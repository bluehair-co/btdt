// ---------- MyRules ----------
// A MyRules file (*.myrules.json) holds what only you know: which bike you rode when, where home was.
// It is applied on top of the location files, and every value it fills in is marked Inferred.
// The format is in docs/myrules.md; this version applies gear periods, places, and gear set on one trip.
// Routines and other corrections are kept in the file (and exported again) but not applied yet.
// MR is null until a file is loaded or a rule is made in the app. It is saved in this browser's
// IndexedDB next to the trips, never uploaded. changes lists what was changed in the app since the
// file was last loaded or exported, so nothing is lost by removing it from the device.
var MR = null;
var MR_SECTIONS = ['places', 'gear', 'routines', 'corrections'];
var MR_DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
var MR_KINDS = { bike: 'Bike', strida: 'Strida', halfbike: 'Halfbike', cargo: 'Cargo bike', ebike: 'E-bike', shoe: 'Shoes', other: 'Other' };
var MR_COUNT = {};   // trips (gear) or stays (places) each rule changed, by id
var MR_AMB = 0;      // trips more than one gear period fits equally well, which get none

function mrList(sec) { return MR && MR.doc[sec] ? MR.doc[sec].filter(function (r) { return r && typeof r === 'object'; }) : []; }
function mrActive(sec) { return MR && MR.on ? mrList(sec).filter(function (r) { return r.id && r.enabled !== false; }) : []; }
function mrById(id) {
  id = String(id || '').replace(/^@/, '');
  for (var s = 0; s < MR_SECTIONS.length; s++) { var L = mrList(MR_SECTIONS[s]); for (var k = 0; k < L.length; k++) if (L[k].id === id) return L[k]; }
  return null;
}
function mrNewId(name) {
  var base = String(name || 'rule').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'rule', id = base, k = 2;
  while (mrById(id)) id = base + '-' + k++;
  return id;
}
function mrDayNum(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) : null; }
function mrMin(s) { var m = /^(\d{2}):(\d{2})$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; }
// A trip's local start: its day number, day of the week and minutes after midnight.
function mrLocalMin(i) {
  var off = D.off[i] !== NO_OFF ? D.off[i] : -new Date(D.start[i]).getTimezoneOffset();
  var t = D.start[i] + off * 60000;
  return Math.floor((t - Math.floor(t / 864e5) * 864e5) / 60000);
}
// The local start of a trip as ISO 8601 with its UTC offset, to the minute: how rules point at one trip.
function mrIsoLocal(i) {
  var off = D.off[i] !== NO_OFF ? D.off[i] : -new Date(D.start[i]).getTimezoneOffset();
  var s = new Date(D.start[i] + off * 60000).toISOString().slice(0, 16), a = Math.abs(off);
  return s + (off < 0 ? '-' : '+') + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
}
// A rule's when, ready to test trips against.
function mrWhen(w) {
  w = w || {};
  var o = { from: mrDayNum(w.from), to: mrDayNum(w.to), days: null, t0: null, t1: null, skip: [] };
  if (Array.isArray(w.days) && w.days.length) { o.days = {}; w.days.forEach(function (d) { var k = MR_DOW.indexOf(String(d).toLowerCase().slice(0, 3)); if (k >= 0) o.days[k] = 1; }); }
  if (Array.isArray(w.time) && w.time.length === 2) { o.t0 = mrMin(w.time[0]); o.t1 = mrMin(w.time[1]); }
  (Array.isArray(w.skip) ? w.skip : []).forEach(function (s) { if (Array.isArray(s)) o.skip.push([mrDayNum(s[0]), mrDayNum(s[1])]); });
  // How long it lasts, for choosing between two rules that both fit: the shorter one wins.
  o.len = o.from != null && o.to != null ? o.to - o.from : 1e9;
  return o;
}
function mrWhenOk(w, i) {
  var d = D.day[i];
  if (w.from != null && d < w.from) return false;
  if (w.to != null && d > w.to) return false;
  if (w.days && !w.days[D.dow[i]]) return false;
  if (w.t0 != null && w.t1 != null) {
    var m = mrLocalMin(i);
    if (w.t0 <= w.t1 ? m < w.t0 || m > w.t1 : m < w.t0 && m > w.t1) return false;
  }
  for (var k = 0; k < w.skip.length; k++) if ((w.skip[k][0] == null || d >= w.skip[k][0]) && (w.skip[k][1] == null || d <= w.skip[k][1])) return false;
  return true;
}
// The trips a TripRef points at. start matches the one trip starting within 3 minutes of it (the
// type it had, when given, picks between two); day every trip that day; span every trip starting in it.
function mrFirstAfter(ms) {
  var o = D.order, lo = 0, hi = o.length;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (D.start[o[mid]] < ms) lo = mid + 1; else hi = mid; }
  return lo;
}
function mrRefTrips(ref) {
  var out = [], k, i, o = D.order;
  if (!ref || typeof ref !== 'object') return out;
  if (ref.start) {
    var t = Date.parse(ref.start);
    if (!isFinite(t)) return out;
    for (k = mrFirstAfter(t - 3 * 60000); k < o.length && D.start[o[k]] <= t + 3 * 60000; k++) if (!isDup(o[k])) out.push(o[k]);
    if (out.length > 1 && ref.mode) out = out.filter(function (j) { return MODES[D.mode[j]] === ref.mode; });
    return out.length === 1 ? out : [];
  }
  if (ref.span && ref.span.length === 2) {
    var a = Date.parse(ref.span[0]), b = Date.parse(ref.span[1]);
    for (k = mrFirstAfter(a); k < o.length && D.start[o[k]] <= b; k++) if (!isDup(o[k])) out.push(o[k]);
    return out;
  }
  var d = mrDayNum(ref.day);
  if (d != null) for (i = 0; i < D.day.length; i++) if (D.day[i] === d && !isDup(i)) out.push(i);
  return out;
}
function mrExcept(r) {
  var s = {};
  (Array.isArray(r.except) ? r.except : []).forEach(function (ref) { mrRefTrips(ref).forEach(function (i) { s[i] = 1; }); });
  return s;
}
// The place rules with a position, and the one a point is in (the nearest, if several).
function mrPlaceAt(lat, lng) {
  var best = null, bd = Infinity;
  mrActive('places').forEach(function (r) {
    if (!Array.isArray(r.at) || !isFinite(lat)) return;
    var d = km([lat, lng], r.at) * 1000;
    if (d <= (+r.radius_m || 100) && d < bd) { bd = d; best = r; }
  });
  return best;
}
function mrNear(lat, lng, ref) {
  var r = mrById(ref);
  return r && Array.isArray(r.at) && isFinite(lat) && km([lat, lng], r.at) * 1000 <= Math.max(+r.radius_m || 100, 500);
}

// Gear: called by buildGear once recorded gear is in. byName is buildGear's gear index by name.
// A gear set on one trip (a correction) wins; then gear periods fill in the trips of their type
// with no gear of their own. Recorded gear is never replaced by a period. Of the periods that fit
// a trip, one with a match beats one without, then the shorter one wins; a tie leaves the trip
// without gear (a wrong guess is worse than none).
function mrApplyGear(byName, addGear) {
  var n = D.day.length, i, k;
  D.mrGear = []; D.mrAmb = []; MR_COUNT = {}; MR_AMB = 0;
  if (!MR || !MR.on) return;
  var periods = mrActive('gear').filter(function (r) { return MODE_IDX[r.mode] != null; }).map(function (r) {
    var m = r.match || {};
    return { r: r, mi: MODE_IDX[r.mode], w: mrWhen(r.when), ex: mrExcept(r), m: m, level: Object.keys(m).length ? 0 : 1 };
  });
  function gearOf(r) { return addGear(r.strava_name && byName[r.strava_name] ? r.strava_name : r.name || r.id, r.kind, r.mode); }
  function fits(p, i) {
    if (D.mode[i] !== p.mi || p.ex[i] || !mrWhenOk(p.w, i)) return false;
    var m = p.m;
    if (m.min_km != null && D.km[i] < m.min_km) return false;
    if (m.max_km != null && D.km[i] > m.max_km) return false;
    if (Array.isArray(m.sports) && m.sports.length && !(D.sport[i] && m.sports.indexOf(SPORTS[D.sport[i]][1] || SPORTS[D.sport[i]][0]) >= 0)) return false;
    if (m.weekdays_only && (D.dow[i] === 0 || D.dow[i] === 6)) return false;
    if (m.from && !mrNear(D.from[2 * i], D.from[2 * i + 1], m.from) && !mrNear(D.to[2 * i], D.to[2 * i + 1], m.from)) return false;
    if (m.to && !mrNear(D.to[2 * i], D.to[2 * i + 1], m.to) && !mrNear(D.from[2 * i], D.from[2 * i + 1], m.to)) return false;
    return true;
  }
  // Gear set on one trip.
  mrActive('corrections').forEach(function (c) {
    if (!c.then || !c.then.gear || !c.trip || c.trip.day || c.trip.span) return;
    var ref = String(c.then.gear), r = ref.charAt(0) === '@' ? mrById(ref) : null;
    if (ref.charAt(0) === '@' && (!r || r.enabled === false)) return;
    var ex = mrExcept(c);
    mrRefTrips(c.trip).forEach(function (i) {
      if (ex[i]) return;
      var g = r ? gearOf(r) : addGear(ref, null, MODES[D.mode[i]]);
      D.gear[i] = g; D.mrGear[i] = { rule: c.id, gear: g };
      MR_COUNT[c.id] = (MR_COUNT[c.id] || 0) + 1;
    });
  });
  if (!periods.length) return;
  for (i = 0; i < n; i++) {
    if (D.gear[i] || isDup(i)) continue;
    var best = [];
    for (k = 0; k < periods.length; k++) {
      var p = periods[k];
      if (!fits(p, i)) continue;
      if (!best.length || p.level < best[0].level || p.level === best[0].level && p.w.len < best[0].w.len) best = [p];
      else if (p.level === best[0].level && p.w.len === best[0].w.len) best.push(p);
    }
    if (!best.length) continue;
    if (best.length > 1) { D.mrAmb[i] = best.map(function (p) { return p.r.id; }); MR_AMB++; continue; }
    D.gear[i] = gearOf(best[0].r);
    D.mrGear[i] = { rule: best[0].r.id, gear: D.gear[i] };
    MR_COUNT[best[0].r.id] = (MR_COUNT[best[0].r.id] || 0) + 1;
  }
}
function mrInferred(i) { return !!(D.mrGear && D.mrGear[i]); }
function mrTag(i) { return D && mrInferred(i) ? '<span class="guess inf">Inferred</span>' : ''; }

// Places: hidden places leave their stays out of the map's pins and heatmap and the places in
// Insights (trips to and from them still count); home from MyRules replaces the app's guess.
function mrApplyPlaces() {
  var nv = D.vs.length;
  D.vhide = new Uint8Array(nv);
  mrActive('places').forEach(function (r) { MR_COUNT[r.id] = 0; });
  if (!MR || !MR.on) return;
  for (var v = 0; v < nv; v++) {
    var r = mrPlaceAt(D.vll[2 * v], D.vll[2 * v + 1]);
    if (!r) continue;
    MR_COUNT[r.id]++;
    if (r.hide) D.vhide[v] = 1;
  }
}
// The home rule that counts: the one that runs latest (open-ended wins).
function mrHomeRule() {
  var best = null, bt = -Infinity;
  mrActive('places').forEach(function (r) {
    if (r.role !== 'home' || !Array.isArray(r.at)) return;
    var t = r.when && r.when.to ? mrDayNum(r.when.to) : Infinity;
    if (t >= bt) { bt = t; best = r; }
  });
  return best;
}
// The place D.places has for the home rule, for findHome.
function mrHomePlace() {
  var r = mrHomeRule();
  if (!r) return null;
  var best = -1, bd = Math.max(+r.radius_m || 100, 300) / 1000;
  D.places.forEach(function (q, k) { if (q.ap) return; var d = km([q.lat, q.lng], r.at); if (d <= bd) { bd = d; best = k; } });
  return best;
}
// Name for a place from a place rule: Home for a home, else the rule's name.
function mrPlaceName(q) {
  if (q.ap) return '';
  var r = mrPlaceAt(q.lat, q.lng);
  if (!r) return '';
  // A hidden place shows as the town it is in, never by its name or address.
  if (r.hide) { var c = nearestCity(q.lat, q.lng); return c ? (c.d > 8 ? 'Near ' : '') + c.name : ccName(countryAt(q.lat, q.lng)); }
  return r.role === 'home' ? 'Home' : r.name || r.role || '';
}

// Applies the rules again after a change, keeping the filters (gear chips are rebuilt, all on).
function mrReapply() {
  if (!D) { renderImports(); return; }
  buildGear();
  M.gear = GEAR; M.gearMode = GEAR_MODE;
  D.places = null; D.home = undefined; D.spotN = null; D.homeSpot = undefined; D.skey = null;
  mrApplyPlaces();
  M.anyGuess = mrAnyGuess();
  F.gear = new Set(gearIds());
  buildFilterUI();
  apply();
  renderSettings();
  if (openId === 'mrSheet') mrRenderRules();
}
function mrAnyGuess() {
  for (var i = 0; i < D.day.length; i++) if (D.est[i] & 4 || mrInferred(i)) return true;
  return false;
}

// ---------- reading, saving and exporting ----------
function mrSave() {
  if (DEMO) return Promise.resolve();
  if (!MR) return withStore('btdt', 'readwrite', function (s) { return s.delete('myrules'); }).catch(function () {});
  return withStore('btdt', 'readwrite', function (s) { return s.put({ doc: MR.doc, name: MR.name, on: MR.on, changes: MR.changes, exported: MR.exported }, 'myrules'); }).catch(function () {});
}
function mrLoad() {
  return withStore('btdt', 'readonly', function (s) { return s.get('myrules'); }).then(function (x) {
    if (x && x.doc) MR = { doc: x.doc, name: x.name || 'my.myrules.json', on: x.on !== false, changes: x.changes || [], exported: x.exported || 0 };
  }).catch(function () {});
}
// Something changed in the app: kept with a short description, until the next export.
function mrChange(text) {
  MR.changes.push({ t: Date.now(), text: text });
  MR.doc.about = Object.assign({}, MR.doc.about, { updated: new Date().toISOString(), generator: 'BT•DT' });
  mrSave();
  mrReapply();
}
function mrEnsure() {
  if (!MR) MR = { doc: { $schema: 'https://bluehair-co.github.io/btdt/schema/myrules-0.1.json', myrules: '0.1', about: { generator: 'BT•DT' } }, name: 'my.myrules.json', on: true, changes: [], exported: 0 };
  return MR;
}
function mrExport() {
  if (!MR) return;
  saveFile(MR.name.replace(/(\.myrules)?\.json$/i, '') + '.myrules.json', [JSON.stringify(MR.doc, null, 2) + '\n'], 'application/json');
  MR.changes = []; MR.exported = Date.now();
  mrSave(); renderImports();
  if (openId === 'mrSheet') mrRenderRules();
}
// Whether a file is a MyRules file: by its name, or a small .json whose start says "myrules".
function mrIsFile(f) {
  if (/\.myrules\.json$/i.test(f.name)) return Promise.resolve(true);
  if (!/\.json$/i.test(f.name) || f.size > 5e6) return Promise.resolve(false);
  return f.slice(0, 600).text().then(function (t) { return /^\s*\{[\s\S]*"myrules"\s*:/.test(t) && !/semanticSegments|timelineObjects|locations/.test(t); }).catch(function () { return false; });
}
function mrParse(text) {
  var doc = JSON.parse(text);
  if (!doc || typeof doc !== 'object' || typeof doc.myrules !== 'string') throw new Error('this isn\'t a MyRules file');
  if (doc.myrules.split('.')[0] !== '0') throw new Error('it is MyRules version ' + doc.myrules + ', which this version of BT•DT can\'t read yet');
  MR_SECTIONS.forEach(function (s) { if (doc[s] != null && !Array.isArray(doc[s])) throw new Error('"' + s + '" should be a list'); });
  return doc;
}
// Loads MyRules files picked with the location files. With rules already here, asks whether to
// merge (same id replaced) or replace; replacing unsaved changes first offers to download them.
function mrImport(files) {
  return Promise.all(files.map(function (f) { return f.text().then(function (t) { return { name: f.name, doc: mrParse(t) }; }); })).then(function (got) {
    var doc = got[0].doc;
    got.slice(1).forEach(function (g) { doc = mrMergeDocs(doc, g.doc); });
    var name = got[got.length - 1].name;
    if (!MR) { mrUse(doc, name, false); return; }
    mrAsk({
      title: 'Add to your MyRules?',
      text: esc(name) + ' has ' + mrCount(doc) + '. You already have ' + mrCount(MR.doc) + '.',
      buttons: [
        ['Merge', 'primary', function () { mrUse(mrMergeDocs(MR.doc, doc), MR.name, true); }],
        ['Replace', '', function () { mrBeforeLosing('Replace', function () { mrUse(doc, name, false); }); }],
        ['Cancel', 'quiet', null]
      ],
      note: 'Merge keeps your rules and adds the new ones; a rule with the same id is replaced.'
    });
  }).catch(function (e) { setStatus('MyRules: ' + (e && e.message || e), true); });
}
function mrUse(doc, name, changed) {
  var had = MR && MR.changes || [];
  MR = { doc: doc, name: name, on: true, changes: changed ? had.concat([{ t: Date.now(), text: 'Merged ' + name }]) : [], exported: changed && MR ? MR.exported : 0 };
  mrSave();
  mrReapply();
  setStatus('MyRules: loaded ' + mrCount(doc) + (D ? '.' : '. Load your location files to apply them.'));
}
function mrMergeDocs(a, b) {
  var out = JSON.parse(JSON.stringify(a));
  MR_SECTIONS.forEach(function (s) {
    (b[s] || []).forEach(function (r) {
      var L = out[s] || (out[s] = []), k = L.findIndex(function (x) { return x && x.id === r.id; });
      if (k >= 0) L[k] = r; else L.push(r);
    });
  });
  return out;
}
function mrCount(doc) {
  var n = 0;
  MR_SECTIONS.forEach(function (s) { n += (doc[s] || []).length; });
  return n + ' rule' + (n === 1 ? '' : 's');
}

// ---------- dialogs ----------
// One small dialog for the questions MyRules asks: a title, text, a few buttons.
function mrAsk(o) {
  var d = $('mrDlg');
  $('mrDlgTitle').textContent = o.title;
  $('mrDlgText').innerHTML = o.text;
  $('mrDlgExtra').innerHTML = o.extra || '';
  $('mrDlgNote').textContent = o.note || '';
  var bt = $('mrDlgBtns');
  bt.textContent = '';
  o.buttons.forEach(function (b) {
    var el = document.createElement('button');
    el.type = 'button'; el.className = 'btn' + (b[1] ? ' ' + b[1] : ''); el.innerHTML = b[0];
    el.addEventListener('click', function () { if (b[3] !== 'stay') d.close(); if (b[2]) b[2](el); });
    bt.appendChild(el);
  });
  if (!d.open) d.showModal();
  if (o.after) o.after(d);
}
// Before something that drops the rules here (removing everything, replacing them with another
// file): when there are changes made in the app that weren't exported, offer to download them first.
// what is the action ('Remove' or 'Replace'), go does it after the usual confirmation.
function mrBeforeLosing(what, go) {
  var n = MR && MR.changes.length || 0;
  if (!n) { go(); return; }
  var many = n + ' change' + (n === 1 ? '' : 's');
  mrAsk({
    title: 'Save your MyRules first?',
    text: 'Your MyRules have <b>' + many + '</b> made in the app that are only on this device. ' + (what === 'Remove' ? 'Removing your data deletes them too.' : 'Replacing your rules deletes them.'),
    extra: '<button type="button" class="btn quiet" id="mrSeeChanges" aria-expanded="false">See the ' + many + '</button><ul class="mr-changes" id="mrChangeList" hidden>' +
      MR.changes.slice().reverse().map(function (c) { return '<li>' + esc(c.text) + ' <span class="fine">' + niceDate(Math.floor((c.t - new Date(c.t).getTimezoneOffset() * 60000) / 864e5)) + '</span></li>'; }).join('') + '</ul>',
    buttons: [
      [icon('upload') + 'Download MyRules', 'primary', function () { mrExport(); mrConfirm(what, 0, go); }],
      [what === 'Remove' ? 'Remove without saving' : 'Replace without saving', 'danger', function () { mrConfirm(what, n, go); }],
      ['Cancel', 'quiet', null]
    ],
    note: 'After the download starts you\'ll be asked to confirm.',
    after: function () {
      $('mrSeeChanges').addEventListener('click', function () {
        var l = $('mrChangeList'); l.hidden = !l.hidden; this.setAttribute('aria-expanded', l.hidden ? 'false' : 'true');
        this.textContent = (l.hidden ? 'See the ' : 'Hide the ') + many;
      });
    }
  });
}
function mrConfirm(what, lost, go) {
  // Opened after the first dialog closes.
  setTimeout(function () {
    var r = MR ? mrCount(MR.doc) : '';
    mrAsk({
      title: what === 'Remove' ? 'Remove your data from this device?' : 'Replace your MyRules?',
      text: what === 'Remove' ? 'Your trips, stays' + (MR ? ' and MyRules (' + r + ')' : '') + ' will be deleted from this browser. Your original files are not affected.' : 'Your ' + r + ' will be replaced by the new file.',
      buttons: [[(what === 'Remove' ? 'Remove' : 'Replace') + (lost ? ', and lose ' + lost + ' change' + (lost === 1 ? '' : 's') : ''), 'danger', go], ['Cancel', 'quiet', null]],
      note: lost ? '' : MR && MR.exported ? 'Your exported MyRules file has all of your rules.' : ''
    });
  }, 0);
}

// ---------- Imported data: the MyRules card ----------
function renderMyRules() {
  var el = $('mrCard');
  if (!el) return;
  if (!MR) {
    el.innerHTML = '<p class="fine">Add what only you know, like which bike you rode when or where home was. BT•DT fills in what your files leave out and marks it <span class="guess inf">Inferred</span>. Load a <b>.myrules.json</b> file with your location files, or set a ride\'s gear in its trip details to start.</p>';
    return;
  }
  var nGear = 0, n = MR.changes.length;
  for (var k in MR_COUNT) { var r = mrById(k); if (r && !Array.isArray(r.at)) nGear += MR_COUNT[k]; }
  el.innerHTML = '<div class="mr-card"><div class="mr-card-head"><span class="mr-ic">' + icon('flag') + '</span><span class="file-txt"><b>' + esc(MR.name) + '</b><small>' + mrCount(MR.doc) + '</small></span>' +
    '<input type="checkbox" class="switch" id="mrOn" aria-label="Apply MyRules"' + (MR.on ? ' checked' : '') + '></div>' +
    '<p class="fine" style="margin:8px 0">' + (!MR.on ? 'Switched off: everything shows as your files have it.' : D ? 'Gear filled in on ' + tripsText(nGear) + '.' + (MR_AMB ? ' ' + tripsText(MR_AMB) + ' fit two gear periods equally, so got none.' : '') + ' Recorded data is never overwritten.' : 'Applied once you load your location files.') + '</p>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><button type="button" class="btn" id="mrOpen">Open rules</button>' +
    '<button type="button" class="btn mr-export" id="mrExportBtn">' + icon('upload') + 'Export' + (n ? '<i class="mr-dot"></i>' : '') + '</button>' +
    '<span class="fine mr-unsaved">' + (n ? n + ' change' + (n === 1 ? '' : 's') + ' not exported' : !MR.exported && !DEMO ? 'Saved in this browser only. Export to keep a copy.' : '') + '</span></div>' +
    '<p class="fine" style="margin-top:8px">The exported file includes your places, such as home.</p></div>';
  $('mrOn').addEventListener('change', function () { MR.on = this.checked; mrSave(); mrReapply(); });
  $('mrOpen').addEventListener('click', function () { mrRenderRules(); openSheet('mrSheet'); });
  $('mrExportBtn').addEventListener('click', mrExport);
}

// ---------- the rules sheet ----------
function mrWhenText(w) {
  if (!w) return 'Always';
  var f = mrDayNum(w.from), t = mrDayNum(w.to), s;
  s = f != null && t != null ? niceDate(f) + ' – ' + niceDate(t) : f != null ? 'Since ' + niceDate(f) : t != null ? 'Until ' + niceDate(t) : 'Always';
  if (Array.isArray(w.days) && w.days.length && w.days.length < 7) s += ' · ' + w.days.map(function (d) { var k = MR_DOW.indexOf(String(d).slice(0, 3)); return k >= 0 ? DOW[k] : d; }).join(', ');
  if (Array.isArray(w.time)) s += ' · ' + w.time.join('–');
  return s;
}
function mrRuleRow(sec, r, title, sub, ic, color, count) {
  var on = r.enabled !== false, ex = Array.isArray(r.except) && r.except.length;
  return '<div class="mr-rule' + (on ? '' : ' off') + '"><span class="mode-badge sm" style="background:' + color + '">' + icon(ic) + '</span><span class="file-txt"><b>' + esc(title) + '</b><small>' + sub +
    (ex ? ' · ' + ex + ' exception' + (ex === 1 ? '' : 's') : '') + (r.note ? '<br>' + esc(r.note) : '') + '</small></span>' +
    (count != null ? '<span class="num fine">' + fmt(count) + '</span>' : '') +
    '<input type="checkbox" class="switch" data-mr-on="' + esc(r.id) + '" aria-label="Apply ' + esc(title) + '"' + (on ? ' checked' : '') + '>' +
    '<button type="button" class="icon-btn" data-mr-del="' + esc(sec) + ':' + esc(r.id) + '" aria-label="Delete ' + esc(title) + '">' + icon('close') + '</button></div>';
}
function mrRenderRules() {
  var h = '';
  if (!MR) { $('mrBody').innerHTML = '<p class="fine">No rules yet.</p>'; return; }
  if (!MR.on) h += '<p class="fine mr-warn">MyRules are switched off in Imported data.</p>';
  if (MR_AMB) h += '<p class="fine mr-warn">' + tripsText(MR_AMB) + ' fit two gear periods equally well, so they got no gear. Narrow one of the periods (a shorter period, or a distance limit) to pick one.</p>';
  var gear = mrList('gear'), places = mrList('places'), cor = mrList('corrections'), rout = mrList('routines');
  if (gear.length) h += '<div class="sec"><h3>Gear</h3>' + gear.map(function (r) {
    var m = r.match || {}, bits = [mrWhenText(r.when), LABEL[r.mode] || r.mode];
    if (m.max_km != null) bits.push('under ' + dist(m.max_km));
    if (m.min_km != null) bits.push('over ' + dist(m.min_km));
    if (r.strava_name) bits.push('same as “' + esc(r.strava_name) + '”');
    var ic = r.kind === 'strida' ? 'strida' : r.kind === 'halfbike' ? 'halfbike' : r.kind === 'cargo' ? 'cargobike' : r.kind === 'ebike' ? 'ebike' : r.mode;
    return mrRuleRow('gear', r, r.name || r.id, bits.map(function (b) { return b; }).join(' · '), ic, modeColor(r.mode || 'CYCLING'), MR_COUNT[r.id] || 0);
  }).join('') + '</div>';
  if (places.length) h += '<div class="sec"><h3>Places</h3>' + places.map(function (r) {
    var sub = [r.role ? r.role.charAt(0).toUpperCase() + r.role.slice(1) : '', r.when ? mrWhenText(r.when) : '', r.hide ? 'Hidden from pins, heatmap and places' : '', (MR_COUNT[r.id] || 0) + ' stays'].filter(Boolean).join(' · ');
    return mrRuleRow('places', r, r.name || r.id, sub, r.role === 'home' ? 'home' : r.hide ? 'shield' : 'pin', r.role === 'home' ? '#008300' : '#9aa49d', null);
  }).join('') + '</div>';
  if (cor.length) h += '<div class="sec"><h3>Corrections</h3>' + cor.map(function (c) {
    var t = c.trip || {}, g = c.then && c.then.gear, gr = g && String(g).charAt(0) === '@' ? mrById(g) : null;
    var when = t.start ? t.start.slice(0, 16).replace('T', ', ') : t.day || (t.span ? t.span.join(' – ') : '');
    var sub = g ? 'Gear: ' + esc(gr ? gr.name || gr.id : g) : 'Not applied in this version of BT•DT';
    return mrRuleRow('corrections', c, when || c.id, sub, g ? 'CYCLING' : 'info', g ? modeColor('CYCLING') : '#9aa49d', g ? MR_COUNT[c.id] || 0 : null);
  }).join('') + '</div>';
  if (rout.length) h += '<div class="sec"><h3>Routines</h3><p class="fine" style="margin-bottom:6px">Kept in your file and exported again, but not applied in this version of BT•DT yet.</p>' +
    rout.map(function (r) { return mrRuleRow('routines', r, r.name || r.id, mrWhenText(r.when), r.then && r.then.mode || 'OTHER', '#9aa49d', null); }).join('') + '</div>';
  if (!h) h = '<p class="fine">No rules yet. Set a ride\'s gear in its trip details to make one.</p>';
  $('mrBody').innerHTML = h;
}
$('mrBody').addEventListener('change', function (ev) {
  var id = ev.target.dataset.mrOn;
  if (!id) return;
  var r = mrById(id);
  if (!r) return;
  if (ev.target.checked) delete r.enabled; else r.enabled = false;
  mrChange((ev.target.checked ? 'Switched on: ' : 'Switched off: ') + (r.name || r.id));
});
$('mrBody').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-mr-del]');
  if (!b) return;
  var p = b.dataset.mrDel.split(':'), sec = p[0], id = p.slice(1).join(':'), r = mrById(id);
  mrAsk({
    title: 'Delete this rule?', text: esc(r && (r.name || r.id) || id) + ' will be removed from your MyRules.',
    buttons: [['Delete', 'danger', function () {
      MR.doc[sec] = mrList(sec).filter(function (x) { return x.id !== id; });
      mrChange('Deleted: ' + (r && (r.name || r.id) || id));
    }], ['Cancel', 'quiet', null]]
  });
});
$('mrBack').addEventListener('click', function () { openSheet('importsSheet'); });
$('mrSheetExport').addEventListener('click', mrExport);

// ---------- trip details ----------
// What MyRules did to a trip, with Not this trip; and Set gear for rides, runs and walks.
var MR_GEAR_MODES = { CYCLING: 1, RUNNING: 1, WALKING: 1 };
function mrTripBlock(i) {
  if (!D || isDup(i)) return '';
  var h = '', g = D.mrGear && D.mrGear[i], amb = D.mrAmb && D.mrAmb[i];
  if (g) {
    var r = mrById(g.rule), isCor = r && r.trip;
    h += '<div class="mr-chg"><b>Gear:</b> ' + esc(GEAR[g.gear].name) + '<div class="fine">' + (isCor ? 'Set for this trip' : 'From the rule <i>' + esc(r ? r.name || r.id : g.rule) + '</i>' + (r && r.when ? ', ' + esc(mrWhenText(r.when)) : '')) + '</div></div>';
  }
  if (amb) h += '<div class="mr-chg"><b>Gear:</b> none<div class="fine">' + amb.map(function (id) { var r = mrById(id); return '<i>' + esc(r ? r.name || r.id : id) + '</i>'; }).join(' and ') + ' both fit this trip equally well. Set its gear, or narrow one of them.</div></div>';
  var btns = '';
  if (g) btns += '<button type="button" class="btn" data-mr-act="not" data-t="' + i + '">Not this trip</button>';
  if (MR_GEAR_MODES[MODES[D.mode[i]]] && !(D.gear[i] && !g)) btns += '<button type="button" class="btn" data-mr-act="gear" data-t="' + i + '">' + icon('gear') + (D.gear[i] ? 'Change gear' : 'Set gear') + '</button>';
  if (!h && !btns) return '';
  return '<div class="mr-trip">' + (h ? '<h4 class="place-h">From MyRules</h4>' + h : '') + (btns ? '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">' + btns + '</div>' : '') + '</div>';
}
$('tripBody').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-mr-act]');
  if (!b) return;
  var i = +b.dataset.t;
  if (b.dataset.mrAct === 'not') {
    var g = D.mrGear[i], r = g && mrById(g.rule);
    if (!r) return;
    if (r.trip) { MR.doc.corrections = mrList('corrections').filter(function (x) { return x !== r; }); mrChange('Removed the gear set on ' + niceDate(D.day[i]) + ', ' + clock(D.start[i], D.off[i])); }
    else { (r.except || (r.except = [])).push({ start: mrIsoLocal(i), mode: MODES[D.mode[i]] }); mrChange('Not this trip: ' + (r.name || r.id) + ' on ' + niceDate(D.day[i]) + ', ' + clock(D.start[i], D.off[i])); }
    openTrip(i);
  } else if (b.dataset.mrAct === 'gear') mrGearDialog(i);
});

// Set gear: on this trip only (a correction), or on every trip of its type without gear in a period
// (a gear period), with the dates from the first and last trip on that gear and a live count.
function mrGearDialog(i) {
  var mode = MODES[D.mode[i]], opts = gearOrder().filter(function (g) { return GEAR[g].mode === mode || GEAR[g].modes && GEAR[g].modes[mode]; });
  function span(g) {
    var a = Infinity, b = -Infinity;
    for (var j = 0; j < D.day.length; j++) if (D.gear[j] === g) { a = Math.min(a, D.day[j]); b = Math.max(b, D.day[j]); }
    return isFinite(a) ? [a, b] : [D.day[i], D.day[i]];
  }
  var kinds = mode === 'CYCLING' ? ['bike', 'strida', 'halfbike', 'cargo', 'ebike', 'other'] : ['shoe', 'other'];
  mrAsk({
    title: 'Set gear',
    text: esc(tripRoute(i)) + ' · ' + niceDate(D.day[i]) + ', ' + clock(D.start[i], D.off[i]) + ' · ' + dist(D.km[i]),
    extra: '<div class="mr-form"><label class="field"><span>Gear</span><select id="mrG">' + opts.map(function (g) { return '<option value="' + g + '">' + esc(GEAR[g].name) + '</option>'; }).join('') + '<option value="new">New gear…</option></select></label>' +
      '<div id="mrNew" hidden class="grid2"><label class="field"><span>Name</span><input type="text" id="mrName" placeholder="e.g. Strida EVO"></label><label class="field"><span>Kind</span><select id="mrKind">' + kinds.map(function (k) { return '<option value="' + k + '">' + MR_KINDS[k] + '</option>'; }).join('') + '</select></label></div>' +
      '<label class="mr-opt"><input type="radio" name="mrScope" value="one"><span><b>Just this trip</b><small class="fine">Saved as a correction.</small></span></label>' +
      '<label class="mr-opt"><input type="radio" name="mrScope" value="period" checked><span><b>Every ' + esc((LABEL[mode] || mode).toLowerCase()) + ' trip without gear in a period</b>' +
      '<span class="mr-dates"><input type="date" id="mrFrom" aria-label="From"> to <input type="date" id="mrTo" aria-label="To (empty: until now)"></span>' +
      '<span class="mr-dates">Only trips under <input type="number" id="mrMax" min="0" step="1" style="width:5em" aria-label="Maximum distance"> km (optional)</span>' +
      '<small class="fine" id="mrCountTxt"></small></span></label></div>',
    buttons: [['Save rule', 'primary', function () { mrSaveGear(i); }], ['Cancel', 'quiet', null]],
    note: 'Gear recorded by Strava or another activity file is never replaced by a period.',
    after: function () {
      var sel = $('mrG');
      function prefill() {
        var nw = sel.value === 'new';
        $('mrNew').hidden = !nw;
        var s = nw ? [D.day[i], D.day[i]] : span(+sel.value);
        $('mrFrom').value = isoDay(s[0]); $('mrTo').value = nw ? '' : isoDay(s[1]);
        count();
      }
      function count() {
        var f = mrDayNum($('mrFrom').value), t = mrDayNum($('mrTo').value), mx = parseFloat($('mrMax').value), c = 0;
        for (var j = 0; j < D.day.length; j++) if (D.mode[j] === D.mode[i] && (!D.gear[j] || D.mrGear[j] && !(mrById(D.mrGear[j].rule) || {}).trip) && !isDup(j) && (f == null || D.day[j] >= f) && (t == null || D.day[j] <= t) && !(mx > 0 && D.km[j] > mx)) c++;
        $('mrCountTxt').innerHTML = '<b class="num">' + fmt(c) + '</b> ' + esc((LABEL[mode] || mode).toLowerCase()) + ' ' + (c === 1 ? 'trip' : 'trips') + ' in that period have no recorded gear. They get this one, marked <span class="guess inf">Inferred</span>, unless a narrower rule covers them.';
      }
      sel.addEventListener('change', prefill);
      ['mrFrom', 'mrTo', 'mrMax'].forEach(function (id) { $(id).addEventListener('input', count); });
      prefill();
    }
  });
}
function mrSaveGear(i) {
  var sel = $('mrG').value, mode = MODES[D.mode[i]], one = document.querySelector('input[name="mrScope"]:checked').value === 'one';
  var name = sel === 'new' ? $('mrName').value.trim() : GEAR[+sel].name, kind = sel === 'new' ? $('mrKind').value : GEAR[+sel].kind;
  if (!name) { toast('Give the gear a name'); return; }
  mrEnsure();
  // A gear period of the same name already in MyRules is pointed at; Strava's gear by its name.
  var existing = mrList('gear').filter(function (r) { return (r.name === name || r.strava_name === name) && r.mode === mode; })[0];
  var recorded = sel !== 'new' && !existing && !GEAR[+sel].rule;
  if (one) {
    (MR.doc.corrections || (MR.doc.corrections = [])).push({ id: mrNewId(name + '-' + isoDay(D.day[i])), trip: { start: mrIsoLocal(i), mode: mode }, then: { gear: existing ? '@' + existing.id : name } });
    mrChange('Gear ' + name + ' set on ' + niceDate(D.day[i]) + ', ' + clock(D.start[i], D.off[i]));
  } else {
    var w = {}, f = $('mrFrom').value, t = $('mrTo').value, mx = parseFloat($('mrMax').value);
    if (f) w.from = f;
    if (t) w.to = t;
    var r = { id: mrNewId(name), name: name, kind: kind === 'shoe' || MR_KINDS[kind] ? kind : 'other', mode: mode };
    if (f || t) r.when = w;
    if (mx > 0) r.match = { max_km: mx };
    if (recorded) r.strava_name = name;
    (MR.doc.gear || (MR.doc.gear = [])).push(r);
    mrChange(name + ' period added (' + mrWhenText(r.when) + ')');
  }
  openTrip(i);
}
