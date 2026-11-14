#!/usr/bin/env python3
"""Make the demo's Strava activities: the made-up person also records their sport on Strava, so the
demo shows what loading activity files adds (sports, a full GPS track, speed and heart rate).

  python3 source/demo/make_activities.py      (after make_demo.py)

Reads static/demo.json and writes static/demo-activities.gpx.gz: one GPX file as Strava writes it,
with a track for every run, every weekend road ride, and the longer walks on holidays (as hikes),
taken from the Timeline trips at the same times so each activity replaces its Timeline trip. The
points are a dense recording along the Timeline trail (a point every few seconds), with the pace
changing as it would and a heart rate that follows the effort. Fitness improves slowly over the
three years, so the Heart rate card's trend goes down at the same speed. Fixed seed, same output
every run.
"""
import datetime as dt
import gzip
import json
import math
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'static', 'demo.json')
OUT = os.path.join(HERE, '..', 'static', 'demo-activities.gpx.gz')
R = random.Random(42)
START = dt.datetime(2023, 11, 13, tzinfo=dt.timezone.utc)
HOME = (52.36395, 4.86560)


def km(a, b):
    r = math.pi / 180
    dlat, dlng = (b[0] - a[0]) * r, (b[1] - a[1]) * r
    h = math.sin(dlat / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin(dlng / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def latlng(s):
    a, b = s.replace('°', '').split(',')
    return float(a), float(b)


def parse(s):
    return dt.datetime.fromisoformat(s)


# Strava's GPX type numbers: 1 ride, 4 hike, 9 run.
KINDS = {
    'run': dict(type=9, every=4, hr=(118, 6.2), wobble=0.08, zone=(16, 0.9)),
    'ride': dict(type=1, every=6, hr=(92, 2.5), wobble=0.12, zone=(0, 0)),
    'hike': dict(type=4, every=8, hr=(92, 7.0), wobble=0.2, zone=(0, 0)),
}


def name_for(kind, local):
    h = local.hour
    part = 'Morning' if h < 12 else 'Lunch' if h < 14 else 'Afternoon' if h < 18 else 'Evening'
    if kind == 'ride':
        return R.choice(['%s Ride' % part, 'Amstel loop', 'Waterland', 'Coffee ride', '%s Ride' % part])
    if kind == 'hike':
        return '%s Hike' % part
    return R.choice(['%s Run' % part, '%s Run' % part, 'Vondelpark laps', 'Easy run'])


def smooth_noise(n, scale, amp):
    """A slowly wandering series of n values around 1 (pace changes, not jitter)."""
    out, v, target = [], 0.0, 0.0
    for i in range(n):
        if i % max(1, scale) == 0:
            target = R.uniform(-amp, amp)
        v += (target - v) * (1.5 / max(1, scale))
        out.append(1 + v)
    return out


def activity(kind, t0, t1, trail):
    k = KINDS[kind]
    secs = (t1 - t0).total_seconds()
    n = max(3, int(secs / k['every']))
    cum = [0.0]
    for i in range(len(trail) - 1):
        cum.append(cum[-1] + km(trail[i], trail[i + 1]))
    total = cum[-1]
    pace = smooth_noise(n, 30, k['wobble'])
    # Distance along the trail at each sample: faster stretches cover more of it.
    acc, w = [0.0], 0.0
    for i in range(1, n):
        w += pace[i]
        acc.append(w)
    acc = [a / acc[-1] * total for a in acc]
    # Fitness: heart rate at the same speed drops about 9 bpm over the three years, with seasons.
    years = (t0 - START).total_seconds() / 3.156e7
    fit = 9 * min(1, years / 3) + 2.5 * math.cos((t0.month - 7) / 12 * 2 * math.pi)
    base, per_kmh = k['hr']
    pts, j, hr = [], 0, 0.0
    for i in range(n):
        s = acc[i]
        while j < len(cum) - 2 and cum[j + 1] < s:
            j += 1
        seg = cum[j + 1] - cum[j] or 1e-9
        u = min(1, max(0, (s - cum[j]) / seg))
        lat = trail[j][0] + (trail[j + 1][0] - trail[j][0]) * u + R.gauss(0, 1.5e-5)
        lng = trail[j][1] + (trail[j + 1][1] - trail[j][1]) * u + R.gauss(0, 2.5e-5)
        t = secs * i / (n - 1)
        v = (acc[min(n - 1, i + 1)] - acc[max(0, i - 1)]) / (2 * secs / (n - 1) / 3600) if n > 2 else 0
        want = base + per_kmh * v - fit
        # A hard stretch now and then on runs (strides, a bridge), and a warm-up at the start.
        if k['zone'][0] and math.sin(i / 37.0 + t0.day) > k['zone'][1]:
            want += k['zone'][0]
        want = min(want, 188)
        if i == 0:
            hr = want - 30
        hr += (want - hr) * (0.06 if t > 240 else 0.02)
        pts.append((lat, lng, t0 + dt.timedelta(seconds=t), round(hr + R.gauss(0, 1.2))))
    return pts


def main():
    with open(SRC, encoding='utf-8') as f:
        segs = json.load(f)['semanticSegments']
    paths = {}
    for s in segs:
        if 'timelinePath' in s:
            paths[s['startTime']] = [latlng(p['point']) for p in s['timelinePath']]
    acts = []
    for s in segs:
        a = s.get('activity')
        if not a:
            continue
        mode = a['topCandidate']['type']
        dist = a['distanceMeters'] / 1000
        start = latlng(a['start']['latLng'])
        kind = None
        if mode == 'RUNNING':
            kind = 'run'
        elif mode == 'CYCLING' and dist >= 25:
            kind = 'ride'
        elif mode == 'WALKING' and dist >= 3 and km(start, HOME) > 300:
            kind = 'hike'
        if not kind:
            continue
        trail = paths.get(s['startTime'])
        if not trail or len(trail) < 2:
            continue
        acts.append((kind, parse(s['startTime']), parse(s['endTime']), trail))
    out = ['<?xml version="1.0" encoding="UTF-8"?>\n<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">\n']
    for kind, t0, t1, trail in acts:
        pts = activity(kind, t0, t1, trail)
        out.append('<trk><name>%s</name><type>%d</type><trkseg>\n' % (name_for(kind, t0), KINDS[kind]['type']))
        for lat, lng, t, hr in pts:
            out.append('<trkpt lat="%.6f" lon="%.6f"><time>%s</time><extensions><hr>%d</hr></extensions></trkpt>\n'
                       % (lat, lng, t.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), hr))
        out.append('</trkseg></trk>\n')
    out.append('</gpx>\n')
    data = ''.join(out).encode('utf-8')
    with open(OUT, 'wb') as f:
        f.write(gzip.compress(data, 9, mtime=0))
    counts = {}
    for a in acts:
        counts[a[0]] = counts.get(a[0], 0) + 1
    print('Wrote %s: %s, %d KB (%d KB unzipped)' % (os.path.relpath(OUT), counts, os.path.getsize(OUT) // 1024, len(data) // 1024))


if __name__ == '__main__':
    main()
