// ACRUX taste: what you listen to, learned from your plays, and the "For you" rows built from it.
// Every play arrives from the page (POST /api/plays) with its song in the shared result shape (api/common.js), so a
// song from your library, Jamendo, Audius, the Internet Archive, iTunes or YouTube is read the same way, on five
// dimensions: genre, kind (mood, tempo, voice, sound), category (library, independent, live, community…), artist and
// album. Genres come from the song's source plus the artist's MusicBrainz genres (fetched once a month per artist).
const { db, cached } = require('./db');
const { fail, notGenre } = require('./common');
const mbz = require('./musicbrainz');
const jamendo = require('./jamendo');
const archive = require('./archive');
const audius = require('./audius');

const DAY = 864e5;
const HALF_LIFE = 7 * DAY; // "lately": a play a week ago counts half as much as one today…
const RECENT = 30 * DAY;   // …and plays over a month old don't count there at all

db.exec(`
  CREATE TABLE IF NOT EXISTS songs (id TEXT PRIMARY KEY, json TEXT NOT NULL, first_seen INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS plays (song_id TEXT NOT NULL, listened REAL NOT NULL, duration REAL NOT NULL, at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS plays_at ON plays (at);
  CREATE TABLE IF NOT EXISTS artist_genres (artist TEXT PRIMARY KEY, json TEXT NOT NULL, fetched INTEGER NOT NULL);
`);

// ---------- names ----------

// One spelling per genre across sources: "Hip-Hop/Rap", "hiphop" and "Hip hop music" are all "hip hop".
// ponytail: aliases by hand; add them as new spellings show up.
const ALIAS = { hiphop: 'hip hop', 'hip hop rap': 'hip hop', 'lo fi': 'lofi', 'lo fi hip hop': 'lofi hip hop', 'r&b soul': 'r&b',
  'rhythm and blues': 'r&b', electronica: 'electronic', 'independent': 'indie', 'alternative music': 'alternative' };
function genre(name) {
  const g = String(name).toLowerCase().replace(/[-_/]/g, ' ').replace(/\s+music$/, '').replace(/\s+/g, ' ').trim();
  return ALIAS[g] || g;
}
const kind = (name) => String(name).toLowerCase().trim();

// ---------- recording ----------

const text = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const words = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 12).map((x) => x.slice(0, 60)) : []);
// Only the fields the taste and the replay need, each checked: the page is the only writer, but the body is still input.
function clean(song) {
  const p = song.playback;
  const playback = p?.kind === 'embed' && typeof p.videoId === 'string' ? { kind: 'embed', videoId: p.videoId.slice(0, 20) }
    : p?.kind === 'audio' && p.urls && ['low', 'medium', 'high'].every((t) => /^https?:\/\//.test(p.urls[t] || ''))
      ? { kind: 'audio', urls: { low: text(p.urls.low, 1000), medium: text(p.urls.medium, 1000), high: text(p.urls.high, 1000) } } : null;
  if (!playback || !text(song.id) || !text(song.title) || !text(song.source, 20)) return null;
  return {
    source: song.source, id: song.id, title: song.title, artist: text(song.artist) || 'Unknown artist', artistId: text(song.artistId),
    album: text(song.album), albumId: text(song.albumId), durationSec: Number(song.durationSec) || 0,
    artworkUrl: text(song.artworkUrl, 1000) || null, artworkAlt: text(song.artworkAlt, 1000), sourceUrl: text(song.sourceUrl, 1000),
    category: text(song.category, 20), community: song.community === true || undefined, preview: song.preview === true || undefined,
    tags: { genres: words(song.tags?.genres), kinds: words(song.tags?.kinds) }, playback,
  };
}

const putSong = db.prepare('INSERT INTO songs (id, json, first_seen) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json');
const putPlay = db.prepare('INSERT INTO plays (song_id, listened, duration, at) VALUES (?, ?, ?, ?)');
const countPlays = db.prepare('SELECT COUNT(*) AS n FROM plays');

// One listen: { song, listenedSec, durationSec }. Under 10 s it's kept as a skip (it counts against).
function record(body) {
  const song = clean(body?.song || {});
  const listened = Number(body?.listenedSec);
  const duration = Number(body?.durationSec) || song?.durationSec || 0;
  if (!song || !(listened >= 0 && listened < 86400) || !(duration >= 0 && duration < 86400)) throw fail('Not a play', 400);
  const id = `${song.source}:${song.id}`;
  putSong.run(id, JSON.stringify(song), Date.now());
  putPlay.run(id, listened, duration, Date.now());
  const genres = song.artist !== 'Unknown artist' ? artistGenres(song.artist).catch(() => {}) : Promise.resolve(); // never holds up the page
  // For you is rebuilt every 5 plays; build it now, in the background, so Discover opens with it ready.
  if (countPlays.get().n % 5 === 1) genres.then(() => forYou()).catch(() => {});
}

// The artist's MusicBrainz genres, fetched at most once a month (an unknown artist is remembered as none).
const getGenres = db.prepare('SELECT json, fetched FROM artist_genres WHERE artist = ?');
const putGenres = db.prepare('INSERT OR REPLACE INTO artist_genres (artist, json, fetched) VALUES (?, ?, ?)');
async function artistGenres(name) {
  const key = name.toLowerCase();
  const row = getGenres.get(key);
  if (row && Date.now() - row.fetched < RECENT) return JSON.parse(row.json);
  const found = await mbz.artist(name);
  const value = { genres: found?.genres || [], mbid: found?.mbid || null };
  putGenres.run(key, JSON.stringify(value), Date.now());
  return value;
}
const knownGenres = (name) => { const row = getGenres.get(String(name).toLowerCase()); return row ? JSON.parse(row.json) : { genres: [], mbid: null }; };

// ---------- metrics ----------

// How much a play says you like the song: the share of it you heard; a skip (under 10 s) counts against.
const weight = (listened, duration) => (listened < 10 ? -0.3 : Math.min(1, listened / (duration || listened)));
// Older plays count for less, halving every `halfLife` (0: never).
const decay = (age, halfLife) => (halfLife ? 0.5 ** (age / halfLife) : 1);

// Your top genres, kinds, categories, artists, albums and songs from plays since `since`.
function profile(plays, since, halfLife, now = Date.now()) {
  const dims = { genres: new Map(), kinds: new Map(), categories: new Map(), artists: new Map(), albums: new Map(), songs: new Map() };
  for (const p of plays) {
    if (p.at < since) continue;
    const w = weight(p.listened, p.duration) * decay(now - p.at, halfLife);
    const s = p.song;
    const add = (dim, key, name, extra) => {
      if (!key) return;
      const e = dims[dim].get(key) || { name, score: 0, plays: 0, ...extra };
      if (name !== String(name).toLowerCase()) e.name = name; // "Radiohead" over "radiohead", whichever came first
      e.score += w;
      if (w > 0) e.plays++;
      dims[dim].set(key, e);
    };
    const who = genre(s.artist); // uploaders often tag a song with its artist: that's not a genre or a kind
    const genres = new Set([...s.tags.genres, ...(p.artistGenres || [])].map(genre).filter((g) => g && g !== who && !notGenre(g)));
    for (const g of genres) add('genres', g, g);
    for (const k of new Set(s.tags.kinds.map(kind).filter((k) => k && genre(k) !== who))) add('kinds', k, k);
    add('categories', s.category, s.category);
    add('artists', s.artist.toLowerCase(), s.artist, { source: s.source, id: s.artistId || null });
    if (s.album) add('albums', `${s.artist}\u0000${s.album}`.toLowerCase(), s.album, { artist: s.artist, source: s.source, id: s.albumId || null, cover: s.artworkUrl || null });
    add('songs', p.song_id, s.title, { song: s });
  }
  const top = (m, n) => [...m.values()].filter((e) => e.score > 0).sort((a, b) => b.score - a.score).slice(0, n)
    .map((e) => ({ ...e, score: Math.round(e.score * 100) / 100 }));
  return { genres: top(dims.genres, 10), kinds: top(dims.kinds, 10), categories: top(dims.categories, 6),
    artists: top(dims.artists, 10), albums: top(dims.albums, 10), songs: top(dims.songs, 20) };
}

const allPlays = db.prepare('SELECT p.song_id, p.listened, p.duration, p.at, s.json FROM plays p JOIN songs s ON s.id = p.song_id ORDER BY p.at');
function taste() {
  const plays = allPlays.all().map((p) => {
    const song = JSON.parse(p.json);
    return { ...p, song, artistGenres: knownGenres(song.artist).genres };
  });
  const now = Date.now();
  return { plays: plays.length, allTime: profile(plays, 0, 0, now), recent: profile(plays, now - RECENT, HALF_LIFE, now) };
}

// ---------- Home ----------

// The home page's rows: songs heard lately, songs new to you (the first time you heard them, until Add More Songs
// exists), and your most-played artists and albums. Plays under 10 s (skips) don't put a song in either list.
const lastHeard = db.prepare(`SELECT s.json, MAX(p.at) AS last FROM plays p JOIN songs s ON s.id = p.song_id
  WHERE p.listened >= 10 GROUP BY s.id ORDER BY last DESC LIMIT 20`);
const newToYou = db.prepare(`SELECT s.json FROM songs s WHERE EXISTS (SELECT 1 FROM plays p WHERE p.song_id = s.id AND p.listened >= 10)
  ORDER BY s.first_seen DESC LIMIT 20`);
// Your songs: every song from outside your library (Discover) you've listened to (10 s or more), newest first, with how
// often. The library's Recently Added and the side-panel search show them. Videos stay on YouTube, so they're left out.
const yourSongs = db.prepare(`SELECT s.json, COUNT(*) AS plays FROM songs s JOIN plays p ON p.song_id = s.id
  WHERE p.listened >= 10 AND s.id NOT LIKE 'library:%' GROUP BY s.id ORDER BY s.first_seen DESC`);
const mine = () => ({ songs: yourSongs.all().map((r) => ({ ...JSON.parse(r.json), plays: r.plays })).filter((s) => s.playback.kind === 'audio') });

function home() {
  const t = taste();
  const songs = (rows) => rows.map((r) => JSON.parse(r.json));
  return { plays: t.plays, recent: songs(lastHeard.all()), added: songs(newToYou.all()), artists: t.allTime.artists, albums: t.allTime.albums };
}

// ---------- For you ----------

// Audius only knows its own genre names.
const AUDIUS = ['Electronic', 'Rock', 'Metal', 'Alternative', 'Hip-Hop/Rap', 'Experimental', 'Punk', 'Folk', 'Pop', 'Ambient',
  'Soundtrack', 'World', 'Jazz', 'Acoustic', 'Funk', 'R&B/Soul', 'Classical', 'Reggae', 'Country', 'Blues', 'Latin', 'Lo-Fi',
  'Hyperpop', 'Dancehall', 'Techno', 'Trap', 'House', 'Deep House', 'Disco', 'Electro', 'Trance', 'Downtempo', 'Drum & Bass', 'Dubstep'];
const audiusGenre = (g) => AUDIUS.find((a) => genre(a) === g) || AUDIUS.find((a) => g.split(' ').includes(genre(a)));

// Songs for a genre from every free source, taking turns so no source crowds the row; songs you've played a lot, out.
async function genreMix(g, played) {
  const tag = g.replace(/\s+/g, '');
  const lists = (await Promise.allSettled([
    jamendo.byGenre(tag), audiusGenre(g) ? audius.byGenre(audiusGenre(g)) : { results: [] }, archive.byGenre(g),
  ])).map((r) => (r.status === 'fulfilled' ? r.value.results.filter((s) => !played.has(`${s.source}:${s.id}`)) : []));
  const out = [];
  for (let i = 0; out.length < 20 && lists.some((l) => l[i]); i++) for (const l of lists) if (l[i] && out.length < 20) out.push(l[i]);
  return out;
}

// More by an artist you like, from where their music is: their own page on its source, else a search of every source.
async function moreFrom(a, played) {
  const pages = { jamendo, audius, archive };
  let songs = [];
  if (pages[a.source] && a.id) songs = (await pages[a.source].artistPage(a.id)).tracks;
  if (songs.length < 6) {
    const found = await Promise.allSettled([jamendo, audius, archive].map((s) => s.find.songs(a.name, 1)));
    songs.push(...found.flatMap((r) => (r.status === 'fulfilled' ? r.value.results : [])).filter((s) => s.artist.toLowerCase() === a.name.toLowerCase()));
  }
  return songs.filter((s) => !played.has(`${s.source}:${s.id}`)).slice(0, 20);
}

// Rows for Discover's landing page, rebuilt every 6 hours or after 5 more plays.
async function forYou() {
  const t = taste();
  if (!t.plays) return { taste: t, rows: [] };
  const rows = await cached(`foryou:${Math.floor(t.plays / 5)}:${Math.floor(Date.now() / (6 * 36e5))}`, 6 * 36e5, async () => {
    const played = new Set(t.allTime.songs.filter((s) => s.plays >= 2).map((s) => `${s.song.source}:${s.song.id}`));
    const recent = t.recent.genres.map((g) => g.name);
    const always = t.allTime.genres.map((g) => g.name).find((g) => g !== recent[0]);
    const artists = t.allTime.artists.slice(0, 3);
    const top = artists[0];
    const jobs = [
      recent[0] && genreMix(recent[0], played).then((songs) => ({ title: 'Your recent mix', note: recent.slice(0, 3).join(' · '), songs })),
      always && genreMix(always, played).then((songs) => ({ title: `Because you like ${always}`, songs })),
      ...artists.map((a) => moreFrom(a, played).then((songs) => ({ title: `More from ${a.name}`, songs }))),
      top && artistGenres(top.name).then((g) => (g.mbid ? mbz.similar(g.mbid) : []))
        .then((like) => ({ title: `Artists like ${top.name}`, artists: like })),
    ].filter(Boolean);
    const done = await Promise.allSettled(jobs);
    for (const r of done) if (r.status === 'rejected') console.error('For you:', r.reason?.message);
    const rows = done.filter((r) => r.status === 'fulfilled' && (r.value.songs?.length || r.value.artists?.length)).map((r) => r.value);
    const onRepeat = t.allTime.songs.filter((s) => s.plays >= 2).slice(0, 12).map((s) => s.song);
    return [...(onRepeat.length ? [{ title: 'On repeat', songs: onRepeat }] : []), ...rows];
  });
  return { taste: t, rows }; // the taste itself is always fresh; only the searched rows are kept
}

module.exports = { record, taste, home, mine, forYou, profile, weight, genre, clean };
