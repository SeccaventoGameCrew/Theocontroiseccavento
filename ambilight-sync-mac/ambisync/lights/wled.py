"""WLED (ESP8266/ESP32 controllers) - JSON API + realtime UDP on port 21324.

Supports gradients: each LED of the strip can follow a different part of the TV.
"""
from __future__ import annotations

import http.client
import socket

from .. import colors, netutil
from .base import Light, device

UDP_PORT = 21324
REALTIME_TIMEOUT = 2  # seconds after the last packet before WLED goes back to normal


def probe(host: str, port: int = 80) -> dict | None:
    info = netutil.http_get_json(host, "/json/info", port=port, timeout=1.5)
    if not isinstance(info, dict) or "leds" not in info or "ver" not in info:
        return None
    if info.get("brand", "WLED") != "WLED" and "wifi" not in info:
        return None
    leds = info.get("leds") or {}
    extra = {"count": int(leds.get("count") or 30), "udp_port": int(info.get("udpport") or UDP_PORT)}
    if port != 80:
        extra["http_port"] = port
    return device("wled", "WLED", info.get("mac") or host, host, name=info.get("name", ""),
                  model=f"WLED {info.get('ver', '')}".strip(), **extra)


def discover(timeout: float = 2.0, ctx: dict | None = None) -> list[dict]:
    sweep = (ctx or {}).get("sweep") or {}
    hosts = [h for h, ports in sweep.items() if 80 in ports]
    found = []
    for host in hosts:
        d = probe(host)
        if d:
            found.append(d)
    return found


class WLEDLight(Light):
    driver = "wled"
    brand = "WLED"
    min_interval = 0.03
    keepalive = 1.0
    supports_gradient = True

    def __init__(self, dev: dict):
        super().__init__(dev)
        self.count = int(self.extra.get("count", 30))
        self.udp_port = int(self.extra.get("udp_port", UDP_PORT))
        self.http_port = int(self.extra.get("http_port", 80))
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def _state(self, body: dict) -> None:
        client = netutil.HttpClient(self.ip, self.http_port, timeout=2)
        try:
            client.post_json("/json/state", body)
        except (OSError, http.client.HTTPException):
            pass
        finally:
            client.close()

    def prepare(self) -> None:
        d = probe(self.ip, self.http_port)
        if d:
            self.count = d["extra"]["count"]
        self._state({"on": True})

    def set_pixels(self, pixels: list) -> None:
        leds = colors.resample(pixels, self.count)
        if self.count <= 490:
            payload = bytearray([2, REALTIME_TIMEOUT])  # DRGB
            for r, g, b in leds:
                payload += bytes((r, g, b))
            self.sock.sendto(bytes(payload), (self.ip, self.udp_port))
            return
        for start in range(0, self.count, 489):  # DNRGB, chunks of 489 LEDs
            chunk = leds[start:start + 489]
            payload = bytearray([4, REALTIME_TIMEOUT, start >> 8, start & 0xFF])
            for r, g, b in chunk:
                payload += bytes((r, g, b))
            self.sock.sendto(bytes(payload), (self.ip, self.udp_port))

    def set_color(self, rgb):
        self.set_pixels([tuple(rgb)])

    def power(self, on: bool) -> None:
        if not on:
            self.set_pixels([(0, 0, 0)])
        self._state({"on": bool(on)})

    def close(self) -> None:
        self.sock.close()
