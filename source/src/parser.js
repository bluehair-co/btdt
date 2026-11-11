// BT•DT parser: turns Google Timeline exports into a flat list of trips
// {start, end, day, mode, km, est} with their GPS trails, plus the places stayed.
// Runs inside a Web Worker (or on the main thread as a fallback).
// Supported: on-device Timeline.json (Android), iPhone Timeline export,
// Takeout Semantic Location History monthly files, Takeout Records.json, Dawarich exports.

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
// Places stayed (visits) are kept alongside: start, end, position, kind (1 home, 2 work),
// name (Takeout only) and Google's place ID (the same ID every time you're at that place).
function Collector() {
  this.start = []; this.end = []; this.day = []; this.mode = []; this.km = []; this.est = []; this.off = []; this.orig = []; this.from = []; this.to = [];
  this.pathPts = []; this.pathT = []; this.pathOff = [0];
  this.vs = []; this.ve = []; this.vday = []; this.voff = []; this.vll = []; this.vtype = []; this.vname = []; this.vpid = [];
}
// Trips Timeline couldn't classify get a mode guessed from their average speed,
// marked with the GUESSED bit in est.
var GUESSED = 4;
function guessMode(dist, hours) {
  if (!(hours > 0)) return null;
  var v = dist / hours;
  if (v < 7) return 'WALKING';
  if (v < 25) return 'CYCLING';
  // Up to 300 km/h a car is likelier than a plane, though no car goes that fast: such a trip is a GPS
  // jump, which cleanJumps looks at (it would leave a flight alone).
  if (v < 300) return 'CAR';
  return 'FLYING';
}
// Fastest believable average speed per mode (km/h). Timeline sometimes stores an
// absurd distance on a typed trip (e.g. 5,843 km for a car hop across Amsterdam).
var MAX_KMH = { WALKING: 15, RUNNING: 25, CYCLING: 50, CAR: 160, TAXI: 160, VEHICLE: 160, MOTORCYCLE: 160, BUS: 150, TRAIN: 350,
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
// Google's home and work tags (semanticType) are left out: they often don't match what you
// labelled yourself. vtype stays in the data (always 0) so saved data keeps its shape.
Collector.prototype.visit = function (st, et, ll, type, name, pid) {
  if (!st || !et || !ll || !(et.ms > st.ms)) return;
  var d = dayOf(st);
  if (d == null || !isFinite(d)) return;
  this.vs.push(st.ms); this.ve.push(et.ms); this.vday.push(d); this.voff.push(st.off != null ? st.off : NO_OFF);
  this.vll.push(ll[0], ll[1]); this.vtype.push(0); this.vname.push(name || ''); this.vpid.push(pid ? String(pid) : '');
};
function pathKm(pts) {
  var t = 0;
  for (var i = 1; i < pts.length; i++) t += km(pts[i - 1], pts[i]);
  return t;
}
// A corrupted GPS fix (a digit dropped from the longitude, a stale position such as home showing up
// again) puts a point km off the route, which draws a spike and inflates the distance. A point is left
// out when reaching it means moving impossibly fast for the trip's transport and:
// - inside the trail, the trail goes out to it and comes straight back (an out-and-back spike);
// - at either end, the rest of the trail is consistent and the end is wrong rather than the times
//   being a little off: the trip couldn't even have gone between its two ends in its time, or the
//   end repeats a point from inside the trail (a stale fix), or both ends are the same stale point.
//   A jump under 5 km at an end also needs a minute between the end and the next point, as
//   Timeline's first and last points are often only seconds apart from the ends.
// The worst point goes first and the check is repeated, so neighbouring bad points come out one by one.
// pts are [lat, lng]; t is seconds; cap is km/h. Returns the indices kept.
function jumpKeep(pts, t, cap) {
  var keep = [], i;
  for (i = 0; i < pts.length; i++) keep.push(i);
  if (pts.length < 3 || !(cap > 0)) return keep;
  var endCap = Math.max(2 * cap, 150);
  // Speed of a leg over 1 km (shorter ones are GPS jitter, however short the time), else 0.
  function v(a, b) {
    var d = km(pts[a], pts[b]), h = Math.abs(t[b] - t[a]) / 3600;
    if (!(d > 1)) return 0;
    return h > 0 ? d / h : Infinity;
  }
  // Whether point p is within 100 m of one of the kept points inside the trail.
  function repeats(p) {
    for (var k = 1; k < keep.length - 1; k++) if (keep[k] !== p && km(pts[p], pts[keep[k]]) < 0.1) return true;
    return false;
  }
  // Whether the end at index j (0 or the last) is a bad point; 2 when the other end is the same bad point.
  function badEnd(j) {
    var n = keep.length, p = keep[j], q = keep[j ? n - 2 : 1], r = keep[j ? n - 3 : 2], o = keep[j ? 0 : n - 1];
    if (!(v(p, q) > endCap) || v(q, r) > cap) return 0;
    var d = km(pts[p], pts[q]);
    if (d < 5 && Math.abs(t[q] - t[p]) < 60) return 0;
    if (km(pts[p], pts[o]) < 0.1) {
      var q2 = keep[j ? 1 : n - 2], r2 = keep[j ? 2 : n - 3];
      return n >= 5 && v(o, q2) > endCap && v(q2, r2) <= cap && (km(pts[o], pts[q2]) >= 5 || Math.abs(t[q2] - t[o]) >= 60) ? 2 : 0;
    }
    var h = Math.abs(t[o] - t[p]) / 3600;
    return !(h > 0) || km(pts[p], pts[o]) / h > cap || repeats(p) ? 1 : 0;
  }
  for (;;) {
    var n = keep.length, best = -1, top = 0, both = false, j;
    if (n < 3) break;
    for (j = 0; j < n; j++) {
      var p = keep[j], score = 0, end = 0;
      if (j === 0 || j === n - 1) {
        end = badEnd(j);
        if (end) score = km(pts[p], pts[keep[j ? n - 2 : 1]]);
      } else {
        var a = keep[j - 1], b = keep[j + 1];
        if (Math.max(v(a, p), v(p, b)) > cap) {
          var din = km(pts[a], pts[p]), dout = km(pts[p], pts[b]), dd = km(pts[a], pts[b]);
          if (din + dout > 2 * dd + 1) score = din + dout - dd;
        }
      }
      if (score > top) { top = score; best = j; both = end === 2; }
    }
    if (best < 0) break;
    if (both) { keep.pop(); keep.shift(); } else keep.splice(best, 1);
  }
  return keep;
}
// Trips that lost bad GPS jumps, marked with the JUMPS bit in est.
var JUMPS = 128;
// Single legs may beat a mode's average by half, except on the road, where nothing beats 160 km/h.
var ROAD = { CAR: 1, TAXI: 1, VEHICLE: 1, MOTORCYCLE: 1, BUS: 1 };
function jumpCap(mode) { return ROAD[mode] ? MAX_KMH.CAR : 1.5 * (MAX_KMH[mode] || 200); }
// Leaves bad GPS jumps out of every trip's line in R and fixes the distance they inflated (see jumpKm).
// Strava, simulated trips and flights are left as they are.
function cleanTrails(R) {
  var n = R.start.length, i, q, any = false, out = [];
  for (i = 0; i < n; i++) {
    var o0 = R.pathOff[i], o1 = R.pathOff[i + 1], s = R.srcs ? R.srcs[i] : R.src, mode = MODES[R.mode[i]];
    out.push(null);
    if (o1 - o0 < 3 || mode === 'FLYING' || s === SRC.strava || s === SRC.sim || R.est[i] & STRAVA) continue;
    var pts = [], t = [];
    for (q = o0; q < o1; q++) { pts.push([R.pathPts[2 * q], R.pathPts[2 * q + 1]]); t.push(R.pathT[q]); }
    var keep = jumpKeep(pts, t, jumpCap(mode));
    if (keep.length === pts.length) continue;
    out[i] = keep; any = true;
    var e = R.est[i], raw = pathKm(pts), clean = pathKm(keep.map(function (k) { return pts[k]; })), first = pts[keep[0]], last = pts[keep[keep.length - 1]];
    var ends = keep[0] !== 0 || keep[keep.length - 1] !== pts.length - 1;
    // The trip now starts and ends where its first and last good points are.
    if (keep[0] !== 0) { R.from[2 * i] = first[0]; R.from[2 * i + 1] = first[1]; }
    if (keep[keep.length - 1] !== pts.length - 1) { R.to[2 * i] = last[0]; R.to[2 * i + 1] = last[1]; }
    jumpKm(R, i, raw, clean, ends, first, last);
  }
  if (!any) return R;
  var np = 0, w = 0;
  for (i = 0; i < n; i++) np += out[i] ? out[i].length : R.pathOff[i + 1] - R.pathOff[i];
  var P = new Float32Array(2 * np), T = new Float32Array(np), O = new Uint32Array(n + 1);
  for (i = 0; i < n; i++) {
    var o = R.pathOff[i];
    if (out[i]) for (q = 0; q < out[i].length; q++, w++) { P[2 * w] = R.pathPts[2 * (o + out[i][q])]; P[2 * w + 1] = R.pathPts[2 * (o + out[i][q]) + 1]; T[w] = R.pathT[o + out[i][q]]; }
    else for (q = o; q < R.pathOff[i + 1]; q++, w++) { P[2 * w] = R.pathPts[2 * q]; P[2 * w + 1] = R.pathPts[2 * q + 1]; T[w] = R.pathT[q]; }
    O[i + 1] = w;
  }
  R.pathPts = P; R.pathT = T; R.pathOff = O;
  return R;
}
// Trip i's distance after its line lost a detour of raw - clean km: a straight line is redrawn between
// the new ends, and a distance from Timeline or along the trail loses the detour when it counted it
// (it is over half of it longer than the clean line). Timeline's own figure is kept in orig.
function jumpKm(R, i, raw, clean, ends, first, last) {
  var e = R.est[i], d = R.km[i], was = d;
  if ((e & 3) === 2) { if (ends) d = Math.max(km(first, last), 0.01); }
  else if (d > clean + (raw - clean) / 2) d = Math.max(clean, d - (raw - clean), 0.01);
  if (d > 0 && Math.abs(d - was) > 0.001) {
    if ((e & 3) === 0 && !(e & FIXED) && !(R.orig[i] > 0)) R.orig[i] = was;
    R.km[i] = d;
  }
  R.est[i] = e | JUMPS;
  // A type guessed from the speed is guessed again from the speed it really had.
  if (e & GUESSED && !(e & (PATH_TRIP | STRAVA)) && Math.abs(R.km[i] - was) > 0.001) {
    var g = guessMode(R.km[i], (R.end[i] - R.start[i]) / 36e5);
    if (g && g !== 'FLYING') R.mode[i] = MODE_IDX[g];
  }
}
// A trip's end or a whole stay can sit at a bad position too (a stray fix, or a place Timeline matched
// wrongly), which no trail shows when the trip has only its two ends: a 3-minute walk from home to
// 34 km away. Every trip end and stay, in time order, is a track of where you were, and ends and stays
// in a row within 1 km of each other are one stop. A stop is a bad position when it holds one end of a
// trip with no line of its own, lasted under 6 hours, is at least 5 km from the stops on both sides
// while those are close together (the track goes out and straight back), and the track reaches or
// leaves it faster than anything on the ground (STOP_KMH; within a day of a flight, faster than a plane). Its trip ends and
// stays move to the stop next to it in time, and those trips' lines and distances follow (see jumpKm).
var STOP_KMH = 300;
function cleanStops(R) {
  var n = R.start.length, nv = R.vs ? R.vs.length : 0, A = [], fly = [], i, j;
  function ll(a, k) { return isFinite(a[2 * k]) && isFinite(a[2 * k + 1]) ? [a[2 * k], a[2 * k + 1]] : null; }
  for (i = 0; i < n; i++) {
    if (MODES[R.mode[i]] === 'FLYING') fly.push([R.start[i], R.end[i]]);
    var a = ll(R.from, i), b = ll(R.to, i);
    if (a) A.push({ t: R.start[i], ll: a, trip: i, end: 0, o: 1 });
    if (b) A.push({ t: R.end[i], ll: b, trip: i, end: 1, o: 0 });
  }
  for (i = 0; i < nv; i++) {
    var v = ll(R.vll, i);
    if (v) { A.push({ t: R.vs[i], ll: v, visit: i, o: 1 }); A.push({ t: R.ve[i], ll: v, visit: i, o: 0 }); }
  }
  if (A.length < 3) return R;
  // At the same time, what ends comes before what starts.
  A.sort(function (x, y) { return x.t - y.t || x.o - y.o; });
  // Whether a flight is in the air at some time in [a, b]: flights by start, with the latest end so far.
  fly.sort(function (x, y) { return x[0] - y[0]; });
  var flyEnd = [], m = -Infinity;
  for (i = 0; i < fly.length; i++) { m = Math.max(m, fly[i][1]); flyEnd.push(m); }
  function flying(a, b) {
    var lo = 0, hi = fly.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (fly[mid][0] <= b) lo = mid + 1; else hi = mid; }
    return lo > 0 && flyEnd[lo - 1] >= a;
  }
  var S = [];
  for (i = 0; i < A.length; i++) {
    var last = S[S.length - 1];
    if (last && km(last.ll, A[i].ll) < 1) { last.t2 = A[i].t; last.m.push(A[i]); }
    else S.push({ t1: A[i].t, t2: A[i].t, ll: A[i].ll, m: [A[i]] });
    A[i].s = S.length - 1;
  }
  // Stops holding one end of a trip with no line of its own (the other end elsewhere): only such a
  // trip shows a bad end that its line didn't already.
  var at = {};
  A.forEach(function (x) { if (x.trip != null) (at[x.trip] = at[x.trip] || [])[x.end] = x.s; });
  Object.keys(at).forEach(function (k) {
    var e = at[k];
    if (e[0] == null || e[1] == null || e[0] === e[1] || R.pathOff[+k + 1] - R.pathOff[+k] > 2 || MODES[R.mode[+k]] === 'FLYING') return;
    S[e[0]].two = S[e[1]].two = true;
  });
  var ns = S.length, prev = new Int32Array(ns), next = new Int32Array(ns), gone = new Uint8Array(ns), any = false;
  for (i = 0; i < ns; i++) { prev[i] = i - 1; next[i] = i + 1 < ns ? i + 1 : -1; }
  function speed(p, q) {
    var d = km(S[p].ll, S[q].ll), h = (S[q].t1 - S[p].t2) / 36e5;
    if (!(d > 1) || flying(S[p].t2, S[q].t1)) return 0;
    return h > 0 ? d / h : Infinity;
  }
  function score(c) {
    var p = prev[c], q = next[c];
    if (p < 0 || q < 0 || !S[c].two || S[c].t2 - S[c].t1 > 6 * 36e5) return 0;
    var din = km(S[p].ll, S[c].ll), dout = km(S[c].ll, S[q].ll), dd = km(S[p].ll, S[q].ll);
    if (din < 5 || dout < 5 || dd > 0.2 * Math.min(din, dout)) return 0;
    // Within a day of a flight, a layover Timeline missed a flight for is fast but real: there it takes
    // a jump faster than a plane.
    var cap = flying(S[c].t1 - 864e5, S[c].t2 + 864e5) ? MAX_KMH.FLYING : STOP_KMH;
    return Math.max(speed(p, c), speed(c, q)) > cap ? din + dout - dd : 0;
  }
  // One pass, taking out each stop that scores higher than both its neighbours: a bad position is a
  // single stop, and going on from the stops left would start moving real ones.
  var sc = new Float64Array(ns);
  for (i = 0; i < ns; i++) sc[i] = score(i);
  for (i = 0; i < ns; i++) {
    var p = prev[i], q = next[i];
    if (!(sc[i] > 0) || p >= 0 && sc[p] >= sc[i] || q >= 0 && sc[q] >= sc[i]) continue;
    // The bad stop takes the place of the stop next to it in time.
    S[i].fix = S[q].t1 - S[i].t2 < S[i].t1 - S[p].t2 ? S[q].ll : S[p].ll;
    gone[i] = 1; any = true;
  }
  if (!any) return R;
  var trips = {};
  for (j = 0; j < ns; j++) {
    if (!gone[j]) continue;
    S[j].m.forEach(function (x) {
      if (x.visit != null) { R.vll[2 * x.visit] = S[j].fix[0]; R.vll[2 * x.visit + 1] = S[j].fix[1]; return; }
      var k = x.trip, s = R.srcs ? R.srcs[k] : R.src;
      if (MODES[R.mode[k]] === 'FLYING' || s === SRC.strava || s === SRC.sim || R.est[k] & STRAVA) return;
      (trips[k] = trips[k] || [])[x.end] = S[j].fix;
    });
  }
  Object.keys(trips).forEach(function (key) {
    var k = +key, o0 = R.pathOff[k], o1 = R.pathOff[k + 1], q, old = [], now = [];
    for (q = o0; q < o1; q++) old.push([R.pathPts[2 * q], R.pathPts[2 * q + 1]]);
    var a = [R.from[2 * k], R.from[2 * k + 1]], b = [R.to[2 * k], R.to[2 * k + 1]];
    if (old.length < 2) old = [a, b];
    var fa = trips[k][0], fb = trips[k][1];
    // The line's first and last points are the trip's ends.
    now = old.slice();
    if (fa) { R.from[2 * k] = fa[0]; R.from[2 * k + 1] = fa[1]; if (km(now[0], a) < 0.05) now[0] = fa; }
    if (fb) { R.to[2 * k] = fb[0]; R.to[2 * k + 1] = fb[1]; if (km(now[now.length - 1], b) < 0.05) now[now.length - 1] = fb; }
    if (o1 - o0 >= 2) {
      R.pathPts[2 * o0] = now[0][0]; R.pathPts[2 * o0 + 1] = now[0][1];
      R.pathPts[2 * (o1 - 1)] = now[now.length - 1][0]; R.pathPts[2 * (o1 - 1) + 1] = now[now.length - 1][1];
    }
    jumpKm(R, k, pathKm(old), pathKm(now), true, [R.from[2 * k], R.from[2 * k + 1]], [R.to[2 * k], R.to[2 * k + 1]]);
  });
  return R;
}
// Timeline's trips often disagree with the stays on either side of them, and the stays are right:
// - a trip's first or last point is a stale position (home, or where the car was earlier) km away
//   from the stay it starts from or ends at, while the trail next to it is at the stay;
// - a car trip starts long before it leaves (or ends long after it arrives): the time parked next
//   to the stay is counted as driving, and its GPS jitter as distance;
// - Timeline's distance is just the straight line between the trip's ends (0.1 km for a 7 km loop),
//   or shorter than the straight line between where it really started and ended.
// A stay counts as the trip's own when it ends (or starts) within 5 minutes of the trip.
var STAY_GAP = 5 * 60000, PARKED_KM = 1, PARKED_MS = 10 * 60000;
// Index of the point where the trail leaves for good: the first of two points in a row over
// PARKED_KM from the stay (a single point out there is jitter). -1 if it never does.
function leaves(pts, at) {
  for (var i = 0; i + 1 < pts.length; i++) if (km(pts[i], at) > PARKED_KM && km(pts[i + 1], at) > PARKED_KM) return i;
  return -1;
}
function cleanEnds(R) {
  var n = R.start.length, nv = R.vs ? R.vs.length : 0, i, q, any = false, out = [];
  if (!nv) return R;
  var byEnd = [], byStart = [];
  for (i = 0; i < nv; i++) if (isFinite(R.vll[2 * i])) { byEnd.push(i); byStart.push(i); }
  byEnd.sort(function (a, b) { return R.ve[a] - R.ve[b]; });
  byStart.sort(function (a, b) { return R.vs[a] - R.vs[b]; });
  // The stay in idx (sorted by key) whose key is nearest to t, within STAY_GAP; -1 if none.
  function near(idx, key, t) {
    var lo = 0, hi = idx.length, best = -1, bd = STAY_GAP + 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (key[idx[mid]] < t) lo = mid + 1; else hi = mid; }
    for (var j = Math.max(0, lo - 2); j < Math.min(idx.length, lo + 2); j++) {
      var d = Math.abs(key[idx[j]] - t);
      if (d < bd) { bd = d; best = idx[j]; }
    }
    return best;
  }
  function vll(v) { return [R.vll[2 * v], R.vll[2 * v + 1]]; }
  function dayAt(ms, off) { return off === NO_OFF ? null : Math.floor((ms + off * 60000) / 864e5); }
  for (i = 0; i < n; i++) {
    out.push(null);
    var o0 = R.pathOff[i], o1 = R.pathOff[i + 1], s = R.srcs ? R.srcs[i] : R.src, mode = MODES[R.mode[i]];
    if (o1 - o0 < 3 || mode === 'FLYING' || s === SRC.strava || s === SRC.sim || R.est[i] & STRAVA) continue;
    var P = near(byEnd, R.ve, R.start[i]), N = near(byStart, R.vs, R.end[i]);
    var pts = [], t = [];
    for (q = o0; q < o1; q++) { pts.push([R.pathPts[2 * q], R.pathPts[2 * q + 1]]); t.push(R.pathT[q]); }
    var raw = pts.map(function (p) { return p.slice(); }), changed = false, last = pts.length - 1;
    // Stale ends: over 1 km from the stay, while the next point is closer to the stay than to the end.
    if (P >= 0 && km(pts[0], vll(P)) > PARKED_KM && km(pts[1], vll(P)) < km(pts[1], pts[0])) { pts[0] = vll(P); changed = true; }
    if (N >= 0 && km(pts[last], vll(N)) > PARKED_KM && km(pts[last - 1], vll(N)) < km(pts[last - 1], pts[last])) { pts[last] = vll(N); changed = true; }
    // Parked time at either end of a road trip.
    var a = 0, b = last;
    if (ROAD[mode]) {
      var k = P >= 0 ? leaves(pts, vll(P)) : -1;
      if (k > 1 && t[k - 1] - t[0] >= PARKED_MS / 1000) a = k - 1;
      var rp = pts.slice().reverse();
      k = N >= 0 ? leaves(rp, vll(N)) : -1;
      if (k > 1 && t[last] - t[last - k + 1] >= PARKED_MS / 1000) b = last - k + 1;
      if (b - a < 1) { a = 0; b = last; }
    }
    var e = R.est[i], was = R.km[i], dur = t[b] - t[a], t0 = t[a], gline = km(raw[0], raw[last]);
    // Timeline's own distance: kept unless it is only the straight line between its ends, or shorter
    // than the straight line between the real ends; then the trail measures it, if that is drivable.
    var short = (e & 3) === 0 && (was <= 1.05 * gline + 0.05 || was < km(pts[a], pts[b]));
    if (!changed && a === 0 && b === last && !(short && pathKm(pts) > was + 0.05)) continue;
    pts = pts.slice(a, b + 1); t = t.slice(a, b + 1).map(function (x) { return x - t0; });
    if (a > 0) {
      R.start[i] += t0 * 1000;
      var d0 = dayAt(R.start[i], R.off[i]); if (d0 != null) R.day[i] = d0;
      R.ve[P] = R.start[i];
    }
    if (b < last) {
      R.end[i] = R.start[i] + dur * 1000;
      R.vs[N] = R.end[i];
      var dv = dayAt(R.vs[N], R.voff[N]); if (dv != null) R.vday[N] = dv;
    }
    R.from[2 * i] = pts[0][0]; R.from[2 * i + 1] = pts[0][1];
    R.to[2 * i] = pts[pts.length - 1][0]; R.to[2 * i + 1] = pts[pts.length - 1][1];
    out[i] = { pts: pts, t: t }; any = true;
    var clean = pathKm(pts), h = dur / 3600;
    if ((e & 3) === 1) R.km[i] = clean;
    else if ((e & 3) === 2) R.km[i] = Math.max(km(pts[0], pts[pts.length - 1]), 0.01);
    if (changed || a > 0 || b < last) R.est[i] |= JUMPS;
    if (short && clean > was && !(h > 0 && clean / h > jumpCap(mode))) {
      if (!(R.orig[i] > 0)) R.orig[i] = was;
      R.km[i] = clean; R.est[i] = (R.est[i] & ~3) | 1;
    }
  }
  if (!any) return R;
  var np = 0;
  for (i = 0; i < n; i++) np += out[i] ? out[i].pts.length : R.pathOff[i + 1] - R.pathOff[i];
  var PP = new Float32Array(2 * np), T = new Float32Array(np), O = new Uint32Array(n + 1), w = 0;
  for (i = 0; i < n; i++) {
    O[i] = w;
    if (out[i]) for (q = 0; q < out[i].pts.length; q++, w++) { PP[2 * w] = out[i].pts[q][0]; PP[2 * w + 1] = out[i].pts[q][1]; T[w] = out[i].t[q]; }
    else for (q = R.pathOff[i]; q < R.pathOff[i + 1]; q++, w++) { PP[2 * w] = R.pathPts[2 * q]; PP[2 * w + 1] = R.pathPts[2 * q + 1]; T[w] = R.pathT[q]; }
  }
  O[n] = w;
  R.pathPts = PP; R.pathT = T; R.pathOff = O;
  return R;
}
// Leaves bad GPS jumps out of the trips in R (the parsed or saved trips): first inside each trip's
// line, then at trip ends and stays, then where trips disagree with
// the stays next to them. Running it again changes nothing, so it runs on every load and
// picks up data saved before it existed.
function cleanJumps(R) {
  cleanTrails(R);
  cleanStops(R);
  cleanEnds(R);
  return R;
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
// Timeline keeps a stay as a place and that place's location today, not where it was when you were
// there: when a business moves, every old stay there moves with it (years of office days showing up
// across town), along with the ends of the trips to and from them. The GPS points recorded during a
// stay say where you really were. A stay's GPS spot is the middle of its points when none of them is
// within MOVED_KM of the place and most are within 500 m of that middle; a stay with no points of its
// own uses the last point before it and the first after it (each within 10 minutes, within 500 m of
// each other). A place is moved when at least 3 of its stays have a GPS spot over MOVED_KM from it and
// within 500 m of the middle of those spots: those stays take that middle, and the trips ending or
// starting within 10 minutes of them at the place's location follow. Stays whose GPS agrees with the
// place (such as later visits to the new building) are left alone, as is a place that is off only once.
// V: [{st, et, ll, pid}] (ms); paths: [[ms, ll], …] by time. Sets fix on the moved stays.
var MOVED_KM = 2;
function movedPlaces(V, paths) {
  function mid(L) {
    var a = L.map(function (x) { return x[0]; }).sort(function (x, y) { return x - y; }), b = L.map(function (x) { return x[1]; }).sort(function (x, y) { return x - y; });
    return [a[a.length >> 1], b[b.length >> 1]];
  }
  function at(ms) {
    var lo = 0, hi = paths.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (paths[m][0] < ms) lo = m + 1; else hi = m; }
    return lo;
  }
  function spot(v) {
    var i = at(v.st), pts = [], k;
    for (k = i; k < paths.length && paths[k][0] <= v.et; k++) pts.push(paths[k][1]);
    if (pts.length) {
      for (k = 0; k < pts.length; k++) if (km(pts[k], v.ll) <= MOVED_KM) return null;
      var g = mid(pts), n = 0;
      for (k = 0; k < pts.length; k++) if (km(pts[k], g) < 0.5) n++;
      return 2 * n >= pts.length && km(g, v.ll) > MOVED_KM ? g : null;
    }
    var p = paths[i - 1], q = paths[i];
    if (!p || !q || v.st - p[0] > 6e5 || q[0] - v.et > 6e5 || km(p[1], q[1]) > 0.5) return null;
    return km(p[1], v.ll) > MOVED_KM && km(q[1], v.ll) > MOVED_KM ? [(p[1][0] + q[1][0]) / 2, (p[1][1] + q[1][1]) / 2] : null;
  }
  var by = {};
  V.forEach(function (v) {
    var g = v.ll && v.et > v.st && spot(v);
    if (g) (by[v.pid || v.ll.join()] = by[v.pid || v.ll.join()] || []).push({ v: v, g: g });
  });
  Object.keys(by).forEach(function (k) {
    var L = by[k];
    if (L.length < 3) return;
    var c = mid(L.map(function (x) { return x.g; })), near = L.filter(function (x) { return km(x.g, c) < 0.5; });
    if (near.length >= 3) near.forEach(function (x) { x.v.fix = c; });
  });
}
// The stays among Timeline's segments (or iOS items), in order: {st, et, ll, type, pid}.
function visitsOf(segs) {
  var V = [];
  for (var i = 0; i < segs.length; i++) {
    var s = segs[i];
    if (!s || !s.visit) continue;
    var tc = s.visit.topCandidate || {}, st = parseTime(s.startTime), et = parseTime(s.endTime);
    V.push({ st: st ? st.ms : NaN, et: et ? et.ms : NaN, ll: parseLL(tc.placeLocation), type: tc.semanticType, pid: tc.placeId || tc.placeID });
  }
  return V;
}
// The fixed stays among V, and a lookup for a trip end at time ms and position ll: the fix of a moved
// stay that starts (end 1) or ends (end 0) within 10 minutes of it at the place's location, else null.
function movedEnds(V) {
  var F = V.filter(function (v) { return v.fix; });
  return function (ms, ll, end) {
    if (!ll) return null;
    for (var i = 0; i < F.length; i++) {
      var v = F[i];
      if (Math.abs((end ? v.st : v.et) - ms) <= 6e5 && km(ll, v.ll) < 0.2) return v.fix;
    }
    return null;
  };
}
// Adds a trip from Timeline, with its ends moved off a moved place (see movedPlaces); its distance is
// then measured along its trail between the new ends.
function addMoved(c, moved, type, st, et, meters, a, b, pts, ts) {
  var a2 = st && moved(st.ms, a, 0), b2 = et && moved(et.ms, b, 1), n = c.start.length;
  if (a2) a = a2;
  if (b2) b = b2;
  if (a2 || b2) meters = pathKm([a].concat(pts || [], [b])) * 1000;
  addActivity(c, type, st, et, meters, a, b, pts, ts);
  if ((a2 || b2) && c.start.length > n) c.est[n] |= JUMPS;
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
  var V = visitsOf(segs), vi = 0;
  movedPlaces(V, paths);
  var moved = movedEnds(V);
  for (i = 0; i < segs.length; i++) {
    s = segs[i];
    var st = parseTime(s.startTime), et = parseTime(s.endTime);
    if (s.visit) {
      var v = V[vi++];
      c.visit(st, et, v.fix || v.ll, v.type, '', v.pid);
    }
    if (!s.activity) continue;
    var a = s.activity, p = split(st && et ? between(paths, st.ms, et.ms) : null);
    var aLL = parseLL(a.start), bLL = parseLL(a.end), meters = a.distanceMeters, bad;
    if (st && (bad = badPoint(st.ms, aLL))) { aLL = bad.fix; meters = km(aLL, bLL) * 1000; }
    if (et && (bad = badPoint(et.ms, bLL))) { bLL = bad.fix; meters = km(aLL, bLL) * 1000; }
    addMoved(c, moved, a.topCandidate && a.topCandidate.type, st, et, meters, aLL, bLL, p.pts, p.ts);
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
    // Bad GPS jumps out first, so they neither make the trip nor decide its type (at a car's top speed, as the type isn't known yet).
    var n0 = run.length;
    if (run.length >= 3) run = jumpKeep(run.map(function (x) { return x[1]; }), run.map(function (x) { return x[0] / 1000; }), jumpCap('CAR')).map(function (k) { return run[k]; });
    if (run.length >= 2) {
      var a = run[0], b = run[run.length - 1], far = 0;
      for (var j = 1; j < run.length; j++) far = Math.max(far, km(a[1], run[j][1]));
      if (far >= 0.5) {
        var inner = run.slice(1, -1), before = c.start.length, off = a[2];
        c.add(runMode(run), { ms: a[0], off: off }, { ms: b[0], off: b[2] != null ? b[2] : off }, pathKm(run.map(function (x) { return x[1]; })), 1 | GUESSED, a[1], b[1],
          inner.map(function (x) { return x[1]; }), inner.map(function (x) { return x[0]; }));
        if (c.start.length > before) c.est[before] |= PATH_TRIP | (run.length < n0 ? JUMPS : 0);
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
  var V = visitsOf(arr), vi = 0;
  movedPlaces(V, paths);
  var moved = movedEnds(V);
  for (i = 0; i < arr.length; i++) {
    it = arr[i];
    if (!it) continue;
    var st = parseTime(it.startTime), et = parseTime(it.endTime);
    if (it.visit) {
      var v = V[vi++];
      c.visit(st, et, v.fix || v.ll, v.type, '', v.pid);
    }
    if (!it.activity) continue;
    var a = it.activity, p = split(st && et ? between(paths, st.ms, et.ms) : null);
    addMoved(c, moved, a.topCandidate && a.topCandidate.type, st, et, a.distanceMeters, parseLL(a.start), parseLL(a.end), p.pts, p.ts);
  }
}

function parseSemantic(o, c) {
  var objs = o.timelineObjects || [];
  for (var i = 0; i < objs.length; i++) {
    var v = objs[i].placeVisit;
    if (v) {
      var vd = v.duration || {}, loc = v.location || {};
      c.visit(parseTime(vd.startTimestamp || vd.startTimestampMs), parseTime(vd.endTimestamp || vd.endTimestampMs),
        parseLL(loc) || parseLL(v.centerLatE7 != null ? { latE7: v.centerLatE7, lngE7: v.centerLngE7 } : null), loc.semanticType, loc.name, loc.placeId);
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
    if (s === SRC.records || s === SRC.dawarich || s === SRC.strava || s === SRC.sim || est[i] & (RECORDS_GPS | STRAVA) || mode === 'FLYING') continue;
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
var SRC = { device: 0, ios: 1, semantic: 2, records: 3, dawarich: 4, sim: 8, strava: 9 };
var KIND_LABEL = ['Timeline.json (on-device)', 'iPhone Timeline export', 'Takeout Semantic Location History', 'Takeout Records.json'];
KIND_LABEL[SRC.dawarich] = 'Dawarich';
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
  ['vs', 've', 'vday', 'voff', 'vll', 'vtype', 'vname', 'vpid'].forEach(function (k) { o[k] = c[k]; });
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
    vll: Float32Array.from(c.vll), vtype: Uint8Array.from(c.vtype), vname: c.vname, vpid: c.vpid
  };
}
var NOT_TIMELINE = "This file doesn't look like Google Timeline data. Pick Timeline.json from your phone, Records.json / Semantic Location History files from Google Takeout, or a Dawarich export.";
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
// Read it as a stream and parse one location entry at a time.
function parseRecordsStream(file, onProgress) {
  var c = new Collector(), rt = new RecordTrips(c);
  return streamText(file.stream(), file.size, jsonItems(function (o) { addRecord(o, rt); }), onProgress)
    .then(function () { return finishRecords(c, rt); });
}
// Feeds the text of a byte stream to onText piece by piece (total bytes for the progress).
function streamText(stream, total, onText, onProgress) {
  var reader = stream.getReader(), dec = new TextDecoder(), got = 0, shown = -1;
  return (function pump() {
    return reader.read().then(function (r) {
      if (r.done) { onText(dec.decode(), true); return; }
      got += r.value.byteLength;
      onText(dec.decode(r.value, { stream: true }));
      var pc = total ? Math.min(99, Math.floor(got / total * 100)) : 0;
      if (onProgress && pc !== shown) { shown = pc; onProgress(pc / 100); }
      return pump();
    });
  })();
}
// A text handler for streamText that parses each object in the list one level down in the
// top-level object ({"locations": [{…}, …]}, {"type": "FeatureCollection", "features": [{…}, …]})
// and hands it to onItem, without ever holding the whole file.
function jsonItems(onItem) {
  var buf = '', pos = 0, depth = 0, inStr = false, esc = false, start = -1;
  return function (text) {
    buf += text;
    for (var i = pos, n = buf.length; i < n; i++) {
      var ch = buf.charCodeAt(i);
      if (inStr) { if (esc) esc = false; else if (ch === 92) esc = true; else if (ch === 34) inStr = false; continue; }
      if (ch === 34) inStr = true;
      else if (ch === 123 || ch === 91) { depth++; if (depth === 3 && ch === 123) start = i; }
      else if (ch === 125 || ch === 93) {
        depth--;
        if (depth === 2 && ch === 125 && start >= 0) {
          try { onItem(JSON.parse(buf.slice(start, i + 1))); } catch (e) { /* skip a damaged entry */ }
          start = -1;
        }
      }
    }
    if (start >= 0) { buf = buf.slice(start); start = 0; pos = buf.length; } else { buf = ''; pos = 0; }
  };
}
// A text handler for streamText that parses one JSON object per line (JSON Lines).
function jsonLines(onItem) {
  var buf = '';
  function line(l) { l = l.trim(); if (l) try { onItem(JSON.parse(l)); } catch (e) { /* skip a damaged line */ } }
  return function (text, end) {
    buf += text;
    if (end) { buf.split('\n').forEach(line); buf = ''; return; }
    var k = buf.lastIndexOf('\n');
    if (k < 0) return;
    buf.slice(0, k).split('\n').forEach(line);
    buf = buf.slice(k + 1);
  };
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
  // A type BT•DT doesn't know is kept by name, to show on the trip.
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
      out.push({ name: name, method: method, comp: comp, raw: raw, off: lho });
      p = xe + cl;
    }
    return out;
  });
}
function zipRead(file, en) {
  return zipStream(file, en).then(function (st) { return new Response(st).arrayBuffer(); });
}
// An entry's uncompressed bytes as a stream, for entries too big to hold whole.
function zipStream(file, en) {
  return file.slice(en.off, en.off + 30).arrayBuffer().then(function (ab) {
    var v = new DataView(ab), start = en.off + 30 + v.getUint16(26, true) + v.getUint16(28, true);
    var blob = file.slice(start, start + en.comp);
    if (en.method === 0) return blob.stream();
    if (en.method !== 8) throw new Error('Unsupported compression in ' + en.name);
    return blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
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
function parseStravaZip(file, all, onProgress) {
  return Promise.resolve(all).then(function (all) {
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

// ---------- Dawarich ----------
// Dawarich (a self-hosted location history app) keeps raw GPS points, like Records.json. Its exports:
// - Export as GeoJSON or GPX (Points page): a ZIP holding one file, either GeoJSON (a Point feature
//   per point, its time in properties.timestamp as Unix seconds) or GPX (creator="Dawarich", one
//   track with every point). The file on its own works too.
// - Export my data (Settings): a ZIP with manifest.json and the points as JSON Lines
//   (points/YYYY/YYYY-MM.jsonl), plus visits (stays at named places) and tracks, whose segments
//   carry the transport Dawarich detected.
// Trips and stays are rebuilt from the points (see dwBuild). The points are also kept as a track, so
// Timeline trips loaded alongside are drawn along them, as with Records.json (see withTrack).
var NO_DAWARICH = 'No GPS points were found in this Dawarich export.';
function DwPoints() { this.t = []; this.ll = []; this.dev = []; this.devs = {}; this.ndev = 0; this.visits = []; this.segs = []; }
DwPoints.prototype.add = function (ms, lat, lng, acc, dev) {
  if (!(ms > 0) || !(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) || (lat === 0 && lng === 0) || acc > MAX_ACCURACY) return;
  var d = 0;
  if (dev != null && dev !== '') { d = this.devs[dev]; if (d === undefined) d = this.devs[dev] = this.ndev++; }
  this.t.push(ms); this.ll.push(lat, lng); this.dev.push(d);
};
// Unix seconds or milliseconds, or a date string.
function dwTime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(v)) { var n = Number(v); return n > 1e11 ? n : n * 1000; }
  var t = parseTime(v);
  return t ? t.ms : null;
}
// A point from the GeoJSON export (a Feature) or the account export (a line of points/….jsonl).
function dwPoint(o, P) {
  if (!o || typeof o !== 'object') return;
  var p = o.properties || o, g = o.geometry, lat, lng, m;
  if (g) {
    if (g.type !== 'Point' || !g.coordinates) return;
    lng = Number(g.coordinates[0]); lat = Number(g.coordinates[1]);
  } else {
    lat = parseFloat(p.latitude != null ? p.latitude : p.lat);
    lng = parseFloat(p.longitude != null ? p.longitude : p.lon != null ? p.lon : p.lng);
    if (!isFinite(lat) && typeof p.lonlat === 'string' && (m = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/.exec(p.lonlat))) { lng = +m[1]; lat = +m[2]; }
  }
  var t = p.timestamp != null ? p.timestamp : p.tst != null ? p.tst : p.recorded_at || p.time || p.datetime;
  P.add(dwTime(t), lat, lng, p.accuracy != null ? Number(p.accuracy) : 0, p.tracker_id);
}
// A visit from the account export: a stay at a place, named by you or by Dawarich. Declined
// suggestions and deleted visits are left out.
function dwVisit(o, P) {
  if (!o || o.status === 'declined' || o.status === 2 || o.deleted_at) return;
  var s = dwTime(o.started_at), e = dwTime(o.ended_at), pl = o.place_reference || {};
  if (!(s > 0 && e > s)) return;
  var lat = parseFloat(pl.latitude), lng = parseFloat(pl.longitude);
  P.visits.push({ s: s, e: e, name: String(o.name || pl.name || ''), ll: isFinite(lat) && isFinite(lng) && (lat || lng) ? [lat, lng] : null });
}
// A track from the account export: its segments say how Dawarich thinks you travelled.
var DW_MODES = [null, null, 'WALKING', 'RUNNING', 'CYCLING', 'CAR', 'BUS', 'TRAIN', 'FLYING', 'BOAT', 'MOTORCYCLE'];
var DW_MODE = { walking: 'WALKING', running: 'RUNNING', cycling: 'CYCLING', driving: 'CAR', bus: 'BUS', train: 'TRAIN', flying: 'FLYING', boat: 'BOAT', motorcycle: 'MOTORCYCLE' };
function dwTrack(o, P) {
  (o && o.segments || []).forEach(function (g) {
    var m = g.transportation_mode, mode = typeof m === 'number' ? DW_MODES[m] : DW_MODE[String(m).toLowerCase()];
    var s = dwTime(g.start_at), e = dwTime(g.end_at);
    if (mode && g.confidence !== 'low' && g.confidence !== 0 && s > 0 && e > s) P.segs.push([s, e, mode]);
  });
}
// A text handler for streamText that reads the track points of a GPX file.
function gpxPoints(P) {
  var buf = '';
  return function (text) {
    buf += text;
    var re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g, m, last = 0;
    while ((m = re.exec(buf))) {
      var t = parseTime(tag(m[2], 'time'));
      P.add(t && t.ms, attr(m[1], 'lat'), attr(m[1], 'lon'), 0);
      last = re.lastIndex;
    }
    var k = buf.indexOf('<trkpt', last);
    buf = k >= 0 ? buf.slice(k) : buf.slice(-8);
  };
}
function dwHandler(kind, P) {
  if (kind === 'gpx') return gpxPoints(P);
  var f = kind === 'visits' ? dwVisit : kind === 'tracks' ? dwTrack : dwPoint;
  return (kind === 'geojson' ? jsonItems : jsonLines)(function (o) { f(o, P); });
}
// What a Dawarich file is, from its name and first few KB, or null.
function dwSniff(name, head) {
  if (/\.gpx$/i.test(name)) return /<gpx\b[^>]*\bcreator\s*=\s*["']Dawarich/i.test(head) ? 'gpx' : null;
  if (/^\s*\{\s*"type"\s*:\s*"FeatureCollection"/.test(head)) return 'geojson';
  // A month of points from the account export, unzipped (the position comes last in each line, often past the first 4 KB).
  if (/\.jsonl$/i.test(name) && /"timestamp"\s*:/.test(head) && /"(battery_status|tracker_id|latitude|lonlat)"\s*:/.test(head)) return 'points';
  return null;
}
function kmLL(a0, a1, b0, b1) { return km([a0, a1], [b0, b1]); }
// Stays: points that keep within 150 m of their middle for at least 10 minutes (a phone that
// stops reporting while still counts, as long as its next point is there too). Stays at the same
// spot less than 15 minutes apart are one stay (a stray GPS fix doesn't split it).
// Trips: the points between two stays. A run of them ends at a gap of over 30 minutes, and a long
// fast jump between two points (no data while in the air) is a flight, as in Records.json. A run
// that gets at least 500 m from where it started, or ends at least 200 m from it, is a trip; its type is the one Dawarich gave the
// track it is on (account export), or else guessed from its speed (see runMode).
var DW_STAY_KM = 0.15, DW_STAY_MS = 10 * 60000;
function dwBuild(P) {
  var n0 = P.t.length, k, i, j;
  if (!n0) throw new Error(NO_DAWARICH);
  var ord = new Uint32Array(n0);
  for (k = 0; k < n0; k++) ord[k] = k;
  ord.sort(function (a, b) { return P.t[a] - P.t[b]; });
  var T = new Float64Array(n0), LA = new Float64Array(n0), LO = new Float64Array(n0), DV = new Int32Array(n0), n = 0;
  for (k = 0; k < n0; k++) {
    var o = ord[k];
    if (n && P.t[o] === T[n - 1]) continue;
    T[n] = P.t[o]; LA[n] = P.ll[2 * o]; LO[n] = P.ll[2 * o + 1]; DV[n] = P.dev[o]; n++;
  }
  P.t = P.ll = P.dev = null;
  function pt(x) { return [LA[x], LO[x]]; }
  var c = new Collector(), stays = [];
  for (i = 0; i < n;) {
    var sl = LA[i], sg = LO[i], cnt = 1;
    for (j = i + 1; j < n && kmLL(sl / cnt, sg / cnt, LA[j], LO[j]) <= DW_STAY_KM; j++) { sl += LA[j]; sg += LO[j]; cnt++; }
    if (T[j - 1] - T[i] >= DW_STAY_MS) {
      var last = stays[stays.length - 1], la = sl / cnt, lo = sg / cnt;
      if (last && T[i] - T[last.b] < 15 * 60000 && kmLL(last.lat, last.lng, la, lo) <= 0.2) {
        last.lat = (last.lat * last.n + sl) / (last.n + cnt); last.lng = (last.lng * last.n + sg) / (last.n + cnt); last.n += cnt; last.b = j - 1;
      } else stays.push({ a: i, b: j - 1, lat: la, lng: lo, n: cnt });
      i = j;
    } else i++;
  }
  // Dawarich's transport per moment, from its track segments.
  var segs = P.segs.sort(function (a, b) { return a[0] - b[0]; }), segMax = 0;
  segs.forEach(function (g) { segMax = Math.max(segMax, g[1] - g[0]); });
  function modeAt(ms) {
    var lo = 0, hi = segs.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (segs[mid][0] <= ms) lo = mid + 1; else hi = mid; }
    for (var q = lo - 1; q >= 0 && segs[q][0] >= ms - segMax; q--) if (segs[q][1] >= ms) return segs[q][2];
    return null;
  }
  function addRun(idx, mode) {
    var jumps = false, given = !!mode;
    if (idx.length >= 3) {
      var keep = jumpKeep(idx.map(pt), idx.map(function (x) { return T[x] / 1000; }), jumpCap(mode || 'CAR'));
      if (keep.length < idx.length) { idx = keep.map(function (x) { return idx[x]; }); jumps = true; }
    }
    if (idx.length < 2) return;
    var a = idx[0], b = idx[idx.length - 1], far = 0, q;
    for (q = 1; q < idx.length; q++) far = Math.max(far, kmLL(LA[a], LO[a], LA[idx[q]], LO[idx[q]]));
    // A trip from or to a stay starts or ends at its middle. Short hops between two places count
    // too (a stay takes the first and last 150 m of the way).
    var ea = edge[a] || pt(a), eb = edge[b] || pt(b);
    if (far < 0.5 && km(ea, eb) < 0.2) return;
    var pts = idx.map(pt), dist = pathKm(simplify(pts, 15).map(function (x) { return pts[x]; }));
    var inner = simplify(pts, 6).slice(1, -1), before = c.start.length;
    if (!mode) mode = runMode(idx.map(function (x) { return [T[x], pt(x)]; }));
    c.add(mode, { ms: T[a], off: null }, { ms: T[b], off: null }, dist, 1 | (given ? 0 : GUESSED), ea, eb,
      inner.map(function (x) { return pts[x]; }), inner.map(function (x) { return T[idx[x]]; }));
    if (jumps && c.start.length > before) c.est[before] |= JUMPS;
  }
  // A run split where Dawarich's transport changes; points it has no transport for join the part they're in.
  function flush(run) {
    if (run.length < 2) return;
    var part = [run[0]], cur = segs.length ? modeAt(T[run[0]]) : null;
    for (var q = 1; q < run.length; q++) {
      var m = segs.length ? modeAt(T[run[q]]) : null;
      part.push(run[q]);
      if (m && cur && m !== cur) { addRun(part, cur); part = [run[q]]; }
      if (m) cur = m;
    }
    addRun(part, cur);
  }
  function stretch(a, b) {
    var run = [a];
    for (var q = a + 1; q <= b; q++) {
      var d = kmLL(LA[q - 1], LO[q - 1], LA[q], LO[q]), h = (T[q] - T[q - 1]) / 36e5;
      if (d > 150 && h < 20 && d / h > 180) {
        flush(run); run = [q];
        c.add('FLYING', { ms: T[q - 1], off: null }, { ms: T[q], off: null }, d, 2, pt(q - 1), pt(q), null);
      } else if (h > 0.5) { flush(run); run = [q]; }
      else run.push(q);
    }
    flush(run);
  }
  var from = 0, edge = {};
  stays.forEach(function (s) { edge[s.a] = edge[s.b] = [s.lat, s.lng]; });
  stays.forEach(function (s) { stretch(from, s.a); from = s.b; });
  stretch(from, n - 1);
  // Stays, named after the Dawarich visit they match (most of either one's time, within 500 m).
  var V = P.visits.sort(function (a, b) { return a.s - b.s; }), vMax = 0;
  V.forEach(function (v) { vMax = Math.max(vMax, v.e - v.s); });
  stays.forEach(function (s) {
    var st = T[s.a], et = T[s.b], ll = [s.lat, s.lng], best = null, bestOv = 0;
    var lo = 0, hi = V.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (V[mid].s < st - vMax) lo = mid + 1; else hi = mid; }
    for (var q = lo; q < V.length && V[q].s < et; q++) {
      var v = V[q], ov = Math.min(et, v.e) - Math.max(st, v.s);
      if (ov > bestOv && ov >= 0.5 * Math.min(et - st, v.e - v.s) && (!v.ll || km(v.ll, ll) < 0.5)) { best = v; bestOv = ov; }
    }
    if (best && best.ll && km(best.ll, ll) < 0.3) ll = best.ll;
    c.visit({ ms: st, off: null }, { ms: et, off: null }, ll, 0, best ? best.name : '', '');
  });
  if (!c.start.length && !c.vs.length) throw new Error(NO_DAWARICH);
  var r = finish(c, SRC.dawarich), TL = new Float32Array(2 * n);
  for (k = 0; k < n; k++) { TL[2 * k] = LA[k]; TL[2 * k + 1] = LO[k]; }
  r.track = { t: T.slice(0, n), ll: TL, dev: DV.slice(0, n) };
  return r;
}
// A Dawarich file on its own.
function parseDawarichFile(file, kind, onProgress) {
  var P = new DwPoints();
  return streamText(file.stream(), file.size, dwHandler(kind, P), onProgress).then(function () { return dwBuild(P); });
}
// A Dawarich ZIP: its points (and the visits and tracks of the account export), then trips and stays from them.
function isDawarichZip(all) {
  return all.some(function (e) { return /(^|\/)points\/.*\.jsonl$/i.test(e.name); }) ||
    !all.some(function (e) { return /(^|\/)activities\//i.test(e.name); }) && all.some(function (e) { return /\.(geojson|json|gpx)$/i.test(e.name) && !/(^|\/)manifest\.json$/i.test(e.name); });
}
function parseDawarichZip(file, all, onProgress) {
  var P = new DwPoints(), jobs = [];
  all.forEach(function (e) {
    var m = /(^|\/)(points|visits|tracks)\/.*\.jsonl$/i.exec(e.name);
    if (m) jobs.push([e, m[2].toLowerCase()]);
  });
  if (!jobs.length) all.forEach(function (e) {
    if (/(^|\/)manifest\.json$/i.test(e.name)) return;
    if (/\.gpx$/i.test(e.name)) jobs.push([e, 'gpx']);
    else if (/\.(geojson|json)$/i.test(e.name)) jobs.push([e, 'geojson']);
  });
  var total = 0, done = 0;
  jobs.forEach(function (j) { total += j[0].raw || j[0].comp || 1; });
  return jobs.reduce(function (pr, j) {
    return pr.then(function () {
      var size = j[0].raw || j[0].comp || 1, kind = j[1];
      return zipStream(file, j[0]).then(function (st) {
        // A GPX not written by Dawarich (or a JSON that isn't GeoJSON) is read anyway: inside a Dawarich ZIP there is nothing else it can be.
        return streamText(st, size, dwHandler(kind, P), function (f) { onProgress((done + f * size) / total); });
      }).then(function () { done += size; });
    });
  }, Promise.resolve()).then(function () { return dwBuild(P); });
}

function parseFile(file, onProgress) {
  if (/\.zip$/i.test(file.name)) return zipEntries(file).then(function (all) {
    return isDawarichZip(all) ? parseDawarichZip(file, all, onProgress) : parseStravaZip(file, all, onProgress);
  });
  return file.slice(0, 4096).text().then(function (head) {
    var dw = /\.gz$/i.test(file.name) ? null : dwSniff(file.name, head);
    if (dw) return parseDawarichFile(file, dw, onProgress);
    if (isStravaName(file.name)) return parseStravaFile(file);
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
if (typeof module !== 'undefined') module.exports = { PATH_TRIP: PATH_TRIP, JUMPS: JUMPS, cleanJumps: cleanJumps, jumpKeep: jumpKeep, parseTimeline: parseTimeline, withTrack: withTrack, mergeTracks: mergeTracks, RECORDS_GPS: RECORDS_GPS, MODES: MODES, normMode: normMode, km: km, SRC: SRC, NO_OFF: NO_OFF, parseFile: parseFile, dwBuild: dwBuild, DwPoints: DwPoints, dwPoint: dwPoint, STRAVA: STRAVA, SPORTS: SPORTS, stravaSport: stravaSport };
