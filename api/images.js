// Pictures for artists, albums and songs that came without one, from free sources that need no key:
//   artist: Deezer's artist photo, else the artist's Wikidata image (on Wikimedia Commons, via MusicBrainz)
//   album:  iTunes, else Deezer, else the Cover Art Archive (via MusicBrainz)
//   song:   iTunes, else Deezer (its album's cover)
//   q:      a free search (a recent-search row): an artist of exactly that name, else the top song's art
// Matches are by name, so an unknown artist sharing a famous name can get the famous one's photo. Each answer (a URL,
// or none) is kept 30 days; api/discover.js serves the picture itself from the same origin (/discover/image).
const { cached } = require('./db');
const { getJson } = require('./common');
const mbz = require('./musicbrainz');
const archive = require('./archive');

const MONTH = 30 * 864e5;
const same = (a, b) => mbz.norm(a) === mbz.norm(b);
// Credits often list several artists ("Sachin-Jigar, Shreya Ghoshal"): either one containing the other will do.
const near = (a, b) => { const x = mbz.norm(a), y = mbz.norm(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
const itunes = (params) => getJson(`https://itunes.apple.com/search?${new URLSearchParams({ media: 'music', limit: 10, ...params })}`).then((b) => b.results || []);
const big = (url) => url?.replace('100x100bb', '600x600bb') || null;
const deezer = (kind, q) => getJson(`https://api.deezer.com/search/${kind}?${new URLSearchParams({ q, limit: 10 })}`).then((b) => b.data || []);
// The first finder that gives a picture. If none does but one failed (busy, rate-limited), it throws: "none" is only
// remembered when every source answered.
async function first(...finders) {
  let failed = null;
  for (const find of finders) {
    const url = await find().catch((err) => { failed = err; return null; });
    if (url) return url;
  }
  if (failed) throw failed;
  return null;
}

const artist = (name) => first(
  async () => (await deezer('artist', name)).find((a) => same(a.name, name) && !/\/artist\/\/|artist\/?$/.test(a.picture_xl || ''))?.picture_xl,
  async () => {
    const wikidata = (await mbz.artist(name))?.wikidata;
    if (!wikidata) return null;
    const entity = (await getJson(`https://www.wikidata.org/wiki/Special:EntityData/${wikidata}.json`)).entities?.[wikidata];
    const file = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    return file ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=500` : null;
  },
);

// Deezer first: iTunes allows only about 20 requests a minute.
const album = (title, by) => first(
  async () => (await deezer('album', `${by} ${title}`)).find((a) => same(a.title, title) && near(a.artist?.name, by))?.cover_xl,
  async () => big((await itunes({ term: `${by} ${title}`, entity: 'album' })).find((a) => same(a.collectionName, title) && near(a.artistName, by))?.artworkUrl100),
  async () => {
    const group = await mbz.releaseGroup(title, by);
    return group ? `https://coverartarchive.org/release-group/${group}/front-500` : null;
  },
);

const song = (title, by) => first(
  async () => (await deezer('track', `${by} ${title}`)).find((t) => near(t.artist?.name, by))?.album?.cover_xl,
  async () => big((await itunes({ term: `${by} ${title}`, entity: 'song' })).find((t) => near(t.artistName, by))?.artworkUrl100),
);

const search = (q) => first(
  async () => (await deezer('artist', q)).find((a) => same(a.name, q))?.picture_xl,
  async () => (await deezer('track', q))[0]?.album?.cover_xl,
  async () => big((await itunes({ term: q, entity: 'song', limit: 1 }))[0]?.artworkUrl100),
);

// The picture's URL for one of the four kinds of ask, or null. Kept a month either way.
// `item`: an Internet Archive item, whose own uploaded cover wins; else `q` finds one.
function image({ artist: by = '', album: title = '', song: track = '', q = '', item = '' }) {
  const key = `img:${[by, title, track, q, item].map((s) => s.toLowerCase()).join('|')}`;
  const find = item ? async () => (/^[\w.-]+$/.test(item) && await archive.cover(item)) || (q ? search(q) : null)
    : q ? () => search(q) : title ? () => album(title, by) : track ? () => song(track, by) : by ? () => artist(by) : null;
  if (!find) return Promise.resolve(null);
  return cached(key, MONTH, () => find().then((url) => ({ url }))).then((r) => r.url);
}

module.exports = { image };
