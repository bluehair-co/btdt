#!/usr/bin/env python3
"""Build the station packs listed in countries.json into a folder, with index.json listing them.

  python3 build_all.py out [NL BE ...]

With country codes (or the COUNTRIES environment variable, space or comma separated), only those are
built and the other packs already in out/ are kept. Each country's OpenStreetMap extract comes from
Geofabrik, is cut down to railways with osmium-tool, and is deleted once its pack is written.
Needs osmium-tool (apt install osmium-tool) and pyosmium (pip install osmium).
"""
import datetime
import json
import os
import subprocess
import sys

import build_pack

HERE = os.path.dirname(os.path.abspath(__file__))
FILTER = ['w/railway=rail,narrow_gauge,tram,subway,light_rail', 'nwa/railway=station,halt,tram_stop']


def run(*cmd):
    print('+', ' '.join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def fetch(c, dest):
    # Geofabrik first, then the openstreetmap.fr extracts (the same data, names with underscores).
    urls = ['https://download.geofabrik.de/%s-latest.osm.pbf' % c['extract'],
            'https://download.openstreetmap.fr/extracts/%s-latest.osm.pbf' % c.get('mirror', c['extract'].replace('-', '_'))]
    for u in urls:
        try:
            run('curl', '-fsSL', '--retry', '4', '--retry-delay', '15', '--retry-all-errors', '-o', dest, u)
            return
        except subprocess.CalledProcessError:
            continue
    raise RuntimeError('no extract could be downloaded')


def main():
    out = sys.argv[1]
    want = [c.strip().upper() for c in (sys.argv[2:] or os.environ.get('COUNTRIES', '').replace(',', ' ').split()) if c.strip()]
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(HERE, 'countries.json'), encoding='utf-8') as f:
        countries = json.load(f)['countries']
    idx_path = os.path.join(out, 'index.json')
    index = {'v': 1, 'packs': {}}
    if os.path.exists(idx_path):
        with open(idx_path, encoding='utf-8') as f:
            index = json.load(f)
    # A country taken off the list loses its pack.
    listed = {c['cc'] for c in countries}
    for cc in list(index['packs']):
        if cc not in listed:
            index['packs'].pop(cc)
            if os.path.exists(os.path.join(out, cc + '.json.gz')):
                os.remove(os.path.join(out, cc + '.json.gz'))
    failed = []
    for c in countries:
        cc = c['cc']
        if want and cc not in want:
            continue
        pbf, rail = '/tmp/%s.osm.pbf' % cc, '/tmp/%s-rail.osm.pbf' % cc
        try:
            fetch(c, pbf)
            run('osmium', 'tags-filter', pbf, *FILTER, '-o', rail, '--overwrite')
            os.remove(pbf)
            pack, info = build_pack.build(rail, cc, c['name'])
            dest = os.path.join(out, cc + '.json.gz')
            build_pack.write(pack, dest)
            info.update({'name': c['name'], 'bytes': os.path.getsize(dest), 'built': pack['built']})
            index['packs'][cc] = info
            print(cc, info, flush=True)
        except Exception as e:  # one country failing leaves the others (and its last pack) in place
            print('FAILED', cc, e, flush=True)
            failed.append(cc)
        for p in (pbf, rail):
            if os.path.exists(p):
                os.remove(p)
    index['updated'] = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    index['attribution'] = '© OpenStreetMap contributors, ODbL 1.0'
    with open(idx_path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1, sort_keys=True)
    if failed:
        print('Failed:', ' '.join(failed))
        if len(failed) == len([c for c in countries if not want or c['cc'] in want]):
            sys.exit(1)


if __name__ == '__main__':
    main()
