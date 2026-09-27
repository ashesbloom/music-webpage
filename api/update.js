// ACRUX updates, for the desktop app (desktop/main.js sets ACRUX_UPDATES=1 when packaged). A release (a pushed v* tag,
// .github/workflows/release.yml) carries ACRUX-files.zip, the app's own folder (pages, player, this server, its
// node_modules), and files.json { version, electron, shell, sha256 }. This checks GitHub at start and every 6 hours,
// downloads the zip into <data>/app/, checks it against GitHub's sha256, unpacks it to <data>/app/<version>/ and points
// <data>/app/current.json at it; desktop/main.js runs the server from there on the next start. The app's shell (Electron
// and desktop/main.js) can't change this way: a release that changes it says "download the new version" instead.
// Settings (settings.js) shows it and asks for the restart.
//   GET /api/app/update                  { enabled, version, latest, status, progress, notes, url, auto, error }
//   POST /api/app/update/check · /download · /restart
//   PUT /api/app/update { auto }         download new versions by itself (default on)
// Only the computer running ACRUX sees or does any of it.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { once } = require('events');
const { pipeline } = require('stream/promises');
const { json, sameSite, loopback } = require('./common');
const tracks = require('./tracks');
const { zipEntries, entryStream } = require('./local');

const ROUTES = /^\/api\/app\/update(\/|$)/;
const API = process.env.ACRUX_UPDATE_API || 'https://api.github.com/repos/ashesbloom/music-webpage/releases/latest';
const DIR = path.join(tracks.DATA, 'app');
const ENABLED = process.env.ACRUX_UPDATES === '1';
const running = {
  version: require('../package.json').version,
  electron: process.versions.electron || '',
  shell: process.env.ACRUX_SHELL || '',
};
// status: idle · checking · available (auto off) · downloading · ready · shell (needs the installer) · error
const state = { status: 'idle', latest: null, progress: 0, notes: '', url: '', error: '' };
let release = null; // the release checked last, and its files.json
let files = null;
const auto = () => tracks.stored.get('updateAuto') !== '0';
const newer = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }) > 0;

// What a release means for this app: nothing new (or nothing it can take: no files.json), a new download of the whole
// app (its shell changed), or files this app can take itself.
function decide(rel, info, run) {
  const latest = String(rel?.tag_name || '').replace(/^v/, '');
  if (!latest || !newer(latest, run.version) || info?.version !== latest) return 'none';
  if (info.electron !== run.electron || info.shell !== run.shell) return 'shell';
  return 'files';
}

// Where a zip entry lands in `dir`, or an error when its name climbs out of it (a hostile zip: "../../x").
function inside(dir, name) {
  const out = path.resolve(dir, name);
  if (!out.startsWith(path.resolve(dir) + path.sep)) throw new Error(`The update has a file outside its folder: ${name}`);
  return out;
}

const asset = (name) => release?.assets?.find((a) => a.name === name);
async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'ACRUX', Accept: 'application/json' }, signal: AbortSignal.timeout(15e3) });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return res.json();
}

async function check() {
  if (!ENABLED || ['checking', 'downloading'].includes(state.status)) return;
  state.status = 'checking';
  try {
    release = await getJson(API);
    const info = asset('files.json');
    files = info ? await getJson(info.browser_download_url).catch(() => null) : null;
    const what = decide(release, files, running);
    Object.assign(state, { latest: String(release.tag_name).replace(/^v/, ''), notes: String(release.body || '').slice(0, 4000), url: release.html_url, error: '' });
    if (what === 'none') state.status = 'idle';
    else if (what === 'shell') state.status = 'shell';
    else if (ready() === state.latest) state.status = 'ready'; // downloaded already, waiting for the restart
    else if (auto()) return download();
    else state.status = 'available';
  } catch (err) {
    Object.assign(state, { status: 'error', error: err.message });
  }
}

async function download() {
  const zip = asset('ACRUX-files.zip');
  const version = state.latest;
  if (!zip || !version || state.status === 'downloading') return;
  Object.assign(state, { status: 'downloading', progress: 0, error: '' });
  const file = path.join(DIR, `${version}.zip`);
  const tmp = path.join(DIR, `${version}.tmp`);
  const dest = path.join(DIR, version);
  try {
    await fs.promises.mkdir(DIR, { recursive: true });
    const res = await fetch(zip.browser_download_url, { headers: { 'User-Agent': 'ACRUX' } });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const total = Number(res.headers.get('content-length')) || zip.size || 0;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(file);
    let got = 0;
    for await (const chunk of res.body) {
      hash.update(chunk);
      got += chunk.length;
      state.progress = total ? got / total : 0;
      if (!out.write(chunk)) await once(out, 'drain');
    }
    out.end();
    await once(out, 'finish');
    const want = String(zip.digest || '').replace(/^sha256:/, '') || files?.sha256;
    if (!want || hash.digest('hex') !== want) throw new Error('The download didn’t match its checksum, so it wasn’t used');
    await fs.promises.rm(tmp, { recursive: true, force: true });
    for (const e of await zipEntries(file)) {
      if (e.name.endsWith('/')) continue;
      const to = inside(tmp, e.name);
      await fs.promises.mkdir(path.dirname(to), { recursive: true });
      await pipeline(await entryStream(file, e), fs.createWriteStream(to));
    }
    const pkg = JSON.parse(await fs.promises.readFile(path.join(tmp, 'package.json'), 'utf8'));
    if (pkg.version !== version || !fs.existsSync(path.join(tmp, 'server.js'))) throw new Error('The update isn’t a whole ACRUX');
    await fs.promises.rm(dest, { recursive: true, force: true });
    await fs.promises.rename(tmp, dest);
    await fs.promises.writeFile(path.join(DIR, 'current.json'), JSON.stringify({ version }));
    Object.assign(state, { status: 'ready', progress: 1 });
    process.parentPort?.postMessage('update-ready');
  } catch (err) {
    Object.assign(state, { status: 'error', error: err.message });
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
  } finally {
    await fs.promises.rm(file, { force: true }).catch(() => {});
  }
}

// The version downloaded and waiting for a restart, if any.
function ready() {
  try {
    const { version } = JSON.parse(fs.readFileSync(path.join(DIR, 'current.json'), 'utf8'));
    return newer(version, running.version) && fs.existsSync(path.join(DIR, version, 'server.js')) ? version : null;
  } catch { return null; }
}

// Once this version runs, the older ones (and anything half-done) go; the one waiting for a restart stays.
async function tidy() {
  const keep = new Set([running.version, ready(), 'current.json', 'bad.json']);
  for (const name of await fs.promises.readdir(DIR).catch(() => [])) {
    if (!keep.has(name)) await fs.promises.rm(path.join(DIR, name), { recursive: true, force: true }).catch(() => {});
  }
}

if (ENABLED) {
  if (ready()) Object.assign(state, { status: 'ready', latest: ready() });
  setTimeout(() => { tidy(); check(); }, 10e3).unref();
  setInterval(check, 6 * 36e5).unref();
}

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
const view = () => ({ enabled: ENABLED, version: running.version, auto: auto(), ...state });

module.exports = async function update(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  if (!loopback(req)) return send(res, 403, { error: 'Only on the computer running ACRUX' });
  if (m !== 'GET' && !sameSite(req)) return send(res, 403, { error: 'Only ACRUX itself can do that' });
  if (p === '/api/app/update' && m === 'GET') return send(res, 200, view());
  if (p === '/api/app/update' && m === 'PUT') {
    const body = await json(req).catch(() => null);
    if (typeof body?.auto === 'boolean') tracks.stored.set('updateAuto', body.auto ? '1' : '0');
    if (body?.auto && state.status === 'available') download();
    return send(res, 200, view());
  }
  if (p === '/api/app/update/check' && m === 'POST') { check(); return send(res, 200, view()); }
  if (p === '/api/app/update/download' && m === 'POST') { download(); return send(res, 200, view()); }
  if (p === '/api/app/update/restart' && m === 'POST') {
    if (state.status !== 'ready') return send(res, 409, { error: 'No update is waiting' });
    process.parentPort?.postMessage('restart');
    return send(res, 200, view());
  }
  send(res, 404, { error: 'Not found' });
};
module.exports.ROUTES = ROUTES;
module.exports.ready = () => ENABLED && !!ready();
module.exports.decide = decide; // tests/update.test.js
module.exports.inside = inside;
