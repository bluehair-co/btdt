# BT•DT design rules

The rules David has set for how BT•DT looks and behaves, collected from the project's history. Follow them for every new feature, and when a feature breaks one, fix it in the same PR.

## Keeping the interface calm

- **Long explanations go behind an (i) button.** A card, panel, section, switch or dialog shows only its short label and controls. Any sentence that explains what something shows, how a number is worked out or what a switch does goes behind the (i) next to it. Use the helpers in `core.js`: `infoHead()` for a heading with its explanation, `infoBtn()` + `infoBox()` next to a switch or label, `infoMore()` for a short line with more behind it, and `mrAsk`'s `info` for dialogs. Insights cards use `.info-btn` + `.info-text` inside `.card-head`. The click handler in `data.js` opens the box named by the button's `aria-controls`. Status lines (how many points were left out, which packs are kept) stay in view. This rule dates from the first UI clean-up (8 Nov 2026) and was applied across the whole app on 20 Nov 2026 (PR #219). Every new feature must follow it from the start.
- **Show only the filters that matter.** Years and Months only show for *All*; Days of the week only for *All* and *Date range*. Choices that already pin the days hide the rest.
- **Less prominent by default.** Secondary features (for example the My Edits summary in Filters) sit in a small section at the bottom with a count and a button, not as a big block at the top.
- **The landing page stays short:** the picture, the tagline, *Load location files*, *Try the demo*, the supported services as small tags below the separator, and the *About* (i) and *How to get your files* (?) entry points. Longer text belongs in those two modals.
- **Fixed places for fixed controls.** The Filters button (Material's filter_alt) is at the left of the top bar and the Menu button (Material's menu, three lines) at its right, the same on every tab and screen size. Playback (bottom left) and Views and layers (bottom right) sit beside the dock-like tab bar on desktop and never inside it. Calendars and pickers keep the same size so buttons don't move.

## One home per job (UX clean-up, Nov 2026)

Every place in the app answers one question, and a new feature goes where its question is answered. This came out of the UX audit of 20 Nov 2026; the app before it is kept on the `v1.0` branch.

- **Filters**: what am I looking at? Only filters: *When* (Navigator, All, Date range), *More about when* (years, months, days of the week, time of day, closed unless one is in use), transport, countries, source. Filters in use show as chips at the top, each with ✕.
- **Menu** (the three-line button): my data and the app. *Your data* (files, import, export, Home, remove), *My Edits*, *Trip cleanup* (every switch that changes how trips are split or drawn, and the packs they need), *Preferences* (units, dates, theme, heart rate, CO₂), *About*. Each page has a back arrow to the Menu, and each Menu row shows what is on right now.
- **The map's ⋮ button** (a small round button right of the dock) opens one menu: *Playback*, *Views and layers*, then the map tools. Left of the dock, *Zoom to all trips* slides in only while some trips are out of view (from the left on a phone, from below on a desktop); the zoom buttons don't have it.
- **Map sheet** (*⋮ › Views and layers*): how the map looks. The view, *Colour lines by* (Transport, Speed, Heart rate, No lines), the heatmap, the legend, and what sits on top. Actions on the map are not here.
- **Map tools** (the lower items of the ⋮ menu): things you do on the map, such as *Select trips on the map* and *New map snap*. A new map action goes in this menu, not as another floating button. While one runs (selecting trips, making a map snap, ignoring GPS points), the top bar, tabs and map buttons step aside so only the map, the tool's bar and its own panel show.
- **Trip pages:** the header (icon, title, the facts that matter) with a pencil at its right. The pencil opens the trip's edit menu: *Trip info* (type, title, gear), *Split trip*, *Ignore GPS points* and *Hide this trip*. Anything you can change about one trip lives in that menu. Beside the pencil, ⋯ (`moreMenu`) holds the rest: *Group with similar trips*, *Show this day on the map*, *Open in Timeline* and *Raw data*. A trip page has no row of buttons under its header.
- **Place pages:** the header, then one row with the main action (*Edit this place* or *Name this place*; *Show on the map* for a town), at most one outline button beside it (*Show on the map*) and ⋯ (`moreMenu`) for the rest (*Open in Google Maps*, *This place moved…*).
- **My Edits rows** show the name and two facts; the rest of what a rule does sits behind its (i).
- **One door per thing.** A feature has one entry point and one name. Don't add a second button for something that already has one.
- **Importance sets depth.** What drives the app sits shallow; rarely changed settings can sit a level deeper.
- **A choice of one is a segmented control**, never switches that turn each other off.
- **One main action per sheet**, at most one outline button beside it, the rest grouped or in a ⋯ menu (the button version of the (i) rule).

## Patterns for every new feature

| Pattern | Rule |
|---|---|
| Sheet header | ‹ back when drilled in · title · (i) · at most one action · ✕ |
| Buttons | One filled button per sheet or dialog, at most one outline button, the rest in ⋯ (`moreMenu`) |
| Switch rows | Label · (i) · switch, with a status line underneath that stays in view |
| A choice of one | A segmented control, never switches that turn each other off |
| Names | One name per thing: *Zoom to all trips*, *Export trips*, *Export My Edits file*, *Station packs* |
| Where it goes | A filter › Filters · how the map looks › map sheet · an action on the map › *Map tools* · a change to how trips are cleaned › *Menu › Trip cleanup* · an action on one trip › its pencil menu · a new Insights card › one of its groups (Scores, Overview, Places, Countries, Fitness, CO₂) |
| Lists of trips | One tap opens the trip. Where the main map isn't in view, the sheet shows the trip's own map at the top. |

## Feedback while the app works

- **Every action that saves shows the "Working on it…" pill at once** (`saving(fn)` or `working(text, fn)` in `core.js`): a spinner pill and a veil over the page, fading in after 150 ms so quick changes don't flash. That covers switches (applying rules, snapping trains to tracks or cars to roads, splitting trips) and every tap that saves: *[type] is right*, *Undo*, *Not this trip*, *Hide this trip*, *Keep as one trip*, *Use Google's location*, merging places, and the *Save*, *Delete* and *Remove* buttons of every dialog (`mrAsk` does this for its primary and danger buttons). A tap must never look like nothing happened.
- **Bars over the app are prompts** (`promptBar()` in `core.js`, `.prompt` in `app.css`). Anything that floats over the map or the app with a short message and a few buttons (*Sync My Edits with Google Drive*, the bar of *Select trips*, *Ignore GPS points*, *This was a stay*, *Split trip*, *New map snap*, walks that may be stays, the road-snapping pill) is a prompt, so they all look and fit the same: an icon or spinner, a bold title and a muted line of text, buttons on the right, a × when it can be put away. On a wide screen it is as wide as its content, centred; on a phone it takes the full width less 12 px each side, and the buttons move to a line of their own when they don't fit beside the text. A map tool's prompt (`mode: true`) sits at the top of the screen while the top bar steps aside; any other sits just under the top bar. Never centre a floating element with `left: 50%` and a transform without giving it a width: the browser then fits it into half the screen and the words wrap word by word. A new floating prompt uses `promptBar()`, never its own bar.
- **Downloads show a progress bar** (station and road packs, and *Getting the map ready…* before playback, in the Working pill with `workingBar()`). Once a pack is on the device, turning its switch off and on again only shows the spinner; nothing is downloaded twice.
- **Playback moves stay light.** While playback moves the map between trips, the place names fade out and come back once it has landed. The trip lines stay, except when the map zooms in far past where the move began (after a long trip): they fade out then, since the map would only stretch them, and back in once redrawn.
- **The loading screen** (`busy()` in `core.js`): a donut that fills with progress around an icon that changes between transport types, pins and landmarks. It must keep moving through every step, including *Opening your saved trips*.

## Honesty about data

- **Never pass off a guess as a recording.** Guessed types are marked and can be checked (*Check*), fixed trips are flagged in their details, values from My Edits are tagged *Rule applied* or *Map snap*, and the user's own fixes are tagged *Edited*. Every change can be undone per trip and per rule.
- **Rules apply fully or not at all.** A routine sets type, line and gear together; a trip it can't fully apply to is left alone. A generic "Vehicle" counts as undefined.
- **Show what a rule would do,** even when it is switched off, instead of a bare 0.
- **Generic, not personal.** Fixes for one person's data (an office Google moved, a bike owned between two dates) become features driven by My Edits, never special cases in code.

## Privacy and attribution

- Files are read on the device and never uploaded. Anything fetched from the internet is fetched only when the user asks (a country's pack, *Get the name from OpenStreetMap*, *Use the line from OpenStreetMap*), sends as little as possible, and is described in About → *How it works*.
- **Credits:** every library, data source, service or asset that needs attribution gets a line in About → *Credits & license*, with its licence, in the same PR that adds it. The README's license section lists them too. (The landing picture is credited as made with Google Gemini.)
- The app is CC BY-NC 4.0 by BlueHair; the BlueHair name and logo are not covered.

## Look

- **Design tokens.** Every colour, font, text size, spacing step and corner rounding is a named token at the top of `source/src/app.css`. Use the token, never a raw value: `var(--fs-sm)` not `13px`, `var(--sp-4)` not `8px`, `var(--r-md)` not `10px`, `var(--rule)` not `#0f7c8c`. In JavaScript, read colours with `cssVar('--name')` (Leaflet and canvas need the actual colour) or pass `'var(--name)'` into HTML. A colour the app needs that has no token gets a new one, with a comment saying what it is for.
  - Spacing is `--sp-N`, N steps of `--space-unit` (2px): `--sp-4` is 8px. Changing `--space-unit` makes the whole app roomier or tighter.
  - Text sizes run `--fs-3xs` (10px) to `--fs-3xl` (20px, sheet titles); body text is `--fs-md` (14px). Corners run `--r-xs` (4px) to `--r-sheet` (22px), plus `--r-pill`.
  - Odd one-off values (1px, 3px, 5px, chart labels at 9.5px, fluid `clamp()` sizes) stay as they are. If one starts being used in several places, make it a token.
- **The dark theme is written once:** `:root[data-theme="dark"]` holds only the tokens that differ. `data-theme` is always `light` or `dark` (an inline script in `<head>` sets it before the page draws, and `applyTheme()` keeps it up to date), so there are no `prefers-color-scheme` copies. Give a component a themed colour by adding a token with a light and a dark value, not a dark-only rule.
- **v2.0: printed in three inks.** The app looks like a Risograph print of its landing picture: paper (`--bg`), the blue ink (`--fg`, `--accent` in light), the pink ink (`--pink`; the accent in dark) and the yellow ink (`--chip-on-bg`: anything selected). Dark mode is the same print on night-blue paper.
  - **Panels are paper left blank for the print (the off-print rule).** Everything that floats over the app is a sheet of paper with ink printed on it: the bars, the dock, the playback bar, map buttons (zoom, round buttons), sheets and side panels, menus, prompts, dialogs (About) and the landing panel. Three layers, each a little out of register:
    1. the **paper** (`--paper`, the panel colour; yellow when a round button is pressed), fed slightly crooked: a small tilt and a 1–2px shift;
    2. the **pink block** (`--offset`) behind it, 3–5.5px down and right;
    3. the **ink outline** (1.5px `--edge`), printed on top with its own small shift (up to 2px) and tilt.
    The content (text, icons, controls) is printed straight. **Every sheet gets its own random tilt and offsets each time it appears** (`paperize()` in `core.js`, with a MutationObserver that catches panels as they open); the tilt is capped so a panel's far edge moves no more than about 3px (at most 0.7°, 1.3° for the legend). Corners are `--paper-r` (4px); round buttons are round paper. Panels that sit against a screen edge (phone sheets and the About sheet on a phone) lie straight and are open along that edge. The map legend is a tilted slip of paper with no outline and no block; its transport colours are dots with their off-print (pink, blue under the yellow cycling dot). Add a new floating panel to `PAPER_SEL` in `core.js` and to the paper rules in `app.css`; give it no border, background or box-shadow of its own. Tooltips and the Working pill keep the solid ink edge.
    Buttons, chips, segmented controls and switches are outlined in ink and are not paper.
  - **Insights cards are printed sheets:** no outline and no block, 2px corners, crop marks round every card and a colour bar (the inks and their tints) under the first card of each section. What a card shows is printed: big numbers with the yellow highlighter, bars as dot screens in their ink, records as ticket stubs, routes as transit lines, place totals as postmarks, gear as luggage tags, charts with the ink grain (`filter: url(#riso)`). Score cards may later get a treatment of their own (torn from a pad, or taped in).
  - The map's Esri tiles are tinted into paper and blue ink by two blend layers (`tintMap` in `map.js`), with a paper grain. Yellow cycling lines get an ink casing on the light map (`casedLine`).
- The landing picture (`landing-riso.webp`) is artwork, not UI; the landing page looks the same in light and dark. The name is a passport stamp (SVG in `app.html`) dated today in the user's date format.
- Fonts: Bricolage Grotesque (titles, big numbers), IBM Plex Sans / Mono, and IBM Plex Sans Condensed for stamp and ticket lettering.
- Icons: [Phosphor](https://phosphoricons.com) (MIT), duotone for transport and places (a line drawing and a soft shape, like two inks) and bold for the interface, written into `core.js` by `source/icons/phosphor.py`. Transport and place badges are round, ringed in ink, with a small pink offset. The Halfbike, Strida and cargo bike gear icons are custom drawings in the same duotone style (`source/icons/gear/`, written into `PH` by the same script); the other gear icons (e-bike, handcycle) and the score and loader art are still the older Material-style ones. Hidden places show the crossed-out eye; Family has its own icon.
- **One badge.** Every transport and place badge is built by `badgeHtml(bg, icon, small)` in `core.js` (`badge()` for a trip's type): round, ringed in ink, with the icon in `--badge-ink`, or `--on-bike` on the yellow cycling fill (class `bike`). Build a badge with it, never by hand.
- Country flags are printed in the inks: one sprite, `flags.png`, made by `source/icons/flags.py` from flag-icons (MIT). `flag(cc)` returns HTML, so never put it inside `esc()`.
- Each transport kind has its own colour token (`--m-road`, `--m-transit`, `--m-bike`, `--m-foot`, `--m-air`, `--m-water`) used everywhere: lines, icons, legends, filters. Cycling is the yellow ink; icons on it use `--on-bike`.
- Light and dark themes (*Menu › Preferences*, or the system's). Check both.
- **Playback is a mode of its own.** Opening playback on the Map hides everything else (top bar, dock, round buttons, legend, zoom); only the map, the playback bar at the bottom, the date on a bare slip of paper top left (like the legend) and a round Close button top right stay. Close (or Escape) brings the rest back. Playback is not remembered between visits.
- **The loading screen is stamps, not a spinner.** Stamps land one after another (`busy()` in `core.js`), each with its own shape (round, oval, hexagon, framed, postage stamp, date stamp), ink and icon, close together at new random places every round; then the page clears and a new round starts. The text under them says what is being read, with the percentage. Dates and times on the stamps follow *Preferences*.
- **One spinner for the whole app: the spin pill.** A slip of paper in the middle of the screen with a yellow block under it, holding the spinner (a faint ink ring with a yellow arc and its blue off-print), the text and, when there is one, a progress bar. The Working pill (`working()`, `saving()`, `workingBar()`) is one, with its veil that takes taps; `spinPill(id, text, frac)` in `core.js` puts up others that leave the page usable (the road snapping pill). Never make another spinner: use these.
- **The heatmap is printed in the three inks:** yellow, then pink, then blue (pink over blue in between); on night paper it runs blue, pink, yellow, paper.
- Phone first, desktop too: sheets slide up from the bottom on a phone and open as side panels on desktop. Every touch interaction (lasso, one-finger zoom, sliders) must work with a finger.
- **Local settings everywhere.** Units, dates and times follow the device's region by default and can be changed in *Menu › Preferences*. Every label follows them: distances, speeds and per-distance figures (km or miles), short distances (m or ft), date order and 12/24-hour time, in results and also in form fields, their labels, info texts and examples. Nothing is hard-coded to km or to one date format. Check new UI in both kilometres and miles.

## Process

- When David asks for a mockup first, make the mockup (screenshots or a small HTML page), wait for his pick, then build.
- Show screenshots of new UI on a phone and a desktop viewport.
- Name things in the UI with plain verbs: *Trip info*, *Edit this place*, *Group with similar trips*, *Turn off for these trips*, *Keep as one trip*.
