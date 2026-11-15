#!/usr/bin/env python3
"""Fetch the street routes for the demo's Halfbike rides (and the Sofia airport taxi) from BRouter
(brouter.de, OpenStreetMap data) and save them to halfbike_routes.json next to this file, so
make_demo.py stays offline and gives the same output every run.

  python3 source/demo/fetch_halfbike_routes.py      (only when the loops below change)

Each ride is a loop: waypoints in order, from home back to home, routed with BRouter's trekking
(bike) profile so it follows cycle paths and streets.
"""
import json
import os
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'halfbike_routes.json')
AMS_HOME = (52.36395, 4.86560)
# ul. "Borova Gora" 32, Lozenets (by Journalist Square).
SOF_HOME = (42.68225, 23.33380)
SOF_AIRPORT = (42.69300, 23.40820)

LOOPS = {
    # Amsterdam, from Oud-West.
    'ams-amstel': [AMS_HOME, (52.3577, 4.8690), (52.3530, 4.8950), (52.3450, 4.9045), (52.3290, 4.9130), (52.3240, 4.9190),
                   (52.3400, 4.9110), (52.3590, 4.9035), (52.3640, 4.8830), AMS_HOME],
    'ams-westerpark': [AMS_HOME, (52.3725, 4.8700), (52.3863, 4.8780), (52.3925, 4.8700), (52.3870, 4.8560), (52.3770, 4.8530), AMS_HOME],
    'ams-oost': [AMS_HOME, (52.3600, 4.8850), (52.3600, 4.9205), (52.3630, 4.9470), (52.3700, 4.9300), (52.3670, 4.9080), (52.3660, 4.8900), AMS_HOME],
    'ams-bos': [AMS_HOME, (52.3480, 4.8560), (52.3310, 4.8520), (52.3180, 4.8390), (52.3270, 4.8220), (52.3400, 4.8420), AMS_HOME],
    'ams-ij': [AMS_HOME, (52.3760, 4.8820), (52.3860, 4.8920), (52.3790, 4.9120), (52.3770, 4.9320), (52.3720, 4.9180), (52.3700, 4.8950), AMS_HOME],
    'ams-sloterplas': [AMS_HOME, (52.3640, 4.8380), (52.3700, 4.8150), (52.3620, 4.8050), (52.3580, 4.8250), (52.3600, 4.8450), AMS_HOME],
    # Sofia, from Lozenets.
    'sof-borisova': [SOF_HOME, (42.6830, 23.3440), (42.6870, 23.3420), (42.6900, 23.3360), (42.6860, 23.3330), SOF_HOME],
    'sof-south-park': [SOF_HOME, (42.6780, 23.3200), (42.6740, 23.3080), (42.6680, 23.3050), (42.6720, 23.3160), SOF_HOME],
    'sof-centre': [SOF_HOME, (42.6850, 23.3190), (42.6930, 23.3220), (42.6960, 23.3300), (42.6920, 23.3360), SOF_HOME],
    'sof-dragalevtsi': [SOF_HOME, (42.6640, 23.3230), (42.6470, 23.3120), (42.6380, 23.3110), (42.6450, 23.3290), (42.6640, 23.3330), SOF_HOME],
}
CAR = {
    'sof-airport-home': [SOF_AIRPORT, SOF_HOME],
    'sof-home-airport': [SOF_HOME, SOF_AIRPORT],
}


def route(pts, profile):
    lonlats = '|'.join('%.5f,%.5f' % (p[1], p[0]) for p in pts)
    url = 'https://brouter.de/brouter?lonlats=%s&profile=%s&alternativeidx=0&format=geojson' % (lonlats, profile)
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'btdt-demo-build'}), timeout=60) as r:
        g = json.load(r)
    coords = g['features'][0]['geometry']['coordinates']
    return [[round(c[1], 6), round(c[0], 6)] for c in coords]


def trim_spurs(pts, window=80):
    """Cuts the out-and-back stubs a route makes where a waypoint sits off the road: when the route
    comes back to a point it passed a little earlier, the detour in between is dropped."""
    out, where = [], {}
    for p in pts:
        k = (round(p[0], 5), round(p[1], 5))
        j = where.get(k)
        if j is not None and len(out) - j <= window:
            for q in out[j + 1:]:
                where.pop((round(q[0], 5), round(q[1], 5)), None)
            del out[j + 1:]
            continue
        where[k] = len(out)
        out.append(p)
    return out


def main():
    out = {}
    for name, pts in LOOPS.items():
        out[name] = trim_spurs(route(pts, 'trekking'))
        time.sleep(1)
    for name, pts in CAR.items():
        out[name] = route(pts, 'car-fast')
        time.sleep(1)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
        f.write('\n')
    print('Wrote %s: %s' % (os.path.relpath(OUT), ', '.join('%s %d pts' % (k, len(v)) for k, v in out.items())))


if __name__ == '__main__':
    main()
