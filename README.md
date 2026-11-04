# BT;DT (Been There · Done That)

See where you've been and how you get around, from your Google Timeline. Your Timeline file is read on your device and is never uploaded.

Live app: https://bluehair-co.github.io/btdt/

- The files at the top of this repository are the published app (`index.html`, the manifest, service worker and icons).
- `source/` holds the source and the build script; `python3 source/build.py` rebuilds into `source/dist/`.
- Bad GPS jumps (a stray fix kilometres off the route, or a stale home position) are left out of trips when the app opens; see *Bad GPS jumps* in `source/README.md`.
