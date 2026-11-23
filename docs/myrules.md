# MyRules files — draft spec v0.2

*Version 0.2, 17 Nov 2026 (0.1 plus `unless`, §3.1). BT•DT applies gear periods, places, routines (`mode`, `gear`, `snap`) and corrections (`mode`, `gear`, `name`, `hide`); §9, slices 1 to 3. `replace` corrections are read, kept and exported again, but not applied yet.*

A **MyRules file** holds the things only you know about your own history: which bike you owned when, where home and work were, the train you took to work every weekday, the day Timeline got completely wrong. You load it next to your location files. BT•DT applies it on top of what it read from them, and marks everything it changed as **inferred**, so a guess never passes for a recording.

The app stays generic: nothing about any one person is built in. And because the format is open and versioned, other tools could read and write the same file.

The JSON Schema is published with the app at [`schema/myrules-0.2.json`](../schema/myrules-0.2.json) (0.1 stays at [`schema/myrules-0.1.json`](../schema/myrules-0.1.json)), and [`myrules-example.json`](myrules-example.json) is a complete example covering every rule type.

---

## 1. Goals and non-goals

**Goals**

1. Fill gaps in the data using facts the user knows: gear, places, routines.
2. Clean up messy data where a fact explains it, like a commute train drawn as a GPS zig-zag.
3. Never hide that a value was inferred. Each change names the rule that made it and can be undone per trip, per rule or all at once.
4. Most people should never write the file by hand. Edits made in the app (assigning gear, naming a place, "not this trip") become rules, and the app exports them.
5. Keep the file portable. It is plain JSON, with no BT•DT internals such as trip indexes or gear numbers.

**Non-goals for v0.1**

- No scripting or expressions. Rules are data, not code.
- No sharing between people or syncing. The file is yours, like your Timeline export.
- No fetching anything. Rail geometry for snapping comes from your own trips or from the file itself (see §5.3), because the app has no server and does not call routing services.

---

## 2. File basics

| | |
|---|---|
| Name | Anything, but `*.myrules.json` is recommended so the app recognises it in a folder or ZIP. A file with `"myrules"` at the top is also recognised by content. |
| Encoding | UTF-8 JSON. No YAML (decided, see §10). |
| Comments | JSON has none, so every rule takes an optional `"note"` string. |
| Version | `"myrules": "0.2"`. A minor bump only adds things (0.2 added `unless` to 0.1), so the app reads 0.1 files as they are. A major bump may change meaning, and the app refuses a major version it doesn't know, with a message. |
| Schema | `"$schema": "https://bluehair-co.github.io/btdt/schema/myrules-0.2.json"` (optional; to be published with the app). |
| Unknown keys | Kept on export, so a file written by a newer app or another tool round-trips. Keys starting with `x-` are for tool-specific extensions. |
| Unknown rule types | Skipped with a notice ("2 rules of a newer kind were skipped"), never an error. |

### Top level

```json
{
  "$schema": "https://bluehair-co.github.io/btdt/schema/myrules-0.2.json",
  "myrules": "0.2",
  "about": { "name": "David's context", "updated": "2026-11-14T21:40:00Z", "generator": "BT•DT 2.4" },
  "places": [ … ],
  "moves": [ … ],
  "gear": [ … ],
  "routines": [ … ],
  "corrections": [ … ],
  "gps_spots": [ … ]
}
```

Every section is optional. Rules live in four typed lists rather than one generic list, because each kind has different fields and typed lists are much easier to read and edit by hand.

### Fields every rule shares

| Field | Type | Meaning |
|---|---|---|
| `id` | string, required | Unique in the file, like `"strida-evo"`. Other rules refer to it as `"@strida-evo"`. The app makes one from the name when it writes a rule. |
| `name` | string | What the app shows. |
| `when` | When | When the rule applies (§3). Leave it out for always. |
| `enabled` | boolean, default `true` | Switched off in the app: kept in the file but not applied. |
| `except` | TripRef[] | Trips the rule must leave alone. "Not this trip" in the app adds one here. |
| `unless` | Unless[] | Conditions the rule leaves alone, like "not on weekends" (§3.1). *Turn off for these trips* in the app adds one here. Since 0.2. |
| `note` | string | Free text for humans. |

---

## 3. Time: the `when` object

```json
"when": {
  "from": "2021-03-01",
  "to": "2023-08-31",
  "days": ["mon", "tue", "wed", "thu", "fri"],
  "time": ["06:30", "09:30"],
  "skip": [["2022-07-15", "2022-08-07"]]
}
```

- `from` and `to` are local dates, both included. Either can be left out for an open range ("since 2019").
- `days` and `time` limit it to days of the week and a local time window. A trip matches when it **starts** inside the window. A window that crosses midnight (`["22:00", "02:00"]`) works.
- `skip` lists date ranges inside it that don't count (holidays, a broken bike in the shop).
- All times are the local time where the trip started, the same local time the app already shows.

### 3.1 Leaving trips out: `unless`

A gear period applies across its whole time frame, which often catches trips it shouldn't: the weekend rides on a rented bike, the holiday where the Strida stayed home. `unless` lists conditions the rule leaves alone, written the way the filters are:

```json
"unless": [
  { "days": ["sat", "sun"] },
  { "countries": ["VN", "JP"] },
  { "time": ["22:00", "23:59"], "months": [7, 8] }
]
```

- Each entry takes the parts of a `when` (`from`, `to`, `days`, `time`), plus `months` (1–12), `years` and `countries` (ISO 3166-1 codes; a trip counts when it starts or ends in one, as in Filters).
- A trip matches an entry when it fits **every** part the entry has, and the rule skips it when it matches **any** entry, like a trip in `except`.
- Unlike `except`, it follows the data: trips loaded later that match are left alone too.

**In BT•DT.** In *Menu › MyRules*, the *In these filters* line says how many gear periods and routines changed the trips shown ("2 rules changed 408 of the trips shown"). *Show them* lists them, each with how many of those trips it changed and **Turn off for these trips**. That offers:

- **Trips like these** (the default): the date, year, month, day of the week, time of day and country filters that are on become one `unless` entry. Transport, gear, source and *Guessed* filters aren't part of it, since a rule only touches its own type, and the gear filter is often how its trips were found. When none of those filters is on, only the next choice is offered.
- **Just these trips**: each trip shown is added to the rule's `except`, so nothing else changes.

The rules sheet shows each `unless` entry under its rule ("Not on weekends") with *Undo*. A file with an `unless` is saved as version 0.2.

---

## 4. Referring to a trip: `TripRef`

Corrections and exceptions have to point at one trip in a way that survives a re-import, so they never use the app's internal trip numbers.

```json
{ "start": "2024-03-06T08:12+01:00" }
{ "start": "2024-03-06T08:12+01:00", "mode": "CAR" }
{ "day": "2024-03-06" }
{ "span": ["2024-03-06T07:00+01:00", "2024-03-06T11:00+01:00"] }
{ "trips": [{ "start": "2024-03-06T08:12+01:00", "mode": "VEHICLE" }, { "start": "2024-03-07T17:40+01:00", "mode": "VEHICLE" }] }
```

- `start` matches the trip that starts within **±3 minutes** of it. That is enough to survive the small shifts from re-exporting Timeline or fixing a stale start, and small enough not to catch the next trip. If two trips fall in the window, `mode` (the type it had when the ref was made) picks one; if it is still ambiguous, the ref matches nothing and the app lists it under "Rules that matched nothing".
- `day` matches every trip that day; `span` matches every trip starting inside it.
- `trips` (a bulk edit) matches each trip it lists, each by its `start` and `mode` as above. *Select trips on the map* writes one.

---

## 5. Rule types

### 5.1 Places

```json
{
  "id": "home-oudwest",
  "name": "Home",
  "role": "home",
  "at": [52.3667, 4.8650],
  "radius_m": 75,
  "when": { "from": "2019-05-01", "to": "2024-01-31" },
  "hide": false
}
```

| Field | Meaning |
|---|---|
| `role` | `home`, `work`, `school`, `station`, or anything else, which is shown as typed. `home` replaces the app's own home guess for those dates. |
| `at`, `radius_m` | Where it is, as `[lat, lng]` and a radius (default 100 m). Stays within the radius take the name. |
| `google_place_id` | Optional. Matches stays with that place ID wherever Google put them (useful for places Google moved). |
| `hide` | `true` hides the place: stays there are left out of the map's pins and heatmap and the places in Insights, and trips to or from it show the town instead of the place's name. The trips themselves still count. |

| `drift` | *GPS drifts here.* `{ "radius_m": 300 }` (or `true`, for the place's own radius): walks that were really time spent here become part of the stays, or are cut back to the part where you moved (see below). `"only": true` marks a place made just for this: it names no stays and has no part in places. The place's `except` lists the walks to keep as walks. |

What a place does: it names stays, decides the Home pin, and anchors routines (`"from": "@home-oudwest"`). Places don't change trips, except with `drift`.

**GPS drifts here (`drift`).** Indoors the phone keeps guessing where it is, so Timeline records slow "walks" that start and end where you sat, or keeps a real walk going while you stood still at one end. A walk counts when it starts or ends inside the circle next to a stay inside it (within 15 minutes); a walk whose type you set or checked, a recorded activity, a walk in a routine, and a walk between two stays over 150 m apart are left alone. A walk that never leaves the circle and averages under 3 km/h (or lasts 5 minutes or less) becomes part of the stay next to it. A walk with a still stretch at an end inside the circle (10 minutes or more between two GPS points, beyond the time to walk between them) is cut back to the part where you moved, and those minutes join the stay; its details say *Cut back* with *Not this trip*, which adds it to `except`. It applies to walks loaded later too, and only while MyRules are on.

```json
{ "id": "office-drift", "name": "Office", "at": [52.0787, 4.3356], "drift": { "radius_m": 400, "only": true },
  "except": [{ "start": "2019-01-16T09:40+01:00", "mode": "WALKING" }] }
```

**In BT•DT.** *Menu › Trip cleanup › Walks that may be stays* lists places where such walks keep happening, and a place page's ⋯ menu has *Check walks here…*. Either opens the place's walks on the map with a radius slider and a list to untick the real ones; saving writes `drift` and `except`. A place with `drift` shows *GPS drifts here* in MyRules; for one with `only`, tapping it opens the same review, with *Remove*.

### 5.1.1 Places that moved

Google keeps one location per place, today's. When a place moves and keeps its Google place ID (an employer moving across town), your old stays there show at the new address. BT•DT puts them back where your phone's GPS was when that is clear (see *Places Google moved* in `source/README.md`); a move says it yourself, or keeps Google's location instead. *This place moved…* and *Use Google's location* on a place's page write them.

```json
{ "id": "moved-office", "name": "Office", "google_place_ids": ["ChIJZ_pybQW3xUcRLuvdd3msBtg"],
  "at": [52.078562, 4.335813], "when": { "to": "2019-01-16" } }
{ "id": "google-office", "name": "Office", "google_place_ids": ["ChIJZ_pybQW3xUcRLuvdd3msBtg"], "keep": true }
```

| Field | Meaning |
|---|---|
| `google_place_ids` | The place's Google place IDs (one place can have more than one). |
| `at` | Where the place was, `[lat, lng]`. Its stays in `when` (`from` and `to` only) go there, with the ends of the trips arriving within 10 minutes before them or leaving within 10 minutes after them (within 200 m of where the stay was), and those trips' distances change by what the end moved. |
| `keep` | `true` instead: the stays BT•DT moved to where your phone was go back to Google's location, with the ends of their trips. |

A move with `at` wins over `keep` on the stays in its dates; of two moves, the later one in the file wins.

### 5.2 Gear periods

```json
{
  "id": "strida-evo",
  "name": "Strida EVO",
  "kind": "strida",
  "mode": "CYCLING",
  "when": { "from": "2021-03-01", "to": "2023-08-31" },
  "match": { "max_km": 25 }
}
```

| Field | Meaning |
|---|---|
| `kind` | Bikes: `bike`, `strida`, `halfbike`, `cargo`, `ebike`. Runs and walks: `shoe`. Cars: `car`, or `petrol`, `diesel`, `hybrid`, `ev` (electric) to count that car's CO₂ instead of the car factor in *Preferences*. Motorbikes: `motorbike`, `scooter`. Boats (not ferries): `boat`, `sailboat`, `kayak`, `sup` (paddleboard). Snow sports: `skis`, `snowboard`. Any type: `other`. Picks the icon and the label in *Your gear*, as the app already does for Strava gear. |
| `default` | `true` makes it the default of its `mode` (one per mode; BT•DT sets one for `CAR` in *Preferences › CO₂ estimates › Default car*). It needs no `when`. Every trip of that mode still without gear after corrections, routines and gear periods gets it as a guess: tagged *Default car*, counted as guessed, and its `kind` (`petrol`, `diesel`, `hybrid`, `ev`) sets the trip's CO₂. *… is right* on a trip confirms it with a correction (`"gear": "@id"`); *Confirm for a period…* adds a gear period with the same `name`. |
| `model` | Optional make and model, for you (`"Volvo XC40"`). |
| `assign` | `false`: gear in your list only. It fills no trips by itself; you set it on trips with *Set gear* (a correction with `"gear": "@id"`). `when`, `match` and country conditions don't apply then. Leave it out (the default) for a gear period: every trip of its `mode` without gear in the period gets it. *New gear…* in MyRules saves `"assign": false` unless *Use as default* is on. |
| `mode` | The transport type it applies to (the app's own type names). The app offers gear for `CYCLING`, `RUNNING`, `WALKING`, `CAR`, `MOTORCYCLE`, `BOAT` and `SKIING`. |
| `match` | Optional narrowing: `min_km`, `max_km`, `sports` (e.g. `["Mountain bike"]`), `from`/`to` (place ids: only rides starting or ending there), `weekdays_only`, `countries` (ISO codes such as `["ES"]`: only trips that start or end in one of them, so countries you visit later stay out). |

**In BT•DT.** *New gear…* at the top of *MyRules › Gear* adds gear to your list: name, type and kind. It only becomes a gear period with *Use as default*, which asks for the period (end optional), countries and a distance limit. *Edit gear* (tap the rule) has the same fields. Both, and the period option of *Set gear*, have a *Countries* choice: *Everywhere*, *Only in* (writes `match.countries`) or *Not in* (writes an `unless` entry with only `countries`, as *Turn off for these trips* does). Switching between *Only in* and *Not in* flips the countries picked, so a rule saved as “not in every country but Spain” becomes “only in Spain” with one tap.
| `strava_name` | Optional. The name this gear has in your Strava export, so a gear period and recorded Strava gear show as **one** chip in Filters instead of two. |

What it does: every trip of that type inside the period **with no gear of its own** gets this gear, marked inferred. Gear recorded by Strava or another activity file is never replaced.

When two gear periods overlap (you owned two bikes), the one with the narrower `match` wins (§6). If neither is narrower, the trip gets **no gear** and the trip details say "Strida EVO or Gazelle: 2 rules apply, add a match to pick one". A wrong guess is worse than none.

### 5.3 Routines

```json
{
  "id": "commute-utrecht",
  "name": "Train to Utrecht",
  "from": "@amsterdam-centraal",
  "to": "@utrecht-centraal",
  "both_ways": true,
  "when": { "from": "2019-09-02", "to": "2022-06-30", "days": ["mon","tue","wed","thu","fri"], "time": ["06:30", "10:00"] },
  "then": { "mode": "TRAIN", "snap": "learn" },
  "return_when": { "time": ["16:00", "20:00"] }
}
```

A routine matches trips that start within 500 m of `from` and end within 500 m of `to` (or its own `radius_m`, from 100 to 3,000 m, one number for both ends or `{"from": 300, "to": 1200}` for each its own, so trips whose ends GPS caught loosely still group together; places' own radius if larger), inside `when`. With `both_ways`, the reverse trip matches too, inside `return_when` (which defaults to `when`).

**All or nothing.** A routine takes a trip only when everything in its `then` can apply to it: its type, its gear and its line. A trip that matches by place and time but can't take one of them stays out of the routine altogether, keeps its own type and GPS points, and its details say why (*Not in routine*). That happens when the files gave it another type and the routine has no `force`, when it was recorded with other gear than the routine's `gear` (recorded gear is never replaced), when the routine has a `snap` line and the trip went another way, and for every trip while the line can't be had (a `"learn"` line with no trip clean enough yet, or a GeoJSON file that isn't loaded).

`then` says what to do with a match:

| Action | Meaning |
|---|---|
| `mode` | Set the transport type. Applies where the type is missing, generic (Google's *In vehicle*, which doesn't say car, bus or train) or was guessed from speed, or where the files already say the same. A trip the files give another type stays out of the routine, unless `"force": true` is set on the routine. |
| `gear` | Give it a gear (`"@strida-evo"`): for a bike commute. A trip recorded with other gear (Strava, an activity file) stays out of the routine. |
| `snap` | Redraw the trip along a known line instead of its GPS points (below). |
| `match` | With `snap`: how closely a trip has to follow the line to be one of the routine's trips, as the share of its GPS points within 500 m of it (percent, default 67). |

`include` (next to `except`) lists trips you added by hand (*Add to routine*): they take the routine's line whatever their match, as long as their ends are within 1 km of it.

**Where the line for `snap` comes from.** The app runs offline with no routing server, so it can't look up train tracks the way the simulated-trips generator does with BRouter. The line comes from one of these:

- `"learn"`: the app picks the recommended trip that matches the routine as the line for the rest: the cleanest trip of the way most of its trips take. Cleanest means the most GPS points per km with no gap over 2 minutes, preferring a recorded activity or Records.json line; with no clean trip, the one with most points (5 or more). The trip details of a snapped trip say which trip it was taken from, and you can pick another one. This works for most commutes, since a few hundred trips almost always include one good one.
- An encoded polyline in the file: `"snap": { "polyline": "…" }` (Google's polyline encoding, 5 decimals). Tools that can route, like our generator, can write this.
- OpenStreetMap, for public transport (train, tram, metro, bus, ferry): *Use the line from OpenStreetMap* in the routine dialog asks Overpass for the route relations of that type passing within 600 m of both ends, joins each one's ways and cuts it between the ends. You pick one if there are several; it is saved as `"snap": { "polyline": "…", "osm": { "relation": 123, "name": "5 · Tram 5" } }`. Only the two ends are sent, and only when you ask.

- A GeoJSON file loaded at the same time: `"snap": { "geojson": "utrecht-line.geojson" }`.

**What snapping does.** It cuts the line between the points nearest the trip's start and end, and puts the trip's own timing on it: each of its GPS points within 500 m of the line is placed at how far along the line it is, and the time between them is spread by distance, so the speed graph and the heatmap's time weighting still show where it stopped or went slowly. A trip with no GPS points near the line gets an even speed from its start to its end time. The distance becomes the line's length. The original GPS points are kept and drawn dashed in the trip details, and **Raw data** still shows them. A trip that follows the line less closely than the routine's `match` (share of its GPS points within 500 m of the line, 67% by default), or whose start or end is over 1 km from it, is not snapped, because it was probably a different route that day (a diversion, a bus replacement). It stays out of the routine (so it keeps its own type too); its details say how closely it followed the line and offer *Add to routine*, and the rules sheet counts these trips.

**In BT•DT.**

- `from` and `to` are a place (`"@office"`) or a position (`[52.364, 4.866]`), matched within 500 m (or the place's radius, if larger).
- Of the routines that match a trip (ends, times, type and gear), the one whose line it follows most closely wins (a routine without a line counts as 0%), then the one with the shorter `when`, then the later one in the file. A routine whose line it doesn't follow closely enough can't take it, so the next one gets a chance; with none left, the trip stays out and its details name the closest one.
- `mode` follows the table above. A routine's `gear` fills trips without gear, before gear periods.
- **The learned line** is the one *Edit routine* recommends: trips are grouped into the ways they take (within 150 m of each other for most of their length), and the line is the best trip of the way most trips take, by GPS points per km with no gap over 2 minutes (a recorded activity or a Records.json line counts double), else by most points. Trips with under 5 points aren't used.
- **Picking another line:** the arrows in *Edit routine*, or *Use this trip's line* in a trip's details (also on a trip left out for want of a line), write `"snap": { "trip": TripRef }`. Any trip with 5 or more points can be the line.
- **GeoJSON lines:** a `.geojson` named by a routine's `snap.geojson` is read as that line (its LineString, or the longest part of a MultiLineString) when loaded with the rules or after them. It is kept with your rules in the browser.
- **How it shows:** snapped trips and types a routine set are marked *Rule applied*; trips a map snap took are marked *Map snap*. The rules sheet says where each line came from, how many trips went another way and how many were left out for their type. A trip the routine matched but left out says why in its details, with *Edit routine*.
- **On a wide screen** the routine dialogs (*Edit routine*, *Trips like this one*, *Same on other days?*) open as a panel on the right, and the ghosts, the line and the two ends are drawn on the main map, dimmed underneath. Closing the panel takes them off and puts the map back where it was.
- **Editing a routine:** name, type, period, days of the week, the time it leaves, how far from its two ends a trip may start and end (`radius_m`, a slider for each end, drawn as dashed circles on the map), both ways (with its own *Back between* time window, `return_when.time`; empty uses the times there), *Always*, and the line. Tap a ghost to make that trip the line, or use the arrows; for public transport, *Use the line from OpenStreetMap*. The *Follows the line for at least* slider sets `match`; the ghosts that make the cut are drawn in the type's colour and the others dashed grey, with the counts, as you move it.
- **From a trip:** *Group with similar trips* in the ⋯ menu of a trip's details (a trip not in a routine and not a flight, over 1 km end to end) opens the routine editor on a new routine: the trip's two ends, both ways, any day and time, its type, and its own trail as the line (`snap: { trip }`), or no line when the trip has under 5 GPS points (its routine then goes by its ends and type alone). The match slider decides which trips between those ends follow it closely enough; *Save as routine* adds it to MyRules.
- **The rules sheet** has a tab for each kind of rule you have (Gear, Places, Routines, Corrections).
- **Seeing what it covers:** while you make a routine (*Same on other days?*) or edit one (tap it in the rules sheet), a small map shows the trips it would cover as ghost lines, with how many there are and how many would change type. It updates as you change the dates, times and options, before you save. With *Draw them along one line*, the line in use is drawn solid on top of the ghosts. For a learned line, the arrows under the map go through the different ways its trips take (trips within 150 m of each other for most of their length are one way), the way most trips take first, each drawn from its cleanest trip. The one you stop on is saved as `snap: { "trip": … }`; *Back to the recommended line* returns to `"learn"`, which is worked out again from your data.
- **Making a routine in the app:** after you change a trip's type with *Trip info*, the app offers *Same on other days?* if you made 5 or more trips like it. Like it means the same ends within 500 m, on the same kind of day, starting within 2 hours of it. It fills in:
  - the dates and a time window;
  - *Both ways*, with the time you usually come back;
  - *Also where your files recorded another type* (`force`);
  - *Draw them along one line* (`snap: "learn"`, on by default for public transport).

### 5.4 Corrections

One-off fixes for a trip, a day or a span.

```json
{ "id": "fix-2024-03-06", "trip": { "start": "2024-03-06T08:12+01:00" }, "then": { "mode": "TRAIN" } }
{ "id": "drop-gps-mess", "trip": { "span": ["2023-11-02T13:00+01:00", "2023-11-02T15:30+01:00"] }, "then": { "hide": true }, "note": "Phone in a drawer at the office" }
{ "id": "flight-bcn", "trip": { "day": "2022-04-14" }, "then": { "replace": { "mode": "FLYING", "from": "AMS", "to": "BCN", "depart": "09:40", "arrive": "11:55" } } }
```

| Action | Meaning |
|---|---|
| `mode`, `gear`, `name` | Set the type, gear or title. Corrections are explicit, so they replace recorded values too. `"mode": "UNKNOWN"` marks a trip *Unclassified*: for one that looks wrong (a GPS glitch?) when you aren't sure what it was. `gear` is a gear period's id (`"@strida-evo"`) or a gear's name as your activity files record it (`"Gazelle"`). A new gear named on one trip can carry its kind in `gear_kind` (same values as a gear period's `kind`, such as `"ev"`). |
| `checked` | `true`: you checked the type your files give this trip and it is right. Nothing changes, but the trip leaves the *Check* list and its type counts three times when BT•DT learns from your trips. |
| `ignore_points` | The GPS points of this trip to leave out, as a list of their times (ISO 8601, to the second, e.g. `"2024-03-06T07:41:48Z"`). For bad points such as a spike off the route: the trip's line, distance, speed chart, playback and the heatmap go without them. Only on a correction for one trip (`start`); a trip always keeps at least two points. *Ignore GPS points* in the trip details writes it. |
| `stay` | This walk was really time spent at a place: `{ "at": [lat, lng], "name": "…", "place": "<place id>" }` (`name` and `place` optional). The walk is hidden and a stay at `at` covers its time instead, so it counts as a visit to that place. Only on a correction for one trip (`start`). *This was a stay…* in a walk's pencil menu writes it: it suggests the place of yours nearest to where the walk lingered (or a new place there when none is close), and you can tap another of your places or anywhere on the map. A new place has no `place` and becomes one of your places like any other stay. |
| `hide` | Leave the matched trips out everywhere (map, totals, export). Undo shows them again. `"hide": false` on a later or narrower correction shows a trip a wider one hid. |
| `replace` | Replace everything in the span or day with one trip, written like a simulated trip (airports by IATA code or place id). This is a one-line version of the existing `"simulated": true` files. |

A correction on a day or span that sets `gear` only fills trips without recorded gear; only one on a single trip (`start`) replaces it. A trip's `start` matches the trip that starts within 3 minutes of it; add the type the files gave it (`"mode"` in the TripRef) to pick between two. Setting a type also clears *guessed from speed*, and a Strava sport of another type.

### 5.4.1 Bad GPS spots

`gps_spots` lists spots where the phone keeps putting itself without GPS, such as a Wi-Fi router or a cell tower that *Leave out cell-tower fixes* doesn't catch (its coordinates move a few metres over the years). GPS points within 15 m of a spot are left out of every trip, including trips loaded later, except a trip's first and last points; a trip keeps at least two points, and flights and recorded activities are left alone. It applies while MyRules are on.

```json
{ "id": "gps-spot-2019-10-14", "name": "GPS spot from the trip on 14/10/2019", "at": [[52.369705, 4.977301]] }
```

| Field | Meaning |
|---|---|
| `at` | The spots, `[lat, lng]` each. |

**In BT•DT.** *Ignore GPS points* (a trip's pencil menu): after you mark points and *Save*, it asks *Just this trip* or *Every trip, here*, with how many points on how many trips the spot would take. *Every trip, here* saves the new points as one `gps_spots` rule; they show in *MyRules › Corrections* under *Bad GPS spots*, with a switch, rename and *Delete*. A trip that loses points to one says so in its details.

### 5.5 How corrections show in the app

Anything a correction sets is marked **Edited** rather than *Rule applied*: it is your own fix, not a guess, so the *Guessed and inferred* filter leaves it alone. The trip details list each change ("Type: Train (was cycling)") with **Undo**, which drops that action from a correction on one trip, or adds the trip to the `except` of a correction on a day or span. **Trip info** (in the pencil menu of the trip details) sets the type (*Unclassified*, last in the list, for a trip that looks wrong when you aren't sure what it was) and title, *Hide this trip* in the same menu hides it, and writes them into one correction for that trip (made when needed, updated after, removed once empty); *Set gear → Just this trip* writes into the same one. **Remove edit**, next to it, takes back every correction on the trip after asking: the trip's own correction is deleted, a bulk edit lets go of the trip (as *Detach this trip*), and a correction on a day or span gets it in its `except`. Hidden trips can be opened again from the correction in the rules sheet.

**Bulk edits.** *Select trips on the map* (in *Map tools*, the pencil button beside the layers button) lets you draw a lasso or a rectangle on the map. Every trip the map shows (so, within the filters) that passes through it is picked; drawing again adds more, and a tap or the list drops one. *Change type…* (any type, or *Unclassified* for trips that look wrong) saves one correction with `trip.trips` listing them all and `then.mode`, named after what it did. *Set gear…* does the same with `then.gear`: gear already on your trips or in your list, or new gear (added to your list with `"assign": false`). It goes only on the picked trips of the gear's type, and gear recorded by an activity file is kept. Each trip's details say *From the bulk edit …* with **Detach this trip**, which takes it out of the list (the correction goes once the list is empty), and **List its trips**.

**Checking types.** Trips whose type may be wrong are marked *Check* (an unsure guess, a type from your files that your other trips between the same places disagree with, or a ride too fast for a bike). Their details ask *Is this the right type?*: keeping a guessed type writes `mode`, keeping a type from your files writes `"checked": true`, and changing it writes the new `mode`, all in the correction for that trip. Your corrections, checks and routines then count when BT•DT guesses the type of trips between the same places (a fix three times as much as a type from your files).

---

## 6. Order and precedence

Rules are applied in one pass after the files are read and cleaned (after the bad-GPS-jump, stale-end and places-moved fixes), so they work on the cleanest data the app has.

1. **Recorded beats inferred.** A value the data recorded (Strava gear, a type Timeline gave and that fits the speed) is kept. Gear periods and routines only fill in what is missing, generic (*In vehicle*) or was guessed; a routine leaves out a trip whose recorded type it would have to overrule. Only corrections overrule recorded values, with one exception: a routine with `"force": true` may replace a recorded transport type. Nothing but a correction replaces recorded gear.
2. **Specific beats general.** For each field of each trip, the most specific rule that matches decides:
   1. corrections naming one trip (`start`),
   2. corrections naming a span or a day,
   3. routines,
   4. gear periods with a `match`,
   5. gear periods without one.
3. **Ties within a level.** A shorter `when` wins (a two-week period beats a two-year one). If it is still a tie, the rule later in the file wins for corrections (the newest fix), but for gear periods the trip gets nothing and is flagged as ambiguous (§5.2).
4. **`except` and `unless` always win.** A trip listed in a rule's `except`, or matching one of its `unless` conditions, is skipped by that rule, and the next rule down may still apply.
5. **Places apply first**, since routines and gear matches refer to them.

Each trip keeps a list of what changed it, so the app can always show "why".

---

## 7. How "inferred" shows in the app

The app already shows two kinds of uncertainty: *type guessed from speed* and *Simulated*. Inferred values work the same way.

- **Data.** A new trip flag, `inferred` (next to `type guessed from speed` in the flags list), plus a per-trip list of `{ field, value, was, rule }`. Raw data and the JSON/CSV export include it.
- **Badges.** A trip with an inferred gear, type or line says *Rule applied* (or *Map snap*) in the lists and on its gear, in the same style as the existing *Simulated* tag.
- **Trip details.** A "From MyRules" section lists each change, like "Gear: Strida EVO (was none), from *Strida EVO, Mar 2021 to Aug 2023*". Each line has **Not this trip**, which adds the trip to the rule's `except`.
- **Snapped lines** are drawn solid, with the original GPS points dashed and faded under them in the trip details only.
- **Filters.** The existing *Guessed types* control becomes *Guessed and inferred*: All, Leave out, Only these. A gear period's gear gets a chip under its type like Strava gear, and when it has a `strava_name`, it shares the chip.
- **One switch for all.** *Menu › MyRules* has a master switch. Off shows the data exactly as the files had it, which is handy for checking a rule.

---

## 8. Loading, editing and exporting

**Loading.** The file goes through the same *Load location files* button (or with a folder or ZIP). It is saved in the browser with the rest of the import, never uploaded. Loading a second MyRules file asks whether to **merge** (rules with the same `id` are replaced) or **replace**.

**Where it lives in the UI.** *Menu › MyRules*, with a card at the top showing the rule count and how many trips it changed. Below it, the rules by section, each with its own switch, the number of trips it changed, and a tap-through to those trips in the Timeline.

**Editing in the app writes rules.**

| You do this | It writes this |
|---|---|
| Set a trip's gear, choosing *Just this trip* | correction with `start` |
| Set a trip's gear, choosing *All rides without gear from … to …* (dates prefilled from the first and last ride with this gear) | gear period |
| Name a stay or mark it *Home* / *Work* | place, with `when` from the first to last stay there |
| Mark a home, work or school *Current* or *Past* | place with `role`, and `when.to` for a past one |
| Say what kind of place it is (Restaurant, Bar / café, Supermarket, Store, Entertainment, Public transport stop, Friends, and the others) | place with `role`: `restaurant`, `cafe`, `supermarket`, `store`, `entertainment`, `transit`, `friends`, `family`, `sport` |
| *Hide this place* | place with `hide: true` |

Once 5 or more places have a kind, Insights adds *Time by kind of place*: the time stayed at each kind in the filters, with how many places and the share of all your time.

On the map, every stay within a named place's radius counts as that one place: pins that fall inside it merge into a single pin, with one place page for all of it. The radius overrides the app's own grouping: it is checked against the places in your original data (each Google place, and each stay without one), so a place inside is always taken and one outside is always left, even if the app had grouped it with something on the other side of the line. Trips that start or end within the radius are labelled with its name.
| Set a trip's type | correction with `start` |
| *Same every weekday?* after correcting a commute (offered when 5+ similar trips exist) | routine |
| *Not this trip* on an inferred value | entry in that rule's `except` |
| *Turn off for these trips* in *Menu › MyRules* → *Show them*, *Trips like these* | the filters as an entry in that rule's `unless` |
| *Turn off for these trips*, *Just these trips* | an entry per trip in that rule's `except` |

The app never asks someone to type JSON. People who like files can still edit it and load it again.

**Exporting.** *Export MyRules* in the card downloads the `.myrules.json`. Because it contains places like home, the export button says so: "This file includes your home and work locations." The demo gets a small example file so the feature can be tried.

### Keeping MyRules in Google Drive

*Keep your rules* in the MyRules card is *On this device* (the default) or *In Google Drive*. *In Google Drive* keeps the document in one file, `btdt.myrules.json`, in the user's own Drive, so several devices share it. BT•DT signs in with Google Identity Services and asks only for the `drive.file` scope (the files it makes itself). It syncs when the app opens (while Google's one-hour sign-in lasts; after that a bar offers *Sync*), a moment after every change, and on *Sync*. Merging is rule by rule against the copy both sides had at the last sync: a rule added or changed on one device is kept, a rule deleted on one device and unchanged on the other is deleted, and a rule changed on both keeps the version from the document saved last (`about.updated`), with a note saying how many. Sections that aren't lists of rules with ids are merged as a whole the same way. Going back to *On this device* stops syncing and leaves the file in Drive.

### Cleaning up the corrections

Edits pile up over time: a trip fixed twice, a type set to what the files already said, a trip that is no longer in the data, bulk edits made in several goes. When some of them can be written more simply, the top of the rules sheet says so, with **Clean up rules**. It opens a preview with one group per kind of tidy-up, each with a count, a switch, and *See them* for the list:

- **Several edits on one trip** are joined into one edit per trip (the later one wins a field both set).
- **Type set to what your files already say** (not a guess, not taken by a routine or map snap, no other edit giving it another type, not a recorded activity) becomes *Type checked* (`checked: true`), which is all it did.
- **Edits on trips that aren't in your data** are deleted, but only for dates your loaded data covers, so rules for years you haven't loaded stay. In a bulk edit only the missing trips go.
- **Edits that change nothing** are deleted.
- **Bulk edits that do the same thing** are joined into one, when no other bulk edit, day or span between them touches their trips.

Your trips come out exactly as before: it only changes how the edits are written down. It counts as one change (*Cleaned up corrections: 120 → 96…*), and *Undo* at the top of the rules puts the file back as it was, until anything else changes or the page reloads. It needs your trips loaded and MyRules switched on, since it checks what each edit did. Routines, places, gear periods and map snaps are left alone.

### Changes that haven't been exported

The browser copy is often the only copy of rules made in the app, so the app has to keep track of what hasn't been saved anywhere else.

- **What counts as a change.** Any rule written, edited, switched on or off, or deleted in the app, and any *Not this trip*, since the file was last loaded or exported. The app keeps a counter and the time of the last export, next to the saved rules. Loading the same file again doesn't count as a change.
- **Showing it.** While there are changes, the MyRules card says *5 changes not exported* with a dot on *Export*. Exporting clears it.
- **Remove from this device.** When there are changes, tapping *Remove from this device* first shows a step about MyRules:
  1. "Your MyRules have 5 changes that are only on this device", with only the count. A **See the 5 changes** link opens the full list in its own sheet ("Strida EVO period added", "Not this trip on 14 Sep 2021"…), newest first, so a long list never crowds the dialog.
  2. **Download MyRules** (the main button) exports the file. Once the download has started, the dialog moves on to the usual removal confirmation.
  3. **Remove without saving** goes to the same confirmation, but the button there then says *Remove, and lose 5 changes*.
  4. **Cancel** removes nothing.

  With no changes it goes straight to the usual confirmation, which adds a line: "Your MyRules (14 rules) will be removed too. Your exported file has all of it."
- **Same check elsewhere.** Every other action that would drop changed rules shows the same step: *Replace* when loading another MyRules file, and importing new location files in a way that replaces the saved import, if that also replaces the context. *Merge* keeps them, so it doesn't ask.
- **Browser storage cleared outside the app** (site data deleted, private window) can't be caught. The MyRules card says "Saved in this browser only. Export to keep a copy." until the first export, to cover this case.

---

## 9. Suggested build order

1. **Slice 1: gear periods and places** (done; the smallest useful piece, and the most reliable inference). Load and save the file, the Imported data card and rules list, inferred flag and badges, trip details section with *Not this trip*, the gear assignment sheet that writes rules, export, and the Filters change.
2. **Slice 2: corrections** (done). `mode`, `gear`, `name`, `hide`; *Trip info* in trip details writes them. `replace` comes later.
3. **Slice 3: routines** (done). `mode`, `gear` and `snap` (learned, polyline and GeoJSON lines); *Same on other days?* after *Trip info* writes them.
4. **Later:** publish the schema at a stable URL, a small MyRules validator page.

---

## 10. Decisions (15 Nov 2026)

- **Name: MyRules.** Files are `*.myrules.json`, and the version key is `"myrules"`.
- **Format: JSON only** for now. No YAML, so no parser library is needed.
- **Gear periods never overrule recorded gear.** Strava or activity-file gear always stays. Only a correction on a single trip can change recorded gear. Gear rules have no `force`.
- **Hidden places are not blurred** on the map. `hide` only leaves them out of pins and the heatmap.
