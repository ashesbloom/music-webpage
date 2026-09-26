// MusicBrainz: open music metadata, no key. It gives an artist's genres (for the taste profile) and their YouTube
// channel, preferably the auto-generated "Artist - Topic" one that holds their studio catalogue, so YouTube can list it
// for a few quota units instead of a 100-unit search. Its rule is at most one request a second, so requests queue.
// ListenBrainz (same foundation, no key) gives similar artists.
const { getJson } = require('./common');

let nextAt = 0;
async function mb(path, retry = true) {
  const wait = Math.max(0, nextAt - Date.now());
  nextAt = Date.now() + wait + 1100;
  if (wait) await new Promise((done) => setTimeout(done, wait));
  try {
    return await getJson(`https://musicbrainz.org/ws/2/${path}${path.includes('?') ? '&' : '?'}fmt=json`);
  } catch (err) {
    if (err.status !== 503 || !retry) throw err; // 503: busy, or asked too fast; once more a little later
    nextAt = Math.max(nextAt, Date.now() + 1500);
    return mb(path, false);
  }
}

const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
// youtube.com/channel/UC… or music.youtube.com/channel/UC… -> UC…
const channelOf = (url) => /youtube\.com\/channel\/(UC[\w-]{22})/.exec(url || '')?.[1];

// The artist of this name, if MusicBrainz is sure of it: { mbid, name, genres, channel }, or null.
async function artist(name) {
  const found = (await mb(`artist?${new URLSearchParams({ query: `artist:"${name.replace(/"/g, '')}"`, limit: 3 })}`)).artists || [];
  const best = found.find((a) => a.score >= 90 && norm(a.name) === norm(name)); // the same name, not just a close one
  if (!best) return null;
  const full = await mb(`artist/${best.id}?inc=url-rels+genres+tags`);
  const links = (full.relations || []).map((r) => ({ type: r.type, url: r.url?.resource }));
  const topic = links.find((l) => l.type === 'youtube music' && channelOf(l.url)) || links.find((l) => channelOf(l.url));
  const genres = [...(full.genres || []), ...(full.tags || [])].sort((a, b) => b.count - a.count).map((g) => g.name);
  const wikidata = /wikidata\.org\/wiki\/(Q\d+)/.exec(links.find((l) => l.type === 'wikidata')?.url || '')?.[1] || null;
  return { mbid: best.id, name: full.name, genres: [...new Set(genres)].slice(0, 8), channel: channelOf(topic?.url) || null, wikidata };
}

// The release group (album) of this title by this artist, if MusicBrainz is sure of it: its MBID, or null.
async function releaseGroup(title, artist) {
  const query = `releasegroup:"${title.replace(/"/g, '')}" AND artist:"${artist.replace(/"/g, '')}"`;
  const found = (await mb(`release-group?${new URLSearchParams({ query, limit: 3 })}`))['release-groups'] || [];
  return found.find((g) => g.score >= 90 && norm(g.title) === norm(title))?.id || null;
}

// Artists like this one (ListenBrainz), by MBID: [{ name, mbid }]
async function similar(mbid) {
  const body = await getJson(`https://labs.api.listenbrainz.org/similar-artists/json?${new URLSearchParams({ artist_mbids: mbid, algorithm: 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30' })}`);
  return (Array.isArray(body) ? body : []).map((a) => ({ name: a.name, mbid: a.artist_mbid })).filter((a) => a.name && a.mbid !== mbid).slice(0, 12);
}

module.exports = { artist, releaseGroup, similar, norm };
