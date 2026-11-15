"""Philips TV (JointSPACE API): discovery, pairing and reading of Ambilight colours."""
from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import secrets
import time
from concurrent.futures import ThreadPoolExecutor

from . import netutil

HTTP_PORT = 1925
HTTPS_PORT = 1926
SIDES = ("left", "top", "right", "bottom")

# Public key shared by every JointSPACE client (also used by Home Assistant).
AUTH_SHARED_KEY = base64.b64decode(
    "ZmVay1EQVFOaZhwQ4Kv81ypLAZNczV9sG4KkseXWn1NEk6cXmPKO/MCa9sryslvLCFMnNe4Z4CPXzToowvhHvA=="
)


class TVError(Exception):
    pass


class NeedsPairing(TVError):
    pass


class PairingError(TVError):
    pass


def hmac_signature(timestamp: str, pin: str, key: bytes = AUTH_SHARED_KEY) -> str:
    digest = hmac.new(key, timestamp.encode() + pin.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


def parse_layers(data) -> dict | None:
    """Turn {'layer1': {'left': {'0': {'r':..}}}} into {'left': [(r, g, b), ...], ...}."""
    if not isinstance(data, dict):
        return None
    layer = data.get("layer1")
    if not isinstance(layer, dict):
        layers = [v for k, v in sorted(data.items()) if str(k).startswith("layer") and isinstance(v, dict)]
        layer = layers[0] if layers else None
    if not isinstance(layer, dict):
        return None
    frame: dict = {}
    for side in SIDES:
        pixels = layer.get(side) or {}
        items = []
        if isinstance(pixels, dict):
            for key, value in pixels.items():
                if str(key).isdigit() and isinstance(value, dict):
                    items.append((int(key), value))
        items.sort(key=lambda kv: kv[0])
        frame[side] = [
            tuple(max(0, min(255, int(v.get(c, 0) or 0))) for c in ("r", "g", "b")) for _, v in items
        ]
    return frame


class PhilipsTV:
    """One Philips TV. `tls`/`port`/`api` are detected by `detect()` when unknown."""

    def __init__(self, host: str, *, tls: bool | None = None, port: int | None = None, api: int = 6,
                 user: str | None = None, password: str | None = None,
                 fingerprint: str | None = None, timeout: float = 3.0, name: str | None = None):
        self.host = host
        self.tls = tls
        self.port = port
        self.api = api
        self.user = user
        self.password = password
        self.fingerprint = fingerprint
        self.timeout = timeout
        self.name = name
        self.system: dict = {}
        self._client: netutil.HttpClient | None = None
        self._pair_state: dict | None = None

    # -- persistence -------------------------------------------------------
    @classmethod
    def from_config(cls, cfg: dict, **kw) -> "PhilipsTV":
        return cls(cfg["host"], tls=cfg.get("tls"), port=cfg.get("port"), api=cfg.get("api", 6),
                   user=cfg.get("user"), password=cfg.get("password"),
                   fingerprint=cfg.get("fingerprint"), name=cfg.get("name"), **kw)

    def to_config(self) -> dict:
        return {
            "host": self.host, "tls": self.tls, "port": self.port, "api": self.api,
            "user": self.user, "password": self.password, "fingerprint": self.fingerprint,
            "name": self.name, "model": self.model,
        }

    @property
    def model(self) -> str | None:
        return self.system.get("model") or self.system.get("name") or self.name

    @property
    def pairing_required(self) -> bool:
        feats = (self.system.get("featuring") or {}).get("systemfeatures") or {}
        return feats.get("pairing_type") == "digest_auth_pairing"

    @property
    def paired(self) -> bool:
        return bool(self.user and self.password)

    @property
    def ambilight_features(self) -> list:
        feats = (self.system.get("featuring") or {}).get("jsonfeatures") or {}
        return list(feats.get("ambilight") or [])

    # -- transport ---------------------------------------------------------
    def _client_for(self, tls: bool, port: int) -> netutil.HttpClient:
        return netutil.HttpClient(self.host, port, tls, user=self.user, password=self.password,
                                  fingerprint=self.fingerprint if tls else None, timeout=self.timeout)

    @property
    def client(self) -> netutil.HttpClient:
        if self._client is None:
            if self.tls is None or self.port is None:
                self.detect()
            self._client = self._client_for(bool(self.tls), int(self.port))
        return self._client

    def close(self) -> None:
        if self._client:
            self._client.close()
        self._client = None

    def detect(self) -> dict:
        """Find protocol/port/API version by asking /system. Raises TVError if not a Philips TV."""
        attempts = [(True, HTTPS_PORT, 6), (False, HTTP_PORT, 6), (False, HTTP_PORT, 5), (False, HTTP_PORT, 1)]
        if self.tls is not None and self.port:
            attempts.insert(0, (self.tls, self.port, self.api))
        last_error: Exception | None = None
        for tls, port, api in attempts:
            client = self._client_for(tls, port)
            try:
                status, data = client.get_json(f"/{api}/system", auth=False)
            except netutil.PinMismatch:
                client.close()
                raise
            except (OSError, http.client.HTTPException) as e:
                last_error = e
                client.close()
                continue
            if status == 200 and isinstance(data, dict) and ("name" in data or "api_version" in data):
                major = (data.get("api_version") or {}).get("Major")
                self.system = data
                self.api = int(major) if major else api
                self.tls, self.port = tls, port
                if tls and client.seen_fingerprint and not self.fingerprint:
                    self.fingerprint = client.seen_fingerprint
                feats = (data.get("featuring") or {}).get("systemfeatures") or {}
                if str(feats.get("secured_transport", "")).lower() == "true" and not tls:
                    # TV prefers HTTPS: re-check there.
                    client.close()
                    try:
                        s_client = self._client_for(True, HTTPS_PORT)
                        st, sd = s_client.get_json(f"/{self.api}/system", auth=False)
                        if st == 200:
                            self.tls, self.port = True, HTTPS_PORT
                            if not self.fingerprint:
                                self.fingerprint = s_client.seen_fingerprint
                        s_client.close()
                    except (OSError, http.client.HTTPException):
                        pass
                else:
                    client.close()
                self.name = data.get("name") or self.name
                self.close()
                return data
            client.close()
        raise TVError(f"{self.host}: nessuna TV Philips risponde ({last_error or 'risposta non valida'})")

    def _path(self, path: str) -> str:
        return f"/{self.api}/{path}"

    def get(self, path: str):
        status, data = self.client.get_json(self._path(path))
        if status == 401:
            raise NeedsPairing("la TV richiede l'abbinamento")
        if status != 200:
            return None
        return data

    def post(self, path: str, body):
        status, data = self.client.post_json(self._path(path), body)
        if status == 401:
            raise NeedsPairing("la TV richiede l'abbinamento")
        return data if status == 200 else None

    # -- pairing -----------------------------------------------------------
    def pair_request(self, device_name: str = "Ambilight Sync (Mac)") -> dict:
        if not self.system:
            self.detect()
        device = {
            "device_name": device_name,
            "device_os": "macOS",
            "type": "native",
            "id": secrets.token_hex(8),
            "app_id": "it.ambisync.mac",
            "app_name": "Ambilight Sync",
        }
        body = {"access": {"scope": ["read", "write", "control"]}, "device": device}
        featuring = self.system.get("featuring")
        if featuring:
            body["access"]["featuring"] = featuring
        client = self._client_for(bool(self.tls), int(self.port))
        try:
            status, data = client.post_json(self._path("pair/request"), body, auth=False)
        finally:
            client.close()
        if not isinstance(data, dict) or data.get("error_id") != "SUCCESS":
            raise PairingError(f"la TV ha rifiutato la richiesta di abbinamento ({status}: {data})")
        self._pair_state = {"device": device, "auth_key": data["auth_key"], "timestamp": data["timestamp"]}
        return {"timeout": data.get("timeout", 60)}

    def pair_grant(self, pin: str) -> None:
        state = self._pair_state
        if not state:
            raise PairingError("avvia prima l'abbinamento")
        pin = str(pin).strip()
        auth = {
            "auth_appId": "1",
            "auth_timestamp": state["timestamp"],
            "auth_signature": hmac_signature(str(state["timestamp"]), pin),
            "pin": pin,
        }
        client = netutil.HttpClient(self.host, int(self.port), bool(self.tls), user=state["device"]["id"],
                                    password=state["auth_key"], fingerprint=self.fingerprint, timeout=self.timeout)
        try:
            status, data = client.post_json(self._path("pair/grant"), {"auth": auth, "device": state["device"]})
        finally:
            client.close()
        if not isinstance(data, dict) or data.get("error_id") != "SUCCESS":
            raise PairingError(f"PIN non accettato ({status}: {data})")
        self.user, self.password = state["device"]["id"], state["auth_key"]
        self._pair_state = None
        self.close()

    # -- ambilight ---------------------------------------------------------
    def topology(self) -> dict | None:
        data = self.get("ambilight/topology")
        return data if isinstance(data, dict) else None

    def frame(self, source: str = "processed") -> dict:
        data = self.get(f"ambilight/{source}")
        frame = parse_layers(data)
        if frame is None:
            raise TVError(f"la TV non espone i colori Ambilight ({source})")
        return frame

    def ambilight_power(self) -> str | None:
        try:
            data = self.get("ambilight/power")
        except TVError:
            return None
        if isinstance(data, dict):
            return data.get("power")
        return None

    def identity_matches(self, other_cfg: dict | None) -> bool:
        """Is this the same TV as the one saved in the configuration?"""
        if not other_cfg:
            return True
        if self.fingerprint and other_cfg.get("fingerprint"):
            return self.fingerprint == other_cfg["fingerprint"]
        return bool(self.name) and self.name == other_cfg.get("name")


# --------------------------------------------------------------------------
# Discovery and verification
# --------------------------------------------------------------------------
def probe(host: str, timeout: float = 2.0) -> dict | None:
    tv = PhilipsTV(host, timeout=timeout)
    try:
        tv.detect()
    except (TVError, netutil.PinMismatch):
        return None
    return describe(tv)


def describe(tv: PhilipsTV) -> dict:
    return {
        "host": tv.host, "tls": tv.tls, "port": tv.port, "api": tv.api, "name": tv.name,
        "model": tv.model, "fingerprint": tv.fingerprint, "pairing_required": tv.pairing_required,
        "ambilight_features": tv.ambilight_features,
        "has_ambilight": bool(tv.ambilight_features) or tv.api < 6,
    }


def discover(hosts_with_ports: dict | None = None, timeout: float = 0.6, extra_hosts=()) -> list[dict]:
    """Find Philips TVs. `hosts_with_ports` is an existing sweep result (optional)."""
    if hosts_with_ports is None:
        ip = netutil.local_ipv4()
        hosts = netutil.subnet_hosts(ip) if ip else []
        ssdp = netutil.ssdp_search(timeout=1.5)
        hosts = sorted(set(hosts) | set(ssdp))
        hosts_with_ports = netutil.sweep(hosts, [HTTP_PORT, HTTPS_PORT], timeout=timeout)
    candidates = {h for h, ports in hosts_with_ports.items() if ports & {HTTP_PORT, HTTPS_PORT}}
    candidates |= set(extra_hosts)
    if not candidates:
        return []
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(probe, sorted(candidates)))
    return [r for r in results if r]


def verify(tv: PhilipsTV, samples: int = 10) -> dict:
    """Check that the TV exposes Ambilight colours. Returns a report for the panel."""
    checks = []
    report = {"ok": False, "checks": checks, "fps": None, "sample": None, "topology": None}

    def add(label, ok, detail=""):
        checks.append({"label": label, "ok": ok, "detail": detail})

    try:
        tv.detect()
    except (TVError, netutil.PinMismatch) as e:
        add("TV raggiungibile in rete", False, str(e))
        return report
    add("TV raggiungibile in rete", True,
        f"{tv.name or 'TV Philips'} a {tv.host} - API JointSPACE v{tv.api} ({'https' if tv.tls else 'http'})")
    feats = tv.ambilight_features
    add("Ambilight dichiarato dalla TV", bool(feats) or tv.api < 6,
        ", ".join(feats) if feats else ("API vecchia: nessun elenco funzioni" if tv.api < 6 else "nessuna funzione Ambilight"))
    if tv.pairing_required:
        add("Abbinamento con la TV", tv.paired, "fatto" if tv.paired else "necessario: premi 'Abbina' e inserisci il PIN")
    try:
        topo = tv.topology()
        if topo:
            report["topology"] = topo
            add("Topologia LED", True, "sinistra {left}, alto {top}, destra {right}, basso {bottom}".format(
                **{s: topo.get(s, 0) for s in SIDES}))
        else:
            add("Topologia LED", False, "non disponibile")
        for source, label in (("processed", "Colori Ambilight (processed)"), ("measured", "Colori dello schermo (measured)")):
            try:
                frame = tv.frame(source)
                n = sum(len(v) for v in frame.values())
                add(label, n > 0, f"{n} LED letti")
                if source == "processed" and n:
                    report["sample"] = frame
                    report["ok"] = True
            except TVError as e:
                if isinstance(e, NeedsPairing):
                    raise
                add(label, False, str(e))
        power = tv.ambilight_power()
        if power:
            add("Ambilight acceso", power.lower() == "on",
                "acceso" if power.lower() == "on" else "spento: accendilo dal telecomando (tasto Ambilight)")
        if report["ok"]:
            t0 = time.monotonic()
            done = 0
            for _ in range(samples):
                try:
                    tv.frame("processed")
                    done += 1
                except (TVError, OSError):
                    break
            elapsed = time.monotonic() - t0
            if done:
                report["fps"] = round(done / elapsed, 1) if elapsed > 0 else None
                add("Velocità di lettura", True, f"{report['fps']} letture al secondo")
    except NeedsPairing:
        add("Accesso ai colori Ambilight", False, "la TV chiede l'abbinamento: premi 'Abbina' e inserisci il PIN")
    except (OSError, http.client.HTTPException) as e:
        add("Accesso ai colori Ambilight", False, f"errore di rete: {e}")
    except netutil.PinMismatch as e:
        add("Accesso ai colori Ambilight", False, f"{e}: ripeti l'abbinamento")
    finally:
        tv.close()
    return report
