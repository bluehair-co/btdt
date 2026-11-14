// ---------- settings ----------
function renderSettings() {
  setPressed('#unitSeg button', function (b) { return b.dataset.u === PREFS.unit; });
  setPressed('#themeSeg button', function (b) { return b.dataset.t === PREFS.theme; });
  buildFactors();
  renderHrSettings();
  if (!D) { $('dataSummary').textContent = 'No data loaded yet.'; $('homeNote').textContent = ''; $('forgetBtn').hidden = true; return; }
  $('forgetBtn').hidden = !!DEMO;
  if (DEMO) {
    $('dataSummary').textContent = 'This is the demo: ' + tripsText(tripTotal()) + ' and ' + fmt(D.vs.length) + ' stays, ' + niceDate(M.minD) + ' – ' + niceDate(M.maxD) +
      ', all made up. Nothing is saved. Import your own Timeline file to replace it.';
    $('homeNote').textContent = '';
    return;
  }
  var names = (D.files || []).map(function (f) { return f.name; }).filter(Boolean);
  $('dataSummary').textContent = tripsText(tripTotal()) + (D.vs.length ? ' and ' + fmt(D.vs.length) + ' stays' : '') + ', ' + niceDate(M.minD) + ' – ' + niceDate(M.maxD) +
    (names.length ? ', from ' + names.slice(0, 3).join(', ') + (names.length > 3 ? ' and ' + (names.length - 3) + ' more' : '') : '') + '. Saved on this device only.' +
    (D.stravaStats ? ' ' + stravaText(D.stravaStats) : '');
  var h = findHome();
  $('homeNote').textContent = h >= 0 ? 'Home is ' + describeHome(h) + ', judging by ' + D.homeHow + '. BT•DT labels it Home in lists.' : 'BT•DT couldn\'t tell where home is from this data.';
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
  PREFS.unit = b.dataset.u; savePrefs(); renderSettings();
  if (D) apply();
});
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
  $('carType').value = A.car;
  $('occ').value = A.occ;
  $('rf').checked = A.rf;
  var rows = [['CAR', 'Car (per vehicle)']].concat(EDIT.map(function (m) { return [m, LABEL[m] + (m === 'MOTORCYCLE' ? ' (per vehicle)' : '')]; }));
  var el = $('factors'); el.textContent = '';
  rows.forEach(function (r) {
    var id = 'g_' + r[0], l = document.createElement('label'), inp = document.createElement('input');
    l.htmlFor = id; l.textContent = r[1];
    inp.type = 'number'; inp.id = id; inp.min = 0; inp.step = 1; inp.value = A.g[r[0]];
    inp.addEventListener('input', function () {
      var v = parseFloat(inp.value); if (!isFinite(v) || v < 0) return;
      A.g[r[0]] = v;
      if (r[0] === 'CAR') { A.car = 'custom'; $('carType').value = 'custom'; }
      saveFactors(); co2Changed();
    });
    el.appendChild(l); el.appendChild(inp);
  });
  var note = document.createElement('p');
  note.className = 'fine'; note.style.gridColumn = '1 / -1';
  note.textContent = 'Flights, per passenger by distance: under 500 km ' + A.fly.dom[A.rf ? 0 : 1] + ' g, 500–3,700 km ' + A.fly.short[A.rf ? 0 : 1] + ' g, longer ' + A.fly.long[A.rf ? 0 : 1] + ' g. Walking and cycling count as zero. Factors are UK government averages for 2025.';
  el.appendChild(note);
}
function co2Changed() { if (D) { dirty.insights = true; if (tab === 'insights') renderTab(); } }
$('carType').addEventListener('change', function () {
  A.car = this.value;
  if (CAR[A.car] != null) A.g.CAR = CAR[A.car];
  saveFactors(); buildFactors(); co2Changed();
});
$('occ').addEventListener('input', function () { var v = parseFloat(this.value); if (v >= 1) { A.occ = v; saveFactors(); co2Changed(); } });
$('rf').addEventListener('change', function () { A.rf = this.checked; saveFactors(); buildFactors(); co2Changed(); });
$('resetFactors').addEventListener('click', function () { A = JSON.parse(JSON.stringify(DEFAULTS)); saveFactors(); buildFactors(); co2Changed(); });

// ---------- start ----------
fillIcons();
applyTheme();
syncLayersUI();
renderSettings();
$('mapNote').textContent = PATH_NOTE;
var resizeT = 0;
window.addEventListener('resize', function () {
  clearTimeout(resizeT);
  resizeT = setTimeout(function () { if (!D) return; if (tab === 'map' && map) { map.invalidateSize(); if (PREFS.heat) heatLayer.redraw(); } if (tab === 'timeline') tlLayout(); }, 150);
});
busy('Opening your saved trips…');
loadSaved().then(function (R) {
  busy('');
  if (R && !D) { setData(R); toast('Showing the trips saved on this device.'); }
}).catch(function () { busy(''); });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(function () { /* offline start unavailable */ });
}
