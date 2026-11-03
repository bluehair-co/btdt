// ---------- insights ----------
function stat(label, value, unit, note) {
  return '<div class="stat"><div class="label">' + label + '</div><div class="value">' + value + (unit ? '<small>' + unit + '</small>' : '') + '</div>' + (note ? '<div class="note">' + note + '</div>' : '') + '</div>';
}
function hours(i) { return Math.max(0, D.end[i] - D.start[i]) / 36e5; }
function renderInsights() {
  var n = sel.length;
  $('insightsPage').querySelectorAll('.card').forEach(function (c, k) { if (k) c.hidden = !n; });
  if (!n) {
    $('sumStats').innerHTML = '<p class="empty" style="grid-column:1/-1">No trips match your filters.</p>';
    $('sumNote').textContent = '';
    return;
  }
  needPlaces(); findHome();
  renderSummary(); renderSplit(); renderRhythm(); renderTime(); renderRoutes(); renderPlaces(); renderRecords(); renderCountries(); renderCo2();
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

function heatColor(level) { return level ? 'color-mix(in srgb, var(--accent) ' + [0, 22, 42, 62, 82, 100][level] + '%, var(--grid))' : 'var(--grid)'; }
function renderRhythm() {
  var c = [], j, k, max = 0;
  for (k = 0; k < 7; k++) c.push(new Array(24).fill(0));
  for (j = 0; j < sel.length; j++) { var i = sel[j]; c[D.dow[i]][D.hour[i]]++; }
  var vals = [];
  c.forEach(function (row) { row.forEach(function (v) { if (v) vals.push(v); if (v > max) max = v; }); });
  vals.sort(function (a, b) { return a - b; });
  // Five steps by quantile, so a few very busy hours don't wash out the rest.
  var cuts = [0.2, 0.4, 0.6, 0.8].map(function (q) { return vals[Math.floor((vals.length - 1) * q)] || 0; });
  function level(v) { if (!v) return 0; var l = 1; cuts.forEach(function (x) { if (v > x) l++; }); return Math.min(5, l); }
  var h = '<div></div>';
  for (k = 0; k < 24; k++) h += '<div class="h">' + (k % 6 === 0 ? k : '') + '</div>';
  DOW_ORDER.forEach(function (d) {
    h += '<div class="d">' + DOW[d] + '</div>';
    for (k = 0; k < 24; k++) h += '<div class="c" data-d="' + d + '" data-h="' + k + '" data-n="' + c[d][k] + '" style="background:' + heatColor(level(c[d][k])) + '"></div>';
  });
  $('rhythm').innerHTML = '<div class="rhythm" role="img" aria-label="Trips by day of the week and hour">' + h + '</div>' +
    '<div class="rhythm-scale">Fewer' + [1, 2, 3, 4, 5].map(function (l) { return '<i style="background:' + heatColor(l) + '"></i>'; }).join('') + 'More trips</div>';
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
window.addEventListener('resize', function () { clearTimeout(rsT); rsT = setTimeout(function () { if (tab === 'insights') drawTime(); }, 120); });

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
  $('placesNote').textContent = useStays ? 'Places you stayed, by total time there. Tap one to see it on the map.' : 'Places your trips ended, by number of trips. Tap one to see it on the map.';
  if (!list.length) { $('topPlaces').innerHTML = '<p class="empty">No places in this selection.</p>'; return; }
  $('topPlaces').innerHTML = list.slice(0, 8).map(function (o) {
    var q = D.places[o.p], cc = countryAt(q.lat, q.lng), home = o.p === D.home;
    return '<button type="button" class="hit-row" data-place="' + o.p + '"><span class="mode-badge sm" style="background:' + (home ? 'var(--accent)' : 'var(--m-other)') + '">' + icon(home ? 'home' : 'pin') + '</span>' +
      '<span class="t"><b>' + esc(placeLabel(o.p)) + '</b><small>' + (flag(cc) ? flag(cc) + ' ' : '') + esc(ccName(cc)) + (useStays ? ' · ' + fmt(o.n) + ' stay' + (o.n > 1 ? 's' : '') : '') + '</small></span>' +
      '<span class="r num">' + (useStays ? hoursLabel(o.h).replace(/ \d+ min$/, '') : fmt(o.n) + '<small>trips</small>') + '</span></button>';
  }).join('');
}
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
  var b = ev.target.closest('[data-i],[data-day],[data-place]');
  if (!b) return;
  if (b.dataset.i) { setTab('timeline'); tlSelect(+b.dataset.i, true); }
  else if (b.dataset.day) { setTab('map'); showDay(+b.dataset.day); }
  else {
    var q = D.places[+b.dataset.place];
    if (PREFS.proj !== 'merc') setProj('merc');
    setTab('map');
    if (map) map.setView([q.lat, q.lng], 15);
  }
});
