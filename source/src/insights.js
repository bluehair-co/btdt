// ---------- insights ----------
function stat(label, value, unit, note) {
  return '<div class="stat"><div class="label">' + label + '</div><div class="value">' + value + (unit ? '<small>' + unit + '</small>' : '') + '</div>' + (note ? '<div class="note">' + note + '</div>' : '') + '</div>';
}
function hours(i) { return Math.max(0, D.end[i] - D.start[i]) / 36e5; }
function renderInsights() {
  var n = sel.length;
  $('insightsPage').querySelectorAll('.card').forEach(function (c) { if (c.id !== 'sumCard') c.hidden = !n; });
  if (!n) {
    $('sumStats').innerHTML = '<p class="empty" style="grid-column:1/-1">No trips match your filters.</p>';
    $('sumNote').textContent = '';
    return;
  }
  needPlaces(); findHome();
  renderSummary(); renderFar(); renderSplit(); renderRhythm(); renderTime(); renderRoutes(); renderPlaces(); renderSquares(); renderGear(); renderHeart(); renderRecords(); renderCountries(); renderCo2();
}
function renderSummary() {
  var n = sel.length, kmT = 0, h = 0, days = {}, places = {}, cc = {}, j, i;
  for (j = 0; j < n; j++) {
    i = sel[j]; kmT += D.km[i]; h += hours(i); days[D.day[i]] = 1;
    if (D.pb[i] >= 0) places[D.pb[i]] = 1;
    if (D.ccList[D.cs[i]]) cc[D.ccList[D.cs[i]]] = 1;
    if (D.ccList[D.ce[i]]) cc[D.ccList[D.ce[i]]] = 1;
  }
  for (j = 0; j < selV.length; j++) places[D.pv[selV[j]]] = 1;
  var nd = Object.keys(days).length, d0 = D.day[sel[0]], d1 = D.day[sel[n - 1]], span = d1 - d0 + 1, d = distParts(kmT), avg = distParts(kmT / n);
  $('sumNote').textContent = d0 === d1 ? longDate(d0) : niceDate(d0) + ' – ' + niceDate(d1);
  $('sumStats').innerHTML =
    stat('Trips', fmt(n), '', fmt(n / nd, 1) + ' on days you travelled') +
    stat('Distance', d.v, d.u, avg.v + ' ' + avg.u + ' per trip on average') +
    stat('Time travelling', hoursLabel(h).replace(/ min$/, '<small>min</small>').replace(/ h( |$)/, '<small>h</small>$1'), '', hoursLabel(h / nd) + ' a day you travelled') +
    stat('Days travelled', fmt(nd), '', span > 1 ? 'Out of ' + fmt(span) + ' days (' + Math.round(nd / span * 100) + '%)' : '') +
    stat('Countries', fmt(Object.keys(cc).length), '', '') +
    stat('Places', fmt(Object.keys(places).length), '', selV.length ? fmt(selV.length) + ' stays' : 'Where trips ended');
}

// ---------- how far is that? ----------
// The selection's distance as laps of the Earth (Magellan) and legs to the Moon and back (Armstrong).
// Mars counts at its closest, when launches to it are timed.
var EARTH_KM = 40075, MOON_KM = 384400, MARS_KM = 55e6;
function farPct(share) { return share > 0 && share < .01 ? '<1' : String(Math.floor(share * 100)); }
// One of the 24×24 icons, drawn at (x, y) as its centre and s wide, in an SVG.
function glyph(name, x, y, s, color, rot) {
  return '<path d="' + ICONS[name] + '" fill="' + color + '"' + (name === 'capsule' || name === 'moon' || name === 'rocket' || name === 'mars' ? ' fill-rule="evenodd"' : '') +
    ' transform="translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ')' + (rot ? ' rotate(' + rot.toFixed(1) + ')' : '') + ' scale(' + s / 24 + ') translate(-12,-12)"/>';
}
// A marker riding a track: a disc in the track's colour with a white icon, like the transport badges.
function rider(x, y, fill, color, name, s, rot, nudge) {
  return '<circle class="rider" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (s / 2).toFixed(1) + '" fill="' + fill + '"/>' + glyph(name, x, y + (nudge || 0) * .7, s * .66, '#fff', rot);
}
function polyD(pts) { return pts.map(function (p, k) { return (k ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(''); }
// One of the planets drawn in Figma, centred on (x, y) and s across.
function planet(name, x, y, s) { return '<use href="#art-' + name + '" x="' + (x - s / 2).toFixed(1) + '" y="' + (y - s / 2).toFixed(1) + '" width="' + s + '" height="' + s + '"/>'; }
// How wide the scores' drawings are, in px, and how big the planets are at that width.
function farWidth() { var w = $('farView').clientWidth - 32; return w > 100 ? w : 340; }
function farScale(w) { return Math.max(.72, Math.min(1, w / 700)); }
// Armstrong and Musk: a figure of eight W wide and 164 high, out of the left of the Earth and round the far
// planet (r is the radius of the turn round it). It is a semicircle at each end and two crossing curves
// between them, which stretch or squeeze to the width. The first half goes out over the top to the far side
// of the planet, the second half comes home underneath.
function makeEight(W, r) {
  var cy = 82, R = 72, lx = 89, rx = W - 17 - r, L = rx - lx, pts = [[lx - R, cy]], k, t;
  function arc(cx, rr, a0, a1) { for (k = 1; k <= 24; k++) { t = a0 + (a1 - a0) * k / 24; pts.push([cx + rr * Math.cos(t), cy + rr * Math.sin(t)]); } }
  function bez(a, b, c, d) { for (k = 1; k <= 60; k++) { t = k / 60; var u = 1 - t; pts.push([u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]]); } }
  var P = Math.PI;
  arc(lx, R, P, P * 1.5);
  bez([lx, cy - R], [lx + L * .34, cy - R], [lx + L * .6, cy + r + 5], [rx, cy + r]);
  arc(rx, r, P / 2, 0);
  arc(rx, r, 0, -P / 2);
  bez([rx, cy - r], [lx + L * .6, cy - r - 5], [lx + L * .34, cy + R], [lx, cy + R]);
  arc(lx, R, P / 2, P);
  var len = [0];
  for (k = 1; k < pts.length; k++) len.push(len[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  var d = 'M' + (lx - R) + ',' + cy + 'A' + R + ',' + R + ' 0 0 1 ' + lx + ',' + (cy - R) +
    'C' + (lx + L * .34).toFixed(1) + ',' + (cy - R) + ' ' + (lx + L * .6).toFixed(1) + ',' + (cy + r + 5) + ' ' + rx + ',' + (cy + r) +
    'A' + r + ',' + r + ' 0 0 0 ' + rx + ',' + (cy - r) +
    'C' + (lx + L * .6).toFixed(1) + ',' + (cy - r - 5) + ' ' + (lx + L * .34).toFixed(1) + ',' + (cy + R) + ' ' + lx + ',' + (cy + R) +
    'A' + R + ',' + R + ' 0 0 1 ' + (lx - R) + ',' + cy;
  return { pts: pts, len: len, d: d, rx: rx, cy: cy, W: W };
}
// The route up to fraction f: the points so far, where the rider is, and which way it points.
function loopAt(f, L) {
  var d = L.len[L.len.length - 1] * Math.max(0, Math.min(1, f)), k = 1;
  while (k < L.len.length - 1 && L.len[k] < d) k++;
  var a = L.pts[k - 1], b = L.pts[k], t = (d - L.len[k - 1]) / ((L.len[k] - L.len[k - 1]) || 1), p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { pts: L.pts.slice(0, k).concat([p]), x: p[0], y: p[1], ang: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI };
}
// The eight as an SVG, drawn W px wide: the route, the part travelled (fraction f), the Earth, the far planet and the rider.
function eightArt(f, far, farSize, r, cls, rideName, label) {
  var w = farWidth(), k = farScale(w), L = makeEight(w / k, r), at = loopAt(f, L);
  return '<svg class="far-art eight" viewBox="0 0 ' + L.W.toFixed(1) + ' 164" style="height:' + (164 * k).toFixed(1) + 'px" role="img" aria-label="' + label + '">' +
    '<path class="trk" d="' + L.d + '"/>' + planet('earth', 81, 82, 128) + planet(far, L.rx, L.cy, farSize) +
    (f > 0 ? '<path class="' + cls + '" d="' + polyD(at.pts) + '"/>' : '') +
    rider(at.x, at.y, 'var(--m-' + { space: 'bike', mars: 'air' }[cls] + ')', '', rideName, 24, at.ang) + '</svg>';
}
// Musk: a straight line from the Earth to Mars, to scale. While the rocket would be lost in the Earth's edge,
// a magnifier over the edge shows the start of the line zoomed in, by the biggest step of 1-2-5 that keeps the
// rocket inside the lens, and says by how much. From 20 px out the line shows as it is.
var MUSK_ZOOMS = [2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 1e4, 2e4, 5e4, 1e5];
function muskArt(share) {
  var w = farWidth(), k = farScale(w), W = w / k, cy = 82, ex = 145, rx = W - 17 - 34, x1 = rx - 33.5, px = (x1 - ex) * Math.min(1, share), R = 48;
  var s = '<svg class="far-art eight" viewBox="0 0 ' + W.toFixed(1) + ' 164" style="height:' + (164 * k).toFixed(1) + 'px" role="img" aria-label="' + marsPct(Math.min(1, share)) + '% of the way to Mars">' +
    '<path class="trk" d="M' + ex + ',' + cy + 'H' + x1 + '"/>' + planet('mars', rx, cy, 68) + planet('earth', 81, cy, 128);
  if (px >= 20) return s + '<path class="mars" d="M' + ex + ',' + cy + 'H' + (ex + px).toFixed(1) + '"/>' + rider(ex + px, cy, 'var(--m-air)', '', 'rocket', 24, 0) + '</svg>';
  var z = 2, j, zx;
  for (j = 0; j < MUSK_ZOOMS.length; j++) if (px * MUSK_ZOOMS[j] <= 36) z = MUSK_ZOOMS[j];
  zx = ex + Math.max(0, px * z);
  // The lens sits a little right of the Earth's edge, so the Earth fills less of it than the line.
  // A glare on the glass: a bright arc along the upper left of the lens and a small glint beside it.
  var lx = ex + 14, g0 = 200 * Math.PI / 180, g1 = 252 * Math.PI / 180, gr = R - 11, hx = lx + 27, hy = cy + 36.1;
  return s + '<defs><clipPath id="muskLens"><circle cx="' + lx + '" cy="' + cy + '" r="' + R + '"/></clipPath></defs>' +
    '<rect class="lens-rim" x="' + hx + '" y="' + hy + '" width="8" height="29" transform="rotate(-45 ' + hx + ' ' + hy + ')"/>' +
    '<g clip-path="url(#muskLens)"><circle class="lens-bg" cx="' + lx + '" cy="' + cy + '" r="' + R + '"/>' + planet('earth', ex - 279, cy, 558) +
    '<path class="trk" d="M' + ex + ',' + cy + 'H' + (lx + R) + '"/>' + (share > 0 ? '<path class="mars" d="M' + ex + ',' + cy + 'H' + zx.toFixed(1) + '"/>' : '') +
    rider(zx, cy, 'var(--m-air)', '', 'rocket', 24, 0) + '<circle class="lens-in" cx="' + lx + '" cy="' + cy + '" r="' + (R - 2.5) + '"/>' +
    '<path class="lens-glare" d="M' + (lx + gr * Math.cos(g0)).toFixed(1) + ',' + (cy + gr * Math.sin(g0)).toFixed(1) + 'A' + gr + ',' + gr + ' 0 0 1 ' + (lx + gr * Math.cos(g1)).toFixed(1) + ',' + (cy + gr * Math.sin(g1)).toFixed(1) + '"/>' +
    '<circle class="lens-glint" cx="' + (lx + gr * Math.cos(266 * Math.PI / 180)).toFixed(1) + '" cy="' + (cy + gr * Math.sin(266 * Math.PI / 180)).toFixed(1) + '" r="2.6"/></g>' +
    '<circle class="lens-rim" cx="' + lx + '" cy="' + cy + '" r="' + R + '"/><text class="lens-zoom" x="' + (lx + R + 10) + '" y="' + (cy + R + 10) + '">×' + fmt(z) + '</text></svg>';
}
// Marco Polo: Venice to Kublai Khan's China and back over land, so only trips on the ground count (road,
// public transport, on foot and cycling). Odd legs head east along a winding Silk Road, even legs come home.
var POLO_KM = 12000, LAND = { road: 1, transit: 1, foot: 1, bike: 1 };
function renderPolo(g) {
  var km = 0, j;
  for (j = 0; j < sel.length; j++) if (LAND[groupOf(MODES[D.mode[sel[j]]]).key]) km += D.km[sel[j]];
  km *= g;
  FAR.notes[0] = 'How far your trips over land here would take you along the Silk Road from Venice to China, about ' + dist(POLO_KM) + ', and back. Only road, public transport, walking and cycling count; flights and boats don\'t.';
  var legs = km / POLO_KM, leg = Math.floor(legs), part = legs - leg, back = leg % 2 === 1, trips = Math.floor(leg / 2), left = dist(POLO_KM - part * POLO_KM), value, sub, note;
  if (legs < 1) { value = farPct(legs) + '%'; sub = 'of the way to China'; note = left + ' still to go to Kublai Khan\'s court'; }
  else {
    var there = trips ? 'There and back ' + (trips === 1 ? 'once' : trips === 2 ? 'twice' : fmt(trips) + ' times') : '';
    value = fmt(legs / 2, legs < 20 ? 2 : 1); sub = '× Venice to China and back';
    note = back ? (trips ? there + ', then out again and on the way home: ' : 'Made it to China! On the way home to Venice, with ') + left + ' to go' : there + '. Heading east again, with ' + left + ' to China';
  }
  // The road: a gentle wave between Venice and China, as points, drawn to the card's width.
  var w = farWidth(), k = farScale(w), W = w / k, x0 = 56, x1 = W - 56, cy = 62, A = 14, n = 2.5, pts = [], len = [0], i;
  for (i = 0; i <= 120; i++) { var t = i / 120; pts.push([x0 + (x1 - x0) * t, cy + A * Math.sin(t * n * 2 * Math.PI)]); if (i) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); }
  var road = { pts: pts, len: len }, f = back ? 1 - part : part, at = loopAt(f, road), done = back ? [[at.x, at.y]].concat(pts.slice(Math.ceil(f * 120))) : at.pts;
  var ride = rider(at.x, at.y, 'var(--m-transit)', '', 'camel', 24, 0);
  if (back) ride = '<g transform="translate(' + (2 * at.x).toFixed(1) + ',0) scale(-1,1)">' + ride + '</g>';
  function end(x, name, sub, anchor) {
    return '<circle cx="' + x + '" cy="' + cy + '" r="7" class="polo-end"/><text class="polo-l" x="' + x + '" y="' + (cy + 40) + '" text-anchor="' + anchor + '">' + name + '</text>' +
      '<text class="polo-s" x="' + x + '" y="' + (cy + 55) + '" text-anchor="' + anchor + '">' + sub + '</text>';
  }
  $('polo').innerHTML = '<svg class="far-art eight" viewBox="0 0 ' + W.toFixed(1) + ' 128" style="height:' + (128 * k).toFixed(1) + 'px" role="img" aria-label="' + farPct(part) + '% of the way ' + (back ? 'home to Venice' : 'to China') + '">' +
    '<path class="trk" d="' + polyD(pts) + '"/>' + end(x0, 'Venice', '1271', 'start') + end(x1, 'Kublai Khan\'s court', '1275', 'end') +
    (part > 0 ? '<path class="polo" d="' + polyD(done) + '"/>' : '') + ride + '</svg>' +
    '<div class="far-stat">' + stat('', value, sub, note) + '</div>';
}
// Merckx: the Tour de France on a little map of France, about 3,400 km in 21 stages from Brittany, through the
// Pyrenees and the Alps, to Paris. Only cycling counts. Each Tour starts again from Brest.
var TOUR_KM = 3400;
// Places as [longitude, latitude], drawn as x = (lon + 5.4) × 13, y = (51.4 − lat) × 19 (squeezed for 46.5° N).
function frXY(p) { return [(p[0] + 5.4) * 13, (51.4 - p[1]) * 19]; }
var FRANCE = [[2.5, 51.1], [4.2, 50.1], [5.8, 49.5], [8.2, 49], [7.6, 47.6], [6.1, 46.3], [7, 45.9], [6.7, 45.1], [7, 44.2], [7.5, 43.8],
  [6.2, 43.1], [4.8, 43.4], [3.1, 43.1], [3.2, 42.4], [1.7, 42.5], [-.5, 42.8], [-1.8, 43.4], [-1.3, 44.6], [-1.2, 46.2], [-2.2, 47.2],
  [-4.5, 47.8], [-4.8, 48.4], [-3.5, 48.8], [-1.6, 48.6], [-1.9, 49.7], [-1.2, 49.4], [.2, 49.5], [1.5, 50.1], [1.6, 50.9]].map(frXY);
var TOUR = [[-4.3, 48.3], [-2.8, 47.7], [-1.5, 47.2], [-.6, 44.8], [-.4, 43.3], [.1, 42.9], [1.4, 43.6], [3.9, 43.6], [5.3, 44.2],
  [6.1, 45.1], [6.1, 45.9], [5, 47.3], [4, 48.6], [2.35, 48.86]].map(frXY);
// A smooth curve through the points (Catmull-Rom), as many points close together; closed joins the end to the start.
function smoothPts(P, closed, per) {
  var out = [], n = P.length, m = closed ? n : n - 1, i, k;
  function at(j) { return closed ? P[(j + n) % n] : P[Math.max(0, Math.min(n - 1, j))]; }
  for (i = 0; i < m; i++) {
    var a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2);
    for (k = i ? 1 : 0; k <= per; k++) {
      var t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(function (q) { return .5 * (2 * b[q] + (c[q] - a[q]) * t + (2 * a[q] - 5 * b[q] + 4 * c[q] - d[q]) * t2 + (3 * b[q] - a[q] - 3 * c[q] + d[q]) * t3); }));
    }
  }
  return out;
}
function renderMerckx(g) {
  var km = 0, j;
  for (j = 0; j < sel.length; j++) if (groupOf(MODES[D.mode[sel[j]]]).key === 'bike') km += D.km[sel[j]];
  km *= g;
  FAR.notes[1] = 'How many Tours de France your bike rides here add up to, at about ' + dist(TOUR_KM) + ' in 21 stages each. Only cycling counts.';
  var tours = km / TOUR_KM, done = Math.floor(tours), part = tours - done, stage = Math.min(21, Math.floor(part * 21) + 1), left = dist(TOUR_KM - part * TOUR_KM), value, sub, note;
  if (!km) { value = '0'; sub = 'stages ridden'; note = 'No bike rides in these trips yet'; }
  else if (tours < 1) { value = 'Stage ' + stage; sub = 'of 21'; note = left + ' still to ride to Paris'; }
  else {
    value = fmt(tours, tours < 10 ? 2 : 1); sub = '× the Tour de France';
    note = (done >= 5 ? 'As many as Merckx\'s five wins' + (done > 5 ? ', and more' : '') + '. ' : (done === 1 ? 'One Tour' : fmt(done) + ' Tours') + ' done. ') + 'On stage ' + stage + ' of the next, ' + left + ' from Paris';
  }
  var road = (function (pts) { var len = [0]; for (var k = 1; k < pts.length; k++) len.push(len[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])); return { pts: pts, len: len }; })(smoothPts(TOUR, false, 12));
  var at = loopAt(part, road), ks = farScale(farWidth()), dots = '', s;
  // A dot where each stage ends; the ones ridden on this Tour are filled.
  for (s = 1; s < 21; s++) { var p = loopAt(s / 21, road); dots += '<circle class="stage' + (km && s / 21 <= part ? ' on' : '') + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3.5"/>'; }
  var paris = TOUR[TOUR.length - 1], brest = TOUR[0];
  $('merckx').innerHTML = '<svg class="far-art map" viewBox="0 0 184 176" style="width:' + (184 * ks).toFixed(1) + 'px" role="img" aria-label="' + (km ? 'On stage ' + stage + ' of 21' : 'No stages ridden') + '">' +
    '<path class="fr" d="' + polyD(smoothPts(FRANCE, true, 6)) + 'Z"/><path class="trk" d="' + polyD(road.pts) + '"/>' +
    (km && part > 0 ? '<path class="tour" d="' + polyD(at.pts) + '"/>' : '') + dots +
    '<circle class="polo-end" cx="' + brest[0].toFixed(1) + '" cy="' + brest[1].toFixed(1) + '" r="5"/>' +
    '<circle class="tour-end" cx="' + paris[0].toFixed(1) + '" cy="' + paris[1].toFixed(1) + '" r="7"/><text class="polo-l" x="' + (paris[0] - 12).toFixed(1) + '" y="' + (paris[1] + 4).toFixed(1) + '" text-anchor="end">Paris</text>' +
    rider(at.x, at.y, 'var(--m-bike)', '', 'CYCLING', 24, 0) + '</svg>' +
    '<div class="far-stat">' + stat('', value, sub, note) + '</div>';
}
// A share of the way to Mars, with enough decimals to show something for a few trips.
function marsPct(share) {
  var p = share * 100;
  if (p <= 0) return '0';
  if (p < .0001) return '<0.0001';
  return p >= 10 ? fmt(Math.floor(p)) : p >= 1 ? fmt(Math.floor(p * 10) / 10, 1) : fmt(p, Math.min(4, 1 - Math.floor(Math.log10(p))));
}
function yearsText(y) {
  if (y < 1) return fmt(Math.max(1, Math.round(y * 365.25))) + ' days';
  if (y < 1e6) return fmt(y, y < 10 ? 1 : 0) + ' years';
  return 'over a million years';
}
function renderMusk(g) {
  var kmT = FAR.km * g, share = kmT / MARS_KM, left = MARS_KM - kmT, note, value, sub;
  var d0 = D.day[sel[0]], d1 = D.day[sel[sel.length - 1]], perDay = kmT / Math.max(1, d1 - d0 + 1);
  FAR.notes[4] = 'How far your trips here would take you towards Mars when it\'s closest, about ' + bigDist(MARS_KM) + ' away (it averages ' + bigDist(225e6) + ', and is ' + bigDist(401e6) + ' away on the far side of the Sun). The line is to scale: while your rocket is too close to the Earth to see, the magnifier zooms in on it. The pace is your distance per day over these dates.';
  if (share < 1) { value = marsPct(share) + '%'; sub = 'of the way to Mars'; note = dist(left) + ' still to go' + (perDay > 0 ? '. At this pace you\'d land in ' + yearsText(left / perDay / 365.25) : ''); }
  else { value = fmt(share, share < 10 ? 2 : 1); sub = '× the way to Mars'; note = 'Made it to Mars, with ' + dist(kmT - MARS_KM) + ' to spare'; }
  $('musk').innerHTML = muskArt(share) +
    '<div class="far-stat">' + stat('', value, sub, note) + '</div>';
}
// Voyager 1: about 17 km/s, and one light-day (25,902 million km) from Earth in mid-November 2026.
var VOY_KMH = 61200, VOY_KM0 = 25.902e9, VOY_T0 = Date.UTC(2026, 10, 15), VOY_PER_DAY = VOY_KMH * 24;
function voyagerKm() { return VOY_KM0 + (Date.now() - VOY_T0) / 864e5 * VOY_PER_DAY; }
// Millions and billions in words, in the chosen unit.
function bigDist(km) {
  var v = distVal(km), u = ' ' + distUnit();
  return v >= 1e9 ? fmt(v / 1e9, 1) + ' billion' + u : v >= 1e6 ? fmt(v / 1e6, 1) + ' million' + u : dist(km);
}
function raceTime(h) { return h * 60 < 1 ? fmt(Math.max(1, Math.round(h * 3600))) + ' s' : hoursLabel(h); }
// Playing it runs the race: Voyager rides from the start to the flag (g of the way) and you keep your pace.
function renderVoyager(g) {
  var kmT = FAR.km, dV = voyagerKm(), raceH = kmT / VOY_KMH, d0 = D.day[sel[0]], d1 = D.day[sel[sel.length - 1]], span = d1 - d0 + 1;
  var youF = Math.min(1, raceH / (span * 24)), faster = VOY_KMH / Math.max(1e-9, kmT / (span * 24)), share = kmT / dV, ratio = VOY_PER_DAY / Math.max(1, kmT);
  FAR.notes[5] = 'It\'s the farthest thing people have made: about ' + bigDist(dV) + ' away, a light-day, and moving at about ' + fmt(distVal(VOY_KMH)) + ' ' + distUnit() + '/h. ' +
    'The race is your distance here against Voyager over the same distance, with you going at your average pace for these dates. Zoom out for the whole way to Voyager.';
  var out = FAR.zoom;
  function art(W, cls) {
  var x0 = 96, x1 = W - 80, youX = x0 + (x1 - x0) * youF * g, vX = x0 + (x1 - x0) * g;
  var race = '<g class="v-race">' +
    '<line x1="' + x1 + '" y1="30" x2="' + x1 + '" y2="148" stroke="var(--fg)" stroke-width="2" stroke-dasharray="4 4"/>' + glyph('flag', x1 + 12, 26, 20, 'var(--fg)') +
    '<text class="vl" x="' + (x1 + 30) + '" y="168" text-anchor="end">' + dist(kmT) + ', your distance</text>' +
    '<text class="vl" x="16" y="66">Voyager</text><path class="trk" stroke-width="10" d="M' + x0 + ',62H' + x1 + '"/>' + (vX > x0 + 1 ? '<path class="gold" stroke-width="10" d="M' + x0 + ',62H' + vX.toFixed(1) + '"/>' : '') +
    rider(vX, 62, 'var(--m-foot)', 'var(--m-foot)', 'voyager', 24) +
    '<text class="vl" x="16" y="122">You</text><path class="trk" stroke-width="10" d="M' + x0 + ',118H' + x1 + '"/>' +
    (youX > x0 + 1 ? '<path class="you" stroke-width="10" stroke="var(--accent)" stroke-linecap="round" d="M' + x0 + ',118H' + youX.toFixed(1) + '"/>' : '') +
    rider(youX, 118, 'var(--accent)', 'var(--accent)', 'pin', 20) +
    (youF < .6 ? '<text class="vl" x="' + (youX + 20).toFixed(1) + '" y="102">' + dist(kmT * youF * g) + ' in, at your pace</text>' : '') +
    '<g transform="translate(' + W / 2 + ',22)"><rect x="-74" y="-12" width="148" height="24" rx="12" fill="var(--chip-on-bg)"/><text class="vb" y="4.5" text-anchor="middle" style="fill:var(--chip-on-fg)">Race time ' + raceTime(raceH * g) + '</text></g></g>';
  var c0 = 74, c1 = W - 54, X = function (km) { return c0 + (c1 - c0) * Math.min(1, km / dV); }, ja = X(.78e9), ne = X(4.5e9), hp = X(18e9);
  var chase = '<g class="v-chase"><path class="gold" stroke-width="10" d="M' + c0 + ',92H' + c1 + '"/>' + planet('earth', 40, 92, 48) +
    [.78e9, 1.43e9, 2.87e9, 4.5e9].map(function (k) { return '<circle cx="' + X(k).toFixed(1) + '" cy="92" r="3" fill="var(--bg)"/>'; }).join('') +
    '<path d="M' + ja.toFixed(1) + ',78V72H' + ne.toFixed(1) + 'V78" fill="none" stroke="var(--muted)"/><text class="vl" x="' + ((ja + ne) / 2).toFixed(1) + '" y="64" text-anchor="middle">Jupiter to Neptune</text>' +
    '<line x1="' + hp.toFixed(1) + '" y1="58" x2="' + hp.toFixed(1) + '" y2="' + (W < 500 ? 106 : 126) + '" stroke="var(--muted)" stroke-dasharray="3 4"/><text class="vl" x="' + hp.toFixed(1) + '" y="50" text-anchor="middle">Leaves the Sun\'s bubble</text>' +
    rider(c1, 92, 'var(--m-foot)', 'var(--m-foot)', 'voyager', 24) + (W < 500 ? '<text class="vl" x="' + c1 + '" y="122" text-anchor="end">Voyager 1,<tspan x="' + c1 + '" dy="15">' + bigDist(dV) + '</tspan></text>'
      : '<text class="vl" x="' + c1 + '" y="136" text-anchor="end">Voyager 1, ' + bigDist(dV) + '</text>') +
    '<line x1="' + (c0 + 2) + '" y1="92" x2="156" y2="148" stroke="var(--accent)" stroke-width="1.2"/><circle cx="' + (c0 + 2) + '" cy="92" r="3" fill="var(--accent)"/>' +
    rider(172, 154, 'var(--accent)', 'var(--accent)', 'pin', 22) + '<text class="vb" x="198" y="159">You: ' + dist(kmT) + '</text></g>';
  return '<svg class="far-art mid ' + cls + (out ? ' out' : '') + '" viewBox="0 0 ' + W + ' 180" style="max-width:' + W + 'px" role="img" aria-label="' + (out ? marsPct(share) + '% of the way to Voyager 1' : 'Voyager covers your distance in ' + raceTime(raceH)) + '">' + race + chase + '</svg>';
  }
  // The narrow drawing is as wide as the card (up to 640), so it shows at its own size on a phone.
  var wn = Math.round(Math.max(320, Math.min(640, $('farView').clientWidth - 8)));
  $('voyager').innerHTML = art(wn, 'far-n') + art(840, 'far-w') +
    '<div class="far-stat v-stats"><div' + (out ? ' hidden' : '') + '>' + stat('', raceTime(raceH * g), 'for Voyager to go as far as you', 'You took ' + (span === 1 ? 'a day' : fmt(span) + ' days') + '. Voyager is ' + fmt(faster) + '× faster than your average pace') + '</div>' +
    '<div' + (out ? '' : ' hidden') + '>' + stat('', marsPct(share) + '%', 'of the way to Voyager 1', 'It\'s a light-day away and gets ' + bigDist(VOY_PER_DAY) + ' further every day' + (ratio >= 1.5 ? ': ' + fmt(ratio) + '× your distance here' : '')) + '</div></div>' +
    '<div class="v-foot"><button type="button" class="v-zoom" id="vZoom" aria-pressed="' + out + '">' + icon(out ? 'zoomIn' : 'zoomOut') + '<span>' + (out ? 'Back to the race' : 'Zoom out') + '</span></button></div>';
}
function voyagerZoom(on) {
  FAR.zoom = on;
  var host = $('voyager'), b = $('vZoom'), st = host.querySelectorAll('.v-stats > div');
  host.querySelectorAll('svg.far-art').forEach(function (svg) { svg.classList.toggle('out', on); });
  b.setAttribute('aria-pressed', String(on));
  b.innerHTML = icon(on ? 'zoomIn' : 'zoomOut') + '<span>' + (on ? 'Back to the race' : 'Zoom out') + '</span>';
  st[0].hidden = on; st[1].hidden = !on;
}

// ---------- the scores carousel ----------
// The scores take turns every 5 seconds. Touching the card (swipe, dots, arrows, zoom, info) stops that,
// until the period or filters change. It also waits while the card is hovered or Insights isn't showing.
// Who each score is named after, and when they did it: the first line of each score's note.
var FAR_WHO = [
  'Marco Polo set out from Venice in 1271 and reached Kublai Khan\'s court in China in 1275, over land along the Silk Road.',
  'Eddy Merckx won the Tour de France five times, four of them in a row from 1969 to 1972, and again in 1974.',
  'Ferdinand Magellan set out in 1519 on the first voyage around the world, finished in 1522.',
  'Neil Armstrong was the first person to walk on the Moon, on 20 July 1969.',
  'Elon Musk is planning to go to Mars... somewhere in the future.',
  'Voyager 1 was launched by NASA on 5 September 1977 and reached interstellar space in 2012.'
];
var FAR = { i: 0, auto: true, key: -1, timer: 0, zoom: false, notes: [], km: 0, g: 1, anim: 0 };
var farSlides = Array.prototype.slice.call(document.querySelectorAll('#farTrack .far-slide'));
$('farDots').innerHTML = farSlides.map(function (s, k) { return '<button type="button" data-far="' + k + '" aria-label="' + s.dataset.title + '"></button>'; }).join('');
function farGo(k, user, still) {
  var n = farSlides.length;
  if (FAR.anim && !still) { cancelAnimationFrame(FAR.anim); FAR.anim = 0; FAR_DRAW[FAR.i](1); }
  FAR.i = ((k % n) + n) % n;
  $('farTrack').style.transform = 'translateX(' + (-100 * FAR.i) + '%)';
  // The card is as tall as the score showing, so a short drawing doesn't leave a gap above the next card.
  var h = farSlides[FAR.i].offsetHeight;
  if (h) $('farView').style.height = h + 'px';
  farSlides.forEach(function (s, j) { var on = j === FAR.i; s.inert = !on; s.setAttribute('aria-hidden', on ? 'false' : 'true'); s.setAttribute('aria-label', (j + 1) + ' of ' + n); });
  $('farDots').querySelectorAll('button').forEach(function (b, j) { b.setAttribute('aria-current', j === FAR.i ? 'true' : 'false'); });
  $('farTitle').textContent = farSlides[FAR.i].dataset.title;
  $('farTitle').setAttribute('aria-live', user ? 'polite' : 'off');
  $('farNote').innerHTML = '<span class="far-who">' + FAR_WHO[FAR.i] + '</span>' + (FAR.notes[FAR.i] || '');
  farSchedule();
  if (!still) farPlay();
}
function farStop() { FAR.auto = false; clearTimeout(FAR.timer); }
function farSchedule() {
  clearTimeout(FAR.timer);
  if (!FAR.auto) return;
  FAR.timer = setTimeout(function () {
    var card = $('farCard'), waiting = tab !== 'insights' || document.hidden || !sel.length || card.hidden || card.matches(':hover');
    if (waiting) farSchedule(); else farGo(FAR.i + 1);
  }, 5000);
}
// New dates or filters start the turns again.
function farRefresh() {
  if (applyCount !== FAR.key) { FAR.key = applyCount; FAR.auto = true; }
  farGo(FAR.i);
}
(function () {
  var card = $('farCard'), view = $('farView'), sx = null, sy = 0;
  card.addEventListener('pointerdown', farStop);
  card.addEventListener('keydown', function (ev) {
    farStop();
    if (ev.target.closest('input, textarea')) return;
    if (ev.key === 'ArrowRight') farGo(FAR.i + 1, true);
    else if (ev.key === 'ArrowLeft') farGo(FAR.i - 1, true);
  });
  card.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-far]');
    if (b) { var v = b.dataset.far; farGo(v === 'next' ? FAR.i + 1 : v === 'prev' ? FAR.i - 1 : +v, true); }
    else if (ev.target.closest('#vZoom')) voyagerZoom(!FAR.zoom);
  });
  view.addEventListener('pointerdown', function (ev) { sx = ev.clientX; sy = ev.clientY; });
  view.addEventListener('pointerup', function (ev) {
    if (sx == null) return;
    var dx = ev.clientX - sx, dy = ev.clientY - sy; sx = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) farGo(FAR.i + (dx < 0 ? 1 : -1), true);
  });
  view.addEventListener('pointercancel', function () { sx = null; });
  // The eights are drawn to the card's width, so they are drawn again when it changes.
  var w0 = 0;
  if (window.ResizeObserver) new ResizeObserver(function () {
    var w = view.clientWidth;
    if (w && Math.abs(w - w0) > 1) { w0 = w; if (sel.length) renderFar(true); }
  }).observe(view);
  // The card follows the height of the score showing when that changes by itself (the font arriving, the zoom).
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { var h = farSlides[FAR.i].offsetHeight; if (h) view.style.height = h + 'px'; });
    farSlides.forEach(function (s) { ro.observe(s); });
  }
})();
// Magellan: a ring round the Earth from the top, clockwise; the caravel is where this lap has got to.
function renderMagellan(g) {
  var kmT = FAR.km * g, laps = kmT / EARTH_KM, done = Math.floor(laps), lap = laps - done, r = 70.5, cx = 82, cy = 82, th = lap * 2 * Math.PI, ks = farScale(farWidth());
  var sx = cx + r * Math.sin(th), sy = cy - r * Math.cos(th), arc = lap > .002 ? '<path class="sea" d="M' + cx + ',' + (cy - r) + ' A' + r + ',' + r + ' 0 ' + (lap > .5 ? 1 : 0) + ',1 ' + sx.toFixed(1) + ',' + sy.toFixed(1) + '"/>' : '';
  $('magellan').innerHTML = '<svg class="far-art ring" viewBox="0 0 164 164" style="width:' + (164 * ks).toFixed(1) + 'px" role="img" aria-label="' + farPct(lap) + '% of the way round on lap ' + fmt(done + 1) + '">' +
    planet('earth', cx, cy, 128) + '<circle class="trk" cx="' + cx + '" cy="' + cy + '" r="' + r + '"/>' + arc +
    rider(sx, sy, 'var(--m-road)', '', 'caravel', 24, 0, -1) + '</svg>' +
    '<div class="far-stat">' + (laps < 1
      ? stat('', farPct(laps) + '%', 'around the world', dist(EARTH_KM - kmT) + ' to go to make it all the way round')
      : stat('', fmt(laps, laps < 10 ? 2 : 1), '× around the world', (done === 1 ? 'Once round' : done === 2 ? 'Twice round' : fmt(done) + ' times round') + ', and ' + dist(EARTH_KM - lap * EARTH_KM) + ' from finishing lap ' + fmt(done + 1))) + '</div>';
}
// Armstrong: one leg is the Earth to the Moon. Odd legs head out along the top of the loop, even legs come home underneath.
function renderArmstrong(g) {
  var legs = FAR.km * g / MOON_KM, leg = Math.floor(legs), part = legs - leg, trips = Math.floor(leg / 2), back = leg % 2 === 1, left = dist(MOON_KM - part * MOON_KM);
  var f = (back ? .5 : 0) + part / 2, sub, note, value;
  if (legs < 1) { value = farPct(legs) + '%'; sub = 'of the way to the Moon'; note = left + ' still to go'; }
  else {
    var there = trips ? 'There and back ' + (trips === 1 ? 'once' : trips === 2 ? 'twice' : fmt(trips) + ' times') : '';
    value = fmt(legs / 2, legs < 20 ? 2 : 1); sub = '× to the Moon and back';
    note = back ? (trips ? there + ', then out again and on the way home: ' : 'Made it to the Moon! On the way home, with ') + left + ' to go' : there + '. On the way out again, with ' + left + ' to the Moon';
  }
  $('armstrong').innerHTML = eightArt(f, 'moon', 35, 32, 'space', 'capsule', back ? farPct(part) + '% of the way home from the Moon' : farPct(part) + '% of the way to the Moon') +
    '<div class="far-stat">' + stat('', value, sub, note) + '</div>';
}
// Each score drawn with g of the distance (1 is all of it), in the carousel's order.
var FAR_DRAW = [renderPolo, renderMerckx, renderMagellan, renderArmstrong, renderMusk, renderVoyager];
// still: drawn again for a new width, so the score showing isn't played again.
function renderFar(still) {
  var kmT = 0, j;
  for (j = 0; j < sel.length; j++) kmT += D.km[sel[j]];
  FAR.km = kmT;
  FAR.notes[2] = 'How many times your trips here would take you around the world, ' + dist(EARTH_KM) + ' at the equator.';
  FAR.notes[3] = 'How far your trips here would take you towards the Moon, on average ' + dist(MOON_KM) + ' away, and back.';
  FAR_DRAW.forEach(function (draw) { draw(1); });
  if (still) { if (FAR.anim) FAR_DRAW[FAR.i](FAR.g); farGo(FAR.i, false, true); }
  else farRefresh();
}
// ---------- the scores playing ----------
// When a score comes into view (Insights opens, the carousel turns, or the dates or filters change), its distance
// counts up from nothing over 1.6 s, slowing as it ends: the line grows, the rider rides it and the number climbs.
// The card keeps the height of the finished score. Not with reduced motion.
var FAR_PLAY_MS = 1600;
// The note under the number doesn't count: it keeps its finished text, hidden so its space is there all along,
// and fades in once the score has played.
function farPlay() {
  cancelAnimationFrame(FAR.anim); FAR.anim = 0;
  var k = FAR.i, draw = FAR_DRAW[k], t0 = 0, slide = farSlides[k], notes;
  if (!sel.length || tab !== 'insights' || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  draw(1);
  notes = Array.prototype.map.call(slide.querySelectorAll('.far-stat .note'), function (n) { return n.innerHTML; });
  function frame(g) {
    draw(g);
    slide.querySelectorAll('.far-stat .note').forEach(function (n, j) { if (notes[j] != null) n.innerHTML = notes[j]; n.classList.add('hold'); });
  }
  function step(now) {
    if (!t0) t0 = now;
    var t = Math.min(1, (now - t0) / FAR_PLAY_MS);
    FAR.g = 1 - Math.pow(1 - t, 3);
    if (FAR.i !== k) return;
    if (t < 1) { frame(FAR.g); FAR.anim = requestAnimationFrame(step); return; }
    FAR.anim = 0; frame(1);
    void slide.offsetWidth;
    slide.querySelectorAll('.far-stat .note.hold').forEach(function (n) { n.classList.remove('hold'); });
  }
  FAR.g = 0; frame(0);
  FAR.anim = requestAnimationFrame(step);
}

var SPLIT = {
  km: { val: function (i) { return D.km[i]; }, fmt: dist },
  h: { val: hours, fmt: hoursLabel },
  n: { val: function () { return 1; }, fmt: function (v) { return tripsText(v); } }
};
function renderSplit() {
  var M_ = SPLIT[PREFS.splitM] || SPLIT.km, by = {}, total = 0;
  setPressed('#splitSeg button', function (b) { return b.dataset.m === PREFS.splitM; });
  for (var j = 0; j < sel.length; j++) { var i = sel[j], m = modeOf(i), v = M_.val(i); by[m] = (by[m] || 0) + v; total += v; }
  var ms = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }), max = by[ms[0]] || 1;
  $('splitBars').innerHTML = ms.map(function (m) {
    var share = total ? by[m] / total * 100 : 0;
    return '<div class="bar-row">' + badge(m, true) + '<div><div class="name"><span>' + (LABEL[m] || m) + '</span><span>' + (share < 1 && share > 0 ? '<1' : Math.round(share)) + '%</span></div>' +
      '<div class="track"><i style="width:' + (by[m] / max * 100).toFixed(1) + '%;background:' + modeColor(m) + '"></i></div></div><div class="val">' + M_.fmt(by[m]) + '</div></div>';
  }).join('');
}
$('splitSeg').addEventListener('click', function (ev) { var b = ev.target.closest('button[data-m]'); if (b) { PREFS.splitM = b.dataset.m; savePrefs(); renderSplit(); } });

// Ten steps of the accent colour, from faint (1) to full (10); 0 is empty.
var HEAT_STEPS = 10, HEAT_LEVELS = Array.from({ length: HEAT_STEPS }, function (_, k) { return k + 1; });
function heatColor(level) { return level ? 'color-mix(in srgb, var(--accent) ' + Math.round(14 + 86 * (level - 1) / (HEAT_STEPS - 1)) + '%, var(--grid))' : 'var(--grid)'; }
// Levels by decile of the non-empty values, so a few very busy cells don't wash out the rest.
function heatLevels(vals) {
  vals = vals.filter(function (v) { return v; }).sort(function (a, b) { return a - b; });
  var cuts = HEAT_LEVELS.slice(0, -1).map(function (l) { return vals[Math.floor((vals.length - 1) * l / HEAT_STEPS)] || 0; });
  return function (v) { if (!v) return 0; var l = 1; cuts.forEach(function (x) { if (v > x) l++; }); return Math.min(HEAT_STEPS, l); };
}
function renderRhythm() {
  var c = [], j, k, max = 0;
  for (k = 0; k < 7; k++) c.push(new Array(24).fill(0));
  for (j = 0; j < sel.length; j++) { var i = sel[j]; c[D.dow[i]][D.hour[i]]++; }
  var level = heatLevels([].concat.apply([], c));
  var h = '<div></div>';
  for (k = 0; k < 24; k++) h += '<div class="h">' + (k % 6 === 0 ? k : '') + '</div>';
  DOW_ORDER.forEach(function (d) {
    h += '<div class="d">' + DOW[d] + '</div>';
    for (k = 0; k < 24; k++) h += '<div class="c" data-d="' + d + '" data-h="' + k + '" data-n="' + c[d][k] + '" style="background:' + heatColor(level(c[d][k])) + '"></div>';
  });
  $('rhythm').innerHTML = '<div class="rhythm" role="img" aria-label="Trips by day of the week and hour">' + h + '</div>' +
    '<div class="rhythm-scale">Fewer' + HEAT_LEVELS.map(function (l) { return '<i style="background:' + heatColor(l) + '"></i>'; }).join('') + 'More trips</div>';
}
function rhythmTip(ev) {
  var c = ev.target.closest('.c[data-d]');
  if (!c) { hideTip(); return; }
  var d = +c.dataset.d, h = +c.dataset.h, n = +c.dataset.n;
  showTip(ev, '<b>' + DOW_LONG[d] + 's, ' + pad2(h) + ':00–' + pad2((h + 1) % 24) + ':00</b><div class="row"><span>Trips started</span><span class="num">' + fmt(n) + '</span></div>');
}
$('rhythm').addEventListener('mousemove', rhythmTip);
$('rhythm').addEventListener('mouseleave', hideTip);
$('rhythm').addEventListener('click', rhythmTip);

// ---------- over time ----------
var TIME = {
  km: { title: 'Distance over time', val: function (i) { return distVal(D.km[i]); }, tick: function (v) { return fmt(v) + ' ' + distUnit(); }, show: function (v) { return fmt(v, v < 10 && v > 0 ? 1 : 0) + ' ' + distUnit(); } },
  h: { title: 'Time travelling over time', val: hours, tick: function (v) { return fmt(v, v < 10 && v % 1 ? 1 : 0) + ' h'; }, show: hoursLabel },
  n: { title: 'Trips over time', val: function () { return 1; }, tick: function (v) { return fmt(v); }, show: function (v) { return fmt(v); } },
  co2: { title: 'CO₂ over time', val: tripKg, tick: function (v) { return v >= 1000 ? fmt(v / 1000, v % 1000 ? 1 : 0) + ' t' : fmt(v) + ' kg'; }, show: co2s }
};
function svgEl(tag, attrs) {
  var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (var k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function niceMax(v) {
  if (v <= 0) return 1;
  var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
var timeData = null;
// Slot width in px for the units that scroll; years always fit the card.
var TIME_UNITS = { year: 0, month: 14, week: 14, day: 26 };
function weekStart(k) { return k * 7 - 3; }
function renderTime() {
  var mt = TIME[PREFS.timeM] || TIME.km;
  setPressed('#timeSeg button', function (b) { return b.dataset.m === PREFS.timeM; });
  $('timeTitle').textContent = mt.title;
  // Days are offered for ranges up to two months; a longer range shows weeks instead.
  var short = sel.length > 0 && D.day[sel[sel.length - 1]] - D.day[sel[0]] <= 62;
  var unit = PREFS.timeU in TIME_UNITS ? PREFS.timeU : 'year';
  if (unit === 'day' && !short) unit = 'week';
  $('timeUnitSeg').querySelector('[data-u="day"]').hidden = !short;
  setPressed('#timeUnitSeg button', function (b) { return b.dataset.u === unit; });
  // Weeks start on Monday; day 0 (1 Jan 1970) was a Thursday.
  function key(i) { return unit === 'day' ? D.day[i] : unit === 'week' ? Math.floor((D.day[i] + 3) / 7) : unit === 'month' ? D.year[i] * 12 + D.month[i] : D.year[i]; }
  var buckets = {}, present = {};
  for (var j = 0; j < sel.length; j++) {
    var i = sel[j], g = groupOf(modeOf(i)).key, k = key(i), b = buckets[k] || (buckets[k] = {});
    b[g] = (b[g] || 0) + mt.val(i); present[g] = 1;
  }
  var G = GROUPS.filter(function (g) { return present[g.key]; });
  var keys = Object.keys(buckets).map(Number).sort(function (a, b) { return a - b; });
  if (keys.length) { var all = []; for (var q = keys[0]; q <= keys[keys.length - 1]; q++) all.push(q); keys = all; }
  timeData = { keys: keys, buckets: buckets, G: G, unit: unit, mt: mt };
  $('timeLegend').innerHTML = G.length > 1 ? G.map(function (g) { return '<span><i style="background:' + g.color + '"></i>' + g.label + '</span>'; }).join('') : '';
  drawTime();
}
function bucketName(k, unit) {
  if (unit === 'day') return longDate(k);
  if (unit === 'week') { var a = dayToDate(weekStart(k)), z = dayToDate(weekStart(k) + 6); return 'Week of ' + a.getUTCDate() + ' ' + MONTHS[a.getUTCMonth()] + (a.getUTCFullYear() !== z.getUTCFullYear() ? ' ' + a.getUTCFullYear() : '') + ' – ' + z.getUTCDate() + ' ' + MONTHS[z.getUTCMonth()] + ' ' + z.getUTCFullYear(); }
  if (unit === 'month') return MONTHS_LONG[k % 12] + ' ' + Math.floor(k / 12);
  return String(k);
}
function drawTime() {
  var T = timeData, host = $('timeChart');
  if (!T) return;
  var keys = T.keys, G = T.G, mt = T.mt, unit = T.unit, old = host.querySelector('.time-scroll');
  // Keep the scroll position when only the measure or the size changes; otherwise show the latest.
  var keep = old && host.dataset.view === unit + ':' + keys[0] + ':' + keys.length ? old.scrollLeft : -1;
  host.textContent = '';
  var scroll = TIME_UNITS[unit] > 0;
  host.classList.toggle('scroll', scroll);
  host.dataset.view = unit + ':' + keys[0] + ':' + keys.length;
  var W = Math.max(260, host.clientWidth), H = 220, R = 4, Tp = 8, B = 24, max = 0;
  keys.forEach(function (k) { var b = T.buckets[k]; if (b) { var s = 0; G.forEach(function (g) { s += b[g.key] || 0; }); max = Math.max(max, s); } });
  var top = niceMax(max), nt = /^2(0*)$/.test(String(top)) ? 4 : 5, widest = 0, t;
  for (t = 0; t <= nt; t++) widest = Math.max(widest, mt.tick(top * t / nt).length);
  var Lm = Math.max(30, Math.ceil(widest * 6.6) + 10), ph = H - Tp - B;
  // Scrolling units get a fixed slot width (wider if they would not fill the card) and a separate y axis.
  var pw = scroll ? Math.max(W - Lm - R, keys.length * TIME_UNITS[unit]) : W - Lm - R, slot = pw / keys.length;
  var X0 = scroll ? 0 : Lm, SW = scroll ? pw + R : W;
  var bw = Math.max(1.5, Math.min(22, slot * 0.72));
  var label = mt.title + ' per ' + unit + ', stacked by transport group';
  var svg = svgEl('svg', { width: SW, height: H, viewBox: '0 0 ' + SW + ' ' + H, role: 'img', 'aria-label': label });
  var axis = scroll ? svgEl('svg', { width: Lm, height: H, viewBox: '0 0 ' + Lm + ' ' + H, 'aria-hidden': 'true' }) : svg;
  for (t = 0; t <= nt; t++) {
    var v = top * t / nt, y = Tp + ph - ph * t / nt;
    svg.appendChild(svgEl('line', { x1: X0, x2: SW - R, y1: y, y2: y, stroke: 'var(--grid)', 'stroke-width': 1 }));
    var tx = svgEl('text', { x: Lm - 6, y: y + 4, 'text-anchor': 'end' }); tx.textContent = mt.tick(v); axis.appendChild(tx);
  }
  // x labels: years each fit; months show the year in January; weeks are labelled at the first week of each month.
  var every = Math.max(1, Math.ceil(44 / slot));
  keys.forEach(function (k, idx) {
    var cx = X0 + slot * idx + slot / 2, b = T.buckets[k] || {}, text = null, ws, wd;
    if (unit === 'year') { if (idx % every === 0) text = k; }
    else if (unit === 'day') { if (idx % every === 0) { ws = dayToDate(k); text = ws.getUTCDate() + (ws.getUTCDate() <= every || idx === 0 ? ' ' + MONTHS[ws.getUTCMonth()] : ''); } }
    else if (unit === 'month') { if (k % 12 % (slot >= 30 ? 1 : slot * 3 >= 30 ? 3 : 6) === 0) text = k % 12 === 0 ? Math.floor(k / 12) : MONTHS[k % 12]; }
    else {
      ws = dayToDate(weekStart(k)); wd = dayToDate(weekStart(k) - 7);
      if (idx === 0 || ws.getUTCMonth() !== wd.getUTCMonth()) text = ws.getUTCMonth() === 0 || idx === 0 ? ws.getUTCFullYear() : MONTHS[ws.getUTCMonth()];
    }
    if (text !== null) {
      var lb = svgEl('text', { x: unit === 'week' ? X0 + slot * idx : cx, y: H - 6, 'text-anchor': unit === 'week' ? 'start' : 'middle' });
      lb.textContent = text;
      svg.appendChild(lb);
    }
    var y0 = Tp + ph, segs = G.filter(function (g) { return b[g.key] > 0; });
    segs.forEach(function (g, si) {
      var hgt = b[g.key] / top * ph, isTop = si === segs.length - 1, gap = si > 0 ? 2 : 0, hh = Math.max(0, hgt - gap);
      if (hh <= 0) { y0 -= hgt; return; }
      var x = cx - bw / 2, yy = y0 - hgt, r = isTop ? Math.min(4, hh, bw / 2) : 0;
      var dPath = 'M' + x + ',' + (yy + hh) + 'V' + (yy + r) + (r ? 'Q' + x + ',' + yy + ' ' + (x + r) + ',' + yy : '') +
        'H' + (x + bw - r) + (r ? 'Q' + (x + bw) + ',' + yy + ' ' + (x + bw) + ',' + (yy + r) : '') + 'V' + (yy + hh) + 'Z';
      svg.appendChild(svgEl('path', { d: dPath, fill: g.color }));
      y0 -= hgt;
    });
    var hit = svgEl('rect', { x: X0 + slot * idx, y: Tp, width: slot, height: ph, fill: 'transparent', 'data-k': k });
    svg.insertBefore(hit, svg.firstChild);
  });
  if (!scroll) { host.appendChild(svg); return; }
  var sc = document.createElement('div');
  sc.className = 'time-scroll';
  sc.appendChild(svg);
  sc.addEventListener('scroll', hideTip, { passive: true });
  host.appendChild(axis);
  host.appendChild(sc);
  sc.scrollLeft = keep >= 0 ? keep : sc.scrollWidth;
}
function timeTip(ev) {
  var r = ev.target.closest('rect[data-k]');
  $('timeChart').querySelectorAll('rect[data-k]').forEach(function (x) { x.setAttribute('fill', x === r ? 'var(--grid)' : 'transparent'); });
  if (!r) { hideTip(); return; }
  var T = timeData, k = +r.dataset.k, b = T.buckets[k] || {}, total = 0;
  var rows = T.G.map(function (g) { total += b[g.key] || 0; return '<div class="row"><span><i style="background:' + g.color + '"></i>' + g.label + '</span><span class="num">' + T.mt.show(b[g.key] || 0) + '</span></div>'; }).join('');
  showTip(ev, '<b>' + bucketName(k, T.unit) + '</b>' + (T.G.length > 1 ? rows : '') + '<div class="row" style="margin-top:4px"><span>Total</span><span class="num">' + T.mt.show(total) + '</span></div>');
}
$('timeChart').addEventListener('mousemove', timeTip);
$('timeChart').addEventListener('mouseleave', function () { hideTip(); $('timeChart').querySelectorAll('rect[data-k]').forEach(function (x) { x.setAttribute('fill', 'transparent'); }); });
$('timeChart').addEventListener('click', timeTip);
$('timeSeg').addEventListener('click', function (ev) { var b = ev.target.closest('button[data-m]'); if (b) { PREFS.timeM = b.dataset.m; savePrefs(); renderTime(); } });
$('timeUnitSeg').addEventListener('click', function (ev) { var b = ev.target.closest('button[data-u]'); if (b) { PREFS.timeU = b.dataset.u; savePrefs(); renderTime(); } });
$('insightsPage').addEventListener('scroll', hideTip, { passive: true });
var rsT = 0;
window.addEventListener('resize', function () { clearTimeout(rsT); rsT = setTimeout(function () { if (tab === 'insights') { drawTime(); if (hrData && !$('hrCard').hidden) drawHrFit(); } }, 120); });

// ---------- routes, places, records, countries ----------
function renderRoutes() {
  var by = {}, list = [];
  for (var j = 0; j < sel.length; j++) {
    var i = sel[j], a = D.pa[i], b = D.pb[i];
    if (a < 0 || b < 0 || a === b) continue;
    // Either direction counts as the same route.
    var la = placeLabel(a), lb = placeLabel(b);
    if (la === lb) continue;
    // Places with the same name (several spots in one town) count as one.
    if (la > lb) { var t = a; a = b; b = t; }
    var key = la < lb ? la + '|' + lb : lb + '|' + la, r = by[key];
    if (!r) { r = by[key] = { a: a, b: b, n: 0, km: 0, modes: {}, last: i }; list.push(r); }
    var m = modeOf(i);
    r.n++; r.km += D.km[i]; r.modes[m] = (r.modes[m] || 0) + 1;
    r.last = i;
  }
  list.sort(function (x, y) { return y.n - x.n || y.km - x.km; });
  if (!list.length) { $('topRoutes').innerHTML = '<p class="empty">No trips between two different places.</p>'; return; }
  $('topRoutes').innerHTML = list.slice(0, 8).map(function (r) {
    var ms = Object.keys(r.modes).sort(function (x, y) { return r.modes[y] - r.modes[x]; });
    return '<button type="button" class="hit-row" data-i="' + r.last + '">' + badge(ms[0], true) +
      '<span class="t"><b>' + esc(placeLabel(r.a)) + ' ↔ ' + esc(placeLabel(r.b)) + '</b><small>' + ms.slice(0, 3).map(function (m) { return LABEL[m] || m; }).join(', ') + ' · ' + dist(r.km / r.n) + ' each way</small></span>' +
      '<span class="r num">' + fmt(r.n) + '<small>trips</small></span></button>';
  }).join('');
}
function renderPlaces() {
  var by = {}, list = [], useStays = selV.length > 0, j, p;
  if (useStays) {
    for (j = 0; j < selV.length; j++) {
      var v = selV[j]; p = D.pv[v];
      var lbl = placeLabel(p), o = by[lbl] || (by[lbl] = { p: p, n: 0, h: 0 });
      o.n++; o.h += (D.ve[v] - D.vs[v]) / 36e5;
    }
  } else {
    for (j = 0; j < sel.length; j++) {
      p = D.pb[sel[j]];
      if (p < 0) continue;
      var lb2 = placeLabel(p);
      (by[lb2] || (by[lb2] = { p: p, n: 0, h: 0 })).n++;
    }
  }
  for (var k in by) list.push(by[k]);
  list.sort(function (a, b) { return useStays ? b.h - a.h : b.n - a.n; });
  $('placesTitle').textContent = useStays ? 'Where you spent time' : 'Where you went';
  $('placesNote').textContent = useStays ? 'Places you stayed, by total time there. Tap one for its visits, spots and a Google Maps link.' : 'Places your trips ended, by number of trips. Tap one to see it on the map.';
  if (!list.length) { $('topPlaces').innerHTML = '<p class="empty">No places in this selection.</p>'; return; }
  $('topPlaces').innerHTML = list.slice(0, 8).map(function (o) {
    var q = D.places[o.p], cc = countryAt(q.lat, q.lng), home = o.p === D.home;
    return '<button type="button" class="hit-row" data-place="' + o.p + '"><span class="mode-badge sm" style="background:' + (home ? 'var(--accent)' : 'var(--m-other)') + '">' + icon(home ? 'home' : 'pin') + '</span>' +
      '<span class="t"><b>' + esc(placeLabel(o.p)) + '</b><small>' + (flag(cc) ? flag(cc) + ' ' : '') + esc(ccName(cc)) + (useStays ? ' · ' + fmt(o.n) + ' stay' + (o.n > 1 ? 's' : '') : '') + '</small></span>' +
      '<span class="r num">' + (useStays ? hoursLabel(o.h).replace(/ \d+ min$/, '') : fmt(o.n) + '<small>trips</small>') + '</span></button>';
  }).join('');
}
// Explorer squares in the trips shown: how many, the biggest cluster and square, and new ones per year.
function renderSquares() {
  var E = explorer(), years = {};
  $('sqCard').hidden = !E.sq.size;
  if (!E.sq.size) return;
  E.sq.forEach(function (o) { var y = D.year[o.i]; years[y] = (years[y] || 0) + 1; });
  $('sqStats').innerHTML = stat('Squares', fmt(E.sq.size), '', 'about 1.5 km across') +
    stat('Biggest cluster', fmt(E.cluster.size), '', 'squares with all four neighbours visited') +
    stat('Max square', E.max + '×' + E.max, '', fmt(E.max * E.max) + ' squares, all visited');
  var ys = Object.keys(years).map(Number).sort(), mx = Math.max.apply(null, ys.map(function (y) { return years[y]; }));
  $('sqYears').innerHTML = ys.length > 1 ? '<p class="fine" style="margin:0">New squares each year</p>' + ys.map(function (y) {
    return '<div class="bar-row"><span class="num" style="font-size:12px">' + y + '</span><div><div class="track"><i style="width:' + (years[y] / mx * 100).toFixed(1) + '%;background:var(--accent)"></i></div></div><div class="val">+' + fmt(years[y]) + '</div></div>';
  }).join('') : '';
}
// Each bike and pair of shoes in the trips shown: distance, activities and when it was used.
function renderGear() {
  var by = {}, j, i;
  for (j = 0; j < sel.length; j++) {
    i = sel[j];
    var g = D.gear[i];
    if (!g) continue;
    var x = by[g] || (by[g] = { g: g, km: 0, n: 0, d0: D.day[i], d1: D.day[i] });
    x.km += D.km[i]; x.n++; x.d1 = D.day[i];
  }
  var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.km - a.km; });
  $('gearCard').hidden = !list.length;
  if (!list.length) return;
  var max = list[0].km;
  $('gearList').innerHTML = list.map(function (x) {
    var G = M.gear[x.g], d = distParts(x.km);
    return '<button type="button" class="hit-row gear-row" data-gear="' + x.g + '"><span class="mode-badge sm" style="background:' + modeColor(G.mode) + '">' + icon(gearIcon(x.g)) + '</span>' +
      '<span class="t"><b>' + esc(G.name) + '</b><small>' + gearKind(x.g) + ' · ' + fmt(x.n) + ' activit' + (x.n === 1 ? 'y' : 'ies') + ' · ' + (x.d0 === x.d1 ? niceDate(x.d0) : niceDate(x.d0) + ' – ' + niceDate(x.d1)) + '</small>' +
      '<i class="gear-bar"><i style="width:' + (x.km / max * 100).toFixed(1) + '%;background:' + modeColor(G.mode) + '"></i></i></span>' +
      '<span class="r num">' + d.v + '<small>' + d.u + '</small></span></button>';
  }).join('');
}
// ---------- heart rate ----------
// Fitness from heart rate: for each sport, the speed you usually go at (the median while moving,
// rounded), and each month the median heart rate of the moments within 8% of that speed, after an
// activity's first 5 minutes. The same speed at a lower heart rate means fitter.
var HR_SKIP = 300, HR_NEAR = 0.08, HR_MIN_N = 24, hrData = null;
function hrSportOf(i) {
  var k = D.sport ? D.sport[i] : 0, m = modeOf(i);
  // A motor does part of the work on an e-bike, so its heart rate says little about fitness.
  if (k) return /^e(bike|mtb)$/.test(SPORTS[k][0]) ? null : { key: SPORTS[k][0], label: SPORTS[k][1] };
  return m === 'CYCLING' || m === 'RUNNING' || m === 'WALKING' ? { key: m, label: LABEL[m] } : null;
}
function median(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a.length ? a[a.length >> 1] : 0; }
function hrFitness() {
  var groups = {}, j, i, zt = [0, 0, 0, 0, 0], nHr = 0;
  for (j = 0; j < sel.length; j++) {
    i = sel[j];
    var h = tripHr(i);
    if (!h) continue;
    nHr++;
    hrZoneTimes(h).forEach(function (t, z) { zt[z] += t; });
    var sp = hrSportOf(i), s = sp && tripSpeeds(i);
    if (!s || s.length < 4) continue;
    var g = groups[sp.key] || (groups[sp.key] = { key: sp.key, label: sp.label, v: [], b: [], m: [], i: [] });
    var T = s.map(function (q) { return q[0]; }), V = s.map(function (q) { return q[1]; }), mk = D.year[i] * 12 + D.month[i];
    for (var k = 0; k < h.t.length; k++) {
      if (h.t[k] < HR_SKIP) continue;
      var v = seriesAt(T, V, h.t[k]);
      if (v > 2) { g.v.push(v); g.b.push(h.v[k]); g.m.push(mk); g.i.push(i); }
    }
  }
  var list = Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (g) { return g.v.length >= HR_MIN_N; });
  list.forEach(function (g) {
    // The usual speed, rounded in the units shown: to whole km/h (mph) from 15 up, to halves below.
    var med = distVal(median(g.v)), r = med >= 15 ? Math.round(med) : Math.round(med * 2) / 2;
    g.refShow = r; g.ref = r / distVal(1);
    var by = {};
    for (var k = 0; k < g.v.length; k++) {
      if (Math.abs(g.v[k] - g.ref) > g.ref * HR_NEAR) continue;
      var o = by[g.m[k]] || (by[g.m[k]] = { b: [], acts: {} });
      o.b.push(g.b[k]); o.acts[g.i[k]] = 1;
    }
    g.months = Object.keys(by).map(Number).sort(function (a, b) { return a - b; }).filter(function (m) { return by[m].b.length >= HR_MIN_N; })
      .map(function (m) { return { m: m, bpm: median(by[m].b), n: Object.keys(by[m].acts).length }; });
    g.size = g.v.length;
  });
  list = list.filter(function (g) { return g.months.length; }).sort(function (a, b) { return b.size - a.size; });
  return { groups: list, zt: zt, n: nHr };
}
function renderHeart() {
  hrData = hrFitness();
  $('hrCard').hidden = !hrData.n;
  if (!hrData.n) return;
  var G = hrData.groups;
  if (!G.some(function (g) { return g.key === PREFS.hrSport; }) && G.length) PREFS.hrSport = G[0].key;
  $('hrSportSeg').innerHTML = G.length > 1 ? G.map(function (g) { return '<button type="button" data-k="' + g.key + '" aria-pressed="' + (g.key === PREFS.hrSport) + '">' + esc(g.label) + '</button>'; }).join('') : '';
  $('hrSportSeg').hidden = G.length < 2;
  drawHrFit();
  // Time in each zone over every activity with heart rate.
  var zt = hrData.zt, tot = zt.reduce(function (a, b) { return a + b; }, 0) || 1;
  $('hrZoneTotals').innerHTML = '<div class="hz-bar" role="img" aria-label="Time in each heart rate zone">' + zt.map(function (t, z) { return t ? '<i style="width:' + (t / tot * 100).toFixed(2) + '%;background:' + HR_COLORS[z] + '"></i>' : ''; }).join('') + '</div>' +
    '<div class="hz-rows" style="margin-top:10px">' + HR_ZONES.map(function (Z, z) {
      return '<div class="hz-row' + (zt[z] ? '' : ' none') + '"><i style="background:' + HR_COLORS[z] + '"></i><span class="hz-n">' + Z.n + ' ' + Z.name + '</span><span class="fine">' + hrZoneRange(z) + ' bpm</span>' +
        '<span class="num">' + (zt[z] ? hoursLabel(zt[z] / 3600).replace(/ \d+ min$/, '') : '–') + '</span><span class="num hz-p">' + Math.round(zt[z] / tot * 100) + '%</span></div>';
    }).join('') + '</div>' +
    '<p class="fine" style="margin:10px 0 0">' + fmt(hrData.n) + ' activit' + (hrData.n === 1 ? 'y' : 'ies') + ' with heart rate, ' + hoursLabel(tot / 3600).replace(/ \d+ min$/, '') + ' in all. Maximum heart rate ' + hrMax() + ' bpm' + (PREFS.maxHr >= 100 ? ', as set in Settings.' : ', the highest they reached; set your own in Settings.') + '</p>';
}
function drawHrFit() {
  var host = $('hrFitChart'), G = hrData && hrData.groups, g = G && G.filter(function (x) { return x.key === PREFS.hrSport; })[0];
  host.textContent = '';
  if (!g) {
    $('hrFitTitle').textContent = 'Fitness';
    host.innerHTML = '<p class="hr-empty">No rides, runs or walks with both heart rate and GPS speed here.</p>';
    $('hrFitNote').textContent = '';
    return;
  }
  var unit = PREFS.unit === 'mi' ? 'mph' : 'km/h', M = g.months;
  $('hrFitTitle').textContent = 'Fitness: heart rate at ' + fmt(g.refShow, g.refShow % 1 ? 1 : 0) + ' ' + unit + ' (' + g.label.toLowerCase() + ')';
  var W = Math.max(240, host.clientWidth), H = 196, L0 = 34, R0 = 8, T0 = 8, B0 = 30, w = W - L0 - R0, h = H - T0 - B0;
  var m0 = M[0].m, m1 = Math.max(M[M.length - 1].m, m0 + 1), lo = Infinity, hi = -Infinity;
  M.forEach(function (o) { lo = Math.min(lo, o.bpm); hi = Math.max(hi, o.bpm); });
  var st = Math.max(5, Math.round(niceStep(Math.max(10, hi - lo), 4))); lo = Math.floor((lo - 2) / st) * st; hi = Math.max(lo + st, Math.ceil((hi + 2) / st) * st);
  var x = function (m) { return L0 + w * (m - m0) / (m1 - m0); }, y = function (b) { return T0 + h * (1 - (b - lo) / (hi - lo)); };
  var svg = svgEl('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': $('hrFitTitle').textContent + ', by month' });
  for (var v = lo; v <= hi + 1e-9; v += st) {
    svg.appendChild(svgEl('line', { x1: L0, x2: W - R0, y1: y(v), y2: y(v), stroke: 'var(--grid)', 'stroke-width': 1 }));
    var tx = svgEl('text', { x: L0 - 6, y: y(v) + 4, 'text-anchor': 'end' }); tx.textContent = fmt(v); svg.appendChild(tx);
  }
  // Month labels, as many as fit; January shows its year.
  var every = Math.max(1, Math.ceil(44 / (w / Math.max(1, m1 - m0))));
  for (var m = m0; m <= m1; m++) {
    if ((m - m0) % every && m % 12) continue;
    var t = svgEl('text', { x: x(m), y: H - 6, 'text-anchor': 'middle' }); t.textContent = m % 12 ? MONTHS[m % 12] : String(Math.floor(m / 12)); svg.appendChild(t);
  }
  // The trend: a straight line fitted through the months, weighted by activities.
  var sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  M.forEach(function (o) { var wt = Math.sqrt(o.n); sw += wt; sx += wt * o.m; sy += wt * o.bpm; sxx += wt * o.m * o.m; sxy += wt * o.m * o.bpm; });
  var den = sw * sxx - sx * sx, slope = M.length > 1 && den ? (sw * sxy - sx * sy) / den : 0, icpt = (sy - slope * sx) / sw;
  if (M.length > 1) svg.appendChild(svgEl('line', { x1: x(M[0].m), x2: x(M[M.length - 1].m), y1: y(icpt + slope * M[0].m), y2: y(icpt + slope * M[M.length - 1].m), stroke: 'var(--muted)', 'stroke-width': 1.5, 'stroke-dasharray': '4 4' }));
  // Months next to each other are joined; a month without enough riding leaves a gap.
  var path = '';
  M.forEach(function (o, k) { path += (k && M[k - 1].m === o.m - 1 ? 'L' : 'M') + x(o.m).toFixed(1) + ' ' + y(o.bpm).toFixed(1); });
  svg.appendChild(svgEl('path', { d: path, fill: 'none', stroke: HR_COLORS[4], 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  M.forEach(function (o) {
    var c = svgEl('circle', { cx: x(o.m), cy: y(o.bpm), r: 4, fill: 'var(--panel)', stroke: HR_COLORS[4], 'stroke-width': 2, class: 'hf-dot' });
    var ti = svgEl('title', {}); ti.textContent = MONTHS_LONG[o.m % 12] + ' ' + Math.floor(o.m / 12) + ': ' + o.bpm + ' bpm at about ' + fmt(g.refShow, g.refShow % 1 ? 1 : 0) + ' ' + unit + ', from ' + o.n + ' activit' + (o.n === 1 ? 'y' : 'ies');
    c.appendChild(ti); svg.appendChild(c);
  });
  host.appendChild(svg);
  var first = M[0], last = M[M.length - 1], ch = Math.round(slope * (last.m - first.m));
  $('hrFitNote').textContent = M.length < 2 ? 'Only one month here with enough ' + g.label.toLowerCase() + ' at this speed. Pick a longer period to see the trend.' :
    Math.abs(ch) < 2 ? 'About the same since ' + MONTHS_LONG[first.m % 12] + ' ' + Math.floor(first.m / 12) + '.' :
    (ch < 0 ? 'Down ' + -ch + ' bpm' : 'Up ' + ch + ' bpm') + ' at the same speed since ' + MONTHS_LONG[first.m % 12] + ' ' + Math.floor(first.m / 12) + (ch < 0 ? ': fitter.' : '. Lower means fitter; heat and tiredness push it up too.');
}
$('hrSportSeg').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-k]');
  if (!b) return;
  PREFS.hrSport = b.dataset.k; savePrefs();
  setPressed('#hrSportSeg button', function (x) { return x.dataset.k === PREFS.hrSport; });
  drawHrFit();
});
function renderRecords() {
  var best = {}, j, i, byDay = {};
  function rec(key, i_, v) { if (v > 0 && (!best[key] || v > best[key].v)) best[key] = { i: i_, v: v }; }
  for (j = 0; j < sel.length; j++) {
    i = sel[j];
    var m = modeOf(i), g = groupOf(m).key, h = hours(i);
    rec('far', i, D.km[i]);
    rec('long', i, h);
    if (g === 'air') rec('air', i, D.km[i]);
    if (g === 'road') rec('road', i, D.km[i]);
    if (g === 'transit') rec('transit', i, D.km[i]);
    if (g === 'foot') rec('foot', i, D.km[i]);
    if (g === 'bike') rec('bike', i, D.km[i]);
    if (g !== 'air' && h >= 1 / 12) rec('fast', i, D.km[i] / h);
    var dd = byDay[D.day[i]] || (byDay[D.day[i]] = { km: 0, n: 0 });
    dd.km += D.km[i]; dd.n++;
  }
  var bd = null, bn = null;
  for (var d in byDay) {
    if (!bd || byDay[d].km > byDay[bd].km) bd = d;
    if (!bn || byDay[d].n > byDay[bn].n) bn = d;
  }
  var items = [
    ['far', 'ruler', 'Longest trip', function (r) { return dist(r.v); }],
    ['long', 'clock', 'Longest time on the move', function (r) { return hoursLabel(r.v); }],
    ['air', 'FLYING', 'Longest flight', function (r) { return dist(r.v); }],
    ['road', 'CAR', 'Longest drive', function (r) { return dist(r.v); }],
    ['transit', 'TRAIN', 'Longest public transport trip', function (r) { return dist(r.v); }],
    ['foot', 'WALKING', 'Longest walk', function (r) { return dist(r.v); }],
    ['bike', 'CYCLING', 'Longest ride', function (r) { return dist(r.v); }],
    ['fast', 'bolt', 'Fastest on the ground', function (r) { return speed(r.v); }]
  ];
  var h = items.filter(function (x) { return best[x[0]]; }).map(function (x) {
    var r = best[x[0]];
    return '<button type="button" class="record" data-i="' + r.i + '"><span class="k">' + icon(x[1]) + x[2] + '</span><span class="v">' + x[3](r) + '</span><span class="s">' + esc(tripRoute(r.i)) + ' · ' + niceDate(D.day[r.i]) + '</span></button>';
  }).join('');
  if (bd) h += '<button type="button" class="record" data-day="' + bd + '"><span class="k">' + icon('calendar') + 'Furthest in a day</span><span class="v">' + dist(byDay[bd].km) + '</span><span class="s">' + longDate(+bd) + '</span></button>';
  if (bn) h += '<button type="button" class="record" data-day="' + bn + '"><span class="k">' + icon('calendar') + 'Most trips in a day</span><span class="v">' + fmt(byDay[bn].n) + '</span><span class="s">' + longDate(+bn) + '</span></button>';
  $('records').innerHTML = h;
}
// Days between records: when you were last seen in a country and next seen in the same
// one, the days in between count there too (a month between two flights is a month there).
// Built once from all the data, so a filter's edges don't cut a stay short.
var ccGaps = null;
function evDay(ms, off) {
  if (off !== NO_OFF) return Math.floor((ms + off * 60000) / 864e5);
  var d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
}
function countryGaps() {
  if (ccGaps && ccGaps.D === D) return ccGaps.list;
  var ev = [], i, k;
  for (i = 0; i < D.day.length; i++) ev.push([D.start[i], D.day[i], D.cs[i]], [D.end[i], evDay(D.end[i], D.off[i]), D.ce[i]]);
  for (i = 0; i < D.vs.length; i++) ev.push([D.vs[i], D.vday[i], D.vcc[i]], [D.ve[i], evDay(D.ve[i], D.voff[i]), D.vcc[i]]);
  ev.sort(function (a, b) { return a[0] - b[0]; });
  var list = [];   // [country index, first day, last day] of each gap
  for (k = 1; k < ev.length; k++) {
    var a = ev[k - 1], b = ev[k];
    if (a[2] === b[2] && D.ccList[a[2]] && b[1] > a[1] + 1) list.push([a[2], a[1] + 1, b[1] - 1]);
  }
  ccGaps = { D: D, list: list };
  return list;
}
// Calls add(country index, day) for each gap day up to day `last` that passes the same day
// filters as trips and stays. A year with no records at all isn't in the year filter, so
// 'all years' lets it through.
function gapDays(last, add) {
  var allCC = F.countries.size === M.countries.length, allY = F.years.size === M.years.length;
  countryGaps().forEach(function (g) {
    if (!allCC && !F.countries.has(g[0])) return;
    for (var d = g[1]; d <= Math.min(g[2], last); d++) {
      if (!dayOk(d)) continue;
      var x = dayToDate(d);
      if ((allY || F.years.has(x.getUTCFullYear())) && F.months.has(x.getUTCMonth()) && F.dows.has(x.getUTCDay())) add(g[0], d);
    }
  });
}
// Where an event falls on the local day line: day number plus the fraction of the day.
function evPos(ms, off) {
  if (off !== NO_OFF) return (ms + off * 60000) / 864e5;
  var d = new Date(ms);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) / 864e5;
}
// Visits: the selected trips and stays in time order, cut wherever the country changes.
// A visit with others before and after it that lasted under a day is a short stop, and a
// layover when you both flew in and flew out: a true layover when you stayed by the
// airport (nothing over 5 km from where you landed or took off; big hubs and their terminals
// spread over a few km), and a layover with a visit
// when you went further, into town or to another airport.
var STOP_MS = 864e5, LAYOVER_KM = 5;
function countryVisits() {
  var ev = [], fly = MODES.indexOf('FLYING'), j, i, v;
  for (j = 0; j < sel.length; j++) {
    i = sel[j];
    var air = D.mode[i] === fly;
    ev.push({ t: D.start[i], cc: D.ccList[D.cs[i]], off: D.off[i], trip: 1, dep: air, ll: [D.from[2 * i], D.from[2 * i + 1]] }, { t: D.end[i], cc: D.ccList[D.ce[i]], off: D.off[i], trip: 1, arr: air, ll: [D.to[2 * i], D.to[2 * i + 1]] });
  }
  for (j = 0; j < selV.length; j++) {
    v = selV[j];
    var vll = [D.vll[2 * v], D.vll[2 * v + 1]];
    ev.push({ t: D.vs[v], cc: D.ccList[D.vcc[v]], off: D.voff[v], ll: vll }, { t: D.ve[v], cc: D.ccList[D.vcc[v]], off: D.voff[v], ll: vll });
  }
  ev = ev.filter(function (e) { return e.cc; }).sort(function (a, b) { return a.t - b.t; });
  var out = [], cur = null;
  ev.forEach(function (e) {
    if (cur && cur.cc === e.cc) { cur.t1 = e.t; cur.p1 = evPos(e.t, e.off); cur.last = e; cur.ev.push(e); return; }
    cur = { cc: e.cc, t0: e.t, t1: e.t, p0: evPos(e.t, e.off), p1: evPos(e.t, e.off), first: e, last: e, ev: [e] };
    out.push(cur);
  });
  out.forEach(function (x, k) {
    // A trip's times carry the offset where it started, so an arrival is in the zone you came
    // from: place the visit by the offset of what followed in this country.
    if (x.first.arr && x.last !== x.first) { x.p0 = evPos(x.t0, x.last.off); x.p1 = evPos(x.t1, x.last.off); }
    x.off = x.first.arr ? x.last.off : x.first.off;
    x.ms = x.t1 - x.t0;
    x.short = k > 0 && k < out.length - 1 && x.ms < STOP_MS;
    // How you got there and left: the first and last trips in the visit. A stay can end at the
    // same second the next flight starts, so the last event isn't always the departure.
    var trips = x.ev.filter(function (e) { return e.trip; }), tIn = trips[0], tOut = trips[trips.length - 1];
    x.layover = x.short && trips.length > 1 && !!tIn.arr && !!tOut.dep;
    if (x.layover) {
      var a = tIn.ll, b = tOut.ll;
      x.away = x.ev.reduce(function (m, e) {
        var d = Math.min(haversine(e.ll, a), haversine(e.ll, b));
        return isFinite(d) ? Math.max(m, d) : m;
      }, 0);
      x.visit = x.away > LAYOVER_KM;
    }
    delete x.ev;
  });
  return out;
}
function stopText(c) {
  var n = c.stops.length, v = c.stops.filter(function (x) { return x.visit; }).length;
  if (c.kind === 'layover') return n > 1 ? fmt(n) + ' layovers' + (v ? ', ' + fmt(v) + ' with a visit' : '') : v ? 'Layover with a visit' : 'Layover';
  return n > 1 ? fmt(n) + ' short stops' : 'Short stop';
}
function stopKind(x) { return x.layover ? (x.visit ? 'layover with a visit' : 'layover') : 'short stop'; }
function renderCountries() {
  var by = {}, perDay = {};   // perDay[day][cc] = earliest time seen there that day
  function add(k, d, t) {
    var cc = D.ccList[k];
    if (!cc) return;
    var c = by[cc] || (by[cc] = { cc: cc, days: {}, first: d, last: d });
    c.days[d] = 1; if (d < c.first) c.first = d; if (d > c.last) c.last = d;
    var pd = perDay[d] || (perDay[d] = {});
    if (t == null) t = d * 864e5;
    if (!(cc in pd) || t < pd[cc]) pd[cc] = t;
  }
  for (var j = 0; j < sel.length; j++) { var i = sel[j]; add(D.cs[i], D.day[i], D.start[i]); add(D.ce[i], evDay(D.end[i], D.off[i]), D.end[i]); }
  for (var v = 0; v < selV.length; v++) {
    var w = selV[v];
    add(D.vcc[w], D.vday[w], D.vs[w]);
    add(D.vcc[w], evDay(D.ve[w], D.voff[w]), D.ve[w]);   // and the day the stay ended
  }
  gapDays(Infinity, function (k, d) { add(k, d); });
  var list = Object.keys(by).map(function (k) { var c = by[k]; c.n = Object.keys(c.days).length; c.stops = []; c.stays = 0; return c; }).sort(function (a, b) { return b.n - a.n; });
  var visits = countryVisits();
  visits.forEach(function (x) { var c = by[x.cc]; if (c) { if (x.short) c.stops.push(x); else c.stays++; } });
  // A country you only passed through: every visit there was a short stop.
  list.forEach(function (c, r) {
    c.color = ccColor(r);
    c.kind = c.stays || !c.stops.length ? '' : c.stops.every(function (x) { return x.layover; }) ? 'layover' : 'stop';
    c.stopMs = c.stops.reduce(function (a, x) { return a + x.ms; }, 0);
  });
  renderCcTimeline(list, perDay, visits);
  var many = list.length > 1;
  var passed = list.filter(function (c) { return c.kind; }).length;
  $('ccNote').textContent = list.length ? fmt(list.length) + ' countr' + (list.length === 1 ? 'y' : 'ies') + (passed ? ' (' + fmt(passed) + ' only passed through)' : '') + ', by days you were there. Days between your records count too when you were in the same country before and after. Flights count only where they took off and landed. A stop of under a day between other countries is a short stop, or a layover when you flew in and out (with a visit when you went over 5 km from the airport).' : '';
  var max = list.length ? list[0].n : 1;
  $('ccList').innerHTML = list.length ? list.map(function (c) {   // always every country, never cut short
    return '<div class="hit-row" style="cursor:default"><span class="flag" aria-hidden="true" style="font-size:22px;width:28px;text-align:center">' + (flag(c.cc) || '·') + '</span>' +
      '<span class="t"><b>' + esc(ccName(c.cc)) + '</b>' + (c.kind ? ' <span class="cc-stop">' + (c.kind === 'layover' ? icon('FLYING') : '') + stopText(c) + ' · ' + duration(c.stopMs) + '</span>' : '') + '<small>' + (c.first === c.last ? niceDate(c.first) : niceDate(c.first) + ' – ' + niceDate(c.last)) + '</small><span class="meter" style="display:block;margin-top:6px"><i style="width:' + (c.n / max * 100).toFixed(1) + '%' + (many ? ';background:' + c.color : '') + '"></i></span></span>' +
      '<span class="r num">' + fmt(c.n) + '<small>day' + (c.n > 1 ? 's' : '') + '</small></span></div>';
  }).join('') : '<p class="empty">No countries in this selection.</p>';
}
// ---------- countries over time ----------
// A colour per country, by days there in this selection: the eight chart hues, then the
// same hues striped one way and the other, so neighbours stay apart past eight countries.
function ccColor(r) {
  var c = 'var(--cc' + (r % 8 + 1) + ')', t = Math.floor(r / 8);
  if (!t) return c;
  return 'repeating-linear-gradient(' + (t % 2 ? 45 : 135) + 'deg,' + c + ' 0 5px,color-mix(in srgb,' + c + ' 55%,#000) 5px 8px)';
}
var CT = null;   // the strip's state: period, day runs, zoom
// Every record's day and country, from all the data, to look up where you were last seen
// before a stretch with no records and where next.
var ccSeen = null;
function ccSeenList() {
  if (ccSeen && ccSeen.D === D) return ccSeen.list;
  var ev = [], i;
  for (i = 0; i < D.day.length; i++) ev.push([D.start[i], D.day[i], D.ccList[D.cs[i]]], [D.end[i], evDay(D.end[i], D.off[i]), D.ccList[D.ce[i]]]);
  for (i = 0; i < D.vs.length; i++) ev.push([D.vs[i], D.vday[i], D.ccList[D.vcc[i]]], [D.ve[i], evDay(D.ve[i], D.voff[i]), D.ccList[D.vcc[i]]]);
  // By day (then time): local days can run backwards across time zones, and this list is searched by day.
  ev = ev.filter(function (e) { return e[2]; }).sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
  ccSeen = { D: D, list: ev };
  return ev;
}
// Stretches of the strip with no records: the country you were last seen in before and next
// seen in after. The same country fills the stretch; two countries share it half and half.
// They're drawn faded as a guess and don't add to the day counts. Left blank when a month,
// weekday, year or country filter is on, since those leave days out on purpose.
function ccGuesses(lo, hi, runs, byCc, list) {
  if (F.months.size !== 12 || F.dows.size !== 7 || F.years.size !== M.years.length || F.countries.size !== M.countries.length) return [];
  var ev = ccSeenList(), out = [], k = 0, d = lo;
  function before(day) { var a = 0, b = ev.length - 1, r = -1; while (a <= b) { var m = (a + b) >> 1; if (ev[m][1] < day) { r = m; a = m + 1; } else b = m - 1; } return r; }
  function color(cc) {
    if (!byCc[cc]) { byCc[cc] = { cc: cc, n: 0, days: {}, first: lo, last: lo, stops: [], kind: '', guessOnly: true, color: ccColor(list.length) }; list.push(byCc[cc]); }
    return cc;
  }
  function fill(a, b) {
    var i = before(a), A = i >= 0 ? ev[i][2] : null, B = i + 1 < ev.length ? ev[i + 1][2] : null;
    if (!A || !B || ev[i + 1][1] <= b) return;   // nothing before or after, or a record inside
    var from = ev[i][1], to = ev[i + 1][1];
    if (A === B) { out.push({ d0: a, d1: b, parts: [color(A)], guess: { a: A, b: B, from: from, to: to } }); return; }
    var mid = Math.floor((from + to) / 2);   // the last day given to A
    if (mid >= a) out.push({ d0: a, d1: Math.min(b, mid), parts: [color(A)], guess: { a: A, b: B, from: from, to: to } });
    if (mid < b) out.push({ d0: Math.max(a, mid + 1), d1: b, parts: [color(B)], guess: { a: A, b: B, from: from, to: to } });
  }
  runs.forEach(function (r) { if (r.d0 > d) fill(d, r.d0 - 1); d = Math.max(d, r.d1 + 1); });
  if (d <= hi) fill(d, hi);
  return out;
}
function renderCcTimeline(list, perDay, visits) {
  var card = $('cctlCard'), off = F.modes.size !== M.modes.length || F.sports.size !== M.sports.length;
  // Only with every kind of transport: a filtered set of trips leaves holes in where you were.
  card.classList.toggle('off', off); $('cctlOff').hidden = !off;
  if (off) { card.hidden = false; CT = null; return; }
  if (list.length < 2) { card.hidden = true; CT = null; return; }
  list = list.slice();   // countries only guessed get added here, not to the Countries list
  card.hidden = false;
  var days = Object.keys(perDay).map(Number), lo, hi;
  if (F.dm === 'one') { lo = periodStart(F.one, F.unit); hi = periodEnd(F.one, F.unit); }
  else if (F.dm === 'range' || F.dm === 'week') { lo = F.from; hi = F.to; }
  else { lo = Math.min.apply(null, days); hi = Math.max.apply(null, days); }
  var byCc = {}, d;
  list.forEach(function (c) { byCc[c.cc] = c; });
  // Which countries on a day you were in for more than a short stop.
  var long = {};
  visits.forEach(function (x) { if (!x.short) for (var k = Math.floor(x.p0); k <= Math.floor(x.p1); k++) long[k + '|' + x.cc] = 1; });
  // Runs of days in the same single country. Split: a day in more than one country is a
  // run of its own, in the order you got there. Not split (zoomed out): the day goes to the
  // last country you got to that day that wasn't just a short stop.
  function runsOf(split) {
    var runs = [];
    for (d = lo; d <= hi; d++) {
      var pd = perDay[d];
      if (!pd) continue;
      var parts = Object.keys(pd).sort(function (a, b) { return pd[a] - pd[b]; }), last = runs[runs.length - 1];
      if (!split && parts.length > 1) {
        var main = parts.filter(function (cc) { return long[d + '|' + cc]; });
        parts = [main.length ? main[main.length - 1] : parts[parts.length - 1]];
      }
      if (parts.length === 1 && last && last.parts.length === 1 && last.parts[0] === parts[0] && last.d1 === d - 1) last.d1 = d;
      else runs.push({ d0: d, d1: d, parts: parts });
    }
    return runs;
  }
  var stops = visits.filter(function (x) { return x.short && byCc[x.cc] && x.p1 >= lo && x.p0 < hi + 1; });
  var runsS = runsOf(true), runsM = runsOf(false), guess = ccGuesses(lo, hi, runsM, byCc, list);
  function withGuess(runs) { return runs.concat(guess).sort(function (a, b) { return a.d0 - b.d0; }); }
  CT = { lo: lo, hi: hi, span: hi - lo + 1, runsS: withGuess(runsS), runsM: withGuess(runsM), runs: null, split: null, stops: stops, list: list, byCc: byCc, fit: true, ppd: 1, on: null };
  $('cctlInfo').textContent = '';
  $('cctlLegend').innerHTML = list.map(function (c) {
    return '<button type="button" data-cc="' + c.cc + '"><span class="cctl-sw" style="background:' + c.color + '"></span>' + (flag(c.cc) ? flag(c.cc) + ' ' : '') + esc(ccName(c.cc)) + ' <small>' + (c.guessOnly ? 'guessed only' : fmt(c.n) + ' day' + (c.n > 1 ? 's' : '')) + (c.kind ? ' · ' + stopText(c).toLowerCase() : '') + '</small></button>';
  }).join('');
  cctlFit();
}
function cctlFitPpd() { return Math.max(1e-3, $('cctlScroll').clientWidth / CT.span); }
function cctlFit() { if (!CT) return; CT.fit = true; CT.ppd = cctlFitPpd(); cctlDraw(); $('cctlScroll').scrollLeft = 0; }
var CCTL_MAX = 90;   // px per day at the closest zoom
function cctlZoom(ppd, ax) {
  if (!CT) return;
  var sc = $('cctlScroll'), min = cctlFitPpd();
  if (ax == null) ax = sc.clientWidth / 2;
  var at = (sc.scrollLeft + ax) / CT.ppd;
  ppd = Math.max(min, Math.min(Math.max(CCTL_MAX, min), ppd));
  if (Math.abs(ppd - CT.ppd) < 1e-6) return;
  CT.ppd = ppd; CT.fit = ppd <= min * 1.0001;
  cctlDraw();
  sc.scrollLeft = at * ppd - ax;
  cctlAxis();
}
var CCTL_MONTHS = 1.1;   // px per day from which every month on the axis gets its name
var CCTL_SPLIT = 36;   // px per day from which a day in two countries is drawn split
function cctlDraw() {
  var ppd = CT.ppd, W = CT.span * ppd, h = [], split = ppd >= CCTL_SPLIT;
  if (split !== CT.split) { CT.split = split; CT.runs = split ? CT.runsS : CT.runsM; if (CT.on) CT.on = { cc: CT.on.cc, r: null }; }
  $('cctlTrack').style.width = W + 'px';
  CT.runs.forEach(function (r, k) {
    var x = (r.d0 - CT.lo) * ppd, w = (r.d1 - r.d0 + 1) * ppd, pw = w / r.parts.length;
    r.parts.forEach(function (cc, p) {
      var c = CT.byCc[cc], n = r.d1 - r.d0 + 1, lab = '';
      if (pw >= 150 && r.parts.length === 1) lab = '<span class="f">' + flag(cc) + '</span>' + esc(ccName(cc)) + ' · ' + fmt(n) + ' day' + (n > 1 ? 's' : '');
      else if (pw >= 44 && r.parts.length === 1) lab = '<span class="f">' + flag(cc) + '</span>' + fmt(n) + 'd';
      else if (pw >= 24) lab = '<span class="f">' + flag(cc) + '</span>';
      if (r.guess) lab = pw >= 44 ? '<span class="f">' + flag(cc) + '</span>≈' + fmt(n) + 'd' : pw >= 24 ? '<span class="f">' + flag(cc) + '</span>' : '';
      h.push('<b data-r="' + k + '" data-p="' + p + '" class="' + (r.guess ? 'q ' : '') + (pw >= 6 ? 'g ' : '') + (CT.on && (CT.on.cc === cc && (CT.on.r == null && CT.on.s == null || CT.on.r === k && CT.on.p === p)) ? 'on' : '') + '" style="left:' + (x + p * pw).toFixed(2) + 'px;width:' + Math.max(pw, 1).toFixed(2) + 'px;background:' + c.color + '">' + lab + '</b>');
    });
  });
  $('cctlBars').innerHTML = h.join('');
  // Stops as pins at the time you were there. A true layover (you stayed at the airport) is a
  // circle under the strip; a stop where you got out (a layover with a visit, or a short stop
  // on the ground) is a downward pentagon above it.
  // Where pins would overlap, layovers and countries you only passed through go first, and
  // a short stop in a country that has its own blocks is left out until you zoom in.
  var placed = [], order = CT.stops.map(function (x, k) { return k; }).sort(function (a, b) {
    var pa = CT.stops[a].layover || CT.byCc[CT.stops[a].cc].kind ? 0 : 1, pb = CT.stops[b].layover || CT.byCc[CT.stops[b].cc].kind ? 0 : 1;
    return pa - pb || a - b;
  });
  var keep = {}, placedLow = [];
  function airside(x) { return x.layover && !x.visit; }
  order.forEach(function (k) {
    var x = CT.stops[k], px = ((x.p0 + x.p1) / 2 - CT.lo) * ppd, must = x.layover || CT.byCc[x.cc].kind, lane = airside(x) ? placedLow : placed;
    if (airside(x) && ppd < CCTL_MONTHS) return;   // true layovers only once months show
    if (!must && lane.some(function (q) { return Math.abs(q - px) < 20; })) return;
    lane.push(px); keep[k] = 1;
  });
  function pin(x, k) {
    var c = CT.byCc[x.cc], low = airside(x);
    return '<button type="button" data-s="' + k + '" class="' + (low ? 'dot' : 'pent') + (x.layover ? ' air' : '') + (CT.on && CT.on.s === k ? ' on' : '') + '" style="left:' + (((x.p0 + x.p1) / 2 - CT.lo) * ppd).toFixed(1) + 'px;--c:' + c.color.replace(/^repeating.*?,(var\(--cc\d\)).*$/, '$1') + '" aria-label="' + esc(ccName(x.cc)) + ' ' + stopKind(x) + '">' + (low ? '' : '<i></i>') + '<span>' + (flag(x.cc) || '·') + '</span></button>';
  }
  $('cctlPins').innerHTML = CT.stops.map(function (x, k) { return keep[k] && !airside(x) ? pin(x, k) : ''; }).join('');
  $('cctlPinsLow').innerHTML = CT.stops.map(function (x, k) { return keep[k] && airside(x) ? pin(x, k) : ''; }).join('');
  setPressed('#cctlCard .card-head .seg button', function (b) { return b.id === 'cctlFit' && CT.fit; });
  $('cctlOut').disabled = CT.fit; $('cctlIn').disabled = ppd >= Math.max(CCTL_MAX, cctlFitPpd()) * 0.999;
  cctlAxis();
}
// Ticks and labels for what's on screen (and a screen either side), from days up to years.
function cctlAxis() {
  if (!CT) return;
  var sc = $('cctlScroll'), ppd = CT.ppd, vw = sc.clientWidth || 300;
  var a = Math.max(CT.lo, CT.lo + Math.floor((sc.scrollLeft - vw) / ppd)), b = Math.min(CT.hi + 1, CT.lo + Math.ceil((sc.scrollLeft + 2 * vw) / ppd));
  var ticks = [], d;
  for (d = a; d <= b; d++) {
    var x = dayToDate(d), dd = x.getUTCDate(), m = x.getUTCMonth(), y = x.getUTCFullYear(), t = null;
    if (ppd >= 18) t = dd === 1 ? [true, MONTHS[m] + ' ' + y] : [false, String(dd)];
    else if (ppd >= 3.5) t = dd === 1 ? [true, m ? MONTHS[m] : MONTHS[m] + ' ' + y] : x.getUTCDay() === 1 ? [false, String(dd)] : null;
    else if (ppd >= CCTL_MONTHS) t = dd === 1 ? (m ? [false, MONTHS[m]] : [true, String(y)]) : null;
    else t = dd === 1 && !m ? [true, String(y)] : dd === 1 && ppd * 30 >= 6 ? [false, ''] : null;
    if (t) ticks.push({ x: (d - CT.lo) * ppd, major: t[0], text: t[1] });
  }
  // Labels left to right; a month or year label wins over a day label it would overlap.
  // The left edge always says which month (or year) you're looking at.
  var x0 = sc.scrollLeft, e = dayToDate(Math.min(CT.hi, CT.lo + Math.floor(x0 / ppd))), shown = [];
  var edge = { x: x0, major: true, text: ppd >= CCTL_MONTHS ? MONTHS[e.getUTCMonth()] + ' ' + e.getUTCFullYear() : String(e.getUTCFullYear()) };
  edge.w = edge.text.length * 7 + 10;
  ticks = ticks.filter(function (t) { return !(t.text && t.major && t.x >= x0 - 1 && t.x < x0 + edge.w); });
  shown.push(edge);
  ticks.forEach(function (t) {
    if (!t.text || (t.x >= x0 - 30 && t.x < x0)) return;
    t.w = t.text.length * 7 + 10;
    var p = shown[shown.length - 1];
    if (p && p.x + p.w > t.x) {
      if (t.major && !p.major) { shown.pop(); p = shown[shown.length - 1]; if (p && p.x + p.w > t.x) return; }
      else return;
    }
    shown.push(t);
  });
  $('cctlAxis').innerHTML = ticks.map(function (t) { return '<i class="' + (t.major ? 'major' : '') + '" style="left:' + t.x.toFixed(1) + 'px"></i>'; }).join('') +
    shown.map(function (t) { return '<span class="' + (t.major ? 'major' : '') + '" style="left:' + t.x.toFixed(1) + 'px">' + esc(t.text) + '</span>'; }).join('');
}
function cctlRange(a, b) { return a === b ? niceDate(a) : niceDate(a) + ' – ' + niceDate(b); }
function cctlSay(r, p) {
  var run = CT.runs[r], cc = run.parts[p], c = CT.byCc[cc], n = run.d1 - run.d0 + 1, others = run.parts.filter(function (x) { return x !== cc; });
  CT.on = { cc: cc, r: r, p: p };
  if (run.guess) {
    var g = run.guess;
    $('cctlInfo').innerHTML = '<span class="cctl-sw" style="background:' + c.color + ';opacity:.5;vertical-align:-1px"></span> <b>' + flag(cc) + ' ' + esc(ccName(cc)) + '</b>, probably · ' + cctlRange(run.d0, run.d1) +
      ' · no records between ' + niceDate(g.from) + ' in ' + flag(g.a) + ' ' + esc(ccName(g.a)) + ' and ' + niceDate(g.to) + ' in ' + flag(g.b) + ' ' + esc(ccName(g.b)) + ' <span class="fine" style="display:inline">(not in the day counts)</span>';
    $('cctlBars').querySelectorAll('b').forEach(function (b) { b.classList.toggle('on', +b.dataset.r === r && +b.dataset.p === p); });
    return;
  }
  $('cctlInfo').innerHTML = '<span class="cctl-sw" style="background:' + c.color + ';vertical-align:-1px"></span> <b>' + flag(cc) + ' ' + esc(ccName(cc)) + '</b> · ' + cctlRange(run.d0, run.d1) +
    (others.length ? ' · also ' + others.map(function (x) { return flag(x) + ' ' + esc(ccName(x)); }).join(', ') + ' that day' : ' · ' + fmt(n) + ' day' + (n > 1 ? 's' : '')) +
    ' <span class="fine" style="display:inline">(' + fmt(c.n) + ' in total)</span>';
  $('cctlBars').querySelectorAll('b').forEach(function (b) { b.classList.toggle('on', +b.dataset.r === r && +b.dataset.p === p); });
}
function cctlPinClick(ev) {
  var b = ev.target.closest('button[data-s]');
  if (!b || !CT) return;
  var k = +b.dataset.s, x = CT.stops[k], c = CT.byCc[x.cc];
  CT.on = { cc: x.cc, r: null, s: k };
  $('cctlBars').querySelectorAll('b.on').forEach(function (y) { y.classList.remove('on'); });
  $('cctlTrack').querySelectorAll('.cctl-pins button').forEach(function (y) { y.classList.toggle('on', +y.dataset.s === k); });
  $('cctlInfo').innerHTML = '<span class="cctl-sw" style="background:' + c.color + ';vertical-align:-1px"></span> <b>' + flag(x.cc) + ' ' + esc(ccName(x.cc)) + '</b> · ' + stopKind(x) + ' of ' + duration(x.ms) + (x.layover ? (x.visit ? ', up to ' + dist(x.away) + ' from the airport' : ', at the airport') : '') + ' · ' + clock(x.t0, x.off, true) + ' – ' + clock(x.t1, x.off, Math.floor(x.p1) !== Math.floor(x.p0));
}
$('cctlPins').addEventListener('click', cctlPinClick);
$('cctlPinsLow').addEventListener('click', cctlPinClick);
$('cctlBars').addEventListener('click', function (ev) { var b = ev.target.closest('b[data-r]'); if (b && CT) cctlSay(+b.dataset.r, +b.dataset.p); });
$('cctlLegend').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-cc]');
  if (!b || !CT) return;
  var cc = b.dataset.cc, c = CT.byCc[cc], sc = $('cctlScroll');
  CT.on = { cc: cc, r: null };
  $('cctlBars').querySelectorAll('b').forEach(function (x) { x.classList.toggle('on', CT.runs[+x.dataset.r].parts[+x.dataset.p] === cc); });
  $('cctlInfo').innerHTML = '<span class="cctl-sw" style="background:' + c.color + ';vertical-align:-1px"></span> <b>' + flag(cc) + ' ' + esc(ccName(cc)) + '</b> · ' + fmt(c.n) + ' day' + (c.n > 1 ? 's' : '') + (c.first === c.last ? ' · ' + niceDate(c.first) : ' · first ' + niceDate(c.first) + ', last ' + niceDate(c.last));
  var x = (c.first - CT.lo) * CT.ppd;
  if (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth - 20) sc.scrollLeft = x - 20;
});
$('cctlIn').addEventListener('click', function () { if (CT) cctlZoom(CT.ppd * 2); });
$('cctlOut').addEventListener('click', function () { if (CT) cctlZoom(CT.ppd / 2); });
$('cctlFit').addEventListener('click', cctlFit);
$('cctlAllModes').addEventListener('click', function () {
  F.modes = new Set(M.modes); F.sports = new Set(M.sports);
  syncFilterUI(); changed();
});
(function () {
  var sc = $('cctlScroll'), raf = 0, pinch = null;
  sc.addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; cctlAxis(); }); }, { passive: true });
  // Ctrl+wheel, which is also what a trackpad pinch sends, zooms around the pointer.
  sc.addEventListener('wheel', function (ev) {
    if (!CT || !ev.ctrlKey) return;
    ev.preventDefault();
    cctlZoom(CT.ppd * Math.exp(-ev.deltaY * 0.01), ev.clientX - sc.getBoundingClientRect().left);
  }, { passive: false });
  function two(ev) { var a = ev.touches[0], b = ev.touches[1]; return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, x: (a.clientX + b.clientX) / 2 - sc.getBoundingClientRect().left }; }
  sc.addEventListener('touchstart', function (ev) { if (CT && ev.touches.length === 2) { var t = two(ev); pinch = { d: t.d, ppd: CT.ppd }; } }, { passive: true });
  sc.addEventListener('touchmove', function (ev) {
    if (!pinch || ev.touches.length !== 2) return;
    ev.preventDefault();
    var t = two(ev);
    cctlZoom(pinch.ppd * t.d / pinch.d, t.x);
  }, { passive: false });
  sc.addEventListener('touchend', function (ev) { if (ev.touches.length < 2) pinch = null; });
  // The Insights tab may be drawn while hidden, so fit again once the strip has a width.
  if (window.ResizeObserver) new ResizeObserver(function () { if (!CT) return; if (CT.fit) cctlFit(); else cctlZoom(CT.ppd); cctlAxis(); }).observe(sc);
})();
function renderCo2() {
  var by = {}, total = 0, days = {};
  for (var j = 0; j < sel.length; j++) { var i = sel[j], g = groupOf(modeOf(i)), kg = tripKg(i); by[g.key] = (by[g.key] || 0) + kg; total += kg; days[D.day[i]] = 1; }
  var G = GROUPS.filter(function (g) { return by[g.key] > 0; }), max = G.reduce(function (m, g) { return Math.max(m, by[g.key]); }, 0) || 1, c = co2(total);
  var nd = Object.keys(days).length;
  $('co2Card').innerHTML = '<div class="stats" style="margin-bottom:14px">' + stat('Total', c.v, c.u, '') + stat('Per day travelled', co2(total / Math.max(1, nd)).v, co2(total / Math.max(1, nd)).u, '') + '</div>' +
    '<div class="bars">' + (G.length ? G.map(function (g) {
      return '<div class="bar-row"><span class="mode-badge sm" style="background:' + g.color + '">' + icon(g.modes[0]) + '</span><div><div class="name"><span>' + g.label + '</span><span>' + Math.round(by[g.key] / total * 100) + '%</span></div>' +
        '<div class="track"><i style="width:' + (by[g.key] / max * 100).toFixed(1) + '%;background:' + g.color + '"></i></div></div><div class="val">' + co2s(by[g.key]) + '</div></div>';
    }).join('') : '<p class="empty">No emissions from these trips.</p>') + '</div>';
}
document.querySelector('#insightsPage .cards').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-i],[data-day],[data-place],[data-gear]');
  if (!b) return;
  if (b.dataset.gear) {
    // Only this gear's trips: the types it was used for on (with their sports), every other type and gear off.
    var g = +b.dataset.gear, used = M.gear[g].modes;
    M.modes.forEach(function (m) { setMode(m, !!used[m]); });
    F.gear = new Set([g]);
    syncFilterUI(); apply();
    toast('Showing only ' + M.gear[g].name + '. Change it under Transport in Filters.');
  }
  else if (b.dataset.i) { setTab('timeline'); tlSelect(+b.dataset.i, true); }
  else if (b.dataset.day) { setTab('map'); showDay(+b.dataset.day); }
  else if (!openPlace(+b.dataset.place)) {
    // A place you only reached by trip (no stays there) has no page: show it on the map.
    var q = D.places[+b.dataset.place];
    if (PREFS.proj !== 'merc') setProj('merc');
    setTab('map');
    if (map) map.setView([q.lat, q.lng], 15);
  }
});

// ---------- place page ----------
// Everything about one place in the Places list, over your whole history (not just the filters):
// how often and when you go, and the spots inside it. A place in the list is everything with the
// same name (often a town); Google gives each spot you stay at its own place ID, so the spots are
// told apart by that ID even when they're a few metres apart. Stays without an ID (Takeout files
// before IDs, or data saved before BT•DT kept them) fall back to the 300 m grouping.
// Nothing is looked up: the Google Maps buttons are plain links you choose to open.
function mapsUrl(lat, lng, pid) {
  return 'https://www.google.com/maps/search/?api=1&query=' + lat.toFixed(6) + '%2C' + lng.toFixed(6) + (pid ? '&query_place_id=' + encodeURIComponent(pid) : '');
}
function mapsLink(lat, lng, pid, text) {
  return '<a class="btn" href="' + esc(mapsUrl(lat, lng, pid)) + '" target="_blank" rel="noopener noreferrer">' + icon('pin') + (text || 'Open in Google Maps') + '</a>';
}
function placeStays(lbl) {
  var out = [];
  for (var v = 0; v < D.vs.length; v++) if (D.pv[v] >= 0 && placeLabel(D.pv[v]) === lbl) out.push(v);
  return out;
}
// The spot a stay is at: Google's place ID, or the 300 m place when the stay has none.
// The spot each stay is at, worked out once for all stays. A spot is Google's place ID, so two
// shops on one street stay apart. A stay without an ID (older Takeout, or saved before IDs were
// kept) joins the nearest place ID within 100 m in its 300 m place (about how far off a GPS
// position can be in a city), so one place doesn't show as two pins. Stays left over group with
// each other within 50 m (the first one seen is the centre), so old visits in a busy
// neighbourhood don't all become one spot.
function spotKey(v) {
  if (!D.skey || D.skey.length !== D.vs.length) buildSpotKeys();
  return D.skey[v];
}
function buildSpotKeys() {
  var n = D.vs.length, keys = new Array(n), byPv = {}, v, pid;
  for (v = 0; v < n; v++) {
    pid = D.vpid && D.vpid[v];
    if (D.pv[v] < 0) keys[v] = 'p' + D.pv[v];
    else if (pid) {
      keys[v] = 'id:' + pid;
      var L = byPv[D.pv[v]] || (byPv[D.pv[v]] = {});
      if (!L[keys[v]]) L[keys[v]] = [D.vll[2 * v], D.vll[2 * v + 1]];
    }
  }
  var loose = {};
  for (v = 0; v < n; v++) {
    if (keys[v]) continue;
    var ll = [D.vll[2 * v], D.vll[2 * v + 1]], C = byPv[D.pv[v]], best = null, bd = 0.1, k, d;
    for (k in C) { d = km(ll, C[k]); if (d <= bd) { bd = d; best = k; } }
    if (!best) {
      var G = loose[D.pv[v]] || (loose[D.pv[v]] = []);
      for (var g = 0; g < G.length && !best; g++) if (km(ll, G[g]) <= 0.05) best = 'g' + D.pv[v] + '_' + g;
      if (!best) { best = 'g' + D.pv[v] + '_' + G.length; G.push(ll); }
    }
    keys[v] = best;
  }
  // Merges: one place under two place IDs (see mergedSpots), then the ones you made by hand.
  var root = mergedSpots(keys);
  for (v = 0; v < n; v++) keys[v] = root(keys[v]);
  D.skey = keys;
}
// Google sometimes gives one place a new place ID (re-registered, new owner, or an address and a
// business at one spot) and your history keeps both. Two place IDs within 25 m, each with at least
// 3 visits, are taken as one place when your visits moved from one to the other: in time order,
// at most a tenth of the smaller one's visits (and none when it has under 10) fall on the wrong
// side of the handover. Neighbouring shops have their visits mixed in time, so they stay apart.
// (Checked on a real Timeline: 11 of 440 ID pairs within 25 m merge, including a place whose ID
// changed in 2022 with 2 visits to the new ID in 2020.) Merges you make on a spot page
// (PREFS.spotMerge, from key to key) are applied on top. The merged spot keeps the key with
// more time there.
var AUTO_MERGE_KM = 0.025, AUTO_MERGE_MIN = 3, AUTO_MERGE_OFF = 0.1;
// The fewest visits that would have to go for all of a's to come before all of b's, or the other way.
function handoverOff(a, b) {
  var ev = a.map(function (t) { return [t, 0]; }).concat(b.map(function (t) { return [t, 1]; })).sort(function (x, y) { return x[0] - y[0]; });
  var best = Infinity;
  [0, 1].forEach(function (first) {
    var after = ev.filter(function (e) { return e[1] === first; }).length, before = 0;
    best = Math.min(best, after);
    ev.forEach(function (e) { if (e[1] === first) after--; else before++; best = Math.min(best, after + before); });
  });
  return best;
}
function mergedSpots(keys) {
  var info = {}, v, k, parent = {};
  for (v = 0; v < keys.length; v++) {
    k = keys[v];
    if (k.slice(0, 3) !== 'id:') continue;
    var o = info[k] || (info[k] = { k: k, ll: [D.vll[2 * v], D.vll[2 * v + 1]], ts: [], h: 0 });
    o.ts.push(D.vs[v]); o.h += D.ve[v] - D.vs[v];
  }
  function find(x) { while (parent[x] && parent[x] !== x) x = parent[x]; return x; }
  function union(a, b) {
    a = find(a); b = find(b);
    if (a === b) return;
    var ha = info[a] ? info[a].h : 0, hb = info[b] ? info[b].h : 0;
    if (ha >= hb) parent[b] = a; else parent[a] = b;
  }
  var grid = {}, cell = function (ll) { return [Math.round(ll[0] * 400), Math.round(ll[1] * 400)]; };
  for (k in info) if (info[k].ts.length >= AUTO_MERGE_MIN) { var c = cell(info[k].ll); (grid[c[0] + ',' + c[1]] || (grid[c[0] + ',' + c[1]] = [])).push(info[k]); }
  D.autoMerged = {};
  for (k in info) {
    var a = info[k];
    if (a.ts.length < AUTO_MERGE_MIN) continue;
    var ca = cell(a.ll);
    for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) (grid[(ca[0] + dx) + ',' + (ca[1] + dy)] || []).forEach(function (b) {
      if (b.k <= a.k || km(a.ll, b.ll) > AUTO_MERGE_KM) return;
      if (handoverOff(a.ts, b.ts) > Math.floor(AUTO_MERGE_OFF * Math.min(a.ts.length, b.ts.length))) return;
      union(a.k, b.k); D.autoMerged[a.k] = D.autoMerged[b.k] = 1;
    });
  }
  var man = PREFS.spotMerge || {};
  for (k in man) if (info[k] && info[man[k]]) union(man[k], k);
  return function (x) { return parent[x] ? find(x) : x; };
}
// Every place ID that ended up in a spot, with how it got there.
function spotParts(key) {
  var seen = {}, out = [];
  for (var v = 0; v < D.vs.length; v++) {
    var pid = D.vpid && D.vpid[v];
    if (!pid || seen[pid] || spotKey(v) !== key) continue;
    seen[pid] = 1;
    var k = 'id:' + pid;
    out.push({ k: k, pid: pid, manual: !!(PREFS.spotMerge && PREFS.spotMerge[k]), auto: !!(D.autoMerged && D.autoMerged[k]) });
  }
  return out;
}
function respot() {
  D.skey = null; D.spotN = null; D.homeSpot = undefined;
  if (pinLayer) pinLayer._ver = null;
  if (map && PREFS.pins) layerToggles();
}
function mergeSpot(from, into) {
  PREFS.spotMerge = PREFS.spotMerge || {};
  PREFS.spotMerge[from] = into; savePrefs(); respot();
  var pid = into.slice(3);
  for (var v = 0; v < D.vs.length; v++) if (D.vpid[v] === pid) { openSpot(spotKey(v)); return; }
}
function unmergeSpot(key) {
  var m = PREFS.spotMerge || {};
  spotParts(key).forEach(function (x) { delete m[x.k]; });
  for (var k in m) if (m[k] === key) delete m[k];
  savePrefs(); respot(); openSpot(key);
}
function spotStays(key) {
  var out = [];
  for (var v = 0; v < D.vs.length; v++) if (D.pv[v] >= 0 && spotKey(v) === key) out.push(v);
  return out;
}
// Home is one spot: within the 300 m home place there are often several place IDs (the building
// next door, the shop downstairs, a GPS fix matched to a neighbour), and only the one where you
// spent most time is home; the rest are "Near home".
function homeSpot() {
  if (D.homeSpot !== undefined) return D.homeSpot;
  findHome();
  var all = {}, v, k, best = null, bh = 0;
  for (v = 0; v < D.vs.length; v++) if (D.pv[v] === D.home && D.home >= 0) {
    k = spotKey(v); all[k] = (all[k] || 0) + D.ve[v] - D.vs[v];
  }
  for (k in all) if (all[k] > bh) { bh = all[k]; best = k; }
  D.homeSpot = best;
  return best;
}
// Spots among the stays vs, most time first.
function spotsOf(vs) {
  var by = {}, order = [];
  vs.forEach(function (v) {
    var key = spotKey(v), s = by[key], dur = D.ve[v] - D.vs[v];
    if (!s) { s = by[key] = { key: key, pid: key.slice(0, 3) === 'id:' ? key.slice(3) : D.vpid && D.vpid[v] || '', lat: D.vll[2 * v], lng: D.vll[2 * v + 1], p: D.pv[v], n: 0, h: 0, last: 0, lv: v, name: '', home: false }; order.push(s); }
    s.n++; s.h += dur / 36e5;
    if (D.vs[v] > s.last) { s.last = D.vs[v]; s.lv = v; }
    if (D.vname[v] && !s.name) s.name = D.vname[v];
    if (key === homeSpot()) s.home = true;
    else if (D.pv[v] === D.home) s.nearHome = true;
  });
  order.sort(function (a, b) { return b.h - a.h; });
  return order;
}
// A spot's name: the one Takeout gave it, Home, or the town it's in.
function spotName(s, k) {
  if (s.name) return s.name;
  if (s.home) return 'Home';
  if (s.nearHome) return 'Near home';
  return k != null ? 'Spot ' + (k + 1) : 'Spot in ' + placeLabel(s.p);
}
// Time spent there by weekday and hour, local time, as minutes per cell.
function presence(vs) {
  var c = [], k;
  for (k = 0; k < 7; k++) c.push(new Array(24).fill(0));
  vs.forEach(function (v) {
    var off = D.voff[v] !== NO_OFF ? D.voff[v] : -new Date(D.vs[v]).getTimezoneOffset();
    var t = D.vs[v] + off * 60000, e = Math.min(D.ve[v], D.vs[v] + 14 * 864e5) + off * 60000;
    while (t < e) {
      var next = Math.min(e, Math.floor(t / 36e5) * 36e5 + 36e5), d = new Date(t);
      c[d.getUTCDay()][d.getUTCHours()] += (next - t) / 6e4;
      t = next;
    }
  });
  return c;
}
function presenceGrid(c) {
  var k, level = heatLevels([].concat.apply([], c));
  var h = '<div></div>';
  for (k = 0; k < 24; k++) h += '<div class="h">' + (k % 6 === 0 ? k : '') + '</div>';
  DOW_ORDER.forEach(function (d) {
    h += '<div class="d">' + DOW[d] + '</div>';
    for (k = 0; k < 24; k++) h += '<div class="c" title="' + DOW_LONG[d] + 's ' + pad2(k) + ':00: ' + hoursLabel(c[d][k] / 60) + '" style="background:' + heatColor(level(c[d][k])) + '"></div>';
  });
  return '<div class="rhythm" role="img" aria-label="Time there by day of the week and hour">' + h + '</div>' +
    '<div class="rhythm-scale">Less' + HEAT_LEVELS.map(function (l) { return '<i style="background:' + heatColor(l) + '"></i>'; }).join('') + 'More time there</div>';
}
function visitRow(v) {
  return '<div class="hit-row"><span class="t"><b>' + longDate(D.vday[v]) + '</b><small>' + clock(D.vs[v], D.voff[v]) + '–' + clock(D.ve[v], D.voff[v]) + '</small></span><span class="r num">' + duration(D.ve[v] - D.vs[v]) + '</span></div>';
}
var placeVisits = [];
// One page for a town (every spot with that name, listed) or a single spot.
// The page covers your whole history, or only the visits that pass the filters (remembered).
var placeLast = null;
function scopeSeg(nAll, nF) {
  var f = PREFS.placeScope === 'filters';
  return '<div class="seg full" role="group" aria-label="Visits counted" id="placeScope" style="margin-top:12px">' +
    '<button type="button" data-pscope="all" aria-pressed="' + !f + '">All history · ' + fmt(nAll) + '</button>' +
    '<button type="button" data-pscope="filters" aria-pressed="' + f + '">These filters · ' + fmt(nF) + '</button></div>';
}
function placePage(o, keepScroll) {
  placeLast = o;
  setPinOn(spotsOf(o.vs).map(function (x) { return x.key; }));
  var inSel = {}, j;
  for (j = 0; j < selV.length; j++) inSel[selV[j]] = 1;
  var inF = o.vs.filter(function (v) { return inSel[v]; }), scoped = PREFS.placeScope === 'filters';
  var seg = scopeSeg(o.vs.length, inF.length), scopeTxt = scoped ? esc(filterText()) : 'all your history';
  if (scoped && !inF.length) {
    var s0 = spotsOf(o.vs)[0], c0 = countryAt(s0.lat, s0.lng);
    showPlaceHtml('<div class="trip-head"><span class="mode-badge" style="background:' + (o.home ? 'var(--accent)' : 'var(--m-other)') + '">' + icon(o.home ? 'home' : 'pin') + '</span><div><h3>' + esc(o.title) + '</h3><p>' +
      esc(o.sub ? o.sub + ' · ' : '') + (flag(c0) ? flag(c0) + ' ' : '') + esc(ccName(c0)) + '</p></div></div>' + seg +
      '<p class="empty" style="margin-top:14px">No visits here in ' + scopeTxt + '. Change the filters or choose All history.</p>', keepScroll);
    return;
  }
  var vs = scoped ? inF : o.vs, n = vs.length, h = 0, fv = vs[0], lv = vs[0], durs = [];
  var byDow = [0, 0, 0, 0, 0, 0, 0], byHour = new Array(24).fill(0);
  vs.forEach(function (v) {
    var dur = D.ve[v] - D.vs[v];
    h += dur / 36e5; durs.push(dur);
    if (D.vs[v] < D.vs[fv]) fv = v;
    if (D.vs[v] > D.vs[lv]) lv = v;
    byDow[dayToDate(D.vday[v]).getUTCDay()]++;
    byHour[localHour(D.vs[v], D.voff[v])]++;
  });
  durs.sort(function (a, b) { return a - b; });
  var spots = spotsOf(vs), top = spots[0], cc = countryAt(top.lat, top.lng);
  var bd = DOW_ORDER.reduce(function (b, d) { return byDow[d] > byDow[b] ? d : b; }, DOW_ORDER[0]);
  var bh = byHour.reduce(function (b, x, k) { return x > byHour[b] ? k : b; }, 0);
  // How often: visits per week or month over the time from the first visit to the last
  // (at least a week, so a few visits in a short span don't read as a monthly habit).
  var weeks = Math.max(1, (D.vday[lv] - D.vday[fv] + 1) / 7), perWeek = n / weeks, perMonth = perWeek * 4.35;
  var oftenTxt = n < 2 ? 'Once' : perWeek >= 1 ? fmt(Math.round(perWeek * 10) / 10) + ' a week' : perMonth >= 1 ? fmt(Math.round(perMonth * 10) / 10) + ' a month' : 'Every ' + fmt(Math.round(1 / perMonth)) + ' months';
  var withIds = spots.filter(function (s) { return s.pid; }).length;
  placeVisits = vs.slice().sort(function (a, b) { return D.vs[b] - D.vs[a]; });
  var html = '<div class="trip-head"><span class="mode-badge" style="background:' + (o.home ? 'var(--accent)' : 'var(--m-other)') + '">' + icon(o.home ? 'home' : 'pin') + '</span><div><h3>' + esc(o.title) + '</h3><p>' +
    esc(o.sub ? o.sub + ' · ' : '') + (flag(cc) ? flag(cc) + ' ' : '') + esc(ccName(cc)) + ' · ' + scopeTxt + '</p></div></div>' + seg +
    '<dl class="kv" style="margin-top:12px">' + [
      ['Visits', fmt(n)], ['How often', oftenTxt],
      ['Time there', hoursLabel(h).replace(/ \d+ min$/, '')], ['Average stay', hoursLabel(h / n)],
      ['Typical stay', duration(durs[Math.floor((n - 1) / 2)])], ['Longest stay', duration(durs[n - 1])],
      ['First visit', niceDate(D.vday[fv]) + ', ' + clock(D.vs[fv], D.voff[fv])], ['Last visit', niceDate(D.vday[lv]) + ', ' + clock(D.vs[lv], D.voff[lv])]
    ].concat(o.spots ? [['Spots', fmt(spots.length)]] : []).map(function (x) { return '<div><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>'; }).join('') + '</dl>' +
    '<h4 class="place-h">When you\'re there</h4><p class="fine">Most often on ' + DOW_LONG[bd] + 's, arriving around ' + pad2(bh) + ':00.</p>' + presenceGrid(presence(vs));
  if (o.spots) html += '<h4 class="place-h">Spots here</h4><p class="fine">' + (withIds ? 'Grouped by the place Google matched each stay to, so two spots on one street stay apart.' : 'Grouped by distance (300 m). Load your Timeline file again to group them by the place Google matched each stay to.') +
    ' Tap one for its own page. Google Maps shows what it is; only that spot is sent to Google, and only when you tap.</p>' +
    '<div class="list-rows">' + spots.slice(0, 15).map(function (s, k) {
      return '<div class="spot-row"><button type="button" class="hit-row" data-spot="' + esc(s.key) + '"><span class="t"><b>' + esc(spotName(s, k)) + '</b><small>' + fmt(s.n) + ' visit' + (s.n > 1 ? 's' : '') + ' · last ' + niceDate(D.vday[s.lv]) + '</small></span>' +
        '<span class="r num">' + hoursLabel(s.h).replace(/ \d+ min$/, '') + '</span></button>' +
        '<span class="spot-acts"><button type="button" class="btn quiet" data-pmap="' + s.lat + ',' + s.lng + '">Map</button>' +
        '<a class="btn quiet" href="' + esc(mapsUrl(s.lat, s.lng, s.pid)) + '" target="_blank" rel="noopener noreferrer">Google Maps</a></span></div>';
    }).join('') + '</div>' + (spots.length > 15 ? '<p class="fine">Showing the 15 where you spent most time.</p>' : '');
  if (o.spot) html += mergeHtml(o.spot);
  html += '<h4 class="place-h">Visits</h4><div class="list-rows" id="placeVisits">' + placeVisits.slice(0, 20).map(visitRow).join('') + '</div>' +
    (n > 20 ? '<button type="button" class="btn quiet" data-pall>Show all ' + fmt(n) + ' visits</button>' : '') +
    '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px"><button type="button" class="btn" data-pmap="' + (o.ll ? o.ll.join(',') : top.lat + ',' + top.lng) + '">' + icon('fit') + 'Show on the map</button>' +
    mapsLink(top.lat, top.lng, top.pid) + (o.town != null ? '<button type="button" class="btn" data-ptown="' + o.town + '">' + icon('pin') + 'All of ' + esc(placeLabel(o.town)) + '</button>' : '') + '</div>';
  showPlaceHtml(html, keepScroll);
}
function showPlaceHtml(html, keepScroll) {
  var top = $('tripBody').scrollTop;
  $('tripSheetTitle').textContent = 'Place';
  $('tripBack').hidden = true;
  $('tripBody').innerHTML = html;
  openSheet('tripSheet');
  $('tripBody').scrollTop = keepScroll ? top : 0;
}
// The filters changed while a place page is open: follow them.
function refreshPlace() { if (placeLast && openId === 'tripSheet') placePage(placeLast, true); }
// A place in the Places list: everything with its name.
function openPlace(p) {
  needPlaces(); findHome();
  var lbl = placeLabel(p), vs = placeStays(lbl);
  if (!vs.length) return false;
  var q = D.places[p];
  placePage({ title: lbl, vs: vs, home: p === D.home, spots: true, ll: [q.lat, q.lng] });
  return true;
}
// One spot (a pin on the map).
// On a spot page: the place IDs it's made of, and nearby spots with an ID to merge it into by hand
// (Google's IDs only: spots without one have no lasting key to remember the merge by).
function mergeHtml(key) {
  var parts = spotParts(key), me = spotsOf(spotStays(key))[0], html = '';
  if (parts.length > 1) html += '<h4 class="place-h">Merged spot</h4><p class="fine">' + fmt(parts.length) + ' Google place IDs are counted as this one place' +
    (parts.some(function (x) { return x.auto; }) ? ' (some because Google gave the place a new ID: they are within 25 m and your visits moved from one to the other)' : '') + '.</p>' +
    (parts.some(function (x) { return x.manual; }) || Object.keys(PREFS.spotMerge || {}).some(function (k) { return PREFS.spotMerge[k] === key; }) ? '<button type="button" class="btn quiet" data-punmerge="' + esc(key) + '">Undo the merges you made</button>' : '');
  if (key.slice(0, 3) !== 'id:') return html;
  var near = [], seen = {};
  for (var v = 0; v < D.vs.length; v++) {
    var k = spotKey(v);
    if (k === key || seen[k] || k.slice(0, 3) !== 'id:') continue;
    var d = km([me.lat, me.lng], [D.vll[2 * v], D.vll[2 * v + 1]]);
    if (d > 0.15) continue;
    seen[k] = 1; near.push({ k: k, d: d });
  }
  near.sort(function (a, b) { return a.d - b.d; });
  if (!near.length) return html;
  return html + '<h4 class="place-h">Same place as…</h4><p class="fine">If a spot nearby is really this place under another Google ID, merge it here. The merge is saved on this device and can be undone.</p>' +
    '<div class="list-rows">' + near.slice(0, 5).map(function (x) {
      var s2 = spotsOf(spotStays(x.k))[0];
      return '<div class="spot-row"><button type="button" class="hit-row" data-spot="' + esc(x.k) + '"><span class="t"><b>' + esc(spotName(s2)) + '</b><small>' + fmt(Math.round(x.d * 1000)) + ' m away · ' + fmt(s2.n) + ' visit' + (s2.n > 1 ? 's' : '') + ' · last ' + niceDate(D.vday[s2.lv]) + '</small></span></button>' +
        '<span class="spot-acts"><a class="btn quiet" href="' + esc(mapsUrl(s2.lat, s2.lng, s2.pid)) + '" target="_blank" rel="noopener noreferrer">Google Maps</a><button type="button" class="btn quiet" data-pmerge="' + esc(x.k) + '" data-pinto="' + esc(key) + '">Merge into this</button></span></div>';
    }).join('') + '</div>';
}
function openSpot(key) {
  needPlaces(); findHome();
  var vs = spotStays(key);
  if (!vs.length) return false;
  var s = spotsOf(vs)[0], name = spotName(s), town = placeLabel(s.p), others = placeStays(town).length > vs.length;
  placePage({ title: name, sub: name.indexOf(town) < 0 && town !== 'Home' ? town : '', vs: vs, home: s.home, spots: false, town: others ? s.p : null, spot: key });
  return true;
}
function showPlaceOnMap(lat, lng) {
  closeSheets();
  if (PREFS.proj !== 'merc') setProj('merc');
  setTab('map');
  if (map) map.setView([lat, lng], 16);
}
$('tripBody').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-pmap],[data-spot],[data-ptown],[data-pall],[data-pscope],[data-pmerge],[data-punmerge]');
  if (!b) return;
  if (b.dataset.pmerge) { mergeSpot(b.dataset.pmerge, b.dataset.pinto); return; }
  if (b.dataset.punmerge) { unmergeSpot(b.dataset.punmerge); return; }
  if (b.dataset.pscope) { PREFS.placeScope = b.dataset.pscope; savePrefs(); placePage(placeLast, true); return; }
  if (b.dataset.spot) { openSpot(b.dataset.spot); return; }
  if (b.dataset.ptown) { openPlace(+b.dataset.ptown); return; }
  if (b.hasAttribute('data-pall')) { $('placeVisits').innerHTML = placeVisits.map(visitRow).join(''); b.remove(); return; }
  var ll = b.dataset.pmap.split(',');
  showPlaceOnMap(+ll[0], +ll[1]);
});
