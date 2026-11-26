// ---------- settings ----------
function renderSettings() {
  setPressed('#unitSeg button', function (b) { return b.dataset.u === PREFS.unitF; });
  setPressed('#themeSeg button', function (b) { return b.dataset.t === PREFS.theme; });
  renderDateTimeSettings();
  $('unitNote').textContent = 'Automatic uses ' + (LOCALE_FMT.unit === 'mi' ? 'miles' : 'kilometres') + ', from this device\'s region.';
  buildFactors(); renderDefCar(); fillDists();
  renderHrSettings();
  renderImports();
  renderSplitSettings();
  netSettings();
  if (typeof driftSettings === 'function') driftSettings();
  renderPacks();
  renderMenu();
  $('homeSec').hidden = !D || !!DEMO;
  $('homeEdit').hidden = true;
  if (!D || DEMO) { $('homeNote').textContent = ''; return; }
  var h = findHome();
  $('homeNote').textContent = h >= 0 ? 'Home is ' + describeHome(h) + ', judging by ' + D.homeHow + '. BT•DT labels it Home in lists.' : 'BT•DT couldn\'t tell where home is from this data.';
  $('homeEdit').hidden = h < 0;
}
// The Menu's rows: what each page holds right now.
function renderMenu() {
  $('menuSub-mrSheet').textContent = !MR ? 'Add what only you know: gear, places, routines' : mrCount(MR.doc) + (MR.on ? '' : ' · switched off');
  var packs = typeof packCodes === 'function' ? packCodes().length : 0, split = splitSetting();
  $('menuSub-cleanupSheet').textContent = [split === 'auto' ? 'Merged trips split' : split === 'ask' ? 'Merged trips suggested' : 'Merged trips kept whole',
    packs ? packs + ' station pack' + (packs === 1 ? '' : 's') : 'No station packs'].concat(typeof driftMenuText === 'function' ? driftMenuText() : []).filter(Boolean).join(' · ');
  var u = PREFS.unitF === 'km' ? 'Kilometres' : PREFS.unitF === 'mi' ? 'Miles' : LOCALE_FMT.unit === 'mi' ? 'Miles' : 'Kilometres';
  $('menuSub-prefsSheet').textContent = u + ' · ' + niceDate(todayDay()) + ' · ' + (PREFS.theme === 'dark' ? 'Dark' : PREFS.theme === 'light' ? 'Light' : 'System') + ' theme';
}
$('homeEdit').addEventListener('click', function () { var h = findHome(); if (h >= 0) openPlace(h); });
// Leave out cell-tower fixes (see mrApplyDrops): the switch, and how many points and trips it takes.
function netSettings() {
  var el = $('netFix');
  el.checked = netFixOn();
  var note = '';
  if (D && D.base) {
    var pts = 0, trips = 0;
    if (netFixOn()) (D.netDrop || []).forEach(function (x) { if (x) { pts += x.n; trips++; } });
    else { var net = mrNetFixes(); Object.keys(net).forEach(function (k) { trips++; pts += (D.base.pathOff[+k + 1] - D.base.pathOff[+k]) - net[k].length; }); }
    note = !trips ? 'None of your trips has any.' : (netFixOn() ? fmt(pts) + ' GPS point' + (pts === 1 ? '' : 's') + ' left out of ' : 'Would leave out ' + fmt(pts) + ' GPS point' + (pts === 1 ? '' : 's') + ' from ') + tripsText(trips) + '.';
  }
  $('netNote').textContent = note;
}
$('netFix').addEventListener('change', function () {
  var on = this.checked;
  working(on ? 'Leaving out cell-tower fixes…' : 'Bringing cell-tower fixes back…', function () {
    PREFS.netFix = on; savePrefs();
    mrReapply();
    netSettings();
  });
});
// The files behind D, one row each: a file read as two kinds (a ZIP with a Timeline and activities) is one row.
function importedFiles() {
  var by = {}, out = [];
  (D && D.files || []).forEach(function (f) {
    if (!f.name) return;
    var r = by[f.name];
    if (!r) { r = by[f.name] = { name: f.name, kinds: [], n: 0, counted: true }; out.push(r); }
    if (f.kind && r.kinds.indexOf(f.kind) < 0) r.kinds.push(f.kind);
    if (f.n == null) r.counted = false; else r.n += f.n;
  });
  return out;
}
// Imported data: the summary, the import buttons and the list of files, opened from the top of the filters.
function renderImports() {
  var files = importedFiles(), list = $('fileList');
  list.textContent = '';
  files.forEach(function (f) {
    var li = document.createElement('li');
    li.innerHTML = '<span data-icon="' + (/\.zip$/i.test(f.name) ? 'folder' : 'file') + '"></span><span class="file-txt"><b>' + esc(f.name) + '</b><small>' +
      esc([f.kinds.join(' and ')].concat(f.counted ? [tripsText(f.n)] : []).filter(Boolean).join(' · ')) + '</small></span>';
    list.appendChild(li);
  });
  fillIcons(list);
  $('filesHead').textContent = files.length ? 'Files (' + files.length + ')' : 'Files';
  $('fileList').closest('.sec').hidden = !files.length;
  renderMyRules();
  if (!D) { $('dataSummary').textContent = 'No data loaded yet.'; $('forgetBtn').hidden = true; $('menuSub-importsSheet').textContent = 'No data loaded'; return; }
  $('forgetBtn').hidden = !!DEMO;
  var span = niceDate(M.minD) + ' – ' + niceDate(M.maxD);
  $('menuSub-importsSheet').textContent = (DEMO ? 'Demo data' : files.length + ' file' + (files.length === 1 ? '' : 's')) + ' · ' + span;
  if (DEMO) {
    $('dataSummary').textContent = 'This is the demo: ' + tripsText(tripTotal()) + ' and ' + fmt(D.vs.length) + ' stays, ' + span +
      ', all made up. Nothing is saved. Import your own files to replace it.';
    return;
  }
  $('dataSummary').textContent = tripsText(tripTotal()) + (D.vs.length ? ' and ' + fmt(D.vs.length) + ' stays' : '') + ', ' + span + '. Saved on this device only.' +
    (D.stravaStats ? ' ' + stravaText(D.stravaStats) : '');
}
// Maximum heart rate, for the zones: shown once an import has heart rate. Empty means worked out from the data.
function renderHrSettings() {
  var a = D ? hrMaxAuto() : { n: 0 };
  $('hrSec').hidden = !a.n;
  if (!a.n) return;
  if (document.activeElement !== $('maxHr')) $('maxHr').value = PREFS.maxHr >= 100 ? PREFS.maxHr : '';
  $('maxHr').placeholder = String(a.v);
  $('maxHrNote').textContent = (PREFS.maxHr >= 100 ? 'Heart rate zones use the ' + PREFS.maxHr + ' bpm you set. Clear it to use the highest your activities reached, ' + a.v + ' bpm.' :
    'Heart rate zones use the highest your ' + fmt(a.n) + ' activities with heart rate reached, ' + a.v + ' bpm. If you know your maximum is higher, set it here.') +
    ' Zones: Z1 under 60%, Z2 60–70%, Z3 70–80%, Z4 80–90%, Z5 90% and over.';
}
$('maxHr').addEventListener('change', function () {
  var v = Math.round(parseFloat(this.value));
  PREFS.maxHr = v >= 100 && v <= 230 ? v : 0;
  savePrefs(); renderHrSettings();
  if (D) { dirty.map = dirty.insights = true; renderTab(); if (hlTrip != null) highlight(hlTrip); }
});
function describeHome(h) {
  var q = D.places[h], c = nearestCity(q.lat, q.lng);
  return (c ? (c.d > 8 ? 'near ' : 'in ') + c.name : 'at ' + ll(q.lat, q.lng)) + ' (' + ll(q.lat, q.lng) + ')';
}
$('unitSeg').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-u]');
  if (!b) return;
  PREFS.unitF = b.dataset.u; resolveUnit(); savePrefs(); renderSettings();
  if (D) apply();
});
// Date and time format: Automatic follows the device's language and region; each choice shows an example.
var DT_SAMPLE = Math.floor(Date.UTC(2026, 10, 17) / 864e5);
function dtOpts(key, opts, sample) {
  var keep = PREFS[key], out = opts.map(function (o) {
    PREFS[key] = o[0];
    return '<option value="' + o[0] + '">' + o[1] + ' (' + sample() + ')</option>';
  }).join('');
  PREFS[key] = keep;
  return out;
}
function renderDateTimeSettings() {
  var dSample = function () { return niceDate(DT_SAMPLE); }, tSample = function () { return fmtHM(14, 5); };
  $('dateFmt').innerHTML = dtOpts('dateF', [['auto', 'Automatic'], ['dmy', 'Day month year'], ['mdy', 'Month day, year'], ['ymd', 'Year-month-day']], dSample);
  $('timeFmt').innerHTML = dtOpts('timeF', [['auto', 'Automatic'], ['24', '24-hour'], ['12', '12-hour']], tSample);
  $('dateFmt').value = PREFS.dateF; $('timeFmt').value = PREFS.timeF;
  var lang = (navigator.languages && navigator.languages[0]) || navigator.language;
  $('dtNote').textContent = 'Automatic follows this device' + (lang ? ' (' + lang + ')' : '') + '. Used for every date and time in BT•DT; dates you type in filters follow your browser.';
}
function dateTimeChanged() {
  savePrefs(); renderSettings();
  if (!D) return;
  fillHourOpts();
  dirty.map = dirty.insights = dirty.timeline = true;
  apply();
  if (hlTrip != null) highlight(hlTrip);
  if (TL.sel != null) tlSelect(TL.sel);
  scrubLabel();
}
$('dateFmt').addEventListener('change', function () { PREFS.dateF = this.value; dateTimeChanged(); });
$('timeFmt').addEventListener('change', function () { PREFS.timeF = this.value; dateTimeChanged(); });
$('themeSeg').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-t]');
  if (!b) return;
  PREFS.theme = b.dataset.t; savePrefs(); renderSettings(); themeChanged();
});
function themeChanged() {
  applyTheme();
  if (map) addTiles(map);
  if (TL.map) addTiles(TL.map);
  heatPalette = null;
  if (D) { dirty.map = dirty.insights = dirty.timeline = true; renderTab(); if (TL.sel != null) tlSelect(TL.sel); }
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (PREFS.theme === 'system') themeChanged(); });

function buildFactors() {
  $('occ').value = A.occ;
  $('rf').checked = A.rf;
  var rows = [['CAR', 'Car, no car known (per vehicle)']].concat(EDIT.map(function (m) { return [m, LABEL[m] + (m === 'MOTORCYCLE' ? ' (per vehicle)' : '')]; }));
  var el = $('factors'); el.textContent = '';
  rows.forEach(function (r) {
    var id = 'g_' + r[0], l = document.createElement('label'), inp = document.createElement('input');
    l.htmlFor = id; l.textContent = r[1];
    // Typed per km or per mile, as in Settings; kept per km. Only a field you change is converted back.
    var per = PREFS.unit === 'mi' ? 1 / MI : 1;
    inp.type = 'number'; inp.id = id; inp.min = 0; inp.step = 'any'; inp.value = Math.round(A.g[r[0]] * per);
    inp.addEventListener('input', function () {
      var v = parseFloat(inp.value); if (!isFinite(v) || v < 0) return;
      A.g[r[0]] = v / per;
      if (r[0] === 'CAR') A.car = 'custom';
      saveFactors(); co2Changed();
    });
    el.appendChild(l); el.appendChild(inp);
  });
  var note = document.createElement('p');
  note.className = 'fine'; note.style.gridColumn = '1 / -1';
  $('factorsSum').textContent = 'Grams of CO₂e per ' + (PREFS.unit === 'mi' ? 'mile' : 'km');
  var fp = PREFS.unit === 'mi' ? 1 / MI : 1, fg = function (x) { return fmt(Math.round(x * fp)); };
  note.textContent = 'Flights, per passenger by distance: under ' + dist(500) + ' ' + fg(A.fly.dom[A.rf ? 0 : 1]) + ' g, ' + dist(500).replace(/ \S+$/, '') + '–' + dist(3700) + ' ' + fg(A.fly.short[A.rf ? 0 : 1]) + ' g, longer ' + fg(A.fly.long[A.rf ? 0 : 1]) + ' g. Car trips count by what their car runs on, your default car included: petrol ' + fg(CAR.petrol) + ' g, diesel ' + fg(CAR.diesel) + ' g, hybrid ' + fg(CAR.hybrid) + ' g, electric ' + fg(CAR.ev) + ' g. Car trips with no car known use the car factor above. Walking and cycling count as zero. Factors are UK government averages for 2025.';
  el.appendChild(note);
}
function co2Changed() { if (D) { dirty.insights = true; if (tab === 'insights') renderTab(); } }
// The default car (MyRules gear, see mrDefaultCarDialog): what it is, and Set up… or Edit….
function renderDefCar() {
  var r = mrDefaultCar(), on = r && MR && MR.on;
  $('defCarTxt').innerHTML = r ? '<b>' + esc(r.name || 'My car') + '</b><small>' + esc([MR_KINDS[r.kind] || 'Car', r.model].filter(Boolean).join(' · ')) + (on ? '' : ' · MyRules are off') + '</small>'
    : '<small>Not set up. Car trips without gear count as a ' + (CAR[A.car] != null && A.car !== 'petrol' ? esc(MR_KINDS[A.car].toLowerCase()) : 'petrol car') + '.</small>';
  $('defCarBtn').textContent = r ? 'Edit…' : 'Set up…';
}
$('defCarBtn').addEventListener('click', function () { mrDefaultCarDialog(); });
$('occ').addEventListener('input', function () { var v = parseFloat(this.value); if (v >= 1) { A.occ = v; saveFactors(); co2Changed(); } });
$('rf').addEventListener('change', function () { A.rf = this.checked; saveFactors(); buildFactors(); co2Changed(); });
$('resetFactors').addEventListener('click', function () { A = JSON.parse(JSON.stringify(DEFAULTS)); saveFactors(); buildFactors(); co2Changed(); });

// ---------- start ----------
fillIcons(); fillDists();
applyTheme();
syncLayersUI();
renderSettings();
$('mapNote').textContent = PATH_NOTE;
var resizeT = 0;
window.addEventListener('resize', function () {
  clearTimeout(resizeT);
  resizeT = setTimeout(function () { if (!D || BUILDING) return; if (tab === 'map' && map) { map.invalidateSize(); if (PREFS.heat) heatLayer.redraw(); } if (tab === 'timeline') tlLayout(); }, 150);
});
stampDate();
busy('Opening your saved trips…');
// The road packs' graph is made first (when snapping to roads is on), so the trips are drawn along
// the roads in one go. setDataSoon works through the trips in slices, so the loader keeps moving.
mrLoad().then(packsLoad).then(function () { return roadOn() && !RG ? roadsLoad() : null; }).then(loadSaved).then(function (R) {
  if (!R || D) return;
  return setDataSoon(R).then(function () { toast('Showing the trips saved on this device.'); });
}).catch(function () { /* opens without them */ }).then(function () { busy(''); driveStart(); });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(function () { /* offline start unavailable */ });
}
