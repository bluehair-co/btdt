# CLAUDE.md: working on BT•DT

BT•DT (Been There · Done That) is a browser app (installable PWA) that reads location history files on the user's device and shows them as a map, heatmap, insights and a timeline. There is no server and no build toolchain beyond one Python script. The owner (David, GitHub `bluehair-co`) does not write code: Claude builds, tests and ships every change, and David reviews the result in the live app.

- Live app: https://bluehair-co.github.io/btdt/ (GitHub Pages, `main` branch, repository root)
- Repository: `bluehair-co/btdt` (it was called `timeliner` before; GitHub redirects the old name)
- User-facing overview: `README.md`. How the data is read and cleaned, in depth: `source/README.md`. MyRules format: `docs/myrules.md`.
- Design and UX rules: `docs/design-rules.md`. Read it before any UI change.
- How the project got here: `docs/history.md`.
- Rollback point: the `v1.0` branch holds the app as it was before the UX overhaul of 20–21 Nov 2026 (PRs #222–#225). To roll back, restore `main`'s published files from that branch in a PR; only do this when David asks.
- Where things live in the UI (Filters, *Menu*, map sheet, *Map tools*, trip and place pages): the *One home per job* section and the patterns table in `docs/design-rules.md`. Put new features where that table says.

## Standing rules from David

1. **Merge your own PRs.** Once a PR is ready and tested, merge it into `main` yourself without asking. (Exception: when David says "don't merge yet" or "show me a mockup first" for a piece of work, wait for his go.)
2. **Credits.** Any new feature that uses a technology, library, data source or asset that needs attribution gets a line in *About → Credits & license* (`source/src/app.html`, `<ul class="about-credits">`) **in the same PR**, and in the third-party list at the end of `README.md`.
3. **Long explanations go behind an (i) button**, never as running text in a card, panel, section or dialog. Use `infoHead`, `infoBtn`/`infoBox` and `infoMore` from `core.js`. See `docs/design-rules.md`.
4. **Every action that saves or works shows the "Working on it…" pill, at once.** A tap that saves (a button like *Cycling is right*, a dialog's *Save* or *Delete*, *Keep as one trip*, a switch) must never look like nothing happened while the trips are worked out again. Use `saving(fn)` (pill reads "Saving…") or `working(text, fn)` from `core.js`; `mrAsk` dialogs do it for their primary and danger buttons. Downloads show a progress bar; exports and imports show the loader.
5. **Mockups first when asked.** For layout or visual changes David often asks for a mockup; then build only after he picks one.
6. **Keep the app generic.** Nothing about one person is built in. Personal facts (gear, home, commutes, places Google moved) belong in the user's MyRules file, never in code. Never commit David's own location data, MyRules file or emails.
7. **Privacy.** Files are read on the device and never uploaded. Anything the app fetches (tiles, packs, OpenStreetMap lookups) must be on request, send the minimum, and be described in About → *How it works*.
8. **Local settings everywhere.** Every date, time and unit label the user sees follows *Menu › Preferences* (which defaults to the device's region): distances, speeds and per-distance figures in km or miles, short distances in m or ft, date order, 12/24-hour time. That covers form fields and their labels, info texts, notes and examples, not just results. Never write `km`, `m`, `km/h` or a date format into UI text: use `dist()`, `distShort()`, `speed()`, `distUnit()`, `distField()`/`distSave()` for inputs (stored values stay in km), `data-dist-km` for distances in `app.html`, and the date/time helpers in `core.js`. Test new UI in both kilometres and miles.

## Layout of the repository

```
index.html, sw.js, manifest.webmanifest, icons, *.webp, demo.json,  <- the published app (built output, committed)
demo-activities.zip, og-image.jpg, robots.txt, sitemap.xml, schema/
source/
  build.py            assembles source/dist/ from src/ + static/ + place-data.html
  src/                the app source (see below)
  static/             files copied as-is into dist/ (sw.js, manifest, icons, demo data, schema/)
  place-data.html     airports, time zones, country borders, towns (inlined into index.html)
  packs/              station/road pack builder (build_pack.py, build_all.py, countries.json)
  demo/               demo data generators (make_demo.py, make_activities.py, halfbike routes)
  icons/, landing/    source art and scripts for app icons and the landing picture layers
  README.md           data handling in depth (read the relevant section before touching the parser)
docs/                 myrules.md (format spec), myrules-example.json, screenshots/, design-rules.md, history.md
.github/workflows/station-packs.yml   builds station and road packs into the `packs` branch
```

### Source files (`source/src/`)

Everything is plain ES5-style JavaScript with globals, concatenated by `build.py` into one IIFE inside `index.html` in this order: `core.js, data.js, map.js, insights.js, timeline.js, rules.js, moved.js, packs.js, snaps.js, roads.js, split.js, select.js, ignore.js, settings.js`. `parser.js` goes in its own `<script id="parser">` so it can also run in a Web Worker. Libraries: Leaflet 1.9.4 and D3 7.9.0 from cdnjs.

| File | What it holds |
|---|---|
| `app.html` | All markup: landing, About and *How to get your files* modals, tabs, filters, settings, sheets, loader, the Working pill. |
| `app.css` | All styles. Colour tokens are CSS variables (`--m-road`, `--m-transit`, `--accent`…), light and dark themes. |
| `parser.js` | Reads every input format (Timeline.json on-device and iPhone, Takeout Records.json and Semantic Location History, Dawarich, Strava ZIP, GPX/KML/KMZ/GeoJSON/TCX/FIT) into flat typed arrays, then cleans them: GPS jumps (`cleanJumps`), stale ends (`cleanEnds`), stops, stays, cell-tower/Wi-Fi fixes (`netFixes`), places Google moved (`movedPlaces`), transport guessing (`guessMode`, `TripIndex` voting, speed profiles, corridors, stations), merged-trip splitting (`splitPlan`). |
| `core.js` | Basics: `$`, dates, units, preferences (`PREFS`, saved in localStorage `btdt.prefs`), icons, the (i) helpers (`infoHead`, `infoBtn`, `infoBox`, `infoMore`), country lookup, the loader (`busy()`), the Working pill (`working()`). |
| `data.js` | State (`D` trips/stays with Strava laid over, `RAW` as loaded, `M` facts, `F` filters, `sel`), loading and saving (IndexedDB), filters, imports, export (JSON/CSV), trip details. |
| `map.js` | Leaflet map, paths, heatmap, speed and heart-rate paths, explorer squares, countries, regular-place pins, playback (sun/night, speed pill), beacons, zoom to all, one-finger zoom. |
| `insights.js` | Insights cards: summary, how you travel, weekly rhythm, over time, top routes/places, records, countries over time, CO₂, scores (Magellan/Marco Polo, Armstrong, Musk, Voyager, Merckx), heart rate, gear. |
| `timeline.js` | The virtualised trip list and its search (`tlMatch`). |
| `rules.js` | **MyRules**: loading/saving the rules document (`MR`), applying gear periods, places, routines (type, gear, line snapping, both-ways, radius per end), corrections (type, title, gear, hide, Unclassified, ignored GPS points, bulk edits), `unless` exceptions, the rules sheet with tabs, *Group with similar trips*, *Clean up rules*. |
| `moved.js` | Places Google moved: MyRules `moves`, *This place moved…*, *Use Google's location*. |
| `packs.js` | Station packs: download, IndexedDB `btdt-packs`, station lookup, routing network across installed packs, *Snap train trips to the tracks*. |
| `snaps.js` | Map snaps (two stations, one line, saved in MyRules `snaps`). |
| `roads.js` | Road packs and *Snap car trips to roads* (IndexedDB `btdt-roads`). |
| `split.js` | Trips Timeline merged: automatic/suggested splits, *Keep as one trip*, *Split trip* by hand. |
| `select.js` | *Select trips* on the map (lasso/rectangle, touch too) and bulk *Change type…*. |
| `ignore.js` | *Ignore GPS points* of one trip. |
| `settings.js` | The *Menu* (the three-line button) and its pages: *Your data*, *Trip cleanup* (merged trips, cell-tower fixes, packs, snapping) and *Preferences* (units, theme, date/time format, CO₂ factors, heart rate). |

## Data formats

- **Inputs:** see `source/README.md` (one section per format, with the cleaning steps). Old Takeout and new on-device Timeline files can be loaded together; Records.json fills gaps under Timeline. A Timeline-format file with `"simulated": true` at the top holds trips rebuilt from bookings and wins where it clashes with the export.
- **Internal:** parsed trips and stays are column arrays (`start`, `end`, `mode`, `km`, `from`, `to`, `pathOff` + flat points, `off` = UTC offset in minutes, `vs/ve/vll` for stays, flags as bits such as `GUESSED`, `FIXED`, `JUMPS`). Saved in IndexedDB, never uploaded.
- **MyRules (`*.myrules.json`, v0.2):** sections `places`, `moves`, `gear`, `routines`, `snaps`, `corrections`. Every rule has `id`, optional `name`, `when` (from/to/days/times), `enabled`, `except` (trip refs), `unless` (conditions), `note`. Trips are referenced by local start time with UTC offset and mode, never by index. Spec: `docs/myrules.md`; JSON Schema: `schema/myrules-0.2.json` (keep `source/static/schema/` in sync). Rules apply fully or not at all: a routine sets type, line and gear together. Values a rule fills in are tagged *Rule applied* (or *Map snap*), user fixes *Edited*, and both can be undone per trip or per rule. Unknown keys round-trip on export.
- **Export:** *Export trips* in *Menu › Your data* writes the filtered trips as JSON (same shape as a trip's *{ } Raw data*, with GPS points) or CSV.

## Station and road packs

- Built from OpenStreetMap (Geofabrik extracts, cut down with osmium-tool, read with pyosmium) by `.github/workflows/station-packs.yml`: every three months (cron), on `workflow_dispatch` (optionally with country codes like `NL BE`), and on pushes to `main` touching `source/packs/**`.
- Output goes to the orphan `packs` branch (one commit, force-pushed each time): `index.json`, `<CC>.json.gz` station packs, `roads/<CC>.json.gz` road packs (US states and Canadian provinces as `roads/US-CA.json.gz` etc.).
- The app downloads from `https://raw.githubusercontent.com/bluehair-co/btdt/packs/` (`PACK_BASE` in `packs.js`) only when the user picks a country, with a progress bar, and keeps packs in IndexedDB.
- Format (v1): coordinates in 1e-5 degrees, delta-encoded; `stations` flat `[dlat, dlng, kinds, name, …]`; `nodes` flat; `lines` `[[kind, dnode, …], …]`; kind bits 1 rail, 2 tram, 4 metro, 8 light rail. Details in `source/packs/build_pack.py`.
- To offer a new country: add it to `source/packs/countries.json` (big countries can be built from `parts`, with `"roads": "parts"` or `"roads": true`) and push; the workflow builds it.

## Build and deploy

1. Edit files in `source/src/` (or `source/static/`).
2. Bump `VERSION` in `source/static/sw.js` (`btdt-vNNN`) whenever a deployed file changes, so installed copies update.
3. `python3 source/build.py` writes `source/dist/` (gitignored).
4. Copy the built files to the repository root: `cp -r source/dist/* .` (at least `index.html` and `sw.js`, plus whatever changed in `static/`).
5. Update docs in the same PR: `README.md` for user-visible features, `source/README.md` for data handling, `docs/myrules.md` + schema for MyRules changes, About → *How it works* if something new is fetched.
6. Branch, commit, open a PR against `main`, test (below), merge. GitHub Pages publishes `main` within a minute or two.

There is no `package.json` and no bundler. Don't add one.

## Testing and screenshots

There is no unit-test suite; each change is tested by running the built `index.html` headless with Playwright (preinstalled in Claude's cloud container; `require('playwright')`, `chromium.launch()`).

- Open `source/dist/index.html` via `file://` or a local `python3 -m http.server`. The cloud container may block cdnjs: install `leaflet@1.9.4` and `d3@7.9.0` with npm in a scratch folder and serve them with `context.route` (pattern: requests ending in `leaflet.min.js`, `leaflet.min.css`, `d3.min.js` are fulfilled from `node_modules`, every other external request aborted).
- Load data with `page.setInputFiles('#fileIn', file)`, or open the demo (*Try the demo*: `demo.json` + `demo-activities.zip`). Never put real personal data in the repo; build small synthetic Timeline.json fixtures for edge cases.
- Check both a **desktop** viewport (about 1280×800 or 1440×900) and a **phone** viewport (about 390×844), light and dark, and watch for `pageerror`.
- For parser and cleaning changes, compare fingerprints (type, distance, flags, points per trip) of every trip between the old and new build on a large test timeline, and report the differences in the PR.
- Save screenshots David should see into the project's shared files folder under a folder named for the feature (for example `/mnt/project-files/<feature>/desk-*.png`, `phone-*.png`) and attach them in the thread. Use `deviceScaleFactor: 2` for screenshots David will look at.
- Write a short *Tested* section in each PR saying what was checked.

## PR conventions

- Branch from `main`; one feature or fix per PR.
- Title in plain words describing what the user gets, for example `Snap car trips to roads: a spinner in the pill while loading (#208)`.
- Body: what changed and why, a *Tested* section, and the SW version (`SW v152`).
- Squash-merge once tested (recent PRs land as one commit titled `… (#NNN)`), then tell David in the thread that it's live and whether he needs to reload or re-import.

## Writing style (UI text and replies)

Plain, friendly English in full sentences. Name things the way the UI names them (*Trip info*, *Group with similar trips*, *Station packs*), in italics in docs. No jargon in the UI (say "GPS points", not "fixes", in labels). British spelling in the app (kilometres, colour), and units follow Settings.
