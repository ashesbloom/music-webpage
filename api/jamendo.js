// Jamendo: independent, Creative Commons music: tracks, albums and artists, all searchable page by page. Needs a free
// client ID from devportal.jamendo.com in .env (JAMENDO_CLIENT_ID). Its stream URLs send CORS headers, so the browser
// plays them directly.
const { playable, fail, getJson } = require('./common');

const API = 'https://api.jamendo.com/v3.0';
const PAGE = 20;

// A Jamendo track -> the shared result shape (api/common.js); null when it can't be played.
// The stream URL's `format` picks the tier: mp31 (96 kbps), mp32 (VBR, good), flac.
function map(t) {
  const durationSec = Number(t.duration);
  if (!t.audio || !playable(durationSec)) return null;
  const tier = (format) => {
    const url = new URL(t.audio);
    url.searchParams.set('format', format);
    return url.href;
  };
  return {
    source: 'jamendo', id: String(t.id), title: t.name, artist: t.artist_name, album: t.album_name || undefined, durationSec,
    artistId: t.artist_id ? String(t.artist_id) : undefined, albumId: t.album_id ? String(t.album_id) : undefined,
    artworkUrl: t.image || t.album_image || null, artworkAlt: t.album_image || undefined,
    playback: { kind: 'audio', urls: { low: tier('mp31'), medium: tier('mp32'), high: tier('flac') } },
    license: t.license_ccurl || undefined, sourceUrl: t.shareurl || `https://www.jamendo.com/track/${t.id}`,
    category: 'independent', tags: tags(t.musicinfo),
  };
}
// Jamendo's music info (with include=musicinfo) -> genres, and the kind of song: mood tags, tempo, voice, sound.
function tags(info = {}) {
  const speed = { verylow: 'very slow', low: 'slow', medium: 'mid-tempo', high: 'upbeat', veryhigh: 'fast' }[info.speed];
  return {
    genres: info.tags?.genres || [],
    kinds: [...(info.tags?.vartags || []), speed, info.vocalinstrumental, info.acousticelectric].filter(Boolean),
  };
}
const album = (a) => ({
  source: 'jamendo', id: String(a.id), title: a.name, artist: a.artist_name, artistId: a.artist_id ? String(a.artist_id) : undefined,
  year: a.releasedate?.slice(0, 4) || undefined, artworkUrl: a.image || null, sourceUrl: `https://www.jamendo.com/album/${a.id}`,
});
const artist = (a) => ({ source: 'jamendo', id: String(a.id), name: a.name, artworkUrl: a.image || null, sourceUrl: `https://www.jamendo.com/artist/${a.id}` });
const tracks = (list) => list.map(map).filter(Boolean);

async function get(path, params) {
  const id = process.env.JAMENDO_CLIENT_ID;
  if (!id) throw fail('Jamendo isn’t set up yet: add JAMENDO_CLIENT_ID to .env and restart the server.', 503);
  const body = await getJson(`${API}${path}?${new URLSearchParams({ client_id: id, format: 'json', ...params })}`);
  if (body.headers?.status === 'failed') throw fail(`Jamendo: ${body.headers.error_message}`);
  return body.results;
}

// One page of songs, albums or artists for a search; with no query, what's popular this week.
const paged = (n) => ({ limit: PAGE, offset: (n - 1) * PAGE });
const page = (list, results) => ({ results, more: list.length === PAGE });
const find = {
  songs: async (q, n) => {
    const list = await get('/tracks/', { imagesize: 300, include: 'musicinfo', ...paged(n), ...(q ? { search: q, boost: 'popularity_month' } : { order: 'popularity_week' }) });
    return page(list, tracks(list));
  },
  albums: async (q, n) => {
    const list = await get('/albums/', { imagesize: 300, ...paged(n), ...(q ? { namesearch: q, order: 'popularity_total' } : { order: 'popularity_week' }) });
    return page(list, list.map(album));
  },
  artists: async (q, n) => {
    const list = await get('/artists/', { ...paged(n), ...(q ? { namesearch: q, order: 'popularity_total' } : { order: 'popularity_week' }) });
    return page(list, list.map(artist));
  },
};

// An album with all its tracks.
async function albumPage(id) {
  const [a] = await get('/albums/tracks/', { id, imagesize: 300 });
  if (!a) throw fail('Jamendo has no such album.', 404);
  return { ...album(a), tracks: tracks(a.tracks.map((t) => ({ ...t, artist_id: a.artist_id, artist_name: a.artist_name, album_id: a.id, album_name: a.name, image: a.image }))) };
}

// An artist, their albums and their most played tracks.
async function artistPage(id) {
  const [[a], [withAlbums], top] = await Promise.all([
    get('/artists/', { id }),
    get('/artists/albums/', { id, imagesize: 300 }),
    get('/tracks/', { artist_id: id, order: 'popularity_total', limit: 50, imagesize: 300, include: 'musicinfo' }),
  ]);
  if (!a) throw fail('Jamendo has no such artist.', 404);
  return { artist: artist(a), albums: (withAlbums?.albums || []).map((al) => album({ ...al, artist_id: a.id, artist_name: a.name })), tracks: tracks(top) };
}

// "More like this": Jamendo's /tracks/similar answers nothing, so popular tracks sharing this one's genre tags.
async function similar(id) {
  const [t] = await get('/tracks/', { id, include: 'musicinfo' });
  const tags = t?.musicinfo?.tags?.genres?.slice(0, 3) || [];
  if (!tags.length) return [];
  const list = await get('/tracks/', { fuzzytags: tags.join(' '), boost: 'popularity_month', limit: 13, imagesize: 300, include: 'musicinfo' });
  return tracks(list).filter((r) => r.id !== String(id)).slice(0, 12);
}

// Popular songs with these tags (For you): { results }
const byGenre = async (genre) => ({ results: tracks(await get('/tracks/', { fuzzytags: genre, boost: 'popularity_month', limit: 20, imagesize: 300, include: 'musicinfo' })) });

module.exports = { find, byGenre, albumPage, artistPage, similar, map };
