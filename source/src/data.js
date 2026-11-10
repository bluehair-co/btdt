// ---------- state ----------
var D = null;   // all trips and stays (typed arrays), with Strava laid over Timeline
var RAW = null; // the same as loaded and saved, before Strava is laid over
var M = null;   // facts about D: years, modes, countries, days
var F = null;   // the filters, shared by every tab
var sel = new Int32Array(0), selV = new Int32Array(0);   // trips and stays that pass, oldest first
var tab = 'map';
var dirty = { map: true, insights: true, timeline: true };
var mq = window.matchMedia('(min-width: 960px)');
function wide() { return mq.matches; }
var coarse = window.matchMedia('(pointer: coarse)').matches;

function localHour(ms, off) {
  if (off != null && off !== NO_OFF) return new Date(ms + off * 60000).getUTCHours();
  return new Date(ms).getHours();
}

// Fills in what older saved imports lack: times along the GPS trail and the stays.
function upgrade(R) {
  var n = R.day.length;
  if (!R.pathOff) { R.pathOff = new Uint32Array(n + 1); R.pathPts = new Float32Array(0); }
  if (!R.pathT || R.pathT.length !== R.pathPts.length / 2) {
    var t = new Float32Array(R.pathPts.length / 2);
    for (var i = 0; i < n; i++) {
      var o0 = R.pathOff[i], o1 = R.pathOff[i + 1], dur = Math.max(0, (R.end[i] - R.start[i]) / 1000);
      for (var q = o0; q < o1; q++) t[q] = o1 - o0 > 1 ? dur * (q - o0) / (o1 - o0 - 1) : 0;
    }
    R.pathT = t;
  }
  if (!R.vs) {
    R.vs = new Float64Array(0); R.ve = new Float64Array(0); R.vday = new Int32Array(0); R.voff = new Int16Array(0);
    R.vll = new Float32Array(0); R.vtype = new Uint8Array(0); R.vname = []; R.vsrcs = new Uint8Array(0);
  }
  // Google's place ID for each stay; data saved before it was kept has none until the file is loaded again.
  if (!R.vpid) R.vpid = [];
  // Google's home and work tags aren't used (see Collector.visit); clear them from data saved before.
  if (R.vtype) R.vtype.fill(0);
  if (!R.files) R.files = [];
  // Bad GPS jumps come out of trips saved before BT;DT looked for them too (it changes nothing the second time).
  cleanJumps(R);
  fillOffsets(R);
  if (R.strava) fillOffsets(R.strava);
  return R;
}
// Takeout's Semantic Location History, Records.json and Strava write times in UTC with no
// offset, which would show them in this browser's time zone. Give those trips and stays the
// offset of the time zone where they started, and the date they started on there.
function fillOffsets(R) {
  var zc = {};
  function offAt(lat, lng, ms) {
    if (!isFinite(lat) || !isFinite(lng)) return NO_OFF;
    var key = lat.toFixed(2) + ',' + lng.toFixed(2), z = zc[key];
    if (z === undefined) z = zc[key] = zoneAt(lat, lng);
    var o = z ? zoneOffset(z, ms) : null;
    return o == null ? NO_OFF : o;
  }
  // Google's on-device Timeline.json writes the home time zone's winter time on some older
  // trips, wherever they were (UTC+1 for Spain in September, and also UTC+1 for a trip in
  // Canada). Two cases are that mistake, and get the place's offset instead:
  // - the file's offset is the place's offset in the other half of the year but not on the day;
  // - the file's offset is two hours or more from the place's, which no zone border explains.
  // A smaller difference is left as the file says, as the place's zone can be off by an hour
  // near the zone borders inside a country. An offset that matches where the trip ended
  // (a flight, a trip across a border) is left too.
  function wrongSeason(off, lat, lng, ms, lat2, lng2) {
    var o = offAt(lat, lng, ms);
    if (o === NO_OFF || o === off) return NO_OFF;
    if (lat2 != null && offAt(lat2, lng2, ms) === off) return NO_OFF;
    if (Math.abs(off - o) >= 120) return o;
    var y = new Date(ms).getUTCFullYear();
    return off === offAt(lat, lng, Date.UTC(y, 0, 15)) || off === offAt(lat, lng, Date.UTC(y, 6, 15)) ? o : NO_OFF;
  }
  var i, o;
  for (i = 0; R.off && i < R.off.length; i++) {
    if (R.off[i] !== NO_OFF) {
      o = wrongSeason(R.off[i], R.from[2 * i], R.from[2 * i + 1], R.start[i], R.to[2 * i], R.to[2 * i + 1]);
      if (o !== NO_OFF) { R.off[i] = o; R.day[i] = Math.floor((R.start[i] + o * 60000) / 864e5); }
      continue;
    }
    o = offAt(R.from[2 * i], R.from[2 * i + 1], R.start[i]);
    if (o === NO_OFF) o = offAt(R.to[2 * i], R.to[2 * i + 1], R.start[i]);
    if (o !== NO_OFF) { R.off[i] = o; R.day[i] = Math.floor((R.start[i] + o * 60000) / 864e5); }
  }
  for (i = 0; R.voff && i < R.voff.length; i++) {
    if (R.voff[i] !== NO_OFF) {
      o = wrongSeason(R.voff[i], R.vll[2 * i], R.vll[2 * i + 1], R.vs[i]);
      if (o !== NO_OFF) { R.voff[i] = o; R.vday[i] = Math.floor((R.vs[i] + o * 60000) / 864e5); }
      continue;
    }
    o = offAt(R.vll[2 * i], R.vll[2 * i + 1], R.vs[i]);
    if (o !== NO_OFF) { R.voff[i] = o; R.vday[i] = Math.floor((R.vs[i] + o * 60000) / 864e5); }
  }
}

function tagCountries() {
  var n = D.day.length, nv = D.vs.length, idx = {}, cache = {};
  D.ccList = []; D.ccCount = []; D.cs = new Uint16Array(n); D.ce = new Uint16Array(n); D.vcc = new Uint16Array(nv);
  function code(lat, lng) {
    var key = isFinite(lat) ? lat.toFixed(2) + ',' + lng.toFixed(2) : '?';
    var cc = cache[key];
    if (cc === undefined) cc = cache[key] = isFinite(lat) ? countryAt(lat, lng) : '';
    if (idx[cc] === undefined) { idx[cc] = D.ccList.length; D.ccList.push(cc); D.ccCount.push(0); }
    return idx[cc];
  }
  for (var i = 0; i < n; i++) {
    var a = code(D.from[2 * i], D.from[2 * i + 1]), b = code(D.to[2 * i], D.to[2 * i + 1]);
    D.cs[i] = a; D.ce[i] = b;
    D.ccCount[a]++; if (b !== a) D.ccCount[b]++;
  }
  for (var v = 0; v < nv; v++) { var c = code(D.vll[2 * v], D.vll[2 * v + 1]); D.vcc[v] = c; D.ccCount[c]++; }
}

// Strava types an earlier version didn't know are matched again, so a newly added sport
// shows up without loading the export again.
function rematchSports(S) {
  if (!S || !S.stype) return;
  for (var i = 0; i < S.stype.length; i++) {
    if (S.sport[i] || !S.stype[i]) continue;
    var st = stravaSport(S.stype[i]);
    // The activity file's own type, when activities.csv gave one BT;DT doesn't know (see pickType).
    if (!st.sport && S.smeta && S.smeta[i] && S.smeta[i].fileType) { st = stravaSport(S.smeta[i].fileType); if (st.sport) S.smeta[i].typeUsed = S.smeta[i].fileType; }
    if (!st.sport) continue;
    S.sport[i] = st.sport; S.mode[i] = MODE_IDX[st.mode]; S.est[i] &= ~GUESSED; S.stype[i] = '';
  }
}
function setData(R) {
  RAW = upgrade(R);
  rematchSports(RAW.strava);
  D = withStrava(RAW);
  $('app').classList.remove('no-data');
  var n = D.day.length, nv = D.vs.length, i, yc = {}, present = {}, sp = {}, plain = {};
  if (!D.sport) D.sport = new Uint8Array(n);
  D.year = new Int16Array(n); D.month = new Int8Array(n); D.dow = new Int8Array(n); D.hour = new Int8Array(n);
  for (i = 0; i < n; i++) {
    var x = dayToDate(D.day[i]);
    D.year[i] = x.getUTCFullYear(); D.month[i] = x.getUTCMonth(); D.dow[i] = x.getUTCDay();
    D.hour[i] = localHour(D.start[i], D.off[i]);
    yc[D.year[i]] = 1; present[MODES[D.mode[i]]] = 1;
    if (D.sport[i]) sp[D.sport[i]] = (sp[D.sport[i]] || 0) + 1;
    else plain[MODES[D.mode[i]]] = 1;
  }
  D.vyear = new Int16Array(nv); D.vmonth = new Int8Array(nv); D.vdow = new Int8Array(nv);
  for (i = 0; i < nv; i++) {
    var y = dayToDate(D.vday[i]);
    D.vyear[i] = y.getUTCFullYear(); D.vmonth[i] = y.getUTCMonth(); D.vdow[i] = y.getUTCDay();
    yc[D.vyear[i]] = 1;
  }
  D.order = Int32Array.from(Array.from({ length: n }, function (_, k) { return k; }).sort(function (a, b) { return D.start[a] - D.start[b]; }));
  D.vorder = Int32Array.from(Array.from({ length: nv }, function (_, k) { return k; }).sort(function (a, b) { return D.vs[a] - D.vs[b]; }));
  tagCountries();
  D.places = null; D.home = undefined; D.spotN = null; D.homeSpot = undefined; D.skey = null;
  var minD = Infinity, maxD = -Infinity;
  for (i = 0; i < n; i++) { if (D.day[i] < minD) minD = D.day[i]; if (D.day[i] > maxD) maxD = D.day[i]; }
  for (i = 0; i < nv; i++) { if (D.vday[i] < minD) minD = D.vday[i]; if (D.vday[i] > maxD) maxD = D.vday[i]; }
  if (!isFinite(minD)) minD = maxD = Math.floor(Date.now() / 864e5);
  var anyGuess = false;
  for (i = 0; i < n && !anyGuess; i++) if (D.est[i] & 4) anyGuess = true;
  M = {
    years: Object.keys(yc).map(Number).sort(function (a, b) { return a - b; }),
    modes: MODES.filter(function (m) { return present[m]; }),
    countries: D.ccList.map(function (_, k) { return k; }).filter(function (k) { return D.ccCount[k] > 0; })
      .sort(function (a, b) { return D.ccCount[b] - D.ccCount[a]; }),
    minD: minD, maxD: maxD, anyGuess: anyGuess, navDays: [],
    // Strava sports present, by mode, in the order SPORTS lists them.
    sports: Object.keys(sp).map(Number).sort(function (a, b) { return a - b; }), sportN: sp,
    // Modes with trips that have no sport (from Timeline, or a Strava type BT;DT doesn't know).
    plain: plain
  };
  F = defaultFilters();
  buildFilterUI();
  mapReset();
  apply();
  renderSettings();
}

// ---------- filters ----------
var modeTreeOpen = {};
// The app opens on the last 7 days. If nothing was recorded in them (an older export),
// it shows the last 7 days in the data instead.
function lastWeek() {
  var today = todayDay(), end = today;
  if (M.maxD < today - 6) end = M.maxD;
  return [end - 6, end];
}
// The app opens on the period navigator at this week. If nothing was recorded in the last
// 7 days (an older export), it opens on the week of the latest day with data instead.
// Navigator in Filters goes back to this.
function navHome() {
  var today = todayDay();
  return M.maxD < today - 6 ? M.maxD : today;
}
function defaultFilters() {
  var wk = lastWeek();
  return {
    dm: 'one', one: navHome(), unit: 'week', from: wk[0], to: wk[1],
    years: new Set(M.years), months: new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), dows: new Set([0, 1, 2, 3, 4, 5, 6]),
    h0: 0, h1: 24, modes: new Set(M.modes), sports: new Set(M.sports), countries: new Set(M.countries), guess: 'all', src: 'all'
  };
}
function activeFilters() {
  var k = 0;
  if (F.dm !== 'all') k++;
  if (F.years.size !== M.years.length) k++;
  if (F.months.size !== 12) k++;
  if (F.dows.size !== 7) k++;
  if (F.h0 !== 0 || F.h1 !== 24) k++;
  if (F.modes.size !== M.modes.length || F.sports.size !== M.sports.length) k++;
  if (F.countries.size !== M.countries.length) k++;
  if (F.guess !== 'all') k++;
  if (F.src !== 'all') k++;
  return k;
}
// Years and months only apply to All, and days of the week to All and Date range: a date
// range, the last 7 days or a single day, week, month or year already say which days, so
// those filters are hidden and turned back to everything there (or they would quietly leave
// out days you can't see).
function ymFilters() { return F.dm === 'all'; }
function calFilters() { return F.dm === 'all' || F.dm === 'range'; }
function allCalendar() {
  if (!ymFilters()) { F.years = new Set(M.years); F.months = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]); }
  if (!calFilters()) F.dows = new Set([0, 1, 2, 3, 4, 5, 6]);
}
function hourOk(h) {
  if (F.h0 === 0 && F.h1 === 24) return true;
  return F.h0 < F.h1 ? h >= F.h0 && h < F.h1 : h >= F.h0 || h < F.h1;
}
function dayOk(d) {
  if (F.dm === 'one') return F.unit === 'day' ? d === F.one : d >= periodStart(F.one, F.unit) && d <= periodEnd(F.one, F.unit);
  if (F.dm === 'range' || F.dm === 'week') return d >= F.from && d <= F.to;
  return true;
}
function apply() {
  var ord = D.order, out = [], nav = {}, k, i;
  var modeOk = MODES.map(function (m) { return F.modes.has(m); });
  var allCC = F.countries.size === M.countries.length, anyHour = F.h0 === 0 && F.h1 === 24;
  for (k = 0; k < ord.length; k++) {
    i = ord[k];
    if (!(D.sport[i] ? F.sports.has(D.sport[i]) : modeOk[D.mode[i]]) || !F.years.has(D.year[i]) || !F.months.has(D.month[i]) || !F.dows.has(D.dow[i])) continue;
    if (F.guess === 'no' && D.est[i] & 4) continue;
    if (F.guess === 'only' && !(D.est[i] & 4)) continue;
    if (F.src !== 'all' && !(D.est[i] & STRAVA) === (F.src === 'strava')) continue;
    // A Timeline trip a Strava activity replaced shows only when Timeline is the only source.
    if (F.src !== 'timeline' && isDup(i)) continue;
    if (!anyHour && !hourOk(D.hour[i])) continue;
    if (!allCC && !F.countries.has(D.cs[i]) && !F.countries.has(D.ce[i])) continue;
    nav[D.day[i]] = 1;
    if (dayOk(D.day[i])) out.push(i);
  }
  sel = Int32Array.from(out);
  M.navDays = Object.keys(nav).map(Number).sort(function (a, b) { return a - b; });
  // Stays follow the same filters, except transport and time of day.
  // Stays come from Timeline, so Strava-only leaves them out.
  var outV = [];
  for (k = 0; F.src !== 'strava' && k < D.vorder.length; k++) {
    i = D.vorder[k];
    if (!F.years.has(D.vyear[i]) || !F.months.has(D.vmonth[i]) || !F.dows.has(D.vdow[i]) || !dayOk(D.vday[i])) continue;
    if (!allCC && !F.countries.has(D.vcc[i])) continue;
    outV.push(i);
  }
  selV = Int32Array.from(outV);
  dirty.map = dirty.insights = dirty.timeline = true;
  syncFilterUI();
  syncPeriodNavs();
  renderTab();
  refreshPlace();
}
var applyTimer = 0;
function changed() { clearTimeout(applyTimer); applyTimer = setTimeout(apply, 30); }

function filterText() {
  var t = F.dm === 'one' ? periodLabel(F.one, F.unit) : F.dm !== 'all' ? (F.from === F.to ? niceDate(F.from) : niceDate(F.from) + ' – ' + niceDate(F.to)) : 'All time';
  var k = activeFilters() - (F.dm !== 'all' ? 1 : 0);
  return t + (k ? ' · ' + k + ' filter' + (k > 1 ? 's' : '') : '');
}
function tripsText(n) { return fmt(n) + ' trip' + (n === 1 ? '' : 's'); }

function chipHtml(f, v, label, n) {
  return '<button type="button" class="chip" data-f="' + f + '" data-v="' + v + '" aria-pressed="false">' + label + (n != null ? '<span class="n">' + fmt(n) + '</span>' : '') + '</button>';
}
function buildFilterUI() {
  var mc = {}, i;
  for (i = 0; i < D.day.length; i++) { if (isDup(i)) continue; var m = MODES[D.mode[i]]; mc[m] = (mc[m] || 0) + 1; }
  $('years').innerHTML = M.years.map(function (y) { return chipHtml('years', y, y); }).join('');
  $('months').innerHTML = MONTHS.map(function (m, k) { return chipHtml('months', k, m); }).join('');
  $('dows').innerHTML = DOW_ORDER.map(function (d) { return chipHtml('dows', d, DOW[d]); }).join('');
  // Transport as a tree: each kind (Road, Flights…) with its types under it, and a type's
  // Strava sports under the type. Ticking a kind ticks everything under it. A kind with one
  // type is that type, so it shows only the type's sports, if any, under it.
  var groups = GROUPS.filter(function (g) { return g.modes.some(function (m) { return mc[m]; }); });
  function sportChips(m) {
    return M.sports.filter(function (k) { return SPORTS[k][2] === m; }).map(function (k) { return chipHtml('sports', k, esc(SPORTS[k][1]), M.sportN[k]).replace('class="chip"', 'class="chip sub"'); }).join('');
  }
  $('modeTree').innerHTML = groups.map(function (g) {
    var ms = g.modes.filter(function (m) { return mc[m]; }), one = ms.length === 1, n = 0;
    ms.forEach(function (m) { n += mc[m]; });
    var kids = one ? sportChips(ms[0]) : ms.map(function (m) {
      var subs = sportChips(m);
      return '<div class="mt-mode">' + chipHtml('modes', m, '<span style="color:' + g.color + ';display:flex">' + icon(m) + '</span>' + (LABEL[m] || m), mc[m]) +
        (subs ? '<div class="subchips" aria-label="' + (LABEL[m] || m) + ' on Strava">' + subs + '</div>' : '') + '</div>';
    }).join('');
    var head = one ? chipHtml('modes', ms[0], '<i class="sw" style="background:' + g.color + '"></i>' + g.label, n)
      : chipHtml('group', g.key, '<i class="sw" style="background:' + g.color + '"></i>' + g.label, n);
    var open = !!modeTreeOpen[g.key];
    return '<div class="mt-group" data-g="' + g.key + '">' +
      '<div class="mt-row">' + (kids ? '<button type="button" class="mt-caret" data-mt="' + g.key + '" aria-expanded="' + open + '" aria-controls="mt-' + g.key + '" aria-label="Show what ' + esc(g.label) + ' includes">' + icon('right') + '</button>' : '<span class="mt-caret-pad"></span>') +
      head + '</div>' +
      (kids ? '<div class="mt-kids" id="mt-' + g.key + '"' + (open ? '' : ' hidden') + '>' + kids + '</div>' : '') + '</div>';
  }).join('');
  $('countries').innerHTML = M.countries.map(function (k) {
    var cc = D.ccList[k];
    return chipHtml('countries', k, (flag(cc) ? flag(cc) + ' ' : '') + esc(ccName(cc)));
  }).join('');
  $('ccSearch').hidden = M.countries.length < 12;
  $('guessWrap').hidden = !M.anyGuess;
  $('srcWrap').hidden = !D.stravaStats;
  var h0 = '', h1 = '';
  for (i = 0; i < 24; i++) h0 += '<option value="' + i + '">' + pad2(i) + ':00</option>';
  for (i = 1; i <= 24; i++) h1 += '<option value="' + i + '">' + pad2(i % 24) + ':00' + (i === 24 ? ' (midnight)' : '') + '</option>';
  $('h0').innerHTML = h0; $('h1').innerHTML = h1;
  var lo = isoDay(M.minD), hi = isoDay(M.maxD);
  ['oneDay', 'from', 'to'].forEach(function (id) { $(id).min = lo; $(id).max = hi; });
}
// A trip with a Strava sport is shown when its sport is on; other trips when their mode is on.
// So a mode with sports is fully on when it and all its sports are, partly on when some are.
function modeParts(m) {
  var out = [];
  M.sports.forEach(function (k) { if (SPORTS[k][2] === m) out.push(F.sports.has(k)); });
  if (!out.length || M.plain[m]) out.push(F.modes.has(m));
  return out;
}
function modeState(m) {
  var p = modeParts(m), on = p.filter(Boolean).length;
  return on === p.length ? 'true' : on ? 'mixed' : 'false';
}
function setMode(m, on) {
  if (on) F.modes.add(m); else F.modes.delete(m);
  M.sports.forEach(function (k) { if (SPORTS[k][2] === m) { if (on) F.sports.add(k); else F.sports.delete(k); } });
}
function groupModes(key) {
  var g = GROUPS.filter(function (x) { return x.key === key; })[0];
  return g.modes.filter(function (m) { return M.modes.indexOf(m) >= 0; });
}
function groupState(key) {
  var st = groupModes(key).map(modeState);
  return st.length && st.every(function (x) { return x === 'true'; }) ? 'true' : st.some(function (x) { return x !== 'false'; }) ? 'mixed' : 'false';
}
function setPressed(sel_, fn) {
  document.querySelectorAll(sel_).forEach(function (b) { b.setAttribute('aria-pressed', fn(b) ? 'true' : 'false'); });
}
function syncFilterUI() {
  document.querySelectorAll('#filtersSheet .chip[data-f]').forEach(function (b) {
    var f = b.dataset.f, v = b.dataset.v;
    b.setAttribute('aria-pressed', f === 'group' ? groupState(v) : f === 'modes' ? modeState(v) : F[f].has(+v) ? 'true' : 'false');
  });
  setPressed('#guessSeg button', function (b) { return b.dataset.g === F.guess; });
  setPressed('#srcSeg button', function (b) { return b.dataset.src === F.src; });
  $('oneField').hidden = F.dm !== 'one';
  setPressed('#dayMode button', function (b) { return b.dataset.dm === 'nav' ? F.dm === 'one' && F.unit !== 'day' : b.dataset.dm === 'one' ? F.dm === 'one' && F.unit === 'day' : b.dataset.dm === F.dm; });
  $('oneLabel').textContent = F.unit === 'day' ? 'Day' : 'Any day in the ' + F.unit;
  setPressed('[data-pn="step"] button', function (b) { return b.dataset.step === F.unit; });
  $('rangeFields').hidden = F.dm !== 'range';
  $('yearsSec').hidden = $('monthsSec').hidden = !ymFilters();
  $('dowsSec').hidden = !calFilters();
  $('oneDay').value = isoDay(F.one); $('from').value = isoDay(F.from); $('to').value = isoDay(F.to);
  $('h0').value = F.h0; $('h1').value = F.h1;
  var k = activeFilters();
  $('filterBadge').hidden = !k; $('filterBadge').textContent = k;
  syncExport();
}

$('filtersSheet').addEventListener('click', function (ev) {
  var b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.f) {
    var f = b.dataset.f, v = b.dataset.v;
    // A group or mode that is fully on turns off; one that is off or partly on turns fully on.
    if (f === 'group') {
      var on = groupState(v) === 'true';
      groupModes(v).forEach(function (m) { setMode(m, !on); });
    } else if (f === 'modes') setMode(v, modeState(v) !== 'true');
    else {
      var val = +v, s = F[f];
      if (s.has(val)) s.delete(val); else s.add(val);
    }
  } else if (b.dataset.q) {
    var all = b.dataset.all === '1', q = b.dataset.q;
    if (q === 'modes') F.sports = new Set(all ? M.sports : []);
    F[q] = new Set(all ? { years: M.years, months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], dows: [0, 1, 2, 3, 4, 5, 6], modes: M.modes, countries: M.countries }[q] : []);
  } else if (b.dataset.dm === 'nav') {
    F = Object.assign(F, { dm: 'one', unit: 'week', one: navHome() });
    allCalendar();
  } else if (b.dataset.dm) {
    F.dm = b.dataset.dm;
    allCalendar();
    if (F.dm === 'one') F.unit = 'day';
    if (F.dm === 'one' && M.navDays.length && M.navDays.indexOf(F.one) < 0) F.one = M.navDays[M.navDays.length - 1];
    if (F.dm === 'week') { var wk = lastWeek(); F.from = wk[0]; F.to = wk[1]; }
  } else if (b.dataset.g) F.guess = b.dataset.g;
  else if (b.dataset.src) F.src = b.dataset.src;
  else if (b.id === 'dowWeekdays') F.dows = new Set([1, 2, 3, 4, 5]);
  else if (b.id === 'dowWeekend') F.dows = new Set([0, 6]);
  else if (b.id === 'hoursAll') { F.h0 = 0; F.h1 = 24; }
  else if (b.id === 'resetFilters') F = defaultFilters();
  else if (b.dataset.mt) {
    var g = b.dataset.mt, op = !modeTreeOpen[g];
    modeTreeOpen[g] = op;
    b.setAttribute('aria-expanded', op ? 'true' : 'false');
    $('mt-' + g).hidden = !op;
    return;
  }
  else return;
  syncFilterUI();
  changed();
});
function onDate(id, key) {
  $(id).addEventListener('change', function () {
    var d = parseIsoDay(this.value);
    if (d == null) return;
    F[key] = d;
    if (key === 'from' && F.to < d) F.to = d;
    if (key === 'to' && F.from > d) F.from = d;
    changed();
  });
}
onDate('oneDay', 'one'); onDate('from', 'from'); onDate('to', 'to');
$('oneToday').addEventListener('click', function () { showDay(todayDay(), F.unit); });
$('h0').addEventListener('change', function () { F.h0 = +this.value; changed(); });
$('h1').addEventListener('change', function () { F.h1 = +this.value; changed(); });
$('ccSearch').addEventListener('input', function () {
  var q = this.value.trim().toLowerCase();
  $('countries').querySelectorAll('.chip').forEach(function (c) { c.hidden = q && c.textContent.toLowerCase().indexOf(q) < 0; });
});
// Today as a local day number.
function todayDay() { return Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 864e5); }
// Show one day (or the week, month or year holding it), from anywhere in the app.
function showDay(d, unit) {
  F.dm = 'one'; F.one = d; F.unit = unit || 'day';
  allCalendar();
  syncFilterUI();
  apply();
}

// ---------- tabs ----------
function setTab(t) {
  tab = t;
  $('mapPage').hidden = t !== 'map';
  $('insightsPage').hidden = t !== 'insights';
  $('timelinePage').hidden = t !== 'timeline';
  document.querySelectorAll('.dock button').forEach(function (b) { if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  hideTip();
  if (openId && openId !== 'settingsSheet' && openId !== 'filtersSheet') closeSheets();
  renderTab();
}
function renderTab() {
  if (!D) return;
  if (tab === 'map') renderMapTab();
  else if (tab === 'insights' && dirty.insights) { dirty.insights = false; renderInsights(); }
  else if (tab === 'timeline') { if (dirty.timeline) { dirty.timeline = false; buildTimeline(); } else tlLayout(); }
}
document.querySelector('.dock').addEventListener('click', function (ev) { var b = ev.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });

// ---------- sheets ----------
var openId = null;
function openSheet(id) {
  if (openId && openId !== id) closeSheets(true);
  openId = id;
  $(id).classList.add('open');
  // On a wide screen the side panels sit next to the map, so it stays usable.
  $('scrim').hidden = wide() && id !== 'settingsSheet';
  $('filtersBtn').setAttribute('aria-expanded', id === 'filtersSheet' ? 'true' : 'false');
  $('layersBtn').setAttribute('aria-expanded', id === 'layersSheet' ? 'true' : 'false');
}
function closeSheets(quiet) {
  if (!openId) return;
  var was = openId;
  $(was).classList.remove('open');
  openId = null;
  $('scrim').hidden = true;
  $('filtersBtn').setAttribute('aria-expanded', 'false');
  $('layersBtn').setAttribute('aria-expanded', 'false');
  if (was === 'tripSheet') { highlight(null); setPinOn([]); placeLast = null; }
}
function toggleSheet(id) { if (openId === id) closeSheets(); else openSheet(id); }
$('filtersBtn').addEventListener('click', function () { toggleSheet('filtersSheet'); });
$('layersBtn').addEventListener('click', function () { toggleSheet('layersSheet'); });
document.addEventListener('click', function (ev) {
  var info = ev.target.closest('.info-btn');
  if (info) {
    var head = info.closest('.card-head'), op = !head.classList.contains('info-open');
    head.classList.toggle('info-open', op);
    info.setAttribute('aria-expanded', op ? 'true' : 'false');
  } else if (ev.target.closest('[data-open-filters]')) openSheet('filtersSheet');
  else if (ev.target.closest('[data-close]')) closeSheets();
});
$('scrim').addEventListener('click', function () { closeSheets(); });
$('openSettings').addEventListener('click', function () { renderSettings(); openSheet('settingsSheet'); });
document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { closeSheets(); hideTip(); } });

// ---------- tooltips (mouse only; taps open sheets instead) ----------
var tipEl = $('tip');
function showTip(e, html) {
  tipEl.innerHTML = html; tipEl.hidden = false;
  var w = tipEl.offsetWidth, h = tipEl.offsetHeight, x = e.clientX + 14, y = e.clientY + 14;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14;
  if (y + h > innerHeight - 8) y = e.clientY - h - 14;
  tipEl.style.left = Math.max(8, x) + 'px'; tipEl.style.top = Math.max(8, y) + 'px';
}
function hideTip() { tipEl.hidden = true; }

// ---------- places ----------
// Each trip end and stay is snapped to a place: the nearest airport for flights, otherwise
// the first place seen within 300 m, so GPS jitter around home or work doesn't split it.
function tagPlaces() {
  var n = D.day.length, nv = D.vs.length, grid = {}, byAp = {};
  D.places = []; D.pa = new Int32Array(n); D.pb = new Int32Array(n); D.pv = new Int32Array(nv);
  function place(lat, lng, flight, name) {
    if (!isFinite(lat)) return -1;
    if (flight) {
      var ap = nearestAirport(lat, lng);
      if (ap) {
        if (byAp[ap.code] == null) { byAp[ap.code] = D.places.length; D.places.push({ lat: ap.lat, lng: ap.lng, ap: ap }); }
        return byAp[ap.code];
      }
    }
    var gx = Math.floor(lng * 200), gy = Math.floor(lat * 200);
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var cell = grid[(gx + dx) + ',' + (gy + dy)];
      if (cell) for (var k = 0; k < cell.length; k++) {
        var q = D.places[cell[k]];
        if (km([lat, lng], [q.lat, q.lng]) <= 0.3) { if (name && !q.name) q.name = name; return cell[k]; }
      }
    }
    var id = D.places.length;
    D.places.push({ lat: lat, lng: lng, ap: null, name: name || '' });
    (grid[gx + ',' + gy] || (grid[gx + ',' + gy] = [])).push(id);
    return id;
  }
  // Stays first, so their names label the places trips start and end at.
  for (var v = 0; v < nv; v++) D.pv[v] = place(D.vll[2 * v], D.vll[2 * v + 1], false, D.vname[v]);
  for (var i = 0; i < n; i++) {
    var fl = MODES[D.mode[i]] === 'FLYING';
    D.pa[i] = place(D.from[2 * i], D.from[2 * i + 1], fl);
    D.pb[i] = place(D.to[2 * i], D.to[2 * i + 1], fl);
  }
}
function needPlaces() { if (!D.places) tagPlaces(); }
// A short name for a place: the airport, the name Timeline gave it, or the nearest town.
function placeLabel(id) {
  if (id < 0) return 'Unknown place';
  var q = D.places[id];
  if (q.label) return q.label;
  if (q.ap) q.label = q.ap.city + ' (' + q.ap.code + ')';
  else if (q.name) q.label = q.name;
  else {
    var c = nearestCity(q.lat, q.lng);
    q.label = c ? (c.d > 8 ? 'Near ' : '') + c.name : ccName(countryAt(q.lat, q.lng));
  }
  if (D.home != null && id === D.home && !q.ap) q.label = 'Home';
  return q.label;
}
function tripRoute(i) {
  needPlaces();
  var a = placeLabel(D.pa[i]), b = placeLabel(D.pb[i]);
  return D.pa[i] === D.pb[i] || a === b ? 'Around ' + a : a + ' → ' + b;
}
// Home: where most nights are spent, else the most common trip end (Google's home tag isn't used).
function findHome() {
  if (D.home !== undefined) return D.home;
  needPlaces();
  var score = {}, best = -1, bs = 0, v, i, how = '';
  {
    for (v = 0; v < D.vs.length; v++) {
      // A stay that covers 3 am local time counts as a night there.
      var off = D.voff[v] !== NO_OFF ? D.voff[v] * 60000 : -new Date(D.vs[v]).getTimezoneOffset() * 60000;
      var s = D.vs[v] + off, e = D.ve[v] + off, night = Math.ceil((s - 3 * 36e5) / 864e5) * 864e5 + 3 * 36e5;
      if (night <= e) score[D.pv[v]] = (score[D.pv[v]] || 0) + Math.min(30, Math.floor((e - night) / 864e5) + 1);
    }
    if (Object.keys(score).length) how = 'where most nights were spent';
    else {
      for (i = 0; i < D.day.length; i++) if (D.pb[i] >= 0 && !isDup(i) && MODES[D.mode[i]] !== 'FLYING') score[D.pb[i]] = (score[D.pb[i]] || 0) + 1;
      how = 'where most trips end';
    }
  }
  for (var k in score) if (score[k] > bs) { bs = score[k]; best = +k; }
  D.home = best;
  D.homeHow = how;
  if (best >= 0) D.places[best].label = null;
  return best;
}

// ---------- import ----------
function setStatus(text, isErr) {
  ['welcomeStatus', 'importStatus'].forEach(function (id) { $(id).textContent = text || ''; $(id).className = 'status' + (isErr ? ' err' : ''); });
  if (text && D) toast(text);
}
// Combine exports. When several cover the same day, the newest kind of export wins for that day,
// except for Records.json trips in the gaps it left (see inGap).
// Simulated trips and stays always win: they are kept whatever the day, an exported trip that
// overlaps them for at least half of its time (or half of theirs) is left out, and exported stays
// are cut back to the time around them. A few minutes' overlap at the ends is not a conflict, so
// the walk to the station stays.
// Strava activities are kept apart (R.strava) and laid over the Timeline trips by withStrava.
function merge(base, parts) {
  var sv = parts.filter(function (p) { return p.strava; });
  parts = parts.filter(function (p) { return !p.strava; });
  var all = (base ? [upgrade(base)] : []).concat(parts.map(upgrade)), total = 0;
  function src(p, i) { return p.srcs ? p.srcs[i] : p.src; }
  function vsrc(p, i) { return p.vsrcs && p.vsrcs.length ? p.vsrcs[i] : p.src; }
  var best = {}, sim = [];
  all.forEach(function (p) {
    var i, s, d;
    for (i = 0; i < p.day.length; i++) {
      s = src(p, i); d = p.day[i];
      if (s === SRC.sim) sim.push([p.start[i], p.end[i]]);
      else if (best[d] === undefined || s < best[d]) best[d] = s;
    }
    for (i = 0; i < p.vs.length; i++) {
      s = vsrc(p, i); d = p.vday[i];
      if (s === SRC.sim) sim.push([p.vs[i], p.ve[i]]);
      else if (best[d] === undefined || s < best[d]) best[d] = s;
    }
    total += p.day.length;
  });
  sim.sort(function (a, b) { return a[0] - b[0]; });
  // The simulated stretches that overlap [s, e), in time order.
  function simIn(s, e) {
    var lo = 0, hi = sim.length, out = [];
    while (lo < hi) { var mid = (lo + hi) >> 1; if (sim[mid][0] < e) lo = mid + 1; else hi = mid; }
    for (var k = 0; k < lo; k++) if (sim[k][1] > s) out.push(sim[k]);
    return out;
  }
  function simClash(s, e) {
    var tot = 0, xs = simIn(s, Math.max(e, s + 1));
    for (var k = 0; k < xs.length; k++) {
      var ov = Math.min(e, xs[k][1]) - Math.max(s, xs[k][0]);
      if (ov >= (xs[k][1] - xs[k][0]) / 2) return true;
      tot += Math.max(0, ov);
    }
    return xs.length > 0 && tot >= (e - s) / 2;
  }
  // What the winning exports cover, in time order. A Records.json trip on a day another export
  // won is still kept when it falls in a gap they left (Timeline exports often record a stay and
  // nothing else on a day of driving): at most a fifth of it overlaps their trips, and at most
  // half of it their stays (whose ends are often loose). Flights are left to the winning export.
  function overlaps(list) {
    list.sort(function (a, b) { return a[0] - b[0]; });
    var mx = 0;
    list.forEach(function (x) { mx = Math.max(mx, x[1] - x[0]); });
    return function (s, e) {
      var lo = 0, hi = list.length, ov = 0, last = s;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (list[mid][0] < s - mx) lo = mid + 1; else hi = mid; }
      for (var k = lo; k < list.length && list[k][0] < e; k++) {
        var a = Math.max(last, list[k][0]), b = Math.min(e, list[k][1]);
        if (b > a) { ov += b - a; last = b; }
      }
      return ov;
    };
  }
  var coverT = [], coverV = [], fly = MODES.indexOf('FLYING');
  all.forEach(function (p) {
    var i, s;
    for (i = 0; i < p.day.length; i++) { s = src(p, i); if (s !== SRC.sim && s !== SRC.records && s === best[p.day[i]]) coverT.push([p.start[i], p.end[i]]); }
    for (i = 0; i < p.vs.length; i++) { s = vsrc(p, i); if (s !== SRC.sim && s !== SRC.records && s === best[p.vday[i]]) coverV.push([p.vs[i], p.ve[i]]); }
  });
  var ovT = overlaps(coverT), ovV = overlaps(coverV);
  function inGap(p, i) {
    var s = p.start[i], e = p.end[i];
    return e > s && p.mode[i] !== fly && ovT(s, e) <= (e - s) / 5 && ovV(s, e) <= (e - s) / 2;
  }
  var idx = [], vidx = [], simOut = 0, gapKept = 0;
  all.forEach(function (p, pi) {
    var i, s;
    for (i = 0; i < p.day.length; i++) {
      s = src(p, i);
      if (s === SRC.sim) idx.push([pi, i]);
      else if (s === best[p.day[i]]) { if (simClash(p.start[i], p.end[i])) simOut++; else idx.push([pi, i]); }
      else if (s === SRC.records && inGap(p, i) && !simClash(p.start[i], p.end[i])) { idx.push([pi, i]); gapKept++; }
    }
    for (i = 0; i < p.vs.length; i++) {
      s = vsrc(p, i);
      if (s === SRC.sim) { vidx.push([pi, i, p.vs[i], p.ve[i]]); continue; }
      if (s !== best[p.vday[i]]) continue;
      // Keep the parts of the stay outside the simulated stretches.
      var a = p.vs[i];
      simIn(a, p.ve[i]).forEach(function (x) { if (x[0] > a) vidx.push([pi, i, a, x[0]]); a = Math.max(a, x[1]); });
      if (a < p.ve[i]) vidx.push([pi, i, a, p.ve[i]]);
    }
  });
  // At the same start, the most recently loaded file comes first, so its copy is the one kept below
  // (a regenerated file replaces what was loaded before).
  idx.sort(function (a, b) { return all[a[0]].start[a[1]] - all[b[0]].start[b[1]] || b[0] - a[0]; });
  vidx.sort(function (a, b) { return a[2] - b[2] || b[0] - a[0]; });
  var out = idx.filter(function (x, j) {
    if (!j) return true;
    var y = idx[j - 1], p = all[x[0]], q = all[y[0]];
    return !(p.start[x[1]] === q.start[y[1]] && p.mode[x[1]] === q.mode[y[1]]);
  });
  var vout = vidx.filter(function (x, j) { return !j || x[2] !== vidx[j - 1][2]; });
  var nv = vout.length;
  var R = gather(all, out, src);
  R.vs = new Float64Array(nv); R.ve = new Float64Array(nv); R.vday = new Int32Array(nv); R.voff = new Int16Array(nv); R.vll = new Float32Array(2 * nv); R.vtype = new Uint8Array(nv); R.vname = []; R.vpid = []; R.vsrcs = new Uint8Array(nv);
  R.files = (base ? base.files || [] : []).concat(parts.concat(sv).map(function (p) { return { name: p.name, kind: p.kind }; }));
  vout.forEach(function (x, j) {
    var p = all[x[0]], i = x[1];
    R.vs[j] = x[2]; R.ve[j] = x[3]; R.voff[j] = p.voff[i];
    R.vday[j] = x[2] === p.vs[i] ? p.vday[i] : dayOf({ ms: x[2], off: p.voff[i] === NO_OFF ? null : p.voff[i] });
    R.vll[2 * j] = p.vll[2 * i]; R.vll[2 * j + 1] = p.vll[2 * i + 1]; R.vtype[j] = p.vtype[i]; R.vname.push(p.vname[i] || ''); R.vpid.push(p.vpid && p.vpid[i] || ''); R.vsrcs[j] = vsrc(p, i);
  });
  // Records points give the Timeline trips their full GPS trail (see withTrack).
  var track = mergeTracks(all.map(function (p) { return p.track; }));
  if (track) {
    var before = 0, after = 0, i_;
    for (i_ = 0; i_ < R.est.length; i_++) if (R.est[i_] & RECORDS_GPS) before++;
    R = withTrack(R, track);
    for (i_ = 0; i_ < R.est.length; i_++) if (R.est[i_] & RECORDS_GPS) after++;
    R.track = track; R.redrawn = after - before;
  }
  R.simReplaced = simOut; R.gapKept = gapKept;
  R.dropped = total - out.length - simOut;
  // Strava: the same activity loaded twice (an export, then a newer one) is kept once.
  var sall = (base && base.strava ? [base.strava] : []).concat(sv), sidx = [];
  sall.forEach(function (p, pi) { for (var i = 0; i < p.start.length; i++) sidx.push([pi, i]); });
  sidx.sort(function (a, b) { return sall[a[0]].start[a[1]] - sall[b[0]].start[b[1]]; });
  // The newer file's copy wins, so loading an export again picks up what this version reads from it (such as the sport).
  var skeep = [];
  sidx.forEach(function (x) {
    var L = skeep[skeep.length - 1];
    if (L && sall[x[0]].start[x[1]] - sall[L[0]].start[L[1]] <= 60000) { if (x[0] > L[0]) skeep[skeep.length - 1] = x; }
    else skeep.push(x);
  });
  sidx = skeep;
  if (sidx.length) R.strava = gather(sall, sidx, function () { return SRC.strava; });
  return R;
}
// The trips at [[part, index], …] as one set of arrays.
function gather(all, out, src) {
  var n = out.length, npts = 0;
  var R = { start: new Float64Array(n), end: new Float64Array(n), day: new Int32Array(n), mode: new Uint8Array(n),
    km: new Float32Array(n), est: new Uint8Array(n), off: new Int16Array(n), orig: new Float32Array(n), from: new Float32Array(2 * n), to: new Float32Array(2 * n), srcs: new Uint8Array(n), sport: new Uint8Array(n), stype: [], smeta: [] };
  out.forEach(function (x) { var p = all[x[0]]; npts += p.pathOff[x[1] + 1] - p.pathOff[x[1]]; });
  R.pathPts = new Float32Array(2 * npts); R.pathT = new Float32Array(npts); R.pathOff = new Uint32Array(n + 1);
  var w = 0;
  out.forEach(function (x, j) {
    var p = all[x[0]], i = x[1];
    R.start[j] = p.start[i]; R.end[j] = p.end[i]; R.day[j] = p.day[i]; R.mode[j] = p.mode[i]; R.km[j] = p.km[i]; R.est[j] = p.est[i];
    R.off[j] = p.off ? p.off[i] : NO_OFF; R.orig[j] = p.orig ? p.orig[i] : 0;
    R.from[2 * j] = p.from[2 * i]; R.from[2 * j + 1] = p.from[2 * i + 1]; R.to[2 * j] = p.to[2 * i]; R.to[2 * j + 1] = p.to[2 * i + 1];
    R.srcs[j] = src(p, i); R.sport[j] = p.sport ? p.sport[i] : 0; R.stype.push(p.stype && p.stype[i] || ''); R.smeta.push(p.smeta && p.smeta[i] || null);
    for (var q = p.pathOff[i]; q < p.pathOff[i + 1]; q++, w++) { R.pathPts[2 * w] = p.pathPts[2 * q]; R.pathPts[2 * w + 1] = p.pathPts[2 * q + 1]; R.pathT[w] = p.pathT[q]; }
    R.pathOff[j + 1] = w;
  });
  return R;
}

// Strava activities replace the Timeline trips they cover: a trip at least half inside an
// activity's time is the same journey recorded less precisely, whatever transport Timeline
// thought it was. Activities Timeline missed are added. Flights are never replaced.
// The replaced Timeline trips stay in the result, marked in dup, so choosing Timeline as the
// only source shows them again (apply leaves them out otherwise).
// R itself is left as loaded (it is what gets saved); the result also has repl, the number
// of Timeline trips each Strava trip replaced, dup, and stravaStats.
// Trips shown with every source: a Timeline trip a Strava activity replaced isn't counted.
function isDup(i) { return D.dup ? D.dup[i] === 1 : false; }
function tripTotal() {
  if (!D.dup) return D.day.length;
  for (var i = 0, c = 0; i < D.dup.length; i++) c += 1 - D.dup[i];
  return c;
}
function withStrava(R) {
  var S = R.strava;
  if (!S || !S.start.length) return R;
  var n = R.start.length, m = S.start.length, i, j, k, fly = MODES.indexOf('FLYING');
  var ord = Array.from({ length: n }, function (_, x) { return x; }).sort(function (a, b) { return R.start[a] - R.start[b]; });
  var maxDur = 0;
  for (i = 0; i < n; i++) if (R.mode[i] !== fly) maxDur = Math.max(maxDur, R.end[i] - R.start[i]);
  function first(t) { var lo = 0, hi = n; while (lo < hi) { var mid = (lo + hi) >> 1; if (R.start[ord[mid]] < t) lo = mid + 1; else hi = mid; } return lo; }
  var drop = new Uint8Array(n), cnt = new Uint16Array(m), off = new Int16Array(m), matched = 0, replaced = 0;
  for (k = 0; k < m; k++) {
    var s = S.start[k], e = S.end[k], o = S.off ? S.off[k] : NO_OFF;
    for (j = first(s - maxDur); j < n && R.start[ord[j]] < e; j++) {
      i = ord[j];
      if (R.mode[i] === fly) continue;
      var dur = R.end[i] - R.start[i], ov = Math.min(e, R.end[i]) - Math.max(s, R.start[i]);
      if (dur > 0 ? ov >= dur / 2 : R.start[i] >= s) {
        if (!drop[i]) { drop[i] = 1; replaced++; }
        cnt[k]++;
        if (o === NO_OFF) o = R.off[i];
      }
    }
    if (cnt[k]) matched++;
    // No trip to take the local time from: use the nearest trip within 3 days that has one.
    for (var step = 0, at = first(s); o === NO_OFF && step < 40; step++) {
      var a = ord[at - 1 - step], b = ord[at + step];
      if (b != null && R.off[b] !== NO_OFF && R.start[b] - s < 3 * 864e5) o = R.off[b];
      else if (a != null && R.off[a] !== NO_OFF && s - R.start[a] < 3 * 864e5) o = R.off[a];
    }
    off[k] = o;
  }
  var list = [];
  for (i = 0; i < n; i++) list.push([0, i]);
  for (k = 0; k < m; k++) list.push([1, k]);
  list.sort(function (x, y) { return (x[0] ? S : R).start[x[1]] - (y[0] ? S : R).start[y[1]]; });
  var O = gather([R, S], list, function (p, x) { return p === S ? SRC.strava : p.srcs ? p.srcs[x] : 0; });
  O.repl = new Uint16Array(list.length);
  O.dup = new Uint8Array(list.length);
  list.forEach(function (x, j) {
    if (!x[0]) { O.dup[j] = drop[x[1]]; return; }
    var k_ = x[1];
    O.repl[j] = cnt[k_];
    O.est[j] |= STRAVA;
    if (off[k_] !== NO_OFF) { O.off[j] = off[k_]; O.day[j] = Math.floor((S.start[k_] + off[k_] * 60000) / 864e5); }
  });
  ['vs', 've', 'vday', 'voff', 'vll', 'vtype', 'vname', 'vpid', 'vsrcs', 'files', 'strava', 'track'].forEach(function (key) { O[key] = R[key]; });
  O.stravaStats = { acts: m, matched: matched, replaced: replaced, added: m - matched };
  return O;
}
function stravaText(st) {
  if (!st) return '';
  return fmt(st.acts) + ' Strava ' + (st.acts === 1 ? 'activity' : 'activities') + ': ' + fmt(st.matched) + ' replaced ' + fmt(st.replaced) + ' Timeline trip' + (st.replaced === 1 ? '' : 's') +
    (st.added ? ', ' + fmt(st.added) + ' added where Timeline had nothing' : '') + '.';
}
function runParser(files) {
  return new Promise(function (resolve) {
    var results = [], errors = [], skipped = 0, worker = null;
    try { worker = new Worker(URL.createObjectURL(new Blob([$('parser').textContent], { type: 'text/javascript' }))); } catch (e) { worker = null; }
    function done() { resolve({ results: results, errors: errors, skipped: skipped }); }
    if (worker) {
      worker.onmessage = function (e) {
        var m = e.data;
        if (m.type === 'progress') busy(m.text);
        else if (m.type === 'file') results.push(m.result);
        else if (m.type === 'error') { if (m.skipped) skipped++; else errors.push(m.name + ': ' + m.text); }
        else if (m.type === 'done') { worker.terminate(); done(); }
      };
      worker.onerror = function () { worker.terminate(); mainThread(); };
      worker.postMessage({ files: files });
    } else mainThread();
    function mainThread() {
      results = []; errors = []; skipped = 0;
      (function next(i) {
        if (i >= files.length) { done(); return; }
        busy('Reading ' + files[i].name + '…');
        parseFile(files[i], function () {}).then(function (r) { r.name = files[i].name; results.push(r); })
          .catch(function (err) { if (err && err.message === NOT_TIMELINE) skipped++; else errors.push(files[i].name + ': ' + (err && err.message || err)); })
          .then(function () { next(i + 1); });
      })(0);
    }
  });
}
function importFiles(list) {
  var files = Array.prototype.filter.call(list, function (f) { return /\.json$/i.test(f.name) || isStravaName(f.name); });
  if (!files.length) { setStatus('No Timeline (.json) or Strava files found there.', true); return; }
  setStatus('');
  busy('Reading…');
  runParser(files).then(function (r) {
    if (!r.results.length) { busy(''); setStatus(r.errors.length ? r.errors.join(' · ') : NOT_TIMELINE, true); return; }
    busy('Preparing your map…');
    setTimeout(function () {
      var next = merge(RAW, r.results);
      setData(next);
      // Saved after setData, which leaves out bad GPS jumps, so the saved copy is the cleaned one.
      saveData(next);
      busy('');
      var nv = next.vs.length;
      var onlyStrava = r.results.every(function (x) { return x.strava; });
      var msg = onlyStrava ? '' : 'Loaded ' + tripsText(tripTotal()) + (nv ? ' and ' + fmt(nv) + ' stays' : '') + ' from ' + r.results.length + ' file' + (r.results.length > 1 ? 's' : '') + '.';
      if (r.skipped) msg += ' Skipped ' + r.skipped + ' file' + (r.skipped > 1 ? 's' : '') + ' without Timeline data.';
      if (next.dropped) msg += ' Left out ' + fmt(next.dropped) + ' trips already covered by another export.';
      if (next.gapKept) msg += ' Kept ' + tripsText(next.gapKept) + ' from Records.json where Timeline recorded nothing.';
      if (next.redrawn) msg += ' Drew ' + tripsText(next.redrawn) + ' along the GPS trail from Records.json.';
      if (next.simReplaced) msg += ' Simulated trips replaced ' + fmt(next.simReplaced) + ' exported trip' + (next.simReplaced === 1 ? '' : 's') + '.';
      if (r.results.some(function (x) { return x.strava; })) msg += ' ' + stravaText(D.stravaStats);
      msg = msg.trim();
      if (r.errors.length) msg += ' Problems: ' + r.errors.join(' · ');
      setStatus(msg, r.errors.length > 0);
    }, 30);
  });
}
$('fileIn').addEventListener('change', function () { closeSheets(); importFiles(this.files); this.value = ''; });
$('stravaIn').addEventListener('change', function () { closeSheets(); importFiles(this.files); this.value = ''; });
$('dirIn').addEventListener('change', function () { importFiles(this.files); this.value = ''; });
// The welcome Load button's chevron opens a small menu (like a split Send button) with Load a whole folder.
(function () {
  var more = $('loadMore'), menu = $('loadMenu'), item = $('loadFolder');
  function show(open) {
    menu.hidden = !open; more.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) item.focus();
  }
  more.addEventListener('click', function (e) { e.stopPropagation(); show(menu.hidden); });
  item.addEventListener('click', function () { show(false); $('dirIn').click(); });
  document.addEventListener('click', function (e) { if (!menu.hidden && !$('loadSplit').contains(e.target)) show(false); });
  $('loadSplit').addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { show(false); more.focus(); } });
})();
// About: a dialog over the welcome picture, closed until asked for. A click on the backdrop closes it.
(function () {
  var dlg = $('about');
  $('aboutBtn').addEventListener('click', function () { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); });
  $('aboutClose').addEventListener('click', function () { dlg.close ? dlg.close() : dlg.removeAttribute('open'); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
})();
document.body.addEventListener('dragover', function (e) { e.preventDefault(); });
document.body.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });

// ---------- remember the last import on this device ----------
// Kept in this browser's IndexedDB so the app opens with it next time. Nothing leaves the device.
function withStore(name, mode, fn) {
  return new Promise(function (resolve, reject) {
    var rq;
    try { rq = indexedDB.open(name, 1); } catch (e) { reject(e); return; }
    rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
    rq.onerror = function () { reject(rq.error); };
    rq.onsuccess = function () {
      var db = rq.result, tx = db.transaction('kv', mode), req = fn(tx.objectStore('kv'));
      tx.oncomplete = function () { db.close(); resolve(req.result); };
      tx.onerror = tx.onabort = function () { db.close(); reject(tx.error); };
    };
  });
}
function saveData(R) {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
  var keep = {};
  ['start', 'end', 'day', 'mode', 'km', 'est', 'off', 'orig', 'from', 'to', 'srcs', 'pathPts', 'pathT', 'pathOff',
    'vs', 've', 'vday', 'voff', 'vll', 'vtype', 'vname', 'vpid', 'vsrcs', 'files', 'strava', 'track'].forEach(function (k) { keep[k] = R[k]; });
  return withStore('btdt', 'readwrite', function (s) { return s.put(keep, 'trips'); }).catch(function () { /* this visit still works */ });
}
function loadSaved() {
  var get = function (s) { return s.get('trips'); };
  var load = function (name) { return withStore(name, 'readonly', get).catch(function () { return null; }); };
  return load('btdt').then(function (R) {
    if (R && R.day) return R;
    // Trips saved while the app was called Timeliner: same format, so they are copied over as they are.
    return load('timeliner').then(function (prev) {
      if (prev && prev.day) { saveData(prev); return prev; }
      // Trips saved by Transport Footprint 1.0 on this device.
      return load('footprint').then(function (old) {
        if (old && old.day) { saveData(upgrade(old)); return old; }
        return null;
      });
    });
  });
}
$('forgetBtn').addEventListener('click', function () {
  var del = function (s) { return s.delete('trips'); };
  Promise.all([withStore('btdt', 'readwrite', del).catch(function () {}), withStore('timeliner', 'readwrite', del).catch(function () {}), withStore('footprint', 'readwrite', del).catch(function () {})])
    .then(function () { location.reload(); });
});
