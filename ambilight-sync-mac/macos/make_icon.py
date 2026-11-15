"""Draws the app icon (a TV with an Ambilight halo) as a 1024x1024 PNG. Standard library only.

    python3 make_icon.py icon.png
"""
from __future__ import annotations

import colorsys
import math
import struct
import sys
import zlib

SIZE = 1024


def rounded_rect_distance(x, y, cx, cy, hw, hh, r):
    """Signed distance from a rounded rectangle (negative inside)."""
    qx = abs(x - cx) - (hw - r)
    qy = abs(y - cy) - (hh - r)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - r


def pixel(x, y):
    # Icon tile: dark rounded square
    d_tile = rounded_rect_distance(x, y, 512, 512, 412, 412, 185)
    if d_tile > 1:
        return (0, 0, 0, 0)
    alpha = 255 if d_tile <= 0 else int(255 * (1 - d_tile))
    # TV screen
    d_tv = rounded_rect_distance(x, y, 512, 500, 270, 165, 26)
    hue = (math.atan2(y - 500, x - 512) / (2 * math.pi) + 0.62) % 1.0
    r, g, b = colorsys.hsv_to_rgb(hue, 0.85, 1.0)
    if d_tv <= 0:
        # screen: near black with a faint reflection
        shade = 18 + int(10 * max(0.0, 1 - (y - 335) / 330))
        edge = max(0.0, 1 + d_tv / 6)  # thin bezel highlight
        return (int(shade + 60 * edge), int(shade + 60 * edge), int(shade + 66 * edge), alpha)
    # Ambilight halo fading away from the screen
    glow = math.exp(-d_tv / 95.0)
    base = (22, 22, 28)
    col = [int(base[i] + (c * 255 - base[i]) * glow) for i, c in enumerate((r, g, b))]
    # stand
    if 680 < y < 700 and abs(x - 512) < 110:
        col = [70, 70, 78]
    return (col[0], col[1], col[2], alpha)


def write_png(path, size=SIZE):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        sy = y * SIZE / size
        for x in range(size):
            rows.extend(pixel(x * SIZE / size + 0.5, sy + 0.5))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    write_png(sys.argv[1] if len(sys.argv) > 1 else "icon.png")
