# BT;DT (Been There · Done That)

BT;DT 2.0 shows where you've been and how you get around, using your Google Timeline. It is the successor to Transport Footprint, which is frozen as v1.0 in `../versions/v1.0/`.

## Open it

- **On a Mac or PC:** open `dist/index.html` in a browser.
- **On a phone:** host the `dist/` folder over HTTPS (for example GitHub Pages or Netlify), open it, and choose *Add to Home screen*. It then starts offline, and your last import stays saved on the phone.

Your Timeline file is read on the device and is never uploaded.

## Strava

In Settings, *Load Strava export* takes the ZIP from Strava (Settings → My Account → Download or Delete Your Account), or single .gpx, .fit or .tcx files. Only the activity files inside the ZIP are read, so a large export with photos is fine. A Strava activity replaces every Timeline trip that is at least half inside its time (whatever transport Timeline guessed), and activities Timeline missed are added. Virtual rides are skipped. The Strava activities are saved apart from the Timeline trips, so re-importing either one keeps the match. Each Strava trip keeps its sport (Kayaking, Mountain bike, Trail run…) under the matching transport type, which is what the trip is called in the app; the Transport filter lists the sports present under their type. Data loaded before sports were read shows them after loading the Strava export again.

## Trips from Timeline's loose GPS points

Older on-device Timeline data often keeps GPS points while you were moving but no trip for them, so a day of driving shows up as a few stays and nothing else. Points outside every trip and stay are joined into trips (a run ends at a gap of over 30 minutes, a jump of over 50 km, or a trip or stay) when they get at least 500 m from where they started. Their transport type is guessed from the speed they kept while moving: 30 km/h or more is a car, 10 km/h or more a bike, slower is walking. They are marked as guessed, and the trip details say they were made from loose points.

## Records.json under Timeline

Load the on-device Timeline.json together with Takeout Records.json files (all at once, or one after the other) to get the best of both. Timeline still decides where you stayed, how you travelled and where each trip starts and ends. Records.json, which keeps a GPS point about every minute where Timeline kept one every few minutes, gives those trips their line: each trip is drawn along the Records points recorded during it, and when they cover the whole trip (no gap over 15 minutes) its distance is measured along them too, with Timeline's own figure shown in the trip details. Points less accurate than 200 m are left out, and when two phones recorded at once, a trip uses the phone its own Timeline points came from. On days only Records.json covers, trips are rebuilt from its points as before. On days Timeline covers, a trip rebuilt from Records.json is still kept when it falls in a gap Timeline left (older Timeline data often has a stay and nothing else on a day of driving): at most a fifth of it may overlap Timeline's trips and at most half its stays. Flights always come from Timeline. The Records points are saved on the device with the trips, so files loaded later are matched too.

## Simulated trips

A file in the on-device Timeline.json format with `"simulated": true` at the top is read as simulated trips, for example trips rebuilt from booking emails. Where they clash with an exported Timeline, the simulated trips win: an exported trip that overlaps a simulated one for at least half of its time (or half of the simulated trip's time) is left out, and exported stays are cut back to the time around it. A few minutes' overlap at either end is not a clash, so the walk to the station stays. Everything else on those days still comes from the export.

## Times

Times and dates show the local time where you were. The on-device Timeline.json writes each time with its UTC offset, which is used as it is. Takeout's Semantic Location History, Records.json and Strava write times in UTC only, so those trips and stays take the time zone of the place they started (found from the country borders and time zone data built into the app, daylight saving included). Only when no time zone can be found, such as far out at sea, does a time fall back to this device's time zone. Some older trips in the on-device Timeline.json carry winter time all year round (UTC+1 for Spain in September); when a file's offset is the place's offset in the other season but not on that day, the place's offset is used instead. Those trips can also carry the home time zone while abroad (UTC+1 on a trip in Canada), so an offset two hours or more from the place's is replaced by the place's too, unless it matches where the trip ended.

## Countries

A place's country comes from the built-in borders (Natural Earth, simplified to about 1 km), with these rules everywhere:

- Places just off the simplified coastline, such as a beach or a harbour, take the country with the nearest border within 25 km, unless an airport is closer (for small islands the borders leave out). Further out at sea they take the nearest airport's country.
- Overseas parts the borders fold into another country (Réunion, Guadeloupe, Martinique, French Guiana, Mayotte, Bonaire, Christmas Island…) are found from the airport data and keep their own code and time zone: a place takes the territory when one of its airports is within 300 km and closer than any of the main country's airports.
- Within 3 km of a border, an airport within 5 km on the other side decides which side a place is on, as the simplified line can put a border town on the wrong side.
- Gibraltar, the Vatican, Ceuta and Melilla, which the borders leave out or give to a neighbour, are outlined by hand.

## Layout

- **Map:** full-screen map with the time slider at the top. When a single day is chosen, the top bar becomes a navigator: switch between Day, Week (Monday to Sunday), Month and Year, and the arrows (or the arrow keys) step to the previous or next one with trips. Filters are bottom-left (the gear there opens Settings). Views and layers are bottom-right: Mercator, Equal Earth or Globe; paths; a heatmap of where you travelled or stayed, based on GPS points, paths (how many trips went along each route, flights included) or time spent, with dot size and intensity; and countries visited, in blue where your only visit was a layover at the airport (flew in and out within a day, never over 5 km from it).
- **Insights:** the same navigator as the map, in the same place (the period is shared, so stepping on any tab moves them all, and it stays put as you switch tabs), then summary, how you travel, weekly rhythm, change over time, top routes, places, records, countries over time (a strip you can scroll and zoom, one colour per country; days in two countries are split once zoomed in far enough, and stops of under a day are marked: a true layover, where you flew in and out and stayed within 5 km of the airport, is a circle below the strip (shown once the axis names the months), and a stop where you got out, a layover with a visit or a short stop on the ground, is a downward pentagon above it; stretches with no records are drawn faded in the country you were in before and after, or half each when those differ, and are left out of the day counts; it only shows with every kind of transport selected, and otherwise offers a button to show all transport), countries and CO₂.
- **Timeline:** the same navigator, then every trip in the filter range, newest first. Tap a trip to see it on a map at the top of the list.

## Export

At the bottom of Filters, *Export* downloads what the filters currently show (every filter applies: days, years, months, days of the week, time of day, transport, guessed types, source and countries; the map's time slider doesn't narrow it).

- **Raw data (JSON):** the filters in words, then every matching trip, newest first, in the same format as a trip's *{ } Raw data* (GPS points included), then the matching stays (times, place name, home or work tag, country and position).
- **Table (CSV):** one row per trip, without the GPS points: UTC and local times, duration, type, source, distance, route, countries, start and end positions, CO₂, number of GPS points and flags. It opens in Excel or Numbers.

## Rebuild

Run `python3 build.py`. It assembles `dist/index.html` from `src/` and copies `static/` (the manifest, service worker and icons).

The app icons in `static/` are made from `icons/logo-source.jpg` by `python3 icons/make_icons.py`. The repository and the storage keys on the device still use the old name, Timeliner, so existing installs keep their data.
