#!/usr/bin/env python3
"""Make the app icons in ../static/ from logo-source.jpg.

  python3 source/icons/make_icons.py

The original logo had a checkerboard painted where transparency should be, so
logo-source.jpg is cut to the dark rounded square and its corners are made truly transparent
(or filled with the same navy, for icons the platform masks itself).
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'static')
NAVY = (18, 33, 67)
# Corner radius of the rounded square, as a share of its side.
RADIUS = 0.23
# A point inside the pin of the semicolon, in logo-source.jpg.
PIN_SEED = (808, 760)


def rounded_mask(size, inset=0.0):
    big = size * 4
    m = Image.new('L', (big, big), 0)
    i = inset * big
    ImageDraw.Draw(m).rounded_rectangle((i, i, big - 1 - i, big - 1 - i), radius=RADIUS * (big - 2 * i), fill=255)
    return m.resize((size, size), Image.LANCZOS)


def square():
    return Image.open(os.path.join(HERE, 'logo-source.jpg')).convert('RGB')


def rounded(size):
    """The logo as drawn: a rounded square with transparent corners."""
    img = square().resize((size, size), Image.LANCZOS).convert('RGBA')
    img.putalpha(rounded_mask(size, inset=0.006))  # trims the light JPEG fringe at the edge
    return img


def full_bleed(size, scale):
    """Navy all the way to the edges, with the logo scaled down inside it.
    For maskable icons (Android adaptive) and iOS, which cut their own shape."""
    canvas = Image.new('RGBA', (size, size), NAVY + (255,))
    inner = round(size * scale)
    logo = rounded(inner)
    off = (size - inner) // 2
    canvas.alpha_composite(logo, (off, off))
    return canvas


def pin(size):
    """Just the location pin from the semicolon, on a transparent background: the
    browser-tab icon, where the whole logo is too small to read."""
    src = Image.open(os.path.join(HERE, 'logo-source.jpg')).convert('RGB')
    a = np.asarray(src).astype(float).max(axis=2)
    # The pin is the bright shape around this point; the letters beside it are not joined to it.
    solid = Image.fromarray(((a > 170) * 255).astype('uint8')).copy()
    ImageDraw.floodfill(solid, PIN_SEED, 128)
    shape = Image.fromarray(((np.array(solid) == 128) * 255).astype('uint8')).filter(ImageFilter.MaxFilter(5))
    # Soft edge from brightness, so the outline stays smooth against the navy glow.
    soft = np.clip((a - 110) / 90, 0, 1) * (np.array(shape) / 255)
    rgba = src.convert('RGBA')
    rgba.putalpha(Image.fromarray((soft * 255).astype('uint8')))
    x0, y0, x1, y1 = Image.fromarray((soft > 0.5).astype('uint8') * 255).getbbox()
    side = max(x1 - x0, y1 - y0) + 6
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    box = tuple(round(v) for v in (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2))
    return rgba.crop(box).resize((size, size), Image.LANCZOS)


def main():
    for s in (192, 512):
        rounded(s).save(os.path.join(OUT, 'icon-%d.png' % s), optimize=True)
    # Maskable: Android keeps only the centre circle of 80%, so everything
    # that matters (the route ends and the check pin) has to sit inside it.
    full_bleed(512, 0.78).save(os.path.join(OUT, 'icon-maskable-512.png'), optimize=True)
    full_bleed(192, 0.78).save(os.path.join(OUT, 'icon-maskable-192.png'), optimize=True)
    full_bleed(180, 0.94).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)
    # Browser tabs get just the pin.
    pin(32).save(os.path.join(OUT, 'favicon-32.png'), optimize=True)
    pin(96).save(os.path.join(OUT, 'favicon-96.png'), optimize=True)
    pin(48).save(os.path.join(OUT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
    print('Icons written to', os.path.normpath(OUT))


if __name__ == '__main__':
    main()
