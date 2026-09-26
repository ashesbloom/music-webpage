// Shared by the Discover sources. Every source maps its tracks to one result shape:
//   { source: 'jamendo'|'archive'|'audius'|'itunes'|'youtube', id, title, artist, artistId?, album?, albumId?,
//     durationSec, artworkUrl, artworkAlt? (a fallback picture), sourceUrl, license?,
//     playback: { kind: 'audio', urls: { low, medium, high } } | { kind: 'embed', videoId },
//     tags: { genres: [], kinds: [] }, category: 'independent'|'live'|'release'|'community'|'preview'|'video',
//     community?: true (an Archive community upload), preview?: true (a 30-second clip) }
// so the page only looks at playback.kind to pick the record player or the video card, and the taste profile
// (api/taste.js) reads every song the same way.

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

module.exports = { playable, notGenre, fail, getJson };
