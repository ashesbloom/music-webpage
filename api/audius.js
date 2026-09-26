// Audius: an open music platform of independent artists: full songs, no key (requests name the app). Its stream URL
// redirects to a content node that sends CORS headers and supports byte ranges, so songs play on the record like
// Jamendo's. One stream quality, so every tier is the same URL. Gated tracks (paid or members only) are left out.
const { playable, fail, getJson } = require('./common');

const API = 'https://api.audius.co/v1';
const APP = 'ACRUX';
const PAGE = 20;

const get = async (path, params = {}) => (await getJson(`${API}${path}?${new URLSearchParams({ app_name: APP, ...params })}`)).data;
const art = (a) => a?.['480x480'] || a?.['1000x1000'] || a?.['150x150'] || null;

function map(t) {
  if (!t || t.is_streamable === false || t.is_stream_gated || t.stream_conditions || !playable(t.duration)) return null;
  const stream = `${API}/tracks/${t.id}/stream?app_name=${APP}`;
  return {
    source: 'audius', id: t.id, title: t.title, artist: t.user?.name || 'Unknown artist', artistId: t.user?.id, durationSec: t.duration,
    artworkUrl: art(t.artwork), artworkAlt: t.artwork?.['150x150'] || undefined,
    playback: { kind: 'audio', urls: { low: stream, medium: stream, high: stream } },
    sourceUrl: `https://audius.co${t.permalink || ''}`, category: 'independent',
    tags: {
      genres: t.genre ? [t.genre] : [],
      kinds: [t.mood, ...String(t.tags || '').split(',').map((s) => s.trim())].filter(Boolean).slice(0, 8),
    },
  };
}
// Audius has playlists more than albums; both show as albums here.
const album = (p) => ({
  source: 'audius', id: p.id, title: p.playlist_name, artist: p.user?.name || 'Unknown artist', artistId: p.user?.id,
  artworkUrl: art(p.artwork), sourceUrl: `https://audius.co${p.permalink || ''}`, category: 'independent',
});
const artist = (u) => ({ source: 'audius', id: u.id, name: u.name, artworkUrl: art(u.profile_picture), sourceUrl: `https://audius.co/${u.handle}` });
const songs = (list) => (list || []).map(map).filter(Boolean);
const paged = (n) => ({ limit: PAGE, offset: (n - 1) * PAGE });
const page = (list, results) => ({ results, more: (list || []).length === PAGE });

// One page of a search; with no query, what's trending this week.
const find = {
  songs: async (q, n) => {
    const list = await get(q ? '/tracks/search' : '/tracks/trending', q ? { query: q, ...paged(n) } : { time: 'week', ...paged(n) });
    return page(list, songs(list));
  },
  albums: async (q, n) => {
    const list = await get(q ? '/playlists/search' : '/playlists/trending', q ? { query: q, ...paged(n) } : { time: 'week', ...paged(n) });
    return page(list, (list || []).map(album));
  },
  artists: async (q, n) => {
    if (!q) return { results: [], more: false };
    const list = await get('/users/search', { query: q, ...paged(n) });
    return page(list, (list || []).map(artist));
  },
};

// Trending songs in a genre this week (For you). Audius genres are its own list ("Lo-Fi", "Hip-Hop/Rap"…).
const byGenre = async (genre) => ({ results: songs(await get('/tracks/trending', { genre, time: 'week', limit: 20 })) });

async function albumPage(id) {
  const [[p], list] = await Promise.all([get(`/playlists/${id}`), get(`/playlists/${id}/tracks`)]);
  if (!p) throw fail('Audius has no such album.', 404);
  return { ...album(p), tracks: songs(list) };
}

async function artistPage(id) {
  const [u, top, lists] = await Promise.all([get(`/users/${id}`), get(`/users/${id}/tracks`, { sort: 'plays', limit: 50 }), get(`/users/${id}/playlists`).catch(() => [])]);
  if (!u) throw fail('Audius has no such artist.', 404);
  return { artist: artist(u), albums: (lists || []).map(album), tracks: songs(top) };
}

module.exports = { find, byGenre, albumPage, artistPage, map };
