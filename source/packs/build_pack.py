#!/usr/bin/env python3
"""Build one station pack: a country's railway stations, tram and metro stops, and its railway,
tram and metro lines, simplified, as one small gzipped JSON file BT•DT downloads on request.

  python3 build_pack.py rail.osm.pbf NL "Netherlands" out/NL.json.gz

The input is an OpenStreetMap extract, best cut down first with osmium-tool (see build_all.py):
  osmium tags-filter country.osm.pbf w/railway=rail,narrow_gauge,tram,subway,light_rail \
      nwa/railway=station,halt,tram_stop -o rail.osm.pbf

The pack (format v1):
  { "v": 1, "cc": "NL", "name": "Netherlands", "built": "2026-11-19", "data": "2026-11-18T20:21:00Z",
    "attribution": "© OpenStreetMap contributors", "license": "ODbL 1.0",
    "stations": [dlat, dlng, kinds, "name", ...],   flat, 4 values per station
    "nodes": [dlat, dlng, ...],                      flat, 2 values per node
    "lines": [[kind, dnode, dnode, ...], ...] }
Coordinates are in 1e-5 degrees (about a metre), each a difference from the one before it, and the
node numbers in a line are differences from the number before them too. kind and kinds are bits:
1 railway, 2 tram, 4 metro, 8 light rail. Lines that share a junction share its node, so the lines
can be followed from one to another (BT•DT draws a routine's line along them).
"""
import datetime
import gzip
import json
import math
import sys

import osmium

LINE_KIND = {'rail': 1, 'narrow_gauge': 1, 'tram': 2, 'subway': 4, 'light_rail': 8}
STATION_KIND = {'subway': 4, 'light_rail': 8, 'tram': 2}
# Tracks for trains to stand or turn on (sidings, yards, spurs), and lines no passenger rides, are
# left out. Crossovers stay: at many stations they are the only way from one line onto another.
SKIP_USAGE = {'industrial', 'military', 'test', 'tourism', 'freight'}
TOLERANCE_M = 12      # how far a simplified line may be from the real one
SAME_STOP_KM = 0.3    # stops of one name and kind closer than this are one (one per platform in OSM)


def e5(v):
    return int(round(v * 1e5))


class Reader(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = []        # (kind, [(id, lat, lng), ...])
        self.stations = []    # (lat, lng, kinds, name)

    def station_kind(self, tags):
        rw = tags.get('railway')
        if rw == 'tram_stop':
            return 2
        if rw in ('station', 'halt'):
            st = tags.get('station')
            if st in STATION_KIND:
                return STATION_KIND[st]
            if tags.get('subway') == 'yes':
                return 4
            if tags.get('light_rail') == 'yes':
                return 8
            return 1
        return 0

    def node(self, n):
        k = self.station_kind(n.tags)
        if k and n.location.valid():
            self.stations.append((n.location.lat, n.location.lon, k, n.tags.get('name', '')))

    def area_station(self, w, k):
        pts = [(nd.location.lat, nd.location.lon) for nd in w.nodes if nd.location.valid()]
        if pts:
            self.stations.append((sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts), k, w.tags.get('name', '')))

    def way(self, w):
        t = w.tags
        k = self.station_kind(t)
        if k:
            self.area_station(w, k)
            return
        kind = LINE_KIND.get(t.get('railway'))
        if not kind or t.get('service') not in (None, 'crossover') or t.get('usage') in SKIP_USAGE or t.get('passenger') == 'no':
            return
        pts = [(nd.ref, nd.location.lat, nd.location.lon) for nd in w.nodes if nd.location.valid()]
        if len(pts) >= 2:
            self.ways.append((kind, pts))


def simplify(pts, tol_m):
    """Douglas-Peucker on [(lat, lng), ...], keeping both ends."""
    if len(pts) < 3:
        return list(range(len(pts)))
    c = math.cos(math.radians(pts[0][0]))
    xy = [(p[1] * 111320 * c, p[0] * 110570) for p in pts]
    keep = {0, len(pts) - 1}
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = xy[a]
        bx, by = xy[b]
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        worst, wi = -1, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            if L == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                u = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
                d = math.hypot(px - ax - u * dx, py - ay - u * dy)
            if d > worst:
                worst, wi = d, i
        if worst > tol_m:
            keep.add(wi)
            stack.append((a, wi))
            stack.append((wi, b))
    return sorted(keep)


def km(a, b):
    r = math.pi / 180
    h = math.sin((b[0] - a[0]) * r / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin((b[1] - a[1]) * r / 2) ** 2
    return 2 * 6371.0088 * math.asin(min(1, math.sqrt(h)))


def merge_stations(stations):
    """One stop per name and kind within SAME_STOP_KM (OSM often has one per platform), at their middle.
    A station that is also a metro or tram stop keeps both kinds."""
    out = []
    grid = {}
    for lat, lng, k, name in stations:
        key = (round(lat * 100), round(lng * 100))
        hit = None
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for s in grid.get((key[0] + dy, key[1] + dx), []):
                    if s['name'] == name and (s['k'] & k or not name) and km((s['lat'], s['lng']), (lat, lng)) <= SAME_STOP_KM:
                        hit = s
        if hit:
            n = hit['n'] + 1
            hit['lat'] += (lat - hit['lat']) / n
            hit['lng'] += (lng - hit['lng']) / n
            hit['n'] = n
            hit['k'] |= k
            continue
        s = {'lat': lat, 'lng': lng, 'k': k, 'name': name, 'n': 1}
        out.append(s)
        grid.setdefault(key, []).append(s)
    # A named train station and a metro stop of the same name at the same spot: one entry, both kinds.
    return out


def graph(ways, tol_m):
    """Nodes and lines from [(kind, [(osm node id, lat, lng), ...]), ...]: each way cut at every node
    another way uses (so junctions stay joined) and simplified to tol_m. Returns nodes, lines, km."""
    uses = {}
    for kind, pts in ways:
        for j, (nid, _, _) in enumerate(pts):
            uses[nid] = uses.get(nid, 0) + (2 if j in (0, len(pts) - 1) else 1)
    nodes = []          # (lat, lng)
    index = {}          # OSM node id -> node number, for nodes lines share
    lines = []
    total_km = 0.0

    def node_no(nid, lat, lng):
        if nid in index:
            return index[nid]
        index[nid] = len(nodes)
        nodes.append((lat, lng))
        return index[nid]

    for kind, pts in ways:
        cuts = [0] + [j for j in range(1, len(pts) - 1) if uses.get(pts[j][0], 0) > 1] + [len(pts) - 1]
        for a, b in zip(cuts, cuts[1:]):
            seg = pts[a:b + 1]
            keep = simplify([(p[1], p[2]) for p in seg], tol_m)
            line = [kind]
            for q, j in enumerate(keep):
                nid, lat, lng = seg[j]
                if q in (0, len(keep) - 1):
                    line.append(node_no(nid, lat, lng))
                else:
                    line.append(len(nodes))
                    nodes.append((lat, lng))
            for q in range(2, len(line)):
                total_km += km(nodes[line[q - 1]], nodes[line[q]])
            lines.append(line)
    return nodes, lines, total_km


def encode(nodes, lines):
    flat_nodes, pl, pg = [], 0, 0
    for lat, lng in nodes:
        la, lo = e5(lat), e5(lng)
        flat_nodes += [la - pl, lo - pg]
        pl, pg = la, lo
    out_lines = []
    for line in lines:
        prev, enc = 0, [line[0]]
        for v in line[1:]:
            enc.append(v - prev)
            prev = v
        out_lines.append(enc)
    return flat_nodes, out_lines


def build(path, cc, name):
    r = Reader()
    r.apply_file(path, locations=True)
    nodes, lines, total_km = graph(r.ways, TOLERANCE_M)
    stations = merge_stations(r.stations)
    stations.sort(key=lambda s: (s['lat'], s['lng']))
    flat_st, pl, pg = [], 0, 0
    for s in stations:
        la, lo = e5(s['lat']), e5(s['lng'])
        flat_st += [la - pl, lo - pg, s['k'], s['name']]
        pl, pg = la, lo
    flat_nodes, out_lines = encode(nodes, lines)
    pack = {
        'v': 1, 'cc': cc, 'name': name, 'built': datetime.date.today().isoformat(),
        'attribution': '© OpenStreetMap contributors', 'license': 'ODbL 1.0',
        'stations': flat_st, 'nodes': flat_nodes, 'lines': out_lines,
    }
    info = {'stations': len(stations), 'km': round(total_km), 'lines': len(lines), 'nodes': len(nodes)}
    return pack, info


# ---------- road packs ----------
# A country's main roads, for drawing car trips along them (Snap cars to roads in the app), in a
# file of their own (roads/NL.json.gz) so nobody downloads them without asking. Same graph format
# as a station pack's lines; kind bits: 1 motorway, 2 trunk, 4 primary (each with its links).
# Simplified to ROAD_TOLERANCE_M; no names, no one-way, no lanes.
ROAD_KIND = {'motorway': 1, 'motorway_link': 1, 'trunk': 2, 'trunk_link': 2, 'primary': 4, 'primary_link': 4}
ROAD_TOLERANCE_M = 15


class RoadReader(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = []

    def way(self, w):
        kind = ROAD_KIND.get(w.tags.get('highway'))
        if not kind or w.tags.get('access') in ('no', 'private') or w.tags.get('area') == 'yes':
            return
        pts = [(nd.ref, nd.location.lat, nd.location.lon) for nd in w.nodes if nd.location.valid()]
        if len(pts) >= 2:
            self.ways.append((kind, pts))


def build_roads(path, cc, name, country=None):
    r = RoadReader()
    r.apply_file(path, locations=True)
    nodes, lines, total_km = graph(r.ways, ROAD_TOLERANCE_M)
    flat_nodes, out_lines = encode(nodes, lines)
    pack = {
        'v': 1, 'cc': cc, 'name': name, 'kind': 'roads', 'built': datetime.date.today().isoformat(),
        'attribution': '© OpenStreetMap contributors', 'license': 'ODbL 1.0',
        'nodes': flat_nodes, 'lines': out_lines,
    }
    if country:
        pack['country'] = country
    by = {}
    for line in lines:
        by[line[0]] = by.get(line[0], 0) + 1
    info = {'km': round(total_km), 'lines': len(lines), 'nodes': len(nodes), 'name': name}
    if nodes:
        lats, lngs = [n[0] for n in nodes], [n[1] for n in nodes]
        info['bbox'] = [round(min(lats), 3), round(min(lngs), 3), round(max(lats), 3), round(max(lngs), 3)]
    if country:
        info['cc'] = country
    return pack, info


def write(pack, out):
    data = json.dumps(pack, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    with gzip.open(out, 'wb', compresslevel=9) as f:
        f.write(data)


if __name__ == '__main__':
    if len(sys.argv) != 5:
        raise SystemExit(__doc__)
    pack, info = build(sys.argv[1], sys.argv[2], sys.argv[3])
    write(pack, sys.argv[4])
    print(sys.argv[2], info)
