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
var MR_SECTIONS = ['places', 'moves', 'gear', 'routines', 'snaps', 'corrections', 'gps_spots'];
var MR_DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
var MR_KINDS = { bike: 'Bike', strida: 'Strida', halfbike: 'Halfbike', cargo: 'Cargo bike', ebike: 'E-bike', shoe: 'Shoes',
  car: 'Car', petrol: 'Petrol car', diesel: 'Diesel car', hybrid: 'Hybrid car', ev: 'Electric car', motorbike: 'Motorbike', scooter: 'Scooter', boat: 'Boat', sailboat: 'Sailing boat', kayak: 'Kayak or canoe', sup: 'Paddleboard',
  skis: 'Skis', snowboard: 'Snowboard', other: 'Other' };
// The kinds of gear each type can have (Other last), and an example name for new gear.
var MR_GEAR_KINDS = { CYCLING: ['bike', 'strida', 'halfbike', 'cargo', 'ebike'], RUNNING: ['shoe'], WALKING: ['shoe'], CAR: ['car', 'petrol', 'diesel', 'hybrid', 'ev'],
  MOTORCYCLE: ['motorbike', 'scooter'], BOAT: ['boat', 'sailboat', 'kayak', 'sup'], SKIING: ['skis', 'snowboard'] };
var MR_GEAR_EG = { CYCLING: 'Strida EVO', RUNNING: 'Trail shoes', WALKING: 'Hiking boots', CAR: 'Blue Volvo', MOTORCYCLE: 'Vespa', BOAT: 'Sea kayak', SKIING: 'Powder skis' };
function mrKindsFor(m) { return (MR_GEAR_KINDS[m || 'CYCLING'] || []).concat(['other']); }
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
  // A bulk edit: the trips it lists, each by its start.
  if (Array.isArray(ref.trips)) {
    var seen = {};
    ref.trips.forEach(function (r) { mrRefTrips(r).forEach(function (j) { if (!seen[j]) { seen[j] = 1; out.push(j); } }); });
    return out.sort(function (x, y) { return D.start[x] - D.start[y]; });
  }
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
// Does trip i start or end in one of these countries (ISO codes), as Filters counts it?
function mrCcIn(list, i) {
  var a = String(D.ccList[D.cs[i]] || '').toUpperCase(), b = String(D.ccList[D.ce[i]] || '').toUpperCase();
  return list.some(function (c) { c = String(c).toUpperCase(); return c === a || c === b; });
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
// mrPlaceAt and mrStayPlace for a whole pass over the trips or stays: the place rules are listed once
// and put in a grid of MR_PF_CELL° cells (each in every cell its radius reaches), so a point is only
// measured against the few places near it, and a stay's original place (mrUnits) is looked up once.
// Same answers as mrPlaceAt: the nearest place whose radius it is within, the first in the file on a tie.
// Made fresh for each pass, as rules change between them.
var MR_PF_CELL = 0.05;
function mrPlaceFinder() {
  var L = mrActive('places').filter(function (r) { return Array.isArray(r.at) && isFinite(r.at[0]) && isFinite(r.at[1]); });
  var grid = new Map(), wide = [], U = null, memo = null;
  L.forEach(function (r, k) {
    var rad = Math.max(+r.radius_m || 100, 1) / 1000 * 1.05 + 0.01, la = +r.at[0], lo = +r.at[1];
    var dla = rad / 110.57, cs = Math.cos(Math.min(89, Math.abs(la) + dla) * Math.PI / 180), dlo = rad / (111.32 * Math.max(cs, 0.01));
    var y0 = Math.floor((la - dla) / MR_PF_CELL), y1 = Math.floor((la + dla) / MR_PF_CELL), x0 = Math.floor((lo - dlo) / MR_PF_CELL), x1 = Math.floor((lo + dlo) / MR_PF_CELL);
    // Near the poles or the date line, or a radius over many cells: checked for every point.
    if (Math.abs(la) + dla > 85 || lo - dlo < -180 || lo + dlo > 180 || (y1 - y0 + 1) * (x1 - x0 + 1) > 400) { wide.push(k); return; }
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) { var key = y * 8192 + x, c = grid.get(key); if (!c) grid.set(key, c = []); c.push(k); }
  });
  function at(lat, lng) {
    if (!L.length || !isFinite(lat)) return null;
    var c = grid.get(Math.floor(lat / MR_PF_CELL) * 8192 + Math.floor(lng / MR_PF_CELL)), best = null, bk = -1, bd = Infinity, j, k;
    // In file order, as mrPlaceAt goes: the wide ones merged into the cell's list.
    for (var a = 0, b = 0, na = c ? c.length : 0, nb = wide.length; a < na || b < nb;) {
      if (b >= nb || a < na && c[a] < wide[b]) k = c[a++]; else k = wide[b++];
      var r = L[k], d = km([lat, lng], r.at) * 1000;
      if (d <= (+r.radius_m || 100) && d < bd) { bd = d; best = r; bk = k; }
    }
    return best;
  }
  function stay(v) {
    if (!L.length) return null;
    if (!U) { U = mrUnits(); memo = new Array(U.list.length); }
    var k = U.of[v];
    if (memo[k] === undefined) { var u = U.list[k]; memo[k] = at(u.lat, u.lng); }
    return memo[k];
  }
  return { at: at, stay: stay, n: L.length };
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
  // "assign": false is gear in your list only: it goes on trips only where you set it (a correction).
  var periods = mrActive('gear').filter(function (r) { return MODE_IDX[r.mode] != null && !r.default && r.assign !== false; }).map(function (r) {
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
    if (Array.isArray(m.countries) && m.countries.length && !mrCcIn(m.countries, i)) return false;
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
      var g = r ? gearOf(r) : addGear(ref, c.then.gear_kind || null, MODES[D.mode[i]]);
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
  for (i = 0; periods.length && i < n; i++) {
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
  // The default car (a gear rule with "default": true, one per type): a guess for every trip of its
  // type still without gear. It's marked as guessed until you confirm it (mrGearOk, a gear period).
  var defs = {};
  mrActive('gear').forEach(function (r) { if (r.default && MODE_IDX[r.mode] != null && !defs[MODE_IDX[r.mode]]) defs[MODE_IDX[r.mode]] = { r: r, ex: mrExcept(r) }; });
  if (!Object.keys(defs).length) return;
  for (i = 0; i < n; i++) {
    var df = defs[D.mode[i]];
    if (!df || D.gear[i] || D.mrAmb[i] || isDup(i) || df.ex[i]) continue;
    D.gear[i] = gearOf(df.r);
    D.mrGear[i] = { rule: df.r.id, gear: D.gear[i], def: true };
    MR_COUNT[df.r.id] = (MR_COUNT[df.r.id] || 0) + 1;
  }
}
// Trips that have this gear (by name and type), for gear set by hand only.
function mrGearUses(r) {
  if (!D) return 0;
  var c = 0, mi = MODE_IDX[r.mode];
  for (var j = 0; j < D.day.length; j++) if (D.gear[j] && D.mode[j] === mi && GEAR[D.gear[j]].name === r.name) c++;
  return c;
}
function mrDefaultCar() { return mrList('gear').filter(function (r) { return r.default && r.mode === 'CAR'; })[0] || null; }
var MR_CAR_FUELS = ['petrol', 'diesel', 'hybrid', 'ev'];
// Rule applied (inferred): gear a gear period filled in, a type or line a routine or map snap set. Edited: anything a correction set.
function mrInferred(i) { return !!(D.mrGear && D.mrGear[i] && !D.mrGear[i].cor || D.mrMode && D.mrMode[i] && D.mrMode[i].inf || D.snap && D.snap[i] && !D.snap[i].track && !D.snap[i].road); }
function mrEdited(i) { return !!(D.mrMode && (D.mrMode[i] && !D.mrMode[i].inf || D.mrName[i] || D.mrHide[i] || D.mrGear[i] && D.mrGear[i].cor || D.mrDrop && D.mrDrop[i])); }
// A trip a map snap took says so; anything else a rule filled in is "Rule applied".
function mrSnapped(i) { return !!(D.mrSnap && D.mrSnap[i] && D.snap && D.snap[i]); }
function mrRoaded(i) { return !!(D.mrRoad && D.mrRoad[i] && D.snap && D.snap[i] === D.mrRoad[i]); }
function mrTracked(i) { return !!(D.mrTrack && D.mrTrack[i] && D.snap && D.snap[i]); }
function mrRuleOther(i) { var sn = mrSnapped(i); return !!(D.mrGear && D.mrGear[i] && !D.mrGear[i].cor && !D.mrGear[i].def || !sn && (D.mrMode && D.mrMode[i] && D.mrMode[i].inf || D.snap && D.snap[i] && !D.snap[i].track && !D.snap[i].road)); }
function mrTag(i) { return !D ? '' : (mrEdited(i) ? '<span class="guess inf">Edited</span>' : '') + (mrSnapped(i) ? '<span class="guess inf">Map snap</span>' : '') + (mrTracked(i) ? '<span class="guess inf" title="Drawn along the railway of your station packs">On the tracks</span>' : '') + (mrRoaded(i) ? '<span class="guess inf" title="Drawn along the roads of your road pack">On the roads</span>' : '') + (mrRuleOther(i) ? '<span class="guess inf">Rule applied</span>' : '') + (D.mrGear && D.mrGear[i] && D.mrGear[i].def ? '<span class="guess" title="Guessed: your default car">Default car</span>' : '') + (mrCheck(i) ? '<span class="guess">Check</span>' : ''); }
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
// With MyRules switched off: what the routines and corrections would do if they were on (counts,
// trips left out, lines), for the rules sheet. Worked out by applying them once and starting again.
var MR_WOULD = null;
function mrApplyCorrections(dry) { runAll(mrCorrectSteps(dry)); }
// One correction on one trip: its type, checked mark, title and hiding. True when it changed something.
function mrCorrectOne(x, i) {
  var t = x.c.then, b = D.base, mi = t.mode != null ? MODE_IDX[t.mode] : null, hit = false;
  if (mi != null) {
    D.mode[i] = mi;
    // A correction isn't a guess. A Strava sport of another type no longer fits the trip.
    D.est[i] &= ~GUESSED;
    if (D.sport[i] && SPORTS[D.sport[i]][2] !== t.mode) D.sport[i] = 0;
    if (D.stype) D.stype[i] = '';
    D.mrMode[i] = { rule: x.c.id, was: MODES[b.mode[i]], guessed: !!(b.est[i] & GUESSED) };
    hit = true;
  }
  if (t.checked === true && mi == null) { D.mrOk[i] = 1; hit = true; }
  if (typeof t.name === 'string' && t.name.trim()) { D.mrName[i] = { rule: x.c.id, name: t.name.trim() }; hit = true; }
  if (t.hide === true) { D.mrHide[i] = 1; hit = true; }
  else if (t.hide === false && D.mrHide[i]) { D.mrHide[i] = 0; hit = true; }
  return hit;
}
function* mrCorrectSteps(dry) {
  var b = D.base, n = D.day.length;
  function copy(a) { return a ? a.slice() : a; }
  function reset() {
    D.mode = copy(b.mode); D.est = copy(b.est); D.sport = copy(b.sport); D.stype = copy(b.stype); D.km = copy(b.km);
    D.pathPts = b.pathPts; D.pathT = b.pathT; D.pathOff = b.pathOff; D.from = b.from; D.to = b.to; D.mrDrop = [];
    if (b.vll) D.vll = b.vll; D.mvStay = {};
    D.mrMode = []; D.mrName = []; D.mrHide = new Uint8Array(n); D.mrRoute = []; D.mrMiss = []; D.snap = []; D.mrLine = {}; D.mrOk = new Uint8Array(n);
    MR_COUNT = {}; MR_COR = null; MR_LEFT = {}; D.preCor = null;
  }
  reset();
  if (!dry) MR_WOULD = null;
  if (MR && !MR.on && !dry) {
    MR.on = true;
    try { mrApplyCorrections(true); MR_WOULD = { count: MR_COUNT, left: MR_LEFT, line: D.mrLine }; } finally { MR.on = false; }
    reset();
  }
  // With MyRules off, cell-tower fixes still go (a setting of their own).
  if (!MR || !MR.on) { mrApplyDrops(true); yield* mrTrackSteps(); mrApplyRoads(); yield; yield* mrLearnSteps(); return; }
  // GPS points you said to ignore go first, so routines, lines and distances all go without them.
  mrApplyDrops();
  // Places that moved (moved.js): stays and the ends of trips to and from them, before routines look at the ends.
  mrApplyMoves();
  yield;
  // Routines first, so a correction on the same trip wins over them.
  mrApplyRoutines();
  yield;
  mrApplySnaps();
  yield;
  // How every trip is before the corrections: mrReapplyTrip starts one trip again from here.
  if (!dry) D.preCor = { n: n, mode: copy(D.mode), est: copy(D.est), sport: copy(D.sport), stype: copy(D.stype), km: copy(D.km), snap: D.snap.slice(), mrMode: D.mrMode.slice() };
  mrCorrections().forEach(function (x) {
    var hit = 0;
    x.trips.forEach(function (i) { if (mrCorrectOne(x, i)) hit = 1; });
    if (hit) MR_COUNT[x.c.id] = x.trips.length;
  });
  // A trip a correction made a flight isn't drawn along a routine's line.
  D.snap.forEach(function (s, i) { if (s && MODES[D.mode[i]] === 'FLYING') { D.snap[i] = null; D.km[i] = b.km[i]; } });
  if (dry) return;
  // Train trips nothing above drew, along the tracks of the packs (when that's on).
  yield* mrTrackSteps();
  // Car trips nothing above drew, along the roads of the road packs (when that's on).
  mrApplyRoads();
  yield;
  yield* mrLearnSteps();
}

// ---------- GPS points you ignore ----------
// Ignore GPS points in the trip details (ignore.js) saves the times of the points to leave out in
// the trip's own correction (then.ignore_points: ISO times, to the second). They are left out of D's
// copy of the trail (D.base keeps the one loaded), so the trip's line, its distance, its speed chart,
// its playback and the heatmap all go without them. A trip keeps at least two points. Its distance
// loses what the left-out points added to its trail, but is never shorter than the trail that's left.
// D.mrDrop[i]: { rule, n (points left out), of (points it had), km (distance before), gaps } where
// gaps are the stretches (seconds from the start) the left-out points were in, for a recorded
// activity's speed series, which comes from its file rather than from the trail.
function mrIgnoreKey(ms) { return Math.round(ms / 1000); }
function mrIgnoreIso(sec) { return new Date(sec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'); }
function mrIgnoreSet(list) {
  var set = {};
  (Array.isArray(list) ? list : []).forEach(function (v) { var t = Date.parse(v); if (isFinite(t)) set[mrIgnoreKey(t)] = 1; });
  return set;
}
// The trip's points as loaded (D.base): [{ ll, t (seconds since 1970), s (seconds from its start) }].
function mrBasePoints(i) {
  var b = D.base || D, out = [];
  for (var q = b.pathOff[i]; q < b.pathOff[i + 1]; q++) out.push({ ll: [b.pathPts[2 * q], b.pathPts[2 * q + 1]], s: b.pathT[q], t: mrIgnoreKey(D.start[i] + b.pathT[q] * 1000) });
  return out;
}
// Cell-tower and Wi-Fi fixes (netFixes in parser.js) are left out the same way, for every trip, while
// Leave out cell-tower fixes is on in Trip cleanup (PREFS.netFix, on unless switched off). D.netDrop[i]:
// { n (points left out), of, km (distance before) }; worked out once for the trips as loaded (D.base.net).
function netFixOn() { return PREFS.netFix !== false; }
function mrNetFixes() {
  var b = D.base;
  if (!b.net) b.net = netFixes(b === D ? D : Object.assign({}, D, b), D.order);
  return b.net;
}
// Bad GPS spots you marked (MyRules gps_spots, from Ignore GPS points › Every trip, here): a trip's
// points within GPS_SPOT_KM of one are left out, but never its first or last point (where it starts and
// ends), and a trip keeps at least two. Flights and recorded activities (their own GPS) are left alone.
// rules: the spot rules to use (default: the active ones). { trip: { keep, rule, n } }.
var GPS_SPOT_KM = 0.015;
function mrSpotDrops(rules) {
  rules = rules || mrActive('gps_spots');
  var out = {}, b = D.base || D, cell = 0.001, grid = new Map();
  rules.forEach(function (r) {
    (Array.isArray(r.at) ? r.at : []).forEach(function (p) {
      if (!Array.isArray(p) || !isFinite(p[0]) || !isFinite(p[1])) return;
      var k = Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell);
      (grid.get(k) || grid.set(k, []).get(k)).push([p[0], p[1], r.id]);
    });
  });
  if (!grid.size) return out;
  function hit(la, lo) {
    var ci = Math.floor(la / cell), cj = Math.floor(lo / cell);
    for (var di = -1; di <= 1; di++) for (var dj = -1; dj <= 1; dj++) {
      var L = grid.get((ci + di) + ',' + (cj + dj));
      if (L) for (var k = 0; k < L.length; k++) if (kmLL(la, lo, L[k][0], L[k][1]) <= GPS_SPOT_KM) return L[k][2];
    }
    return null;
  }
  for (var i = 0, n = D.start.length; i < n; i++) {
    var o0 = b.pathOff[i], len = b.pathOff[i + 1] - o0;
    if (len < 3 || isDup(i) || MODES[b.mode[i]] === 'FLYING' || (b.est || D.est)[i] & STRAVA) continue;
    var keep = [0], rule = null;
    for (var q = 1; q < len - 1; q++) {
      var id = hit(b.pathPts[2 * (o0 + q)], b.pathPts[2 * (o0 + q) + 1]);
      if (id) { if (!rule) rule = id; } else keep.push(q);
    }
    keep.push(len - 1);
    if (rule && keep.length < len) out[i] = { keep: keep, rule: rule, n: len - keep.length };
  }
  return out;
}
// netOnly: with MyRules off, only the network fixes.
function mrApplyDrops(netOnly) {
  var b = D.base, by = {}, net = netFixOn() ? mrNetFixes() : {}, spots = netOnly ? {} : mrSpotDrops();
  D.netDrop = []; D.spotDrop = [];
  mrActive('gps_spots').forEach(function (r) { MR_COUNT[r.id] = 0; });
  if (!netOnly) mrCorrections().forEach(function (x) {
    var ig = x.c.then.ignore_points;
    if (!x.one || x.trips.length !== 1 || !Array.isArray(ig) || !ig.length) return;
    var i = x.trips[0], set = mrIgnoreSet(ig), pts = mrBasePoints(i), keep = [];
    if (MODES[b.mode[i]] === 'FLYING') return;
    pts.forEach(function (p, k) { if (!set[p.t]) keep.push(k); });
    if (keep.length === pts.length || keep.length < 2) return;
    by[i] = { rule: x.c.id, keep: keep, pts: pts };
    MR_COUNT[x.c.id] = 1;
  });
  // Your bad GPS spots: on their own, or on top of the points you ignored (still keeping two).
  Object.keys(spots).forEach(function (k) {
    var i = +k, sp = spots[k], x = by[i];
    MR_COUNT[sp.rule] = (MR_COUNT[sp.rule] || 0) + 1;
    if (!x) { x = by[i] = { keep: sp.keep, pts: mrBasePoints(i) }; x.spot = sp; x.spotN = x.pts.length - sp.keep.length; return; }
    var on = {};
    sp.keep.forEach(function (q) { on[q] = 1; });
    var both = x.keep.filter(function (q) { return on[q]; });
    if (both.length >= 2 && both.length < x.keep.length) { x.spot = sp; x.spotN = x.keep.length - both.length; x.userKeep = x.userKeep || x.keep.length; x.keep = both; }
  });
  // The network fixes go too: on their own, or on top of the points you ignored (still keeping two).
  Object.keys(net).forEach(function (k) {
    var i = +k, nk = net[k], x = by[i];
    if (!x) { x = by[i] = { keep: nk, pts: mrBasePoints(i) }; x.net = x.pts.length - nk.length; return; }
    var on = {};
    nk.forEach(function (q) { on[q] = 1; });
    var both = x.keep.filter(function (q) { return on[q]; });
    if (both.length >= 2 && both.length < x.keep.length) { x.net = x.keep.length - both.length; x.userKeep = x.userKeep || x.keep.length; x.keep = both; }
  });
  var list = Object.keys(by).map(Number);
  if (!list.length) return;
  var n = D.start.length, np = b.pathT.length, i, q, w = 0;
  list.forEach(function (j) { np -= by[j].pts.length - by[j].keep.length; });
  var P = new Float32Array(2 * np), T = new Float32Array(np), O = new Uint32Array(n + 1);
  D.from = Float32Array.from(b.from); D.to = Float32Array.from(b.to);
  for (i = 0; i < n; i++) {
    O[i] = w;
    var x = by[i];
    if (!x) { for (q = b.pathOff[i]; q < b.pathOff[i + 1]; q++, w++) { P[2 * w] = b.pathPts[2 * q]; P[2 * w + 1] = b.pathPts[2 * q + 1]; T[w] = b.pathT[q]; } continue; }
    var kept = x.keep.map(function (k) { return x.pts[k]; }), gaps = [];
    kept.forEach(function (p) { P[2 * w] = p.ll[0]; P[2 * w + 1] = p.ll[1]; T[w] = p.s; w++; });
    // Its ends move to the first and last points it keeps.
    if (x.keep[0] > 0) { D.from[2 * i] = kept[0].ll[0]; D.from[2 * i + 1] = kept[0].ll[1]; }
    if (x.keep[x.keep.length - 1] < x.pts.length - 1) { var e = kept[kept.length - 1]; D.to[2 * i] = e.ll[0]; D.to[2 * i + 1] = e.ll[1]; }
    // Where the left-out points were: from the point kept before to the one kept after, at most 30 s around them.
    var on = {};
    x.keep.forEach(function (k) { on[k] = 1; });
    x.pts.forEach(function (p, k) {
      if (on[k]) return;
      var a = k - 1, c = k + 1;
      while (a >= 0 && !on[a]) a--;
      while (c < x.pts.length && !on[c]) c++;
      gaps.push([Math.max(a >= 0 ? x.pts[a].s : -Infinity, p.s - 30), Math.min(c < x.pts.length ? x.pts[c].s : Infinity, p.s + 30)]);
    });
    var before = pathKm(x.pts.map(function (p) { return p.ll; })), after = pathKm(kept.map(function (p) { return p.ll; }));
    if (x.rule) D.mrDrop[i] = { rule: x.rule, n: (x.userKeep ? x.pts.length - x.userKeep : x.pts.length - kept.length), of: x.pts.length, km: b.km[i], gaps: gaps };
    if (x.net) D.netDrop[i] = { n: x.net, of: x.pts.length, km: b.km[i] };
    if (x.spot) { var sr = mrById(x.spot.rule); D.spotDrop[i] = { n: x.spotN, rule: x.spot.rule, name: sr && sr.name || 'a bad GPS spot' }; }
    // Never longer than before, nor shorter than the trail that's left.
    if (before > 0) D.km[i] = Math.min(b.km[i], Math.max(after, b.km[i] - (before - after)));
  }
  O[n] = w;
  D.pathPts = P; D.pathT = T; D.pathOff = O;
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
function* mrLearnSteps() {
  var n = D.day.length, i, fly = MODE_IDX.FLYING;
  D.chk = new Int8Array(n).fill(-1); D.chkWhy = []; D.learn = []; D.conf = new Uint8Array(n);
  // Kept on D, so mrReapplyTrip can change one trip's vote and decide its like trips again.
  var idx = D.tidx = new TripIndex(D, mrLearnWeight);
  for (i = 0; i < n; i++) {
    if (!(i & 127)) yield;
    mrLearnOne(idx, i);
  }
}
function mrLearnFixed(j) { return D.mrMode[j] && !D.mrMode[j].inf || D.mrOk[j]; }
// A trip's vote for its like trips (0: none).
function mrLearnWeight(j) {
  if (isDup(j) || D.mrHide[j] || D.est[j] & GUESSED || D.mode[j] === MODE_IDX.FLYING) return 0;
  if (mrLearnFixed(j)) return VOTE_FIX;
  return D.est[j] & STRAVA || D.mrMode[j] ? 2 : 1;
}
// One trip's guess and check, from the votes of its like trips.
function mrLearnOne(idx, i) {
  var fly = MODE_IDX.FLYING;
  if (isDup(i) || D.mrHide[i] || D.mode[i] === fly || mrLearnFixed(i)) return;
  var m = MODES[D.mode[i]], avg = tripAvg(D, i), v;
  if (D.est[i] & GUESSED) {
    if (D.est[i] & STRAVA) return;
    var conf = D.gconf ? D.gconf[i] : 0;
    v = idx.decide(i, avg);
    if (v && VOTE_GROUP[v.mode] !== VOTE_GROUP[m]) { D.learn[i] = { was: m, n: v.trips }; D.mode[i] = MODE_IDX[v.mode]; m = v.mode; conf = v.conf; }
    else if (v) conf = Math.max(conf, v.conf);
    D.conf[i] = conf;
    if (conf && conf < CHECK_CONF) { D.chk[i] = MODE_IDX[mrAltMode(i, m, avg, v || idx.votes(i, avg))]; D.chkWhy[i] = { kind: 'guess' }; }
    return;
  }
  if (D.est[i] & STRAVA || !DOUBT_GROUPS[VOTE_GROUP[m]]) return;
  if (VOTE_GROUP[m] === 'CYCLING' && avg > VOTE_KMH.CYCLING[1]) { D.chk[i] = MODE_IDX[avg > 90 ? 'TRAIN' : 'CAR']; D.chkWhy[i] = { kind: 'speed', avg: avg }; return; }
  v = idx.votes(i, avg);
  var r = v && VOTE_KMH[v.group];
  if (v && v.group !== VOTE_GROUP[m] && DOUBT_GROUPS[v.group] && v.n >= DOUBT_MIN && v.share >= DOUBT_SHARE && (v.by[VOTE_GROUP[m]] || 0) <= DOUBT_OWN * v.tot && avg >= r[0] && avg <= r[1]) {
    D.chk[i] = MODE_IDX[v.mode]; D.chkWhy[i] = { kind: 'history', n: v.trips, share: v.share };
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
  var pf = mrPlaceFinder();
  if (!pf.n) return;
  for (var v = 0; v < nv; v++) {
    var r = pf.stay(v);
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
  // The trips are still being set up (setDataSoon): this comes once they are.
  if (BUILDING) { BUILDING.again = true; return; }
  mrApplyCorrections();
  mrReapplied();
}
// After the rules are applied again: the filters, gear, places and views follow.
function mrReapplied() {
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
// trip: the one trip a change is about, when it only touches that trip's own corrections (its type,
// checked mark, title, hiding or gear): then only that trip and its like trips are worked out again.
function mrChange(text, trip) {
  MR.changes.push({ t: Date.now(), text: text });
  MR.doc.about = Object.assign({}, MR.doc.about, { updated: new Date().toISOString(), generator: 'BT•DT' });
  mrSave();
  if (trip != null && mrReapplyTrip(trip)) { mrReapplied(); return; }
  mrReapply();
}
// The fast way after a change to one trip's own corrections, with the same result as mrReapply:
// 1. the trip goes back to how it was before the corrections (D.preCor, kept by mrCorrectSteps),
// 2. its corrections are applied again, in the same order,
// 3. it is drawn along the tracks or roads, when that's on and its new type calls for it,
// 4. its vote changes in the like-trips index (D.tidx), and the guesses and checks of the trips
//    between the same two places are decided again. Only trips with a vote can sway others, and
//    deciding only ever changes guesses, so nothing further down can change.
// False when it can't (MyRules off, trips still being set up or snapped, no snapshot): then mrReapply.
var MR_FAST = { n: 0, ms: 0 };
function mrReapplyTrip(i) {
  var P = D && D.preCor, idx = D && D.tidx, n = D ? D.day.length : 0;
  if (!P || !idx || P.n !== n || !MR || !MR.on || BUILDING || ROAD_RUN || roadOn() && !RG || !(i >= 0 && i < n)) return false;
  var t0 = performance.now(), b = D.base, oldCor = (MR_COR || []).filter(function (x) { return x.trips.indexOf(i) >= 0; });
  // 1.
  D.mode[i] = P.mode[i]; D.est[i] = P.est[i]; D.sport[i] = P.sport[i]; if (D.stype) D.stype[i] = P.stype[i];
  D.km[i] = P.km[i]; D.snap[i] = P.snap[i];
  if (P.mrMode[i]) D.mrMode[i] = P.mrMode[i]; else delete D.mrMode[i];
  delete D.mrName[i]; D.mrHide[i] = 0; D.mrOk[i] = 0;
  if (D.mrTrack) delete D.mrTrack[i];
  if (D.mrRoad) delete D.mrRoad[i];
  // 2. (The list is made again: the change may have added, changed or removed a correction.)
  MR_COR = null;
  var now = mrCorrections().filter(function (x) { return x.trips.indexOf(i) >= 0; });
  oldCor.forEach(function (x) { if (now.every(function (y) { return y.c !== x.c; })) mrCorCount(x.c); });
  now.forEach(function (x) { if (mrCorrectOne(x, i)) MR_COUNT[x.c.id] = x.trips.length; else mrCorCount(x.c); });
  if (D.snap[i] && MODES[D.mode[i]] === 'FLYING') { D.snap[i] = null; D.km[i] = b.km[i]; }
  // 3.
  if (D.mrTrack && trackOn() && trackCan(i)) mrTrackOne(i);
  if (D.mrRoad && roadOn() && RG && roadCan(i)) {
    var rk = roadKey(i), sn = ROAD_CACHE.get(rk);
    if (sn === undefined) { sn = roadTrip(RG, i); ROAD_CACHE.set(rk, sn); }
    if (sn) { D.snap[i] = sn; D.km[i] = sn.km; D.mrRoad[i] = sn; }
  }
  // 4.
  idx.avg[i] = tripAvg(D, i);
  mrIdxSet(idx, i, mrLearnWeight(i));
  var A = [D.from[2 * i], D.from[2 * i + 1]], Z = [D.to[2 * i], D.to[2 * i + 1]], like = [i];
  if (isFinite(A[0]) && isFinite(Z[0])) for (var j = 0; j < n; j++) {
    if (j === i || !isFinite(D.from[2 * j]) || !isFinite(D.to[2 * j])) continue;
    // A quick no: its start is nowhere near either end in latitude (0.01° is over 1 km).
    var la = D.from[2 * j];
    if (Math.abs(la - A[0]) > 0.01 && Math.abs(la - Z[0]) > 0.01) continue;
    var a = [la, D.from[2 * j + 1]], z = [D.to[2 * j], D.to[2 * j + 1]];
    // A little wider than the index's own END_KM, so no trip that counts is missed.
    if (km(A, a) <= 2 * END_KM && km(Z, z) <= 2 * END_KM || km(A, z) <= 2 * END_KM && km(Z, a) <= 2 * END_KM) like.push(j);
  }
  like.forEach(function (j) {
    if (j !== i && D.learn[j]) D.mode[j] = MODE_IDX[D.learn[j].was];
    delete D.learn[j]; D.chk[j] = -1; delete D.chkWhy[j]; D.conf[j] = 0;
    mrLearnOne(idx, j);
  });
  trackSettings(); roadSettings();
  MR_FAST.n++; MR_FAST.ms = Math.round(performance.now() - t0); MR_FAST.like = like.length;
  return true;
}
// A correction's count when it no longer changes a given trip: as mrCorrectSteps counts it.
function mrCorCount(c) {
  var x = mrCorrections().filter(function (y) { return y.c === c; })[0], hit = false;
  if (x) x.trips.forEach(function (j) {
    var t = c.then;
    if (t.mode != null && MODE_IDX[t.mode] != null || t.checked === true && t.mode == null || typeof t.name === 'string' && t.name.trim() || t.hide === true || t.hide === false && D.mrHide[j]) hit = true;
  });
  if (hit) MR_COUNT[c.id] = x.trips.length; else delete MR_COUNT[c.id];
}
// A trip's vote in the like-trips index: in its place among the trips with the same ends (kept in
// the order TripIndex adds them, so ties come out the same), or out when it has none.
function mrIdxSet(idx, i, w) {
  var R = idx.R, la = R.from[2 * i], lb = R.to[2 * i];
  if (!isFinite(la) || !isFinite(lb)) { idx.w[i] = 0; return; }
  var k = endKey(Math.floor(la / END_LAT), Math.floor(R.from[2 * i + 1] / END_LNG), Math.floor(lb / END_LAT), Math.floor(R.to[2 * i + 1] / END_LNG));
  var L = idx.m.get(k), at = L ? L.indexOf(i) : -1;
  if (w > 0 && VOTE_GROUP[MODES[R.mode[i]]]) {
    idx.w[i] = w;
    if (at >= 0) return;
    if (!L) { idx.m.set(k, [i]); return; }
    var p = 0;
    while (p < L.length && L[p] < i) p++;
    L.splice(p, 0, i);
  } else {
    idx.w[i] = 0;
    if (at >= 0) L.splice(at, 1);
  }
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
    if (!MR) { saving(function () { mrUse(doc, name, false); }, 'Applying MyRules…'); return; }
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
  // o.info: the longer explanation, behind the (i) next to the title.
  $('mrDlgInfo').innerHTML = o.info || ''; $('mrDlgInfo').hidden = true;
  $('mrDlgInfoBtn').hidden = !o.info; $('mrDlgInfoBtn').setAttribute('aria-expanded', 'false');
  $('mrDlgExtra').innerHTML = o.extra || '';
  $('mrDlgExtra').oninput = $('mrDlgExtra').onchange = null;
  $('mrDlgNote').textContent = o.note || '';
  var bt = $('mrDlgBtns');
  bt.textContent = '';
  o.buttons.forEach(function (b) {
    var el = document.createElement('button');
    el.type = 'button'; el.className = 'btn' + (b[1] ? ' ' + b[1] : ''); el.innerHTML = b[0];
    el.addEventListener('click', function () {
      function run() { if (b[3] !== 'stay') d.close(); if (b[2]) b[2](el); }
      // Save, Delete and the like show the pill at once; the dialog closes when the work starts,
      // in the same order as before (closing first, then the save).
      if (b[2] && /primary|danger/.test(b[1] || '')) saving(run, /danger/.test(b[1]) ? 'Working on it…' : 'Saving…'); else run();
    });
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
  // Export sits in the MyRules header and in Your data, with a dot while changes aren't exported.
  var unsaved = MR && MR.changes.length;
  $('mrSheetExport').hidden = $('mrExportData').hidden = !MR;
  $('mrSheetExport').innerHTML = icon('upload') + 'Export' + (unsaved ? '<i class="mr-dot"></i>' : '');
  $('mrSheetExport').classList.add('mr-export');
  if (!MR) {
    el.innerHTML = '<p class="fine">' + infoMore('Add what only you know, like which bike you rode when or where home was.', 'BT•DT fills in what your files leave out and marks it <span class="guess inf">Rule applied</span>. Fix a trip\'s type or title with <b>Trip info</b>, or hide it, from the pencil in its details; those changes are marked <span class="guess inf">Edited</span>. Load a <b>.myrules.json</b> file with your location files, or set a ride\'s gear or edit a trip to start.', 'About MyRules') + '</p>';
    return;
  }
  var nGear = 0, nEd = 0, n = MR.changes.length;
  if (D) for (var i = 0; i < D.day.length; i++) { if (mrInferred(i)) nGear++; if (mrEdited(i)) nEd++; }
  el.innerHTML = '<div class="mr-card"><div class="mr-card-head"><span class="mr-ic">' + icon('flag') + '</span><span class="file-txt"><b>' + esc(MR.name) + '</b><small>' + mrCount(MR.doc) + '</small></span>' +
    '<input type="checkbox" class="switch" id="mrOn" aria-label="Apply MyRules"' + (MR.on ? ' checked' : '') + '></div>' +
    '<p class="fine" style="margin:8px 0">' + (!MR.on ? 'Switched off: everything shows as your files have it.' : D ? 'Gear filled in on ' + tripsText(nGear) + (nEd ? ', ' + tripsText(nEd) + ' edited' : '') + '.' + (MR_AMB ? ' ' + tripsText(MR_AMB) + ' fit two gear periods equally, so got none.' : '') + ' Recorded data is never overwritten.' : 'Applied once you load your location files.') + '</p>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
    '<span class="fine mr-unsaved">' + (n ? n + ' change' + (n === 1 ? '' : 's') + ' not exported' : !MR.exported && !DEMO ? 'Saved in this browser only. Export to keep a copy.' : '') + '</span></div>' +
    '<p class="fine" style="margin-top:8px">The exported file includes your places, such as home.</p></div>';
  $('mrOn').addEventListener('change', function () { var on = this.checked; working(on ? 'Applying MyRules…' : 'Switching MyRules off…', function () { MR.on = on; mrSave(); mrReapply(); }); });
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
  var on = r.enabled !== false, ex = Array.isArray(r.except) && r.except.length, note = r.note ? esc(r.note) : '';
  // A list of facts: the first two on the row, the rest (and the note) behind its (i).
  if (Array.isArray(sub)) {
    var rest = sub.slice(2);
    if (note) rest.push(note);
    sub = infoMore(sub.slice(0, 2).join(' · '), rest.map(function (t) { return t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.'); }).join(' '), 'More about ' + esc(title));
    note = '';
  }
  return '<div class="mr-rule' + (on ? '' : ' off') + '"><span class="mode-badge sm" style="background:' + color + '">' + icon(ic) + '</span><span class="file-txt mr-edit" role="button" tabindex="0" data-mr-edit="' + esc(sec) + ':' + esc(r.id) + '" aria-label="Edit ' + esc(title) + '"><b>' + esc(title) + icon('right', 'mr-chev') + '</b><small>' + sub +
    (ex ? ' · ' + ex + ' exception' + (ex === 1 ? '' : 's') : '') + (note ? '<br>' + note : '') + mrUnlessTags(r) + '</small></span>' +
    (count != null && MR.on ? '<span class="num fine">' + fmt(count) + '</span>' : count != null ? '<span class="num fine mr-would" title="Trips it would change with MyRules on">' + fmt(count) + '</span>' : '') +
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
  var newGear = '<button type="button" class="btn mr-add" data-mr-newgear>New gear…</button>';
  if (!MR) { $('mrBody').innerHTML = '<p class="fine">No rules yet.</p><div class="sec" data-mr-tab="gear"><div class="sec-head"><h3>Gear</h3>' + newGear + '</div></div>'; return; }
  // Switched off, no rule changes anything: say so where the rules are, with the switch at hand.
  // Off: the counts, left-out trips and lines the rules would have.
  var W = MR.on || !MR_WOULD ? { count: MR_COUNT, left: MR_LEFT, line: D && D.mrLine } : MR_WOULD;
  if (!MR.on) h += '<p class="fine mr-warn">' + infoMore('MyRules are switched off.', 'None of these rules change your trips. Routines and corrections show how many trips they would change.', 'About switched-off rules') + ' <button type="button" class="link-btn" id="mrSwitchOn">Switch them on</button></p>';
  if (D && MR.on) h += mrCleanBar();
  if (MR_AMB) h += '<p class="fine mr-warn">' + infoMore(tripsText(MR_AMB) + ' fit two gear periods equally well, so they got no gear.', 'Narrow one of the periods (a shorter period, or a distance limit) to pick one.') + '</p>';
  var gear = mrList('gear'), places = mrList('places'), moves = mrList('moves'), cor = mrList('corrections'), rout = mrList('routines'), snaps = mrList('snaps'), spots = mrList('gps_spots');
  // Gear always has its section, with New gear… (any type, period and countries) at its head.
  h += '<div class="sec" data-mr-tab="gear"><div class="sec-head"><h3>Gear</h3>' + newGear + '</div>' + (gear.length ? '' : '<p class="fine">No gear yet.</p>') + gear.map(function (r) {
    var m = r.match || {}, bits = r.default ? ['Default ' + esc((LABEL[r.mode] || r.mode).toLowerCase()) + ', a guess for trips without gear', esc(MR_KINDS[r.kind] || LABEL[r.mode] || r.mode)]
      : r.assign === false ? [esc(MR_KINDS[r.kind] || LABEL[r.mode] || r.mode), 'set on trips by hand'] : ['Default: ' + (r.when ? mrWhenText(r.when) : 'any time'), LABEL[r.mode] || r.mode];
    if (m.max_km != null) bits.push('under ' + dist(m.max_km));
    if (m.min_km != null) bits.push('over ' + dist(m.min_km));
    var cst = mrCcState(r);
    if (cst.how === 'only') bits.push(esc(mrCcText(cst)));  // Not in shows as its Not on tag, with Undo
    if (r.strava_name) bits.push('same as “' + esc(r.strava_name) + '”');
    var ic = r.kind === 'strida' ? 'strida' : r.kind === 'halfbike' ? 'halfbike' : r.kind === 'cargo' ? 'cargobike' : r.kind === 'ebike' ? 'ebike' : r.mode;
    return mrRuleRow('gear', r, r.name || r.id, bits.map(function (b) { return b; }).join(' · '), ic, modeColor(r.mode || 'CYCLING'), !MR.on ? null : r.assign === false ? mrGearUses(r) : MR_COUNT[r.id] || 0);
  }).join('') + '</div>';
  if (places.length || moves.length) h += '<div class="sec" data-mr-tab="places"><h3>Places</h3>' + places.map(function (r) {
    var sub = [r.role ? (MR_LIFE[r.role] ? (mrIsPast(r) ? 'Past ' + r.role : 'Current ' + r.role) : mrKindName(r.role)) : '', r.when ? mrWhenText(r.when) : '', r.hide ? 'Hidden from pins, heatmap and places' : '', (MR_COUNT[r.id] || 0) + ' stays'].filter(Boolean).join(' · ');
    return mrRuleRow('places', r, r.name || mrKindName(r.role) || r.id, sub, mrLook(r).ic, r.hide ? '#9aa49d' : mrLook(r).bg, null);
  }).join('') + (moves.length ? '<h4 class="place-h mr-grp">Places that moved</h4>' + moves.map(function (r) {
    var sub = (r.keep ? 'Google\'s location kept' : 'Where it was ' + mvWhen(r.when)) + ' · ' + mvStays(MR.on ? MR_COUNT[r.id] || 0 : 0);
    return mrRuleRow('moves', r, r.name || r.id, sub, 'pin', r.keep ? '#9aa49d' : '#0f7c8c', null);
  }).join('') : '') + '</div>';
  // Corrections by date (newest first) or by type (then newest first), with a heading per type.
  var csort = PREFS.corSort === 'type' ? 'type' : 'date', cgrp = null;
  cor = cor.slice().sort(function (a, b) { return csort === 'type' && mrCorGroup(a).localeCompare(mrCorGroup(b)) || mrCorTime(b) - mrCorTime(a); });
  if (cor.length) h += '<div class="sec" data-mr-tab="corrections"><div class="sec-head"><h3>Corrections</h3>' + (cor.length > 1 ? '<div class="seg mr-sort" role="group" aria-label="Sort corrections"><button type="button" data-cor-sort="date" aria-pressed="' + (csort === 'date') + '">By date</button><button type="button" data-cor-sort="type" aria-pressed="' + (csort === 'type') + '">By type</button></div>' : '') + '</div>' + cor.map(function (c) {
    var gh = '';
    if (csort === 'type' && mrCorGroup(c) !== cgrp) { cgrp = mrCorGroup(c); gh = '<h4 class="place-h mr-grp">' + esc(cgrp) + '</h4>'; }
    var t = c.trip || {}, th = c.then || {}, g = th.gear, gr = g && String(g).charAt(0) === '@' ? mrById(g) : null, bits = [];
    var when = t.trips ? (c.name || 'Bulk edit of ' + tripsText(t.trips.length)) : t.start ? t.start.slice(0, 16).replace('T', ', ') : t.day || (t.span ? t.span.join(' – ') : '');
    if (th.mode) bits.push('Type: ' + esc(LABEL[th.mode] || th.mode));
    if (th.name) bits.push('Title: “' + esc(th.name) + '”');
    if (g) bits.push('Gear: ' + esc(gr ? gr.name || gr.id : g));
    if (th.hide === true) bits.push('Hidden');
    if (th.hide === false) bits.push('Shown again');
    var ign = Array.isArray(th.ignore_points) ? th.ignore_points.length : 0;
    if (ign) bits.push(fmt(ign) + ' GPS point' + (ign === 1 ? '' : 's') + ' ignored');
    if (th.replace) bits.push('Replace: not applied in this version of BT•DT');
    var x = MR_COR && MR_COR.filter(function (y) { return y.c === c; })[0], first = x && x.trips.length ? x.trips[0] : null;
    var ic = th.hide ? 'shield' : th.mode || (g ? 'CYCLING' : ign ? 'pinOff' : 'info');
    var applied = th.mode || th.name || g || th.hide != null || ign;
    return gh + mrRuleRow('corrections', c, when || c.id, (bits.join(' · ') || 'Nothing to change') + (first != null ? ' · <button type="button" class="link-btn" data-mr-trip="' + first + '">Open trip</button>' : '') + (t.trips && x && x.trips.length > 1 ? ' · <button type="button" class="link-btn" data-mr-trips="' + esc(c.id) + '">List its trips</button>' : ''),
      ic, th.mode ? modeColor(th.mode) : g ? modeColor('CYCLING') : '#9aa49d', applied && D ? W.count[c.id] || 0 : null);
  }).join('') + '</div>';
  if (rout.length) h += '<div class="sec" data-mr-tab="routines"><h3>Routines</h3>' + rout.map(function (r) {
    var t = r.then || {}, a = mrEnd(r.from, mrEndM(r, 'from')), b = mrEnd(r.to, mrEndM(r, 'to')), ln = D && W.line && W.line[r.id], bits = [];
    function end(ref, e) { var pr = typeof ref === 'string' ? mrById(ref) : null; return pr ? pr.name || pr.role || pr.id : e ? (needPlaces(), placeLabel(mrNearestPlace(e.at))) : '?'; }
    bits.push(esc(end(r.from, a)) + (r.both_ways ? ' ⇄ ' : ' → ') + esc(end(r.to, b)));
    bits.push(mrWhenText(r.when));
    if (t.mode) bits.push(esc(LABEL[t.mode] || t.mode) + (r.force ? ', always' : ', where the type was missing, generic or guessed'));
    if (t.gear) { var gr = String(t.gear).charAt(0) === '@' ? mrById(t.gear) : null; bits.push('Gear: ' + esc(gr ? gr.name || gr.id : t.gear)); }
    var left = D && W.left[r.id] || { type: 0, gear: 0, line: 0 };
    if (!MR.on && D) bits.push('Would take ' + tripsText(W.count[r.id] || 0) + ' with MyRules on');
    if (t.snap) bits.push(ln && ln.missing ? 'Line: ' + esc(ln.missing) + ' isn\'t loaded, so it takes no trips' : ln ? 'Line: ' + (ln.src === 'trip' ? 'learned from the trip on ' + esc(mrWhere(ln.from)) : esc(ln.src)) + ' · trips that follow it for ' + mrMatchMin(t) + '% or more' + (left.line ? ' (' + fmt(left.line) + ' below)' : '') : left.line ? 'Line: no trip with 5 or more GPS points to take it from yet, so it takes none of the ' + fmt(left.line) + ' it matches' : 'Line: no trip with 5 or more GPS points to take it from yet');
    if (left.type) bits.push(fmt(left.type) + ' left out: your files give them another type' + (t.mode ? ' (turn on Always to take them)' : ''));
    if (left.gear) bits.push(fmt(left.gear) + ' left out: recorded with other gear');
    if (!a || !b) bits.push('Its from or to isn\'t a place with a position');
    return mrRuleRow('routines', r, r.name || r.id, bits, t.mode || 'OTHER', t.mode ? modeColor(t.mode) : '#9aa49d', D ? W.count[r.id] || 0 : null);
  }).join('') + '</div>';
  if (snaps.length) h += '<div class="sec" data-mr-tab="snaps"><h3>Map snaps</h3>' + snaps.map(snapRuleRow).join('') + '</div>';
  // Bad GPS spots (Ignore GPS points › Every trip, here), with the corrections.
  if (spots.length) h += '<div class="sec" data-mr-tab="corrections"><h3>Bad GPS spots</h3>' + spots.map(function (r) {
    var n = Array.isArray(r.at) ? r.at.length : 0;
    return mrRuleRow('gps_spots', r, r.name || 'Bad GPS spot', [fmt(n) + ' spot' + (n === 1 ? '' : 's'), distShort(GPS_SPOT_KM * 1000) + ' around each', 'its points are left out of every trip, except where a trip starts or ends'], 'pinOff', 'var(--muted)', MR.on ? MR_COUNT[r.id] || 0 : null);
  }).join('') + '</div>';
  if (!gear.length && !places.length && !moves.length && !cor.length && !rout.length && !snaps.length && !spots.length) h = '<p class="fine">No rules yet. Edit a trip (its type, title or gear) to make one, or add gear here.</p>' + h;
  // Tabs, one per kind of rule that has any, so a long list is easy to browse.
  var tabs = [['gear', 'Gear', gear.length, 1], ['places', 'Places', places.length + moves.length], ['routines', 'Routines', rout.length], ['snaps', 'Map snaps', snaps.length], ['corrections', 'Corrections', cor.length + spots.length]].filter(function (t) { return t[2] || t[3]; });
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
// When a correction is about: its trip's start, its day, the start of its span, its first trip.
function mrCorTime(c) {
  var t = c.trip || {}, v = t.start || t.day || t.span && t.span[0] || t.trips && t.trips[0] && t.trips[0].start;
  var ms = v ? Date.parse(v.length === 10 ? v + 'T00:00' : v) : NaN;
  return isFinite(ms) ? ms : 0;
}
// What sort of change it makes, to sort and group by: the type it sets, else what else it does.
function mrCorGroup(c) {
  var th = c.then || {};
  return th.mode ? LABEL[th.mode] || th.mode : th.hide === true ? 'Hidden' : th.gear ? 'Gear' : th.name ? 'Titles' : th.checked ? 'Type checked' : Array.isArray(th.ignore_points) && th.ignore_points.length ? 'Ignored GPS points' : 'Other';
}
// ---------- cleaning up the corrections ----------
// Edits pile up: a trip fixed twice, a type set to what the files already said, a trip that is no
// longer in the data, bulk edits made in several goes. mrCleanPlan finds them, with what would change
// (nothing on the map: every step keeps what the corrections do to the trips loaded), and mrCleanRun
// does the ones ticked. Needs the trips and MyRules on, since it looks at what each correction did.
// Groups: empty (nothing to change), gone (no trip in the data, only for dates the data covers), same
// (a type the trip already had in the files: kept as Type checked, which is what it did), dup (more
// than one edit on one trip: one edit with all of it, the later one winning a field both set), bulk
// (bulk edits that do the same, joined).
var MR_CLEAN = null;   // the last clean-up, for Undo: { before (the rules), stamp (about.updated after it), text }
var MR_CLEAN_GROUPS = [
  ['dup', 'Several edits on one trip', 'joined into one edit per trip'],
  ['same', 'Type set to what your files already say', 'kept as Type checked, which is all they did'],
  ['gone', 'Edits on trips that aren\'t in your data', 'deleted (only for dates your data covers)'],
  ['empty', 'Edits that change nothing', 'deleted'],
  ['bulk', 'Bulk edits that do the same thing', 'joined into one']
];
function mrCorDoes(t) {
  t = t || {};
  return !!(t.mode != null && MODE_IDX[t.mode] != null || typeof t.name === 'string' && t.name.trim() || t.gear || typeof t.hide === 'boolean' || t.checked === true || Array.isArray(t.ignore_points) && t.ignore_points.length || t.replace);
}
function mrRefDay(ref) {
  var v = ref && (ref.start || ref.day || ref.span && ref.span[0]);
  return v ? mrDayNum(String(v).slice(0, 10)) : null;
}
function mrCleanPlan() {
  var plan = { items: [], n: {} };
  if (!D || !MR || !MR.on || !D.base) return plan;
  var b = D.base, all = mrList('corrections'), act = all.filter(function (c) { return c.id && c.enabled !== false && c.trip && typeof c.trip === 'object'; });
  var minD = M ? M.minD : -Infinity, maxD = M ? M.maxD : Infinity, cut = {};
  function inData(ref) { var d = mrRefDay(ref); return d != null && d >= minD && d <= maxD; }
  function add(kind, c, text, i, extra) { plan.items.push(Object.assign({ kind: kind, c: c, text: text, i: i }, extra || {})); plan.n[kind] = (plan.n[kind] || 0) + 1; }
  function when(c) { var t = c.trip; return t.start ? t.start.slice(0, 16).replace('T', ', ') : t.day || (t.span ? t.span.join(' – ') : c.name || c.id); }
  // Which trips each correction points at, and the other corrections on each trip.
  var refs = new Map(), on = {};
  act.forEach(function (c) {
    var tr = c.then && typeof c.then === 'object' ? mrRefTrips(c.trip) : [];
    refs.set(c, tr);
    tr.forEach(function (i) { (on[i] || (on[i] = [])).push(c); });
  });
  act.forEach(function (c) {
    var t = c.trip, th = c.then;
    if (!th || typeof th !== 'object' || !mrCorDoes(th)) { add('empty', c, when(c) + ': nothing to change'); cut[c.id] = 1; return; }
    if (Array.isArray(t.trips)) {
      var lost = t.trips.filter(function (r) { return inData(r) && !mrRefTrips(r).length; });
      if (lost.length) { add('gone', c, (c.name || 'Bulk edit') + ': ' + tripsText(lost.length) + ' of ' + fmt(t.trips.length) + ' not in your data', null, { lost: lost }); if (lost.length === t.trips.length) cut[c.id] = 1; }
      return;
    }
    if (!refs.get(c).length) { if (inData(t)) { add('gone', c, when(c) + ': no trip there'); cut[c.id] = 1; } return; }
    if (!t.start) return;
    var i = refs.get(c)[0];
    // A type the trip already had: not a guess, no routine or map snap took it, no other edit gives it another type, not a recorded activity.
    if (th.mode != null && MODE_IDX[th.mode] === b.mode[i] && !(b.est[i] & GUESSED) && !(b.est[i] & STRAVA) && !(D.mrRoute && D.mrRoute[i]) && !(D.mrSnap && D.mrSnap[i]) &&
      !(on[i] || []).some(function (o) { return o !== c && o.then && o.then.mode != null && o.then.mode !== th.mode; }))
      add('same', c, when(c) + ': ' + (LABEL[th.mode] || th.mode) + ', as in your files', i);
  });
  // Several edits on one trip (each on that trip alone): joined into the last one.
  Object.keys(on).forEach(function (k) {
    var own = on[k].filter(function (c) { return c.trip.start && !cut[c.id]; });
    if (own.length < 2) return;
    add('dup', own[own.length - 1], when(own[own.length - 1]) + ': ' + own.length + ' edits', +k, { from: own.slice(0, -1) });
  });
  // Bulk edits that do the same: joined when nothing between them touches their trips.
  var bulks = act.filter(function (c) { return Array.isArray(c.trip.trips) && !cut[c.id] && !(c.except && c.except.length) && !(c.unless && c.unless.length) && c.then && typeof c.then === 'object'; });
  var byThen = {};
  bulks.forEach(function (c) { var key = JSON.stringify(c.then); (byThen[key] || (byThen[key] = [])).push(c); });
  Object.keys(byThen).forEach(function (key) {
    var L = byThen[key];
    if (L.length < 2) return;
    var keep = L[L.length - 1], at = act.indexOf(keep), join = L.slice(0, -1).filter(function (c) {
      // Moving c's trips to where keep is must not jump them over another day, span or bulk edit on them.
      var mine = {}, from = act.indexOf(c);
      refs.get(c).forEach(function (i) { mine[i] = 1; });
      return !act.slice(from + 1, at).some(function (o) { return !o.trip.start && L.indexOf(o) < 0 && (refs.get(o) || []).some(function (i) { return mine[i]; }); });
    });
    if (join.length) add('bulk', keep, (keep.name || 'Bulk edit') + ': ' + (join.length + 1) + ' bulk edits', null, { from: join });
  });
  return plan;
}
// Does the groups ticked (all when kinds is left out) on MR.doc. Returns how many corrections went or changed.
function mrCleanRun(plan, kinds) {
  var gone = new Set(), changed = new Set(), fix = {};
  function want(k) { return !kinds || kinds[k]; }
  plan.items.forEach(function (x) {
    if (!want(x.kind)) return;
    var c = x.c;
    if (x.kind === 'empty' || x.kind === 'gone' && !x.lost) gone.add(c);
    else if (x.kind === 'gone') { c.trip.trips = c.trip.trips.filter(function (r) { return x.lost.indexOf(r) < 0; }); if (!c.trip.trips.length) gone.add(c); else changed.add(c); }
    else if (x.kind === 'same') fix[c.id] = c;
  });
  // A type the trip already had becomes Type checked (before joining, so a joined edit keeps a type from another).
  Object.keys(fix).forEach(function (id) { var c = fix[id]; delete c.then.mode; c.then.checked = true; changed.add(c); });
  plan.items.forEach(function (x) {
    if (!want(x.kind) || (x.kind !== 'dup' && x.kind !== 'bulk')) return;
    var c = x.c, from = x.from.filter(function (o) { return !gone.has(o); });
    if (!from.length) return;
    if (x.kind === 'dup') {
      var th = {}, nm = '';
      from.concat([c]).forEach(function (o) { Object.assign(th, o.then); if (o.name) nm = o.name; });
      if (th.mode != null) delete th.checked;
      c.then = th;
      if (nm && !c.name) c.name = nm;
    } else {
      var seen = {}, list = [];
      from.concat([c]).forEach(function (o) { o.trip.trips.forEach(function (r) { var k = JSON.stringify(r); if (!seen[k]) { seen[k] = 1; list.push(r); } }); });
      list.sort(function (p, q) { return Date.parse(p.start || p.day) - Date.parse(q.start || q.day); });
      c.trip.trips = list;
      if (!c.name || /^Bulk edit: /.test(c.name)) c.name = 'Bulk edit: ' + tripsText(list.length) + (c.then.mode ? ' to ' + (LABEL[c.then.mode] || c.then.mode).toLowerCase() : '');
    }
    from.forEach(function (o) { gone.add(o); });
    changed.add(c);
  });
  if (gone.size) MR.doc.corrections = (MR.doc.corrections || []).filter(function (c) { return !gone.has(c); });
  gone.forEach(function (c) { changed.delete(c); });
  return { gone: gone.size, changed: changed.size };
}
function mrCleanAsk() {
  var plan = mrCleanPlan();
  if (!plan.items.length) { toast('Your corrections are already tidy'); return; }
  var groups = MR_CLEAN_GROUPS.filter(function (g) { return plan.n[g[0]]; });
  var extra = '<div class="mr-clean">' + groups.map(function (g) {
    var items = plan.items.filter(function (x) { return x.kind === g[0]; });
    return '<div class="mr-clean-g"><label class="toggle-row"><span class="lbl"><b>' + esc(g[1]) + '</b> <span class="num">' + fmt(items.length) + '</span><small class="fine" style="display:block">' + esc(g[2]) + '</small></span>' +
      '<input type="checkbox" class="switch" data-clean="' + g[0] + '" checked></label>' +
      '<details><summary class="fine">See ' + (items.length === 1 ? 'it' : 'them') + '</summary><ul class="mr-changes">' + items.map(function (x) { return '<li>' + esc(x.text) + '</li>'; }).join('') + '</ul></details></div>';
  }).join('') + '</div>';
  mrAsk({
    title: 'Clean up your corrections?',
    text: 'Your trips stay as they are now: these only tidy how your edits are written down, so the file is shorter and easier to go through.',
    extra: extra,
    buttons: [['Clean up', 'primary', function () {
      var kinds = {};
      $('mrDlgExtra').querySelectorAll('[data-clean]').forEach(function (el) { if (el.checked) kinds[el.dataset.clean] = 1; });
      if (!Object.keys(kinds).length) return;
      working('Cleaning up your rules…', function () { mrCleanDo(plan, kinds); });
    }], ['Cancel', 'quiet', null]],
    note: 'You can undo it from the top of your rules until you change anything else or reload the page.'
  });
}
function mrCleanDo(plan, kinds) {
  var before = JSON.parse(JSON.stringify(MR.doc)), n0 = mrList('corrections').length;
  var r = mrCleanRun(plan, kinds), n1 = mrList('corrections').length;
  var text = 'Cleaned up corrections: ' + fmt(n0) + ' → ' + fmt(n1) + (r.changed ? ', ' + fmt(r.changed) + ' rewritten' : '');
  mrChange(text);
  MR_CLEAN = { before: before, stamp: MR.doc.about && MR.doc.about.updated, text: text };
  if (openId === 'mrSheet') mrRenderRules();
  toast(text);
}
function mrCleanUndo() {
  if (!MR_CLEAN || !MR || !MR.doc.about || MR.doc.about.updated !== MR_CLEAN.stamp) return;
  MR.doc = MR_CLEAN.before;
  MR_CLEAN = null;
  mrChange('Undid the clean-up');
  if (openId === 'mrSheet') mrRenderRules();
  toast('Clean-up undone');
}
// The line at the top of the rules: Undo for the last clean-up, else Clean up when there is something to do.
function mrCleanBar() {
  if (!MR) return '';
  if (MR_CLEAN && MR.doc.about && MR.doc.about.updated === MR_CLEAN.stamp) return '<p class="fine mr-warn">' + esc(MR_CLEAN.text) + '. <button type="button" class="link-btn" id="mrCleanUndo">Undo</button></p>';
  var plan = mrCleanPlan(), n = plan.items.length;
  if (!n) return '';
  return '<p class="fine mr-warn mr-clean-bar">' + infoMore('Some corrections can be written more simply.', 'Cleaning up joins several edits on one trip, turns a type your files already had into Type checked, and deletes edits on trips not in your data. Your trips stay the same, and you can undo it.', 'About Clean up rules') + ' <button type="button" class="link-btn" id="mrCleanBtn">Clean up rules</button></p>';
}
$('mrBody').addEventListener('click', function (ev) {
  var cs = ev.target.closest('[data-cor-sort]');
  if (cs) { PREFS.corSort = cs.dataset.corSort; savePrefs(); mrRenderRules(); return; }
  if (ev.target.closest('#mrCleanBtn')) { mrCleanAsk(); return; }
  if (ev.target.closest('#mrCleanUndo')) { working('Undoing the clean-up…', mrCleanUndo); return; }
  if (ev.target.closest('#mrSwitchOn')) { working('Applying MyRules…', function () { MR.on = true; mrSave(); mrReapply(); mrRenderRules(); renderImports(); }); return; }
  var t = ev.target.closest('[data-mr-tabbtn]');
  if (!t) return;
  MR_TAB = t.dataset.mrTabbtn;
  mrRenderRules();
});
$('mrBody').addEventListener('click', function (ev) { if (ev.target.closest('[data-mr-newgear]')) mrGearRuleDialog(); });
$('mrBody').addEventListener('change', function (ev) {
  var id = ev.target.dataset.mrOn;
  if (!id) return;
  var r = mrById(id);
  if (!r) return;
  var on = ev.target.checked;
  working(on ? 'Applying the rule…' : 'Switching the rule off…', function () {
    if (on) delete r.enabled; else r.enabled = false;
    mrChange((on ? 'Switched on: ' : 'Switched off: ') + (r.name || r.id));
  });
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
    saving(function () {
      ur.unless.splice(uk, 1);
      if (!ur.unless.length) delete ur.unless;
      mrChange((ur.name || ur.id) + ' on again for ' + mrUnlessText(u));
    });
    return;
  }
  var o = ev.target.closest('[data-mr-trip]');
  if (o) { openTrip(+o.dataset.mrTrip); return; }
  var ol = ev.target.closest('[data-mr-trips]');
  if (ol) { mrBulkList(ol.dataset.mrTrips); return; }
  var ed = !ev.target.closest('.info-btn, .info-box') && ev.target.closest('[data-mr-edit]');
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
$('mrSheetExport').addEventListener('click', mrExport);
$('mrExportData').addEventListener('click', mrExport);

// ---------- trip details ----------
// What MyRules did to a trip, each with Undo (a correction) or Not this trip (a gear period); Edit
// trip (type, title, hide) for every trip, and Set gear for the types that have gear (MR_GEAR_KINDS):
// rides, runs, walks, car and motorbike trips, boat trips (not ferries) and snow sports.
var MR_GEAR_MODES = MR_GEAR_KINDS;
function mrWhere(i) { return niceDate(D.day[i]) + ', ' + clock(D.start[i], D.off[i]); }
function mrTripBlock(i) {
  if (!D || isDup(i)) return '';
  var h = '', g = D.mrGear && D.mrGear[i], amb = D.mrAmb && D.mrAmb[i], md = D.mrMode && D.mrMode[i], nm = D.mrName && D.mrName[i];
  function src(id, field) {
    var r = mrById(id), one = r && r.trip && r.trip.start, bulk = r && r.trip && Array.isArray(r.trip.trips);
    if (bulk) return '<div class="fine">From the bulk edit <i>' + esc(r.name || r.id) + '</i> (' + tripsText(r.trip.trips.length) + ') · <button type="button" class="link-btn" data-mr-act="detach" data-r="' + esc(id) + '" data-t="' + i + '">Detach this trip</button>' + (r.trip.trips.length > 1 ? ' · <button type="button" class="link-btn" data-mr-trips="' + esc(id) + '">List its trips</button>' : '') + '</div>';
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
  if (g && g.def) h += '<div class="mr-chg"><b>Gear:</b> ' + esc(GEAR[g.gear].name) + ' <span class="fine">(guessed)</span><div class="fine">' +
    infoMore('Your default car, until you say it was.', 'Car trips without gear get your default car as a guess, and its CO₂ is counted with it. Confirm this trip, or every trip in a period at once (that saves a gear period). To pick another car, use Change gear in Trip info.', 'About the default car') + '</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"><button type="button" class="btn primary" data-mr-act="gearok" data-t="' + i + '">' + esc(GEAR[g.gear].name) + ' is right</button>' +
    '<button type="button" class="btn" data-mr-act="gearperiod" data-t="' + i + '">Confirm for a period…</button></div></div>';
  else if (g) h += '<div class="mr-chg"><b>Gear:</b> ' + esc(GEAR[g.gear].name) + src(g.rule, g.cor ? 'gear' : '') + '</div>';
  var dr = D.mrDrop && D.mrDrop[i];
  if (dr) h += '<div class="mr-chg"><b>GPS points ignored:</b> ' + fmt(dr.n) + ' of ' + fmt(dr.of) + (Math.abs(dr.km - D.km[i]) >= 0.01 ? ' <span class="fine">(' + dist(dr.km) + ' with them)</span>' : '') + src(dr.rule, 'ignore_points') + '</div>';
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
    else why = 'It follows the routine\'s line for ' + (ms.score || 0) + '% of its GPS points, and the routine takes trips from ' + ms.min + '%.' + (ms.can ? '' : ' Its start or end is over ' + dist(1) + ' from the line, so it can\'t be drawn along it.');
    h += '<div class="mr-chg"><b>Not in routine:</b> ' + esc(mr.name || mr.id) + way(ms.dir) + '<div class="fine">' + infoMore('It matches by place and time, but not everything the routine sets fits.', 'Everything a routine sets (type, gear, line) applies together or not at all. ' + why, 'Why it is not in the routine') + '</div></div>';
  }
  var msn = !rr && D.mrSnap && D.mrSnap[i], msr = msn && mrById(msn.rule);
  if (msr && sn) h += '<div class="mr-chg"><b>Map snap:</b> ' + esc(msr.name || msr.id) + way(msn.dir) + '<div class="fine">Drawn ' + esc(msr.line && msr.line.name ? msr.line.name.charAt(0).toLowerCase() + msr.line.name.slice(1) : 'along its line') + ': ' + infoMore(dist(sn.km) + '.', 'Its own GPS points, dashed on the map, come to ' + dist(D.base.km[i]) + '. It follows the line for ' + sn.score + '% of its GPS points.') + '</div></div>';
  var tk = D.mrTrack && D.mrTrack[i];
  if (tk && sn) h += '<div class="mr-chg"><b>On the tracks:</b> ' + esc(tk.from) + ' – ' + esc(tk.to) + '<div class="fine">Drawn ' + esc(tk.name.charAt(0).toLowerCase() + tk.name.slice(1)) + ' from your ' + esc(packNames(tk.packs || [])) + ' station pack' + ((tk.packs || []).length > 1 ? 's' : '') + ': ' + infoMore(dist(sn.km) + '.', 'Its own GPS points, dashed on the map, come to ' + dist(D.base.km[i]) + '. ' + tk.score + '% of them are near the line. Turn it off in Menu › Trip cleanup.') + '</div></div>';
  if (mrRoaded(i)) h += '<div class="mr-chg"><b>On the roads</b><div class="fine">' + infoMore('Drawn along main roads for ' + D.snap[i].cov + '% of the way: ' + dist(D.snap[i].km) + '.', 'It follows the motorways and main roads of your road pack where its GPS points stay close to them, and its own GPS points elsewhere. Its own GPS points, dashed on the map, come to ' + dist(D.base.km[i]) + '. Turn it off in Menu › Trip cleanup.') + '</div></div>';
  if (amb) h += '<div class="mr-chg"><b>Gear:</b> none<div class="fine">' + amb.map(function (id) { var r = mrById(id); return '<i>' + esc(r ? r.name || r.id : id) + '</i>'; }).join(' and ') + ' both fit this trip equally well. Set its gear, or narrow one of them.</div></div>';
  // Trip info is in the pencil menu of the trip's header (mrEditMenu).
  var btns = '';
  // Remove edit: every correction that changed this trip lets go of it (mrRemoveEdits).
  var eds = mrTripEdits(i);
  if (eds.length) btns += '<button type="button" class="btn" data-mr-act="remove" data-t="' + i + '">' + icon('undo') + (eds.length > 1 ? 'Remove edits' : 'Remove edit') + '</button>';
  // Not this trip: out of the routine (its type, gear and line), else out of the gear period.
  if (rr || g && !g.cor) btns += '<button type="button" class="btn" data-mr-act="not" data-r="' + esc(rr ? rr.id : g.rule) + '" data-t="' + i + '">Not this trip' + (rr ? '' : '') + '</button>';
  // Group with similar trips is in ⋯ in the trip's header (mrEditTop).
  if (ms && ms.why === 'fit' && ms.can && mr) btns += '<button type="button" class="btn primary" data-mr-act="include" data-r="' + esc(mr.id) + '" data-t="' + i + '">Add to routine</button>';
  if (rr || mr) btns += '<button type="button" class="btn" data-mr-act="rule" data-r="' + esc((rr || mr).id) + '" data-t="' + i + '">Edit routine</button>';
  if (msr && sn) btns += '<button type="button" class="btn" data-mr-act="snaprule" data-r="' + esc(msr.id) + '" data-t="' + i + '">Open map snap</button>';
  // A trip of your own as the line: one in the routine, or one left out for want of a line or for going another way.
  var lr = rr || ms && (ms.why === 'noline' || ms.why === 'fit') && mr, lln = lr && D.mrLine[lr.id];
  if (lr && lr.then && lr.then.snap && mrLearned(lr.then.snap) && !(lln && lln.from === i) && D.pathOff[i + 1] - D.pathOff[i] >= 5) btns += '<button type="button" class="btn" data-mr-act="line" data-r="' + esc(lr.id) + '" data-t="' + i + '">Use this trip\'s line</button>';
  if (!h && !btns) return mrCheckBlock(i);
  return mrCheckBlock(i) + '<div class="mr-trip">' + (h ? '<h4 class="place-h">From MyRules</h4>' + h : '') + (btns ? '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">' + btns + '</div>' : '') + '</div>';
}
// ⋯ beside the pencil in the trip's header: Group with similar trips, Show this day on the map,
// Open in Timeline and Raw data.
function mrEditTop(i) {
  if (!D) return '';
  var more = [];
  if (mrSimilarOk(i)) more.push(moreItem('data-mr-act="similar" data-t="' + i + '"', 'groupWork', 'Group with similar trips'));
  if (F.dm !== 'one' || F.unit !== 'day' || tab !== 'map') more.push(moreItem('data-act="day" data-i="' + i + '"', 'calendar', 'Show this day on the map'));
  if (tab !== 'timeline') more.push(moreItem('data-act="tl" data-i="' + i + '"', 'history', 'Open in Timeline'));
  more.push(moreItem('data-act="raw" data-i="' + i + '" aria-expanded="false"', 'file', 'Raw data'));
  return moreMenu(more, 'More for this trip', 'more', 'end');
}
// The pencil at the right of the trip's header, before ⋯: everything you can change about this one trip.
// Trip info (type, title, gear), Split trip, Ignore GPS points, and Hide this trip.
function mrEditMenu(i) {
  if (!D || isDup(i)) return '';
  var it = [moreItem('data-mr-act="edit" data-t="' + i + '"', 'edit', 'Trip info')];
  if (splitHandOk(i)) it.push(moreItem('data-split-hand="' + i + '"', 'split', 'Split trip'));
  if (ignOk(i)) it.push(moreItem('data-ign="' + i + '"', 'pinOff', 'Ignore GPS points'));
  it.push(D.mrHide && D.mrHide[i] ? moreItem('data-mr-act="show" data-t="' + i + '"', 'undo', 'Show this trip again') : moreItem('data-mr-act="hide" data-t="' + i + '"', 'hide', 'Hide this trip'));
  return moreMenu(it, 'Edit this trip', 'edit', 'end');
}
// Group with similar trips: a new routine between this trip's ends, matched by route, not by time (along
// its own trail as the line when it has 5 or more GPS points, else by its ends and type alone).
// Not for a trip a routine already has or left out, nor for flights or trips under 1 km end to end.
function mrSimilarOk(i) {
  if (isDup(i) || D.mrRoute && D.mrRoute[i] && mrById(D.mrRoute[i].rule) || D.mrMiss && D.mrMiss[i] && mrById(D.mrMiss[i].rule)) return false;
  return MODES[D.mode[i]] !== 'FLYING' && isFinite(D.from[2 * i]) && isFinite(D.to[2 * i]) && km([D.from[2 * i], D.from[2 * i + 1]], [D.to[2 * i], D.to[2 * i + 1]]) > 1;
}
// Is this the right type? For a trip in the check list: why, and one tap to keep or change its type.
function mrCheckBlock(i) {
  if (!mrCheck(i)) return '';
  var m = MODES[D.mode[i]], alt = MODES[D.chk[i]], w = D.chkWhy[i] || {}, lab = function (x) { return esc((LABEL[x] || x).toLowerCase()); }, why;
  if (w.kind === 'speed') why = 'Your files say ' + lab(m) + ', but it averaged ' + speed(w.avg) + ', faster than a bike ride.';
  else if (w.kind === 'history') why = 'Your files say ' + lab(m) + ', but ' + fmt(w.n) + ' of your trips between these places at a like speed were mostly by ' + lab(alt) + '.';
  else why = 'BT•DT guessed ' + lab(m) + ' but isn\'t sure. It may have been ' + lab(alt) + '.';
  return '<div class="mr-check"><h4 class="place-h">Is this the right type?</h4><p class="fine">' + infoMore(why, 'Your answer is saved in MyRules and teaches BT•DT for trips like it.') + '</p>' +
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
  mrChange('Trip on ' + mrWhere(i) + ': ' + (type === cur ? 'type checked, ' : 'type ') + (LABEL[type] || type).toLowerCase(), i);
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
function mrBulkList(id) {
  var r = mrById(id), x = r && mrCorrections().filter(function (y) { return y.c === r; })[0];
  if (!x || !x.trips.length) { toast('None of its trips are in the data you loaded'); return; }
  openList(x.trips.slice().reverse(), r.name || 'Bulk edit');
}
// Out of a bulk edit: its entry goes; a bulk edit with no trips left goes too.
function mrDetach(c, i) {
  c.trip.trips = c.trip.trips.filter(function (r) { return mrRefTrips(r).indexOf(i) < 0; });
  if (!c.trip.trips.length) MR.doc.corrections = mrList('corrections').filter(function (x) { return x !== c; });
}
// The corrections (edits) that apply to trip i: its own, bulk edits listing it, days and spans.
function mrTripEdits(i) { return mrCorrections().filter(function (x) { return x.trips.indexOf(i) >= 0; }).map(function (x) { return x.c; }); }
// Remove edit: an edit on this trip alone is deleted, a bulk edit lets go of it (mrDetach), and a
// correction on a day or span leaves it out (its except). Asks first, saying what each one does.
function mrRemoveEdits(i) {
  var eds = mrTripEdits(i);
  if (!eds.length) return;
  function what(c) {
    var t = c.then || {}, b = [];
    if (t.mode) b.push('type ' + (LABEL[t.mode] || t.mode).toLowerCase());
    if (t.name) b.push('title “' + t.name + '”');
    if (t.gear) b.push('gear');
    if (t.hide === true) b.push('hidden');
    if (t.checked === true) b.push('type checked');
    if (Array.isArray(t.ignore_points) && t.ignore_points.length) b.push(fmt(t.ignore_points.length) + ' GPS point' + (t.ignore_points.length === 1 ? '' : 's') + ' ignored');
    return b.join(', ');
  }
  var lines = eds.map(function (c) {
    var w = what(c), nm = esc(c.name || c.id);
    if (c.trip.start) return '<li>This trip\'s own edit' + (w ? ' (' + esc(w) + ')' : '') + ' is deleted.</li>';
    if (Array.isArray(c.trip.trips)) return '<li>The trip is detached from the bulk edit <i>' + nm + '</i>' + (w ? ' (' + esc(w) + ')' : '') + (c.trip.trips.length > 1 ? '; its other trips keep it.' : ', which goes with it.') + '</li>';
    return '<li>The trip is left out of the correction for ' + esc(c.trip.day || (c.trip.span || []).join(' – ')) + (w ? ' (' + esc(w) + ')' : '') + '; its other trips keep it.</li>';
  }).join('');
  mrAsk({
    title: eds.length > 1 ? 'Remove the edits on this trip?' : 'Remove the edit on this trip?',
    text: esc(tripRoute(i)) + ' · ' + mrWhere(i) + '<ul class="fine" style="margin:8px 0 0;padding-left:18px">' + lines + '</ul>',
    buttons: [['Remove', 'danger', function () {
      eds.forEach(function (c) {
        if (c.trip.start) MR.doc.corrections = mrList('corrections').filter(function (x) { return x !== c; });
        else if (Array.isArray(c.trip.trips)) mrDetach(c, i);
        else (c.except || (c.except = [])).push({ start: mrIsoLocal(i), mode: MODES[D.base.mode[i]] });
      });
      mrChange('Edit removed: the trip on ' + mrWhere(i), eds.some(function (c) { return c.then && c.then.ignore_points; }) ? null : i);
      toast(eds.length > 1 ? 'Edits removed.' : 'Edit removed.');
      openTrip(i);
    }], ['Cancel', 'quiet', null]],
    note: 'It goes back to what your files say. Rules like routines and gear periods still apply.'
  });
}
function mrDropAction(c, field) {
  delete c.then[field];
  if (!Object.keys(c.then).length) MR.doc.corrections = mrList('corrections').filter(function (x) { return x !== c; });
}
var MR_UNDO = { mode: 'Type', name: 'Title', gear: 'Gear', hide: 'Hidden', checked: 'Type checked', ignore_points: 'Ignored GPS points' };
$('tripBody').addEventListener('click', function (ev) {
  var lt = ev.target.closest('[data-mr-trips]');
  if (lt) { mrBulkList(lt.dataset.mrTrips); return; }
  var b = ev.target.closest('[data-mr-act]');
  if (!b) return;
  var i = +b.dataset.t, act = b.dataset.mrAct;
  if (MR_SAVE_ACTS[act]) saving(function () { mrTripAct(b, i, act); }); else mrTripAct(b, i, act);
});
// The trip page's MyRules buttons; the ones that save (MR_SAVE_ACTS) run behind the Working pill.
var MR_SAVE_ACTS = { line: 1, not: 1, undo: 1, detach: 1, include: 1, type: 1, hide: 1, show: 1, gearok: 1 };
function mrTripAct(b, i, act) {
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
    // Ignored GPS points change the trip's line before anything else: those need everything again.
    mrChange('Undone: ' + MR_UNDO[f] + ' on ' + mrWhere(i), f === 'ignore_points' ? null : i);
    openTrip(i);
  } else if (act === 'detach') {
    var bc = mrById(b.dataset.r);
    if (!bc || !bc.trip || !Array.isArray(bc.trip.trips)) return;
    mrDetach(bc, i);
    mrChange('Detached from ' + (bc.name || bc.id) + ': the trip on ' + mrWhere(i), bc.then && bc.then.ignore_points ? null : i);
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
  else if (act === 'gearok') mrGearOk(i);
  else if (act === 'gearperiod') mrGearPeriodDialog(i);
  else if (act === 'gear') mrGearDialog(i);
  else if (act === 'edit') mrEditDialog(i);
  else if (act === 'hide' || act === 'show') mrHideTrip(i, act === 'hide');
  else if (act === 'remove') mrRemoveEdits(i);
}
// The correction for this one trip that Trip info changes: the last one pointing at it by its start.
function mrTripCorrection(i) {
  return mrCorrections().filter(function (x) { return x.one && x.trips.length === 1 && x.trips[0] === i; }).map(function (x) { return x.c; }).pop() ||
    mrList('corrections').filter(function (c) { return c.trip && c.trip.start && c.enabled !== false && mrRefTrips(c.trip)[0] === i; }).pop() || null;
}
// Trip info: its type, its title and its gear. Saved as a correction on this trip's start, so it
// survives loading the files again.
function mrEditDialog(i) {
  var was = MODES[D.base.mode[i]], cur = MODES[D.mode[i]];
  // Unclassified last: for a trip that looks wrong (a GPS glitch?) when you aren't sure what it was.
  var modes = MODES.filter(function (m) { return m !== 'UNKNOWN'; }).concat(['UNKNOWN']);
  mrAsk({
    title: 'Trip info',
    text: esc(tripRoute(i)) + ' · ' + mrWhere(i) + ' · ' + dist(D.km[i]),
    extra: '<div class="mr-form"><label class="field"><span>Type</span><select id="mrEType">' + modes.map(function (m) {
      return '<option value="' + m + '"' + (m === cur ? ' selected' : '') + '>' + esc(LABEL[m] || m) + (m === 'UNKNOWN' && m !== was ? ' (not sure what it was)' : '') + (m === was ? (D.base.est[i] & GUESSED ? ' (guessed from speed)' : ' (from your files)') : '') + '</option>';
    }).join('') + '</select></label>' +
      '<label class="field"><span>Title</span><input type="text" id="mrEName" value="' + esc(tripName(i)) + '" placeholder="' + esc(recName(i) || 'e.g. Ride to the coast') + '"></label>' +
      mrGearField(i) + '</div>',
    buttons: [['Save', 'primary', function () { mrSaveEdit(i); }], ['Cancel', 'quiet', null]],
    note: 'Saved in MyRules as a correction on this trip. It replaces what your files say.',
    after: function () { var gb = $('mrEGear'); if (gb) gb.addEventListener('click', function () { $('mrDlg').close(); mrGearDialog(i); }); }
  });
}
// Gear in Trip info, for the types that have gear: what it has, and Set gear… unless an activity file
// recorded it (recorded gear is never replaced).
function mrGearField(i) {
  var m = MODES[D.mode[i]], g = D.mrGear && D.mrGear[i], has = D.gear[i], rec = has && !g;
  if (!MR_GEAR_MODES[m]) return '';
  return '<div class="field"><span>Gear</span><div class="mr-rad-row"><span>' + (has ? '<b>' + esc(gearName(has)) + '</b>' + (rec ? ' <small class="fine">recorded by your activity</small>' : '') : '<span class="fine">None</span>') + '</span>' +
    (rec ? '' : '<button type="button" class="btn" id="mrEGear">' + icon('gear') + (has ? 'Change gear…' : 'Set gear…') + '</button>') + '</div></div>';
}
function mrSaveEdit(i) {
  var type = $('mrEType').value, name = $('mrEName').value.trim();
  var was = MODES[D.base.mode[i]], rec = recName(i);
  mrEnsure();
  var c = mrTripCorrection(i), isNew = !c, what = [];
  if (isNew) c = { id: mrNewId('trip-' + isoDay(D.day[i])), trip: { start: mrIsoLocal(i), mode: was }, then: {} };
  var t = c.then || (c.then = {});
  var oldMode = t.mode || was, oldName = t.name || rec;
  // A type the files already had and wasn't guessed needs no correction; a guessed one does, to keep it.
  if (type !== was || D.base.est[i] & GUESSED) t.mode = type; else delete t.mode;
  if (name && name !== rec) t.name = name; else delete t.name;
  if (type !== oldMode) what.push('type ' + (LABEL[type] || type).toLowerCase());
  if ((name || rec) !== oldName) what.push(name && name !== rec ? 'title “' + name + '”' : 'title reset');
  if (!what.length && !(isNew && Object.keys(t).length)) return;
  if (isNew) { if (!Object.keys(t).length) return; (MR.doc.corrections || (MR.doc.corrections = [])).push(c); }
  else if (!Object.keys(t).length) MR.doc.corrections = mrList('corrections').filter(function (x) { return x !== c; });
  mrChange('Trip on ' + mrWhere(i) + ': ' + (what.join(', ') || 'type confirmed'), i);
  if (openId === 'mrSheet') return;
  openTrip(i); if (type !== oldMode && type !== 'UNKNOWN') setTimeout(function () { mrOfferRoutine(i, type); }, 0);
}
// Hide this trip (from the pencil menu), or show it again: saved on the same correction as Trip info.
function mrHideTrip(i, on) {
  var was = MODES[D.base.mode[i]], c = mrTripCorrection(i);
  if (!on && !c) return;
  mrEnsure();
  if (!c) { c = { id: mrNewId('trip-' + isoDay(D.day[i])), trip: { start: mrIsoLocal(i), mode: was }, then: {} }; (MR.doc.corrections || (MR.doc.corrections = [])).push(c); }
  var t = c.then || (c.then = {});
  if (on) t.hide = true; else delete t.hide;
  if (!Object.keys(t).length) MR.doc.corrections = mrList('corrections').filter(function (x) { return x !== c; });
  mrChange('Trip on ' + mrWhere(i) + ': ' + (on ? 'hidden' : 'shown again'), i);
  if (openId === 'mrSheet') return;
  if (on) { closeSheets(); toast('Trip hidden. Show it again from MyRules in Imported data.'); }
  else openTrip(i);
}

// Set gear: on this trip only (a correction), or on every trip of its type without gear in a period
// (a gear period), with the dates from the first and last trip on that gear and a live count.
function mrGearDialog(i) {
  var mode = MODES[D.mode[i]], opts = gearOrder().filter(function (g) { return GEAR[g].mode === mode || GEAR[g].modes && GEAR[g].modes[mode]; });
  // Gear in your list (MyRules) that no trip has yet.
  var listed = mrList('gear').filter(function (r) { return r.mode === mode && r.name && !opts.some(function (g) { return GEAR[g].name === r.name; }); })
    .filter(function (r, k, a) { return a.findIndex(function (x) { return x.name === r.name; }) === k; });
  function span(g) {
    var a = Infinity, b = -Infinity;
    for (var j = 0; j < D.day.length; j++) if (D.gear[j] === g) { a = Math.min(a, D.day[j]); b = Math.max(b, D.day[j]); }
    return isFinite(a) ? [a, b] : [D.day[i], D.day[i]];
  }
  var kinds = mrKindsFor(mode);
  mrAsk({
    title: 'Set gear',
    text: esc(tripRoute(i)) + ' · ' + niceDate(D.day[i]) + ', ' + clock(D.start[i], D.off[i]) + ' · ' + dist(D.km[i]),
    extra: '<div class="mr-form"><label class="field"><span>Gear</span><select id="mrG">' + opts.map(function (g) { return '<option value="' + g + '">' + esc(GEAR[g].name) + '</option>'; }).join('') + listed.map(function (r) { return '<option value="r:' + esc(r.id) + '">' + esc(r.name) + '</option>'; }).join('') + '<option value="new">New gear…</option></select></label>' +
      '<div id="mrNew" hidden class="grid2"><label class="field"><span>Name</span><input type="text" id="mrName" placeholder="e.g. ' + esc(MR_GEAR_EG[mode] || 'My gear') + '"></label><label class="field"><span>Kind</span><select id="mrKind">' + kinds.map(function (k) { return '<option value="' + k + '">' + MR_KINDS[k] + '</option>'; }).join('') + '</select></label></div>' +
      '<label class="mr-opt"><input type="radio" name="mrScope" value="one" checked><span><b>Just this trip</b><small class="fine">Saved as a correction.</small></span></label>' +
      '<label class="mr-opt"><input type="radio" name="mrScope" value="period"><span><b>Every ' + esc((LABEL[mode] || mode).toLowerCase()) + ' trip without gear in a period</b>' +
      // The period's details show once this option is picked.
      '<span class="mr-opt-more" id="mrPeriodMore" hidden><span class="mr-dates"><input type="date" id="mrFrom" aria-label="From"> to <input type="date" id="mrTo" aria-label="To (empty: until now)"></span>' +
      mrCcRow({ how: 'all', list: [] }) +
      '<span class="mr-dates">Only trips under <input type="number" id="mrMax" min="0" step="any" style="width:5em" aria-label="Maximum distance in ' + distUnit() + '"> ' + distUnit() + ' (optional)</span>' +
      '<small class="fine" id="mrCountTxt"></small><small class="fine">Gear recorded by Strava or another activity file is never replaced by a period.</small></span></span></label></div>',
    buttons: [['Save rule', 'primary', function () { mrSaveGear(i); }], ['Cancel', 'quiet', null]],
    after: function () {
      var sel = $('mrG');
      function prefill() {
        var nw = sel.value === 'new';
        $('mrNew').hidden = !nw;
        var lr = /^r:/.test(sel.value), s = nw || lr ? [D.day[i], D.day[i]] : span(+sel.value);
        $('mrFrom').value = isoDay(s[0]); $('mrTo').value = nw || lr ? '' : isoDay(s[1]);
        count();
      }
      function count() {
        var f = mrDayNum($('mrFrom').value), t = mrDayNum($('mrTo').value), mx = distSave(parseFloat($('mrMax').value)), cs = mrCcRead(), c = 0;
        for (var j = 0; j < D.day.length; j++) if (D.mode[j] === D.mode[i] && mrCcFits(cs, j) && (!D.gear[j] || D.mrGear[j] && !(mrById(D.mrGear[j].rule) || {}).trip) && !isDup(j) && (f == null || D.day[j] >= f) && (t == null || D.day[j] <= t) && !(mx > 0 && D.km[j] > mx)) c++;
        $('mrCountTxt').innerHTML = '<b class="num">' + fmt(c) + '</b> ' + esc((LABEL[mode] || mode).toLowerCase()) + ' ' + (c === 1 ? 'trip' : 'trips') + ' in that period have no recorded gear. They get this one, marked <span class="guess inf">Rule applied</span>, unless a narrower rule covers them.';
      }
      sel.addEventListener('change', prefill);
      document.querySelectorAll('input[name="mrScope"]').forEach(function (r) {
        r.addEventListener('change', function () { $('mrPeriodMore').hidden = document.querySelector('input[name="mrScope"]:checked').value !== 'period'; });
      });
      ['mrFrom', 'mrTo', 'mrMax'].forEach(function (id) { $(id).addEventListener('input', count); });
      mrCcWire(count);
      prefill();
    }
  });
}
function mrSaveGear(i) {
  var sel = $('mrG').value, mode = MODES[D.mode[i]], one = document.querySelector('input[name="mrScope"]:checked').value === 'one';
  var lr = /^r:/.test(sel) ? mrById(sel.slice(2)) : null;
  var name = sel === 'new' ? $('mrName').value.trim() : lr ? lr.name : GEAR[+sel].name, kind = sel === 'new' ? $('mrKind').value : lr ? lr.kind : GEAR[+sel].kind;
  if (!name) { toast('Give the gear a name'); return; }
  mrEnsure();
  // A gear period of the same name already in MyRules is pointed at; Strava's gear by its name.
  var existing = lr || mrList('gear').filter(function (r) { return (r.name === name || r.strava_name === name) && r.mode === mode && !r.default; })[0] ||
    mrList('gear').filter(function (r) { return r.name === name && r.mode === mode && r.default; })[0];
  var recorded = sel !== 'new' && !lr && !existing && !GEAR[+sel].rule;
  if (one) {
    var c = mrTripCorrection(i), gv = existing ? '@' + existing.id : name;
    if (!c) (MR.doc.corrections || (MR.doc.corrections = [])).push(c = { id: mrNewId(name + '-' + isoDay(D.day[i])), trip: { start: mrIsoLocal(i), mode: MODES[D.base.mode[i]] }, then: {} });
    c.then.gear = gv;
    // New gear on one trip keeps its kind (an electric car counts its own CO₂); a period has its own.
    if (sel === 'new' && !existing && MR_KINDS[kind] && kind !== 'other') c.then.gear_kind = kind; else delete c.then.gear_kind;
    mrChange('Gear ' + name + ' set on ' + niceDate(D.day[i]) + ', ' + clock(D.start[i], D.off[i]), i);
  } else {
    var w = {}, f = $('mrFrom').value, t = $('mrTo').value, mx = distSave(parseFloat($('mrMax').value));
    if (f) w.from = f;
    if (t) w.to = t;
    var r = { id: mrNewId(name), name: name, kind: kind === 'shoe' || MR_KINDS[kind] ? kind : 'other', mode: mode };
    if (f || t) r.when = w;
    if (mx > 0) r.match = { max_km: mx };
    if (recorded) r.strava_name = name;
    mrCcInto(r, mrCcRead());
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
  if (sec === 'gear') { if (r.default && r.mode === 'CAR') mrDefaultCarDialog(); else mrGearRuleDialog(r); return; }
  if (sec === 'routines') { mrRoutineDialog(r); return; }
  if (sec === 'gps_spots') { mrSpotDialog(r); return; }
  if (sec === 'snaps') { closeSheets(true); snapStart(r); return; }
  if (!D) { toast('Load your Timeline file to edit this'); return; }
  if (sec === 'moves') { mvEditRule(r); return; }
  if (sec === 'places') {
    if (!Array.isArray(r.at)) { toast('This place has no position to edit'); return; }
    needPlaces(); mrPlaceDialog('mr:' + r.id); return;
  }
  if (sec === 'corrections') {
    var x = mrCorrections().filter(function (y) { return y.c === r; })[0];
    if (x && x.trips.length && Array.isArray(r.trip.trips)) mrBulkList(r.id);
    else if (x && x.trips.length) mrEditDialog(x.trips[0]);
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
// Countries of a gear period: Everywhere, Only in (match.countries) or Not in (an unless entry with
// countries alone, as Turn off for these trips writes). Switching between Only in and Not in flips the
// chips, so "not in all but Spain" becomes "only in Spain", which also leaves out countries visited later.
function mrCcState(r) {
  var m = r && r.match || {}, not = {};
  if (Array.isArray(m.countries) && m.countries.length) return { how: 'only', list: m.countries.map(function (c) { return String(c).toUpperCase(); }) };
  (r && Array.isArray(r.unless) ? r.unless : []).forEach(function (u) { if (mrCcOnly(u)) u.countries.forEach(function (c) { not[String(c).toUpperCase()] = 1; }); });
  var l = Object.keys(not);
  return l.length ? { how: 'not', list: l } : { how: 'all', list: [] };
}
function mrCcOnly(u) { return u && typeof u === 'object' && Array.isArray(u.countries) && u.countries.length && Object.keys(u).every(function (k) { return k === 'countries'; }); }
// The countries in your trips, and any the rule names that aren't in them, by name.
function mrCcCodes(extra) {
  var seen = {}, out = [];
  function add(c) { c = String(c || '').toUpperCase(); if (/^[A-Z]{2}$/.test(c) && !seen[c]) { seen[c] = 1; out.push(c); } }
  if (D && M) M.countries.forEach(function (k) { add(D.ccList[k]); });
  (extra || []).forEach(add);
  return out.sort(function (a, b) { return ccName(a).localeCompare(ccName(b)); });
}
function mrCcRow(st) {
  var on = {}; st.list.forEach(function (c) { on[c] = 1; });
  var codes = mrCcCodes(st.list);
  return '<div class="field"><span>Countries</span><div class="seg full" id="mrCcHow" role="group" aria-label="Countries">' +
    [['all', 'Everywhere'], ['only', 'Only in'], ['not', 'Not in']].map(function (o) { return '<button type="button" data-how="' + o[0] + '" aria-pressed="' + (st.how === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div>' +
    '<span class="chips mr-cc" id="mrCc"' + (st.how === 'all' ? ' hidden' : '') + '>' + (codes.length ? codes.map(function (c) {
      return '<button type="button" class="chip sub" data-cc="' + c + '" aria-pressed="' + !!on[c] + '">' + (flag(c) ? flag(c) + ' ' : '') + esc(ccName(c)) + '</button>';
    }).join('') : '<small class="fine">Load your location files to pick countries.</small>') + '</span>' +
    '<small class="fine" id="mrCcNote"' + (st.how === 'all' ? ' hidden' : '') + '>A trip counts when it starts or ends in one.</small></div>';
}
function mrCcWire(onChange) {
  $('mrCcHow').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-how]'), was = mrCcRead().how;
    if (!b || b.dataset.how === was) return;
    this.querySelectorAll('[data-how]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    var chips = document.querySelectorAll('#mrCc [data-cc]');
    if (b.dataset.how !== 'all' && was !== 'all') chips.forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); });
    else if (b.dataset.how !== 'all') chips.forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
    $('mrCc').hidden = $('mrCcNote').hidden = b.dataset.how === 'all';
    if (onChange) onChange();
  });
  $('mrCc').addEventListener('click', function (ev) {
    var c = ev.target.closest('[data-cc]');
    if (!c) return;
    c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    if (onChange) onChange();
  });
}
function mrCcRead() {
  var h = document.querySelector('#mrCcHow [aria-pressed="true"]'), how = h ? h.dataset.how : 'all', list = [];
  document.querySelectorAll('#mrCc [data-cc][aria-pressed="true"]').forEach(function (c) { list.push(c.dataset.cc); });
  return how === 'all' || !list.length ? { how: 'all', list: [] } : { how: how, list: list };
}
function mrCcFits(st, i) { return st.how === 'all' || (st.how === 'only') === mrCcIn(st.list, i); }
// Writes the dialog's countries into the rule: replaces its match.countries and its countries-only unless entries.
function mrCcInto(r, st) {
  var m = Object.assign({}, r.match);
  delete m.countries;
  if (st.how === 'only') m.countries = st.list;
  if (Object.keys(m).length) r.match = m; else delete r.match;
  var u = (Array.isArray(r.unless) ? r.unless : []).filter(function (x) { return !mrCcOnly(x); });
  if (st.how === 'not') { u.push({ countries: st.list }); mrUseV2(); }
  if (u.length) r.unless = u; else delete r.unless;
}
function mrCcText(st) { return st.how === 'all' ? '' : (st.how === 'only' ? 'only in ' : 'not in ') + st.list.map(ccName).join(', '); }
// Edit a gear period, or (no r) make new gear from MyRules › Gear: its type, kind, period and countries.
function mrGearRuleDialog(r) {
  var isNew = !r;
  if (isNew) r = { mode: 'CYCLING', assign: false };
  var isDef = r.assign !== false;
  var mx = r.match && r.match.max_km;
  function kindOpts(mode, sel) {
    var kinds = mrKindsFor(mode);
    if (sel && kinds.indexOf(sel) < 0) kinds.push(sel);
    return kinds.map(function (k) { return '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(MR_KINDS[k] || k) + '</option>'; }).join('');
  }
  function lead(mode) { return 'Gear of yours for ' + esc((LABEL[mode] || mode || 'cycling').toLowerCase()) + ' trips. Set it on a trip with Set gear, or use it as the default for a period.'; }
  function defTxt(mode) { return 'Every ' + esc((LABEL[mode] || mode || 'cycling').toLowerCase()) + ' trip without gear in this period and these countries gets it.'; }
  var modes = Object.keys(MR_GEAR_KINDS);
  if (modes.indexOf(r.mode) < 0) modes.push(r.mode);
  mrAsk({
    title: isNew ? 'New gear' : 'Edit gear',
    text: '<span id="mrGLead">' + lead(r.mode) + '</span>',
    extra: '<div class="mr-form"><div class="grid2"><label class="field"><span>Name</span><input type="text" id="mrGName" value="' + esc(r.name || '') + '" placeholder="e.g. ' + esc(MR_GEAR_EG[r.mode] || 'My gear') + '"></label>' +
      '<label class="field"><span>Type</span><select id="mrGMode">' + modes.map(function (m) { return '<option value="' + esc(m) + '"' + (m === r.mode ? ' selected' : '') + '>' + esc(LABEL[m] || m) + '</option>'; }).join('') + '</select></label></div>' +
      '<label class="field"><span>Kind</span><select id="mrGKind">' + kindOpts(r.mode, r.kind) + '</select></label>' +
      // Off: gear in your list, set on trips by hand (Set gear). On: trips without gear in the period
      // and countries get it.
      '<label class="mr-switch-row"><span><b>Use as default</b><small class="fine" id="mrGDefTxt"></small></span><input type="checkbox" class="switch" id="mrGDef"' + (isDef ? ' checked' : '') + '></label>' +
      '<div id="mrGDefMore"' + (isDef ? '' : ' hidden') + '>' + mrDateRow(r.when) + mrCcRow(mrCcState(r)) +
      '<label class="field"><span>Only trips under (' + distUnit() + ', optional)</span><input type="number" id="mrGMax" min="0" step="any" value="' + distField(mx) + '"></label></div></div>',
    buttons: [[isNew ? 'Add gear' : 'Save', 'primary', function () {
      var name = $('mrGName').value.trim(), m = distSave(parseFloat($('mrGMax').value), mx);
      if (!name) { toast('Give the gear a name'); return; }
      var def = $('mrGDef').checked;
      if (def) { if (!mrDatesInto(r)) return; delete r.assign; }
      else { r.assign = false; delete r.when; }
      r.name = name; r.mode = $('mrGMode').value; r.kind = $('mrGKind').value;
      if (isNew) { r = Object.assign({ id: mrNewId(name) }, r); mrEnsure(); (MR.doc.gear || (MR.doc.gear = [])).push(r); MR_TAB = 'gear'; }
      var match = Object.assign({}, r.match);
      if (m > 0 && def) match.max_km = m; else delete match.max_km;
      if (Object.keys(match).length) r.match = match; else delete r.match;
      mrCcInto(r, def ? mrCcRead() : { how: 'all', list: [] });
      mrChange((isNew ? 'New gear: ' : 'Gear changed: ') + name + (def ? ' (default, ' + mrWhenText(r.when) + ')' : ''));
    }], ['Cancel', 'quiet', null]],
    after: function () {
      mrCcWire();
      $('mrGDefTxt').innerHTML = defTxt(r.mode);
      $('mrGDef').addEventListener('change', function () { $('mrGDefMore').hidden = !this.checked; });
      // Another type: its kinds, example name and the lines above follow.
      $('mrGMode').addEventListener('change', function () {
        var m = this.value;
        $('mrGKind').innerHTML = kindOpts(m, null);
        $('mrGName').placeholder = 'e.g. ' + (MR_GEAR_EG[m] || 'My gear');
        $('mrGLead').innerHTML = lead(m);
        $('mrGDefTxt').innerHTML = defTxt(m);
      });
    }
  });
}
// A routine from one trip: its two ends, any day and time, both ways, its type, and its own trail as
// the line, so the trips that follow that line closely enough (the match slider) are its trips. A trip
// with under 5 GPS points has too little trail to be a line: its routine goes by the ends and type alone.
function mrSimilar(i) {
  needPlaces();
  var m = MODES[D.mode[i]], A = placeLabel(D.pa[i]), B = placeLabel(D.pb[i]), lab = LABEL[m] || m;
  var r = { id: mrNewId(lab + ' ' + A + ' ' + B), name: lab + ' ' + A + ' – ' + B, from: mrEndRef({ at: [D.from[2 * i], D.from[2 * i + 1]] }), to: mrEndRef({ at: [D.to[2 * i], D.to[2 * i + 1]] }),
    both_ways: true, then: { mode: m, snap: { trip: { start: mrIsoLocal(i), mode: MODES[D.base.mode[i]] } } } };
  if (m === 'UNKNOWN') delete r.then.mode;
  if (D.pathOff[i + 1] - D.pathOff[i] < 5) delete r.then.snap;
  mrRoutineDialog(r, true);
}
// isNew: a routine not saved yet (Group with similar trips), added to MyRules on Save.
function mrRoutineDialog(r, isNew) {
  var t = r.then || {}, rt = r.return_when && Array.isArray(r.return_when.time) ? r.return_when.time : [];
  mrAsk({
    side: true,
    title: isNew ? 'Trips like this one' : 'Edit routine',
    text: (isNew ? 'Your trips between the same two ends, any day and any time.' : 'Trips between its two ends in this period get what you set here.') +
      (MR && !MR.on ? '<b class="mr-off-warn">MyRules are switched off, so this routine won\'t change any trips until you switch them on.</b>' : ''),
    info: isNew ? (t.snap ? 'Only those that follow this trip\'s line closely enough: set how closely below, then save them as a routine.' :
      'This trip has too few GPS points to be a line, so they go by their ends: set how close below, then save them as a routine.') : '',
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
      '<label class="toggle-row"><span class="lbl">Always' + infoBtn('mrRForceInfo', 'About Always') + '</span><input type="checkbox" class="switch" id="mrRForce"' + (r.force ? ' checked' : '') + '></label>' +
      infoBox('mrRForceInfo', 'Replace the type your files have, not only a missing, generic (Vehicle) or guessed one. Without it, trips your files give another type stay out of the routine.') +
      '<label class="toggle-row"><span class="lbl">Draw them along one line<small class="fine" style="display:block">Trips that don\'t follow it closely enough stay out of the routine.</small></span><input type="checkbox" class="switch" id="mrRSnap"' + (t.snap ? ' checked' : '') + '></label>' + mrGhostHtml() + '</div>',
    buttons: [[isNew ? 'Save as routine' : 'Save', 'primary', function () {
      var d = mrGhostSnap(form(true));
      if (!d) return;
      Object.keys(r).forEach(function (k) { delete r[k]; });
      Object.assign(r, d);
      if (isNew) { mrEnsure(); (MR.doc.routines || (MR.doc.routines = [])).push(r); mrChange('New routine: ' + (r.name || r.id)); }
      else mrChange('Routine changed: ' + (r.name || r.id));
      if (!MR.on) toast((r.name || 'Routine') + ' saved. MyRules are switched off, so it changes no trips yet.');
      else if (isNew) toast((r.name || 'Routine') + ': ' + tripsText(MR_COUNT[r.id] || 0) + ' match.');
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
  return '<h4 class="place-h">Name</h4>' + (r ? '<p class="fine">Named <b>' + esc(r.name || r.role) + '</b> in MyRules: everything within ' + fmt(+r.radius_m || 100) + ' m' + (r.role ? ', as ' + (MR_LIFE[r.role] ? (mrIsPast(r) ? 'past ' : 'current ') : '') + esc(mrKindName(r.role).toLowerCase()) + (mrIsPast(r) ? ' until ' + niceDate(mrDayNum(r.when.to)) : '') : '') + (r.hide ? ', hidden from the map' : '') + (r.enabled === false ? ' (switched off)' : '') + '.</p>' : (st ? '<p class="fine">' + (st.airport ? 'Within ' + dist(Math.max(st.d, 0.1)) + ' of <b>' + esc(st.name) + '</b> (from OurAirports), so it counts as an airport.' : esc(st.kind) + ' <b>' + esc(st.name) + '</b> in your station packs (OpenStreetMap), so it counts as a transport stop.') + ' Name it yourself to change that.</p>' : '<p class="fine">Give this place your own name with <i>Name this place</i>, and choose how far around it counts as this place.</p>'));
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
    if (packed && !local.length) { $('mrOsmTxt').textContent = 'Your station packs have no ' + lab + ' line within ' + dist(2) + ' of both ends. Move an end closer to a station.'; return; }
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
$('mrHereBack').addEventListener('click', function () { mrRenderRules(); openSheet('mrSheet'); });
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

// ---------- the default car ----------
// One car of yours, set up in Preferences › CO₂ estimates: a gear rule with "default": true. Car trips
// without gear get it as a guess (tagged Default car); its fuel sets their CO₂. Saved in MyRules like
// any gear, so it goes with your rules file.
function mrDefaultCarDialog() {
  var r = mrDefaultCar(), kind = r && MR_CAR_FUELS.indexOf(r.kind) >= 0 ? r.kind : CAR[A.car] != null ? A.car : 'petrol';
  mrAsk({
    title: r ? 'Default car' : 'Set up your default car',
    text: 'Car trips without gear get this car as a guess.',
    info: 'They are tagged Default car until you confirm them, one trip or a whole period at once, and their CO₂ follows what the car runs on. Cars you add with Set gear on a trip count for their own trips. The default car is saved in MyRules.',
    extra: '<div class="mr-dates" style="display:grid;gap:10px">' +
      '<label class="field"><span>Name</span><input type="text" id="mrDcName" maxlength="60" placeholder="e.g. Family car" value="' + esc(r ? r.name || '' : '') + '"></label>' +
      '<label class="field"><span>Make and model (optional)</span><input type="text" id="mrDcModel" maxlength="80" placeholder="e.g. Volvo XC40" value="' + esc(r && r.model || '') + '"></label>' +
      '<label class="field"><span>Runs on</span><select id="mrDcKind">' + MR_CAR_FUELS.map(function (k) { return '<option value="' + k + '"' + (k === kind ? ' selected' : '') + '>' + esc(MR_KINDS[k]) + '</option>'; }).join('') + '</select></label></div>',
    buttons: [[r ? 'Save' : 'Set up', 'primary', function () {
      var name = $('mrDcName').value.trim() || 'My car', model = $('mrDcModel').value.trim(), k = $('mrDcKind').value;
      mrEnsure();
      var x = mrDefaultCar();
      if (!x) { x = { id: mrNewId(name), name: name, mode: 'CAR', default: true }; (MR.doc.gear || (MR.doc.gear = [])).push(x); }
      var was = x.name;
      x.name = name; x.kind = k; x.default = true;
      if (model) x.model = model; else delete x.model;
      // A confirmed period or trip names the car by name: keep them with it when it's renamed.
      if (was && was !== name) mrList('gear').forEach(function (p) { if (p !== x && p.mode === 'CAR' && p.name === was) p.name = name; });
      mrChange('Default car: ' + name + ' (' + MR_KINDS[k].toLowerCase() + ')');
      if (typeof renderDefCar === 'function') renderDefCar();
    }]].concat(r ? [['Remove', 'danger', function () {
      var x = mrDefaultCar();
      if (!x) return;
      // Confirmed trips keep it as a car of yours (corrections point at it): then it stops being the default only.
      var used = mrList('corrections').some(function (c) { return c.then && c.then.gear === '@' + x.id; });
      if (used) delete x.default; else MR.doc.gear = mrList('gear').filter(function (p) { return p !== x; });
      mrChange('Default car removed: ' + x.name);
      if (typeof renderDefCar === 'function') renderDefCar();
    }]] : []).concat([['Cancel', 'quiet', null]])
  });
}
// "This car is right": the trip gets the default car for good, in its own correction.
function mrGearOk(i) {
  var g = D.mrGear[i], r = g && mrById(g.rule);
  if (!r) return;
  mrEnsure();
  var c = mrTripCorrection(i);
  if (!c) (MR.doc.corrections || (MR.doc.corrections = [])).push(c = { id: mrNewId((r.name || 'car') + '-' + isoDay(D.day[i])), trip: { start: mrIsoLocal(i), mode: MODES[D.base.mode[i]] }, then: {} });
  c.then.gear = '@' + r.id; delete c.then.gear_kind;
  mrChange('Gear ' + (r.name || r.id) + ' confirmed on ' + mrWhere(i), i);
  toast((r.name || 'Your car') + ' confirmed.');
  openTrip(i);
}
// Confirm for a period: a gear period for the default car, so every trip in it that has no gear
// gets the car for good (Rule applied). The dates start as the trip's year; the count is live.
function mrGearPeriodDialog(i) {
  var g = D.mrGear[i], r = g && mrById(g.rule);
  if (!r) return;
  var y = D.year[i], f0 = y + '-01-01', t0 = y + '-12-31';
  mrAsk({
    title: 'Confirm ' + (r.name || 'your car') + ' for a period',
    text: 'Every car trip without gear in this period gets ' + esc(r.name || 'your car') + ' for good, saved as a gear period.',
    extra: mrDateRow({ from: f0, to: t0 }) + '<p class="fine" id="mrGpCount"></p>',
    buttons: [['Confirm', 'primary', function () {
      var w = {}, f = $('mrWFrom').value, t = $('mrWTo').value;
      if (f) w.from = f;
      if (t) w.to = t;
      var p = { id: mrNewId((r.name || 'car') + '-' + (f || 'start')), name: r.name, kind: r.kind, mode: r.mode };
      if (f || t) p.when = w;
      if (r.model) p.model = r.model;
      (MR.doc.gear || (MR.doc.gear = [])).push(p);
      mrChange((r.name || 'Car') + ' confirmed: ' + mrWhenText(p.when));
      openTrip(i);
    }], ['Cancel', 'quiet', null]],
    after: function () {
      function count() {
        var f = mrDayNum($('mrWFrom').value), t = mrDayNum($('mrWTo').value), c = 0;
        for (var j = 0; j < D.day.length; j++) if (D.mrGear[j] && D.mrGear[j].def && D.mrGear[j].rule === r.id && (f == null || D.day[j] >= f) && (t == null || D.day[j] <= t)) c++;
        $('mrGpCount').textContent = tripsText(c) + ' with ' + (r.name || 'your car') + ' as a guess in that period.';
      }
      ['mrWFrom', 'mrWTo'].forEach(function (id) { $(id).addEventListener('input', count); });
      count();
    }
  });
}

// A bad GPS spot rule: its name, or Delete (which brings its points back on every trip).
function mrSpotDialog(r) {
  var n = Array.isArray(r.at) ? r.at.length : 0, t = MR.on ? MR_COUNT[r.id] || 0 : null;
  mrAsk({
    title: 'Bad GPS spot',
    text: fmt(n) + ' spot' + (n === 1 ? '' : 's') + (t != null ? ', on ' + tripsText(t) : '') + '. GPS points within ' + distShort(GPS_SPOT_KM * 1000) + ' of ' + (n === 1 ? 'it' : 'them') + ' are left out of every trip, except where a trip starts or ends.',
    extra: '<label class="field"><span>Name</span><input type="text" id="mrSpName" maxlength="80" value="' + esc(r.name || '') + '"></label>',
    buttons: [['Save', 'primary', function () {
      r.name = $('mrSpName').value.trim() || r.name;
      mrChange('Bad GPS spot renamed: ' + r.name);
    }], ['Delete', 'danger', function () {
      MR.doc.gps_spots = mrList('gps_spots').filter(function (x) { return x !== r; });
      mrChange('Bad GPS spot deleted: ' + (r.name || r.id));
    }], ['Cancel', 'quiet', null]]
  });
}
