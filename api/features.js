// ACRUX Song Features: what each song gives (javascript/features-worker.js works it out in the page, once), kept here
// for every part of ACRUX that wants it (Auto Mix, a visualizer…), on any device.
//   GET  /api/features/:id          the summary (rhythm, sections, key, loudness…); 404 until there is one
//   GET  /api/features/:id/frames   the per-frame measures and matrices (the "ACXF" binary, gzipped); 404 until there are some
//   PUT  /api/features/:id          keep a summary (JSON, 1 MB at most)
//   PUT  /api/features/:id/frames   keep its frames (binary, 16 MB at most); sent before the summary
//   GET  /api/features/missing?limit=  the songs on this computer with none yet, most played first: { songs: [{ id, src }] }
//                                   (your files, fully cached Drive songs, Discover songs kept offline), for the backlog
// Only this computer and your paired devices may keep any (a guest on an invite link may not: frames are large).
// ponytail: a removed song's features stay (about 0.5 MB each); prune them when the library changes if that adds up.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { promisify } = require('util');
const { db } = require('./db');
const { json, loopback } = require('./common');
const tracks = require('./tracks');
const cache = require('./cache');

const ROUTES = /^\/api\/features(\/|$)/;
const VERSION = 1; // features-worker.js's FEATURES_VERSION: older features are made again
const DIR = path.join(tracks.DATA, 'features');
fs.mkdirSync(DIR, { recursive: true });
db.exec('CREATE TABLE IF NOT EXISTS features (id TEXT PRIMARY KEY, v INTEGER NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL)');
const getOne = db.prepare('SELECT v, body, at FROM features WHERE id = ?');
const putOne = db.prepare('INSERT OR REPLACE INTO features (id, v, body, at) VALUES (?, ?, ?, ?)');
const current = db.prepare('SELECT id FROM features WHERE v = ?');
const fileOf = (id) => path.join(DIR, `${crypto.createHash('sha1').update(id).digest('hex')}.bin.gz`);
const gzip = promisify(zlib.gzip);

const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const ints = (a, max) => Array.isArray(a) && a.length <= max && a.every((t) => Number.isInteger(t) && t >= 0 && t <= 7.2e6);
// The shape the Worker makes, with its lists bounded: whoever reads it (a visualizer) can trust it.
const valid = (f) => f?.v === VERSION && num(f.dur, 0, 7200)
  && (f.rhythm === null || (typeof f.rhythm === 'object' && ints(f.rhythm.beats, 50000) && ints(f.rhythm.downbeats, 20000)
    && (f.rhythm.meter === null || Number.isInteger(f.rhythm.meter)) && Array.isArray(f.rhythm.tempo) && f.rhythm.tempo.length <= 20000))
  && ints(f.onsets, 50000) && Array.isArray(f.sections) && f.sections.length <= 1000
  && f.sections.every((s) => num(s.start, 0, 7200) && num(s.end, 0, 7200) && typeof s.label === 'string' && s.label.length <= 2)
  && typeof f.loudness === 'object' && f.loudness !== null;

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body === undefined ? '' : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
async function raw(req, max) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > max) throw Object.assign(new Error('Too large'), { status: 413, expose: true });
    parts.push(part);
  }
  return Buffer.concat(parts);
}

// The songs fully on this computer with no features yet, most played (then most recently added) first.
function missing(limit) {
  const done = new Set(current.all(VERSION).map((r) => r.id));
  const out = [];
  const lib = tracks.list().filter((t) => !done.has(`lib:${t.id}`) && (!t.source.startsWith('drive:') || cache.complete(t.id)))
    .sort((a, b) => (b.used || 0) - (a.used || 0) || (b.added || 0) - (a.added || 0));
  for (const t of lib) out.push({ id: `lib:${t.id}`, src: `/api/tracks/${encodeURIComponent(t.id)}/audio?local=1` });
  try { // Discover songs kept offline (api/collection.js's table)
    for (const { key } of db.prepare("SELECT key FROM offline WHERE kind = 'web' AND status = 'done' ORDER BY at DESC").all()) {
      if (!done.has(key)) out.push({ id: key, src: `/api/offline/${encodeURIComponent(key)}/audio` });
    }
  } catch {}
  return out.slice(0, limit);
}

module.exports = async function features(req, res, url) {
  const m = req.method;
  try {
    const mine = () => loopback(req) || !!require('./collection').deviceOf(req); // this computer, or a paired device
    if (url.pathname === '/api/features/missing' && m === 'GET') {
      if (!loopback(req)) return send(res, 403, { error: 'Only on the computer running ACRUX' });
      return send(res, 200, { songs: missing(Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100)) });
    }
    const hit = /^\/api\/features\/([^/]+)(\/frames)?$/.exec(url.pathname);
    let id;
    try { id = hit && decodeURIComponent(hit[1]); } catch { id = null; }
    if (!id || id.length > 300) return send(res, 400, { error: 'Which song?' });
    if (m === 'GET' && !hit[2]) {
      const row = getOne.get(id);
      return row ? send(res, 200, row.body) : send(res, 404, { error: 'Not worked out yet' });
    }
    if (m === 'GET') {
      const row = getOne.get(id);
      const file = fileOf(id);
      if (!row || !fs.existsSync(file)) return send(res, 404, { error: 'Not worked out yet' });
      const etag = `"${row.v}-${row.at}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
      const zipped = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      const body = await fs.promises.readFile(file);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag, ...(zipped ? { 'Content-Encoding': 'gzip' } : {}) });
      return res.end(zipped ? body : zlib.gunzipSync(body));
    }
    if (m === 'PUT') {
      if (!mine()) return send(res, 403, { error: 'Only ACRUX on this computer or your devices can do that' });
      if (hit[2]) {
        const body = await raw(req, 16e6);
        if (body.length < 12 || body.toString('latin1', 0, 4) !== 'ACXF' || body[4] !== VERSION) return send(res, 400, { error: 'Not a frames file' });
        const file = fileOf(id), tmp = `${file}.${process.pid}.tmp`;
        await fs.promises.writeFile(tmp, await gzip(body));
        await fs.promises.rename(tmp, file);
        return send(res, 200, { ok: true });
      }
      const f = await json(req);
      const body = JSON.stringify(f);
      if (!valid(f) || body.length > 1e6) return send(res, 400, { error: 'Not a song’s features' });
      putOne.run(id, VERSION, body, Date.now());
      return send(res, 200, { ok: true });
    }
    send(res, 405, { error: 'Method Not Allowed' });
  } catch (err) {
    if (!res.headersSent) send(res, err.status || 500, { error: err.expose ? err.message : 'Something went wrong' });
    if (!err.expose) console.error('Song Features:', err);
  }
};
module.exports.ROUTES = ROUTES;
module.exports.missing = missing;
