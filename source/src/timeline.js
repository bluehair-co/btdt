// ---------- timeline ----------
// A list of every trip in the selection, newest first, grouped by day. Only the rows near
// the visible part are in the page, so years of trips scroll smoothly. The search box above
// it narrows the list to trips whose title, places or type hold every word typed.
var TL = { type: [], ref: [], tops: [], total: 0, sel: null, r0: -1, r1: -1, map: null, layer: null, q: '', words: [], hay: null, n: 0 };
var TL_H = [40, 64, 120];   // day header, trip, end of list
// Lower case without accents, so "cafe" finds "Café" and "zurich" finds "Zürich".
function tlNorm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
// What a trip can be found by: its title (Strava, activity file or Trip info), where it
// started and ended, and its type or sport.
function tlHay(i) {
  var h = TL.hay || (TL.hay = {});
  if (h[i] === undefined) {
    var lab = String(tripLabel(i)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    h[i] = tlNorm([tripName(i), tripRoute(i), lab, LABEL[modeOf(i)] || ''].join(' \n '));
  }
  return h[i];
}
function tlMatch(i) {
  if (!TL.words.length) return true;
  var h = tlHay(i);
  for (var w = 0; w < TL.words.length; w++) if (h.indexOf(TL.words[w]) < 0) return false;
  return true;
}
// keepHay: only the search changed, so the trips' names are still good.
function buildTimeline(keepHay) {
  if (keepHay !== true) TL.hay = null;
  var type = [], ref = [], tops = [], y = 0, last = null, perDay = {}, n = 0, selIn = false;
  for (var j = sel.length - 1; j >= 0; j--) {
    var i = sel[j];
    if (!tlMatch(i)) continue;
    var d = D.day[i], pd = perDay[d] || (perDay[d] = { n: 0, km: 0 });
    pd.n++; pd.km += D.km[i]; n++;
    if (i === TL.sel) selIn = true;
    if (d !== last) { type.push(0); ref.push(d); tops.push(y); y += TL_H[0]; last = d; }
    type.push(1); ref.push(i); tops.push(y); y += TL_H[1];
  }
  type.push(2); ref.push(0); tops.push(y); y += TL_H[2];
  TL.type = type; TL.ref = ref; TL.tops = tops; TL.total = y; TL.perDay = perDay; TL.n = n; TL.r0 = TL.r1 = -1;
  $('tlInner').style.height = y + 'px';
  if (TL.sel != null && !selIn) tlClose();
  $('tlList').scrollTop = 0;
  tlLayout();
}
function tlLayout() {
  if (TL.map && $('tripMap')) TL.map.invalidateSize();
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
      out += '<div class="tl-item" ' + top + '><button type="button" class="tl-trip" data-i="' + i + '" aria-pressed="' + (i === TL.sel) + '">' + badge(m, false, D.est[i] & 16 ? actApp(i) || true : 0, tripIcon(i)) +
        '<span class="t"><b>' + esc(tripName(i) || tripRoute(i)) + '</b><small>' + tripLabel(i) + simTag(i) + ' · ' + clock(D.start[i], D.off[i]) + (ms > 0 ? '–' + clock(D.end[i], D.off[i]) : '') + (D.est[i] & 16 ? ' · ' + esc(actApp(i) || 'Activity') : D.est[i] & 4 ? ' · type guessed' : '') + '</small></span>' +
        '<span class="r">' + dist(D.km[i]) + '<small>' + (ms > 0 ? duration(ms) : '') + '</small></span></button></div>';
    } else {
      var q = '<mark>\u201c' + esc(TL.q) + '\u201d</mark>';
      out += '<div class="tl-item tl-end" ' + top + '>' + (!sel.length ? 'No trips match your filters.' :
        !TL.words.length ? 'That\'s all ' + tripsText(sel.length) + ' for ' + esc(filterText()) + '.' :
        TL.n ? tripsText(TL.n) + ' of ' + fmt(sel.length) + (TL.n === 1 ? ' matches ' : ' match ') + q + ' in ' + esc(filterText()) + '.' :
        'None of the ' + tripsText(sel.length) + ' in ' + esc(filterText()) + ' match ' + q + '.') + '</div>';
    }
  }
  $('tlInner').innerHTML = out;
}
var tlRaf = 0;
$('tlList').addEventListener('scroll', function () { if (!tlRaf) tlRaf = requestAnimationFrame(function () { tlRaf = 0; tlRender(); }); }, { passive: true });
$('tlInner').addEventListener('click', function (ev) {
  var b = ev.target.closest('.tl-trip[data-i]');
  if (!b) return;
  // One tap opens the trip, with its map at the top of the sheet (tlSheetMap).
  var i = +b.dataset.i;
  tlSelect(i, false);
  openTrip(i);
});

// The selected trip: marked in the list (and scrolled to, from the map or Insights).
function tlSelect(i, scroll) {
  if (dirty.timeline) { dirty.timeline = false; buildTimeline(); }
  // A trip opened from the map or Insights that the search hides: clear the search to show it.
  if (TL.words.length && !tlMatch(i)) tlSetSearch('');
  TL.sel = i;
  var k = -1;
  for (var q = 0; q < TL.ref.length; q++) if (TL.type[q] === 1 && TL.ref[q] === i) { k = q; break; }
  if (scroll && k >= 0) {
    // Leave room for the day header above the trip.
    requestAnimationFrame(function () { $('tlList').scrollTop = Math.max(0, TL.tops[k] - TL_H[0]); tlRender(true); });
  } else tlRender(true);
}
// The trip's own map at the top of its sheet, when it is opened from Timeline (the main map isn't
// in view there). Made again for each trip; the one before is let go.
function tlSheetMap(i) {
  if (TL.map) { TL.map.remove(); TL.map = null; }
  var el = $('tripMap');
  if (!el) return;
  if (!window.L) { el.innerHTML = '<p class="empty">The map library couldn\'t load. Check your internet connection and reload.</p>'; return; }
  TL.map = L.map(el, { worldCopyJump: true, minZoom: 2, zoomControl: false, attributionControl: true }).setView([50, 8], 4);
  addTiles(TL.map);
  TL.layer = L.layerGroup().addTo(TL.map);
  var pts = tripPath(i), color = cssVar(groupOf(modeOf(i)).v), panel = cssVar('--panel');
  function fit() {
    if (!TL.map || !pts.length) return;
    TL.map.invalidateSize();
    var bb = L.latLngBounds(pts);
    if (bb.getNorthEast().equals(bb.getSouthWest())) TL.map.setView(bb.getCenter(), 15);
    else TL.map.fitBounds(bb, { padding: [20, 20], maxZoom: 16 });
  }
  if (pts.length) {
    L.polyline(pts, { color: panel, weight: 8, opacity: 0.9, interactive: false }).addTo(TL.layer);
    L.polyline(pts, { color: color, weight: 4.5, opacity: 1, interactive: false }).addTo(TL.layer);
    L.circleMarker(pts[0], { radius: 7, color: panel, weight: 2, fillColor: color, fillOpacity: 1 }).bindTooltip('Start').addTo(TL.layer);
    L.circleMarker(pts[pts.length - 1], { radius: 7, color: color, weight: 3, fillColor: panel, fillOpacity: 1 }).bindTooltip('End').addTo(TL.layer);
  }
  fit();
  // Once the sheet has slid in, its size is final.
  setTimeout(fit, 260);
}
function tlClose() {
  TL.sel = null;
  tlRender(true);
}

// The search box.
var tlQT = 0;
function tlSetSearch(v) {
  var box = $('tlSearch');
  if (box.value !== v) box.value = v;
  $('tlSearchClear').hidden = !v;
  var q = v.trim();
  if (q === TL.q) return;
  TL.q = q;
  TL.words = tlNorm(q).split(/\s+/).filter(Boolean);
  if (dirty.timeline) { dirty.timeline = false; buildTimeline(); } else buildTimeline(true);
}
$('tlSearch').addEventListener('input', function () {
  var v = this.value;
  $('tlSearchClear').hidden = !v;
  clearTimeout(tlQT);
  tlQT = setTimeout(function () { tlSetSearch(v); }, 120);
});
$('tlSearch').addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape' && this.value) { ev.stopPropagation(); clearTimeout(tlQT); tlSetSearch(''); }
  else if (ev.key === 'Enter') { clearTimeout(tlQT); tlSetSearch(this.value); this.blur(); }
});
$('tlSearchClear').addEventListener('click', function () { clearTimeout(tlQT); tlSetSearch(''); $('tlSearch').focus(); });
