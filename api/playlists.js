// Your playlists saved from Discover (an album's songs, kept as they are, so they play and download like your own), and
// downloading a playlist or a Discover album as one ZIP of its songs in the best quality their source has.
const zlib = require('zlib');
const { db } = require('./db');
const { fail } = require('./common');
const { clean } = require('./taste');

db.exec('CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, title TEXT NOT NULL, json TEXT NOT NULL, created INTEGER NOT NULL)');
const put = db.prepare('INSERT INTO playlists (id, title, json, created) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET title = excluded.title, json = excluded.json');
const all = db.prepare('SELECT id, title, json FROM playlists ORDER BY created DESC');
const one = db.prepare('SELECT id, title, json FROM playlists WHERE id = ?');
const shape = (row) => ({ id: row.id, title: row.title, ...JSON.parse(row.json) });

const list = () => ({ playlists: all.all().map(shape) });
const get = (id) => { const row = one.get(id); return row ? shape(row) : null; };

// { title, from: "archive:<album>", cover, songs } -> saved; the same album saved again updates its playlist.
function save(body) {
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 100) : '';
  const songs = Array.isArray(body?.songs) ? body.songs.slice(0, 500).map(clean).filter(Boolean) : [];
  if (!title || !songs.length) throw fail('A playlist needs a title and songs', 400);
  const from = typeof body.from === 'string' ? body.from.slice(0, 200) : '';
  const id = from ? `from-${from.replace(/[^\w-]+/g, '-')}`.slice(0, 120) : `pl-${Date.now().toString(36)}`;
  const cover = typeof body.cover === 'string' && /^(https?:\/\/|\/discover\/)/.test(body.cover) ? body.cover.slice(0, 1000) : songs[0].artworkUrl;
  put.run(id, title, JSON.stringify({ from, cover, songs }), Date.now());
  return { id };
}

// ---------- download ----------

// Only from the sites the songs come from (a saved playlist's URLs came from the page).
const HOSTS = [/(^|\.)archive\.org$/, /(^|\.)jamendo\.com$/, /(^|\.)audius\.co$/];
const allowed = (u) => { try { const url = new URL(u); return url.protocol === 'https:' && HOSTS.some((h) => h.test(url.hostname)); } catch { return false; } };
const safe = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';
const ext = (url, type) => /\.(flac|mp3|ogg|m4a|wav)$/i.exec(new URL(url).pathname)?.[0].toLowerCase()
  || { 'audio/flac': '.flac', 'audio/x-flac': '.flac', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a' }[String(type).split(';')[0]] || '.mp3';

// Streams a ZIP of the songs (each at its "high" tier: FLAC where the source has it), written in order as each
// arrives. Three download at once; each is fetched whole (tried twice, given up after a minute without data) before
// it's written, so a server dropping out mid-song skips that song instead of breaking the file. Skipped songs are
// listed in "Not downloaded.txt". Files are stored as they are (audio doesn't compress). Previews and videos are
// left out.
// ponytail: no ZIP64, so a download stops adding songs before 4 GB; add ZIP64 if an album ever gets that big.
async function download(req, res, name, songs) {
  const files = songs.filter((s) => s.playback?.kind === 'audio' && !s.preview && allowed(s.playback.urls.high));
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
  const fetchSong = async (url) => {
    for (let tries = 0; tries < 2 && !gone; tries++) {
      const stop = new AbortController();
      let timer;
      const alive = () => { clearTimeout(timer); timer = setTimeout(() => stop.abort(new Error('no data for a minute')), 60e3); };
      try {
        alive();
        const r = await fetch(url, { headers: { 'User-Agent': 'ACRUX/1.0' }, signal: stop.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const parts = [];
        for await (const chunk of r.body) {
          if (gone) throw new Error('cancelled');
          parts.push(chunk);
          alive();
        }
        return { body: Buffer.concat(parts), url: r.url, type: r.headers.get('content-type') };
      } catch (err) {
        if (tries) console.error('Download: skipped', url, err.message);
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  };
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
  const start = (i) => { if (i < files.length) jobs[i] ??= fetchSong(files[i].playback.urls.high); };
  const missed = [];
  for (const [i, s] of files.entries()) {
    [i, i + 1, i + 2].forEach(start); // three at a time
    const song = await jobs[i];
    jobs[i] = null; // let it go once written
    if (gone) return;
    const name = `${String(i + 1).padStart(width, '0')} ${safe(s.title)}`;
    if (!song || offset + song.body.length > 0xfffff000) { missed.push(name); continue; }
    await file(`${name}${ext(song.url, song.type)}`, song.body);
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

module.exports = { list, get, save, download, allowed };
