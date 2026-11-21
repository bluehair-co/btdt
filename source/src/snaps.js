// ---------- map snaps ----------
// A map snap draws your trips between two stations along one line of a station pack, to clean up
// how their paths look. You tap the two stations on the map, pick the type (train, tram or metro,
// one type the whole way) and the way along the tracks, and see your trips between them: solid when
// they follow the line closely enough, dashed when not, with the accuracy slider. Saved in MyRules
// under "snaps", both ways, with no period, days or times (that's what routines are for):
//   { "id", "name", "mode": "TRAIN", "from": [lat, lng], "to": [lat, lng], "from_name", "to_name",
//     "radius_m": { "from": 300, "to": 800 } (or one number for both), "line": { "polyline": "…", "name": "Along the railway via Haarlem" },
//     "match": 67, "other_types": true }
// A snap takes a trip that starts within its radius of one end and ends within the other's, that
// no routine took, follows its line for match % of its GPS points or more, and whose type is the
// snap's, missing, Vehicle or guessed (or any type with other_types). The trip takes the snap's
// type and the stretch of its line between its ends, as a routine's line does.
var SNAP_RAD = 500, SNAP_MODES = ['TRAIN', 'TRAM', 'SUBWAY'], SNAP_PTS = new Map();
function snapPts(s) {
  var pl = s && s.line && s.line.polyline;
  if (!pl) return null;
  if (!SNAP_PTS.has(pl)) SNAP_PTS.set(pl, mrDecodePolyline(pl));
  var p = SNAP_PTS.get(pl);
  return p.length > 1 ? p : null;
}
function snapOk(s) { return Array.isArray(s.from) && Array.isArray(s.to) && MODE_IDX[s.mode] != null && !!snapPts(s); }
// The radius of an end ('from' or 'to') in km: radius_m is one number for both, or { from, to }.
function snapRad(s, end) { var m = s.radius_m, r = m && typeof m === 'object' ? +m[end] : +m; return (r > 0 ? r : SNAP_RAD) / 1000; }
// 1: from → to, -1: to → from, 0: neither.
function snapDir(s, i, ra, rb) {
  var a = [D.from[2 * i], D.from[2 * i + 1]], b = [D.to[2 * i], D.to[2 * i + 1]];
  if (!isFinite(a[0]) || !isFinite(b[0])) return 0;
  if (km(a, s.from) <= ra && km(b, s.to) <= rb) return 1;
  if (km(a, s.to) <= rb && km(b, s.from) <= ra) return -1;
  return 0;
}
// Its type can take the snap's: the same, none, Vehicle or a guess; any with other_types.
function snapTypeOk(s, i) {
  var b = D.base || D, m = MODE_IDX[s.mode];
  return b.mode[i] === m || !!MR_OPEN[MODES[b.mode[i]]] || !!(b.est[i] & GUESSED) || !!s.other_types;
}
function snapCanTake(i) { var b = D.base || D; return !isDup(i) && MODES[b.mode[i]] !== 'FLYING' && !(D.mrRoute && D.mrRoute[i]); }
// After the routines (a routine's trips stay its own), before the corrections (a fix on a trip wins).
function mrApplySnaps() {
  D.mrSnap = [];
  var L = mrActive('snaps').filter(snapOk), n = D.day.length, b = D.base;
  L.forEach(function (s) { MR_COUNT[s.id] = 0; MR_LEFT[s.id] = { type: 0, line: 0 }; });
  if (!L.length) return;
  for (var i = 0; i < n; i++) {
    if (!snapCanTake(i)) continue;
    var best = null, bsc = -1, bsn = null, near = null;
    for (var k = 0; k < L.length; k++) {
      var s = L[k], d = snapDir(s, i, snapRad(s, 'from'), snapRad(s, 'to'));
      if (!d) continue;
      if (!snapTypeOk(s, i)) { near = near || { s: s, why: 'type' }; continue; }
      var pts = snapPts(s), sc = mrLineScore(i, pts);
      if (sc < mrMatchMin(s)) { if (!near || near.why === 'type') near = { s: s, why: 'line' }; continue; }
      var sn = mrSnapTrip(i, pts);
      if (sn && sc > bsc) { best = s; bsc = sc; bsn = sn; bsn.dir = d; }
    }
    if (best) {
      bsn.rule = best.id; bsn.score = bsc; bsn.snap = true;
      D.snap[i] = bsn; D.km[i] = bsn.km; D.mrSnap[i] = { rule: best.id, dir: bsn.dir };
      MR_COUNT[best.id]++;
      var mi = MODE_IDX[best.mode];
      if (mi !== b.mode[i]) {
        D.mode[i] = mi;
        D.est[i] &= ~GUESSED;
        if (D.sport[i] && SPORTS[D.sport[i]][2] !== best.mode) D.sport[i] = 0;
        if (D.stype) D.stype[i] = '';
        D.mrMode[i] = { rule: best.id, was: MODES[b.mode[i]], guessed: !!(b.est[i] & GUESSED), inf: true };
      }
    } else if (near) MR_LEFT[near.s.id][near.why]++;
  }
}
// The line in MyRules' list.
function snapRuleRow(s) {
  var left = D && MR_LEFT[s.id] || { type: 0, line: 0 }, bits = [];
  bits.push(esc(s.from_name || 'Start') + ' ⇄ ' + esc(s.to_name || 'End'));
  bits.push(esc(LABEL[s.mode] || s.mode) + (s.line && s.line.name ? ', ' + esc(s.line.name.replace(/^Along the [a-z ]+? (via|\()/, '$1').replace(/^\(|\)$/g, '')) : ''));
  bits.push('trips that follow it for ' + mrMatchMin(s) + '% or more' + (left.line ? ' (' + fmt(left.line) + ' below)' : ''));
  if (left.type) bits.push(fmt(left.type) + ' left out: your files give them another type (turn on Other types to take them)');
  if (!snapOk(s)) bits.push('It has no line or ends, so it takes no trips');
  return mrRuleRow('snaps', s, s.name || s.id, bits, s.mode || 'OTHER', s.mode ? modeColor(s.mode) : '#9aa49d', D ? MR_COUNT[s.id] || 0 : null);
}

// ---------- making one ----------
// SN while you make or edit one: phase 'pick' (tapping the two ends) or 'edit' (the panel).
var SN = null;
function snapStart(r) {
  if (!D) { toast('Load your Timeline file first'); return; }
  if (!packCodes().length) { toast('Map snaps follow the lines of a station pack: add one in Menu › Trip cleanup first'); return; }
  closeSheets(true);
  if (PREFS.proj !== 'merc') setProj('merc');
  setTab('map');
  if (!initMap()) return;
  snapEnd();
  SN = { r: r || null, a: null, b: null, marks: L.layerGroup().addTo(map) };
  // Only the map, the bar and the snap's own panel while you make it: no top bar, tabs or map buttons.
  document.body.classList.add('snap-mode');
  if (typeof chartPanelClose === 'function') chartPanelClose();
  if (r && snapOk(r)) {
    SN.a = { lat: r.from[0], lng: r.from[1], name: r.from_name || 'Start' };
    SN.b = { lat: r.to[0], lng: r.to[1], name: r.to_name || 'End' };
    snapPanel();
    return;
  }
  snapPickBar();
}
// The bar over the map while you tap the ends.
function snapPickBar() {
  SN.phase = 'pick';
  var bar = $('snapBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'snapBar'; bar.className = 'snap-bar'; bar.setAttribute('role', 'status');
    bar.innerHTML = '<span class="snap-bar-t"></span><button type="button" class="btn quiet">Cancel</button>';
    bar.querySelector('button').addEventListener('click', snapEnd);
    document.body.appendChild(bar);
  }
  bar.hidden = false;
  snapBarText();
}
function snapBarText() {
  var t = $('snapBar') && $('snapBar').querySelector('.snap-bar-t');
  if (t) t.innerHTML = !SN.a ? icon('pin') + '<span><b>New map snap</b>Tap the station or stop it starts at</span>' : icon('pin') + '<span><b>From ' + esc(SN.a.name) + '</b>Now tap the one it goes to</span>';
}
// A tap on the map while picking: the nearest station or stop of the packs within 1 km.
function snapTap(ll) {
  if (!SN || SN.phase !== 'pick') return false;
  // A railway station wins over a tram or metro stop up to 300 m nearer (the metro station under a
  // railway station often has a name of its own).
  var st = packStation(ll.lat, ll.lng, 1, 15), rw = st && !(st.k & 1) && packStation(ll.lat, ll.lng, Math.min(1, st.d + 0.3), 1);
  if (rw) st = rw;
  if (!st || !st.name) { toast('No station or stop of your packs near there'); return true; }
  var e = { lat: st.lat, lng: st.lng, name: st.name };
  if (SN.a && km([SN.a.lat, SN.a.lng], [e.lat, e.lng]) < 0.3) { toast('Pick another station for the other end'); return true; }
  L.circleMarker([e.lat, e.lng], { radius: 7, color: '#fff', weight: 2, fillColor: cssVar('--accent') || '#c25228', fillOpacity: 1 }).bindTooltip(esc(e.name), { permanent: true, direction: 'top', offset: [0, -8], className: 'snap-tip' }).addTo(SN.marks);
  if (!SN.a) { SN.a = e; snapBarText(); return true; }
  SN.b = e;
  $('snapBar').hidden = true;
  snapPanel();
  return true;
}
// The ways of each type between the two ends, from the packs.
function snapWays() {
  SN.ways = {};
  SNAP_MODES.forEach(function (m) {
    var w = packLines(m, [SN.a.lat, SN.a.lng], [SN.b.lat, SN.b.lng]);
    if (w.length) SN.ways[m] = w;
  });
}
function snapPanel() {
  SN.phase = 'edit';
  snapWays();
  var r = SN.r, modes = SNAP_MODES.filter(function (m) { return SN.ways[m]; });
  SN.mode = r && SN.ways[r.mode] ? r.mode : modes[0] || null;
  SN.way = 0;
  if (r && r.line && SN.mode === r.mode) {
    // The way it was saved with, when the packs still have it; else its own line, as it was.
    var k = SN.ways[SN.mode].findIndex(function (w) { return w.polyline === r.line.polyline; });
    if (k >= 0) SN.way = k; else SN.ways[SN.mode] = [{ name: r.line.name || 'Its line', pts: snapPts(r), km: 0, polyline: r.line.polyline, saved: true }].concat(SN.ways[SN.mode]);
  }
  SN.match = r ? mrMatchMin(r) : MR_MATCH;
  SN.ra = r ? snapRad(r, 'from') * 1000 : SNAP_RAD;
  SN.rb = r ? snapRad(r, 'to') * 1000 : SNAP_RAD;
  SN.other = !!(r && r.other_types);
  var name = r ? r.name || '' : '';
  mrAsk({
    side: true,
    title: r ? 'Edit map snap' : 'New map snap',
    text: 'Your trips between <b>' + esc(SN.a.name) + '</b> and <b>' + esc(SN.b.name) + '</b>, both ways, drawn along one line of your station packs. Solid trips follow it closely enough and take it; dashed ones keep their own path.',
    extra: '<div class="mr-form">' +
      (modes.length ? '<div class="seg full" role="group" aria-label="Type" id="snapMode">' + modes.map(function (m) { return '<button type="button" data-m="' + m + '" aria-pressed="' + (m === SN.mode) + '">' + icon(m) + esc(LABEL[m] || m) + '</button>'; }).join('') + '</div>' +
        '<label class="field"><span>Way</span><select id="snapWay"></select></label>' :
        '<p class="fine mr-warn">Your station packs have no railway, tram or metro line between these two. Pick other ends.</p>') +
      '<label class="field"><span>Name</span><input type="text" id="snapName" value="' + esc(name) + '" placeholder="' + esc(snapDefaultName()) + '"></label>' +
      '<div class="mr-ghost-map" id="snapMap"></div>' +
      '<label class="field mr-match"><span>Within <b class="num" id="snapRaV"></b> of ' + esc(SN.a.name) + '</span><input type="range" id="snapRa" min="100" max="2000" step="50" value="' + SN.ra + '"></label>' +
      '<label class="field mr-match"><span>Within <b class="num" id="snapRbV"></b> of ' + esc(SN.b.name) + '</span><input type="range" id="snapRb" min="100" max="2000" step="50" value="' + SN.rb + '"></label>' +
      '<label class="field mr-match"><span>Follow the line for at least <b class="num" id="snapMatchV"></b></span><input type="range" id="snapMatch" min="10" max="100" step="5" value="' + SN.match + '"></label>' +
      '<label class="toggle-row"><span class="lbl">Other types too' + infoBtn('snapOtherInfo', 'About other types') + '</span><input type="checkbox" class="switch" id="snapOther"' + (SN.other ? ' checked' : '') + '></label>' +
      infoBox('snapOtherInfo', 'Also trips your files give another type (a bus, a car), which then become ' + esc((LABEL[SN.mode] || 'this type').toLowerCase()) + '. Without it, only trips of this type, with no type, Vehicle or a guessed one.') +
      '<small class="fine" id="snapTxt" aria-live="polite"></small>' +
      '<button type="button" class="btn quiet" id="snapRepick">' + icon('pin') + 'Pick other ends</button></div>',
    buttons: [[r ? 'Save' : 'Save map snap', 'primary', snapSave], ['Cancel', 'quiet', null]],
    after: function () {
      $('snapMap').hidden = MR_SIDE;
      $('snapRepick').onclick = function () { var keep = SN; keep.phase = 'pick'; $('mrDlg').close(); snapStart(); };
      var mb = $('snapMode');
      if (mb) mb.onclick = function (ev) { var b = ev.target.closest('[data-m]'); if (!b) return; SN.mode = b.dataset.m; SN.way = 0; setPressed('#snapMode button', function (x) { return x.dataset.m === SN.mode; }); snapFillWays(); snapDraw(true); };
      if ($('snapWay')) $('snapWay').onchange = function () { SN.way = +this.value; snapDraw(true); };
      $('snapRa').oninput = function () { SN.ra = +this.value; snapDraw(); };
      $('snapRb').oninput = function () { SN.rb = +this.value; snapDraw(); };
      $('snapMatch').oninput = function () { SN.match = +this.value; snapDraw(); };
      $('snapOther').onchange = function () { SN.other = this.checked; snapDraw(); };
      snapFillWays();
      snapMapStart();
      snapDraw(true);
    }
  });
}
function snapDefaultName() { return (LABEL[SN.mode] || 'Line') + ' ' + SN.a.name + ' – ' + SN.b.name; }
function snapFillWays() {
  var sel = $('snapWay'), L = SN.mode && SN.ways[SN.mode] || [];
  if (!sel) return;
  sel.innerHTML = L.map(function (w, k) { return '<option value="' + k + '">' + esc(w.name.replace(/ \([^)]*station pack\)$/, '')) + (w.km ? ' · ' + dist(w.km) : '') + '</option>'; }).join('');
  sel.value = String(SN.way);
  sel.disabled = L.length < 2;
  var nm = $('snapName');
  if (nm) nm.placeholder = snapDefaultName();
}
// The map the preview goes on: the main one beside the panel (its other layers off), or a small
// one in the dialog on a phone.
function snapMapStart() {
  if (MR_SIDE) {
    SN.map = map; SN.main = true;
    if (!map.getPane('mrg')) { map.createPane('mrg'); map.getPane('mrg').style.zIndex = 460; }
    if (!MR_GHOST_R) MR_GHOST_R = L.svg({ pane: 'mrg' });
    SN.dim = L.rectangle([[-89, -720], [89, 720]], { pane: 'mrg', renderer: MR_GHOST_R, stroke: false, fillColor: cssVar('--bg') || '#f7f2ee', fillOpacity: .72, interactive: false }).addTo(map);
    layerToggles();
  } else {
    SN.map = L.map($('snapMap'), { zoomControl: false, attributionControl: true, preferCanvas: true });
    SN.map.setView([SN.a.lat, SN.a.lng], 11, { animate: false });
    addTiles(SN.map);
  }
  SN.layer = L.layerGroup().addTo(SN.map);
}
function snapOpt(x) { return SN.main ? L.Util.extend({ pane: 'mrg', renderer: MR_GHOST_R, interactive: false }, x) : L.Util.extend({ interactive: false }, x); }
// The rule the panel would save, as it is now.
function snapDraft() {
  var w = SN.mode && SN.ways[SN.mode] && SN.ways[SN.mode][SN.way];
  if (!w) return null;
  var s = {
    id: SN.r ? SN.r.id : mrNewId(($('snapName') && $('snapName').value.trim()) || snapDefaultName()),
    name: ($('snapName') && $('snapName').value.trim()) || snapDefaultName(),
    mode: SN.mode, from: [+SN.a.lat.toFixed(5), +SN.a.lng.toFixed(5)], to: [+SN.b.lat.toFixed(5), +SN.b.lng.toFixed(5)],
    from_name: SN.a.name, to_name: SN.b.name, radius_m: SN.ra === SN.rb ? SN.ra : { from: SN.ra, to: SN.rb },
    line: { polyline: w.polyline, name: w.name.replace(/ \([^)]*station pack\)$/, '') }
  };
  if (SN.match !== MR_MATCH) s.match = SN.match;
  if (SN.other) s.other_types = true;
  if (SN.r && SN.r.enabled === false) s.enabled = false;
  return s;
}
// The preview: the line, the two ends and their radius, and your trips between them, solid when
// they would take the line and dashed when not.
function snapDraw(fit) {
  if (!SN || !SN.layer) return;
  $('snapRaV').textContent = dist(SN.ra / 1000);
  $('snapRbV').textContent = dist(SN.rb / 1000);
  $('snapMatchV').textContent = SN.match + '%';
  SN.layer.clearLayers();
  var s = snapDraft(), col = SN.mode ? cssVar((modeColor(SN.mode).match(/--[\w-]+/) || [''])[0]) || '#1baf7a' : '#1baf7a', bounds = L.latLngBounds([[SN.a.lat, SN.a.lng], [SN.b.lat, SN.b.lng]]);
  [SN.a, SN.b].forEach(function (e, k) {
    L.circle([e.lat, e.lng], snapOpt({ radius: k ? SN.rb : SN.ra, color: col, weight: 1.5, dashArray: '4 4', fillOpacity: .06 })).addTo(SN.layer);
    L.circleMarker([e.lat, e.lng], snapOpt({ radius: 6, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1 })).addTo(SN.layer);
  });
  var on = 0, off = 0, become = 0, typeOut = 0, other = 0;
  if (s) {
    var pts = snapPts(s);
    pts.forEach(function (p) { bounds.extend(p); });
    for (var i = 0; i < D.day.length; i++) {
      if (!snapCanTake(i) || !snapDir(s, i, SN.ra / 1000, SN.rb / 1000)) continue;
      if (!snapTypeOk(s, i)) { typeOut++; continue; }
      if (D.mrSnap && D.mrSnap[i] && D.mrSnap[i].rule !== s.id) { other++; continue; }
      var own = mrTripPts(i);
      if (own.length < 2) continue;
      var ok = mrLineScore(i, pts) >= SN.match && !!mrSnapTrip(i, pts);
      if (ok) { on++; if ((D.base || D).mode[i] !== MODE_IDX[s.mode]) become++; } else off++;
      L.polyline(own, snapOpt(ok ? { color: col, weight: 3, opacity: SN.main ? .35 : .25 } : { color: '#8a8f8c', weight: 2.5, opacity: .5, dashArray: '4 5' })).addTo(SN.layer);
    }
    L.polyline(pts, snapOpt({ color: '#fff', weight: 8, opacity: .9 })).addTo(SN.layer);
    L.polyline(pts, snapOpt({ color: col, weight: 4.5, opacity: 1 })).addTo(SN.layer);
  }
  $('snapTxt').innerHTML = !s ? '' : '<b>' + tripsText(on) + '</b> follow the line closely enough' + (off ? ' · ' + fmt(off) + ' below, dashed' : '') + (become ? ' · ' + fmt(become) + ' would become ' + esc((LABEL[s.mode] || s.mode).toLowerCase()) : '') +
    (typeOut ? ' · ' + fmt(typeOut) + ' of another type left out' : '') + (other ? ' · ' + fmt(other) + ' taken by another map snap' : '') + '.';
  if (fit) {
    if (SN.main) map.fitBounds(bounds, { paddingTopLeft: [40, 40], paddingBottomRight: [$('mrDlg').offsetWidth + 40, 40], maxZoom: 15 });
    else { SN.map.invalidateSize(); SN.map.fitBounds(bounds, { padding: [16, 16], maxZoom: 15, animate: false }); }
  }
}
function snapSave() {
  var s = snapDraft();
  if (!s) { toast('Pick ends that a line joins first'); return; }
  mrEnsure();
  var list = MR.doc.snaps || (MR.doc.snaps = []), k = SN.r ? list.indexOf(SN.r) : -1;
  if (k >= 0) list[k] = s; else list.push(s);
  if (MR.doc.myrules < MR_VER) { MR.doc.myrules = MR_VER; MR.doc.$schema = MR_SCHEMA; }
  mrChange((k >= 0 ? 'Map snap changed: ' : 'Map snap added: ') + s.name);
  toast(s.name + ': ' + tripsText(MR_COUNT[s.id] || 0) + ' snapped.');
}
// Off the map: the preview, the picked ends, the bar; the main map's layers back.
function snapEnd() {
  if (!SN) return;
  var was = SN;
  SN = null;
  document.body.classList.remove('snap-mode');
  if (was.layer) was.layer.remove();
  if (was.dim) was.dim.remove();
  if (was.marks) was.marks.remove();
  if (was.map && !was.main) was.map.remove();
  if ($('snapBar')) $('snapBar').hidden = true;
  if (map) layerToggles();
}
$('snapNewBtn').addEventListener('click', function () { snapStart(); });

// ---------- train trips along the tracks ----------
// With "Snap train trips to the tracks" on (Menu › Trip cleanup), every train trip that no
// routine, map snap or correction drew is drawn along the railway of the installed packs: from the
// railway station nearest its start (within TRACK_END_KM) to the one nearest its end, along whichever
// of packLines' ways its GPS points follow best. A train's ends and points are often off by some way
// (a late fix after a tunnel, a station a few hundred metres from where the phone woke), so its
// points count as on a way within TRACK_KM, and it takes the way when TRACK_MIN % of them are.
// The ways between two stations are worked out once (PK.tw), and which one each trip follows (PK.th). Applied after MyRules, also with no
// rules file loaded; it changes the line and the distance, never the type.
var TRACK_END_KM = 3, TRACK_KM = 0.6, TRACK_MIN = 70;
function trackOn() { return !!PREFS.trackSnap && packCodes().length > 0; }
function trackScore(i, L) {
  var own = mrTripPts(i), step = Math.max(1, Math.ceil(own.length / 40)), cnt = 0, on = 0;
  for (var q = 0; q < own.length; q += step) { cnt++; if (mrToLine(own[q], L).d <= TRACK_KM) on++; }
  return cnt ? Math.round(100 * on / cnt) : 0;
}
function trackWays(sa, sb) {
  var P = packIndex(), tw = P.tw || (P.tw = new Map()), k = [sa.lat, sa.lng, sb.lat, sb.lng].join(',');
  if (!tw.has(k)) tw.set(k, packLines('TRAIN', [sa.lat, sa.lng], [sb.lat, sb.lng]));
  return tw.get(k);
}
function* mrTrackSteps() {
  D.mrTrack = [];
  if (trackOn()) yield* mrTrackTrips();
  trackSettings();
}
function* mrTrackTrips() {
  var n = D.day.length, T = MODE_IDX.TRAIN;
  for (var i = 0; i < n; i++) {
    if (D.mode[i] !== T || D.snap[i] || isDup(i) || D.mrHide && D.mrHide[i] || D.pathOff[i + 1] - D.pathOff[i] < 3) continue;
    // A train trip can take a while (the ways between two new stations), so the loader gets a turn.
    yield;
    var a = [D.from[2 * i], D.from[2 * i + 1]], z = [D.to[2 * i], D.to[2 * i + 1]];
    if (!isFinite(a[0]) || !isFinite(z[0]) || km(a, z) < 2) continue;
    var sa = packStation(a[0], a[1], TRACK_END_KM, 1 | 8), sb = sa && packStation(z[0], z[1], TRACK_END_KM, 1 | 8);
    if (!sb || km([sa.lat, sa.lng], [sb.lat, sb.lng]) < 1) continue;
    var ways = trackWays(sa, sb), best = null, bsc = -1, hk = D.start[i] + ',' + D.end[i] + ',' + sa.name + ',' + sb.name, P = packIndex(), th = P.th || (P.th = new Map()), hit = th.get(hk);
    if (hit) { best = ways[hit[0]]; bsc = hit[1]; }
    else {
      for (var k = 0; k < ways.length; k++) {
        var sc = trackScore(i, ways[k].pts);
        if (sc > bsc || sc === bsc && ways[k].km < best.km) { bsc = sc; best = ways[k]; }
      }
      th.set(hk, [ways.indexOf(best), bsc]);
    }
    if (!best || bsc < TRACK_MIN) continue;
    var sn = mrSnapTrip(i, best.pts, TRACK_END_KM);
    if (!sn) continue;
    sn.track = true; sn.score = bsc;
    D.snap[i] = sn; D.km[i] = sn.km;
    D.mrTrack[i] = { name: best.name.replace(/ \([^)]*station packs?\)$/, ''), from: sa.name, to: sb.name, score: bsc, packs: best.packs };
  }
}
function trackSettings() {
  var el = $('trackSnap');
  if (!el) return;
  el.checked = !!PREFS.trackSnap;
  el.disabled = !packCodes().length;
  var n = 0;
  if (D && D.mrTrack) D.mrTrack.forEach(function (x) { if (x) n++; });
  $('trackNote').textContent = !packCodes().length ? 'Add a country first.' : PREFS.trackSnap ? (D ? tripsText(n) + ' drawn along the railway.' : '') : '';
}
$('trackSnap').addEventListener('change', function () {
  var on = this.checked;
  working(on ? 'Snapping train trips to the tracks…' : 'Taking train trips off the tracks…', function () {
    PREFS.trackSnap = on; savePrefs();
    mrReapply();
    trackSettings();
  });
});
