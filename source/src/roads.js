// ---------- car trips along the roads ----------
// With "Snap car trips to roads" on (Settings, Station packs), car, taxi and motorcycle trips are
// drawn along the motorways and main roads of a road pack (roads/NL.json.gz on the packs branch:
// motorway, trunk and primary roads with their links, from OpenStreetMap, same node and line format
// as a station pack). The packs are only downloaded when you turn it on, kept in IndexedDB
// "btdt-roads" and removed when you turn it off; they are only read and turned into a graph while
// it is on.
// Each GPS point of a trip (one every ROAD_STEP_KM or more) is put on the nearest road within
// ROAD_NEAR_KM, found in a grid of the roads' segments. Between two points that are both on a road,
// the trip takes the shortest way along the roads (A*), when that is no longer than ROAD_DETOUR times
// the straight line plus ROAD_DETOUR_KM; else, and where its points are away from the roads (side
// streets, car parks), it keeps its own points. A trip takes the result when ROAD_MIN % of its
// length is along the roads. That is worked out in the background, a slice at a time with a pill
// over the map, once per trip (ROAD_CACHE, by its start and end); applied after MyRules and the
// tracks, it changes the line, the times along it and the distance, never the type.
var ROAD_MODES = { CAR: 1, TAXI: 1, MOTORCYCLE: 1 };
var ROAD_STEP_KM = 0.1, ROAD_NEAR_KM = 0.2, ROAD_DETOUR = 1.5, ROAD_DETOUR_KM = 0.5, ROAD_MIN = 50;
var ROADS = {};         // installed road packs, by country: { cc, name, bytes, built, km } (no nodes)
var RG = null;          // the graph of the installed road packs, while it's on
var ROAD_CACHE = new Map(), ROAD_RUN = null, ROAD_STAT = null;
function roadStore(mode, fn) { return withStore('btdt-roads', mode, fn); }
function roadOn() { return !!PREFS.roadSnap; }
function roadCodes() { return Object.keys(ROADS).sort(); }
function roadMeta(p) { return { cc: p.cc, name: p.name, bytes: p.bytes, built: p.built, km: p.km }; }

// The road packs kept on this device, by code: their meta data (name, size, date), from the
// "_meta" record, so Settings knows them without reading the packs. They stay when the switch is
// turned off (and the graph stays in memory), so turning it on again needs no download.
var ROAD_KEPT = {};
function roadKeptLoad() {
  return roadStore('readonly', function (s) { return s.get('_meta'); }).then(function (m) { ROAD_KEPT = m || {}; roadSettings(); }, function () {});
}
function roadKeptSave() { return roadStore('readwrite', function (s) { return s.put(ROAD_KEPT, '_meta'); }).catch(function () {}); }
// The packs' meta data, and (load) their graph. Only called while it's on.
var ROAD_LOADING = null;
function roadsLoad() {
  if (ROAD_LOADING) return ROAD_LOADING;
  ROAD_LOADING = roadStore('readonly', function (s) { return s.getAll(); }).then(function (all) {
    var t0 = performance.now();
    ROADS = {};
    var ok = (all || []).filter(function (p) { return p && p.v === 1 && p.cc && p.kind === 'roads'; });
    ok.forEach(function (p) { ROADS[p.cc] = roadMeta(p); });
    if (Object.keys(ROADS).join() !== Object.keys(ROAD_KEPT).join()) { ROAD_KEPT = Object.assign({}, ROADS); roadKeptSave(); }
    RG = ok.length ? roadGraph(ok) : null;
    if (RG) RG.ms = Math.round(performance.now() - t0);
    ROAD_LOADING = null;
    return RG;
  }, function () { ROAD_LOADING = null; return null; });
  return ROAD_LOADING;
}

// Nodes in typed arrays, the roads' segments in a grid of 0.01° cells, and the graph in CSR form
// (each node's neighbours and the km to them).
function roadGraph(packs) {
  var n = 0, segs = 0;
  packs.forEach(function (p) {
    n += (p.nodes || []).length / 2;
    (p.lines || []).forEach(function (L) { segs += Math.max(0, L.length - 2); });
  });
  var lat = new Float64Array(n), lng = new Float64Array(n), sa = new Int32Array(segs), sb = new Int32Array(segs), sl = new Float32Array(segs);
  var deg = new Int32Array(n + 1), base = 0, s = 0;
  packs.forEach(function (p) {
    var nd = p.nodes || [], la = 0, lo = 0, j;
    for (j = 0; j + 1 < nd.length; j += 2) { la += nd[j]; lo += nd[j + 1]; lat[base + j / 2] = la / 1e5; lng[base + j / 2] = lo / 1e5; }
    (p.lines || []).forEach(function (L) {
      var v = 0, prev = -1;
      for (var q = 1; q < L.length; q++) {
        v += L[q];
        var u = base + v;
        if (prev >= 0 && prev !== u) { sa[s] = prev; sb[s] = u; sl[s] = roadKm(lat[prev], lng[prev], lat[u], lng[u]); deg[prev]++; deg[u]++; s++; }
        prev = u;
      }
    });
    base += nd.length / 2;
  });
  segs = s;
  // CSR
  var off = new Int32Array(n + 1);
  for (var u = 0; u < n; u++) off[u + 1] = off[u] + deg[u];
  var fill = off.slice(0, n), to = new Int32Array(off[n]), w = new Float32Array(off[n]);
  var grid = new Map();
  for (s = 0; s < segs; s++) {
    var a = sa[s], b = sb[s];
    to[fill[a]] = b; w[fill[a]++] = sl[s];
    to[fill[b]] = a; w[fill[b]++] = sl[s];
    var y0 = Math.floor(Math.min(lat[a], lat[b]) * 100), y1 = Math.floor(Math.max(lat[a], lat[b]) * 100);
    var x0 = Math.floor(Math.min(lng[a], lng[b]) * 100), x1 = Math.floor(Math.max(lng[a], lng[b]) * 100);
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var k = y * 100000 + x, c = grid.get(k);
      if (c) c.push(s); else grid.set(k, [s]);
    }
  }
  return {
    n: n, lat: lat, lng: lng, sa: sa, sb: sb, sl: sl, segs: segs, off: off, to: to, w: w, grid: grid,
    np: new Array(n),                            // each node's [lat, lng], made when first used, shared by the trips
    g: new Float64Array(n), prev: new Int32Array(n), seen: new Uint32Array(n), done: new Uint32Array(n), gen: 0
  };
}
function roadKm(la1, lo1, la2, lo2) { var x = (lo2 - lo1) * Math.cos((la1 + la2) * Math.PI / 360) * 111.32, y = (la2 - la1) * 110.57; return Math.sqrt(x * x + y * y); }
function roadPt(G, u) { return G.np[u] || (G.np[u] = [G.lat[u], G.lng[u]]); }
// The nearest segment to (la, lo) within ROAD_NEAR_KM: { s, t (0 at sa, 1 at sb), p, d }, or null.
function roadNear(G, la, lo) {
  var y = Math.floor(la * 100), x = Math.floor(lo * 100), best = null, bd = ROAD_NEAR_KM, cs = Math.cos(la * Math.PI / 180) * 111.32, seen = null;
  for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
    var c = G.grid.get((y + dy) * 100000 + x + dx);
    if (!c) continue;
    for (var k = 0; k < c.length; k++) {
      var s = c[k];
      if (seen && seen.has(s)) continue;
      var a = G.sa[s], b = G.sb[s];
      var ax = (G.lng[a] - lo) * cs, ay = (G.lat[a] - la) * 110.57, bx = (G.lng[b] - lo) * cs, by = (G.lat[b] - la) * 110.57;
      var vx = bx - ax, vy = by - ay, l = vx * vx + vy * vy, t = l ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / l)) : 0;
      var px = ax + t * vx, py = ay + t * vy, d = Math.sqrt(px * px + py * py);
      if (d < bd) { bd = d; best = { s: s, t: t, d: d }; }
      (seen || (seen = new Set())).add(s);
    }
  }
  if (best) { var A = best.s; best.p = [G.lat[G.sa[A]] + best.t * (G.lat[G.sb[A]] - G.lat[G.sa[A]]), G.lng[G.sa[A]] + best.t * (G.lng[G.sb[A]] - G.lng[G.sa[A]])]; }
  return best;
}
// The shortest way along the roads from one place on a segment (roadNear) to another, no longer than
// max km: { pts (the nodes between, not the two places), km }, or null.
function roadRoute(G, A, B, max) {
  if (A.s === B.s) return { pts: [], km: Math.abs(A.t - B.t) * G.sl[A.s] };
  var gen = ++G.gen, g = G.g, prev = G.prev, seen = G.seen, done = G.done, hf = [], hn = [];
  if (gen >= 4294967295) { seen.fill(0); done.fill(0); G.gen = gen = 1; }
  var tla = B.p[0], tlo = B.p[1], cs = Math.cos(tla * Math.PI / 180) * 111.32;
  function h(u) { var x = (G.lng[u] - tlo) * cs, y = (G.lat[u] - tla) * 110.57; return Math.sqrt(x * x + y * y); }
  function push(f, u) {
    hf.push(f); hn.push(u);
    var k = hf.length - 1;
    while (k > 0) { var p = (k - 1) >> 1; if (hf[p] <= f) break; hf[k] = hf[p]; hn[k] = hn[p]; k = p; }
    hf[k] = f; hn[k] = u;
  }
  function pop() {
    var u = hn[0], lf = hf.pop(), ln = hn.pop(), m = hf.length;
    if (m) {
      var k = 0;
      for (;;) { var l = 2 * k + 1, r = l + 1, c = k, cf = lf; if (l < m && hf[l] < cf) { c = l; cf = hf[l]; } if (r < m && hf[r] < cf) c = r; if (c === k) break; hf[k] = hf[c]; hn[k] = hn[c]; k = c; }
      hf[k] = lf; hn[k] = ln;
    }
    return u;
  }
  function start(u, d) { if (seen[u] === gen && g[u] <= d) return; seen[u] = gen; g[u] = d; prev[u] = -1; push(d + h(u), u); }
  var la = G.sl[A.s], lb = G.sl[B.s];
  start(G.sa[A.s], A.t * la); start(G.sb[A.s], (1 - A.t) * la);
  var ta = G.sa[B.s], tb = G.sb[B.s], ea = B.t * lb, eb = (1 - B.t) * lb, best = Infinity, end = -1;
  while (hf.length) {
    var f = hf[0], u = pop();
    if (done[u] === gen) continue;
    if (f >= best || f > max) break;
    done[u] = gen;
    var gu = g[u];
    if (u === ta && gu + ea < best) { best = gu + ea; end = u; }
    if (u === tb && gu + eb < best) { best = gu + eb; end = u; }
    for (var e = G.off[u]; e < G.off[u + 1]; e++) {
      var v = G.to[e], gv = gu + G.w[e];
      if (done[v] === gen || seen[v] === gen && g[v] <= gv) continue;
      seen[v] = gen; g[v] = gv; prev[v] = u; push(gv + h(v), v);
    }
  }
  if (end < 0 || best > max) return null;
  var pts = [];
  for (var x = end; x >= 0; x = prev[x]) pts.push(roadPt(G, x));
  pts.reverse();
  return { pts: pts, km: best };
}
// A trip along the roads, or null when too little of it is: { pts, ts, km, road: true, cov }.
function roadTrip(G, i) {
  var o0 = D.pathOff[i], o1 = D.pathOff[i + 1], dur = Math.max(0, (D.end[i] - D.start[i]) / 1000);
  var pts = [], A = [], T = [], len = 0, along = 0, last = null, lastOn = null, lastP = null;
  function add(p) { if (lastP) len += roadKm(lastP[0], lastP[1], p[0], p[1]); pts.push(p); lastP = p; }
  for (var q = o0; q < o1; q++) {
    var p = [D.pathPts[2 * q], D.pathPts[2 * q + 1]];
    if (!isFinite(p[0])) continue;
    if (last && q < o1 - 1 && roadKm(last[0], last[1], p[0], p[1]) < ROAD_STEP_KM) continue;
    last = p;
    var on = roadNear(G, p[0], p[1]), r = null;
    if (on && lastOn) {
      var straight = roadKm(lastOn.p[0], lastOn.p[1], on.p[0], on.p[1]);
      r = roadRoute(G, lastOn, on, straight * ROAD_DETOUR + ROAD_DETOUR_KM);
    }
    if (r) {
      var l0 = len;
      for (var k = 0; k < r.pts.length; k++) add(r.pts[k]);
      add(on.p);
      along += len - l0;
    } else add(on ? on.p : p);
    // The time it was there, at how far along it is.
    var t = D.pathT[q];
    if (t >= 0 && t <= dur && (!T.length || t > T[T.length - 1]) && (!A.length || len >= A[A.length - 1])) { A.push(len); T.push(t); }
    lastOn = on;
  }
  if (pts.length < 2 || !(len > 0) || 100 * along / len < ROAD_MIN) return null;
  if (!A.length || A[0] > 0) { A.unshift(0); T.unshift(0); }
  if (A[A.length - 1] < len) { A.push(len); T.push(Math.max(dur, T[T.length - 1])); }
  var ts = new Array(pts.length), m = 0, c = 0;
  for (var j = 0; j < pts.length; j++) {
    if (j) c += roadKm(pts[j - 1][0], pts[j - 1][1], pts[j][0], pts[j][1]);
    while (m < A.length - 2 && A[m + 1] < c) m++;
    var span = A[m + 1] - A[m];
    ts[j] = T[m] + (T[m + 1] - T[m]) * (span > 0 ? Math.max(0, Math.min(1, (c - A[m]) / span)) : 1);
  }
  return { pts: pts, ts: ts, km: len, road: true, cov: Math.round(100 * along / len) };
}
function roadKey(i) { return D.start[i] + ',' + D.end[i]; }
function roadCan(i) {
  return !!ROAD_MODES[MODES[D.mode[i]]] && !D.snap[i] && !isDup(i) && !(D.mrHide && D.mrHide[i]) && D.pathOff[i + 1] - D.pathOff[i] >= 2 && (D.base || D).km[i] >= 0.5;
}

// After the tracks: trips worked out already take their line; the others are worked out in the
// background, and the rules applied again when that's done.
function mrApplyRoads() {
  D.mrRoad = [];
  if (!roadOn()) { roadSettings(); return; }
  if (!RG) { if (!ROAD_WAIT) roadLoadApply(); roadSettings(); return; }
  var todo = [];
  for (var i = 0, n = D.day.length; i < n; i++) {
    if (!roadCan(i)) continue;
    var k = roadKey(i), sn = ROAD_CACHE.get(k);
    if (sn === undefined) { todo.push(i); continue; }
    if (!sn) continue;
    D.snap[i] = sn; D.km[i] = sn.km; D.mrRoad[i] = sn;
  }
  if (todo.length && !ROAD_RUN) roadRun(todo);
  roadSettings();
}
// Works out the trips in todo, ROAD_SLICE ms at a time, with the pill showing how far it is.
var ROAD_SLICE = 30;
function roadRun(todo) {
  var G = RG, d0 = D, k = 0, t0 = performance.now(), busy = 0, got = 0;
  ROAD_RUN = { n: todo.length };
  roadPill(0, todo.length);
  function slice() {
    if (D !== d0 || G !== RG || !roadOn()) { ROAD_RUN = null; roadPill(); if (D && roadOn() && RG) mrReapply(); return; }
    var s0 = performance.now();
    while (k < todo.length && performance.now() - s0 < ROAD_SLICE) {
      var i = todo[k++], key = roadKey(i);
      if (!ROAD_CACHE.has(key)) { var sn = roadTrip(G, i); ROAD_CACHE.set(key, sn); if (sn) got++; }
    }
    busy += performance.now() - s0;
    if (k < todo.length) { roadPill(k, todo.length); setTimeout(slice, 0); return; }
    ROAD_STAT = { trips: todo.length, snapped: got, ms: Math.round(busy), wall: Math.round(performance.now() - t0), build: G.ms, nodes: G.n, segs: G.segs };
    ROAD_RUN = null;
    // Applying the rules again with them takes a moment too: the pill stays, spinning, meanwhile.
    roadPill(null, null, 'Drawing car trips along the roads…');
    setTimeout(function () { try { mrReapply(); } finally { roadPill(); } }, 30);
  }
  setTimeout(slice, 0);
}
// The pill over the map, with a spinner: how far the snapping is (done of all), or a text alone;
// nothing hides it.
function roadPill(done, all, text) {
  var el = $('roadPill');
  if (done == null && !text) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'roadPill'; el.className = 'bg-pill'; el.setAttribute('role', 'status');
    el.innerHTML = '<i class="bg-spin" aria-hidden="true"></i><span></span><div class="dl-bar"><i></i></div>';
    document.body.appendChild(el);
  }
  el.hidden = false;
  el.querySelector('span').textContent = text || 'Snapping car trips to roads… ' + fmt(done) + ' of ' + fmt(all);
  el.querySelector('.dl-bar').hidden = done == null;
  if (done != null) el.querySelector('.dl-bar i').style.width = Math.round(100 * done / Math.max(1, all)) + '%';
}
// Loads the road pack with the pill up, then applies the rules again.
var ROAD_WAIT = false;
function roadLoadApply() {
  ROAD_WAIT = true;
  roadPill(null, null, 'Loading the road pack…');
  return roadsLoad().then(function (G) {
    ROAD_WAIT = false;
    if (!G || !D) { roadPill(); roadSettings(); return; }
    setTimeout(function () { try { mrReapply(); } finally { if (!ROAD_RUN) roadPill(); } }, 30);
  }, function () { ROAD_WAIT = false; roadPill(); });
}

// ---------- the switch ----------
function roadAvail() { return PACK_LIST && PACK_LIST.roads || {}; }
// The road packs to get: a country's when your trips are in it (or you have its station pack); a
// region's (CA-ON, with a bbox) when one of your car trips starts or ends in its box.
function roadWanted() {
  var have = {}, av = roadAvail(), ccs = {};
  (D ? D.ccList.filter(function (_, k) { return D.ccCount[k] > 0; }) : []).concat(packCodes()).forEach(function (cc) { ccs[cc] = 1; });
  Object.keys(av).forEach(function (key) {
    var x = av[key];
    if (!x.cc) { if (ccs[key]) have[key] = 1; return; }
    if (!ccs[x.cc] || !D || !x.bbox) return;
    var b = x.bbox;
    for (var i = 0, n = D.day.length; i < n; i++) {
      if (!ROAD_MODES[MODES[D.mode[i]]]) continue;
      for (var e = 0; e < 2; e++) {
        var la = e ? D.to[2 * i] : D.from[2 * i], lo = e ? D.to[2 * i + 1] : D.from[2 * i + 1];
        if (la >= b[0] && la <= b[2] && lo >= b[1] && lo <= b[3]) { have[key] = 1; return; }
      }
    }
  });
  return Object.keys(have).sort();
}
function roadGet(cc, onBytes) {
  var x = roadAvail()[cc];
  return packFetch('roads/' + cc + '.json.gz', x && x.bytes, onBytes).then(function (buf) {
    return gunzip(buf).then(function (raw) {
      var p = JSON.parse(new TextDecoder().decode(raw));
      if (!p || p.v !== 1 || p.cc !== cc || p.kind !== 'roads') throw new Error('Not a road pack');
      p.bytes = buf.byteLength; p.got = Date.now(); p.km = x && x.km;
      return roadStore('readwrite', function (s) { return s.put(p, cc); }).then(function () { ROAD_KEPT[cc] = roadMeta(p); return roadKeptSave(); });
    });
  });
}
function roadName(cc) { var r = roadAvail()[cc]; if (r && r.name) return r.name; if (ROADS[cc] && ROADS[cc].name) return ROADS[cc].name; if (ROAD_KEPT[cc] && ROAD_KEPT[cc].name) return ROAD_KEPT[cc].name; var x = PACK_LIST && PACK_LIST.packs[cc]; return x ? x.name : PACKS[cc] ? PACKS[cc].name : country(cc) || cc; }
function roadNames(keys) { var n = keys.map(roadName); return n.length > 1 ? n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1] : n[0] || ''; }
// Applies the rules again with the pill spinning (switching it on or off with the packs already here).
function roadReapply(text) {
  if (!D) { roadSettings(); return; }
  roadPill(null, null, text);
  setTimeout(function () { try { mrReapply(); } finally { if (!ROAD_RUN) roadPill(); } }, 60);
}
function roadTurnOn() {
  var box = $('roadSnap'), kept = Object.keys(ROAD_KEPT);
  PREFS.roadSnap = true; savePrefs();
  // Packs already on this device: on at once, offline, with the spinner; then, quietly, any pack
  // missing for where your trips are now is downloaded (with the bar).
  if (kept.length) {
    if (RG) roadReapply('Drawing car trips along the roads…'); else if (D) roadLoadApply(); else roadsLoad().then(roadSettings);
    packList().then(function () { var miss = roadWanted().filter(function (cc) { return !ROAD_KEPT[cc]; }); if (miss.length && roadOn()) roadDownload(miss); }, function () {});
    return;
  }
  box.disabled = true;
  dlShow($('roadBar'), $('roadNote'), 'Getting the list of road packs…', null);
  packList().then(function () {
    var ccs = roadWanted(), av = roadAvail();
    if (!ccs.length) {
      PREFS.roadSnap = false; savePrefs();
      box.checked = false; box.disabled = false;
      dlShow($('roadBar'), $('roadNote'), 'There is no road pack yet for the countries your trips are in.' + (Object.keys(av).length ? ' So far there are road packs for ' + roadNames(Object.keys(av).sort()) + '.' : ''), null);
      return;
    }
    return roadDownload(ccs);
  }, function () {
    PREFS.roadSnap = false; savePrefs();
    box.checked = false; box.disabled = false;
    dlShow($('roadBar'), $('roadNote'), 'The list of road packs couldn\'t be fetched. Check your connection and try again.', null);
  });
}
// Downloads the road packs in ccs one after the other, with the bar, then loads them all.
function roadDownload(ccs) {
  var box = $('roadSnap'), av = roadAvail(), all = ccs.reduce(function (a, cc) { return a + (av[cc].bytes || 0); }, 0), before = 0, failed = [];
  box.disabled = true;
  return ccs.reduce(function (p, cc) {
    return p.then(function () {
      return roadGet(cc, function (l, t) {
        var tot = all || t, done = before + l;
        dlShow($('roadBar'), $('roadNote'), dlText('the ' + roadName(cc) + ' road pack', all ? done : l, all ? Math.max(all, done) : t), tot ? Math.min(1, done / tot) : null);
      }).catch(function () { failed.push(cc); }).then(function () { before += av[cc].bytes || 0; });
    });
  }, Promise.resolve()).then(function () {
    dlShow($('roadBar'), $('roadNote'), '', null);
    box.disabled = false;
    if (!Object.keys(ROAD_KEPT).length) {
      PREFS.roadSnap = false; savePrefs(); box.checked = false;
      $('roadNote').textContent = 'The road pack couldn\'t be downloaded. Check your connection and try again.';
      return;
    }
    if (failed.length < ccs.length) { RG = null; ROAD_CACHE = new Map(); }
    if (!roadOn()) { roadSettings(); return; }
    if (D) roadLoadApply(); else roadsLoad().then(roadSettings);
  });
}
// Off: the trips go back to their own paths. The packs stay on this device and the graph and the
// trips worked out stay in memory, so on again is quick.
function roadTurnOff() {
  PREFS.roadSnap = false; savePrefs();
  roadReapply('Taking car trips off the roads…');
}
function roadRemove() {
  PREFS.roadSnap = false; savePrefs();
  RG = null; ROADS = {}; ROAD_KEPT = {}; ROAD_CACHE = new Map(); roadPill();
  roadStore('readwrite', function (s) { return s.clear(); }).catch(function () {}).then(function () { if (D) mrReapply(); else roadSettings(); });
}
function roadSettings() {
  var el = $('roadSnap');
  if (!el) return;
  if (!el.disabled) el.checked = roadOn();
  if ($('roadBar') && !$('roadBar').hidden) return;
  var n = 0;
  if (D && D.mrRoad) D.mrRoad.forEach(function (x) { if (x) n++; });
  var cc = Object.keys(ROAD_KEPT).sort(), size = cc.reduce(function (a, c) { return a + (ROAD_KEPT[c].bytes || 0); }, 0);
  if ($('roadDel')) $('roadDel').hidden = !cc.length;
  $('roadNote').textContent = !roadOn() ? (cc.length ? 'Road pack' + (cc.length > 1 ? 's' : '') + ' of ' + roadNames(cc) + ', ' + packSize(size) + ', kept on this device for when you turn it on again.' : '') : !RG ? (ROAD_LOADING ? 'Loading the road pack…' : '') :
    (cc.length ? 'Road pack' + (cc.length > 1 ? 's' : '') + ' of ' + roadNames(cc) + ', ' + packSize(size) + ' on this device. ' : '') +
    (ROAD_RUN ? 'Snapping your car trips…' : D ? tripsText(n) + ' drawn along the roads.' : '');
}
$('roadSnap').addEventListener('change', function () { if (this.checked) roadTurnOn(); else roadTurnOff(); });
$('roadDel').addEventListener('click', roadRemove);
roadKeptLoad();
if (roadOn()) roadsLoad().then(function () { roadSettings(); });
