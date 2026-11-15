"""Yeelight - LAN protocol on TCP 55443 (enable "LAN Control" in the Yeelight app).

Uses "music mode": the strip connects back to us and accepts unlimited commands
(the normal mode only allows ~60 commands per minute).
"""
from __future__ import annotations

import json
import socket

from .. import colors, netutil
from .base import Light, LightError, device

MULTICAST = ("239.255.255.250", 1982)
PORT = 55443


def _parse_headers(text: str) -> dict:
    headers = {}
    for line in text.split("\r\n")[1:]:
        key, sep, value = line.partition(":")
        if sep:
            headers[key.strip().lower()] = value.strip()
    return headers


def discover(timeout: float = 2.0, ctx: dict | None = None, destinations=None) -> list[dict]:
    msg = ('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1982\r\nMAN: "ssdp:discover"\r\n'
           "ST: wifi_bulb\r\n\r\n").encode()
    replies = netutil.udp_collect(msg, destinations or [MULTICAST], timeout, decode=True)
    found = []
    for ip, text in replies.items():
        h = _parse_headers(text)
        if "yeelight://" not in h.get("location", ""):
            continue
        loc = h["location"].replace("yeelight://", "")
        host, _, port = loc.partition(":")
        uid = h.get("id") or host
        extra = {"port": int(port)} if port and int(port) != PORT else {}
        found.append(device("yeelight", "Yeelight", uid, host or ip, name=h.get("name", ""),
                            model=h.get("model", ""), **extra))
    return found


class YeelightLight(Light):
    driver = "yeelight"
    brand = "Yeelight"
    min_interval = 1.05  # without music mode

    def __init__(self, dev: dict):
        super().__init__(dev)
        self.port = int(self.extra.get("port", PORT))
        self.ctrl: socket.socket | None = None
        self.music: socket.socket | None = None
        self._id = 0

    def _ctrl(self) -> socket.socket:
        if self.ctrl is None:
            self.ctrl = socket.create_connection((self.ip, self.port), timeout=3)
        return self.ctrl

    def _send(self, method: str, params: list, wait: bool = False) -> None:
        self._id += 1
        line = (json.dumps({"id": self._id, "method": method, "params": params}) + "\r\n").encode()
        if self.music is not None:
            self.music.sendall(line)
            return
        sock = self._ctrl()
        sock.sendall(line)
        if wait:
            sock.settimeout(3)
            reply = sock.recv(4096)
            if b'"error"' in reply:
                raise LightError(reply.decode("utf-8", "replace"))
        else:
            sock.setblocking(False)
            try:
                while sock.recv(4096):
                    pass
            except (BlockingIOError, OSError):
                pass
            sock.setblocking(True)
            sock.settimeout(3)

    def prepare(self) -> None:
        if self.music is not None:
            return
        local_ip = netutil.local_ipv4(self.ip) or "0.0.0.0"
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            server.bind((local_ip, 0))
            server.listen(1)
            server.settimeout(4)
            self._send("set_music", [1, local_ip, server.getsockname()[1]], wait=True)
            conn, _ = server.accept()
            conn.settimeout(3)
            self.music = conn
            self.min_interval = 0.05
        except (OSError, LightError):
            self.music = None
            self.min_interval = 1.05
        finally:
            server.close()
        self._send("set_power", ["on", "sudden", 30])

    def set_color(self, rgb):
        full, pct = colors.split_brightness(rgb)
        if pct <= 0:
            self.power(False)
            return
        r, g, b = full
        self._send("set_scene", ["color", (r << 16) | (g << 8) | b, max(1, min(100, int(round(pct))))])

    def power(self, on: bool) -> None:
        self._send("set_power", ["on" if on else "off", "sudden", 30])

    def close(self) -> None:
        for sock in (self.music, self.ctrl):
            if sock is not None:
                try:
                    sock.close()
                except OSError:
                    pass
        self.music = self.ctrl = None
