# BT;DT (Been There · Done That)

See where you've been and how you get around, from your Google Timeline. Your Timeline file is read on your device and is never uploaded.

Live app: https://bluehair-co.github.io/btdt/

- The files at the top of this repository are the published app (`index.html`, the manifest, service worker and icons).
- `source/` holds the source and the build script; `python3 source/build.py` rebuilds into `source/dist/`.
- Bad GPS jumps (a stray fix kilometres off the route, or a stale home position) are left out of trips when the app opens; see *Bad GPS jumps* in `source/README.md`.
- Trips that disagree with the stays next to them (a stale start or end, time parked counted as driving, or a distance that is only the straight line) are fixed too; see *Trips that disagree with their stays* in `source/README.md`.
- Stays Google moved to a place's new location (an office that relocated after you left) are put back where their GPS points say you were; see *Places Google moved* in `source/README.md`. Load Timeline.json again to apply it.

## License

BT;DT is by [BlueHair](https://www.bluehair.co) and licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/): anyone may use, copy and change it for non-commercial purposes, as long as they credit the original ("Based on BT;DT by BlueHair, www.bluehair.co"). See `LICENSE`. The BlueHair name and logo are not covered.

Third-party parts keep their own licenses: Leaflet (BSD 2-Clause), Esri map tiles (Esri terms of use), Natural Earth borders and OurAirports airports (public domain), GeoNames towns (CC BY 4.0), the IANA time zone database (public domain), UK government conversion factors (Open Government Licence v3.0), and Bricolage Grotesque and IBM Plex fonts (SIL Open Font License).
