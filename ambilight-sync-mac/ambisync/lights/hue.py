"""Philips Hue via the Hue Bridge (local REST API v1).

The Bridge accepts about 10 commands per second in total, so with several Hue
lights each one is updated a little less often.
"""
from __future__ import annotations

import http.client
import threading

from .. import colors, netutil
from .base import Light, LightError, device


def probe_bridge(host: str, port: int = 80) -> dict | None:
    data = netutil.http_get_json(host, "/api/config", port=port, timeout=1.5)
    if isinstance(data, dict) and data.get("bridgeid"):
        return {"id": data["bridgeid"].lower(), "ip": host, "port": port, "name": data.get("name", "Hue Bridge")}
    return None


def find_bridges(ctx: dict | None = None) -> list[dict]:
    ctx = ctx or {}
    hosts = set()
    for ip, text in (ctx.get("ssdp") or {}).items():
        if "hue-bridgeid" in text.lower() or "ipbridge" in text.lower():
            hosts.add(ip)
    for ip, ports in (ctx.get("sweep") or {}).items():
        if 80 in ports:
            hosts.add(ip)
    bridges = []
    for host in sorted(hosts):
        b = probe_bridge(host)
        if b:
            bridges.append(b)
    return bridges


def link(host: str, port: int = 80) -> str:
    """Create an API user. The round button on the Bridge must be pressed first."""
    client = netutil.HttpClient(host, port, timeout=3)
    try:
        status, data = client.post_json("/api", {"devicetype": "ambisync#mac"})
    finally:
        client.close()
    if isinstance(data, list) and data:
        if "success" in data[0]:
            return data[0]["success"]["username"]
        err = data[0].get("error") or {}
        if err.get("type") == 101:
            raise LightError("premi il pulsante rotondo sul Bridge Hue e riprova entro 30 secondi")
        raise LightError(err.get("description") or str(data))
    raise LightError(f"risposta inattesa dal Bridge ({status})")


def lights_of(bridge: dict) -> list[dict]:
    port = int(bridge.get("port", 80))
    data = netutil.http_get_json(bridge["ip"], f"/api/{bridge['username']}/lights", port=port, timeout=3)
    found = []
    if not isinstance(data, dict):
        return found
    for num, light in data.items():
        if not isinstance(light, dict) or "xy" not in (light.get("state") or {}):
            continue  # not a colour light
        uid = light.get("uniqueid") or f"{bridge['id']}-{num}"
        extra = {"bridge": bridge["id"], "num": num, "username": bridge["username"]}
        if port != 80:
            extra["port"] = port
        found.append(device("hue", "Philips Hue", uid, bridge["ip"], name=light.get("name", ""),
                            model=light.get("modelid", ""), **extra))
    return found


def discover(timeout: float = 2.0, ctx: dict | None = None) -> list[dict]:
    ctx = ctx if ctx is not None else {}
    saved = dict(ctx.get("hue_bridges") or {})
    found_bridges = find_bridges(ctx)
    ctx["hue_found"] = found_bridges
    for b in found_bridges:
        if b["id"] in saved:
            saved[b["id"]]["ip"] = b["ip"]  # IP may have changed
            saved[b["id"]]["port"] = b.get("port", 80)
    lights = []
    for bridge_id, b in saved.items():
        if b.get("username") and b.get("ip"):
            lights += lights_of({**b, "id": bridge_id})
    return lights


class HueLight(Light):
    driver = "hue"
    brand = "Philips Hue"
    _active = 0
    _active_lock = threading.Lock()

    def __init__(self, dev: dict):
        super().__init__(dev)
        self.port = int(self.extra.get("port", 80))
        self.path = f"/api/{self.extra.get('username')}/lights/{self.extra.get('num')}/state"
        self.client = netutil.HttpClient(self.ip, self.port, timeout=2)
        self._counted = False

    @property
    def min_interval(self) -> float:  # type: ignore[override]
        return max(0.15, 0.11 * max(1, HueLight._active))

    def _put(self, body: dict) -> None:
        try:
            status, data = self.client.put_json(self.path, body)
        except (OSError, http.client.HTTPException) as e:
            raise LightError(str(e)) from e
        if isinstance(data, list) and data and "error" in data[0]:
            raise LightError(data[0]["error"].get("description", "errore Hue"))

    def prepare(self) -> None:
        if not self._counted:
            with HueLight._active_lock:
                HueLight._active += 1
            self._counted = True
        self._put({"on": True})

    def set_color(self, rgb):
        _, pct = colors.split_brightness(rgb)
        if pct <= 0:
            self.power(False)
            return
        x, y = colors.rgb_to_xy(rgb)
        self._put({"on": True, "xy": [x, y], "bri": max(1, min(254, int(round(pct * 2.54)))),
                   "transitiontime": 1})

    def power(self, on: bool) -> None:
        self._put({"on": bool(on)})

    def close(self) -> None:
        if self._counted:
            with HueLight._active_lock:
                HueLight._active = max(0, HueLight._active - 1)
            self._counted = False
        self.client.close()
