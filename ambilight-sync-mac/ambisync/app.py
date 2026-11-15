"""Application state and the local web server that serves the control panel."""
from __future__ import annotations

import collections
import json
import logging
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import __version__, colors, discovery, netutil
from .config import DEFAULT_ZONES, Config
from .engine import SyncEngine
from .lights import BRANDS, DRIVERS, LightError, make_light
from .lights import hue as huemod
from .lights import tuya as tuyamod
from .lights import wled as wledmod
from .lights.base import device
from .tv import PairingError, PhilipsTV, TVError, describe, verify

log = logging.getLogger("ambisync")
WEB_DIR = Path(__file__).parent / "web"
EDITABLE = ("label", "zone", "enabled", "gradient", "reverse")


class MemoryLog(logging.Handler):
    def __init__(self, size: int = 200):
        super().__init__()
        self.lines = collections.deque(maxlen=size)

    def emit(self, record):
        self.lines.append(time.strftime("%H:%M:%S ") + record.getMessage())


class Job:
    def __init__(self):
        self.running = False
        self.message = ""
        self.error: str | None = None
        self.result = None
        self.finished_at = 0.0

    def as_dict(self):
        return {"running": self.running, "message": self.message, "error": self.error,
                "result": self.result, "finished_at": self.finished_at}


class App:
    def __init__(self, cfg: Config, engine: SyncEngine | None = None, scanner=discovery.scan):
        self.cfg = cfg
        self.engine = engine or SyncEngine(cfg)
        self.scanner = scanner
        self.jobs = collections.defaultdict(Job)
        self.last_scan: dict | None = None
        self.pending_tv: PhilipsTV | None = None
        self.quit = threading.Event()
        self.memlog = MemoryLog()
        logging.getLogger("ambisync").addHandler(self.memlog)

    # -- background jobs -------------------------------------------------
    def run_job(self, name: str, fn, *args) -> bool:
        job = self.jobs[name]
        if job.running:
            return False
        job.running, job.error, job.result, job.message = True, None, None, ""

        def runner():
            try:
                job.result = fn(job, *args)
            except (TVError, LightError, netutil.PinMismatch, OSError, ValueError) as e:
                job.error = str(e) or e.__class__.__name__
                log.warning("%s: %s", name, job.error)
            except Exception as e:  # pragma: no cover - safety net
                job.error = f"{e.__class__.__name__}: {e}"
                log.exception("errore in %s", name)
            finally:
                job.running = False
                job.finished_at = time.time()

        threading.Thread(target=runner, daemon=True, name=f"job-{name}").start()
        return True

    # -- startup -----------------------------------------------------------
    def startup(self) -> None:
        """Look for the TV and the strips (their IPs may have changed), then start syncing."""
        def job(j):
            self._scan(j)
            if self.cfg.settings.get("autostart") and self.cfg.tv and self.engine_ready():
                self.engine.start()
            return None
        self.run_job("scan", job)

    def engine_ready(self) -> bool:
        return any(d.get("enabled") for d in self.cfg.lights.values())

    # -- scan --------------------------------------------------------------
    def _scan(self, job: Job) -> dict:
        def progress(msg):
            job.message = msg
            log.info(msg)

        result = self.scanner(self.cfg.snapshot(), progress)
        self.last_scan = result
        self._merge_scan(result)
        job.message = f"Ricerca completata in {result.get('duration', 0)} s"
        log.info("%s: %d TV, %d strisce", job.message, len(result["tvs"]), len(result["lights"]))
        return {"tvs": len(result["tvs"]), "lights": len(result["lights"])}

    def _merge_scan(self, result: dict) -> None:
        with self.cfg.lock:
            lights = self.cfg.lights
            used = {d.get("label") for d in lights.values() if d.get("label")}
            for found in result.get("lights", []):
                cur = lights.get(found["id"])
                if cur:
                    cur.update({k: found[k] for k in ("ip", "model", "brand") if found.get(k)})
                    if found.get("name"):
                        cur["name"] = found["name"]
                    cur["extra"] = {**(cur.get("extra") or {}), **(found.get("extra") or {})}
                    continue
                label = discovery.match_target(found.get("name", ""), self.cfg.targets)
                if label in used:
                    label = None
                if label:
                    used.add(label)
                lights[found["id"]] = {
                    **found,
                    "label": label,
                    "zone": DEFAULT_ZONES.get(label or "", "tutto"),
                    "enabled": bool(label),
                    "gradient": found["driver"] == "wled",
                    "reverse": False,
                }
            # Hue bridges may have a new IP address
            saved_bridges = self.cfg.data.get("hue_bridges") or {}
            for b in result.get("hue_found", []):
                if b["id"] in saved_bridges:
                    saved_bridges[b["id"]].update(ip=b["ip"], port=b.get("port", 80))
            # TV moved to another IP?
            tv_cfg = self.cfg.tv
            if tv_cfg:
                for info in result.get("tvs", []):
                    same = (info.get("fingerprint") == tv_cfg.get("fingerprint")) if tv_cfg.get("fingerprint") \
                        else (info.get("name") == tv_cfg.get("name"))
                    if same and info["host"] != tv_cfg.get("host"):
                        log.info("La TV ora è a %s", info["host"])
                        self.cfg.data["tv"] = {**tv_cfg, "host": info["host"], "tls": info["tls"],
                                               "port": info["port"], "api": info["api"]}
            self.cfg.save()
        self.engine.reload_lights()

    # -- TV ------------------------------------------------------------------
    def select_tv(self, host: str) -> None:
        def job(j):
            j.message = f"Contatto la TV a {host}..."
            old = self.cfg.tv or {}
            tv = PhilipsTV(host)
            tv.detect()
            new = tv.to_config()
            same = old and ((old.get("fingerprint") and old.get("fingerprint") == new.get("fingerprint"))
                            or (not old.get("fingerprint") and old.get("name") == new.get("name")))
            if same:
                new["user"], new["password"] = old.get("user"), old.get("password")
            new["pairing_required"] = tv.pairing_required
            new["ambilight_features"] = tv.ambilight_features
            self.cfg.tv = new
            self._restart_engine()
            j.message = f"TV selezionata: {tv.name or host}"
            return describe(tv)
        self.run_job("tv", job)

    def pair_start(self) -> None:
        def job(j):
            if not self.cfg.tv:
                raise TVError("seleziona prima una TV")
            tv = PhilipsTV(self.cfg.tv["host"], tls=self.cfg.tv.get("tls"), port=self.cfg.tv.get("port"),
                           api=self.cfg.tv.get("api", 6))
            tv.detect()
            info = tv.pair_request()
            self.pending_tv = tv
            j.message = "Inserisci il PIN che compare sulla TV"
            return info
        self.run_job("pair", job)

    def pair_finish(self, pin: str) -> None:
        def job(j):
            tv = self.pending_tv
            if tv is None:
                raise PairingError("avvia prima l'abbinamento")
            tv.pair_grant(pin)
            cfg = tv.to_config()
            cfg["pairing_required"] = True
            cfg["ambilight_features"] = tv.ambilight_features
            self.cfg.tv = cfg
            self.pending_tv = None
            self._restart_engine()
            j.message = "TV abbinata"
            return True
        self.run_job("pair", job)

    def _restart_engine(self) -> None:
        """Pick up new TV address/credentials if syncing is running."""
        if self.engine.running:
            self.engine.stop()
            self.engine.start()

    def verify_tv(self) -> None:
        def job(j):
            if not self.cfg.tv:
                raise TVError("seleziona prima una TV")
            j.message = "Verifico che la TV esponga i colori Ambilight..."
            report = verify(PhilipsTV.from_config(self.cfg.tv))
            if report.get("sample"):
                report["sample"] = {k: [colors.to_hex(px) for px in v] for k, v in report["sample"].items()}
            j.message = "La TV espone i colori Ambilight" if report["ok"] else "La TV non espone i colori Ambilight"
            return report
        self.run_job("verify", job)

    # -- lights --------------------------------------------------------------
    def update_light(self, light_id: str, changes: dict) -> None:
        with self.cfg.lock:
            dev = self.cfg.lights.get(light_id)
            if not dev:
                raise ValueError("striscia sconosciuta")
            for key in EDITABLE:
                if key not in changes:
                    continue
                value = changes[key]
                if key == "label":
                    value = value or None
                    if value and value not in self.cfg.targets:
                        raise ValueError("nome non valido")
                    if value:
                        for other in self.cfg.lights.values():
                            if other is not dev and other.get("label") == value:
                                other["label"] = None
                                other["enabled"] = False
                        if not dev.get("label") and "zone" not in changes:
                            dev["zone"] = DEFAULT_ZONES.get(value, dev.get("zone", "tutto"))
                        if "enabled" not in changes:
                            dev["enabled"] = True
                elif key == "zone":
                    if value not in colors.ZONES:
                        raise ValueError("zona non valida")
                else:
                    value = bool(value)
                dev[key] = value
            self.cfg.save()
        self.engine.reload_lights()

    def remove_light(self, light_id: str) -> None:
        with self.cfg.lock:
            self.cfg.lights.pop(light_id, None)
            self.cfg.save()
        self.engine.reload_lights()

    def add_light(self, driver: str, ip: str) -> None:
        def job(j):
            if driver not in DRIVERS or driver in ("hue", "tuya"):
                raise ValueError("marca non valida per l'aggiunta manuale")
            if driver == "wled":
                dev = wledmod.probe(ip)
                if not dev:
                    raise LightError(f"nessun WLED risponde a {ip}")
            else:
                dev = device(driver, BRANDS[driver], ip, ip)
            self._merge_scan({"lights": [dev], "tvs": []})
            j.message = f"Aggiunta: {BRANDS[driver]} {ip}"
            return dev["id"]
        self.run_job("add", job)

    def identify(self, light_id: str) -> None:
        dev = self.cfg.lights.get(light_id)
        if not dev:
            raise ValueError("striscia sconosciuta")

        def job(j):
            self.engine.pause_light(light_id, 4.0)
            time.sleep(0.2)
            light = make_light(dict(dev))
            try:
                light.identify()
            finally:
                light.close()
            j.message = "Lampeggio completato"
            return light_id
        self.run_job(f"identify:{light_id}", job)

    def hue_link(self, bridge_ip: str) -> None:
        def job(j):
            info = huemod.probe_bridge(bridge_ip)
            if not info:
                raise LightError(f"nessun Bridge Hue a {bridge_ip}")
            username = huemod.link(bridge_ip)
            with self.cfg.lock:
                self.cfg.data["hue_bridges"][info["id"]] = {"ip": bridge_ip, "port": info["port"],
                                                            "username": username, "name": info["name"]}
                self.cfg.save()
            found = huemod.lights_of({**info, "username": username})
            self._merge_scan({"lights": found, "tvs": []})
            j.message = f"Bridge collegato: {len(found)} luci a colori trovate"
            return len(found)
        self.run_job("hue", job)

    def tuya_import(self, text: str) -> int:
        try:
            data = json.loads(text)
        except ValueError as e:
            raise ValueError("il contenuto non è un devices.json valido") from e
        devices = tuyamod.parse_devices_json(data)
        if not devices:
            raise ValueError("nessuna luce Tuya trovata nel file")
        with self.cfg.lock:
            self.cfg.data["tuya_devices"].update(devices)
            self.cfg.save()
        return len(devices)

    # -- state for the panel -------------------------------------------------
    def state(self) -> dict:
        tv = dict(self.cfg.tv) if self.cfg.tv else None
        if tv:
            tv["paired"] = bool(tv.pop("password", None)) and bool(tv.get("user"))
            tv.pop("user", None)
            tv.pop("fingerprint", None)
        engine = self.engine.status()
        lights = []
        for lid, d in sorted(self.cfg.lights.items(),
                             key=lambda kv: (kv[1].get("label") is None, kv[1].get("label") or "", kv[0])):
            item = {k: d.get(k) for k in ("id", "driver", "brand", "name", "ip", "model", "label", "zone",
                                           "enabled", "gradient", "reverse")}
            item["supports_gradient"] = DRIVERS[d["driver"]][1].supports_gradient if d.get("driver") in DRIVERS else False
            item["live"] = engine["lights"].get(lid)
            lights.append(item)
        assigned = {d.get("label") for d in self.cfg.lights.values() if d.get("label")}
        scan = None
        if self.last_scan:
            scan = {k: self.last_scan.get(k) for k in ("tvs", "hue_bridges", "hints", "warnings", "local_ip",
                                                        "duration")}
        return {
            "version": __version__,
            "tv": tv,
            "targets": self.cfg.targets,
            "missing": [t for t in self.cfg.targets if t not in assigned],
            "zones": colors.ZONES,
            "brands": BRANDS,
            "lights": lights,
            "settings": self.cfg.settings,
            "engine": engine,
            "jobs": {name: job.as_dict() for name, job in self.jobs.items()},
            "scan": scan,
            "pairing_pending": self.pending_tv is not None,
            "tuya_available": tuyamod.available(),
            "tuya_count": len(self.cfg.data.get("tuya_devices") or {}),
            "hue_linked": [{"id": k, "ip": v.get("ip"), "name": v.get("name")}
                           for k, v in (self.cfg.data.get("hue_bridges") or {}).items()],
            "log": list(self.memlog.lines)[-60:],
        }


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------
def make_handler(app: App, port: int):
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class Handler(BaseHTTPRequestHandler):
        server_version = "AmbilightSync"

        def log_message(self, fmt, *args):  # keep the console quiet
            pass

        def _send(self, status: int, body: bytes, ctype: str = "application/json") -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, data, status: int = 200) -> None:
            self._send(status, json.dumps(data, ensure_ascii=False).encode())

        def _host_ok(self) -> bool:
            # Protects against DNS-rebinding: only answer to localhost names.
            return self.headers.get("Host", "") in allowed_hosts

        def do_GET(self):
            if not self._host_ok():
                return self._send(403, b"forbidden", "text/plain")
            path = self.path.split("?", 1)[0]
            if path in ("/", "/index.html"):
                body = (WEB_DIR / "index.html").read_bytes()
                return self._send(200, body, "text/html; charset=utf-8")
            if path == "/api/ping":
                return self._json({"ok": True, "app": "ambisync"})
            if path == "/api/state":
                return self._json(app.state())
            return self._send(404, b"not found", "text/plain")

        def do_POST(self):
            if not self._host_ok() or self.headers.get("X-Ambisync") != "1":
                return self._send(403, b"forbidden", "text/plain")
            try:
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}") if length else {}
                if not isinstance(body, dict):
                    raise ValueError("richiesta non valida")
                result = self.route(self.path, body)
                self._json({"ok": True, "result": result})
            except (ValueError, KeyError, TVError, LightError) as e:
                self._json({"ok": False, "error": str(e)}, 400)

        def route(self, path: str, b: dict):
            if path == "/api/scan":
                return app.run_job("scan", app._scan)
            if path == "/api/tv/select":
                return app.select_tv(str(b["host"]).strip())
            if path == "/api/tv/pair/start":
                return app.pair_start()
            if path == "/api/tv/pair/finish":
                return app.pair_finish(str(b["pin"]))
            if path == "/api/tv/verify":
                return app.verify_tv()
            if path == "/api/lights/update":
                return app.update_light(b["id"], b)
            if path == "/api/lights/remove":
                return app.remove_light(b["id"])
            if path == "/api/lights/add":
                return app.add_light(b["driver"], str(b["ip"]).strip())
            if path == "/api/lights/identify":
                return app.identify(b["id"])
            if path == "/api/hue/link":
                return app.hue_link(str(b["ip"]).strip())
            if path == "/api/tuya/import":
                return app.tuya_import(str(b["text"]))
            if path == "/api/settings":
                return app.cfg.update_settings(b)
            if path == "/api/sync/start":
                if not app.cfg.tv:
                    raise ValueError("seleziona prima la TV")
                if not app.engine_ready():
                    raise ValueError("attiva almeno una striscia")
                app.engine.start()
                return True
            if path == "/api/sync/stop":
                threading.Thread(target=app.engine.stop, kwargs={"turn_off": bool(b.get("turn_off"))},
                                 daemon=True).start()
                return True
            if path == "/api/quit":
                app.quit.set()
                return True
            raise ValueError("comando sconosciuto")

    return Handler


def serve(app: App, port: int = 8765, ready=None) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(app, port))
    server.daemon_threads = True
    actual = server.server_address[1]
    if actual != port:  # port 0 in tests
        server.RequestHandlerClass = make_handler(app, actual)
    threading.Thread(target=server.serve_forever, daemon=True, name="http").start()
    if ready:
        ready(actual)
    try:
        while not app.quit.wait(0.2):
            pass
    finally:
        app.engine.stop()
        server.shutdown()
        server.server_close()
