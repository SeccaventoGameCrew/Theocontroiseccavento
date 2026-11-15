"""Sync loop: reads the Ambilight colours from the TV and sends them to every strip."""
from __future__ import annotations

import http.client
import logging
import threading
import time

from . import colors, discovery, netutil
from .lights import DRIVERS, LightError, make_light
from .tv import NeedsPairing, PhilipsTV, TVError

log = logging.getLogger("ambisync")

OFF = ("off",)


class LightWorker(threading.Thread):
    """Sends the most recent colour to one strip, never faster than the strip allows.

    Each strip has its own thread, so a slow or unreachable strip never slows
    down the others.
    """

    def __init__(self, dev: dict, settings_fn, factory=make_light):
        super().__init__(daemon=True, name=f"light-{dev['id']}")
        self.dev = dev
        self.settings_fn = settings_fn
        self.factory = factory
        self.light = None
        self.cond = threading.Condition()
        self.pending = None
        self.stopped = False
        self.is_on: bool | None = None
        self.last_sent = None
        self.last_time = 0.0
        self.error: str | None = None
        self.sent_count = 0
        self.current_hex = "#000000"
        self.paused_until = 0.0
        self.prepared = False

    def submit(self, cmd) -> None:
        with self.cond:
            self.pending = cmd
            self.cond.notify()

    def pause(self, seconds: float) -> None:
        """Ignore colours for a while (used while the strip blinks to be identified)."""
        self.paused_until = time.monotonic() + seconds

    def stop(self, turn_off: bool = False) -> None:
        with self.cond:
            self.stopped = True
            self.pending = OFF if turn_off else None
            self.cond.notify()

    # ------------------------------------------------------------------
    def _ensure_light(self, prepare: bool = True) -> None:
        if self.light is None:
            self.light = self.factory(self.dev)
            self.prepared = False
        if prepare and not self.prepared:
            self.light.prepare()  # switches the strip on
            self.prepared = True
            self.is_on = True

    def _execute(self, cmd) -> None:
        s = self.settings_fn()
        threshold = s.get("dark_threshold", 8)
        if cmd == OFF:
            if self.is_on is not False:
                self.light.power(False)
                self.is_on = False
            self.current_hex = "#000000"
            return
        kind, value = cmd
        level = max(max(px) for px in value) if kind == "pixels" and value else (max(value) if kind == "color" else 0)
        if s.get("off_when_dark", True):
            limit = threshold * (1.6 if self.is_on is False else 1.0)
            if level < limit:
                if self.is_on is not False:
                    self.light.power(False)
                    self.is_on = False
                self.current_hex = "#000000"
                self.last_sent = None
                return
        if self.is_on is False:
            self.light.power(True)
            self.is_on = True
        if kind == "pixels":
            self.light.set_pixels(value)
            self.current_hex = colors.to_hex(colors.average(value, vivid=False))
        else:
            self.light.set_color(value)
            self.current_hex = colors.to_hex(value)
        self.last_sent = cmd
        self.sent_count += 1

    def run(self) -> None:
        backoff = 0.0
        while True:
            with self.cond:
                keepalive = getattr(self.light, "keepalive", None) if self.light else None
                while self.pending is None and not self.stopped:
                    if keepalive and self.last_sent is not None:
                        wait = keepalive - (time.monotonic() - self.last_time)
                        if wait <= 0:
                            self.pending = self.last_sent
                            break
                        self.cond.wait(wait)
                    else:
                        self.cond.wait(1.0)
                if self.stopped and self.pending is None:
                    break
                final = self.stopped
            # Respect the strip's maximum command rate; meanwhile a newer colour may arrive.
            if self.light is not None:
                wait = self.light.min_interval - (time.monotonic() - self.last_time)
                if wait > 0 and not final:
                    time.sleep(wait)
            if backoff and not final:
                time.sleep(backoff)
            with self.cond:
                cmd, self.pending = self.pending, None
            if cmd is None:
                if final:
                    break
                continue
            if not final and time.monotonic() < self.paused_until:
                self.last_sent = None
                continue
            if cmd == self.last_sent and time.monotonic() - self.last_time < (
                    getattr(self.light, "keepalive", None) or 5.0) and not final:
                continue
            try:
                self._ensure_light(prepare=cmd != OFF)
                self._execute(cmd)
                self.error = None
                backoff = 0.0
            except (OSError, LightError, http.client.HTTPException, ValueError) as e:
                self.error = str(e) or e.__class__.__name__
                log.warning("%s: %s", self.dev.get("label") or self.dev["id"], self.error)
                if self.light is not None:
                    try:
                        self.light.close()
                    except Exception:
                        pass
                self.light = None
                backoff = min(5.0, backoff * 2 or 0.5)
            except Exception as e:  # unexpected: keep the worker alive
                self.error = f"{e.__class__.__name__}: {e}"
                log.exception("errore inatteso su %s", self.dev["id"])
                self.light = None
                backoff = 5.0
            self.last_time = time.monotonic()
            if final:
                break
        if self.light is not None:
            try:
                self.light.close()
            except Exception:
                pass


class SyncEngine:
    """Owns the TV connection and one LightWorker per enabled strip."""

    def __init__(self, cfg, tv_factory=PhilipsTV.from_config, light_factory=make_light,
                 relocate=True, locate_interval: float = 300.0):
        self.cfg = cfg
        self.tv_factory = tv_factory
        self.light_factory = light_factory
        self.relocate = relocate
        self.locate_interval = locate_interval
        self.thread: threading.Thread | None = None
        self.running = False
        self.workers: dict[str, LightWorker] = {}
        self.smoothed: dict[str, tuple] = {}
        self.state = "fermo"
        self.message = ""
        self.fps = 0.0
        self.frame: dict | None = None
        self.frame_time = 0.0
        self.tv: PhilipsTV | None = None
        self.lock = threading.RLock()

    # -- control -------------------------------------------------------
    def start(self) -> None:
        with self.lock:
            if self.running:
                return
            self.running = True
            self.state, self.message = "avvio", "Mi collego alla TV..."
            self.thread = threading.Thread(target=self._loop, daemon=True, name="sync")
            self.thread.start()

    def stop(self, turn_off: bool = False) -> None:
        with self.lock:
            self.running = False
            thread = self.thread
        if thread and thread is not threading.current_thread():
            thread.join(5)
        self._stop_workers(turn_off)
        if self.tv:
            self.tv.close()
        self.state, self.message, self.fps = "fermo", "", 0.0

    def _stop_workers(self, turn_off: bool) -> None:
        for w in list(self.workers.values()):
            w.stop(turn_off)
        for w in list(self.workers.values()):
            w.join(3)
        self.workers.clear()
        self.smoothed.clear()

    def reload_lights(self) -> None:
        """Apply panel changes (enabled strips, zones) without restarting."""
        if not self.running:
            return
        with self.lock:
            self._reload_lights()

    def _reload_lights(self) -> None:
        wanted = self.active_lights()
        for lid in list(self.workers):
            w = self.workers[lid]
            if lid not in wanted or wanted[lid].get("ip") != w.dev.get("ip"):
                w.stop(turn_off=False)
                del self.workers[lid]
                self.smoothed.pop(lid, None)
        for lid, dev in wanted.items():
            if lid in self.workers:
                self.workers[lid].dev = dev
            else:
                w = LightWorker(dev, lambda: self.cfg.settings, self.light_factory)
                self.workers[lid] = w
                w.start()

    def pause_light(self, light_id: str, seconds: float) -> None:
        w = self.workers.get(light_id)
        if w:
            w.pause(seconds)

    def active_lights(self) -> dict:
        with self.cfg.lock:
            return {lid: dict(d) for lid, d in self.cfg.lights.items() if d.get("enabled") and d.get("ip")}

    # -- status --------------------------------------------------------
    def status(self) -> dict:
        frame = self.frame if (time.monotonic() - self.frame_time) < 5 else None
        return {
            "running": self.running,
            "state": self.state,
            "message": self.message,
            "fps": round(self.fps, 1),
            "frame": {k: [colors.to_hex(px) for px in v] for k, v in frame.items()} if frame else None,
            "lights": {
                lid: {"color": w.current_hex, "error": w.error, "on": w.is_on, "sent": w.sent_count}
                for lid, w in self.workers.items()
            },
        }

    # -- TV ------------------------------------------------------------
    def _open_tv(self, scan: bool) -> PhilipsTV | None:
        tv_cfg = self.cfg.tv
        if not tv_cfg:
            self.message = "Nessuna TV configurata: cercala e selezionala nel pannello."
            return None
        tv = self.tv_factory(tv_cfg)
        try:
            tv.detect()
            if tv.identity_matches(tv_cfg):
                return tv
        except (TVError, netutil.PinMismatch, OSError):
            pass
        tv.close()
        if not (scan and self.relocate):
            return None
        # The TV may have a new IP address (DHCP): look for it on the network.
        self.message = "La TV non risponde all'indirizzo salvato: la cerco in rete..."
        for info in discovery.tvmod.discover():
            same = (info.get("fingerprint") == tv_cfg["fingerprint"]) if tv_cfg.get("fingerprint") \
                else (info.get("name") == tv_cfg.get("name"))
            if same:
                new_cfg = {**tv_cfg, "host": info["host"], "tls": info["tls"], "port": info["port"],
                           "api": info["api"]}
                self.cfg.tv = new_cfg
                log.info("TV trovata al nuovo indirizzo %s", info["host"])
                return self.tv_factory(new_cfg)
        return None

    def _loop(self) -> None:
        last_try = last_scan = 0.0
        offline_since: float | None = None
        tv_off_sent = False
        frames = 0
        fps_window = time.monotonic()
        try:
            self.reload_lights()
            while self.running:
                if self.tv is None:
                    now = time.monotonic()
                    if last_try and now - last_try < 3.0:
                        self._idle(0.5)
                        continue
                    scan = not last_scan or now - last_scan >= self.locate_interval
                    last_try = now
                    if scan:
                        last_scan = now
                    self.tv = self._open_tv(scan)
                    if self.tv is None:
                        if self.cfg.tv:
                            self.state = "tv_assente"
                            self.message = "TV non trovata (spenta o fuori rete). Riprovo tra poco."
                        else:
                            self.state = "errore"
                        offline_since = offline_since or time.monotonic()
                        tv_off_sent = self._maybe_off(offline_since, tv_off_sent)
                        continue
                settings = self.cfg.settings
                period = 1.0 / max(1, settings.get("fps", 10))
                t0 = time.monotonic()
                try:
                    frame = self.tv.frame(settings.get("source", "processed"))
                except NeedsPairing:
                    self.state, self.message = "abbinamento", "La TV chiede l'abbinamento: premi 'Abbina TV' nel pannello."
                    self.running = False
                    break
                except netutil.PinMismatch:
                    self.state, self.message = "errore", "Il certificato della TV è cambiato: ripeti l'abbinamento."
                    self.running = False
                    break
                except (TVError, OSError, http.client.HTTPException) as e:
                    offline_since = offline_since or time.monotonic()
                    self.state = "tv_assente"
                    self.message = f"La TV non risponde ({e.__class__.__name__}). Riprovo..."
                    tv_off_sent = self._maybe_off(offline_since, tv_off_sent)
                    if time.monotonic() - offline_since > 10:
                        self.tv.close()
                        self.tv = None  # will try to locate it again
                    self._idle(1.0)
                    continue
                offline_since = None
                tv_off_sent = False
                self.frame, self.frame_time = frame, time.monotonic()
                self.state, self.message = "attivo", f"Sincronizzazione attiva con {self.tv.name or 'la TV'}"
                self._dispatch(frame, settings)
                frames += 1
                now = time.monotonic()
                if now - fps_window >= 1.0:
                    self.fps = frames / (now - fps_window)
                    frames, fps_window = 0, now
                self._idle(period - (time.monotonic() - t0))
        except Exception as e:  # keep the panel informative instead of dying silently
            log.exception("errore nel ciclo di sincronizzazione")
            self.state, self.message = "errore", f"Errore inatteso: {e}"
            self.running = False

    def _idle(self, seconds: float) -> None:
        end = time.monotonic() + max(0.0, seconds)
        while self.running:
            left = end - time.monotonic()
            if left <= 0:
                break
            time.sleep(min(0.1, left))

    def _maybe_off(self, offline_since: float, already: bool) -> bool:
        if already or not self.cfg.settings.get("off_when_tv_off", True):
            return already
        if time.monotonic() - offline_since < 4.0:
            return False
        for w in self.workers.values():
            w.submit(OFF)
        return True

    # -- colours ---------------------------------------------------------
    def _dispatch(self, frame: dict, settings: dict) -> None:
        bri = settings.get("brightness", 100) / 100.0
        sat = settings.get("saturation", 1.0)
        smoothing = settings.get("smoothing", 0.35)
        with self.lock:
            workers = list(self.workers.items())
        for lid, w in workers:
            dev = w.dev
            zone = dev.get("zone") or "tutto"
            pixels = colors.zone_pixels(frame, zone)
            driver = DRIVERS.get(dev.get("driver"))
            if dev.get("gradient") and driver and driver[1].supports_gradient:
                px = [colors.adjust(p, sat, bri) for p in pixels]
                if dev.get("reverse"):
                    px.reverse()
                prev = self.smoothed.get(lid)
                flat = tuple(c for p in px for c in p)
                flat = colors.smooth(prev, flat, smoothing)
                self.smoothed[lid] = flat
                px = [colors.to_int(flat[i:i + 3]) for i in range(0, len(flat), 3)]
                w.submit(("pixels", px))
            else:
                target = colors.adjust(colors.average(pixels), sat, bri)
                value = colors.smooth(self.smoothed.get(lid), target, smoothing)
                self.smoothed[lid] = value
                w.submit(("color", colors.to_int(value)))
