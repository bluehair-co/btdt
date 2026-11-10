#!/usr/bin/env python3
"""Split the landing picture into two layers for the welcome page, in ../static/.

  pip install numpy opencv-python-headless pillow
  python3 source/landing/make_layers.py

- landing-fg-*.webp: the cliff, the hiker, the bike and the city behind them, on transparency.
- landing-bg-*.webp: everything else (sky, sun, valley), with the area behind the cliff filled in.

The cut is the shape in cut.svg, drawn by hand in Figma over landing-source.webp. On wide
screens the two layers line up exactly as the original picture. On narrower ones the page
slides the background further left than the cliff, so the hiker and the sun both fit.
The fill behind the cliff is a plain inpaint: only its edges ever show.
"""
import os
import re
import numpy as np
import cv2
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'static')
SRC = os.path.join(HERE, 'landing-source.webp')  # 2752 x 1536
CUT = os.path.join(HERE, 'cut.svg')
SS = 4  # supersampling for a smooth edge


def cut_mask(size):
    """Renders cut.svg's path (straight lines only, even-odd) to a 0-255 mask."""
    svg = open(CUT).read()
    tx, ty = map(float, re.search(r'translate\(([-\d.]+)[ ,]+([-\d.]+)\)', svg).groups())
    d = re.search(r'\sd="([^"]+)"', svg).group(1)
    w, h = size
    big = Image.new('1', (w * SS, h * SS), 0)
    draw = ImageDraw.Draw(big)
    for sub in re.split(r'(?=M)', d):
        nums = list(map(float, re.findall(r'-?\d+(?:\.\d+)?', sub)))
        if len(nums) < 6:
            continue
        pts = [((x + tx) * SS, (y + ty) * SS) for x, y in zip(nums[0::2], nums[1::2])]
        mask = Image.new('1', big.size, 0)
        ImageDraw.Draw(mask).polygon(pts, fill=1)
        big = Image.fromarray(np.logical_xor(np.array(big), np.array(mask)))  # even-odd
    return np.array(big.convert('L').resize(size, Image.BOX))


def main():
    im = np.array(Image.open(SRC).convert('RGB'))
    h, w = im.shape[:2]
    alpha = cut_mask((w, h))
    # Background: fill the cliff's area (grown a little, so no rim is left) from its surroundings.
    grow = cv2.dilate((alpha > 8).astype(np.uint8) * 255, np.ones((15, 15), np.uint8))
    small = cv2.resize(im, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
    hole = cv2.resize(grow, (w // 2, h // 2), interpolation=cv2.INTER_NEAREST)
    fill = cv2.inpaint(cv2.cvtColor(small, cv2.COLOR_RGB2BGR), hole, 12, cv2.INPAINT_TELEA)
    fill = cv2.cvtColor(cv2.resize(fill, (w, h), interpolation=cv2.INTER_CUBIC), cv2.COLOR_BGR2RGB)
    k = cv2.GaussianBlur(grow, (0, 0), 3).astype(float)[..., None] / 255
    bg = Image.fromarray((im * (1 - k) + fill * k).astype(np.uint8))
    fg = Image.fromarray(np.dstack([im, alpha]), 'RGBA')
    for width in (2752, 1600):
        size = (width, round(h * width / w))
        bg.resize(size, Image.LANCZOS).save(os.path.join(OUT, 'landing-bg-%d.webp' % width), quality=80, method=6)
        fg.resize(size, Image.LANCZOS).save(os.path.join(OUT, 'landing-fg-%d.webp' % width), quality=86, method=6)
    print('Layers written to', os.path.normpath(OUT))


if __name__ == '__main__':
    main()
