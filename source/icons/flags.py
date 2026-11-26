#!/usr/bin/env python3
"""Make static/flags.png: every country flag printed in the three inks (plus paper and the transit
green), as one sprite, and the list of countries in it, written into core.js (FLAGS_AT).

  python3 flags.py PATH_TO_FLAG_ICONS   (a checkout of github.com/lipis/flag-icons, MIT)

Each colour of a flag becomes the nearest ink, so flags look printed rather than glossy, the same on
every device (Windows shows no flag emoji), and nothing is fetched per country.
Needs Playwright with Chrome to draw the flags (only when the sprite is made, not in the app).
"""
import base64, io, os, re, sys
from playwright.sync_api import sync_playwright
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
INKS = [('#1E3A9E', '#20264a'), ('#FF4FA0', '#d0233a'), ('#FEDF02', '#f4c400'), ('#FBF6EC', '#ffffff'), ('#1F9466', '#0a8f3c')]
NAMED = {'red': '#ff0000', 'white': '#ffffff', 'blue': '#0000ff', 'black': '#000000', 'yellow': '#ffff00', 'green': '#008000', 'navy': '#000080', 'gold': '#ffd700', 'orange': '#ffa500', 'maroon': '#800000', 'silver': '#c0c0c0', 'gray': '#808080', 'grey': '#808080'}
W, H, COLS = 48, 36, 16
def rgb(h):
    h = h.lstrip('#'); h = ''.join(c * 2 for c in h) if len(h) == 3 else h[:6]
    return tuple(int(h[k:k + 2], 16) for k in (0, 2, 4))
def near(h):
    r = rgb(NAMED.get(h.lower(), h))
    return min(INKS, key=lambda k: sum((a - b) ** 2 for a, b in zip(r, rgb(k[1]))))[0]
def inkify(s):
    sub = lambda m: m.group(1) + near(m.group(2)) + m.group(3)
    col = r'(#[0-9a-fA-F]{3,6}|' + '|'.join(NAMED) + r')'
    s = re.sub(r'((?:fill|stroke|stop-color)=")' + col + r'(")', sub, s)
    s = re.sub(r'((?:fill|stroke|stop-color):\s*)' + col + r'(\b)', sub, s)
    # shapes with no fill of their own are black: the blue ink
    return s.replace('<svg', '<svg fill="#1E3A9E"', 1)
def main():
    root = os.path.join(sys.argv[1], 'flags', '4x3')
    codes = sorted(f[:-4] for f in os.listdir(root) if re.fullmatch(r'[a-z]{2}\.svg', f))
    rows = (len(codes) + COLS - 1) // COLS
    cells = ''.join(f'<img src="data:image/svg+xml;base64,{base64.b64encode(inkify(open(os.path.join(root, c + ".svg")).read()).encode()).decode()}" style="position:absolute;left:{(i % COLS) * W}px;top:{(i // COLS) * H}px;width:{W}px;height:{H}px">' for i, c in enumerate(codes))
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'))
        pg = b.new_page(viewport={'width': COLS * W, 'height': rows * H})
        pg.set_content(f'<body style="margin:0;background:transparent">{cells}</body>'); pg.wait_for_timeout(800)
        png = pg.screenshot(omit_background=True); b.close()
    im = Image.open(io.BytesIO(png)).convert('RGBA')
    # Keep only the inks: a small palette image
    im = im.quantize(colors=16, method=Image.Quantize.FASTOCTREE)
    out = os.path.join(HERE, '..', 'static', 'flags.png')
    im.save(out, optimize=True)
    core = os.path.join(HERE, '..', 'src', 'core.js')
    s = open(core).read()
    line = "var FLAGS_AT = '" + ''.join(c.upper() for c in codes) + "', FLAGS_COLS = " + str(COLS) + ', FLAGS_ROWS = ' + str(rows) + ';'
    s = re.sub(r"var FLAGS_AT = '[A-Z]*', FLAGS_COLS = \d+, FLAGS_ROWS = \d+;", line, s) if 'var FLAGS_AT' in s else s.replace('function flag(cc)', line + '\nfunction flag(cc)', 1)
    open(core, 'w').write(s)
    print(len(codes), 'flags,', os.path.getsize(out) // 1024, 'KB')
main()
