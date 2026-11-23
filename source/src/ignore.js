// ---------- ignoring GPS points of a trip ----------
// Ignore GPS points in the trip details: the trip alone on the map with each of its GPS points.
// Drawing around points (a lasso or a rectangle, as in Select trips) ignores them; drawing around
// points that are all ignored brings them back; a tap on a point does either for that one. Save
// writes their times into the trip's own correction (then.ignore_points, see mrApplyDrops), so the
// trip's distance, speed chart, playback and the heatmap go without them, and Remove edit (or Undo
// next to "GPS points ignored") in its details brings them back.
// Drawing works with a mouse, a pen or one finger: the map is touch-action none meanwhile (the
// sel-on class, as in Select trips), and a second finger zooms the map instead.
var IGN = null, IGN_TAP_PX = 22;
function ignOk(i) {
  if (!D || isDup(i) || MODES[(D.base || D).mode[i]] === 'FLYING' || MODES[D.mode[i]] === 'FLYING') return false;
  var b = D.base || D;
  return b.pathOff[i + 1] - b.pathOff[i] >= 3;
}
function ignStart(i) {
  if (!ignOk(i)) return;
  closeSheets(true);
  if (PREFS.proj !== 'merc') setProj('merc');
  setTab('map');
  if (!initMap()) return;
  if (typeof snapEnd === 'function') snapEnd();
  if (typeof splitHandEnd === 'function') splitHandEnd();
  if (typeof selEnd === 'function') selEnd();
  ignEnd();
  if (!map.getPane('mrg')) { map.createPane('mrg'); map.getPane('mrg').style.zIndex = 460; }
  var c = mrTripCorrection(i), set = mrIgnoreSet(c && c.then && c.then.ignore_points), pts = mrBasePoints(i), off = new Set();
  pts.forEach(function (p, k) { if (set[p.t]) off.add(k); });
  IGN = { i: i, pts: pts, off: off, was: Array.from(off).sort(function (a, b) { return a - b; }).join(), hist: [], shape: PREFS.selShape === 'rect' ? 'rect' : 'lasso',
    km0: pathKm(pts.map(function (p) { return p.ll; })), col: cssVar((modeColor(MODES[D.mode[i]]).match(/--[\w-]+/) || [''])[0]) || '#c25228' };
  IGN.r = L.canvas({ pane: 'mrg', padding: 0.5 });
  IGN.dim = L.rectangle([[-89, -720], [89, 720]], { pane: 'mrg', renderer: IGN.r, stroke: false, fillColor: cssVar('--bg') || '#f7f2ee', fillOpacity: .5, interactive: false }).addTo(map);
  IGN.layer = L.layerGroup().addTo(map);
  IGN.draw = L.layerGroup().addTo(map);
  map.dragging.disable(); map.boxZoom.disable(); map.doubleClickZoom.disable();
  map.getContainer().classList.add('sel-on');
  document.body.classList.add('sel-mode');
  layerToggles();
  hideTip(); setHovered([]);
  ignBars();
  ignRender();
  map.fitBounds(L.latLngBounds(pts.map(function (p) { return p.ll; })), { padding: [70, 40], maxZoom: 17 });
}
function ignBars() {
  var top = $('ignTop');
  if (!top) {
    top = document.createElement('div');
    top.id = 'ignTop'; top.className = 'snap-bar sel-top'; top.setAttribute('role', 'status');
    top.innerHTML = '<span class="snap-bar-t">' + icon('pinOff') + '<span><b>Ignore GPS points</b><span class="sel-hint"></span></span></span>' +
      '<div class="seg" role="group" aria-label="Shape"><button type="button" data-shape="lasso">Lasso</button><button type="button" data-shape="rect">Rectangle</button></div>' +
      '<button type="button" class="btn quiet" data-a="cancel">Cancel</button>';
    top.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b || !IGN) return;
      if (b.dataset.shape) { IGN.shape = PREFS.selShape = b.dataset.shape; savePrefs(); ignRender(); }
      else if (b.dataset.a === 'cancel') { var i = IGN.i; ignEnd(); openTrip(i); }
    });
    document.body.appendChild(top);
    var bot = document.createElement('div');
    bot.id = 'ignBot'; bot.className = 'sel-bar';
    bot.innerHTML = '<div class="sel-row"><div class="sel-sum ign-sum" id="ignSum"></div>' +
      '<button type="button" class="btn quiet" data-a="undo">Undo</button><button type="button" class="btn primary" data-a="save">Save</button></div>';
    bot.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-a]');
      if (!b || !IGN) return;
      if (b.dataset.a === 'undo') { var h = IGN.hist.pop(); if (h) { IGN.off = h; ignRender(); } }
      else if (b.dataset.a === 'save') ignSave();
    });
    document.body.appendChild(bot);
    var el = map.getContainer();
    el.addEventListener('pointerdown', ignDown, true);
    el.addEventListener('pointermove', ignMove, true);
    el.addEventListener('pointerup', ignUp, true);
    el.addEventListener('pointercancel', function () { if (IGN) { IGN.drawPts = null; IGN.draw.clearLayers(); } }, true);
  }
  top.hidden = false; $('ignBot').hidden = false;
}
// The points kept, as [lat, lng].
function ignKept() { return IGN.pts.filter(function (_, k) { return !IGN.off.has(k); }).map(function (p) { return p.ll; }); }
function ignRender() {
  if (!IGN) return;
  setPressed('#ignTop [data-shape]', function (b) { return b.dataset.shape === IGN.shape; });
  $('ignTop').querySelector('.sel-hint').textContent = (IGN.shape === 'rect' ? 'Drag a rectangle over the bad points' : 'Draw around the bad points') + ', or tap one. Do it again on ignored ones to bring them back.';
  var n = IGN.off.size, kept = ignKept(), b = D.base || D, k0 = b.km[IGN.i], left = pathKm(kept);
  // The distance it would have, as mrApplyDrops works it out.
  var kmNow = n && IGN.km0 > 0 ? Math.max(left, k0 - (IGN.km0 - left)) : k0;
  $('ignSum').innerHTML = n ? '<b>' + fmt(n) + ' of ' + fmt(IGN.pts.length) + ' points ignored</b><small>' + dist(k0) + ' → ' + dist(kmNow) + '</small>' : '<b>No points ignored</b><small>' + fmt(IGN.pts.length) + ' GPS points · ' + dist(k0) + '</small>';
  $('ignBot').querySelector('[data-a="undo"]').disabled = !IGN.hist.length;
  $('ignBot').querySelector('[data-a="save"]').disabled = Array.from(IGN.off).sort(function (a, c) { return a - c; }).join() === IGN.was;
  IGN.layer.clearLayers();
  var o = { pane: 'mrg', renderer: IGN.r, interactive: false }, all = IGN.pts.map(function (p) { return p.ll; }), red = '#c62f27';
  // The trail as loaded, faint and dashed, so a spike to an ignored point still shows where it went.
  if (n) L.polyline(all, Object.assign({ color: '#8a8f8c', weight: 2, opacity: .7, dashArray: '4 5' }, o)).addTo(IGN.layer);
  L.polyline(kept, Object.assign({ color: '#fff', weight: 7, opacity: .9 }, o)).addTo(IGN.layer);
  L.polyline(kept, Object.assign({ color: IGN.col, weight: 3.5, opacity: 1 }, o)).addTo(IGN.layer);
  IGN.pts.forEach(function (p, k) {
    if (IGN.off.has(k)) L.circleMarker(p.ll, Object.assign({ radius: 5.5, color: red, weight: 2.5, fillColor: '#fff', fillOpacity: 1 }, o)).addTo(IGN.layer);
    else L.circleMarker(p.ll, Object.assign({ radius: 3.5, color: '#fff', weight: 1.5, fillColor: IGN.col, fillOpacity: 1 }, o)).addTo(IGN.layer);
  });
}
// Ignores the points ks, or brings them back when all of them are ignored already. Keeps two.
function ignToggle(ks) {
  if (!ks.length) return;
  var back = ks.every(function (k) { return IGN.off.has(k); }), next = new Set(IGN.off);
  ks.forEach(function (k) { if (back) next.delete(k); else next.add(k); });
  if (IGN.pts.length - next.size < 2) { toast('A trip keeps at least two GPS points'); return; }
  IGN.hist.push(IGN.off);
  IGN.off = next;
  ignRender();
}
function ignXY(ev) { var r = map.getContainer().getBoundingClientRect(); return L.point(ev.clientX - r.left, ev.clientY - r.top); }
function ignDown(ev) {
  if (!IGN || ev.button > 0 || ev.target.closest('.leaflet-control')) return;
  // A second finger: a pinch, not a drawing.
  if (IGN.drawPts) { IGN.drawPts = null; IGN.draw.clearLayers(); return; }
  IGN.drawPts = [ignXY(ev)];
  IGN.pid = ev.pointerId;
}
function ignShape(pts) {
  if (IGN.shape !== 'rect') return pts;
  var a = pts[0], b = pts[pts.length - 1];
  return [L.point(a.x, a.y), L.point(b.x, a.y), L.point(b.x, b.y), L.point(a.x, b.y)];
}
function ignMove(ev) {
  if (!IGN || !IGN.drawPts || ev.pointerId !== IGN.pid) return;
  var p = ignXY(ev), last = IGN.drawPts[IGN.drawPts.length - 1];
  if (p.distanceTo(last) < 3) return;
  IGN.drawPts.push(p);
  ev.preventDefault();
  IGN.draw.clearLayers();
  L.polygon(ignShape(IGN.drawPts).map(function (q) { return map.containerPointToLatLng(q); }), { pane: 'mrg', renderer: IGN.r, color: cssVar('--accent') || '#c25228', weight: 2, dashArray: '6 5', fillOpacity: .08, interactive: false }).addTo(IGN.draw);
}
function ignUp(ev) {
  if (!IGN || !IGN.drawPts || ev.pointerId !== IGN.pid) return;
  var pts = IGN.drawPts, far = 0;
  IGN.drawPts = null;
  IGN.draw.clearLayers();
  pts.forEach(function (p) { far = Math.max(far, p.distanceTo(pts[0])); });
  if (far < SEL_TAP_PX) {
    // A tap: the point nearest it.
    var best = -1, bd = IGN_TAP_PX;
    IGN.pts.forEach(function (p, k) { var d = map.latLngToContainerPoint(p.ll).distanceTo(pts[0]); if (d < bd) { bd = d; best = k; } });
    if (best < 0) toast('Tap a GPS point of the trip, or draw around some');
    else ignToggle([best]);
    return;
  }
  var shape = ignShape(pts);
  if (shape.length < 3) return;
  var got = [];
  IGN.pts.forEach(function (p, k) { if (ignInPoly(map.latLngToContainerPoint(p.ll), shape)) got.push(k); });
  if (!got.length) toast('No GPS points of the trip in there');
  else ignToggle(got);
}
function ignInPoly(p, shape) {
  var c = false;
  for (var a = 0, b = shape.length - 1; a < shape.length; b = a++) {
    var A = shape[a], B = shape[b];
    if ((A.y > p.y) !== (B.y > p.y) && p.x < (B.x - A.x) * (p.y - A.y) / (B.y - A.y) + A.x) c = !c;
  }
  return c;
}
// Save: with points newly ignored, first Just this trip or Every trip, here (a bad GPS spot in MyRules,
// gps_spots: the points within GPS_SPOT_KM of these go on every trip, see mrSpotDrops), with how many
// points and trips that would take.
function ignSave() {
  if (!IGN) return;
  var was = {};
  IGN.was.split(',').forEach(function (k) { if (k !== '') was[k] = 1; });
  var fresh = Array.from(IGN.off).filter(function (k) { return !was[k]; }).sort(function (a, b) { return a - b; });
  if (!fresh.length) { ignSaveDo([]); return; }
  // The spots: the new points, one per few metres.
  var at = [];
  fresh.forEach(function (k) { var ll = IGN.pts[k].ll; if (!at.some(function (p) { return kmLL(p[0], p[1], ll[0], ll[1]) < 0.005; })) at.push([+ll[0].toFixed(6), +ll[1].toFixed(6)]); });
  var pre = mrSpotDrops([{ id: '_preview', at: at }]), tn = 0, pn = 0;
  Object.keys(pre).forEach(function (k) { tn++; pn += pre[k].n; });
  mrAsk({
    title: 'Leave these points out where?',
    text: fmt(fresh.length) + ' GPS point' + (fresh.length === 1 ? '' : 's') + ' marked on this trip.',
    info: 'Every trip, here leaves out the GPS points within ' + distShort(GPS_SPOT_KM * 1000) + ' of these on all your trips, and on trips you load later, except where a trip starts or ends. Use it for a spot where your phone keeps putting itself without GPS, such as a Wi-Fi router or a cell tower. It is saved in MyRules › Corrections as a bad GPS spot, which you can switch off or delete.',
    extra: '<p class="fine">Every trip, here: ' + (tn > 1 ? fmt(pn) + ' points on ' + tripsText(tn) + ' now.' : 'only this trip has points there now.') + '</p>',
    buttons: [['Just this trip', 'primary', function () { ignSaveDo([]); }], ['Every trip, here', '', function () { ignSaveDo(fresh, at); }], ['Back to the points', 'quiet', null]]
  });
}
// fresh: the newly ignored points that go into a bad GPS spot at (not into the trip's correction).
function ignSaveDo(fresh, at) {
  if (!IGN) return;
  var spot = fresh.length > 0, skip = {};
  fresh.forEach(function (k) { skip[k] = 1; });
  var i = IGN.i, list = Array.from(IGN.off).filter(function (k) { return !skip[k]; }).sort(function (a, b) { return a - b; }).map(function (k) { return mrIgnoreIso(IGN.pts[k].t); }), n = list.length + fresh.length;
  mrEnsure();
  if (spot) (MR.doc.gps_spots || (MR.doc.gps_spots = [])).push({ id: mrNewId('gps-spot-' + isoDay(D.day[i])), name: 'GPS spot from the trip on ' + niceDate(D.day[i]), at: at });
  var c = mrTripCorrection(i);
  if (!c && list.length) { c = { id: mrNewId('trip-' + isoDay(D.day[i])), trip: { start: mrIsoLocal(i), mode: MODES[D.base.mode[i]] }, then: {} }; (MR.doc.corrections || (MR.doc.corrections = [])).push(c); }
  if (c) {
    var t = c.then || (c.then = {});
    if (list.length) t.ignore_points = list; else delete t.ignore_points;
    if (!Object.keys(t).length) MR.doc.corrections = mrList('corrections').filter(function (x) { return x !== c; });
  }
  ignEnd();
  working(n ? 'Leaving out ' + fmt(n) + ' GPS point' + (n === 1 ? '' : 's') + '…' : 'Bringing the GPS points back…', function () {
    mrChange(spot ? 'Bad GPS spot marked on ' + mrWhere(i) : 'Trip on ' + mrWhere(i) + ': ' + (n ? fmt(n) + ' GPS point' + (n === 1 ? '' : 's') + ' ignored' : 'GPS points back'));
    openTrip(i);
  });
  toast(spot ? 'Left out on every trip there. Switch it off or delete it in MyRules › Corrections.' : n ? fmt(n) + ' GPS point' + (n === 1 ? '' : 's') + ' ignored. Remove edit in the trip details brings them back.' : 'All its GPS points are back.');
}
function ignEnd() {
  if (!IGN) return;
  var was = IGN;
  IGN = null;
  was.dim.remove(); was.layer.remove(); was.draw.remove();
  map.dragging.enable(); map.boxZoom.enable(); map.doubleClickZoom.enable();
  map.getContainer().classList.remove('sel-on');
  document.body.classList.remove('sel-mode');
  if ($('ignTop')) { $('ignTop').hidden = true; $('ignBot').hidden = true; }
  layerToggles();
}
$('tripBody').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-ign]');
  if (!b) return;
  ev.stopPropagation();
  ignStart(+b.dataset.ign);
});
