// ---------- selecting trips on the map, to change their type at once ----------
// Select trips (Views and layers, or the button under the zoom buttons): you draw an area on the map,
// a free shape (lasso) or a rectangle, and every trip the map shows (so, the filters) that passes
// through it is picked. Drawing again adds more; a tap on a trip, or its box in the list, drops it or
// adds it. Change type… and Set gear… save one correction listing them all (a bulk edit, MyRules
// "corrections" with trip: { trips: [{ start, mode }, …] }); each trip's details can detach it.
// ⋯ › Export trips downloads the picked trips, as JSON or CSV (the same files as Menu › Your data).
var SEL = null, SEL_TAP_PX = 6;
function selStart() {
  if (!D) { toast('Load your Timeline file first'); return; }
  closeSheets(true);
  if (PREFS.proj !== 'merc') setProj('merc');
  setTab('map');
  if (!initMap()) return;
  if (typeof snapEnd === 'function') snapEnd();
  if (typeof splitHandEnd === 'function') splitHandEnd();
  if (typeof ignEnd === 'function') ignEnd();
  selEnd();
  if (!map.getPane('mrg')) { map.createPane('mrg'); map.getPane('mrg').style.zIndex = 460; }
  SEL = { shape: PREFS.selShape === 'rect' ? 'rect' : 'lasso', picked: [], on: new Set(), list: false };
  SEL.r = L.canvas({ pane: 'mrg', padding: 0.5 });
  SEL.dim = L.rectangle([[-89, -720], [89, 720]], { pane: 'mrg', renderer: SEL.r, stroke: false, fillColor: cssVar('--bg') || '#f7f2ee', fillOpacity: .5, interactive: false }).addTo(map);
  SEL.layer = L.layerGroup().addTo(map);
  SEL.draw = L.layerGroup().addTo(map);
  map.dragging.disable(); map.boxZoom.disable(); map.doubleClickZoom.disable();
  map.getContainer().classList.add('sel-on');
  document.body.classList.add('sel-mode');
  selBars();
  selRender();
}
function selBars() {
  var top = $('selTop');
  if (!top) {
    top = promptBar('selTop', { mode: true, icon: 'select', title: 'Select trips',
      extra: '<div class="seg" role="group" aria-label="Shape"><button type="button" data-shape="lasso">Lasso</button><button type="button" data-shape="rect">Rectangle</button></div>',
      acts: [['Cancel', 'quiet', 'cancel']],
      on: function (a, b) {
        if (!b || !SEL) return;
        if (b.dataset.shape) { SEL.shape = PREFS.selShape = b.dataset.shape; savePrefs(); selRender(); }
        else if (a === 'cancel') selEnd();
      } });
    var bot = document.createElement('div');
    bot.id = 'selBot'; bot.className = 'sel-bar';
    bot.innerHTML = '<div class="sel-list" id="selList" hidden></div><div class="sel-row"><button type="button" class="sel-sum" id="selSum" aria-expanded="false" aria-controls="selList"></button>' +
      '<button type="button" class="btn quiet" data-a="clear">Clear</button>' +
      moreMenu([moreItem('data-a="json"', 'download', 'Export trips (JSON)'), moreItem('data-a="csv"', 'download', 'Export trips (CSV)')], 'More for these trips', null, 'up') +
      '<button type="button" class="btn" data-a="gear">Set gear…</button><button type="button" class="btn primary" data-a="type">Change type…</button></div>';
    bot.addEventListener('click', function (ev) {
      if (!SEL) return;
      var b = ev.target.closest('button');
      if (b && b.id === 'selSum') { SEL.list = !SEL.list; selRender(); return; }
      if (b && b.dataset.a === 'clear') { SEL.picked = []; SEL.on.clear(); selRender(); return; }
      if (b && b.dataset.a === 'type') { selTypeDialog(); return; }
      if (b && b.dataset.a === 'gear') { selGearDialog(); return; }
      if (b && (b.dataset.a === 'json' || b.dataset.a === 'csv')) { moreClose(null); selExport(b.dataset.a); return; }
      if (b && b.dataset.i != null) { closeSheets(true); openTrip(+b.dataset.i); }
    });
    bot.addEventListener('change', function (ev) {
      var c = ev.target.closest('input[data-i]');
      if (!c || !SEL) return;
      selToggle(+c.dataset.i, c.checked);
      selRender(true);
    });
    document.body.appendChild(bot);
    var el = map.getContainer();
    el.addEventListener('pointerdown', selDown, true);
    el.addEventListener('pointermove', selMove, true);
    el.addEventListener('pointerup', selUp, true);
    el.addEventListener('pointercancel', function () { if (SEL) { SEL.pts = null; SEL.draw.clearLayers(); } }, true);
  }
  top.hidden = false; $('selBot').hidden = false;
}
function selToggle(i, on) {
  if (on && !SEL.on.has(i)) { SEL.on.add(i); SEL.picked.push(i); }
  if (!on && SEL.on.has(i)) { SEL.on.delete(i); SEL.picked = SEL.picked.filter(function (j) { return j !== i; }); }
}
// The bars, the list and the picked trips over the dimmed map.
function selRender(keepList) {
  if (!SEL) return;
  setPressed('#selTop [data-shape]', function (b) { return b.dataset.shape === SEL.shape; });
  var n = SEL.picked.length, kmT = 0;
  SEL.picked.forEach(function (i) { kmT += D.km[i]; });
  promptText('selTop', null, SEL.shape === 'rect' ? 'Drag a rectangle over the trips. Again to add more, tap one to drop it.' : 'Draw around the trips. Again to add more, tap one to drop it.');
  $('selSum').innerHTML = n ? '<b>' + tripsText(n) + '</b> · <span class="sel-km">' + dist(kmT) + '</span> <span class="sel-caret">' + (SEL.list ? 'Hide list' : 'List') + '</span>' : '<b>No trips yet</b>';
  $('selSum').setAttribute('aria-expanded', String(SEL.list && n > 0));
  $('selBot').querySelector('[data-a="clear"]').disabled = !n;
  $('selBot').querySelector('[data-a="type"]').disabled = !n;
  $('selBot').querySelector('.more-btn').disabled = !n;
  var box = $('selList');
  box.hidden = !(SEL.list && n);
  if (!box.hidden && !keepList) {
    var rows = SEL.picked.slice().sort(function (a, b) { return D.start[b] - D.start[a]; }).slice(0, 300);
    box.innerHTML = rows.map(function (i) {
      return '<div class="sel-item"><input type="checkbox" checked data-i="' + i + '" aria-label="Keep ' + esc(tripRoute(i)) + ' selected">' +
        '<button type="button" class="sel-open" data-i="' + i + '"><b>' + esc(tripRoute(i)) + '</b><small>' + niceDate(D.day[i]) + ', ' + clock(D.start[i], D.off[i]) + ' · ' + esc(tripLabel(i)) + '</small></button><span class="num">' + dist(D.km[i]) + '</span></div>';
    }).join('') + (n > 300 ? '<p class="fine">Showing the latest 300.</p>' : '');
  }
  SEL.layer.clearLayers();
  var parts = [];
  SEL.picked.forEach(function (i) { var h = selHit(i); if (h) parts.push(h.parts[0]); });
  if (parts.length) {
    L.polyline(parts, { pane: 'mrg', renderer: SEL.r, color: '#fff', weight: 7, opacity: .9, interactive: false }).addTo(SEL.layer);
    L.polyline(parts, { pane: 'mrg', renderer: SEL.r, color: cssVar('--accent') || '#c25228', weight: 3.5, opacity: 1, interactive: false }).addTo(SEL.layer);
  }
}
function selHit(i) {
  if (SEL.hv !== hits) { SEL.hv = hits; SEL.byI = null; }
  if (!SEL.byI) { SEL.byI = new Map(); hits.forEach(function (h) { SEL.byI.set(h.i, h); }); }
  return SEL.byI.get(i);
}
// Drawing: one pointer draws (the map doesn't pan meanwhile); a second one (a pinch) stops it.
// Listened to while capturing: the map's canvas keeps them to itself otherwise.
function selDown(ev) {
  if (!SEL || ev.button > 0 || ev.target.closest('.leaflet-control')) return;
  if (SEL.pts) { SEL.pts = null; SEL.draw.clearLayers(); return; }
  var r = map.getContainer().getBoundingClientRect();
  SEL.pts = [L.point(ev.clientX - r.left, ev.clientY - r.top)];
  SEL.pid = ev.pointerId;
}
function selMove(ev) {
  if (!SEL || !SEL.pts || ev.pointerId !== SEL.pid) return;
  var r = map.getContainer().getBoundingClientRect(), p = L.point(ev.clientX - r.left, ev.clientY - r.top), last = SEL.pts[SEL.pts.length - 1];
  if (p.distanceTo(last) < 3) return;
  SEL.pts.push(p);
  ev.preventDefault();
  SEL.draw.clearLayers();
  var poly = selShape(SEL.pts).map(function (q) { return map.containerPointToLatLng(q); });
  L.polygon(poly, { pane: 'mrg', renderer: SEL.r, color: cssVar('--accent') || '#c25228', weight: 2, dashArray: '6 5', fillOpacity: .08, interactive: false }).addTo(SEL.draw);
}
function selUp(ev) {
  if (!SEL || !SEL.pts || ev.pointerId !== SEL.pid) return;
  var pts = SEL.pts, far = 0;
  SEL.pts = null;
  SEL.draw.clearLayers();
  pts.forEach(function (p) { far = Math.max(far, p.distanceTo(pts[0])); });
  // A tap: the trip under it is dropped (or added).
  if (far < SEL_TAP_PX) {
    var list = hitsAt(pts[0]);
    if (!list.length) return;
    var i = list[0].i;
    selToggle(i, !SEL.on.has(i));
    selRender();
    return;
  }
  var shape = selShape(pts);
  if (shape.length < 3) return;
  var got = selInside(shape), add = 0;
  got.forEach(function (i) { if (!SEL.on.has(i)) { selToggle(i, true); add++; } });
  selRender();
  if (!got.length) toast('No trips on the map pass through there');
  else if (!add) toast('Those trips are already selected');
}
function selShape(pts) {
  if (SEL.shape !== 'rect') return pts;
  var a = pts[0], b = pts[pts.length - 1];
  return [L.point(a.x, a.y), L.point(b.x, a.y), L.point(b.x, b.y), L.point(a.x, b.y)];
}
// The trips the map shows that pass through the shape (in screen points): a GPS point inside it, or a
// stretch crossing its edge.
function selInside(shape) {
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, out = [];
  shape.forEach(function (p) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
  var sw = map.containerPointToLatLng([minX, maxY]), ne = map.containerPointToLatLng([maxX, minY]);
  function inPoly(p) {
    var c = false;
    for (var a = 0, b = shape.length - 1; a < shape.length; b = a++) {
      var A = shape[a], B = shape[b];
      if ((A.y > p.y) !== (B.y > p.y) && p.x < (B.x - A.x) * (p.y - A.y) / (B.y - A.y) + A.x) c = !c;
    }
    return c;
  }
  function cross(p, q, r, s) {
    function o(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
    return o(p, q, r) * o(p, q, s) < 0 && o(r, s, p) * o(r, s, q) < 0;
  }
  for (var k = 0; k < hits.length; k++) {
    var h = hits[k], bb = h.bb;
    if (h.k >= visibleB || isDup(h.i)) continue;
    if (bb[0] > ne.lat || bb[2] < sw.lat || bb[1] > ne.lng || bb[3] < sw.lng) continue;
    var pts = h.parts[0], prev = null, hit = false;
    for (var q = 0; q < pts.length && !hit; q++) {
      var c = map.latLngToContainerPoint(pts[q]);
      if (c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY && inPoly(c)) hit = true;
      else if (prev) for (var e = 0, f = shape.length - 1; e < shape.length && !hit; f = e++) if (cross(prev, c, shape[e], shape[f])) hit = true;
      prev = c;
    }
    if (hit) out.push(h.i);
  }
  return out;
}
// Change type…: one correction listing every picked trip. Unclassified last, for trips that look wrong.
var SEL_TYPES = ['TRAIN', 'BUS', 'CAR', 'TRAM', 'SUBWAY', 'FERRY', 'CYCLING', 'WALKING', 'RUNNING', 'MOTORCYCLE', 'TAXI', 'FLYING', 'VEHICLE', 'UNKNOWN'];
function selTypeDialog() {
  if (!SEL || !SEL.picked.length) return;
  var n = SEL.picked.length, now = {}, kmT = 0;
  SEL.picked.forEach(function (i) { var m = MODES[D.mode[i]]; now[m] = (now[m] || 0) + 1; kmT += D.km[i]; });
  var nowTxt = Object.keys(now).sort(function (a, b) { return now[b] - now[a]; }).map(function (m) { return (n > 1 && Object.keys(now).length > 1 ? fmt(now[m]) + ' ' : '') + esc((LABEL[m] || m).toLowerCase()); }).join(', ');
  var days = SEL.picked.map(function (i) { return D.day[i]; }), d0 = Math.min.apply(null, days), d1 = Math.max.apply(null, days);
  var types = SEL_TYPES.filter(function (m) { return MODE_IDX[m] != null; });
  var pick = types.filter(function (m) { return !now[m]; })[0] || types[0];
  mrAsk({
    title: 'Change ' + tripsText(n),
    text: (Object.keys(now).length === 1 ? (n > 1 ? 'All are ' : 'It is ') : 'Now ') + nowTxt + ', ' + dist(kmT) + ' in all, ' + (d0 === d1 ? niceDate(d0) : niceDate(d0) + ' to ' + niceDate(d1)) + '.',
    extra: '<div class="sel-types" role="radiogroup" aria-label="New type">' + types.map(function (m) {
      return '<button type="button" role="radio" data-m="' + m + '" aria-checked="' + (m === pick) + '">' + badge(m, true) + '<span>' + esc(LABEL[m] || m) + '</span></button>';
    }).join('') + '</div><label class="field"><span>Name</span><input type="text" id="selName" placeholder="Bulk edit"></label>',
    buttons: [['Make ' + tripsText(n) + ' ' + esc(LABEL[pick] || pick), 'primary', function () { selSave(); }], ['Back to map', 'quiet', null]],
    note: 'Saved in MyRules as one correction listing these trips, marked Edited. Each trip\'s details can detach it.',
    after: function () {
      SEL.type = pick;
      function name() { return 'Bulk edit: ' + tripsText(n) + ' to ' + (LABEL[SEL.type] || SEL.type).toLowerCase(); }
      $('selName').placeholder = name();
      $('mrDlgExtra').querySelector('.sel-types').onclick = function (ev) {
        var b = ev.target.closest('[data-m]');
        if (!b) return;
        SEL.type = b.dataset.m;
        this.querySelectorAll('[data-m]').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
        $('mrDlgBtns').querySelector('.primary').textContent = 'Make ' + tripsText(n) + ' ' + (LABEL[SEL.type] || SEL.type);
        $('selName').placeholder = name();
      };
    }
  });
}
function selSave() {
  if (!SEL || !SEL.picked.length || !SEL.type) return;
  var n = SEL.picked.length, type = SEL.type, name = ($('selName').value || '').trim() || $('selName').placeholder;
  mrEnsure();
  var b = D.base || D, refs = SEL.picked.slice().sort(function (x, y) { return D.start[x] - D.start[y]; }).map(function (i) { return { start: mrIsoLocal(i), mode: MODES[b.mode[i]] }; });
  var c = { id: mrNewId('bulk-' + type.toLowerCase()), name: name, trip: { trips: refs }, then: { mode: type } };
  (MR.doc.corrections || (MR.doc.corrections = [])).push(c);
  selEnd();
  // Applying the rules again over the whole Timeline takes a moment: the spinner shows meanwhile
  // (given a frame to appear first).
  busy('Changing ' + tripsText(n) + ' to ' + (LABEL[type] || type).toLowerCase() + '…');
  setTimeout(function () {
    try { mrChange(name); } finally { busy(''); }
    toast(tripsText(n) + ' now ' + (LABEL[type] || type).toLowerCase() + '. Undo it in MyRules, or detach a trip in its details.');
  }, 60);
}
// Set gear…: the gear goes on the picked trips of its type (gear is for one type), in one bulk edit.
// Recorded gear (Strava and other activity files) stays, as with any bulk edit. New gear joins your
// gear list in MyRules (not a default).
function selGearDialog() {
  if (!SEL || !SEL.picked.length) return;
  var n = SEL.picked.length, types = {};
  SEL.picked.forEach(function (i) { var m = MODES[D.mode[i]]; types[m] = (types[m] || 0) + 1; });
  var ms = Object.keys(types).filter(function (m) { return MR_GEAR_KINDS[m]; }).sort(function (a, b) { return types[b] - types[a]; });
  if (!ms.length) { toast('Gear is for rides, runs, walks, car, motorbike, boat and snow trips. None of these are.'); return; }
  // Gear of those types: on your trips already, and in your list in MyRules.
  var opts = [], seen = {};
  ms.forEach(function (m) {
    gearOrder().forEach(function (g) { var x = GEAR[g]; if (x.mode === m && !seen[m + '|' + x.name]) { seen[m + '|' + x.name] = 1; opts.push({ v: 'g:' + g, name: x.name, mode: m, kind: x.kind }); } });
    mrList('gear').forEach(function (r) { if (r.mode === m && r.name && !seen[m + '|' + r.name]) { seen[m + '|' + r.name] = 1; opts.push({ v: 'r:' + r.id, name: r.name, mode: m, kind: r.kind }); } });
  });
  var several = ms.length > 1;
  function lab(o) { return o.name + (several ? ' (' + (LABEL[o.mode] || o.mode) + ')' : ''); }
  mrAsk({
    title: 'Set gear on ' + tripsText(n),
    text: ms.map(function (m) { return fmt(types[m]) + ' ' + esc((LABEL[m] || m).toLowerCase()); }).join(', ') + (Object.keys(types).length > ms.length ? ', and others that have no gear' : '') + '.',
    extra: '<div class="mr-form"><label class="field"><span>Gear</span><select id="selG">' + opts.map(function (o) { return '<option value="' + esc(o.v) + '">' + esc(lab(o)) + '</option>'; }).join('') + '<option value="new">New gear…</option></select></label>' +
      '<div id="selGNew" class="mr-form" hidden><div class="grid2"><label class="field"><span>Name</span><input type="text" id="selGName" maxlength="60"></label>' +
      '<label class="field"><span>Type</span><select id="selGMode">' + ms.map(function (m) { return '<option value="' + m + '">' + esc(LABEL[m] || m) + '</option>'; }).join('') + '</select></label></div>' +
      '<label class="field"><span>Kind</span><select id="selGKind"></select></label></div>' +
      '<p class="fine" id="selGCount"></p><label class="field"><span>Name of the edit</span><input type="text" id="selName"></label></div>',
    info: 'Saved in MyRules as one correction listing these trips, marked Edited; each trip’s details can detach it. Gear goes only on trips of its own type. Gear recorded by Strava or another activity file is kept.',
    buttons: [['Set gear', 'primary', function () { selGearSave(); }], ['Back to map', 'quiet', null]],
    after: function () {
      function pick() {
        var v = $('selG').value, nw = v === 'new', o = opts.filter(function (x) { return x.v === v; })[0];
        $('selGNew').hidden = !nw;
        var m = nw ? $('selGMode').value : o.mode;
        if (nw) {
          $('selGName').placeholder = 'e.g. ' + (MR_GEAR_EG[m] || 'My gear');
          var k = $('selGKind').value;
          $('selGKind').innerHTML = mrKindsFor(m).map(function (x) { return '<option value="' + x + '"' + (x === k ? ' selected' : '') + '>' + esc(MR_KINDS[x]) + '</option>'; }).join('');
        }
        var c = types[m] || 0, rest = n - c, nm = nw ? ($('selGName').value.trim() || 'the new gear') : o.name;
        $('selGCount').textContent = 'Goes on ' + fmt(c) + ' ' + (LABEL[m] || m).toLowerCase() + ' ' + (c === 1 ? 'trip' : 'trips') + (rest ? '. The other ' + fmt(rest) + ' aren’t ' + (LABEL[m] || m).toLowerCase() + ' trips and stay as they are.' : '.');
        $('selName').placeholder = 'Bulk edit: ' + nm + ' on ' + tripsText(c);
        SEL.gear = { v: v, mode: m, o: o };
      }
      ['selG', 'selGMode'].forEach(function (id) { $(id).addEventListener('change', pick); });
      $('selGName').addEventListener('input', pick);
      if (!opts.length) $('selG').value = 'new';
      pick();
    }
  });
}
function selGearSave() {
  var s = SEL && SEL.gear;
  if (!s) return;
  var name, gv, mode = s.mode;
  mrEnsure();
  if (s.v === 'new') {
    name = $('selGName').value.trim();
    if (!name) { toast('Give the gear a name'); return; }
    var r = mrList('gear').filter(function (x) { return x.name === name && x.mode === mode; })[0];
    if (!r) { r = { id: mrNewId(name), name: name, kind: $('selGKind').value, mode: mode, assign: false }; (MR.doc.gear || (MR.doc.gear = [])).push(r); }
    gv = '@' + r.id;
  } else if (/^r:/.test(s.v)) { var lr = mrById(s.v.slice(2)); name = lr.name; gv = '@' + lr.id; }
  else {
    name = s.o.name;
    // Gear with a rule of its own is pointed at by id; recorded gear by its name.
    var own = mrList('gear').filter(function (x) { return x.name === name && x.mode === mode && !x.default; })[0] || mrList('gear').filter(function (x) { return x.name === name && x.mode === mode; })[0];
    gv = own ? '@' + own.id : name;
  }
  var mi = MODE_IDX[mode], b = D.base || D;
  var trips = SEL.picked.filter(function (i) { return D.mode[i] === mi; }).sort(function (x, y) { return D.start[x] - D.start[y]; });
  if (!trips.length) { toast('None of these trips are ' + (LABEL[mode] || mode).toLowerCase() + ' trips.'); return; }
  var label = ($('selName').value || '').trim() || $('selName').placeholder;
  var c = { id: mrNewId('bulk-gear-' + name), name: label, trip: { trips: trips.map(function (i) { return { start: mrIsoLocal(i), mode: MODES[b.mode[i]] }; }) }, then: { gear: gv } };
  (MR.doc.corrections || (MR.doc.corrections = [])).push(c);
  selEnd();
  busy('Setting ' + name + ' on ' + tripsText(trips.length) + '…');
  setTimeout(function () {
    try { mrChange(label); } finally { busy(''); }
    toast(name + ' set on ' + tripsText(trips.length) + '. Undo it in MyRules, or detach a trip in its details.');
  }, 60);
}
// Export trips: the picked trips, oldest to newest, in the files Menu › Your data writes for the filters.
// The selection stays, so the trips can still be changed afterwards.
function selExport(fmtName) {
  if (!SEL || !SEL.picked.length) return;
  var trips = SEL.picked.slice().sort(function (a, b) { return D.start[a] - D.start[b]; });
  var d0 = D.day[trips[0]], d1 = D.day[trips[trips.length - 1]];
  var name = 'btdt-selected-' + trips.length + '-trips-' + (d0 === d1 ? isoDay(d0) : isoDay(d0) + '-to-' + isoDay(d1)) + '.' + fmtName;
  runExport(function () {
    if (fmtName === 'csv') exportCsv(trips, name);
    else exportJson(trips, [], name, { selection: { how: 'Selected on the map', days: { from: isoDay(d0), to: isoDay(d1) }, filters: exportFilters() } });
  });
}
function selEnd() {
  if (!SEL) return;
  var was = SEL;
  SEL = null;
  was.dim.remove(); was.layer.remove(); was.draw.remove();
  map.dragging.enable(); map.boxZoom.enable(); map.doubleClickZoom.enable();
  map.getContainer().classList.remove('sel-on');
  document.body.classList.remove('sel-mode');
  if ($('selTop')) { $('selTop').hidden = true; $('selBot').hidden = true; }
  if ($('mrDlg').open) $('mrDlg').close();
}
$('selNewBtn').addEventListener('click', function () { selStart(); });
