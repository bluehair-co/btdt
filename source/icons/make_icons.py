#!/usr/bin/env python3
"""Make the app icons in ../static/ from the BT•DT icons in Figma ("BTDT Icons").

  python3 source/icons/make_icons.py

icon-source.png (1024 x 1024) is the "BTDT Mobile Icon" frame exported at 4x: the pin on
the contour-line background, full bleed, so the platforms round its corners themselves.
The pin and its glow sit inside the centre circle of 80% that Android keeps for maskable
icons, so one picture serves every size.

favicon.svg is the "BTDT Browser Icon" frame (just the pin, with a thin dark outline that
keeps it visible on light and dark browser tabs) on a transparent background, and
favicon-source.png is that SVG drawn at 512 x 512, for the PNG and ICO tab icons.
"""
import os
import shutil
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'static')


def square(size):
    return Image.open(os.path.join(HERE, 'icon-source.png')).convert('RGB').resize((size, size), Image.LANCZOS)


def tab_pin(size):
    return Image.open(os.path.join(HERE, 'favicon-source.png')).convert('RGBA').resize((size, size), Image.LANCZOS)


def main():
    for s in (192, 512):
        square(s).save(os.path.join(OUT, 'icon-%d.png' % s), optimize=True)
        square(s).save(os.path.join(OUT, 'icon-maskable-%d.png' % s), optimize=True)
    square(180).save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)
    # Browser tabs get just the pin.
    shutil.copy(os.path.join(HERE, 'favicon.svg'), os.path.join(OUT, 'favicon.svg'))
    tab_pin(32).save(os.path.join(OUT, 'favicon-32.png'), optimize=True)
    tab_pin(96).save(os.path.join(OUT, 'favicon-96.png'), optimize=True)
    tab_pin(48).save(os.path.join(OUT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)], append_images=[tab_pin(16), tab_pin(32)])
    print('Icons written to', os.path.normpath(OUT))


if __name__ == '__main__':
    main()
