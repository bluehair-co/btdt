// ---------- places Google moved ----------
// Timeline keeps one location per place, today's. When a place moves (an employer relocating) and
// Google keeps its place ID, every old stay there shows at the new address. When a file is read,
// movedPlaces (parser.js) puts those stays back where your phone's GPS was, when that is clear, and
// keeps Google's location in vgoog. On top of that, MyRules moves (MR.doc.moves, one rule per place
// that moved, by Google's place IDs):
// - { google_place_ids, at, when: { from, to } }: you say where the place was then (This place
//   moved… on its page). Its stays in those dates go to at.
// - { google_place_ids, keep: true }: Use Google's location: the stays BT•DT moved go back.
// A stay's move takes the ends of the trips arriving within MV_END_MS before it starts, or leaving
// within MV_END_MS after it ends, that are within MV_END_KM of where the stay was, along with the
// first or last point of their trail there; their distance changes by what the end moved.
// D.mvStay[v]: { rule, keep } for each stay a rule moved. MR_COUNT counts them by rule.
var MV_END_MS = 6e5, MV_END_KM = 0.2;
function mvRules() {
  return mrActive('moves').filter(function (r) {
    return Array.isArray(r.google_place_ids) && r.google_place_ids.length && (r.keep === true || Array.isArray(r.at) && isFinite(+r.at[0]) && isFinite(+r.at[1]));
  });
}
function mvWhenOk(r, v) {
  var w = r.when || {}, f = mrDayNum(w.from), t = mrDayNum(w.to), d = D.vday[v];
  return (f == null || d >= f) && (t == null || d <= t);
}
// Google's location for a stay: where Timeline put it, before BT•DT moved it.
function mvGoogle(v) {
  var g = D.vgoog, b = D.base && D.base.vll || D.vll;
  return g && isFinite(g[2 * v]) ? [g[2 * v], g[2 * v + 1]] : [b[2 * v], b[2 * v + 1]];
}
function mvAuto(v) { return !!(D.vgoog && isFinite(D.vgoog[2 * v])); }
function mrApplyMoves() {
  D.mvStay = {};
  var L = mvRules(), b = D.base, by = {}, moved = [], v;
  L.forEach(function (r) { MR_COUNT[r.id] = 0; r.google_place_ids.forEach(function (id) { (by[id] = by[id] || []).push(r); }); });
  if (!L.length) return;
  for (v = 0; v < D.vs.length; v++) {
    var R = D.vpid[v] && by[D.vpid[v]];
    if (!R) continue;
    // Where you said it was wins over keeping Google's location; of those, the later rule.
    var pick = null;
    R.forEach(function (r) { if (!r.keep && mvWhenOk(r, v)) pick = r; });
    if (!pick && mvAuto(v)) R.forEach(function (r) { if (r.keep) pick = r; });
    if (!pick) continue;
    var to = pick.keep ? mvGoogle(v) : [+pick.at[0], +pick.at[1]], from = [D.vll[2 * v], D.vll[2 * v + 1]];
    D.mvStay[v] = { rule: pick.id, keep: !!pick.keep };
    MR_COUNT[pick.id]++;
    if (km(to, from) > 0.001) moved.push({ v: v, to: to, from: from });
  }
  if (!moved.length) return;
  D.vll = Float32Array.from(D.vll);
  moved.forEach(function (x) { D.vll[2 * x.v] = x.to[0]; D.vll[2 * x.v + 1] = x.to[1]; });
  // The trips to and from them.
  if (D.from === b.from) D.from = Float32Array.from(b.from);
  if (D.to === b.to) D.to = Float32Array.from(b.to);
  if (D.pathPts === b.pathPts) D.pathPts = Float32Array.from(b.pathPts);
  var S = moved.slice().sort(function (p, q) { return D.vs[p.v] - D.vs[q.v]; }), E = moved.slice().sort(function (p, q) { return D.ve[p.v] - D.ve[q.v]; });
  function near(list, key, t) {
    var lo = 0, hi = list.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (key[list[m].v] < t - MV_END_MS) lo = m + 1; else hi = m; }
    var out = [];
    for (; lo < list.length && key[list[lo].v] <= t + MV_END_MS; lo++) out.push(list[lo]);
    return out;
  }
  function moveEnd(i, end, x) {
    var o = end ? D.to : D.from, old = [o[2 * i], o[2 * i + 1]];
    if (!isFinite(old[0]) || km(old, x.from) > MV_END_KM) return false;
    o[2 * i] = x.to[0]; o[2 * i + 1] = x.to[1];
    var a = D.pathOff[i], z = D.pathOff[i + 1] - 1, q = end ? z : a, nb;
    if (z >= a && km([D.pathPts[2 * q], D.pathPts[2 * q + 1]], old) < 0.05) { D.pathPts[2 * q] = x.to[0]; D.pathPts[2 * q + 1] = x.to[1]; }
    var q2 = end ? z - 1 : a + 1;
    nb = z > a ? [D.pathPts[2 * q2], D.pathPts[2 * q2 + 1]] : end ? [D.from[2 * i], D.from[2 * i + 1]] : [D.to[2 * i], D.to[2 * i + 1]];
    if (isFinite(nb[0])) D.km[i] = Math.max(0, D.km[i] + km(x.to, nb) - km(old, nb));
    return true;
  }
  for (var i = 0; i < D.start.length; i++) {
    near(S, D.vs, D.end[i]).some(function (x) { return D.vs[x.v] >= D.end[i] - MV_END_MS && moveEnd(i, 1, x); });
    near(E, D.ve, D.start[i]).some(function (x) { return moveEnd(i, 0, x); });
  }
}

// ---------- reading where a place was ----------
// "52.0786, 4.3358", a Google Maps link (its !3d…!4d… pin, else its @lat,lng view), or a plus code:
// full (9F4638HP+C8) or short (38HP+C8, The Hague), the short one recovered near ref as Open Location
// Code says (the town after it isn't looked up: the place is near ref anyway).
var OLC = '23456789CFGHJMPQRVWX';
function olcDecode(code) {
  var c = code.toUpperCase().replace('+', '').replace(/0+$/, ''), lat = -90, lng = -180, r = 20, la = 0, lo = 0, i, a, b;
  if (c.length < 2 || c.length % 2 && c.length < 10) return null;
  for (i = 0; i < c.length && i < 10; i += 2) {
    a = OLC.indexOf(c[i]); b = OLC.indexOf(c[i + 1]);
    if (a < 0 || b < 0) return null;
    lat += a * r; lng += b * r; la = lo = r; r /= 20;
  }
  for (i = 10; i < c.length; i++) {
    a = OLC.indexOf(c[i]);
    if (a < 0) return null;
    la /= 5; lo /= 4; lat += Math.floor(a / 4) * la; lng += (a % 4) * lo;
  }
  return [lat + la / 2, lng + lo / 2];
}
function olcEncode8(lat, lng) {
  var y = Math.min(Math.max(lat + 90, 0), 179.9999999), x = ((lng + 180) % 360 + 360) % 360, r = 20, out = '';
  for (var k = 0; k < 4; k++) { var a = Math.floor(y / r), b = Math.floor(x / r); y -= a * r; x -= b * r; out += OLC[a] + OLC[b]; r /= 20; }
  return out;
}
function olcRecover(code, ref) {
  var s = code.toUpperCase(), sep = s.indexOf('+');
  if (sep >= 8) return olcDecode(s);
  if (sep < 2 || sep % 2 || !ref) return null;
  var pad = 8 - sep, res = Math.pow(20, 2 - pad / 2), half = res / 2, c = olcDecode(olcEncode8(ref[0], ref[1]).slice(0, pad) + s);
  if (!c) return null;
  if (ref[0] + half < c[0] && c[0] - res >= -90) c[0] -= res; else if (ref[0] - half > c[0] && c[0] + res <= 90) c[0] += res;
  if (ref[1] + half < c[1]) c[1] -= res; else if (ref[1] - half > c[1]) c[1] += res;
  return c;
}
function mvParseAt(text, ref) {
  var t = String(text || '').trim(), m, ok = function (p) { return p && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180 ? [+p[0].toFixed(6), +p[1].toFixed(6)] : null; };
  if ((m = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(t))) return ok([+m[1], +m[2]]);
  if ((m = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(t))) return ok([+m[1], +m[2]]);
  if ((m = /^(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)$/.exec(t))) return ok([+m[1], +m[2]]);
  if ((m = /([23456789CFGHJMPQRVWX0]{2,8}\+[23456789CFGHJMPQRVWX]{0,7})/i.exec(t))) return ok(olcRecover(m[1], ref));
  return null;
}

// ---------- on a place's page ----------
function mvRulesFor(ids) {
  return mrList('moves').filter(function (r) { return Array.isArray(r.google_place_ids) && r.google_place_ids.some(function (id) { return ids.indexOf(id) >= 0; }); });
}
function mvPids(vs) {
  var seen = {}, out = [];
  vs.forEach(function (v) { var p = D.vpid[v]; if (p && !seen[p]) { seen[p] = 1; out.push(p); } });
  return out;
}
function mvSpan(vs) {
  var a = Infinity, z = -Infinity;
  vs.forEach(function (v) { a = Math.min(a, D.vday[v]); z = Math.max(z, D.vday[v]); });
  return a === z ? 'on ' + niceDate(a) : niceDate(a) + ' – ' + niceDate(z);
}
function mvWhen(w) {
  var f = mrDayNum(w && w.from), t = mrDayNum(w && w.to);
  return f != null && t != null ? 'from ' + niceDate(f) + ' to ' + niceDate(t) : t != null ? 'until ' + niceDate(t) : f != null ? 'since ' + niceDate(f) : 'on all your visits';
}
function mvStays(n) { return fmt(n) + ' stay' + (n === 1 ? '' : 's'); }
// This place moved… is offered for a spot with Google place IDs that has no move rule yet.
function mvCanNew(key) {
  var ids = mvPids(spotStays(key));
  return ids.length > 0 && !mvRulesFor(ids).some(function (r) { return !r.keep; });
}
function mvSpotHtml(key) {
  var vs = spotStays(key), ids = mvPids(vs);
  if (!ids.length) return '';
  var on = MR && MR.on, auto = vs.filter(mvAuto), R = mvRulesFor(ids), keep = R.filter(function (r) { return r.keep && r.enabled !== false; })[0], h = '';
  if (auto.length) {
    var phone = D.base.vll, d = km(mvGoogle(auto[0]), [phone[2 * auto[0]], phone[2 * auto[0] + 1]]);
    if (keep && on) h += '<p class="fine">' + infoMore('Shown at Google\'s location for this place, as you chose.', 'During ' + mvStays(auto.length) + ' here (' + mvSpan(auto) + ') your phone was ' + dist(d) + ' away.') + '</p>' +
      '<div class="mv-acts"><button type="button" class="btn" data-mv-unkeep="' + esc(keep.id) + '" data-key="' + esc(key) + '">' + icon('pin') + 'Show where my phone was</button></div>';
    else h += '<p class="fine">' + infoMore('Google now puts this place ' + dist(d) + ' from where your phone was.', 'That was during ' + mvStays(auto.length) + ' here (' + mvSpan(auto) + '). It most likely moved and kept its Google place ID, so those stays and the trips to and from them are shown where your phone was.') + '</p>' +
      '<div class="mv-acts"><button type="button" class="btn quiet" data-mv-keep="' + esc(key) + '">Use Google\'s location</button></div>';
  }
  R.filter(function (r) { return !r.keep; }).forEach(function (r) {
    var n = vs.filter(function (v) { return D.mvStay && D.mvStay[v] && D.mvStay[v].rule === r.id; }).length;
    var g = mvGoogle(vs[0]), d = Array.isArray(r.at) ? km(g, r.at) : 0;
    h += '<p class="fine">You said this place was ' + dist(d) + ' from Google\'s location ' + mvWhen(r.when) +
      (on && r.enabled !== false ? ': ' + mvStays(n) + ' here are shown there.' : r.enabled === false ? ' (switched off).' : ', but MyRules are switched off.') + '</p>' +
      '<div class="mv-acts"><button type="button" class="btn" data-mv-edit="' + esc(r.id) + '" data-key="' + esc(key) + '">' + icon('edit') + 'Edit where it was</button></div>';
  });
  // Nothing to say: This place moved… is in the page's ⋯ menu (placeActs, mvCanNew).
  return h ? '<h4 class="place-h">Where it was</h4>' + h : '';
}
function mvName(key) {
  var s = spotsOf(spotStays(key))[0];
  return s ? spotName(s, 0) : 'this place';
}
function mvSave(r, isNew, text, key) {
  if (isNew) (MR.doc.moves || (MR.doc.moves = [])).push(r);
  mrUseV2();
  var vs = spotStays(key);
  placeLast = null;
  mrChange(text);
  if (openId !== 'mrSheet') mrReopenSpot(vs);
}
// Use Google's location: a keep rule for the spot's place IDs.
function mvKeep(key) {
  var ids = mvPids(spotStays(key)), nm = mvName(key);
  mrEnsure();
  var r = mvRulesFor(ids).filter(function (x) { return x.keep; })[0], isNew = !r;
  if (isNew) r = { id: mrNewId('google ' + nm), name: nm, google_place_ids: ids, keep: true };
  delete r.enabled;
  mvSave(r, isNew, 'Google\'s location kept: ' + nm, key);
}
function mvUnkeep(id, key) {
  var r = mrById(id);
  if (!r) return;
  MR.doc.moves = mrList('moves').filter(function (x) { return x !== r; });
  mvSave(r, false, 'Where your phone was, again: ' + (r.name || r.id), key);
}
var MV_MAP = null;
function mvDialog(key, r) {
  if (!window.L) { toast('The map couldn\'t load. Check your internet connection.'); return; }
  var vs = spotStays(key), ids = r ? r.google_place_ids : mvPids(vs);
  if (!ids || !ids.length) { toast('Load your Timeline file again: this place has no Google place ID yet'); return; }
  var g = mvGoogle(vs[0]), auto = vs.filter(mvAuto), base = D.base.vll;
  // The pin starts where it was (your rule), else where your phone was, else at Google's location.
  var pin = r && Array.isArray(r.at) ? [+r.at[0], +r.at[1]] : auto.length ? [base[2 * auto[0]], base[2 * auto[0] + 1]] : g.slice();
  var last = -Infinity;
  vs.forEach(function (v) { last = Math.max(last, D.vday[v]); });
  var w = r && r.when || {}, nm = r && r.name || mvName(key);
  mrAsk({
    title: 'This place moved',
    text: 'Put the pin where this place was when you went there.',
    info: 'Google keeps one location per place: today\'s. Your stays here in those dates, with the trips to and from them, move to where you put the pin.',
    extra: '<div class="mr-form"><div class="field"><span>When it was there</span><span class="mr-dates">From <input type="date" id="mvFrom" value="' + esc(w.from || '') + '" aria-label="From"> until <input type="date" id="mvTo" value="' + esc(w.to || (r ? '' : isFinite(last) ? isoDay(last) : '')) + '" aria-label="Until"></span>' +
      '<small class="fine">Leave a date empty for no limit on that side.</small></div>' +
      '<label class="field"><span>Where it was</span><input type="text" id="mvAt" placeholder="52.0786, 4.3358 · 38HP+C8 · a Google Maps link" autocomplete="off" spellcheck="false"></label>' +
      '<div id="mvMap" class="mv-map" role="application" aria-label="Map: tap where the place was"></div>' +
      '<p class="fine" id="mvInfo" aria-live="polite"></p></div>',
    buttons: [['Save', 'primary', function () {
      var f = $('mvFrom').value, t = $('mvTo').value;
      if (f && t && f > t) { toast('From is after Until'); return; }
      mrEnsure();
      var isNew = !r;
      if (isNew) r = { id: mrNewId('moved ' + nm), name: nm, google_place_ids: ids };
      r.at = [+pin[0].toFixed(6), +pin[1].toFixed(6)];
      delete r.keep;
      var wh = Object.assign({}, r.when);
      if (f) wh.from = f; else delete wh.from;
      if (t) wh.to = t; else delete wh.to;
      if (Object.keys(wh).length) r.when = wh; else delete r.when;
      mvSave(r, isNew, (isNew ? 'Place moved: ' : 'Place moved, changed: ') + nm + ' (' + mvWhen(r.when) + ')', key);
    }]].concat(r ? [['Remove', 'danger', function () {
      MR.doc.moves = mrList('moves').filter(function (x) { return x !== r; });
      mvSave(r, false, 'Place moved, removed: ' + nm, key);
    }]] : []).concat([['Cancel', 'quiet', null]]),
    after: function () {
      if (MV_MAP) { MV_MAP.remove(); MV_MAP = null; }
      var m = MV_MAP = L.map('mvMap', { zoomControl: false, attributionControl: true, preferCanvas: true });
      L.control.zoom({ position: 'topright' }).addTo(m);
      m.setView(pin, 15, { animate: false });
      addTiles(m);
      L.circleMarker(g, { radius: 6, color: '#fff', weight: 2, fillColor: '#8a918c', fillOpacity: 1 }).addTo(m).bindTooltip('Google\'s location now');
      var mk = L.circleMarker(pin, { radius: 9, color: '#fff', weight: 3, fillColor: '#0f7c8c', fillOpacity: 1, interactive: false }).addTo(m);
      function count() {
        var f = mrDayNum($('mvFrom').value), t = mrDayNum($('mvTo').value), n = 0;
        vs.forEach(function (v) { if ((f == null || D.vday[v] >= f) && (t == null || D.vday[v] <= t)) n++; });
        $('mvInfo').textContent = mvStays(n) + ' here in those dates · ' + dist(km(g, pin)) + ' from Google\'s location. Tap the map to move the pin.';
      }
      function put(p, pan) { pin = p; mk.setLatLng(p); if (pan) m.setView(p, Math.max(m.getZoom(), 16)); count(); }
      m.on('click', function (e) { put([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]); $('mvAt').value = pin[0] + ', ' + pin[1]; });
      $('mvAt').addEventListener('input', function () { var p = mvParseAt(this.value, g); if (p) put(p, true); });
      $('mvFrom').addEventListener('input', count);
      $('mvTo').addEventListener('input', count);
      setTimeout(function () { m.invalidateSize(); m.fitBounds(L.latLngBounds([g, pin]).pad(0.3), { maxZoom: 16, animate: false }); }, 0);
      count();
    }
  });
}
$('tripBody').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-mv-new],[data-mv-edit],[data-mv-keep],[data-mv-unkeep]');
  if (!b) return;
  if (b.dataset.mvNew) mvDialog(b.dataset.mvNew, null);
  else if (b.dataset.mvEdit) mvDialog(b.dataset.key, mrById(b.dataset.mvEdit));
  else if (b.dataset.mvKeep) { var k = b.dataset.mvKeep; saving(function () { mvKeep(k); }); }
  else { var u = b.dataset.mvUnkeep, uk = b.dataset.key; saving(function () { mvUnkeep(u, uk); }); }
});
// From the rules sheet: the dialog on the place's spot, found by its first place ID.
function mvEditRule(r) {
  if (r.keep) { toast('Switch it off or delete it to show where your phone was again'); return; }
  var ids = r.google_place_ids || [];
  for (var v = 0; v < D.vs.length; v++) if (ids.indexOf(D.vpid[v]) >= 0) { needPlaces(); mvDialog(spotKey(v), r); return; }
  toast('This place isn\'t in the data you loaded');
}
