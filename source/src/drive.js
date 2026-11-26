// ---------- My Edits in Google Drive ----------
// Keep your rules › In Google Drive (Menu › My Edits) keeps the My Edits document in one file, BTDT-Edits.json (btdt.myrules.json before),
// in the user's own Drive, so a laptop and a phone use the same rules. Off until turned on, and nothing
// is fetched before that. Only the rules file goes to Drive, never location data.
// - Sign-in: Google Identity Services, token flow in the browser (no server, no client secret), only
//   the drive.file scope: BT•DT sees just the files it made itself. The token lasts an hour and is kept
//   in this tab (sessionStorage); after that a tap on Sync asks again (browsers only open Google's
//   window after a tap).
// - Sync (driveSync): read the Drive file, merge it with this device's rules (driveMerge), write back
//   what changed, apply what came in. Each change here (mrSave) syncs again a moment later.
// - Merging is rule by rule (every rule has an id), against the copy both had at the last sync (the
//   base): a rule changed or added on one side wins; deleted on one side and left alone on the other is
//   deleted; changed on both sides, the document saved last wins (counted, and said in a toast).
var DRIVE_CLIENT = '598451119921-pnn3e50l7g0vqburnssvjnkjl9hruuc8.apps.googleusercontent.com';
var DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
var DRIVE_NAME = 'BTDT-Edits.json', DRIVE_OLD_NAME = 'btdt.myrules.json';
var DRIVE_API = 'https://www.googleapis.com';
var DRIVE = { on: false, file: null, version: null, at: 0, err: '', state: 'off', token: null, exp: 0, gis: null, client: null, pushT: 0, running: null, again: false, applying: false };
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('btdt.drive') || 'null');
    if (s) { DRIVE.on = !!s.on; DRIVE.file = s.file || null; DRIVE.version = s.version || null; DRIVE.at = s.at || 0; }
    var t = JSON.parse(sessionStorage.getItem('btdt.driveTok') || 'null');
    if (t && t.exp > Date.now()) { DRIVE.token = t.token; DRIVE.exp = t.exp; }
  } catch (e) { /* storage unavailable */ }
  DRIVE.state = DRIVE.on ? (DRIVE.token ? 'ok' : 'signin') : 'off';
})();
function driveKeep() {
  try {
    localStorage.setItem('btdt.drive', JSON.stringify({ on: DRIVE.on, file: DRIVE.file, version: DRIVE.version, at: DRIVE.at }));
    if (DRIVE.token) sessionStorage.setItem('btdt.driveTok', JSON.stringify({ token: DRIVE.token, exp: DRIVE.exp })); else sessionStorage.removeItem('btdt.driveTok');
  } catch (e) { /* storage unavailable */ }
}
// The rules as both sides had them at the last sync.
function driveBase() { try { return JSON.parse(localStorage.getItem('btdt.driveBase') || 'null'); } catch (e) { return null; } }
function driveSetBase(doc) { try { if (doc) localStorage.setItem('btdt.driveBase', JSON.stringify(doc)); else localStorage.removeItem('btdt.driveBase'); } catch (e) { /* too big or unavailable */ } }

// ---------- signing in ----------
function driveGis() {
  if (DRIVE.gis) return DRIVE.gis;
  DRIVE.gis = new Promise(function (resolve, reject) {
    if (window.google && google.accounts && google.accounts.oauth2) { resolve(); return; }
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = function () { resolve(); };
    s.onerror = function () { DRIVE.gis = null; reject(new Error('Google sign-in could not load. Are you online?')); };
    document.head.appendChild(s);
  });
  return DRIVE.gis;
}
// A token, asking Google for one when needed (ask: from a tap; else only one already held).
function driveToken(ask) {
  if (DRIVE.token && DRIVE.exp - 60000 > Date.now()) return Promise.resolve(DRIVE.token);
  if (!ask) return Promise.reject(Object.assign(new Error('Sign in to sync'), { signin: true }));
  return driveGis().then(function () {
    return new Promise(function (resolve, reject) {
      var c = google.accounts.oauth2.initTokenClient({
        client_id: DRIVE_CLIENT, scope: DRIVE_SCOPE,
        callback: function (r) {
          if (!r || r.error || !r.access_token) { reject(new Error(r && r.error === 'access_denied' ? 'Google Drive access was not allowed.' : 'Google sign-in did not finish.')); return; }
          if (google.accounts.oauth2.hasGrantedAllScopes && !google.accounts.oauth2.hasGrantedAllScopes(r, DRIVE_SCOPE)) { reject(new Error('Tick the box that lets BT•DT see the files it makes in your Drive.')); return; }
          DRIVE.token = r.access_token; DRIVE.exp = Date.now() + (+r.expires_in || 3600) * 1000; driveKeep();
          resolve(DRIVE.token);
        },
        error_callback: function (e) {
          reject(Object.assign(new Error(e && e.type === 'popup_failed_to_open' ? 'Your browser blocked Google’s sign-in window. Allow pop-ups for this site and try again.' : 'Google sign-in was closed.'), { signin: true }));
        }
      });
      c.requestAccessToken({ prompt: '' });
    });
  });
}
// A call to the Drive API with the token. A 401 means the token ran out: sign in again.
function driveFetch(path, opt) {
  opt = opt || {};
  opt.headers = Object.assign({ Authorization: 'Bearer ' + DRIVE.token }, opt.headers || {});
  return fetch(DRIVE_API + path, opt).then(function (res) {
    if (res.status === 401) { DRIVE.token = null; DRIVE.exp = 0; driveKeep(); throw Object.assign(new Error('Sign in to sync'), { signin: true }); }
    if (res.status === 404) throw Object.assign(new Error('The rules file is no longer in your Drive.'), { gone: true });
    if (!res.ok) throw new Error('Google Drive answered ' + res.status + '.');
    return res;
  });
}
function driveQuery(name) {
  var q = encodeURIComponent("name = '" + name + "' and trashed = false");
  return driveFetch('/drive/v3/files?q=' + q + '&spaces=drive&orderBy=modifiedTime%20desc&fields=files(id,version)').then(function (r) { return r.json(); }).then(function (j) { return j.files && j.files[0] || null; });
}
// The rules file: BTDT-Edits.json, or the btdt.myrules.json of before. An old one is renamed to the new
// name (it keeps its id, so the next save goes there too).
function driveFind() {
  return driveQuery(DRIVE_NAME).then(function (f) {
    if (f) return f;
    return driveQuery(DRIVE_OLD_NAME).then(function (o) {
      if (!o) return null;
      return driveFetch('/drive/v3/files/' + o.id + '?fields=id,version', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: DRIVE_NAME }) })
        .then(function (r) { return r.json(); }).then(function (j) { return { id: j.id || o.id, version: j.version || o.version }; }, function () { return o; });
    });
  });
}
function driveMeta(id) { return driveFetch('/drive/v3/files/' + id + '?fields=id,version,trashed').then(function (r) { return r.json(); }); }
function driveRead(id) { return driveFetch('/drive/v3/files/' + id + '?alt=media').then(function (r) { return r.text(); }).then(function (t) { return t.trim() ? JSON.parse(t) : {}; }); }
function driveCreate(doc) {
  var b = 'btdt' + Math.random().toString(36).slice(2);
  var body = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name: DRIVE_NAME, mimeType: 'application/json' }) +
    '\r\n--' + b + '\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify(doc, null, 2) + '\n\r\n--' + b + '--';
  return driveFetch('/upload/drive/v3/files?uploadType=multipart&fields=id,version', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: body }).then(function (r) { return r.json(); });
}
function driveWrite(id, doc) {
  return driveFetch('/upload/drive/v3/files/' + id + '?uploadType=media&fields=id,version', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc, null, 2) + '\n' }).then(function (r) { return r.json(); });
}

// ---------- merging ----------
// JSON with its keys in order, so the same rule written on two devices compares equal.
function driveStable(x) {
  if (Array.isArray(x)) return '[' + x.map(driveStable).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(function (k) { return JSON.stringify(k) + ':' + driveStable(x[k]); }).join(',') + '}';
  return JSON.stringify(x === undefined ? null : x);
}
function driveSame(a, b) { return driveStable(a) === driveStable(b); }
// local, remote, base: My Edits documents (base may be null: never synced, both count as new).
// { doc, conflicts }. A list of rules with ids is merged rule by rule; anything else as a whole.
function driveMerge(local, remote, base) {
  local = local || {}; remote = remote || {}; base = base || {};
  var conflicts = 0, out = {};
  var newer = String(local.about && local.about.updated || '') >= String(remote.about && remote.about.updated || '') ? 'local' : 'remote';
  function pick(l, r, b, hasB) {
    if (driveSame(l, r)) return l;
    if (hasB && driveSame(l, b)) return r;
    if (hasB && driveSame(r, b)) return l;
    conflicts++;
    return newer === 'local' ? l : r;
  }
  function isList(v) { return Array.isArray(v) && v.every(function (x) { return x && typeof x === 'object' && typeof x.id === 'string'; }); }
  var keys = {};
  Object.keys(remote).concat(Object.keys(local)).forEach(function (k) { keys[k] = 1; });
  Object.keys(keys).forEach(function (k) {
    var L = local[k], R = remote[k], B = base[k];
    if (k === 'about') { out[k] = newer === 'local' ? L || R : R || L; return; }
    if ((L === undefined || isList(L)) && (R === undefined || isList(R)) && (B === undefined || isList(B))) {
      var lm = {}, rm = {}, bm = {}, ids = [], seen = {}, list = [];
      (L || []).forEach(function (x) { lm[x.id] = x; });
      (R || []).forEach(function (x) { rm[x.id] = x; });
      (B || []).forEach(function (x) { bm[x.id] = x; });
      // Drive's order first, then rules only this device has, in its order.
      (R || []).concat(L || []).forEach(function (x) { if (!seen[x.id]) { seen[x.id] = 1; ids.push(x.id); } });
      ids.forEach(function (id) {
        var l = lm[id], r = rm[id], b = bm[id], hasB = b !== undefined;
        if (l && r) { list.push(pick(l, r, b, hasB)); return; }
        var one = l || r;
        // On one side only: new there, or deleted on the other. Deleted wins unless it changed since.
        if (hasB && driveSame(one, b)) return;
        if (hasB) conflicts++;
        list.push(one);
      });
      if (list.length || L !== undefined || R !== undefined) out[k] = list;
      return;
    }
    if (L === undefined) { if (!(k in base) || !driveSame(R, B)) out[k] = R; return; }
    if (R === undefined) { if (!(k in base) || !driveSame(L, B)) out[k] = L; return; }
    out[k] = pick(L, R, B, k in base);
  });
  return { doc: out, conflicts: conflicts };
}

// ---------- syncing ----------
// ask: started by a tap (may sign in; shows the pill). One sync at a time; a change made during one
// syncs again after it.
function driveSync(ask) {
  if (!DRIVE.on || DEMO) return Promise.resolve();
  if (DRIVE.running) { DRIVE.again = true; return DRIVE.running; }
  var pill = !!ask;
  if (pill) driveBusy(true);
  DRIVE.state = 'sync'; driveShow();
  var conflicts = 0, changed = false;
  DRIVE.running = driveToken(ask).then(function () {
    if (DRIVE.file) return driveMeta(DRIVE.file).then(function (m) { if (m.trashed) throw Object.assign(new Error('gone'), { gone: true }); return m; }).catch(function (e) { if (e.gone) { DRIVE.file = null; DRIVE.version = null; return driveFind(); } throw e; });
    return driveFind();
  }).then(function (meta) {
    var local = MR ? MR.doc : null, base = driveBase();
    // No file yet: this device's rules start it.
    if (!meta) {
      var start = local || mrEnsure().doc;
      return driveCreate(start).then(function (m) { DRIVE.file = m.id; DRIVE.version = m.version; driveSetBase(start); });
    }
    DRIVE.file = meta.id;
    var same = meta.version != null && String(meta.version) === String(DRIVE.version);
    var read = same && base ? Promise.resolve(base) : driveRead(meta.id);
    return read.then(function (remote) {
      var m = driveMerge(local, remote, base);
      conflicts = m.conflicts;
      var doc = m.doc, up = !driveSame(doc, remote);
      changed = !driveSame(doc, local || {});
      var w = up ? driveWrite(meta.id, doc) : Promise.resolve(meta);
      return w.then(function (m2) {
        DRIVE.version = m2.version != null ? m2.version : meta.version;
        driveSetBase(doc);
        if (changed) driveApply(doc);
      });
    });
  }).then(function () {
    DRIVE.at = Date.now(); DRIVE.err = ''; DRIVE.state = 'ok'; driveKeep();
    if (conflicts) toast(conflicts + ' rule' + (conflicts === 1 ? ' was' : 's were') + ' changed on two devices: the one saved last was kept.');
    else if (pill) toast(changed ? 'My Edits updated from Google Drive.' : 'My Edits are in sync with Google Drive.');
  }, function (e) {
    DRIVE.state = e && e.signin ? 'signin' : 'err'; DRIVE.err = e && e.message || 'Could not sync.';
    driveKeep();
    if (pill) toast(DRIVE.err);
  }).then(function () {
    if (pill) driveBusy(false);
    DRIVE.running = null; driveShow();
    if (DRIVE.again && DRIVE.state === 'ok') { DRIVE.again = false; return driveSync(false); }
    DRIVE.again = false;
  });
  return DRIVE.running;
}
// Rules that came from Drive: saved here and applied, without syncing back.
function driveApply(doc) {
  DRIVE.applying = true;
  try {
    mrEnsure();
    MR.doc = doc;
    MR.changes = [];
    mrSave();
    if (D) mrReapply(); else { renderSettings(); if (openId === 'mrSheet') mrRenderRules(); }
  } finally { DRIVE.applying = false; }
}
// Called by mrSave: a change here goes to Drive a moment later (a burst of saves is one sync).
function driveChanged() {
  if (!DRIVE.on || DRIVE.applying || DEMO) return;
  clearTimeout(DRIVE.pushT);
  DRIVE.pushT = setTimeout(function () { driveSync(false); }, 1500);
}
function driveBusy(on) {
  if (on) { if (!WORKING.n++) WORKING.at = performance.now(); $('workingText').textContent = 'Syncing with Google Drive…'; workingShow(true); }
  else if (WORKING.n && !--WORKING.n) setTimeout(function () { if (!WORKING.n) workingShow(false); }, Math.max(0, WORKING_MIN - (performance.now() - WORKING.at)));
}

// ---------- the switch and its line (in the My Edits card) ----------
function driveRow() {
  if (DEMO) return '';
  var on = DRIVE.on;
  var t = !on ? 'Saved in this browser.'
    : DRIVE.state === 'sync' ? 'Syncing…'
    : DRIVE.state === 'signin' ? 'Sign in again to sync.'
    : DRIVE.state === 'err' ? esc(DRIVE.err)
    : DRIVE.at ? 'Synced at ' + clock(DRIVE.at, null, Date.now() - DRIVE.at > 20 * 3600000) + '.' : 'Connecting…';
  return '<div class="mr-drive"><div class="mr-drive-head"><b>Keep your rules</b>' + infoBtn('driveInfo', 'About where your rules are kept') + '</div>' +
    '<div class="seg full" id="driveWhere" role="group" aria-label="Keep your rules">' +
    '<button type="button" data-w="local" aria-pressed="' + !on + '">On this device</button><button type="button" data-w="drive" aria-pressed="' + on + '">In Google Drive</button></div>' +
    '<p class="fine mr-drive-what">Only your rules: gear, place names, routines and your fixes to trips. Your location history always stays on this device.</p>' +
    infoBox('driveInfo', '<b>On this device</b> keeps your rules in this browser only; use Export to keep a copy or move them. <b>In Google Drive</b> keeps them in one file in your own Google Drive, so your phone and computer use the same rules: choose it on each device and sign in with the same Google account. BT•DT asks only for the files it makes itself, so it can’t see the rest of your Drive. Each change you make is saved there a moment later; rules from your other devices come in when you open the app or tap Sync. If the same rule was changed on two devices, the one saved last is kept. Google’s sign-in lasts an hour; after that, tap Sync. Going back to On this device stops syncing and leaves the file in your Drive.') +
    // On this device, the card above already says where the rules are and offers Export.
    (on ? '<div class="mr-drive-st"><small id="driveTxt">' + t + '</small><button type="button" class="btn" id="driveSyncBtn"' + (DRIVE.state === 'sync' ? ' disabled' : '') + '>Sync</button></div>' : '<small id="driveTxt" hidden>' + t + '</small>') + '</div>';
}
function driveWire() {
  var seg = $('driveWhere');
  if (!seg) return;
  seg.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-w]');
    if (!b || (b.dataset.w === 'drive') === DRIVE.on) return;
    if (b.dataset.w === 'drive') {
      DRIVE.on = true; DRIVE.state = 'sync'; driveKeep(); driveShow();
      driveSync(true).then(function () {
        if (DRIVE.state !== 'ok' && !DRIVE.at) { DRIVE.on = false; DRIVE.state = 'off'; driveKeep(); driveShow(); }
      });
    } else {
      DRIVE.on = false; DRIVE.state = 'off'; DRIVE.file = null; DRIVE.version = null; DRIVE.at = 0; DRIVE.token = null; DRIVE.exp = 0;
      driveSetBase(null); driveKeep(); driveShow(); if ($('driveBar')) $('driveBar').hidden = true;
      toast('Your rules are kept on this device. The file stays in your Google Drive.');
    }
  });
  var sb = $('driveSyncBtn');
  if (sb) sb.addEventListener('click', function () { driveSync(true); });
}
function driveShow() {
  if (DRIVE.on && DRIVE.state === 'signin' && !DEMO)
    promptBar('driveBar', { icon: 'sync', title: 'Sync My Edits with Google Drive', text: 'Only your rules, never your location history.', acts: [['Sync', 'primary', 'sync']], close: 'Not now',
      on: function (a) { if (!a) return; $('driveBar').hidden = true; if (a === 'sync') driveSync(true); } });
  else if ($('driveBar')) $('driveBar').hidden = true;
  if ($('mrCard')) renderMyRules();
}
// When the app opens: sync if a token is still held, else offer the bar with Sync.
function driveStart() {
  if (!DRIVE.on || DEMO) return;
  if (DRIVE.token && DRIVE.exp - 60000 > Date.now()) driveSync(false); else { DRIVE.state = 'signin'; driveShow(); }
}
