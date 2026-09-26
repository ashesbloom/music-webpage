// Internet Archive: live recordings (the Live Music Archive), netlabel releases, public-domain records, and community
// uploads, which hold most mainstream material (bootlegs, live sets, and some commercial albums uploaded without
// permission: a legal grey area, so those items are marked `community`). No key. An item is an album (a concert or a
// release) and its creator the artist. It's asked politely: one search per page plus one file list per item, each
// answer cached for a day. /download/ sends CORS headers for audio; its images don't, so the record's tint reads
// covers through the server (/discover/art).
const { playable, notGenre, fail, getJson } = require('./common');
const { cached } = require('./db');

// All audio and Live Music Archive items (mediatype etree), without talk: podcasts, audiobooks, radio shows, and
// stream_only items, whose files can't be downloaded.
const MUSIC = 'mediatype:(audio OR etree) AND NOT collection:(podcasts OR librivoxaudio OR audio_bookspoetry OR oldtimeradio'
  + ' OR radioprograms OR audio_religion OR audio_news OR audio_tech OR audio_podcast OR stream_only)';
const CLEAN = ['etree', 'netlabels', 'georgeblood', '78rpm']; // curated collections; anything else is a community upload
const PER_ITEM = 3; // tracks per album in a song search; an album's own page has them all
const FILES_MS = 4000; // an item's file list slower than this drops out of a song page (not of background work)
const SLOW_MS = 12000; // For you and artist pages can wait longer: a big item's list (hundreds of files) takes a while
// Each tier's formats, best first; a track takes the first one it has. Ogg is last: Safari can't decode it.
const TIERS = {
  low: ['64Kbps MP3', 'VBR MP3', '128Kbps MP3', 'MP3', 'Ogg Vorbis', 'Flac', '24bit Flac'],
  medium: ['VBR MP3', '128Kbps MP3', 'MP3', '64Kbps MP3', 'Flac', 'Ogg Vorbis', '24bit Flac'],
  high: ['Flac', '24bit Flac', 'VBR MP3', '128Kbps MP3', 'MP3', 'Ogg Vorbis', '64Kbps MP3'],
};
const AUDIO = new Set(TIERS.high);

// Whether an item has an uploaded picture (its tile is then its cover, not a drawn waveform).
const uploaded = (files) => files.some((f) => f.source === 'original' && ['JPEG', 'PNG', 'GIF', 'Item Image'].includes(f.format));

// A file's length as the Archive writes it ("39.8", "00:39" or "1:02:03") -> seconds
const seconds = (len) => Math.round(String(len ?? '').split(':').reduce((t, part) => t * 60 + Number(part), 0)) || 0;
const first = (v) => [v].flat()[0]; // some fields are sometimes lists
const list = (v) => [v].flat().filter(Boolean).map(String);
const enc = encodeURIComponent;

// How an item came to be here: a live taping, a curated release, or a community upload.
const community = (item) => item.mediatype !== 'etree' && !list(item.collection).some((c) => CLEAN.includes(c));
const category = (item) => (item.mediatype === 'etree' || list(item.collection).includes('etree') ? 'live' : community(item) ? 'community' : 'release');
// The item's subjects ("Rock; Live; 1977" or a list) as genre tags, without the file formats, the kind of upload and
// the artist's own name that uploaders also put there.
const bare = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const genres = (item) => list(item.subject).flatMap((s) => s.split(/[;,]/)).map((s) => s.trim())
  .filter((s) => s && s.length <= 30 && !/[\d#]/.test(s) && !notGenre(s) && bare(s) !== bare(first(item.creator))).slice(0, 8);

// An item and its file list -> up to `limit` playable tracks, in track order. A track is an original audio file plus
// the derivatives made from it (their `original`), so each tier can pick its own format.
function tracks(item, files, limit = PER_ITEM) {
  const id = item.identifier;
  const url = (name) => `https://archive.org/download/${enc(id)}/${name.split('/').map(enc).join('/')}`;
  const tile = files.find((f) => f.format === 'Item Tile');
  // The tile is the item's cover only when an image was uploaded; otherwise the Archive draws a waveform of the audio.
  // Then each song asks the picture finder (api/images.js) and keeps the waveform as its fallback.
  const art = uploaded(files);
  const drawn = tile ? url(tile.name) : `https://archive.org/services/img/${enc(id)}`;
  const creator = first(item.creator);
  const groups = new Map();
  for (const f of files) {
    if (!AUDIO.has(f.format)) continue;
    const key = f.source === 'original' ? f.name : first(f.original);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), f]);
  }
  const shared = { community: community(item) || undefined, category: category(item), tags: { genres: genres(item), kinds: [] } };
  return [...groups].map(([key, group]) => {
    const pick = (tier) => TIERS[tier].map((format) => group.find((f) => f.format === format)).find(Boolean);
    const info = (field) => group.map((f) => f[field]).find(Boolean);
    const title = info('title') || key.replace(/^.*\/|\.[^.]+$/g, '');
    const by = info('creator') || creator || 'Unknown artist';
    return {
      n: parseInt(info('track'), 10) || Infinity,
      source: 'archive', id: `${id}/${key}`, title, artist: by, album: first(item.title), durationSec: seconds(info('length')),
      albumId: id, artistId: creator || undefined,
      artworkUrl: art ? drawn : `/discover/image?${new URLSearchParams({ song: title, artist: by })}`, artworkAlt: drawn,
      playback: { kind: 'audio', urls: { low: url(pick('low').name), medium: url(pick('medium').name), high: url(pick('high').name) } },
      license: item.licenseurl || undefined, sourceUrl: `https://archive.org/details/${enc(id)}`, ...shared,
    };
  })
    .filter((t) => playable(t.durationSec))
    .sort((a, b) => a.n - b.n || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(({ n, ...t }) => t);
}

// An album card's picture: the item's own cover if one was uploaded, else one found by its title (api/images.js; the
// creator is often just the uploader, so it's left out), with the Archive's drawn thumbnail as the fallback.
const album = (d) => ({
  source: 'archive', id: d.identifier, title: first(d.title) || d.identifier, artist: first(d.creator) || 'Unknown artist',
  artistId: first(d.creator) || undefined, year: String(first(d.year) || first(d.date) || '').slice(0, 4) || undefined,
  artworkUrl: `/discover/image?${new URLSearchParams({ item: d.identifier, q: first(d.title) || '' })}`,
  artworkAlt: `https://archive.org/services/img/${enc(d.identifier)}`, sourceUrl: `https://archive.org/details/${enc(d.identifier)}`,
  community: community(d) || undefined, category: category(d),
});
// No picture of their own: the page finds their photo by name (api/images.js).
const artist = (name) => ({ source: 'archive', id: name, name, artworkUrl: null, sourceUrl: `https://archive.org/search?query=${enc(`creator:"${name}"`)}` });

// The Archive's search is Lucene: the user's words go in as plain words (all of them must match), never as syntax.
const words = (q) => q.replace(/[+\-!(){}[\]^"~*?:\\/&|]/g, ' ').replace(/\b(AND|OR|NOT|TO)\b/g, (w) => w.toLowerCase())
  .split(/\s+/).filter(Boolean).join(' AND ');
const phrase = (name) => `"${name.replace(/["\\]/g, '')}"`;
// Free text over the whole Archive brings up talk shows; the artist, title and subject fields find music.
const fields = (w) => `creator:(${w}) OR title:(${w}) OR subject:(${w})`;

// One page of items matching a query, most downloaded first: { docs, more }
async function items(query, n, rows) {
  const params = new URLSearchParams({ q: `(${query}) AND ${MUSIC}`, rows, page: n, output: 'json' });
  for (const field of ['identifier', 'title', 'creator', 'licenseurl', 'year', 'collection', 'subject', 'mediatype']) params.append('fl[]', field);
  params.append('sort[]', 'downloads desc');
  const res = (await getJson(`https://archive.org/advancedsearch.php?${params}`)).response;
  return { docs: res?.docs || [], more: n * rows < (res?.numFound || 0) };
}
const files = (id, ms) => getJson(`https://archive.org/metadata/${enc(id)}/files`, ms).then((r) => r.result || []);
// Every playable track of an item, kept a day: song pages, For you and artist pages keep asking for the same items.
const itemTracks = (d, ms) => cached(`archive:item:${d.identifier}`, 864e5, () => files(d.identifier, ms).then((f) => tracks(d, f, Infinity)));
// A few tracks from each item, fetched together; a slow or broken item just drops out.
const tracksOf = async (docs, ms = FILES_MS) => (await Promise.all(docs.map((d) => itemTracks(d, ms).then((t) => t.slice(0, PER_ITEM), () => [])))).flat();

const none = { results: [], more: false };
const find = {
  songs: async (q, n) => {
    if (!words(q)) return none;
    const { docs, more } = await items(fields(words(q)), n, 12);
    return { results: await tracksOf(docs), more };
  },
  albums: async (q, n) => {
    if (!words(q)) return none;
    const { docs, more } = await items(fields(words(q)), n, 20);
    return { results: docs.map(album), more };
  },
  // Creators whose name matches, from the albums credited to them (one artist per name, with an album's cover).
  artists: async (q, n) => {
    if (!words(q)) return none;
    const { docs, more } = await items(`creator:(${words(q)})`, n, 50);
    const byName = new Map();
    for (const d of docs) {
      const name = first(d.creator);
      if (name && !byName.has(name)) byName.set(name, artist(name));
    }
    return { results: [...byName.values()], more };
  },
};

// Songs tagged with a genre (For you): { results }
const byGenre = async (genre) => ({ results: await tracksOf((await items(`subject:(${words(genre)})`, 1, 8)).docs, SLOW_MS) });

// An album (an item) with all its tracks.
async function albumPage(id) {
  const meta = await getJson(`https://archive.org/metadata/${enc(id)}`);
  if (!meta.metadata) throw fail('The Internet Archive has no such album.', 404);
  const item = { identifier: id, ...meta.metadata };
  return { ...album(item), tracks: tracks(item, meta.files || [], Infinity) };
}

// An artist (a creator name): their most downloaded albums, and a few tracks from the top ones.
async function artistPage(name) {
  const { docs } = await items(`creator:${phrase(name)}`, 1, 50);
  const albums = docs.map(album);
  return { artist: artist(name), albums, tracks: await tracksOf(docs.slice(0, 4), SLOW_MS) };
}

// The item's uploaded cover (its tile), or null when it only has a drawn waveform. Kept a month.
const cover = (id) => cached(`archive:cover:${id}`, 30 * 864e5, () => files(id, SLOW_MS).then((f) => {
  const tile = f.find((x) => x.format === 'Item Tile');
  return { url: uploaded(f) && tile ? `https://archive.org/download/${enc(id)}/${tile.name.split('/').map(enc).join('/')}` : null };
})).then((r) => r.url);

module.exports = { find, byGenre, albumPage, artistPage, tracks, album, cover, seconds, words };
