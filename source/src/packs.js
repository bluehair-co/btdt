// ---------- station packs ----------
// A country's railway stations, tram and metro stops and its railway, tram and metro lines,
// simplified, built from OpenStreetMap by .github/workflows/station-packs.yml every three months
// and published on the repository's packs branch (source/packs/ has the format). A pack is only
// downloaded when you choose its country, which tells GitHub that country and nothing about your
// trips, and is kept in this browser (IndexedDB "btdt-packs") so it works offline. Packs place and
// name the stops where Timeline merged two trips (splitTrips), type their legs from the lines they
// follow, and draw a routine's line along the railway without asking OpenStreetMap (packLines).
var PACK_BASE = 'https://raw.githubusercontent.com/bluehair-co/btdt/packs/';
var PACKS = {};        // installed packs, by country code
var PK = null;         // the installed packs, ready to look things up in (packIndex)
var PACK_LIST = null;  // index.json from the packs branch, once fetched this visit
var PACK_KINDS = { 1: 'railway', 2: 'tram', 4: 'metro', 8: 'light rail' };

function packStore(mode, fn) { return withStore('btdt-packs', mode, fn); }
function packsLoad() {
  return packStore('readonly', function (s) { return s.getAll(); }).then(function (all) {
    PACKS = {};
    (all || []).forEach(function (p) { if (p && p.v === 1 && p.cc) PACKS[p.cc] = p; });
    PK = null;
  }).catch(function () { /* no packs */ });
}
function packCodes() { return Object.keys(PACKS).sort(); }
function packList() {
  if (PACK_LIST) return Promise.resolve(PACK_LIST);
  return fetch(PACK_BASE + 'index.json', { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function (j) { PACK_LIST = j && j.packs ? j : { packs: {} }; return PACK_LIST; });
}
function packGet(cc) {
  return fetch(PACK_BASE + cc + '.json.gz', { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.arrayBuffer();
  }).then(function (buf) {
    return gunzip(buf).then(function (raw) {
      var p = JSON.parse(new TextDecoder().decode(raw));
      if (!p || p.v !== 1 || p.cc !== cc) throw new Error('Not a station pack');
      p.bytes = buf.byteLength; p.got = Date.now();
      return packStore('readwrite', function (s) { return s.put(p, cc); }).then(function () { PACKS[cc] = p; PK = null; return p; });
    });
  });
}
function packRemove(cc) {
  return packStore('readwrite', function (s) { return s.delete(cc); }).then(function () { delete PACKS[cc]; PK = null; });
}
// Downloads the packs in ccs one after the other, then splits the trips again with them.
function packDownload(ccs, note) {
  var got = [], failed = [];
  return ccs.reduce(function (p, cc) {
    return p.then(function () {
      if (note) note('Downloading ' + packName(cc) + '…');
      return packGet(cc).then(function () { got.push(cc); }, function () { failed.push(cc); });
    });
  }, Promise.resolve()).then(function () {
    if (got.length) packsChanged();
    return { got: got, failed: failed };
  });
}
function packName(cc) { var x = PACK_LIST && PACK_LIST.packs[cc]; return PACKS[cc] ? PACKS[cc].name : x ? x.name : country(cc) || cc; }
function packSize(b) { return b >= 1e6 ? fmt(b / 1e6, 1) + ' MB' : fmt(Math.max(1, Math.round(b / 1e3))) + ' kB'; }

// The installed packs decoded: stations in a grid of 0.01° cells, the cells (about 150 m, as in
// retypeGuessed) each kind of line runs through, and each pack's nodes and lines for routing.
function packIndex() {
  if (PK) return PK;
  var st = { lat: [], lng: [], k: [], name: [], cc: [] }, grid = new Map(), rail = new Map(), graphs = [];
  packCodes().forEach(function (cc) {
    var p = PACKS[cc], s = p.stations || [], la = 0, lo = 0, j;
    for (j = 0; j + 3 < s.length; j += 4) {
      la += s[j]; lo += s[j + 1];
      var x = st.lat.length, key = Math.floor(la / 1000) * 100000 + Math.floor(lo / 1000);
      st.lat.push(la / 1e5); st.lng.push(lo / 1e5); st.k.push(s[j + 2]); st.name.push(s[j + 3]); st.cc.push(cc);
      (grid.get(key) || grid.set(key, []).get(key)).push(x);
    }
    var nd = p.nodes || [], N = new Float64Array(nd.length);
    la = 0; lo = 0;
    for (j = 0; j + 1 < nd.length; j += 2) { la += nd[j]; lo += nd[j + 1]; N[j] = la / 1e5; N[j + 1] = lo / 1e5; }
    var lines = (p.lines || []).map(function (L) {
      var idx = [], v = 0;
      for (var q = 1; q < L.length; q++) { v += L[q]; idx.push(v); }
      var pts = idx.map(function (k) { return [N[2 * k], N[2 * k + 1]]; }), bit = L[0];
      densify(pts, 0.1, function (a, b, cs) { var c = cellKey(cellY(a), cellX(b, cs)); rail.set(c, (rail.get(c) || 0) | bit); });
      return { kind: bit, idx: idx };
    });
    graphs.push({ cc: cc, N: N, lines: lines, adj: {} });
  });
  PK = { st: st, grid: grid, rail: rail, graphs: graphs };
  return PK;
}
// The nearest station or stop of the kinds in bits within maxKm, or null.
function packStation(lat, lng, maxKm, bits) {
  var P = packIndex(), S = P.st, best = null;
  if (!S.lat.length) return null;
  var y0 = Math.floor(lat * 100), x0 = Math.floor(lng * 100), ry = Math.ceil(maxKm / 1.1), rx = Math.ceil(maxKm / (1.1 * Math.max(0.2, Math.cos(lat * Math.PI / 180))));
  for (var dy = -ry; dy <= ry; dy++) for (var dx = -rx; dx <= rx; dx++) {
    var c = P.grid.get((y0 + dy) * 100000 + x0 + dx);
    if (!c) continue;
    for (var q = 0; q < c.length; q++) {
      var x = c[q];
      if (!(S.k[x] & bits)) continue;
      var d = km([lat, lng], [S.lat[x], S.lng[x]]);
      if (d <= maxKm && (!best || d < best.d)) best = { lat: S.lat[x], lng: S.lng[x], name: S.name[x], k: S.k[x], cc: S.cc[x], d: d };
    }
  }
  return best;
}
// The kinds of line (bits) within about 150 to 300 m of a point.
function packRailBits(lat, lng) {
  var P = packIndex(), y = cellY(lat), x = cellX(lng, Math.max(0.2, Math.cos(lat * Math.PI / 180))), c = 0;
  for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) c |= P.rail.get(cellKey(y + dy, x + dx)) || 0;
  return c;
}
function packNear() {
  if (!packCodes().length) return null;
  packIndex();
  return { station: packStation, rail: function (lat, lng, bits) { return !!(packRailBits(lat, lng) & bits); } };
}
// The packs' word for where a stop was: "Amsterdam Centraal".
function packStopName(s) { return s && s.name ? s.name : s ? 'a ' + (PACK_KINDS[s.k & 1 ? 1 : s.k & 4 ? 4 : s.k & 8 ? 8 : 2] === 'railway' ? 'railway station' : PACK_KINDS[s.k & 4 ? 4 : s.k & 8 ? 8 : 2] + ' stop') : ''; }

// ---------- a routine's line along the railway ----------
// The kinds of line each type of routine can follow.
var PACK_MODE_BITS = { TRAIN: 1 | 8, TRAM: 2 | 8, SUBWAY: 4 | 8 };
// The ways along a pack's lines of the routine's type between the points nearest its two ends (each
// within 2 km), like Use the line from OpenStreetMap but without going online: the shortest, then
// up to three other ways (PACK_ALT) when the network has them, as for Amsterdam – Den Haag through
// Schiphol or through Haarlem. Each other way is found by making the ~150 m cells of the ways found
// so far 4 times as long to cross (so both tracks of a double line) and searching again; it is kept
// when at most 60% of it runs through cells of one found before and it is at most 1.6 times as long
// as the shortest. Each is named after a junction station only it
// passes ("via Haarlem and Leiden Centraal"): up to two, junctions first. Resolves to [] when no installed pack covers both ends.
function packNames(ccs) { var n = ccs.map(packName); return n.length > 1 ? n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1] : n[0] || ''; }
var PACK_GAP_KM = 0.05, PACK_ALT = { n: 4, tries: 8, penalty: 4, shared: 0.6, longer: 1.6 };
function packLines(mode, a, b) {
  var bits = PACK_MODE_BITS[mode];
  if (!bits || !packCodes().length) return [];
  var out = [];
  packIndex().graphs.forEach(function (g) {
    var adj = g.adj[bits];
    if (!adj) {
      adj = g.adj[bits] = new Map();
      g.lines.forEach(function (L) {
        if (!(L.kind & bits)) return;
        for (var q = 1; q < L.idx.length; q++) {
          var u = L.idx[q - 1], v = L.idx[q], w = km([g.N[2 * u], g.N[2 * u + 1]], [g.N[2 * v], g.N[2 * v + 1]]);
          (adj.get(u) || adj.set(u, []).get(u)).push(v, w);
          (adj.get(v) || adj.set(v, []).get(v)).push(u, w);
        }
      });
      // OpenStreetMap often joins a line to the next only through a crossover or siding, which
      // packs leave out: each dead end is joined to the nearest other track within 50 m, at the
      // nearest point of it (simplified tracks can have their points far apart), as edges to both
      // ends of that stretch.
      var cells = new Map(), segs = [];
      function cellOf(la, lo) { return Math.floor(la * 500) * 1e6 + Math.floor(lo * 300); }
      adj.forEach(function (e, u) {
        for (var q = 0; q < e.length; q += 2) {
          var v = e[q];
          if (v < u) continue;
          var s = segs.length, n = Math.max(1, Math.ceil(e[q + 1] / 0.1)), seen = {};
          segs.push(u, v, e[q + 1]);
          for (var j = 0; j <= n; j++) {
            var c = cellOf(g.N[2 * u] + (g.N[2 * v] - g.N[2 * u]) * j / n, g.N[2 * u + 1] + (g.N[2 * v + 1] - g.N[2 * u + 1]) * j / n);
            if (!seen[c]) { seen[c] = 1; (cells.get(c) || cells.set(c, []).get(c)).push(s); }
          }
        }
      });
      var links = [];
      adj.forEach(function (e, u) {
        // A dead end: one track out of it (a line drawn twice counts once).
        for (var q = 2; q < e.length; q += 2) if (e[q] !== e[0]) return;
        var la = g.N[2 * u], lo = g.N[2 * u + 1], c0 = cellOf(la, lo), best = null, bd = PACK_GAP_KM, cs = Math.cos(la * Math.PI / 180), done = {};
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) (cells.get(c0 + dy * 1e6 + dx) || []).forEach(function (s) {
          if (done[s]) return;
          done[s] = 1;
          var p = segs[s], r = segs[s + 1];
          if (p === u || r === u || p === e[0] || r === e[0]) return;
          // The nearest point of the stretch p–r, in km on a flat map.
          var ax = (g.N[2 * p + 1] - lo) * 111.32 * cs, ay = (g.N[2 * p] - la) * 110.57, bx = (g.N[2 * r + 1] - lo) * 111.32 * cs, by = (g.N[2 * r] - la) * 110.57;
          var ex = bx - ax, ey = by - ay, L = ex * ex + ey * ey, f = L ? Math.max(0, Math.min(1, -(ax * ex + ay * ey) / L)) : 0;
          var d = Math.hypot(ax + f * ex, ay + f * ey);
          if (d < bd) { bd = d; best = [p, r, f * segs[s + 2], (1 - f) * segs[s + 2]]; }
        });
        if (best) links.push([u, bd, best]);
      });
      links.forEach(function (l) {
        var u = l[0], d = l[1], b = l[2];
        adj.get(u).push(b[0], d + b[2], b[1], d + b[3]);
        adj.get(b[0]).push(u, d + b[2]); adj.get(b[1]).push(u, d + b[3]);
      });
    }
    // The track points near an end: all within 400 m, or 150 m further than the nearest (up to 1 km),
    // each with how far off it is (up to 2 km). A station where lines from two sides end on their own platforms
    // (a terminus like Den Haag Centraal) is reached from either side.
    // Track points in cells of 0.02° (about 2 km), to find those near an end without going through them all.
    var ng = g.ng && g.ng[bits];
    if (!ng) {
      ng = (g.ng || (g.ng = {}))[bits] = new Map();
      adj.forEach(function (_, u) { var c = Math.floor(g.N[2 * u] * 50) * 1e5 + Math.floor(g.N[2 * u + 1] * 50); (ng.get(c) || ng.set(c, []).get(c)).push(u); });
    }
    function ends(p) {
      var all = [], bd = 2, y = Math.floor(p[0] * 50), x = Math.floor(p[1] * 50), rx = Math.ceil(1 / Math.max(0.2, Math.cos(p[0] * Math.PI / 180)));
      for (var dy = -1; dy <= 1; dy++) for (var dx = -rx; dx <= rx; dx++) (ng.get((y + dy) * 1e5 + x + dx) || []).forEach(function (u) {
        var d = km(p, [g.N[2 * u], g.N[2 * u + 1]]);
        if (d <= 2) { all.push([u, d]); if (d < bd) bd = d; }
      });
      var r = Math.min(2, Math.max(0.4, bd + 0.15)), m = new Map();
      all.forEach(function (x) { if (x[1] <= r) m.set(x[0], x[1]); });
      return m.size ? { m: m, d: bd } : null;
    }
    var A = ends(a), B = ends(b);
    if (!A || !B) return;
    // The ~150 m cells a stretch or a way runs through: the other track of a double line is in the
    // same cells, so it counts as the same way.
    function midCell(u, v) { var la = (g.N[2 * u] + g.N[2 * v]) / 2; return cellKey(cellY(la), cellX((g.N[2 * u + 1] + g.N[2 * v + 1]) / 2, Math.max(0.2, Math.cos(la * Math.PI / 180)))); }
    function wayCells(w) {
      var s = [], set = new Set();
      densify(w.nodes.map(function (u) { return [g.N[2 * u], g.N[2 * u + 1]]; }), 0.05, function (la, lo, cs) { var c = cellKey(cellY(la), cellX(lo, cs)); s.push(c); set.add(c); });
      w.samples = s; w.cells = set;
    }
    // Dijkstra with a binary heap of [distance, node] from all the start's points (off the track
    // counting double), each edge's length times its penalty, to the nearest of the end's points.
    function shortest(pen) {
      var dist = new Map(), prev = new Map(), heap = [], goal = -1, gd = Infinity;
      function push(x) { heap.push(x); var k = heap.length - 1; while (k > 0) { var p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; var t = heap[p]; heap[p] = heap[k]; heap[k] = t; k = p; } }
      function pop() { var top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; var k = 0; for (;;) { var l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; var t = heap[m]; heap[m] = heap[k]; heap[k] = t; k = m; } } return top; }
      A.m.forEach(function (d0, u) { dist.set(u, 2 * d0); push([2 * d0, u]); });
      while (heap.length) {
        var h = pop(), d = h[0], u = h[1];
        if (d > dist.get(u)) continue;
        if (d >= gd) break;
        if (B.m.has(u) && d + 2 * B.m.get(u) < gd) { gd = d + 2 * B.m.get(u); goal = u; }
        var e = adj.get(u) || [];
        for (var q = 0; q < e.length; q += 2) {
          var v = e[q], nd = d + e[q + 1] * (pen.size ? pen.get(midCell(u, v)) || 1 : 1);
          if (!dist.has(v) || nd < dist.get(v)) { dist.set(v, nd); prev.set(v, u); push([nd, v]); }
        }
      }
      if (goal < 0) return null;
      var nodes = [], u2 = goal;
      while (u2 !== undefined) { nodes.push(u2); u2 = prev.get(u2); }
      nodes.reverse();
      if (nodes.length < 2) return null;
      var len = 0;
      for (var k = 1; k < nodes.length; k++) len += km([g.N[2 * nodes[k - 1]], g.N[2 * nodes[k - 1] + 1]], [g.N[2 * nodes[k]], g.N[2 * nodes[k] + 1]]);
      var w = { nodes: nodes, km: len };
      wayCells(w);
      return w;
    }
    var pen = new Map(), ways = [], first = shortest(pen);
    if (!first) return;
    ways.push(first);
    for (var tr = 0; tr < PACK_ALT.tries && ways.length < PACK_ALT.n; tr++) {
      ways[ways.length - 1].cells.forEach(function (c) { pen.set(c, (pen.get(c) || 1) * PACK_ALT.penalty); });
      var w2 = shortest(pen);
      if (!w2 || w2.km > first.km * PACK_ALT.longer) break;
      var fresh = ways.every(function (w) {
        var sh = 0;
        w2.samples.forEach(function (c) { if (w.cells.has(c)) sh++; });
        return sh <= PACK_ALT.shared * w2.samples.length;
      });
      if (fresh) ways.push(w2);
    }
    // The stations each way passes, in order, and which of them are junctions (3 or more ways out
    // of a node within 500 m), to name the ways after.
    var kind = mode === 'TRAIN' ? 1 : mode === 'TRAM' ? 2 | 8 : 4 | 8;
    ways.forEach(function (w) {
      var seen = {}, list = [], pts = w.nodes.map(function (u) { return [g.N[2 * u], g.N[2 * u + 1]]; }), k = 0;
      densify(pts, 0.05, function (la, lo) {
        k++;
        var s = packStation(la, lo, kind === 1 ? 0.3 : 0.15, kind);
        // Not the stations at the two ends.
        if (!s || !s.name || seen[s.name] || km([s.lat, s.lng], a) < 1 || km([s.lat, s.lng], b) < 1) return;
        seen[s.name] = 1;
        var jn = w.nodes.some(function (x) {
          var e = adj.get(x) || [], nb = {};
          for (var q = 0; q < e.length; q += 2) nb[e[q]] = 1;
          return Object.keys(nb).length >= 3 && km([s.lat, s.lng], [g.N[2 * x], g.N[2 * x + 1]]) <= 0.5;
        });
        list.push({ name: s.name, jn: jn, k: k });
      });
      w.stations = list; w.names = seen; w.nk = k;
    });
    var label = 'Along the ' + (mode === 'TRAIN' ? 'railway' : mode === 'TRAM' ? 'tram lines' : 'metro lines');
    ways.forEach(function (w, n) {
      var via = '';
      if (ways.length > 1) {
        // Stations on this way only, junctions first, nearest the middle of the way next.
        var own = w.stations.filter(function (s) { return ways.every(function (o) { return o === w || !o.names[s.name]; }); });
        own.sort(function (x, y) { return (y.jn - x.jn) || Math.abs(x.k - w.nk / 2) - Math.abs(y.k - w.nk / 2); });
        var two = own.slice(0, 2).sort(function (x, y) { return x.k - y.k; });
        via = two.length ? 'via ' + two.map(function (s) { return s.name; }).join(' and ') : n ? 'other way ' + n : 'shortest';
      }
      var pts = w.nodes.map(function (u) { return [g.N[2 * u], g.N[2 * u + 1]]; });
      var ccs = [g.cc];
      out.push({ id: 'pack:' + ccs.join('+') + (n ? ':' + n : ''), name: via ? label + ' ' + via : label + ' (' + packNames(ccs) + ' station pack' + (ccs.length > 1 ? 's' : '') + ')', pts: pts, km: w.km, off: A.d + B.d, polyline: mrEncodePolyline(pts), pack: ccs[0], packs: ccs, n: n });
    });
  });
  // The pack nearest the two ends, its ways shortest first.
  if (!out.length) return out;
  var best = out.slice().sort(function (x, y) { return x.off - y.off || x.n - y.n; })[0].pack;
  return out.filter(function (x) { return x.pack === best; });
}

// ---------- after a change of packs ----------
// The trips are split again with the packs there are now, keeping the filters and period.
function packsChanged() {
  PK = null;
  refreshData();
  renderPacks();
}
// setData again from what was loaded, keeping the filters (new types, sports and gear switched on).
function refreshData() {
  if (!RAW) return;
  var oldF = F, oldM = M, oldCC = D && D.ccList;
  // Trips are numbered again: an open trip's details would point at another trip.
  if (openId === 'tripSheet') closeSheets(true);
  setData(RAW);
  if (!oldF || !oldM) return;
  ['dm', 'one', 'unit', 'from', 'to', 'h0', 'h1', 'guess', 'src', 'years', 'months', 'dows'].forEach(function (k) { F[k] = oldF[k]; });
  F.modes = new Set(M.modes.filter(function (m) { return oldF.modes.has(m) || oldM.modes.indexOf(m) < 0; }));
  F.sports = new Set(M.sports.filter(function (s) { return oldF.sports.has(s) || oldM.sports.indexOf(s) < 0; }));
  if (oldCC && oldF.countries.size !== oldM.countries.length) {
    var codes = {};
    oldF.countries.forEach(function (k) { codes[oldCC[k]] = 1; });
    F.countries = new Set(M.countries.filter(function (k) { return codes[D.ccList[k]]; }));
    if (!F.countries.size) F.countries = new Set(M.countries);
  }
  if (F.guess === 'check' && !M.nCheck) F.guess = 'all';
  syncFilterUI();
  apply();
}

// ---------- Settings: station packs ----------
function renderPacks() {
  var box = $('packList');
  if (!box) return;
  var ccs = packCodes();
  box.innerHTML = ccs.map(function (cc) {
    var p = PACKS[cc], x = PACK_LIST && PACK_LIST.packs[cc], newer = x && x.built && p.built && x.built > p.built;
    return '<li><span class="file-txt"><b>' + flag(cc) + ' ' + esc(p.name || cc) + '</b><small>' + packSize(p.bytes || 0) + ' · ' + fmt((p.stations || []).length / 4) + ' stations and stops · OpenStreetMap data of ' + esc(p.built || '?') + '</small></span>' +
      '<span class="pack-acts">' + (newer ? '<button type="button" class="link-btn" data-pack-act="update" data-cc="' + cc + '">Update</button>' : '') + '<button type="button" class="link-btn" data-pack-act="remove" data-cc="' + cc + '">Remove</button></span></li>';
  }).join('');
  box.hidden = !ccs.length;
  trackSettings();
  $('packNote').textContent = ccs.length ? 'Kept on this device, so they work offline.' : 'None yet. A pack places and names the stations where Timeline merged two trips, tells a train from a tram, and draws a routine\'s line along the railway without going online.';
}
function packOptions(sel, have) {
  return packList().then(function (L) {
    var rows = Object.keys(L.packs).filter(function (cc) { return !have[cc]; }).sort(function (a, b) { return String(L.packs[a].name).localeCompare(L.packs[b].name); });
    sel.innerHTML = '<option value="">Choose a country…</option>' + rows.map(function (cc) { return '<option value="' + cc + '">' + esc(L.packs[cc].name) + ' (' + packSize(L.packs[cc].bytes) + ')</option>'; }).join('');
    return rows.length;
  });
}
$('packAdd').addEventListener('click', function () {
  var sel = $('packSel'), btn = this, have = {};
  packCodes().forEach(function (cc) { have[cc] = 1; });
  btn.disabled = true; $('packMsg').textContent = 'Getting the list of countries…';
  packOptions(sel, have).then(function (n) {
    btn.disabled = false;
    $('packMsg').textContent = n ? '' : 'You have every pack there is.';
    sel.hidden = !n;
    if (n) sel.focus();
    renderPacks();
  }, function () { btn.disabled = false; $('packMsg').textContent = 'The list of packs couldn\'t be fetched. Check your connection and try again.'; });
});
$('packSel').addEventListener('change', function () {
  var cc = this.value, sel = this;
  if (!cc) return;
  sel.disabled = true;
  packDownload([cc], function (t) { $('packMsg').textContent = t; }).then(function (r) {
    sel.disabled = false; sel.hidden = true; sel.value = '';
    $('packMsg').textContent = r.got.length ? packName(cc) + ' is ready.' : packName(cc) + ' couldn\'t be downloaded. Check your connection and try again.';
  });
});
$('packList').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-pack-act]');
  if (!b) return;
  var cc = b.dataset.cc;
  if (b.dataset.packAct === 'remove') packRemove(cc).then(function () { $('packMsg').textContent = packName(cc) + ' removed.'; packsChanged(); });
  else packDownload([cc], function (t) { $('packMsg').textContent = t; }).then(function (r) { $('packMsg').textContent = r.got.length ? packName(cc) + ' is up to date.' : 'The update couldn\'t be downloaded.'; });
});

// ---------- offered after an import ----------
// The countries your trips are in that have a pack you don't have yet, most trips first, ticked
// when they hold a twentieth of your trips or more. Each country is offered once.
function packOffer() {
  if (!D || DEMO || !navigator.onLine) return;
  var asked = PREFS.packAsked || [], count = {}, tot = 0;
  for (var i = 0; i < D.day.length; i++) {
    if (isDup(i) || MODES[D.mode[i]] === 'FLYING') continue;
    var a = D.ccList[D.cs[i]], b = D.ccList[D.ce[i]];
    if (a) count[a] = (count[a] || 0) + 1;
    if (b && b !== a) count[b] = (count[b] || 0) + 1;
    tot++;
  }
  packList().then(function (L) {
    var ccs = Object.keys(count).filter(function (cc) { return L.packs[cc] && !PACKS[cc] && asked.indexOf(cc) < 0 && count[cc] >= 3; })
      .sort(function (a, b) { return count[b] - count[a]; }).slice(0, 12);
    if (!ccs.length) return;
    $('packOfferList').innerHTML = ccs.map(function (cc) {
      var on = count[cc] >= tot / 20;
      return '<label class="toggle-row"><span class="lbl">' + flag(cc) + ' ' + esc(L.packs[cc].name) + ' <span class="fine">' + tripsText(count[cc]) + ' · ' + packSize(L.packs[cc].bytes) + '</span></span><input type="checkbox" class="switch" value="' + cc + '"' + (on ? ' checked' : '') + '></label>';
    }).join('');
    $('packOfferMsg').textContent = '';
    var dlg = $('packDlg');
    dlg.dataset.ccs = ccs.join(',');
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }).catch(function () { /* offline: offered next time */ });
}
function packOfferClose() {
  var dlg = $('packDlg');
  PREFS.packAsked = (PREFS.packAsked || []).concat((dlg.dataset.ccs || '').split(',').filter(Boolean));
  savePrefs();
  if (dlg.close) dlg.close(); else dlg.removeAttribute('open');
}
$('packOfferNo').addEventListener('click', packOfferClose);
$('packDlg').querySelector('.about-close').addEventListener('click', packOfferClose);
$('packOfferYes').addEventListener('click', function () {
  var ccs = Array.prototype.filter.call($('packOfferList').querySelectorAll('input:checked'), function () { return true; }).map(function (x) { return x.value; });
  if (!ccs.length) { packOfferClose(); return; }
  var btn = this;
  btn.disabled = true;
  packDownload(ccs, function (t) { $('packOfferMsg').textContent = t; }).then(function (r) {
    btn.disabled = false;
    packOfferClose();
    toast(r.failed.length ? 'Downloaded ' + r.got.length + ' of ' + ccs.length + ' station packs. Try the others from Settings.' : ccs.length === 1 ? 'Station pack ready' : ccs.length + ' station packs ready');
  });
});

// ---------- naming the stops and airports in Regular places ----------
// A spot you pass through can be named from what is there, as if you had given it a name and kind:
// - An airport (from the airports built into the app, so no pack is needed) when the middle of its
//   stays is within 2 km of a big airport's point, 1.5 km of a medium one or 1 km of a small one,
//   and stays there last 6 hours or less on average: an Airport, "Amsterdam Airport (AMS)".
// - Else, with a station pack, a station when stays last 30 minutes or less on average and it is
//   within 200 m of a railway station (their point can sit far from the platforms) or 80 m of a
//   tram, metro or light rail stop: a Transport stop with the station's name.
// It takes that name when Takeout gave none, its icon (plane, train, tram or metro) in teal on pins,
// lists and its page, and counts as that kind in Time by kind of place. A MyRules rule, Home and Near
// home always win. Worked out once per spot for the data shown, from all its stays.
var STOP_TRAIN_KM = 0.2, STOP_TRAM_KM = 0.08, STOP_MAX_MS = 30 * 6e4, AIRPORT_MAX_MS = 6 * 36e5;
var AIRPORT_KM = { 0.6: 1, 0.8: 1.5, 1: 2 };
function airportAt(lat, lng) {
  if (!AP) buildAirports();
  var best = null, bd = Infinity, la = Math.floor(lat), lo = Math.floor(lng);
  for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
    var cell = AP.grid[(la + dy) + ',' + (((lo + dx + 180) % 360 + 360) % 360 - 180)];
    if (!cell) continue;
    for (var k = 0; k < cell.length; k++) {
      var a = cell[k], d = km([lat, lng], [a.lat, a.lng]);
      if (d <= AIRPORT_KM[a.w] && d < bd) { bd = d; best = a; }
    }
  }
  return best && { name: best.city.replace(/\s*\(.*$/, '').replace(/,.*$/, '') + ' Airport (' + best.code + ')', role: 'airport', ic: 'FLYING', kind: 'Airport', d: bd, airport: true };
}
function spotStopKey(key) {
  if (!D || !D.vs || !D.vs.length) return null;
  spotKey(0);
  if (!D.stopBy || D.stopFor !== D.skey) {
    // Stays, time and centre per spot, over all the data shown.
    var by = {};
    for (var v = 0; v < D.vs.length; v++) if (D.pv[v] >= 0) {
      var k = D.skey[v], o = by[k] || (by[k] = { n: 0, ms: 0, la: 0, lo: 0, out: D.pv[v] === D.home });
      o.n++; o.ms += D.ve[v] - D.vs[v]; o.la += D.vll[2 * v]; o.lo += D.vll[2 * v + 1];
    }
    D.stopBy = by; D.stopFor = D.skey; D.stopOf = {};
  }
  if (key in D.stopOf) return D.stopOf[key];
  var t = D.stopBy[key], st = null;
  // Not home, nor near it, nor a place you named.
  if (t && !t.out && key !== homeSpot() && key.slice(0, 3) !== 'mr:') {
    var la = t.la / t.n, lo = t.lo / t.n, avg = t.ms / t.n;
    if (avg <= AIRPORT_MAX_MS) st = airportAt(la, lo);
    if (!st && avg <= STOP_MAX_MS && packCodes().length) {
      st = packStation(la, lo, STOP_TRAIN_KM, 1) || packStation(la, lo, STOP_TRAM_KM, 2 | 4 | 8);
      if (st && st.name) {
        st.role = 'transit';
        st.ic = st.k & 1 ? 'TRAIN' : st.k & 4 ? 'SUBWAY' : 'TRAM';
        st.kind = st.k & 1 ? 'Railway station' : st.k & 4 ? 'Metro station' : st.k & 8 ? 'Light rail stop' : 'Tram stop';
      } else st = null;
    }
  }
  return (D.stopOf[key] = st);
}
// The stop or airport a spot is, when no MyRules rule names it.
function spotStop(s) { return !s || s.home || s.nearHome || mrRuleOf(s) ? null : spotStopKey(s.key); }
// How many spots are stops or airports, for Time by kind of place.
function stopSpots() {
  if (!D || !D.vs || !D.vs.length) return 0;
  spotStopKey('');
  var n = 0;
  for (var k in D.stopBy) if (spotStopKey(k)) n++;
  return n;
}
