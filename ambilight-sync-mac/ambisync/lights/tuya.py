"""Tuya / Smart Life (many unbranded strips) - local protocol through the optional
`tinytuya` package. Each device needs its "local key", obtained once with
`python3 -m tinytuya wizard` (see README) and imported in the panel.
"""
from __future__ import annotations

from .base import Light, LightError, device

try:  # optional dependency
    import tinytuya  # type: ignore
except Exception:  # pragma: no cover - depends on the installation
    tinytuya = None

LIGHT_CATEGORIES = {"dj", "dd", "fwd", "dc", "xdd", "fsd", "tgq", "tgkg"}


def available() -> bool:
    return tinytuya is not None


def parse_devices_json(data) -> dict:
    """Read the devices.json created by the tinytuya wizard -> {id: {...}}."""
    out = {}
    if isinstance(data, dict):
        data = data.get("devices") or list(data.values())
    for d in data or []:
        if not isinstance(d, dict) or not d.get("id") or not d.get("key"):
            continue
        if d.get("category") and d["category"] not in LIGHT_CATEGORIES:
            continue
        out[d["id"]] = {
            "name": d.get("name", ""),
            "key": d["key"],
            "ip": d.get("ip") or "",
            "version": str(d.get("version") or "3.3"),
            "model": d.get("product_name") or d.get("model") or "",
        }
    return out


def discover(timeout: float = 4.0, ctx: dict | None = None) -> list[dict]:
    known = dict((ctx or {}).get("tuya_devices") or {})
    if not known:
        return []
    ips = {}
    if tinytuya is not None:
        try:
            scan = tinytuya.deviceScan(False, maxretry=max(3, int(timeout)), color=False, poll=False)
        except Exception:
            scan = {}
        for ip, info in (scan or {}).items():
            gw = info.get("gwId") or info.get("id")
            if gw:
                ips[gw] = (info.get("ip") or ip, str(info.get("version") or ""))
    found = []
    for dev_id, d in known.items():
        ip, version = ips.get(dev_id, (d.get("ip"), d.get("version")))
        if not ip:
            continue
        found.append(device("tuya", "Tuya / Smart Life", dev_id, ip, name=d.get("name", ""),
                            model=d.get("model", ""), key=d["key"], version=version or d.get("version", "3.3"),
                            tuya_id=dev_id))
    return found


class TuyaLight(Light):
    driver = "tuya"
    brand = "Tuya / Smart Life"
    min_interval = 0.2

    def __init__(self, dev: dict):
        super().__init__(dev)
        if tinytuya is None:
            raise LightError("per le strisce Tuya serve il pacchetto tinytuya (vedi README)")
        self.bulb = tinytuya.BulbDevice(self.extra.get("tuya_id") or self.id.split(":", 1)[1], self.ip,
                                        self.extra.get("key"), version=float(self.extra.get("version") or 3.3),
                                        persist=True)
        self.bulb.set_socketPersistent(True)
        self.bulb.set_socketTimeout(2)

    def prepare(self) -> None:
        self.bulb.turn_on(nowait=True)

    def set_color(self, rgb):
        r, g, b = rgb
        if max(rgb) <= 0:
            self.power(False)
            return
        self.bulb.set_colour(r, g, b, nowait=True)

    def power(self, on: bool) -> None:
        if on:
            self.bulb.turn_on(nowait=True)
        else:
            self.bulb.turn_off(nowait=True)

    def close(self) -> None:
        try:
            self.bulb.close()
        except Exception:
            pass
