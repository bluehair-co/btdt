#!/usr/bin/env python3
"""Write the Phosphor icons BT•DT uses into source/src/core.js (between the PHOSPHOR markers).

  python3 phosphor.py PATH_TO_PHOSPHOR_CORE   (a checkout of github.com/phosphor-icons/core, MIT)

Transport and place icons use the duotone weight (a line drawing plus a soft shape, like two inks);
interface icons use the bold weight, to match the ink edges. Names not listed keep their own icon.
"""
import os, re, sys
DUO = {
    'WALKING': 'person-simple-walk', 'RUNNING': 'person-simple-run', 'CYCLING': 'bicycle', 'CAR': 'car-profile', 'TAXI': 'taxi',
    'MOTORCYCLE': 'motorcycle', 'BUS': 'bus', 'TRAIN': 'train-simple', 'TRAM': 'tram', 'SUBWAY': 'subway', 'CABLE': 'cable-car',
    'FERRY': 'boat', 'BOAT': 'sailboat', 'FLYING': 'airplane-tilt', 'SKIING': 'person-simple-ski', 'UNKNOWN': 'question-mark',
    'home': 'house', 'work': 'briefcase', 'school': 'graduation-cap', 'family': 'users-three', 'friends': 'users',
    'basketball': 'basketball', 'restaurant': 'fork-knife', 'cafe': 'coffee', 'cart': 'shopping-cart', 'store': 'storefront',
    'ticket': 'ticket', 'pin': 'map-pin', 'eyeSlash': 'eye-slash', 'flag': 'flag',
    # landmarks for the loading screen and the Other places badge
    'castle': 'castle-turret', 'church': 'church', 'mosque': 'mosque', 'synagogue': 'synagogue', 'museum': 'bank',
    'lighthouse': 'lighthouse', 'windmill': 'windmill', 'mountains': 'mountains', 'palm': 'tree-palm', 'bridge': 'bridge',
    'tent': 'tent', 'park': 'park', 'city': 'buildings',
}
BOLD = {
    'more': 'dots-three', 'split': 'scissors', 'select': 'lasso', 'undo': 'arrow-counter-clockwise', 'chart': 'chart-bar',
    'history': 'clock-counter-clockwise', 'filter': 'funnel', 'menu': 'list', 'layers': 'stack', 'gear': 'gear',
    'expand': 'corners-out', 'search': 'magnifying-glass', 'close': 'x', 'left': 'caret-left', 'down': 'caret-down',
    'right': 'caret-right', 'file': 'file', 'folder': 'folder', 'play': 'play', 'playCircle': 'play-circle', 'pause': 'pause',
    'calendar': 'calendar-blank', 'fit': 'frame-corners', 'upload': 'upload-simple', 'download': 'download-simple',
    'sync': 'arrows-clockwise', 'bolt': 'lightning', 'ruler': 'ruler', 'edit': 'pencil-simple', 'hide': 'eye-slash',
    'groupWork': 'circles-three', 'info': 'info', 'help': 'question', 'shield': 'shield', 'left2': 'caret-double-left',
    'right2': 'caret-double-right', 'clock': 'clock', 'zoomOut': 'magnifying-glass-minus', 'zoomIn': 'magnifying-glass-plus',
    'sun': 'sun', 'night': 'moon',
}
def inner(path):
    s = open(path).read()
    return s[s.index('>') + 1:s.rindex('</svg>')].strip()
def main():
    root = sys.argv[1]
    out = []
    for k, n in DUO.items():
        body = inner(os.path.join(root, 'assets/duotone', n + '-duotone.svg'))
        body = body.replace(' opacity="0.2"', ' class="ph2"')
        out.append(f"  {k}: '{body}'")
    for k, n in BOLD.items():
        out.append(f"  {k}: '{inner(os.path.join(root, 'assets/bold', n + '-bold.svg'))}'")
    block = ('// PHOSPHOR START (written by source/icons/phosphor.py; Phosphor Icons, MIT)\nvar PH = {\n' + ',\n'.join(out) + '\n};\n// PHOSPHOR END')
    core = os.path.join(os.path.dirname(__file__), '..', 'src', 'core.js')
    s = open(core).read()
    if '// PHOSPHOR START' in s:
        s = re.sub(r'// PHOSPHOR START.*?// PHOSPHOR END', lambda m: block, s, flags=re.S)
    else:
        s = s.replace('function icon(name, cls) {', block + '\nfunction icon(name, cls) {', 1)
    open(core, 'w').write(s)
    print(len(DUO) + len(BOLD), 'icons')
main()
