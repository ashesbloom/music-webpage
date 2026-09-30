// Shared by the API. sendFile serves a file from disk (the site's own, your songs, covers, the Drive cache).
// Every Discover source maps its tracks to one result shape:
//   { source: 'jamendo'|'archive'|'audius'|'itunes'|'youtube', id, title, artist, artistId?, album?, albumId?,
//     durationSec, artworkUrl, artworkAlt? (a fallback picture), sourceUrl, license?,
//     playback: { kind: 'audio', urls: { low, medium, high } } | { kind: 'embed', videoId },
//     tags: { genres: [], kinds: [] }, category: 'independent'|'live'|'release'|'community'|'preview'|'video',
//     community?: true (an Archive community upload), preview?: true (a 30-second clip) }
// so the page only looks at playback.kind to pick the record player or the video card, and the taste profile
// (api/taste.js) reads every song the same way.

const fs = require('fs');
const path = require('path');

// ponytail: DeckAudio keeps a whole decoded song in memory (an hour of Archive concert is GBs), so long tracks are
// left out; lift this if it ever plays from a ring buffer instead.
const MAX_SEC = 15 * 60;
const playable = (sec) => sec > 0 && sec <= MAX_SEC;

// Words uploaders put among genre tags that aren't genres: file formats, kinds of upload.
const NOT_GENRES = new Set(['flac', 'mp3', 'ogg', 'wav', 'bootleg', 'bootlegs', 'compilation', 'live', 'concert', 'audio', 'music', 'album',
  'full album', 'remaster', 'remastered', 'lossless', 'cd', 'vinyl', 'rip', 'soundboard', 'sbd', 'aud', 'demo', 'demos', 'single', 'ep',
  'various artists', 'unknown', 'misc', 'other', 'collection', 'discography', 'rare', 'unreleased', 'free', 'playlist']);
const notGenre = (s) => NOT_GENRES.has(String(s).toLowerCase().trim());

// An error whose message the page may show (e.g. "add JAMENDO_CLIENT_ID to .env"); anything else shows as
// "<source> didn't answer".
const fail = (message, status = 502) => Object.assign(new Error(message), { expose: true, status });

// GET a JSON API politely: a named User-Agent and a time limit. A non-2xx throws with .status and the parsed .body.
async function getJson(url, ms = 8000) {
  const res = await fetch(url, { headers: { 'User-Agent': 'ACRUX/1.0 (personal music player; github.com/ashesbloom/music-webpage)' }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.body = await res.json().catch(() => null);
    throw err;
  }
  return res.json();
}

// A request body of JSON (a play, a playlist of up to 500 songs, a Drive link), up to 2 MB.
async function json(req) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 2e6) throw fail('Too large', 413);
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw fail('Not JSON', 400); }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', // module scripts are refused under any other type
  '.wasm': 'application/wasm',              // compiled while it downloads (onnxruntime-web)
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.mp4': 'video/mp4', // the Browse tiles are videos
};
const typeOf = (name) => TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream';

// A file from disk (stat: its fs.Stats), with one byte range when asked: "bytes=a-b", "bytes=a-" or "bytes=-n" (the last
// n bytes). Anything else is ignored (the whole file). type defaults to the one its extension says.
// cache: 'no-store' (songs: they're on this computer already), 'check' (the site's own files: kept, and asked for again
// each time, so a changed one shows at once and an unchanged one answers 304 with no body), or 'keep' (named after its
// contents, like covers: kept for good).
const CACHE = { 'no-store': 'no-store', check: 'no-cache', keep: 'max-age=31536000, immutable' };
function sendFile(req, res, file, stat, type = typeOf(file), cache = 'no-store') {
  const size = stat.size;
  const headers = { 'Content-Type': type, 'Cache-Control': CACHE[cache], 'Accept-Ranges': 'bytes' };
  if (cache !== 'no-store') {
    headers.ETag = `"${size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
    if (req.headers['if-none-match'] === headers.ETag) {
      res.writeHead(304, headers);
      return res.end();
    }
  }
  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2]) && !(range[1] && range[2] && Number(range[2]) < Number(range[1]))) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else {
      start = Math.max(size - Number(range[2]), 0);
    }
    if (start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Cache-Control': 'no-store' });
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = size === 0 ? 0 : end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || size === 0) return res.end();
  fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
}

// Anything that changes something must come from this site (its Origin), so another site open in your browser can't
// post to it; curl and the page itself send none.
function sameSite(req) {
  const origin = req.headers.origin;
  if (!origin) return !req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']);
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
// The computer running ACRUX itself (the owner), not a phone or a guest on the Wi-Fi.
const loopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

module.exports = { playable, notGenre, fail, getJson, json, TYPES, typeOf, sendFile, sameSite, loopback };
