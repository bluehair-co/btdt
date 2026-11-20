# BT•DT design rules

The rules David has set for how BT•DT looks and behaves, collected from the project's history. Follow them for every new feature, and when a feature breaks one, fix it in the same PR.

## Keeping the interface calm

- **Long explanations go behind an (i) button.** A card, panel, section, switch or dialog shows only its short label and controls. Any sentence that explains what something shows, how a number is worked out or what a switch does goes behind the (i) next to it. Use the helpers in `core.js`: `infoHead()` for a heading with its explanation, `infoBtn()` + `infoBox()` next to a switch or label, `infoMore()` for a short line with more behind it, and `mrAsk`'s `info` for dialogs. Insights cards use `.info-btn` + `.info-text` inside `.card-head`. The click handler in `data.js` opens the box named by the button's `aria-controls`. Status lines (how many points were left out, which packs are kept) stay in view. This rule dates from the first UI clean-up (8 Nov 2026) and was applied across the whole app on 20 Nov 2026 (PR #219). Every new feature must follow it from the start.
- **Show only the filters that matter.** Years and Months only show for *All*; Days of the week only for *All* and *Date range*. Choices that already pin the days hide the rest.
- **Less prominent by default.** Secondary features (for example the MyRules summary in Filters) sit in a small section at the bottom with a count and a button, not as a big block at the top.
- **The landing page stays short:** the picture, the tagline, *Load location files*, *Try the demo*, the supported services as small tags below the separator, and the *About* (i) and *How to get your files* (?) entry points. Longer text belongs in those two modals.
- **Fixed places for fixed controls.** The filter button is at the left of the top bar and the Settings gear at its right, the same on every tab and screen size. Playback (bottom left) and Views and layers (bottom right) sit beside the dock-like tab bar on desktop and never inside it. Calendars and pickers keep the same size so buttons don't move.

## Feedback while the app works

- **Any switch that makes the app work for a while shows the "Working on it…" pill** (`working(text, fn)` in `core.js`): a spinner pill and a veil over the page, fading in after 150 ms so quick changes don't flash. Applying rules, snapping trains to tracks or cars to roads, splitting trips and similar switches all use it.
- **Downloads show a progress bar** (station and road packs). Once a pack is on the device, turning its switch off and on again only shows the spinner; nothing is downloaded twice.
- **The loading screen** (`busy()` in `core.js`): a donut that fills with progress around an icon that changes between transport types, pins and landmarks. It must keep moving through every step, including *Opening your saved trips*.

## Honesty about data

- **Never pass off a guess as a recording.** Guessed types are marked and can be checked (*Check*), fixed trips are flagged in their details, values from MyRules are tagged *Rule applied* or *Map snap*, and the user's own fixes are tagged *Edited*. Every change can be undone per trip and per rule.
- **Rules apply fully or not at all.** A routine sets type, line and gear together; a trip it can't fully apply to is left alone. A generic "Vehicle" counts as undefined.
- **Show what a rule would do,** even when it is switched off, instead of a bare 0.
- **Generic, not personal.** Fixes for one person's data (an office Google moved, a bike owned between two dates) become features driven by MyRules, never special cases in code.

## Privacy and attribution

- Files are read on the device and never uploaded. Anything fetched from the internet is fetched only when the user asks (a country's pack, *Get the name from OpenStreetMap*, *Use the line from OpenStreetMap*), sends as little as possible, and is described in About → *How it works*.
- **Credits:** every library, data source, service or asset that needs attribution gets a line in About → *Credits & license*, with its licence, in the same PR that adds it. The README's license section lists them too. (The landing picture is credited as made with Google Gemini.)
- The app is CC BY-NC 4.0 by BlueHair; the BlueHair name and logo are not covered.

## Look

- Fonts: Bricolage Grotesque (titles, tagline in a thin weight) and IBM Plex Sans / Mono.
- Icons: Google Material Icons, filled; the generic cycling icon is Material's pedal bike, with custom icons for specific gear (Strida, Halfbike, cargo bike) drawn to match it.
- Each transport kind has its own colour token (`--m-road`, `--m-transit`, `--m-bike`, `--m-foot`, `--m-air`, `--m-water`) used everywhere: lines, icons, legends, filters.
- Light and dark themes (Settings, or the system's). Check both.
- Phone first, desktop too: sheets slide up from the bottom on a phone and open as side panels on desktop. Every touch interaction (lasso, one-finger zoom, sliders) must work with a finger.
- Units, dates and times follow the device's region by default and can be changed in Settings; nothing is hard-coded to km or to one date format.

## Process

- When David asks for a mockup first, make the mockup (screenshots or a small HTML page), wait for his pick, then build.
- Show screenshots of new UI on a phone and a desktop viewport.
- Name things in the UI with plain verbs: *Edit trip*, *Edit this place*, *Find similar trips*, *Turn off for these trips*, *Keep as one trip*.
