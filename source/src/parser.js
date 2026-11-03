// BT;DT parser: turns Google Timeline exports into a flat list of trips
// {start, end, day, mode, km, est} with their GPS trails, plus the places stayed.
// Runs inside a Web Worker (or on the main thread as a fallback).
// Supported: on-device Timeline.json (Android), iPhone Timeline export,
// Takeout Semantic Location History monthly files, Takeout Records.json.

var MODE_ALIASES = {
  WALKING: ['WALKING', 'ON_FOOT', 'WALK', 'HIKING'],
  RUNNING: ['RUNNING'],
  CYCLING: ['CYCLING', 'ON_BICYCLE', 'BIKING'],
  CAR: ['IN_PASSENGER_VEHICLE', 'DRIVING', 'IN_CAR', 'CAR'],
  TAXI: ['IN_TAXI', 'TAXI'],
  // Generic "in a vehicle" without the kind; Google Maps shows these as "Moving".
  VEHICLE: ['IN_VEHICLE', 'MOTOR_VEHICLE', 'IN_ROAD_VEHICLE'],
  MOTORCYCLE: ['MOTORCYCLING', 'ON_MOTORCYCLE'],
  BUS: ['IN_BUS', 'BUS'],
  TRAIN: ['IN_TRAIN', 'IN_RAIL_VEHICLE', 'TRAIN'],
  TRAM: ['IN_TRAM', 'TRAM'],
  SUBWAY: ['IN_SUBWAY', 'SUBWAY'],
  FERRY: ['IN_FERRY', 'FERRY'],
  BOAT: ['SAILING', 'KAYAKING', 'ROWING', 'IN_BOAT', 'MOTOR_BOAT', 'BOATING'],
  FLYING: ['FLYING', 'IN_PLANE', 'IN_AIRPLANE'],
  SKIING: ['SKIING', 'SNOWBOARDING', 'SLEDDING'],
  OTHER: ['HORSEBACK_RIDING', 'SWIMMING', 'SKATING', 'SKATEBOARDING', 'INLINE_SKATING', 'WHEELCHAIR'],
  CABLE: ['IN_CABLECAR', 'IN_CABLE_CAR', 'IN_GONDOLA_LIFT', 'IN_FUNICULAR'],
  UNKNOWN: ['UNKNOWN_ACTIVITY_TYPE', 'UNKNOWN', 'TILTING', 'EXITING_VEHICLE', 'STILL', 'STATIONARY', '']
};
var ALIAS = {};
Object.keys(MODE_ALIASES).forEach(function (k) {
  MODE_ALIASES[k].forEach(function (a) { ALIAS[a] = k; });
});
function normMode(raw) {
  var s = String(raw == null ? '' : raw).trim().toUpperCase().replace(/[\s-]+/g, '_');
  return ALIAS[s] || ALIAS['IN_' + s] || 'UNKNOWN';
}

// "52.37°, 4.89°" | "geo:52.37,4.89" | {latLng: "..."} | {latitudeE7, longitudeE7}
var LL_RE = /(-?\d+(?:\.\d+)?)[^\d-]+?(-?\d+(?:\.\d+)?)/;
function parseLL(v) {
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v.latitudeE7 != null) return e7(v.latitudeE7, v.longitudeE7);
    if (v.latE7 != null) return e7(v.latE7, v.lngE7);
    v = v.latLng || v.LatLng || v.point || v.location;
    if (v == null || typeof v === 'object') return null;
  }
  var m = LL_RE.exec(String(v));
  if (!m) return null;
  var a = parseFloat(m[1]), b = parseFloat(m[2]);
  if (!(a >= -90 && a <= 90 && b >= -180 && b <= 180) || (a === 0 && b === 0)) return null;
  return [a, b];
}
function e7(a, b) {
  if (a == null || b == null) return null;
  if (a > 900000000) a -= 4294967296;
  if (b > 1800000000) b -= 4294967296;
  return [a / 1e7, b / 1e7];
}
function km(a, b) {
  if (!a || !b) return 0;
  var R = 6371.0088, r = Math.PI / 180;
  var dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Returns {ms, off} where off is the UTC offset in minutes written in the
// timestamp (so dates follow local time where you were), or null.
var OFF_RE = /([+-])(\d{2}):?(\d{2})$/;
function parseTime(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'number') return { ms: s, off: null };
  s = String(s);
  if (/^\d+$/.test(s)) return { ms: Number(s), off: null };
  var ms = Date.parse(s);
  if (!isFinite(ms)) return null;
  var m = /T.*/.test(s) ? OFF_RE.exec(s) : null;
  var off = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null;
  return { ms: ms, off: off };
}
function dayOf(t) {
  if (!t) return null;
  if (t.off != null) return Math.floor((t.ms + t.off * 60000) / 864e5);
  var d = new Date(t.ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
}

// Trip collector. est: 0 = distance from Timeline, 1 = from the GPS path,
// 2 = straight line between start and end (an underestimate on the ground).
// Each trip's GPS trail is kept as lat/lng pairs in one flat list (pathPts),
// with pathOff[i]..pathOff[i+1] marking trip i's slice, and pathT holding each
// point's time in seconds after the trip started.
// Places stayed (visits) are kept alongside: start, end, position, kind (1 home, 2 work).
function Collector() {
  this.start = []; this.end = []; this.day = []; this.mode = []; this.km = []; this.est = []; this.off = []; this.orig = []; this.from = []; this.to = [];
  this.pathPts = []; this.pathT = []; this.pathOff = [0];
  this.vs = []; this.ve = []; this.vday = []; this.voff = []; this.vll = []; this.vtype = []; this.vname = [];
}
// Trips Timeline couldn't classify get a mode guessed from their average speed,
// marked with the GUESSED bit in est.
var GUESSED = 4;
function guessMode(dist, hours) {
  if (!(hours > 0)) return null;
  var v = dist / hours;
  if (v < 7) return 'WALKING';
  if (v < 25) return 'CYCLING';
  if (v < 300) return 'CAR';
  return 'FLYING';
}
// Fastest believable average speed per mode (km/h). Timeline sometimes stores an
// absurd distance on a typed trip (e.g. 5,843 km for a car hop across Amsterdam).
var MAX_KMH = { WALKING: 15, RUNNING: 25, CYCLING: 50, CAR: 200, TAXI: 200, VEHICLE: 200, MOTORCYCLE: 200, BUS: 150, TRAIN: 350,
  TRAM: 100, SUBWAY: 120, FERRY: 80, BOAT: 80, CABLE: 60, SKIING: 120, OTHER: 60, FLYING: 1100 };
var FIXED = 8, NO_OFF = 32767;
Collector.prototype.add = function (mode, st, et, dist, est, a, b, pts, ptsT) {
  if (!st || !(dist > 0) || dist > 25000) return;
  var given = dist;
  var cap = MAX_KMH[mode], hours = et ? (et.ms - st.ms) / 36e5 : 0;
  // A distance measured along a full GPS recording (Strava) is kept as it is.
  if (cap && hours > 0 && dist / hours > cap && !this.gps) {
    // Too fast for this mode: trust the GPS trail if there is one, else the straight line, never more than Timeline said.
    var ln = km(a, b), trail = pts && pts.length ? pathKm([a].concat(pts, [b]).filter(Boolean)) : 0;
    var alt = trail > ln && trail / hours <= cap ? trail : ln, altEst = alt === trail && trail > ln ? 1 : 2;
    // A flight whose distance matches its ends just has a broken duration: keep it.
    if (mode === 'FLYING' && dist <= 1.2 * ln + 50) alt = dist;
    if (dist - alt > 1 && alt < dist * 0.8) { dist = alt; est = altEst | FIXED; }
    // Still far too fast over 250+ km: that was a flight Timeline typed as ground transport.
    // (Not trains: a 300+ km/h train is a fast train with a squeezed duration.)
    if (mode !== 'FLYING' && mode !== 'TRAIN' && ln >= 250 && dist / hours >= 500) { mode = 'FLYING'; est |= GUESSED; }
    if (!(dist > 0)) return;
  }
  if (mode === 'UNKNOWN' && et) {
    // Untyped trips often carry a broken distance (e.g. 148 km for a 16 km hop).
    // When it's far longer than the straight line between the ends, use the straight line.
    var line = km(a, b);
    if (line > 0 && dist > 3 * line + 5 && !this.gps) { dist = line; est = 2; }
    var g = guessMode(dist, (et.ms - st.ms) / 36e5);
    // Too fast for the ground but under 250 km apart is a GPS jump, not a flight: leave it out.
    if (g === 'FLYING' && !(line >= 250)) g = null;
    if (g) { mode = g; est |= GUESSED; }
  }
  var d = dayOf(st);
  if (d == null || !isFinite(d)) return;
  this.start.push(st.ms); this.end.push(et ? et.ms : st.ms); this.day.push(d);
  this.mode.push(mode); this.km.push(dist); this.est.push(est);
  // UTC offset in minutes (NO_OFF when the file doesn't say) and Timeline's own distance when we replaced it.
  this.off.push(st.off != null ? st.off : NO_OFF); this.orig.push(dist !== given ? given : 0);
  this.from.push(a ? a[0] : NaN, a ? a[1] : NaN); this.to.push(b ? b[0] : NaN, b ? b[1] : NaN);
  // No GPS in the air, so flights keep only their two ends.
  if (mode !== 'FLYING') {
    var dur = et ? Math.max(0, (et.ms - st.ms) / 1000) : 0, trail = [], times = [], i;
    if (a) { trail.push(a); times.push(0); }
    for (i = 0; pts && i < pts.length; i++) {
      if (!pts[i]) continue;
      trail.push(pts[i]);
      var tt = ptsT && ptsT[i] != null ? (ptsT[i] - st.ms) / 1000 : NaN;
      times.push(tt >= 0 && tt <= dur ? tt : NaN);
    }
    if (b) { trail.push(b); times.push(dur); }
    fillTimes(trail, times, dur);
    var last = null;
    for (i = 0; i < trail.length; i++) {
      // Skip points within ~20 m of the previous one; they add size but nothing visible.
      if (last && Math.abs(trail[i][0] - last[0]) < 0.0002 && Math.abs(trail[i][1] - last[1]) < 0.0003) {
        // The trip still ends when it ends, even if its last point repeats the one before.
        if (i === trail.length - 1) this.pathT[this.pathT.length - 1] = times[i];
        continue;
      }
      this.pathPts.push(trail[i][0], trail[i][1]); this.pathT.push(times[i]); last = trail[i];
    }
  }
  this.pathOff.push(this.pathPts.length / 2);
};
// Points without a timestamp get one by distance between the nearest timed points around them,
// and times are kept in order.
function fillTimes(pts, t, dur) {
  var n = pts.length, i, j;
  if (!n) return;
  if (!(t[0] >= 0)) t[0] = 0;
  if (!(t[n - 1] >= 0)) t[n - 1] = dur;
  for (i = 1; i < n; i++) if (t[i] < t[i - 1]) t[i] = NaN;
  if (!(t[n - 1] >= t[0])) t[n - 1] = Math.max(t[0], dur);
  for (i = 1; i < n; i++) {
    if (t[i] >= 0) continue;
    for (j = i + 1; j < n && !(t[j] >= 0); j++);
    var total = 0, k, seg = [];
    for (k = i; k <= j; k++) { total += km(pts[k - 1], pts[k]); seg.push(total); }
    for (k = i; k < j; k++) t[k] = t[i - 1] + (t[j] - t[i - 1]) * (total ? seg[k - i] / total : (k - i + 1) / (j - i + 1));
    i = j;
  }
}
var HOME = 1, WORK = 2;
Collector.prototype.visit = function (st, et, ll, type, name) {
  if (!st || !et || !ll || !(et.ms > st.ms)) return;
  var d = dayOf(st);
  if (d == null || !isFinite(d)) return;
  var k = String(type || '').toUpperCase();
  this.vs.push(st.ms); this.ve.push(et.ms); this.vday.push(d); this.voff.push(st.off != null ? st.off : NO_OFF);
  this.vll.push(ll[0], ll[1]); this.vtype.push(/HOME/.test(k) ? HOME : /WORK/.test(k) ? WORK : 0); this.vname.push(name || '');
};
function pathKm(pts) {
  var t = 0;
  for (var i = 1; i < pts.length; i++) t += km(pts[i - 1], pts[i]);
  return t;
}
function addActivity(c, type, st, et, meters, a, b, pts, ptsT) {
  var mode = normMode(type), d = Number(meters) / 1000, est = 0;
  if (!(d > 0) && pts && pts.length > 1) { d = pathKm(pts); est = 1; }
  if (!(d > 0)) { d = km(a, b); est = 2; }
  c.add(mode, st, et, d, est, a, b, pts, ptsT);
}
// [[ms, ll], …] → {pts, ts}
function split(list) {
  if (!list) return { pts: null, ts: null };
  return { pts: list.map(function (x) { return x[1]; }), ts: list.map(function (x) { return x[0]; }) };
}

// Known bad points in the owner's Timeline, fixed by hand. Each is a single stray
// location fix: points within 50 km of `bad` inside [from, to] are ignored, and a
// trip that starts or ends there takes `fix` (and the straight-line distance) instead.
var BAD_POINTS = [
  // 12 Apr 2026 Toronto → Amsterdam: one fix in Playa del Carmen, Mexico, mid-flight.
  { from: '2026-04-12T20:00:00Z', to: '2026-04-13T05:00:00Z', bad: [20.6733, -87.024], fix: [43.6777, -79.6248] }
];
function badPoint(ms, ll) {
  for (var i = 0; ll && i < BAD_POINTS.length; i++) {
    var b = BAD_POINTS[i];
    if (ms >= Date.parse(b.from) && ms <= Date.parse(b.to) && km(ll, b.bad) < 50) return b;
  }
  return null;
}
function parseAndroid(o, c) {
  var segs = o.semanticSegments || [], i, s, paths = [];
  // Path points are stored in separate segments; index them by time so trips without a distance can use them.
  for (i = 0; i < segs.length; i++) {
    s = segs[i];
    if (s.timelinePath) for (var j = 0; j < s.timelinePath.length; j++) {
      var p = s.timelinePath[j], t = parseTime(p.time) || parseTime(s.startTime), ll = parseLL(p.point);
      if (t && ll && !badPoint(t.ms, ll)) paths.push([t.ms, ll, t.off]);
    }
  }
  paths.sort(function (x, y) { return x[0] - y[0]; });
  for (i = 0; i < segs.length; i++) {
    s = segs[i];
    var st = parseTime(s.startTime), et = parseTime(s.endTime);
    if (s.visit) {
      var tc = s.visit.topCandidate || {};
      c.visit(st, et, parseLL(tc.placeLocation), tc.semanticType, '');
    }
    if (!s.activity) continue;
    var a = s.activity, p = split(st && et ? between(paths, st.ms, et.ms) : null);
    var aLL = parseLL(a.start), bLL = parseLL(a.end), meters = a.distanceMeters, bad;
    if (st && (bad = badPoint(st.ms, aLL))) { aLL = bad.fix; meters = km(aLL, bLL) * 1000; }
    if (et && (bad = badPoint(et.ms, bLL))) { bLL = bad.fix; meters = km(aLL, bLL) * 1000; }
    addActivity(c, a.topCandidate && a.topCandidate.type, st, et, meters, aLL, bLL, p.pts, p.ts);
  }
  pathTrips(segs, paths, c);
}
// Timeline sometimes keeps GPS points while moving but no trip for them (older data often has a
// day of driving as a few stays and nothing else). Points outside every trip and stay are joined
// into trips: a run ends at a gap of over 30 minutes, a jump of over 50 km, or a trip or stay.
// A run that gets at least 500 m from where it started becomes a trip with its type guessed from
// its speed (see runMode), marked with the PATH_TRIP and GUESSED bits in est.
var PATH_TRIP = 64;
// The type from how fast it went while moving (the average would count every stop on the way):
// the speed most of the moving legs stay under.
function runMode(run) {
  var v = [];
  for (var j = 1; j < run.length; j++) {
    var h = (run[j][0] - run[j - 1][0]) / 36e5, d = km(run[j - 1][1], run[j][1]);
    if (h >= 1 / 60 && d > 0.05) v.push(d / h);
  }
  if (!v.length) return 'WALKING';
  v.sort(function (x, y) { return x - y; });
  var fast = v[Math.floor(0.8 * (v.length - 1))];
  return fast >= 30 ? 'CAR' : fast >= 10 ? 'CYCLING' : 'WALKING';
}
function pathTrips(segs, paths, c) {
  var spans = [], i, k = 0, M = 2 * 60000;
  for (i = 0; i < segs.length; i++) {
    var s = segs[i];
    if (!s.visit && !s.activity) continue;
    var st = parseTime(s.startTime), et = parseTime(s.endTime);
    if (st && et) spans.push([st.ms, et.ms]);
  }
  spans.sort(function (a, b) { return a[0] - b[0]; });
  // Covered: inside a trip or stay (with a little slack at the ends). k only moves forward, and
  // the furthest end so far catches spans nested in a longer one.
  var run = [], lastEnd = -Infinity;
  function covered(ms) {
    while (k < spans.length && spans[k][0] - M <= ms) { lastEnd = Math.max(lastEnd, spans[k][1]); k++; }
    return ms <= lastEnd + M;
  }
  function flush() {
    if (run.length >= 2) {
      var a = run[0], b = run[run.length - 1], far = 0;
      for (var j = 1; j < run.length; j++) far = Math.max(far, km(a[1], run[j][1]));
      if (far >= 0.5) {
        var inner = run.slice(1, -1), before = c.start.length, off = a[2];
        c.add(runMode(run), { ms: a[0], off: off }, { ms: b[0], off: b[2] != null ? b[2] : off }, pathKm(run.map(function (x) { return x[1]; })), 1 | GUESSED, a[1], b[1],
          inner.map(function (x) { return x[1]; }), inner.map(function (x) { return x[0]; }));
        if (c.start.length > before) c.est[before] |= PATH_TRIP;
      }
    }
    run = [];
  }
  for (i = 0; i < paths.length; i++) {
    var p = paths[i], prev = run[run.length - 1], kBefore = k;
    if (covered(p[0])) { flush(); continue; }
    // A trip or stay that started since the previous point splits the run.
    if (prev && (k > kBefore && spans[k - 1][0] > prev[0] || p[0] - prev[0] > 30 * 60000 || km(prev[1], p[1]) > 50)) flush();
    run.push(p);
  }
  flush();
}
function between(L, a, b) {
  var lo = 0, hi = L.length;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (L[mid][0] < a) lo = mid + 1; else hi = mid; }
  var out = [];
  for (var i = lo; i < L.length && L[i][0] <= b; i++) out.push(L[i]);
  return out;
}

function parseIos(arr, c) {
  var paths = [], i, it;
  for (i = 0; i < arr.length; i++) {
    it = arr[i];
    var st0 = it && it.timelinePath && parseTime(it.startTime);
    if (st0) for (var j = 0; j < it.timelinePath.length; j++) {
      var p = it.timelinePath[j], ll = parseLL(p.point);
      if (ll) paths.push([st0.ms + (Number(p.durationMinutesOffsetFromStartTime) || 0) * 60000, ll]);
    }
  }
  paths.sort(function (x, y) { return x[0] - y[0]; });
  for (i = 0; i < arr.length; i++) {
    it = arr[i];
    if (!it) continue;
    var st = parseTime(it.startTime), et = parseTime(it.endTime);
    if (it.visit) {
      var tc = it.visit.topCandidate || {};
      c.visit(st, et, parseLL(tc.placeLocation), tc.semanticType, '');
    }
    if (!it.activity) continue;
    var a = it.activity, p = split(st && et ? between(paths, st.ms, et.ms) : null);
    addActivity(c, a.topCandidate && a.topCandidate.type, st, et, a.distanceMeters, parseLL(a.start), parseLL(a.end), p.pts, p.ts);
  }
}

function parseSemantic(o, c) {
  var objs = o.timelineObjects || [];
  for (var i = 0; i < objs.length; i++) {
    var v = objs[i].placeVisit;
    if (v) {
      var vd = v.duration || {}, loc = v.location || {};
      c.visit(parseTime(vd.startTimestamp || vd.startTimestampMs), parseTime(vd.endTimestamp || vd.endTimestampMs),
        parseLL(loc) || parseLL(v.centerLatE7 != null ? { latE7: v.centerLatE7, lngE7: v.centerLngE7 } : null), loc.semanticType, loc.name);
    }
    var a = objs[i].activitySegment;
    if (!a) continue;
    var d = a.duration || {}, pts = [], j, w;
    w = (a.waypointPath && a.waypointPath.waypoints) || [];
    for (j = 0; j < w.length; j++) pts.push(parseLL(w[j]));
    // Prefer the recorded raw path when it is more detailed than the waypoints.
    var raw = ((a.simplifiedRawPath && a.simplifiedRawPath.points) || []).map(parseLL).filter(Boolean);
    pts = pts.filter(Boolean);
    if (raw.length > pts.length) pts = raw;
    var meters = a.distance != null ? a.distance : (a.waypointPath && a.waypointPath.distanceMeters);
    var type = a.activityType || (a.activities && a.activities[0] && a.activities[0].activityType);
    addActivity(c, type, parseTime(d.startTimestamp || d.startTimestampMs), parseTime(d.endTimestamp || d.endTimestampMs),
      meters, parseLL(a.startLocation), parseLL(a.endLocation), pts);
  }
}

// Records.json has raw points only, so trips are rebuilt: consecutive points
// with the same transport mode form a trip, and a long fast jump between
// two points (no data while in the air) counts as a flight.
// Every usable point is also kept in a compact track (time, position, phone), which
// later gives the trips from Timeline exports their full GPS trail (see withTrack).
function RecordTrips(c) { this.c = c; this.prev = null; this.cur = null; this.tt = []; this.tll = []; this.tdev = []; }
RecordTrips.prototype.point = function (ll, t, mode, dev) {
  if (!ll || !t) return;
  this.tt.push(t.ms); this.tll.push(ll[0], ll[1]); this.tdev.push(dev | 0);
  var p = this.prev;
  this.prev = { ll: ll, t: t };
  if (!p || t.ms <= p.t.ms) return;
  var d = km(p.ll, ll), h = (t.ms - p.t.ms) / 36e5;
  if (d > 150 && h < 20 && d / h > 180) { this.flush(); this.c.add('FLYING', p.t, t, d, 2, p.ll, ll, null); return; }
  if (h > 0.5) { this.flush(); return; }
  var cur = this.cur;
  if (mode === 'UNKNOWN') { if (!cur || d < 0.1) return; mode = cur.mode; }
  if (!cur || cur.mode !== mode) { this.flush(); this.cur = cur = { mode: mode, st: p.t, a: p.ll, d: 0, pts: [], ts: [] }; }
  cur.d += d; cur.et = t; cur.b = ll; cur.pts.push(ll); cur.ts.push(t.ms);
};
RecordTrips.prototype.flush = function () {
  var cur = this.cur;
  if (cur && cur.mode !== 'UNKNOWN' && cur.d > 0.05) this.c.add(cur.mode, cur.st, cur.et, cur.d, 1, cur.a, cur.b, cur.pts.slice(0, -1), cur.ts.slice(0, -1));
  this.cur = null;
};
function recordMode(L) {
  var a = L.activity && L.activity[0] && L.activity[0].activity, best = null;
  if (!a) return 'UNKNOWN';
  for (var k = 0; k < a.length; k++) if (!best || a[k].confidence > best.confidence) best = a[k];
  return best ? normMode(best.type) : 'UNKNOWN';
}
// Fixes worse than this (mostly cell towers, often kilometres off) are left out.
var MAX_ACCURACY = 200;
function addRecord(L, rt) {
  if (L.accuracy > MAX_ACCURACY) return;
  rt.point(e7(L.latitudeE7, L.longitudeE7), parseTime(L.timestamp != null ? L.timestamp : L.timestampMs), recordMode(L), L.deviceTag);
}
// The track in time order (a file is almost always in order already).
RecordTrips.prototype.track = function () {
  var n = this.tt.length, t = this.tt, ord = null, i;
  for (i = 1; i < n; i++) if (t[i] < t[i - 1]) break;
  if (i < n) ord = Array.from({ length: n }, function (_, k) { return k; }).sort(function (a, b) { return t[a] - t[b]; });
  var T = new Float64Array(n), LL = new Float32Array(2 * n), DV = new Int32Array(n);
  for (i = 0; i < n; i++) {
    var k = ord ? ord[i] : i;
    T[i] = t[k]; LL[2 * i] = this.tll[2 * k]; LL[2 * i + 1] = this.tll[2 * k + 1]; DV[i] = this.tdev[k];
  }
  return { t: T, ll: LL, dev: DV };
};
function finishRecords(c, rt) {
  rt.flush();
  var r = finish(c, SRC.records);
  r.track = rt.track();
  return r;
}
function parseRecords(o, c) {
  var locs = o.locations || [], rt = new RecordTrips(c);
  for (var i = 0; i < locs.length; i++) addRecord(locs[i], rt);
  return rt;
}

// ---------- Records GPS under Timeline trips ----------
// Timeline exports keep a point every few minutes; Records.json keeps one about every minute,
// from the same phone. withTrack gives each Timeline trip the Records points recorded during it,
// so its line and the heatmap follow the real route. Marked with the RECORDS_GPS bit in est.
var RECORDS_GPS = 32;
// Several tracks (one per Records file) as one, in time order; a point loaded twice is kept once.
function mergeTracks(list) {
  list = list.filter(function (x) { return x && x.t && x.t.length; });
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  list.sort(function (a, b) { return a.t[0] - b.t[0]; });
  var n = 0, i, j, sorted = true;
  for (i = 0; i < list.length; i++) { n += list[i].t.length; if (i && list[i].t[0] < list[i - 1].t[list[i - 1].t.length - 1]) sorted = false; }
  var t = new Float64Array(n), ll = new Float32Array(2 * n), dev = new Int32Array(n), w = 0;
  for (i = 0; i < list.length; i++) {
    t.set(list[i].t, w); ll.set(list[i].ll, 2 * w); dev.set(list[i].dev, w); w += list[i].t.length;
  }
  var ord = null;
  if (!sorted) ord = Uint32Array.from(Array.from({ length: n }, function (_, k) { return k; }).sort(function (a, b) { return t[a] - t[b]; }));
  var T = new Float64Array(n), LL = new Float32Array(2 * n), DV = new Int32Array(n);
  for (i = 0, j = 0; i < n; i++) {
    var k = ord ? ord[i] : i;
    if (j && t[k] === T[j - 1]) continue;
    T[j] = t[k]; LL[2 * j] = ll[2 * k]; LL[2 * j + 1] = ll[2 * k + 1]; DV[j] = dev[k]; j++;
  }
  return { t: T.slice(0, j), ll: LL.slice(0, 2 * j), dev: DV.slice(0, j) };
}
function firstAt(t, ms) {
  var lo = 0, hi = t.length;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (t[mid] < ms) lo = mid + 1; else hi = mid; }
  return lo;
}
// The Records points for trip i of R: from one phone only (the one whose points match the
// trip's own trail, which Timeline took from that phone), without single stray jumps.
function trackFor(R, T, i, mode) {
  var lo = firstAt(T.t, R.start[i]), hi = firstAt(T.t, R.end[i] + 1), k, j;
  if (hi - lo < 3) return null;
  var count = {}, devs = [];
  for (k = lo; k < hi; k++) { if (!count[T.dev[k]]) { count[T.dev[k]] = 0; devs.push(T.dev[k]); } count[T.dev[k]]++; }
  var dev = devs[0];
  if (devs.length > 1) {
    var own = [[R.from[2 * i], R.from[2 * i + 1]], [R.to[2 * i], R.to[2 * i + 1]]], score = {}, best = -1;
    for (j = R.pathOff[i]; j < R.pathOff[i + 1]; j++) own.push([R.pathPts[2 * j], R.pathPts[2 * j + 1]]);
    for (k = lo; k < hi; k++) {
      var p = [T.ll[2 * k], T.ll[2 * k + 1]];
      for (j = 0; j < own.length; j++) if (km(p, own[j]) < 0.05) { score[T.dev[k]] = (score[T.dev[k]] || 0) + 1; break; }
    }
    devs.forEach(function (d) {
      var s = (score[d] || 0) * 1e6 + count[d];
      if (s > best) { best = s; dev = d; }
    });
  }
  var pts = [], ts = [];
  for (k = lo; k < hi; k++) if (T.dev[k] === dev) { pts.push([T.ll[2 * k], T.ll[2 * k + 1]]); ts.push(T.t[k]); }
  // A point far off the line that the next point comes straight back from is a bad fix.
  var cap = Math.max(30, 1.5 * (MAX_KMH[mode] || 200)), keep = [pts[0]], kt = [ts[0]];
  for (k = 1; k < pts.length; k++) {
    var a = keep[keep.length - 1], h1 = (ts[k] - kt[kt.length - 1]) / 36e5, d1 = km(a, pts[k]);
    if (k + 1 < pts.length && d1 > 1 && (h1 <= 0 || d1 / h1 > cap)) {
      var h2 = (ts[k + 1] - ts[k]) / 36e5, d2 = km(pts[k], pts[k + 1]);
      if ((h2 <= 0 || d2 / h2 > cap) && km(a, pts[k + 1]) < d1) continue;
    }
    keep.push(pts[k]); kt.push(ts[k]);
  }
  return keep.length >= 3 ? { pts: keep, ts: kt } : null;
}
// R with the trips from Timeline exports re-drawn on the Records track T. The distance is
// measured along the track too (smoothed to 25 m, so GPS jitter adds nothing) when it covers the whole trip (no gap over 15 minutes, and
// within 10 minutes of both ends); Timeline's own distance is kept in orig.
function withTrack(R, T) {
  if (!T || !T.t.length) return R;
  var n = R.start.length, paths = new Array(n), any = false, i, mode;
  var est = Uint8Array.from(R.est), kmv = Float32Array.from(R.km), orig = Float32Array.from(R.orig);
  for (i = 0; i < n; i++) {
    var s = R.srcs ? R.srcs[i] : R.src;
    mode = MODES[R.mode[i]];
    if (s === SRC.records || s === SRC.strava || s === SRC.sim || est[i] & (RECORDS_GPS | STRAVA) || mode === 'FLYING') continue;
    var tr = trackFor(R, T, i, mode);
    if (!tr || tr.pts.length <= R.pathOff[i + 1] - R.pathOff[i]) continue;
    var a = [R.from[2 * i], R.from[2 * i + 1]], b = [R.to[2 * i], R.to[2 * i + 1]], dur = (R.end[i] - R.start[i]) / 1000;
    var trail = [], times = [];
    if (isFinite(a[0])) { trail.push(a); times.push(0); }
    tr.pts.forEach(function (p, k) { trail.push(p); times.push((tr.ts[k] - R.start[i]) / 1000); });
    if (isFinite(b[0])) { trail.push(b); times.push(dur); }
    var keep = simplify(trail, 6);
    paths[i] = { pts: keep.map(function (k) { return trail[k]; }), t: keep.map(function (k) { return times[k]; }) };
    est[i] |= RECORDS_GPS; any = true;
    var gap = Math.max(tr.ts[0] - R.start[i], R.end[i] - tr.ts[tr.ts.length - 1]), inner = 0;
    for (var k = 1; k < tr.ts.length; k++) inner = Math.max(inner, tr.ts[k] - tr.ts[k - 1]);
    if (gap > 10 * 60000 || inner > 15 * 60000 || mode === 'UNKNOWN') continue;
    var d = pathKm(simplify(trail, 25).map(function (k) { return trail[k]; })), hours = dur / 3600;
    if (!(d > 0) || (hours > 0 && d / hours > (MAX_KMH[mode] || 200))) continue;
    if (!(est[i] & FIXED)) orig[i] = (est[i] & 3) === 0 ? kmv[i] : 0;
    kmv[i] = d; est[i] = (est[i] & ~3) | 1;
  }
  if (!any) return R;
  var O = {}, w = 0, np = 0;
  Object.keys(R).forEach(function (key) { O[key] = R[key]; });
  for (i = 0; i < n; i++) np += paths[i] ? paths[i].pts.length : R.pathOff[i + 1] - R.pathOff[i];
  O.pathPts = new Float32Array(2 * np); O.pathT = new Float32Array(np); O.pathOff = new Uint32Array(n + 1);
  for (i = 0; i < n; i++) {
    if (paths[i]) for (var q = 0; q < paths[i].pts.length; q++, w++) { O.pathPts[2 * w] = paths[i].pts[q][0]; O.pathPts[2 * w + 1] = paths[i].pts[q][1]; O.pathT[w] = paths[i].t[q]; }
    else for (q = R.pathOff[i]; q < R.pathOff[i + 1]; q++, w++) { O.pathPts[2 * w] = R.pathPts[2 * q]; O.pathPts[2 * w + 1] = R.pathPts[2 * q + 1]; O.pathT[w] = R.pathT[q]; }
    O.pathOff[i + 1] = w;
  }
  O.est = est; O.km = kmv; O.orig = orig;
  return O;
}

// Source codes, highest priority first when the same day appears in several exports.
// Strava activities don't compete per day; they replace the Timeline trips they cover (see withStrava).
// Simulated trips (an on-device-format file with "simulated": true at the top) don't compete per day
// either; they replace whatever overlaps them in time (see merge).
var SRC = { device: 0, ios: 1, semantic: 2, records: 3, sim: 8, strava: 9 };
var KIND_LABEL = ['Timeline.json (on-device)', 'iPhone Timeline export', 'Takeout Semantic Location History', 'Takeout Records.json'];
KIND_LABEL[SRC.strava] = 'Strava';
KIND_LABEL[SRC.sim] = 'Simulated trips';
var MODES = Object.keys(MODE_ALIASES);
var MODE_IDX = {};
MODES.forEach(function (m, i) { MODE_IDX[m] = i; });

// A guessed flight next to a flight Timeline already recorded (same airport, within
// a few hours) is the same journey seen twice: keep only the recorded one.
function dropDuplicateFlights(c) {
  var real = [], drop = {}, i, j, any = false;
  for (i = 0; i < c.mode.length; i++) if (c.mode[i] === 'FLYING' && !(c.est[i] & GUESSED)) real.push(i);
  for (i = 0; i < c.mode.length; i++) {
    if (c.mode[i] !== 'FLYING' || !(c.est[i] & GUESSED)) continue;
    for (j = 0; j < real.length; j++) {
      var r = real[j];
      if (Math.abs(c.start[r] - c.start[i]) > 6 * 36e5) continue;
      var a = [c.from[2 * i], c.from[2 * i + 1]], b = [c.from[2 * r], c.from[2 * r + 1]];
      if (km(a, b) < 100) { drop[i] = true; any = true; break; }
    }
  }
  if (!any) return c;
  var o = new Collector();
  ['vs', 've', 'vday', 'voff', 'vll', 'vtype', 'vname'].forEach(function (k) { o[k] = c[k]; });
  for (i = 0; i < c.mode.length; i++) {
    if (drop[i]) continue;
    o.start.push(c.start[i]); o.end.push(c.end[i]); o.day.push(c.day[i]); o.mode.push(c.mode[i]); o.km.push(c.km[i]); o.est.push(c.est[i]); o.off.push(c.off[i]); o.orig.push(c.orig[i]);
    o.from.push(c.from[2 * i], c.from[2 * i + 1]); o.to.push(c.to[2 * i], c.to[2 * i + 1]);
    for (j = c.pathOff[i]; j < c.pathOff[i + 1]; j++) { o.pathPts.push(c.pathPts[2 * j], c.pathPts[2 * j + 1]); o.pathT.push(c.pathT[j]); }
    o.pathOff.push(o.pathPts.length / 2);
  }
  return o;
}
function finish(c, src) {
  c = dropDuplicateFlights(c);
  return {
    src: src, kind: KIND_LABEL[src],
    start: Float64Array.from(c.start), end: Float64Array.from(c.end), day: Int32Array.from(c.day),
    mode: Uint8Array.from(c.mode.map(function (m) { return MODE_IDX[m]; })),
    km: Float32Array.from(c.km), est: Uint8Array.from(c.est), off: Int16Array.from(c.off), orig: Float32Array.from(c.orig),
    from: Float32Array.from(c.from), to: Float32Array.from(c.to),
    pathPts: Float32Array.from(c.pathPts), pathT: Float32Array.from(c.pathT), pathOff: Uint32Array.from(c.pathOff),
    vs: Float64Array.from(c.vs), ve: Float64Array.from(c.ve), vday: Int32Array.from(c.vday), voff: Int16Array.from(c.voff),
    vll: Float32Array.from(c.vll), vtype: Uint8Array.from(c.vtype), vname: c.vname
  };
}
var NOT_TIMELINE = "This file doesn't look like Google Timeline data. Pick Timeline.json from your phone, or Records.json / Semantic Location History files from Google Takeout.";
function parseTimeline(o) {
  var c = new Collector(), src;
  if (Array.isArray(o)) { src = SRC.ios; parseIos(o, c); }
  else if (o && o.semanticSegments) { src = o.simulated === true ? SRC.sim : SRC.device; parseAndroid(o, c); }
  else if (o && o.locations) return finishRecords(c, parseRecords(o, c));
  else if (o && o.timelineObjects) { src = SRC.semantic; parseSemantic(o, c); }
  else throw new Error(NOT_TIMELINE);
  return finish(c, src);
}

// What kind of file is this, judging by its first few KB (so huge unrelated
// Takeout files such as "Timeline Edits.json" are skipped without reading them).
function sniff(head) {
  if (/^\s*\[/.test(head)) return 'ios';
  if (/"semanticSegments"\s*:/.test(head)) return 'device';
  if (/"timelineObjects"\s*:/.test(head)) return 'semantic';
  if (/^\s*\{\s*"locations"\s*:/.test(head)) return 'records';
  return null;
}

// Records.json can be several hundred MB, too big to load as one string.
// Read it in 8 MB slices and parse one location entry at a time.
function parseRecordsStream(file, onProgress) {
  var c = new Collector(), rt = new RecordTrips(c);
  var CH = 8 << 20, off = 0, dec = new TextDecoder();
  var buf = '', pos = 0, depth = 0, inStr = false, esc = false, start = -1;
  function step() {
    if (off >= file.size) return Promise.resolve(finishRecords(c, rt));
    return file.slice(off, off + CH).arrayBuffer().then(function (ab) {
      off += ab.byteLength;
      buf += dec.decode(new Uint8Array(ab), { stream: off < file.size });
      for (var i = pos, n = buf.length; i < n; i++) {
        var ch = buf.charCodeAt(i);
        if (inStr) { if (esc) esc = false; else if (ch === 92) esc = true; else if (ch === 34) inStr = false; continue; }
        if (ch === 34) inStr = true;
        else if (ch === 123 || ch === 91) { depth++; if (depth === 3 && ch === 123) start = i; }
        else if (ch === 125 || ch === 93) {
          depth--;
          if (depth === 2 && ch === 125 && start >= 0) {
            try { addRecord(JSON.parse(buf.slice(start, i + 1)), rt); } catch (e) { /* skip a damaged entry */ }
            start = -1;
          }
        }
      }
      if (start >= 0) { buf = buf.slice(start); start = 0; pos = buf.length; } else { buf = ''; pos = 0; }
      onProgress(off / file.size);
      return step();
    });
  }
  return step();
}

// ---------- Strava ----------
// Strava's account export is a ZIP with activities.csv (one row per activity, with its
// type and file name) and an activities/ folder holding each recording as .gpx, .tcx or
// .fit, often gzipped. Single activity files work too. Every activity with GPS becomes a
// trip marked with the STRAVA bit in est; its track is thinned for the map, but the
// distance is measured on the full track.
var STRAVA = 16;
var NO_STRAVA = 'No Strava activities with GPS were found in this file.';
function isStravaName(name) { return /\.(zip|gpx|tcx|fit)(\.gz)?$/i.test(name); }

// Strava's sports. Each one belongs to a transport mode (its parent in the filters and the
// colour on the map) and is kept on the trip as its index in SPORTS (0 = none). They are
// matched by their English names and common translations, in this order, so the more
// specific names (E-Mountain Bike Ride, Trail Run…) are tried before the general ones.
// Saved trips store the index, so new sports go at the end.
var SPORTS = [null,
  ['emtb', 'E-mountain bike', 'CYCLING', /e-?mountain|e-?mtb/],
  ['mtb', 'Mountain bike', 'CYCLING', /mountain|mtb|vtt|ciclismo de monta|bicicleta de monta/],
  ['ebike', 'E-bike', 'CYCLING', /e-?bike|elektr|électrique|eléctrica|elettrica/],
  ['gravel', 'Gravel ride', 'CYCLING', /gravel/],
  ['velomobile', 'Velomobile', 'CYCLING', /velomobil/],
  ['handcycle', 'Handcycle', 'CYCLING', /handcycl|handbike/],
  ['ride', 'Ride', 'CYCLING', /ride|bik|cycl|fiets|bici|v[ée]lo|rad/],
  ['trailrun', 'Trail run', 'RUNNING', /trail|carrera por monta/],
  ['run', 'Run', 'RUNNING', /\brun|hardloop|carrera|course|lauf|corsa|corrida/],
  ['rollerski', 'Roller ski', 'OTHER', /roller.?ski|rollski|skiroll/],
  ['backcountry', 'Backcountry ski', 'SKIING', /backcountry|skitour|ski de rando|randonnée à ski|travesía|alpinisme/],
  ['nordic', 'Nordic ski', 'SKIING', /nordic|cross.?country|langlauf|fondo|nordique|de fond|nórdico|langlaufen/],
  ['snowboard', 'Snowboard', 'SKIING', /snowboard/],
  ['snowshoe', 'Snowshoe', 'SKIING', /snowshoe|schneeschuh|raquette|sneeuwschoen|raquetas/],
  ['iceskate', 'Ice skate', 'SKIING', /ice.?skat|eislauf|schaats|patinaje sobre hielo|patin à glace/],
  ['alpine', 'Alpine ski', 'SKIING', /ski|esqu[ií]/],
  ['wheelchair', 'Wheelchair', 'WALKING', /wheelchair|rollstuhl|rolstoel|fauteuil|silla de ruedas/],
  ['hike', 'Hike', 'WALKING', /hik|wanderung|senderismo|randonn|escursion|caminhada/],
  ['walk', 'Walk', 'WALKING', /walk|wandel|spazier|camin|marche|passeggiat/],
  ['kayak', 'Kayaking', 'BOAT', /kayak|kajak/],
  ['canoe', 'Canoeing', 'BOAT', /cano|kano/],
  ['sup', 'Stand-up paddle', 'BOAT', /stand.?up|paddl|\bsup\b/],
  ['row', 'Rowing', 'BOAT', /row|roei|remo|aviron|ruder|rudern/],
  ['kitesurf', 'Kitesurf', 'BOAT', /kite/],
  ['windsurf', 'Windsurf', 'BOAT', /windsurf/],
  ['surf', 'Surfing', 'BOAT', /surf/],
  ['sail', 'Sailing', 'BOAT', /sail|zeil|segel|vela\b|voile/],
  ['swim', 'Swim', 'BOAT', /swim|zwem|schwimm|nataci|nuoto|natação|nage/],
  ['skateboard', 'Skateboard', 'OTHER', /skateboard/],
  ['inline', 'Inline skate', 'OTHER', /inline|skeeler|skat/],
  ['golf', 'Golf', 'OTHER', /golf/],
  ['climb', 'Climbing', 'OTHER', /climb|klett|klim|escalad|arrampic/],
  ['workout', 'Workout', 'OTHER', /workout|training|crossfit|hiit|weight|yoga|pilates|ellipti|stair|entrenamiento|entraînement/]
];
// Strava's GPX files give the type as a number, FIT files as their own number.
var GPX_TYPE = { 1: 'Ride', 4: 'Hike', 9: 'Run', 10: 'Walk', 18: 'Ride' };
var FIT_SPORT = { 1: 'Run', 2: 'Ride', 5: 'Swim', 11: 'Walk', 12: 'Nordic Ski', 13: 'Alpine Ski', 14: 'Snowboard', 15: 'Rowing', 17: 'Hike',
  21: 'E-Bike Ride', 30: 'Inline Skate', 31: 'Rock Climbing', 32: 'Sail', 33: 'Ice Skate', 35: 'Snowshoe', 37: 'Stand Up Paddling',
  38: 'Surfing', 41: 'Kayaking', 43: 'Windsurf', 44: 'Kitesurf' };
// Activity type → { mode, sport }. mode null means skip (virtual rides happen on a map that
// isn't the world); a type that matches no sport keeps sport 0 and a mode guessed from speed.
function stravaSport(t) {
  var s = String(t == null ? '' : t).trim().toLowerCase();
  if (/^\d+$/.test(s)) { if (s === '17') return { mode: null, sport: 0 }; s = (GPX_TYPE[s] || '').toLowerCase(); }
  if (!s) return { mode: 'UNKNOWN', sport: 0 };
  if (/virtu/.test(s)) return { mode: null, sport: 0 };
  for (var k = 1; k < SPORTS.length; k++) if (SPORTS[k][3].test(s)) return { mode: SPORTS[k][2], sport: k };
  return { mode: normMode(s), sport: 0 };
}

function gunzip(buf) {
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
function maybeGunzip(name, buf) { return /\.gz$/i.test(name) ? gunzip(buf) : Promise.resolve(buf); }

// GPX and TCX are small enough XML to read with patterns (Web Workers have no DOMParser).
function attr(s, name) { var m = new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']+)').exec(s); return m ? parseFloat(m[1]) : NaN; }
function tag(s, name) { var m = new RegExp('<(?:\\w+:)?' + name + '\\b[^>]*>([^<]*)<').exec(s); return m ? m[1].trim() : ''; }
function readGpx(txt) {
  var re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g, m, pts = [], ts = [];
  while ((m = re.exec(txt))) {
    var lat = attr(m[1], 'lat'), lng = attr(m[1], 'lon'), t = parseTime(tag(m[2], 'time'));
    if (t && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && (lat || lng)) { pts.push([lat, lng]); ts.push(t.ms); }
  }
  return { type: tag(txt, 'type'), pts: pts, ts: ts };
}
function readTcx(txt) {
  var re = /<Trackpoint\b[^>]*>([\s\S]*?)<\/Trackpoint>/g, m, pts = [], ts = [], sp = /<Activity\b[^>]*Sport\s*=\s*"([^"]*)"/.exec(txt);
  while ((m = re.exec(txt))) {
    var lat = parseFloat(tag(m[1], 'LatitudeDegrees')), lng = parseFloat(tag(m[1], 'LongitudeDegrees')), t = parseTime(tag(m[1], 'Time'));
    if (t && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && (lat || lng)) { pts.push([lat, lng]); ts.push(t.ms); }
  }
  return { type: sp ? sp[1] : '', pts: pts, ts: ts };
}
// FIT is Garmin's binary format. Only the record messages (time and position) and the
// sport are read; everything else is skipped by the sizes its definitions give.
var FIT_EPOCH = 631065600000;
function readFit(buf) {
  var v = new DataView(buf), hs = v.getUint8(0), end = Math.min(buf.byteLength, hs + v.getUint32(4, true)), p = hs;
  var defs = {}, lastTs = 0, pts = [], ts = [], sport = null, subSport = null, virtual = false;
  while (p < end) {
    var h = v.getUint8(p++), local, d, ct = null;
    if (h & 0x80) { local = (h >> 5) & 3; var o = h & 0x1f; ct = (lastTs & ~0x1f) + o; if (o < (lastTs & 0x1f)) ct += 0x20; }
    else if (h & 0x40) {
      var le = v.getUint8(p + 1) === 0, gnum = v.getUint16(p + 2, le), nf = v.getUint8(p + 4), fields = [], size = 0;
      p += 5;
      for (var f = 0; f < nf; f++, p += 3) { fields.push([v.getUint8(p), v.getUint8(p + 1), size]); size += v.getUint8(p + 1); }
      if (h & 0x20) { var nd = v.getUint8(p++); for (f = 0; f < nd; f++, p += 3) size += v.getUint8(p + 1); }
      defs[h & 0x0f] = { le: le, g: gnum, fields: fields, size: size };
      continue;
    } else local = h & 0x0f;
    d = defs[local];
    if (!d || p + d.size > buf.byteLength) break;
    var rec = {};
    for (var k = 0; k < d.fields.length; k++) {
      var fd = d.fields[k], at = p + fd[2];
      if (fd[1] === 4) rec[fd[0]] = fd[0] === 0 || fd[0] === 1 ? v.getInt32(at, d.le) : v.getUint32(at, d.le);
      else if (fd[1] === 1) rec[fd[0]] = v.getUint8(at);
    }
    p += d.size;
    if (rec[253] != null) lastTs = rec[253];
    if (d.g === 20) {
      var t = rec[253] != null ? rec[253] : ct, la = rec[0], lo = rec[1];
      if (t != null && la != null && lo != null && la !== 0x7fffffff && lo !== 0x7fffffff && (la || lo)) {
        pts.push([la * 180 / 2147483648, lo * 180 / 2147483648]); ts.push(FIT_EPOCH + t * 1000);
      }
    } else if (d.g === 18 || d.g === 12) {
      var sp = rec[d.g === 18 ? 5 : 0], sub = rec[d.g === 18 ? 6 : 1];
      if (sp != null && sp !== 255 && sport == null) { sport = sp; subSport = sub; }
      if (sub === 58 || sub === 6) virtual = true;
    }
  }
  // Mountain bike and trail run are cycling and running with a sub-sport.
  var name = sport === 2 && subSport === 8 ? 'Mountain Bike Ride' : sport === 1 && subSport === 3 ? 'Trail Run' : FIT_SPORT[sport] || '';
  return { type: virtual ? 'virtual' : name, sport: sport, subSport: subSport, pts: pts, ts: ts };
}
function readActivity(name, buf) {
  var n = name.replace(/\.gz$/i, '');
  if (/\.fit$/i.test(n)) return readFit(buf);
  var txt = new TextDecoder().decode(buf);
  return /\.tcx$/i.test(n) ? readTcx(txt.trim()) : readGpx(txt);
}

// Douglas–Peucker on a local flat projection; tol is in metres.
function simplify(pts, tol) {
  var n = pts.length;
  if (n < 3) return pts.map(function (_, i) { return i; });
  var keep = new Uint8Array(n), stack = [[0, n - 1]], r = Math.PI / 180, kx = Math.cos(pts[0][0] * r) * 111320, ky = 110540, t2 = tol * tol;
  keep[0] = keep[n - 1] = 1;
  while (stack.length) {
    var s = stack.pop(), a = s[0], b = s[1], ax = pts[a][1] * kx, ay = pts[a][0] * ky, dx = pts[b][1] * kx - ax, dy = pts[b][0] * ky - ay, L = dx * dx + dy * dy, best = 0, bi = -1;
    for (var i = a + 1; i < b; i++) {
      var px = pts[i][1] * kx - ax, py = pts[i][0] * ky - ay, u = L ? Math.max(0, Math.min(1, (px * dx + py * dy) / L)) : 0;
      var ex = px - u * dx, ey = py - u * dy, e2 = ex * ex + ey * ey;
      if (e2 > best) { best = e2; bi = i; }
    }
    if (bi >= 0 && best > t2) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  var out = [];
  for (i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}
function addStrava(c, type, a, meta) {
  var st = stravaSport(type), mode = st.mode;
  if (mode === null || a.pts.length < 2) return false;
  // Keep time order and drop repeated timestamps (paused recordings can repeat them).
  var pts = [], ts = [], i;
  for (i = 0; i < a.pts.length; i++) if (!ts.length || a.ts[i] > ts[ts.length - 1]) { pts.push(a.pts[i]); ts.push(a.ts[i]); }
  if (pts.length < 2) return false;
  // Distance on a lightly smoothed track, so GPS jitter while standing still doesn't add up.
  var dist = pathKm(simplify(pts, 2).map(function (i) { return pts[i]; })), keep = simplify(pts, 6);
  var inner = keep.slice(1, -1), n = pts.length - 1, before = c.start.length;
  c.gps = true;
  c.add(mode || 'UNKNOWN', { ms: ts[0], off: null }, { ms: ts[n], off: null }, dist, 1, pts[0], pts[n],
    inner.map(function (i) { return pts[i]; }), inner.map(function (i) { return ts[i]; }));
  if (c.start.length === before) return false;
  (c.sport || (c.sport = [])).push(st.sport);
  // A type BT;DT doesn't know is kept by name, to show on the trip.
  (c.stype || (c.stype = [])).push(st.sport ? '' : String(type == null || /^\d+$/.test(String(type).trim()) ? '' : type).trim());
  // What the export said about the activity, for the trip's raw data.
  (c.smeta || (c.smeta = [])).push(Object.assign({ typeUsed: type == null ? '' : String(type), fileType: a.type || '' }, a.sport != null ? { fitSport: a.sport, fitSubSport: a.subSport } : {}, meta || {}));
  return true;
}
function finishStrava(c) {
  if (!c.start.length) throw new Error(NO_STRAVA);
  var r = finish(c, SRC.strava);
  for (var i = 0; i < r.est.length; i++) r.est[i] |= STRAVA;
  r.sport = Uint8Array.from(c.sport); r.stype = c.stype; r.smeta = c.smeta;
  r.strava = true;
  return r;
}
function parseStravaFile(file) {
  return file.arrayBuffer().then(function (buf) { return maybeGunzip(file.name, buf); }).then(function (buf) {
    var c = new Collector(), a = readActivity(file.name, buf);
    addStrava(c, a.type, a, { file: file.name });
    return finishStrava(c);
  });
}

// A small ZIP reader: reads the central directory at the end of the file, then only the
// entries it needs, so a multi-GB export with photos is never loaded whole.
function u64(v, at) { return v.getUint32(at, true) + v.getUint32(at + 4, true) * 4294967296; }
function zipEntries(file) {
  var tail = Math.min(file.size, 65557 + 20);
  return file.slice(file.size - tail).arrayBuffer().then(function (ab) {
    var v = new DataView(ab), e = -1, i;
    for (i = ab.byteLength - 22; i >= 0; i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('This ZIP file looks damaged.');
    var count = v.getUint16(e + 10, true), cdSize = v.getUint32(e + 12, true), cdOff = v.getUint32(e + 16, true);
    if ((cdOff === 0xffffffff || count === 0xffff) && e >= 20 && v.getUint32(e - 20, true) === 0x07064b50) {
      var z = u64(v, e - 12);
      return file.slice(z, z + 56).arrayBuffer().then(function (b) {
        var w = new DataView(b);
        return readCd(file, u64(w, 48), u64(w, 40));
      });
    }
    return readCd(file, cdOff, cdSize);
  });
}
function readCd(file, off, size) {
  return file.slice(off, off + size).arrayBuffer().then(function (ab) {
    var v = new DataView(ab), p = 0, out = [], dec = new TextDecoder();
    while (p + 46 <= ab.byteLength && v.getUint32(p, true) === 0x02014b50) {
      var method = v.getUint16(p + 10, true), comp = v.getUint32(p + 20, true), raw = v.getUint32(p + 24, true);
      var nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lho = v.getUint32(p + 42, true);
      var name = dec.decode(new Uint8Array(ab, p + 46, nl)), x = p + 46 + nl, xe = x + xl;
      while (x + 4 <= xe) {
        var id = v.getUint16(x, true), len = v.getUint16(x + 2, true), q = x + 4;
        if (id === 1) {
          if (raw === 0xffffffff) { raw = u64(v, q); q += 8; }
          if (comp === 0xffffffff) { comp = u64(v, q); q += 8; }
          if (lho === 0xffffffff) lho = u64(v, q);
        }
        x += 4 + len;
      }
      out.push({ name: name, method: method, comp: comp, off: lho });
      p = xe + cl;
    }
    return out;
  });
}
function zipRead(file, en) {
  return file.slice(en.off, en.off + 30).arrayBuffer().then(function (ab) {
    var v = new DataView(ab), start = en.off + 30 + v.getUint16(26, true) + v.getUint16(28, true);
    var blob = file.slice(start, start + en.comp);
    if (en.method === 0) return blob.arrayBuffer();
    if (en.method !== 8) throw new Error('Unsupported compression in ' + en.name);
    return new Response(blob.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
  });
}
// activities.csv → {"activities/123.fit.gz": "Ride", …}
function csvRows(txt) {
  var rows = [], row = [], cell = '', q = false;
  for (var i = 0; i < txt.length; i++) {
    var ch = txt[i];
    if (q) { if (ch === '"') { if (txt[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function stravaTypes(txt) {
  var rows = csvRows(txt.replace(/^\uFEFF/, '')), head = rows[0] || [], ti = -1, fi = -1, out = {}, i;
  for (i = 0; i < head.length; i++) {
    if (ti < 0 && /activity type/i.test(head[i])) ti = i;
    if (fi < 0 && /filename/i.test(head[i])) fi = i;
  }
  // Headers in another language: find the file column by its values; the type is the fourth column.
  if (fi < 0 && rows[1]) for (i = 0; i < rows[1].length; i++) if (/^activities\//.test(rows[1][i])) fi = i;
  if (ti < 0) ti = 3;
  if (fi < 0) return out;
  // The first columns (ID, date, name, type, description, time, distance…) are kept for the trip's raw data.
  for (i = 1; i < rows.length; i++) if (rows[i][fi]) {
    var csv = {};
    for (var k = 0; k < Math.min(head.length, 13); k++) if (rows[i][k]) csv[head[k]] = rows[i][k];
    out[rows[i][fi].trim()] = { type: rows[i][ti], csv: csv };
  }
  return out;
}
// activities.csv sometimes gives a broader type than the activity file (Water Sport where the
// file, like the Strava app, says Kayaking). Its type wins only when it is a known sport, or a
// virtual activity to skip; otherwise the file's type is used when that one is known.
function pickType(csvType, fileType) {
  if (csvType == null || csvType === '') return fileType;
  var c = stravaSport(csvType);
  if (c.sport || c.mode === null) return csvType;
  return stravaSport(fileType).sport ? fileType : csvType;
}
function parseStravaZip(file, onProgress) {
  return zipEntries(file).then(function (all) {
    var acts = all.filter(function (e) { return /(^|\/)activities\/[^/]+\.(gpx|tcx|fit)(\.gz)?$/i.test(e.name); });
    if (!acts.length) throw new Error(NO_STRAVA);
    var csv = all.filter(function (e) { return /(^|\/)activities\.csv$/i.test(e.name); })[0];
    var c = new Collector(), types = {}, skipped = 0;
    return (csv ? zipRead(file, csv).then(function (b) { types = stravaTypes(new TextDecoder().decode(b)); }) : Promise.resolve()).then(function step(_, i) {
      i = i || 0;
      if (i >= acts.length) { var r = finishStrava(c); r.skippedActs = skipped; return r; }
      var en = acts[i], key = en.name.replace(/^.*?(activities\/)/, '$1');
      return zipRead(file, en).then(function (b) { return maybeGunzip(en.name, b); }).then(function (b) {
        var a = readActivity(en.name, b), row = types[key], t = row && row.type;
        if (!addStrava(c, pickType(t, a.type), a, { file: key, csvType: t == null ? null : t, csv: row ? row.csv : null })) skipped++;
      }).catch(function () { skipped++; }).then(function () {
        if (i % 20 === 0) onProgress((i + 1) / acts.length);
        return step(null, i + 1);
      });
    });
  });
}

function parseFile(file, onProgress) {
  if (/\.zip$/i.test(file.name)) return parseStravaZip(file, onProgress);
  if (isStravaName(file.name)) return parseStravaFile(file);
  return file.slice(0, 4096).text().then(function (head) {
    var kind = sniff(head);
    if (!kind) throw new Error(NOT_TIMELINE);
    if (kind === 'records') return parseRecordsStream(file, onProgress);
    return file.text().then(function (txt) { onProgress(1); return parseTimeline(JSON.parse(txt)); });
  });
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = function (e) {
    var files = e.data.files;
    (function next(i) {
      if (i >= files.length) { self.postMessage({ type: 'done' }); return; }
      var f = files[i], label = files.length > 1 ? ' (' + (i + 1) + ' of ' + files.length + ')' : '';
      self.postMessage({ type: 'progress', text: 'Reading ' + f.name + label + '…' });
      parseFile(f, function (p) {
        self.postMessage({ type: 'progress', text: 'Reading ' + f.name + label + ' · ' + Math.round(p * 100) + '%' });
      }).then(function (r) {
        r.name = f.name;
        self.postMessage({ type: 'file', result: r });
        next(i + 1);
      }).catch(function (err) {
        self.postMessage({ type: 'error', name: f.name, text: err && err.message || String(err), skipped: err && err.message === NOT_TIMELINE });
        next(i + 1);
      });
    })(0);
  };
}
if (typeof module !== 'undefined') module.exports = { PATH_TRIP: PATH_TRIP, parseTimeline: parseTimeline, withTrack: withTrack, mergeTracks: mergeTracks, RECORDS_GPS: RECORDS_GPS, MODES: MODES, normMode: normMode, km: km, SRC: SRC, NO_OFF: NO_OFF, parseFile: parseFile, STRAVA: STRAVA, SPORTS: SPORTS, stravaSport: stravaSport };
