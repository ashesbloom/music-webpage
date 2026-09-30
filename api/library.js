// ACRUX library API, mounted by server.js: your music, from this computer and your Google Drive folders.
//   GET  /api/library                      every song (catalog.js groups them into albums and artists), and where
//                                          they come from
//   GET  /api/tracks/:id/audio             a song's sound: from data/music, a linked folder, or through the Drive cache
//   GET  /api/covers/:file                 a cover kept in data/covers
//   POST /api/import?name=&batch=          one dropped file (a song, a folder picture or a .zip) -> { added, skipped }
//   GET  /api/local/dirs?dir=              the folders in a folder of this computer, to pick one to link
//   POST /api/local/link { dir }           play a folder from where it is (nothing copied) -> { id }; read like a Drive
//                                          folder, in the background
//   DELETE /api/albums/:id                 removes an album you added (copied in: its files too; from Drive or a linked
//                                          folder: its link, when the link is just that album; the files stay)
//   GET · POST /api/sources                where your songs come from, the Drive sign-in, cache and settings · add a
//                                          Drive folder { url } (401 { needsAuth } when it takes signing in)
//   POST /api/sources/:id/scan · DELETE /api/sources/:id   look through a Drive or linked folder again · forget it
//   GET /api/drive/connect · /api/drive/callback · POST /api/drive/disconnect   signing in to Google Drive
//   PUT /api/drive/client { id, secret }   the Google sign-in client, pasted on the panel (instead of .env)
//   PUT /api/player/state { ids } · POST /api/player/intent { album }            what the Drive cache fetches ahead
//   GET · PUT /api/settings                cache size (GB), days a song stays cached, upcoming songs to get ready,
//                                          keep a copy of songs from this computer (1) or play them where they are (0)
//   GET /api/events                        live `scan` progress and `library` changes (Server-Sent Events)
// Anything that changes something must come from this site (its Origin), so another site open in your browser can't
// post to it. Adding, removing, settings and listing folders also only work from this computer: with HOST=0.0.0.0,
// phones on your Wi-Fi can play your music but can't change it or look around its disk.
const fs = require('fs');
const { fail, json, sendFile, typeOf, sameSite, loopback } = require('./common');
const tracks = require('./tracks');
const local = require('./local');
const drive = require('./drive');
const cache = require('./cache');

const ROUTES = /^\/api\/(library|tracks|covers|import|local|albums|sources|drive|player|settings|events)(\/|$)/;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
// The address Google sends you back to after signing in: this server as you opened it, if that's a loopback name.
const home = (req) => (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '') ? req.headers.host : `127.0.0.1:${req.socket.localPort}`);

module.exports = async function library(req, res, url) {
  let p; // decoded: the page sends ids like "drive:<id>" encoded ("drive%3A…")
  try { p = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: 'Bad path' }); }
  const m = req.method;
  const read = m === 'GET' || m === 'HEAD';
  const param = (name) => String(url.searchParams.get(name) || '');
  try {
    if (!read && !sameSite(req)) return send(res, 403, { error: 'Only ACRUX itself can do that' });
    const mine = () => { if (!loopback(req)) throw fail('Only on the computer running ACRUX', 403); };

    if (p === '/api/library' && read) {
      return send(res, 200, { tracks: tracks.list(), sources: tracks.sources.list().map(({ id, kind, title, isFile }) => ({ id, kind, title, isFile })) });
    }
    if (p === '/api/events' && m === 'GET') return tracks.subscribe(req, res);

    let hit = /^\/api\/covers\/([^/]+)$/.exec(p);
    if (hit && read) {
      const file = tracks.coverFile(hit[1]);
      const stat = file && (await fs.promises.stat(file).catch(() => null));
      return stat ? sendFile(req, res, file, stat, undefined, 'keep') : send(res, 404, { error: 'No such cover' }); // named after its bytes
    }

    hit = /^\/api\/tracks\/([^/]+)\/audio$/.exec(p);
    if (hit && read) {
      const track = tracks.get(hit[1]);
      if (!track) return send(res, 404, { error: 'No such song' });
      // ?local=1: Song Features' backlog (javascript/features.js) reading it. Only from this computer, never Drive, and
      // it isn't a play (the song's "last played" stays as it was).
      const quiet = url.searchParams.get('local') === '1';
      if (track.source.startsWith('drive:')) {
        if (!quiet) return cache.stream(req, res, track);
        if (!cache.complete(track.id)) return send(res, 409, { error: 'Not on this computer' });
        return sendFile(req, res, cache.fileOf(track.id), fs.statSync(cache.fileOf(track.id)), typeOf(track.name));
      }
      const file = await local.fileOf(track); // only the path kept for this id, never one from the request
      const stat = file && (await fs.promises.stat(file).catch(() => null));
      if (!stat?.isFile()) return send(res, 404, { error: 'That song’s file is gone' });
      if (!quiet) tracks.touch(track.id);
      return sendFile(req, res, file, stat, typeOf(track.name));
    }

    if (p === '/api/import' && m === 'POST') {
      mine();
      return send(res, 200, await local.importRequest(req, param('name'), param('batch').slice(0, 40)));
    }
    if (p === '/api/local/dirs' && read) {
      mine();
      return send(res, 200, await local.dirs(param('dir')));
    }
    if (p === '/api/local/link' && m === 'POST') {
      mine();
      return send(res, 200, await local.link((await json(req))?.dir));
    }
    hit = /^\/api\/albums\/([0-9a-f]{16})$/.exec(p);
    if (hit && m === 'DELETE') {
      mine();
      const [first] = tracks.byAlbum(hit[1]);
      if (!first) return send(res, 404, { error: 'No such album in your library' });
      if (first.source === 'local') return send(res, 200, await local.removeAlbum(hit[1]));
      // From Drive: a link that's just this album goes with it; from a folder of albums, the album alone goes (and
      // stays out of the folder's rescans).
      if (!tracks.sources.get(first.source)) { // its link is gone: only the songs are left to clear
        for (const t of tracks.byAlbum(hit[1])) tracks.remove(t.id);
        tracks.changed();
        return send(res, 200, { removed: hit[1] });
      }
      if (tracks.bySource(first.source).some((t) => t.album_id !== hit[1])) {
        drive.removeAlbum(first.source, hit[1]);
        return send(res, 200, { removed: hit[1] });
      }
      (first.source.startsWith('dir:') ? local.unlink : drive.remove)(first.source);
      return send(res, 200, { removed: first.source });
    }

    if (p === '/api/sources' && read) {
      const [bytes, signIn] = await Promise.all([cache.usage(), drive.status()]);
      return send(res, 200, { sources: tracks.sources.list(), drive: signIn, cache: { bytes }, settings: tracks.settings.get() });
    }
    if (p === '/api/sources' && m === 'POST') {
      mine();
      try {
        return send(res, 200, await drive.add((await json(req))?.url));
      } catch (err) {
        if (err.needsAuth) return send(res, err.status, { error: err.message, needsAuth: true });
        throw err;
      }
    }
    hit = /^\/api\/sources\/((drive|dir):[\w-]+)(\/scan)?$/.exec(p);
    const linked = hit?.[2] === 'dir';
    if (hit && m === 'POST' && hit[3]) {
      mine();
      if (!tracks.sources.get(hit[1])) return send(res, 404, { error: 'No such folder' });
      (linked ? local.scan : drive.scan)(hit[1]);
      return send(res, 202, { scanning: hit[1] });
    }
    if (hit && m === 'DELETE' && !hit[3]) {
      mine();
      (linked ? local.unlink : drive.remove)(hit[1]);
      return send(res, 200, { removed: hit[1] });
    }

    if (p === '/api/drive/connect' && m === 'GET') {
      mine();
      res.writeHead(302, { Location: drive.connectUrl(home(req)), 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (p === '/api/drive/callback' && m === 'GET') {
      mine();
      try {
        await drive.callback(url.searchParams);
        if (process.env.ACRUX_APP) { // the desktop app sent the sign-in to your browser: this tab is done, the app takes over
          process.parentPort?.postMessage('signed-in');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(`<!doctype html><meta charset="utf-8"><title>Google Drive – ACRUX</title><body style="font:16px/1.5 system-ui;background:#111;color:#eee;padding:40px;max-width:640px">
            <p>Google Drive is connected. You can close this tab and go back to ACRUX.</p>`);
        }
        res.writeHead(302, { Location: '/library.html#addmore', 'Cache-Control': 'no-store' });
        return res.end();
      } catch (err) {
        const why = String(err.expose ? err.message : 'Something went wrong.').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
        const link = 'style="color:#ff6b5e"';
        // "Access blocked: ACRUX has not completed the Google verification process": the app is in Testing and the
        // account isn't one of its test users.
        const denied = err.denied ? `<p>If Google said <em>Access blocked: ACRUX has not completed the Google verification process</em>,
          the account you signed in with isn’t one of the app’s test users yet. Open
          <a ${link} href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noopener">Google Auth → Audience</a>,
          add that account’s email under <b>Test users</b>, save, then sign in again. (If you pressed Cancel, just sign in again.)</p>
          <p>This goes for every Google account that signs in to this ACRUX: Google lets only the app’s test users in (up to 100)
          until it has reviewed the app, which a personal copy isn’t.</p>` : '';
        res.writeHead(err.status || 500, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(`<!doctype html><meta charset="utf-8"><title>Google Drive – ACRUX</title><body style="font:16px/1.5 system-ui;background:#111;color:#eee;padding:40px;max-width:640px">
          <p>Google Drive wasn’t connected. ${why}</p>${denied}
          <p><a ${link} href="/api/drive/connect">Sign in again</a> · <a ${link} href="/library.html#addmore">Back to My Music</a></p>`);
      }
    }
    if (p === '/api/drive/client' && m === 'PUT') {
      mine();
      await drive.setClient(await json(req));
      return send(res, 200, await drive.status());
    }
    if (p === '/api/drive/disconnect' && m === 'POST') {
      mine();
      await drive.disconnect();
      res.writeHead(204).end();
      return;
    }

    if (p === '/api/player/state' && m === 'PUT') {
      cache.setUpcoming((await json(req))?.ids);
      res.writeHead(204).end();
      return;
    }
    if (p === '/api/player/intent' && m === 'POST') {
      cache.hint((await json(req))?.album);
      res.writeHead(204).end();
      return;
    }

    if (p === '/api/settings' && read) return send(res, 200, tracks.settings.get());
    if (p === '/api/settings' && m === 'PUT') {
      mine();
      const saved = tracks.settings.set(await json(req));
      cache.evict();
      return send(res, 200, saved);
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    if (err.expose) return send(res, err.status, { error: err.message });
    console.error('Library:', err);
    if (!res.headersSent) send(res, 500, { error: 'Something went wrong' });
    else res.destroy();
  }
};

module.exports.ROUTES = ROUTES;
