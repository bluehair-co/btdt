// ---------- walks that may be stays (GPS drifts here) ----------
// Indoors, a phone keeps guessing where it is (Wi-Fi, cell towers, a weak GPS fix), and each guess
// lands somewhere nearby. Timeline then records short, slow "walks" that start and end where you sat,
// or keeps the time you sat still at one end of a real walk. A My Edits place with drift
// ({ "radius_m": 300 }, or true for its own radius) turns those walks into what they were:
// - a walk that never leaves the circle and is slow (under DRIFT_SLOW on average) or short (up to
//   DRIFT_SHORT) becomes part of the stay before or after it (D.drift[i] 1: it leaves every list,
//   map and total, and that stay ends later or starts earlier);
// - a walk with a still stretch at an end inside the circle (DRIFT_IDLE or more between two GPS
//   points, after the time walking between them) is cut back to the part where you moved, and the
//   still minutes join the stay there (D.drift[i] 2: its start or end, line and distance change).
// Only walks next to a stay in the circle (ending or starting within DRIFT_GAP of it) count, so
// the time always has a stay to go to, and a walk from one stay to another over DRIFT_APART away
// is never made a stay (it took you somewhere, however short). Walks whose type you set or checked, recorded activities,
// simulated trips and walks in a routine are left alone, and the place's except (TripRefs) lists
// the walks you said were real. drift.only: a place made only for this, which names no stays.
// Applied in mrCorrectSteps after the corrections (driftApply), on D's copies; D.base keeps the
// trips and stays as loaded, and driftReset puts them back before the rules run again.
// Trip cleanup lists places where such walks keep happening (driftSuggest), and the review
// (driftStart) shows one place's walks on the map with a radius slider and tick boxes.
var DRIFT_GAP = 15 * 60000, DRIFT_TOUCH = 2 * 60000, DRIFT_IDLE = 10 * 60000, DRIFT_SHORT = 5 * 60000;
var DRIFT_SLOW = 3, DRIFT_WALK = 5;   // km/h: slower than this on average; walking pace for the moving bits
var DRIFT_APART = 0.15;               // km between the stays before and after a walk that took you somewhere
var DRIFT_RAD = 300, DRIFT_RAD_MIN = 50, DRIFT_RAD_MAX = 600, DRIFT_MIN = 8, DRIFT_MIN_MS = 2 * 36e5, DRIFT_SUG = 6;
var MR_DRIFT = {};   // by place id: { stay, cut, ms } walks it changed

function driftRad(r) {
  var d = r && r.drift, m = d && typeof d === 'object' && +d.radius_m || +r.radius_m || 100;
  return Math.max(DRIFT_RAD_MIN, Math.min(2000, m));
}
function driftRules() { return mrActive('places').filter(function (r) { return r.drift && Array.isArray(r.at) && isFinite(r.at[0]) && isFinite(r.at[1]); }); }
function driftAll() { return mrList('places').filter(function (r) { return r.drift && Array.isArray(r.at) && isFinite(r.at[0]); }); }
function driftName(r) { return r.name || (r.role ? mrKindName(r.role) : '') || 'A place'; }

// Back to the trips and stays as loaded (called by mrCorrectSteps before the rules run).
function driftReset() {
  var b = D.base;
  if (D.driftOn && b) {
    D.start = b.start; D.end = b.end; D.vs = b.vs; D.ve = b.ve;
    (D.driftDays || []).forEach(function (x) { var i = x[0]; D.day[i] = x[1]; D.year[i] = x[2]; D.month[i] = x[3]; D.dow[i] = x[4]; D.hour[i] = x[5]; });
  }
  D.driftOn = false; D.drift = null; D.driftInfo = null; D.driftDays = null; D.preDrift = null; MR_DRIFT = {};
}
// The trips as they were before driftApply changed them: the review and the suggestions look at those.
function driftSrc() {
  var P = D.preDrift && D.preDrift.pathPts ? D.preDrift : D, b = D.base || D;
  return { start: b.start, end: b.end, pathPts: P.pathPts, pathT: P.pathT, pathOff: P.pathOff, km: P.km, from: P.from, to: P.to, mode: D.preDrift && D.preDrift.mode || D.mode };
}
function driftOk(i) {
  return !isDup(i) && !D.mrHide[i] && !(D.est[i] & STRAVA) && !(D.mrMode[i] && !D.mrMode[i].inf) && !D.mrOk[i] && !(D.mrRoute && D.mrRoute[i]) &&
    (D.srcs ? D.srcs[i] : D.src) !== SRC.sim;
}
// Stays as loaded, sorted by when they end and by when they start, to find the one next to a walk.
function driftStayIdx() {
  var b = D.base || D;
  if (b.driftIdx && b.driftIdx.n === b.vs.length) return b.driftIdx;
  var nv = b.vs.length, s = new Int32Array(nv), e = new Int32Array(nv);
  for (var v = 0; v < nv; v++) { s[v] = v; e[v] = v; }
  s.sort(function (x, y) { return b.vs[x] - b.vs[y]; });
  e.sort(function (x, y) { return b.ve[x] - b.ve[y]; });
  return (b.driftIdx = { n: nv, s: s, e: e });
}
function driftFirst(t, idx, at) {
  var lo = 0, hi = idx.length;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (at[idx[mid]] < t) lo = mid + 1; else hi = mid; }
  return lo;
}
// The stay that ends nearest a walk's start (from DRIFT_GAP before it to DRIFT_TOUCH after), or -1.
function driftPrev(t) {
  var b = D.base || D, X = driftStayIdx().e, best = -1, bd = Infinity;
  for (var k = driftFirst(t - DRIFT_GAP, X, b.ve); k < X.length && b.ve[X[k]] <= t + DRIFT_TOUCH; k++) { var d = Math.abs(b.ve[X[k]] - t); if (d < bd) { bd = d; best = X[k]; } }
  return best;
}
// The stay that starts nearest a walk's end, or -1.
function driftNext(t) {
  var b = D.base || D, X = driftStayIdx().s, best = -1, bd = Infinity;
  for (var k = driftFirst(t - DRIFT_TOUCH, X, b.vs); k < X.length && b.vs[X[k]] <= t + DRIFT_GAP; k++) { var d = Math.abs(b.vs[X[k]] - t); if (d < bd) { bd = d; best = X[k]; } }
  return best;
}

// The walks a circle (centre c, radius rk km) would change: [{ i, kind: 'stay' | 'cut', s, e (the
// walk's new start and end), a, z (its first and last GPS point kept), head, tail (still time cut
// off at each end), ms (time that joins a stay), prev, next (the stays it goes to, or -1) }].
function driftCands(c, rk) {
  var S = driftSrc(), out = [], n = D.day.length, wk = MODE_IDX.WALKING;
  var dLat = rk / 110.57 + 0.0002, dLng = dLat / Math.max(0.05, Math.cos(c[0] * Math.PI / 180));
  function near(la, lo) { return Math.abs(la - c[0]) <= dLat && Math.abs(lo - c[1]) <= dLng && kmLL(la, lo, c[0], c[1]) <= rk; }
  for (var i = 0; i < n; i++) {
    if (S.mode[i] !== wk) continue;
    if (!near(S.from[2 * i], S.from[2 * i + 1]) && !near(S.to[2 * i], S.to[2 * i + 1])) continue;
    if (!driftOk(i)) continue;
    var o0 = S.pathOff[i], o1 = S.pathOff[i + 1], t0 = S.start[i], t1 = S.end[i], dur = t1 - t0;
    if (o1 - o0 < 2 || dur <= 0) continue;
    var pv = driftPrev(t0), nx = driftNext(t1);
    var pa = pv >= 0 && near(D.vll[2 * pv], D.vll[2 * pv + 1]), na = nx >= 0 && near(D.vll[2 * nx], D.vll[2 * nx + 1]);
    if (!pa && !na) continue;
    var P = [], inside = [], all = true, q;
    for (q = o0; q < o1; q++) {
      var la = S.pathPts[2 * q], lo = S.pathPts[2 * q + 1], ok = near(la, lo);
      P.push([la, lo, t0 + S.pathT[q] * 1000]); inside.push(ok);
      if (!ok) all = false;
    }
    var kmh = S.km[i] / (dur / 36e5);
    // Between two stays at different spots (over DRIFT_APART), it took you somewhere: a real walk, however short.
    var apart = pv >= 0 && nx >= 0 && kmLL(D.vll[2 * pv], D.vll[2 * pv + 1], D.vll[2 * nx], D.vll[2 * nx + 1]) > DRIFT_APART;
    if (all && !apart && (kmh < DRIFT_SLOW || dur <= DRIFT_SHORT)) {
      out.push({ i: i, kind: 'stay', s: t0, e: t1, a: 0, z: P.length - 1, head: 0, tail: 0, ms: dur, prev: pa ? pv : -1, next: na ? nx : -1 });
      continue;
    }
    // Still at the start: the last long gap between points inside the circle, from the first point on.
    var a = 0, z = P.length - 1, s = t0, e = t1, k, wm, idle;
    if (pa) for (k = 1; k < P.length && inside[k] && inside[k - 1]; k++) {
      wm = km(P[k - 1], P[k]) / DRIFT_WALK * 36e5; idle = P[k][2] - P[k - 1][2] - wm;
      if (idle >= DRIFT_IDLE) { a = k - 1; s = P[k][2] - wm; }
    }
    // Still at the end: the first long gap among the last points inside the circle.
    if (na) for (k = P.length - 2; k >= a && inside[k] && inside[k + 1]; k--) {
      wm = km(P[k], P[k + 1]) / DRIFT_WALK * 36e5; idle = P[k + 1][2] - P[k][2] - wm;
      if (idle >= DRIFT_IDLE) { z = k + 1; e = P[k][2] + wm; }
    }
    if (s === t0 && e === t1 || e - s < 60000 || z <= a) continue;
    out.push({ i: i, kind: 'cut', s: s, e: e, a: a, z: z, head: s - t0, tail: t1 - e, ms: (s - t0) + (t1 - e), prev: s > t0 ? pv : -1, next: e < t1 ? nx : -1 });
  }
  return out;
}

// In mrCorrectSteps, after the corrections: every place with drift changes its walks.
function driftApply() {
  D.preDrift = { mode: D.mode.slice() };
  var rules = driftRules();
  if (!rules.length) return;
  var plan = [], taken = {};
  rules.forEach(function (r) {
    var w = r.when ? mrWhen(r.when) : null, ex = mrExcept(r), st = { stay: 0, cut: 0, ms: 0 };
    driftCands(r.at, driftRad(r) / 1000).forEach(function (x) {
      if (taken[x.i] || ex[x.i] || w && !mrWhenOk(w, x.i)) return;
      taken[x.i] = 1; x.rule = r.id; plan.push(x); st[x.kind]++; st.ms += x.ms;
    });
    MR_DRIFT[r.id] = st;
  });
  if (!plan.length) return;
  var b = D.base, n = D.day.length, cut = {};
  Object.assign(D.preDrift, { pathPts: D.pathPts, pathT: D.pathT, pathOff: D.pathOff, km: D.km, from: D.from, to: D.to });
  D.driftOn = true; D.drift = new Uint8Array(n); D.driftInfo = []; D.driftDays = [];
  D.start = b.start.slice(); D.end = b.end.slice(); D.vs = b.vs.slice(); D.ve = b.ve.slice();
  D.km = D.km.slice(); D.from = D.from.slice(); D.to = D.to.slice();
  plan.forEach(function (x) {
    var i = x.i;
    if (x.kind === 'stay') {
      D.drift[i] = 1;
      D.driftInfo[i] = { rule: x.rule, kind: 'stay', ms: x.ms };
      // The stay before runs on to the one after (or to the walk's end); else the one after starts earlier.
      if (x.prev >= 0) D.ve[x.prev] = Math.max(D.ve[x.prev], x.next >= 0 ? D.vs[x.next] : x.e);
      else if (x.next >= 0) D.vs[x.next] = Math.min(D.vs[x.next], x.s);
      return;
    }
    D.drift[i] = 2; cut[i] = x;
    D.driftInfo[i] = { rule: x.rule, kind: 'cut', head: x.head, tail: x.tail, s0: b.start[i], e0: b.end[i], km0: D.km[i] };
    D.start[i] = x.s; D.end[i] = x.e;
    if (x.prev >= 0) D.ve[x.prev] = Math.max(D.ve[x.prev], x.s);
    if (x.next >= 0) D.vs[x.next] = Math.min(D.vs[x.next], x.e);
    if (x.head) {
      // A later start can be another hour, or (just after midnight) another day.
      var off = D.off[i], day = off === NO_OFF ? D.day[i] : Math.floor((x.s + off * 60000) / 864e5);
      D.driftDays.push([i, D.day[i], D.year[i], D.month[i], D.dow[i], D.hour[i]]);
      if (day !== D.day[i]) { var dt = dayToDate(day); D.day[i] = day; D.year[i] = dt.getUTCFullYear(); D.month[i] = dt.getUTCMonth(); D.dow[i] = dt.getUTCDay(); }
      D.hour[i] = localHour(x.s, off);
    }
  });
  // The cut-back walks' GPS points: from the last still one to the first still one, with times
  // from their new start; their distance loses what the points left out added.
  var ids = Object.keys(cut);
  if (!ids.length) return;
  var np = D.pathT.length, i, q, w = 0;
  ids.forEach(function (k) { var x = cut[k], j = +k; np -= (D.pathOff[j + 1] - D.pathOff[j]) - (x.z - x.a + 1); });
  var P = new Float32Array(2 * np), T = new Float32Array(np), O = new Uint32Array(n + 1);
  for (i = 0; i < n; i++) {
    O[i] = w;
    var x = cut[i], o0 = D.pathOff[i], o1 = D.pathOff[i + 1];
    if (!x) { for (q = o0; q < o1; q++, w++) { P[2 * w] = D.pathPts[2 * q]; P[2 * w + 1] = D.pathPts[2 * q + 1]; T[w] = D.pathT[q]; } continue; }
    var shift = (x.s - b.start[i]) / 1000, len = (x.e - x.s) / 1000, all = [], kept = [];
    for (q = o0; q < o1; q++) all.push([D.pathPts[2 * q], D.pathPts[2 * q + 1]]);
    for (q = x.a; q <= x.z; q++, w++) {
      P[2 * w] = all[q][0]; P[2 * w + 1] = all[q][1];
      T[w] = q === x.a ? 0 : q === x.z ? len : Math.min(len, Math.max(0, D.pathT[o0 + q] - shift));
      kept.push(all[q]);
    }
    var gone = pathKm(all.slice(0, x.a + 1)) + pathKm(all.slice(x.z)), left = pathKm(kept);
    D.km[i] = Math.min(D.km[i], Math.max(D.km[i] - gone, left));
    D.from[2 * i] = kept[0][0]; D.from[2 * i + 1] = kept[0][1];
    D.to[2 * i] = kept[kept.length - 1][0]; D.to[2 * i + 1] = kept[kept.length - 1][1];
  }
  O[n] = w;
  D.pathPts = P; D.pathT = T; D.pathOff = O;
}

// ---------- in the trip details, the rules sheet and the place dialog ----------
function driftTripHtml(i) {
  var x = D.driftInfo && D.driftInfo[i];
  if (!x || x.kind !== 'cut') return '';
  var r = mrById(x.rule), bits = [];
  if (x.head >= 30000) bits.push(duration(x.head) + ' standing still at the start');
  if (x.tail >= 30000) bits.push(duration(x.tail) + ' standing still at the end');
  return '<div class="mr-chg"><b>Cut back:</b> ' + bits.join(' and ') + ' joined your stay <span class="fine">(was ' + clock(x.s0, D.off[i]) + '–' + clock(x.e0, D.off[i]) + ', ' + dist(x.km0) + ')</span>' +
    '<div class="fine">' + infoMore('From <i>' + esc(r ? driftName(r) : x.rule) + '</i>, where GPS drifts.', 'Indoors your phone kept guessing where it was, so Timeline kept this walk going while you stood still. Only the part where you moved is a walk now. Not this trip makes it whole again.', 'About cut back walks') + '</div></div>';
}
function driftRowText(r) {
  if (!r.drift) return '';
  var st = MR && MR.on && MR_DRIFT[r.id], n = st ? st.stay + st.cut : 0;
  return 'GPS drifts here' + (r.drift.only ? ' · within ' + distShort(driftRad(r)) : '') + (st ? ' · ' + fmt(n) + ' walk' + (n === 1 ? '' : 's') + ' made stays' : '');
}
function driftPlaceHtml(r) {
  if (!r || !r.drift) return '';
  var id = infoId(), st = MR && MR.on && MR_DRIFT[r.id];
  return '<label class="toggle-row"><span class="lbl">GPS drifts here' + infoBtn(id, 'About GPS drifts here') + '</span><input type="checkbox" class="switch" id="mrPDrift" checked></label>' +
    infoBox(id, 'Walks within ' + distShort(driftRad(r)) + ' that were really time spent here become part of your stays. Switch it off to make them walks again.') +
    '<p class="fine">' + (st ? fmt(st.stay + st.cut) + ' walk' + (st.stay + st.cut === 1 ? '' : 's') + ' made stays' + (st.cut ? ' (' + fmt(st.cut) + ' cut back)' : '') : 'No walks changed right now') +
    (Array.isArray(r.except) && r.except.length ? ' · ' + fmt(r.except.length) + ' kept as walks' : '') + '.</p>' +
    '<button type="button" class="btn" id="mrPDriftRev">' + icon('WALKING') + 'Review walks</button>';
}

// ---------- places to check (Trip cleanup) ----------
// Stays that walks keep starting or ending at while slow, staying close, or standing still at that
// end. The spots with the most of them are measured as a circle of DRIFT_RAD, and those with
// DRIFT_MIN or more walks and DRIFT_MIN_MS or more time to change are offered, most time first. Places that already have drift
// (and anything within 400 m of an offered one) are left out.
function driftSuggest() {
  if (!D || !D.base) return [];
  var stamp = (MR ? MR.changes.length + ':' + MR.on + ':' + driftAll().length : '-') + ':' + D.day.length + ':' + (D.mrHide ? 1 : 0);
  if (D.driftSug && D.driftSug.stamp === stamp && D.driftSug.d === D.base) return D.driftSug.list;
  needPlaces();
  var S = driftSrc(), wk = MODE_IDX.WALKING, by = {}, n = D.day.length, i, q;
  for (i = 0; i < n; i++) {
    if (S.mode[i] !== wk || !driftOk(i)) continue;
    var o0 = S.pathOff[i], o1 = S.pathOff[i + 1], t0 = S.start[i], t1 = S.end[i], dur = t1 - t0;
    if (o1 - o0 < 2 || dur <= 0) continue;
    var kmh = S.km[i] / (dur / 36e5), pv = driftPrev(t0), nx = driftNext(t1);
    var slow = (kmh < DRIFT_SLOW || dur <= DRIFT_SHORT) && !(pv >= 0 && nx >= 0 && kmLL(D.vll[2 * pv], D.vll[2 * pv + 1], D.vll[2 * nx], D.vll[2 * nx + 1]) > DRIFT_APART);
    [[pv, o0, 1], [nx, o1 - 1, -1]].forEach(function (x) {
      var v = x[0];
      if (v < 0) return;
      var la = D.vll[2 * v], lo = D.vll[2 * v + 1], far = 0, still = false;
      for (q = o0; q < o1; q++) far = Math.max(far, kmLL(S.pathPts[2 * q], S.pathPts[2 * q + 1], la, lo));
      // A long gap at that end, close to the stay.
      var e = x[1], f = e + x[2];
      if (f >= o0 && f < o1 && Math.abs(S.pathT[f] - S.pathT[e]) * 1000 >= DRIFT_IDLE && kmLL(S.pathPts[2 * e], S.pathPts[2 * e + 1], la, lo) <= 0.3) still = true;
      if (!(slow && far <= 0.5) && !still) return;
      var k = spotKey(v), o = by[k] || (by[k] = { key: k, n: 0, v: v });
      o.n++;
    });
  }
  var have = driftAll(), out = [];
  Object.keys(by).map(function (k) { return by[k]; }).filter(function (o) { return o.n >= DRIFT_MIN / 2; })
    .sort(function (a, b) { return b.n - a.n; }).slice(0, 40).forEach(function (o) {
      if (out.length >= DRIFT_SUG * 2) return;
      var c = spotPos(o.key) || [D.vll[2 * o.v], D.vll[2 * o.v + 1]];
      if (out.some(function (x) { return km(x.c, c) < 0.4; }) || have.some(function (r) { return km(r.at, c) < driftRad(r) / 1000 + 0.1; })) return;
      var cs = driftCands(c, DRIFT_RAD / 1000), ms = 0;
      cs.forEach(function (x) { ms += x.ms; });
      if (cs.length < DRIFT_MIN || ms < DRIFT_MIN_MS) return;
      var s = spotsOf(spotStays(o.key))[0];
      out.push({ key: o.key, c: [+c[0].toFixed(6), +c[1].toFixed(6)], n: cs.length, ms: ms, name: s ? spotName(s) : 'A place' });
    });
  out.sort(function (a, b) { return b.ms - a.ms; });
  out = out.slice(0, DRIFT_SUG);
  D.driftSug = { stamp: stamp, d: D.base, list: out };
  return out;
}
function driftWalks(n) { return fmt(n) + ' walk' + (n === 1 ? '' : 's'); }
function driftHours(ms) { return hoursLabel(ms / 36e5).replace(/ \d+ min$/, ''); }
// The Menu's Trip cleanup row: places to check, once they are known.
function driftMenuText() {
  var s = D && D.driftSug && D.driftSug.d === D.base ? D.driftSug.list.length : 0;
  return s ? s + ' place' + (s === 1 ? '' : 's') + ' to check' : '';
}
// The section in Trip cleanup. Looking for places takes a moment, so it runs only when the sheet
// opens (look), and then after each change while it is open.
var DRIFT_LOOK = 0;
function driftSettings(look) {
  var box = $('driftList'), note = $('driftNote');
  if (!box) return;
  if (!D) { box.innerHTML = ''; note.textContent = 'Load your Timeline file to look for them.'; return; }
  if (look === true || openId === 'cleanupSheet') {
    var known = D.driftSug && D.driftSug.d === D.base;
    if (!known) { box.innerHTML = ''; note.textContent = 'Looking for places…'; }
    var my = ++DRIFT_LOOK;
    setTimeout(function () { if (my === DRIFT_LOOK) { driftSuggest(); driftList(); renderMenu(); } }, known ? 0 : 30);
    if (!known) return;
  }
  driftList();
}
function driftList() {
  var box = $('driftList'), note = $('driftNote'), sug = D.driftSug && D.driftSug.d === D.base ? D.driftSug.list : null, done = driftAll();
  var rows = (sug || []).map(function (x, k) {
    return '<li><button type="button" class="drift-row" data-drift-sug="' + k + '">' + lookBadge({ ic: 'WALKING', bg: 'var(--m-foot)' }, true) +
      '<span class="file-txt"><b>' + esc(x.name) + '</b><small>' + driftWalks(x.n) + ' · ' + driftHours(x.ms) + '</small></span>' + icon('right', 'mr-chev') + '</button></li>';
  }).concat(done.map(function (r) {
    var st = MR && MR.on && MR_DRIFT[r.id], n = st ? st.stay + st.cut : 0;
    return '<li><button type="button" class="drift-row" data-drift-rule="' + esc(r.id) + '">' + lookBadge({ ic: 'home', bg: 'var(--map-grey)' }, true) +
      '<span class="file-txt"><b>' + esc(driftName(r)) + '</b><small>' + (r.enabled === false || !MR.on ? 'Switched off' : driftWalks(n) + ' made stays') + '</small></span><span class="tag-done">Done</span>' + icon('right', 'mr-chev') + '</button></li>';
  }));
  box.innerHTML = rows.join('');
  box.hidden = !rows.length;
  note.textContent = !sug ? '' : !sug.length && !done.length ? 'No places where walks look like stays.' : sug.length ? '' : 'No more places to check.';
  if (MR && !MR.on && done.length) note.textContent = 'My Edits are switched off, so these places don\'t change any walks.';
}
$('driftList').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-drift-sug],[data-drift-rule]');
  if (!b) return;
  if (b.dataset.driftRule) { var r = mrById(b.dataset.driftRule); if (r) driftStart({ rule: r }); return; }
  var x = D.driftSug && D.driftSug.list[+b.dataset.driftSug];
  if (x) driftStart({ c: x.c, name: x.name });
});
// A place page's ⋯ › Check walks here…: the review at that spot (or at the place it is named by).
$('tripBody').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-drift-spot]');
  if (!b) return;
  var key = b.dataset.driftSpot, r = mrSpotRule(key), s = spotsOf(spotStays(key))[0], c = r ? r.at : spotPos(key) || (s && [s.lat, s.lng]);
  if (r && r.drift) { driftStart({ rule: r }); return; }
  // A place made only for GPS drifts here whose circle takes in this spot: that one.
  var dr = c && driftAll().filter(function (x) { return km(x.at, c) * 1000 <= driftRad(x); }).sort(function (x, y) { return km(x.at, c) - km(y.at, c); })[0];
  if (dr) { driftStart({ rule: dr }); return; }
  if (c) driftStart({ c: [+(+c[0]).toFixed(6), +(+c[1]).toFixed(6)], name: r ? driftName(r) : s ? spotName(s) : 'This place', place: r });
});

// ---------- the review: one place's walks on the map ----------
// Only the walks the circle would change are drawn, the rest of the map steps aside (sel-mode, as in
// Select trips). The slider sets the radius, the list ticks walks (unticked: they stay walks, dashed
// grey), a tap on a walk on the map or in the list shows which is which. Saving writes the place's
// drift and its except (the walks you unticked), behind the Saving… pill.
var DR = null;
function driftStart(o) {
  if (!D) { toast('Load your Timeline file first'); return; }
  closeSheets(true);
  if ($('mrDlg').open) $('mrDlg').close();
  if (PREFS.proj !== 'merc') setProj('merc');
  setTab('map');
  if (!initMap()) return;
  if (typeof snapEnd === 'function') snapEnd();
  if (typeof splitHandEnd === 'function') splitHandEnd();
  if (typeof selEnd === 'function') selEnd();
  if (typeof ignEnd === 'function') ignEnd();
  driftEnd();
  if (!map.getPane('mrg')) { map.createPane('mrg'); map.getPane('mrg').style.zIndex = 460; }
  var r = o.rule || o.place && o.place.drift && o.place || null;
  DR = { rule: r, place: o.place || r, c: r ? r.at.map(Number) : o.c, rad: r ? driftRad(r) : DRIFT_RAD, name: r ? driftName(r) : o.name || 'This place', off: new Set(), sel: -1, cands: [] };
  DR.r = L.canvas({ pane: 'mrg', padding: 0.5, tolerance: 6 });
  DR.dim = L.rectangle([[-89, -720], [89, 720]], { pane: 'mrg', renderer: DR.r, stroke: false, fillColor: cssVar('--bg'), fillOpacity: .5, interactive: false }).addTo(map);
  DR.layer = L.layerGroup().addTo(map);
  map.getContainer().classList.add('drift-on');
  document.body.classList.add('sel-mode', 'drift-mode');
  layerToggles();
  hideTip(); setHovered([]);
  driftCompute();
  // Walks you said were real (the place's except) start unticked.
  if (r) { var ex = mrExcept(r); DR.cands.forEach(function (x) { if (ex[x.i]) DR.off.add(x.i); }); }
  driftBars();
  driftRender();
  driftFit();
}
// The walks for the radius: what the circle would change, with the ones the place keeps as walks.
function driftCompute() {
  var cs = driftCands(DR.c, DR.rad / 1000);
  DR.cands = cs;
  driftSort();
}
// Newest first.
function driftSort() { var t = (D.base || D).start; DR.cands.sort(function (a, b) { return t[b.i] - t[a.i]; }); }
function driftFit() {
  var b = L.latLng(DR.c).toBounds(DR.rad * 2.4), pad = wide() ? { paddingTopLeft: [30, 80], paddingBottomRight: [440, 30] } : { paddingTopLeft: [20, 80], paddingBottomRight: [20, Math.min(innerHeight * .5, ($('drBot') ? $('drBot').offsetHeight : 380)) + 20] };
  map.fitBounds(b, Object.assign({ maxZoom: 18, animate: false }, pad));
}
function driftBars() {
  var top = $('drTop');
  if (!top) {
    top = promptBar('drTop', { mode: true, cls: 'dr-top', icon: 'WALKING', text: 'Walks that may be stays', acts: [['Cancel', 'quiet', 'cancel']],
      on: function (a) { if (a === 'cancel') driftEnd(); } });
    top.querySelector('.prompt-title').id = 'drTitle';
    var bot = document.createElement('div'), id = infoId();
    bot.id = 'drBot'; bot.className = 'sel-bar dr-bar';
    bot.innerHTML = '<div class="dr-head"><label class="dr-rad"><span>Radius</span><input type="range" id="drRad" min="' + DRIFT_RAD_MIN + '" max="' + DRIFT_RAD_MAX + '" step="25" aria-label="Radius"><b class="num" id="drRadTxt"></b></label>' +
      '<div class="dr-sum"><span id="drSum"></span>' + infoBtn(id, 'About walks that may be stays', 'sm') + '<button type="button" class="link-btn" id="drAll"></button></div>' +
      infoBox(id, 'Each walk here starts or ends at a stay inside the circle. Ticked walks that never leave the circle become part of that stay. Walks marked <i>Cut back</i> stood still at one end: only those still minutes join the stay, and the part where you moved stays a walk. Untick the walks that were real. Saving keeps this as a My Edits place with <i>GPS drifts here</i>, so walks loaded later are handled the same way.') + '</div>' +
      '<div class="dr-list" id="drList"></div>' +
      '<div class="dr-legend fine"><span><i class="dr-k on"></i>Becomes a stay</span><span><i class="dr-k off"></i>Stays a walk</span><span><i class="dr-k c"></i>Radius</span></div>' +
      '<div class="dr-acts"><button type="button" class="btn quiet" id="drRemove" hidden>Remove</button><button type="button" class="btn primary" id="drSave"></button></div>';
    document.body.appendChild(bot);
    fillIcons(bot);
    var rad = $('drRad'), tm = 0;
    rad.addEventListener('input', function () {
      DR.rad = +rad.value; $('drRadTxt').textContent = distShort(DR.rad);
      if (DR.circle) DR.circle.setRadius(DR.rad);
      clearTimeout(tm); tm = setTimeout(function () { if (DR) { driftCompute(); driftRender(); } }, 60);
    });
    $('drAll').addEventListener('click', function () {
      if (!DR) return;
      var allOn = !DR.cands.some(function (x) { return DR.off.has(x.i); });
      DR.cands.forEach(function (x) { if (allOn) DR.off.add(x.i); else DR.off.delete(x.i); });
      driftRender();
    });
    $('drList').addEventListener('change', function (ev) {
      var c = ev.target.closest('input[data-i]');
      if (!c || !DR) return;
      if (c.checked) DR.off.delete(+c.dataset.i); else DR.off.add(+c.dataset.i);
      DR.sel = +c.dataset.i;
      driftRender(true);
    });
    $('drList').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-i]');
      if (!b || !DR) return;
      DR.sel = DR.sel === +b.dataset.i ? -1 : +b.dataset.i;
      driftRender(true);
      if (DR.sel >= 0) driftShow(DR.sel);
    });
    $('drSave').addEventListener('click', function () { if (DR) driftSave(); });
    $('drRemove').addEventListener('click', function () { if (DR) driftRemove(); });
    map.on('click', driftTap);
  }
  $('drTitle').textContent = DR.name;
  $('drRad').value = DR.rad; $('drRadTxt').textContent = distShort(DR.rad);
  $('drRemove').hidden = !DR.rule;
  top.hidden = false; $('drBot').hidden = false;
}
function driftWhen(x) {
  var i = x.i, b = D.base || D, off = D.off[i], bits = [];
  if (x.head) bits.push('still ' + duration(x.head) + ' at the start');
  if (x.tail) bits.push('still ' + duration(x.tail) + ' at the end');
  // The day it started as loaded (a cut-back start can be on the next day).
  var day = off === NO_OFF ? D.day[i] : Math.floor((b.start[i] + off * 60000) / 864e5);
  return { day: niceDate(day),
    t: clock(b.start[i], off) + '–' + clock(b.end[i], off) + (bits.length ? ' · ' + bits.join(', ') : ''), dur: duration(b.end[i] - b.start[i]) };
}
function driftRender(keepList) {
  if (!DR) return;
  var n = DR.cands.length, on = DR.cands.filter(function (x) { return !DR.off.has(x.i); }), ms = 0;
  on.forEach(function (x) { ms += x.ms; });
  $('drSum').innerHTML = n ? '<b>' + fmt(on.length) + '</b> of ' + driftWalks(n) + ' ticked · <b>' + driftHours(ms) + '</b>' : 'No walks here look like stays.';
  $('drAll').textContent = on.length === n ? 'Untick all' : 'Tick all';
  $('drAll').hidden = !n;
  var save = $('drSave');
  save.textContent = on.length ? 'Make ' + driftWalks(on.length) + ' stays' : DR.rule ? 'Save' : 'Make walks stays';
  save.disabled = !on.length && !DR.rule;
  if (!keepList) {
    $('drList').innerHTML = DR.cands.slice(0, 400).map(function (x) {
      var w = driftWhen(x), off = DR.off.has(x.i);
      return '<div class="dr-item' + (off ? ' off' : '') + (x.i === DR.sel ? ' sel' : '') + '" data-row="' + x.i + '"><input type="checkbox" data-i="' + x.i + '"' + (off ? '' : ' checked') + ' aria-label="Make the walk on ' + esc(w.day) + ' part of the stay">' +
        '<button type="button" class="sel-open" data-i="' + x.i + '"><b>' + esc(w.day) + '</b><small>' + esc(w.t) + '</small></button>' +
        '<span class="dr-n"><span class="num">' + w.dur + '</span>' + (x.kind === 'cut' ? '<span class="tag-cut">Cut back</span>' : '') + '</span></div>';
    }).join('') + (n > 400 ? '<p class="fine dr-more">Showing the latest 400 of ' + fmt(n) + '.</p>' : '');
  } else {
    $('drList').querySelectorAll('.dr-item').forEach(function (el) {
      var i = +el.dataset.row;
      el.classList.toggle('off', DR.off.has(i)); el.classList.toggle('sel', i === DR.sel);
    });
  }
  driftDraw();
}
function driftPath(i) {
  var S = driftSrc(), out = [];
  for (var q = S.pathOff[i]; q < S.pathOff[i + 1]; q++) out.push([S.pathPts[2 * q], S.pathPts[2 * q + 1]]);
  return out;
}
function driftDraw() {
  DR.layer.clearLayers();
  var foot = cssVar('--m-foot'), acc = cssVar('--accent'), grey = cssVar('--muted');
  DR.circle = L.circle(DR.c, { pane: 'mrg', renderer: DR.r, radius: DR.rad, color: acc, weight: 2, dashArray: '7 5', fillColor: acc, fillOpacity: .07, interactive: false }).addTo(DR.layer);
  // A cut-back walk: only its still ends become the stay; the part where you moved stays a walk (grey).
  var onP = [], offP = [], moveP = [], sel = null;
  DR.lines = [];
  DR.cands.forEach(function (x) {
    var p = driftPath(x.i);
    DR.lines.push({ i: x.i, p: p });
    if (x.i === DR.sel) sel = p;
    else if (DR.off.has(x.i)) offP.push(p);
    else if (x.kind === 'cut') {
      moveP.push(p.slice(x.a, x.z + 1));
      if (x.head) onP.push(p.slice(0, x.a + 2));
      if (x.tail) onP.push(p.slice(x.z - 1));
    } else onP.push(p);
  });
  if (offP.length) L.polyline(offP, { pane: 'mrg', renderer: DR.r, color: grey, weight: 2, dashArray: '5 5', opacity: .8, interactive: false }).addTo(DR.layer);
  if (moveP.length) L.polyline(moveP, { pane: 'mrg', renderer: DR.r, color: grey, weight: 1.6, opacity: sel ? .3 : .55, interactive: false }).addTo(DR.layer);
  if (onP.length) L.polyline(onP, { pane: 'mrg', renderer: DR.r, color: foot, weight: 2.6, opacity: sel ? .45 : .85, interactive: false }).addTo(DR.layer);
  if (sel) {
    L.polyline(sel, { pane: 'mrg', renderer: DR.r, color: cssVar('--on-color'), weight: 8, opacity: .95, interactive: false }).addTo(DR.layer);
    L.polyline(sel, { pane: 'mrg', renderer: DR.r, color: DR.off.has(DR.sel) ? grey : acc, weight: 4, dashArray: DR.off.has(DR.sel) ? '6 5' : null, interactive: false }).addTo(DR.layer);
  }
  L.circleMarker(DR.c, { pane: 'mrg', renderer: DR.r, radius: 5, color: cssVar('--on-color'), weight: 2, fillColor: acc, fillOpacity: 1, interactive: false }).addTo(DR.layer);
}
// A tap on the map: the walk nearest it (within 14 px) is shown, and its row in the list.
function driftTap(ev) {
  if (!DR || !DR.lines) return;
  var p = map.latLngToContainerPoint(ev.latlng), best = -1, bd = 14;
  DR.lines.forEach(function (l) {
    var prev = null;
    l.p.forEach(function (ll) {
      var c = map.latLngToContainerPoint(ll);
      var d = prev ? L.LineUtil.pointToSegmentDistance(p, prev, c) : p.distanceTo(c);
      if (d < bd) { bd = d; best = l.i; }
      prev = c;
    });
  });
  DR.sel = best;
  driftRender(true);
  var row = best >= 0 && $('drList').querySelector('[data-row="' + best + '"]');
  if (row) row.scrollIntoView({ block: 'nearest' });
}
function driftShow(i) {
  var p = driftPath(i);
  if (!p.length) return;
  var b = L.latLngBounds(p);
  if (!map.getBounds().contains(b)) map.panTo(b.getCenter());
}
// Save: the place gets drift with the radius, and the walks you unticked in its except. A new place
// is made only for this (drift.only), so it names no stays. Nothing ticked takes drift off again.
function driftSave() {
  var on = DR.cands.filter(function (x) { return !DR.off.has(x.i); }), off = DR.cands.filter(function (x) { return DR.off.has(x.i); });
  var r = DR.rule || DR.place, name = DR.name, rad = DR.rad, c = DR.c, b = D.base || D, isNew = false;
  if (!on.length && !r) return;
  mrEnsure();
  if (!r) { isNew = true; r = { id: mrNewId(name), name: name, at: c }; (MR.doc.places || (MR.doc.places = [])).push(r); }
  var refs = off.map(function (x) { return { start: mrIsoLocal(x.i), mode: MODES[b.mode[x.i]] }; });
  if (on.length) {
    r.drift = Object.assign({}, typeof r.drift === 'object' ? r.drift : {}, { radius_m: rad });
    if (isNew || r.drift.only) r.drift.only = true;
    if (refs.length) r.except = refs; else delete r.except;
  } else if (r.drift && r.drift.only) {
    MR.doc.places = mrList('places').filter(function (x) { return x !== r; });
  } else { delete r.drift; delete r.except; }
  driftEnd();
  saving(function () {
    mrChange(on.length ? 'GPS drifts here: ' + name + ' (' + driftWalks(on.length) + ' made stays)' : 'GPS drifts here removed: ' + name);
    if (D.driftSug) D.driftSug = null;
    toast(on.length ? driftWalks(on.length) + ' near ' + name + ' are now part of your stays. Change it in Menu › Trip cleanup.' : 'The walks near ' + name + ' are walks again.');
  });
}
function driftRemove() {
  var r = DR.rule, name = DR.name;
  if (!r) return;
  mrAsk({
    title: 'Make these walks walks again?',
    text: 'The walks near <b>' + esc(name) + '</b> stop being part of your stays.' + (r.drift && r.drift.only ? ' The place goes from My Edits.' : ' The place keeps its name.'),
    buttons: [['Remove', 'danger', function () {
      if (r.drift && r.drift.only) MR.doc.places = mrList('places').filter(function (x) { return x !== r; });
      else { delete r.drift; delete r.except; }
      driftEnd();
      mrChange('GPS drifts here removed: ' + name);
      D.driftSug = null;
      toast('The walks near ' + name + ' are walks again.');
    }], ['Cancel', 'quiet', null]]
  });
}
function driftEnd() {
  if (!DR) return;
  var was = DR;
  DR = null;
  was.dim.remove(); was.layer.remove();
  map.getContainer().classList.remove('drift-on');
  document.body.classList.remove('sel-mode', 'drift-mode');
  if ($('drTop')) { $('drTop').hidden = true; $('drBot').hidden = true; }
  layerToggles();
}
document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && DR && !$('mrDlg').open) driftEnd(); });

// ---------- this was a stay (one walk, a place you pick on the map) ----------
// In a walk's pencil menu, This was a stay… shows your regular places near it on the map; tap one and
// Make it a stay saves a correction { trip, then: { stay: { at, name, place } } }. The walk is hidden
// (mrCorrectOne) and, when the trips are set up, a stay at that place covers its time (mrStayInject).
// Stays can only be added then, so a change to these corrections sets the trips up again (mrReapply
// compares mrStaySig with the one the trips were set up with).
function mrStayCors() {
  if (!MR || !MR.on) return [];
  return mrActive('corrections').filter(function (c) { return c.trip && c.trip.start && c.then && c.then.stay && Array.isArray(c.then.stay.at) && isFinite(c.then.stay.at[0]) && isFinite(c.then.stay.at[1]); });
}
// Splits (split.js) are made while the trips are set up too, so they are in the same signature.
function mrStaySig() {
  return JSON.stringify(mrSplitRules()) + '|' + mrStayCors().map(function (c) { return c.id + '@' + c.trip.start + '@' + c.then.stay.at.join(',') + '@' + (c.then.stay.name || '') + (c.except ? '@' + JSON.stringify(c.except) : ''); }).join('|');
}
// R is D while the trips are set up (after splitTrips): its stays plus one per walk made a stay.
function mrStayInject(R) {
  var cors = mrStayCors();
  R.staySig = mrStaySig(); R.madeStays = [];
  if (!cors.length) return R;
  var n = R.start.length, k;
  // mrRefTrips finds trips by their start, in time order.
  R.order = Int32Array.from(Array.from({ length: n }, function (_, j) { return j; }).sort(function (a, b) { return R.start[a] - R.start[b]; }));
  var add = [];
  cors.forEach(function (c) {
    var ex = c.except ? mrExcept(c) : {}, t = mrRefTrips(c.trip).filter(function (j) { return !ex[j]; });
    if (t.length !== 1) return;
    var i = t[0], s = c.then.stay;
    add.push({ i: i, at: s.at, name: s.name || '', rule: c.id });
  });
  if (!add.length) return R;
  var nv = R.vs.length, m = nv + add.length, O = Object.assign({}, R);
  function grow(key, w, Ctor) {
    var a = R[key];
    if (a == null) return null;
    if (Array.isArray(a)) return a.slice();
    var b = new (Ctor || a.constructor)(m * w);
    b.set(a.subarray(0, nv * w));
    return b;
  }
  O.vs = grow('vs', 1); O.ve = grow('ve', 1); O.vday = grow('vday', 1); O.voff = grow('voff', 1); O.vll = grow('vll', 2);
  O.vtype = grow('vtype', 1); O.vname = grow('vname', 1) || []; O.vpid = grow('vpid', 1) || []; O.vgoog = grow('vgoog', 2); O.vsrcs = grow('vsrcs', 1);
  add.forEach(function (x, j) {
    var v = nv + j, i = x.i;
    O.vs[v] = R.start[i]; O.ve[v] = R.end[i]; O.vday[v] = R.day[i]; O.voff[v] = R.off[i];
    O.vll[2 * v] = x.at[0]; O.vll[2 * v + 1] = x.at[1];
    if (O.vtype) O.vtype[v] = 0;
    O.vname[v] = x.name; O.vpid[v] = '';
    if (O.vgoog) { O.vgoog[2 * v] = NaN; O.vgoog[2 * v + 1] = NaN; }
    if (O.vsrcs) O.vsrcs[v] = R.srcs ? R.srcs[i] : R.src || 0;
    O.madeStays.push({ v: v, trip: i, rule: x.rule });
  });
  return O;
}

// The picker: the walk on the map and your places around it, one to tap.
var STP = null, STAY_NEAR_KM = 3, STAY_MAX = 20, STAY_SUGGEST_KM = 0.4;
function stayPickOk(i) {
  return !!D && !isDup(i) && !(D.mrStay && D.mrStay[i]) && !(D.mrHide && D.mrHide[i]) && MODES[D.mode[i]] === 'WALKING' && !(D.est[i] & STRAVA);
}
function stayPickStart(i) {
  if (!stayPickOk(i)) return;
  needPlaces();
  var b = D.base || D, pts = [];
  for (var q = b.pathOff[i]; q < b.pathOff[i + 1]; q++) pts.push([b.pathPts[2 * q], b.pathPts[2 * q + 1]]);
  if (!pts.length) pts.push([D.from[2 * i], D.from[2 * i + 1]], [D.to[2 * i], D.to[2 * i + 1]]);
  // Your places (where you stayed, named or not) near the walk, nearest first, each with how often you were there.
  var visits = {}, v;
  for (v = 0; v < D.vs.length; v++) if (D.pv && D.pv[v] >= 0) visits[D.pv[v]] = (visits[D.pv[v]] || 0) + 1;
  var cands = [];
  D.places.forEach(function (p, k) {
    if (p.ap || !visits[k] && !p.mr) return;
    var d = Infinity;
    for (var j = 0; j < pts.length; j += Math.max(1, Math.floor(pts.length / 40))) d = Math.min(d, kmLL(p.lat, p.lng, pts[j][0], pts[j][1]));
    d = Math.min(d, kmLL(p.lat, p.lng, pts[pts.length - 1][0], pts[pts.length - 1][1]));
    if (d <= STAY_NEAR_KM) cands.push({ k: k, d: d, n: visits[k] || 0, lat: p.lat, lng: p.lng });
  });
  cands.sort(function (x, y) { return x.d - y.d; });
  cands = cands.slice(0, STAY_MAX);
  // Where the walk spent its time: the middle of its points (they come at a steady pace, so the
  // middle sits where it lingered). The suggestion is the place nearest to it, if one is close;
  // otherwise a new place right there, which you can move with a tap anywhere on the map.
  var la = pts.map(function (x) { return x[0]; }).sort(function (a, b) { return a - b; }), ln = pts.map(function (x) { return x[1]; }).sort(function (a, b) { return a - b; });
  var mid = { lat: la[la.length >> 1], lng: ln[ln.length >> 1] }, best = null;
  cands.forEach(function (c) { c.dm = kmLL(c.lat, c.lng, mid.lat, mid.lng); if (c.dm <= STAY_SUGGEST_KM && (!best || c.dm < best.dm)) best = c; });
  closeSheets(true);
  if (PREFS.proj !== 'merc') setProj('merc');
  setTab('map');
  if (!initMap()) return;
  if (typeof splitHandEnd === 'function') splitHandEnd();
  if (typeof ignEnd === 'function') ignEnd();
  if (typeof selEnd === 'function') selEnd();
  if (typeof snapEnd === 'function') snapEnd();
  stayPickEnd();
  if (!map.getPane('mrg')) { map.createPane('mrg'); map.getPane('mrg').style.zIndex = 460; }
  STP = { i: i, cands: cands, spot: mid, sug: best ? best.k : null, sel: best ? best.k : 'spot' };
  STP.r = L.canvas({ pane: 'mrg', padding: 0.5 });
  STP.dim = L.rectangle([[-89, -720], [89, 720]], { pane: 'mrg', renderer: STP.r, stroke: false, fillColor: cssVar('--bg'), fillOpacity: .5, interactive: false }).addTo(map);
  STP.line = L.polyline(pts, { pane: 'mrg', renderer: STP.r, color: cssVar('--m-foot'), weight: 4, opacity: .8, interactive: false }).addTo(map);
  STP.layer = L.layerGroup().addTo(map);
  map.getContainer().classList.add('sel-on');
  document.body.classList.add('sel-mode');
  map.on('click', stayPickTap);
  layerToggles();
  hideTip(); setHovered([]);
  stayPickBars();
  stayPickRender();
  var bb = L.latLngBounds(pts).extend([mid.lat, mid.lng]);
  cands.slice(0, 8).forEach(function (c) { bb.extend([c.lat, c.lng]); });
  map.fitBounds(bb, { paddingTopLeft: [80, wide() ? 120 : 160], paddingBottomRight: [80, wide() ? 140 : 200], maxZoom: 17 });
}
function stayPickRender() {
  if (!STP) return;
  STP.layer.clearLayers();
  STP.cands.forEach(function (c) {
    var on = STP.sel === c.k, lab = (STP.sug === c.k ? 'Suggested: ' : '') + placeLabel(c.k) + ' · ' + fmt(c.n) + ' stay' + (c.n === 1 ? '' : 's');
    var m = L.marker([c.lat, c.lng], { pane: 'mrg', keyboard: true, title: lab, alt: lab, zIndexOffset: on ? 1000 : 0,
      icon: L.divIcon({ className: 'stay-pin' + (on ? ' on' : ''), html: '<span data-stay-k="' + c.k + '"></span>', iconSize: on ? [30, 30] : [22, 22] }) })
      .bindTooltip(esc(lab), { direction: 'top', offset: [0, on ? -14 : -10], permanent: on })
      .on('click', function () { STP.sel = c.k; stayPickRender(); })
      .addTo(STP.layer);
    if (on) m.openTooltip();
  });
  // The new place: shown while it's picked, or when none of yours is close to the walk.
  if (STP.sel === 'spot' || STP.sug == null) {
    var on = STP.sel === 'spot', lab = 'A new place' + (on ? ' here' : ', where the walk lingered');
    var sm = L.marker([STP.spot.lat, STP.spot.lng], { pane: 'mrg', keyboard: true, title: lab, alt: lab, zIndexOffset: on ? 1000 : 0,
      icon: L.divIcon({ className: 'stay-pin new' + (on ? ' on' : ''), html: '<span data-stay-k="spot"></span>', iconSize: on ? [30, 30] : [22, 22] }) })
      .bindTooltip(esc(lab), { direction: 'top', offset: [0, on ? -14 : -10], permanent: on })
      .on('click', function () { STP.sel = 'spot'; stayPickRender(); })
      .addTo(STP.layer);
    if (on) sm.openTooltip();
  }
  var i = STP.i, s = STP.sel;
  var when = clock(D.start[i], D.off[i]) + '–' + clock(D.end[i], D.off[i]);
  $('stpSum').innerHTML = s == null ? '<b>Tap the place where you were</b><small>' + when + '</small>'
    : s === 'spot' ? '<b>A stay at a new place' + (stayNewName() ? ' in ' + esc(stayNewName()) : '') + '</b><small>' + when + ', instead of this walk. Tap the map to move it.</small>'
    : '<b>A stay at ' + esc(placeLabel(s)) + '</b><small>' + when + ', instead of this walk' + (s === STP.sug ? ' (suggested: the place nearest to where it lingered)' : '') + '</small>';
  $('stpBot').querySelector('[data-a="save"]').disabled = s == null;
}
function stayPickBars() {
  var top = $('stpTop');
  if (!top) {
    top = promptBar('stpTop', { mode: true, icon: 'home', title: 'This was a stay', text: 'Tap one of your places, or anywhere on the map for a new one.', acts: [['Cancel', 'quiet', 'cancel']],
      on: function (a) { if (a === 'cancel' && STP) { var i = STP.i; stayPickEnd(); openTrip(i); } } });
    var bot = document.createElement('div');
    bot.id = 'stpBot'; bot.className = 'sel-bar';
    bot.innerHTML = '<div class="sel-row"><div class="sel-sum ign-sum" id="stpSum"></div><button type="button" class="btn primary" data-a="save">Make it a stay</button></div>';
    bot.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (b && b.dataset.a === 'save') stayPickSave();
    });
    document.body.appendChild(bot);
  }
  top.hidden = false; $('stpBot').hidden = false;
}
function stayNewName() {
  var c = STP && nearestCity(STP.spot.lat, STP.spot.lng);
  return c ? (c.d > 8 ? 'Near ' : '') + c.name : '';
}
function stayPickTap(e) {
  if (!STP) return;
  STP.spot = { lat: e.latlng.lat, lng: e.latlng.lng }; STP.sel = 'spot';
  stayPickRender();
}
function stayPickSave() {
  if (!STP || STP.sel == null) return;
  var i = STP.i, b = D.base || D, spot = STP.sel === 'spot';
  var p = spot ? STP.spot : D.places[STP.sel], name = spot ? stayNewName() || 'a new place' : placeLabel(STP.sel);
  mrEnsure();
  var c = mrTripCorrection(i);
  if (!c) (MR.doc.corrections || (MR.doc.corrections = [])).push(c = { id: mrNewId('stay-' + isoDay(D.day[i])), trip: { start: mrIsoLocal(i), mode: MODES[b.mode[i]] }, then: {} });
  c.then.stay = { at: [+p.lat.toFixed(6), +p.lng.toFixed(6)], name: spot ? stayNewName() : name };
  if (!c.then.stay.name) delete c.then.stay.name;
  if (p.mr) c.then.stay.place = p.mr;
  stayPickEnd();
  working('Making it a stay…', function () { mrChange('Walk on ' + mrWhere(i) + ' made a stay at ' + name); });
  toast('Made a stay at ' + name + '. Undo it in My Edits › Corrections.');
}
function stayPickEnd() {
  if (!STP) return;
  var was = STP;
  STP = null;
  was.dim.remove(); was.line.remove(); was.layer.remove();
  map.off('click', stayPickTap);
  map.getContainer().classList.remove('sel-on');
  document.body.classList.remove('sel-mode');
  if ($('stpTop')) { $('stpTop').hidden = true; $('stpBot').hidden = true; }
  layerToggles();
}
$('tripBody').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-stay-pick]');
  if (!b) return;
  ev.stopPropagation();
  stayPickStart(+b.dataset.stayPick);
});
