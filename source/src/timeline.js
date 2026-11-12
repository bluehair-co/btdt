// ---------- timeline ----------
// A list of every trip in the selection, newest first, grouped by day. Only the rows near
// the visible part are in the page, so years of trips scroll smoothly.
var TL = { type: [], ref: [], tops: [], total: 0, sel: null, r0: -1, r1: -1, map: null, layer: null };
var TL_H = [40, 64, 120];   // day header, trip, end of list
function buildTimeline() {
  var type = [], ref = [], tops = [], y = 0, last = null, perDay = {};
  for (var j = sel.length - 1; j >= 0; j--) {
    var i = sel[j], d = D.day[i], pd = perDay[d] || (perDay[d] = { n: 0, km: 0 });
    pd.n++; pd.km += D.km[i];
    if (d !== last) { type.push(0); ref.push(d); tops.push(y); y += TL_H[0]; last = d; }
    type.push(1); ref.push(i); tops.push(y); y += TL_H[1];
  }
  type.push(2); ref.push(0); tops.push(y); y += TL_H[2];
  TL.type = type; TL.ref = ref; TL.tops = tops; TL.total = y; TL.perDay = perDay; TL.r0 = TL.r1 = -1;
  $('tlInner').style.height = y + 'px';
  if (TL.sel != null && Array.prototype.indexOf.call(sel, TL.sel) < 0) tlClose();
  $('tlList').scrollTop = 0;
  tlLayout();
}
function tlLayout() {
  if (TL.map && !$('tlMapWrap').hidden) TL.map.invalidateSize();
  tlRender(true);
}
// Index of the item at height y.
function tlAt(y) {
  var lo = 0, hi = TL.tops.length - 1;
  while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (TL.tops[mid] <= y) lo = mid; else hi = mid - 1; }
  return lo;
}
function tlRender(force) {
  var list = $('tlList'), st = list.scrollTop, h = list.clientHeight || innerHeight;
  var a = tlAt(Math.max(0, st - 600)), b = tlAt(st + h + 600);
  if (!force && a === TL.r0 && b === TL.r1) return;
  TL.r0 = a; TL.r1 = b;
  var out = '';
  for (var k = a; k <= b; k++) {
    var top = 'style="top:' + TL.tops[k] + 'px"';
    if (TL.type[k] === 0) {
      var d = TL.ref[k], pd = TL.perDay[d];
      out += '<div class="tl-item tl-day" ' + top + '><b>' + longDate(d) + '</b><span>' + tripsText(pd.n) + ' · ' + dist(pd.km) + '</span></div>';
    } else if (TL.type[k] === 1) {
      var i = TL.ref[k], m = modeOf(i), ms = D.end[i] - D.start[i];
      out += '<div class="tl-item" ' + top + '><button type="button" class="tl-trip" data-i="' + i + '" aria-pressed="' + (i === TL.sel) + '">' + badge(m, false, D.est[i] & 16, tripIcon(i)) +
        '<span class="t"><b>' + esc(tripName(i) || tripRoute(i)) + '</b><small>' + tripLabel(i) + simTag(i) + ' · ' + clock(D.start[i], D.off[i]) + (ms > 0 ? '–' + clock(D.end[i], D.off[i]) : '') + (D.est[i] & 16 ? ' · Strava' : D.est[i] & 4 ? ' · type guessed' : '') + '</small></span>' +
        '<span class="r">' + dist(D.km[i]) + '<small>' + (ms > 0 ? duration(ms) : '') + '</small></span></button></div>';
    } else {
      out += '<div class="tl-item tl-end" ' + top + '>' + (sel.length ? 'That\'s all ' + tripsText(sel.length) + ' for ' + esc(filterText()) + '.' : 'No trips match your filters.') + '</div>';
    }
  }
  $('tlInner').innerHTML = out;
}
var tlRaf = 0;
$('tlList').addEventListener('scroll', function () { if (!tlRaf) tlRaf = requestAnimationFrame(function () { tlRaf = 0; tlRender(); }); }, { passive: true });
$('tlInner').addEventListener('click', function (ev) {
  var b = ev.target.closest('.tl-trip[data-i]');
  if (!b) return;
  var i = +b.dataset.i;
  if (i === TL.sel) tlClose(); else tlSelect(i, false);
});

// The selected trip, on a map above the list.
function tlSelect(i, scroll) {
  if (dirty.timeline) { dirty.timeline = false; buildTimeline(); }
  TL.sel = i;
  var wrap = $('tlMapWrap');
  wrap.hidden = false;
  if (!window.L) $('tlMap').innerHTML = '<p class="empty">The map library couldn\'t load. Check your internet connection and reload.</p>';
  else {
    if (!TL.map) {
      TL.map = L.map('tlMap', { worldCopyJump: true, minZoom: 2, zoomControl: false, attributionControl: true }).setView([50, 8], 4);
      addTiles(TL.map);
      TL.layer = L.layerGroup().addTo(TL.map);
    }
    TL.map.invalidateSize();
    TL.layer.clearLayers();
    var pts = tripPath(i), color = cssVar(groupOf(modeOf(i)).v), panel = cssVar('--panel');
    if (pts.length) {
      L.polyline(pts, { color: panel, weight: 8, opacity: 0.9, interactive: false }).addTo(TL.layer);
      L.polyline(pts, { color: color, weight: 4.5, opacity: 1, interactive: false }).addTo(TL.layer);
      L.circleMarker(pts[0], { radius: 7, color: panel, weight: 2, fillColor: color, fillOpacity: 1 }).bindTooltip('Start').addTo(TL.layer);
      L.circleMarker(pts[pts.length - 1], { radius: 7, color: color, weight: 3, fillColor: panel, fillOpacity: 1 }).bindTooltip('End').addTo(TL.layer);
      var bb = L.latLngBounds(pts);
      if (bb.getNorthEast().equals(bb.getSouthWest())) TL.map.setView(bb.getCenter(), 15);
      else TL.map.fitBounds(bb, { paddingTopLeft: [24, 24], paddingBottomRight: [24, 84], maxZoom: 16 });
    }
  }
  var m = modeOf(i), ms = D.end[i] - D.start[i];
  $('tlMapInfo').innerHTML = badge(m, true) + '<span class="t" style="flex:1"><b>' + esc(tripRoute(i)) + '</b><small>' + tripLabel(i) + simTag(i) + ' · ' + niceDate(D.day[i]) + ', ' + clock(D.start[i], D.off[i]) +
    ' · ' + dist(D.km[i]) + (ms > 0 ? ' · ' + duration(ms) : '') + '</small></span><button type="button" class="btn quiet" data-details="' + i + '" style="padding:6px 10px">Details</button>';
  var k = -1;
  for (var q = 0; q < TL.ref.length; q++) if (TL.type[q] === 1 && TL.ref[q] === i) { k = q; break; }
  if (scroll && k >= 0) {
    // Leave room for the day header above the trip.
    requestAnimationFrame(function () { $('tlList').scrollTop = Math.max(0, TL.tops[k] - TL_H[0]); tlRender(true); });
  } else {
    tlRender(true);
    // Keep the tapped row in view now that the list is shorter.
    requestAnimationFrame(function () {
      var list = $('tlList');
      if (k >= 0 && (TL.tops[k] < list.scrollTop || TL.tops[k] + TL_H[1] > list.scrollTop + list.clientHeight)) list.scrollTop = Math.max(0, TL.tops[k] - 8);
      tlRender(true);
    });
  }
}
function tlClose() {
  TL.sel = null;
  $('tlMapWrap').hidden = true;
  tlRender(true);
}
$('tlMapClose').addEventListener('click', tlClose);
$('tlMapInfo').addEventListener('click', function (ev) { var b = ev.target.closest('[data-details]'); if (b) openTrip(+b.dataset.details); });
