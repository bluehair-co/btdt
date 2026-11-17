// ---------- MyRules ----------
// A MyRules file (*.myrules.json) holds what only you know: which bike you rode when, where home was.
// It is applied on top of the location files. Values a rule fills in are marked Inferred; values a
// correction sets on a trip (its type, title, gear, or hiding it) are marked Edited.
// The format is in docs/myrules.md; this version applies gear periods, places, routines (type, gear
// and lines) and corrections.
// Corrections that replace trips are kept in the file (and exported again) but not applied yet.
// MR is null until a file is loaded or a rule is made in the app. It is saved in this browser's
// IndexedDB next to the trips, never uploaded. changes lists what was changed in the app since the
// file was last loaded or exported, so nothing is lost by removing it from the device.
var MR = null;
var MR_SECTIONS = ['places', 'gear', 'routines', 'corrections'];
var MR_DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
var MR_KINDS = { bike: 'Bike', strida: 'Strida', halfbike: 'Halfbike', cargo: 'Cargo bike', ebike: 'E-bike', shoe: 'Shoes', other: 'Other' };
var MR_COUNT = {};   // trips (gear) or stays (places) each rule changed, by id
var MR_AMB = 0;      // trips more than one gear period fits equally well, which get none

function mrList(sec) { return MR && MR.doc[sec] ? MR.doc[sec].filter(function (r) { return r && typeof r === 'object'; }) : []; }
function mrActive(sec) { return MR && MR.on ? mrList(sec).filter(function (r) { return r.id && r.enabled !== false; }) : []; }
function mrById(id) {
  id = String(id || '').replace(/^@/, '');
  for (var s = 0; s < MR_SECTIONS.length; s++) { var L = mrList(MR_SECTIONS[s]); for (var k = 0; k < L.length; k++) if (L[k].id === id) return L[k]; }
  return null;
}
function mrNewId(name) {
  var base = String(name || 'rule').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'rule', id = base, k = 2;
  while (mrById(id)) id = base + '-' + k++;
  return id;
}
function mrDayNum(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) : null; }
function mrMin(s) { var m = /^(\d{2}):(\d{2})$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; }
// A trip's local start: its day number, day of the week and minutes after midnight.
function mrLocalMin(i) {
  var off = D.off[i] !== NO_OFF ? D.off[i] : -new Date(D.start[i]).getTimezoneOffset();
  var t = D.start[i] + off * 60000;
  return Math.floor((t - Math.floor(t / 864e5) * 864e5) / 60000);
}
// The local start of a trip as ISO 8601 with its UTC offset, to the minute: how rules point at one trip.
function mrIsoLocal(i) {
  var off = D.off[i] !== NO_OFF ? D.off[i] : -new Date(D.start[i]).getTimezoneOffset();
  var s = new Date(D.start[i] + off * 60000).toISOString().slice(0, 16), a = Math.abs(off);
  return s + (off < 0 ? '-' : '+') + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
}
// A rule's when, ready to test trips against.
function mrWhen(w) {
  w = w || {};
  var o = { from: mrDayNum(w.from), to: mrDayNum(w.to), days: null, t0: null, t1: null, skip: [] };
  if (Array.isArray(w.days) && w.days.length) { o.days = {}; w.days.forEach(function (d) { var k = MR_DOW.indexOf(String(d).toLowerCase().slice(0, 3)); if (k >= 0) o.days[k] = 1; }); }
  if (Array.isArray(w.time) && w.time.length === 2) { o.t0 = mrMin(w.time[0]); o.t1 = mrMin(w.time[1]); }
  (Array.isArray(w.skip) ? w.skip : []).forEach(function (s) { if (Array.isArray(s)) o.skip.push([mrDayNum(s[0]), mrDayNum(s[1])]); });
  // How long it lasts, for choosing between two rules that both fit: the shorter one wins.
  o.len = o.from != null && o.to != null ? o.to - o.from : 1e9;
  return o;
}
function mrWhenOk(w, i) {
  var d = D.day[i];
  if (w.from != null && d < w.from) return false;
  if (w.to != null && d > w.to) return false;
  if (w.days && !w.days[D.dow[i]]) return false;
  if (w.t0 != null && w.t1 != null) {
    var m = mrLocalMin(i);
    if (w.t0 <= w.t1 ? m < w.t0 || m > w.t1 : m < w.t0 && m > w.t1) return false;
  }
  for (var k = 0; k < w.skip.length; k++) if ((w.skip[k][0] == null || d >= w.skip[k][0]) && (w.skip[k][1] == null || d <= w.skip[k][1])) return false;
  return true;
}
// The trips a TripRef points at. start matches the one trip starting within 3 minutes of it (the
// type it had, when given, picks between two); day every trip that day; span every trip starting in it.
function mrFirstAfter(ms) {
  var o = D.order, lo = 0, hi = o.length;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (D.start[o[mid]] < ms) lo = mid + 1; else hi = mid; }
  return lo;
}
function mrRefTrips(ref) {
  var out = [], k, i, o = D.order;
  if (!ref || typeof ref !== 'object') return out;
  if (ref.start) {
    var t = Date.parse(ref.start);
    if (!isFinite(t)) return out;
    for (k = mrFirstAfter(t - 3 * 60000); k < o.length && D.start[o[k]] <= t + 3 * 60000; k++) if (!isDup(o[k])) out.push(o[k]);
    // The type the trip had in the files, not the one a correction gave it.
    if (out.length > 1 && ref.mode) out = out.filter(function (j) { return MODES[(D.base || D).mode[j]] === ref.mode; });
    return out.length === 1 ? out : [];
  }
  if (ref.span && ref.span.length === 2) {
    var a = Date.parse(ref.span[0]), b = Date.parse(ref.span[1]);
    for (k = mrFirstAfter(a); k < o.length && D.start[o[k]] <= b; k++) if (!isDup(o[k])) out.push(o[k]);
    return out;
  }
  var d = mrDayNum(ref.day);
  if (d != null) for (i = 0; i < D.day.length; i++) if (D.day[i] === d && !isDup(i)) out.push(i);
  return out;
}
function mrExcept(r) {
  var s = {};
  (Array.isArray(r.except) ? r.except : []).forEach(function (ref) { mrRefTrips(ref).forEach(function (i) { s[i] = 1; }); });
  return s;
}
// The place rules with a position, and the one a point is in (the nearest, if several).
function mrPlaceAt(lat, lng) {
  var best = null, bd = Infinity;
  mrActive('places').forEach(function (r) {
    if (!Array.isArray(r.at) || !isFinite(lat)) return;
    var d = km([lat, lng], r.at) * 1000;
    if (d <= (+r.radius_m || 100) && d < bd) { bd = d; best = r; }
  });
  return best;
}
// The places in your original data, before BT•DT groups anything: each Google place ID is one (at
// the middle of its stays), and a stay without an ID is one on its own. A place rule takes or leaves
// each of them whole, by where it is, whatever grouping the app did after (the 300 m places, IDs
// within 100 m, merged IDs), so the radius you set is the only thing that decides.
function mrUnits() {
  if (D.mrUnits && D.mrUnits.nv === D.vs.length) return D.mrUnits;
  var by = {}, list = [], of = new Int32Array(D.vs.length);
  for (var v = 0; v < D.vs.length; v++) {
    var pid = D.vpid && D.vpid[v], k = pid ? 'id:' + pid : 'v' + v, u = by[k];
    if (!u) { u = by[k] = { key: k, k: list.length, la: 0, lo: 0, n: 0, name: '' }; list.push(u); }
    u.la += D.vll[2 * v]; u.lo += D.vll[2 * v + 1]; u.n++;
    if (!u.name && D.vname[v]) u.name = D.vname[v];
    of[v] = u.k;
  }
  list.forEach(function (u) { u.lat = u.la / u.n; u.lng = u.lo / u.n; });
  return (D.mrUnits = { nv: D.vs.length, list: list, of: of });
}
// The place rule a stay belongs to, by where its original place is.
function mrStayPlace(v) {
  var U = mrUnits(), u = U.list[U.of[v]];
  return mrPlaceAt(u.lat, u.lng);
}
function mrNearestPlace(at) {
  var best = -1, bd = Infinity;
  D.places.forEach(function (q, k) { if (q.ap) return; var d = km([q.lat, q.lng], at); if (d < bd) { bd = d; best = k; } });
  return best;
}
function mrNear(lat, lng, ref) {
  var r = mrById(ref);
  return r && Array.isArray(r.at) && isFinite(lat) && km([lat, lng], r.at) * 1000 <= Math.max(+r.radius_m || 100, 500);
}

// Gear: called by buildGear once recorded gear is in. byName is buildGear's gear index by name.
// A gear set on one trip (a correction) wins; then gear periods fill in the trips of their type
// with no gear of their own. Recorded gear is never replaced by a period. Of the periods that fit
// a trip, one with a match beats one without, then the shorter one wins; a tie leaves the trip
// without gear (a wrong guess is worse than none).
function mrApplyGear(byName, addGear) {
  var n = D.day.length, i, k;
  D.mrGear = []; D.mrAmb = []; MR_AMB = 0;
  mrActive('gear').forEach(function (r) { MR_COUNT[r.id] = 0; });
  if (!MR || !MR.on) return;
  var periods = mrActive('gear').filter(function (r) { return MODE_IDX[r.mode] != null; }).map(function (r) {
    var m = r.match || {};
    return { r: r, mi: MODE_IDX[r.mode], w: mrWhen(r.when), ex: mrExcept(r), m: m, level: Object.keys(m).length ? 0 : 1 };
  });
  function gearOf(r) { return addGear(r.strava_name && byName[r.strava_name] ? r.strava_name : r.name || r.id, r.kind, r.mode); }
  function fits(p, i) {
    if (D.mode[i] !== p.mi || p.ex[i] || !mrWhenOk(p.w, i)) return false;
    var m = p.m;
    if (m.min_km != null && D.km[i] < m.min_km) return false;
    if (m.max_km != null && D.km[i] > m.max_km) return false;
    if (Array.isArray(m.sports) && m.sports.length && !(D.sport[i] && m.sports.indexOf(SPORTS[D.sport[i]][1] || SPORTS[D.sport[i]][0]) >= 0)) return false;
    if (m.weekdays_only && (D.dow[i] === 0 || D.dow[i] === 6)) return false;
    if (m.from && !mrNear(D.from[2 * i], D.from[2 * i + 1], m.from) && !mrNear(D.to[2 * i], D.to[2 * i + 1], m.from)) return false;
    if (m.to && !mrNear(D.to[2 * i], D.to[2 * i + 1], m.to) && !mrNear(D.from[2 * i], D.from[2 * i + 1], m.to)) return false;
    return true;
  }
  // Gear set by a correction: on a day or span first, then on one trip, each in file order, so the
  // trip's own and the newest win. Only a correction on one trip replaces recorded gear.
  mrCorrections().forEach(function (x) {
    var c = x.c;
    if (!c.then.gear) return;
    var ref = String(c.then.gear), r = ref.charAt(0) === '@' ? mrById(ref) : null;
    if (ref.charAt(0) === '@' && (!r || r.enabled === false)) return;
    var hit = 0;
    x.trips.forEach(function (i) {
      if (!x.one && D.gear[i] && !D.mrGear[i]) return;
      var g = r ? gearOf(r) : addGear(ref, null, MODES[D.mode[i]]);
      D.gear[i] = g; D.mrGear[i] = { rule: c.id, gear: g, cor: true };
      hit++;
    });
    MR_COUNT[c.id] = Math.max(MR_COUNT[c.id] || 0, hit);
  });
  // Gear from a routine, on its trips without gear: more specific than a gear period.
  for (i = 0; i < n; i++) {
    var rt = D.mrRoute[i], rr = rt && mrById(rt.rule), rg = rr && rr.then && rr.then.gear;
    if (!rg || D.gear[i]) continue;
    var gr = String(rg).charAt(0) === '@' ? mrById(rg) : null;
    if (String(rg).charAt(0) === '@' && (!gr || gr.enabled === false)) continue;
    D.gear[i] = gr ? gearOf(gr) : addGear(String(rg), null, MODES[D.mode[i]]);
    D.mrGear[i] = { rule: rr.id, gear: D.gear[i] };
  }
  if (!periods.length) return;
  for (i = 0; i < n; i++) {
    if (D.gear[i] || isDup(i)) continue;
    var best = [];
    for (k = 0; k < periods.length; k++) {
      var p = periods[k];
      if (!fits(p, i)) continue;
      if (!best.length || p.level < best[0].level || p.level === best[0].level && p.w.len < best[0].w.len) best = [p];
      else if (p.level === best[0].level && p.w.len === best[0].w.len) best.push(p);
    }
    if (!best.length) continue;
    if (best.length > 1) { D.mrAmb[i] = best.map(function (p) { return p.r.id; }); MR_AMB++; continue; }
    D.gear[i] = gearOf(best[0].r);
    D.mrGear[i] = { rule: best[0].r.id, gear: D.gear[i] };
    MR_COUNT[best[0].r.id] = (MR_COUNT[best[0].r.id] || 0) + 1;
  }
}
// Inferred: gear a gear period filled in. Edited: anything a correction set.
function mrInferred(i) { return !!(D.mrGear && D.mrGear[i] && !D.mrGear[i].cor || D.mrMode && D.mrMode[i] && D.mrMode[i].inf || D.snap && D.snap[i]); }
function mrEdited(i) { return !!(D.mrMode && (D.mrMode[i] && !D.mrMode[i].inf || D.mrName[i] || D.mrHide[i] || D.mrGear[i] && D.mrGear[i].cor)); }
function mrTag(i) { return !D ? '' : (mrEdited(i) ? '<span class="guess inf">Edited</span>' : '') + (mrInferred(i) ? '<span class="guess inf">Inferred</span>' : ''); }

// Corrections, ready to apply: the switched-on ones that point at trips, those on a day or span
// first and those on one trip after, each in file order, so applying them in turn lets the trip's
// own and then the newest win. trips leaves out the correction's except.
var MR_COR = null;
function mrCorrections() {
  if (MR_COR) return MR_COR;
  var span = [], one = [];
  mrActive('corrections').forEach(function (c) {
    if (!c.trip || !c.then || typeof c.then !== 'object') return;
    var ex = mrExcept(c), x = { c: c, one: !!c.trip.start, trips: mrRefTrips(c.trip).filter(function (i) { return !ex[i]; }) };
    (x.one ? one : span).push(x);
  });
  return (MR_COR = span.concat(one));
}
// Types, titles and hiding from corrections, on D's own copy of the files' values (D.base). Called by
// setData before anything counts types, and again by mrReapply. Gear is set later, in mrApplyGear.
function mrApplyCorrections() {
  var b = D.base, n = D.day.length;
  function copy(a) { return a ? a.slice() : a; }
  D.mode = copy(b.mode); D.est = copy(b.est); D.sport = copy(b.sport); D.stype = copy(b.stype); D.km = copy(b.km);
  D.mrMode = []; D.mrName = []; D.mrHide = new Uint8Array(n); D.mrRoute = []; D.snap = []; D.mrLine = {};
  MR_COUNT = {}; MR_COR = null; MR_NOFIT = {};
  if (!MR || !MR.on) return;
  // Routines first, so a correction on the same trip wins over them.
  mrApplyRoutines();
  mrCorrections().forEach(function (x) {
    var t = x.c.then, mi = t.mode != null ? MODE_IDX[t.mode] : null, hit = 0;
    x.trips.forEach(function (i) {
      if (mi != null) {
        D.mode[i] = mi;
        // A correction isn't a guess. A Strava sport of another type no longer fits the trip.
        D.est[i] &= ~GUESSED;
        if (D.sport[i] && SPORTS[D.sport[i]][2] !== t.mode) D.sport[i] = 0;
        if (D.stype) D.stype[i] = '';
        D.mrMode[i] = { rule: x.c.id, was: MODES[b.mode[i]], guessed: !!(b.est[i] & GUESSED) };
        hit = 1;
      }
      if (typeof t.name === 'string' && t.name.trim()) { D.mrName[i] = { rule: x.c.id, name: t.name.trim() }; hit = 1; }
      if (t.hide === true) { D.mrHide[i] = 1; hit = 1; }
      else if (t.hide === false && D.mrHide[i]) { D.mrHide[i] = 0; hit = 1; }
    });
    if (hit) MR_COUNT[x.c.id] = x.trips.length;
  });
  // Lines last: a trip a correction moved to another type keeps its routine's line only if it still matches.
  mrApplySnaps();
}

// ---------- routines ----------
// A routine matches trips that start within 500 m of its from and end within 500 m of its to (a
// place's own radius if larger), inside its when; with both_ways, the trip back too, inside
// return_when (else when). from and to are a place rule ("@office") or a position ([lat, lng]).
// Of the routines that match a trip, the one with the shorter when wins, then the later one in the
// file. then.mode sets the type when the files had none or it was guessed (or always, with force);
// then.gear fills trips without gear (in mrApplyGear); then.snap draws the trip along a line.
var MR_NOFIT = {};   // trips a routine's line didn't fit, by routine id
function mrEnd(ref) {
  if (Array.isArray(ref) && ref.length === 2 && isFinite(ref[0])) return { at: [+ref[0], +ref[1]], rad: 0.5 };
  if (ref && typeof ref === 'object' && Array.isArray(ref.at)) return { at: ref.at, rad: Math.max(0.5, (+ref.radius_m || 0) / 1000) };
  var r = mrById(ref);
  return r && Array.isArray(r.at) ? { at: r.at, rad: Math.max(0.5, (+r.radius_m || 0) / 1000) } : null;
}
function mrRoutineList() {
  return mrActive('routines').map(function (r, k) {
    var a = mrEnd(r.from), b = mrEnd(r.to), w = mrWhen(r.when);
    if (!a || !b) return null;
    var rw = r.return_when ? mrWhen(Object.assign({}, r.when, r.return_when)) : w;
    return { r: r, k: k, a: a, b: b, w: w, rw: rw, ex: mrExcept(r), then: r.then && typeof r.then === 'object' ? r.then : {} };
  }).filter(Boolean);
}
function mrNearEnd(e, i, end) { var o = end ? 'to' : 'from', lat = D[o][2 * i]; return isFinite(lat) && km([lat, D[o][2 * i + 1]], e.at) <= e.rad; }
// 1: the trip goes from → to; -1: to → from (both_ways); 0: no match.
function mrRouteDir(x, i) {
  if (x.ex[i]) return 0;
  if (mrNearEnd(x.a, i, false) && mrNearEnd(x.b, i, true) && mrWhenOk(x.w, i)) return 1;
  if (x.r.both_ways && mrNearEnd(x.b, i, false) && mrNearEnd(x.a, i, true) && mrWhenOk(x.rw, i)) return -1;
  return 0;
}
function mrApplyRoutines() {
  var L = mrRoutineList(), n = D.day.length, b = D.base;
  L.forEach(function (x) { MR_COUNT[x.r.id] = 0; });
  if (!L.length) return;
  for (var i = 0; i < n; i++) {
    if (isDup(i) || MODES[b.mode[i]] === 'FLYING') continue;
    var best = null, bd = 0;
    for (var k = 0; k < L.length; k++) {
      var d = mrRouteDir(L[k], i);
      if (d && (!best || L[k].w.len <= best.w.len)) { best = L[k]; bd = d; }
    }
    if (!best) continue;
    D.mrRoute[i] = { rule: best.r.id, dir: bd };
    MR_COUNT[best.r.id]++;
    var m = best.then.mode, mi = m != null ? MODE_IDX[m] : null;
    if (mi == null || mi === b.mode[i]) continue;
    if (!best.r.force && !(b.est[i] & GUESSED) && MODES[b.mode[i]] !== 'UNKNOWN') continue;
    D.mode[i] = mi;
    D.est[i] &= ~GUESSED;
    if (D.sport[i] && SPORTS[D.sport[i]][2] !== m) D.sport[i] = 0;
    if (D.stype) D.stype[i] = '';
    D.mrMode[i] = { rule: best.r.id, was: MODES[b.mode[i]], guessed: !!(b.est[i] & GUESSED), inf: true };
  }
}

// ---------- lines (snap) ----------
// A routine's then.snap draws its trips along one line instead of their own GPS points: "learn" (the
// cleanest of its trips, or the one { "trip": TripRef } names), { "polyline": "…" } (Google's
// encoding, 5 decimals) or { "geojson": "file.geojson" } (a LineString loaded with the rules, kept in
// MR.lines). Each trip takes the stretch between the points nearest its start and end, its own times
// spread along it by distance, and the line's length as its distance. A trip whose own points stray
// over 1 km from the line for more than a third of them isn't snapped ("didn't fit").
function mrDecodePolyline(s) {
  var pts = [], idx = 0, lat = 0, lng = 0;
  s = String(s || '');
  while (idx < s.length) {
    var v = [0, 0];
    for (var c = 0; c < 2; c++) {
      var shift = 0, res = 0, by;
      do { by = s.charCodeAt(idx++) - 63; res |= (by & 0x1f) << shift; shift += 5; } while (by >= 0x20 && idx <= s.length);
      v[c] = res & 1 ? ~(res >> 1) : res >> 1;
    }
    lat += v[0]; lng += v[1];
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}
function mrTripPts(i) {
  var out = [];
  for (var q = D.pathOff[i]; q < D.pathOff[i + 1]; q++) out.push([D.pathPts[2 * q], D.pathPts[2 * q + 1]]);
  return out;
}
// How clean a trip's own trail is, to learn a line from: GPS points per km with no gap over 2 minutes,
// a recorded activity or a Records.json line counting double. 0 when it can't be used.
function mrClean(i) {
  var o0 = D.pathOff[i], o1 = D.pathOff[i + 1], n = o1 - o0;
  var len = (D.base || D).km[i];   // the files' distance: a snapped trip's is the line's
  if (n < 10 || !(len > 0.3)) return 0;
  for (var q = o0 + 1; q < o1; q++) if (D.pathT[q] - D.pathT[q - 1] > 120) return 0;
  return n / len * (D.base.est[i] & (16 | 32) ? 2 : 1);
}
// The line a routine draws its trips along, from → to. src says where it came from.
function mrRouteLine(x, trips) {
  var sn = x.then.snap, pts = null, src = '', from = null;
  if (!sn) return null;
  if (typeof sn === 'object' && sn.polyline) { pts = mrDecodePolyline(sn.polyline); src = 'the line in your MyRules'; }
  else if (typeof sn === 'object' && sn.geojson) {
    pts = MR.lines && MR.lines[sn.geojson];
    src = pts ? sn.geojson : '';
    if (!pts) return { missing: sn.geojson };
  } else {
    // Learned: the trip the rule names, else the cleanest one.
    var pick = typeof sn === 'object' && sn.trip ? mrRefTrips(sn.trip)[0] : null, best = 0;
    if (pick == null) trips.forEach(function (i) { var c = mrClean(i); if (c > best) { best = c; pick = i; } });
    if (pick == null) return null;
    pts = mrTripPts(pick);
    if (D.mrRoute[pick] && D.mrRoute[pick].dir < 0) pts.reverse();
    src = 'trip'; from = pick;
  }
  return pts && pts.length >= 2 ? { pts: pts, src: src, from: from } : null;
}
function mrLL(p, c) { return [(p[1] - c[1]) * Math.cos(c[0] * Math.PI / 180) * 111.32, (p[0] - c[0]) * 110.57]; }
// Distance (km) from a point to the line, and the index of its nearest point.
function mrToLine(p, L) {
  var bd = Infinity, bi = 0;
  for (var k = 0; k < L.length - 1; k++) {
    var a = mrLL(L[k], p), b = mrLL(L[k + 1], p), dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    var t = l ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / l)) : 0, x = a[0] + t * dx, y = a[1] + t * dy, d = Math.sqrt(x * x + y * y);
    if (d < bd) { bd = d; bi = t < 0.5 ? k : k + 1; }
  }
  return { d: bd, k: bi };
}
function mrSnapTrip(i, L) {
  var a = [D.from[2 * i], D.from[2 * i + 1]], b = [D.to[2 * i], D.to[2 * i + 1]];
  if (!isFinite(a[0]) || !isFinite(b[0])) return null;
  // Its own points, at most 40 of them, mostly near the line.
  var own = mrTripPts(i), off = 0, step = Math.max(1, Math.ceil(own.length / 40)), cnt = 0;
  for (var q = 0; q < own.length; q += step) { cnt++; if (mrToLine(own[q], L).d > 1) off++; }
  if (cnt && off > cnt / 3) return null;
  var ia = mrToLine(a, L), ib = mrToLine(b, L);
  if (ia.d > 1 || ib.d > 1 || ia.k === ib.k) return null;
  var seg = ia.k < ib.k ? L.slice(ia.k, ib.k + 1) : L.slice(ib.k, ia.k + 1).reverse();
  var cum = [0], len = 0;
  for (q = 1; q < seg.length; q++) { len += km(seg[q - 1], seg[q]); cum.push(len); }
  var dur = Math.max(0, (D.end[i] - D.start[i]) / 1000);
  return { pts: seg, ts: cum.map(function (c) { return len ? dur * c / len : 0; }), km: len };
}
function mrApplySnaps() {
  mrRoutineList().forEach(function (x) {
    if (!x.then.snap) return;
    var trips = [];
    for (var i = 0; i < D.day.length; i++) if (D.mrRoute[i] && D.mrRoute[i].rule === x.r.id && MODES[D.mode[i]] !== 'FLYING') trips.push(i);
    var line = mrRouteLine(x, trips);
    D.mrLine[x.r.id] = line;
    if (!line || !line.pts) return;
    MR_NOFIT[x.r.id] = 0;
    trips.forEach(function (i) {
      if (i === line.from) return;
      var s = mrSnapTrip(i, line.pts);
      if (!s) { MR_NOFIT[x.r.id]++; return; }
      s.rule = x.r.id;
      D.snap[i] = s;
      D.km[i] = s.km;
    });
  });
}

// Places: hidden places leave their stays out of the map's pins and heatmap and the places in
// Insights (trips to and from them still count); home from MyRules replaces the app's guess.
function mrApplyPlaces() {
  var nv = D.vs.length;
  D.vhide = new Uint8Array(nv);
  mrActive('places').forEach(function (r) { MR_COUNT[r.id] = 0; });
  if (!MR || !MR.on) return;
  for (var v = 0; v < nv; v++) {
    var r = mrStayPlace(v);
    if (!r) continue;
    MR_COUNT[r.id]++;
    if (r.hide) D.vhide[v] = 1;
  }
}
// The home rule that counts: the one that runs latest (open-ended wins).
// Home, work and school can be current or past: past ones have a when.to before today.
var MR_LIFE = { home: 'Home', work: 'Work', school: 'School' };
function mrIsPast(r) { var t = r && r.when && mrDayNum(r.when.to); return t != null && t < todayDay(); }
function mrIsCurrent(r) { return !!(r && MR_LIFE[r.role] && !mrIsPast(r)); }
// The place rule a spot or place (D.places) was made from, if it is switched on.
function mrRuleOf(q) {
  var r = q.mr ? mrById(q.mr) : q.key && q.key.slice(0, 3) === 'mr:' ? mrById(q.key.slice(3)) : null;
  return r && r.enabled !== false && MR && MR.on ? r : null;
}
function mrHomeRule() {
  var best = null, bt = -Infinity;
  mrActive('places').forEach(function (r) {
    // Only a current home: with only past ones, home is guessed from the nights again.
    if (r.role !== 'home' || !Array.isArray(r.at) || mrIsPast(r)) return;
    var t = r.when && r.when.to ? mrDayNum(r.when.to) : Infinity;
    if (t >= bt) { bt = t; best = r; }
  });
  return best;
}
// The place D.places has for the home rule, for findHome.
function mrHomePlace() {
  var r = mrHomeRule();
  if (!r) return null;
  var best = -1, bd = Math.max(+r.radius_m || 100, 300) / 1000;
  D.places.forEach(function (q, k) { if (q.ap) return; var d = km([q.lat, q.lng], r.at); if (d <= bd) { bd = d; best = k; } });
  return best;
}
// Name for a place from a place rule: Home for a home, else the rule's name.
function mrPlaceName(q) {
  if (q.ap) return '';
  // A place (D.places) or spot is a named place's only when it was made from its radius (tagPlaces,
  // buildSpotKeys); anything else at those coordinates goes by its own name.
  var r = q.mr ? mrById(q.mr) : q.key ? (q.key.slice(0, 3) === 'mr:' ? mrById(q.key.slice(3)) : null) : 'ap' in q ? null : mrPlaceAt(q.lat, q.lng);
  if (r && (r.enabled === false || !MR || !MR.on)) r = null;
  if (!r) return '';
  // A hidden place shows as the town it is in, never by its name or address.
  if (r.hide) { var c = nearestCity(q.lat, q.lng); return c ? (c.d > 8 ? 'Near ' : '') + c.name : ccName(countryAt(q.lat, q.lng)); }
  if (MR_LIFE[r.role] && mrIsPast(r)) return r.name || 'Former ' + r.role;
  return r.role === 'home' ? 'Home' : r.name || mrKindName(r.role);
}

// Applies the rules again after a change, keeping the filters (gear chips are rebuilt, all on; types
// and sports trips now have for the first time are turned on).
function mrReapply() {
  if (!D) { renderImports(); return; }
  mrApplyCorrections();
  var ms = modeStats();
  ms.modes.forEach(function (m) { if (M.modes.indexOf(m) < 0) F.modes.add(m); });
  ms.sports.forEach(function (sp) { if (M.sports.indexOf(sp) < 0) F.sports.add(sp); });
  M.modes = ms.modes; M.sports = ms.sports; M.sportN = ms.sportN; M.plain = ms.plain;
  buildGear();
  M.gear = GEAR; M.gearMode = GEAR_MODE;
  D.places = null; D.home = undefined; D.spotN = null; D.homeSpot = undefined; D.skey = null;
  mrApplyPlaces();
  M.anyGuess = mrAnyGuess();
  F.gear = new Set(gearIds());
  // Pins carry place names in their titles: drawn again.
  if (pinLayer) pinLayer._ver = null;
  buildFilterUI();
  apply();
  renderSettings();
  if (openId === 'mrSheet') mrRenderRules();
}
function mrAnyGuess() {
  for (var i = 0; i < D.day.length; i++) if (D.est[i] & GUESSED || mrInferred(i)) return true;
  return false;
}

// ---------- reading, saving and exporting ----------
function mrSave() {
  if (DEMO) return Promise.resolve();
  if (!MR) return withStore('btdt', 'readwrite', function (s) { return s.delete('myrules'); }).catch(function () {});
  return withStore('btdt', 'readwrite', function (s) { return s.put({ doc: MR.doc, name: MR.name, on: MR.on, changes: MR.changes, exported: MR.exported, lines: MR.lines || {} }, 'myrules'); }).catch(function () {});
}
function mrLoad() {
  return withStore('btdt', 'readonly', function (s) { return s.get('myrules'); }).then(function (x) {
    if (x && x.doc) MR = { doc: x.doc, name: x.name || 'my.myrules.json', on: x.on !== false, changes: x.changes || [], exported: x.exported || 0, lines: x.lines || {} };
  }).catch(function () {});
}
// Something changed in the app: kept with a short description, until the next export.
function mrChange(text) {
  MR.changes.push({ t: Date.now(), text: text });
  MR.doc.about = Object.assign({}, MR.doc.about, { updated: new Date().toISOString(), generator: 'BT•DT' });
  mrSave();
  mrReapply();
}
function mrEnsure() {
  if (!MR) MR = { doc: { $schema: 'https://bluehair-co.github.io/btdt/schema/myrules-0.1.json', myrules: '0.1', about: { generator: 'BT•DT' } }, name: 'my.myrules.json', on: true, changes: [], exported: 0 };
  return MR;
}
function mrExport() {
  if (!MR) return;
  saveFile(MR.name.replace(/(\.myrules)?\.json$/i, '') + '.myrules.json', [JSON.stringify(MR.doc, null, 2) + '\n'], 'application/json');
  MR.changes = []; MR.exported = Date.now();
  mrSave(); renderImports();
  if (openId === 'mrSheet') mrRenderRules();
}
// Whether a file is a MyRules file: by its name, or a small .json whose start says "myrules".
function mrIsFile(f) {
  if (/\.myrules\.json$/i.test(f.name)) return Promise.resolve(true);
  if (!/\.json$/i.test(f.name) || f.size > 5e6) return Promise.resolve(false);
  return f.slice(0, 600).text().then(function (t) { return /^\s*\{[\s\S]*"myrules"\s*:/.test(t) && !/semanticSegments|timelineObjects|locations/.test(t); }).catch(function () { return false; });
}
// GeoJSON lines for routines' snap: a .geojson file whose name a routine (here or in the MyRules
// files loaded with it) gives as its snap.geojson is a line, not location data. Its first LineString
// (or the longest part of a MultiLineString) is kept in MR.lines, saved with the rules.
function mrLineNames(texts) {
  var names = {};
  mrList('routines').forEach(function (r) { var g = r.then && r.then.snap && r.then.snap.geojson; if (g) names[g] = 1; });
  (texts || []).forEach(function (t) { var re = /"geojson"\s*:\s*"([^"]+)"/g, m; while ((m = re.exec(t))) names[m[1]] = 1; });
  return names;
}
function mrGeoLine(text) {
  var g = JSON.parse(text), best = null;
  function take(c) { if (Array.isArray(c) && c.length >= 2 && (!best || c.length > best.length)) best = c; }
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (o.type === 'FeatureCollection') (o.features || []).forEach(walk);
    else if (o.type === 'Feature') walk(o.geometry);
    else if (o.type === 'LineString') take(o.coordinates);
    else if (o.type === 'MultiLineString') (o.coordinates || []).forEach(take);
    else if (o.type === 'GeometryCollection') (o.geometries || []).forEach(walk);
  })(g);
  if (!best) throw new Error('it has no line');
  return best.map(function (c) { return [+(+c[1]).toFixed(6), +(+c[0]).toFixed(6)]; });
}
function mrImportLines(files) {
  return Promise.all(files.map(function (f) { return f.text().then(function (t) { return [f.name, mrGeoLine(t)]; }); })).then(function (got) {
    mrEnsure();
    MR.lines = MR.lines || {};
    got.forEach(function (g) { MR.lines[g[0]] = g[1]; });
    mrSave(); mrReapply();
    setStatus('MyRules: loaded the line' + (got.length > 1 ? 's' : '') + ' ' + got.map(function (g) { return g[0]; }).join(', ') + '.');
  }).catch(function (e) { setStatus('MyRules line: ' + (e && e.message || e), true); });
}
function mrParse(text) {
  var doc = JSON.parse(text);
  if (!doc || typeof doc !== 'object' || typeof doc.myrules !== 'string') throw new Error('this isn\'t a MyRules file');
  if (doc.myrules.split('.')[0] !== '0') throw new Error('it is MyRules version ' + doc.myrules + ', which this version of BT•DT can\'t read yet');
  MR_SECTIONS.forEach(function (s) { if (doc[s] != null && !Array.isArray(doc[s])) throw new Error('"' + s + '" should be a list'); });
  return doc;
}
// Loads MyRules files picked with the location files. With rules already here, asks whether to
// merge (same id replaced) or replace; replacing unsaved changes first offers to download them.
function mrImport(files) {
  return Promise.all(files.map(function (f) { return f.text().then(function (t) { return { name: f.name, doc: mrParse(t) }; }); })).then(function (got) {
    var doc = got[0].doc;
    got.slice(1).forEach(function (g) { doc = mrMergeDocs(doc, g.doc); });
    var name = got[got.length - 1].name;
    if (!MR) { mrUse(doc, name, false); return; }
    mrAsk({
      title: 'Add to your MyRules?',
      text: esc(name) + ' has ' + mrCount(doc) + '. You already have ' + mrCount(MR.doc) + '.',
      buttons: [
        ['Merge', 'primary', function () { mrUse(mrMergeDocs(MR.doc, doc), MR.name, true); }],
        ['Replace', '', function () { mrBeforeLosing('Replace', function () { mrUse(doc, name, false); }); }],
        ['Cancel', 'quiet', null]
      ],
      note: 'Merge keeps your rules and adds the new ones; a rule with the same id is replaced.'
    });
  }).catch(function (e) { setStatus('MyRules: ' + (e && e.message || e), true); });
}
function mrUse(doc, name, changed) {
  var had = MR && MR.changes || [];
  MR = { doc: doc, name: name, on: true, changes: changed ? had.concat([{ t: Date.now(), text: 'Merged ' + name }]) : [], exported: changed && MR ? MR.exported : 0, lines: MR && MR.lines || {} };
  mrSave();
  mrReapply();
  setStatus('MyRules: loaded ' + mrCount(doc) + (D ? '.' : '. Load your location files to apply them.'));
}
function mrMergeDocs(a, b) {
  var out = JSON.parse(JSON.stringify(a));
  MR_SECTIONS.forEach(function (s) {
    (b[s] || []).forEach(function (r) {
      var L = out[s] || (out[s] = []), k = L.findIndex(function (x) { return x && x.id === r.id; });
      if (k >= 0) L[k] = r; else L.push(r);
    });
  });
  return out;
}
function mrCount(doc) {
  var n = 0;
  MR_SECTIONS.forEach(function (s) { n += (doc[s] || []).length; });
  return n + ' rule' + (n === 1 ? '' : 's');
}

// ---------- dialogs ----------
// One small dialog for the questions MyRules asks: a title, text, a few buttons.
function mrAsk(o) {
  var d = $('mrDlg');
  $('mrDlgTitle').textContent = o.title;
  $('mrDlgText').innerHTML = o.text;
  $('mrDlgExtra').innerHTML = o.extra || '';
  $('mrDlgExtra').oninput = $('mrDlgExtra').onchange = null;
  $('mrDlgNote').textContent = o.note || '';
  var bt = $('mrDlgBtns');
  bt.textContent = '';
  o.buttons.forEach(function (b) {
    var el = document.createElement('button');
    el.type = 'button'; el.className = 'btn' + (b[1] ? ' ' + b[1] : ''); el.innerHTML = b[0];
    el.addEventListener('click', function () { if (b[3] !== 'stay') d.close(); if (b[2]) b[2](el); });
    bt.appendChild(el);
  });
  if (!d.open) d.showModal();
  if (o.after) o.after(d);
}
// Before something that drops the rules here (removing everything, replacing them with another
// file): when there are changes made in the app that weren't exported, offer to download them first.
// what is the action ('Remove' or 'Replace'), go does it after the usual confirmation.
function mrBeforeLosing(what, go) {
  var n = MR && MR.changes.length || 0;
  if (!n) { go(); return; }
  var many = n + ' change' + (n === 1 ? '' : 's');
  mrAsk({
    title: 'Save your MyRules first?',
    text: 'Your MyRules have <b>' + many + '</b> made in the app that are only on this device. ' + (what === 'Remove' ? 'Removing your data deletes them too.' : 'Replacing your rules deletes them.'),
    extra: '<button type="button" class="btn quiet" id="mrSeeChanges" aria-expanded="false">See the ' + many + '</button><ul class="mr-changes" id="mrChangeList" hidden>' +
      MR.changes.slice().reverse().map(function (c) { return '<li>' + esc(c.text) + ' <span class="fine">' + niceDate(Math.floor((c.t - new Date(c.t).getTimezoneOffset() * 60000) / 864e5)) + '</span></li>'; }).join('') + '</ul>',
    buttons: [
      [icon('upload') + 'Download MyRules', 'primary', function () { mrExport(); mrConfirm(what, 0, go); }],
      [what === 'Remove' ? 'Remove without saving' : 'Replace without saving', 'danger', function () { mrConfirm(what, n, go); }],
      ['Cancel', 'quiet', null]
    ],
    note: 'After the download starts you\'ll be asked to confirm.',
    after: function () {
      $('mrSeeChanges').addEventListener('click', function () {
        var l = $('mrChangeList'); l.hidden = !l.hidden; this.setAttribute('aria-expanded', l.hidden ? 'false' : 'true');
        this.textContent = (l.hidden ? 'See the ' : 'Hide the ') + many;
      });
    }
  });
}
function mrConfirm(what, lost, go) {
  // Opened after the first dialog closes.
  setTimeout(function () {
    var r = MR ? mrCount(MR.doc) : '';
    mrAsk({
      title: what === 'Remove' ? 'Remove your data from this device?' : 'Replace your MyRules?',
      text: what === 'Remove' ? 'Your trips, stays' + (MR ? ' and MyRules (' + r + ')' : '') + ' will be deleted from this browser. Your original files are not affected.' : 'Your ' + r + ' will be replaced by the new file.',
      buttons: [[(what === 'Remove' ? 'Remove' : 'Replace') + (lost ? ', and lose ' + lost + ' change' + (lost === 1 ? '' : 's') : ''), 'danger', go], ['Cancel', 'quiet', null]],
      note: lost ? '' : MR && MR.exported ? 'Your exported MyRules file has all of your rules.' : ''
    });
  }, 0);
}

// ---------- Imported data: the MyRules card ----------
function renderMyRules() {
  var el = $('mrCard');
  if (!el) return;
  if (!MR) {
    el.innerHTML = '<p class="fine">Add what only you know, like which bike you rode when or where home was. BT•DT fills in what your files leave out and marks it <span class="guess inf">Inferred</span>. Fix a trip\'s type or title, or hide it, with <b>Edit trip</b> in its details; those changes are marked <span class="guess inf">Edited</span>. Load a <b>.myrules.json</b> file with your location files, or set a ride\'s gear or edit a trip to start.</p>';
    return;
  }
  var nGear = 0, nEd = 0, n = MR.changes.length;
  if (D) for (var i = 0; i < D.day.length; i++) { if (mrInferred(i)) nGear++; if (mrEdited(i)) nEd++; }
  el.innerHTML = '<div class="mr-card"><div class="mr-card-head"><span class="mr-ic">' + icon('flag') + '</span><span class="file-txt"><b>' + esc(MR.name) + '</b><small>' + mrCount(MR.doc) + '</small></span>' +
    '<input type="checkbox" class="switch" id="mrOn" aria-label="Apply MyRules"' + (MR.on ? ' checked' : '') + '></div>' +
    '<p class="fine" style="margin:8px 0">' + (!MR.on ? 'Switched off: everything shows as your files have it.' : D ? 'Gear filled in on ' + tripsText(nGear) + (nEd ? ', ' + tripsText(nEd) + ' edited' : '') + '.' + (MR_AMB ? ' ' + tripsText(MR_AMB) + ' fit two gear periods equally, so got none.' : '') + ' Recorded data is never overwritten.' : 'Applied once you load your location files.') + '</p>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><button type="button" class="btn" id="mrOpen">Open rules</button>' +
    '<button type="button" class="btn mr-export" id="mrExportBtn">' + icon('upload') + 'Export' + (n ? '<i class="mr-dot"></i>' : '') + '</button>' +
    '<span class="fine mr-unsaved">' + (n ? n + ' change' + (n === 1 ? '' : 's') + ' not exported' : !MR.exported && !DEMO ? 'Saved in this browser only. Export to keep a copy.' : '') + '</span></div>' +
    '<p class="fine" style="margin-top:8px">The exported file includes your places, such as home.</p></div>';
  $('mrOn').addEventListener('change', function () { MR.on = this.checked; mrSave(); mrReapply(); });
  $('mrOpen').addEventListener('click', function () { mrRenderRules(); openSheet('mrSheet'); });
  $('mrExportBtn').addEventListener('click', mrExport);
}

// ---------- the rules sheet ----------
function mrWhenText(w) {
  if (!w) return 'Always';
  var f = mrDayNum(w.from), t = mrDayNum(w.to), s;
  s = f != null && t != null ? niceDate(f) + ' – ' + niceDate(t) : f != null ? 'Since ' + niceDate(f) : t != null ? 'Until ' + niceDate(t) : 'Always';
  if (Array.isArray(w.days) && w.days.length && w.days.length < 7) s += ' · ' + w.days.map(function (d) { var k = MR_DOW.indexOf(String(d).slice(0, 3)); return k >= 0 ? DOW[k] : d; }).join(', ');
  if (Array.isArray(w.time)) s += ' · ' + w.time.map(function (x) { var m = mrMin(x); return m == null ? x : fmtMin(m); }).join('–');
  return s;
}
function mrRuleRow(sec, r, title, sub, ic, color, count) {
  var on = r.enabled !== false, ex = Array.isArray(r.except) && r.except.length;
  return '<div class="mr-rule' + (on ? '' : ' off') + '"><span class="mode-badge sm" style="background:' + color + '">' + icon(ic) + '</span><span class="file-txt mr-edit" role="button" tabindex="0" data-mr-edit="' + esc(sec) + ':' + esc(r.id) + '" aria-label="Edit ' + esc(title) + '"><b>' + esc(title) + icon('right', 'mr-chev') + '</b><small>' + sub +
    (ex ? ' · ' + ex + ' exception' + (ex === 1 ? '' : 's') : '') + (r.note ? '<br>' + esc(r.note) : '') + '</small></span>' +
    (count != null ? '<span class="num fine">' + fmt(count) + '</span>' : '') +
    '<input type="checkbox" class="switch" data-mr-on="' + esc(r.id) + '" aria-label="Apply ' + esc(title) + '"' + (on ? ' checked' : '') + '>' +
    '<button type="button" class="icon-btn" data-mr-del="' + esc(sec) + ':' + esc(r.id) + '" aria-label="Delete ' + esc(title) + '">' + icon('close') + '</button></div>';
}
function mrRenderRules() {
  var h = '';
  if (!MR) { $('mrBody').innerHTML = '<p class="fine">No rules yet.</p>'; return; }
  if (!MR.on) h += '<p class="fine mr-warn">MyRules are switched off in Imported data.</p>';
  if (MR_AMB) h += '<p class="fine mr-warn">' + tripsText(MR_AMB) + ' fit two gear periods equally well, so they got no gear. Narrow one of the periods (a shorter period, or a distance limit) to pick one.</p>';
  var gear = mrList('gear'), places = mrList('places'), cor = mrList('corrections'), rout = mrList('routines');
  if (gear.length) h += '<div class="sec"><h3>Gear</h3>' + gear.map(function (r) {
    var m = r.match || {}, bits = [mrWhenText(r.when), LABEL[r.mode] || r.mode];
    if (m.max_km != null) bits.push('under ' + dist(m.max_km));
    if (m.min_km != null) bits.push('over ' + dist(m.min_km));
    if (r.strava_name) bits.push('same as “' + esc(r.strava_name) + '”');
    var ic = r.kind === 'strida' ? 'strida' : r.kind === 'halfbike' ? 'halfbike' : r.kind === 'cargo' ? 'cargobike' : r.kind === 'ebike' ? 'ebike' : r.mode;
    return mrRuleRow('gear', r, r.name || r.id, bits.map(function (b) { return b; }).join(' · '), ic, modeColor(r.mode || 'CYCLING'), MR_COUNT[r.id] || 0);
  }).join('') + '</div>';
  if (places.length) h += '<div class="sec"><h3>Places</h3>' + places.map(function (r) {
    var sub = [r.role ? (MR_LIFE[r.role] ? (mrIsPast(r) ? 'Past ' + r.role : 'Current ' + r.role) : mrKindName(r.role)) : '', r.when ? mrWhenText(r.when) : '', r.hide ? 'Hidden from pins, heatmap and places' : '', (MR_COUNT[r.id] || 0) + ' stays'].filter(Boolean).join(' · ');
    return mrRuleRow('places', r, r.name || mrKindName(r.role) || r.id, sub, mrLook(r).ic, r.hide ? '#9aa49d' : mrLook(r).bg, null);
  }).join('') + '</div>';
  if (cor.length) h += '<div class="sec"><h3>Corrections</h3>' + cor.map(function (c) {
    var t = c.trip || {}, th = c.then || {}, g = th.gear, gr = g && String(g).charAt(0) === '@' ? mrById(g) : null, bits = [];
    var when = t.start ? t.start.slice(0, 16).replace('T', ', ') : t.day || (t.span ? t.span.join(' – ') : '');
    if (th.mode) bits.push('Type: ' + esc(LABEL[th.mode] || th.mode));
    if (th.name) bits.push('Title: “' + esc(th.name) + '”');
    if (g) bits.push('Gear: ' + esc(gr ? gr.name || gr.id : g));
    if (th.hide === true) bits.push('Hidden');
    if (th.hide === false) bits.push('Shown again');
    if (th.replace) bits.push('Replace: not applied in this version of BT•DT');
    var x = MR_COR && MR_COR.filter(function (y) { return y.c === c; })[0], first = x && x.trips.length ? x.trips[0] : null;
    var ic = th.hide ? 'shield' : th.mode || (g ? 'CYCLING' : 'info');
    var applied = th.mode || th.name || g || th.hide != null;
    return mrRuleRow('corrections', c, when || c.id, (bits.join(' · ') || 'Nothing to change') + (first != null ? ' · <button type="button" class="link-btn" data-mr-trip="' + first + '">Open trip</button>' : ''),
      ic, th.mode ? modeColor(th.mode) : g ? modeColor('CYCLING') : '#9aa49d', applied ? MR_COUNT[c.id] || 0 : null);
  }).join('') + '</div>';
  if (rout.length) h += '<div class="sec"><h3>Routines</h3>' + rout.map(function (r) {
    var t = r.then || {}, a = mrEnd(r.from), b = mrEnd(r.to), ln = D && D.mrLine && D.mrLine[r.id], bits = [];
    function end(ref, e) { var pr = typeof ref === 'string' ? mrById(ref) : null; return pr ? pr.name || pr.role || pr.id : e ? (needPlaces(), placeLabel(mrNearestPlace(e.at))) : '?'; }
    bits.push(esc(end(r.from, a)) + (r.both_ways ? ' ⇄ ' : ' → ') + esc(end(r.to, b)));
    bits.push(mrWhenText(r.when));
    if (t.mode) bits.push(esc(LABEL[t.mode] || t.mode) + (r.force ? ', always' : ', where the type was missing or guessed'));
    if (t.gear) { var gr = String(t.gear).charAt(0) === '@' ? mrById(t.gear) : null; bits.push('Gear: ' + esc(gr ? gr.name || gr.id : t.gear)); }
    if (t.snap) bits.push(ln && ln.missing ? 'Line: ' + esc(ln.missing) + ' isn\'t loaded' : ln ? 'Line: ' + (ln.src === 'trip' ? 'learned from the trip on ' + esc(mrWhere(ln.from)) : esc(ln.src)) + (MR_NOFIT[r.id] ? ' · ' + fmt(MR_NOFIT[r.id]) + ' didn\'t fit' : '') : 'Line: no trip clean enough to learn it from yet');
    if (!a || !b) bits.push('Its from or to isn\'t a place with a position');
    return mrRuleRow('routines', r, r.name || r.id, bits.join(' · '), t.mode || 'OTHER', t.mode ? modeColor(t.mode) : '#9aa49d', D ? MR_COUNT[r.id] || 0 : null);
  }).join('') + '</div>';
  if (!h) h = '<p class="fine">No rules yet. Set a ride\'s gear or edit a trip in its trip details to make one.</p>';
  $('mrBody').innerHTML = h;
}
$('mrBody').addEventListener('change', function (ev) {
  var id = ev.target.dataset.mrOn;
  if (!id) return;
  var r = mrById(id);
  if (!r) return;
  if (ev.target.checked) delete r.enabled; else r.enabled = false;
  mrChange((ev.target.checked ? 'Switched on: ' : 'Switched off: ') + (r.name || r.id));
});
$('mrBody').addEventListener('keydown', function (ev) {
  var ed = (ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[data-mr-edit]') && ev.target;
  if (ed) { ev.preventDefault(); mrEditRule(ed.dataset.mrEdit); }
});
$('mrBody').addEventListener('click', function (ev) {
  var o = ev.target.closest('[data-mr-trip]');
  if (o) { openTrip(+o.dataset.mrTrip); return; }
  var ed = ev.target.closest('[data-mr-edit]');
  if (ed) { mrEditRule(ed.dataset.mrEdit); return; }
  var b = ev.target.closest('[data-mr-del]');
  if (!b) return;
  var p = b.dataset.mrDel.split(':'), sec = p[0], id = p.slice(1).join(':'), r = mrById(id);
  mrAsk({
    title: 'Delete this rule?', text: esc(r && (r.name || r.id) || id) + ' will be removed from your MyRules.',
    buttons: [['Delete', 'danger', function () {
      MR.doc[sec] = mrList(sec).filter(function (x) { return x.id !== id; });
      mrChange('Deleted: ' + (r && (r.name || r.id) || id));
    }], ['Cancel', 'quiet', null]]
  });
});
$('mrBack').addEventListener('click', function () { openSheet('importsSheet'); });
$('mrSheetExport').addEventListener('click', mrExport);

// ---------- trip details ----------
// What MyRules did to a trip, each with Undo (a correction) or Not this trip (a gear period); Edit
// trip (type, title, hide) for every trip, and Set gear for rides, runs and walks.
var MR_GEAR_MODES = { CYCLING: 1, RUNNING: 1, WALKING: 1 };
function mrWhere(i) { return niceDate(D.day[i]) + ', ' + clock(D.start[i], D.off[i]); }
function mrTripBlock(i) {
  if (!D || isDup(i)) return '';
  var h = '', g = D.mrGear && D.mrGear[i], amb = D.mrAmb && D.mrAmb[i], md = D.mrMode && D.mrMode[i], nm = D.mrName && D.mrName[i];
  function src(id, field) {
    var r = mrById(id), one = r && r.trip && r.trip.start;
    return '<div class="fine">' + (one ? 'Set for this trip' : r && r.trip ? 'From the correction for ' + esc(r.trip.day || (r.trip.span || []).join(' – ')) : 'From the rule <i>' + esc(r ? r.name || r.id : id) + '</i>' + (r && r.when ? ', ' + esc(mrWhenText(r.when)) : '')) +
      (field ? ' · <button type="button" class="link-btn" data-mr-act="undo" data-f="' + field + '" data-r="' + esc(id) + '" data-t="' + i + '">Undo</button>' : '') + '</div>';
  }
  if (D.mrHide && D.mrHide[i]) {
    var hc = mrCorrections().filter(function (x) { return x.c.then.hide === true && x.trips.indexOf(i) >= 0; }).pop();
    h += '<div class="mr-chg"><b>Hidden</b> from the map, lists and totals' + (hc ? src(hc.c.id, 'hide') : '') + '</div>';
  }
  if (md) h += '<div class="mr-chg"><b>Type:</b> ' + esc(LABEL[MODES[D.mode[i]]] || MODES[D.mode[i]]) + ' <span class="fine">(was ' + esc((LABEL[md.was] || md.was).toLowerCase()) + (md.guessed ? ', guessed' : '') + ')</span>' + src(md.rule, md.inf ? '' : 'mode') + '</div>';
  if (nm) h += '<div class="mr-chg"><b>Title:</b> ' + esc(nm.name) + (recName(i) ? ' <span class="fine">(was “' + esc(recName(i)) + '”)</span>' : '') + src(nm.rule, 'name') + '</div>';
  if (g) h += '<div class="mr-chg"><b>Gear:</b> ' + esc(GEAR[g.gear].name) + src(g.rule, g.cor ? 'gear' : '') + '</div>';
  var rt = D.mrRoute && D.mrRoute[i], rr = rt && mrById(rt.rule), sn = D.snap && D.snap[i], ln = rr && D.mrLine[rr.id];
  if (rr) {
    h += '<div class="mr-chg"><b>Routine:</b> ' + esc(rr.name || rr.id) + ' <span class="fine">(' + (rt.dir > 0 ? 'there' : 'back') + ')</span>';
    if (sn) h += '<div class="fine">Drawn along ' + (ln && ln.src === 'trip' ? 'the line of the trip on ' + esc(mrWhere(ln.from)) : esc(ln ? ln.src : 'its line')) + ': ' + dist(sn.km) + ' (its own GPS points, dashed: ' + dist(D.base.km[i]) + ').</div>';
    else if (ln && ln.from === i) h += '<div class="fine">This trip\'s GPS trail is the line the routine\'s other trips are drawn along.</div>';
    else if (ln && ln.missing) h += '<div class="fine">Its line, ' + esc(ln.missing) + ', isn\'t loaded: load it with your location files.</div>';
    else if (rr.then && rr.then.snap && ln) h += '<div class="fine">Not drawn along the routine\'s line: this trip went another way.</div>';
    h += '</div>';
  }
  if (amb) h += '<div class="mr-chg"><b>Gear:</b> none<div class="fine">' + amb.map(function (id) { var r = mrById(id); return '<i>' + esc(r ? r.name || r.id : id) + '</i>'; }).join(' and ') + ' both fit this trip equally well. Set its gear, or narrow one of them.</div></div>';
  var btns = '<button type="button" class="btn" data-mr-act="edit" data-t="' + i + '">' + icon('info') + 'Edit trip</button>';
  // Not this trip: out of the routine (its type, gear and line), else out of the gear period.
  if (rr || g && !g.cor) btns += '<button type="button" class="btn" data-mr-act="not" data-r="' + esc(rr ? rr.id : g.rule) + '" data-t="' + i + '">Not this trip' + (rr ? '' : '') + '</button>';
  if (rr && rr.then && rr.then.snap && ln && !ln.missing && ln.from !== i && (ln.src === 'trip' || rr.then.snap === 'learn') && mrClean(i)) btns += '<button type="button" class="btn" data-mr-act="line" data-r="' + esc(rr.id) + '" data-t="' + i + '">Use this trip\'s line</button>';
  if (MR_GEAR_MODES[MODES[D.mode[i]]] && !(D.gear[i] && !g)) btns += '<button type="button" class="btn" data-mr-act="gear" data-t="' + i + '">' + icon('gear') + (D.gear[i] ? 'Change gear' : 'Set gear') + '</button>';
  return '<div class="mr-trip">' + (h ? '<h4 class="place-h">From MyRules</h4>' + h : '') + '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">' + btns + '</div></div>';
}
// Drops one action from a correction, and the correction once it has none left.
function mrDropAction(c, field) {
  delete c.then[field];
  if (!Object.keys(c.then).length) MR.doc.corrections = mrList('corrections').filter(function (x) { return x !== c; });
}
var MR_UNDO = { mode: 'Type', name: 'Title', gear: 'Gear', hide: 'Hidden' };
$('tripBody').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-mr-act]');
  if (!b) return;
  var i = +b.dataset.t, act = b.dataset.mrAct;
  if (act === 'line') {
    var lr = mrById(b.dataset.r);
    if (!lr) return;
    lr.then.snap = { trip: { start: mrIsoLocal(i), mode: MODES[D.base.mode[i]] } };
    mrChange('Line for ' + (lr.name || lr.id) + ' taken from the trip on ' + mrWhere(i));
    openTrip(i);
  } else if (act === 'not') {
    var r = mrById(b.dataset.r);
    if (!r) return;
    (r.except || (r.except = [])).push({ start: mrIsoLocal(i), mode: MODES[D.base.mode[i]] });
    mrChange('Not this trip: ' + (r.name || r.id) + ' on ' + mrWhere(i));
    openTrip(i);
  } else if (act === 'undo') {
    var c = mrById(b.dataset.r), f = b.dataset.f;
    if (!c || !c.then) return;
    if (c.trip && c.trip.start) mrDropAction(c, f);
    // A correction on a day or span: this trip is left out of it.
    else (c.except || (c.except = [])).push({ start: mrIsoLocal(i), mode: MODES[D.base.mode[i]] });
    mrChange('Undone: ' + MR_UNDO[f] + ' on ' + mrWhere(i));
    openTrip(i);
  } else if (act === 'gear') mrGearDialog(i);
  else if (act === 'edit') mrEditDialog(i);
});
// The correction for this one trip that Edit trip changes: the last one pointing at it by its start.
function mrTripCorrection(i) {
  return mrCorrections().filter(function (x) { return x.one && x.trips.length === 1 && x.trips[0] === i; }).map(function (x) { return x.c; }).pop() ||
    mrList('corrections').filter(function (c) { return c.trip && c.trip.start && c.enabled !== false && mrRefTrips(c.trip)[0] === i; }).pop() || null;
}
// Edit trip: its type, its title, and hiding it. Saved as a correction on this trip's start, so it
// survives loading the files again.
function mrEditDialog(i) {
  var was = MODES[D.base.mode[i]], cur = MODES[D.mode[i]], hidden = !!D.mrHide[i];
  var modes = MODES.filter(function (m) { return m !== 'UNKNOWN' || cur === 'UNKNOWN'; });
  mrAsk({
    title: 'Edit trip',
    text: esc(tripRoute(i)) + ' · ' + mrWhere(i) + ' · ' + dist(D.km[i]),
    extra: '<div class="mr-form"><label class="field"><span>Type</span><select id="mrEType">' + modes.map(function (m) {
      return '<option value="' + m + '"' + (m === cur ? ' selected' : '') + '>' + esc(LABEL[m] || m) + (m === was ? (D.base.est[i] & GUESSED ? ' (guessed from speed)' : ' (from your files)') : '') + '</option>';
    }).join('') + '</select></label>' +
      '<label class="field"><span>Title</span><input type="text" id="mrEName" value="' + esc(tripName(i)) + '" placeholder="' + esc(recName(i) || 'e.g. Ride to the coast') + '"></label>' +
      '<label class="toggle-row"><span class="lbl" style="display:block">Hide this trip<small class="fine" style="display:block">Left out of the map, lists, totals and exports. Undo it in MyRules.</small></span><input type="checkbox" class="switch" id="mrEHide"' + (hidden ? ' checked' : '') + '></label></div>',
    buttons: [['Save', 'primary', function () { mrSaveEdit(i); }], ['Cancel', 'quiet', null]],
    note: 'Saved in MyRules as a correction on this trip. It replaces what your files say.'
  });
}
function mrSaveEdit(i) {
  var type = $('mrEType').value, name = $('mrEName').value.trim(), hide = $('mrEHide').checked;
  var was = MODES[D.base.mode[i]], rec = recName(i);
  mrEnsure();
  var c = mrTripCorrection(i), isNew = !c, what = [];
  if (isNew) c = { id: mrNewId('trip-' + isoDay(D.day[i])), trip: { start: mrIsoLocal(i), mode: was }, then: {} };
  var t = c.then || (c.then = {});
  var oldMode = t.mode || was, oldName = t.name || rec, oldHide = !!t.hide;
  // A type the files already had and wasn't guessed needs no correction; a guessed one does, to keep it.
  if (type !== was || D.base.est[i] & GUESSED) t.mode = type; else delete t.mode;
  if (name && name !== rec) t.name = name; else delete t.name;
  if (hide) t.hide = true; else delete t.hide;
  if (type !== oldMode) what.push('type ' + (LABEL[type] || type).toLowerCase());
  if ((name || rec) !== oldName) what.push(name && name !== rec ? 'title “' + name + '”' : 'title reset');
  if (hide !== oldHide) what.push(hide ? 'hidden' : 'shown again');
  if (!what.length && !(isNew && Object.keys(t).length)) return;
  if (isNew) { if (!Object.keys(t).length) return; (MR.doc.corrections || (MR.doc.corrections = [])).push(c); }
  else if (!Object.keys(t).length) MR.doc.corrections = mrList('corrections').filter(function (x) { return x !== c; });
  mrChange('Trip on ' + mrWhere(i) + ': ' + (what.join(', ') || 'type confirmed'));
  if (openId === 'mrSheet') return;
  if (hide) { closeSheets(); toast('Trip hidden. Show it again from MyRules in Imported data.'); }
  else { openTrip(i); if (type !== oldMode) setTimeout(function () { mrOfferRoutine(i, type); }, 0); }
}

// Set gear: on this trip only (a correction), or on every trip of its type without gear in a period
// (a gear period), with the dates from the first and last trip on that gear and a live count.
function mrGearDialog(i) {
  var mode = MODES[D.mode[i]], opts = gearOrder().filter(function (g) { return GEAR[g].mode === mode || GEAR[g].modes && GEAR[g].modes[mode]; });
  function span(g) {
    var a = Infinity, b = -Infinity;
    for (var j = 0; j < D.day.length; j++) if (D.gear[j] === g) { a = Math.min(a, D.day[j]); b = Math.max(b, D.day[j]); }
    return isFinite(a) ? [a, b] : [D.day[i], D.day[i]];
  }
  var kinds = mode === 'CYCLING' ? ['bike', 'strida', 'halfbike', 'cargo', 'ebike', 'other'] : ['shoe', 'other'];
  mrAsk({
    title: 'Set gear',
    text: esc(tripRoute(i)) + ' · ' + niceDate(D.day[i]) + ', ' + clock(D.start[i], D.off[i]) + ' · ' + dist(D.km[i]),
    extra: '<div class="mr-form"><label class="field"><span>Gear</span><select id="mrG">' + opts.map(function (g) { return '<option value="' + g + '">' + esc(GEAR[g].name) + '</option>'; }).join('') + '<option value="new">New gear…</option></select></label>' +
      '<div id="mrNew" hidden class="grid2"><label class="field"><span>Name</span><input type="text" id="mrName" placeholder="e.g. Strida EVO"></label><label class="field"><span>Kind</span><select id="mrKind">' + kinds.map(function (k) { return '<option value="' + k + '">' + MR_KINDS[k] + '</option>'; }).join('') + '</select></label></div>' +
      '<label class="mr-opt"><input type="radio" name="mrScope" value="one"><span><b>Just this trip</b><small class="fine">Saved as a correction.</small></span></label>' +
      '<label class="mr-opt"><input type="radio" name="mrScope" value="period" checked><span><b>Every ' + esc((LABEL[mode] || mode).toLowerCase()) + ' trip without gear in a period</b>' +
      '<span class="mr-dates"><input type="date" id="mrFrom" aria-label="From"> to <input type="date" id="mrTo" aria-label="To (empty: until now)"></span>' +
      '<span class="mr-dates">Only trips under <input type="number" id="mrMax" min="0" step="1" style="width:5em" aria-label="Maximum distance"> km (optional)</span>' +
      '<small class="fine" id="mrCountTxt"></small></span></label></div>',
    buttons: [['Save rule', 'primary', function () { mrSaveGear(i); }], ['Cancel', 'quiet', null]],
    note: 'Gear recorded by Strava or another activity file is never replaced by a period.',
    after: function () {
      var sel = $('mrG');
      function prefill() {
        var nw = sel.value === 'new';
        $('mrNew').hidden = !nw;
        var s = nw ? [D.day[i], D.day[i]] : span(+sel.value);
        $('mrFrom').value = isoDay(s[0]); $('mrTo').value = nw ? '' : isoDay(s[1]);
        count();
      }
      function count() {
        var f = mrDayNum($('mrFrom').value), t = mrDayNum($('mrTo').value), mx = parseFloat($('mrMax').value), c = 0;
        for (var j = 0; j < D.day.length; j++) if (D.mode[j] === D.mode[i] && (!D.gear[j] || D.mrGear[j] && !(mrById(D.mrGear[j].rule) || {}).trip) && !isDup(j) && (f == null || D.day[j] >= f) && (t == null || D.day[j] <= t) && !(mx > 0 && D.km[j] > mx)) c++;
        $('mrCountTxt').innerHTML = '<b class="num">' + fmt(c) + '</b> ' + esc((LABEL[mode] || mode).toLowerCase()) + ' ' + (c === 1 ? 'trip' : 'trips') + ' in that period have no recorded gear. They get this one, marked <span class="guess inf">Inferred</span>, unless a narrower rule covers them.';
      }
      sel.addEventListener('change', prefill);
      ['mrFrom', 'mrTo', 'mrMax'].forEach(function (id) { $(id).addEventListener('input', count); });
      prefill();
    }
  });
}
function mrSaveGear(i) {
  var sel = $('mrG').value, mode = MODES[D.mode[i]], one = document.querySelector('input[name="mrScope"]:checked').value === 'one';
  var name = sel === 'new' ? $('mrName').value.trim() : GEAR[+sel].name, kind = sel === 'new' ? $('mrKind').value : GEAR[+sel].kind;
  if (!name) { toast('Give the gear a name'); return; }
  mrEnsure();
  // A gear period of the same name already in MyRules is pointed at; Strava's gear by its name.
  var existing = mrList('gear').filter(function (r) { return (r.name === name || r.strava_name === name) && r.mode === mode; })[0];
  var recorded = sel !== 'new' && !existing && !GEAR[+sel].rule;
  if (one) {
    var c = mrTripCorrection(i), gv = existing ? '@' + existing.id : name;
    if (c) c.then.gear = gv;
    else (MR.doc.corrections || (MR.doc.corrections = [])).push({ id: mrNewId(name + '-' + isoDay(D.day[i])), trip: { start: mrIsoLocal(i), mode: MODES[D.base.mode[i]] }, then: { gear: gv } });
    mrChange('Gear ' + name + ' set on ' + niceDate(D.day[i]) + ', ' + clock(D.start[i], D.off[i]));
  } else {
    var w = {}, f = $('mrFrom').value, t = $('mrTo').value, mx = parseFloat($('mrMax').value);
    if (f) w.from = f;
    if (t) w.to = t;
    var r = { id: mrNewId(name), name: name, kind: kind === 'shoe' || MR_KINDS[kind] ? kind : 'other', mode: mode };
    if (f || t) r.when = w;
    if (mx > 0) r.match = { max_km: mx };
    if (recorded) r.strava_name = name;
    (MR.doc.gear || (MR.doc.gear = [])).push(r);
    mrChange(name + ' period added (' + mrWhenText(r.when) + ')');
  }
  openTrip(i);
}

// ---------- editing a rule from MyRules ----------
// Tap a rule in MyRules to change it in a dialog over the list, which is drawn again when you save,
// so you can go on to the next one. Places and trip fixes use the same dialogs as their pages; gear
// periods and routines have their own here.
function mrEditRule(ref) {
  var k = ref.indexOf(':'), sec = ref.slice(0, k), r = mrById(ref.slice(k + 1));
  if (!r) return;
  if (sec === 'gear') { mrGearRuleDialog(r); return; }
  if (sec === 'routines') { mrRoutineDialog(r); return; }
  if (!D) { toast('Load your Timeline file to edit this'); return; }
  if (sec === 'places') {
    if (!Array.isArray(r.at)) { toast('This place has no position to edit'); return; }
    needPlaces(); mrPlaceDialog('mr:' + r.id); return;
  }
  if (sec === 'corrections') {
    var x = mrCorrections().filter(function (y) { return y.c === r; })[0];
    if (x && x.trips.length) mrEditDialog(x.trips[0]);
    else toast('This trip isn\'t in the data you loaded');
  }
}
function mrDateRow(w) {
  w = w || {};
  return '<div class="field"><span>Period</span><span class="mr-dates"><input type="date" id="mrWFrom" value="' + esc(w.from || '') + '" aria-label="From"> to <input type="date" id="mrWTo" value="' + esc(w.to || '') + '" aria-label="To (empty: until now)"></span></div>';
}
// The period from the dialog's dates, keeping the days and times it had.
function mrDatesInto(r) {
  var w = Object.assign({}, r.when), f = $('mrWFrom').value, t = $('mrWTo').value;
  if (f && t && f > t) { toast('The period ends before it starts'); return false; }
  if (f) w.from = f; else delete w.from;
  if (t) w.to = t; else delete w.to;
  if (Object.keys(w).length) r.when = w; else delete r.when;
  return true;
}
function mrGearRuleDialog(r) {
  var kinds = r.mode === 'CYCLING' || !r.mode ? ['bike', 'strida', 'halfbike', 'cargo', 'ebike', 'other'] : ['shoe', 'other'];
  if (r.kind && kinds.indexOf(r.kind) < 0) kinds.push(r.kind);
  var mx = r.match && r.match.max_km;
  mrAsk({
    title: 'Edit gear period',
    text: 'Every ' + esc((LABEL[r.mode] || r.mode || 'cycling').toLowerCase()) + ' trip without recorded gear in this period gets this gear.',
    extra: '<div class="mr-form"><div class="grid2"><label class="field"><span>Name</span><input type="text" id="mrGName" value="' + esc(r.name || '') + '"></label>' +
      '<label class="field"><span>Kind</span><select id="mrGKind">' + kinds.map(function (k) { return '<option value="' + esc(k) + '"' + (k === r.kind ? ' selected' : '') + '>' + esc(MR_KINDS[k] || k) + '</option>'; }).join('') + '</select></label></div>' +
      mrDateRow(r.when) +
      '<label class="field"><span>Only trips under (km, optional)</span><input type="number" id="mrGMax" min="0" step="1" value="' + (mx != null ? mx : '') + '"></label></div>',
    buttons: [['Save', 'primary', function () {
      var name = $('mrGName').value.trim(), m = parseFloat($('mrGMax').value);
      if (!name) { toast('Give the gear a name'); return; }
      if (!mrDatesInto(r)) return;
      r.name = name; r.kind = $('mrGKind').value;
      var match = Object.assign({}, r.match);
      if (m > 0) match.max_km = m; else delete match.max_km;
      if (Object.keys(match).length) r.match = match; else delete r.match;
      mrChange('Gear period changed: ' + name + ' (' + mrWhenText(r.when) + ')');
    }], ['Cancel', 'quiet', null]]
  });
}
function mrRoutineDialog(r) {
  var t = r.then || {};
  mrAsk({
    title: 'Edit routine',
    text: 'Trips between its two ends in this period get what you set here.',
    extra: '<div class="mr-form"><label class="field"><span>Name</span><input type="text" id="mrRName" value="' + esc(r.name || '') + '" placeholder="e.g. Train to work"></label>' +
      '<label class="field"><span>Type</span><select id="mrRMode"><option value="">Leave the type as it is</option>' + MODES.filter(function (m) { return m !== 'UNKNOWN'; }).map(function (m) {
        return '<option value="' + m + '"' + (m === t.mode ? ' selected' : '') + '>' + esc(LABEL[m] || m) + '</option>';
      }).join('') + '</select></label>' +
      mrDateRow(r.when) +
      '<label class="toggle-row"><span class="lbl">Both ways<small class="fine" style="display:block">Also the trips back.</small></span><input type="checkbox" class="switch" id="mrRBoth"' + (r.both_ways ? ' checked' : '') + '></label>' +
      '<label class="toggle-row"><span class="lbl">Always<small class="fine" style="display:block">Replace the type your files have, not only a missing or guessed one.</small></span><input type="checkbox" class="switch" id="mrRForce"' + (r.force ? ' checked' : '') + '></label>' +
      '<label class="toggle-row"><span class="lbl">Draw them along one line<small class="fine" style="display:block">Trips that went another way keep their own.</small></span><input type="checkbox" class="switch" id="mrRSnap"' + (t.snap ? ' checked' : '') + '></label>' + mrGhostHtml() + '</div>',
    buttons: [['Save', 'primary', function () {
      var d = mrGhostSnap(form(true));
      if (!d) return;
      Object.keys(r).forEach(function (k) { delete r[k]; });
      Object.assign(r, d);
      mrChange('Routine changed: ' + (r.name || r.id));
    }], ['Cancel', 'quiet', null]],
    after: function () { mrGhostStart(function () { return form(false); }); }
  });
  // The routine as the dialog has it: a copy, so the preview never changes the saved one.
  function form(saving) {
    var d = JSON.parse(JSON.stringify(r)), name = $('mrRName').value.trim(), mode = $('mrRMode').value;
    var f = $('mrWFrom').value, to = $('mrWTo').value;
    if (f && to && f > to) { if (saving) toast('The period ends before it starts'); return null; }
    var w = Object.assign({}, d.when);
    if (f) w.from = f; else delete w.from;
    if (to) w.to = to; else delete w.to;
    if (Object.keys(w).length) d.when = w; else delete d.when;
    if (name) d.name = name; else delete d.name;
    d.then = Object.assign({}, d.then);
    if (mode) d.then.mode = mode; else delete d.then.mode;
    if ($('mrRBoth').checked) d.both_ways = true; else delete d.both_ways;
    if ($('mrRForce').checked) d.force = true; else delete d.force;
    if (!$('mrRSnap').checked) delete d.then.snap;
    else if (!d.then.snap) d.then.snap = 'learn';
    return d;
  }
}

// ---------- naming a place from its pin ----------
// A spot page (a regular place's pin) has Name this place: a name, what it is (home, work…), the
// radius that counts as this place (set on its own map with Define radius), and Hide. Saved as a
// place rule in MyRules.
var MR_ROLES = [['', 'A place'], ['home', 'Home'], ['work', 'Work'], ['school', 'School'], ['family', 'Family'], ['friends', 'Friends'], ['sport', 'Sport'],
  ['restaurant', 'Restaurant'], ['cafe', 'Bar / café'], ['supermarket', 'Supermarket'], ['store', 'Store'], ['transit', 'Public transport stop']];
// Each kind of place: its name and icon, for pins, the places list and Time by kind of place.
var MR_KIND = { home: ['Home', 'home'], work: ['Work', 'work'], school: ['School', 'school'], family: ['Family', 'home'], friends: ['Friends', 'friends'], sport: ['Sport', 'basketball'],
  restaurant: ['Restaurant', 'restaurant'], cafe: ['Bar / café', 'cafe'], supermarket: ['Supermarket', 'cart'], store: ['Store', 'store'], transit: ['Public transport', 'BUS'] };
function mrKindName(role) { return MR_KIND[role] ? MR_KIND[role][0] : role ? role.charAt(0).toUpperCase() + role.slice(1) : ''; }
// How a place looks wherever it's shown (pins, lists, its page): the icon of its kind, in the sunrise
// colour when it's your current home, work or school, teal when you named it, grey otherwise.
function mrLook(r, home) {
  var ic = r && MR_KIND[r.role] ? MR_KIND[r.role][1] : home ? 'home' : 'pin';
  return { ic: r && r.hide ? 'shield' : ic, bg: home || mrIsCurrent(r) ? 'var(--accent)' : r ? '#0f7c8c' : 'var(--m-other)' };
}
function spotLook(s) { return mrLook(mrRuleOf(s), s.home); }
function lookBadge(L, sm) { return '<span class="mode-badge' + (sm ? ' sm' : '') + '" style="background:' + L.bg + '">' + icon(L.ic) + '</span>'; }
function mrSpotCentre(key) {
  var vs = spotStays(key), la = 0, lo = 0;
  vs.forEach(function (v) { la += D.vll[2 * v]; lo += D.vll[2 * v + 1]; });
  return vs.length ? [+(la / vs.length).toFixed(6), +(lo / vs.length).toFixed(6)] : null;
}
// The place rule a spot is named by: the one its centre is in, switched on or not.
function mrSpotRule(key) {
  if (String(key).slice(0, 3) === 'mr:') return mrById(key.slice(3));
  var c = mrSpotCentre(key), best = null, bd = Infinity;
  if (!c) return null;
  mrList('places').forEach(function (r) {
    if (!Array.isArray(r.at)) return;
    var d = km(c, r.at) * 1000;
    if (d <= (+r.radius_m || 100) && d < bd) { bd = d; best = r; }
  });
  return best;
}
function mrSpotHtml(key) {
  var r = mrSpotRule(key);
  return '<h4 class="place-h">Name</h4>' + (r ? '<p class="fine">Named <b>' + esc(r.name || r.role) + '</b> in MyRules: everything within ' + fmt(+r.radius_m || 100) + ' m' + (r.role ? ', as ' + (MR_LIFE[r.role] ? (mrIsPast(r) ? 'past ' : 'current ') : '') + esc(mrKindName(r.role).toLowerCase()) + (mrIsPast(r) ? ' until ' + niceDate(mrDayNum(r.when.to)) : '') : '') + (r.hide ? ', hidden from the map' : '') + (r.enabled === false ? ' (switched off)' : '') + '.</p>' : '<p class="fine">Give this place your own name, and choose how far around it counts as this place.</p>') +
    '<div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="btn" data-mr-place="' + esc(key) + '">' + icon('pin') + (r ? 'Edit this place' : 'Name this place') + '</button></div>';
}
function mrPlaceDialog(key) {
  var r = mrSpotRule(key), c = r ? r.at : mrSpotCentre(key), s = spotsOf(spotStays(key))[0] || {};
  if (!c) return;
  var nm = r ? r.name || '' : s.name || '', role = r ? r.role || '' : s.home ? 'home' : '', rad = r ? +r.radius_m || 100 : 100;
  // Past: until the date the rule has, else the last stay there.
  var past = mrIsPast(r), until = r && r.when && r.when.to || isoDay(s.lv != null ? D.vday[s.lv] : todayDay() - 1);
  mrAsk({
    title: r ? 'Edit this place' : 'Name this place',
    text: 'Stays within the radius take this name, in every list and on the map.',
    extra: '<div class="mr-form"><label class="field"><span>Name</span><input type="text" id="mrPName" value="' + esc(nm) + '" placeholder="e.g. Climbing gym"></label>' +
      '<div class="g-name"><button type="button" class="btn quiet" id="mrPOsm">' + icon('search') + 'Get the name from OpenStreetMap</button><div id="mrPGOut" class="g-out" aria-live="polite"></div></div>' +
      '<label class="field"><span>What it is</span><select id="mrPRole">' + MR_ROLES.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === role ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
      '<div id="mrPLife"' + (MR_LIFE[role] ? '' : ' hidden') + '><label class="mr-opt"><input type="radio" name="mrPNow" value="now"' + (past ? '' : ' checked') + '><span><b>Current</b><small class="fine">Its pin gets the sunrise colour.</small></span></label>' +
      '<label class="mr-opt"><input type="radio" name="mrPNow" value="past"' + (past ? ' checked' : '') + '><span><b>Past</b><span class="mr-dates">Until <input type="date" id="mrPTo" value="' + esc(until) + '" aria-label="Until"></span></span></label></div>' +
      '<div class="field"><span>Counts as this place within</span><div class="mr-rad-row"><span><b id="mrPRadTxt"></b> <small class="fine" id="mrPCount"></small></span>' +
      '<button type="button" class="btn" id="mrPRadBtn">' + icon('pin') + 'Define radius</button></div><input type="hidden" id="mrPRad" value="' + rad + '"></div>' +
      '<label class="toggle-row"><span class="lbl">Hide from pins, heatmap and places</span><input type="checkbox" class="switch" id="mrPHide"' + (r && r.hide ? ' checked' : '') + '></label></div>',
    buttons: [['Save', 'primary', function () { mrSavePlace(key, r, c); }]].concat(r ? [['Remove the name', 'danger', function () {
      var vs = spotStays(key);
      placeLast = null;
      MR.doc.places = mrList('places').filter(function (x) { return x !== r; });
      mrChange('Name removed: ' + (r.name || r.id));
      if (openId !== 'mrSheet') mrReopenSpot(vs);
    }]] : []).concat([['Cancel', 'quiet', null]]),
    after: function () {
      function upd() {
        var m = +$('mrPRad').value, n = mrStaysWithin(c, m);
        $('mrPRadTxt').textContent = fmt(m) + ' m';
        $('mrPCount').textContent = '· ' + fmt(n) + ' stay' + (n === 1 ? '' : 's');
      }
      $('mrPRole').addEventListener('change', function () { $('mrPLife').hidden = !MR_LIFE[this.value]; });
      $('mrPTo').addEventListener('input', function () { document.querySelector('input[name="mrPNow"][value="past"]').checked = true; });
      $('mrPOsm').addEventListener('click', function () { osmNameFill(c, +$('mrPRad').value); });
      $('mrPRadBtn').addEventListener('click', function () {
        mrRadiusMap(c, +$('mrPRad').value, $('mrPName').value.trim() || 'This place', function (m) { $('mrPRad').value = m; upd(); });
      });
      upd();
    }
  });
}
// Get the name from OpenStreetMap: on request only, the place's centre goes to OpenStreetMap's
// Nominatim (the name of what's right there) and Overpass (the named places within the radius, up
// to 300 m). The first name fills the Name field and the others nearby are chips to pick instead,
// nearest first. Nothing is saved until Save. No key needed; one tap is two requests, well inside
// both services' usage policies.
var OSM_KINDS = 'amenity|shop|leisure|tourism|office|craft|sport|healthcare|railway|public_transport|aeroway|historic|building|club';
function osmLookup(c, rad) {
  var lang = (navigator.language || 'en').split('-')[0], R = Math.round(Math.max(30, Math.min(rad || 100, 300)));
  var here = fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&namedetails=1&accept-language=' + encodeURIComponent(lang) + '&lat=' + c[0] + '&lon=' + c[1])
    .then(function (r) { if (!r.ok) throw new Error('OpenStreetMap answered ' + r.status); return r.json(); });
  var q = '[out:json][timeout:10];nwr(around:' + R + ',' + c[0] + ',' + c[1] + ')[name][~"^(' + OSM_KINDS + ')$"~"."];out tags center 40;';
  var near = fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  return Promise.all([here.catch(function (e) { return { err: e }; }), near]).then(function (a) {
    var out = [], seen = {}, h = a[0], els = a[1] && a[1].elements || [];
    if (h.err && !els.length) throw h.err;
    function add(t) { t = t && String(t).trim(); if (t && !seen[t.toLowerCase()]) { seen[t.toLowerCase()] = 1; out.push(t); } }
    if (h && !h.err) add(h.namedetails && h.namedetails['name:' + lang] || h.name);
    els.map(function (e) {
      var p = e.center || e, t = e.tags || {};
      return { t: t['name:' + lang] || t.name, d: isFinite(p.lat) ? km(c, [p.lat, p.lon]) : 1 };
    }).sort(function (x, y) { return x.d - y.d; }).forEach(function (x) { add(x.t); });
    return out.slice(0, 8);
  });
}
function osmNameFill(c, rad) {
  var out = $('mrPGOut'), btn = $('mrPOsm');
  btn.disabled = true;
  out.innerHTML = '<p class="fine">Looking it up on OpenStreetMap…</p>';
  osmLookup(c, rad).then(function (names) {
    btn.disabled = false;
    if (!names.length) { out.innerHTML = '<p class="fine">OpenStreetMap has no named place here.</p>'; return; }
    $('mrPName').value = names[0];
    out.innerHTML = (names.length > 1 ? '<p class="fine">Or one of the other places nearby:</p><div class="chips">' +
      names.map(function (t, i) { return '<button type="button" class="chip" data-gname="' + esc(t) + '" aria-pressed="' + (i ? 'false' : 'true') + '">' + esc(t) + '</button>'; }).join('') + '</div>' : '') +
      '<p class="g-attr">Names © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors</p>';
    out.querySelectorAll('[data-gname]').forEach(function (b) {
      b.addEventListener('click', function () {
        $('mrPName').value = b.dataset.gname;
        out.querySelectorAll('[data-gname]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      });
    });
  }).catch(function (e) {
    btn.disabled = false;
    out.innerHTML = '<p class="fine">Couldn\'t get a name from OpenStreetMap: ' + esc(e && e.message || 'no connection') + '. Try again in a moment.</p>';
  });
}
function mrStaysWithin(c, m) {
  var n = 0;
  mrUnits().list.forEach(function (u) { if (km(c, [u.lat, u.lng]) * 1000 <= m) n += u.n; });
  return n;
}
// Define radius: a full-screen map of just the place, its radius and the stays around it, with a
// slider and Save. It opens over the name dialog, which gets the radius back on Save.
var MR_RAD = null;
function mrRadiusMap(c, rad, title, done) {
  var d = $('mrRadDlg');
  if (!window.L) { toast('The map couldn\'t load. Check your internet connection.'); return; }
  $('mrRadTitle').textContent = title;
  $('mrRadIn').value = rad;
  d.showModal();
  if (!MR_RAD) {
    MR_RAD = { map: L.map('mrRadMap', { zoomControl: false, attributionControl: true, preferCanvas: true }) };
    L.control.zoom({ position: 'topright' }).addTo(MR_RAD.map);
  }
  var m = MR_RAD.map;
  // A view first: layers can't be drawn on a map without one.
  m.setView(c, 16, { animate: false });
  addTiles(m);
  if (MR_RAD.layer) MR_RAD.layer.remove();
  MR_RAD.layer = L.layerGroup().addTo(m);
  // The places in your original data within 1.5 km (see mrUnits), before any grouping: a dot each,
  // bigger with more visits, teal inside the radius and grey outside.
  var dots = [];
  mrUnits().list.forEach(function (u) {
    var p = [u.lat, u.lng], dk = km(c, p) * 1000;
    if (dk > 1500) return;
    var mk = L.circleMarker(p, { radius: Math.min(11, 4 + 2.2 * Math.log10(u.n)), weight: 1.5 }).addTo(MR_RAD.layer);
    mk.bindTooltip(esc(u.name || 'A place without a name') + ' · ' + fmt(u.n) + ' visit' + (u.n === 1 ? '' : 's'));
    dots.push({ p: p, d: dk, n: u.n, m: mk });
  });
  var circle = L.circle(c, { radius: rad, color: '#0f7c8c', weight: 3, fillOpacity: .14, interactive: false }).addTo(MR_RAD.layer);
  L.circleMarker(c, { radius: 6, color: '#fff', weight: 2, fillColor: '#0f7c8c', fillOpacity: 1, interactive: false }).addTo(MR_RAD.layer);
  function paint() {
    var r = +$('mrRadIn').value, n = 0;
    circle.setRadius(r);
    var np = 0;
    dots.forEach(function (x) { var inside = x.d <= r; if (inside) { n += x.n; np++; } x.m.setStyle({ color: inside ? '#0b6672' : '#8a918c', fillColor: inside ? '#0f7c8c' : '#b9bfbb', fillOpacity: inside ? .9 : .6 }); });
    $('mrRadTxt').textContent = fmt(r) + ' m';
    $('mrRadCount').textContent = fmt(np) + ' place' + (np === 1 ? '' : 's') + ' from your data inside · ' + fmt(n) + ' stay' + (n === 1 ? '' : 's');
  }
  function fit() { m.fitBounds(circle.getBounds(), { padding: [30, 30], maxZoom: 18 }); }
  setTimeout(function () { m.invalidateSize(); fit(); }, 0);
  paint();
  $('mrRadIn').oninput = paint;
  $('mrRadIn').onchange = fit;
  $('mrRadSave').onclick = function () { d.close(); done(+$('mrRadIn').value); };
  $('mrRadCancel').onclick = function () { d.close(); };
}
function mrSavePlace(key, r, c) {
  var name = $('mrPName').value.trim(), role = $('mrPRole').value, rad = +$('mrPRad').value, hide = $('mrPHide').checked;
  if (!name && !role) { toast('Give the place a name'); return; }
  mrEnsure();
  var isNew = !r;
  if (isNew) { r = { id: mrNewId(name || role), at: c }; (MR.doc.places || (MR.doc.places = [])).push(r); }
  if (name) r.name = name; else delete r.name;
  if (role) r.role = role; else delete r.role;
  r.radius_m = rad;
  if (hide) r.hide = true; else delete r.hide;
  // Current or past, for home, work and school: past ends on its until date.
  var wasPast = mrIsPast(r), past = !!MR_LIFE[role] && document.querySelector('input[name="mrPNow"]:checked').value === 'past';
  if (past) { var to = $('mrPTo').value || isoDay(todayDay() - 1); if (mrDayNum(to) >= todayDay()) to = isoDay(todayDay() - 1); r.when = Object.assign({}, r.when, { to: to }); }
  else if (MR_LIFE[role] && r.when) { delete r.when.to; if (!Object.keys(r.when).length) delete r.when; }
  var vs = spotStays(key);
  // The spot's key changes (see buildSpotKeys): its page is opened again below, not refreshed.
  placeLast = null;
  mrChange((isNew ? 'Place named: ' : 'Place changed: ') + (name || role) + ' (' + rad + ' m' + (MR_LIFE[role] ? ', ' + (past ? 'past, until ' + niceDate(mrDayNum(r.when.to)) : 'current') : '') + ')');
  // Edited from MyRules: you stay there (mrChange draws the list again).
  if (openId !== 'mrSheet') mrReopenSpot(vs);
}
// Naming a place merges the spots within its radius into one (and removing the name splits them
// again), so its page opens again on the spot where most of its stays are now.
function mrReopenSpot(vs) {
  var n = {}, best = null;
  vs.forEach(function (v) { var k = spotKey(v); n[k] = (n[k] || 0) + 1; if (!best || n[k] > n[best]) best = k; });
  if (best) openSpot(best); else closeSheets();
}
$('tripBody').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-mr-place]');
  if (b) mrPlaceDialog(b.dataset.mrPlace);
});

// ---------- making a routine from a fixed trip ----------
// After you change a trip's type, when you made 5 or more trips like it (the same ends within
// 500 m, on the same kind of day, starting within 2 hours of it), BT•DT offers to make a routine of
// it: the type for all of them, both ways when you made the trip back too, and optionally their line.
var MR_RAIL = { TRAIN: 1, TRAM: 1, SUBWAY: 1, FERRY: 1, BUS: 1, CABLE: 1 };
// Minutes after midnight in the chosen clock format, for text (mrHm is for time inputs).
function fmtMin(m) { m = ((Math.round(m) % 1440) + 1440) % 1440; return fmtHM(Math.floor(m / 60), m % 60); }
function mrHm(m) { m = ((Math.round(m) % 1440) + 1440) % 1440; return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }
function mrLike(i) {
  var a = { at: [D.from[2 * i], D.from[2 * i + 1]], rad: 0.5 }, b = { at: [D.to[2 * i], D.to[2 * i + 1]], rad: 0.5 };
  if (!isFinite(a.at[0]) || !isFinite(b.at[0]) || km(a.at, b.at) < 1) return null;
  var wk = D.dow[i] > 0 && D.dow[i] < 6, m0 = mrLocalMin(i), there = [], back = [];
  for (var j = 0; j < D.day.length; j++) {
    if (isDup(j) || D.mrHide[j] || (D.dow[j] > 0 && D.dow[j] < 6) !== wk || MODES[D.mode[j]] === 'FLYING') continue;
    var dm = Math.abs(mrLocalMin(j) - m0);
    if (mrNearEnd(a, j, false) && mrNearEnd(b, j, true) && Math.min(dm, 1440 - dm) <= 120) there.push(j);
    else if (mrNearEnd(b, j, false) && mrNearEnd(a, j, true)) back.push(j);
  }
  return { a: a, b: b, wk: wk, there: there, back: back };
}
function mrOfferRoutine(i, mode) {
  var x = mrLike(i);
  if (!x || x.there.length < 6) return;
  needPlaces();
  var A = placeLabel(D.pa[i]), B = placeLabel(D.pb[i]), lab = LABEL[mode] || mode;
  var days = x.there.map(function (j) { return D.day[j]; }).concat(x.back.map(function (j) { return D.day[j]; }));
  var d0 = Math.min.apply(null, days), d1 = Math.max.apply(null, days), m0 = mrLocalMin(i);
  var bm = x.back.map(mrLocalMin).sort(function (p, q) { return p - q; }), mb = bm.length ? bm[bm.length >> 1] : null;
  var modes = {};
  x.there.concat(x.back).forEach(function (j) { var m = LABEL[MODES[D.mode[j]]] || MODES[D.mode[j]]; modes[m] = (modes[m] || 0) + 1; });
  mrAsk({
    title: 'Same on other days?',
    text: 'You made <b>' + fmt(x.there.length) + '</b> trips like this from ' + esc(A) + ' to ' + esc(B) + (x.wk ? ' on weekdays' : ' at weekends') + ' around ' + fmtMin(m0) +
      (x.back.length ? ', and ' + fmt(x.back.length) + ' back' : '') + '. Your files have them as ' + Object.keys(modes).map(function (m) { return esc(m.toLowerCase()) + ' (' + fmt(modes[m]) + ')'; }).join(', ') + '.',
    extra: '<div class="mr-form">' + mrGhostHtml() +
      '<span class="mr-dates">From <input type="date" id="mrRFrom" value="' + isoDay(d0) + '" aria-label="From"> to <input type="date" id="mrRTo" value="' + isoDay(d1) + '" aria-label="To (empty: until now)"></span>' +
      '<span class="mr-dates">Leaving between <input type="time" id="mrRT0" value="' + mrHm(m0 - 90) + '" aria-label="Earliest start"> and <input type="time" id="mrRT1" value="' + mrHm(m0 + 90) + '" aria-label="Latest start"></span>' +
      (x.back.length ? '<label class="mr-opt"><input type="checkbox" id="mrRBoth"' + (x.back.length >= 3 ? ' checked' : '') + '><span><b>Both ways</b><span class="mr-dates">Back between <input type="time" id="mrRB0" value="' + (mb != null ? mrHm(mb - 120) : '15:00') + '" aria-label="Earliest return"> and <input type="time" id="mrRB1" value="' + (mb != null ? mrHm(mb + 120) : '20:00') + '" aria-label="Latest return"></span></span></label>' : '') +
      '<label class="mr-opt"><input type="checkbox" id="mrRForce"><span><b>Also where your files recorded another type</b><small class="fine">Off: only trips whose type was missing or guessed from speed.</small></span></label>' +
      '<label class="mr-opt"><input type="checkbox" id="mrRSnap"' + (MR_RAIL[mode] ? ' checked' : '') + '><span><b>Draw them along one line</b><small class="fine">Learned from the cleanest of these trips; trips that went another way keep their own.</small></span></label></div>',
    buttons: [['Make a routine', 'primary', function () { mrSaveRoutine(i, mode, x, A, B); }], ['Not now', 'quiet', null]],
    after: function () { mrGhostStart(function () { return mrOfferDraft(i, mode, x, A, B); }); },
    note: 'Saved in MyRules. What it fills in is marked Inferred, and you can leave out any trip.'
  });
}
// ---------- a routine's trips as ghosts ----------
// While you make or edit a routine, a small map in the dialog shows the trips it would cover as
// ghost lines (faint, so the more often you took a way the stronger it shows), drawn again as you
// change its period, times or options, with how many there are and how many would change type.
// With Draw them along one line, the line it uses is drawn on top, solid. A learned line comes from
// the cleanest trip (the recommended one); the arrows under the map go through the other clean
// trips, best first, and the one you stop on is saved as the routine's { trip } (back on the
// recommended one, it stays "learn", so it follows your data).
var MR_GHOST = null;
function mrRoutineTrips(r) {
  var out = { trips: [], change: 0, dir: {} };
  var a = mrEnd(r.from), b = mrEnd(r.to);
  if (!D || !a || !b) return out;
  var w = mrWhen(r.when), x = { r: r, a: a, b: b, w: w, rw: r.return_when ? mrWhen(Object.assign({}, r.when, r.return_when)) : w, ex: mrExcept(r) };
  var m = r.then && r.then.mode, mi = m != null ? MODE_IDX[m] : null, base = D.base || D;
  for (var i = 0; i < D.day.length; i++) {
    if (isDup(i) || MODES[base.mode[i]] === 'FLYING') continue;
    var dr = mrRouteDir(x, i);
    if (!dr) continue;
    out.trips.push(i); out.dir[i] = dr;
    if (mi != null && mi !== base.mode[i] && (r.force || base.est[i] & GUESSED || MODES[base.mode[i]] === 'UNKNOWN')) out.change++;
  }
  return out;
}
// The different ways a routine's trips take: trips whose lines lie within 150 m of each other for
// 85% of their length (both ways round) are one way. Each way is named by its best trip (cleanest,
// else the one with most points); the ways come most-taken first, so the first is the recommended
// one. Kept for the last set of trips, as the dialog redraws often.
var MR_WAYS = { key: '', ways: [] };
function mrWays(trips) {
  var key = trips.join(',');
  if (MR_WAYS.key === key) return MR_WAYS.ways;
  function samp(P, n) { if (P.length <= n) return P; var o = []; for (var k = 0; k < n; k++) o.push(P[Math.round(k * (P.length - 1) / (n - 1))]); return o; }
  function near(A, B) { var c = 0; A.forEach(function (p) { if (mrToLine(p, B).d <= 0.15) c++; }); return c / A.length; }
  var ws = [];
  trips.map(function (i) { return { i: i, c: mrClean(i), n: D.pathOff[i + 1] - D.pathOff[i] }; }).filter(function (t) { return t.n >= 5; })
    .sort(function (a, b) { return b.c - a.c || b.n - a.n; }).forEach(function (t) {
      var P = mrTripPts(t.i), s = samp(P, 30), L = samp(P, 60);
      var w = ws.filter(function (w) { return near(s, w.L) >= 0.85 && near(w.s, L) >= 0.85; })[0];
      if (w) w.all.push(t.i); else ws.push({ i: t.i, s: s, L: L, all: [t.i] });
    });
  // Most-taken first; a way only one stray trip took comes last.
  ws.sort(function (a, b) { return b.all.length - a.all.length; });
  MR_WAYS = { key: key, ways: ws };
  return ws;
}
function mrGhostHtml() {
  return '<div class="mr-ghost"><div class="mr-ghost-map" id="mrGhostMap"></div>' +
    '<div class="mr-pick" id="mrPick" hidden><button type="button" class="icon-btn" id="mrPickPrev" aria-label="Previous way">' + icon('left') + '</button>' +
    '<span class="mr-pick-t" id="mrPickTxt" aria-live="polite"></span><button type="button" class="icon-btn" id="mrPickNext" aria-label="Next way">' + icon('right') + '</button></div>' +
    '<button type="button" class="btn quiet mr-pick-rec" id="mrPickRec" hidden>Back to the recommended line</button>' +
    '<small class="fine" id="mrGhostTxt"></small></div>';
}
// A learned line (not one from a polyline or a GeoJSON file)?
function mrLearned(sn) { return !!sn && !(typeof sn === 'object' && (sn.polyline || sn.geojson)); }
// The trip you chose with the arrows, written into the routine the dialog makes.
function mrGhostSnap(d) {
  if (!d || !MR_GHOST || MR_GHOST.pick === undefined || !d.then || !mrLearned(d.then.snap)) return d;
  var i = MR_GHOST.pick;
  d.then.snap = i == null ? 'learn' : { trip: { start: mrIsoLocal(i), mode: MODES[(D.base || D).mode[i]] } };
  return d;
}
// draft() builds the routine from the dialog as it is now.
function mrGhostStart(draft) {
  var el = $('mrGhostMap');
  if (MR_GHOST && MR_GHOST.map) MR_GHOST.map.remove();
  MR_GHOST = { map: null, first: true, pick: undefined, cands: [] };
  if (!el) return;
  if (!window.L || !D) el.hidden = true;
  else {
    MR_GHOST.map = L.map(el, { zoomControl: false, attributionControl: true, preferCanvas: true });
    MR_GHOST.map.setView([0, 0], 2, { animate: false });
    addTiles(MR_GHOST.map);
    MR_GHOST.layer = L.layerGroup().addTo(MR_GHOST.map);
  }
  function colour(r) {
    var col = r.then && r.then.mode ? modeColor(r.then.mode) : '#7a8580';
    // The canvas needs a real colour, not a CSS variable.
    var vm = /^var\((--[\w-]+)\)$/.exec(col);
    return vm ? cssVar(vm[1]) || '#7a8580' : col;
  }
  function draw() {
    var r = mrGhostSnap(draft());
    if (!r) return;
    var res = mrRoutineTrips(r), col = colour(r), sn = r.then && r.then.snap, line = null, from = null, W = null;
    // The line it would draw its trips along, and the trips it could learn it from.
    MR_GHOST.cands = [];
    if (sn && !mrLearned(sn)) line = mrRouteLine({ then: r.then }, res.trips);
    else if (sn) {
      var W = mrWays(res.trips);
      MR_GHOST.cands = W.map(function (w) { return w.i; });
      from = typeof sn === 'object' && sn.trip ? mrRefTrips(sn.trip)[0] : MR_GHOST.cands[0];
      if (from != null) line = { pts: mrTripPts(from), from: from };
    }
    var pk = $('mrPick'), k = -1;
    if (W && from != null) W.forEach(function (w, j) { if (w.all.indexOf(from) >= 0) k = j; });
    MR_GHOST.k = k;
    pk.hidden = !mrLearned(sn);
    if (!pk.hidden) {
      var nw = W ? W.length : 0, ways = W && W[k] ? W[k].all.length : 0, rec = from != null && from === MR_GHOST.cands[0];
      $('mrPickTxt').innerHTML = from == null ? 'No trip clean enough to learn the line from' :
        (nw > 1 && k >= 0 ? '<b>Way ' + fmt(k + 1) + ' of ' + fmt(nw) + '</b> · ' + fmt(ways) + ' trip' + (ways === 1 ? '' : 's') + (k === 0 ? ' · recommended' : '') : rec ? '<b>Recommended line</b>' : '<b>Your chosen line</b>') +
        '<small class="fine">' + (nw === 1 && k === 0 ? 'Your ' + fmt(ways) + ' trips here all take this way. ' : k < 0 ? 'Its trip isn\'t in this period. ' : '') + 'From the trip on ' + esc(mrWhere(from)) + '</small>';
      $('mrPickPrev').disabled = $('mrPickNext').disabled = nw < 2 && k >= 0;
      $('mrPickRec').hidden = rec || from == null || !MR_GHOST.cands.length;
    }
    $('mrGhostTxt').innerHTML = res.trips.length ? '<b class="num">' + fmt(res.trips.length) + '</b> ' + (res.trips.length === 1 ? 'trip' : 'trips') + ' covered, shown as ghosts' +
      (r.then && r.then.mode ? ' · ' + fmt(res.change) + ' would become ' + esc((LABEL[r.then.mode] || r.then.mode).toLowerCase()) : '') : 'No trips covered with these settings.';
    if (!MR_GHOST.map) return;
    MR_GHOST.layer.clearLayers();
    var bounds = L.latLngBounds([]);
    // At most 400 ghosts: enough to see the pattern, light enough to redraw while typing.
    res.trips.slice(-400).forEach(function (i) {
      if (line && i === line.from) return;
      var pts = mrTripPts(i);
      if (pts.length < 2) pts = [[D.from[2 * i], D.from[2 * i + 1]], [D.to[2 * i], D.to[2 * i + 1]]];
      pts = pts.filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); });
      if (pts.length < 2) return;
      L.polyline(pts, { color: col, weight: 3, opacity: .22, interactive: false }).addTo(MR_GHOST.layer);
      bounds.extend(pts[0]); bounds.extend(pts[pts.length - 1]);
    });
    // The line in use, always on top: solid, with a white edge so it stands out of the ghosts.
    if (line && line.pts && line.pts.length > 1) {
      L.polyline(line.pts, { color: '#fff', weight: 8, opacity: .95, interactive: false }).addTo(MR_GHOST.layer);
      L.polyline(line.pts, { color: col, weight: 4.5, opacity: 1, interactive: false }).addTo(MR_GHOST.layer);
      line.pts.forEach(function (p) { bounds.extend(p); });
    }
    [mrEnd(r.from), mrEnd(r.to)].forEach(function (e) {
      if (!e) return;
      L.circleMarker(e.at, { radius: 6, color: '#fff', weight: 2, fillColor: '#0f7c8c', fillOpacity: 1, interactive: false }).addTo(MR_GHOST.layer);
      bounds.extend(e.at);
    });
    // Framed once, on the ends and the trips; later changes keep your view.
    if (MR_GHOST.first && bounds.isValid()) { MR_GHOST.first = false; MR_GHOST.map.invalidateSize(); MR_GHOST.map.fitBounds(bounds, { padding: [20, 20], maxZoom: 15, animate: false }); }
  }
  // The arrows: the next or previous clean trip, round and round.
  // The arrows: the next or previous way, round and round. Recommended: back to the best trip of the
  // way most trips take, worked out again from your data each time (saved as "learn").
  function step(by) {
    var c = MR_GHOST.cands, n = c.length, k = MR_GHOST.k;
    if (!n) return;
    var j = k < 0 ? 0 : (k + by + n) % n;
    MR_GHOST.pick = j === 0 ? null : c[j];
    draw();
  }
  $('mrPickPrev').onclick = function () { step(-1); };
  $('mrPickNext').onclick = function () { step(1); };
  $('mrPickRec').onclick = function () { MR_GHOST.pick = null; draw(); };
  var box = $('mrDlgExtra'), tm = null;
  function later() { clearTimeout(tm); tm = setTimeout(draw, 150); }
  box.oninput = later; box.onchange = later;
  setTimeout(function () { if (MR_GHOST.map) MR_GHOST.map.invalidateSize(); draw(); }, 0);
}
function mrEndRef(e) { var r = mrPlaceAt(e.at[0], e.at[1]); return r ? '@' + r.id : [+e.at[0].toFixed(5), +e.at[1].toFixed(5)]; }
// The routine the Same on other days? dialog would make, as it is filled in now.
function mrOfferDraft(i, mode, x, A, B) {
  var lab = LABEL[mode] || mode, w = {}, f = $('mrRFrom').value, t = $('mrRTo').value;
  if (f) w.from = f;
  if (t) w.to = t;
  if (x.wk) w.days = ['mon', 'tue', 'wed', 'thu', 'fri']; else w.days = ['sat', 'sun'];
  if ($('mrRT0').value && $('mrRT1').value) w.time = [$('mrRT0').value, $('mrRT1').value];
  var r = { id: mrNewId(lab + ' ' + A + ' ' + B), name: lab + ' ' + A + ' – ' + B, from: mrEndRef(x.a), to: mrEndRef(x.b), when: w, then: { mode: mode } };
  if ($('mrRBoth') && $('mrRBoth').checked) { r.both_ways = true; if ($('mrRB0').value && $('mrRB1').value) r.return_when = { time: [$('mrRB0').value, $('mrRB1').value] }; }
  if ($('mrRForce').checked) r.force = true;
  if ($('mrRSnap').checked) r.then.snap = 'learn';
  return r;
}
function mrSaveRoutine(i, mode, x, A, B) {
  var r = mrGhostSnap(mrOfferDraft(i, mode, x, A, B));
  mrEnsure();
  (MR.doc.routines || (MR.doc.routines = [])).push(r);
  mrChange('Routine added: ' + r.name);
  openTrip(i);
  toast(r.name + ': ' + tripsText(MR_COUNT[r.id] || 0) + ' match.');
}

