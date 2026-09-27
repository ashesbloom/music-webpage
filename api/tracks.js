// Your music: every song you added from this computer (api/local.js: copied in, or in a folder linked in place) or found
// in one of your Google Drive folders (api/drive.js), one row each in data/acrux.db, with their covers in data/covers.
// Also the Add More panel's settings and the live events (Server-Sent Events) it listens to. Nothing here goes online.
// The tracks table is also where a later enrichment job (recognising albums) would write: update rows, then changed().
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db } = require('./db');

const DATA = process.env.ACRUX_DATA || path.join(__dirname, '..', 'data');
const MUSIC = path.join(DATA, 'music');   // songs you added, as <album artist>/<album>/<file>
const COVERS = path.join(DATA, 'covers'); // <sha1>.<ext>, shared by every song that has that picture
fs.mkdirSync(COVERS, { recursive: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, folder TEXT,
    resource_key TEXT, auth TEXT, status TEXT NOT NULL, added INTEGER NOT NULL, synced INTEGER, is_file INTEGER);
  CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, source TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL,
    title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT NOT NULL, album_artist TEXT NOT NULL, album_id TEXT NOT NULL,
    track_no INTEGER, disc_no INTEGER, year INTEGER, genre TEXT, duration REAL, sample_rate INTEGER, bits INTEGER, codec TEXT,
    size INTEGER, md5 TEXT, modified TEXT, resource_key TEXT, cover TEXT, head INTEGER, added INTEGER NOT NULL, used INTEGER);
  CREATE INDEX IF NOT EXISTS tracks_source ON tracks (source);
  CREATE INDEX IF NOT EXISTS tracks_album ON tracks (album_id);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
try { db.exec('ALTER TABLE sources ADD COLUMN is_file INTEGER'); } catch {} // a link to one song (a database from before has no such column)
// Albums you removed from a folder of albums: a rescan of that folder leaves them out.
db.exec('CREATE TABLE IF NOT EXISTS removed_albums (source TEXT NOT NULL, album_id TEXT NOT NULL, PRIMARY KEY (source, album_id))');
// Songs whose link is gone (removed while it was still being read, before scans stopped writing then) go too.
db.exec('DELETE FROM tracks WHERE source NOT IN (SELECT id FROM sources)');

// Albums are kept apart by where they came from (the same album on this computer and in Drive is two). Rows from before
// that were keyed without it; they're moved over once.
const albumKey = (source, key) => crypto.createHash('sha1').update(`${source}\n${key}`).digest('hex').slice(0, 16);
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'albumKeys'").get()) {
  const move = db.prepare('UPDATE tracks SET album_id = ? WHERE id = ?');
  db.exec('BEGIN');
  for (const t of db.prepare('SELECT id, source, album_id FROM tracks').all()) move.run(albumKey(t.source, t.album_id), t.id);
  db.prepare("INSERT INTO settings (key, value) VALUES ('albumKeys', 'by source')").run();
  db.exec('COMMIT');
}

// ---------- names ----------

const AUDIO = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.aif', '.aiff']);
const isAudio = (name) => AUDIO.has(path.extname(name).toLowerCase());
// How likely a picture in an album's folder is its cover: 3 for cover/folder/front ("Front Continuum.jpg"), 2 for
// art/artwork/album ("Art.jpg"), 1 for any other picture, 0 for the other scans (back, CD, inlay, booklet…) and -1 for
// what isn't a picture. A folder's best one is its cover.
function coverRank(name) {
  const base = path.basename(name).toLowerCase();
  if (!/\.(jpe?g|png|webp)$/.test(base)) return -1;
  if (/\b(back|cd\d*|disc\d*|disk\d*|inlay|tray|inside|inner|booklet|matrix|label|spine)\b/.test(base)) return 0;
  if (/\b(cover|folder|front)\b/.test(base)) return 3;
  if (/(art|artwork|album)\b/.test(base)) return 2;
  return 1;
}
const isCover = (name) => coverRank(name) > 0;

// What a file's name and folder say, for songs without tags: "Nectar/07 - Run.flac" -> track 7, "Run", album "Nectar";
// "08. Radiohead - 4 Minute Warning.flac" -> track 8, "4 Minute Warning" by Radiohead; a folder named like
// "Fleetwood Mac - Rumours (1977) [24-96 FLAC]" -> album "Rumours" by Fleetwood Mac, 1977. root: the name of the folder
// the path starts in, for files at its top (a Drive folder's songs have paths inside it: "01 - Planet Telex.flac").
function fromName(rel, root = null) {
  const parts = rel.split('/').filter(Boolean);
  const base = parts.at(-1).replace(/\.[^.]+$/, '');
  const m = /^(?:(\d{1,2})[-.](?=\d))?(\d{1,3})(?:\s*[-._)]+\s*|\s+)(.+)$/.exec(base); // "07 - ", "02.-", "1-03 "
  const rest = (m ? m[3] : base).replace(/_/g, ' ').trim() || base;
  const by = /^(.+?) - (.+)$/.exec(rest); // "Artist - Title"
  const folder = parts.length > 1 ? parts.at(-2) : root || null;
  const named = folder && /^(.+?) - (.+?)(?:\s*[([].*)?$/.exec(folder); // "Artist - Album (1977) [extras]"
  return {
    n: m ? Number(m[2]) : /^\d{1,3}$/.test(base) ? Number(base) : null, // "07 - Run", or just "7"
    disc: m?.[1] ? Number(m[1]) : null,
    title: by ? by[2] : rest,
    artist: by ? by[1] : named ? named[1] : null,
    album: named ? named[2].trim() : folder,
    year: Number(/\((\d{4})\)/.exec(folder || '')?.[1]) || null,
  };
}

// A name tagged as the same one repeated ("Joji,Joji", "Joji; Joji") as that one name; a real list stays as it is.
function once(name) {
  if (!name) return null;
  const parts = [...new Set(String(name).split(/\s*[,;/]\s*/).filter(Boolean))];
  return parts.length === 1 ? parts[0] : String(name);
}

// A track's fields from music-metadata's answer (null when the file couldn't be read), its path and where it came
// from (a source id), falling back to the name (and root: the folder the path starts in, as fromName).
function describe(meta, rel, source, root = null) {
  const c = meta?.common || {};
  const f = meta?.format || {};
  const guess = fromName(rel, root);
  const artist = once([...new Set(c.artists || [])].join(', ') || c.artist) || guess.artist || 'Unknown artist';
  const album = c.album || guess.album || 'Unknown album';
  const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  return {
    title: c.title || guess.title, artist, album, album_artist: once(c.albumartist) || artist,
    track_no: c.track?.no ?? guess.n, disc_no: c.disk?.no ?? guess.disc, year: c.year ?? guess.year, genre: c.genre?.[0] ?? null,
    duration: f.duration ?? null, sample_rate: f.sampleRate ?? null, bits: f.bitsPerSample ?? null, codec: f.codec ?? null,
    // One album per album artist + title from one source; untagged compilations stay together by their folder.
    album_id: albumKey(source, crypto.createHash('sha1').update(`${c.albumartist || folder || artist}\n${album}`.toLowerCase()).digest('hex').slice(0, 16)),
  };
}

// ---------- covers ----------

const EXT = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
// Keeps a picture (bytes and its type) once, however many songs have it: its file name, or null if it isn't one.
// Rippers embed scans of 10 MB and more; they're kept as they are.
// ponytail: no downscaling (no image library); add it if big covers ever slow the crate down.
function saveCover(data, type) {
  const ext = EXT[String(type).toLowerCase()];
  if (!ext || !data?.length || data.length > 40e6) return null;
  const name = `${crypto.createHash('sha1').update(data).digest('hex')}${ext}`;
  const file = path.join(COVERS, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, data);
  return name;
}
const coverFile = (name) => (/^[0-9a-f]{40}\.(jpg|png|webp)$/.test(name) ? path.join(COVERS, name) : null);

// ---------- rows ----------

const COLS = ['id', 'source', 'path', 'name', 'title', 'artist', 'album', 'album_artist', 'album_id', 'track_no', 'disc_no', 'year',
  'genre', 'duration', 'sample_rate', 'bits', 'codec', 'size', 'md5', 'modified', 'resource_key', 'cover', 'head', 'added', 'used'];
const putRow = db.prepare(`INSERT OR REPLACE INTO tracks (${COLS.join(', ')}) VALUES (${COLS.map(() => '?').join(', ')})`);
const put = (row) => putRow.run(...COLS.map((c) => row[c] ?? null));
const getRow = db.prepare('SELECT * FROM tracks WHERE id = ?');
const get = (id) => getRow.get(id) || null;
const bySource = db.prepare('SELECT * FROM tracks WHERE source = ?');
const byAlbum = db.prepare('SELECT * FROM tracks WHERE album_id = ? ORDER BY disc_no, track_no, title');
const delRow = db.prepare('DELETE FROM tracks WHERE id = ?');
const remove = (id) => delRow.run(id);
const useRow = db.prepare('UPDATE tracks SET used = ? WHERE id = ?');
// Songs of an album without a cover of their own take the one another of its songs has.
const shareRow = db.prepare(`UPDATE tracks SET cover = (SELECT t2.cover FROM tracks t2 WHERE t2.album_id = tracks.album_id AND t2.cover IS NOT NULL LIMIT 1)
  WHERE source = ? AND cover IS NULL`);
const shareCovers = (source) => shareRow.run(source);
const touch = (id) => useRow.run(Date.now(), id);

// Every song for the page (catalog.js groups them into albums and artists), in album order.
const everything = db.prepare(`SELECT id, source, name, title, artist, album, album_artist AS albumArtist, album_id AS albumId,
  track_no AS track, disc_no AS disc, year, genre, duration, sample_rate AS sampleRate, bits, codec, cover, added
  FROM tracks ORDER BY album_id, disc_no, track_no, title`);
const list = () => everything.all();

const putSource = db.prepare(`INSERT INTO sources (id, kind, title, folder, resource_key, auth, status, added, is_file) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET title = excluded.title, resource_key = excluded.resource_key, auth = excluded.auth`);
const getSource = db.prepare('SELECT * FROM sources WHERE id = ?');
const setStatus = db.prepare('UPDATE sources SET status = ?, synced = COALESCE(?, synced) WHERE id = ?');
const delSource = db.prepare('DELETE FROM sources WHERE id = ?');
// Each with its songs, albums (one: a link to an album; more: to a folder of albums) and size.
const allSources = db.prepare(`SELECT s.id, s.kind, s.title, s.status, s.synced, s.is_file AS isFile, COUNT(t.id) AS songs,
  COUNT(DISTINCT t.album_id) AS albums, COALESCE(SUM(t.size), 0) AS bytes
  FROM sources s LEFT JOIN tracks t ON t.source = s.id GROUP BY s.id ORDER BY s.kind DESC, s.added DESC`);
const sources = {
  put: (s) => putSource.run(s.id, s.kind, s.title, s.folder ?? null, s.resource_key ?? null, s.auth ?? null, s.status, Date.now(), s.is_file ? 1 : null),
  get: (id) => getSource.get(id) || null,
  status: (id, status, synced = null) => setStatus.run(status, synced, id),
  remove: (id) => delSource.run(id),
  list: () => allSources.all(),
};

// ---------- settings ----------

// The Drive cache's size cap; how long a song stays cached after you last played it (0: until the cap needs the room);
// how many upcoming songs get their start fetched; whether songs from this computer are copied in (1) or played from
// where they are (0: a linked folder).
const DEFAULTS = { cacheGB: 10, keepDays: 7, prefetch: 3, keepCopy: 1 };
const LIMITS = { cacheGB: [1, 2000], keepDays: [0, 365], prefetch: [0, 10], keepCopy: [0, 1] };
const readSettings = db.prepare('SELECT key, value FROM settings');
const writeSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
const settings = {
  get: () => ({ ...DEFAULTS, ...Object.fromEntries(readSettings.all().filter((r) => r.key in DEFAULTS).map((r) => [r.key, Number(r.value)])) }),
  set(patch) {
    for (const [key, [min, max]] of Object.entries(LIMITS)) {
      const v = Number(patch?.[key]);
      if (patch?.[key] !== undefined && Number.isFinite(v)) writeSetting.run(key, String(Math.min(Math.max(Math.round(v), min), max)));
    }
    return settings.get();
  },
};

// ---------- events ----------

// The Add More panel's live view: `scan` (a Drive folder's progress) and `library` (songs came or went, so the page
// fetches them again). Library changes are sent at most once a second.
const clients = new Set();
function subscribe(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(': ACRUX\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25e3); // keeps proxies and sleeping laptops from dropping it
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}
function emit(type, data) {
  const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(message);
}
let soon = null;
function changed() {
  soon ??= setTimeout(() => { soon = null; emit('library', {}); }, 1000);
}

const addRemoved = db.prepare('INSERT OR IGNORE INTO removed_albums (source, album_id) VALUES (?, ?)');
const isRemoved = db.prepare('SELECT 1 FROM removed_albums WHERE source = ? AND album_id = ?');
const clearRemoved = db.prepare('DELETE FROM removed_albums WHERE source = ?');
const removedAlbums = {
  add: (source, album) => addRemoved.run(source, album),
  has: (source, album) => !!isRemoved.get(source, album),
  clear: (source) => clearRemoved.run(source),
};

// Other things kept by name (the Google sign-in client pasted on the Add More panel).
const readStored = db.prepare('SELECT value FROM settings WHERE key = ?');
const stored = {
  get: (key) => readStored.get(key)?.value ?? null,
  set: (key, value) => writeSetting.run(key, value),
};

module.exports = {
  DATA, MUSIC, isAudio, isCover, coverRank, fromName, describe, saveCover, coverFile,
  put, get, remove, touch, shareCovers, list, bySource: (id) => bySource.all(id), byAlbum: (id) => byAlbum.all(id),
  sources, settings, stored, removedAlbums, subscribe, emit, changed,
};
