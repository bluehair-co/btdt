#!/usr/bin/env python3
"""Split the landing picture into two layers for the welcome page, in ../static/.

  pip install numpy scipy opencv-python-headless pillow
  python3 source/landing/make_layers.py

- landing-fg-*.webp: the cliff, the hiker, the bike and the city behind them, on transparency.
- landing-bg-*.webp: everything else (sky, sun, valley), with the area behind the cliff filled in.

On wide screens the two line up exactly as the original picture. On narrower ones the
page slides the background further left than the cliff, so the hiker and the sun both fit.

The cliff top is found as the dark shape inside a hand-drawn zone and the city is
separated from the sky with GrabCut. Below the cliff top, the cut follows EDGE, traced by
hand along the outside of the cliff's light rim and the ridge with the glowing trail. The fill behind the cliff is a plain inpaint: only its edges ever show.
"""
import os
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'static')
SRC = os.path.join(HERE, 'landing-source.webp')  # 2752 x 1536

# Where the cliff can be (it is the dark part of this zone).
ZONE = [(0, 415), (170, 415), (170, 470), (410, 470), (410, 385), (650, 385), (660, 440), (670, 215), (800, 215),
        (800, 440), (870, 455), (870, 520), (812, 600), (732, 690), (714, 800), (710, 1000), (708, 1100),
        (1000, 1170), (1300, 1270), (1560, 1536), (0, 1536)]
# Surely cliff, whatever its brightness (the glowing trail, highlights).
CORE = [(0, 600), (500, 580), (700, 520), (780, 560), (720, 700), (690, 1100), (1000, 1200), (1250, 1300), (1450, 1536), (0, 1536)]
DARK = 72        # luminance below which a pixel in the zone is cliff
CITY = (0, 120, 760, 600)  # box the skyline is in
# The cliff's right edge, traced along the outside of its light rim: down the rock face to its
# foot, then along the top of the dark ridge with the glowing trail to the bottom of the picture.
# Everything left of this line and below the cliff top is in front; the valley right of it stays behind.
EDGE = [(852, 470), (832, 530), (813, 580), (803, 620), (793, 660), (773, 690), (743, 720), (717, 750),
        (707, 800), (714, 830), (714, 890), (692, 940), (672, 975), (682, 1040), (679, 1100), (671, 1180),
        (700, 1185), (800, 1256), (920, 1218), (1100, 1232), (1180, 1250), (1250, 1275), (1290, 1295),
        (1335, 1335), (1400, 1355), (1440, 1380), (1470, 1395), (1600, 1412), (1700, 1439), (1800, 1469),
        (1900, 1504), (1962, 1536)]
TOP = 478  # below this line everything left of EDGE is cliff, bike, trees or city
# Two small towers of the skyline that peek out between the bike and the hiker.
TOWERS = [[(628, 396), (656, 396), (656, 470), (628, 470)], [(661, 434), (686, 434), (686, 470), (661, 470)]]


def poly_mask(size, pts):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return np.array(m) > 0


def cliff_mask(im):
    h, w = im.shape[:2]
    lum = im @ np.array([.2126, .7152, .0722])
    fg = Image.fromarray((((lum < DARK) & poly_mask((w, h), ZONE)) * 255).astype('uint8'))
    fg = np.array(fg.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))) > 0
    fg |= poly_mask((w, h), CORE)
    fg = ndimage.binary_fill_holes(fg)
    lab, _ = ndimage.label(fg)
    return lab == lab[1400, 100]


def add_city(im, cliff):
    x0, y0, x1, y1 = CITY
    h, w = im.shape[:2]
    crop = cv2.cvtColor(np.ascontiguousarray(im[y0:y1, x0:x1]), cv2.COLOR_RGB2BGR)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    c = cliff[y0:y1, x0:x1]
    m = np.full(crop.shape[:2], cv2.GC_PR_BGD, np.uint8)
    m[(xx < 600) & (yy > 200)] = cv2.GC_PR_FGD
    m[yy < 165] = cv2.GC_BGD                      # sky above the tallest spire
    m[(xx > 705) & ~c & (yy < 440)] = cv2.GC_BGD  # sky right of the hiker
    m[(xx < 560) & (yy > 445)] = cv2.GC_FGD       # the city's base
    m[c] = cv2.GC_FGD
    for t in TOWERS:
        m[poly_mask((w, h), t)[y0:y1, x0:x1]] = cv2.GC_FGD
    cv2.grabCut(crop, m, None, np.zeros((1, 65)), np.zeros((1, 65)), 8, cv2.GC_INIT_WITH_MASK)
    out = cliff.copy()
    out[y0:y1, x0:x1] |= np.isin(m, [cv2.GC_FGD, cv2.GC_PR_FGD])
    # Between the bike and the hiker the sunlit cloud is as bright as the towers, so take the towers as drawn.
    gap = np.zeros_like(out); gap[380:470, 600:700] = True
    towers = np.zeros_like(out)
    for t in TOWERS:
        towers |= poly_mask((w, h), t)
    out = np.where(gap, cliff | towers, out)
    out = cv2.morphologyEx(out.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
    lab, n = ndimage.label(out)
    out = lab == 1 + int(np.argmax(ndimage.sum(out, lab, range(1, n + 1))))  # drop stray stars
    return ndimage.binary_fill_holes(out)


def main():
    im = np.array(Image.open(SRC).convert('RGB'))
    h, w = im.shape[:2]
    shape = add_city(im, cliff_mask(im))
    left = poly_mask((w, h), [(0, 0), (870, 0), (870, 440)] + EDGE + [(0, h)])
    yy = np.arange(h)[:, None]
    shape = (shape & left) | (left & (yy >= TOP))
    alpha = cv2.GaussianBlur(shape.astype(np.float32) * 255, (0, 0), 1.0).astype(np.uint8)
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
