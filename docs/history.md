# BT•DT: how it got here

A short history of the project and an overview of its features, for anyone (or any Claude) picking it up. The app was built by Claude from David's requests, between 13 October and 20 November 2026, in about 220 pull requests.

## Timeline

| When | Phase | What happened |
|---|---|---|
| 13 Oct 2026 | **HeatMapper** | The idea: an Android app showing Google Timeline as a heatmap with year, month, day and transport filters. A plan proposed Kotlin + MapLibre, with a quick web prototype first. The web prototype (one HTML page reading Timeline.json in the browser) won, and the native app was never built. |
| 13–17 Oct | **Transport Footprint (v1.0)** | The prototype pivoted into a sustainability dashboard: CO₂ per trip, using UK government conversion factors. Frozen as v1.0 on 17 Oct (kept in the project files under `versions/v1.0/`). A phone version was made installable as a PWA instead of an APK. |
| 16–26 Oct | Side projects | Using Gmail, Claude built a table of every flight David took (`flight-history.xlsx`), found his train, bus and ferry trips, and pieced together a 2005 Indonesia itinerary. Missing trips were rebuilt along real roads and railways as *simulated trips*. An analysis compared old Takeout Records (2012–2016) with the new Timeline export. |
| 17–18 Oct | **Timeliner 2.0** | A redesign: a full-screen map as the home screen, three tabs (Map, Insights, Timeline), shared filters, data kept on the device. Published on GitHub Pages from the `timeliner` repository on 18 Oct. Strava import added the same day. |
| 18 Oct – 2 Nov | Growing the core | Playback, the over-time chart with Years, Months, Weeks and Days, a day/week/month/year navigator shared across tabs, heatmap bases, local time zones, the country timeline strip with layovers, Raw data, and export. |
| 3 Nov | **Renamed BT•DT** | Became *BT;DT (Been There · Done That)* with David's logo, later written BT•DT. The repository became `bluehair-co/btdt`. |
| 4–6 Nov | Cleaning Google's data | Bad GPS jumps, trips that disagree with their stays, place pages and regular places, places Google moved, re-IDed places. |
| 8–10 Nov | **UI clean-up and landing** | Explanations behind (i) buttons, the transport tree, the period navigator and calendar, the hiker landing picture with its layers, the Sunrise palette, and desktop map buttons beside the dock. The About dialog and the CC BY-NC 4.0 license were added, with work to make the project easier to find. |
| 10–13 Nov | Fun and fitness | Distance scores (Marco Polo / Magellan, Armstrong, Musk, Voyager, Merckx) in a carousel, a demo mode (three made-up years in Amsterdam), Dawarich import, new icons from Figma, Strava gear, speed paths, explorer squares, and the trip chart. |
| 14 Nov | More sources | GPX, KML, GeoJSON, TCX, FIT and Garmin exports, heart rate (zones, paths, fitness trend), the About / *How to get your files* split, the Credits rule, the loading donut, and the decision to make **MyRules**. |
| 15–17 Nov | **MyRules** | A portable `*.myrules.json` file (spec v0.1, then v0.2 with `unless`). It holds gear periods, named places, routines and corrections. Also: kinds of place, sunrise and sunset in playback, Timeline search, OpenStreetMap place names, date, time and unit formats from the device's region, *Turn off for these trips*, beacons and zoom to all, and transport guesses that learn from your own trips. |
| 18–19 Nov | Routines and packs | Routines apply fully or not at all. Added a routine editor with ghosts and a match slider, *Find similar trips*, a radius for each end, and both-ways time windows. **Station packs** from OpenStreetMap: splitting trips Timeline merged, naming stations and airports, map snaps, trains snapped to the tracks, and splitting a trip by hand. Also *Select trips* for bulk type changes and the "Working on it…" pill. |
| 19–20 Nov | Roads and fixes | **Road packs** and *Snap car trips to roads* (NL, Mexico, and US states and Canadian provinces), one routing network across borders, download progress bars, and packs kept on the device. *Unclassified*, *Ignore GPS points…*, cell-tower and Wi-Fi fixes left out, more fixes for places Google moved, *Clean up rules*, and faster loading. |
| 20 Nov | UI clean-up 2 | Long explanations moved behind (i) buttons across the whole app (#219). Handover docs written (`CLAUDE.md`, this file, `design-rules.md`). |

## Feature overview (as of 20 Nov 2026)

**Inputs:** Google Timeline (Android on-device, iPhone, old Takeout Records.json and Semantic Location History), Strava export ZIP, Garmin export, Dawarich, and GPX, KML/KMZ, GeoJSON, TCX and FIT files. There are also MyRules files and simulated-trip files.

**Map:** paths coloured by transport, heatmap (GPS points, paths or time spent), speed paths, heart rate paths, explorer squares, countries visited (with layover-only countries in blue), regular places with pin groups, and Mercator, Equal Earth or Globe views. Playback runs over a day, week, month or year, with a speed pill, sunrise and sunset, the night side, and roll-over at midnight. Small isolated trips get beacons, and a zoom to all button fits everything. One-finger zoom works on touch screens.

**Insights:** summary, how you travel, weekly rhythm, over time, top routes, top places (by time or visits), time by kind of place, records, countries over time, countries, CO₂, distance scores, heart rate and fitness, gear, and explorer squares.

**Timeline:** a virtualised list of trips by day, with search, trip details (chart, raw data, flags, edits, legs of split trips), and place pages.

**Filters:** the period navigator and calendar, date range, years, months, days of the week, time of day, a transport tree with Strava sports and gear, source, countries, *Check* (unsure types), imported data, export to JSON or CSV, and a MyRules summary.

**Cleaning:** GPS jumps, stale ends, stays that disagree with trips, parked time, places Google moved, re-IDed places, cell-tower and Wi-Fi fixes, merged trips split into legs, and transport guessing (speed, profile, history voting, corridors, stations, packs).

**MyRules:** gear periods, named places (with kind and radius), moves, routines (type, gear and line, one-way or both ways, a radius per end, a match slider), map snaps, and corrections (type, title, gear, hide, Unclassified, ignored GPS points, bulk edits). It also covers `except` and `unless`, *Turn off for these trips*, *Clean up rules*, and export.

**Packs:** station packs for 46 countries (built quarterly by GitHub Actions to the `packs` branch), and road packs for the Netherlands, Mexico, US states and Canadian provinces.

**Other:** a PWA that works offline, a demo mode, light and dark themes, units and date formats from the device's region, an About dialog (how it works, credits, license) and *How to get your files*.

## Ideas mentioned but not built

- A native Android app (Kotlin + MapLibre): replaced by the installable PWA.
- *Replace* corrections in MyRules (swap a trip for a hand-drawn one): read and exported, but not applied yet.
- Comparing loop routes (home to home) by shape for *Find similar trips*.
- Writing trips back into the phone's Timeline: there is no API for it.
