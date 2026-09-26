// YouTube: the mainstream catalogue, searched only on a tap (Discover's YouTube tab). A search costs 101 of the 10,000
// daily quota units (search.list 100 + videos.list 1 for durations), about 99 a day, so the count is kept in SQLite;
// the trending chart costs 1. Needs YOUTUBE_API_KEY in .env. Videos play in the page's video card, never on the record.
const { fail, getJson } = require('./common');
const { quota } = require('./db');

const API = 'https://www.googleapis.com/youtube/v3';
const LIMIT = 10000;
const COST = 101;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// The API returns titles HTML-escaped ("Don&#39;t"); the page escapes for itself.
const decode = (t = '') => t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] !== '#' ? NAMED[e.toLowerCase()] ?? m : String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))));
// ISO 8601 duration ("PT3M21S", "PT1H2M", "P0D" for a live stream) -> seconds
function iso(d) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(d || '');
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0;
}

const map = (item, durationSec = 0) => {
  const s = item.snippet;
  const videoId = item.id.videoId;
  return {
    source: 'youtube', id: videoId, title: decode(s.title), artist: decode(s.channelTitle), durationSec,
    artworkUrl: (s.thumbnails?.high || s.thumbnails?.medium || s.thumbnails?.default)?.url || null,
    playback: { kind: 'embed', videoId }, sourceUrl: `https://www.youtube.com/watch?v=${videoId}`, category: 'video',
  };
};

const status = () => {
  const used = Math.min(quota.used(), LIMIT);
  return { used, remaining: LIMIT - used, limit: LIMIT, searchesLeft: Math.floor((LIMIT - used) / COST) };
};

const USED_UP = 'Today’s YouTube quota is used up. It comes back at midnight Pacific time.';

// One API call: `cost` units counted up front (Google charges for failed calls too); Google's refusals become
// messages the page can show.
async function call(path, params, cost = 1) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw fail('YouTube isn’t set up yet: add YOUTUBE_API_KEY to .env and restart the server.', 503);
  if (LIMIT - quota.used() < cost) throw fail(USED_UP, 429);
  quota.spend(cost);
  try {
    return await getJson(`${API}/${path}?${new URLSearchParams({ ...params, key })}`);
  } catch (err) {
    const reason = err.body?.error?.errors?.[0]?.reason;
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      quota.set(LIMIT);
      throw fail(USED_UP, 429);
    }
    if (err.status === 400 || err.status === 403) throw fail(`YouTube refused the request (${reason || err.status}). Check YOUTUBE_API_KEY and that YouTube Data API v3 is enabled for it.`, 503);
    throw err;
  }
}

// Details for up to 50 videos at a time (1 unit each call): duration, whether it can be embedded, and topics (genres).
async function details(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const body = await call('videos', { part: 'contentDetails,status,topicDetails', id: ids.slice(i, i + 50).join(','), maxResults: '50' });
    for (const v of body.items || []) out.set(v.id, v);
  }
  return out;
}
// Topic URLs ("https://en.wikipedia.org/wiki/Rock_music") -> genre names ("Rock music")
const topics = (v) => (v?.topicDetails?.topicCategories || []).map((u) => decodeURIComponent(u.split('/').pop()).replace(/_/g, ' ')).filter((t) => t !== 'Music');
const withDetails = (item, v) => ({ ...map(item, iso(v?.contentDetails?.duration)), tags: { genres: topics(v), kinds: [] } });

// A search: 101 units (search.list 100 + videos.list 1), so only on a tap.
async function search(q) {
  const found = await call('search', { part: 'snippet', type: 'video', videoCategoryId: '10', videoEmbeddable: 'true', maxResults: '15', q }, 100);
  const items = (found.items || []).filter((i) => i.id?.videoId && i.snippet?.liveBroadcastContent !== 'upcoming');
  if (!items.length) return [];
  const info = await details(items.map((i) => i.id.videoId));
  return items.map((i) => withDetails(i, info.get(i.id.videoId)));
}

// Trending music videos (YouTube's chart): 1 unit, so Discover's landing page shows them without a tap.
async function trending() {
  const body = await call('videos', { part: 'snippet,contentDetails,status,topicDetails', chart: 'mostPopular', videoCategoryId: '10', maxResults: '24' });
  return (body.items || []).filter((v) => v.status?.embeddable !== false)
    .map((v) => withDetails({ id: { videoId: v.id }, snippet: v.snippet }, v));
}

// An artist's whole channel (their "Artist - Topic" channel holds the studio catalogue): its uploads playlist is the
// channel ID with UU for UC. 1 unit per 50 videos, plus 1 per 50 for details: about 20 units for 500 songs.
// Topic videos' descriptions read "Provided to YouTube by …\n\nSong · Artist\n\nAlbum\n\n…", which gives the album.
async function catalog(channel) {
  const items = [];
  let pageToken = '';
  for (let pages = 0; pages < 10; pages++) {
    const body = await call('playlistItems', { part: 'snippet', playlistId: `UU${channel.slice(2)}`, maxResults: '50', ...(pageToken && { pageToken }) });
    items.push(...(body.items || []).filter((i) => i.snippet?.resourceId?.videoId));
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  const info = await details(items.map((i) => i.snippet.resourceId.videoId));
  return items.map((i) => {
    const s = i.snippet;
    const v = info.get(s.resourceId.videoId);
    if (!v || v.status?.embeddable === false) return null;
    const parts = String(s.description || '').split(/\n\s*\n/);
    const album = parts[0].startsWith('Provided to YouTube') ? parts[2] : undefined;
    const song = withDetails({ id: { videoId: s.resourceId.videoId }, snippet: { ...s, channelTitle: String(s.videoOwnerChannelTitle || s.channelTitle || '').replace(/ - Topic$/, '') } }, v);
    return { ...song, album: album?.trim() || undefined, category: 'studio' };
  }).filter(Boolean);
}

module.exports = { search, trending, catalog, status, map, iso, decode };
