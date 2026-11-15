"""Common interface for every LED strip brand."""
from __future__ import annotations

import time

from .. import colors


class LightError(Exception):
    pass


class Light:
    driver = "base"
    brand = "?"
    min_interval = 0.1        # minimum seconds between two commands
    keepalive: float | None = None  # resend the last colour this often (seconds), if needed
    supports_gradient = False

    def __init__(self, dev: dict):
        self.dev = dev
        self.id = dev["id"]
        self.ip = dev.get("ip")
        self.extra = dev.get("extra") or {}

    def prepare(self) -> None:
        """Called once before streaming (open sockets, switch on, ...)."""

    def set_color(self, rgb: tuple) -> None:
        """`rgb` is an int triple 0-255 that already includes brightness."""
        raise NotImplementedError

    def set_pixels(self, pixels: list) -> None:
        self.set_color(colors.to_int(colors.average(pixels, vivid=False)))

    def power(self, on: bool) -> None:
        raise NotImplementedError

    def identify(self) -> None:
        """Blink so the user can tell which strip this is."""
        self.prepare()
        for _ in range(3):
            self.set_color((255, 255, 255))
            time.sleep(0.45)
            self.set_color((255, 0, 0))
            time.sleep(0.45)
        self.set_color((255, 255, 255))

    def close(self) -> None:
        pass


def device(driver: str, brand: str, uid: str, ip: str | None, name: str = "", model: str = "",
           **extra) -> dict:
    """Uniform description of a discovered strip."""
    return {
        "id": f"{driver}:{uid}".lower(),
        "driver": driver,
        "brand": brand,
        "name": name or "",
        "ip": ip,
        "model": model or "",
        "extra": extra,
    }
