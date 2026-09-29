// Your Google Drive folders as music. Paste a folder's link: ACRUX lists it (and every folder inside), reads each
// song's tags from the start of the file, and plays the songs through the local cache (api/cache.js).
// Access: a folder shared by link opens with an API key (GOOGLE_API_KEY, else YOUTUBE_API_KEY, from the same Google
// Cloud project with the Drive API enabled). A private folder needs you signed in: an OAuth desktop client
// (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET), read-only access, its refresh token kept in the macOS Keychain (a 0600
// file in data/ elsewhere).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { setTimeout: sleep } = require('timers/promises');
const { parseBuffer } = require('music-metadata');
const { fail, typeOf } = require('./common');
const tracks = require('./tracks');

const API = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const apiKey = () => require('./keys').key('drive');
// The OAuth client for signing in: from .env, else the one pasted on the Add More panel (kept in data/acrux.db; a
// desktop app's client secret isn't secret in Google's sense, it only names the app).
const client = () => {
  const id = process.env.GOOGLE_CLIENT_ID || tracks.stored.get('googleClientId');
  const secret = process.env.GOOGLE_CLIENT_SECRET || tracks.stored.get('googleClientSecret');
  return id && secret ? { client_id: id, client_secret: secret } : null;
};

// ---------- links ----------

// A link as Drive gives it -> { id, resourceKey }: a folder (drive/folders/<id>, also /u/0/…, shared drives,
// ?usp=sharing), a file (file/d/<id>/view), open?id= or uc?id=, or the bare id. Whether it's a song, an album or a
// folder of albums is found out from Drive (add, then the scan). Older link-shared items also need their resourcekey.
function parseLink(text) {
  const s = String(text || '').trim();
  if (/^[\w-]{10,}$/.test(s)) return { id: s, resourceKey: null };
  let url;
  try { url = new URL(s); } catch { throw fail('Paste the link of a song or a folder in Google Drive', 400); }
  if (!/(^|\.)google\.com$/.test(url.hostname)) throw fail('That isn’t a Google Drive link', 400);
  if (/\/(document|spreadsheets|presentation|forms)\/d\//.test(url.pathname)) throw fail('That’s a Google Docs link. Paste the link of a song or a folder of songs.', 400);
  const id = /\/(?:folders|file\/d)\/([\w-]{10,})/.exec(url.pathname)?.[1] || url.searchParams.get('id');
  if (!id || !/^[\w-]{10,}$/.test(id)) throw fail('Paste the link of a song or a folder in Google Drive', 400);
  return { id, resourceKey: url.searchParams.get('resourcekey') };
}

// ---------- your Google sign-in ----------

const KEYCHAIN = process.platform === 'darwin';
// ponytail: off the Mac the token is a plain file in your data folder (the app's is %APPDATA%\ACRUX, only your account
// can read it); move it to Electron's safeStorage through desktop/main.js if that isn't enough.
const TOKEN_FILE = path.join(tracks.DATA, 'google-drive-token');
const security = (args) => new Promise((done, failed) => execFile('security', args, (err, out) => (err ? failed(err) : done(out.trim()))));
const saved = {
  get: () => (KEYCHAIN ? security(['find-generic-password', '-s', 'ACRUX', '-a', 'google-drive', '-w'])
    : fs.promises.readFile(TOKEN_FILE, 'utf8').then((t) => t.trim())).catch(() => null),
  set: (t) => (KEYCHAIN ? security(['add-generic-password', '-U', '-s', 'ACRUX', '-a', 'google-drive', '-w', t])
    : fs.promises.writeFile(TOKEN_FILE, t, { mode: 0o600 })),
  clear: () => (KEYCHAIN ? security(['delete-generic-password', '-s', 'ACRUX', '-a', 'google-drive'])
    : fs.promises.rm(TOKEN_FILE, { force: true })).catch(() => {}),
};
let refresh; // the refresh token (undefined until read, null when there is none)
let access = null; // { token, expires }
let refreshing = null;
let expired = false; // Google refused the saved sign-in: the panel asks to reconnect
// A sign-in this ACRUX can use: the desktop app and a dev server share the Keychain slot, not the client that goes with it.
const connected = async () => !!client() && !!(refresh === undefined ? (refresh = await saved.get()) : refresh);

// A current access token, renewed from the refresh token a minute before it runs out.
async function bearer() {
  if (access && access.expires > Date.now() + 60e3) return access.token;
  refreshing ??= (async () => {
    if (!(await connected()) || !client()) throw Object.assign(fail('Connect Google Drive to open this folder', 401), { needsAuth: true });
    const res = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams({ ...client(), refresh_token: refresh, grant_type: 'refresh_token' }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (body.error === 'invalid_grant') { // revoked, or a test-mode app's week is up
        expired = true;
        refresh = null;
        await saved.clear();
        throw Object.assign(fail('Your Google Drive sign-in ran out. Connect Google Drive again.', 401), { needsAuth: true });
      }
      throw fail('Google didn’t renew the sign-in. Try again in a moment.', 502);
    }
    access = { token: body.access_token, expires: Date.now() + body.expires_in * 1000 };
    return access.token;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

// The sign-in, as Google's loopback flow for desktop apps (with PKCE): connectUrl() sends you to Google, which comes
// back to /api/drive/callback on this computer with a code, swapped here for the tokens.
const pending = new Map(); // state -> { verifier, redirect, at }
const b64url = (buf) => buf.toString('base64url');
function connectUrl(host) {
  if (!client()) throw fail('To open private folders, add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (an OAuth client of type “Desktop app”) to .env, then restart ACRUX.', 400);
  const state = b64url(crypto.randomBytes(16));
  const verifier = b64url(crypto.randomBytes(32));
  const redirect = `http://${host}/api/drive/callback`;
  pending.set(state, { verifier, redirect, at: Date.now() });
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: client().client_id, redirect_uri: redirect, response_type: 'code', scope: SCOPE, state, access_type: 'offline', prompt: 'consent',
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
  })}`;
}
async function callback(params) {
  const state = params.get('state');
  const p = pending.get(state);
  pending.delete(state);
  if (params.get('error') === 'access_denied') { // you pressed Cancel, or Google blocked an account that isn't a test user
    throw Object.assign(fail('Google didn’t give ACRUX access.', 403), { denied: true });
  }
  if (params.get('error')) throw fail(`Google said: ${params.get('error')}`, 400);
  if (!p || Date.now() - p.at > 10 * 60e3) throw fail('That sign-in took too long or came from elsewhere. Try Connect again.', 400);
  const res = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams({
    ...client(), code: params.get('code') || '', redirect_uri: p.redirect, grant_type: 'authorization_code', code_verifier: p.verifier,
  }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.refresh_token) throw fail('Google didn’t give ACRUX access. Try again.', 502);
  await saved.set(body.refresh_token);
  refresh = body.refresh_token;
  access = { token: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  expired = false;
  tracks.emit('drive', {}); // open pages (setup, Add More) show the sign-in now: the app's window may not reload
}
async function disconnect() {
  const token = refresh ?? (await saved.get());
  if (token) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
  await saved.clear();
  refresh = null;
  access = null;
  tracks.emit('drive', {});
}
// Google holds back downloads made with an API key when too many come from one computer (it answers with its "automated
// queries" page); signed-in downloads are held back far less. While it lasts, nothing is fetched ahead.
let heldUntil = 0;
const HELD = 'Google Drive is holding back downloads from this computer for now (too many in a row with the API key). It passes on its own, usually within the hour. Connecting Google Drive avoids it: signed-in downloads aren’t held back like this.';
const held = () => heldUntil > Date.now() && !(refresh && client()); // as downloadAs(): signed in only with the client
// PUT /api/drive/client { id, secret }: the client made in Google Cloud (Desktop app). A new one signs you out of the
// old one's access first.
async function setClient(body) {
  const id = String(body?.id || '').trim();
  const secret = String(body?.secret || '').trim();
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) throw fail('That isn’t a Client ID: it ends in .apps.googleusercontent.com.', 400);
  if (!/^[\w-]{10,100}$/.test(secret)) throw fail('That isn’t a client secret: it usually starts with GOCSPX-.', 400);
  if (client()?.client_id !== id && (await connected())) await disconnect();
  tracks.stored.set('googleClientId', id);
  tracks.stored.set('googleClientSecret', secret);
}
const status = async () => ({ key: !!apiKey(), client: !!client(), connected: await connected(), expired,
  held: held() ? Math.ceil((heldUntil - Date.now()) / 60e3) : 0 });

// ---------- requests ----------

// Downloads with the API key take turns: one nobody is waiting on (fetching ahead, reading tags in a scan) starts at
// least GAP after the previous one; a song being played starts at once, and the next background one waits after it.
// ponytail: one fixed gap, as Google doesn't publish when it holds a computer back; raise GAP if it still does.
const GAP = 3000;
let nextSlot = 0;
async function turn(paced, signal) {
  const wait = paced ? Math.max(0, nextSlot - Date.now()) : 0;
  nextSlot = Math.max(nextSlot, Date.now()) + GAP;
  if (wait) await sleep(wait, undefined, { signal });
}

// A Drive API call with a folder's access ('key' or 'oauth'). Busy answers (429, 5xx, rate limits) are retried with a
// growing, jittered wait, five tries in all; anything else throws with .status and Google's .reason.
// paced: a download nobody is waiting on, which takes its turn (above).
async function request(p, { auth, keys = [], range, signal, paced = false } = {}) {
  const url = new URL(API + p);
  url.searchParams.set('supportsAllDrives', 'true');
  if (auth !== 'oauth' && p.includes('alt=media')) await turn(paced, signal); // signed-in downloads are held back far less
  for (let tries = 0; ; tries++) {
    const headers = { 'User-Agent': 'ACRUX/1.0' };
    if (auth === 'oauth') headers.Authorization = `Bearer ${await bearer()}`;
    else if (apiKey()) url.searchParams.set('key', apiKey());
    else throw fail('Add a Google key in My Music → Set up ACRUX (with the Google Drive API turned on), or connect Google Drive.', 400);
    if (keys.length) headers['X-Goog-Drive-Resource-Keys'] = keys.join(',');
    if (range) headers.Range = range;
    let res;
    try { res = await fetch(url, { headers, signal }); } catch (err) { // the connection dropped (a weak network): like a busy answer
      if (signal?.aborted || tries >= 4) throw err;
      await sleep(2 ** tries * 1000 + Math.random() * 1000, undefined, { signal });
      continue;
    }
    if (res.ok) return res;
    const text = await res.text().catch(() => '');
    if (res.status === 403 && /automated queries|<html/i.test(text)) { // not the API answering: Google's traffic block
      if (auth !== 'oauth') heldUntil = Date.now() + 15 * 60e3;
      throw Object.assign(fail(HELD, 503), { reason: 'held' });
    }
    let body = null;
    try { body = JSON.parse(text); } catch {}
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
    if (res.status === 401 && auth === 'oauth' && !tries) { access = null; continue; } // a token revoked early
    if ((res.status === 429 || res.status >= 500 || /rateLimitExceeded/i.test(reason)) && tries < 4) {
      await sleep(2 ** tries * 1000 + Math.random() * 1000, undefined, { signal });
      continue;
    }
    if (/accessNotConfigured|SERVICE_DISABLED/.test(reason) || /has not been used in project|is disabled/.test(body?.error?.message || '')) {
      throw fail('The Google Drive API is off for your API key’s project. Turn it on in Google Cloud Console (APIs & Services → Library → Google Drive API).', 400);
    }
    if (auth !== 'oauth' && (/API_KEY_SERVICE_BLOCKED/.test(JSON.stringify(body)) || / are blocked\.?$/.test(body?.error?.message || ''))) {
      throw fail('Your API key isn’t allowed to use the Google Drive API. In Google Cloud Console → Credentials, add Google Drive API to the key’s API restrictions.', 400);
    }
    throw Object.assign(new Error(body?.error?.message || `HTTP ${res.status}`), { status: res.status, reason });
  }
}
const keysOf = (id, key) => (key ? [`${id}/${key}`] : []);

// How to download from a folder: signed in, as you, even from a folder shared by link (Google holds those back less);
// else as the folder was opened.
const downloadAs = async (source) => ((await connected()) && client() ? 'oauth' : source.auth);

// A song's bytes from Drive, from `range` (e.g. "bytes=1048576-"), as a fetch Response (206 when the range was kept).
// paced: nobody is listening to it yet (fetched ahead).
async function media(track, range, signal, paced = false) {
  const source = tracks.sources.get(track.source);
  if (!source) throw fail('That folder was removed', 404);
  return request(`/files/${track.id}?alt=media`, { auth: await downloadAs(source), keys: keysOf(track.id, track.resource_key), range, signal, paced });
}

// ---------- folders ----------

// Opens a link to a folder or a song, with the API key when it's shared by link, else your sign-in; then scans it in
// the background (progress arrives as `scan` events). A folder holding one album shows as that album, one holding
// several as a collection (worked out from its songs). -> { id, kind: 'folder' | 'song' }
const FIELDS = 'id,name,mimeType,size,md5Checksum,modifiedTime,resourceKey';
async function add(link) {
  const { id: target, resourceKey } = parseLink(link);
  let meta = null;
  let auth = null;
  const ways = [apiKey() && 'key', (await connected()) && 'oauth'].filter(Boolean);
  if (!ways.length) {
    throw Object.assign(fail('Add a Google key in My Music → Set up ACRUX to open folders shared by link, or connect Google Drive for private ones.', 400), { needsAuth: !!client() });
  }
  for (const way of ways) {
    try {
      meta = await (await request(`/files/${target}?fields=${FIELDS}`, { auth: way, keys: keysOf(target, resourceKey) })).json();
      auth = way;
      break;
    } catch (err) {
      if (err.expose) throw err;
      if (![403, 404].includes(err.status)) throw fail(`Google Drive didn’t answer (${err.message}). Try again in a moment.`, 502);
    }
  }
  if (!meta) {
    if (ways.includes('oauth')) throw fail('Your Google account can’t open that link. Check it, or ask its owner to share it with you.', 404);
    throw Object.assign(fail('That isn’t shared by link. Connect Google Drive to open it, or share it as “Anyone with the link”.', 401), { needsAuth: true });
  }
  const song = meta.mimeType !== FOLDER;
  if (song && !tracks.isAudio(meta.name)) {
    throw fail('That’s not a song or a folder. Paste the link of a song (MP3, FLAC, M4A, OGG, Opus, WAV or AIFF) or of a folder of songs.', 400);
  }
  const id = `drive:${target}`;
  const have = song && tracks.get(meta.id);
  if (have && have.source !== id) throw fail(`That song is already in your library, in “${have.album}”.`, 409);
  tracks.sources.put({ id, kind: 'drive', title: song ? meta.name.replace(/\.[^.]+$/, '') : meta.name, folder: target,
    resource_key: resourceKey, auth, status: 'scanning', is_file: song });
  scan(id);
  return { id, kind: song ? 'song' : 'folder' };
}

// Runs fn over items, n at a time.
async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) await fn(items[next++]); }));
}

// Where a file's sound starts, after its tags: past a FLAC's metadata blocks (as far as their headers are in buf) or an
// MP3's ID3v2 tag; 0 when it can't tell.
function audioStart(buf) {
  if (buf.toString('latin1', 0, 4) === 'fLaC') {
    let at = 4;
    while (at + 4 <= buf.length) {
      const last = buf[at] & 0x80;
      at += 4 + buf.readUIntBE(at + 1, 3);
      if (last) break;
    }
    return at;
  }
  if (buf.toString('latin1', 0, 3) === 'ID3' && buf.length >= 10) {
    return 10 + (((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)) + (buf[5] & 0x10 ? 10 : 0);
  }
  return 0;
}

// A song's tags from the first 64 KB of its file: FLAC and MP3 keep them up front, and FLAC's length is in its first
// block. Its embedded picture (often megabytes) is read too only when asked (one song per album that has no folder
// picture), or when the tags didn't fit. -> { meta (null: unreadable, its name stands in), start (where its sound
// starts), picture }
async function readTags(source, f, withPicture = false) {
  const read = async (end) => {
    const res = await request(`/files/${f.id}?alt=media`, { auth: await downloadAs(source), keys: keysOf(f.id, f.resourceKey), range: `bytes=0-${end}`, signal: AbortSignal.timeout(60e3), paced: true });
    return Buffer.from(await res.arrayBuffer());
  };
  const parse = (buf, skipCovers) => parseBuffer(buf, { mimeType: typeOf(f.name), size: Number(f.size) || undefined }, { skipCovers }).catch(() => null);
  try {
    let buf = await read(65535);
    const start = audioStart(buf);
    let meta = await parse(buf, true);
    if (start > buf.length && start <= 40e6 && (withPicture || !meta?.common.title)) {
      buf = await read(start - 1);
      meta = (await parse(buf, false)) || meta;
    }
    return { meta, start, picture: meta?.common.picture?.[0] || null };
  } catch (err) {
    if (err.reason !== 'held') console.error('Drive: tags of', f.name, '-', err.message);
    return { meta: null, start: 0, picture: null };
  }
}

// A folder's picture (its best-named one: tracks.coverRank), kept with the covers. Hi-res rips come with scans of
// several MB, so up to 40 MB.
async function folderCover(source, f) {
  if (Number(f.size) > 40e6) return null;
  try {
    const res = await request(`/files/${f.id}?alt=media`, { auth: await downloadAs(source), keys: keysOf(f.id, f.resourceKey), signal: AbortSignal.timeout(120e3), paced: true });
    return tracks.saveCover(Buffer.from(await res.arrayBuffer()), typeOf(f.name));
  } catch { return null; }
}

// Lists a folder and every folder in it (or looks up the one song a song link is), then reads the tags of songs that
// are new or changed (by Drive's checksum and modified time) and forgets the ones that are gone, with their cached
// bytes. A rescan costs a request per 1000 files listed plus one per new or changed song. A song you'd added on its
// own that turns up in the folder moves into it (and its now-empty link goes).
// ponytail: re-lists the folder instead of following Drive's Changes API, and doesn't follow shortcuts; two added
// folders holding the same song share it, and it sits in whichever was scanned last.
const scanning = new Map(); // source id -> AbortController
async function scan(id) {
  const source = tracks.sources.get(id);
  if (!source || source.kind !== 'drive' || scanning.has(id)) return;
  const stop = new AbortController();
  scanning.set(id, stop);
  const cache = require('./cache'); // loaded here: cache.js reads songs through media() above
  const progress = (extra) => tracks.emit('scan', { source: id, ...extra });
  try {
    tracks.sources.status(id, 'scanning');
    const files = [];
    const covers = new Map(); // folder id -> its picture's file
    const parentOf = new Map(); // folder id -> the folder it's in (a box set keeps its artwork above CD1, CD2…)
    const folders = source.is_file ? [] : [{ id: source.folder, rel: '', key: source.resource_key }];
    if (source.is_file) {
      const f = await (await request(`/files/${source.folder}?fields=${FIELDS}`, { auth: source.auth, keys: keysOf(source.folder, source.resource_key), signal: stop.signal })).json();
      files.push({ ...f, resourceKey: f.resourceKey ?? source.resource_key, rel: f.name, parent: null });
    }
    while (folders.length) {
      const dir = folders.shift();
      let page = '';
      do {
        const q = new URLSearchParams({
          q: `'${dir.id}' in parents and trashed = false`, pageSize: '1000', includeItemsFromAllDrives: 'true',
          fields: 'nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime,resourceKey)',
        });
        if (page) q.set('pageToken', page);
        const body = await (await request(`/files?${q}`, { auth: source.auth, keys: keysOf(dir.id, dir.key), signal: stop.signal })).json();
        for (const f of body.files || []) {
          const rel = dir.rel ? `${dir.rel}/${f.name}` : f.name;
          if (f.mimeType === FOLDER) {
            folders.push({ id: f.id, rel, key: f.resourceKey, name: f.name });
            parentOf.set(f.id, dir.id);
          }
          else if (tracks.isAudio(f.name)) files.push({ ...f, rel, parent: dir.id });
          else {
            // A picture is its folder's cover, or, in a folder of pictures ("Album Artwork", "Scans"), the album's above it.
            const art = /\b(art|artwork|scans?|covers?|images?|pictures?)\b/i.test(dir.name || '') && parentOf.get(dir.id);
            const home = art || dir.id;
            const rank = tracks.coverRank(f.name);
            if (rank > (covers.get(home)?.rank ?? 0)) covers.set(home, { ...f, rank });
          }
        }
        page = body.nextPageToken;
        progress({ status: 'listing', found: files.length });
      } while (page);
    }

    const old = new Map(tracks.bySource(id).map((t) => [t.id, t]));
    const here = new Set(files.map((f) => f.id));
    for (const t of old.values()) {
      if (here.has(t.id)) continue;
      tracks.remove(t.id);
      cache.drop(t.id);
    }
    // New or changed songs; plus, for an album that still has no cover, one of its songs again (its picture may not
    // have been kept before).
    const covered = new Set([...old.values()].filter((t) => t.cover).map((t) => t.album_id));
    const retry = new Set();
    const todo = files.filter((f) => {
      const t = old.get(f.id);
      if (!t || t.md5 !== (f.md5Checksum ?? null) || t.modified !== f.modifiedTime) return true;
      if (covered.has(t.album_id) || retry.has(t.album_id)) return false;
      retry.add(t.album_id);
      return true;
    });
    const pictures = new Map(); // folder id -> its picture: the folder's own, else the first song's embedded one
    let read = 0;
    progress({ status: 'reading', read, total: todo.length });
    // Two at a time, and none while Google is holding back downloads (those songs keep their names; a rescan reads them).
    await pool(todo, 2, async (f) => {
      if (stop.signal.aborted) return;
      // An album's picture: its folder's, else the folder above's (a disc folder), else the one inside its first song.
      const first = !pictures.has(f.parent);
      const pictureFile = covers.get(f.parent) || covers.get(parentOf.get(f.parent));
      if (first) pictures.set(f.parent, pictureFile ? folderCover(source, pictureFile) : null);
      const folderPic = await pictures.get(f.parent);
      const { meta, start, picture: pic } = held() ? { meta: null, start: 0, picture: null } : await readTags(source, f, first && !folderPic);
      if (stop.signal.aborted || !tracks.sources.get(id)) return; // removed meanwhile: write nothing
      const saved = pic && tracks.saveCover(pic.data, pic.format);
      if (saved && !folderPic) pictures.set(f.parent, saved); // the album's other songs share it
      const size = Number(f.size) || 0;
      const duration = meta?.format.duration;
      const was = old.get(f.id);
      if (!meta && was) { // couldn't be read this time (Drive refused): it keeps what was read before; a rescan tries again
        progress({ status: 'reading', read: ++read, total: todo.length });
        return;
      }
      const described = tracks.describe(meta, f.rel, id, source.is_file ? null : source.title); // untagged songs at a folder's top: named from it
      if (tracks.removedAlbums.has(id, described.album_id)) return; // an album you removed from this folder
      if (was && (was.md5 !== (f.md5Checksum ?? null) || was.modified !== f.modifiedTime)) cache.drop(f.id); // its bytes changed
      tracks.put({
        ...described, id: f.id, source: id, path: f.rel, name: f.name, size,
        md5: meta ? f.md5Checksum ?? null : null, // unread: a rescan tries it again
        modified: f.modifiedTime, resource_key: f.resourceKey ?? null,
        cover: saved || folderPic || null,
        // The start that makes a song begin at once: its tags (and picture) plus about 10 s of sound.
        head: Math.min(size, duration ? start + Math.round((10 * (size - start)) / duration) : start + 2e6),
        added: old.get(f.id)?.added ?? Date.now(),
      });
      tracks.changed();
      progress({ status: 'reading', read: ++read, total: todo.length });
    });
    if (stop.signal.aborted) return;
    for (const s of tracks.sources.list()) if (s.isFile && !s.songs && s.id !== id && s.status === 'ready') tracks.sources.remove(s.id);
    tracks.shareCovers(id); // a cover found for one song of an album is every song's
    tracks.sources.status(id, 'ready', Date.now());
    progress({ status: 'ready', songs: files.length });
  } catch (err) {
    if (stop.signal.aborted) return;
    const message = err.expose ? err.message : `Google Drive stopped answering (${err.message}). Rescan to try again.`;
    if (!err.expose) console.error('Drive scan:', err);
    tracks.sources.status(id, `error: ${message}`);
    progress({ status: 'error', error: message });
  } finally {
    scanning.delete(id);
  }
}

// Forgets a folder: its songs, their cached bytes, and the folder. Your Drive isn't touched.
function remove(id) {
  const source = tracks.sources.get(id);
  if (!source || source.kind !== 'drive') throw fail('No such Drive folder', 404);
  scanning.get(id)?.abort();
  const cache = require('./cache');
  for (const t of tracks.bySource(id)) {
    tracks.remove(t.id);
    cache.drop(t.id);
  }
  tracks.sources.remove(id);
  tracks.removedAlbums.clear(id);
  tracks.changed();
}

// Removes one album from a Drive folder of albums: its songs and their downloaded copies, and it stays out when the
// folder is looked through again. Drive isn't touched.
// ponytail: a rescan still reads its songs' first 64 KB to know they belong to it; keep file ids too if that matters.
function removeAlbum(id, albumId) {
  const cache = require('./cache');
  for (const t of tracks.byAlbum(albumId)) {
    if (t.source !== id) continue;
    tracks.remove(t.id);
    cache.drop(t.id);
  }
  tracks.removedAlbums.add(id, albumId);
  tracks.changed();
}

// A scan cut short by the server stopping picks up again when it starts, and so does one whose songs weren't read
// (Google held downloads back): their tags, length and cover.
// ponytail: a song whose tags never parse is read again (64 KB) at every start; mark it tried if that adds up.
setImmediate(() => {
  for (const s of tracks.sources.list()) {
    if (s.kind === 'drive' && (s.status === 'scanning' || tracks.bySource(s.id).some((t) => !t.md5))) scan(s.id);
  }
});

module.exports = { parseLink, add, scan, remove, removeAlbum, media, connectUrl, callback, disconnect, setClient, status, held, audioStart };
