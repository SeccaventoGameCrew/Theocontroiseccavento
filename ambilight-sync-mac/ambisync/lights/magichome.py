"""Magic Home / LEDnet WF / Zengge controllers - TCP 5577 (8-byte protocol)."""
from __future__ import annotations

import socket

from .. import netutil
from .base import Light, device

DISCOVERY_PORT = 48899
PORT = 5577


def _checksum(data: bytes) -> bytes:
    return bytes(data) + bytes([sum(data) & 0xFF])


def discover(timeout: float = 2.0, ctx: dict | None = None, destinations=None) -> list[dict]:
    replies = netutil.udp_collect(b"HF-A11ASSISTHREAD",
                                  destinations or netutil.broadcast_destinations(DISCOVERY_PORT),
                                  timeout, decode=True)
    found = []
    for ip, text in replies.items():
        parts = text.strip().split(",")
        if len(parts) < 3:
            continue
        found.append(device("magichome", "Magic Home", parts[1], parts[0] or ip, model=parts[2]))
    return found


class MagicHomeLight(Light):
    driver = "magichome"
    brand = "Magic Home"
    min_interval = 0.08

    def __init__(self, dev: dict):
        super().__init__(dev)
        self.port = int(self.extra.get("port", PORT))
        self.nine_byte = bool(self.extra.get("nine_byte", False))
        self.write_mode = int(self.extra.get("write_mode", 0x00))
        self.sock: socket.socket | None = None

    def _send(self, data: bytes) -> None:
        for attempt in range(2):
            try:
                if self.sock is None:
                    self.sock = socket.create_connection((self.ip, self.port), timeout=3)
                self.sock.sendall(_checksum(data))
                self._drain()
                return
            except OSError:
                self.close()
                if attempt:
                    raise

    def _drain(self) -> None:
        self.sock.setblocking(False)
        try:
            while self.sock.recv(1024):
                pass
        except (BlockingIOError, OSError):
            pass
        self.sock.setblocking(True)
        self.sock.settimeout(3)

    def prepare(self) -> None:
        self.power(True)

    def set_color(self, rgb):
        r, g, b = rgb
        if self.nine_byte:
            msg = bytes([0x41, r, g, b, 0, 0, self.write_mode, 0x0F])
        else:
            msg = bytes([0x41, r, g, b, 0, self.write_mode, 0x0F])  # 0x41 = do not save to flash
        self._send(msg)

    def power(self, on: bool) -> None:
        self._send(bytes([0x71, 0x23 if on else 0x24, 0x0F]))

    def close(self) -> None:
        if self.sock is not None:
            try:
                self.sock.close()
            except OSError:
                pass
        self.sock = None
