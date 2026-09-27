// ACRUX catalog: every song, album, artist and playlist the site knows: the built-in ones below, plus your music from
// the server (songs you added and your Google Drive folders, api/library.js) once `ready`.
// Load it first: it sets SITE (asset and page URLs, from this script's own location, so any page depth works).
const SITE = new URL('../', document.currentScript.src).href;
// A choice made in Settings (settings.js), kept on this device: its stored string, else `fallback` (unset, private mode).
function pref(key, fallback = null) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
const CATALOG = (() => {
  const cover = (file) => `${SITE}playback_tree/covers/${file}`;
  const artists = [
    { id: 'acdc', name: 'AC/DC', photo: cover('artist_acdc.jpg') },
    { id: 'brent', name: 'Brent Faiyaz' },
    { id: 'joji', name: 'Joji', photo: cover('artist_joji.jpg') },
    { id: 'nirvana', name: 'Nirvana', photo: cover('artist_nirvana.jpg') },
    { id: 'radiohead', name: 'Radiohead', photo: cover('artist_radiohead.jpg') },
    { id: 'weeknd', name: 'The Weeknd', photo: cover('artist_weekend.jpg') },
  ];
  const albums = [
    { id: 'nectar', title: 'Nectar', artist: 'joji', genre: 'Alternative', year: 2020, cover: cover('joji/joji_nector.jpg'),
      desc: 'The follow-up to 2018’s BALLADS 1 builds on the Japanese singer’s daring aesthetic—an arty blur of bedroom trip-hop, alt-R&B and slow-winding IDM that always seems to zig when you think it’ll zag.' },
    { id: 'smithereens', title: 'Smithereens', artist: 'joji', genre: 'Alternative', year: 2022, cover: cover('joji/joji_smithereens.jpg'),
      desc: 'Joji’s third album, released in 2022. Nine short, stripped-back songs about love that is already slipping away, led by the piano ballad Glimpse of Us.' },
    // No audio for these yet: their pages say so.
    { id: 'amnesiac', title: 'Amnesiac', artist: 'radiohead', genre: 'Alternative', year: 2001, cover: cover('radiohead_amnesiac.png') },
    { id: 'nevermind', title: 'Nevermind', artist: 'nirvana', genre: 'Grunge', year: 1991, cover: cover('nirvana.jpg') },
    { id: 'wasteland', title: 'Wasteland', artist: 'brent', genre: 'R&B', year: 2022, cover: cover('waste_land.jpg') },
  ];
  // [title, time, cover file (album cover if none), audio file name (track number if none)]
  const tracks = {
    nectar: ['nector', [
      ['Ew', '3:27'], ['Modus', '3:27'], ['Tick Tock', '2:12'], ['Daylight', '2:43', 'joji_daylight.jpg'],
      ['Gimme Love', '3:34', 'joji_golden.jpg'], ['Run', '3:15', 'joji_run.jpg'], ['Sanctuary', '3:00', 'joji%20santuary.jpg'],
      ['High Hopes', '3:02'], ['Nitrous', '2:11'], ['Pretty Boy', '2:36'], ['Normal People', '2:46'], ['Afterthought', '3:14'],
      ['Mr.Hollywood', '3:22'], ['777', '3:01'], ['Reanimator', '3:03'], ['Like You Do', '4:00'], ['Your Man', '2:43'], ['Upgrade', '1:29'],
    ]],
    smithereens: ['smithereens', [
      ['Feeling Like the End', '3:27'], ['Glimpse of Us', '3:27', 'joji_glimps_of_us.jpg', '2r'], ['Die For You', '2:12'],
      ['Before the Day Is Over', '2:43'], ['Dissolve', '3:34'], ['Night Rider', '3:15'], ['BlahBlahBlah', '3:00'], ['Yukon', '3:02'], ['1AM Freestyle', '2:11'],
    ]],
  };
  const songs = Object.entries(tracks).flatMap(([album, [folder, list]]) => list.map(([title, time, art, file], i) => ({
    id: `${album}-${i + 1}`, n: i + 1, title, time, album, artist: 'Joji',
    cover: art ? cover(`joji/${art}`) : albums.find((a) => a.id === album).cover,
    alt: albums.find((a) => a.id === album).cover, // the album's cover, if the song's own picture fails
    src: `${SITE}playback_tree/songs/joji/${folder}/${file || i + 1}.mp3`,
  })));
  // Demo playlists (`demo`: they play, pin, favorite, download and duplicate, but can't be changed; to go later), and
  // the Library's own: Favorites (the songs you ♥, from the server) and Recently Added. Yours come from the server
  // (applyCollection). A cover is `favorites` (heart), `photo`, `groove` colours, or else a mosaic of the first four
  // song covers. `hidden` lists open from the Library but aren't in My Playlists.
  const playlists = [
    { id: 'favorites', title: 'Favorites', favorites: true, songs: [] },
    { id: 'late-night-joji', demo: true, title: 'Late Night Joji', desc: 'Slow ones for after midnight: Joji, mostly.',
      songs: ['smithereens-2', 'nectar-1', 'nectar-7', 'nectar-4', 'smithereens-3', 'nectar-6', 'smithereens-1', 'nectar-5', 'smithereens-8', 'nectar-12', 'smithereens-5', 'nectar-18'] },
    { id: 'lo-fi', demo: true, title: 'Lo-Fi', groove: ['#e8a73c', '#2c1905'],
      songs: ['nectar-2', 'nectar-9', 'nectar-11', 'nectar-13', 'smithereens-7', 'smithereens-9', 'nectar-17', 'nectar-15', 'smithereens-6'] },
    { id: 'party', demo: true, title: 'Party Playlists', groove: ['#e8457f', '#2a0714'],
      songs: ['nectar-3', 'nectar-14', 'nectar-5', 'nectar-10', 'nectar-8', 'nectar-16', 'nectar-4', 'nectar-17'] },
    { id: 'summer-20', demo: true, title: 'Summer ’20', photo: cover('joji/joji_daylight.jpg'),
      songs: ['nectar-4', 'nectar-5', 'nectar-6', 'nectar-7', 'nectar-16', 'nectar-18', 'nectar-3', 'nectar-1'] },
    { id: 'slow-burn', demo: true, title: 'Slow Burn', groove: ['#d63a2e', '#1c0404'],
      songs: ['smithereens-5', 'smithereens-4', 'smithereens-3', 'nectar-12', 'nectar-11', 'nectar-7', 'smithereens-2'] },
    { id: 'recently-played', title: 'Recently Played', hidden: true, songs: [] }, // filled from your plays (homeReady)
    { id: 'recently-added', title: 'Recently Added', hidden: true,
      songs: ['nectar-7', 'nectar-2', 'nectar-3', 'nectar-16', 'nectar-17', 'nectar-13', 'nectar-14', 'nectar-15'] },
  ];
  // The desktop app ships without the demo songs (edition.js): it starts with only your music.
  if (window.ACRUX_APP) {
    artists.length = albums.length = songs.length = 0;
    playlists.splice(0, playlists.length, ...playlists.filter((p) => !p.demo));
    playlists.find((p) => p.id === 'recently-added').songs = [];
  }
  const song = (id) => songs.find((s) => s.id === id);
  const album = (id) => albums.find((a) => a.id === id);
  const artist = (id) => artists.find((a) => a.id === id);
  const playlist = (id) => playlists.find((p) => p.id === id);
  // Lists made at runtime (Discover's results, discover.js): key -> songs. The player plays them like any other list.
  const made = {};
  const addList = (key, songs) => { if (songs) made[key] = songs; else delete made[key]; }; // none: the list goes
  const find = (id) => song(id) || Object.values(made).flat().find((s) => s.id === id); // a Discover song too
  // "album:nectar" or "playlist:lo-fi" (or a made list's key) -> its songs, in order
  const list = (key = '') => {
    if (made[key]) return made[key];
    const [kind, id] = key.split(':');
    if (kind === 'album') return songs.filter((s) => s.album === id);
    return (playlist(id)?.songs || []).map(song).filter(Boolean);
  };
  const page = (query) => `${SITE}library.html${query ? `?${query}` : ''}`;

  // Songs from the server (Discover, and your listening: api/common.js's result shape) as songs the player, queue and
  // ⋯ tray understand. A library song comes back as itself. Its src follows the streaming quality picked on Discover.
  const quality = () => {
    try {
      const saved = localStorage.getItem('quality');
      return ['low', 'medium', 'high'].includes(saved) ? saved : 'medium';
    } catch { return 'medium'; }
  };
  const tiers = { low: 'Low · 96 kbps MP3, saves data', medium: 'Medium · about 200 kbps MP3', high: 'High · lossless FLAC where the source has it, larger downloads' };
  // Picked on Discover or in Settings: the song playing now reloads at the same spot when it has that quality.
  function setQuality(t) {
    try { localStorage.setItem('quality', t); } catch {} // private mode: stays Medium
    const s = started && songs[index];
    if (!s?.urls || s.src === music.src) return; // not a Discover song, or the same file in this quality
    const pos = music.currentTime;
    const playing = !music.paused;
    music.src = s.src;
    const url = music.src;
    music.addEventListener('canplay', () => { if (music.src === url) music.currentTime = pos; }, { once: true });
    if (playing) music.play();
  }
  const BADGE = { jamendo: 'Jamendo', archive: 'Archive', audius: 'Audius', itunes: 'Preview', youtube: 'YouTube' };
  // A Discover album or artist page, for the sources that have them.
  const discover = (kind, source, id) => (['jamendo', 'archive', 'audius'].includes(source) && id
    ? page(`view=discover&${kind}=${encodeURIComponent(`${source}:${id}`)}`) : null);
  const fromResult = (r) => {
    if (r.source === 'library') return song(r.id) || null;
    const secs = Math.floor(r.durationSec || 0);
    const time = secs ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '';
    if (r.playback?.kind === 'embed') { // a YouTube video: it plays as a screen on the deck (deck-audio.js)
      return {
        id: `${r.source}:${r.id}`, source: r.source, result: r, video: true, src: `youtube:${r.playback.videoId}`,
        title: r.title, artist: r.artist, albumTitle: r.album || 'YouTube', time, cover: r.artworkUrl || `${SITE}playback_tree/placeholder.svg`,
        alt: null, sourceUrl: r.sourceUrl, albumHref: null, artistHref: null, href: page('view=discover'),
      };
    }
    if (r.playback?.kind !== 'audio') return null;
    const albumHref = discover('album', r.source, r.albumId);
    return {
      id: `${r.source}:${r.id}`, jamendoId: r.source === 'jamendo' ? r.id : null, source: r.source, result: r,
      title: r.title, artist: r.artist, albumTitle: r.album || BADGE[r.source], time,
      cover: r.artworkUrl || `${SITE}playback_tree/placeholder.svg`, alt: r.artworkAlt || null, urls: r.playback.urls, sourceUrl: r.sourceUrl,
      albumHref, artistHref: discover('artist', r.source, r.artistId), href: albumHref || page('view=discover'),
      get src() { // a copy kept offline plays from this computer
        return offline.get(this.id) === 'done' ? `${SITE}api/offline/${encodeURIComponent(this.id)}/audio` : this.urls[quality()] || this.urls.medium;
      },
    };
  };
  const asJson = (res) => (res.headers.get('content-type')?.includes('json') ? res.json() : {});
  // What pages ask the server for on each visit (your songs, your most-played lists, Home's rows): fetched once and kept
  // until a live event says it changed (below). {} without the server, asked again next time.
  const kept = new Map(); // api path -> a promise of its JSON
  function get(path) {
    if (!kept.has(path)) {
      kept.set(path, fetch(`${SITE}api/${path}`).then((res) => (res.ok ? asJson(res) : {})).catch(() => {
        kept.delete(path);
        return {};
      }));
    }
    return kept.get(path);
  }

  // Your music (api/library.js): each album joins `albums` (by its artist, matched by name to one already here, else
  // added), its songs join `songs`, and they play from /api/tracks/<id>/audio. Marked `lib`, so reload() can swap
  // them for a fresh copy after you add or remove some.
  const clock = (sec) => (sec ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}` : '');
  const slug = (t) => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
  // Where they came from: [{ id: 'local' | 'drive:<id>' | 'dir:<id>', kind, title, isFile }] (a Drive link: a song, or a
  // folder; dir: a folder linked in place).
  const sources = [];
  // "FLAC · 24-bit/96 kHz", "MP3 · 44.1 kHz": an album's format, from its first song.
  const format = (t) => [/Layer 3/.test(t.codec) ? 'MP3' : t.codec?.split(' ')[0], [t.bits && `${t.bits}-bit`, t.sampleRate && `${+(t.sampleRate / 1000).toFixed(1)} kHz`].filter(Boolean).join('/')]
    .filter(Boolean).join(' · ');
  const mockAdded = playlist('recently-added').songs; // the built-in list, until you add songs of your own
  function addLibrary(tracks, from = []) {
    sources.splice(0, sources.length, ...from);
    for (const all of [songs, albums, artists]) for (let i = all.length - 1; i >= 0; i--) if (all[i].lib) all.splice(i, 1);
    const byAlbum = new Map();
    for (const t of tracks) byAlbum.set(t.albumId, [...(byAlbum.get(t.albumId) || []), t]);
    for (const [albumId, list] of byAlbum) {
      const first = list[0];
      const who = new Set(list.map((t) => t.albumArtist)).size > 1 ? 'Various Artists' : first.albumArtist;
      let person = artists.find((a) => a.name.toLowerCase() === who.toLowerCase());
      if (!person) artists.push(person = { id: `lib-${slug(who)}`, name: who, lib: true });
      const art = list.find((t) => t.cover)?.cover;
      // No picture in its files or folder: one found online by name (api/images.js); the placeholder when it 404s (player.js).
      const named = first.album !== 'Unknown album' && `${SITE}discover/image?${new URLSearchParams({ album: first.album, artist: who })}`;
      const albumCover = art ? `${SITE}api/covers/${art}` : named || `${SITE}playback_tree/placeholder.svg`;
      const drive = first.source.startsWith('drive:');
      const id = `lib-${albumId}`;
      albums.push({ id, title: first.album, artist: person.id, genre: first.genre || '', year: first.year || '', cover: albumCover,
        lib: true, drive, local: !drive, source: first.source, format: format(first), desc: drive ? 'From your Google Drive.' : '' });
      // By disc and track number, unless they repeat (a bonus disc tagged 1, 2… again with no disc number): then by
      // file name, numbers in order ("13. …" after "2. …").
      const tagged = list.every((t) => t.track) && new Set(list.map((t) => `${t.disc}|${t.track}`)).size === list.length;
      list.sort(tagged ? (a, b) => (a.disc || 0) - (b.disc || 0) || a.track - b.track
        : (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      list.forEach((t, i) => songs.push({
        id: `lib:${t.id}`, trackId: t.id, n: tagged ? t.track : i + 1, title: t.title, time: clock(t.duration), album: id, artist: t.artist,
        cover: t.cover ? `${SITE}api/covers/${t.cover}` : albumCover, alt: albumCover, lib: true, drive,
        src: `${SITE}api/tracks/${encodeURIComponent(t.id)}/audio`, added: t.added,
        // Added on its own (a Drive link to one song, or a loose file you dropped), not with its album or folder.
        single: !!sources.find((x) => x.id === t.source)?.isFile || (t.source === 'local' && !t.name.includes('/')),
      }));
    }
    // Recently Added (My Music): the songs you added on their own, newest first. Whole albums and folders are in Albums.
    const yours = songs.filter((s) => s.single).sort((a, b) => b.added - a.added);
    Object.assign(playlist('recently-added'), yours.length
      ? { songs: yours.map((s) => s.id), desc: 'Songs you added, newest first.', yours: true } : { songs: mockAdded, desc: undefined, yours: false });
  }
  const libraryReady = () => fetch(`${SITE}api/library`).then(asJson).then((body) => addLibrary(body.tracks || [], body.sources || [])).catch(() => {});
  const sourceTitle = (id) => (id === 'local' ? 'From this computer' : sources.find((x) => x.id === id)?.title || 'From Google Drive');

  // ---------- your collection (api/collection.js) ----------
  // Your playlists, what you ♥ and pin, the songs kept offline, and who you are here: the owner (this computer), or a
  // guest invited to a playlist from the Wi-Fi. Without the server: the demo playlists, and nothing can be changed.
  let marks = new Map();   // "kind:id" -> { kind, id, title, sub, cover, href, ref?, at }
  let offline = new Map(); // song id -> 'done' | 'waiting'
  let me = {};
  let sharing = null;
  const abs = (u) => (u?.startsWith('/') ? `${SITE}${u.slice(1)}` : u);
  document.documentElement.classList.add('viewer'); // not the owner (yet): ♥ and ↓ stay hidden
  function applyCollection(c) {
    marks = new Map((c.marks || []).map((m) => [`${m.kind}:${m.id}`, m]));
    offline = new Map((c.offline || []).map((o) => [o.key, o.status]));
    me = c.me || {};
    sharing = c.sharing || null;
    document.documentElement.classList.toggle('viewer', !me.owner);
    for (let i = playlists.length - 1; i >= 0; i--) if (playlists[i].server) playlists.splice(i, 1);
    const edits = new Set((me.guest?.playlists || []).filter((x) => x.role === 'edit').map((x) => x.id));
    for (const p of c.playlists || []) {
      const list = p.songs.map(fromResult).filter(Boolean);
      addList(`playlist:${p.id}`, list);
      playlists.push({ id: p.id, title: p.title, desc: p.desc || (p.from ? 'Saved from Discover.' : ''), photo: abs(p.photo), groove: p.groove,
        songs: list.map((s) => s.id), server: true, saved: !!p.from, from: p.from, searchable: p.searchable, people: p.people || [],
        invited: !!p.invited, editable: !!me.owner || edits.has(p.id), created: p.created });
    }
    const favs = [...marks.values()].filter((m) => m.kind === 'song' && m.ref).map((m) => fromResult(m.ref)).filter(Boolean);
    addList('playlist:favorites', favs);
    playlist('favorites').songs = favs.map((s) => s.id);
  }
  const collectionReady = () => fetch(`${SITE}api/collection`).then(asJson).then((c) => { if (c.me) applyCollection(c); }).catch(() => {});
  const drawn = () => document.dispatchEvent(new Event('collectionchange')); // ♥ and ↓ drawn before it came show it
  // Recently Played and Recently Added as the home page shows them (api/taste.js, GET /api/home), so its headings open
  // them as playlists: the songs you listened to last, and the ones you added on their own plus the Discover songs new
  // to you. Before any, Recently Added stays as addLibrary left it.
  const homeReady = () => get('home').then((h) => {
    const played = (h.recent || []).map(fromResult).filter(Boolean);
    addList('playlist:recently-played', played);
    Object.assign(playlist('recently-played'), { songs: played.map((s) => s.id), desc: 'The songs you listened to last, newest first.' });
    const added = (h.added || []).map(fromResult).filter(Boolean);
    addList('playlist:recently-added', added.length ? added : undefined);
    if (added.length) Object.assign(playlist('recently-added'), { songs: added.map((s) => s.id), yours: true,
      desc: 'Songs you added on their own, and the ones new to you from Discover, newest first.' });
  }).catch(() => {});
  const loadAll = () => libraryReady().then(() => Promise.all([collectionReady(), homeReady()])).then(drawn); // after the library: your lists hold its songs
  const ready = loadAll();

  // What a song is saved as (api/playlists.js): a Discover song as its result, one of yours by id, a built-in one with
  // its file (so the server can put it in a ZIP).
  const ref = (s) => s.result || (s.lib ? { source: 'library', id: s.id }
    : { source: 'library', id: s.id, title: s.title, src: s.src.startsWith(SITE) ? s.src.slice(SITE.length) : s.src });
  const marked = (kind, id) => marks.has(`${kind}:${id}`);
  // Whether a song can be kept offline: 'here' (it's on this computer already), 'done', 'waiting', 'can', or null
  // (videos and previews can't be).
  const keepState = (s) => {
    if (!s || s.video || s.result?.preview || s.source === 'itunes') return null;
    if (!s.result && !s.drive) return 'here';
    return offline.get(s.id) || 'can';
  };
  // Pinned first (newest pin on top), then the rest as they were.
  const pinnedFirst = (lists) => [...lists].sort((a, b) => (marks.get(`pin:${b.id}`)?.at || 0) - (marks.get(`pin:${a.id}`)?.at || 0));

  // Changes go to the server, which answers with an error to show, or the change; the collection is then fetched again.
  let local = 0; // when this page last changed something: its own live event needn't redraw it
  async function call(path, method = 'GET', body) {
    const blob = body instanceof Blob;
    let res;
    try {
      res = await fetch(`${SITE}api/${path}`, { method, headers: { 'Content-Type': blob ? body.type : 'application/json' }, body: blob ? body : body && JSON.stringify(body) });
    } catch { throw new Error('That needs the ACRUX server: run npm start.'); }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'ACRUX’s server didn’t take that. Try again.');
    return out;
  }
  async function change(path, method, body) {
    local = Date.now();
    const out = await call(path, method, body);
    await refresh();
    return out;
  }
  async function refresh() {
    await collectionReady();
    document.dispatchEvent(new Event('collectionchange'));
  }
  const markInfo = (kind, x) => (kind === 'song' ? { title: x.title, sub: x.artist, cover: x.cover, href: songPage(x), ref: ref(x) } : x);
  const toggleMark = (kind, id, info) => change(`marks/${kind}/${encodeURIComponent(id)}`, marked(kind, id) ? 'DELETE' : 'PUT', markInfo(kind, info));

  // What changed on the server (/api/events), whoever changed it (another window, a guest, a folder being read, a play
  // being counted): what it changed is drawn again. One connection per window; addmore.js and setup.js listen on it.
  const events = window.EventSource ? new EventSource(`${SITE}api/events`) : null;
  if (events) {
    events.onerror = () => { if (events.readyState === EventSource.CLOSED) events.close(); }; // no server: it gives up
    // Only what changed is drawn again: ♥, ↓ and Home's rows in place (collectionchange, homechange); the page itself
    // only when the playlists or your music really changed, and never Discover's results (they'd be searched again).
    const discovering = () => /[?&]view=discover/.test(location.search) && !/[?&]mine=1/.test(location.search);
    const redraw = (before, after) => { if (before !== after && !discovering()) window.navReload?.(); };
    const listsNow = () => JSON.stringify(playlists.filter((p) => p.server).map((p) => [p.id, p.title, p.desc, p.photo, p.songs, p.people]));
    events.addEventListener('collection', () => {
      if (Date.now() - local < 2000) return; // this page's own change, drawn already
      const before = listsNow();
      catalog.ready.then(refresh).then(() => redraw(before, listsNow()));
    });
    // Songs added or removed: your music is fetched again. A play counted: Home's rows and your songs. Both drop what
    // `get` kept.
    const want = { library: false, plays: false };
    const musicNow = () => JSON.stringify([sources, songs.filter((s) => s.lib).map((s) => [s.id, s.title, s.cover, s.time, s.album])]);
    async function update() {
      const { library, plays } = want;
      want.library = want.plays = false;
      const [music, home] = [musicNow(), kept.get('home')];
      for (const path of plays ? ['songs', 'playlists/played', 'home'] : library ? ['home'] : []) kept.delete(path);
      await (library ? catalog.reload() : homeReady());
      const same = JSON.stringify(await home) === JSON.stringify(await get('home'));
      if (!same) document.dispatchEvent(new Event('homechange')); // home.js draws its rows again
      if (library && document.body.dataset.page !== 'home') redraw(music, musicNow());
    }
    // Now, then at most once per 2 s: a folder being read changes in bursts.
    let running = false;
    async function soon() {
      if (running) return;
      running = true;
      while (want.library || want.plays) {
        await update().catch(() => {});
        await new Promise((done) => setTimeout(done, 2000));
      }
      running = false;
    }
    events.addEventListener('library', () => {
      if (window.AddMore?.busy()) return; // a drop being added: drawn once it's done
      want.library = true;
      soon();
    });
    events.addEventListener('plays', () => { want.plays = true; soon(); });
  }

  // Where a song lives, opened at that song (which then plays): its album's page, else your songs (Recently Added).
  const songPage = (s) => `${s.albumHref || page('view=discover&mine=1')}&song=${encodeURIComponent(s.id)}`;
  const catalog = { artists, albums, songs, playlists, song, album, artist, playlist, list, addList, page, quality, tiers, setQuality, discover, fromResult, songPage, ready,
    sources, sourceTitle, find, ref, marked, keepState, pinnedFirst, call, change, refresh, toggleMark, get, events,
    me: () => me, sharing: () => sharing, mark: (kind, id) => marks.get(`${kind}:${id}`),
    // Fetches your music again (after adding or removing some); `ready` waits for it.
    reload() {
      catalog.ready = loadAll().then(() => document.dispatchEvent(new Event('librarychange'))); // player.js drops removed songs
      return catalog.ready;
    } };
  return catalog;
})();
