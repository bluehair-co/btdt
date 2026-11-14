#!/usr/bin/env python3
"""Make the demo data: three made-up years of someone living in Amsterdam, as an on-device
Timeline.json (semanticSegments), written to static/demo.json.

  python3 source/demo/make_demo.py

Everyday life is cycling, walking and trams around Amsterdam (Oud-West home, office at the
Zuidas), with trains to other Randstad cities now and then and a road trip outside the Randstad
every couple of months. Twice a year there is a holiday: Vietnam, Peru, South Africa, Japan,
Colombia and Tanzania, some of them with a layover. Every person, place visit and trip is made
up; only the cities, streets and airports are real. The output is the same every run (fixed seed).
"""
import datetime as dt
import heapq
import json
import math
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'static', 'demo.json')
R = random.Random(20231113)
# Weekend road rides draw from their own generator, so adding them left the rest of the demo as it was.
RR = random.Random(20240406)
UTC = dt.timezone.utc
START = dt.date(2023, 11, 13)
END = dt.date(2026, 11, 8)

# ---------------------------------------------------------------- time zones
def _last_sunday(y, m):
    d = dt.date(y, m, 31)
    return d - dt.timedelta(days=(d.weekday() + 1) % 7)


def _eu_summer(t):
    """True while EU summer time is on (from 01:00 UTC on the last Sunday of March to that of October)."""
    y = t.year
    a = dt.datetime.combine(_last_sunday(y, 3), dt.time(1), UTC)
    b = dt.datetime.combine(_last_sunday(y, 10), dt.time(1), UTC)
    return a <= t < b


TZ = {
    'CET': lambda t: 120 if _eu_summer(t) else 60,      # Netherlands, Belgium, Germany, Spain
    'EET': lambda t: 180 if _eu_summer(t) else 120,     # Finland
    'GST': lambda t: 240, 'AST': lambda t: 180, 'ICT': lambda t: 420, 'JST': lambda t: 540,
    'PET': lambda t: -300, 'COT': lambda t: -300, 'SAST': lambda t: 120, 'EAT': lambda t: 180,
}


def stamp(t, tz):
    off = TZ[tz](t)
    loc = t + dt.timedelta(minutes=off)
    s = '+' if off >= 0 else '-'
    return loc.strftime('%Y-%m-%dT%H:%M:%S') + '%s%02d:%02d' % (s, abs(off) // 60, abs(off) % 60)


def local_to_utc(day, hh, mm, tz):
    """UTC time for a local wall-clock time on a day."""
    guess = dt.datetime(day.year, day.month, day.day, hh, mm, tzinfo=UTC)
    return guess - dt.timedelta(minutes=TZ[tz](guess - dt.timedelta(hours=1)))


def ll(p):
    return '%.6f°, %.6f°' % (p[0], p[1])


# ---------------------------------------------------------------- geometry
def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(min(1, math.sqrt(h)))


def path_km(pts):
    return sum(km(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def wiggle(pts, amp_km, seg_km):
    """Bends a waypoint line a little, like a road that isn't straight: extra points every seg_km,
    pushed sideways by up to amp_km (smoothly, so it reads as curves, not noise)."""
    out = [pts[0]]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        d = km(a, b)
        n = max(1, int(d / seg_km))
        ph = R.uniform(0, math.pi * 2)
        f = R.uniform(1.2, 2.6)
        dlat, dlng = b[0] - a[0], b[1] - a[1]
        norm = math.hypot(dlat, dlng * math.cos(math.radians(a[0]))) or 1
        nx, ny = -dlng * math.cos(math.radians(a[0])) / norm, dlat / norm
        for k in range(1, n + 1):
            u = k / n
            s = math.sin(u * math.pi) * math.sin(u * math.pi * f + ph) * amp_km / 111.0 if k < n else 0
            out.append((a[0] + dlat * u + nx * s, a[1] + dlng * u + ny * s / max(0.2, math.cos(math.radians(a[0])))))
    return out


def jitter(p, m):
    return (p[0] + R.gauss(0, m) / 111000.0, p[1] + R.gauss(0, m) / (111000.0 * math.cos(math.radians(p[0]))))


# ---------------------------------------------------------------- output
SEGS = []
PIDS = {}


def pid(name):
    if name not in PIDS:
        abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
        PIDS[name] = 'ChIJ' + ''.join(R.choice(abc) for _ in range(23))
    return PIDS[name]


SPEED = {  # km/h while moving, door to door
    'WALKING': 4.6, 'RUNNING': 10.5, 'CYCLING': 15.0, 'IN_TRAM': 13.5, 'IN_BUS': 18.0, 'IN_SUBWAY': 28.0,
    'IN_TRAIN': 85.0, 'IN_PASSENGER_VEHICLE': 55.0, 'IN_FERRY': 11.0, 'IN_CABLECAR': 14.0, 'FLYING': 760.0,
}
EVERY = {  # seconds between GPS points
    'WALKING': 120, 'RUNNING': 90, 'CYCLING': 90, 'IN_TRAM': 120, 'IN_BUS': 150, 'IN_SUBWAY': 180,
    'IN_TRAIN': 300, 'IN_PASSENGER_VEHICLE': 240, 'IN_FERRY': 150, 'IN_CABLECAR': 60,
}


class Person:
    """Where the made-up person is: a place, its time zone, and since when they've been there."""

    def __init__(self, place, tz, since):
        self.place, self.tz, self.since = place, tz, since

    def stay(self, until):
        p = self.place
        if until - self.since >= dt.timedelta(minutes=3):
            SEGS.append({
                'startTime': stamp(self.since, self.tz), 'endTime': stamp(until, self.tz),
                'visit': {'topCandidate': {'placeId': pid(p['name']), 'semanticType': p.get('sem', 'UNKNOWN'),
                                           'placeLocation': {'latLng': ll(p['ll'])}}}
            })

    def go(self, dest, mode, route, depart, tz2=None, speed=None, every=None):
        """Leaves now-ish (at depart) for dest along route (a list of points), arriving by the mode's speed."""
        tz2 = tz2 or self.tz
        depart = max(depart, self.since)
        self.stay(depart)
        pts = [self.place['ll']] + list(route) + [dest['ll']]
        d = path_km(pts)
        v = (speed or SPEED[mode]) * R.uniform(0.9, 1.1)
        mins = d / v * 60 + (30 if mode == 'FLYING' else 0)
        arrive = depart + dt.timedelta(minutes=max(2.0, mins))
        seg = {
            'startTime': stamp(depart, self.tz), 'endTime': stamp(arrive, tz2),
            'activity': {'start': {'latLng': ll(pts[0])}, 'end': {'latLng': ll(pts[-1])},
                         'distanceMeters': round(d * 1000 * (1.0 if mode == 'FLYING' else R.uniform(1.0, 1.04)), 1),
                         'topCandidate': {'type': mode}}
        }
        SEGS.append(seg)
        if mode != 'FLYING':
            SEGS.append({'startTime': stamp(depart, self.tz), 'endTime': stamp(arrive, tz2),
                         'timelinePath': trail(pts, depart, arrive, every or EVERY[mode], self.tz)})
        self.place, self.tz, self.since = dest, tz2, arrive
        return arrive


def trail(pts, t0, t1, every, tz):
    """GPS points along pts: one every `every` seconds plus each bend, a few metres off the line."""
    cum = [0.0]
    for i in range(len(pts) - 1):
        cum.append(cum[-1] + km(pts[i], pts[i + 1]))
    total = cum[-1] or 1e-9
    secs = (t1 - t0).total_seconds()
    marks = set()
    k = 0.0
    while k < secs:
        marks.add(k / secs)
        k += every * R.uniform(0.75, 1.3)
    for c in cum:
        marks.add(c / total)
    marks.add(1.0)
    out = []
    j = 0
    for f in sorted(marks):
        s = f * total
        while j < len(cum) - 2 and cum[j + 1] < s:
            j += 1
        seg = cum[j + 1] - cum[j] or 1e-9
        u = min(1, max(0, (s - cum[j]) / seg))
        p = (pts[j][0] + (pts[j + 1][0] - pts[j][0]) * u, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * u)
        if 0 < f < 1:
            p = jitter(p, 6)
        out.append({'point': ll(p), 'time': stamp(t0 + dt.timedelta(seconds=secs * f), tz)})
    return out


# ---------------------------------------------------------------- Amsterdam
NODES = {
    'HOME': (52.36395, 4.86560), 'OVJ': (52.3602, 4.8638), 'VPW': (52.3590, 4.8628), 'VPM': (52.3577, 4.8690),
    'VPE': (52.3612, 4.8782), 'VPS': (52.3557, 4.8702), 'H1': (52.3500, 4.8706), 'H2': (52.3458, 4.8712),
    'ZA': (52.3412, 4.8735), 'KNK': (52.3666, 4.8664), 'BLD': (52.3680, 4.8740), 'MRX': (52.3725, 4.8778),
    'WST': (52.3747, 4.8838), 'DAM': (52.3731, 4.8926), 'CS': (52.3786, 4.8995), 'NOR': (52.3787, 4.8860),
    'HPL': (52.3829, 4.8843), 'WPK': (52.3858, 4.8790), 'LEI': (52.3641, 4.8830), 'LDS': (52.3660, 4.8880),
    'MNT': (52.3672, 4.8934), 'REM': (52.3663, 4.8966), 'WAT': (52.3672, 4.9025), 'WEE': (52.3612, 4.9078),
    'OST': (52.3602, 4.9205), 'OST2': (52.3590, 4.9262), 'SPG': (52.3612, 4.8875), 'RIJ': (52.3596, 4.8848),
    'MUS': (52.3577, 4.8812), 'FBL': (52.3583, 4.8912), 'ACM': (52.3557, 4.8930), 'SAR': (52.3543, 4.8963),
    'FRP': (52.3605, 4.8990), 'CEI': (52.3545, 4.8845), 'CSP': (52.3812, 4.8996), 'NDP': (52.4006, 4.8916),
}
EDGES = ('HOME-OVJ OVJ-VPW HOME-KNK KNK-BLD BLD-MRX MRX-WST WST-DAM DAM-CS WST-NOR NOR-HPL HPL-WPK HPL-CS '
         'OVJ-VPE VPW-VPM VPM-VPE VPM-VPS VPS-H1 H1-H2 H2-ZA VPE-LEI BLD-VPE LEI-LDS LDS-MNT MNT-DAM MNT-REM '
         'REM-WAT WAT-WEE WEE-OST OST-OST2 LEI-SPG SPG-RIJ RIJ-MUS MUS-VPE MUS-H1 SPG-FBL FBL-ACM ACM-SAR '
         'SAR-FRP FBL-FRP FRP-WEE FRP-REM ACM-CEI CEI-MUS CEI-H1 CSP-CS').split()
ADJ = {}
for e in EDGES:
    a, b = e.split('-')
    w = km(NODES[a], NODES[b])
    ADJ.setdefault(a, []).append((b, w))
    ADJ.setdefault(b, []).append((a, w))


def nearest(p):
    return min(NODES, key=lambda n: km(NODES[n], p))


def city_route(a, b):
    """Along Amsterdam's streets (the network above), as bend points between places a and b."""
    s, t = nearest(a), nearest(b)
    dist, prev, q = {s: 0}, {}, [(0, s)]
    while q:
        d, n = heapq.heappop(q)
        if n == t:
            break
        if d > dist[n]:
            continue
        for m, w in ADJ[n]:
            if d + w < dist.get(m, 1e9):
                dist[m] = d + w
                prev[m] = n
                heapq.heappush(q, (d + w, m))
    nodes = [t]
    while nodes[-1] != s:
        nodes.append(prev[nodes[-1]])
    pts = [NODES[n] for n in reversed(nodes)]
    # Drop a first or last node that sends the trip backwards past its own end.
    if len(pts) > 1 and km(a, pts[1]) < km(pts[0], pts[1]) and km(a, pts[0]) > 0.05:
        pts = pts[1:]
    if len(pts) > 1 and km(b, pts[-2]) < km(pts[-1], pts[-2]) and km(b, pts[-1]) > 0.05:
        pts = pts[:-1]
    return wiggle(pts, 0.012, 0.4) if pts else []


def P(name, lat, lng, sem='UNKNOWN'):
    return {'name': name, 'll': (lat, lng), 'sem': sem}


HOME = P('home', 52.36395, 4.86560, 'HOME')
WORK = P('work', 52.33905, 4.87290, 'WORK')
GYM = P('gym', 52.36110, 4.87050)
SUPER = P('supermarket', 52.36640, 4.86960)
MARKET = P('Ten Katemarkt', 52.36710, 4.86760)
CAFES = [P('cafe Vondelpark', 52.35800, 4.86850), P('cafe Kinkerbuurt', 52.36560, 4.87180), P('cafe Jordaan', 52.37530, 4.88150),
         P('bakery Oud-West', 52.36250, 4.86950)]
LUNCH = [P('lunch Zuidas', 52.33720, 4.87000), P('lunch Beethovenstraat', 52.34120, 4.87580), P('salad bar Zuidas', 52.33980, 4.87930)]
FRIENDS = [P('friends De Pijp', 52.35350, 4.89700), P('friends Jordaan', 52.37680, 4.88250), P('friends Oost', 52.35900, 4.92550),
           P('friends Westerpark', 52.38470, 4.87520)]
DINNER = [P('restaurant Leidseplein', 52.36380, 4.88200), P('restaurant De Pijp', 52.35610, 4.89180), P('bar Rembrandtplein', 52.36600, 4.89700),
          P('restaurant Jordaan', 52.37720, 4.88480), P('restaurant Oud-West', 52.36500, 4.87300), P('bar Waterlooplein', 52.36760, 4.90180)]
WEEKEND = [P('Albert Cuypmarkt', 52.35570, 4.89260), P('Rijksmuseum', 52.35999, 4.88520), P('Westerpark', 52.38630, 4.87800),
           P('Oosterpark', 52.36000, 4.92050), P('Dam', 52.37310, 4.89260), P('Stedelijk Museum', 52.35800, 4.87990),
           P('Noordermarkt', 52.37950, 4.88620), P('Sarphatipark', 52.35420, 4.89630), P('Vondelpark', 52.35780, 4.86900)]
NDSM = P('NDSM', 52.40100, 4.89200)
CS_PIER = P('ferry pier Centraal', 52.38120, 4.89960)
NDSM_PIER = P('ferry pier NDSM', 52.40060, 4.89160)
CENTRAAL = P('Amsterdam Centraal', 52.37890, 4.90030)
ZUID = P('Amsterdam Zuid', 52.33890, 4.87210)
SCHIPHOL = P('Schiphol', 52.30920, 4.76210)

me = None


def at(day, hh, mm, spread=0, tz='CET'):
    t = local_to_utc(day, hh, mm, tz)
    return t + dt.timedelta(minutes=R.randint(-spread, spread)) if spread else t


def city_trip(dest, mode, depart):
    return me.go(dest, mode, city_route(me.place['ll'], dest['ll']), depart)


def bike_or(depart, dest, tram_p=0.15, walk_km=1.2):
    d = km(me.place['ll'], dest['ll'])
    if d < walk_km and R.random() < 0.7:
        mode = 'WALKING'
    elif R.random() < tram_p:
        mode = 'IN_TRAM'
    else:
        mode = 'CYCLING'
    return city_trip(dest, mode, depart)


def winter(day):
    return day.month in (11, 12, 1, 2)


def later(mins_lo, mins_hi):
    return me.since + dt.timedelta(minutes=R.randint(mins_lo, mins_hi))


def run_loop(depart):
    loop = [NODES['OVJ'], NODES['VPW'], NODES['VPM'], NODES['VPE'], (52.3600, 4.8760), NODES['VPM'], NODES['VPW'], NODES['OVJ']]
    if R.random() < 0.5:
        loop = loop[:4] + [NODES['VPM'], NODES['VPS'], (52.3567, 4.8640)] + loop[-2:]
    return me.go(HOME, 'RUNNING', wiggle(loop, 0.01, 0.2), depart)


def evening_out(day, start_from_work=False):
    kind = R.random()
    dest = R.choice(FRIENDS) if kind < 0.4 else R.choice(DINNER)
    bike_or(me.since + dt.timedelta(minutes=R.randint(5, 50)) if start_from_work else at(day, 19, 0, 40), dest, tram_p=0.25 if winter(day) else 0.12)
    back = later(120, 260)
    bike_or(back, HOME, tram_p=0.1)


def office_day(day):
    t = at(day, 8, 25, 22)
    city_trip(WORK, 'IN_TRAM' if R.random() < (0.3 if winter(day) else 0.14) else 'CYCLING', t)
    if R.random() < 0.38:
        spot = R.choice(LUNCH)
        city_trip(spot, 'WALKING', at(day, 12, 20, 25))
        city_trip(WORK, 'WALKING', later(25, 50))
    leave = at(day, 17, 45, 35)
    me.stay(leave)
    r = R.random()
    if r < 0.2 and day.weekday() in (1, 3):
        bike_or(leave, GYM, tram_p=0.05)
        bike_or(later(60, 85), HOME, tram_p=0)
    elif r < 0.4:
        me.since = leave
        evening_out(day, start_from_work=True)
    elif r < 0.55:
        bike_or(leave, SUPER, tram_p=0.05)
        city_trip(HOME, 'WALKING' if R.random() < 0.5 else 'CYCLING', later(10, 25))
    else:
        city_trip(HOME, 'IN_TRAM' if R.random() < (0.3 if winter(day) else 0.14) else 'CYCLING', leave)


def home_day(day):
    if R.random() < 0.35:
        spot = R.choice(CAFES)
        bike_or(at(day, 9, 30, 30), spot, tram_p=0)
        bike_or(later(30, 70), HOME, tram_p=0)
    if R.random() < 0.45:
        city_trip(R.choice([SUPER, MARKET]), 'WALKING', at(day, 12, 40, 30))
        city_trip(HOME, 'WALKING', later(15, 35))
    if R.random() < 0.3 and not winter(day):
        run_loop(at(day, 17, 40, 30))
    elif R.random() < 0.15:
        run_loop(at(day, 7, 30, 20))
    if R.random() < 0.35:
        evening_out(day)


def ferry_outing(day):
    city_trip(CS_PIER, 'CYCLING', at(day, 13, 0, 60))
    me.go(NDSM_PIER, 'IN_FERRY', [(52.3880, 4.8975), (52.3960, 4.8930)], later(3, 12))
    me.go(NDSM, 'CYCLING', [], me.since)
    me.go(NDSM_PIER, 'CYCLING', [], later(90, 200))
    me.go(CS_PIER, 'IN_FERRY', [(52.3960, 4.8930), (52.3880, 4.8975)], later(3, 12))
    city_trip(HOME, 'CYCLING', me.since)


# Weekend morning road rides out of town (recorded on Strava too, see make_activities.py), from April
# to October: south along the Amstel, or north through Waterland.
RIDES = [
    [(52.3560, 4.8800), (52.3450, 4.9020), (52.3200, 4.9100), (52.2960, 4.9230), (52.2740, 4.9660), (52.2850, 5.0100), (52.3150, 4.9750), (52.3400, 4.9300), (52.3560, 4.8800)],
    [(52.3790, 4.9000), (52.3900, 4.9300), (52.3830, 4.9900), (52.4250, 5.0450), (52.4590, 5.1000), (52.4610, 5.0350), (52.4350, 4.9950), (52.4000, 4.9250), (52.3790, 4.9000)],
    [(52.3560, 4.8800), (52.3200, 4.8700), (52.2900, 4.8300), (52.2600, 4.8000), (52.2400, 4.8600), (52.2700, 4.9000), (52.3200, 4.8950), (52.3560, 4.8800)],
]


def road_ride(day):
    global R
    saved, R = R, RR
    try:
        me.go(HOME, 'CYCLING', wiggle(R.choice(RIDES), 0.15, 0.8), at(day, 8, 40, 30), speed=R.uniform(25, 29))
    finally:
        R = saved


def weekend_day(day):
    if 4 <= day.month <= 10 and RR.random() < 0.4:
        road_ride(day)
    if R.random() < 0.1:
        return
    if R.random() < 0.5:
        first = R.choice(WEEKEND[:1] + CAFES + [MARKET])
        bike_or(at(day, 10, 45, 50), first, tram_p=0.05)
        bike_or(later(40, 120), HOME, tram_p=0.05)
    r = R.random()
    if r < 0.08:
        ferry_outing(day)
    elif r < 0.75:
        a = R.choice(WEEKEND)
        bike_or(at(day, 14, 0, 70), a, tram_p=0.12 if winter(day) else 0.05)
        if R.random() < 0.4:
            b = R.choice([x for x in WEEKEND + CAFES if x is not a])
            bike_or(later(60, 150), b, tram_p=0.05)
        bike_or(later(50, 160), HOME, tram_p=0.08)
    if R.random() < 0.5:
        dest = R.choice(DINNER + FRIENDS)
        bike_or(at(day, 19, 15, 45), dest, tram_p=0.15)
        bike_or(later(150, 330), HOME, tram_p=0.05)


# Trains to other Randstad cities, from Centraal.
RAIL = {
    'Utrecht': ([(52.3790, 4.9000), (52.3460, 4.9180), (52.3125, 4.9465), (52.2720, 4.9700), (52.1720, 5.0010), (52.1350, 5.0400)],
                P('Utrecht Centraal', 52.08940, 5.11010), [P('Domplein', 52.09080, 5.12170), P('Oudegracht', 52.08780, 5.12030), P('Lepelenburg', 52.08960, 5.13180)]),
    'Haarlem': ([(52.3889, 4.8380), (52.3870, 4.7300)], P('Haarlem station', 52.38740, 4.63800),
                [P('Grote Markt Haarlem', 52.38120, 4.63680), P('Frans Hals Museum', 52.37690, 4.63300)]),
    'Rotterdam': ([(52.3889, 4.8380), (52.3092, 4.7621), (52.2640, 4.6390), (52.1664, 4.4817), (52.0700, 4.3220), (52.0110, 4.3560)],
                  P('Rotterdam Centraal', 51.92440, 4.46900), [P('Markthal', 51.92010, 4.48650), P('Erasmusbrug', 51.90950, 4.48680), P('Witte de Withstraat', 51.91660, 4.47530)]),
    'Den Haag': ([(52.3889, 4.8380), (52.3092, 4.7621), (52.2640, 4.6390), (52.1664, 4.4817)],
                 P('Den Haag Centraal', 52.08090, 4.32480), [P('Binnenhof', 52.07980, 4.31330), P('Mauritshuis', 52.08040, 4.31440), P('Scheveningen beach', 52.11300, 4.27970)]),
    'Leiden': ([(52.3889, 4.8380), (52.3092, 4.7621), (52.2640, 4.6390)], P('Leiden Centraal', 52.16640, 4.48170),
               [P('Rapenburg', 52.15680, 4.48390), P('Hortus Leiden', 52.15720, 4.48580)]),
}


def train_day(day, city):
    route, station, sights = RAIL[city]
    bike_or(at(day, 10, 10, 30), CENTRAAL, tram_p=0.5)
    me.go(station, 'IN_TRAIN', wiggle(route, 0.4, 3), later(4, 15))
    stops = R.sample(sights, min(len(sights), R.randint(1, 3)))
    for s in stops:
        me.go(s, 'IN_TRAM' if km(me.place['ll'], s['ll']) > 3 else 'WALKING', wiggle([me.place['ll'], s['ll']], 0.05, 0.3)[1:-1], later(10, 90))
    me.go(station, 'WALKING', [], later(40, 120))
    me.go(CENTRAAL, 'IN_TRAIN', wiggle(list(reversed(route)), 0.4, 3), later(5, 20))
    bike_or(later(2, 8), HOME, tram_p=0.5)


# ---------------------------------------------------------------- road trips outside the Randstad
A2 = [(52.3390, 4.8900), (52.3300, 4.9300), (52.2700, 4.9750), (52.1100, 5.0500), (52.0500, 5.1000)]
A2S = A2 + [(51.9400, 5.2300), (51.7000, 5.3100), (51.4400, 5.4700), (51.2500, 5.7000), (51.1900, 5.9600)]
A4 = [(52.3480, 4.8550), (52.3000, 4.7700), (52.1700, 4.5300), (52.0400, 4.3900), (52.0100, 4.3700), (51.9300, 4.4300)]
A1 = [(52.3480, 4.8550), (52.3300, 4.9500), (52.3000, 5.1600), (52.2200, 5.2900), (52.1700, 5.4000), (52.1400, 5.5800)]
A6 = [(52.3480, 4.8550), (52.3300, 4.9500), (52.3700, 5.2200), (52.5100, 5.4700), (52.7100, 5.7500)]
A7 = [(52.3700, 4.8600), (52.4200, 4.8300), (52.5000, 4.9500), (52.6400, 5.0600), (52.9300, 5.0400), (53.0000, 5.1700), (53.0600, 5.5300)]
A9 = [(52.3700, 4.8600), (52.4200, 4.8300), (52.6300, 4.7500), (52.8800, 4.7800)]

ROADTRIPS = [
    # (first day, name, tz, route out, base, nights, outings)
    (dt.date(2024, 4, 12), 'Texel', A9 + [(52.9620, 4.7800)], P('hotel De Koog', 53.09700, 4.76000), 2,
     [P('Ecomare', 53.08780, 4.75610), P('Den Burg', 53.05480, 4.79900), P('Lighthouse Texel', 53.18250, 4.85440)]),
    (dt.date(2024, 5, 25), 'Giethoorn', A6 + [(52.7300, 5.9800)], P('Giethoorn', 52.74000, 6.08000), 0,
     [P('Weerribben', 52.78000, 6.06000)]),
    (dt.date(2024, 6, 21), 'Ardennes', A2S + [(50.8500, 5.6900), (50.6300, 5.5700)], P('cabin Durbuy', 50.35300, 5.45600), 2,
     [P('Durbuy old town', 50.35220, 5.45660), P('La Roche-en-Ardenne', 50.18360, 5.57580), P('Grottes de Hotton', 50.27180, 5.44370)]),
    (dt.date(2024, 10, 5), 'Hoge Veluwe', A1 + [(52.0950, 5.7800)], P('Kröller-Müller Museum', 52.09550, 5.81690), 0,
     [P('Hoge Veluwe dunes', 52.07400, 5.85000)]),
    (dt.date(2024, 11, 29), 'Cologne', A2 + [(52.0100, 5.5500), (51.9800, 5.9100), (51.8300, 6.2500), (51.4900, 6.8600), (51.2300, 6.7800)],
     P('hotel Köln', 50.94000, 6.96000), 2,
     [P('Kölner Dom', 50.94130, 6.95830), P('Christmas market Köln', 50.93730, 6.96010), P('Belgisches Viertel', 50.93890, 6.93700)]),
    (dt.date(2025, 3, 22), 'Zeeland', A4 + [(51.8500, 4.4000), (51.6500, 3.9200), (51.5000, 3.6100)], P('B&B Domburg', 51.56400, 3.49600), 1,
     [P('Domburg beach', 51.56900, 3.49100), P('Middelburg', 51.49880, 3.61360), P('Veere', 51.54800, 3.66600)]),
    (dt.date(2025, 5, 9), 'Maastricht', A2S, P('hotel Maastricht', 50.85000, 5.69000), 2,
     [P('Vrijthof', 50.84870, 5.68830), P('Sint-Pietersberg', 50.83000, 5.68800), P('Valkenburg', 50.86500, 5.83200)]),
    (dt.date(2025, 9, 13), 'Groningen', A6 + [(52.9600, 5.9200), (53.1000, 6.1000)], P('hotel Groningen', 53.21900, 6.56700), 1,
     [P('Grote Markt Groningen', 53.21880, 6.56770), P('Noorderplantsoen', 53.22400, 6.55800), P('Pieterburen', 53.39940, 6.44840)]),
    (dt.date(2025, 10, 18), 'Antwerp', A2 + [(51.8300, 4.9800), (51.5900, 4.7800)], P('hotel Antwerpen', 51.22000, 4.40000), 1,
     [P('Grote Markt Antwerpen', 51.22130, 4.39960), P('MAS Antwerpen', 51.22890, 4.40470), P('Zurenborg', 51.20960, 4.42780)]),
    (dt.date(2026, 4, 3), 'Friesland', A7, P('B&B Sneek', 53.03300, 5.65900), 2,
     [P('Sneekermeer', 53.03500, 5.75000), P('Hindeloopen', 52.94200, 5.40100), P('Harlingen', 53.17460, 5.41450)]),
    (dt.date(2026, 8, 22), 'Giethoorn', A6 + [(52.7300, 5.9800)], P('Giethoorn', 52.74000, 6.08000), 0,
     [P('Giethoorn canals', 52.73700, 6.07600)]),
    (dt.date(2026, 9, 11), 'Texel', A9 + [(52.9620, 4.7800)], P('hotel De Koog', 53.09700, 4.76000), 2,
     [P('Ecomare', 53.08780, 4.75610), P('Oudeschild', 53.03900, 4.84800), P('Slufter', 53.12600, 4.80000)]),
]
TEXEL_FERRY = [P('ferry Den Helder', 52.96300, 4.77900), P('ferry Texel', 53.00100, 4.79000)]


def road_trip(day, name, out, base, nights, outings):
    t = at(day, 9 if nights == 0 else 16, 30, 40)
    via = [HOME['ll'], (52.3602, 4.8638), (52.3540, 4.8560)] if out[0][0] < 52.36 else [HOME['ll'], (52.3666, 4.8664)]
    leg = wiggle(via[1:] + out, 0.6, 4)
    if name == 'Texel':
        me.go(TEXEL_FERRY[0], 'IN_PASSENGER_VEHICLE', leg, t, speed=75)
        me.go(TEXEL_FERRY[1], 'IN_FERRY', [(52.9800, 4.7900)], later(10, 30))
        me.go(base, 'IN_PASSENGER_VEHICLE', wiggle([(53.0010, 4.7900), (53.0548, 4.7990), (53.0800, 4.7700)], 0.15, 1), me.since, speed=45)
    else:
        me.go(base, 'IN_PASSENGER_VEHICLE', leg, t, speed=78)
    d = day
    for n in range(nights + 1):
        if n > 0:
            d = day + dt.timedelta(days=n)
        todo = outings if nights == 0 else [o for o in outings if R.random() < 0.75] or outings[:1]
        if nights and n == 0:
            todo = []
        for o in todo[:2] if nights else todo:
            dkm = km(me.place['ll'], o['ll'])
            mode = 'WALKING' if dkm < 1.6 else ('CYCLING' if dkm < 6 and R.random() < 0.5 else 'IN_PASSENGER_VEHICLE')
            start = at(d, 10, 0, 50) if me.since < at(d, 9, 0) else later(20, 60)
            me.go(o, mode, wiggle([me.place['ll'], o['ll']], 0.08 if mode != 'IN_PASSENGER_VEHICLE' else 0.5, 0.4 if mode != 'IN_PASSENGER_VEHICLE' else 2)[1:-1], start)
            if nights:
                me.go(base, mode, wiggle([me.place['ll'], base['ll']], 0.08 if mode != 'IN_PASSENGER_VEHICLE' else 0.5, 0.4 if mode != 'IN_PASSENGER_VEHICLE' else 2)[1:-1], later(60, 180))
    back = later(30, 120) if nights == 0 else at(d, 14, 30, 60)
    back = max(back, me.since + dt.timedelta(minutes=20))
    rev = list(reversed(out)) + list(reversed(via[1:]))
    if name == 'Texel':
        me.go(TEXEL_FERRY[1], 'IN_PASSENGER_VEHICLE', wiggle([(53.0800, 4.7700), (53.0548, 4.7990)], 0.15, 1), back, speed=45)
        me.go(TEXEL_FERRY[0], 'IN_FERRY', [(52.9800, 4.7900)], later(10, 35))
        me.go(HOME, 'IN_PASSENGER_VEHICLE', wiggle(rev[1:], 0.6, 4), me.since, speed=75)
    else:
        me.go(HOME, 'IN_PASSENGER_VEHICLE', wiggle(rev, 0.6, 4), back, speed=78)
    return d


# ---------------------------------------------------------------- holidays
def A(name, lat, lng, tz):
    p = P(name, lat, lng)
    p['tz'] = tz
    return p


AIR = {
    'AMS': A('Schiphol', 52.30920, 4.76210, 'CET'), 'DXB': A('Dubai International', 25.25320, 55.36570, 'GST'),
    'SGN': A('Tan Son Nhat', 10.81880, 106.65190, 'ICT'), 'DAD': A('Da Nang airport', 16.04390, 108.19900, 'ICT'),
    'HAN': A('Noi Bai', 21.22120, 105.80720, 'ICT'), 'LIM': A('Jorge Chávez', -12.02190, -77.11430, 'PET'),
    'CUZ': A('Cusco airport', -13.53570, -71.93880, 'PET'), 'CPT': A('Cape Town International', -33.97150, 18.60210, 'SAST'),
    'GRJ': A('George airport', -34.00560, 22.37890, 'SAST'), 'HEL': A('Helsinki-Vantaa', 60.31720, 24.96330, 'EET'),
    'NRT': A('Narita', 35.77200, 140.39290, 'JST'), 'KIX': A('Kansai', 34.43200, 135.23040, 'JST'),
    'MAD': A('Madrid-Barajas', 40.49830, -3.56760, 'CET'), 'BOG': A('El Dorado', 4.70160, -74.14690, 'COT'),
    'MDE': A('José María Córdova', 6.16450, -75.42310, 'COT'), 'CTG': A('Rafael Núñez', 10.44240, -75.51300, 'COT'),
    'DOH': A('Hamad International', 25.27310, 51.60810, 'AST'), 'JRO': A('Kilimanjaro airport', -3.42940, 37.07450, 'EAT'),
    'SEU': A('Seronera airstrip', -2.45800, 34.82250, 'EAT'), 'ZNZ': A('Zanzibar airport', -6.22200, 39.22490, 'EAT'),
}


def fly(to, depart, wait_after=(25, 50)):
    me.go(to, 'FLYING', [], depart, tz2=to['tz'])
    me.since = me.since  # arrival; the stay at the airport follows until the next trip


def layover(to, mins):
    return me.since + dt.timedelta(minutes=mins)


def to_schiphol(day, hh, mm):
    city_trip(ZUID, 'IN_TRAM', at(day, hh, mm, 10))
    me.go(SCHIPHOL_STOP, 'IN_TRAIN', [(52.3350, 4.8400), (52.3200, 4.8000)], later(4, 10))
    me.go(AIR['AMS'], 'WALKING', [], me.since)


SCHIPHOL_STOP = P('Schiphol station', 52.30880, 4.76190)


def from_schiphol():
    me.go(SCHIPHOL_STOP, 'WALKING', [], later(25, 45))
    me.go(ZUID, 'IN_TRAIN', [(52.3200, 4.8000), (52.3350, 4.8400)], later(3, 12))
    city_trip(HOME, 'IN_TRAM', later(3, 8))


def local(day, hh, mm, spread=30):
    return at(day, hh, mm, spread, me.tz)


def hop(dest, mode, depart, amp=None, seg=None, speed=None, via=None):
    pts = [me.place['ll']] + (via or []) + [dest['ll']]
    big = mode in ('IN_PASSENGER_VEHICLE', 'IN_BUS', 'IN_TRAIN', 'IN_FERRY')
    route = wiggle(pts, amp if amp is not None else (0.4 if big else 0.05), seg or (2 if big else 0.25))[1:-1]
    return me.go(dest, mode, route, depart, speed=speed)


def city_days(day, n, hotel, sights, far_mode='IN_PASSENGER_VEHICLE'):
    """n days of sightseeing from hotel: two or three sights a day, walked when close."""
    d = day
    for k in range(n):
        d = day + dt.timedelta(days=k)
        todo = R.sample(sights, min(len(sights), R.randint(2, 3)))
        t = local(d, 9, 45, 40)
        for s in todo:
            dk = km(me.place['ll'], s['ll'])
            mode = 'WALKING' if dk < 2.2 else far_mode
            hop(s, mode, max(t, me.since + dt.timedelta(minutes=10)))
            t = later(50, 150)
        dk = km(me.place['ll'], hotel['ll'])
        hop(hotel, 'WALKING' if dk < 2.2 else far_mode, t)
        if R.random() < 0.6:
            dinner = P('dinner ' + hotel['name'] + str(R.randint(0, 3)), *jitter(hotel['ll'], 500))
            hop(dinner, 'WALKING', local(d, 19, 30, 30))
            hop(hotel, 'WALKING', later(70, 130))
    return d


def H(name, lat, lng):
    return P(name, lat, lng)


def vietnam(day):
    to_schiphol(day, 7, 15)
    fly(AIR['DXB'], local(day, 10, 40, 0) if False else at(day, 10, 40, 5))
    fly(AIR['SGN'], layover(AIR['DXB'], R.randint(140, 200)))
    d = day + dt.timedelta(days=1)
    hotel = H('hotel District 1', 10.77450, 106.70200)
    hop(hotel, 'IN_PASSENGER_VEHICLE', later(35, 60), via=[(10.8000, 106.6700)])
    d = city_days(d + dt.timedelta(days=1), 2, hotel, [H('Ben Thanh Market', 10.77250, 106.69800), H('War Remnants Museum', 10.77950, 106.69210),
                                                       H('Saigon Central Post Office', 10.77980, 106.69990), H('Thao Dien', 10.80300, 106.73500), H('Bui Vien', 10.76750, 106.69300)])
    d += dt.timedelta(days=1)
    hop(AIR['SGN'], 'IN_PASSENGER_VEHICLE', local(d, 8, 0, 10), via=[(10.8000, 106.6700)])
    fly(AIR['DAD'], later(80, 110))
    hoian = H('homestay Hoi An', 15.87700, 108.32600)
    hop(hoian, 'IN_PASSENGER_VEHICLE', later(30, 50), via=[(16.0300, 108.2300), (15.9500, 108.2800)], speed=40)
    for k in range(1, 5):
        dd = d + dt.timedelta(days=k)
        for s in R.sample([H('Hoi An Ancient Town', 15.87750, 108.32750), H('An Bang Beach', 15.91350, 108.34100), H('Tra Que village', 15.89900, 108.33800),
                           H('Cam Thanh coconut forest', 15.87300, 108.37000), H('Japanese Covered Bridge', 15.87710, 108.32610)], 2):
            hop(s, 'CYCLING' if km(me.place['ll'], s['ll']) > 1.2 else 'WALKING', max(local(dd, 9, 30, 50), later(30, 90)))
        hop(hoian, 'CYCLING' if km(me.place['ll'], hoian['ll']) > 1.2 else 'WALKING', later(60, 160))
    d += dt.timedelta(days=5)
    hop(AIR['DAD'], 'IN_PASSENGER_VEHICLE', local(d, 9, 0, 20), via=[(15.9500, 108.2800), (16.0300, 108.2300)], speed=40)
    fly(AIR['HAN'], later(80, 110))
    hanoi = H('hotel Old Quarter', 21.03350, 105.85000)
    hop(hanoi, 'IN_PASSENGER_VEHICLE', later(30, 50), via=[(21.1200, 105.8100), (21.0600, 105.8400)], speed=35)
    d = city_days(d + dt.timedelta(days=1), 1, hanoi, [H('Hoan Kiem Lake', 21.02850, 105.85200), H('Temple of Literature', 21.02750, 105.83550),
                                                      H('Train Street', 21.02700, 105.84300), H('West Lake', 21.05600, 105.82300)])
    d += dt.timedelta(days=1)
    port = H('Tuan Chau harbour', 20.91500, 107.03000)
    hop(port, 'IN_BUS', local(d, 8, 0, 10), via=[(21.0000, 106.1000), (20.9500, 106.6000)], speed=55)
    boat = H('junk boat Ha Long Bay', 20.85000, 107.11000)
    hop(boat, 'IN_FERRY', later(40, 70), via=[(20.9100, 107.0500), (20.8800, 107.0900)], speed=10)
    hop(H('Sung Sot cave', 20.84300, 107.09200), 'IN_FERRY', later(90, 150), speed=10)
    hop(boat, 'IN_FERRY', later(60, 100), speed=10)
    d += dt.timedelta(days=1)
    hop(port, 'IN_FERRY', local(d, 9, 30, 15), via=[(20.8800, 107.0900), (20.9100, 107.0500)], speed=10)
    hop(hanoi, 'IN_BUS', later(20, 40), via=[(20.9500, 106.6000), (21.0000, 106.1000)], speed=55)
    d += dt.timedelta(days=1)
    city_days(d, 1, hanoi, [H('Ho Chi Minh Mausoleum', 21.03670, 105.83470), H('Dong Xuan Market', 21.03820, 105.84950), H('St Joseph Cathedral', 21.02870, 105.84900)])
    d += dt.timedelta(days=1)
    hop(AIR['HAN'], 'IN_PASSENGER_VEHICLE', local(d, 19, 30, 10), via=[(21.0600, 105.8400), (21.1200, 105.8100)], speed=35)
    fly(AIR['DXB'], later(140, 170))
    fly(AIR['AMS'], layover(AIR['DXB'], R.randint(150, 210)))
    from_schiphol()
    return me.since.date()


def peru(day):
    to_schiphol(day, 9, 30)
    fly(AIR['LIM'], at(day, 12, 50, 5))
    mira = H('hotel Miraflores', -12.12110, -77.02970)
    hop(mira, 'IN_PASSENGER_VEHICLE', later(40, 70), via=[(-12.0600, -77.0900), (-12.1000, -77.0500)], speed=28)
    d = city_days(day + dt.timedelta(days=1), 2, mira, [H('Larcomar', -12.13180, -77.03050), H('Barranco', -12.14900, -77.02100), H('Plaza Mayor Lima', -12.04640, -77.03000),
                                                        H('Parque Kennedy', -12.12190, -77.02980), H('Huaca Pucllana', -12.11080, -77.03390)])
    d += dt.timedelta(days=1)
    hop(AIR['LIM'], 'IN_PASSENGER_VEHICLE', local(d, 6, 0, 10), via=[(-12.1000, -77.0500), (-12.0600, -77.0900)], speed=30)
    fly(AIR['CUZ'], later(90, 120))
    cusco = H('hotel Cusco', -13.51700, -71.97850)
    hop(cusco, 'IN_PASSENGER_VEHICLE', later(25, 40), speed=20)
    d = city_days(d, 2, cusco, [H('Plaza de Armas Cusco', -13.51670, -71.97870), H('San Blas', -13.51450, -71.97500), H('Sacsayhuamán', -13.50940, -71.98170),
                                H('Qorikancha', -13.52010, -71.97510), H('San Pedro Market', -13.52130, -71.98420)])
    d += dt.timedelta(days=1)
    olla = H('hotel Ollantaytambo', -13.25800, -72.26300)
    hop(H('Pisac', -13.42200, -71.84700), 'IN_PASSENGER_VEHICLE', local(d, 8, 30, 15), via=[(-13.4700, -71.9200)], speed=35)
    hop(olla, 'IN_PASSENGER_VEHICLE', later(100, 150), via=[(-13.3050, -72.1160)], speed=40)
    d += dt.timedelta(days=1)
    aguas = H('Aguas Calientes', -13.15470, -72.52540)
    hop(aguas, 'IN_TRAIN', local(d, 6, 10, 5), via=[(-13.2200, -72.3500), (-13.1800, -72.4500)], amp=0.2, seg=1, speed=30)
    mp = H('Machu Picchu', -13.16310, -72.54500)
    hop(mp, 'IN_BUS', later(10, 25), via=[(-13.1580, -72.5380)], amp=0.15, seg=0.3, speed=15)
    hop(H('Huayna Picchu', -13.15700, -72.54600), 'WALKING', later(60, 90))
    hop(mp, 'WALKING', later(30, 60))
    hop(aguas, 'IN_BUS', later(60, 120), via=[(-13.1580, -72.5380)], amp=0.15, seg=0.3, speed=15)
    hop(olla, 'IN_TRAIN', later(60, 120), via=[(-13.1800, -72.4500), (-13.2200, -72.3500)], amp=0.2, seg=1, speed=30)
    d += dt.timedelta(days=1)
    hop(cusco, 'IN_PASSENGER_VEHICLE', local(d, 10, 0, 30), via=[(-13.3500, -72.0500), (-13.4500, -72.0000)], speed=40)
    d = city_days(d + dt.timedelta(days=1), 1, cusco, [H('Rainbow Mountain trailhead', -13.86920, -71.30300), H('San Blas', -13.51450, -71.97500)])
    d += dt.timedelta(days=1)
    hop(AIR['CUZ'], 'IN_PASSENGER_VEHICLE', local(d, 9, 0, 15), speed=20)
    fly(AIR['LIM'], later(80, 110))
    fly(AIR['AMS'], layover(AIR['LIM'], R.randint(200, 300)))
    from_schiphol()
    return me.since.date()


def south_africa(day):
    to_schiphol(day, 7, 0)
    fly(AIR['CPT'], at(day, 10, 15, 5))
    hotel = H('guesthouse Gardens', -33.93000, 18.41300)
    hop(hotel, 'IN_PASSENGER_VEHICLE', later(35, 60), via=[(-33.9500, 18.5200)], speed=50)
    d = day + dt.timedelta(days=1)
    for k, plan in enumerate([['V&A Waterfront', 'Bo-Kaap'], ['Table Mountain'], ['Cape Point'], ['Kirstenbosch', 'Camps Bay']]):
        dd = d + dt.timedelta(days=k)
        for name in plan:
            if name == 'Table Mountain':
                low, top = H('Table Mountain cable station', -33.94800, 18.40300), H('Table Mountain top', -33.95750, 18.40300)
                hop(low, 'IN_PASSENGER_VEHICLE', local(dd, 9, 0, 20), speed=25)
                me.go(top, 'IN_CABLECAR', [], later(15, 40))
                hop(H('Maclear\'s Beacon', -33.96400, 18.41500), 'WALKING', later(30, 60))
                hop(top, 'WALKING', later(20, 40))
                me.go(low, 'IN_CABLECAR', [], later(10, 30))
                hop(hotel, 'IN_PASSENGER_VEHICLE', later(5, 20), speed=25)
            elif name == 'Cape Point':
                hop(H('Boulders Beach', -34.19700, 18.45100), 'IN_PASSENGER_VEHICLE', local(dd, 8, 30, 20), via=[(-34.0100, 18.4600), (-34.1000, 18.4700)], speed=50)
                hop(H('Cape Point', -34.35680, 18.49700), 'IN_PASSENGER_VEHICLE', later(70, 110), via=[(-34.2800, 18.4400)], speed=50)
                hop(hotel, 'IN_PASSENGER_VEHICLE', later(90, 150), via=[(-34.2000, 18.3800), (-34.0500, 18.3500)], speed=50)
            else:
                pl = {'V&A Waterfront': (-33.90360, 18.42070), 'Bo-Kaap': (-33.92150, 18.41500), 'Kirstenbosch': (-33.98750, 18.43250), 'Camps Bay': (-33.95100, 18.37700)}[name]
                s = H(name, *pl)
                dk = km(me.place['ll'], s['ll'])
                hop(s, 'WALKING' if dk < 2.5 else 'IN_PASSENGER_VEHICLE', max(local(dd, 10, 0, 40), later(30, 90)))
        if me.place is not hotel:
            hop(hotel, 'WALKING' if km(me.place['ll'], hotel['ll']) < 2.5 else 'IN_PASSENGER_VEHICLE', later(60, 150))
    d += dt.timedelta(days=4)
    stops = [(H('Hermanus', -34.41870, 19.23450), [(-34.0900, 18.8500), (-34.3500, 19.0300)], 1),
             (H('Swellendam', -34.02200, 20.44200), [(-34.3000, 19.6000), (-34.1000, 20.1000)], 1),
             (H('Knysna', -34.03600, 23.04700), [(-34.1830, 22.1460), (-33.9630, 22.4610), (-34.0000, 22.8000)], 2),
             (H('Plettenberg Bay', -34.05300, 23.37200), [(-34.0700, 23.2000)], 1)]
    for place, via, nights in stops:
        hop(place, 'IN_PASSENGER_VEHICLE', max(local(d, 9, 30, 30), later(20, 40)), via=via, speed=80)
        for n in range(nights):
            dd = d + dt.timedelta(days=n)
            s = H('walk ' + place['name'] + str(n), *jitter(place['ll'], 1200))
            hop(s, 'WALKING', max(local(dd, 15, 0, 60), later(30, 60)))
            hop(place, 'WALKING', later(60, 140))
        d += dt.timedelta(days=nights)
    hop(AIR['GRJ'], 'IN_PASSENGER_VEHICLE', local(d, 9, 0, 20), via=[(-34.0400, 23.0500), (-33.9800, 22.6000)], speed=75)
    fly(AIR['CPT'], later(80, 110))
    d += dt.timedelta(days=0)
    fly(AIR['AMS'], later(400, 480))
    from_schiphol()
    return me.since.date()


def japan(day):
    to_schiphol(day, 7, 50)
    fly(AIR['HEL'], at(day, 10, 25, 5))
    fly(AIR['NRT'], layover(AIR['HEL'], R.randint(110, 170)))
    tokyo_st = H('Tokyo Station', 35.68120, 139.76710)
    hotel = H('hotel Shibuya', 35.65800, 139.70160)
    me.go(tokyo_st, 'IN_TRAIN', wiggle([AIR['NRT']['ll'], (35.7600, 140.2000), (35.7300, 140.0000), (35.7000, 139.8500), tokyo_st['ll']], 0.4, 3)[1:-1], later(40, 70))
    hop(hotel, 'IN_SUBWAY', later(5, 15), via=[(35.6710, 139.7400)], amp=0.1, seg=1)
    d = city_days(day + dt.timedelta(days=2), 3, hotel, [H('Sensō-ji', 35.71480, 139.79670), H('Shinjuku Gyoen', 35.68520, 139.71000), H('Meiji Jingu', 35.67640, 139.69930),
                                                          H('Tsukiji Outer Market', 35.66550, 139.77070), H('Akihabara', 35.69840, 139.77310), H('teamLab Planets', 35.64910, 139.78980),
                                                          H('Shibuya Crossing', 35.65950, 139.70050)], far_mode='IN_SUBWAY')
    d += dt.timedelta(days=1)
    kyoto_st = H('Kyoto Station', 34.98580, 135.75880)
    me.go(tokyo_st, 'IN_SUBWAY', [(35.6710, 139.7400)], local(d, 9, 0, 20))
    me.go(kyoto_st, 'IN_TRAIN', wiggle([tokyo_st['ll'], (35.6285, 139.7387), (35.5075, 139.6175), (35.2562, 139.1553), (34.9719, 138.3889), (34.7038, 137.7350),
                                        (35.1709, 136.8815), (35.3150, 136.2900), kyoto_st['ll']], 0.5, 6)[1:-1], later(10, 25), speed=200)
    ky = H('ryokan Gion', 35.00370, 135.77500)
    hop(ky, 'IN_BUS', later(10, 20), speed=16)
    d = city_days(d + dt.timedelta(days=1), 2, ky, [H('Fushimi Inari', 34.96710, 135.77270), H('Kiyomizu-dera', 34.99490, 135.78500), H('Arashiyama', 35.01700, 135.67100),
                                                    H('Kinkaku-ji', 35.03940, 135.72920), H('Nishiki Market', 35.00500, 135.76480)], far_mode='IN_BUS')
    d += dt.timedelta(days=1)
    nara = H('Nara Park', 34.68500, 135.84300)
    me.go(kyoto_st, 'IN_BUS', wiggle([ky['ll'], kyoto_st['ll']], 0.1, 0.5)[1:-1], local(d, 9, 0, 20), speed=16)
    me.go(H('Nara Station', 34.68510, 135.80480), 'IN_TRAIN', wiggle([kyoto_st['ll'], (34.8800, 135.7900), (34.7600, 135.8000)], 0.3, 2)[1:-1], later(5, 15), speed=55)
    hop(nara, 'WALKING', later(5, 15))
    hop(H('Tōdai-ji', 34.68900, 135.83980), 'WALKING', later(60, 100))
    osaka = H('hotel Namba', 34.66600, 135.50100)
    me.go(H('Nara Station', 34.68510, 135.80480), 'WALKING', [(34.6860, 135.8250)], later(60, 120))
    me.go(osaka, 'IN_TRAIN', wiggle([(34.68510, 135.80480), (34.6700, 135.6500), osaka['ll']], 0.3, 2)[1:-1], later(5, 15), speed=55)
    d = city_days(d + dt.timedelta(days=1), 2, osaka, [H('Dōtonbori', 34.66870, 135.50130), H('Osaka Castle', 34.68730, 135.52620), H('Umeda Sky Building', 34.70530, 135.49040),
                                                       H('Kuromon Market', 34.66530, 135.50680), H('Shinsekai', 34.65250, 135.50630)], far_mode='IN_SUBWAY')
    d += dt.timedelta(days=1)
    me.go(AIR['KIX'], 'IN_TRAIN', wiggle([osaka['ll'], (34.6000, 135.4500), (34.5000, 135.3200), AIR['KIX']['ll']], 0.3, 2)[1:-1], local(d, 7, 0, 10), speed=60)
    fly(AIR['AMS'], later(130, 160))
    from_schiphol()
    return me.since.date()


def colombia(day):
    to_schiphol(day, 6, 30)
    fly(AIR['MAD'], at(day, 9, 30, 5))
    fly(AIR['BOG'], layover(AIR['MAD'], R.randint(100, 160)))
    hotel = H('hotel La Candelaria', 4.59810, -74.07600)
    hop(hotel, 'IN_PASSENGER_VEHICLE', later(40, 70), via=[(4.6600, -74.1100), (4.6200, -74.0900)], speed=25)
    d = day + dt.timedelta(days=1)
    for k in range(2):
        dd = d + dt.timedelta(days=k)
        if k == 0:
            low, top = H('Monserrate cable car', 4.60570, -74.05600), H('Monserrate', 4.60580, -74.05630)
            hop(low, 'IN_PASSENGER_VEHICLE', local(dd, 9, 0, 20), speed=18)
            me.go(top, 'IN_CABLECAR', [(4.6060, -74.0580)], later(10, 30), speed=6)
            me.go(low, 'IN_CABLECAR', [(4.6060, -74.0580)], later(60, 100), speed=6)
            hop(H('Museo del Oro', 4.60180, -74.07200), 'IN_PASSENGER_VEHICLE', later(10, 20), speed=18)
            hop(hotel, 'WALKING', later(70, 120))
        else:
            city_days(dd, 1, hotel, [H('Usaquén', 4.69500, -74.03100), H('Zona G', 4.65100, -74.05600), H('Plaza de Bolívar', 4.59810, -74.07610)])
    d += dt.timedelta(days=2)
    hop(AIR['BOG'], 'IN_PASSENGER_VEHICLE', local(d, 8, 0, 15), via=[(4.6200, -74.0900), (4.6600, -74.1100)], speed=25)
    fly(AIR['MDE'], later(75, 100))
    pob = H('hotel El Poblado', 6.20860, -75.56590)
    hop(pob, 'IN_PASSENGER_VEHICLE', later(25, 45), via=[(6.1900, -75.5000)], speed=40)
    d += dt.timedelta(days=1)
    hop(H('Acevedo metro', 6.30000, -75.55850), 'IN_SUBWAY', local(d, 10, 0, 20), via=[(6.2300, -75.5700), (6.2700, -75.5650)], amp=0.05, seg=1)
    me.go(H('Santo Domingo', 6.29300, -75.54100), 'IN_CABLECAR', [(6.2970, -75.5500)], later(5, 15))
    me.go(H('Parque Arví', 6.27900, -75.50300), 'IN_CABLECAR', [(6.2860, -75.5200)], later(30, 60))
    me.go(H('Santo Domingo', 6.29300, -75.54100), 'IN_CABLECAR', [(6.2860, -75.5200)], later(80, 140))
    me.go(H('Acevedo metro', 6.30000, -75.55850), 'IN_CABLECAR', [(6.2970, -75.5500)], later(5, 15))
    hop(H('Plaza Botero', 6.25200, -75.56800), 'IN_SUBWAY', later(5, 10), via=[(6.2700, -75.5650)], amp=0.05, seg=1)
    hop(pob, 'IN_SUBWAY', later(60, 90), via=[(6.2300, -75.5700)], amp=0.05, seg=1)
    d += dt.timedelta(days=1)
    hop(H('Comuna 13', 6.25600, -75.60900), 'IN_PASSENGER_VEHICLE', local(d, 10, 0, 20), speed=22)
    hop(pob, 'IN_PASSENGER_VEHICLE', later(120, 180), speed=22)
    d += dt.timedelta(days=1)
    hop(H('El Peñol', 6.22050, -75.17800), 'IN_PASSENGER_VEHICLE', local(d, 8, 30, 20), via=[(6.1900, -75.5000), (6.1500, -75.3800), (6.2100, -75.2500)], speed=45)
    hop(H('Guatapé', 6.23400, -75.15800), 'IN_PASSENGER_VEHICLE', later(90, 140), speed=25)
    hop(pob, 'IN_PASSENGER_VEHICLE', later(120, 180), via=[(6.2100, -75.2500), (6.1500, -75.3800), (6.1900, -75.5000)], speed=45)
    d += dt.timedelta(days=1)
    hop(AIR['MDE'], 'IN_PASSENGER_VEHICLE', local(d, 9, 0, 15), via=[(6.1900, -75.5000)], speed=40)
    fly(AIR['CTG'], later(70, 100))
    ctg = H('hotel Ciudad Amurallada', 10.42360, -75.55030)
    hop(ctg, 'IN_PASSENGER_VEHICLE', later(20, 35), speed=22)
    d = city_days(d + dt.timedelta(days=1), 2, ctg, [H('Getsemaní', 10.42100, -75.54700), H('Castillo San Felipe', 10.42270, -75.53930), H('Bocagrande', 10.39900, -75.55500),
                                                     H('Plaza Santo Domingo', 10.42550, -75.55190), H('Las Bóvedas', 10.42920, -75.54730)])
    d += dt.timedelta(days=1)
    pier = H('Muelle La Bodeguita', 10.42110, -75.54960)
    hop(pier, 'WALKING', local(d, 8, 0, 10))
    isla = H('Islas del Rosario', 10.17000, -75.75000)
    hop(isla, 'IN_FERRY', later(20, 40), via=[(10.3900, -75.5700), (10.2600, -75.6600)], speed=30)
    hop(H('Playa Blanca', 10.23000, -75.61500), 'IN_FERRY', later(150, 210), speed=30)
    hop(pier, 'IN_FERRY', later(120, 180), via=[(10.3200, -75.5900)], speed=30)
    hop(ctg, 'WALKING', later(5, 15))
    d += dt.timedelta(days=1)
    city_days(d, 1, ctg, [H('Getsemaní', 10.42100, -75.54700), H('Café del Mar', 10.42700, -75.55300)])
    d += dt.timedelta(days=1)
    hop(AIR['CTG'], 'IN_PASSENGER_VEHICLE', local(d, 12, 0, 15), speed=22)
    fly(AIR['MAD'], later(130, 160))
    fly(AIR['AMS'], layover(AIR['MAD'], R.randint(90, 150)))
    from_schiphol()
    return me.since.date()


def tanzania(day):
    to_schiphol(day, 7, 30)
    fly(AIR['DOH'], at(day, 10, 30, 5))
    fly(AIR['JRO'], layover(AIR['DOH'], R.randint(160, 230)))
    arusha = H('lodge Arusha', -3.38690, 36.68300)
    hop(arusha, 'IN_PASSENGER_VEHICLE', later(40, 70), via=[(-3.4000, 36.9000)], speed=45)
    d = day + dt.timedelta(days=2)
    tar = H('camp Tarangire', -3.83300, 36.00000)
    hop(tar, 'IN_PASSENGER_VEHICLE', local(d, 7, 30, 20), via=[(-3.3700, 36.5000), (-3.5500, 36.1000), (-3.8000, 36.0300)], speed=50)

    def game_drive(base, center, rad, dd):
        pts = [center]
        for _ in range(R.randint(3, 5)):
            pts.append(jitter(center, rad))
        spot = H('game drive ' + base['name'] + str(dd), *pts[-1])
        hop(spot, 'IN_PASSENGER_VEHICLE', max(local(dd, 6, 30, 20), later(30, 60)), via=pts[:-1], amp=0.6, seg=1.5, speed=22)
        hop(base, 'IN_PASSENGER_VEHICLE', later(60, 120), via=[jitter(center, rad)], amp=0.6, seg=1.5, speed=22)

    game_drive(tar, (-3.9000, 36.0100), 9000, d)
    d += dt.timedelta(days=1)
    ngor = H('lodge Karatu', -3.34000, 35.67000)
    hop(ngor, 'IN_PASSENGER_VEHICLE', local(d, 8, 0, 20), via=[(-3.8000, 36.0300), (-3.5500, 36.1000), (-3.3540, 35.8590)], speed=45)
    d += dt.timedelta(days=1)
    floor = H('Ngorongoro Crater floor', -3.17000, 35.58000)
    hop(floor, 'IN_PASSENGER_VEHICLE', local(d, 6, 30, 15), via=[(-3.2400, 35.6200), (-3.2000, 35.5300)], speed=25)
    hop(H('Lake Magadi Ngorongoro', -3.18000, 35.53000), 'IN_PASSENGER_VEHICLE', later(90, 150), via=[(-3.1300, 35.6100)], amp=0.5, seg=1.5, speed=18)
    hop(ngor, 'IN_PASSENGER_VEHICLE', later(90, 150), via=[(-3.2400, 35.6200)], speed=25)
    d += dt.timedelta(days=1)
    ser = H('camp Seronera', -2.45000, 34.82000)
    hop(ser, 'IN_PASSENGER_VEHICLE', local(d, 7, 30, 15), via=[(-3.2400, 35.6200), (-3.0000, 35.3500), (-2.7000, 35.0500)], speed=40)
    for k in range(1, 3):
        game_drive(ser, (-2.4200, 34.8800), 14000, d + dt.timedelta(days=k))
    d += dt.timedelta(days=3)
    hop(AIR['SEU'], 'IN_PASSENGER_VEHICLE', local(d, 9, 0, 15), speed=25)
    fly(AIR['ZNZ'], later(40, 70))
    stone = H('hotel Stone Town', -6.16220, 39.18800)
    hop(stone, 'IN_PASSENGER_VEHICLE', later(20, 35), speed=25)
    d = city_days(d + dt.timedelta(days=1), 1, stone, [H('Forodhani Gardens', -6.16000, 39.18800), H('Darajani Market', -6.16200, 39.19600), H('House of Wonders', -6.16080, 39.18910)])
    d += dt.timedelta(days=1)
    nungwi = H('beach hotel Nungwi', -5.72700, 39.29700)
    hop(nungwi, 'IN_PASSENGER_VEHICLE', local(d, 10, 0, 20), via=[(-5.9500, 39.2600)], speed=40)
    for k in range(1, 4):
        dd = d + dt.timedelta(days=k)
        if k == 2:
            hop(H('Mnemba Atoll', -5.82000, 39.38000), 'IN_FERRY', local(dd, 8, 30, 15), via=[(-5.7600, 39.3300)], speed=20)
            hop(nungwi, 'IN_FERRY', later(150, 220), via=[(-5.7600, 39.3300)], speed=20)
        else:
            hop(H('Kendwa beach', -5.75400, 39.29000), 'WALKING', local(dd, 16, 0, 40))
            hop(nungwi, 'WALKING', later(60, 150))
    d += dt.timedelta(days=4)
    hop(AIR['ZNZ'], 'IN_PASSENGER_VEHICLE', local(d, 13, 0, 15), via=[(-5.9500, 39.2600)], speed=40)
    fly(AIR['DOH'], later(130, 160))
    fly(AIR['AMS'], layover(AIR['DOH'], R.randint(120, 180)))
    from_schiphol()
    return me.since.date()


HOLIDAYS = [(dt.date(2024, 2, 2), vietnam), (dt.date(2024, 8, 9), peru), (dt.date(2025, 1, 31), south_africa),
            (dt.date(2025, 7, 4), japan), (dt.date(2026, 1, 23), colombia), (dt.date(2026, 6, 19), tanzania)]
TRAIN_CITIES = ['Utrecht', 'Haarlem', 'Rotterdam', 'Den Haag', 'Leiden']
DAYS_OFF = {(12, 25), (12, 26), (1, 1), (4, 27), (5, 5)}


def main():
    global me
    me = Person(HOME, 'CET', local_to_utc(START, 0, 0, 'CET') - dt.timedelta(hours=6))
    hol = dict(HOLIDAYS)
    road = {r[0]: r for r in ROADTRIPS}
    day = START
    next_train = START + dt.timedelta(days=R.randint(10, 25))
    while day <= END:
        if day in hol:
            day = hol[day](day) + dt.timedelta(days=1)
            continue
        if day in road:
            _, name, out, base, nights, outings = road[day]
            day = road_trip(day, name, out, base, nights, outings) + dt.timedelta(days=1)
            continue
        wd = day.weekday()
        if wd >= 5 and day >= next_train:
            train_day(day, R.choice(TRAIN_CITIES))
            next_train = day + dt.timedelta(days=R.randint(21, 42))
        elif wd >= 5 or (day.month, day.day) in DAYS_OFF or (day.month == 12 and day.day > 26) or (day.month == 8 and R.random() < 0.3):
            weekend_day(day)
        elif wd == 4 or (wd == 2 and R.random() < 0.5) or R.random() < 0.05:
            home_day(day)
        else:
            office_day(day)
        day += dt.timedelta(days=1)
    me.stay(local_to_utc(END, 23, 30, 'CET'))
    SEGS.sort(key=lambda s: (s['startTime'][:0], parse(s['startTime']), 0 if 'visit' in s or 'activity' in s else 1))
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'semanticSegments': SEGS}, f, ensure_ascii=False, separators=(',', ':'))
    n_trips = sum(1 for s in SEGS if 'activity' in s)
    print('Wrote %s: %d trips, %d stays, %d KB' % (os.path.relpath(OUT), n_trips, sum(1 for s in SEGS if 'visit' in s), os.path.getsize(OUT) // 1024))


def parse(s):
    return dt.datetime.fromisoformat(s)


if __name__ == '__main__':
    main()
