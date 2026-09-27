// Your playlists: the ones you make here and the ones saved from Discover albums, in data/acrux.db. A playlist holds
// song refs in order: { source: 'library', id } for a song of your library ('lib:<track>'), or a built-in one with its
// file ({ …, src: 'playback_tree/songs/…', title }); else a Discover song's result, checked like a play's (taste.clean).
// Also: a ZIP of songs for "Save to computer", each read from wherever it is (a file, the Drive cache, the web).
const zlib = require('zlib');
const crypto = require('crypto');
const { db } = require('./db');
const { fail } = require('./common');
const { clean } = require('./taste');

db.exec('CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, title TEXT NOT NULL, json TEXT NOT NULL, created INTEGER NOT NULL)');
const put = db.prepare('INSERT INTO playlists (id, title, json, created) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET title = excluded.title, json = excluded.json');
const all = db.prepare('SELECT id, title, json, created FROM playlists ORDER BY created DESC');
const one = db.prepare('SELECT id, title, json, created FROM playlists WHERE id = ?');
const del = db.prepare('DELETE FROM playlists WHERE id = ?');
function shape(row) {
  const j = JSON.parse(row.json);
  return { id: row.id, title: row.title, desc: j.desc || '', photo: j.photo ?? j.cover ?? null, groove: j.groove || null,
    searchable: j.searchable !== false, from: j.from || '', songs: j.songs || [], created: row.created, updated: j.updated || row.created };
}
const write = (p) => {
  const { id, title, created, ...rest } = p;
  put.run(id, title, JSON.stringify({ ...rest, updated: Date.now() }), created || Date.now());
};

const list = () => ({ playlists: all.all().map(shape) });
const get = (id) => { const row = one.get(id); return row ? shape(row) : null; };
const need = (id) => get(id) || (() => { throw fail('No such playlist', 404); })();

// ---------- songs ----------

const LIB_ID = /^[\w:.-]{1,120}$/;
const BUILT_IN = /^playback_tree\/songs\/[\w%./ -]+\.(mp3|flac|m4a|ogg|wav)$/;
function ref(s) {
  if (s?.source !== 'library') return clean(s || {});
  if (typeof s.id !== 'string' || !LIB_ID.test(s.id)) return null;
  const r = { source: 'library', id: s.id };
  if (typeof s.src === 'string' && BUILT_IN.test(s.src) && !s.src.includes('..')) {
    r.src = s.src;
    r.title = typeof s.title === 'string' ? s.title.slice(0, 200) : s.id;
  }
  return r;
}
const keyOf = (r) => (r.source === 'library' ? r.id : `${r.source}:${r.id}`); // the page's song id
const refs = (songs) => (Array.isArray(songs) ? songs.slice(0, 2000).map(ref).filter(Boolean) : []);

// ---------- changes ----------

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const photoOk = (u) => (typeof u === 'string' && /^(https?:\/\/|\/discover\/|\/api\/covers\/[0-9a-f]{40}\.(jpg|png|webp)$)/.test(u) ? u.slice(0, 1000) : null);
const grooveOk = (g) => (Array.isArray(g) && g.length === 2 && g.every((c) => /^#[0-9a-f]{6}$/i.test(c)) ? g : null);

// { title, desc?, photo?, groove?, searchable?, songs? } -> a new playlist; with `from` ("archive:<album>", a Discover
// album saved as a playlist) the same album saved again updates its playlist.
function create(body) {
  const title = text(body?.title, 100);
  const from = text(body?.from, 200);
  const songs = refs(body?.songs);
  if (!title) throw fail('A playlist needs a name', 400);
  if (from && !songs.length) throw fail('A playlist needs a title and songs', 400);
  const id = from ? `from-${from.replace(/[^\w-]+/g, '-')}`.slice(0, 120) : `pl-${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  write({ id, title, created: get(id)?.created, from, desc: text(body.desc, 500), photo: photoOk(body.photo ?? body.cover) || (from ? songs[0].artworkUrl : null),
    groove: grooveOk(body.groove), searchable: body.searchable !== false, songs });
  return { id };
}

// { title?, desc?, photo? (null: none), groove? (null: none), searchable? }
function update(id, patch) {
  const p = need(id);
  if (patch?.title !== undefined) p.title = text(patch.title, 100) || p.title;
  if (patch?.desc !== undefined) p.desc = text(patch.desc, 500);
  if (patch?.photo !== undefined) p.photo = photoOk(patch.photo);
  if (patch?.groove !== undefined) p.groove = grooveOk(patch.groove);
  if (patch?.searchable !== undefined) p.searchable = patch.searchable !== false;
  write(p);
  return shape(one.get(id));
}

// Adds songs at the end, leaving out the ones already there: { added, skipped }.
function addSongs(id, songs) {
  const p = need(id);
  const have = new Set(p.songs.map(keyOf));
  const add = refs(songs).filter((r) => !have.has(keyOf(r)) && have.add(keyOf(r)));
  p.songs.push(...add);
  write(p);
  return { added: add.length, skipped: refs(songs).length - add.length };
}
// The whole list again: reordered, or with songs removed.
function setSongs(id, songs) {
  const p = need(id);
  const seen = new Set();
  p.songs = refs(songs).filter((r) => !seen.has(keyOf(r)) && seen.add(keyOf(r)));
  write(p);
  return { songs: p.songs.length };
}
function duplicate(id) {
  const p = need(id);
  return create({ ...p, from: '', title: `${p.title} (Copy)`.slice(0, 100) });
}
function remove(id) {
  need(id);
  del.run(id);
}

// ---------- download ----------

// Only from the sites the songs come from (a saved playlist's URLs came from the page).
const HOSTS = [/(^|\.)archive\.org$/, /(^|\.)jamendo\.com$/, /(^|\.)audius\.co$/];
const allowed = (u) => { try { const url = new URL(u); return url.protocol === 'https:' && HOSTS.some((h) => h.test(url.hostname)); } catch { return false; } };
const safe = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';
const ext = (url, type) => /\.(flac|mp3|ogg|m4a|wav)$/i.exec(new URL(url).pathname)?.[0].toLowerCase()
  || { 'audio/flac': '.flac', 'audio/x-flac': '.flac', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a' }[String(type).split(';')[0]] || '.mp3';

// A song from the web, fetched whole (tried twice, given up after a minute without data) -> { body, ext } or null.
const fromUrl = (url) => async (isGone) => {
  for (let tries = 0; tries < 2 && !isGone(); tries++) {
    const stop = new AbortController();
    let timer;
    const alive = () => { clearTimeout(timer); timer = setTimeout(() => stop.abort(new Error('no data for a minute')), 60e3); };
    try {
      alive();
      const r = await fetch(url, { headers: { 'User-Agent': 'ACRUX/1.0' }, signal: stop.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const parts = [];
      for await (const chunk of r.body) {
        if (isGone()) throw new Error('cancelled');
        parts.push(chunk);
        alive();
      }
      return { body: Buffer.concat(parts), ext: ext(r.url, r.headers.get('content-type')) };
    } catch (err) {
      if (tries) console.error('Download: skipped', url, err.message);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
};

// Streams a ZIP of songs ({ title, load(isGone) -> { body, ext } | null }), written in order as each arrives. Three
// load at once; each is loaded whole before it's written, so a server dropping out mid-song skips that song instead of
// breaking the file. Skipped songs are listed in "Not downloaded.txt". Files are stored as they are (audio doesn't
// compress).
// ponytail: no ZIP64, so a download stops adding songs before 4 GB; add ZIP64 if an album ever gets that big.
async function download(req, res, name, files) {
  if (!files.length) throw fail('Nothing here can be downloaded (previews and videos can’t).', 404);
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  let gone = false;
  res.on('close', () => { gone = !res.writableFinished; }); // the browser gave up: stop fetching
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${safe(name)}.zip`)}`, 'Cache-Control': 'no-store' });
  let offset = 0;
  const write = (buf) => new Promise((done) => {
    offset += buf.length;
    if (res.write(buf)) done(); else res.once('drain', done);
  });
  const central = [];
  const width = String(files.length).length < 2 ? 2 : String(files.length).length;
  const file = async (name, body) => {
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(body) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); // UTF-8 name
    head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(body.length, 22); head.writeUInt16LE(nameBuf.length, 26);
    central.push({ nameBuf, crc, size: body.length, start: offset });
    await write(head);
    await write(nameBuf);
    await write(body);
  };
  const jobs = [];
  const start = (i) => { if (i < files.length) jobs[i] ??= files[i].load(() => gone).catch(() => null); };
  const missed = [];
  for (const [i, s] of files.entries()) {
    [i, i + 1, i + 2].forEach(start); // three at a time
    const song = await jobs[i];
    jobs[i] = null; // let it go once written
    if (gone) return;
    const name = `${String(i + 1).padStart(width, '0')} ${safe(s.title)}`;
    if (!song || offset + song.body.length > 0xfffff000) { missed.push(name); continue; }
    await file(`${name}${song.ext}`, song.body);
  }
  if (missed.length) await file('Not downloaded.txt', Buffer.from(`These songs couldn't be downloaded (their server didn't answer). Try again later:\n\n${missed.join('\n')}\n`));
  const dir = offset;
  for (const c of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8);
    h.writeUInt16LE(time, 12); h.writeUInt16LE(date, 14); h.writeUInt32LE(c.crc >>> 0, 16); h.writeUInt32LE(c.size, 20); h.writeUInt32LE(c.size, 24);
    h.writeUInt16LE(c.nameBuf.length, 28); h.writeUInt32LE(c.start, 42);
    await write(h);
    await write(c.nameBuf);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(offset - dir, 12); end.writeUInt32LE(dir, 16);
  await write(end);
  res.end();
}

module.exports = { list, get, create, save: create, update, addSongs, setSongs, duplicate, remove, ref, refs, keyOf, download, fromUrl, allowed, ext };
