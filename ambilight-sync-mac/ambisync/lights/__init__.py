"""LED strip drivers. Each module offers `discover()` and a `Light` subclass."""
from __future__ import annotations

from . import govee, hue, magichome, tuya, wiz, wled, yeelight
from .base import Light, LightError

DRIVERS = {
    "govee": (govee, govee.GoveeLight),
    "wiz": (wiz, wiz.WizLight),
    "yeelight": (yeelight, yeelight.YeelightLight),
    "wled": (wled, wled.WLEDLight),
    "magichome": (magichome, magichome.MagicHomeLight),
    "hue": (hue, hue.HueLight),
    "tuya": (tuya, tuya.TuyaLight),
}

BRANDS = {name: cls.brand for name, (_, cls) in DRIVERS.items()}


def make_light(dev: dict) -> Light:
    try:
        _, cls = DRIVERS[dev["driver"]]
    except KeyError as e:
        raise LightError(f"marca non supportata: {dev.get('driver')}") from e
    return cls(dev)


__all__ = ["DRIVERS", "BRANDS", "Light", "LightError", "make_light"]
