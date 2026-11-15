"""Govee - official LAN API (enable "LAN Control" for each device in the Govee Home app)."""
from __future__ import annotations

import json
import socket
import time

from .base import Light, device

MULTICAST = "239.255.255.250"
SCAN_PORT = 4001
LISTEN_PORT = 4002
CONTROL_PORT = 4003


def discover(timeout: float = 3.0, ctx: dict | None = None, target: str = MULTICAST,
             scan_port: int = SCAN_PORT, listen_port: int = LISTEN_PORT) -> list[dict]:
    msg = json.dumps({"msg": {"cmd": "scan", "data": {"account_topic": "reserve"}}}).encode()
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    found = {}
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if hasattr(socket, "SO_REUSEPORT"):
            try:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
            except OSError:
                pass
        s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        s.bind(("", listen_port))
        for _ in range(2):
            s.sendto(msg, (target, scan_port))
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            s.settimeout(max(0.05, end - time.monotonic()))
            try:
                data, (ip, _) = s.recvfrom(4096)
            except (socket.timeout, OSError):
                break
            try:
                info = json.loads(data.decode())["msg"]
            except (ValueError, KeyError, TypeError):
                continue
            if info.get("cmd") != "scan":
                continue
            d = info.get("data") or {}
            mac = d.get("device") or ip
            found[mac] = device("govee", "Govee", mac, d.get("ip") or ip, model=d.get("sku", ""))
    except OSError:
        pass
    finally:
        s.close()
    return list(found.values())


class GoveeLight(Light):
    driver = "govee"
    brand = "Govee"
    min_interval = 0.1

    def __init__(self, dev: dict):
        super().__init__(dev)
        self.port = int(self.extra.get("port", CONTROL_PORT))
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def _send(self, cmd: str, data: dict) -> None:
        payload = json.dumps({"msg": {"cmd": cmd, "data": data}}).encode()
        self.sock.sendto(payload, (self.ip, self.port))

    def prepare(self) -> None:
        self._send("turn", {"value": 1})
        self._send("brightness", {"value": 100})

    def set_color(self, rgb):
        r, g, b = rgb
        self._send("colorwc", {"color": {"r": r, "g": g, "b": b}, "colorTemInKelvin": 0})

    def power(self, on: bool) -> None:
        self._send("turn", {"value": 1 if on else 0})

    def close(self) -> None:
        self.sock.close()
