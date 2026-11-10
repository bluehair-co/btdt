#!/usr/bin/env python3
"""Make the app icons in ../static/ from icon-source.jpg (2048 x 2048).

  python3 source/icons/make_icons.py

icon-source.jpg is a full-bleed square: the platforms round its corners themselves.
Everything that matters (the location pin) sits well inside the centre circle of 80%
that Android keeps for maskable icons, so one picture serves every size.
The browser-tab icon is the location pin on its own, cut out on a transparent background.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'static')
SRC = os.path.join(HERE, 'icon-source.jpg')
# The pin in icon-source.jpg: its round head (centre and radius) and the tip it narrows to.
# Kept a few pixels inside the drawn edge so no background shows along the outline.
PIN_HEAD = (1023, 784, 466)
PIN_TIP = (1023, 1640)


def square(size):
    return Image.open(SRC).convert('RGB').resize((size, size), Image.LANCZOS)


def pin_outline(n=720):
    """The pin's outline: the head's arc between the two tangents that run to the tip."""
    cx, cy, r = PIN_HEAD
    tx, ty = PIN_TIP
    d = math.hypot(tx - cx, ty - cy)
    spread = math.acos(r / d)
    towards = math.atan2(ty - cy, tx - cx)
    a0, a1 = towards + spread, towards - spread + 2 * math.pi
    arc = [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
    return arc + [PIN_TIP]


def pin(size):
    """Just the location pin, on a transparent background: the browser-tab icon."""
    src = Image.open(SRC).convert('RGBA')
    k = 4  # drawn at 4x and scaled down, for a smooth edge
    mask = Image.new('L', (src.width * k, src.height * k), 0)
    ImageDraw.Draw(mask).polygon([(x * k, y * k) for x, y in pin_outline()], fill=255)
    src.putalpha(mask.resize(src.size, Image.LANCZOS))
    x0, y0, x1, y1 = src.getchannel('A').getbbox()
    side = max(x1 - x0, y1 - y0) + 8
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    box = tuple(round(v) for v in (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2))
    return src.crop(box).resize((size, size), Image.LANCZOS)


# A thin light outline keeps the pin's dark lower half visible on dark browser tabs.
OUTLINE = (255, 243, 228)


def tab_pin(size):
    """The pin with a light outline about 1/16 of its size (at least 1 px), drawn at this size."""
    w = max(1, round(size / 16))
    inner = pin(size - 2 * w)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.alpha_composite(inner, (w, w))
    ring = out.getchannel('A').point(lambda v: 255 if v > 40 else 0).filter(ImageFilter.MaxFilter(2 * w + 1))
    edge = Image.new('RGBA', (size, size), OUTLINE + (0,))
    edge.putalpha(ring)
    edge.alpha_composite(out)
    return edge


def main():
    for s in (192, 512):
        square(s).save(os.path.join(OUT, 'icon-%d.png' % s), optimize=True)
        square(s).save(os.path.join(OUT, 'icon-maskable-%d.png' % s), optimize=True)
    square(180).save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)
    # Browser tabs get just the pin.
    tab_pin(32).save(os.path.join(OUT, 'favicon-32.png'), optimize=True)
    tab_pin(96).save(os.path.join(OUT, 'favicon-96.png'), optimize=True)
    tab_pin(48).save(os.path.join(OUT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)], append_images=[tab_pin(16), tab_pin(32)])
    print('Icons written to', os.path.normpath(OUT))


if __name__ == '__main__':
    main()
