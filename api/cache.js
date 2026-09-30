// The Drive cache: each song's bytes from its start, as far as they've been fetched (data/drive-cache/<file id>; the
// file's size is how far). ACRUX's player reads a song from its first byte to its last, so the start is all the cache
// keeps: a song plays from here while the rest streams in from Drive, and every byte is fetched once.
// What gets fetched, most urgent first:
//   1. songs being played (the current one; a page fetches your next song only when it asks, like Auto Mix will): at once;
//   2. the start (tags and ~10 s of sound) of the next few songs in your queue (PUT /api/player/state), so skipping
//      to them starts at once;
//   3. the start of the first two songs of the last two albums you opened (POST /api/player/intent).
//   4. songs you downloaded (kept for offline play, api/collection.js): whole, and never trimmed.
// 2 to 4 download one at a time, only while no song is being played in, and a song being played stops them (what
// they got is kept; they carry on from there later), each taking its turn with Drive (api/drive.js). Songs leave after
// the keep time you pick on the Add More panel (a week since you last played them, at first), and past the size cap the
// songs played longest ago go first.
// ponytail: one connection per song; parallel ranged chunks if one Drive connection can't fill a fast line.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { setTimeout: sleep } = require('timers/promises');
const { sendFile, typeOf } = require('./common');
const tracks = require('./tracks');
const drive = require('./drive');

const DIR = path.join(tracks.DATA, 'drive-cache');
fs.mkdirSync(DIR, { recursive: true });
const fileOf = (id) => path.join(DIR, id.replace(/[^\w-]/g, '_')); // Drive ids are [\w-] already

// A song's download: { track, have (bytes on disk), upto (wanted: Infinity = all), running, ctrl, readers, error }.
const jobs = new Map();
function job(track) {
  let j = jobs.get(track.id);
  if (!j) {
    let have = 0;
    try { have = fs.statSync(fileOf(track.id)).size; } catch {}
    j = { track, have, upto: 0, running: false, ctrl: null, readers: 0, error: null, events: new EventEmitter().setMaxListeners(0) };
    jobs.set(track.id, j);
  }
  j.track = track;
  return j;
}

const cooling = new Map(); // file id -> until when Drive refused it (quota, throttling): background fetches skip it

// Fetches a song's bytes up to j.upto, appended to its file, carrying on from what's there. `running` is set before
// the first wait, so callers can check it straight after.
async function run(j) {
  if (j.running) return;
  j.running = true;
  j.error = null;
  let fh;
  try {
    fh = await fs.promises.open(fileOf(j.track.id), 'a');
    let tries = 0; // in a row without new bytes
    while (j.have < Math.min(j.upto, j.track.size)) {
      const end = j.upto >= j.track.size ? '' : j.upto - 1;
      j.ctrl = new AbortController();
      let got = 0;
      try {
        const res = await drive.media(j.track, `bytes=${j.have}-${end}`, j.ctrl.signal, !j.readers); // no listener yet: it takes its turn
        if (res.status === 200 && j.have > 0) { // the range was ignored: the whole file is coming
          await fh.truncate(0);
          j.have = 0;
        }
        for await (const chunk of res.body) {
          await fh.write(chunk);
          got += chunk.length;
          j.have += chunk.length;
          j.events.emit('data');
        }
        if (!got) throw new Error('Drive sent nothing');
      } catch (err) {
        // Dropped midway (a weak network) while someone's listening: carry on from the bytes on disk, not from scratch.
        if (got) tries = 0;
        if (j.ctrl.signal.aborted || err.expose || !j.readers || ++tries > 5) throw err;
        await sleep(2 ** (tries - 1) * 1000, undefined, { signal: j.ctrl.signal });
        continue;
      }
      tries = 0;
    }
  } catch (err) {
    if (!j.ctrl?.signal.aborted) {
      j.error = err;
      cooling.set(j.track.id, Date.now() + 5 * 60e3);
      console.error('Drive cache:', j.track.name, '-', err.message, err.cause?.code || err.cause?.message || '');
    }
  } finally {
    await fh?.close().catch(() => {});
    j.running = false;
    j.ctrl = null;
    j.events.emit('data'); // wakes readers: done, stopped or failed
    if (j.have >= j.track.size) tracks.emit('collection', {}); // a song is whole: downloaded, or cached (Your Downloaded Songs)
    pump();
    evict();
  }
}

// Until res can take more (or the listener left).
const drained = (res) => new Promise((done) => {
  const go = () => { res.off('drain', go); res.off('close', go); done(); };
  res.on('drain', go);
  res.on('close', go);
});

// GET /api/tracks/:id/audio for a Drive song: a complete one from disk (byte ranges too), else the whole song as it
// comes: what's cached at once, then the rest as it arrives from Drive.
async function stream(req, res, track) {
  tracks.touch(track.id);
  const file = fileOf(track.id);
  const j = job(track);
  if (j.have >= track.size && !j.running) return sendFile(req, res, file, fs.statSync(file), typeOf(track.name));
  if (drive.held() && j.have < track.size) { // Drive won't send the rest for now: say so at once (the page shows it), not stall midway
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ error: 'Google Drive is holding back downloads for now', held: true }));
  }
  res.writeHead(200, { 'Content-Type': typeOf(track.name), 'Content-Length': track.size, 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') return res.end();
  j.readers++;
  for (const other of jobs.values()) if (other !== j && other.running && !other.readers) other.ctrl?.abort(); // it waits its turn
  fs.closeSync(fs.openSync(file, 'a')); // exists before it's read
  j.upto = Infinity;
  run(j);
  let gone = false;
  res.on('close', () => { gone = true; j.events.emit('data'); });
  let fh;
  try {
    fh = await fs.promises.open(file, 'r');
    let pos = 0;
    while (!gone && pos < track.size) {
      if (pos < j.have) {
        const buf = Buffer.allocUnsafe(Math.min(256 * 1024, j.have - pos)); // a new one each time: res may still hold the last
        const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
        if (!bytesRead) throw new Error('the cached file shrank');
        pos += bytesRead;
        if (!res.write(buf.subarray(0, bytesRead))) await drained(res);
      } else if (!j.running) {
        if (j.error) throw j.error;
        j.upto = Infinity;
        run(j); // stopped by someone else leaving: go on
      } else {
        await new Promise((done) => j.events.once('data', done));
      }
    }
    if (!gone) res.end();
  } catch (err) {
    console.error('Drive stream:', track.name, '-', err.message, err.cause?.code || err.cause?.message || '');
    res.destroy(); // the player sees the song fail and says so
  } finally {
    await fh?.close().catch(() => {});
    if (--j.readers === 0 && j.running) { // nobody's listening: stop, keeping what came
      j.upto = 0;
      j.ctrl?.abort();
    }
    pump();
  }
}

// ---------- ahead of time ----------

let upcoming = []; // Drive song ids in the order they'll play, the one playing first
let hints = [];    // album ids opened lately, newest last
function targets() {
  const k = tracks.settings.get().prefetch;
  return [...upcoming.slice(0, k + 1), ...hints.flatMap((a) => tracks.byAlbum(a).slice(0, 2).map((t) => t.id))];
}

// Starts the next song start that's missing, if nothing is downloading (and Drive isn't holding downloads back).
function pump() {
  if (drive.held()) return;
  for (const j of jobs.values()) if (j.running) return;
  for (const id of targets()) {
    if ((cooling.get(id) || 0) > Date.now()) continue;
    const t = tracks.get(id);
    if (!t?.source.startsWith('drive:')) continue;
    const j = job(t);
    const head = Math.min(t.head || 2e6, t.size);
    if (j.have >= head) continue;
    j.upto = Math.max(j.upto, head);
    run(j);
    return;
  }
  for (const id of kept) {
    if ((cooling.get(id) || 0) > Date.now()) continue;
    const t = tracks.get(id);
    if (!t?.source.startsWith('drive:')) continue;
    const j = job(t);
    if (j.have >= t.size) continue;
    j.upto = Infinity;
    run(j);
    return;
  }
}

// Songs you downloaded: fetched whole in turn (after the starts above) and never trimmed.
let kept = new Set();
function setKept(ids) {
  kept = new Set(ids);
  pump();
}
const complete = (id) => {
  const t = tracks.get(id);
  try { return !!t && fs.statSync(fileOf(id)).size >= t.size; } catch { return false; }
};

// A Drive song's whole file on disk (Save to computer, a ZIP), fetching what's missing first.
async function whole(track) {
  const j = job(track);
  j.readers++; // like a listener: nothing else stops it
  let tried = false;
  try {
    while (j.have < track.size) {
      if (!j.running) {
        if (tried && j.error) throw j.error;
        tried = true;
        j.upto = Infinity;
        run(j);
      }
      await new Promise((done) => j.events.once('data', done));
    }
  } finally {
    j.readers--;
  }
  return fileOf(track.id);
}

// PUT /api/player/state { ids }: the songs coming up. Starts no longer wanted stop.
function setUpcoming(ids) {
  upcoming = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && /^[\w-]{1,100}$/.test(id)).slice(0, 20);
  const wanted = new Set(targets());
  for (const j of jobs.values()) if (j.running && !j.readers && !wanted.has(j.track.id)) j.ctrl?.abort();
  pump();
}

// POST /api/player/intent { album }: an album page opened, so its first songs may be next.
function hint(album) {
  if (typeof album !== 'string' || !/^[0-9a-f]{16}$/.test(album)) return;
  hints = [...hints.filter((a) => a !== album), album].slice(-2);
  pump();
}

// ---------- size ----------

// The cached songs: { id, size, last } (last: when last played, else when its bytes last came in).
async function files() {
  const names = await fs.promises.readdir(DIR);
  return Promise.all(names.map(async (id) => {
    const stat = await fs.promises.stat(fileOf(id)).catch(() => ({ size: 0, mtimeMs: 0 }));
    return { id, size: stat.size, last: Math.max(tracks.get(id)?.used || 0, stat.mtimeMs) };
  }));
}
// Whole songs in the cache you didn't download (Your Downloaded Songs, api/collection.js): { id: 'lib:<id>', until },
// until = when it leaves if not played again (evict's rule), null with no keep time (it stays until the cache fills).
function cachedSongs() {
  const { keepDays } = tracks.settings.get();
  return fs.readdirSync(DIR).flatMap((id) => {
    const t = tracks.get(id);
    if (!t || kept.has(id)) return [];
    let stat;
    try { stat = fs.statSync(fileOf(id)); } catch { return []; }
    if (stat.size < t.size) return [];
    const last = Math.max(t.used || 0, stat.mtimeMs);
    return [{ id: `lib:${id}`, until: keepDays ? last + keepDays * 864e5 : null }];
  });
}
const usage = async () => (await files()).reduce((sum, f) => sum + f.size, 0);

// Removes songs not played for the keep time (the Add More panel's "Keep songs for"), then, over the size cap, the
// songs played longest ago until the cache is a tenth under it, so it isn't trimmed again after every song. Songs
// playing, downloading or coming up stay. Runs after each download, at start and every hour.
let evicting = false;
async function evict() {
  if (evicting) return;
  evicting = true;
  let removed = false; // songs Your Downloaded Songs shows: it's told they left
  try {
    const { cacheGB, keepDays } = tracks.settings.get();
    const cap = cacheGB * 1e9;
    const keep = new Set([...targets(), ...kept, ...[...jobs.values()].filter((j) => j.running || j.readers).map((j) => j.track.id)]);
    const gone = async (f) => {
      await fs.promises.rm(fileOf(f.id), { force: true });
      jobs.delete(f.id);
      if (f.size) removed = true;
    };
    let all = await files();
    for (const f of all) if (!f.size && !keep.has(f.id)) await gone(f); // a play cut off before any sound came
    all = all.filter((f) => f.size || keep.has(f.id));
    if (keepDays) {
      const before = Date.now() - keepDays * 864e5;
      for (const f of all) if (f.last < before && !keep.has(f.id)) await gone(f);
      all = all.filter((f) => f.last >= before || keep.has(f.id));
    }
    let total = all.reduce((sum, f) => sum + f.size, 0);
    if (total <= cap) return;
    for (const f of all.sort((a, b) => a.last - b.last)) {
      if (total <= cap * 0.9) break;
      if (keep.has(f.id)) continue;
      await gone(f);
      total -= f.size;
    }
  } catch (err) {
    console.error('Drive cache: trimming -', err.message);
  } finally {
    evicting = false;
    if (removed) tracks.emit('collection', {});
  }
}

// Forgets a song's cached bytes (it changed in Drive, or its folder was removed).
function drop(id) {
  jobs.get(id)?.ctrl?.abort();
  jobs.delete(id);
  fs.rmSync(fileOf(id), { force: true });
}

setTimeout(evict, 5e3).unref(); // at start, once the server is up
setInterval(evict, 36e5).unref();

module.exports = { stream, setUpcoming, hint, usage, evict, drop, setKept, complete, whole, cachedSongs };
