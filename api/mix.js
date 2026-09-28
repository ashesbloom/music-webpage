// ACRUX Auto Mix: each song's analysis (javascript/automix-analyze.js works it out in the page, once: its beats, bars,
// key, loudness and structure), kept here so a song is analysed once on any device, and the summaries queue.js ranks
// Infinite's songs by.
//   GET  /api/mix/:id                 the analysis; 404 until there is one
//   PUT  /api/mix/:id                 keep one (JSON from the analyser, 64 KB at most)
//   POST /api/mix/summaries {ids}     {id: {bpm, camelot, lufs, energy}} for the ones analysed (100 at most)
const { db } = require('./db');
const { json, sameSite } = require('./common');

const ROUTES = /^\/api\/mix\//;
const VERSION = 1; // automix-analyze.js's VERSION: older analyses are made again
db.exec('CREATE TABLE IF NOT EXISTS mix (id TEXT PRIMARY KEY, bpm REAL, camelot TEXT, lufs REAL, energy REAL, body TEXT NOT NULL, at INTEGER NOT NULL)');
const getOne = db.prepare('SELECT body FROM mix WHERE id = ?');
const getSummary = db.prepare('SELECT bpm, camelot, lufs, energy FROM mix WHERE id = ?');
const putOne = db.prepare('INSERT OR REPLACE INTO mix (id, bpm, camelot, lufs, energy, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)');

const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const list = (a, ok, max = 20000) => Array.isArray(a) && a.length <= max && a.every(ok);
// Only what the analyser makes, with every field the page mixes from (automix.js plan(), trim()) in range: a
// malformed one (sent by anyone on an invite link) could otherwise put NaN into the sound.
const valid = (a) => a?.v === VERSION && num(a.dur, 0, 7200) && num(a.start, 0, 7200) && num(a.end, 0, 7200)
  && num(a.lufs, -80, 10) && num(a.peakDb, -120, 20) && num(a.bpm, 0, 300) && typeof a.beat === 'boolean'
  && typeof a.steady === 'boolean' && typeof a.cold === 'boolean' && num(a.energy, 0, 1)
  && num(a.startDb, -200, 200) && num(a.endDb, -200, 200) && int(a.downbeat, 0, 3) && num(a.downbeatConf, -100, 100)
  && int(a.phraseOffset, 0, 7) && int(a.nbars, 0, 5000) && int(a.intro, 0, 5000) && int(a.outro, 0, 5000)
  && (a.grid === null || (num(a.grid?.t0, -10, 7200) && num(a.grid?.period, 0.2, 2)))
  && (a.beats === null || list(a.beats, (t) => num(t, -10000, 7.2e6)))
  && (a.key === null || /^(1[0-2]|[1-9])[AB]$/.test(a.key?.camelot))
  && (a.fade === null || num(a.fade?.start, 0, 7200))
  && list(a.bars?.energy, (v) => num(v, -200, 200), 5000) && list(a.bars?.busy, (v) => v === 0 || v === 1, 5000)
  && list(a.bars?.loose, (v) => v === 0 || v === 1, 5000);

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body));
};

module.exports = async function mix(req, res, url) {
  const m = req.method;
  if (m !== 'GET' && !sameSite(req)) return send(res, 403, { error: 'Only ACRUX itself can do that' });
  try {
    if (url.pathname === '/api/mix/summaries' && m === 'POST') {
      const ids = (await json(req))?.ids;
      const out = {};
      for (const id of Array.isArray(ids) ? ids.slice(0, 100) : []) {
        const row = typeof id === 'string' && getSummary.get(id);
        if (row) out[id] = { ...row };
      }
      return send(res, 200, out);
    }
    let id;
    try { id = decodeURIComponent(url.pathname.slice('/api/mix/'.length)); } catch { id = ''; }
    if (!id || id.length > 300) return send(res, 400, { error: 'Which song?' });
    if (m === 'GET') {
      const row = getOne.get(id);
      return row ? send(res, 200, row.body) : send(res, 404, { error: 'Not analysed yet' });
    }
    if (m === 'PUT') {
      const a = await json(req);
      const body = JSON.stringify(a);
      if (!valid(a) || body.length > 65536) return send(res, 400, { error: 'Not an analysis' });
      putOne.run(id, a.bpm, a.key?.camelot ?? null, a.lufs, a.energy, body, Date.now());
      return send(res, 200, { ok: true });
    }
    send(res, 405, { error: 'Method Not Allowed' });
  } catch (err) {
    send(res, err.status || 500, { error: err.expose ? err.message : 'Something went wrong' });
  }
};
module.exports.ROUTES = ROUTES;
