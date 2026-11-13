// Offline support for BT•DT. The page and its libraries are cached so the
// app opens without a connection; map tiles are cached as you look at them.
// Timeline files are never fetched or cached here: they are read straight from the device.
var VERSION = 'btdt-v60';
var SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './favicon.ico', './favicon.svg', './landing-1600.webp', './landing-bg-1600.webp', './landing-bg-2752.webp', './landing-fg-1600.webp', './landing-fg-2752.webp', './bluehair-logo.png'];
var LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js'
];
var TILES = 'btdt-tiles';
var MAX_TILES = 3000;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(SHELL).then(function () {
      return Promise.all(LIBS.map(function (u) { return c.add(u).catch(function () { /* fetched later */ }); }));
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION && k !== TILES; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function cacheFirst(req, name) {
  return caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res.ok || res.type === 'opaque') {
        var copy = res.clone();
        caches.open(name).then(function (c) { c.put(req, copy); if (name === TILES) trim(c); });
      }
      return res;
    });
  });
}

var trimming = false;
function trim(c) {
  if (trimming) return;
  trimming = true;
  c.keys().then(function (keys) {
    return Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_TILES)).map(function (k) { return c.delete(k); }));
  }).then(function () { trimming = false; }, function () { trimming = false; });
}

// The page itself: newest version when online, cached copy when not.
function networkFirst(req) {
  return fetch(req).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) { return hit || caches.match('./index.html'); });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin === self.location.origin) { e.respondWith(networkFirst(req)); return; }
  if (url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req, VERSION));
    return;
  }
  if (url.hostname === 'server.arcgisonline.com' && url.pathname.indexOf('/tile/') > 0) {
    e.respondWith(cacheFirst(req, TILES));
  }
});
