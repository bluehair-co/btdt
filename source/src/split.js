// ---------- trips Timeline merged ----------
// Timeline sometimes keeps a train ride, the wait at the station and the tram or walk after it as
// one trip. splitPlan (parser.js) finds the cuts from the trip's GPS points; splitTrips turns each
// such trip into its legs, each a trip of its own (type, line, times, distance), so filters,
// routines, Insights and the map treat them as what they were. The legs remember the trip they came
// from (D.leg), and the trip details show them together with the stops between them.
// - Automatic (PREFS.split 'auto', the default): sure cuts are made (a stop at a station, or the speed
//   changing a lot at a stop); trips with only unsure cuts are offered (D.offer) with a Split button.
// - Only suggest ('ask'): every trip is offered, none is split until you say so.
// - Off: nothing is split or offered.
// Keep as one trip (PREFS.splitKeep) and Split (PREFS.splitYes) are kept per trip, by its start time
// in seconds. A trip a MyRules correction points at is only offered, as you have already looked at it.
// Splitting happens on D only: what is saved stays as loaded, so turning it off brings the trips back.
var SPLIT_MODES = { VEHICLE: 1, UNKNOWN: 1, TRAIN: 1, TRAM: 1, SUBWAY: 1, BUS: 1 };
var SPLIT_TRIP = ['start', 'end', 'day', 'mode', 'km', 'est', 'off', 'orig', 'from', 'to', 'srcs', 'sport', 'stype', 'smeta', 'gby', 'gconf', 'repl', 'dup', 'pathPts', 'pathT', 'pathOff'];
function splitSetting() { return PREFS.split === 'ask' || PREFS.split === 'off' ? PREFS.split : 'auto'; }
function splitKey(ms) { return String(Math.round(ms / 1000)); }
function splitHas(list, key) { return Array.isArray(list) && list.indexOf(key) >= 0; }

// Start times (ms) of trips MyRules corrections point at.
function splitFixed() {
  var out = [];
  if (typeof mrActive === 'function') mrActive('corrections').forEach(function (c) { var t = c.trip && c.trip.start && Date.parse(c.trip.start); if (isFinite(t)) out.push(t); });
  return out.sort(function (a, b) { return a - b; });
}
function splitCandidate(R, i) {
  var e = R.est[i], m = MODES[R.mode[i]], s = R.srcs ? R.srcs[i] : R.src;
  if (e & STRAVA || m === 'FLYING' || s === SRC.strava || s === SRC.sim || R.dup && R.dup[i]) return false;
  if (!SPLIT_MODES[m] && !(e & GUESSED)) return false;
  return R.pathOff[i + 1] - R.pathOff[i] >= 4;
}
// The type a leg's lines say, from the station packs: { mode, conf } or null.
function splitPackType(pts, avg, near) {
  if (!near || pts.length < 2) return null;
  var on = { 1: 0, 2: 0, 4: 0, 8: 0 }, n = 0;
  pts.forEach(function (p) { var b = packRailBits(p[0], p[1]); n++; for (var k in on) if (b & k) on[k]++; });
  function share(bits) { var c = 0; pts.forEach(function (p) { if (packRailBits(p[0], p[1]) & bits) c++; }); return c / n; }
  if (avg >= 25 && share(1 | 8) >= 0.6 && on[1] >= on[4]) return { mode: 'TRAIN', conf: 85 };
  // A tram runs in the street, where a phone keeps its GPS; a metro mostly underground, where it
  // doesn't. Points along both are a tram.
  var tram = share(2 | 8), metro = share(4);
  if (avg >= 8 && avg < 35 && tram >= 0.6 && tram >= metro) return { mode: 'TRAM', conf: 75 };
  if (avg >= 12 && metro >= 0.6) return { mode: 'SUBWAY', conf: 70 };
  return null;
}
function splitTrips(R) {
  var n = R.start.length, i, set = splitSetting(), keep = PREFS.splitKeep || [], yes = PREFS.splitYes || [];
  R.leg = null; R.offer = null; R.splitN = 0; R.offerN = 0;
  if (set === 'off' && !yes.length) return R;
  var near = packNear(), fixed = splitFixed(), plans = [], any = false;
  function isFixed(ms) { for (var k = 0; k < fixed.length; k++) if (Math.abs(fixed[k] - ms) <= 3 * 60000) return true; return false; }
  for (i = 0; i < n; i++) {
    plans.push(null);
    if (!splitCandidate(R, i)) continue;
    var plan = splitPlan(tripRun(R, i), near);
    if (!plan.length) continue;
    var key = splitKey(R.start[i]), use;
    if (splitHas(yes, key)) use = plan;
    else if (set === 'auto' && !splitHas(keep, key) && !isFixed(R.start[i])) use = plan.filter(function (c) { return c.sure; });
    else use = [];
    if (set === 'off' && !splitHas(yes, key)) continue;
    plans[i] = { key: key, all: plan, use: use, kept: splitHas(keep, key) };
    if (use.length) any = true;
  }
  var offer = [], leg = [], out = { start: [], end: [], day: [], mode: [], km: [], est: [], off: [], orig: [], from: [], to: [], srcs: [], sport: [], stype: [], smeta: [], gby: [], gconf: [], repl: [], dup: [], pts: [], t: [] };
  function push(o, l, f) {
    for (var k in o) out[k].push(o[k]);
    leg.push(l); offer.push(f);
  }
  function copy(i2) {
    var pts = [], t = [];
    for (var q = R.pathOff[i2]; q < R.pathOff[i2 + 1]; q++) { pts.push(R.pathPts[2 * q], R.pathPts[2 * q + 1]); t.push(R.pathT[q]); }
    return { start: R.start[i2], end: R.end[i2], day: R.day[i2], mode: R.mode[i2], km: R.km[i2], est: R.est[i2], off: R.off[i2], orig: R.orig ? R.orig[i2] : 0,
      from: [R.from[2 * i2], R.from[2 * i2 + 1]], to: [R.to[2 * i2], R.to[2 * i2 + 1]], srcs: R.srcs ? R.srcs[i2] : R.src || 0, sport: R.sport ? R.sport[i2] : 0,
      stype: R.stype && R.stype[i2] || '', smeta: R.smeta && R.smeta[i2] || null, gby: R.gby ? R.gby[i2] : 0, gconf: R.gconf ? R.gconf[i2] : 0,
      repl: R.repl ? R.repl[i2] : 0, dup: R.dup ? R.dup[i2] : 0, pts: pts, t: t };
  }
  var retype = [], splitN = 0, offerN = 0;
  for (i = 0; i < n; i++) {
    var P = plans[i];
    if (!P || !P.use.length) {
      var f = P && (set !== 'off' || P.kept) ? { key: P.key, plan: P.all, kept: P.kept } : null;
      if (f) offerN++;
      push(copy(i), null, f);
      continue;
    }
    splitN++;
    var legs = splitLegs(R, i, P.use, near), base = copy(i), first = out.start.length;
    legs.forEach(function (L, k) {
      var o = Object.assign({}, base, { start: L.start, end: L.end, km: L.km, orig: 0, from: L.pts[0], to: L.pts[L.pts.length - 1], pts: [].concat.apply([], L.pts), t: L.t,
        day: base.off === NO_OFF ? base.day : Math.floor((L.start + base.off * 60000) / 864e5), mode: MODE_IDX[L.mode], gby: L.gby, gconf: L.conf, repl: 0, dup: 0,
        est: (base.est & ~(GUESSED | 8)) | (L.guess ? GUESSED : 0) });
      push(o, { key: P.key, k: k, n: legs.length, first: first, stop: L.stop, was: { mode: MODES[R.mode[i]], km: R.km[i], start: R.start[i], end: R.end[i], guessed: !!(R.est[i] & GUESSED) }, cuts: P.use.length < P.all.length ? P.all.length - P.use.length : 0 }, null);
      if (L.retype) retype.push(out.start.length - 1);
    });
  }
  if (!any && !offerN) return R;
  var m = out.start.length, O = {};
  Object.keys(R).forEach(function (k) { if (SPLIT_TRIP.indexOf(k) < 0) O[k] = R[k]; });
  O.start = Float64Array.from(out.start); O.end = Float64Array.from(out.end); O.day = Int32Array.from(out.day); O.mode = Uint8Array.from(out.mode);
  O.km = Float32Array.from(out.km); O.est = Uint8Array.from(out.est); O.off = Int16Array.from(out.off); O.orig = Float32Array.from(out.orig);
  O.from = new Float32Array(2 * m); O.to = new Float32Array(2 * m);
  for (i = 0; i < m; i++) { O.from[2 * i] = out.from[i][0]; O.from[2 * i + 1] = out.from[i][1]; O.to[2 * i] = out.to[i][0]; O.to[2 * i + 1] = out.to[i][1]; }
  O.srcs = Uint8Array.from(out.srcs); O.sport = Uint8Array.from(out.sport); O.stype = out.stype; O.smeta = out.smeta;
  O.gby = Uint8Array.from(out.gby); O.gconf = Uint8Array.from(out.gconf);
  if (R.repl) O.repl = Uint16Array.from(out.repl);
  if (R.dup) O.dup = Uint8Array.from(out.dup);
  var np = 0;
  out.t.forEach(function (t) { np += t.length; });
  O.pathPts = new Float32Array(2 * np); O.pathT = new Float32Array(np); O.pathOff = new Uint32Array(m + 1);
  var w = 0;
  for (i = 0; i < m; i++) {
    O.pathOff[i] = w;
    for (var q = 0; q < out.t[i].length; q++, w++) { O.pathPts[2 * w] = out.pts[i][2 * q]; O.pathPts[2 * w + 1] = out.pts[i][2 * q + 1]; O.pathT[w] = out.t[i][q]; }
  }
  O.pathOff[m] = w;
  O.leg = leg; O.offer = offer; O.splitN = splitN; O.offerN = offerN;
  // Legs without a type from their lines are guessed like any untyped trip: speed, your other trips
  // between the same places, labelled trips on the same line, stations named at their ends.
  if (retype.length) {
    var only = new Uint8Array(m);
    retype.forEach(function (j) { only[j] = 1; });
    retypeGuessed(O, only);
  }
  return O;
}
// The legs of trip i cut at cuts: [{ start, end, pts, t, km, mode, guess, retype, gby, conf, stop }].
// A stop at a station ends the leg before at the station and starts the next one there. The distance
// Timeline (or the trail) gave the whole trip is shared by the legs by the length of their trails,
// so totals don't change.
function splitLegs(R, i, cuts, near) {
  var run = tripRun(R, i), ll = run.map(function (r) { return r[1]; }), t = run.map(function (r) { return (r[0] - R.start[i]) / 1000; });
  var n = run.length, legs = [], from = 0, startS = 0;
  cuts.forEach(function (c, x) {
    var L = { a: from, b: c.a, s: startS, pre: x ? legs[x - 1].post : null, cut: c };
    var tEnd = t[c.a], tNext = t[c.b];
    if (c.st && c.kind !== 'speed') {
      var S = [c.st.lat, c.st.lng], vin = Math.max(c.vin, 4), vout = Math.max(c.vout, 4);
      var arr = Math.min(t[c.a] + km(ll[c.a], S) / vin * 3600, t[c.b]), dep = Math.max(arr, t[c.b] - km(S, ll[c.b]) / vout * 3600);
      if (km(ll[c.a], S) > 0.05) { L.end = [S, arr]; tEnd = arr; }
      if (km(S, ll[c.b]) > 0.05) { L.nextPre = [S, dep]; tNext = dep; }
    }
    L.e = tEnd;
    L.stop = { kind: c.kind, st: c.st, name: c.st ? packStopName(c.st) : '', ms: (tNext - tEnd) * 1000, at: c.st ? [c.st.lat, c.st.lng] : ll[c.a], sure: c.sure };
    legs.push(L);
    from = c.b; startS = tNext;
    L.post = L.nextPre || null;
  });
  legs.push({ a: from, b: n - 1, s: startS, pre: legs.length ? legs[legs.length - 1].post : null, e: (R.end[i] - R.start[i]) / 1000, stop: null });
  var trail = 0;
  legs.forEach(function (L, k) {
    var pts = [], tt = [];
    if (L.pre) { pts.push(L.pre[0]); tt.push(L.pre[1]); }
    for (var q = L.a; q <= L.b; q++) { pts.push(ll[q]); tt.push(t[q]); }
    if (L.end) { pts.push(L.end[0]); tt.push(L.end[1]); }
    var s0 = k ? L.s : 0, s1 = k < legs.length - 1 ? L.e : (R.end[i] - R.start[i]) / 1000;
    L.start = R.start[i] + s0 * 1000; L.end = R.start[i] + Math.max(s1, s0) * 1000;
    if (!k) L.start = R.start[i];
    if (k === legs.length - 1) L.end = R.end[i];
    L.pts = pts; L.t = tt.map(function (x) { return Math.max(0, x - s0); });
    L.trail = pathKm(pts); trail += L.trail;
  });
  var orig = MODES[R.mode[i]], typed = !(R.est[i] & GUESSED) && orig !== 'VEHICLE' && orig !== 'UNKNOWN', longest = 0;
  legs.forEach(function (L, k) { if (L.trail > legs[longest].trail) longest = k; });
  legs.forEach(function (L, k) {
    L.km = trail > 0 ? R.km[i] * L.trail / trail : R.km[i] / legs.length;
    var h = (L.end - L.start) / 36e5, avg = h > 0 ? L.trail / h : 0, pt = splitPackType(L.pts.slice(1, -1).length ? L.pts.slice(1, -1) : L.pts, avg, near);
    if (pt) { L.mode = pt.mode; L.guess = true; L.gby = BY_PACK; L.conf = pt.conf; return; }
    // A trip Timeline typed (a train, then a walk) keeps that type on its longest leg.
    if (typed && k === longest) { L.mode = orig; L.guess = false; L.gby = 0; L.conf = 0; return; }
    L.mode = guessMode(L.trail, h) || 'WALKING'; if (L.mode === 'FLYING') L.mode = 'CAR';
    L.guess = true; L.retype = true; L.gby = BY_SPEED; L.conf = 0;
  });
  return legs;
}

// ---------- what the app shows ----------
function legOf(i) { return D && D.leg ? D.leg[i] : null; }
function offerOf(i) { return D && D.offer ? D.offer[i] : null; }
function splitTag(i) {
  var l = legOf(i);
  if (l) return '<span class="guess inf" title="Split from one Timeline trip">Leg ' + (l.k + 1) + '/' + l.n + '</span>';
  var f = offerOf(i);
  return f && !f.kept && splitSetting() !== 'off' ? '<span class="guess" title="Looks like ' + (f.plan.length + 1) + ' trips Timeline merged">Split?</span>' : '';
}
function splitStopText(s) {
  var mins = Math.round(s.ms / 60000), where = s.name ? 'at ' + esc(s.name) : s.at ? 'in ' + esc(nearestCity(s.at[0], s.at[1]) ? nearestCity(s.at[0], s.at[1]).name : 'the same place') : '';
  return (s.kind === 'speed' ? 'Changed ' + (where || 'transport') : mins >= 1 ? hoursLabel(mins / 60) + ' stop ' + where : 'Stop ' + where).trim();
}
// The trip details: its legs and stops, with Keep as one trip; or, for a trip that looks merged, a Split button.
function splitBlock(i) {
  var l = legOf(i), f = offerOf(i);
  if (l) {
    var rows = '';
    for (var k = 0; k < l.n; k++) {
      var j = l.first + k, L = D.leg[j];
      rows += '<button type="button" class="hit-row' + (j === i ? ' on' : '') + '" data-i="' + j + '"' + (j === i ? ' aria-current="true"' : '') + '>' + badge(modeOf(j), true, 0, tripIcon(j)) +
        '<span class="t"><b>' + tripLabel(j) + '</b><small>' + clock(D.start[j], D.off[j]) + '–' + clock(D.end[j], D.off[j]) + '</small></span><span class="r num">' + dist(D.km[j]) + '<small>' + duration(D.end[j] - D.start[j]) + '</small></span></button>';
      if (L.stop) rows += '<div class="split-stop fine">' + icon('pin') + splitStopText(L.stop) + '</div>';
    }
    var w = l.was;
    return '<div class="split-box"><div class="sb-head"><b>' + (l.n === 1 ? 'Split' : l.n + ' legs of one Timeline trip') + '</b></div>' +
      '<p class="fine">Timeline kept this as one ' + esc((LABEL[w.mode] || w.mode).toLowerCase()) + ' trip of ' + dist(w.km) + ', ' + clock(w.start, D.off[i]) + '–' + clock(w.end, D.off[i]) + '. Its GPS points show ' + (l.n === 2 ? 'a stop or a change of speed' : 'stops or changes of speed') + ', so BT•DT splits it into legs, each with its own type and line. The distance is shared by the legs, so totals stay the same.</p>' +
      '<div class="list-rows split-legs">' + rows + '</div>' +
      '<div class="sb-acts"><button type="button" class="btn" data-split-act="keep" data-key="' + l.key + '" data-ms="' + w.start + '">' + icon('undo') + 'Keep as one trip</button></div></div>';
  }
  if (f && splitSetting() !== 'off') {
    var p = f.plan, s = p.map(function (c) { return (c.kind === 'speed' ? 'the speed changing from about ' + speed(c.vin) + ' to ' + speed(c.vout) : 'a stop ' + (c.st ? 'at ' + esc(packStopName(c.st)) : 'of a few minutes') + ' between ' + speed(c.vin) + ' and ' + speed(c.vout)); });
    return '<div class="split-box offer"><div class="sb-head"><b>' + (f.kept ? 'Kept as one trip' : 'Looks like ' + (p.length + 1) + ' trips') + '</b></div>' +
      '<p class="fine">' + (f.kept ? 'You chose to keep this as one trip. ' : '') + 'Its GPS points show ' + s.join(', then ') + '. Timeline may have merged ' + (p.length === 1 ? 'two trips' : 'several trips') + ' here' + (packCodes().length ? '' : '; a station pack in Settings would show where the stops were') + '.</p>' +
      '<div class="sb-acts"><button type="button" class="btn" data-split-act="split" data-key="' + f.key + '" data-ms="' + D.start[i] + '">' + icon('split') + 'Split into ' + (p.length + 1) + ' trips</button></div></div>';
  }
  return '';
}
function splitRaw(i) {
  var l = legOf(i);
  if (!l) return null;
  return { leg: l.k + 1, of: l.n, timelineTrip: { start: new Date(l.was.start).toISOString(), end: new Date(l.was.end).toISOString(), mode: l.was.mode, km: +l.was.km.toFixed(3) },
    stopAfter: l.stop ? { kind: l.stop.kind, minutes: Math.round(l.stop.ms / 60000), station: l.stop.name || null, at: [+l.stop.at[0].toFixed(6), +l.stop.at[1].toFixed(6)] } : null };
}
// Keep as one trip / Split: saved for this trip, then the trips are split again and its details reopen.
function splitChoose(act, key, ms) {
  var keep = (PREFS.splitKeep || []).filter(function (k) { return k !== key; }), yes = (PREFS.splitYes || []).filter(function (k) { return k !== key; });
  if (act === 'keep') keep.push(key); else yes.push(key);
  PREFS.splitKeep = keep; PREFS.splitYes = yes;
  savePrefs();
  refreshData();
  // The trip (or its first leg) starts at the same time.
  for (var i = 0; i < D.start.length; i++) if (Math.abs(D.start[i] - ms) < 1000 && !isDup(i)) { openTrip(i); break; }
  toast(act === 'keep' ? 'Kept as one trip' : 'Split into legs');
}
$('tripBody').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-split-act]');
  if (!b) return;
  ev.stopPropagation();
  splitChoose(b.dataset.splitAct, b.dataset.key, +b.dataset.ms);
});

// ---------- Settings ----------
function renderSplitSettings() {
  setPressed('#splitSeg button', function (b) { return b.dataset.s === splitSetting(); });
  var s = splitSetting(), note = $('splitNote');
  if (!D) { note.textContent = ''; return; }
  var n = D.splitN || 0, o = 0;
  if (D.offer) D.offer.forEach(function (f) { if (f && !f.kept) o++; });
  note.textContent = (s === 'off' ? 'Trips are shown as Timeline recorded them.' :
    (n ? fmt(n) + ' trip' + (n === 1 ? ' is' : 's are') + ' split into legs' : 'No trips are split') + (o ? ', and ' + fmt(o) + ' more look merged (marked Split? in their details).' : '.')) +
    (s === 'auto' ? ' Automatic splits where the GPS points are clear: a stop at a station, or a stop between very different speeds.' : '');
}
$('splitSeg').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-s]');
  if (!b || b.dataset.s === splitSetting()) return;
  PREFS.split = b.dataset.s; savePrefs();
  refreshData();
  renderSplitSettings();
});
