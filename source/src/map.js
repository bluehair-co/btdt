// ---------- trips on the map ----------
var map = null, pinLayer = null, speedLayer = null, sqLayer = null, pathLayer = null, renderer = null, ccLayer = null, heatLayer = null, hlLayer = null, posMarker = null, curLine = null;
var hits = [], lines = [], groupLines = [], many = false, mapBounds = [], fitKey = null, hovered = [];
var visibleB = 0;   // trips sel[0 .. visibleB-1] are drawn; the time slider lowers it
var HIT_PX = coarse ? 12 : 7, LINE_W = 2.5, LINE_OP = 0.55;
var PATH_NOTE = 'Lines follow the GPS trail Timeline recorded for each trip. Trips without a trail are drawn straight from start to end, and flights follow the shortest path over the globe. Tap a line for the trip.';

function tripPath(i) {
  var a = [D.from[2 * i], D.from[2 * i + 1]], b = [D.to[2 * i], D.to[2 * i + 1]];
  if (modeOf(i) === 'FLYING' && isFinite(a[0]) && isFinite(b[0])) return greatCircle(a, b);
  var o0 = D.pathOff[i], o1 = D.pathOff[i + 1], pts = [];
  for (var j = o0; j < o1; j++) pts.push([D.pathPts[2 * j], D.pathPts[2 * j + 1]]);
  if (pts.length < 2) pts = [a, b].filter(function (p) { return isFinite(p[0]); });
  return pts;
}
// The trail with the time of each point, in seconds since the trip started.
function trail(i) {
  var pts = tripPath(i), dur = Math.max(0, (D.end[i] - D.start[i]) / 1000), ts = [], o0 = D.pathOff[i], o1 = D.pathOff[i + 1];
  if (modeOf(i) !== 'FLYING' && o1 - o0 >= 2) for (var j = o0; j < o1; j++) ts.push(D.pathT[j]);
  else for (var k = 0; k < pts.length; k++) ts.push(pts.length > 1 ? dur * k / (pts.length - 1) : 0);
  return { pts: pts, ts: ts };
}
// Where the trip was at time t (ms), and its trail up to there.
function along(i, t) {
  var tr = trail(i), s = (t - D.start[i]) / 1000, p = tr.pts, ts = tr.ts;
  if (!p.length) return null;
  if (s <= ts[0]) return { ll: p[0], upto: [p[0]] };
  for (var j = 1; j < p.length; j++) {
    if (s <= ts[j]) {
      var f = ts[j] > ts[j - 1] ? (s - ts[j - 1]) / (ts[j] - ts[j - 1]) : 1;
      var q = [p[j - 1][0] + (p[j][0] - p[j - 1][0]) * f, p[j - 1][1] + (p[j][1] - p[j - 1][1]) * f];
      return { ll: q, upto: p.slice(0, j).concat([q]) };
    }
  }
  return { ll: p[p.length - 1], upto: p };
}
function greatCircle(a, b) {
  var r = Math.PI / 180, la1 = a[0] * r, lo1 = a[1] * r, la2 = b[0] * r, lo2 = b[1] * r;
  var d = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin((la2 - la1) / 2), 2) + Math.cos(la1) * Math.cos(la2) * Math.pow(Math.sin((lo2 - lo1) / 2), 2)));
  if (d < 0.02) return [a, b];
  var pts = [], N = 48, prev = null;
  for (var j = 0; j <= N; j++) {
    var f = j / N, A1 = Math.sin((1 - f) * d) / Math.sin(d), B1 = Math.sin(f * d) / Math.sin(d);
    var x = A1 * Math.cos(la1) * Math.cos(lo1) + B1 * Math.cos(la2) * Math.cos(lo2);
    var y = A1 * Math.cos(la1) * Math.sin(lo1) + B1 * Math.cos(la2) * Math.sin(lo2);
    var z = A1 * Math.sin(la1) + B1 * Math.sin(la2);
    var lat = Math.atan2(z, Math.sqrt(x * x + y * y)) / r, lng = Math.atan2(y, x) / r;
    // Keep longitudes continuous so routes across the date line don't wrap around the map.
    if (prev != null) while (lng - prev > 180) lng -= 360;
    if (prev != null) while (prev - lng > 180) lng += 360;
    prev = lng; pts.push([lat, lng]);
  }
  return pts;
}

function addTiles(m) {
  var svc = isDark() ? 'Canvas/World_Dark_Gray_Base' : 'Canvas/World_Light_Gray_Base';
  if (m._tl) m._tl.forEach(function (l) { m.removeLayer(l); });
  if (!m.getPane('labels')) { m.createPane('labels'); m.getPane('labels').style.zIndex = 450; m.getPane('labels').style.pointerEvents = 'none'; }
  m._tl = [
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/' + svc + '/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 16, attribution: 'Tiles &copy; Esri' }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/' + svc.replace('_Base', '_Reference') + '/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 16, pane: 'labels' })
  ];
  m._tl.forEach(function (l) { l.addTo(m); });
}
function initMap() {
  if (map) return true;
  if (!window.L) { $('map').innerHTML = '<p class="empty" style="padding-top:40vh">The map library couldn\'t load. Check your internet connection and reload.</p>'; return false; }
  map = L.map('map', { preferCanvas: true, worldCopyJump: true, minZoom: 2, zoomControl: !coarse }).setView([50, 8], 4);
  if (map.zoomControl) map.zoomControl.setPosition('topleft');
  addTiles(map);
  map.createPane('cc'); map.getPane('cc').style.zIndex = 320;
  map.createPane('heat'); map.getPane('heat').style.zIndex = 380; map.getPane('heat').style.pointerEvents = 'none';
  renderer = L.canvas({ padding: 0.4, tolerance: 0 });
  pathLayer = L.layerGroup();
  ccLayer = L.layerGroup();
  pinLayer = L.layerGroup();
  speedLayer = L.layerGroup();
  sqLayer = L.layerGroup();
  hlLayer = L.layerGroup().addTo(map);
  heatLayer = new HeatLayer();
  posMarker = L.marker([0, 0], { icon: posIcon(null), interactive: false, keyboard: false, zIndexOffset: 1000 });
  posMarker._mode = null;
  var spT = 0;
  map.on('moveend', function () { clearTimeout(spT); spT = setTimeout(speedMoved, 120); });
  map.on('click', function (e) { onMapTap(map.latLngToContainerPoint(e.latlng), e.originalEvent); });
  if (!coarse) {
    var raf = 0, last = null;
    map.on('mousemove', function (e) { last = e; if (!raf) raf = requestAnimationFrame(function () { raf = 0; onMapHover(last); }); });
    map.on('mouseout', function () { setHovered([]); hideTip(); });
  }
  return true;
}
function mapReset() { fitKey = null; if (P) P.fitted = false; highlight(null); stopPlay(); }

function renderMapTab() {
  var ok = PREFS.proj === 'merc' ? initMap() : true;
  if (map) map.invalidateSize();
  if (dirty.map) {
    dirty.map = false;
    if (map || initMap()) buildPaths();
    heatDirty = true;
    updateTopbar();
    legend();
    var key = F.dm + '|' + (F.dm === 'one' ? periodStart(F.one, F.unit) + F.unit : '') + '|' + F.from + '|' + F.to;
    if (key !== fitKey) { fitKey = key; fitAll(); }
  }
  if (map) {
    layerToggles();
    if (PREFS.heat && heatDirty) heatLayer.redraw();
  }
  if (PREFS.proj !== 'merc') drawProj();
  return ok;
}
function groupColor(g) { return cssVar(g.v); }
function buildPaths() {
  pathLayer.clearLayers(); hlLayer.clearLayers(); hits = []; lines = []; groupLines = []; hovered = []; curLine = null;
  many = sel.length > 6000;
  mapBounds = [];
  var colors = {};
  GROUPS.forEach(function (g) { colors[g.key] = groupColor(g); });
  for (var k = 0; k < sel.length; k++) {
    var i = sel[k], m = modeOf(i), pts = tripPath(i);
    if (pts.length < 2) continue;
    mapBounds.push(pts[0], pts[pts.length - 1]);
    var bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (var q = 0; q < pts.length; q++) {
      if (pts[q][0] < bb[0]) bb[0] = pts[q][0]; if (pts[q][1] < bb[1]) bb[1] = pts[q][1];
      if (pts[q][0] > bb[2]) bb[2] = pts[q][0]; if (pts[q][1] > bb[3]) bb[3] = pts[q][1];
    }
    var h = { i: i, k: k, parts: [pts], bb: bb, w: LINE_W, color: colors[groupOf(m).key] };
    hits.push(h);
    if (!many) {
      h.line = L.polyline(pts, { renderer: renderer, color: h.color, weight: LINE_W, opacity: LINE_OP, lineCap: 'round', lineJoin: 'round', interactive: false });
      pathLayer.addLayer(h.line);
      lines[k] = h.line;
    }
  }
  visibleB = sel.length; prevCur = null; P_pos = null; P_cur = null;
  if (many) buildGroups(sel.length);
  scrubV = 1000; $('scrub').value = 1000;
  if (map.hasLayer(posMarker)) map.removeLayer(posMarker);
  $('mapNote').textContent = PATH_NOTE + (many ? ' With this many trips, overlapping lines are drawn together to keep the map quick.' : '') +
    (PREFS.proj !== 'merc' ? ' ' + PROJ_NOTES[PREFS.proj] : '');
}
// With very many trips, each transport group becomes one multi-line so the map stays fast.
function buildGroups(limit) {
  groupLines.forEach(function (l) { pathLayer.removeLayer(l); });
  groupLines = [];
  var by = {};
  hits.forEach(function (h) { if (h.k < limit) (by[h.color] || (by[h.color] = [])).push(h.parts[0]); });
  Object.keys(by).forEach(function (c) {
    var l = L.polyline(by[c], { renderer: renderer, color: c, weight: LINE_W - 0.5, opacity: LINE_OP, lineCap: 'round', lineJoin: 'round', interactive: false });
    pathLayer.addLayer(l); groupLines.push(l);
  });
}
// What the coloured paths show: speed, or heart rate zones (which move with your maximum heart rate).
function pathsKey() { return PREFS.hrPaths ? 'hr' + hrMax() : 'speed'; }
function layerToggles() {
  [[sqLayer, PREFS.squares], [pathLayer, PREFS.paths], [speedLayer, PREFS.speedPaths || PREFS.hrPaths], [ccLayer, PREFS.cc], [heatLayer, PREFS.heat], [pinLayer, PREFS.pins]].forEach(function (x) {
    if (x[1] && !map.hasLayer(x[0])) map.addLayer(x[0]);
    if (!x[1] && map.hasLayer(x[0])) map.removeLayer(x[0]);
  });
  if (PREFS.cc && ccLayer._ver !== ccVer()) buildCC();
  if (PREFS.pins && (pinLayer._ver !== selVer() || pinLayer._d !== D)) buildPins();
  if (PREFS.squares && (sqLayer._ver !== applyCount || sqLayer._d !== D)) buildSquares();
  if ((PREFS.speedPaths || PREFS.hrPaths) && (speedLayer._ver !== applyCount || speedLayer._d !== D || speedLayer._m !== pathsKey() || speedLayer._z !== map.getZoom() || !speedLayer._b || !speedLayer._b.contains(map.getBounds()))) buildSpeed();
}

// ---------- explorer squares ----------
// Zoom 14 map tiles (about 1.5 km across in the Netherlands) that the trips shown passed through,
// leaving out flights. Lines are followed a quarter of a square at a time; a straight stretch
// over 30 squares (a long jump between GPS points, or a trip with only its ends) only counts
// its ends, so it doesn't paint a line of squares you never saw.
var SQ_Z = 14, SQ_N = 1 << SQ_Z, SQ = null;
function sqXY(ll) {
  var la = Math.max(-85.05, Math.min(85.05, ll[0])) * Math.PI / 180;
  return [(ll[1] + 180) / 360 * SQ_N, (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * SQ_N];
}
function sqLat(y) { var n = Math.PI - 2 * Math.PI * y / SQ_N; return 180 / Math.PI * Math.atan(Math.sinh(n)); }
function sqLng(x) { return x / SQ_N * 360 - 180; }
function explorer() {
  if (SQ && SQ.ver === applyCount && SQ.d === D) return SQ;
  var sq = new Map(), k, i;
  function mark(x, y, i_) {
    x = ((Math.floor(x) % SQ_N) + SQ_N) % SQ_N; y = Math.floor(y);
    if (y < 0 || y >= SQ_N) return;
    var key = x * SQ_N + y, o = sq.get(key);
    if (!o) sq.set(key, { t: D.start[i_], i: i_, n: 1, last: i_ });
    else if (o.last !== i_) { o.n++; o.last = i_; if (D.start[i_] < o.t) { o.t = D.start[i_]; o.i = i_; } }
  }
  for (k = 0; k < sel.length; k++) {
    i = sel[k];
    if (modeOf(i) === 'FLYING') continue;
    var p = tripPath(i);
    if (!p.length) continue;
    var a = sqXY(p[0]);
    mark(a[0], a[1], i);
    for (var j = 1; j < p.length; j++) {
      var b = sqXY(p[j]), dx = b[0] - a[0], dy = b[1] - a[1], L_ = Math.hypot(dx, dy);
      if (L_ <= 30) for (var s = 1, ns = Math.ceil(L_ / 0.25); s <= ns; s++) mark(a[0] + dx * s / ns, a[1] + dy * s / ns, i);
      else mark(b[0], b[1], i);
      a = b;
    }
  }
  // The cluster: squares with all four neighbours visited, and the biggest 4-connected block of them.
  function has(x, y) { return sq.has(x * SQ_N + y); }
  var inner = new Set(), keys = Array.from(sq.keys()), best = [];
  keys.forEach(function (key) { var x = Math.floor(key / SQ_N), y = key % SQ_N; if (has(x - 1, y) && has(x + 1, y) && has(x, y - 1) && has(x, y + 1)) inner.add(key); });
  var seen = new Set();
  inner.forEach(function (key) {
    if (seen.has(key)) return;
    var comp = [], stack = [key]; seen.add(key);
    while (stack.length) {
      var c = stack.pop(), x = Math.floor(c / SQ_N), y = c % SQ_N; comp.push(c);
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { var nk = (x + d[0]) * SQ_N + y + d[1]; if (inner.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); } });
    }
    if (comp.length > best.length) best = comp;
  });
  // The max square: the biggest n × n block of visited squares (dynamic programming, row by row).
  keys.sort(function (p_, q) { return p_ % SQ_N - q % SQ_N || p_ - q; });
  var dp = new Map(), mx = 0, at = null;
  keys.forEach(function (key) {
    var x = Math.floor(key / SQ_N), y = key % SQ_N;
    var v = 1 + Math.min(dp.get((x - 1) * SQ_N + y) || 0, dp.get(x * SQ_N + y - 1) || 0, dp.get((x - 1) * SQ_N + y - 1) || 0);
    dp.set(key, v);
    if (v > mx) { mx = v; at = [x, y]; }
  });
  SQ = { ver: applyCount, d: D, sq: sq, cluster: new Set(best), max: mx, maxAt: at };
  return SQ;
}
function sqRing(key) {
  var x = Math.floor(key / SQ_N), y = key % SQ_N, n = sqLat(y), s = sqLat(y + 1), w = sqLng(x), e = sqLng(x + 1);
  return [[n, w], [n, e], [s, e], [s, w]];
}
function buildSquares() {
  sqLayer.clearLayers();
  sqLayer._ver = applyCount; sqLayer._d = D;
  var E = explorer(), plain = [], clus = [], acc = cssVar('--accent');
  E.sq.forEach(function (_, key) { (E.cluster.has(key) ? clus : plain).push(sqRing(key)); });
  var o = { renderer: renderer, color: acc, weight: 0.6, opacity: 0.5, fillColor: acc, interactive: false };
  if (plain.length) sqLayer.addLayer(L.polygon(plain, Object.assign({}, o, { fillOpacity: 0.18 })));
  if (clus.length) sqLayer.addLayer(L.polygon(clus, Object.assign({}, o, { fillOpacity: 0.42 })));
  if (E.max > 1) {
    var x = E.maxAt[0], y = E.maxAt[1];
    sqLayer.addLayer(L.rectangle([[sqLat(y - E.max + 1), sqLng(x - E.max + 1)], [sqLat(y + 1), sqLng(x + 1)]], { renderer: renderer, color: acc, weight: 2.5, opacity: 0.9, fill: false, interactive: false }));
  }
}
// What a square says when tapped or hovered with no line under it.
function squareAt(pt, ev) {
  if (!PREFS.squares || !D) return false;
  var ll = map.containerPointToLatLng(pt), xy = sqXY([ll.lat, ll.lng]), x = ((Math.floor(xy[0]) % SQ_N) + SQ_N) % SQ_N, o = explorer().sq.get(x * SQ_N + Math.floor(xy[1]));
  if (!o) return false;
  showTip(ev, '<b>First here ' + longDate(D.day[o.i]) + '</b><div class="row"><span>' + tripLabel(o.i) + ' · ' + esc(tripRoute(o.i)) + '</span></div><div class="row"><span>' + tripsText(o.n) + ' through this square in these filters</span></div>');
  return true;
}
function sqLegend() {
  var E = explorer(), acc = 'var(--accent)';
  return '<span><i style="background:' + acc + ';opacity:.3;height:10px"></i>' + fmt(E.sq.size) + ' squares</span>' + (E.cluster.size ? '<span><i style="background:' + acc + ';opacity:.6;height:10px"></i>Cluster ' + fmt(E.cluster.size) + '</span>' : '') +
    (E.max > 1 ? '<span><i style="border:2px solid ' + acc + ';background:none;height:8px;width:8px"></i>Max square ' + E.max + '×' + E.max + '</span>' : '');
}

// ---------- speed paths ----------
// The average speed of the trips shown along each stretch of the map, leaving out flights.
// Each trip's line is cut into stretches from one GPS point to the next, joined with the next
// ones until they last 20 seconds, so a dense recording (Strava) doesn't turn GPS jitter into
// speed; a trip with only its ends is one stretch at its average speed. The lines are then
// followed through a grid of 10-pixel cells at the map's zoom: every move from one cell to the
// next adds that stretch's speed to the link between the two cells, and each link is drawn
// between the middles of the points that fell in its cells, coloured by the average speed of
// everything that passed and thicker where more trips did. Only what's near the view is
// gathered, again after zooming or moving away, so it stays quick with tens of thousands of trips.
// Colour bands (km/h): the general scale, or one fitted to the transport shown when every trip in the
// filter is of one kind (cycling tops out at 30 km/h rather than 120), or one kind of Strava water or
// snow sport (paddling tops out at 10). Flights aren't drawn.
var SPEED_BANDS = [5, 10, 15, 25, 50, 80, 120];
var SPEED_FIT = [
  { modes: ['WALKING'], bands: [1, 2, 3, 4, 5, 6, 7] },
  { modes: ['RUNNING'], bands: [6, 8, 9, 10, 11, 12, 14] },
  { modes: ['WALKING', 'RUNNING'], bands: [2, 4, 6, 8, 10, 12, 14] },
  { modes: ['CYCLING'], bands: [6, 10, 14, 18, 22, 26, 30] },
  { modes: ['CAR', 'TAXI', 'VEHICLE', 'MOTORCYCLE', 'BUS'], bands: [10, 20, 30, 50, 70, 90, 120] },
  { modes: ['TRAM', 'SUBWAY'], bands: [5, 10, 15, 20, 30, 40, 60] },
  { modes: ['TRAIN'], bands: [20, 40, 60, 80, 100, 140, 200] },
  // Water and snow by Strava sport first (a trip of that mode with another sport, or none, moves on).
  { sports: ['kayak', 'canoe', 'sup', 'row', 'swim', 'surf'], bands: [1, 2, 3, 4, 6, 8, 10] },
  { sports: ['kitesurf', 'windsurf', 'sail'], bands: [4, 8, 12, 16, 20, 25, 30] },
  { modes: ['FERRY', 'BOAT'], bands: [3, 6, 10, 15, 20, 30, 40] },
  { sports: ['nordic', 'backcountry', 'snowshoe'], bands: [2, 4, 6, 8, 10, 14, 20] },
  { sports: ['alpine', 'snowboard'], bands: [5, 10, 20, 30, 40, 50, 70] },
  { sports: ['iceskate'], bands: [5, 10, 15, 20, 25, 30, 35] },
  { modes: ['SKIING'], bands: [3, 6, 10, 20, 30, 45, 70] },
  { sports: ['inline', 'skateboard', 'rollerski'], bands: [5, 10, 14, 18, 22, 26, 30] }
];
var SPEED_COLORS = ['#d7301f', '#f46d43', '#fdae61', '#fee08b', '#a6d96a', '#1a9850', '#2b83ba', '#5e3c99'];
var SPEED_CELL = 10;
var spBands = { ver: -1, d: null, bands: SPEED_BANDS };
function speedBands() {
  if (spBands.ver === applyCount && spBands.d === D) return spBands.bands;
  // Each kind of trip shown, as [mode, Strava sport key or ''].
  var seen = {}, list = [];
  for (var k = 0; k < sel.length; k++) {
    var m = modeOf(sel[k]), sp = D.sport && D.sport[sel[k]] ? SPORTS[D.sport[sel[k]]][0] : '';
    if (m !== 'FLYING' && !seen[m + sp]) { seen[m + sp] = 1; list.push([m, sp]); }
  }
  var fit = list.length ? SPEED_FIT.filter(function (f) {
    return list.every(function (x) { return f.modes && f.modes.indexOf(x[0]) >= 0 || f.sports && f.sports.indexOf(x[1]) >= 0; });
  })[0] : null;
  spBands = { ver: applyCount, d: D, bands: fit ? fit.bands : SPEED_BANDS };
  return spBands.bands;
}
function speedBand(kmh) { var B = speedBands(); for (var b = 0; b < B.length; b++) if (kmh < B[b]) return b; return B.length; }
// A trip's line as stretches of at least 20 seconds, each with its speed (km/h).
function speedRuns(i) {
  var tr = trail(i), p = tr.pts, ts = tr.ts, out = [];
  if (p.length < 2) return out;
  var hrs = (D.end[i] - D.start[i]) / 36e5, avg = hrs > 0 ? D.km[i] / hrs : 0;
  if (p.length === 2 || !(ts[ts.length - 1] > 0)) { out.push({ v: avg, pts: p }); return out; }
  var a = 0;
  while (a < p.length - 1) {
    var z = a + 1, km = haversine(p[a], p[z]);
    while (z < p.length - 1 && ts[z] - ts[a] < 20) { km += haversine(p[z], p[z + 1]); z++; }
    var dt = ts[z] - ts[a];
    out.push({ v: dt > 0 ? km / (dt / 3600) : avg, pts: p.slice(a, z + 1) });
    a = z;
  }
  return out;
}
function wpx(ll, s) {
  var la = Math.max(-85.05, Math.min(85.05, ll[0])) * Math.PI / 180;
  return [(ll[1] + 180) / 360 * s, (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * s];
}
function wll(x, y, s) { return [180 / Math.PI * Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y / s)), x / s * 360 - 180]; }
function buildSpeed() {
  speedLayer.clearLayers();
  var z = map.getZoom(), s = 256 * Math.pow(2, z), vb = map.getBounds().pad(0.5);
  speedLayer._ver = applyCount; speedLayer._d = D; speedLayer._u = PREFS.unit; speedLayer._z = z; speedLayer._b = vb; speedLayer._m = pathsKey();
  // Heart rate paths draw the same way, from the activities that recorded it.
  var hrm = PREFS.hrPaths, runs = hrm ? hrRuns : speedRuns, band = hrm ? hrZone : speedBand, colors = hrm ? HR_COLORS : SPEED_COLORS;
  var nw = wpx([vb.getNorth(), vb.getWest()], s), se = wpx([vb.getSouth(), vb.getEast()], s);
  var x0 = nw[0], y0 = nw[1], x1 = se[0], y1 = se[1], C = SPEED_CELL, R = 1 << 25;
  var cells = new Map(), links = new Map();
  function cell(id, x, y) {
    var c = cells.get(id);
    if (!c) cells.set(id, c = { x: 0, y: 0, n: 0 });
    c.x += x; c.y += y; c.n++;
  }
  for (var k = 0; k < hits.length; k++) {
    var h = hits[k], bb = h.bb;
    if (modeOf(h.i) === 'FLYING' || hrm && !tripHr(h.i) || bb[0] > vb.getNorth() || bb[2] < vb.getSouth() || bb[1] > vb.getEast() || bb[3] < vb.getWest()) continue;
    runs(h.i).forEach(function (r) {
      var prev = -1, a = wpx(r.pts[0], s);
      for (var j = 1; j < r.pts.length; j++) {
        var b = wpx(r.pts[j], s);
        if (Math.max(a[0], b[0]) < x0 || Math.min(a[0], b[0]) > x1 || Math.max(a[1], b[1]) < y0 || Math.min(a[1], b[1]) > y1) { a = b; prev = -1; continue; }
        var n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (C / 2)));
        for (var q = j === 1 ? 0 : 1; q <= n; q++) {
          var x = a[0] + (b[0] - a[0]) * q / n, y = a[1] + (b[1] - a[1]) * q / n, id = Math.floor(x / C) * R + Math.floor(y / C);
          cell(id, x, y);
          if (prev >= 0 && id !== prev) {
            var key = prev < id ? prev + '_' + id : id + '_' + prev, l = links.get(key);
            if (!l) links.set(key, l = { a: prev, b: id, v: 0, n: 0 });
            l.v += r.v; l.n++;
          }
          prev = id;
        }
        a = b;
      }
    });
  }
  // One line per colour and thickness.
  var by = {};
  links.forEach(function (l) {
    var A = cells.get(l.a), B = cells.get(l.b), w = l.n < 3 ? 0 : l.n < 10 ? 1 : 2, key = band(l.v / l.n) * 3 + w;
    (by[key] || (by[key] = [])).push([wll(A.x / A.n, A.y / A.n, s), wll(B.x / B.n, B.y / B.n, s)]);
  });
  Object.keys(by).map(Number).sort(function (p, q) { return p % 3 - q % 3 || p - q; }).forEach(function (key) {
    speedLayer.addLayer(L.polyline(by[key], { renderer: renderer, color: colors[Math.floor(key / 3)], weight: [2.5, 3.5, 5][key % 3], opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }));
  });
}
// After a zoom, or moving beyond what was gathered, gather again.
function speedMoved() {
  if (!(PREFS.speedPaths || PREFS.hrPaths) || !map.hasLayer(speedLayer)) return;
  var b = speedLayer._b;
  if (speedLayer._z !== map.getZoom() || !b || !b.contains(map.getBounds())) buildSpeed();
}
// ---------- heart rate ----------
// Heart rate an activity recorded (Strava, or any GPX, TCX or FIT file that has it): { t: seconds
// after the start, v: bpm }, or null. Trips without it are left out of everything below.
function tripHr(i) { var m = D.smeta && D.smeta[i]; return m && m.hr && m.hr.t.length >= 2 ? m.hr : null; }
// Five zones as a share of your maximum heart rate: under 60%, 60–70, 70–80, 80–90 and 90% and over.
var HR_ZONES = [
  { n: 'Z1', name: 'Recovery', lo: 0 }, { n: 'Z2', name: 'Endurance', lo: 0.6 }, { n: 'Z3', name: 'Tempo', lo: 0.7 },
  { n: 'Z4', name: 'Threshold', lo: 0.8 }, { n: 'Z5', name: 'Maximum', lo: 0.9 }];
// The same in both themes, on the map and in the charts: grey-blue, blue, green, amber, red.
var HR_COLORS = ['#8a9bb0', '#2a78d6', '#1baf7a', '#eda100', '#e34948'];
// Your maximum heart rate: the one set in Settings, or else the highest any activity held (its 99th
// percentile, so a strap's brief spike doesn't count). Kept per import.
var hrAuto = { d: null, v: 0, n: 0 };
function hrMaxAuto() {
  if (hrAuto.d === D) return hrAuto;
  var best = 0, n = 0;
  for (var i = 0; D && i < D.start.length; i++) {
    var h = tripHr(i);
    if (!h) continue;
    var v = h.v.slice().sort(function (a, b) { return a - b; }), p = v[Math.floor((v.length - 1) * 0.99)];
    if (p < 230) best = Math.max(best, p);
    n++;
  }
  hrAuto = { d: D, v: Math.round(best), n: n };
  return hrAuto;
}
function hrMax() { return PREFS.maxHr >= 100 ? PREFS.maxHr : hrMaxAuto().v || 190; }
function hrZone(bpm) { var f = bpm / hrMax(); for (var z = HR_ZONES.length - 1; z > 0; z--) if (f >= HR_ZONES[z].lo) return z; return 0; }
function hrZoneRange(z) {
  var m = hrMax(), lo = Math.round(HR_ZONES[z].lo * m), hi = z < HR_ZONES.length - 1 ? Math.round(HR_ZONES[z + 1].lo * m) - 1 : 0;
  return z === 0 ? 'under ' + (hi + 1) : hi ? lo + '–' + hi : lo + '+';
}
// Seconds in each zone. A sample counts until the next one, but no more than twice the usual gap,
// so a pause in the recording isn't counted as time in the zone it stopped in.
function hrZoneTimes(h) {
  var out = [0, 0, 0, 0, 0], gap = Infinity, j;
  for (j = 1; j < h.t.length; j++) gap = Math.min(gap, h.t[j] - h.t[j - 1]);
  if (!(gap > 0 && gap < Infinity)) gap = 5;
  for (j = 0; j < h.t.length; j++) out[hrZone(h.v[j])] += j < h.t.length - 1 ? Math.min(h.t[j + 1] - h.t[j], 2 * gap) : gap;
  return out;
}
// A trip's line as stretches of at least 20 seconds (as for speed paths), each with the average heart rate then.
function hrRuns(i) {
  var h = tripHr(i), tr = trail(i), p = tr.pts, ts = tr.ts, out = [];
  if (!h || p.length < 2 || !(ts[ts.length - 1] > 0)) return out;
  var a = 0, j = 0;
  while (a < p.length - 1) {
    var z = a + 1, s = 0, n = 0;
    while (z < p.length - 1 && ts[z] - ts[a] < 20) z++;
    // The average of the samples in the stretch, or the value at its middle if none fall inside.
    while (j < h.t.length && h.t[j] < ts[a]) j++;
    for (var q = j; q < h.t.length && h.t[q] <= ts[z]; q++) { s += h.v[q]; n++; }
    out.push({ v: n ? s / n : seriesAt(h.t, h.v, (ts[a] + ts[z]) / 2), pts: p.slice(a, z + 1) });
    a = z;
  }
  return out;
}
function hrLegend() {
  var any = false;
  for (var k = 0; k < sel.length && !any; k++) any = !!tripHr(sel[k]);
  if (!any) return '<span>No heart rate in the trips shown</span>';
  return '<span class="speed-legend hr-legend" title="Zones of a maximum heart rate of ' + hrMax() + ' bpm">Heart rate ' + HR_ZONES.map(function (z, k) { return '<span title="' + z.name + ', ' + hrZoneRange(k) + ' bpm"><i style="background:' + HR_COLORS[k] + '"></i>' + z.n + '</span>'; }).join('') + '</span>';
}
function speedLegend() {
  var lab = speedBands().map(function (v) { return fmt(distVal(v)); });
  return '<span class="speed-legend">Speed <span>' + lab[0] + '</span><i class="heat-scale" style="background:linear-gradient(90deg,' + SPEED_COLORS.join(',') + ')"></i><span>' + lab[lab.length - 1] + '+ ' + (PREFS.unit === 'mi' ? 'mph' : 'km/h') + '</span></span>';
}
// ---------- pins on regular places ----------
// A pin on each spot (see spotKey) you stayed at in the filters and have stayed at at least
// PIN_MIN times over your whole history, so one-off stops don't crowd the map. Tapping one
// opens its place page.
var PIN_MIN = 3, PIN_MAX = 400, pinOn = {}, pinKeys = [];
// The pins of the place page that's open stand out (red, larger, in front); the rest fade.
function setPinOn(keys) {
  pinKeys = keys || [];
  pinOn = {}; pinKeys.forEach(function (k) { pinOn[k] = 1; });
  if (!pinLayer) return;
  var any = pinKeys.length > 0;
  pinLayer.eachLayer(function (m) {
    var on = !!pinOn[m._key], el = m.getElement && m.getElement();
    m.setZIndexOffset(on ? 2000 : 0);
    m.setOpacity(any && !on ? 0.55 : 1);
    if (el && el.firstChild) el.firstChild.classList.toggle('on', on);
  });
}
function buildPins() {
  pinLayer.clearLayers();
  pinLayer._ver = selVer(); pinLayer._d = D;
  if (!D) return;
  needPlaces(); findHome();
  if (!D.spotN) { D.spotN = {}; for (var v = 0; v < D.vs.length; v++) if (D.pv[v] >= 0) { var k0 = spotKey(v); D.spotN[k0] = (D.spotN[k0] || 0) + 1; } }
  var inSel = [];
  for (var j = 0; j < selV.length; j++) if (D.pv[selV[j]] >= 0 && D.spotN[spotKey(selV[j])] >= PIN_MIN) inSel.push(selV[j]);
  var spots = spotsOf(inSel).sort(function (a, b) { return D.spotN[b.key] - D.spotN[a.key]; }).slice(0, PIN_MAX);
  spots.forEach(function (s) {
    var n = D.spotN[s.key], z = Math.round(Math.min(34, 20 + 4 * Math.log10(n)));
    var m = L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: '', html: '<div class="pin-ic' + (s.home ? ' home' : '') + '" style="width:' + z + 'px;height:' + z + 'px">' + icon(s.home ? 'home' : 'pin') + '</div>', iconSize: [z, z], iconAnchor: [z / 2, z * 1.25] }),
      title: spotName(s) + ' · ' + fmt(n) + ' visits', riseOnHover: true
    });
    m._key = s.key;
    m.on('click', function (e) { if (e.originalEvent) L.DomEvent.stop(e.originalEvent); openSpot(s.key); });
    m.on('add', function () { var el = m.getElement(); if (el && el.firstChild) el.firstChild.classList.toggle('on', !!pinOn[s.key]); });
    pinLayer.addLayer(m);
  });
  setPinOn(pinKeys);
}
function ccVer() { return selVer() + '|' + ccReach().key; }
function selVer() { return sel.length + ':' + (sel[0] || 0) + ':' + (sel[sel.length - 1] || 0) + ':' + selV.length; }
function fitAll() {
  if (PREFS.proj !== 'merc') { if (P) P.fitted = false; return; }
  if (!map) return;
  var b = mapBounds.slice();
  if (!b.length) for (var v = 0; v < selV.length; v++) b.push([D.vll[2 * selV[v]], D.vll[2 * selV[v] + 1]]);
  // Over many trips, leave out the few far-off ends so the map opens on where you usually are.
  // The demo opening on all its data shows every trip, the far-off holidays too.
  if (b.length > 40 && !(DEMO && F.dm === 'all')) {
    var la = b.map(function (p) { return p[0]; }).sort(function (x, y) { return x - y; }), lo = b.map(function (p) { return p[1]; }).sort(function (x, y) { return x - y; });
    var q = function (a, f) { return a[Math.floor((a.length - 1) * f)]; };
    b = [[q(la, 0.03), q(lo, 0.03)], [q(la, 0.97), q(lo, 0.97)]];
  }
  if (b.length) map.fitBounds(L.latLngBounds(b), { padding: wide() ? [100, 60] : [90, 40], maxZoom: 15 });
}
$('fitBtn').addEventListener('click', function () {
  if (PREFS.proj !== 'merc') { if (P) { P.fitted = false; drawProj(); } }
  else fitAll();
  if (!wide()) closeSheets();
});

// ---------- tapping and hovering lines ----------
function segDist(p, a, b) {
  var dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function hitsAt(pt) {
  if (!PREFS.paths && !PREFS.speedPaths && !PREFS.hrPaths) return [];
  var c1 = map.containerPointToLatLng([pt.x - HIT_PX, pt.y + HIT_PX]), c2 = map.containerPointToLatLng([pt.x + HIT_PX, pt.y - HIT_PX]);
  var out = [];
  for (var k = 0; k < hits.length; k++) {
    var h = hits[k], bb = h.bb;
    if (h.k >= visibleB || PREFS.hrPaths && !tripHr(h.i)) continue;
    // Quick box test first (lines across the date line skip it), then the exact distance in screen pixels.
    var wraps = bb[3] - bb[1] >= 180 || bb[1] < -180 || bb[3] > 180;
    if (!wraps && (bb[0] > c2.lat || bb[2] < c1.lat || bb[1] > c2.lng || bb[3] < c1.lng)) continue;
    var p = h.parts[0], prev = map.latLngToContainerPoint(p[0]), near = false;
    for (var j = 1; j < p.length && !near; j++) {
      var cur = map.latLngToContainerPoint(p[j]);
      if (segDist(pt, prev, cur) <= HIT_PX + h.w / 2) near = true;
      prev = cur;
    }
    if (near) out.push(h);
  }
  return out.sort(function (a, b) { return D.start[b.i] - D.start[a.i]; });
}
function onMapTap(pt, ev) {
  var list = hitsAt(pt);
  // On a phone with the chart open, the trip details are out of sight: a tap on an empty spot
  // leaves the chart open, and a tap on several trips closes it to list them.
  var phoneChart = chartPanelTrip != null && !wide();
  if (!list.length) { if (openId === 'tripSheet' && !phoneChart) closeSheets(); if (!squareAt(pt, ev)) hideTip(); return; }
  hideTip(); setHovered([]);
  if (list.length === 1) openTrip(list[0].i);
  else { if (phoneChart) chartPanelClose(); openList(list.map(function (h) { return h.i; })); }
}
function setHovered(list) {
  if (many) list = [];
  hovered.forEach(function (h) { if (list.indexOf(h) < 0 && h.line) h.line.setStyle({ opacity: LINE_OP, weight: h.w }); });
  list.forEach(function (h) { if (hovered.indexOf(h) < 0 && h.line) { h.line.setStyle({ opacity: 1, weight: h.w + 2 }); h.line.bringToFront(); } });
  hovered = list;
  if (map) map.getContainer().style.cursor = list.length ? 'pointer' : '';
}
function onMapHover(e) {
  if (hits.length > 8000) return;
  var list = hitsAt(e.containerPoint);
  setHovered(list);
  if (openId === 'tripSheet' || !list.length && !squareAt(e.containerPoint, e.originalEvent)) { hideTip(); return; }
  if (!list.length) return;
  showTip(e.originalEvent, hoverHtml(list.map(function (h) { return h.i; })));
}
function hoverHtml(list) {
  var rows = list.slice(0, 5).map(function (i) {
    var m = modeOf(i);
    return '<div class="row"><span><i style="background:' + modeColor(m) + '"></i>' + tripLabel(i) + ' · ' + niceDate(D.day[i]) + '</span><span class="num">' + dist(D.km[i]) + '</span></div>';
  }).join('');
  return '<b>' + (list.length === 1 ? esc(tripRoute(list[0])) : fmt(list.length) + ' trips here') + '</b>' + rows +
    (list.length > 5 ? '<div class="row"><span>+' + fmt(list.length - 5) + ' more</span></div>' : '');
}

// Stretches joined while they stay in one zone: [{ z, pts }].
function hrLines(runs) {
  var out = [];
  runs.forEach(function (r) {
    var z = hrZone(r.v), last = out[out.length - 1];
    if (last && last.z === z) last.pts = last.pts.concat(r.pts.slice(1));
    else out.push({ z: z, pts: r.pts.slice() });
  });
  return out;
}
// The trip that's open in the trip sheet, drawn on top.
var hlTrip = null;
function highlight(i) {
  hlTrip = i;
  if (hlLayer) {
    hlLayer.clearLayers();
    if (i != null && PREFS.proj === 'merc') {
      var pts = tripPath(i), c = groupOf(modeOf(i)).v;
      if (pts.length) {
        L.polyline(pts, { renderer: renderer, color: cssVar('--panel'), weight: 9, opacity: 0.9, interactive: false }).addTo(hlLayer);
        // With heart rate paths on, an activity that recorded it is coloured by zone, as its chart is.
        var runs = PREFS.hrPaths ? hrRuns(i) : [];
        if (runs.length) hrLines(runs).forEach(function (l) { L.polyline(l.pts, { renderer: renderer, color: HR_COLORS[l.z], weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(hlLayer); });
        else L.polyline(pts, { renderer: renderer, color: cssVar(c), weight: 5, opacity: 1, interactive: false }).addTo(hlLayer);
      }
    }
  }
  if (PREFS.proj !== 'merc' && P && P.proj) paintProj();
}

// ---------- trip sheet ----------
var listBack = null;
function placeOf(i, end) {
  var o = end ? 'to' : 'from', lat = D[o][2 * i], lng = D[o][2 * i + 1];
  if (!isFinite(lat)) return 'Unknown';
  needPlaces();
  var cc = D.ccList[end ? D.ce[i] : D.cs[i]];
  return esc(placeLabel(end ? D.pb[i] : D.pa[i])) + (cc ? ', ' + esc(country(cc)) : '');
}
function tripRows(i) {
  var m = modeOf(i), k = D.km[i], ms = D.end[i] - D.start[i], off = D.off[i], e = D.est[i];
  var line = haversine([D.from[2 * i], D.from[2 * i + 1]], [D.to[2 * i], D.to[2 * i + 1]]), nGps = D.pathOff[i + 1] - D.pathOff[i];
  var t0 = localTime(D.start[i], zoneAt(D.from[2 * i], D.from[2 * i + 1]), off), t1 = localTime(D.end[i], zoneAt(D.to[2 * i], D.to[2 * i + 1]), off);
  var src = e & 16 ? (actApp(i) ? 'from ' + esc(actApp(i)) : 'from the activity file') : isSim(i) ? 'simulated' : e & 8 || e & JUMPS && (e & 3) === 0 && D.orig[i] > 0 ? 'corrected' : (e & 3) === 1 ? 'along the GPS trail' : (e & 3) === 2 ? 'straight line' : 'from Timeline';
  var rows = [
    ['From', placeOf(i, false)], ['To', placeOf(i, true)],
    ['Start', t0.time + ' <span class="fine">' + t0.label + '</span>'],
    ['End', (t1.date !== t0.date ? t1.date + ', ' : '') + t1.time + (t1.label !== t0.label ? ' <span class="fine">' + t1.label + '</span>' : '')],
    ['Duration', ms > 0 ? duration(ms) : 'Not recorded'],
    ['Distance', dist(k) + ' <span class="fine">' + src + '</span>'],
    ['Straight line', isFinite(line) ? dist(line) : 'Unknown'],
    ['Average speed', ms > 0 ? speed(k / (ms / 36e5)) : 'Unknown'],
    ['CO₂', co2s(tripKg(i))],
    tripHr(i) ? ['Heart rate', hrAvgMax(tripHr(i))] : null,
    D.gear[i] ? ['Gear', '<span class="gear-kv"><span style="color:' + modeColor(M.gear[D.gear[i]].mode) + ';display:flex">' + icon(gearIcon(D.gear[i])) + '</span>' + esc(M.gear[D.gear[i]].name) + '</span>'] : null,
    ['GPS points', m === 'FLYING' ? 'None in the air' : fmt(nGps)]
  ].filter(Boolean);
  var notes = [];
  if (e & 16) notes.push(D.repl[i] ? 'Recorded ' + esc(actFrom(i)) + '. It replaces ' + (D.repl[i] === 1 ? 'the less precise trip' : D.repl[i] + ' less precise trips') + ' Timeline recorded at the same time.' : 'Recorded ' + esc(actFrom(i)) + '. Timeline has no trip at this time.');
  if (isDup(i)) notes.push('A recorded activity covers this trip too. It shows here because Timeline is the only source chosen; with ' + esc(actsLabel(D.stravaStats)) + ' included, the activity takes its place.');
  if (isSim(i)) notes.push('Simulated from a file you loaded, not recorded by Timeline. It replaces any exported trip at the same time.');
  if (e & PATH_TRIP) notes.push('Timeline kept GPS points here but no trip, so BT•DT made this trip from them.');
  if (e & 4 && e & 16) notes.push((D.stype && D.stype[i] ? (actApp(i) ? esc(actApp(i)) + ' calls' : 'Its file calls') + ' this activity “' + esc(D.stype[i]) + '”, which BT•DT doesn\'t match to a transport type yet' : (actApp(i) ? esc(actApp(i)) + ' gives' : 'Its file gives') + ' this activity no type') + ', so it is counted as ' + (LABEL[m] || m).toLowerCase() + ' from its average speed.');
  else if (e & 4) notes.push('Timeline gave this trip no transport type, or one that didn\'t fit its speed, so the type is guessed: from its speed, then from your labelled trips along the same line, and from railway stations at its ends.');
  if (e & RECORDS_GPS) notes.push('The line follows the GPS points from Records.json' + ((e & 3) === 1 ? ', and the distance is measured along them' + (D.orig[i] > 0 && Math.abs(D.orig[i] - k) > 0.05 * k ? ' (Timeline said ' + dist(D.orig[i]) + ').' : '.') : '.'));
  else if (D.orig[i] > 0 && D.orig[i] < k && (e & 3) === 1 && !(e & 8)) notes.push('Timeline recorded ' + dist(D.orig[i]) + ' for this trip, no more than the straight line between its ends, so BT•DT measures the distance along the GPS trail instead.');
  else if (D.orig[i] > 0 && (!(e & JUMPS) || e & 8)) notes.push('Timeline recorded ' + dist(D.orig[i]) + ' for this trip, which is impossible at its speed, so BT•DT uses the ' + ((e & 3) === 1 ? 'GPS trail' : 'straight line') + ' instead.');
  if (e & JUMPS) notes.push('Some GPS points here were bad (a fix that jumped impossibly far for a ' + (LABEL[m] || m).toLowerCase() + ' trip, an end at a stale position away from the stay next to it, or time parked counted as part of the trip), so the line, times and distance leave them out' + (D.orig[i] > k && !(e & (RECORDS_GPS | 8)) ? ' (Timeline recorded ' + dist(D.orig[i]) + ', counting them).' : '.'));
  if (m === 'FLYING') notes.push('The cities are the nearest airports to where the flight started and ended.');
  else if (nGps < 3 && !(e & 16) && !isSim(i)) notes.push('Timeline kept few or no GPS points for this trip, so its line joins the start and end.');
  return { t0: t0, rows: rows, notes: notes };
}
function hrAvgMax(h) {
  var s = 0, mx = 0;
  h.v.forEach(function (v) { s += v; mx = Math.max(mx, v); });
  return Math.round(s / h.v.length) + ' bpm <span class="fine">avg · ' + mx + ' max</span>';
}
// Time in each heart rate zone, as a bar split by zone and a row per zone.
function hrZonesBlock(i) {
  var h = tripHr(i);
  if (!h) return '';
  var zt = hrZoneTimes(h), tot = zt.reduce(function (a, b) { return a + b; }, 0) || 1;
  return '<div class="hr-zones"><div class="hz-head"><b>Heart rate zones</b><span class="fine">of a maximum of ' + hrMax() + ' bpm</span></div>' +
    '<div class="hz-bar" role="img" aria-label="Time in each heart rate zone">' + zt.map(function (t, z) { return t ? '<i style="width:' + (t / tot * 100).toFixed(2) + '%;background:' + HR_COLORS[z] + '"></i>' : ''; }).join('') + '</div>' +
    '<div class="hz-rows">' + HR_ZONES.map(function (Z, z) {
      var p = Math.round(zt[z] / tot * 100);
      return '<div class="hz-row' + (zt[z] ? '' : ' none') + '"><i style="background:' + HR_COLORS[z] + '"></i><span class="hz-n">' + Z.n + ' ' + Z.name + '</span><span class="fine">' + hrZoneRange(z) + ' bpm</span>' +
        '<span class="num">' + (zt[z] ? duration(zt[z] * 1000) : '–') + '</span><span class="num hz-p">' + p + '%</span></div>';
    }).join('') + '</div></div>';
}
// A Strava activity's own name is the title, with its sport under it.
function tripHead(i, sub) {
  var m = modeOf(i), r = tripRows(i), name = tripName(i);
  return '<div class="trip-head">' + badge(m, false, D.est[i] & 16 ? actApp(i) || true : 0, tripIcon(i)) + '<div><h3>' + (name ? esc(name) : tripLabel(i)) + (D.est[i] & 4 ? ' <span class="guess">Guessed</span>' : '') + simTag(i) + '</h3><p>' + (name ? tripLabel(i) + ' · ' : '') + (sub || longDate(D.day[i]) + ' · ' + r.t0.time) + '</p></div></div>';
}
// A Strava activity's description, as written.
function tripDesc(i) {
  var s = D.est[i] & STRAVA && stravaInfo(i);
  return s && s.desc ? '<p class="trip-desc">' + esc(s.desc).replace(/\n/g, '<br>') + '</p>' : '';
}
// ---------- speed and heart rate chart ----------
// Speed over the trip from its GPS points, over stretches of at least 20 seconds (as for speed paths;
// a Strava activity's from all its recorded points, see speedSeries),
// and the heart rate a Strava activity recorded, on one time axis: speed on the left scale, bpm on
// the right. Pointing at the chart (or tapping it) puts the trip's transport icon where it was then.
function tripSpeeds(i) {
  if (modeOf(i) === 'FLYING') return [];
  // A Strava activity keeps its speed from every recorded point.
  var sm = D.est[i] & STRAVA && D.smeta && D.smeta[i];
  if (sm && sm.spd) return sm.spd.t.map(function (t, k) { return [t, sm.spd.v[k]]; });
  var tr = trail(i), p = tr.pts, ts = tr.ts, out = [];
  if (p.length < 3 || !(ts[ts.length - 1] > 0)) return out;
  var a = 0;
  while (a < p.length - 1) {
    var z = a + 1, d = haversine(p[a], p[z]);
    while (z < p.length - 1 && ts[z] - ts[a] < 20) { d += haversine(p[z], p[z + 1]); z++; }
    var dt = ts[z] - ts[a];
    if (dt > 0) { out.push([ts[a], d / (dt / 3600)]); out.push([ts[z], d / (dt / 3600)]); }
    a = z;
  }
  return out;
}
// Round tick steps for a scale up to max.
function niceStep(max, n) {
  var raw = max / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}
// Charts drawn now, by where they are: 'sheet' (trip details) and 'panel' (under the map, on desktop).
var charts = {};
// The chart of trip i at W×H (viewBox units; the panel's match its pixels so text keeps its size).
// The readout line above the chart always takes its room, so pointing at the chart doesn't move it.
function tripChart(i, where, W, H) {
  var sp = tripSpeeds(i), hr = tripHr(i);
  delete charts[where];
  if (sp.length < 4 && !hr) return '';
  var dur = Math.max(1, (D.end[i] - D.start[i]) / 1000), L0 = 34, R0 = hr ? 34 : 10, T0 = 10, B0 = 22;
  var w = W - L0 - R0, h = H - T0 - B0, x = function (t) { return L0 + w * Math.max(0, Math.min(1, t / dur)); };
  var smax = 0, k, ticks = Math.max(3, Math.min(8, Math.round(h / 32)));
  for (k = 0; k < sp.length; k++) smax = Math.max(smax, distVal(sp[k][1]));
  // A GPS spike shouldn't flatten the rest: the scale goes to the 98th percentile of speed.
  var sv = sp.map(function (q) { return distVal(q[1]); }).sort(function (a, b) { return a - b; });
  if (sv.length) smax = Math.min(smax, sv[Math.floor(sv.length * 0.98)] * 1.15);
  var ss = niceStep(smax || 1, ticks), stop = Math.ceil((smax || 1) / ss) * ss;
  var hmin = 0, hmax = 0, hs = 1;
  if (hr) {
    hmin = Math.min.apply(null, hr.v); hmax = Math.max.apply(null, hr.v);
    hs = niceStep(Math.max(10, hmax - hmin), ticks); hmin = Math.floor(hmin / hs) * hs; hmax = Math.max(hmin + hs, Math.ceil(hmax / hs) * hs);
  }
  var ys = function (v) { return T0 + h * (1 - Math.min(1, v / stop)); }, yh = function (v) { return T0 + h * (1 - (v - hmin) / (hmax - hmin)); };
  var g = '', col = cssVar(groupOf(modeOf(i)).v);
  for (var v = 0; v <= stop + 1e-9; v += ss) g += '<line x1="' + L0 + '" x2="' + (L0 + w) + '" y1="' + ys(v).toFixed(1) + '" y2="' + ys(v).toFixed(1) + '" class="tc-grid"/><text x="' + (L0 - 5) + '" y="' + (ys(v) + 3.5).toFixed(1) + '" text-anchor="end" class="tc-ax">' + fmt(v, ss % 1 ? 1 : 0) + '</text>';
  if (hr) for (v = hmin; v <= hmax + 1e-9; v += hs) g += '<text x="' + (L0 + w + 5) + '" y="' + (yh(v) + 3.5).toFixed(1) + '" class="tc-ax tc-hr">' + fmt(v) + '</text>';
  // Time ticks about every 70 units of width.
  var steps = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600], ms = steps[steps.length - 1];
  for (k = 0; k < steps.length; k++) if (dur / steps[k] <= w / 70) { ms = steps[k]; break; }
  for (var t = 0; t <= dur; t += ms) g += '<text x="' + x(t).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" class="tc-ax">' + (t >= 3600 ? Math.floor(t / 3600) + ':' + pad2(Math.round(t % 3600 / 60)) : Math.round(t / 60) + (t ? '′' : '')) + '</text>';
  var sl = sp.map(function (q) { return x(q[0]).toFixed(1) + ',' + ys(distVal(q[1])).toFixed(1); }).join(' ');
  // The heart rate line is coloured by zone, as the route is with heart rate paths on.
  var hl = '';
  if (hr) {
    var seg = [], sz = -1;
    hr.t.forEach(function (t, j) {
      var z = hrZone(hr.v[j]), pt = x(t).toFixed(1) + ',' + yh(hr.v[j]).toFixed(1);
      if (z !== sz && seg.length) { seg.push(pt); hl += '<polyline points="' + seg.join(' ') + '" fill="none" stroke="' + HR_COLORS[sz] + '" stroke-width="1.6" stroke-linejoin="round"/>'; seg = []; }
      seg.push(pt); sz = z;
    });
    if (seg.length > 1) hl += '<polyline points="' + seg.join(' ') + '" fill="none" stroke="' + HR_COLORS[sz] + '" stroke-width="1.6" stroke-linejoin="round"/>';
  }
  charts[where] = { i: i, sp: sp, spT: sp.map(function (q) { return q[0]; }), spV: sp.map(function (q) { return q[1]; }), hr: hr, dur: dur, L0: L0, w: w, W: W };
  var unit = PREFS.unit === 'mi' ? 'mph' : 'km/h';
  return '<div class="trip-chart" data-k="' + where + '">' +
    '<div class="tc-key">' + (sp.length >= 4 ? '<span><i style="background:' + col + '"></i>Speed (' + unit + ')</span>' : '') + (hr ? '<span><i style="background:linear-gradient(90deg,' + HR_COLORS.join(',') + ')"></i>Heart rate (bpm, by zone)</span>' : '') +
    // On a phone the panel goes with the map, so the button is only there on the Map tab.
    (where === 'sheet' && (wide() || tab === 'map') ? '<button type="button" class="icon-btn tc-open" data-act="chart" data-i="' + i + '" aria-label="Open the chart under the map" title="Open under the map">' + icon('expand') + '</button>' : '') + '</div>' +
    '<div class="tc-read" aria-live="off"></div>' +
    '<svg class="tc-svg" viewBox="0 0 ' + W + ' ' + H + '"' + (where === 'panel' ? ' width="' + W + '" height="' + H + '"' : '') + ' role="img" aria-label="' + (hr ? 'Speed and heart rate' : 'Speed') + ' over the trip">' + g +
    (sp.length >= 4 ? '<polyline points="' + sl + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-linejoin="round"/>' : '') +
    hl +
    '<line y1="' + T0 + '" y2="' + (T0 + h) + '" class="tc-cur" visibility="hidden"/></svg></div>';
}
// The value of a series (times tt, values vv) at time t.
function seriesAt(tt, vv, t) {
  var lo = 0, hi = tt.length - 1;
  if (t <= tt[0]) return vv[0];
  if (t >= tt[hi]) return vv[hi];
  while (hi - lo > 1) { var m = (lo + hi) >> 1; if (tt[m] <= t) lo = m; else hi = m; }
  var f = tt[hi] > tt[lo] ? (t - tt[lo]) / (tt[hi] - tt[lo]) : 0;
  return vv[lo] + (vv[hi] - vv[lo]) * f;
}
var chartMarker = null;
function chartAt(ev, pan) {
  var box = ev.target.closest('.trip-chart'), svg = box && box.querySelector('.tc-svg'), c = box && charts[box.dataset.k];
  if (!c || !svg) return;
  var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * c.W, t = Math.max(0, Math.min(c.dur, (px - c.L0) / c.w * c.dur));
  // Both charts of the trip follow the pointer.
  Object.keys(charts).forEach(function (k) {
    var o = charts[k], el = document.querySelector('.trip-chart[data-k="' + k + '"]');
    if (!el || o.i !== c.i) return;
    var cur = el.querySelector('.tc-cur'), X = (o.L0 + o.w * t / o.dur).toFixed(1), parts = [clock(D.start[o.i] + t * 1000, D.off[o.i])];
    cur.setAttribute('x1', X); cur.setAttribute('x2', X); cur.setAttribute('visibility', 'visible');
    if (o.sp.length >= 4) parts.push(speed(seriesAt(o.spT, o.spV, t)));
    if (o.hr) { var b = Math.round(seriesAt(o.hr.t, o.hr.v, t)); parts.push(b + ' bpm ' + HR_ZONES[hrZone(b)].n); }
    el.querySelector('.tc-read').textContent = parts.join(' · ');
  });
  if (!map || !hlLayer || PREFS.proj !== 'merc' || tab !== 'map') return;
  var a = along(c.i, D.start[c.i] + t * 1000);
  if (!a) return;
  if (!chartMarker || !hlLayer.hasLayer(chartMarker)) chartMarker = L.marker(a.ll, { icon: posIcon(modeOf(c.i), tripIcon(c.i)), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(hlLayer);
  else chartMarker.setLatLng(a.ll);
  if (pan && !map.getBounds().contains(a.ll)) map.panTo(a.ll);
}
function chartOut() {
  document.querySelectorAll('.trip-chart').forEach(function (el) {
    el.querySelector('.tc-cur').setAttribute('visibility', 'hidden');
    el.querySelector('.tc-read').textContent = '';
  });
  if (chartMarker && hlLayer) hlLayer.removeLayer(chartMarker);
}
function onChart(ev) { return ev.target.closest && ev.target.closest('.tc-svg'); }
document.addEventListener('pointermove', function (ev) { if (onChart(ev)) chartAt(ev, false); });
document.addEventListener('pointerdown', function (ev) { if (onChart(ev)) chartAt(ev, true); });
document.addEventListener('pointerout', function (ev) {
  // A mouse leaving the chart takes the marker away; a tap leaves it where it was tapped.
  if (ev.pointerType === 'mouse' && onChart(ev) && !(ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('.tc-svg'))) chartOut();
});

// ---------- the chart as a panel under the map ----------
// It takes the bottom of the screen at a height dragged from its top edge; the map, dock and panels
// move up above it (--chart-h). It follows the trip that's open and closes with it.
// On a phone (under 960 px) the dock, the top bar, the map buttons and the trip details make way
// for it, so the trip's map and its chart show together; closing it brings them back.
var chartPanelTrip = null, chartPanelH = 240;
function chartPanelOpen(i) {
  var first = chartPanelTrip == null;
  chartPanelTrip = i;
  // The chart moves from the trip details into the panel, and back when the panel closes.
  delete charts.sheet;
  if ($('tripChartSlot')) $('tripChartSlot').innerHTML = '';
  $('chartPanel').hidden = false;
  document.body.classList.add('chart-open');
  // A phone starts it at no more than 40% of the screen, leaving the rest to the map.
  chartPanelSize(first && !wide() ? Math.min(chartPanelH, window.innerHeight * 0.4) : chartPanelH);
  chartPanelDraw();
  if (map) map.invalidateSize();
  // On a phone the trip is fitted into the map left above the panel.
  if (first && !wide() && map && tab === 'map' && PREFS.proj === 'merc') {
    var pts = tripPath(i);
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [32, 32], maxZoom: 16 });
  }
}
function chartPanelClose() {
  if (chartPanelTrip == null) return;
  var i = chartPanelTrip;
  chartPanelTrip = null;
  delete charts.panel;
  if (openId === 'tripSheet' && $('tripChartSlot')) $('tripChartSlot').innerHTML = tripChart(i, 'sheet', 340, 150);
  $('chartPanel').hidden = true;
  $('chartBody').innerHTML = '';
  document.body.classList.remove('chart-open');
  if (map) map.invalidateSize();
}
function chartPanelSize(hpx) {
  chartPanelH = Math.round(Math.max(150, Math.min(window.innerHeight * 0.7, hpx)));
  document.documentElement.style.setProperty('--chart-h', chartPanelH + 'px');
}
function chartPanelDraw() {
  var i = chartPanelTrip;
  if (i == null) return;
  var name = tripName(i);
  $('chartTitle').innerHTML = (name ? esc(name) + ' · ' : '') + tripLabel(i) + ' · ' + longDate(D.day[i]);
  var body = $('chartBody'), cs = getComputedStyle(body);
  // The body's inner size, less the key and readout lines above the chart.
  var W = Math.max(wide() ? 300 : 240, body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)), H = Math.max(80, body.clientHeight - parseFloat(cs.paddingBottom) - 46);
  body.innerHTML = tripChart(i, 'panel', W, H);
  if (!body.innerHTML) chartPanelClose();
}
(function () {
  var drag = null, raf = 0;
  $('chartHandle').addEventListener('pointerdown', function (ev) {
    drag = { y: ev.clientY, h: chartPanelH };
    this.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  $('chartHandle').addEventListener('pointermove', function (ev) {
    if (!drag) return;
    chartPanelSize(drag.h + drag.y - ev.clientY);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(chartPanelDraw);
  });
  function end() { if (!drag) return; drag = null; chartPanelDraw(); if (map) map.invalidateSize(); }
  $('chartHandle').addEventListener('pointerup', end);
  $('chartHandle').addEventListener('pointercancel', end);
  // Arrow keys resize it too.
  $('chartHandle').addEventListener('keydown', function (ev) {
    var d = ev.key === 'ArrowUp' ? 24 : ev.key === 'ArrowDown' ? -24 : 0;
    if (!d) return;
    ev.preventDefault(); chartPanelSize(chartPanelH + d); chartPanelDraw(); if (map) map.invalidateSize();
  });
  $('chartClose').addEventListener('click', chartPanelClose);
  window.addEventListener('resize', function () { if (chartPanelTrip != null) { chartPanelSize(chartPanelH); chartPanelDraw(); } });
})();
function openTrip(i, fromList) {
  setPinOn([]); placeLast = null;
  var r = tripRows(i);
  $('tripBack').hidden = !fromList;
  $('tripBody').innerHTML = tripHead(i) + tripDesc(i) + '<div id="tripChartSlot">' + (chartPanelTrip == null ? tripChart(i, 'sheet', 340, 150) : '') + '</div>' + hrZonesBlock(i) +
    '<dl class="kv" style="margin-top:12px">' + r.rows.map(function (x) { return '<div><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>'; }).join('') + '</dl>' +
    (r.notes.length ? '<p class="fine" style="margin-top:10px">' + r.notes.join(' ') + '</p>' : '') +
    '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">' +
    (F.dm !== 'one' || F.unit !== 'day' || tab !== 'map' ? '<button type="button" class="btn" data-act="day" data-i="' + i + '">' + icon('calendar') + 'Show this day on the map</button>' : '') +
    (tab !== 'timeline' ? '<button type="button" class="btn" data-act="tl" data-i="' + i + '">' + icon('history') + 'Open in Timeline</button>' : '') +
    '<button type="button" class="btn" data-act="raw" data-i="' + i + '" aria-expanded="false">{ } Raw data</button></div>' +
    '<div id="rawWrap" hidden><div style="display:flex;gap:8px;margin:12px 0 8px"><button type="button" class="btn" data-act="copy" data-i="' + i + '">Copy</button>' +
    '<button type="button" class="btn" data-act="save" data-i="' + i + '">Download</button></div><pre class="raw" id="rawPre"></pre></div>';
  $('tripSheetTitle').textContent = 'Trip';
  openSheet('tripSheet');
  $('tripBody').scrollTop = 0;
  if (tab === 'map') highlight(i);
  // The chart panel follows the open trip.
  if (chartPanelTrip != null) chartPanelOpen(i);
}
// Everything BT•DT keeps about one trip, as JSON, to look into a trip without sharing the whole import.
// BT•DT keeps what it read from the files, not the files themselves, so this is that.
var EST_FLAGS = [[1, 'distance along the GPS trail'], [2, 'distance as a straight line'], [4, 'type guessed from speed'], [8, 'distance corrected'],
  [16, 'recorded activity'], [32, 'line from Records.json'], [64, 'made from GPS points without a trip'],
  [JUMPS, 'bad GPS points left out']];
function rawTrip(i) {
  function iso(ms) { return new Date(ms).toISOString(); }
  function ll(a, k) { return isFinite(a[2 * k]) ? [+a[2 * k].toFixed(6), +a[2 * k + 1].toFixed(6)] : null; }
  var e = D.est[i], s = D.srcs ? D.srcs[i] : null, o = {
    source: s === SRC.strava ? actApp(i) || 'Activity file' : s === SRC.sim ? 'Simulated' : KIND_LABEL[s] || 'Unknown',
    type: tripLabel(i).replace(/&amp;/g, '&'), mode: modeOf(i),
    sport: D.sport && D.sport[i] ? SPORTS[D.sport[i]][0] : null, stravaType: D.stype && D.stype[i] || null,
    start: iso(D.start[i]), end: iso(D.end[i]), utcOffsetMin: D.off[i] === NO_OFF ? null : D.off[i], localDay: isoDay(D.day[i]),
    km: +D.km[i].toFixed(3), fileKm: D.orig[i] > 0 ? +D.orig[i].toFixed(3) : null,
    flags: EST_FLAGS.filter(function (f) { return e & f[0]; }).map(function (f) { return f[1]; }),
    from: ll(D.from, i), to: ll(D.to, i)
  };
  if (e & 16) {
    // The Timeline trips at the same time, including the ones this activity replaced.
    var sm = D.smeta && D.smeta[i];
    o.strava = sm ? Object.assign({}, sm, { hr: undefined, spd: undefined }) : 'Not kept: load the export again to see what it says about this activity.';
    // Heart rate: seconds after the start, bpm.
    if (sm && sm.hr) o.heartRate = sm.hr.t.map(function (t, k) { return [t, sm.hr.v[k]]; });
    o.timelineSameTime = [];
    for (var j = 0; j < RAW.start.length; j++) {
      if (RAW.end[j] <= D.start[i] || RAW.start[j] >= D.end[i]) continue;
      o.timelineSameTime.push({ start: iso(RAW.start[j]), end: iso(RAW.end[j]), mode: MODES[RAW.mode[j]], km: +RAW.km[j].toFixed(3),
        source: KIND_LABEL[RAW.srcs ? RAW.srcs[j] : RAW.src] || 'Unknown', from: ll(RAW.from, j), to: ll(RAW.to, j), points: RAW.pathOff[j + 1] - RAW.pathOff[j] });
    }
  }
  // Each point: latitude, longitude, seconds after the start.
  o.points = [];
  for (var q = D.pathOff[i]; q < D.pathOff[i + 1]; q++) o.points.push([+D.pathPts[2 * q].toFixed(6), +D.pathPts[2 * q + 1].toFixed(6), Math.round(D.pathT[q])]);
  return o;
}
function rawText(i) {
  // One point per line keeps it readable.
  return JSON.stringify(rawTrip(i), null, 1).replace(/\[\n\s+(-?[\d.]+),\n\s+(-?[\d.]+)(?:,\n\s+(-?[\d.]+))?\n\s+\]/g, function (_, a, b, c) { return '[' + a + ', ' + b + (c != null ? ', ' + c : '') + ']'; });
}
function saveFile(name, parts, type) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(parts, { type: type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

// ---------- export what the filters show ----------
// The trips and stays that pass every filter, the trips in the same format as a trip's Raw data.
// The time slider only plays the trips back, so it doesn't narrow the export.
function syncExport() {
  var n = sel.length, nv = selV.length;
  var what = [n ? tripsText(n) : '', nv ? fmt(nv) + ' stay' + (nv === 1 ? '' : 's') : ''].filter(Boolean).join(' and ');
  $('exportText').textContent = n || nv ? 'Download the ' + what +
    ' that match these filters (' + filterText() + '). The JSON has each trip as in its Raw data, GPS points included; the CSV has a row per trip.' : 'No trips match these filters.';
  $('exportJson').disabled = $('exportCsv').disabled = !n && !nv;
  $('exportCsv').disabled = !n;
}
function exportName(ext) {
  var t = F.dm === 'all' ? 'all-time' : F.dm === 'one' ? (F.unit === 'day' ? isoDay(F.one) : isoDay(periodStart(F.one, F.unit)) + '-to-' + isoDay(periodEnd(F.one, F.unit)))
    : F.from === F.to ? isoDay(F.from) : isoDay(F.from) + '-to-' + isoDay(F.to);
  return 'btdt-' + t + (activeFilters() - (F.dm !== 'all' ? 1 : 0) ? '-filtered' : '') + '.' + ext;
}
// The filters in words, leaving out the ones that let everything through.
function exportFilters() {
  var o = {};
  o.days = F.dm === 'all' ? 'All time' : F.dm === 'one' ? { from: isoDay(F.unit === 'day' ? F.one : periodStart(F.one, F.unit)), to: isoDay(F.unit === 'day' ? F.one : periodEnd(F.one, F.unit)) }
    : { from: isoDay(F.from), to: isoDay(F.to) };
  if (F.years.size !== M.years.length) o.years = M.years.filter(function (y) { return F.years.has(y); });
  if (F.months.size !== 12) o.months = MONTHS.filter(function (m, k) { return F.months.has(k); });
  if (F.dows.size !== 7) o.daysOfWeek = DOW_ORDER.filter(function (d) { return F.dows.has(d); }).map(function (d) { return DOW[d]; });
  if (F.h0 !== 0 || F.h1 !== 24) o.hours = { from: F.h0, until: F.h1 };
  if (F.modes.size !== M.modes.length || F.sports.size !== M.sports.length) {
    o.transport = M.modes.filter(function (m) { return F.modes.has(m); });
    if (M.sports.length) o.sports = M.sports.filter(function (s) { return F.sports.has(s); }).map(function (s) { return SPORTS[s][0]; });
  }
  if (F.countries.size !== M.countries.length) o.countries = M.countries.filter(function (c) { return F.countries.has(c); }).map(function (c) { return ccName(D.ccList[c]); });
  if (F.guess !== 'all') o.guessedType = F.guess === 'no' ? 'left out' : 'only these';
  if (F.src !== 'all') o.source = F.src === 'strava' ? actsLabel(D.stravaStats) : 'Timeline';
  if (F.gear.size !== gearIds().length) o.gear = gearIds().filter(function (g) { return F.gear.has(g); }).map(gearName);
  return o;
}
function rawStay(v) {
  function iso(ms) { return new Date(ms).toISOString(); }
  var lat = D.vll[2 * v], lng = D.vll[2 * v + 1];
  return {
    start: iso(D.vs[v]), end: iso(D.ve[v]), utcOffsetMin: D.voff[v] === NO_OFF ? null : D.voff[v], localDay: isoDay(D.vday[v]),
    name: D.vname && D.vname[v] || null, placeId: D.vpid && D.vpid[v] || null,
    country: D.ccList[D.vcc[v]] ? ccName(D.ccList[D.vcc[v]]) : null,
    at: isFinite(lat) ? [+lat.toFixed(6), +lng.toFixed(6)] : null
  };
}
function exportJson() {
  // Newest first, as in Timeline. Built in pieces so a large export doesn't need one huge string.
  var head = JSON.stringify({ app: 'BT•DT', exported: new Date().toISOString(), filters: exportFilters(), tripCount: sel.length, stayCount: selV.length }, null, 1);
  var parts = [head.slice(0, -2) + ',\n "trips": ['], k;
  for (k = sel.length - 1; k >= 0; k--) parts.push((k < sel.length - 1 ? ',\n' : '\n') + rawText(sel[k]));
  parts.push('\n],\n "stays": [');
  for (k = selV.length - 1; k >= 0; k--) parts.push((k < selV.length - 1 ? ',\n' : '\n') + JSON.stringify(rawStay(selV[k])));
  parts.push('\n]\n}\n');
  saveFile(exportName('json'), parts, 'application/json');
}
function csvCell(v) {
  if (v == null) return '';
  var s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function exportCsv() {
  var cols = ['start', 'end', 'localStart', 'localEnd', 'utcOffsetMin', 'localDay', 'durationMin', 'type', 'mode', 'sport', 'source', 'km', 'fileKm',
    'route', 'fromCountry', 'toCountry', 'fromLat', 'fromLng', 'toLat', 'toLng', 'co2Kg', 'gpsPoints', 'flags'];
  var rows = [cols.join(',')];
  function local(ms, off) { return off === NO_OFF ? '' : new Date(ms + off * 60000).toISOString().slice(0, 16).replace('T', ' '); }
  for (var k = sel.length - 1; k >= 0; k--) {
    var i = sel[k], o = rawTrip(i);
    rows.push([o.start, o.end, local(D.start[i], D.off[i]), local(D.end[i], D.off[i]), o.utcOffsetMin, o.localDay, Math.round((D.end[i] - D.start[i]) / 6e4),
      o.type, o.mode, o.sport, o.source, o.km, o.fileKm, tripRoute(i).replace(/&amp;/g, '&'),
      D.ccList[D.cs[i]] ? ccName(D.ccList[D.cs[i]]) : '', D.ccList[D.ce[i]] ? ccName(D.ccList[D.ce[i]]) : '',
      o.from && o.from[0], o.from && o.from[1], o.to && o.to[0], o.to && o.to[1], +tripKg(i).toFixed(3), o.points.length, o.flags.join('; ')].map(csvCell).join(','));
  }
  // The byte order mark lets Excel read the accents and arrows.
  saveFile(exportName('csv'), ['﻿' + rows.join('\r\n') + '\r\n'], 'text/csv');
}
function runExport(fn) {
  busy('Preparing the export…');
  setTimeout(function () {
    try { fn(); toast('Export ready'); } catch (e) { toast('Export failed: ' + e.message); } finally { busy(''); }
  }, 30);
}
$('exportJson').addEventListener('click', function () { runExport(exportJson); });
$('exportCsv').addEventListener('click', function () { runExport(exportCsv); });
function openList(list) {
  setPinOn([]); placeLast = null;
  listBack = list;
  $('tripSheetTitle').textContent = fmt(list.length) + ' trips here';
  $('tripBack').hidden = true;
  $('tripBody').innerHTML = '<div class="list-rows">' + list.slice(0, 300).map(function (i) { return tripRowHtml(i, true); }).join('') + '</div>' +
    (list.length > 300 ? '<p class="fine">Showing the latest 300.</p>' : '');
  openSheet('tripSheet');
  $('tripBody').scrollTop = 0;
}
function tripRowHtml(i, withDate) {
  var m = modeOf(i);
  return '<button type="button" class="hit-row" data-i="' + i + '">' + badge(m, true) + '<span class="t"><b>' + esc(tripRoute(i)) + '</b><small>' + tripLabel(i) + simTag(i) + ' · ' + (withDate ? niceDate(D.day[i]) + ', ' : '') + clock(D.start[i], D.off[i]) + '</small></span>' +
    '<span class="r num">' + dist(D.km[i]) + '<small>' + (D.end[i] > D.start[i] ? duration(D.end[i] - D.start[i]) : '') + '</small></span></button>';
}
$('tripBody').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-i]');
  if (!b) return;
  var i = +b.dataset.i;
  if (b.dataset.act === 'chart') chartPanelOpen(i);
  else if (b.dataset.act === 'day') { closeSheets(); setTab('map'); showDay(D.day[i]); }
  else if (b.dataset.act === 'tl') { closeSheets(); setTab('timeline'); tlSelect(i, true); }
  else if (b.dataset.act === 'raw') {
    var open = $('rawWrap').hidden;
    if (open) $('rawPre').textContent = rawText(i);
    $('rawWrap').hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) $('rawWrap').scrollIntoView({ block: 'nearest' });
  } else if (b.dataset.act === 'copy') {
    var txt = rawText(i);
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast('Trip data copied'); }, function () {
      var r = document.createRange(); r.selectNodeContents($('rawPre')); var s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Selected: copy it from here');
    });
  } else if (b.dataset.act === 'save') {
    saveFile('trip-' + new Date(D.start[i]).toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json', [rawText(i)], 'application/json');
  } else openTrip(i, true);
});
$('tripBack').addEventListener('click', function () { if (listBack) openList(listBack); });

// ---------- top bar: day navigator or time slider ----------
var scrubV = 1000, T0 = 0, T1 = 0, playing = false, playRaf = 0, SPEEDS = [1, 2, 4, 8, 16, 32, 0.25, 0.5];
function speedText() { return ({ 0.25: '¼', 0.5: '½' }[PREFS.speed] || PREFS.speed) + '×'; }
function dayLabel(d) { var x = dayToDate(d); return DOW[x.getUTCDay()] + ' ' + x.getUTCDate() + ' ' + MONTHS[x.getUTCMonth()] + ' ' + x.getUTCFullYear(); }
function updateTopbar() {
  var n = sel.length, one = F.dm === 'one';
  // The playback button (bottom left) shows or hides the time slider in the top bar.
  document.querySelector('#timeBar .scrub').hidden = !n || !PREFS.scrub;
  $('scrubToggle').hidden = !n;
  $('scrubToggle').setAttribute('aria-pressed', PREFS.scrub ? 'true' : 'false');
  $('scrubToggle').setAttribute('aria-label', PREFS.scrub ? 'Hide playback' : 'Show playback');
  if (n) {
    if (one) {
      var o = D.off[sel[0]], offMs = o !== NO_OFF ? o * 60000 : -new Date(F.one * 864e5).getTimezoneOffset() * 60000;
      T0 = periodStart(F.one, F.unit) * 864e5 - offMs; T1 = (periodEnd(F.one, F.unit) + 1) * 864e5 - offMs;
    } else {
      T0 = D.start[sel[0]]; T1 = T0;
      for (var i = 0; i < n; i++) if (D.end[sel[i]] > T1) T1 = D.end[sel[i]];
      if (T1 <= T0) T1 = T0 + 1;
    }
  }
  $('speedBtn').textContent = speedText();
  scrubLabel();
}
// The period navigator at the top of the Map, Insights and Timeline. They share one period
// (the filters' days), so stepping on any tab moves them all.
function syncPeriodNavs() {
  var n = sel.length, total = 0, i, one = F.dm === 'one', nd = M.navDays;
  for (i = 0; i < n; i++) total += D.km[sel[i]];
  var p0 = one ? periodStart(F.one, F.unit) : 0, p1 = one ? periodEnd(F.one, F.unit) : 0, today = todayDay();
  var sub = n ? tripsText(n) + ' · ' + dist(total) : one ? 'No trips this ' + F.unit : 'No trips';
  var k = activeFilters(), kr = k - (F.dm !== 'all' ? 1 : 0);
  document.querySelectorAll('[data-pnav]').forEach(function (bar) {
    function q(name) { return bar.querySelector('[data-pn="' + name + '"]'); }
    q('nav').hidden = !one;
    q('range').hidden = one;
    q('step').hidden = !one;
    if (q('badge')) { q('badge').hidden = !k; q('badge').textContent = k; }
    if (one) {
      q('label').textContent = F.unit === 'day' ? dayLabel(F.one) : periodLabel(F.one, F.unit);
      q('sub').textContent = sub;
      q('pick').setAttribute('aria-label', (F.unit === 'day' ? dayLabel(F.one) : periodLabel(F.one, F.unit)) + '. Pick a day');
      q('prev').disabled = !nd.length || nd[0] >= p0;
      q('next').disabled = !nd.length || nd[nd.length - 1] <= p1;
      q('prev').setAttribute('aria-label', 'Previous ' + F.unit + ' with trips');
      q('next').setAttribute('aria-label', 'Next ' + F.unit + ' with trips');
    } else {
      q('rangeMain').textContent = F.dm === 'all' ? 'All time' : F.from === F.to ? dayLabel(F.from) : niceDate(F.from) + ' – ' + niceDate(F.to);
      q('rangeSub').textContent = sub + (kr ? ' · ' + kr + ' filter' + (kr > 1 ? 's' : '') : '');
    }
  });
}
// The calendar under the navigator's date: a month at a time, Monday first. Days with
// trips in the filters have a dot, the period on show is shaded, and Today at the bottom
// jumps to today in the same step (day, week, month or year).
var calBtn = null, calMonth = 0;
function monthStart(d) { var x = dayToDate(d); return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1) / 864e5; }
function addMonths(d, k) { var x = dayToDate(d); return Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + k, 1) / 864e5; }
function renderCal() {
  var m0 = calMonth, m1 = addMonths(m0, 1) - 1, x = dayToDate(m0), today = todayDay();
  var has = {}, nd = M.navDays, i;
  for (i = 0; i < nd.length; i++) if (nd[i] >= m0 && nd[i] <= m1) has[nd[i]] = 1;
  var p0 = periodStart(F.one, F.unit), p1 = periodEnd(F.one, F.unit), lo = monthStart(M.minD), hi = Math.max(M.maxD, today);
  var lead = (x.getUTCDay() + 6) % 7, h = '<div class="cal-head">' +
    '<button type="button" class="icon-btn" data-cal="-12" aria-label="Previous year"' + (m0 <= lo ? ' disabled' : '') + '>' + icon('left2') + '</button>' +
    '<button type="button" class="icon-btn" data-cal="-1" aria-label="Previous month"' + (m0 <= lo ? ' disabled' : '') + '>' + icon('left') + '</button>' +
    '<b>' + MONTHS_LONG[x.getUTCMonth()] + ' ' + x.getUTCFullYear() + '</b>' +
    '<button type="button" class="icon-btn" data-cal="1" aria-label="Next month"' + (m1 >= hi ? ' disabled' : '') + '>' + icon('right') + '</button>' +
    '<button type="button" class="icon-btn" data-cal="12" aria-label="Next year"' + (m1 >= hi ? ' disabled' : '') + '>' + icon('right2') + '</button></div><div class="cal-grid">';
  DOW_ORDER.forEach(function (k) { h += '<span class="cal-dow">' + DOW[k].slice(0, 2) + '</span>'; });
  for (i = 0; i < lead; i++) h += '<span class="cal-pad"></span>';
  for (var d = m0; d <= m1; d++) {
    var cls = (d >= p0 && d <= p1 ? ' on' : '') + (d === today ? ' today' : '') + (has[d] ? ' has' : '');
    h += '<button type="button" class="cal-day' + cls + '" data-day="' + d + '"' + (d < M.minD || d > hi ? ' disabled' : '') + ' aria-label="' + longDate(d) + (has[d] ? ', trips' : '') + '"' + (d === F.one ? ' aria-current="date"' : '') + '>' + dayToDate(d).getUTCDate() + '</button>';
  }
  // Always six weeks, so the calendar keeps its size and its buttons stay put month to month.
  for (i = lead + m1 - m0 + 1; i < 42; i++) h += '<span class="cal-pad"></span>';
  h += '</div><div class="cal-foot"><button type="button" class="btn" data-cal="today">Today</button></div>';
  $('calPop').innerHTML = h;
}
function openCal(btn) {
  closeCal();
  calBtn = btn; calMonth = monthStart(F.one);
  renderCal();
  $('calPop').hidden = false; $('calScrim').hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  var cur = $('calPop').querySelector('[aria-current]') || $('calPop').querySelector('.cal-day.today') || $('calPop').querySelector('.cal-day:not([disabled])');
  if (cur) cur.focus();
}
function closeCal() {
  if (!calBtn) return;
  calBtn.setAttribute('aria-expanded', 'false');
  $('calPop').hidden = true; $('calScrim').hidden = true; calBtn = null;
}
$('calPop').addEventListener('click', function (ev) {
  var b = ev.target.closest('button');
  if (!b || b.disabled) return;
  if (b.dataset.day) { var btn = calBtn; closeCal(); showDay(+b.dataset.day, F.unit); btn.focus(); }
  else if (b.dataset.cal === 'today') { var bt = calBtn; closeCal(); showDay(todayDay(), F.unit); bt.focus(); }
  // A year back or forward stops at the first or last month with data (or this month).
  else if (b.dataset.cal) { calMonth = Math.max(monthStart(M.minD), Math.min(monthStart(Math.max(M.maxD, todayDay())), addMonths(calMonth, +b.dataset.cal))); renderCal(); }
});
document.addEventListener('click', function (ev) {
  if (calBtn && !ev.target.closest('#calPop') && !ev.target.closest('[data-pn="pick"]')) closeCal();
}, true);
document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && calBtn) { var b = calBtn; closeCal(); b.focus(); } });
// Steps to the nearest day, week, month or year before or after this one that has trips.
// It lands on the last day with trips going back and the first going forward.
function stepDay(dir) {
  var nd = M.navDays, d = null, k, a = periodStart(F.one, F.unit), z = periodEnd(F.one, F.unit);
  if (dir < 0) { for (k = nd.length - 1; k >= 0; k--) if (nd[k] < a) { d = nd[k]; break; } }
  else { for (k = 0; k < nd.length; k++) if (nd[k] > z) { d = nd[k]; break; } }
  if (d != null) showDay(d, F.unit);
}
document.querySelectorAll('[data-pnav]').forEach(function (bar) {
  function q(name) { return bar.querySelector('[data-pn="' + name + '"]'); }
  q('prev').addEventListener('click', function () { stepDay(-1); });
  q('next').addEventListener('click', function () { stepDay(1); });
  q('pick').addEventListener('click', function () { if (calBtn === this) closeCal(); else openCal(this); });
  // Switching unit keeps the day you were on, so Day after Month goes back to it.
  q('step').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-step]');
    if (b && b.dataset.step !== F.unit) showDay(F.one, b.dataset.step);
  });
});
document.addEventListener('keydown', function (ev) {
  if (F == null || F.dm !== 'one' || openId || calBtn || /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) return;
  if (ev.key === 'ArrowLeft') stepDay(-1);
  if (ev.key === 'ArrowRight') stepDay(1);
});

function scrubTime() { return T0 + (T1 - T0) * scrubV / 1000; }
function scrubLabel() {
  if (!sel.length) { $('scrubWhen').textContent = ''; return; }
  if (scrubV >= 1000 && !playing) { $('scrubWhen').textContent = F.dm === 'one' ? 'Whole ' + F.unit : 'All'; return; }
  var t = scrubTime(), i = sel[Math.max(0, upper(t) - 1)];
  $('scrubWhen').textContent = F.dm === 'one' && F.unit === 'day' || T1 - T0 <= 2 * 864e5 ? clock(t, D.off[i]) : clock(t, D.off[i], true).split(',')[0];
}
// How many trips in sel start at or before t.
function upper(t) {
  var lo = 0, hi = sel.length;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (D.start[sel[mid]] <= t) lo = mid + 1; else hi = mid; }
  return lo;
}
var groupTimer = 0;
function scrubTo(v) {
  scrubV = Math.max(0, Math.min(1000, v));
  $('scrub').value = scrubV;
  var t = scrubTime(), b = scrubV >= 1000 ? sel.length : upper(t), old = visibleB;
  visibleB = b;
  if (map) {
    if (!many) {
      for (var k = Math.min(old, b); k < Math.max(old, b); k++) if (lines[k]) lines[k].setStyle({ opacity: k < b ? LINE_OP : 0 });
      // The trip under way is drawn separately, up to where you are.
      if (prevCur != null && lines[prevCur] && prevCur < b) lines[prevCur].setStyle({ opacity: LINE_OP });
    } else if (old !== b) { clearTimeout(groupTimer); groupTimer = setTimeout(function () { buildGroups(visibleB); }, playing ? 0 : 60); }
  }
  // Where you were: along the trip under way, or where the last one ended.
  var pos = null, cur = null;
  if (scrubV < 1000 && sel.length) {
    if (!b) pos = [D.from[2 * sel[0]], D.from[2 * sel[0] + 1]];
    else {
      var i = sel[b - 1];
      if (t < D.end[i]) { var a = along(i, t); if (a) { pos = a.ll; cur = { i: i, pts: a.upto }; } }
      else pos = [D.to[2 * i], D.to[2 * i + 1]];
    }
  }
  prevCur = null;
  if (cur && !many && lines[b - 1]) { lines[b - 1].setStyle({ opacity: 0 }); prevCur = b - 1; }
  P_pos = pos && isFinite(pos[0]) ? pos : null; P_cur = cur;
  if (map) {
    if (curLine) { pathLayer.removeLayer(curLine); curLine = null; }
    if (cur && cur.pts.length > 1) {
      curLine = L.polyline(cur.pts, { renderer: renderer, color: cssVar(groupOf(modeOf(cur.i)).v), weight: LINE_W + 2, opacity: 1, interactive: false });
      pathLayer.addLayer(curLine);
    }
    if (P_pos) {
      var pm = posMode(), pk = pm && pm + '|' + posIc();
      if (pk !== posMarker._mode) { posMarker.setIcon(posIcon(pm, posIc())); posMarker._mode = pk; }
      posMarker.setLatLng(P_pos); if (!map.hasLayer(posMarker)) posMarker.addTo(map);
    }
    else if (map.hasLayer(posMarker)) map.removeLayer(posMarker);
    if (playing && P_pos && PREFS.proj === 'merc') followPlay();
  }
  if (map && PREFS.cc && ccLayer._ver !== ccVer()) buildCC();
  if (PREFS.proj !== 'merc' && P && P.proj) paintProj(playing);
  scrubLabel();
}
var P_pos = null, P_cur = null, prevCur = null;
// During playback the map follows the trip under way: when a trip starts, the map glides
// (zooming out and back in as needed) so that trip's whole route is on screen, clear of
// the top bar, the legend and the dock. Playback holds still while the map glides and
// until its tiles have loaded, then eases back up to speed, so the dot never outruns the
// map. The tiles for the next trips' views are fetched ahead of time. Between trips the
// map only pans to keep the dot in view.
var playFit = { i: null, flying: 0, landed: 0, resume: 0, pan: 0 }, tilesAhead = {}, tileImgs = [];
function playPad() {
  var m = $('map').getBoundingClientRect(), tb = $('topbar').getBoundingClientRect(), dk = document.querySelector('.dock'), lg = $('mapLegend');
  var floor = lg && !lg.hidden && lg.offsetHeight ? lg.getBoundingClientRect().top : dk ? dk.getBoundingClientRect().top : m.bottom;
  var side = wide() ? 60 : 28;
  return { tl: L.point(side, Math.max(24, tb.bottom - m.top + 20)), br: L.point(side + 40, Math.max(24, m.bottom - floor + 20)) };
}
// The view a trip's route gets: its bounds, padded clear of the bars, at zoom 16 at most.
function tripView(i, pad) {
  var pts = tripPath(i).filter(function (q) { return isFinite(q[0]) && isFinite(q[1]); });
  if (!pts.length) return null;
  var b = L.latLngBounds(pts), z = Math.min(16, map.getBoundsZoom(b, false, pad.tl.add(pad.br)));
  var c = map.unproject(map.project(b.getNorthWest(), z).add(map.project(b.getSouthEast(), z)).divideBy(2).add(pad.tl.subtract(pad.br).divideBy(2).multiplyBy(-1)), z);
  return { b: b, z: z, c: c };
}
// Fetches the tiles of a view into the browser's (and the offline) cache.
function prefetchView(v) {
  if (!v || !map._tl) return;
  var sz = map.getSize(), z = Math.max(0, Math.min(16, Math.round(v.z))), n = 1 << z;
  var mid = map.project(v.c, z), lo = mid.subtract(sz.divideBy(2)).divideBy(256).floor(), hi = mid.add(sz.divideBy(2)).divideBy(256).floor();
  if ((hi.x - lo.x + 1) * (hi.y - lo.y + 1) > 80) return;
  for (var x = lo.x; x <= hi.x; x++) for (var y = Math.max(0, lo.y); y <= Math.min(n - 1, hi.y); y++) {
    var key = z + '/' + ((x % n) + n) % n + '/' + y;
    if (tilesAhead[key]) continue;
    tilesAhead[key] = 1;
    map._tl.forEach(function (l) {
      var img = new Image();
      img.onload = img.onerror = function () { var k = tileImgs.indexOf(img); if (k >= 0) tileImgs.splice(k, 1); };
      img.src = L.Util.template(l._url, { x: ((x % n) + n) % n, y: y, z: z });
      tileImgs.push(img);
    });
  }
}
function tilesLoading() { return !!(map._tl && map._tl.some(function (l) { return l.isLoading && l.isLoading(); })); }
// How fast playback runs now, from 0 (holding for the map) to 1.
function playRate(now) {
  var f = playFit;
  if (f.flying) { if (now - f.flying < 8000) return 0; f.flying = 0; f.landed = now; }
  if (f.landed) {
    if (now - f.landed < 2000 && tilesLoading()) return 0;
    f.landed = 0; f.resume = now;
  }
  if (f.resume) {
    var r = (now - f.resume) / 600;
    if (r < 1) return r * r;
    f.resume = 0;
  }
  return 1;
}
function followPlay() {
  var now = performance.now(), pad = playPad(), f = playFit;
  if (f.flying || f.landed) return;
  if (P_cur && P_cur.i !== f.i) {
    f.i = P_cur.i;
    var v = tripView(P_cur.i, pad);
    // Warm the tiles for the next two trips' views while this one plays.
    for (var k = visibleB; k < Math.min(sel.length, visibleB + 2); k++) prefetchView(tripView(sel[k], pad));
    if (v) {
      var view = L.latLngBounds(map.containerPointToLatLng(pad.tl), map.containerPointToLatLng(map.getSize().subtract(pad.br)));
      // Already in view at the zoom it would get: leave the map be rather than nudge it.
      if (!(view.contains(v.b) && Math.abs(map.getZoom() - v.z) < 0.5)) {
        prefetchView(v);
        f.flying = now; f.resume = 0;
        map.flyToBounds(v.b, { paddingTopLeft: pad.tl, paddingBottomRight: pad.br, maxZoom: 16, easeLinearity: 0.2 });
        map.once('moveend', function () { if (f.flying) { f.flying = 0; f.landed = performance.now(); } });
        return;
      }
    }
  }
  if (now < f.pan) return;
  var cp = map.latLngToContainerPoint(P_pos), sz = map.getSize();
  if (cp.x < pad.tl.x || cp.y < pad.tl.y || cp.x > sz.x - pad.br.x || cp.y > sz.y - pad.br.y) {
    map.panTo(P_pos, { animate: true, duration: 0.6 });
    f.pan = now + 700;
  }
}
// The position marker: while a trip is under way it shows that trip's transport icon in
// its colour; between trips (standing still) it is a plain grey dot.
function posMode() { return P_cur ? modeOf(P_cur.i) || 'UNKNOWN' : null; }
// A Strava ride on a Halfbike or cargo bike shows that bike.
function posIc() { return P_cur ? tripIcon(P_cur.i) || 'UNKNOWN' : null; }
function posIcon(m, ic) {
  if (!m) return L.divIcon({ className: '', html: '<div class="pos-dot still"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
  return L.divIcon({ className: '', html: '<div class="pos-dot moving" style="background:' + modeColor(m) + '">' + icon(ic || m) + '</div>', iconSize: [30, 30], iconAnchor: [15, 15] });
}
// The line-drawn gear icons as images, for the canvas of the other map views.
var lineIconImg = {};
function lineIconImage(name) {
  if (!lineIconImg[name]) {
    var im = new Image();
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" fill="#fff" color="#fff">' + LINE_ICONS[name] + '</svg>');
    im.onload = function () { if (P && P.proj) paintProj(playing); };
    lineIconImg[name] = im;
  }
  return lineIconImg[name].complete && lineIconImg[name].naturalWidth ? lineIconImg[name] : null;
}
$('scrub').addEventListener('input', function () { stopPlay(); scrubTo(+this.value); });
function stopPlay() {
  if (!playing) return;
  playing = false; cancelAnimationFrame(playRaf);
  $('playBtn').innerHTML = icon('play'); $('playBtn').setAttribute('aria-label', 'Play');
  scrubLabel();
}
// Playback runs on travel time: the time between trips is squeezed to a short pause
// (a third of an average trip at most), so the dot moves steadily instead of
// jumping from trip to trip. Knots map real time to playback time; the whole
// range plays in 2 minutes at 1×.
function playWarp() {
  var iv = [], k, n = sel.length;
  for (k = 0; k < n; k++) {
    var s0 = Math.max(T0, D.start[sel[k]]), e0 = Math.min(T1, D.end[sel[k]]);
    if (e0 <= s0) continue;
    if (iv.length && s0 <= iv[iv.length - 1][1]) iv[iv.length - 1][1] = Math.max(iv[iv.length - 1][1], e0);
    else iv.push([s0, e0]);
  }
  var moving = 0;
  iv.forEach(function (x) { moving += x[1] - x[0]; });
  var cap = iv.length ? Math.max(1, moving / iv.length / 3) : T1 - T0;
  var real = [T0], virt = [0], last = T0;
  function knot(t, travel) { if (t <= last) return; virt.push(virt[virt.length - 1] + (travel ? t - last : Math.min(t - last, cap))); real.push(t); last = t; }
  iv.forEach(function (x) { knot(x[0], false); knot(x[1], true); });
  knot(T1, false);
  return { real: real, virt: virt, len: virt[virt.length - 1] || 1 };
}
function warpMap(from, to, x) {
  var lo = 0, hi = from.length - 1;
  if (x <= from[0]) return to[0];
  if (x >= from[hi]) return to[hi];
  while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (from[mid] <= x) lo = mid; else hi = mid; }
  var f = from[hi] > from[lo] ? (x - from[lo]) / (from[hi] - from[lo]) : 0;
  return to[lo] + f * (to[hi] - to[lo]);
}
function play() {
  if (scrubV >= 1000) scrubTo(0);
  playing = true; playFit = { i: null, flying: 0, landed: 0, resume: 0, pan: 0 };
  $('playBtn').innerHTML = icon('pause'); $('playBtn').setAttribute('aria-label', 'Pause');
  var W = playWarp(), u = warpMap(W.real, W.virt, scrubTime()), last = performance.now();
  (function frame(now) {
    if (!playing) return;
    u += (now - last) / 120000 * W.len * PREFS.speed * (map && PREFS.proj === 'merc' ? playRate(now) : 1);
    last = now;
    if (u >= W.len) { scrubTo(1000); stopPlay(); return; }
    scrubTo((warpMap(W.virt, W.real, u) - T0) / (T1 - T0) * 1000);
    playRaf = requestAnimationFrame(frame);
  })(last);
}
$('scrubToggle').addEventListener('click', function () {
  PREFS.scrub = !PREFS.scrub; savePrefs();
  // Hiding the slider shows every trip again.
  if (!PREFS.scrub) { stopPlay(); if (scrubV < 1000) scrubTo(1000); }
  updateTopbar();
});
$('playBtn').addEventListener('click', function () { if (playing) stopPlay(); else play(); });
$('speedBtn').addEventListener('click', function () {
  PREFS.speed = SPEEDS[(SPEEDS.indexOf(PREFS.speed) + 1) % SPEEDS.length] || 1;
  savePrefs();
  this.textContent = speedText();
});

// ---------- legend ----------
function legend() {
  var seen = {};
  for (var k = 0; k < sel.length; k++) seen[groupOf(modeOf(sel[k])).key] = 1;
  var h = PREFS.speedPaths ? speedLegend() : PREFS.hrPaths ? hrLegend() : '';
  if (PREFS.squares && D) h += sqLegend();
  h += PREFS.paths ? GROUPS.filter(function (g) { return seen[g.key]; }).map(function (g) { return '<span><i style="background:' + g.color + '"></i>' + g.label + '</span>'; }).join('') : '';
  if (PREFS.heat) h += '<span>' + heatLabel() + ' <i class="heat-scale" style="background:linear-gradient(90deg,' + heatStops().join(',') + ')"></i></span>';
  if (PREFS.cc) {
    h += '<span><i style="background:var(--accent);opacity:.5;height:10px"></i>Countries visited</span>';
    if (visitedCountries().some(function (c) { return c.layover; })) h += '<span><i style="background:var(--cc-air);opacity:.5;height:10px"></i>Only a layover at the airport</span>';
  }
  $('mapLegend').innerHTML = h;
  $('mapLegend').hidden = !h || !sel.length && !selV.length;
}

// ---------- countries visited ----------
// While the time slider is back in time, only what was reached by then counts:
// the trips started (their end country once they've arrived) and the stays begun.
function ccReach() {
  if (scrubV >= 1000) return { nb: sel.length, nv: selV.length, t: Infinity, key: 'all' };
  var t = scrubTime(), lo = 0, hi = selV.length;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (D.vs[selV[mid]] <= t) lo = mid + 1; else hi = mid; }
  var nb = visibleB, done = nb && D.end[sel[nb - 1]] <= t;
  return { nb: nb, nv: lo, t: t, key: nb + ':' + lo + ':' + (done ? 1 : 0) + ':' + evDay(t, NO_OFF) };
}
function visitedCountries() {
  var by = {}, r = ccReach();
  function add(k, d) { var c = by[k] || (by[k] = {}); c[d] = 1; }
  // Arrivals and the end of stays count on the day they happened, as in Insights.
  for (var j = 0; j < r.nb; j++) { var i = sel[j]; add(D.cs[i], D.day[i]); if (D.end[i] <= r.t) add(D.ce[i], evDay(D.end[i], D.off[i])); }
  for (var v = 0; v < r.nv; v++) { var w = selV[v]; add(D.vcc[w], D.vday[w]); if (D.ve[w] <= r.t) add(D.vcc[w], evDay(D.ve[w], D.voff[w])); }
  // Days between records count too, as in Insights; with the slider back in time, only up to then.
  gapDays(isFinite(r.t) ? evDay(r.t, NO_OFF) - 1 : Infinity, add);
  // Countries where every visit reached so far was a true layover (flew in and out, stayed at
  // the airport), by the same rule as the Insights country timeline.
  var stays = {}, air = {};
  ccVisits().forEach(function (x) {
    if (x.t0 > r.t) return;
    if (x.layover && !x.visit) air[x.cc] = 1; else stays[x.cc] = 1;
  });
  return Object.keys(by).map(function (k) { var cc = D.ccList[k]; return { cc: cc, days: Object.keys(by[k]).length, layover: !!air[cc] && !stays[cc] }; }).filter(function (c) { return c.cc; });
}
var ccVisitCache = null;
function ccVisits() {
  var key = selVer();
  if (!ccVisitCache || ccVisitCache.key !== key || ccVisitCache.D !== D) ccVisitCache = { key: key, D: D, list: countryVisits() };
  return ccVisitCache.list;
}
function buildCC() {
  ccLayer.clearLayers();
  ccLayer._ver = ccVer();
  if (!CB) decodeCountries();
  var list = visitedCountries(), maxD = list.reduce(function (m, c) { return Math.max(m, c.days); }, 1), green = cssVar('--accent'), blue = cssVar('--cc-air');
  list.forEach(function (c) {
    var rings = CB.rings[c.cc], color = c.layover ? blue : green;
    if (!rings) return;
    var latlngs = rings.map(function (ring) { var o = []; for (var j = 0; j < ring.length; j += 2) o.push([ring[j + 1], ring[j]]); return o; });
    var op = 0.18 + 0.32 * Math.log(1 + c.days) / Math.log(1 + maxD);
    ccLayer.addLayer(L.polygon(latlngs, { pane: 'cc', color: color, weight: 1, opacity: 0.6, fillColor: color, fillOpacity: op, fillRule: 'evenodd', interactive: false }));
  });
}

// ---------- heatmap ----------
// Points are binned into a grid of screen cells, each cell is drawn as a soft dot whose
// strength is its share of the busiest cells, then the grey levels are coloured.
var heatDirty = true, heatData = null;
function heatStops() {
  return isDark() ? ['rgba(255,140,110,0)', '#a8392b', '#e2574a', '#ff9a85', '#ffe1d9'] : ['rgba(250,180,160,0)', '#f7b8a6', '#e8644f', '#b8261a', '#6d0f07'];
}
var heatPalette = null, heatPalDark = null;
function palette() {
  var dark = isDark();
  if (heatPalette && heatPalDark === dark) return heatPalette;
  var c = document.createElement('canvas'); c.width = 256; c.height = 1;
  var x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 256, 0), st = heatStops();
  st.forEach(function (s, k) { g.addColorStop(k / (st.length - 1), s); });
  x.fillStyle = g; x.fillRect(0, 0, 256, 1);
  heatPalette = x.getImageData(0, 0, 256, 1).data; heatPalDark = dark;
  return heatPalette;
}
// What the heatmap counts: GPS points (each one counts once), paths (how many trips
// passed through an area) or time spent. Stays have no paths, so they fall back to time.
function heatBy() { return PREFS.heatSrc === 'stays' && PREFS.heatBy === 'paths' ? 'time' : PREFS.heatBy; }
function heatLabel() {
  var by = heatBy();
  if (PREFS.heatSrc === 'stays') return by === 'points' ? 'Visits' : 'Time stayed';
  return by === 'points' ? 'GPS points' : by === 'paths' ? 'Trips through' : 'Time travelled';
}
function heatPoints() {
  var by = heatBy(), ver = selVer() + PREFS.heatSrc + by;
  if (heatData && heatData.ver === ver) return heatData;
  // link[k] = 1 when point k continues the line from point k-1 (paths only); trip[k] keeps
  // each trip from counting twice in the same cell.
  var lat = [], lng = [], w = [], link = [], trip = [], note = '', i, j, k;
  if (PREFS.heatSrc === 'stays') {
    if (selV.length) {
      for (k = 0; k < selV.length; k++) {
        var v = selV[k], hrs = (D.ve[v] - D.vs[v]) / 36e5;
        lat.push(D.vll[2 * v]); lng.push(D.vll[2 * v + 1]); w.push(by === 'points' ? 1 : Math.sqrt(Math.min(hrs, 72)));
      }
      note = by === 'points' ? 'Places you stayed, each visit counting once.' : 'Places you stayed, weighted by how long you were there.';
    } else {
      for (k = 0; k < sel.length; k++) { i = sel[k]; lat.push(D.to[2 * i]); lng.push(D.to[2 * i + 1]); w.push(1); }
      note = 'This file has no stays, so the heatmap shows where your trips ended.';
    }
    if (PREFS.heatBy === 'paths') note += ' Stays have no paths, so this uses time spent.';
  } else {
    for (k = 0; k < sel.length; k++) {
      i = sel[k];
      var o0 = D.pathOff[i], o1 = D.pathOff[i + 1];
      if (modeOf(i) !== 'FLYING' && o1 - o0 >= 2) {
        for (j = o0; j < o1; j++) {
          lat.push(D.pathPts[2 * j]); lng.push(D.pathPts[2 * j + 1]); trip.push(k);
          // Don't draw a line the long way round across the date line.
          link.push(j > o0 && Math.abs(D.pathPts[2 * j + 1] - D.pathPts[2 * j - 1]) < 180 ? 1 : 0);
          if (by === 'time') {
            // Weight each GPS point by the time until the next one, so dense trails don't dominate.
            var dt = j + 1 < o1 ? D.pathT[j + 1] - D.pathT[j] : 0;
            w.push(Math.max(0.05, Math.min(10, dt / 60)));
          } else w.push(1);
        }
      } else if (by === 'paths') {
        // Flights (and trips without a trail) follow the same line the map draws for them.
        var tp = tripPath(i);
        for (j = 0; j < tp.length; j++) {
          var lo = ((tp[j][1] + 180) % 360 + 360) % 360 - 180;
          link.push(j > 0 && Math.abs(lo - lng[lng.length - 1]) < 180 ? 1 : 0);
          lat.push(tp[j][0]); lng.push(lo); w.push(1); trip.push(k);
        }
      } else {
        lat.push(D.from[2 * i], D.to[2 * i]); lng.push(D.from[2 * i + 1], D.to[2 * i + 1]);
        w.push(by === 'time' ? 0.5 : 1, by === 'time' ? 0.5 : 1); link.push(0, 0); trip.push(k, k);
      }
    }
    note = by === 'points' ? 'Where you travelled, with every GPS point counting once, so places with dense trails stand out.'
      : by === 'paths' ? 'Where you travelled, by how many trips went along each route.'
      : 'Where you travelled, by the time spent moving along each GPS trail.';
    note += by === 'paths' ? ' Flights follow the shortest route over the globe.' : ' Flights count only where they took off and landed.';
  }
  var n = lat.length, X = new Float64Array(n), Y = new Float64Array(n), W = Float32Array.from(w), r = Math.PI / 180;
  for (k = 0; k < n; k++) {
    var la = Math.max(-85, Math.min(85, lat[k]));
    X[k] = (lng[k] + 180) / 360;
    Y[k] = (1 - Math.log(Math.tan(la * r) + 1 / Math.cos(la * r)) / Math.PI) / 2;
    if (!isFinite(X[k]) || !isFinite(Y[k])) W[k] = 0;
  }
  heatData = { ver: ver, x: X, y: Y, w: W, lat: lat, lng: lng, note: note,
    link: by === 'paths' ? Uint8Array.from(link) : null, trip: by === 'paths' ? Int32Array.from(trip) : null };
  $('heatNote').textContent = note;
  return heatData;
}
var spriteCache = {};
function sprite(rad) {
  if (spriteCache[rad]) return spriteCache[rad];
  var c = document.createElement('canvas'); c.width = c.height = rad * 2;
  var x = c.getContext('2d'), g = x.createRadialGradient(rad, rad, 0, rad, rad, rad);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.45, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, rad * 2, rad * 2);
  return (spriteCache[rad] = c);
}
// Paints the heatmap H onto ctx (w × h CSS pixels at ratio dpr). xy(k) gives a point's screen position or null.
function paintHeat(ctx, w, h, dpr, H, xy) {
  var rad = Math.round(PREFS.heatSize * dpr), cell = Math.max(2, Math.round(rad / 3)), pad = rad;
  var gw = Math.ceil((w * dpr + 2 * pad) / cell), gh = Math.ceil((h * dpr + 2 * pad) / cell), grid = new Float32Array(gw * gh), k;
  var n = H.w.length, weight = H.w;
  if (H.link) paintPaths(grid, gw, gh, H, function (k) { var p = xy(k); return p && [(p[0] * dpr + pad) / cell, (p[1] * dpr + pad) / cell]; });
  else for (k = 0; k < n; k++) {
    var wk = weight[k];
    if (!wk) continue;
    var p = xy(k);
    if (!p) continue;
    var gx = Math.floor((p[0] * dpr + pad) / cell), gy = Math.floor((p[1] * dpr + pad) / cell);
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue;
    grid[gy * gw + gx] += wk;
  }
  var vals = [];
  for (k = 0; k < grid.length; k++) if (grid[k] > 0) vals.push(grid[k]);
  if (!vals.length) return;
  vals.sort(function (a, b) { return a - b; });
  // Intensity: the busiest cells (top 2%) saturate at the middle setting.
  var max = vals[Math.floor((vals.length - 1) * 0.98)] * Math.pow(2, (50 - PREFS.heatGain) / 12.5);
  var c = document.createElement('canvas'); c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  var x = c.getContext('2d'), sp = sprite(rad);
  for (k = 0; k < grid.length; k++) {
    if (!grid[k]) continue;
    x.globalAlpha = Math.min(1, 0.08 + 0.92 * grid[k] / max);
    x.drawImage(sp, (k % gw) * cell + cell / 2 - pad - rad, Math.floor(k / gw) * cell + cell / 2 - pad - rad);
  }
  var img = x.getImageData(0, 0, c.width, c.height), d = img.data, pal = palette();
  for (k = 0; k < d.length; k += 4) {
    var a = d[k + 3];
    if (!a) continue;
    var j = a * 4;
    d[k] = pal[j]; d[k + 1] = pal[j + 1]; d[k + 2] = pal[j + 2]; d[k + 3] = Math.min(255, pal[j + 3] * 0.9 + a * 0.1);
  }
  x.putImageData(img, 0, 0);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.88; ctx.drawImage(c, 0, 0); ctx.restore();
}
// Paths: walks each trip's line through the grid (g(k) gives a point in grid cells) and
// adds one to every cell it passes, at most once per trip.
function paintPaths(grid, gw, gh, H, g) {
  var stamp = new Int32Array(gw * gh).fill(-1), prev = null;
  function mark(x, y, t) {
    var cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) return;
    var c = cy * gw + cx;
    if (stamp[c] !== t) { stamp[c] = t; grid[c] += 1; }
  }
  for (var k = 0; k < H.w.length; k++) {
    var p = H.w[k] ? g(k) : null, t = H.trip[k];
    if (!p) { prev = null; continue; }
    if (prev && H.link[k]) {
      // Clip the segment to the grid (Liang–Barsky), then step one cell at a time.
      var x0 = prev[0], y0 = prev[1], dx = p[0] - x0, dy = p[1] - y0, t0 = 0, t1 = 1;
      var cl = [[-dx, x0], [dx, gw - x0], [-dy, y0], [dy, gh - y0]];
      for (var e = 0; e < 4 && t0 <= t1; e++) {
        var pp = cl[e][0], qq = cl[e][1];
        if (pp === 0) { if (qq < 0) t1 = -1; }
        else if (pp < 0) t0 = Math.max(t0, qq / pp);
        else t1 = Math.min(t1, qq / pp);
      }
      if (t0 <= t1) {
        var steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * (t1 - t0)) + 1;
        for (var s = 0; s <= steps; s++) { var f = t0 + (t1 - t0) * s / steps; mark(x0 + dx * f, y0 + dy * f, t); }
      }
    } else mark(p[0], p[1], t);
    prev = p;
  }
}
var HeatLayer = window.L ? L.Layer.extend({
  onAdd: function (m) {
    this._c = L.DomUtil.create('canvas', 'heat-canvas');
    this._c.style.pointerEvents = 'none';
    m.getPane('heat').appendChild(this._c);
    m.on('moveend resize', this.redraw, this);
    m.on('zoomstart', this._hide, this);
    this.redraw();
  },
  onRemove: function (m) {
    L.DomUtil.remove(this._c);
    m.off('moveend resize', this.redraw, this);
    m.off('zoomstart', this._hide, this);
  },
  _hide: function () { if (this._c) this._c.style.visibility = 'hidden'; },
  redraw: function () {
    if (!this._map || !this._c) return;
    heatDirty = false;
    var m = this._map, size = m.getSize(), dpr = Math.min(2, window.devicePixelRatio || 1), c = this._c;
    var tl = m.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(c, tl);
    c.width = Math.round(size.x * dpr); c.height = Math.round(size.y * dpr);
    c.style.width = size.x + 'px'; c.style.height = size.y + 'px'; c.style.visibility = '';
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    var H = heatPoints(), ws = 256 * Math.pow(2, m.getZoom()), o = m.getPixelOrigin(), ox = -o.x - tl.x, oy = -o.y - tl.y;
    // Draw once per visible copy of the world.
    var x0 = Math.floor((-ox) / ws), x1 = Math.floor((size.x - ox) / ws);
    for (var wcopy = x0; wcopy <= x1; wcopy++) {
      var shift = ox + wcopy * ws;
      paintHeat(ctx, size.x, size.y, dpr, H, function (k) { return [H.x[k] * ws + shift, H.y[k] * ws + oy]; });
    }
  }
}) : null;

// ---------- layers sheet ----------
function syncLayersUI() {
  setPressed('#projSeg button', function (b) { return b.dataset.proj === PREFS.proj; });
  setPressed('#heatSrc button', function (b) { return b.dataset.src === PREFS.heatSrc; });
  setPressed('#heatBy button', function (b) { return b.dataset.by === heatBy(); });
  document.querySelector('#heatBy [data-by="paths"]').disabled = PREFS.heatSrc === 'stays';
  $('layPaths').checked = PREFS.paths; $('laySpeed').checked = PREFS.speedPaths; $('speedNote').hidden = !PREFS.speedPaths; $('layHr').checked = !!PREFS.hrPaths; $('hrNote').hidden = !PREFS.hrPaths; $('laySquares').checked = PREFS.squares; $('squaresNote').hidden = !PREFS.squares; $('layHeat').checked = PREFS.heat; $('layCC').checked = PREFS.cc; $('layPins').checked = PREFS.pins;
  $('pinNote').hidden = !PREFS.pins;
  $('heatOpts').hidden = !PREFS.heat;
  $('heatSize').value = PREFS.heatSize; $('heatGain').value = PREFS.heatGain;
  $('map').hidden = PREFS.proj !== 'merc';
  $('proj').hidden = PREFS.proj === 'merc';
}
function layersChanged() {
  savePrefs(); syncLayersUI(); legend();
  if (map) { layerToggles(); if (PREFS.heat) heatLayer.redraw(); }
  if (PREFS.proj !== 'merc') drawProj();
  if (D) heatPoints();
}
// Paths, speed paths and heart rate paths draw the same lines in different colours, so turning one on turns the others off.
$('layPaths').addEventListener('change', function () { PREFS.paths = this.checked; if (this.checked) PREFS.speedPaths = PREFS.hrPaths = false; if (!this.checked && !PREFS.speedPaths && !PREFS.hrPaths) { setHovered([]); hideTip(); } layersChanged(); });
function colouredPaths(key, on) {
  PREFS.speedPaths = PREFS.hrPaths = false;
  PREFS[key] = on;
  if (on) { PREFS.paths = false; if (PREFS.proj !== 'merc') setProj('merc'); }
  else { setHovered([]); hideTip(); }
  layersChanged();
  // The open trip's line changes colour with heart rate paths.
  if (hlTrip != null) highlight(hlTrip);
}
$('laySpeed').addEventListener('change', function () { colouredPaths('speedPaths', this.checked); });
$('layHr').addEventListener('change', function () { colouredPaths('hrPaths', this.checked); });
$('laySquares').addEventListener('change', function () { PREFS.squares = this.checked; if (this.checked && PREFS.proj !== 'merc') setProj('merc'); if (!this.checked) hideTip(); layersChanged(); });
$('layHeat').addEventListener('change', function () { PREFS.heat = this.checked; layersChanged(); });
$('layCC').addEventListener('change', function () { PREFS.cc = this.checked; layersChanged(); });
$('layPins').addEventListener('change', function () { PREFS.pins = this.checked; if (this.checked && PREFS.proj !== 'merc') setProj('merc'); layersChanged(); });
$('heatSrc').addEventListener('click', function (ev) { var b = ev.target.closest('button[data-src]'); if (b) { PREFS.heatSrc = b.dataset.src; layersChanged(); } });
$('heatBy').addEventListener('click', function (ev) { var b = ev.target.closest('button[data-by]'); if (b && !b.disabled) { PREFS.heatBy = b.dataset.by; layersChanged(); } });
var heatTimer = 0;
['heatSize', 'heatGain'].forEach(function (id) {
  $(id).addEventListener('input', function () {
    PREFS[id] = +this.value;
    clearTimeout(heatTimer);
    heatTimer = setTimeout(function () { savePrefs(); if (map && PREFS.heat) heatLayer.redraw(); if (PREFS.proj !== 'merc' && P && P.proj) paintProj(); }, 40);
  });
});
$('projSeg').addEventListener('click', function (ev) { var b = ev.target.closest('button[data-proj]'); if (b) setProj(b.dataset.proj); });
function setProj(v) {
  if (v === PREFS.proj) return;
  PREFS.proj = v; savePrefs();
  hideTip(); setHovered([]);
  syncLayersUI();
  if (P) { P.fitted = false; P.z = 1; }
  if (v === 'merc') { if (initMap()) { map.invalidateSize(); highlight(hlTrip); if (P_pos) scrubTo(scrubV); } }
  else drawProj();
  $('mapNote').textContent = PATH_NOTE + (v !== 'merc' ? ' ' + PROJ_NOTES[v] : '');
}

// ---------- Equal Earth and globe ----------
// Leaflet only does Web Mercator, so these two are drawn on a canvas with d3-geo from the
// built-in country borders, reusing the trip list built for Leaflet.
var PROJ_NOTES = {
  ee: 'Equal Earth keeps every country at its true size. Drag to pan, pinch or scroll to zoom.',
  globe: 'Drag to turn the globe, pinch or scroll to zoom.'
};
var P = null, d3Loading = null;
function needD3(cb) {
  if (window.d3 && d3.geoEqualEarth) return cb();
  if (!d3Loading) {
    d3Loading = [];
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js';
    s.onload = function () { var q = d3Loading; d3Loading = null; q.forEach(function (f) { f(); }); };
    s.onerror = function () {
      d3Loading = null;
      $('proj').querySelector('canvas').hidden = true;
      $('proj').insertAdjacentHTML('beforeend', '<p class="empty" style="padding-top:40vh">The globe and Equal Earth views need an internet connection the first time. Check it and reload.</p>');
    };
    document.head.appendChild(s);
  }
  d3Loading.push(cb);
}
function initProj() {
  if (!CB) decodeCountries();
  var box = $('proj'), canvas = box.querySelector('canvas');
  P = { box: box, canvas: canvas, ctx: canvas.getContext('2d'), z: 1, gc: [8, 30], ctr: [8, 30], fitted: false, hovered: [], ver: 0, land: null };
  // Spherical polygons need a consistent winding: a ring that covers more than half the globe is turned around.
  P.landBy = {};
  P.land = Object.keys(CB.rings).map(function (cc) {
    var polys = CB.rings[cc].map(function (R) {
      var c = [];
      for (var j = 0; j < R.length; j += 2) c.push([R[j], R[j + 1]]);
      if (c.length && (c[0][0] !== c[c.length - 1][0] || c[0][1] !== c[c.length - 1][1])) c.push(c[0].slice());
      var poly = { type: 'Polygon', coordinates: [c] };
      if (d3.geoArea(poly) > 2 * Math.PI) c.reverse();
      return poly;
    });
    P.landBy[cc] = polys;
    return polys;
  });
  P.grat = d3.geoGraticule10();
  var drag = null, raf = 0, lastMove = null, touches = {}, pinch = null;
  function touchKeys() { return Object.keys(touches); }
  function pinchDist() { var k = touchKeys(); return Math.hypot(touches[k[0]][0] - touches[k[1]][0], touches[k[0]][1] - touches[k[1]][1]); }
  function pinchMid() { var k = touchKeys(); return [(touches[k[0]][0] + touches[k[1]][0]) / 2, (touches[k[0]][1] + touches[k[1]][1]) / 2]; }
  function local(ev) { var r = box.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
  canvas.addEventListener('pointerdown', function (ev) {
    if (ev.button !== 0) return;
    var p = local(ev);
    if (ev.pointerType === 'touch') touches[ev.pointerId] = p;
    if (touchKeys().length === 2) {
      drag = null; pinch = { d: pinchDist(), f: 1 };
      box.classList.add('dragging');
      canvas.setPointerCapture(ev.pointerId);
      return;
    }
    if (pinch) return;
    drag = { x: p[0], y: p[1], gc: P.gc.slice(), ctr: P.ctr.slice(), moved: false, proj: P.proj };
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', function (ev) {
    var p = local(ev);
    if (touches[ev.pointerId]) touches[ev.pointerId] = p;
    if (pinch) {
      if (touchKeys().length < 2) return;
      var d = pinchDist();
      if (pinch.d) pinch.f *= d / pinch.d;
      pinch.d = d;
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; if (pinch && pinch.f !== 1) { var f = pinch.f; pinch.f = 1; projZoom(f, pinchMid()); } });
      return;
    }
    if (drag) {
      var dx = p[0] - drag.x, dy = p[1] - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!drag.moved) { drag.moved = true; box.classList.add('dragging'); hideTip(); setProjHovered([]); }
      if (PREFS.proj === 'globe') {
        var deg = 180 / Math.PI / P.proj.scale();
        P.gc = [drag.gc[0] - dx * deg, Math.max(-89, Math.min(89, drag.gc[1] + dy * deg))];
      } else {
        var c = drag.proj.invert([P.w / 2 - dx, P.h / 2 - dy]);
        if (c && isFinite(c[0])) P.ctr = [c[0], Math.max(-85, Math.min(85, c[1]))];
      }
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; paintProj(true); });
      return;
    }
    if (ev.pointerType === 'mouse') { lastMove = p; if (!raf) raf = requestAnimationFrame(function () { raf = 0; projHover(lastMove, ev); }); }
  });
  function endTouch(ev) {
    delete touches[ev.pointerId];
    if (!pinch) return false;
    if (!touchKeys().length) { pinch = null; box.classList.remove('dragging'); paintProj(); }
    return true;
  }
  canvas.addEventListener('pointerup', function (ev) {
    if (endTouch(ev)) return;
    var d = drag; drag = null; box.classList.remove('dragging');
    if (d && d.moved) { paintProj(); return; }
    if (d) projClick(local(ev));
  });
  canvas.addEventListener('pointercancel', function (ev) { endTouch(ev); drag = null; box.classList.remove('dragging'); });
  canvas.addEventListener('pointerleave', function () { if (!drag) { setProjHovered([]); hideTip(); } });
  canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    projZoom(Math.pow(2, -ev.deltaY / (ev.deltaMode ? 3 : 300)), local(ev));
  }, { passive: false });
  box.querySelector('.proj-zoom').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-z]'); if (b) projZoom(+b.dataset.z, [P.w / 2, P.h / 2]);
  });
  window.addEventListener('resize', function () { if (tab === 'map' && PREFS.proj !== 'merc') paintProj(); });
}
function projZoom(f, at) {
  var z = Math.max(1, Math.min(PREFS.proj === 'globe' ? 30 : 60, P.z * f));
  if (z === P.z) return;
  if (PREFS.proj === 'ee') {
    // Keep the spot under the finger or cursor where it is.
    var before = P.proj.invert(at);
    P.z = z; setupProj();
    var after = before && P.proj(before);
    if (after) {
      var c = P.proj.invert([P.w / 2 + after[0] - at[0], P.h / 2 + after[1] - at[1]]);
      if (c && isFinite(c[0])) P.ctr = [c[0], Math.max(-85, Math.min(85, c[1]))];
    }
  } else P.z = z;
  hideTip();
  paintProj();
}
// Builds the d3 projection for the current size, zoom and centre.
function setupProj() {
  var w = P.box.clientWidth, h = P.box.clientHeight, pad = 12, sphere = { type: 'Sphere' };
  P.w = w; P.h = h;
  if (PREFS.proj === 'globe') {
    var pr = d3.geoOrthographic().clipAngle(90).precision(0.3).rotate([-P.gc[0], -P.gc[1]]).fitExtent([[pad, pad + 70], [w - pad, h - pad - 120]], sphere);
    P.s0 = pr.scale();
    pr.scale(P.s0 * P.z).translate([w / 2, h / 2 - 20]);
    P.proj = pr;
  } else {
    var pe = d3.geoEqualEarth().precision(0.3).fitExtent([[pad, pad], [w - pad, h - pad]], sphere);
    P.s0 = pe.scale();
    pe.scale(P.s0 * P.z).translate([w / 2, h / 2]);
    var q = pe(P.ctr);
    if (P.z <= 1) q = [w / 2, h / 2];
    pe.translate([w - q[0], h - q[1]]);
    P.proj = pe;
  }
}
function fitProj(bounds) {
  if (!bounds || !bounds.length) { P.z = 1; return; }
  var mp = { type: 'MultiPoint', coordinates: bounds.map(function (b) { return [b[1], b[0]]; }) };
  if (PREFS.proj === 'globe') {
    var c = d3.geoCentroid(mp);
    if (!isFinite(c[0])) c = mp.coordinates[0];
    var far = 0;
    mp.coordinates.forEach(function (p) { far = Math.max(far, d3.geoDistance(c, p)); });
    P.gc = [c[0], Math.max(-89, Math.min(89, c[1]))];
    P.z = far >= Math.PI / 2 ? 1 : Math.max(1, Math.min(30, 0.85 / Math.max(Math.sin(far), 0.02)));
  } else {
    var w = P.box.clientWidth, h = P.box.clientHeight;
    var pe = d3.geoEqualEarth().fitExtent([[12, 12], [w - 12, h - 12]], { type: 'Sphere' }), s0 = pe.scale();
    pe.fitExtent([[40, 90], [w - 40, h - 160]], mp);
    P.z = Math.max(1, Math.min(60, pe.scale() / s0));
    var cc = pe.invert([w / 2, h / 2]);
    P.ctr = cc && isFinite(cc[0]) ? cc : [8, 30];
  }
}
function drawProj() {
  if (PREFS.proj === 'merc' || tab !== 'map') return;
  needD3(function () {
    if (!P) initProj();
    if (!P.fitted) { fitProj(mapBounds.length ? mapBounds : null); P.fitted = true; }
    paintProj();
  });
}
function paintProj(fast) {
  if (!P || PREFS.proj === 'merc') return;
  setupProj();
  P.ver++;
  var w = P.w, h = P.h, dpr = Math.min(2, window.devicePixelRatio || 1), cv = P.canvas, ctx = P.ctx;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  var path = d3.geoPath(P.proj, ctx), dark = isDark();
  ctx.beginPath(); path({ type: 'Sphere' });
  ctx.fillStyle = dark ? '#17143a' : '#e2e4f0'; ctx.fill();
  ctx.beginPath(); path(P.grat);
  ctx.strokeStyle = dark ? '#241f4d' : '#d2d4e4'; ctx.lineWidth = 0.5; ctx.stroke();
  ctx.fillStyle = dark ? '#262150' : '#fffaf6'; ctx.strokeStyle = dark ? '#3d3768' : '#d6ccc4'; ctx.lineWidth = 0.6;
  P.land.forEach(function (polys) {
    ctx.beginPath();
    polys.forEach(function (poly) { path(poly); });
    ctx.fill('evenodd'); ctx.stroke();
  });
  if (PREFS.cc) {
    var list = visitedCountries(), maxD = list.reduce(function (m, c) { return Math.max(m, c.days); }, 1);
    var green = cssVar('--accent'), blue = cssVar('--cc-air');
    list.forEach(function (c) {
      var polys = P.landBy[c.cc];
      if (!polys) return;
      ctx.fillStyle = c.layover ? blue : green;
      ctx.globalAlpha = 0.18 + 0.32 * Math.log(1 + c.days) / Math.log(1 + maxD);
      ctx.beginPath(); polys.forEach(function (poly) { path(poly); }); ctx.fill('evenodd');
    });
    ctx.globalAlpha = 1;
  }
  ctx.beginPath(); path({ type: 'Sphere' });
  ctx.strokeStyle = cssVar('--line'); ctx.lineWidth = 1; ctx.stroke();
  if (PREFS.heat && !fast) {
    var H = heatPoints(), pr = P.proj, globe = PREFS.proj === 'globe', ctr = [P.gc[0], P.gc[1]];
    paintHeat(ctx, w, h, dpr, H, function (k) {
      var g = [H.lng[k], H.lat[k]];
      if (globe && d3.geoDistance(g, ctr) > Math.PI / 2) return null;
      var xy = pr(g);
      return xy && isFinite(xy[0]) ? xy : null;
    });
  }
  // Lines, grouped by colour so thousands of trips stay quick to draw.
  if (PREFS.paths) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var groups = {}, order = [];
    hits.forEach(function (hh) {
      if (hh.k >= visibleB || (P_cur && hh.i === P_cur.i) || P.hovered.indexOf(hh) >= 0) return;
      if (!groups[hh.color]) { groups[hh.color] = []; order.push(hh.color); }
      groups[hh.color].push(hh);
    });
    order.forEach(function (key) {
      var list = groups[key], each = !fast && list.length < 4000;
      ctx.strokeStyle = key; ctx.lineWidth = LINE_W; ctx.globalAlpha = LINE_OP;
      if (each) list.forEach(function (x) { ctx.beginPath(); path(projGeo(x)); ctx.stroke(); });
      else { ctx.beginPath(); list.forEach(function (x) { path(projGeo(x)); }); ctx.stroke(); }
    });
    P.hovered.forEach(function (x) {
      ctx.strokeStyle = x.color; ctx.lineWidth = LINE_W + 2; ctx.globalAlpha = 1;
      ctx.beginPath(); path(projGeo(x)); ctx.stroke();
    });
    ctx.globalAlpha = 1;
    if (P_cur && P_cur.pts.length > 1) {
      ctx.strokeStyle = cssVar(groupOf(modeOf(P_cur.i)).v); ctx.lineWidth = LINE_W + 2;
      ctx.beginPath(); path({ type: 'LineString', coordinates: P_cur.pts.map(function (q) { return [q[1], q[0]]; }) }); ctx.stroke();
    }
    if (hlTrip != null) {
      var g2 = { type: 'LineString', coordinates: tripPath(hlTrip).map(function (q) { return [q[1], q[0]]; }) };
      ctx.strokeStyle = cssVar('--panel'); ctx.lineWidth = 9; ctx.globalAlpha = 0.9; ctx.beginPath(); path(g2); ctx.stroke();
      ctx.strokeStyle = cssVar(groupOf(modeOf(hlTrip)).v); ctx.lineWidth = 5; ctx.globalAlpha = 1; ctx.beginPath(); path(g2); ctx.stroke();
    }
  }
  if (P_pos) {
    var g = [P_pos[1], P_pos[0]], xy = P.proj(g);
    if (xy && (PREFS.proj !== 'globe' || d3.geoDistance(g, [P.gc[0], P.gc[1]]) <= Math.PI / 2)) {
      var pm = posMode();
      if (pm) {
        var col = cssVar(groupOf(pm).v);
        ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(xy[0], xy[1], 15, 0, 7); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(xy[0], xy[1], 12, 0, 7); ctx.fill();
        var ic = posIc(), img = LINE_ICONS[ic] && lineIconImage(ic);
        if (img) ctx.drawImage(img, xy[0] - 8, xy[1] - 8, 16, 16);
        else {
          ctx.save(); ctx.translate(xy[0] - 8, xy[1] - 8); ctx.scale(16 / 24, 16 / 24); ctx.fillStyle = '#fff';
          ctx.fill(new Path2D(ICONS[pm] || ICONS.OTHER), pm === 'CABLE' ? 'evenodd' : 'nonzero'); ctx.restore();
        }
      } else {
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(xy[0], xy[1], 8, 0, 7); ctx.fill();
        ctx.fillStyle = cssVar('--pos-still'); ctx.beginPath(); ctx.arc(xy[0], xy[1], 5.5, 0, 7); ctx.fill();
      }
    }
  }
}
function projGeo(h) {
  return h.geo || (h.geo = { type: 'MultiLineString', coordinates: h.parts.map(function (p) { return p.map(function (q) { return [q[1], q[0]]; }); }) });
}
// Screen points for each line, cached until the view changes. Points on the far side of
// the globe are null, and so break the line.
function projPx(h) {
  if (h.pxVer === P.ver) return h.px;
  var pr = P.proj, globe = PREFS.proj === 'globe', ctr = [P.gc[0], P.gc[1]];
  h.px = h.parts.map(function (p) {
    return p.map(function (q) {
      var g = [q[1], q[0]];
      if (globe && d3.geoDistance(g, ctr) > Math.PI / 2) return null;
      var xy = pr(g);
      return xy && isFinite(xy[0]) ? xy : null;
    });
  });
  h.pxVer = P.ver;
  return h.px;
}
function projHitsAt(pt) {
  if (!PREFS.paths) return [];
  var out = [], maxJump = P.w / 2;
  for (var k = 0; k < hits.length; k++) {
    var h = hits[k];
    if (h.k >= visibleB) continue;
    var px = projPx(h), near = false, r = HIT_PX + h.w / 2;
    for (var q = 0; q < px.length && !near; q++) {
      var p = px[q];
      for (var j = 1; j < p.length && !near; j++) {
        var a = p[j - 1], b = p[j];
        if (!a || !b) continue;
        // A jump across the map edge (the date line on Equal Earth) isn't a real segment.
        if (Math.abs(a[0] - b[0]) > maxJump) continue;
        if (segDist({ x: pt[0], y: pt[1] }, { x: a[0], y: a[1] }, { x: b[0], y: b[1] }) <= r) near = true;
      }
    }
    if (near) out.push(h);
  }
  return out.sort(function (a, b) { return D.start[b.i] - D.start[a.i]; });
}
function setProjHovered(list) {
  var same = list.length === P.hovered.length && list.every(function (h, i) { return h === P.hovered[i]; });
  P.hovered = list;
  P.canvas.style.cursor = list.length ? 'pointer' : '';
  if (!same) paintProj();
}
function projHover(pt, ev) {
  if (!P || !P.proj || hits.length > 8000) return;
  var list = projHitsAt(pt);
  setProjHovered(list);
  if (!list.length) { hideTip(); return; }
  showTip(ev, hoverHtml(list.map(function (h) { return h.i; })));
}
function projClick(pt) {
  var list = projHitsAt(pt);
  if (!list.length) { if (openId === 'tripSheet') closeSheets(); return; }
  hideTip();
  if (list.length === 1) openTrip(list[0].i);
  else openList(list.map(function (h) { return h.i; }));
}
