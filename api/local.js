// Songs you add from this computer. The Add More panel posts each file as it is (POST /api/import); a .zip is unpacked
// here. Songs are copied into data/music/<album artist>/<album>/ and played from there: nothing is sent anywhere.
// A song already in the library (the same bytes) is skipped. Pictures named cover/folder/front.jpg that come with the
// songs (in the same folder of the same drop or zip) become their album's cover when the song has none of its own.
// Or a folder is linked in place (Play from where it is): its songs are read the same way but stay where they are.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { parseFile } = require('music-metadata');
const { fail, typeOf } = require('./common');
const tracks = require('./tracks');

const INCOMING = path.join(tracks.MUSIC, '.incoming'); // files being received or unpacked; same disk, so a move is instant
fs.rmSync(INCOMING, { recursive: true, force: true }); // leftovers of a server stopped mid-import
fs.mkdirSync(INCOMING, { recursive: true });
tracks.sources.put({ id: 'local', kind: 'local', title: 'This computer', status: 'ready' });

const temp = () => path.join(INCOMING, crypto.randomBytes(8).toString('hex'));
const safe = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/^\.+/, '').trim().slice(0, 100) || 'Unknown';

// Writes a stream to a new temp file, hashing it on the way: { file, sha1, size }.
async function receive(stream) {
  const file = temp();
  const hash = crypto.createHash('sha1');
  let size = 0;
  try {
    await pipeline(stream, async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk);
        size += chunk.length;
        yield chunk;
      }
    }, fs.createWriteStream(file));
  } catch (err) {
    await fs.promises.rm(file, { force: true }); // cut off, or a damaged zip entry
    throw err;
  }
  return { file, sha1: hash.digest('hex'), size };
}

// Pictures that came with a drop or zip, by "<batch>\n<folder>" (the best-named one: tracks.coverRank), for its songs
// without their own.
// ponytail: kept in memory for the last 200 folders; a picture posted after its songs doesn't reach them.
const folderCovers = new Map();
const folderOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
function rememberCover(batch, rel, name) {
  const key = `${batch}\n${folderOf(rel)}`;
  const rank = tracks.coverRank(rel);
  if ((folderCovers.get(key)?.rank ?? 0) >= rank) return;
  folderCovers.set(key, { name, rank });
  if (folderCovers.size > 200) folderCovers.delete(folderCovers.keys().next().value);
}

// A song's tags as a track row (describe) and its embedded picture, or null when ACRUX can't read it.
async function readSong(file, rel, source) {
  let meta;
  try {
    meta = await parseFile(file, { duration: true });
  } catch {
    return null;
  }
  if (!meta.format.duration && !meta.format.codec) return null;
  return { row: tracks.describe(meta, rel, source), pic: meta.common.picture?.[0] };
}

// One received file, by its path in the drop (rel): a song, a folder picture, or something skipped.
async function addFile({ file, sha1, size }, rel, batch) {
  let moved = false;
  try {
    if (tracks.isCover(rel)) {
      const type = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(rel).toLowerCase()];
      const name = tracks.saveCover(await fs.promises.readFile(file), type);
      if (name) rememberCover(batch, rel, name);
      return { cover: name };
    }
    if (!tracks.isAudio(rel)) return { skipped: 'Not a song or a zip' };
    if (tracks.get(sha1)) return { skipped: 'Already in your library' };
    const song = await readSong(file, rel, 'local');
    if (!song) return { skipped: 'ACRUX can’t read this file' };
    const { row, pic } = song;
    const dir = path.join(tracks.MUSIC, safe(row.album_artist), safe(row.album));
    await fs.promises.mkdir(dir, { recursive: true });
    let dest = path.join(dir, safe(path.basename(rel)));
    if (fs.existsSync(dest)) dest = path.join(dir, `${sha1.slice(0, 6)} ${safe(path.basename(rel))}`); // another song by that name
    await fs.promises.rename(file, dest);
    moved = true;
    tracks.put({
      ...row, id: sha1, source: 'local', path: path.relative(tracks.MUSIC, dest), name: rel, size, added: Date.now(),
      cover: (pic && tracks.saveCover(pic.data, pic.format)) || folderCovers.get(`${batch}\n${folderOf(rel)}`)?.name || null,
    });
    tracks.changed();
    return { added: sha1 };
  } finally {
    if (!moved) await fs.promises.rm(file, { force: true });
  }
}

// ---------- zip ----------

// A zip's entries, from its central directory: [{ name, flags, method, csize, size, offset }].
// ponytail: no ZIP64, so zips over 4 GB (or 65,535 files) are refused; unzipping and dropping the folder works.
async function zipEntries(file) {
  const fh = await fs.promises.open(file);
  try {
    const { size } = await fh.stat();
    const tail = Buffer.alloc(Math.min(size, 65557)); // the end record, after up to 64 KB of comment
    await fh.read(tail, 0, tail.length, size - tail.length);
    const end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (end < 0) throw fail('That isn’t a zip file ACRUX can open', 400);
    const count = tail.readUInt16LE(end + 10);
    const dirSize = tail.readUInt32LE(end + 12);
    const dirAt = tail.readUInt32LE(end + 16);
    if (count === 0xffff || dirAt === 0xffffffff) throw fail('That zip is too big for ACRUX to open (over 4 GB). Unzip it and drop the folder instead.', 400);
    const dir = Buffer.alloc(dirSize);
    await fh.read(dir, 0, dirSize, dirAt);
    const entries = [];
    for (let p = 0, i = 0; i < count; i++) {
      if (dir.readUInt32LE(p) !== 0x02014b50) throw fail('That zip is damaged', 400);
      const flags = dir.readUInt16LE(p + 8);
      const nameLen = dir.readUInt16LE(p + 28);
      const raw = dir.subarray(p + 46, p + 46 + nameLen);
      const utf8 = raw.toString('utf8'); // most zippers write UTF-8 names, flagged or not
      entries.push({
        name: flags & 0x800 || !utf8.includes('�') ? utf8 : raw.toString('latin1'),
        flags, method: dir.readUInt16LE(p + 10), csize: dir.readUInt32LE(p + 20), size: dir.readUInt32LE(p + 24), offset: dir.readUInt32LE(p + 42),
      });
      p += 46 + nameLen + dir.readUInt16LE(p + 30) + dir.readUInt16LE(p + 32);
    }
    return entries;
  } finally {
    await fh.close();
  }
}

// One entry's bytes as a stream (stored or deflated).
async function entryStream(file, entry) {
  const fh = await fs.promises.open(file);
  const head = Buffer.alloc(30);
  try { await fh.read(head, 0, 30, entry.offset); } finally { await fh.close(); }
  if (head.readUInt32LE(0) !== 0x04034b50) throw fail('That zip is damaged', 400);
  const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const raw = fs.createReadStream(file, { start, end: start + entry.csize - 1 });
  return entry.method === 8 ? raw.pipe(zlib.createInflateRaw()) : raw;
}

// Every song and folder picture in a zip, pictures first so their songs find them. Folders inside keep their names;
// songs at the top take the zip's name as their folder ("Nectar.zip" -> album "Nectar" when untagged).
async function addZip(zip, zipName, batch) {
  const base = zipName.replace(/\.zip$/i, '').split('/').pop();
  const wanted = (await zipEntries(zip))
    .filter((e) => !e.name.endsWith('/') && !/(^|\/)(__MACOSX\/|\._)/.test(e.name) && (tracks.isAudio(e.name) || tracks.isCover(e.name)))
    .sort((a, b) => tracks.coverRank(b.name) - tracks.coverRank(a.name)); // pictures first, the likeliest cover first
  const out = { added: [], skipped: [] };
  for (const e of wanted) {
    const rel = `${base}/${e.name}`;
    if (e.flags & 1) { out.skipped.push({ name: e.name, why: 'Locked with a password' }); continue; }
    if (![0, 8].includes(e.method) || !e.csize) { out.skipped.push({ name: e.name, why: 'Packed in a way ACRUX can’t open' }); continue; }
    try {
      const r = await addFile(await receive(await entryStream(zip, e)), rel, batch);
      if (r.added) out.added.push(r.added);
      else if (r.skipped) out.skipped.push({ name: e.name, why: r.skipped });
    } catch (err) {
      out.skipped.push({ name: e.name, why: err.expose ? err.message : 'Damaged inside the zip' });
    }
  }
  return out;
}

// POST /api/import?name=<its path in the drop>&batch=<the drop>: the body is one file. -> { added: [ids], skipped }
async function importRequest(req, name, batch) {
  const rel = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '').slice(0, 500);
  if (!rel) throw fail('Name the file (?name=)', 400);
  const got = await receive(req);
  if (/\.zip$/i.test(rel)) {
    try { return await addZip(got.file, rel, `${batch}\n${rel}`); } finally { await fs.promises.rm(got.file, { force: true }); }
  }
  const r = await addFile(got, rel, String(batch || ''));
  return { added: r.added ? [r.added] : [], skipped: r.skipped ? [{ name: rel, why: r.skipped }] : [] };
}

// Deletes a song copied into ACRUX: its file (and its folders, once empty) and its row.
async function dropCopy(t) {
  const file = path.join(tracks.MUSIC, t.path);
  if (file.startsWith(tracks.MUSIC + path.sep)) await fs.promises.rm(file, { force: true });
  tracks.remove(t.id);
  for (let dir = path.dirname(file); dir.startsWith(tracks.MUSIC + path.sep); dir = path.dirname(dir)) {
    try { await fs.promises.rmdir(dir); } catch { break; } // not empty: stop there
  }
}

// Removes an album you added from this computer: its songs' files and rows.
async function removeAlbum(albumId) {
  const rows = tracks.byAlbum(albumId).filter((t) => t.source === 'local');
  if (!rows.length) throw fail('No album of yours by that id', 404);
  for (const t of rows) await dropCopy(t);
  tracks.changed();
  return { removed: rows.length };
}

// ---------- folders played from where they are ----------

const within = (root, file) => file.startsWith(path.join(root, path.sep)); // path.join: a root of "/" too
const REAL_MUSIC = fs.realpathSync(tracks.MUSIC); // linked files are real paths: ACRUX's copies, as one would see them

// A song of yours on disk: in data/music, or in its linked folder. A linked one is resolved again each time, so a file
// swapped for a symlink leading out of the folder isn't served. null when it's gone.
async function fileOf(t) {
  if (t.source === 'local') {
    const file = path.join(tracks.MUSIC, t.path);
    return file.startsWith(tracks.MUSIC + path.sep) ? file : null;
  }
  const source = tracks.sources.get(t.source);
  const file = source?.kind === 'linked' && (await fs.promises.realpath(t.path).catch(() => null));
  return file && within(source.folder, file) ? file : null;
}

// GET /api/local/dirs?dir=: the folders in a folder of this computer (your Music folder, else your home, to begin
// with), to pick one to link. -> { dir, parent (null at the top), dirs: [{ name, dir }] }
async function dirs(dir) {
  const home = os.homedir();
  const at = dir && path.isAbsolute(dir) ? path.resolve(dir) : fs.existsSync(path.join(home, 'Music')) ? path.join(home, 'Music') : home;
  const entries = await fs.promises.readdir(at, { withFileTypes: true }).catch(() => { throw fail('ACRUX can’t open that folder', 404); });
  const up = path.dirname(at);
  return {
    dir: at, parent: up === at ? null : up,
    dirs: entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => ({ name: e.name, dir: path.join(at, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
  };
}

// POST /api/local/link { dir }: plays a folder from where it is, nothing copied. Its songs are read in the background
// (`scan` events, like a Drive folder's); linking it again looks through it again. -> { id }
async function link(dir) {
  const root = typeof dir === 'string' && path.isAbsolute(dir) && (await fs.promises.realpath(dir).catch(() => null));
  if (!root || !(await fs.promises.stat(root)).isDirectory()) throw fail('ACRUX can’t open that folder', 404);
  const id = `dir:${crypto.createHash('sha1').update(root).digest('hex').slice(0, 16)}`;
  tracks.sources.put({ id, kind: 'linked', title: path.basename(root) || root, folder: root, status: 'scanning' });
  scan(id);
  return { id };
}

// Every file in a folder and the folders inside it. Hidden ones (".…") and symlinks are left out: a symlink could lead
// out of the folder you linked.
async function walk(dir, out = []) {
  for (const e of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) await walk(path.join(dir, e.name), out);
    else if (e.isFile()) out.push(path.join(dir, e.name));
  }
  return out;
}
async function sha1Of(file) {
  const hash = crypto.createHash('sha1');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// Looks through a linked folder (when linked, on Refresh and at each start): new songs join, read like dropped ones;
// changed ones (by size and time) are read again, keeping their id; ones gone leave, as on a Drive folder's Refresh.
// A folder that isn't there (its drive unplugged) keeps its songs. Songs already in your library (the same bytes) and
// albums you removed from it are left out.
// ponytail: no live watching (fs.watch); changes show at the next Refresh or start. Watch linked folders if that's
// too slow.
const scans = new Map(); // source id -> its look, while it runs
const scan = (id) => {
  if (!scans.has(id)) scans.set(id, look(id).finally(() => scans.delete(id)));
  return scans.get(id);
};
async function look(id) {
  const source = tracks.sources.get(id);
  if (source?.kind !== 'linked') return;
  const root = source.folder;
  const progress = (extra) => tracks.emit('scan', { source: id, ...extra });
  try {
    tracks.sources.status(id, 'scanning');
    if (!(await fs.promises.stat(root).catch(() => null))?.isDirectory()) throw fail('That folder isn’t there. If it’s on a drive, plug it in, then Refresh.');
    const files = await walk(root);
    const old = new Map(tracks.bySource(id).map((t) => [t.path, t]));
    const here = new Set(files);
    for (const t of old.values()) if (!here.has(t.path)) tracks.remove(t.id);
    const pictures = new Map(); // folder -> its best-named picture (tracks.coverRank): { file, rank }
    for (const file of files) {
      const rank = tracks.coverRank(file);
      if (rank > (pictures.get(path.dirname(file))?.rank ?? 0)) pictures.set(path.dirname(file), { file, rank });
    }
    const todo = [];
    for (const file of files.filter(tracks.isAudio)) {
      const stat = await fs.promises.stat(file).catch(() => null);
      const was = old.get(file);
      if (stat && !(was && was.size === stat.size && was.modified === String(stat.mtimeMs))) todo.push({ file, stat, was });
    }
    const covers = new Map(); // folder -> its picture's name in data/covers (read once)
    let read = 0;
    for (const { file, stat, was } of todo) {
      progress({ status: 'reading', read: read++, total: todo.length });
      const rel = path.join(path.basename(root), path.relative(root, file)).split(path.sep).join('/'); // the folder's name first, like a drop
      const song = await readSong(file, rel, id);
      if (!song || tracks.removedAlbums.has(id, song.row.album_id)) continue;
      const sha1 = was?.id ?? (await sha1Of(file).catch(() => null));
      if (!sha1) continue; // gone meanwhile
      const dup = !was && tracks.get(sha1);
      if (dup && (dup.source !== 'local' || within(REAL_MUSIC, file))) continue; // already in your library, or ACRUX's own copy
      if (dup) await dropCopy(dup); // copied in before: it plays from this folder now, and the copy goes (same id)
      const dir = path.dirname(file);
      const picture = pictures.get(dir)?.file;
      if (!covers.has(dir)) covers.set(dir, picture ? fs.promises.readFile(picture).then((b) => tracks.saveCover(b, typeOf(picture)), () => null) : null);
      const cover = (song.pic && tracks.saveCover(song.pic.data, song.pic.format)) || (await covers.get(dir));
      if (!tracks.sources.get(id)) return; // unlinked meanwhile: write nothing
      tracks.put({ ...song.row, id: sha1, source: id, path: file, name: rel, size: stat.size, modified: String(stat.mtimeMs), cover, added: was?.added ?? Date.now() });
      tracks.changed();
    }
    tracks.shareCovers(id);
    tracks.sources.status(id, 'ready', Date.now());
    progress({ status: 'ready', songs: tracks.bySource(id).length });
  } catch (err) {
    const message = err.expose ? err.message : `ACRUX couldn’t read that folder (${err.message}). Refresh to try again.`;
    tracks.sources.status(id, `error: ${message}`);
    progress({ status: 'error', error: message });
  } finally {
    tracks.changed();
  }
}

// Forgets a linked folder: its songs leave ACRUX. The files stay where they are, untouched.
function unlink(id) {
  if (tracks.sources.get(id)?.kind !== 'linked') throw fail('No such folder', 404);
  for (const t of tracks.bySource(id)) tracks.remove(t.id);
  tracks.sources.remove(id);
  tracks.removedAlbums.clear(id);
  tracks.changed();
}

setImmediate(() => { for (const s of tracks.sources.list()) if (s.kind === 'linked') scan(s.id); }); // what changed while ACRUX was off

module.exports = { importRequest, removeAlbum, zipEntries, entryStream, fileOf, dirs, link, scan, unlink };
