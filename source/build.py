#!/usr/bin/env python3
"""Build BT;DT (Been There · Done That) into dist/: one self-contained index.html plus the PWA files.

  python3 build.py

The page is assembled from src/ (styles, markup, parser and app scripts) and the
place data (airports, time zones, country borders, towns) kept from v1.0.
"""
import os
import re
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
DIST = os.path.join(HERE, 'dist')
V1 = os.path.join(HERE, 'place-data.html')
JS = ['core.js', 'data.js', 'map.js', 'insights.js', 'timeline.js', 'settings.js']
LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/'


def read(name):
    with open(os.path.join(SRC, name), encoding='utf-8') as f:
        return f.read()


def place_data():
    with open(V1, encoding='utf-8') as f:
        html = f.read()
    m = re.search(r'<script>\n// Airports with scheduled flights.*?</script>', html, re.S)
    if not m:
        raise SystemExit('Place data not found in ' + V1)
    return m.group(0)


HEAD = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="See where you've been and how you get around, from your Google Timeline. Everything stays on your device.">
<meta name="theme-color" content="#f3f5f2">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="BT;DT">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" href="favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<title>BT;DT (Been There · Done That)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="''' + LEAFLET + '''leaflet.min.css">
'''


def main():
    js = '\n'.join(read(n) for n in JS)
    html = (HEAD + '<style>\n' + read('app.css') + '</style>\n</head>\n<body>\n' + read('app.html') +
            place_data() + '\n<script id="parser">\n' + read('parser.js') + '</script>\n' +
            '<script src="' + LEAFLET + 'leaflet.min.js"></script>\n' +
            '<script>\n(function () {\n' + js + '\n})();\n</script>\n</body>\n</html>\n')
    os.makedirs(DIST, exist_ok=True)
    with open(os.path.join(DIST, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(html)
    for name in os.listdir(os.path.join(HERE, 'static')):
        shutil.copy(os.path.join(HERE, 'static', name), os.path.join(DIST, name))
    print('Wrote dist/index.html (%d KB)' % (len(html.encode('utf-8')) // 1024))


if __name__ == '__main__':
    main()
