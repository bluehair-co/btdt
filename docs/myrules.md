# MyRules files — draft spec v0.1

*Version 0.1, 15 Nov 2026. BT•DT applies gear periods, places, routines (`mode`, `gear`, `snap`) and corrections (`mode`, `gear`, `name`, `hide`); §9, slices 1 to 3. `replace` corrections are read, kept and exported again, but not applied yet.*

A **MyRules file** holds the things only you know about your own history: which bike you owned when, where home and work were, the train you took to work every weekday, the day Timeline got completely wrong. You load it next to your location files. BT•DT applies it on top of what it read from them, and marks everything it changed as **inferred**, so a guess never passes for a recording.

The app stays generic: nothing about any one person is built in. And because the format is open and versioned, other tools could read and write the same file.

The JSON Schema is published with the app at [`schema/myrules-0.1.json`](../schema/myrules-0.1.json), and [`myrules-example.json`](myrules-example.json) is a complete example covering every rule type.

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
| Version | `"myrules": "0.1"`. A minor bump (0.2) only adds things. A major bump may change meaning, and the app refuses a major version it doesn't know, with a message. |
| Schema | `"$schema": "https://bluehair-co.github.io/btdt/schema/myrules-0.1.json"` (optional; to be published with the app). |
| Unknown keys | Kept on export, so a file written by a newer app or another tool round-trips. Keys starting with `x-` are for tool-specific extensions. |
| Unknown rule types | Skipped with a notice ("2 rules of a newer kind were skipped"), never an error. |

### Top level

```json
{
  "$schema": "https://bluehair-co.github.io/btdt/schema/myrules-0.1.json",
  "myrules": "0.1",
  "about": { "name": "David's context", "updated": "2026-11-14T21:40:00Z", "generator": "BT•DT 2.4" },
  "places": [ … ],
  "gear": [ … ],
  "routines": [ … ],
  "corrections": [ … ]
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

---

## 4. Referring to a trip: `TripRef`

Corrections and exceptions have to point at one trip in a way that survives a re-import, so they never use the app's internal trip numbers.

```json
{ "start": "2024-03-06T08:12+01:00" }
{ "start": "2024-03-06T08:12+01:00", "mode": "CAR" }
{ "day": "2024-03-06" }
{ "span": ["2024-03-06T07:00+01:00", "2024-03-06T11:00+01:00"] }
```

- `start` matches the trip that starts within **±3 minutes** of it. That is enough to survive the small shifts from re-exporting Timeline or fixing a stale start, and small enough not to catch the next trip. If two trips fall in the window, `mode` (the type it had when the ref was made) picks one; if it is still ambiguous, the ref matches nothing and the app lists it under "Rules that matched nothing".
- `day` matches every trip that day; `span` matches every trip starting inside it.

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

What a place does: it names stays, decides the Home pin, and anchors routines (`"from": "@home-oudwest"`). Places don't change trips.

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
| `kind` | `bike`, `strida`, `halfbike`, `cargo`, `ebike`, `shoe`, `other`. Picks the icon, as the app already does for Strava gear. |
| `mode` | The transport type it applies to: `CYCLING`, `RUNNING`, `WALKING`… (the app's own type names). |
| `match` | Optional narrowing: `min_km`, `max_km`, `sports` (e.g. `["Mountain bike"]`), `from`/`to` (place ids: only rides starting or ending there), `weekdays_only`. |
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

A routine matches trips that start within 500 m of `from` and end within 500 m of `to` (places' own radius if larger), inside `when`. With `both_ways`, the reverse trip matches too, inside `return_when` (which defaults to `when`).

`then` says what to do with a match:

| Action | Meaning |
|---|---|
| `mode` | Set the transport type. Applied only when the type is missing or was guessed from speed, unless `"force": true` is set on the routine. |
| `gear` | Give it a gear (`"@strida-evo"`): for a bike commute. |
| `snap` | Redraw the trip along a known line instead of its GPS points (below). |

**Where the line for `snap` comes from.** The app runs offline with no routing server, so it can't look up train tracks the way the simulated-trips generator does with BRouter. The line comes from one of these:

- `"learn"`: the app picks the cleanest trip that matches the routine as the line for the rest. Cleanest means the most GPS points per km with no gap over 2 minutes, preferring a recorded activity or Records.json line. The trip details of a snapped trip say which trip it was taken from, and you can pick another one. This works for most commutes, since a few hundred trips almost always include one good one.
- An encoded polyline in the file: `"snap": { "polyline": "…" }` (Google's polyline encoding, 5 decimals). Tools that can route, like our generator, can write this.
- A GeoJSON file loaded at the same time: `"snap": { "geojson": "utrecht-line.geojson" }`.

**What snapping does.** It cuts the line between the points nearest the trip's start and end, and spreads the trip's own start and end times along it in proportion to distance. The distance becomes the line's length. The original GPS points are kept and drawn dashed in the trip details, and **Raw data** still shows them. A trip whose own points stray more than 1 km from the line for over a third of its length is not snapped, because it was probably a different route that day (a diversion, a bus replacement) and is listed in the rule's details as "didn't fit".

**In BT•DT.**

- `from` and `to` are a place (`"@office"`) or a position (`[52.364, 4.866]`), matched within 500 m (or the place's radius, if larger).
- Of the routines that match a trip, the one with the shorter `when` wins, then the later one in the file.
- `mode` follows the table above. A routine's `gear` fills trips without gear, before gear periods.
- **The learned line** comes from the matching trip with the most GPS points per km and no gap over 2 minutes. A recorded activity or a Records.json line counts double.
- **Picking another line:** *Use this trip's line* in a trip's details writes `"snap": { "trip": TripRef }`.
- **GeoJSON lines:** a `.geojson` named by a routine's `snap.geojson` is read as that line (its LineString, or the longest part of a MultiLineString) when loaded with the rules or after them. It is kept with your rules in the browser.
- **How it shows:** snapped trips and types a routine set are marked *Inferred*. The rules sheet says where each line came from and how many trips didn't fit.
- **Seeing what it covers:** while you make a routine (*Same on other days?*) or edit one (tap it in the rules sheet), a small map shows the trips it would cover as ghost lines, with how many there are and how many would change type. It updates as you change the dates, times and options, before you save.
- **Making a routine in the app:** after you change a trip's type with *Edit trip*, the app offers *Same on other days?* if you made 5 or more trips like it. Like it means the same ends within 500 m, on the same kind of day, starting within 2 hours of it. It fills in:
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
| `mode`, `gear`, `name` | Set the type, gear or title. Corrections are explicit, so they replace recorded values too. `gear` is a gear period's id (`"@strida-evo"`) or a gear's name as your activity files record it (`"Gazelle"`). |
| `hide` | Leave the matched trips out everywhere (map, totals, export). Undo shows them again. `"hide": false` on a later or narrower correction shows a trip a wider one hid. |
| `replace` | Replace everything in the span or day with one trip, written like a simulated trip (airports by IATA code or place id). This is a one-line version of the existing `"simulated": true` files. |

A correction on a day or span that sets `gear` only fills trips without recorded gear; only one on a single trip (`start`) replaces it. A trip's `start` matches the trip that starts within 3 minutes of it; add the type the files gave it (`"mode"` in the TripRef) to pick between two. Setting a type also clears *guessed from speed*, and a Strava sport of another type.

### 5.5 How corrections show in the app

Anything a correction sets is marked **Edited** rather than *Inferred*: it is your own fix, not a guess, so the *Guessed and inferred* filter leaves it alone. The trip details list each change ("Type: Train (was cycling)") with **Undo**, which drops that action from a correction on one trip, or adds the trip to the `except` of a correction on a day or span. **Edit trip** in the trip details sets the type, title and *Hide this trip*, and writes them into one correction for that trip (made when needed, updated after, removed once empty); *Set gear → Just this trip* writes into the same one. Hidden trips can be opened again from the correction in the rules sheet.

---

## 6. Order and precedence

Rules are applied in one pass after the files are read and cleaned (after the bad-GPS-jump, stale-end and places-moved fixes), so they work on the cleanest data the app has.

1. **Recorded beats inferred.** A value the data recorded (Strava gear, a type Timeline gave and that fits the speed) is kept. Gear periods and routines only fill in what is missing or was guessed. Only corrections overrule recorded values, with one exception: a routine with `"force": true` may replace a recorded transport type. Nothing but a correction replaces recorded gear.
2. **Specific beats general.** For each field of each trip, the most specific rule that matches decides:
   1. corrections naming one trip (`start`),
   2. corrections naming a span or a day,
   3. routines,
   4. gear periods with a `match`,
   5. gear periods without one.
3. **Ties within a level.** A shorter `when` wins (a two-week period beats a two-year one). If it is still a tie, the rule later in the file wins for corrections (the newest fix), but for gear periods the trip gets nothing and is flagged as ambiguous (§5.2).
4. **`except` always wins.** A trip listed in a rule's `except` is skipped by that rule, and the next rule down may still apply.
5. **Places apply first**, since routines and gear matches refer to them.

Each trip keeps a list of what changed it, so the app can always show "why".

---

## 7. How "inferred" shows in the app

The app already shows two kinds of uncertainty: *type guessed from speed* and *Simulated*. Inferred values work the same way.

- **Data.** A new trip flag, `inferred` (next to `type guessed from speed` in the flags list), plus a per-trip list of `{ field, value, was, rule }`. Raw data and the JSON/CSV export include it.
- **Badges.** A trip with an inferred gear, type or line says *Inferred* in the lists and on its gear, in the same style as the existing *Simulated* tag.
- **Trip details.** A "From MyRules" section lists each change, like "Gear: Strida EVO (was none), from *Strida EVO, Mar 2021 to Aug 2023*". Each line has **Not this trip**, which adds the trip to the rule's `except`.
- **Snapped lines** are drawn solid, with the original GPS points dashed and faded under them in the trip details only.
- **Filters.** The existing *Guessed types* control becomes *Guessed and inferred*: All, Leave out, Only these. A gear period's gear gets a chip under its type like Strava gear, and when it has a `strava_name`, it shares the chip.
- **One switch for all.** Settings → MyRules has a master switch. Off shows the data exactly as the files had it, which is handy for checking a rule.

---

## 8. Loading, editing and exporting

**Loading.** The file goes through the same *Load location files* button (or with a folder or ZIP). It is saved in the browser with the rest of the import, never uploaded. Loading a second MyRules file asks whether to **merge** (rules with the same `id` are replaced) or **replace**.

**Where it lives in the UI.** A *MyRules* card in **Imported data**, under the location files, showing the rule count and how many trips it changed, with *Open*. Opening it lists the rules by section, each with its own switch, the number of trips it changed, and a tap-through to those trips in the Timeline.

**Editing in the app writes rules.**

| You do this | It writes this |
|---|---|
| Set a trip's gear, choosing *Just this trip* | correction with `start` |
| Set a trip's gear, choosing *All rides without gear from … to …* (dates prefilled from the first and last ride with this gear) | gear period |
| Name a stay or mark it *Home* / *Work* | place, with `when` from the first to last stay there |
| Mark a home, work or school *Current* or *Past* | place with `role`, and `when.to` for a past one |
| Say what kind of place it is (Restaurant, Bar / café, Supermarket, Store, Public transport stop, Friends, and the others) | place with `role`: `restaurant`, `cafe`, `supermarket`, `store`, `transit`, `friends`, `family`, `sport` |
| *Hide this place* | place with `hide: true` |

Once 5 or more places have a kind, Insights adds *Time by kind of place*: the time stayed at each kind in the filters, with how many places and the share of all your time.

On the map, every stay within a named place's radius counts as that one place: pins that fall inside it merge into a single pin, with one place page for all of it. The radius overrides the app's own grouping: it is checked against the places in your original data (each Google place, and each stay without one), so a place inside is always taken and one outside is always left, even if the app had grouped it with something on the other side of the line. Trips that start or end within the radius are labelled with its name.
| Set a trip's type | correction with `start` |
| *Same every weekday?* after correcting a commute (offered when 5+ similar trips exist) | routine |
| *Not this trip* on an inferred value | entry in that rule's `except` |

The app never asks someone to type JSON. People who like files can still edit it and load it again.

**Exporting.** *Export MyRules* in the card downloads the `.myrules.json`. Because it contains places like home, the export button says so: "This file includes your home and work locations." The demo gets a small example file so the feature can be tried.

### Changes that haven't been exported

The browser copy is often the only copy of rules made in the app, so the app has to keep track of what hasn't been saved anywhere else.

- **What counts as a change.** Any rule written, edited, switched on or off, or deleted in the app, and any *Not this trip*, since the file was last loaded or exported. The app keeps a counter and the time of the last export, next to the saved rules. Loading the same file again doesn't count as a change.
- **Showing it.** While there are changes, the MyRules card in Imported data says *5 changes not exported* with a dot on *Export*. Exporting clears it.
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
2. **Slice 2: corrections** (done). `mode`, `gear`, `name`, `hide`; *Edit trip* in trip details writes them. `replace` comes later.
3. **Slice 3: routines** (done). `mode`, `gear` and `snap` (learned, polyline and GeoJSON lines); *Same on other days?* after *Edit trip* writes them.
4. **Later:** publish the schema at a stable URL, a small MyRules validator page.

---

## 10. Decisions (15 Nov 2026)

- **Name: MyRules.** Files are `*.myrules.json`, and the version key is `"myrules"`.
- **Format: JSON only** for now. No YAML, so no parser library is needed.
- **Gear periods never overrule recorded gear.** Strava or activity-file gear always stays. Only a correction on a single trip can change recorded gear. Gear rules have no `force`.
- **Hidden places are not blurred** on the map. `hide` only leaves them out of pins and the heatmap.
