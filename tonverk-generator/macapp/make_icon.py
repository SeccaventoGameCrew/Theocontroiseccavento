"""Draws the app icon (1024x1024 PNG): a step-sequencer grid on a dark squircle."""
import sys
from PIL import Image, ImageDraw, ImageFilter

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
# shadow
sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(sh).rounded_rectangle((100, 112, 924, 936), radius=186, fill=(0, 0, 0, 110))
img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
# body with vertical gradient
body = Image.new("RGBA", (S, S))
d = ImageDraw.Draw(body)
for y in range(S):
    t = y / S
    c = (int(38 - 16 * t), int(38 - 16 * t), int(42 - 16 * t), 255)
    d.line([(0, y), (S, y)], fill=c)
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((100, 100, 924, 924), radius=186, fill=255)
img.paste(body, (0, 0), mask)
d = ImageDraw.Draw(img)
d.rounded_rectangle((100, 100, 924, 924), radius=186, outline=(70, 70, 76, 255), width=4)
# 4x4 trig keys, lit like a pattern
on = {0, 3, 6, 8, 10, 12, 14, 15}
accent = {0, 8}
cell, gap = 128, 34
x0 = y0 = 512 - 2 * cell - 1.5 * gap
for i in range(16):
    r, c = divmod(i, 4)
    x, y = x0 + c * (cell + gap), y0 + r * (cell + gap)
    if i in accent:
        fill = (255, 138, 76, 255)
    elif i in on:
        fill = (217, 72, 15, 255)
    else:
        fill = (58, 58, 64, 255)
    if i in on:
        glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(glow).rounded_rectangle((x - 8, y - 8, x + cell + 8, y + cell + 8), radius=34,
                                               fill=(255, 110, 40, 90))
        img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(16)))
        d = ImageDraw.Draw(img)
    d.rounded_rectangle((x, y, x + cell, y + cell), radius=28, fill=fill)
    hi = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hi).rounded_rectangle((x + 10, y + 9, x + cell - 10, y + 34), radius=12,
                                         fill=(255, 255, 255, 46 if i in on else 14))
    img.alpha_composite(hi)
    d = ImageDraw.Draw(img)
img.save(sys.argv[1] if len(sys.argv) > 1 else "icon.png")
