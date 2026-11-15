"""Colour maths: screen zones, averages, saturation/brightness, smoothing, CIE xy."""
from __future__ import annotations

import colorsys

ZONES = {
    "tutto": "Tutto lo schermo",
    "sinistra": "Lato sinistro",
    "destra": "Lato destro",
    "alto": "Lato superiore",
    "basso": "Lato inferiore",
    "alto_sx": "In alto a sinistra",
    "alto_centro": "In alto al centro",
    "alto_dx": "In alto a destra",
}


def zone_pixels(frame: dict, zone: str) -> list:
    """LED colours of the TV that belong to `zone`.

    Ambilight LEDs are numbered clockwise: the top side goes from left to right.
    TVs without a top or bottom side fall back to the closest available LEDs.
    """
    left, top = frame.get("left") or [], frame.get("top") or []
    right, bottom = frame.get("right") or [], frame.get("bottom") or []
    everything = left + top + right + bottom
    if zone == "sinistra":
        return left or everything
    if zone == "destra":
        return right or everything
    if zone == "alto":
        return top or everything
    if zone == "basso":
        return bottom or everything
    if zone in ("alto_sx", "alto_centro", "alto_dx"):
        if not top:
            fallback = {"alto_sx": left, "alto_dx": right, "alto_centro": left + right}[zone]
            return fallback or everything
        n = len(top)
        third = max(1, n // 3)
        if zone == "alto_sx":
            return top[:third]
        if zone == "alto_dx":
            return top[n - third:]
        middle = top[third:n - third]
        return middle or top
    return everything


def average(pixels, vivid: bool = True) -> tuple:
    """Average colour; with `vivid` saturated pixels weigh more (avoids muddy greys)."""
    if not pixels:
        return (0.0, 0.0, 0.0)
    tw = r = g = b = 0.0
    for pr, pg, pb in pixels:
        w = 0.2 + (max(pr, pg, pb) - min(pr, pg, pb)) / 255.0 if vivid else 1.0
        r += pr * w
        g += pg * w
        b += pb * w
        tw += w
    return (r / tw, g / tw, b / tw)


def adjust(rgb, saturation: float = 1.0, brightness: float = 1.0) -> tuple:
    h, s, v = colorsys.rgb_to_hsv(*(max(0.0, min(255.0, c)) / 255.0 for c in rgb))
    s = min(1.0, s * saturation)
    v = min(1.0, v * brightness)
    return tuple(c * 255.0 for c in colorsys.hsv_to_rgb(h, s, v))


def smooth(previous, target, smoothing: float) -> tuple:
    if previous is None or len(previous) != len(target):
        return tuple(target)
    a = 1.0 - max(0.0, min(0.95, smoothing))
    return tuple(p + (t - p) * a for p, t in zip(previous, target))


def to_int(rgb) -> tuple:
    return tuple(int(round(max(0.0, min(255.0, c)))) for c in rgb)


def to_hex(rgb) -> str:
    r, g, b = to_int(rgb)
    return f"#{r:02x}{g:02x}{b:02x}"


def split_brightness(rgb) -> tuple:
    """(full-brightness colour, brightness %) for devices with a separate dimmer."""
    r, g, b = (max(0.0, min(255.0, c)) for c in rgb)
    m = max(r, g, b)
    if m <= 0:
        return (0, 0, 0), 0.0
    return to_int((r * 255 / m, g * 255 / m, b * 255 / m)), m / 255.0 * 100.0


def rgb_to_xy(rgb) -> tuple:
    """sRGB -> CIE 1931 xy (Philips Hue wide gamut conversion)."""
    def lin(c):
        c = max(0.0, min(255.0, c)) / 255.0
        return ((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92

    r, g, b = (lin(c) for c in rgb)
    x = r * 0.664511 + g * 0.154324 + b * 0.162028
    y = r * 0.283881 + g * 0.668433 + b * 0.047685
    z = r * 0.000088 + g * 0.072310 + b * 0.986039
    total = x + y + z
    if total <= 0:
        return (0.3227, 0.3290)
    return (round(x / total, 4), round(y / total, 4))


def resample(pixels, count: int) -> list:
    """Stretch/shrink a list of colours to `count` LEDs with linear interpolation."""
    if count <= 0:
        return []
    if not pixels:
        return [(0, 0, 0)] * count
    if len(pixels) == 1:
        return [to_int(pixels[0])] * count
    out = []
    n = len(pixels)
    for i in range(count):
        pos = i * (n - 1) / max(1, count - 1)
        lo = int(pos)
        hi = min(n - 1, lo + 1)
        f = pos - lo
        a, b = pixels[lo], pixels[hi]
        out.append(to_int(tuple(a[k] + (b[k] - a[k]) * f for k in range(3))))
    return out
