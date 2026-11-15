"""Philips WiZ - local UDP API on port 38899 (enable "Local communication" in the WiZ app)."""
from __future__ import annotations

import json
import socket

from .. import colors, netutil
from .base import Light, device

PORT = 38899


def discover(timeout: float = 2.5, ctx: dict | None = None, destinations=None) -> list[dict]:
    dests = destinations or netutil.broadcast_destinations(PORT)
    msg = json.dumps({"method": "getPilot", "params": {}}).encode()
    replies = netutil.udp_collect(msg, dests, timeout)
    found = []
    for ip, raw in replies.items():
        try:
            data = json.loads(raw.decode())
        except (ValueError, AttributeError):
            continue
        result = data.get("result") or {}
        mac = result.get("mac")
        if not mac:
            continue
        port = dests[0][1]
        model = ""
        cfg = netutil.udp_collect(json.dumps({"method": "getSystemConfig", "params": {}}).encode(),
                                  [(ip, port)], 0.8, repeat=1)
        try:
            model = json.loads(cfg[ip].decode())["result"].get("moduleName", "")
        except (KeyError, ValueError, TypeError, AttributeError):
            pass
        extra = {"port": port} if port != PORT else {}
        found.append(device("wiz", "WiZ", mac, ip, model=model, **extra))
    return found


class WizLight(Light):
    driver = "wiz"
    brand = "WiZ"
    min_interval = 0.1

    def __init__(self, dev: dict):
        super().__init__(dev)
        self.port = int(self.extra.get("port", PORT))
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def _pilot(self, params: dict) -> None:
        msg = json.dumps({"id": 1, "method": "setPilot", "params": params}).encode()
        self.sock.sendto(msg, (self.ip, self.port))

    def prepare(self) -> None:
        self._pilot({"state": True})

    def set_color(self, rgb):
        full, pct = colors.split_brightness(rgb)
        if pct <= 0:
            self.power(False)
            return
        r, g, b = full
        self._pilot({"state": True, "r": r, "g": g, "b": b, "dimming": max(10, min(100, int(round(pct))))})

    def power(self, on: bool) -> None:
        self._pilot({"state": bool(on)})

    def close(self) -> None:
        self.sock.close()
