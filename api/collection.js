// ACRUX collection API, mounted by server.js: what you do with your music.
//   GET  /api/collection                  { playlists, marks, offline, cached, me, sharing }: everything below, in one go
//                                         (cached: Drive songs whole in the cache, api/cache.js cachedSongs)
//   GET  /api/playlists/played            your playlists, most listened to lately first (the side panel)
//   POST /api/playlists                   make one { title, desc?, photo?, groove?, songs? } (or save a Discover album:
//                                         { title, from, cover, songs })
//   PATCH · DELETE /api/playlists/:id     { title?, desc?, photo?, groove?, searchable? } · delete it
//   POST /api/playlists/:id/duplicate     a copy you can change
//   POST · PUT /api/playlists/:id/songs   add { songs } at the end (ones already there are skipped) · set the whole list
//   PUT  /api/playlists/:id/photo         an image (up to 10 MB) as its cover
//   PUT · DELETE /api/marks/:kind/:id     favorite a song, album, artist or playlist, or pin a playlist (kind "pin");
//                                         the PUT body is what draws it: { title, sub, cover, href, ref? }
//   PUT · DELETE /api/offline             { songs } keep for playing offline · let go (the copies are deleted)
//   GET  /api/offline/:key/audio          a Discover song kept offline
//   GET  /api/save?song=<ref> | ?playlist=<id> | ?album=lib-<id> | ?name=&songs=<refs>   the file, or a ZIP
// Collaborators (people on your Wi-Fi you invite to a playlist):
//   POST · DELETE /api/playlists/:id/invite        its invite link (made once, kept) · a new link (the old one stops working)
//   PATCH · DELETE /api/playlists/:id/people/:gid  { role: 'edit' | 'view' } · take someone off it
//   GET  /api/invites/:token · POST /api/invites/:token/join { name }   what it's for · join (sets the guest cookie)
//   PUT  /api/sharing { on }                        listen on this computer's Wi-Fi address too, for invite links
// Your devices (your own phone, paired with the QR code from Set up ACRUX):
//   POST /api/devices/pair                          a one-time link to this computer's Wi-Fi address, and its QR code
//   POST /api/devices/join { token }                the phone that opened the link becomes a device (sets its cookie)
//   GET  /api/devices · DELETE /api/devices/:id      your devices · forget one
// Songs are refs, as api/playlists.js describes. Changes come from this site only (Origin), and from this computer,
// except that a guest may add, remove and reorder songs in a playlist they can edit. Every change is announced on
// the live events (/api/events, `collection`), so open pages (a guest's too) redraw.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { db } = require('./db');
const { fail, json, sendFile, typeOf, sameSite, loopback } = require('./common');
const tracks = require('./tracks');
const cache = require('./cache');
const local = require('./local');
const playlists = require('./playlists');
const taste = require('./taste');
const qrcode = require('qrcode-generator');

const ROUTES = /^\/api\/(collection|playlists|marks|offline|save|invites|sharing|devices)(\/|$)/;
const ROOT = path.join(__dirname, '..');
const OFFLINE = path.join(tracks.DATA, 'offline');
fs.mkdirSync(OFFLINE, { recursive: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS marks (kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (kind, id));
  CREATE TABLE IF NOT EXISTS offline (key TEXT PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL, file TEXT, bytes INTEGER,
    status TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS guests (token TEXT PRIMARY KEY, gid TEXT NOT NULL UNIQUE, name TEXT NOT NULL, joined INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS invites (token TEXT PRIMARY KEY, playlist TEXT NOT NULL, role TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS members (playlist TEXT NOT NULL, gid TEXT NOT NULL, role TEXT NOT NULL, joined INTEGER NOT NULL,
    PRIMARY KEY (playlist, gid));
`);

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
const announce = () => tracks.emit('collection', {});
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ---------- marks: favorites and pins ----------

const KINDS = ['song', 'album', 'artist', 'playlist', 'pin'];
const putMark = db.prepare('INSERT OR REPLACE INTO marks (kind, id, json, at) VALUES (?, ?, ?, ?)');
const delMark = db.prepare('DELETE FROM marks WHERE kind = ? AND id = ?');
const allMarks = db.prepare('SELECT kind, id, json, at FROM marks ORDER BY at DESC');
function mark(kind, id, body) {
  const item = { title: text(body?.title, 200), sub: text(body?.sub, 200), cover: text(body?.cover, 1000), href: text(body?.href, 1000) };
  if (kind === 'song') {
    item.ref = playlists.ref(body?.ref);
    if (!item.ref || playlists.keyOf(item.ref) !== id) throw fail('Not a song ACRUX can play', 400);
  }
  putMark.run(kind, id, JSON.stringify(item), Date.now());
}
const marks = () => allMarks.all().map((m) => ({ kind: m.kind, id: m.id, at: m.at, ...JSON.parse(m.json) }));

// ---------- offline: songs kept to play without the internet ----------

// Songs of yours from this computer (copied in or linked), and the built-in ones, are here already; a Drive song is
// kept whole in the Drive cache (api/cache.js); a Discover song is fetched into data/offline. Videos and previews can't
// be kept.
const putOffline = db.prepare('INSERT OR IGNORE INTO offline (key, kind, ref, status, at) VALUES (?, ?, ?, ?, ?)');
const getOffline = db.prepare('SELECT * FROM offline WHERE key = ?');
const allOffline = db.prepare('SELECT * FROM offline ORDER BY at');
const delOffline = db.prepare('DELETE FROM offline WHERE key = ?');
const setFetched = db.prepare('UPDATE offline SET file = ?, bytes = ?, status = ? WHERE key = ?');
const nextWaiting = db.prepare("SELECT * FROM offline WHERE kind = 'web' AND status = 'waiting' ORDER BY at LIMIT 1");
const keptDrive = () => allOffline.all().filter((o) => o.kind === 'drive').map((o) => o.key.slice(4));
cache.setKept(keptDrive());
db.exec("UPDATE offline SET status = 'waiting' WHERE status = 'failed'"); // tried again at each start

const webAudio = (r) => r.playback?.kind === 'audio' && !r.preview && playlists.allowed(r.playback.urls.high);
// Where a ref's song is kept: 'here' (already on this computer), 'drive', 'web', or null (it can't be).
function keepKind(r) {
  if (r.source !== 'library') return webAudio(r) ? 'web' : null;
  if (!r.id.startsWith('lib:')) return 'here';
  const t = tracks.get(r.id.slice(4));
  return !t ? null : t.source.startsWith('drive:') ? 'drive' : 'here';
}
function keep(songs) {
  let kept = 0;
  let skipped = 0;
  for (const r of playlists.refs(songs)) {
    const kind = keepKind(r);
    if (kind === 'drive' || kind === 'web') putOffline.run(playlists.keyOf(r), kind, JSON.stringify(r), 'waiting', Date.now());
    if (kind) kept++; else skipped++;
  }
  cache.setKept(keptDrive());
  fetchWaiting();
  announce();
  return { kept, skipped };
}
function letGo(songs) {
  for (const r of playlists.refs(songs)) {
    const row = getOffline.get(playlists.keyOf(r));
    if (!row) continue;
    delOffline.run(row.key);
    if (row.file) fs.rmSync(path.join(OFFLINE, row.file), { force: true });
  }
  cache.setKept(keptDrive());
  announce();
  return { ok: true };
}
// Discover songs, fetched one at a time in the order you kept them.
let fetching = false;
async function fetchWaiting() {
  if (fetching) return;
  fetching = true;
  try {
    for (let row; (row = nextWaiting.get());) {
      const r = JSON.parse(row.ref);
      const got = await playlists.fromUrl(r.playback.urls.high)(() => !getOffline.get(row.key));
      if (!getOffline.get(row.key)) continue; // let go meanwhile
      if (!got) { setFetched.run(null, null, 'failed', row.key); continue; }
      const file = `${crypto.createHash('sha1').update(row.key).digest('hex')}${got.ext}`;
      await fs.promises.writeFile(path.join(OFFLINE, file), got.body);
      if (!getOffline.get(row.key)) { await fs.promises.rm(path.join(OFFLINE, file), { force: true }); continue; } // let go while it was written
      setFetched.run(file, got.body.length, 'done', row.key);
      announce();
    }
  } catch (err) {
    console.error('Offline:', err.message);
  } finally {
    fetching = false;
  }
}
setTimeout(fetchWaiting, 5e3).unref();
const offline = () => allOffline.all().map((o) => ({ key: o.key, kind: o.kind, ref: JSON.parse(o.ref),
  status: o.kind === 'drive' ? (cache.complete(o.key.slice(4)) ? 'done' : 'waiting') : o.status }));

// ---------- reading songs (Save to computer) ----------

const safe = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';
const fromFile = (file) => async () => ({ body: await fs.promises.readFile(file), ext: path.extname(file).toLowerCase() || '.mp3' });
// A ref -> { title, load } for the ZIP writer, or null (a video, a preview, a song that's gone).
function source(r) {
  if (r.source === 'library' && r.src) {
    const file = path.join(ROOT, decodeURIComponent(r.src));
    return file.startsWith(path.join(ROOT, 'playback_tree') + path.sep) ? { title: r.title, load: fromFile(file) } : null;
  }
  if (r.source === 'library') {
    const t = r.id.startsWith('lib:') && tracks.get(r.id.slice(4));
    if (!t) return null;
    const title = `${t.artist} - ${t.title}`;
    if (!t.source.startsWith('drive:')) return { title, load: async () => { const file = await local.fileOf(t); return file && fromFile(file)(); } };
    return { title, load: async () => ({ body: await fs.promises.readFile(await cache.whole(t)), ext: path.extname(t.name).toLowerCase() }) };
  }
  const title = `${r.artist} - ${r.title}`;
  const row = getOffline.get(playlists.keyOf(r));
  if (row?.status === 'done') return { title, load: fromFile(path.join(OFFLINE, row.file)) };
  return webAudio(r) ? { title, load: playlists.fromUrl(r.playback.urls.high) } : null;
}
async function saveSong(req, res, r) {
  const src = r && source(r);
  if (!src) return send(res, 404, { error: 'That song can’t be saved (videos and previews can’t).' });
  const got = await src.load(() => false);
  if (!got) return send(res, 502, { error: 'Its server didn’t send the song. Try again later.' });
  res.writeHead(200, { 'Content-Type': typeOf(`x${got.ext}`), 'Content-Length': got.body.length, 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${safe(src.title)}${got.ext}`)}` });
  res.end(got.body);
}
const zip = (req, res, name, refs) => playlists.download(req, res, name, refs.map(source).filter(Boolean));

// ---------- collaborators ----------

const token = () => crypto.randomBytes(18).toString('base64url');
const q = {
  guest: db.prepare('SELECT * FROM guests WHERE token = ?'),
  addGuest: db.prepare('INSERT INTO guests (token, gid, name, joined) VALUES (?, ?, ?, ?)'),
  renameGuest: db.prepare('UPDATE guests SET name = ? WHERE token = ?'),
  invite: db.prepare('SELECT * FROM invites WHERE token = ?'),
  inviteOf: db.prepare('SELECT * FROM invites WHERE playlist = ?'),
  addInvite: db.prepare('INSERT INTO invites (token, playlist, role, created) VALUES (?, ?, ?, ?)'),
  dropInvites: db.prepare('DELETE FROM invites WHERE playlist = ?'),
  join: db.prepare('INSERT OR IGNORE INTO members (playlist, gid, role, joined) VALUES (?, ?, ?, ?)'),
  member: db.prepare('SELECT role FROM members WHERE playlist = ? AND gid = ?'),
  membersOf: db.prepare('SELECT m.gid, m.role, g.name FROM members m JOIN guests g ON g.gid = m.gid WHERE m.playlist = ? ORDER BY m.joined'),
  playlistsOf: db.prepare('SELECT playlist AS id, role FROM members WHERE gid = ?'),
  setRole: db.prepare('UPDATE members SET role = ? WHERE playlist = ? AND gid = ?'),
  dropMember: db.prepare('DELETE FROM members WHERE playlist = ? AND gid = ?'),
  dropPlaylist: db.prepare('DELETE FROM members WHERE playlist = ?'),
};
const ROLES = ['edit', 'view'];
// The guest a request comes from (their cookie), if any. The computer running ACRUX is never a guest.
function guestOf(req) {
  if (loopback(req)) return null;
  const t = /(?:^|;\s*)acrux_guest=([\w-]{10,60})/.exec(req.headers.cookie || '')?.[1];
  return t ? q.guest.get(t) || null : null;
}
const canEdit = (req, id) => loopback(req) || q.member.get(id, guestOf(req)?.gid ?? '')?.role === 'edit';

// ---------- your devices ----------

// Set up ACRUX (and My Music) shows a QR code holding a one-time link to this computer's Wi-Fi address. The phone that
// opens it becomes one of your devices: it browses and plays everything, and its listening counts as yours. Like a phone
// with HOST=0.0.0.0, it can't change anything: that stays with this computer.
db.exec('CREATE TABLE IF NOT EXISTS devices (token TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, joined INTEGER NOT NULL)');
const dq = {
  get: db.prepare('SELECT * FROM devices WHERE token = ?'),
  add: db.prepare('INSERT INTO devices (token, id, name, joined) VALUES (?, ?, ?, ?)'),
  list: db.prepare('SELECT id, name, joined FROM devices ORDER BY joined'),
  drop: db.prepare('DELETE FROM devices WHERE id = ?'),
};
const PAIR_MS = 10 * 60e3;
const pairs = new Map(); // one-time pairing token -> when it stops working (kept in memory: a restart voids them)
function makePair(now = Date.now()) {
  for (const [t, until] of pairs) if (until <= now) pairs.delete(t);
  const t = token();
  pairs.set(t, now + PAIR_MS);
  return t;
}
function claimPair(t, now = Date.now()) {
  const until = pairs.get(t);
  pairs.delete(t); // once only
  return !!until && until > now;
}
function deviceOf(req) {
  if (loopback(req)) return null;
  const t = /(?:^|;\s*)acrux_device=([\w-]{10,60})/.exec(req.headers.cookie || '')?.[1];
  return t ? dq.get.get(t) || null : null;
}
const deviceName = (ua = '') => (/iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone'
  : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'Device');

// Listening on the Wi-Fi: this computer's own network addresses, beside 127.0.0.1, so a guest's phone or laptop can open
// an invite link. HOST=0.0.0.0 (server.js) already listens everywhere and lets anyone on the network in, as before.
let server = null; // { handler, port, host }, from server.js
const lan = new Map();
const addresses = () => Object.values(os.networkInterfaces()).flat().filter((a) => a?.family === 'IPv4' && !a.internal).map((a) => a.address);
const openHost = () => server?.host === '0.0.0.0';
function setSharing(on) {
  tracks.stored.set('sharing', on ? '1' : '0');
  if (!on || openHost()) {
    for (const s of lan.values()) { s.close(); s.closeAllConnections(); }
    lan.clear();
    return;
  }
  for (const address of addresses()) {
    if (lan.has(address)) continue;
    const s = http.createServer(server.handler);
    s.on('error', (err) => { console.error('Wi-Fi sharing:', address, err.message); lan.delete(address); });
    s.listen(server.port, address, () => console.log(`Invite links open at http://${address}:${server.port}/`));
    lan.set(address, s);
  }
}
const sharing = () => ({ on: openHost() || lan.size > 0, open: openHost(), address: addresses()[0] || null });
function attach(options) {
  server = options;
  if (tracks.stored.get('sharing') === '1') setSharing(true);
}

// Who may reach the API from the network: the owner's computer, everyone with HOST=0.0.0.0, a guest (their cookie),
// and anyone opening an invite link. The site's own files (pages, scripts, styles) are always fine.
function gate(req, url) {
  if (loopback(req) || openHost()) return true;
  const p = url.pathname;
  if (!p.startsWith('/api/') && !p.startsWith('/discover/')) return true;
  return !!guestOf(req) || !!deviceOf(req) || /^\/api\/invites\/[\w-]+(\/join)?$/.test(p) || p === '/api/devices/join';
}

function inviteLink(id, role = 'edit') {
  let inv = q.inviteOf.get(id);
  if (!inv) {
    inv = { token: token(), role };
    q.addInvite.run(inv.token, id, role, Date.now());
  }
  const host = openHost() || lan.size ? addresses()[0] : null;
  const url = `http://${host || 'localhost'}:${server?.port || 3000}/library.html?view=playlist&id=${encodeURIComponent(id)}&invite=${inv.token}`;
  return { url, sharing: sharing() };
}

// ---------- everything, for the page ----------

function collection(req) {
  const g = guestOf(req);
  const device = deviceOf(req);
  if (!loopback(req) && !device && (g || !openHost())) { // a guest: their playlists only
    const mine = g ? q.playlistsOf.all(g.gid) : [];
    const lists = mine.map((m) => playlists.get(m.id)).filter(Boolean);
    return { playlists: lists, marks: [], offline: [], cached: [], me: { guest: g && { name: g.name, playlists: mine } }, sharing: sharing() };
  }
  const lists = playlists.list().playlists.map((p) => ({ ...p, people: q.membersOf.all(p.id), invited: !!q.inviteOf.get(p.id) }));
  return { playlists: lists, marks: marks(), offline: offline(), cached: cache.cachedSongs(), me: loopback(req) ? { owner: true } : device ? { device: true } : {}, sharing: sharing() }; // a device, or a phone with HOST=0.0.0.0, can look but not change
}

// ---------- routes ----------

async function body(req, max = 10e6) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > max) throw fail('That picture is too large (up to 10 MB).', 413);
    parts.push(part);
  }
  return Buffer.concat(parts);
}

module.exports = async function route(req, res, url) {
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: 'Bad path' }); }
  const m = req.method;
  const read = m === 'GET' || m === 'HEAD';
  const param = (name) => String(url.searchParams.get(name) || '');
  try {
    if (!read && !sameSite(req)) return send(res, 403, { error: 'Only ACRUX itself can do that' });
    const owner = () => { if (!loopback(req)) throw fail('Only on the computer running ACRUX', 403); };
    const raw = (re) => { const r = re.exec(url.pathname); try { return r && r.map((x) => x && decodeURIComponent(x)); } catch { return null; } }; // ids with "/" in them (Archive songs), sent encoded
    let hit;

    if (p === '/api/collection' && read) return send(res, 200, collection(req));
    if (p === '/api/playlists/played' && read) return send(res, 200, { lists: taste.playedLists() });

    // Joining: open to anyone holding the link.
    if ((hit = /^\/api\/invites\/([\w-]+)(\/join)?$/.exec(p))) {
      const inv = q.invite.get(hit[1]);
      const list = inv && playlists.get(inv.playlist);
      if (!list) return send(res, 404, { error: 'This invite link doesn’t work any more. Ask for a new one.' });
      if (!hit[2] && read) return send(res, 200, { playlist: { id: list.id, title: list.title }, role: inv.role });
      if (hit[2] && m === 'POST') {
        const name = text((await json(req))?.name, 40);
        if (!name) throw fail('Say your name, so the others know who added what', 400);
        let g = guestOf(req);
        if (g) q.renameGuest.run(name, g.token);
        else q.addGuest.run((g = { token: token(), gid: token().slice(0, 10) }).token, g.gid, name, Date.now());
        q.join.run(list.id, g.gid, inv.role, Date.now());
        announce();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
          'Set-Cookie': `acrux_guest=${g.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000` });
        return res.end(JSON.stringify({ playlist: list.id }));
      }
    }

    if (p === '/api/playlists' && m === 'POST') {
      owner();
      const made = playlists.create(await json(req));
      announce();
      return send(res, 200, made);
    }
    if ((hit = /^\/api\/playlists\/([\w-]{1,120})(\/(songs|duplicate|photo|invite|people\/([\w-]{1,20})))?$/.exec(p))) {
      const [, id, , what, gid] = hit;
      if (what === 'songs' && (m === 'POST' || m === 'PUT')) {
        if (!canEdit(req, id)) throw fail('You can’t change this playlist', 403);
        const songs = (await json(req))?.songs;
        const done = m === 'POST' ? playlists.addSongs(id, songs) : playlists.setSongs(id, songs);
        announce();
        return send(res, 200, done);
      }
      owner();
      let done;
      if (!what && m === 'PATCH') done = playlists.update(id, await json(req));
      else if (!what && m === 'DELETE') {
        playlists.remove(id);
        q.dropInvites.run(id);
        q.dropPlaylist.run(id);
        delMark.run('pin', id);
        delMark.run('playlist', id);
        done = { removed: id };
      } else if (what === 'duplicate' && m === 'POST') done = playlists.duplicate(id);
      else if (what === 'photo' && m === 'PUT') {
        const name = tracks.saveCover(await body(req), req.headers['content-type']);
        if (!name) throw fail('That isn’t a JPEG, PNG or WebP picture', 400);
        done = playlists.update(id, { photo: `/api/covers/${name}` });
      } else if (what === 'invite' && m === 'POST') {
        if (!playlists.get(id)) throw fail('No such playlist', 404);
        return send(res, 200, inviteLink(id));
      } else if (what === 'invite' && m === 'DELETE') {
        q.dropInvites.run(id);
        return send(res, 200, inviteLink(id));
      } else if (gid && m === 'PATCH') {
        const role = (await json(req))?.role;
        if (!ROLES.includes(role)) throw fail('A role is edit or view', 400);
        q.setRole.run(role, id, gid);
        done = { role };
      } else if (gid && m === 'DELETE') {
        q.dropMember.run(id, gid);
        done = { removed: gid };
      }
      if (done) {
        announce();
        return send(res, 200, done);
      }
    }

    if ((hit = raw(/^\/api\/marks\/([a-z]+)\/([^/]{1,600})$/)) && KINDS.includes(hit[1]) && hit[2].length <= 300) {
      owner();
      if (m === 'PUT') mark(hit[1], hit[2], await json(req));
      else if (m === 'DELETE') delMark.run(hit[1], hit[2]);
      else return send(res, 405, { error: 'PUT or DELETE' });
      announce();
      return send(res, 200, { ok: true });
    }

    if (p === '/api/offline' && (m === 'PUT' || m === 'DELETE')) {
      owner();
      const songs = (await json(req))?.songs;
      return send(res, 200, m === 'PUT' ? keep(songs) : letGo(songs));
    }
    if ((hit = raw(/^\/api\/offline\/([^/]{1,600})\/audio$/)) && read) {
      const row = getOffline.get(hit[1]);
      const file = row?.status === 'done' && path.join(OFFLINE, row.file);
      const stat = file && (await fs.promises.stat(file).catch(() => null));
      return stat ? sendFile(req, res, file, stat) : send(res, 404, { error: 'Not kept offline' });
    }

    if (p === '/api/save' && read) {
      const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };
      if (param('song')) return await saveSong(req, res, playlists.ref(parse(param('song'))));
      if (param('playlist')) {
        const list = playlists.get(param('playlist'));
        if (!list) return send(res, 404, { error: 'No such playlist' });
        return await zip(req, res, list.title, list.songs);
      }
      const album = /^lib-([0-9a-f]{16})$/.exec(param('album'))?.[1];
      if (album) {
        const songs = tracks.byAlbum(album);
        if (!songs.length) return send(res, 404, { error: 'No such album' });
        return await zip(req, res, `${songs[0].album_artist} - ${songs[0].album}`, songs.map((t) => ({ source: 'library', id: `lib:${t.id}` })));
      }
      if (param('songs')) return await zip(req, res, text(param('name'), 100) || 'ACRUX', playlists.refs(parse(param('songs'))));
      return send(res, 400, { error: 'Say which song, playlist or album' });
    }

    if (p === '/api/devices/pair' && m === 'POST') {
      owner();
      const address = addresses()[0];
      if (!address) throw fail('This computer isn’t on a Wi-Fi network, so a phone can’t reach it.', 409);
      setSharing(true); // a phone reaches this computer on its Wi-Fi address
      const link = `http://${address}:${server?.port || 3000}/?pair=${makePair()}`;
      const qr = qrcode(0, 'M');
      qr.addData(link);
      qr.make();
      return send(res, 200, { url: link, qr: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }), minutes: PAIR_MS / 60e3 });
    }
    if (p === '/api/devices/join' && m === 'POST') {
      if (loopback(req)) return send(res, 200, { owner: true }); // the link opened on this computer: nothing to pair
      if (!claimPair(String((await json(req))?.token || ''))) {
        throw fail('This code has expired or was used already. On the computer, open My Music → Set up ACRUX for a new one.', 410);
      }
      const d = { token: token(), id: token().slice(0, 10), name: deviceName(req.headers['user-agent']) };
      dq.add.run(d.token, d.id, d.name, Date.now());
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'Set-Cookie': `acrux_device=${d.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000` });
      return res.end(JSON.stringify({ device: d.name }));
    }
    if (p === '/api/devices' && read) {
      owner();
      return send(res, 200, { devices: dq.list.all() });
    }
    if ((hit = /^\/api\/devices\/([\w-]+)$/.exec(p)) && m === 'DELETE') {
      owner();
      dq.drop.run(hit[1]);
      return send(res, 200, { removed: hit[1] });
    }

    if (p === '/api/sharing' && m === 'PUT') {
      owner();
      setSharing((await json(req))?.on === true);
      return send(res, 200, sharing());
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    if (err.expose) return send(res, err.status, { error: err.message });
    console.error('Collection:', err);
    if (!res.headersSent) send(res, 500, { error: 'Something went wrong' });
    else res.destroy();
  }
};

module.exports.ROUTES = ROUTES;
module.exports.attach = attach;
module.exports.gate = gate;
module.exports.guestOf = guestOf;
module.exports.deviceOf = deviceOf;
module.exports.pairing = { makePair, claimPair };
