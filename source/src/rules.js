// ---------- MyRules ----------
// A MyRules file (*.myrules.json) holds what only you know: which bike you rode when, where home was.
// It is applied on top of the location files. Values a rule fills in are marked Rule applied (Map snap for a map snap's line); values a
// correction sets on a trip (its type, title, gear, or hiding it) are marked Edited.
// The format is in docs/myrules.md; this version applies gear periods, places, routines (type, gear
// and lines) and corrections.
// Corrections that replace trips are kept in the file (and exported again) but not applied yet.
// MR is null until a file is loaded or a rule is made in the app. It is saved in this browser's
// IndexedDB next to the trips, never uploaded. changes lists what was changed in the app since the
// file was last loaded or exported, so nothing is lost by removing it from the device.
var MR = null;
var MR_SECTIONS = ['places', 'gear', 'routines', 'snaps', 'corrections'];
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
  // unless: conditions written by Turn off for these trips. A trip matching any of them is left alone.
  var U = mrUnless(r);
  if (U.length) for (var i = 0; i < D.day.length; i++) if (!s[i] && U.some(function (u) { return mrUnlessOk(u, i); })) s[i] = 1;
  return s;
}
// A rule's unless list, ready to test trips against: each entry is a when (dates, days, time), plus
// countries (ISO codes; a trip counts when it starts or ends in one, as in Filters), months (1–12)
// and years. A trip matches an entry when it fits every part the entry has.
function mrUnless(r) {
  return (Array.isArray(r.unless) ? r.unless : []).filter(function (u) { return u && typeof u === 'object'; }).map(function (u) {
    function set(a, f) { if (!Array.isArray(a) || !a.length) return null; var o = {}; a.forEach(function (v) { o[f(v)] = 1; }); return o; }
    return { w: mrWhen(u), cc: set(u.countries, function (c) { return String(c).toUpperCase(); }), mo: set(u.months, Number), yr: set(u.years, Number) };
  });
}
function mrUnlessOk(u, i) {
  if (!mrWhenOk(u.w, i)) return false;
  if (u.mo && !u.mo[D.month[i] + 1]) return false;
  if (u.yr && !u.yr[D.year[i]]) return false;
  if (u.cc && !u.cc[String(D.ccList[D.cs[i]] || '').toUpperCase()] && !u.cc[String(D.ccList[D.ce[i]] || '').toUpperCase()]) return false;
  return true;
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
// Rule applied (inferred): gear a gear period filled in, a type or line a routine or map snap set. Edited: anything a correction set.
function mrInferred(i) { return !!(D.mrGear && D.mrGear[i] && !D.mrGear[i].cor || D.mrMode && D.mrMode[i] && D.mrMode[i].inf || D.snap && D.snap[i] && !D.snap[i].track); }
function mrEdited(i) { return !!(D.mrMode && (D.mrMode[i] && !D.mrMode[i].inf || D.mrName[i] || D.mrHide[i] || D.mrGear[i] && D.mrGear[i].cor)); }
// A trip a map snap took says so; anything else a rule filled in is "Rule applied".
function mrSnapped(i) { return !!(D.mrSnap && D.mrSnap[i] && D.snap && D.snap[i]); }
function mrTracked(i) { return !!(D.mrTrack && D.mrTrack[i] && D.snap && D.snap[i]); }
function mrRuleOther(i) { var sn = mrSnapped(i); return !!(D.mrGear && D.mrGear[i] && !D.mrGear[i].cor || !sn && (D.mrMode && D.mrMode[i] && D.mrMode[i].inf || D.snap && D.snap[i] && !D.snap[i].track)); }
function mrTag(i) { return !D ? '' : (mrEdited(i) ? '<span class="guess inf">Edited</span>' : '') + (mrSnapped(i) ? '<span class="guess inf">Map snap</span>' : '') + (mrTracked(i) ? '<span class="guess inf" title="Drawn along the railway of your station packs">On the tracks</span>' : '') + (mrRuleOther(i) ? '<span class="guess inf">Rule applied</span>' : '') + (mrCheck(i) ? '<span class="guess">Check</span>' : ''); }
function mrCheck(i) { return !!(D.chk && D.chk[i] >= 0); }

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
  D.mrMode = []; D.mrName = []; D.mrHide = new Uint8Array(n); D.mrRoute = []; D.mrMiss = []; D.snap = []; D.mrLine = {}; D.mrOk = new Uint8Array(n);
  MR_COUNT = {}; MR_COR = null; MR_LEFT = {};
  if (!MR || !MR.on) { mrApplyTracks(); mrLearn(); return; }
  // Routines first, so a correction on the same trip wins over them.
  mrApplyRoutines();
  mrApplySnaps();
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
      if (t.checked === true && mi == null) { D.mrOk[i] = 1; hit = 1; }
      if (typeof t.name === 'string' && t.name.trim()) { D.mrName[i] = { rule: x.c.id, name: t.name.trim() }; hit = 1; }
      if (t.hide === true) { D.mrHide[i] = 1; hit = 1; }
      else if (t.hide === false && D.mrHide[i]) { D.mrHide[i] = 0; hit = 1; }
    });
    if (hit) MR_COUNT[x.c.id] = x.trips.length;
  });
  // A trip a correction made a flight isn't drawn along a routine's line.
  D.snap.forEach(function (s, i) { if (s && MODES[D.mode[i]] === 'FLYING') { D.snap[i] = null; D.km[i] = b.km[i]; } });
  // Train trips nothing above drew, along the tracks of the packs (when that's on).
  mrApplyTracks();
  mrLearn();
}

// ---------- learning from your fixes, and trips to check ----------
// After MyRules, guessed trips vote again on your other trips between the same two places at a
// like speed (TripIndex), now with your own fixes in: a type you set or checked counts VOTE_FIX
// times as much as one from your files, a recorded activity or a routine's twice. A guess that
// changes is kept in D.learn. D.conf is how sure each guess is, and D.chk the type suggested for
// trips worth a look (-1 for none):
// - guesses under CHECK_CONF;
// - a type from your files that DOUBT_MIN or more of your like trips between the same places
//   (DOUBT_SHARE of them) disagree with, while hardly any (DOUBT_OWN) share it (a type you use
//   now and then on that way, like the tram in winter, is left alone), among cycling and motorised types (walks are left out:
//   Google's short walks and slow rides overlap too much to tell);
// - a ride from your files averaging over 32 km/h (VOTE_KMH.CYCLING), which a car or train it is.
// Trips you fixed or checked, recorded activities and flights are never offered.
var VOTE_FIX = 3, DOUBT_MIN = 5, DOUBT_SHARE = 0.8, DOUBT_OWN = 0.1;
var DOUBT_GROUPS = { CYCLING: 1, CAR: 1, BUS: 1, TRAM: 1, TRAIN: 1, SUBWAY: 1 };
function mrLearn() {
  var n = D.day.length, i, fly = MODE_IDX.FLYING;
  D.chk = new Int8Array(n).fill(-1); D.chkWhy = []; D.learn = []; D.conf = new Uint8Array(n);
  function fixed(j) { return D.mrMode[j] && !D.mrMode[j].inf || D.mrOk[j]; }
  var idx = new TripIndex(D, function (j) {
    if (isDup(j) || D.mrHide[j] || D.est[j] & GUESSED || D.mode[j] === fly) return 0;
    if (fixed(j)) return VOTE_FIX;
    return D.est[j] & STRAVA || D.mrMode[j] ? 2 : 1;
  });
  for (i = 0; i < n; i++) {
    if (isDup(i) || D.mrHide[i] || D.mode[i] === fly || fixed(i)) continue;
    var m = MODES[D.mode[i]], avg = tripAvg(D, i), v;
    if (D.est[i] & GUESSED) {
      if (D.est[i] & STRAVA) continue;
      var conf = D.gconf ? D.gconf[i] : 0;
      v = idx.decide(i, avg);
      if (v && VOTE_GROUP[v.mode] !== VOTE_GROUP[m]) { D.learn[i] = { was: m, n: v.trips }; D.mode[i] = MODE_IDX[v.mode]; m = v.mode; conf = v.conf; }
      else if (v) conf = Math.max(conf, v.conf);
      D.conf[i] = conf;
      if (conf && conf < CHECK_CONF) { D.chk[i] = MODE_IDX[mrAltMode(i, m, avg, v || idx.votes(i, avg))]; D.chkWhy[i] = { kind: 'guess' }; }
      continue;
    }
    if (D.est[i] & STRAVA || !DOUBT_GROUPS[VOTE_GROUP[m]]) continue;
    if (VOTE_GROUP[m] === 'CYCLING' && avg > VOTE_KMH.CYCLING[1]) { D.chk[i] = MODE_IDX[avg > 90 ? 'TRAIN' : 'CAR']; D.chkWhy[i] = { kind: 'speed', avg: avg }; continue; }
    v = idx.votes(i, avg);
    var r = v && VOTE_KMH[v.group];
    if (v && v.group !== VOTE_GROUP[m] && DOUBT_GROUPS[v.group] && v.n >= DOUBT_MIN && v.share >= DOUBT_SHARE && (v.by[VOTE_GROUP[m]] || 0) <= DOUBT_OWN * v.tot && avg >= r[0] && avg <= r[1]) {
      D.chk[i] = MODE_IDX[v.mode]; D.chkWhy[i] = { kind: 'history', n: v.trips, share: v.share };
    }
  }
}
// The likeliest other type for a guess worth checking: what your like trips mostly were, else the
// runner-up among them, else the neighbour by speed.
function mrAltMode(i, m, avg, v) {
  var g = VOTE_GROUP[m];
  if (v && v.group !== g && v.mode) return v.mode;
  if (v && v.alt && v.alt !== g) return v.alt;
  if (g === 'WALKING') return 'CYCLING';
  if (g === 'CYCLING') return avg >= 14 ? 'CAR' : 'WALKING';
  if (g === 'CAR') return avg < 30 ? 'CYCLING' : 'TRAIN';
  if (g === 'TRAIN') return 'CAR';
  return 'CAR';
}
// The Check button in the filters: how many trips are worth a look, and showing only those.
function mrCheckUI() {
  var b = $('checkBtn'), c = M && M.nCheck || 0;
  if (!b) return;
  b.hidden = !c;
  b.setAttribute('aria-pressed', F && F.guess === 'check' ? 'true' : 'false');
  b.innerHTML = icon('info') + (F && F.guess === 'check' ? 'Showing the ' : 'Check ') + fmt(c) + ' trip' + (c === 1 ? '' : 's') + ' whose type may be wrong';
}
function mrCheckCount() {
  for (var i = 0, c = 0; D && D.chk && i < D.chk.length; i++) if (D.chk[i] >= 0) c++;
  return c;
}

// ---------- routines ----------
// A routine matches trips that start within 500 m of its from and end within 500 m of its to (a
// place's own radius if larger), inside its when; with both_ways, the trip back too, inside
// return_when (else when). from and to are a place rule ("@office") or a position ([lat, lng]).
// Of the routines that match a trip, the one with the shorter when wins, then the later one in the
// file. then.mode sets the type when the files had none or it was guessed (or always, with force);
// then.gear fills trips without gear (in mrApplyGear); then.snap draws the trip along a line.
var MR_LEFT = {};   // trips a routine matched but left out, by routine id: { type, gear, line }
// rm: the routine's own radius_m for its ends, else 500 m (a place: its radius when larger).
// radius_m is one number for both ends, or { from, to } for each its own.
var MR_END_M = 500;
function mrEndM(r, end) { var v = r && r.radius_m; return v && typeof v === 'object' ? +v[end] || MR_END_M : +v || MR_END_M; }
function mrEnd(ref, rm) {
  var base = (+rm > 0 ? +rm : MR_END_M) / 1000;
  if (Array.isArray(ref) && ref.length === 2 && isFinite(ref[0])) return { at: [+ref[0], +ref[1]], rad: base };
  if (ref && typeof ref === 'object' && Array.isArray(ref.at)) return { at: ref.at, rad: Math.max(base, (+ref.radius_m || 0) / 1000) };
  var r = mrById(ref);
  return r && Array.isArray(r.at) ? { at: r.at, rad: Math.max(base, (+r.radius_m || 0) / 1000) } : null;
}
function mrRoutineList() {
  return mrActive('routines').map(function (r, k) {
    var a = mrEnd(r.from, mrEndM(r, 'from')), b = mrEnd(r.to, mrEndM(r, 'to')), w = mrWhen(r.when);
    if (!a || !b) return null;
    var rw = r.return_when ? mrWhen(Object.assign({}, r.when, r.return_when)) : w;
    return { r: r, k: k, a: a, b: b, w: w, rw: rw, ex: mrExcept(r), inc: mrIncluded(r), then: r.then && typeof r.then === 'object' ? r.then : {} };
  }).filter(Boolean);
}
// Trips you added to a routine by hand (Add to routine): they take its line whatever their match.
function mrIncluded(r) {
  var s = {};
  (Array.isArray(r.include) ? r.include : []).forEach(function (ref) { mrRefTrips(ref).forEach(function (i) { s[i] = 1; }); });
  return s;
}
// How closely a trip has to follow a routine's line to be one of its trips: the share of its GPS
// points within MR_MATCH_KM of the line, at least then.match percent (MR_MATCH by default).
var MR_MATCH = 67, MR_MATCH_KM = 0.5;
function mrMatchMin(t) { var m = t && +t.match; return m > 0 && m <= 100 ? m : MR_MATCH; }
function mrLineScore(i, L) {
  var own = mrTripPts(i), step = Math.max(1, Math.ceil(own.length / 40)), cnt = 0, on = 0;
  if (own.length < 2) own = [[D.from[2 * i], D.from[2 * i + 1]], [D.to[2 * i], D.to[2 * i + 1]]].filter(function (p) { return isFinite(p[0]); });
  for (var q = 0; q < own.length; q += step) { cnt++; if (mrToLine(own[q], L).d <= MR_MATCH_KM) on++; }
  return cnt ? Math.round(100 * on / cnt) : 0;
}
function mrNearEnd(e, i, end) { var o = end ? 'to' : 'from', lat = D[o][2 * i]; return isFinite(lat) && km([lat, D[o][2 * i + 1]], e.at) <= e.rad; }
// 1: the trip goes from → to; -1: to → from (both_ways); 0: no match.
function mrRouteDir(x, i) {
  if (x.ex[i]) return 0;
  if (mrNearEnd(x.a, i, false) && mrNearEnd(x.b, i, true) && mrWhenOk(x.w, i)) return 1;
  if (x.r.both_ways && mrNearEnd(x.b, i, false) && mrNearEnd(x.a, i, true) && mrWhenOk(x.rw, i)) return -1;
  return 0;
}
// A routine takes a trip only when all it sets can apply: its type, its gear and its line. A trip
// that matches by place and time but can't take one of them stays out (D.mrMiss says why).
// Its type fits when the files had the same, none, Google's generic "In vehicle" (MR_OPEN) or a guess,
// or always with force.
var MR_OPEN = { UNKNOWN: 1, VEHICLE: 1 };
// Its gear fits a trip without recorded gear, or one recorded with that same gear.
function mrGearName(g) {
  g = String(g);
  if (g.charAt(0) !== '@') return g;
  var r = mrById(g);
  return r && r.enabled !== false ? r.strava_name || r.name || r.id : null;
}
function mrRecGear(i) { var s = D.est[i] & STRAVA ? stravaInfo(i) : null; return s && s.gear || ''; }
function mrGearFits(x, i) {
  var want = x.then.gear ? mrGearName(x.then.gear) : null, had = want && mrRecGear(i);
  return !had || had.trim().toLowerCase() === want.trim().toLowerCase();
}
// Why a routine that matches a trip by place and time can't take it ('' when it can, lines aside).
function mrUnfit(x, i) { return !mrTypeFits(x, i) ? 'type' : !mrGearFits(x, i) ? 'gear' : ''; }
function mrTypeFits(x, i) {
  var m = x.then.mode, mi = m != null ? MODE_IDX[m] : null, b = D.base || D;
  return mi == null || mi === b.mode[i] || !!x.r.force || !!(b.est[i] & GUESSED) || !!MR_OPEN[MODES[b.mode[i]]];
}
function mrApplyRoutines() {
  var L = mrRoutineList(), n = D.day.length, b = D.base, cand = {}, fits = [], i, k;
  L.forEach(function (x) { MR_COUNT[x.r.id] = 0; MR_LEFT[x.r.id] = { type: 0, gear: 0, line: 0 }; cand[x.r.id] = []; x.dir = {}; });
  if (!L.length) return;
  // Every routine a trip fits by its ends, times, type and gear; a trip that fits none but matches
  // one by place and time is left out for its type or gear.
  for (i = 0; i < n; i++) {
    if (isDup(i) || MODES[b.mode[i]] === 'FLYING') continue;
    var miss = null, md = 0, mw = '';
    for (k = 0; k < L.length; k++) {
      var d = mrRouteDir(L[k], i);
      if (!d) continue;
      var uf = mrUnfit(L[k], i);
      if (uf) { if (!miss || L[k].w.len <= miss.w.len) { miss = L[k]; md = d; mw = uf; } continue; }
      (fits[i] || (fits[i] = [])).push(L[k]); L[k].dir[i] = d; cand[L[k].r.id].push(i);
    }
    if (!fits[i] && miss) { D.mrMiss[i] = { rule: miss.r.id, dir: md, why: mw }; MR_LEFT[miss.r.id][mw]++; }
  }
  // Each routine's line, from all the trips that fit it.
  L.forEach(function (x) {
    if (!x.then.snap || !cand[x.r.id].length) return;
    D.mrLine[x.r.id] = mrRouteLine(x, cand[x.r.id]);
  });
  // Each trip goes to the routine whose line it follows most closely (one without a line counts as
  // 0%); then the shorter period, then the later one in the file. A routine whose line it doesn't
  // follow closely enough can't take it. With none left, it stays out, under the closest one.
  for (i = 0; i < n; i++) {
    if (!fits[i]) continue;
    var best = null, bs = null, bsc = -1, near = null;
    for (k = 0; k < fits[i].length; k++) {
      var x = fits[i][k], line = x.then.snap ? D.mrLine[x.r.id] : null, ok = line && line.pts, sc = 0, sn = null, take;
      if (!x.then.snap) take = true;
      else if (ok && i === line.from) { take = true; sc = 100; }
      else {
        sc = ok ? mrLineScore(i, line.pts) : 0; sn = ok ? mrSnapTrip(i, line.pts) : null;
        take = !!(sn && (sc >= mrMatchMin(x.then) || x.inc[i]));
        if (!take && (!near || sc > near.score || sc === near.score && x.w.len <= near.x.w.len))
          near = { x: x, score: sc, why: !line ? 'noline' : line.missing ? 'missing' : 'fit', can: !!sn };
      }
      if (take && (!best || sc > bsc || sc === bsc && x.w.len <= best.w.len)) { best = x; bsc = sc; bs = sn; }
    }
    if (best) {
      D.mrRoute[i] = { rule: best.r.id, dir: best.dir[i] };
      if (bs) { bs.rule = best.r.id; bs.score = bsc; bs.added = bsc < mrMatchMin(best.then); D.snap[i] = bs; D.km[i] = bs.km; }
    } else if (near) {
      D.mrMiss[i] = { rule: near.x.r.id, dir: near.x.dir[i], why: near.why, score: near.score, min: mrMatchMin(near.x.then), can: near.can };
      MR_LEFT[near.x.r.id].line++;
    }
  }
  L.forEach(function (x) { cand[x.r.id] = cand[x.r.id].filter(function (j) { return D.mrRoute[j] && D.mrRoute[j].rule === x.r.id; }); });
  // Types, on the trips each routine kept.
  L.forEach(function (x) {
    var m = x.then.mode, mi = m != null ? MODE_IDX[m] : null;
    MR_COUNT[x.r.id] = cand[x.r.id].length;
    if (mi == null) return;
    cand[x.r.id].forEach(function (i) {
      if (mi === b.mode[i]) return;
      D.mode[i] = mi;
      D.est[i] &= ~GUESSED;
      if (D.sport[i] && SPORTS[D.sport[i]][2] !== m) D.sport[i] = 0;
      if (D.stype) D.stype[i] = '';
      D.mrMode[i] = { rule: x.r.id, was: MODES[b.mode[i]], guessed: !!(b.est[i] & GUESSED), inf: true };
    });
  });
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
  if (typeof sn === 'object' && sn.polyline) { pts = mrDecodePolyline(sn.polyline); src = sn.osm ? 'the OpenStreetMap line of ' + (sn.osm.name || 'its route') : 'the line in your MyRules'; }
  else if (typeof sn === 'object' && sn.geojson) {
    pts = MR.lines && MR.lines[sn.geojson];
    src = pts ? sn.geojson : '';
    if (!pts) return { missing: sn.geojson };
  } else {
    // Learned: the trip the rule names, else the cleanest one.
    var pick = typeof sn === 'object' && sn.trip ? mrRefTrips(sn.trip)[0] : null, best = 0;
    // Else the recommended one, as Edit routine shows it: the best trip of the way most trips take.
    if (pick == null) { var W = mrWays(trips); pick = W.length ? W[0].i : null; }
    if (pick == null) return null;
    pts = mrTripPts(pick);
    if ((x.dir && x.dir[pick] || D.mrRoute[pick] && D.mrRoute[pick].dir) < 0) pts.reverse();
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
function mrSnapTrip(i, L, far) {
  var a = [D.from[2 * i], D.from[2 * i + 1]], b = [D.to[2 * i], D.to[2 * i + 1]];
  if (!isFinite(a[0]) || !isFinite(b[0])) return null;
  // Its ends near the line, so there is a stretch of it to take.
  var q, ia = mrToLine(a, L), ib = mrToLine(b, L);
  if (ia.d > (far || 1) || ib.d > (far || 1) || ia.k === ib.k) return null;
  var seg = ia.k < ib.k ? L.slice(ia.k, ib.k + 1) : L.slice(ib.k, ia.k + 1).reverse();
  var cum = [0], len = 0;
  for (q = 1; q < seg.length; q++) { len += km(seg[q - 1], seg[q]); cum.push(len); }
  var dur = Math.max(0, (D.end[i] - D.start[i]) / 1000);
  return { pts: seg, ts: mrSnapTimes(i, seg, cum, len, dur), km: len };
}
// The time at each point of the line: the trip's own GPS points, each placed at how far along the
// line it is, and the times between them spread by distance. So stops and slow stretches stay where
// they were; with no GPS points near the line, an even speed from start to end.
function mrSnapTimes(i, seg, cum, len, dur) {
  if (!len || !dur) return cum.map(function () { return 0; });
  var o0 = D.pathOff[i], o1 = D.pathOff[i + 1], A = [0], T = [0], k0 = 0, n = seg.length;
  for (var j = o0; j < o1; j++) {
    var t = D.pathT[j], p = [D.pathPts[2 * j], D.pathPts[2 * j + 1]];
    if (!(t > T[T.length - 1]) || t >= dur || !isFinite(p[0])) continue;
    // Its nearest place on the line, searched from the last one on: a trip goes forward along it.
    var bd = Infinity, ba = 0, bk = k0;
    for (var k = k0; k < n - 1; k++) {
      var a = mrLL(seg[k], p), b = mrLL(seg[k + 1], p), dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
      var u = l ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / l)) : 0, x = a[0] + u * dx, y = a[1] + u * dy, d = Math.sqrt(x * x + y * y);
      if (d < bd) { bd = d; bk = k; ba = cum[k] + u * (cum[k + 1] - cum[k]); }
    }
    // Off the line (a detour, a GPS jump) or going back: left out.
    if (bd > MR_MATCH_KM || ba <= A[A.length - 1] || ba >= len) continue;
    A.push(ba); T.push(t); k0 = bk;
  }
  A.push(len); T.push(dur);
  var m = 0;
  return cum.map(function (c) {
    while (m < A.length - 2 && A[m + 1] < c) m++;
    return T[m] + (T[m + 1] - T[m]) * Math.max(0, Math.min(1, (c - A[m]) / (A[m + 1] - A[m])));
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
  // The gear chips are numbered again, so the ones ticked are kept by name (No gear by its type).
  var allG = F.gear.size === gearIds().length, had = {}, on = {};
  gearIds().forEach(function (g) { var k = g >= NO_GEAR ? 'no:' + g : 'g:' + GEAR[g].name; had[k] = 1; if (F.gear.has(g)) on[k] = 1; });
  buildGear();
  M.gear = GEAR; M.gearMode = GEAR_MODE;
  D.places = null; D.home = undefined; D.spotN = null; D.homeSpot = undefined; D.skey = null;
  mrApplyPlaces();
  M.anyGuess = mrAnyGuess();
  M.nCheck = mrCheckCount();
  if (F.guess === 'check' && !M.nCheck) F.guess = 'all';
  $('guessWrap').hidden = !M.anyGuess && !M.nCheck;
  mrCheckUI();
  // Gear that is new (or all of it, when all was on) is on; the rest as it was.
  F.gear = new Set(gearIds().filter(function (g) { var k = g >= NO_GEAR ? 'no:' + g : 'g:' + GEAR[g].name; return allG || !had[k] || on[k]; }));
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
// side: on a wide screen with the map in view, the dialog opens as a panel on the right instead,
// non-modal, and its ghosts and line are drawn on the main map.
var MR_SIDE = false;
function mrAsk(o) {
  var d = $('mrDlg');
  var side = !!(o.side && wide() && tab === 'map' && typeof map !== 'undefined' && map);
  if (d.open && side !== MR_SIDE) d.close();
  d.classList.toggle('mr-side', side);
  MR_SIDE = side;
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
  if (!d.open) { if (side) d.show(); else d.showModal(); }
  if (side) { d.scrollTop = 0; hideTip(); }
  if (o.after) o.after(d);
}
// Closing: the ghosts leave the main map. Another dialog opened at once keeps them to itself.
$('mrDlg').addEventListener('close', function () {
  if (this.open) return;
  this.classList.remove('mr-side');
  MR_SIDE = false;
  mrGhostClear(true);
  if (SN && SN.phase === 'edit') snapEnd();
});
// A panel isn't modal, so Escape is ours to handle.
$('mrDlg').addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && MR_SIDE && !ev.defaultPrevented) { ev.preventDefault(); ev.stopPropagation(); this.close(); } });
// Taps on the main map are for the ghosts while the panel is open.
function mrSideOpen() { return MR_SIDE && $('mrDlg').open; }
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
    el.innerHTML = '<p class="fine">Add what only you know, like which bike you rode when or where home was. BT•DT fills in what your files leave out and marks it <span class="guess inf">Rule applied</span>. Fix a trip\'s type or title, or hide it, with <b>Edit trip</b> in its details; those changes are marked <span class="guess inf">Edited</span>. Load a <b>.myrules.json</b> file with your location files, or set a ride\'s gear or edit a trip to start.</p>';
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
    (ex ? ' · ' + ex + ' exception' + (ex === 1 ? '' : 's') : '') + (r.note ? '<br>' + esc(r.note) : '') + mrUnlessTags(r) + '</small></span>' +
    (count != null ? '<span class="num fine">' + fmt(count) + '</span>' : '') +
    '<input type="checkbox" class="switch" data-mr-on="' + esc(r.id) + '" aria-label="Apply ' + esc(title) + '"' + (on ? ' checked' : '') + '>' +
    '<button type="button" class="icon-btn" data-mr-del="' + esc(sec) + ':' + esc(r.id) + '" aria-label="Delete ' + esc(title) + '">' + icon('close') + '</button></div>';
}
// A rule's unless conditions, each with Undo.
function mrUnlessTags(r) {
  return (Array.isArray(r.unless) ? r.unless : []).map(function (u, k) {
    return u && typeof u === 'object' ? '<span class="mr-unless"><span class="guess inf">Not on ' + esc(mrUnlessText(u)) + '</span><button type="button" class="link-btn" data-mr-unless="' + esc(r.id) + '" data-k="' + k + '">Undo</button></span>' : '';
  }).join('');
}
function mrRenderRules() {
  var h = '';
  if (!MR) { $('mrBody').innerHTML = '<p class="fine">No rules yet.</p>'; return; }
  if (!MR.on) h += '<p class="fine mr-warn">MyRules are switched off in Imported data.</p>';
  if (MR_AMB) h += '<p class="fine mr-warn">' + tripsText(MR_AMB) + ' fit two gear periods equally well, so they got no gear. Narrow one of the periods (a shorter period, or a distance limit) to pick one.</p>';
  var gear = mrList('gear'), places = mrList('places'), cor = mrList('corrections'), rout = mrList('routines'), snaps = mrList('snaps');
  if (gear.length) h += '<div class="sec" data-mr-tab="gear"><h3>Gear</h3>' + gear.map(function (r) {
    var m = r.match || {}, bits = [mrWhenText(r.when), LABEL[r.mode] || r.mode];
    if (m.max_km != null) bits.push('under ' + dist(m.max_km));
    if (m.min_km != null) bits.push('over ' + dist(m.min_km));
    if (r.strava_name) bits.push('same as “' + esc(r.strava_name) + '”');
    var ic = r.kind === 'strida' ? 'strida' : r.kind === 'halfbike' ? 'halfbike' : r.kind === 'cargo' ? 'cargobike' : r.kind === 'ebike' ? 'ebike' : r.mode;
    return mrRuleRow('gear', r, r.name || r.id, bits.map(function (b) { return b; }).join(' · '), ic, modeColor(r.mode || 'CYCLING'), MR_COUNT[r.id] || 0);
  }).join('') + '</div>';
  if (places.length) h += '<div class="sec" data-mr-tab="places"><h3>Places</h3>' + places.map(function (r) {
    var sub = [r.role ? (MR_LIFE[r.role] ? (mrIsPast(r) ? 'Past ' + r.role : 'Current ' + r.role) : mrKindName(r.role)) : '', r.when ? mrWhenText(r.when) : '', r.hide ? 'Hidden from pins, heatmap and places' : '', (MR_COUNT[r.id] || 0) + ' stays'].filter(Boolean).join(' · ');
    return mrRuleRow('places', r, r.name || mrKindName(r.role) || r.id, sub, mrLook(r).ic, r.hide ? '#9aa49d' : mrLook(r).bg, null);
  }).join('') + '</div>';
  if (cor.length) h += '<div class="sec" data-mr-tab="corrections"><h3>Corrections</h3>' + cor.map(function (c) {
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
  if (rout.length) h += '<div class="sec" data-mr-tab="routines"><h3>Routines</h3>' + rout.map(function (r) {
    var t = r.then || {}, a = mrEnd(r.from, mrEndM(r, 'from')), b = mrEnd(r.to, mrEndM(r, 'to')), ln = D && D.mrLine && D.mrLine[r.id], bits = [];
    function end(ref, e) { var pr = typeof ref === 'string' ? mrById(ref) : null; return pr ? pr.name || pr.role || pr.id : e ? (needPlaces(), placeLabel(mrNearestPlace(e.at))) : '?'; }
    bits.push(esc(end(r.from, a)) + (r.both_ways ? ' ⇄ ' : ' → ') + esc(end(r.to, b)));
    bits.push(mrWhenText(r.when));
    if (t.mode) bits.push(esc(LABEL[t.mode] || t.mode) + (r.force ? ', always' : ', where the type was missing, generic or guessed'));
    if (t.gear) { var gr = String(t.gear).charAt(0) === '@' ? mrById(t.gear) : null; bits.push('Gear: ' + esc(gr ? gr.name || gr.id : t.gear)); }
    var left = D && MR_LEFT[r.id] || { type: 0, gear: 0, line: 0 };
    if (t.snap) bits.push(ln && ln.missing ? 'Line: ' + esc(ln.missing) + ' isn\'t loaded, so it takes no trips' : ln ? 'Line: ' + (ln.src === 'trip' ? 'learned from the trip on ' + esc(mrWhere(ln.from)) : esc(ln.src)) + ' · trips that follow it for ' + mrMatchMin(t) + '% or more' + (left.line ? ' (' + fmt(left.line) + ' below)' : '') : left.line ? 'Line: no trip with 5 or more GPS points to take it from yet, so it takes none of the ' + fmt(left.line) + ' it matches' : 'Line: no trip with 5 or more GPS points to take it from yet');
    if (left.type) bits.push(fmt(left.type) + ' left out: your files give them another type' + (t.mode ? ' (turn on Always to take them)' : ''));
    if (left.gear) bits.push(fmt(left.gear) + ' left out: recorded with other gear');
    if (!a || !b) bits.push('Its from or to isn\'t a place with a position');
    return mrRuleRow('routines', r, r.name || r.id, bits.join(' · '), t.mode || 'OTHER', t.mode ? modeColor(t.mode) : '#9aa49d', D ? MR_COUNT[r.id] || 0 : null);
  }).join('') + '</div>';
  if (snaps.length) h += '<div class="sec" data-mr-tab="snaps"><h3>Map snaps</h3>' + snaps.map(snapRuleRow).join('') + '</div>';
  if (!h) h = '<p class="fine">No rules yet. Set a ride\'s gear or edit a trip in its trip details to make one.</p>';
  // Tabs, one per kind of rule that has any, so a long list is easy to browse.
  var tabs = [['gear', 'Gear', gear.length], ['places', 'Places', places.length], ['routines', 'Routines', rout.length], ['snaps', 'Map snaps', snaps.length], ['corrections', 'Corrections', cor.length]].filter(function (t) { return t[2]; });
  if (tabs.length > 1) {
    if (!tabs.some(function (t) { return t[0] === MR_TAB; })) MR_TAB = tabs[0][0];
    h = '<div class="seg full mr-tabs" role="tablist">' + tabs.map(function (t) {
      return '<button type="button" role="tab" data-mr-tabbtn="' + t[0] + '" aria-selected="' + (t[0] === MR_TAB) + '" aria-pressed="' + (t[0] === MR_TAB) + '">' + t[1] + ' <span class="n">' + fmt(t[2]) + '</span></button>';
    }).join('') + '</div>' + h;
  }
  var body = $('mrBody');
  body.innerHTML = h;
  body.classList.toggle('mr-tabbed', tabs.length > 1);
  if (tabs.length > 1) body.querySelectorAll('[data-mr-tab]').forEach(function (el) { el.hidden = el.dataset.mrTab !== MR_TAB; });
}
var MR_TAB = 'routines';
$('mrBody').addEventListener('click', function (ev) {
  var t = ev.target.closest('[data-mr-tabbtn]');
  if (!t) return;
  MR_TAB = t.dataset.mrTabbtn;
  mrRenderRules();
});
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
  var un = ev.target.closest('[data-mr-unless]');
  if (un) {
    var ur = mrById(un.dataset.mrUnless), uk = +un.dataset.k, u = ur && ur.unless && ur.unless[uk];
    if (!u) return;
    ur.unless.splice(uk, 1);
    if (!ur.unless.length) delete ur.unless;
    mrChange((ur.name || ur.id) + ' on again for ' + mrUnlessText(u));
    return;
  }
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
  if (D.mrOk && D.mrOk[i]) { var okc = mrTripCorrection(i); h += '<div class="mr-chg"><b>Type checked:</b> ' + esc(LABEL[MODES[D.mode[i]]] || MODES[D.mode[i]]) + ' is right' + (okc ? src(okc.id, 'checked') : '') + '</div>'; }
  if (md) h += '<div class="mr-chg"><b>Type:</b> ' + esc(LABEL[MODES[D.mode[i]]] || MODES[D.mode[i]]) + ' <span class="fine">(was ' + esc((LABEL[md.was] || md.was).toLowerCase()) + (md.guessed ? ', guessed' : '') + ')</span>' + src(md.rule, md.inf ? '' : 'mode') + '</div>';
  if (nm) h += '<div class="mr-chg"><b>Title:</b> ' + esc(nm.name) + (recName(i) ? ' <span class="fine">(was “' + esc(recName(i)) + '”)</span>' : '') + src(nm.rule, 'name') + '</div>';
  if (g) h += '<div class="mr-chg"><b>Gear:</b> ' + esc(GEAR[g.gear].name) + src(g.rule, g.cor ? 'gear' : '') + '</div>';
  var rt = D.mrRoute && D.mrRoute[i], rr = rt && mrById(rt.rule), sn = D.snap && D.snap[i], ln = rr && D.mrLine[rr.id];
  var ms = !rr && D.mrMiss && D.mrMiss[i], mr = ms && mrById(ms.rule), mln = mr && D.mrLine[mr.id];
  function way(d) { return ' <span class="fine">· the way ' + (d > 0 ? 'there' : 'back') + '</span>'; }
  if (rr) {
    // Everything it set: its type, gear and line all applied, or it wouldn't have this trip.
    var rm = rr.then && rr.then.mode, bits = [];
    h += '<div class="mr-chg"><b>Routine:</b> ' + esc(rr.name || rr.id) + way(rt.dir);
    if (rm && !md) bits.push('Type: ' + esc((LABEL[rm] || rm).toLowerCase()) + (MODES[D.mode[i]] === rm ? ', as in your files.' : ', but a fix on this trip wins.'));
    if (rm && md && md.rule !== rr.id) bits.push('Type: ' + esc((LABEL[rm] || rm).toLowerCase()) + ' from the routine, but a fix on this trip wins.');
    if (sn) bits.push('Drawn along ' + (ln && ln.src === 'trip' ? 'the line of the trip on ' + esc(mrWhere(ln.from)) : esc(ln ? ln.src : 'its line')) + ': ' + dist(sn.km) + ' (its own GPS points, dashed: ' + dist(D.base.km[i]) + '). ' +
      (sn.added ? 'You added it to the routine: it follows the line for ' + sn.score + '% of its GPS points.' : 'It follows the line for ' + sn.score + '% of its GPS points.'));
    else if (ln && ln.from === i) bits.push('This trip\'s GPS trail is the line the routine\'s other trips are drawn along.');
    h += bits.map(function (t) { return '<div class="fine">' + t + '</div>'; }).join('') + '</div>';
  } else if (mr) {
    // Matched by place and time, but something the routine sets can't apply, so none of it does.
    var mm = mr.then && mr.then.mode, why;
    if (ms.why === 'type') why = 'Your files say ' + esc((LABEL[MODES[D.base.mode[i]]] || MODES[D.base.mode[i]]).toLowerCase()) + ', and the routine only sets ' + esc((LABEL[mm] || mm).toLowerCase()) + ' where the type is missing, generic or guessed. Turn on Always in the routine to take trips like this one.';
    else if (ms.why === 'gear') why = 'It was recorded with ' + esc(mrRecGear(i)) + ', and the routine sets ' + esc(mrGearName(mr.then.gear)) + '. Recorded gear is never replaced by a routine.';
    else if (ms.why === 'missing') why = 'Its line, ' + esc(mln && mln.missing || 'a GeoJSON file') + ', isn\'t loaded: load it with your location files.';
    else if (ms.why === 'noline') why = 'It draws its trips along one line, and none of its trips has a GPS trail of 5 or more points to take it from. Turn off Draw them along one line in the routine, or give it a line in your MyRules file.';
    else why = 'It follows the routine\'s line for ' + (ms.score || 0) + '% of its GPS points, and the routine takes trips from ' + ms.min + '%.' + (ms.can ? '' : ' Its start or end is over 1 km from the line, so it can\'t be drawn along it.');
    h += '<div class="mr-chg"><b>Not in routine:</b> ' + esc(mr.name || mr.id) + way(ms.dir) + '<div class="fine">It matches by place and time, but everything a routine sets (type, gear, line) applies together or not at all. ' + why + '</div></div>';
  }
  var msn = !rr && D.mrSnap && D.mrSnap[i], msr = msn && mrById(msn.rule);
  if (msr && sn) h += '<div class="mr-chg"><b>Map snap:</b> ' + esc(msr.name || msr.id) + way(msn.dir) + '<div class="fine">Drawn ' + esc(msr.line && msr.line.name ? msr.line.name.charAt(0).toLowerCase() + msr.line.name.slice(1) : 'along its line') + ': ' + dist(sn.km) + ' (its own GPS points, dashed: ' + dist(D.base.km[i]) + '). It follows the line for ' + sn.score + '% of its GPS points.</div></div>';
  var tk = D.mrTrack && D.mrTrack[i];
  if (tk && sn) h += '<div class="mr-chg"><b>On the tracks:</b> ' + esc(tk.from) + ' – ' + esc(tk.to) + '<div class="fine">Drawn ' + esc(tk.name.charAt(0).toLowerCase() + tk.name.slice(1)) + ' from your ' + esc(packNames(tk.packs || [])) + ' station pack' + ((tk.packs || []).length > 1 ? 's' : '') + ': ' + dist(sn.km) + ' (its own GPS points, dashed: ' + dist(D.base.km[i]) + '). ' + tk.score + '% of its GPS points are near it. Turn it off in Settings, Station packs.</div></div>';
  if (amb) h += '<div class="mr-chg"><b>Gear:</b> none<div class="fine">' + amb.map(function (id) { var r = mrById(id); return '<i>' + esc(r ? r.name || r.id : id) + '</i>'; }).join(' and ') + ' both fit this trip equally well. Set its gear, or narrow one of them.</div></div>';
  var btns = '<button type="button" class="btn" data-mr-act="edit" data-t="' + i + '">' + icon('info') + 'Edit trip</button>';
  // Not this trip: out of the routine (its type, gear and line), else out of the gear period.
  if (rr || g && !g.cor) btns += '<button type="button" class="btn" data-mr-act="not" data-r="' + esc(rr ? rr.id : g.rule) + '" data-t="' + i + '">Not this trip' + (rr ? '' : '') + '</button>';
  // Find similar trips: a new routine with this trip as its line, matched by route, not by time.
  if (!rr && !mr && MODES[D.mode[i]] !== 'FLYING' && D.pathOff[i + 1] - D.pathOff[i] >= 5 && isFinite(D.from[2 * i]) && isFinite(D.to[2 * i]) && km([D.from[2 * i], D.from[2 * i + 1]], [D.to[2 * i], D.to[2 * i + 1]]) > 1) btns += '<button type="button" class="btn" data-mr-act="similar" data-t="' + i + '">Find similar trips</button>';
  if (ms && ms.why === 'fit' && ms.can && mr) btns += '<button type="button" class="btn primary" data-mr-act="include" data-r="' + esc(mr.id) + '" data-t="' + i + '">Add to routine</button>';
  if (rr || mr) btns += '<button type="button" class="btn" data-mr-act="rule" data-r="' + esc((rr || mr).id) + '" data-t="' + i + '">Edit routine</button>';
  if (msr && sn) btns += '<button type="button" class="btn" data-mr-act="snaprule" data-r="' + esc(msr.id) + '" data-t="' + i + '">Open map snap</button>';
  // A trip of your own as the line: one in the routine, or one left out for want of a line or for going another way.
  var lr = rr || ms && (ms.why === 'noline' || ms.why === 'fit') && mr, lln = lr && D.mrLine[lr.id];
  if (lr && lr.then && lr.then.snap && mrLearned(lr.then.snap) && !(lln && lln.from === i) && D.pathOff[i + 1] - D.pathOff[i] >= 5) btns += '<button type="button" class="btn" data-mr-act="line" data-r="' + esc(lr.id) + '" data-t="' + i + '">Use this trip\'s line</button>';
  if (splitHandOk(i)) btns += '<button type="button" class="btn" data-split-hand="' + i + '">' + icon('split') + 'Split trip…</button>';
  if (MR_GEAR_MODES[MODES[D.mode[i]]] && !(D.gear[i] && !g)) btns += '<button type="button" class="btn" data-mr-act="gear" data-t="' + i + '">' + icon('gear') + (D.gear[i] ? 'Change gear' : 'Set gear') + '</button>';
  return mrCheckBlock(i) + '<div class="mr-trip">' + (h ? '<h4 class="place-h">From MyRules</h4>' + h : '') + '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">' + btns + '</div></div>';
}
// Is this the right type? For a trip in the check list: why, and one tap to keep or change its type.
function mrCheckBlock(i) {
  if (!mrCheck(i)) return '';
  var m = MODES[D.mode[i]], alt = MODES[D.chk[i]], w = D.chkWhy[i] || {}, lab = function (x) { return esc((LABEL[x] || x).toLowerCase()); }, why;
  if (w.kind === 'speed') why = 'Your files say ' + lab(m) + ', but it averaged ' + speed(w.avg) + ', faster than a bike ride.';
  else if (w.kind === 'history') why = 'Your files say ' + lab(m) + ', but ' + fmt(w.n) + ' of your trips between these places at a like speed were mostly by ' + lab(alt) + '.';
  else why = 'BT•DT guessed ' + lab(m) + ' but isn\'t sure. It may have been ' + lab(alt) + '.';
  return '<div class="mr-check"><h4 class="place-h">Is this the right type?</h4><p class="fine">' + why + ' Your answer is saved in MyRules and teaches BT•DT for trips like it.</p>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">' +
    '<button type="button" class="btn primary" data-mr-act="type" data-m="' + m + '" data-t="' + i + '">' + esc(LABEL[m] || m) + ' is right</button>' +
    '<button type="button" class="btn" data-mr-act="type" data-m="' + alt + '" data-t="' + i + '">It was ' + lab(alt) + '</button>' +
    '<button type="button" class="btn" data-mr-act="edit" data-t="' + i + '">Something else</button></div></div>';
}
// One tap from the check: sets the type (or, when it is the one your files had, marks it checked)
// in the correction for this trip.
function mrQuickType(i, type) {
  var was = MODES[D.base.mode[i]], cur = MODES[D.mode[i]];
  mrEnsure();
  var c = mrTripCorrection(i);
  if (!c) { c = { id: mrNewId('trip-' + isoDay(D.day[i])), trip: { start: mrIsoLocal(i), mode: was }, then: {} }; (MR.doc.corrections || (MR.doc.corrections = [])).push(c); }
  var t = c.then || (c.then = {});
  if (type !== was || D.base.est[i] & GUESSED) { t.mode = type; delete t.checked; } else { delete t.mode; t.checked = true; }
  mrChange('Trip on ' + mrWhere(i) + ': ' + (type === cur ? 'type checked, ' : 'type ') + (LABEL[type] || type).toLowerCase());
  var next = mrNextCheck(i);
  toast(type === cur ? 'Kept as ' + (LABEL[type] || type).toLowerCase() + '.' : 'Changed to ' + (LABEL[type] || type).toLowerCase() + '.');
  if (type !== cur) { openTrip(i); setTimeout(function () { mrOfferRoutine(i, type); }, 0); }
  else if (next >= 0) openTrip(next); else openTrip(i);
}
// The next trip to check after trip i among those the filters show (oldest first), else the first.
function mrNextCheck(i) {
  var first = -1, after = false;
  for (var k = 0; k < sel.length; k++) {
    var j = sel[k];
    if (j === i) { after = true; continue; }
    if (!mrCheck(j)) continue;
    if (after) return j;
    if (first < 0) first = j;
  }
  return F.guess === 'check' ? first : -1;
}
// Drops one action from a correction, and the correction once it has none left.
function mrDropAction(c, field) {
  delete c.then[field];
  if (!Object.keys(c.then).length) MR.doc.corrections = mrList('corrections').filter(function (x) { return x !== c; });
}
var MR_UNDO = { mode: 'Type', name: 'Title', gear: 'Gear', hide: 'Hidden', checked: 'Type checked' };
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
    // Out of the routine: no longer one you added by hand either.
    if (Array.isArray(r.include)) { r.include = r.include.filter(function (ref) { return mrRefTrips(ref).indexOf(i) < 0; }); if (!r.include.length) delete r.include; }
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
  } else if (act === 'rule') mrEditRule('routines:' + b.dataset.r);
  else if (act === 'snaprule') mrEditRule('snaps:' + b.dataset.r);
  else if (act === 'similar') mrSimilar(i);
  else if (act === 'include') {
    var ir = mrById(b.dataset.r);
    if (!ir) return;
    (ir.include || (ir.include = [])).push({ start: mrIsoLocal(i), mode: MODES[D.base.mode[i]] });
    mrChange('Added to ' + (ir.name || ir.id) + ': the trip on ' + mrWhere(i));
    openTrip(i);
  }
  else if (act === 'type') mrQuickType(i, b.dataset.m);
  else if (act === 'gear') mrGearDialog(i);
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
        $('mrCountTxt').innerHTML = '<b class="num">' + fmt(c) + '</b> ' + esc((LABEL[mode] || mode).toLowerCase()) + ' ' + (c === 1 ? 'trip' : 'trips') + ' in that period have no recorded gear. They get this one, marked <span class="guess inf">Rule applied</span>, unless a narrower rule covers them.';
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
  if (sec === 'snaps') { closeSheets(true); snapStart(r); return; }
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
// Days of the week (chips, none on: every day) and the time it leaves (empty: any time).
var MR_WEEK = [1, 2, 3, 4, 5, 6, 0];
function mrDaysRow(w) {
  w = w || {};
  var on = {}, t = Array.isArray(w.time) ? w.time : [];
  (Array.isArray(w.days) ? w.days : []).forEach(function (d) { on[String(d).toLowerCase().slice(0, 3)] = 1; });
  var all = !Object.keys(on).length;
  return '<div class="field"><span>Days</span><span class="chips" id="mrWDays">' + MR_WEEK.map(function (k) {
    var d = MR_DOW[k];
    return '<button type="button" class="chip sub" data-d="' + d + '" aria-pressed="' + (all || on[d] ? 'true' : 'false') + '">' + d.charAt(0).toUpperCase() + d.slice(1) + '</button>';
  }).join('') + '</span></div>' +
    '<div class="field"><span>Leaving between</span><span class="mr-dates"><input type="time" id="mrWT0" value="' + esc(t[0] || '') + '" aria-label="Earliest start"> and <input type="time" id="mrWT1" value="' + esc(t[1] || '') + '" aria-label="Latest start"><small class="fine">Empty: any time.</small></span></div>';
}
// Writes the days and time from mrDaysRow into a when.
function mrDaysInto(w) {
  var b = document.querySelectorAll('#mrWDays [data-d]'), d = [];
  b.forEach(function (x) { if (x.getAttribute('aria-pressed') === 'true') d.push(x.dataset.d); });
  if (b.length && d.length && d.length < 7) w.days = d; else delete w.days;
  var t0 = $('mrWT0') && $('mrWT0').value, t1 = $('mrWT1') && $('mrWT1').value;
  if (t0 && t1) w.time = [t0, t1]; else delete w.time;
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
// A routine from one trip: its two ends, any day and time, both ways, its type, and its own trail as
// the line, so the trips that follow that line closely enough (the match slider) are its trips.
function mrSimilar(i) {
  needPlaces();
  var m = MODES[D.mode[i]], A = placeLabel(D.pa[i]), B = placeLabel(D.pb[i]), lab = LABEL[m] || m;
  var r = { id: mrNewId(lab + ' ' + A + ' ' + B), name: lab + ' ' + A + ' – ' + B, from: mrEndRef({ at: [D.from[2 * i], D.from[2 * i + 1]] }), to: mrEndRef({ at: [D.to[2 * i], D.to[2 * i + 1]] }),
    both_ways: true, then: { mode: m, snap: { trip: { start: mrIsoLocal(i), mode: MODES[D.base.mode[i]] } } } };
  if (m === 'UNKNOWN') delete r.then.mode;
  mrRoutineDialog(r, true);
}
// isNew: a routine not saved yet (Find similar trips), added to MyRules on Save.
function mrRoutineDialog(r, isNew) {
  var t = r.then || {}, rt = r.return_when && Array.isArray(r.return_when.time) ? r.return_when.time : [];
  mrAsk({
    side: true,
    title: isNew ? 'Trips like this one' : 'Edit routine',
    text: isNew ? 'Your trips between the same two ends, any day and any time, that follow this trip\'s line closely enough. Set how closely below, then save them as a routine.' : 'Trips between its two ends in this period get what you set here.',
    extra: '<div class="mr-form"><label class="field"><span>Name</span><input type="text" id="mrRName" value="' + esc(r.name || '') + '" placeholder="e.g. Train to work"></label>' +
      '<label class="field"><span>Type</span><select id="mrRMode"><option value="">Leave the type as it is</option>' + MODES.filter(function (m) { return m !== 'UNKNOWN'; }).map(function (m) {
        return '<option value="' + m + '"' + (m === t.mode ? ' selected' : '') + '>' + esc(LABEL[m] || m) + '</option>';
      }).join('') + '</select></label>' +
      mrDateRow(r.when) + mrDaysRow(r.when) +
      ['from', 'to'].map(function (e) {
        var v = mrEndM(r, e), E = e === 'from' ? 'From' : 'To';
        return '<label class="field mr-match"><span>' + (e === 'from' ? 'Starts within <b class="num" id="mrREndFromV">' : 'Ends within <b class="num" id="mrREndToV">') + dist(v / 1000) + '</b> of its ' + (e === 'from' ? 'start' : 'end') + '</span>' +
          '<input type="range" id="mrREnd' + E + '" min="100" max="3000" step="50" value="' + v + '"></label>';
      }).join('') +
      '<label class="toggle-row"><span class="lbl">Both ways<small class="fine" style="display:block">Also the trips back.</small></span><input type="checkbox" class="switch" id="mrRBoth"' + (r.both_ways ? ' checked' : '') + '></label>' +
      '<div class="field" id="mrWBackRow"' + (r.both_ways ? '' : ' hidden') + '><span>Back between</span><span class="mr-dates"><input type="time" id="mrWB0" value="' + esc(rt[0] || '') + '" aria-label="Earliest return"> and <input type="time" id="mrWB1" value="' + esc(rt[1] || '') + '" aria-label="Latest return"><small class="fine">Empty: the same times as there.</small></span></div>' +
      '<label class="toggle-row"><span class="lbl">Always<small class="fine" style="display:block">Replace the type your files have, not only a missing, generic (Vehicle) or guessed one. Without it, trips your files give another type stay out of the routine.</small></span><input type="checkbox" class="switch" id="mrRForce"' + (r.force ? ' checked' : '') + '></label>' +
      '<label class="toggle-row"><span class="lbl">Draw them along one line<small class="fine" style="display:block">Trips that don\'t follow it closely enough stay out of the routine.</small></span><input type="checkbox" class="switch" id="mrRSnap"' + (t.snap ? ' checked' : '') + '></label>' + mrGhostHtml() + '</div>',
    buttons: [[isNew ? 'Save as routine' : 'Save', 'primary', function () {
      var d = mrGhostSnap(form(true));
      if (!d) return;
      Object.keys(r).forEach(function (k) { delete r[k]; });
      Object.assign(r, d);
      if (isNew) { mrEnsure(); (MR.doc.routines || (MR.doc.routines = [])).push(r); mrChange('New routine: ' + (r.name || r.id)); toast((r.name || 'Routine') + ': ' + tripsText(MR_COUNT[r.id] || 0) + ' match.'); }
      else mrChange('Routine changed: ' + (r.name || r.id));
    }], ['Cancel', 'quiet', null]],
    after: function () {
      $('mrRBoth').addEventListener('change', function () { $('mrWBackRow').hidden = !this.checked; });
      $('mrWDays').addEventListener('click', function (ev) {
        var c = ev.target.closest('[data-d]');
        if (!c) return;
        c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
        $('mrDlgExtra').dispatchEvent(new Event('change'));
      });
      mrGhostStart(function () { return form(false); });
    }
  });
  // The routine as the dialog has it: a copy, so the preview never changes the saved one.
  function form(saving) {
    var d = JSON.parse(JSON.stringify(r)), name = $('mrRName').value.trim(), mode = $('mrRMode').value;
    var f = $('mrWFrom').value, to = $('mrWTo').value;
    if (f && to && f > to) { if (saving) toast('The period ends before it starts'); return null; }
    var w = Object.assign({}, d.when);
    if (f) w.from = f; else delete w.from;
    if (to) w.to = to; else delete w.to;
    mrDaysInto(w);
    if (Object.keys(w).length) d.when = w; else delete d.when;
    if (name) d.name = name; else delete d.name;
    d.then = Object.assign({}, d.then);
    if (mode) d.then.mode = mode; else delete d.then.mode;
    if ($('mrRBoth').checked) {
      d.both_ways = true;
      // The trips back: their own time window, else the one there.
      var rw = Object.assign({}, d.return_when), b0 = $('mrWB0').value, b1 = $('mrWB1').value;
      if (b0 && b1) rw.time = [b0, b1]; else delete rw.time;
      if (Object.keys(rw).length) d.return_when = rw; else delete d.return_when;
    } else { delete d.both_ways; delete d.return_when; }
    if ($('mrRForce').checked) d.force = true; else delete d.force;
    var ef = +$('mrREndFrom').value, et = +$('mrREndTo').value;
    $('mrREndFromV').textContent = dist(ef / 1000); $('mrREndToV').textContent = dist(et / 1000);
    if (ef !== et) d.radius_m = { from: ef, to: et }; else if (ef !== MR_END_M) d.radius_m = ef; else delete d.radius_m;
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
  ['restaurant', 'Restaurant'], ['cafe', 'Bar / café'], ['supermarket', 'Supermarket'], ['store', 'Store'], ['transit', 'Transport stop'], ['airport', 'Airport']];
// Each kind of place: its name and icon, for pins, the places list and Time by kind of place.
var MR_KIND = { home: ['Home', 'home'], work: ['Work', 'work'], school: ['School', 'school'], family: ['Family', 'home'], friends: ['Friends', 'friends'], sport: ['Sport', 'basketball'],
  restaurant: ['Restaurant', 'restaurant'], cafe: ['Bar / café', 'cafe'], supermarket: ['Supermarket', 'cart'], store: ['Store', 'store'], transit: ['Transport stop', 'BUS'], airport: ['Airport', 'FLYING'] };
function mrKindName(role) { return MR_KIND[role] ? MR_KIND[role][0] : role ? role.charAt(0).toUpperCase() + role.slice(1) : ''; }
// How a place looks wherever it's shown (pins, lists, its page): the icon of its kind, in the sunrise
// colour when it's your current home, work or school, teal when you named it, grey otherwise.
function mrLook(r, home) {
  var ic = r && MR_KIND[r.role] ? MR_KIND[r.role][1] : home ? 'home' : 'pin';
  return { ic: r && r.hide ? 'shield' : ic, bg: home || mrIsCurrent(r) ? 'var(--accent)' : r ? '#0f7c8c' : 'var(--m-other)' };
}
function spotLook(s) {
  var st = spotStop(s);
  // A stop from the station packs or an airport looks like a place you gave that kind.
  return st ? { ic: st.ic, bg: '#0f7c8c' } : mrLook(mrRuleOf(s), s.home);
}
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
  var r = mrSpotRule(key), st = !r && spotStop((spotsOf(spotStays(key))[0]) || null);
  return '<h4 class="place-h">Name</h4>' + (r ? '<p class="fine">Named <b>' + esc(r.name || r.role) + '</b> in MyRules: everything within ' + fmt(+r.radius_m || 100) + ' m' + (r.role ? ', as ' + (MR_LIFE[r.role] ? (mrIsPast(r) ? 'past ' : 'current ') : '') + esc(mrKindName(r.role).toLowerCase()) + (mrIsPast(r) ? ' until ' + niceDate(mrDayNum(r.when.to)) : '') : '') + (r.hide ? ', hidden from the map' : '') + (r.enabled === false ? ' (switched off)' : '') + '.</p>' : (st ? '<p class="fine">' + (st.airport ? 'Within ' + dist(Math.max(st.d, 0.1)) + ' of <b>' + esc(st.name) + '</b> (from OurAirports), so it counts as an airport.' : esc(st.kind) + ' <b>' + esc(st.name) + '</b> in your station packs (OpenStreetMap), so it counts as a transport stop.') + ' Name it yourself to change that.</p>' : '<p class="fine">Give this place your own name, and choose how far around it counts as this place.</p>')) +
    '<div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="btn" data-mr-place="' + esc(key) + '">' + icon('pin') + (r ? 'Edit this place' : 'Name this place') + '</button></div>';
}
function mrPlaceDialog(key) {
  var r = mrSpotRule(key), c = r ? r.at : mrSpotCentre(key), s = spotsOf(spotStays(key))[0] || {};
  if (!c) return;
  var st = !r && s.key && spotStop(s);
  var nm = r ? r.name || '' : s.name || (st ? st.name : ''), role = r ? r.role || '' : s.home ? 'home' : st ? st.role : '', rad = r ? +r.radius_m || 100 : 100;
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
    side: true,
    title: 'Same on other days?',
    text: 'You made <b>' + fmt(x.there.length) + '</b> trips like this from ' + esc(A) + ' to ' + esc(B) + (x.wk ? ' on weekdays' : ' at weekends') + ' around ' + fmtMin(m0) +
      (x.back.length ? ', and ' + fmt(x.back.length) + ' back' : '') + '. Your files have them as ' + Object.keys(modes).map(function (m) { return esc(m.toLowerCase()) + ' (' + fmt(modes[m]) + ')'; }).join(', ') + '.',
    extra: '<div class="mr-form">' + mrGhostHtml() +
      '<span class="mr-dates">From <input type="date" id="mrRFrom" value="' + isoDay(d0) + '" aria-label="From"> to <input type="date" id="mrRTo" value="' + isoDay(d1) + '" aria-label="To (empty: until now)"></span>' +
      '<span class="mr-dates">Leaving between <input type="time" id="mrRT0" value="' + mrHm(m0 - 90) + '" aria-label="Earliest start"> and <input type="time" id="mrRT1" value="' + mrHm(m0 + 90) + '" aria-label="Latest start"></span>' +
      (x.back.length ? '<label class="mr-opt"><input type="checkbox" id="mrRBoth"' + (x.back.length >= 3 ? ' checked' : '') + '><span><b>Both ways</b><span class="mr-dates">Back between <input type="time" id="mrRB0" value="' + (mb != null ? mrHm(mb - 120) : '15:00') + '" aria-label="Earliest return"> and <input type="time" id="mrRB1" value="' + (mb != null ? mrHm(mb + 120) : '20:00') + '" aria-label="Latest return"></span></span></label>' : '') +
      '<label class="mr-opt"><input type="checkbox" id="mrRForce"><span><b>Also where your files recorded another type</b><small class="fine">Off: only trips whose type was missing or guessed from speed.</small></span></label>' +
      '<label class="mr-opt"><input type="checkbox" id="mrRSnap"' + (MR_RAIL[mode] ? ' checked' : '') + '><span><b>Draw them along one line</b><small class="fine">From one of these trips, or from OpenStreetMap for public transport. Trips that don\'t follow it closely enough keep their own.</small></span></label></div>',
    buttons: [['Make a routine', 'primary', function () { mrSaveRoutine(i, mode, x, A, B); }], ['Not now', 'quiet', null]],
    after: function () { mrGhostStart(function () { return mrOfferDraft(i, mode, x, A, B); }); },
    note: 'Saved in MyRules. What it fills in is marked Rule applied, and you can leave out any trip.'
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
  var out = { trips: [], change: 0, dir: {}, left: 0 };
  var a = mrEnd(r.from, mrEndM(r, 'from')), b = mrEnd(r.to, mrEndM(r, 'to'));
  if (!D || !a || !b) return out;
  var w = mrWhen(r.when), x = { r: r, a: a, b: b, w: w, rw: r.return_when ? mrWhen(Object.assign({}, r.when, r.return_when)) : w, ex: mrExcept(r), then: r.then && typeof r.then === 'object' ? r.then : {} };
  var m = r.then && r.then.mode, mi = m != null ? MODE_IDX[m] : null, base = D.base || D;
  for (var i = 0; i < D.day.length; i++) {
    if (isDup(i) || MODES[base.mode[i]] === 'FLYING') continue;
    var dr = mrRouteDir(x, i);
    if (!dr) continue;
    if (mrUnfit(x, i)) { out.left++; continue; }
    out.trips.push(i); out.dir[i] = dr;
    if (mi != null && mi !== base.mode[i]) out.change++;
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
    '<div class="mr-osm" id="mrOsm" hidden><button type="button" class="btn" id="mrOsmBtn">' + icon('map') + 'Use the line from OpenStreetMap</button>' +
    '<select id="mrOsmSel" aria-label="OpenStreetMap line" hidden></select><small class="fine" id="mrOsmTxt"></small></div>' +
    '<label class="field mr-match" id="mrMatchRow" hidden><span>Follows the line for at least <b class="num" id="mrMatchV"></b></span>' +
    '<input type="range" id="mrMatch" min="10" max="100" step="5" value="' + MR_MATCH + '"></label>' +
    '<small class="fine" id="mrGhostTxt"></small></div>';
}
// A learned line (not one from a polyline or a GeoJSON file)?
function mrLearned(sn) { return !!sn && !(typeof sn === 'object' && (sn.polyline || sn.geojson)); }
// The trip you chose with the arrows, written into the routine the dialog makes.
// Also the match slider, and a line from OpenStreetMap.
function mrGhostSnap(d) {
  if (!d || !MR_GHOST || !d.then || !d.then.snap) return d;
  var mm = $('mrMatch');
  if (mm && MR_GHOST.match != null) { if (MR_GHOST.match === MR_MATCH) delete d.then.match; else d.then.match = MR_GHOST.match; }
  if (MR_GHOST.osm) { d.then.snap = { polyline: MR_GHOST.osm.polyline, osm: { relation: MR_GHOST.osm.id, name: MR_GHOST.osm.name } }; return d; }
  if (MR_GHOST.pick === undefined) return d;
  var i = MR_GHOST.pick;
  d.then.snap = i == null ? 'learn' : { trip: { start: mrIsoLocal(i), mode: MODES[(D.base || D).mode[i]] } };
  return d;
}
// OpenStreetMap's public transport routes for each type, and the line of one between two ends: the
// route relations near both (Overpass), each one's ways joined in order, cut between the points
// nearest the two ends. Only the two ends go to Overpass, and only when you ask.
var MR_OSM_ROUTES = { TRAIN: 'train|light_rail', TRAM: 'tram|light_rail', SUBWAY: 'subway|light_rail', BUS: 'bus|trolleybus', FERRY: 'ferry' };
function mrOsmLines(mode, a, b) {
  var R = MR_OSM_ROUTES[mode];
  if (!R) return Promise.resolve([]);
  var q = '[out:json][timeout:40];rel(around:600,' + a[0].toFixed(5) + ',' + a[1].toFixed(5) + ')[type=route][route~"^(' + R + ')$"]->.a;' +
    'rel(around:600,' + b[0].toFixed(5) + ',' + b[1].toFixed(5) + ')[type=route][route~"^(' + R + ')$"]->.b;rel.a.b;out geom;';
  return fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function (j) {
      var out = [];
      (j.elements || []).forEach(function (el) {
        var line = mrOsmJoin(el.members || []);
        if (line.length < 2) return;
        var ia = mrToLine(a, line), ib = mrToLine(b, line);
        if (ia.d > 1 || ib.d > 1 || ia.k === ib.k) return;
        var seg = ia.k < ib.k ? line.slice(ia.k, ib.k + 1) : line.slice(ib.k, ia.k + 1).reverse(), len = 0;
        for (var k = 1; k < seg.length; k++) len += km(seg[k - 1], seg[k]);
        var t = el.tags || {};
        out.push({ id: el.id, name: [t.ref, t.name || t.from && t.to && t.from + ' – ' + t.to].filter(Boolean).join(' · ') || 'Route ' + el.id, pts: seg, km: len, off: ia.d + ib.d, polyline: mrEncodePolyline(seg) });
      });
      // The same line in both directions or on several routes: keep one, closest to the ends first.
      out.sort(function (x, y) { return x.off - y.off || x.km - y.km; });
      var seen = {};
      return out.filter(function (x) { var k = x.polyline.length + ':' + Math.round(x.km * 10); if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 8);
    });
}
// A relation's ways (stops and platforms left out) joined into one line, each turned to follow on.
function mrOsmJoin(members) {
  var line = [], n = 0;
  members.forEach(function (m) {
    if (m.type !== 'way' || !m.geometry || /stop|platform/.test(m.role || '')) return;
    var g = m.geometry.map(function (p) { return [p.lat, p.lon]; });
    if (g.length < 2) return;
    if (!n++) { line = g; return; }
    var e = line[line.length - 1], st = line[0], last = g[g.length - 1];
    // The first way may run the other way round: turned once the second shows which end goes on.
    if (n === 2 && Math.min(km(st, g[0]), km(st, last)) < Math.min(km(e, g[0]), km(e, last))) { line.reverse(); e = line[line.length - 1]; }
    if (km(e, last) < km(e, g[0])) g.reverse();
    line = line.concat(km(e, g[0]) < 0.001 ? g.slice(1) : g);
  });
  return line;
}
function mrEncodePolyline(pts) {
  var out = '', pl = 0, pg = 0;
  function enc(v) { v = v < 0 ? ~(v << 1) : v << 1; var s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); }
  pts.forEach(function (p) { var la = Math.round(p[0] * 1e5), lo = Math.round(p[1] * 1e5); out += enc(la - pl) + enc(lo - pg); pl = la; pg = lo; });
  return out;
}
// draft() builds the routine from the dialog as it is now.
// The ghosts off the map: the main map gets its layers back and its view back (back: when the
// panel closes), the small map is removed.
var MR_GHOST_R = null;
function mrGhostClear(back) {
  if (!MR_GHOST || !MR_GHOST.map) return;
  if (MR_GHOST.main) {
    MR_GHOST.layer.remove(); MR_GHOST.dim.remove();
    MR_GHOST.map = null;
    // The other layers back.
    layerToggles();
    if (back && MR_GHOST.view) map.setView(MR_GHOST.view.c, MR_GHOST.view.z);
  } else MR_GHOST.map.remove();
  MR_GHOST.map = null;
}
function mrGhostStart(draft) {
  var el = $('mrGhostMap'), view = MR_GHOST && MR_GHOST.main && MR_GHOST.map ? MR_GHOST.view : null;
  mrGhostClear();
  MR_GHOST = { map: null, first: true, pick: undefined, cands: [] };
  if (!el) return;
  if (!window.L || !D) el.hidden = true;
  else if (MR_SIDE) {
    // The panel: the main map, dimmed, with the ghosts in a pane of their own above the trips.
    el.hidden = true;
    if (!map.getPane('mrg')) { map.createPane('mrg'); map.getPane('mrg').style.zIndex = 460; }
    if (!MR_GHOST_R) MR_GHOST_R = L.svg({ pane: 'mrg' });
    MR_GHOST.main = true; MR_GHOST.map = map;
    MR_GHOST.view = view || { c: map.getCenter(), z: map.getZoom() };
    MR_GHOST.dim = L.rectangle([[-89, -720], [89, 720]], { pane: 'mrg', renderer: MR_GHOST_R, stroke: false, fillColor: cssVar('--bg') || '#f7f2ee', fillOpacity: .72, interactive: false }).addTo(map);
    MR_GHOST.layer = L.layerGroup().addTo(map);
    // The other layers off while the ghosts are shown (layerToggles keeps them off).
    layerToggles();
  } else {
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
  // On the main map every ghost layer goes in its pane, and a tap on one stays with it.
  function o(x) { return MR_GHOST.main ? L.Util.extend({ pane: 'mrg', renderer: MR_GHOST_R, bubblingMouseEvents: false }, x) : x; }
  function draw() {
    var r = mrGhostSnap(draft());
    if (!r) return;
    var res = mrRoutineTrips(r), col = colour(r), sn = r.then && r.then.snap, line = null, from = null, W = null, mode = r.then && r.then.mode;
    // The line it would draw its trips along, and the trips it could learn it from.
    MR_GHOST.cands = [];
    if (sn && !mrLearned(sn)) line = mrRouteLine({ then: r.then }, res.trips);
    else if (sn) {
      W = mrWays(res.trips);
      MR_GHOST.cands = W.map(function (w) { return w.i; });
      from = typeof sn === 'object' && sn.trip ? mrRefTrips(sn.trip)[0] : MR_GHOST.cands[0];
      if (from != null) line = { pts: mrTripPts(from), from: from };
    }
    var pk = $('mrPick'), k = -1, osm = sn && typeof sn === 'object' && sn.osm;
    if (W && from != null) W.forEach(function (w, j) { if (w.all.indexOf(from) >= 0) k = j; });
    MR_GHOST.k = k;
    pk.hidden = !sn || (!mrLearned(sn) && !MR_GHOST.cands.length && !osm);
    if (!pk.hidden) {
      var nw = W ? W.length : 0, ways = W && W[k] ? W[k].all.length : 0, rec = from != null && from === MR_GHOST.cands[0], inRes = from != null && res.dir[from];
      $('mrPickTxt').innerHTML = osm ? '<b>OpenStreetMap line</b><small class="fine">' + esc(osm.name || '') + '</small>' : from == null ? 'No trip with 5 or more GPS points to take the line from' :
        (nw > 1 && k >= 0 ? '<b>Way ' + fmt(k + 1) + ' of ' + fmt(nw) + '</b> · ' + fmt(ways) + ' trip' + (ways === 1 ? '' : 's') + (k === 0 && rec ? ' · recommended' : '') : rec ? '<b>Recommended line</b>' : '<b>Your chosen line</b>') +
        '<small class="fine">' + (nw === 1 && k === 0 && rec ? 'Your ' + fmt(ways) + ' trips here all take this way. ' : !inRes ? 'Its trip isn\'t in this period. ' : '') + 'From the trip on ' + esc(mrWhere(from)) + '. Tap a ghost to use that trip instead.</small>';
      $('mrPickPrev').disabled = $('mrPickNext').disabled = !osm && nw < 2 && k >= 0;
      $('mrPickRec').hidden = !osm && (rec || from == null || !MR_GHOST.cands.length);
    }
    // OpenStreetMap: for public transport, once there is a type.
    $('mrOsm').hidden = !sn || !MR_OSM_ROUTES[mode];
    var sel = $('mrOsmSel');
    sel.hidden = !MR_GHOST.osmList || MR_GHOST.osmList.length < 2 || !osm;
    // The match slider, and each trip's match with the line in use (kept while only the slider moves).
    var min = mrMatchMin(r.then), sc = {};
    $('mrMatchRow').hidden = !sn || !line || !line.pts;
    if (MR_GHOST.match == null) $('mrMatch').value = min;
    $('mrMatchV').textContent = min + '%';
    var lkey = line && line.pts ? line.pts.length + ':' + line.pts[0] + ':' + line.pts[line.pts.length - 1] : '', ink = 0, outk = 0;
    if (MR_GHOST.lkey !== lkey) { MR_GHOST.lkey = lkey; MR_GHOST.sc = {}; }
    var inc = mrIncluded(r);
    res.trips.forEach(function (i) {
      if (!lkey || line.from === i) { sc[i] = 100; ink++; return; }
      var v = MR_GHOST.sc[i];
      if (v == null) v = MR_GHOST.sc[i] = mrSnapTrip(i, line.pts) ? mrLineScore(i, line.pts) : -1;
      sc[i] = v;
      if (v >= min || v >= 0 && inc[i]) ink++; else outk++;
    });
    $('mrGhostTxt').innerHTML = (res.trips.length ? '<b class="num">' + fmt(lkey ? ink : res.trips.length) + '</b> ' + ((lkey ? ink : res.trips.length) === 1 ? 'trip' : 'trips') + (lkey ? ' follow the line closely enough' : ' covered, shown as ghosts') +
      (lkey && outk ? ' · ' + fmt(outk) + ' below, dashed' : '') +
      (mode ? ' · ' + fmt(res.change) + ' would become ' + esc((LABEL[mode] || mode).toLowerCase()) : '') : 'No trips covered with these settings.') +
      (res.left ? ' · ' + fmt(res.left) + ' left out: your files give them another type or gear' : '');
    if (!MR_GHOST.map) return;
    MR_GHOST.layer.clearLayers();
    var bounds = L.latLngBounds([]);
    // At most 400 ghosts: enough to see the pattern, light enough to redraw while typing. Tap one to
    // make it the line.
    res.trips.slice(-400).forEach(function (i) {
      if (line && i === line.from) return;
      var pts = mrTripPts(i);
      if (pts.length < 2) pts = [[D.from[2 * i], D.from[2 * i + 1]], [D.to[2 * i], D.to[2 * i + 1]]];
      pts = pts.filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); });
      if (pts.length < 2) return;
      var below = lkey && !(sc[i] >= min || sc[i] >= 0 && inc[i]);
      L.polyline(pts, o(below ? { color: '#8a8f8c', weight: 2.5, opacity: .45, dashArray: '4 5' } : { color: col, weight: 3, opacity: MR_GHOST.main ? .35 : .22 }))
        .on('click', function () { MR_GHOST.pick = i; MR_GHOST.osm = null; draw(); }).addTo(MR_GHOST.layer);
      bounds.extend(pts[0]); bounds.extend(pts[pts.length - 1]);
    });
    // The line in use, always on top: solid, with a white edge so it stands out of the ghosts.
    if (line && line.pts && line.pts.length > 1) {
      L.polyline(line.pts, o({ color: '#fff', weight: 8, opacity: .95, interactive: false })).addTo(MR_GHOST.layer);
      L.polyline(line.pts, o({ color: col, weight: 4.5, opacity: 1, interactive: false })).addTo(MR_GHOST.layer);
      line.pts.forEach(function (p) { bounds.extend(p); });
    }
    [mrEnd(r.from, mrEndM(r, 'from')), mrEnd(r.to, mrEndM(r, 'to'))].forEach(function (e) {
      if (!e) return;
      // How far from it a trip may start or end.
      L.circle(e.at, o({ radius: e.rad * 1000, color: '#0f7c8c', weight: 1.5, opacity: .8, fillColor: '#0f7c8c', fillOpacity: .08, dashArray: '4 4', interactive: false })).addTo(MR_GHOST.layer);
      L.circleMarker(e.at, o({ radius: 6, color: '#fff', weight: 2, fillColor: '#0f7c8c', fillOpacity: 1, interactive: false })).addTo(MR_GHOST.layer);
      bounds.extend(e.at);
    });
    // Framed once, on the ends and the trips; later changes keep your view.
    if (MR_GHOST.first && bounds.isValid()) {
      MR_GHOST.first = false;
      // On the main map, framed in the part the panel leaves free.
      if (MR_GHOST.main) MR_GHOST.map.fitBounds(bounds, { paddingTopLeft: [40, 40], paddingBottomRight: [$('mrDlg').offsetWidth + 40, 40], maxZoom: 15 });
      else { MR_GHOST.map.invalidateSize(); MR_GHOST.map.fitBounds(bounds, { padding: [20, 20], maxZoom: 15, animate: false }); }
    }
  }
  // The arrows: the next or previous way, round and round (or OpenStreetMap line). Recommended: back
  // to the best trip of the way most trips take, worked out again from your data each time ("learn").
  function step(by) {
    var L2 = MR_GHOST.osm && MR_GHOST.osmList;
    if (L2 && L2.length > 1) { var o = (L2.indexOf(MR_GHOST.osm) + by + L2.length) % L2.length; MR_GHOST.osm = L2[o]; $('mrOsmSel').value = o; draw(); return; }
    var c = MR_GHOST.cands, n = c.length, k = MR_GHOST.k;
    if (!n) return;
    var j = k < 0 ? 0 : (k + by + n) % n;
    MR_GHOST.pick = j === 0 ? null : c[j]; MR_GHOST.osm = null;
    draw();
  }
  $('mrPickPrev').onclick = function () { step(-1); };
  $('mrPickNext').onclick = function () { step(1); };
  $('mrPickRec').onclick = function () { MR_GHOST.pick = null; MR_GHOST.osm = null; draw(); };
  $('mrMatch').oninput = function () { MR_GHOST.match = +this.value; draw(); };
  $('mrOsmSel').onchange = function () { MR_GHOST.osm = MR_GHOST.osmList[+this.value]; draw(); };
  $('mrOsmBtn').onclick = function () {
    var r = draft(), a = r && mrEnd(r.from), b = r && mrEnd(r.to), m = r && r.then && r.then.mode, btn = this;
    if (!a || !b || !MR_OSM_ROUTES[m]) return;
    // With a station pack for the country of either end, the line comes only from the packs,
    // offline, with every distinct way to pick from (packLines); OpenStreetMap is asked online only
    // where you have no pack, or for buses and ferries, which packs don't have.
    var lab = (LABEL[m] || m).toLowerCase(), packed = PACK_MODE_BITS[m] && [a.at, b.at].some(function (p) { return !!PACKS[countryAt(p[0], p[1])]; });
    var local = PACK_MODE_BITS[m] ? packLines(m, a.at, b.at) : [];
    if (packed && !local.length) { $('mrOsmTxt').textContent = 'Your station packs have no ' + lab + ' line within 2 km of both ends. Move an end closer to a station.'; return; }
    btn.disabled = true;
    if (!local.length) $('mrOsmTxt').textContent = 'Asking OpenStreetMap for ' + lab + ' lines between the two ends…';
    (local.length ? Promise.resolve(local) : mrOsmLines(m, a.at, b.at)).then(function (list) {
      btn.disabled = false;
      if (!MR_GHOST) return;
      if (!list.length) { $('mrOsmTxt').textContent = 'OpenStreetMap has no ' + lab + ' line passing near both ends.'; return; }
      MR_GHOST.osmList = list; MR_GHOST.osm = list[0]; MR_GHOST.pick = undefined;
      $('mrOsmSel').innerHTML = list.map(function (x, k) { return '<option value="' + k + '">' + esc(x.name) + ' · ' + dist(x.km) + '</option>'; }).join('');
      if (local.length) $('mrOsmTxt').textContent = (list.length > 1 ? list.length + ' ways along the ' + (m === 'TRAIN' ? 'railway' : 'lines') + ' from your ' + packNames(local[0].packs) + ' station pack' + (local[0].packs.length > 1 ? 's' : '') + ': pick one (the arrows step through them too).' : 'Line drawn along the ' + (m === 'TRAIN' ? 'railway' : 'lines') + ' from your ' + packNames(local[0].packs) + ' station pack' + (local[0].packs.length > 1 ? 's' : '') + '.') + ' Saved with the routine.';
      else $('mrOsmTxt').textContent = list.length === 1 ? 'Line found. Saved with the routine.' : list.length + ' lines found: pick one. Saved with the routine.';
      draw();
    }).catch(function () { btn.disabled = false; $('mrOsmTxt').textContent = 'OpenStreetMap couldn\'t be reached. Check your connection and try again.'; });
  };
  var box = $('mrDlgExtra'), tm = null;
  function later() { clearTimeout(tm); tm = setTimeout(draw, 150); }
  box.oninput = later; box.onchange = later;
  setTimeout(function () { if (MR_GHOST.map && !MR_GHOST.main) MR_GHOST.map.invalidateSize(); draw(); }, 0);
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


// ---------- rules in these trips ----------
// The last line of Filters says how many gear periods and routines changed the trips the filters
// show; Show rules lists them, each with Turn off for these trips. That writes the filters as an
// unless condition on the rule (dates, years, months, days of the week, time of day, countries), so
// trips like these, loaded now or later, are left alone; or, with Just these trips, the trips
// themselves into its except. Transport, gear, source and guessed filters aren't part of it: a rule
// only touches its own type anyway, and the gear filter is often how the rule's trips were found.
var MR_VER = '0.2', MR_SCHEMA = 'https://bluehair-co.github.io/btdt/schema/myrules-0.2.json';
// The gear periods and routines that changed a trip shown now, most trips first, each with its trips.
function mrHere() {
  var by = {}, j, i;
  if (!MR || !MR.on || !D || !D.mrGear) return [];
  function add(id, i) { var r = mrById(id); if (!r) return; var x = by[id] || (by[id] = { r: r, trips: [], seen: {} }); if (!x.seen[i]) { x.seen[i] = 1; x.trips.push(i); } }
  var gearIds = {}; mrList('gear').forEach(function (r) { gearIds[r.id] = 1; });
  for (j = 0; j < sel.length; j++) {
    i = sel[j];
    var g = D.mrGear[i], rt = D.mrRoute && D.mrRoute[i];
    if (g && !g.cor && gearIds[g.rule]) add(g.rule, i);
    if (rt) add(rt.rule, i);
  }
  return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.trips.length - a.trips.length; });
}
// The filters as an unless condition, with its parts in words; cond is null when no filter that can
// be written into a rule is on.
function mrFilterCond() {
  var c = {}, words = [], a, b;
  if (F.dm === 'one' || F.dm === 'range' || F.dm === 'week') {
    a = F.dm === 'one' ? (F.unit === 'day' ? F.one : periodStart(F.one, F.unit)) : F.from;
    b = F.dm === 'one' ? (F.unit === 'day' ? F.one : periodEnd(F.one, F.unit)) : F.to;
    c.from = isoDay(a); c.to = isoDay(b);
    words.push(a === b ? niceDate(a) : fmtRange(a, b));
  }
  if (F.years.size !== M.years.length) { c.years = M.years.filter(function (y) { return F.years.has(y); }); words = words.concat(c.years.map(String)); }
  if (F.months.size !== 12) {
    c.months = []; for (var m = 0; m < 12; m++) if (F.months.has(m)) c.months.push(m + 1);
    words = words.concat(c.months.map(function (m) { return MONTHS[m - 1]; }));
  }
  if (F.dows.size !== 7) {
    var ds = DOW_ORDER.filter(function (d) { return F.dows.has(d); });
    c.days = ds.map(function (d) { return MR_DOW[d]; });
    words = words.concat(ds.map(function (d) { return DOW[d]; }));
  }
  if (F.h0 !== 0 || F.h1 !== 24) {
    c.time = [pad2(F.h0) + ':00', pad2((F.h1 + 23) % 24) + ':59'];
    words.push(fmtHour(F.h0) + '–' + fmtHour(F.h1 % 24));
  }
  if (F.countries.size !== M.countries.length) {
    var cs = M.countries.filter(function (k) { return F.countries.has(k); });
    c.countries = cs.map(function (k) { return D.ccList[k]; }).filter(Boolean);
    words = words.concat(cs.map(function (k) { return ccName(D.ccList[k]); }));
  }
  return { cond: Object.keys(c).length ? c : null, words: words };
}
// An unless condition in words: "Sat, Sun · 18:00–00:00 · Spain".
function mrUnlessText(u) {
  var bits = [], f = mrDayNum(u.from), t = mrDayNum(u.to);
  if (f != null || t != null) bits.push(f != null && t != null ? (f === t ? niceDate(f) : fmtRange(f, t)) : f != null ? 'Since ' + niceDate(f) : 'Until ' + niceDate(t));
  if (Array.isArray(u.years) && u.years.length) bits.push(u.years.join(', '));
  if (Array.isArray(u.months) && u.months.length) bits.push(u.months.map(function (m) { return MONTHS[m - 1] || m; }).join(', '));
  var dk = Array.isArray(u.days) ? u.days.map(function (d) { return String(d).slice(0, 3); }).sort().join() : '';
  if (dk === 'fri,mon,thu,tue,wed') bits.push('weekdays');
  else if (dk === 'sat,sun') bits.push('weekends');
  else if (Array.isArray(u.days) && u.days.length) bits.push(u.days.map(function (d) { var k = MR_DOW.indexOf(String(d).slice(0, 3)); return k >= 0 ? DOW[k] : d; }).join(', '));
  if (Array.isArray(u.time) && u.time.length === 2) { var a = mrMin(u.time[0]), b = mrMin(u.time[1]); bits.push(a == null || b == null ? u.time.join('–') : fmtMin(a) + '–' + fmtMin(b + 1)); }
  if (Array.isArray(u.countries) && u.countries.length) bits.push(u.countries.map(function (c) { return ccName(String(c).toUpperCase()); }).join(', '));
  return bits.join(' · ') || 'Always';
}
function mrRuleLook(r) {
  if (mrList('gear').indexOf(r) >= 0) {
    return { ic: r.kind === 'strida' ? 'strida' : r.kind === 'halfbike' ? 'halfbike' : r.kind === 'cargo' ? 'cargobike' : r.kind === 'ebike' ? 'ebike' : r.mode, color: modeColor(r.mode || 'CYCLING'), kind: 'Gear period', gear: true };
  }
  var t = r.then || {};
  return { ic: t.mode || 'OTHER', color: t.mode ? modeColor(t.mode) : '#9aa49d', kind: 'Routine', gear: false };
}
// The last line of Filters, drawn again each time the filters are applied.
function mrHereLine() {
  var L = mrHere(), all = {}, sec = $('mrHereSec');
  L.forEach(function (x) { x.trips.forEach(function (i) { all[i] = 1; }); });
  var n = Object.keys(all).length;
  sec.hidden = !L.length;
  if (L.length) $('mrHereTxt').innerHTML = '<b>' + L.length + ' rule' + (L.length === 1 ? '' : 's') + '</b> changed ' + fmt(n) + ' of the trips shown.';
  if (openId === 'mrHereSheet') mrRenderHere(L);
}
function mrRenderHere(L) {
  L = L || mrHere();
  var shown = {};
  for (var j = 0; j < sel.length; j++) { var m = MODES[D.mode[sel[j]]]; shown[m] = (shown[m] || 0) + 1; }
  $('mrHereLead').textContent = filterText() + ' · ' + tripsText(sel.length) + '. ' + (L.length ? 'The rules below changed some of them. Turning one off here keeps it for every other trip.' : 'No gear period or routine changed any of them.');
  $('mrHereList').innerHTML = L.map(function (x) {
    var r = x.r, lk = mrRuleLook(r), n = x.trips.length;
    var what = lk.gear ? 'Gear on <b class="num">' + fmt(n) + '</b> of the ' + fmt(shown[r.mode] || n) + ' ' + esc((LABEL[r.mode] || r.mode || '').toLowerCase()) + ' trips shown' : 'Matched <b class="num">' + fmt(n) + '</b> of the trips shown';
    return '<div class="mr-rule mr-here"><span class="mode-badge sm" style="background:' + lk.color + '">' + icon(lk.ic) + '</span>' +
      '<span class="file-txt"><b>' + esc(r.name || r.id) + '</b><small>' + lk.kind + ' · ' + mrWhenText(r.when) + '<br>' + what + '</small></span>' +
      '<button type="button" class="btn" data-mr-off="' + esc(r.id) + '">Turn off for these trips</button></div>';
  }).join('');
}
function mrOpenHere() { mrRenderHere(); openSheet('mrHereSheet'); }
$('mrHereBtn').addEventListener('click', mrOpenHere);
$('mrHereBack').addEventListener('click', function () { openSheet('filtersSheet'); });
$('mrHereAll').addEventListener('click', function () { mrRenderRules(); openSheet('mrSheet'); });
$('mrHereList').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-mr-off]');
  if (b) mrTurnOffHere(b.dataset.mrOff);
});
// Turn off for these trips: the filters as a condition on the rule (the default, when any filter
// can be written down), or just the trips shown, one by one, in its except.
function mrTurnOffHere(id) {
  var x = mrHere().filter(function (y) { return y.r.id === id; })[0];
  if (!x) return;
  var r = x.r, n = x.trips.length, fc = mrFilterCond(), lk = mrRuleLook(r), name = r.name || r.id;
  var noun = lk.gear && r.mode === 'CYCLING' ? 'rides' : 'trips', what = n === 1 ? noun.replace(/s$/, '') : noun;
  var chips = fc.words.map(function (w) { return '<span class="chip" aria-pressed="true" style="pointer-events:none">' + esc(w) + '</span>'; }).join(' ');
  var extra = '<div class="mr-form">' + (fc.cond ? '<p class="fine mr-here-f">Your filters: ' + chips + '</p>' +
    '<label class="mr-opt"><input type="radio" name="mrOffHow" value="cond" checked><span><b>' + (noun === 'rides' ? 'Rides' : 'Trips') + ' like these: ' + esc(mrUnlessText(fc.cond)) + '</b><small class="fine">Saved on the rule as “not on ' + esc(mrUnlessText(fc.cond)) + '”. ' + (noun === 'rides' ? 'Rides' : 'Trips') + ' loaded later follow it too.</small></span></label>' : '') +
    '<label class="mr-opt"><input type="radio" name="mrOffHow" value="trips"' + (fc.cond ? '' : ' checked') + '><span><b>Just ' + (n === 1 ? 'this ' : 'these ') + fmt(n) + ' ' + what + '</b><small class="fine">Saved as the rule\'s exceptions, one per ' + what.replace(/s$/, '') + '. Nothing else changes.</small></span></label></div>';
  mrAsk({
    title: 'Turn off ' + name + ' for these trips?',
    text: lk.gear ? 'It gave gear to <b>' + fmt(n) + '</b> ' + what + ' in what the filters show now. They\'ll have no gear, unless another rule fits them.'
      : 'It matched <b>' + fmt(n) + '</b> ' + what + ' in what the filters show now. They\'ll be as your files have them, unless another rule fits them.',
    extra: extra,
    note: (fc.cond ? 'Transport and gear filters aren\'t part of it: the rule only touches ' + esc((LABEL[lk.gear ? r.mode : (r.then || {}).mode] || 'its own type').toLowerCase()) + ' anyway. ' : 'No date, day, time or country filter is on, so only the trips themselves can be saved. ') + 'Undo it from the rule in MyRules.',
    buttons: [['Turn off for ' + fmt(n) + ' ' + what, 'primary', function () {
      var how = (document.querySelector('input[name=mrOffHow]:checked') || {}).value;
      if (how === 'cond' && fc.cond) {
        (r.unless || (r.unless = [])).push(fc.cond);
        mrUseV2();
        mrChange(name + ' turned off for ' + mrUnlessText(fc.cond));
      } else {
        var ex = r.except || (r.except = []), have = mrExcept(r);
        x.trips.forEach(function (i) { if (!have[i]) ex.push({ start: mrIsoLocal(i), mode: MODES[D.base.mode[i]] }); });
        mrChange(name + ' turned off for ' + fmt(n) + ' ' + what);
      }
      toast(name + ' is off for ' + fmt(n) + ' ' + what + '.');
    }], ['Cancel', 'quiet', null]]
  });
}
// A file with an unless is version 0.2 (0.2 only adds unless to 0.1).
function mrUseV2() {
  var v = String(MR.doc.myrules || '0.1').split('.');
  if (v[0] === '0' && +v[1] < 2) { MR.doc.myrules = MR_VER; if (!MR.doc.$schema || /myrules-0\.1\.json$/.test(MR.doc.$schema)) MR.doc.$schema = MR_SCHEMA; }
}
