// ACRUX player: one DeckAudio playing a list of catalog songs (catalog.js loads first).
// The list is the page's <body data-list> ("album:nectar", "playlist:lo-fi"). Any [data-song] button plays that song,
// in the list of its nearest [data-list]. queue.js decides what comes next (upNext); the library pages use playAt/setList.
let songs = CATALOG.list(document.body.dataset.list);
if (!songs.length) songs = CATALOG.list('album:nectar'); // an empty page list still leaves the header player something to play
let listKey = document.body.dataset.list;
let index = 0;
let started = false; // until the first play, Play starts songs[index] from its list
let loaded = null;    // the song in `music` now: songs[index] can point elsewhere once the list is swapped
const music = new DeckAudio(songs[0]?.src); // the app starts with no songs until you add some

function playAt(i) {
  if (!songs[i]) return; // an empty list: nothing to play yet
  index = i;
  started = true;
  loaded = songs[i];
  if (!music.take(songs[i].src)) { // Auto Mix had this song ready: it starts at once (deck-audio.js take())
    music.id = songs[i].id;
    music.src = songs[i].src;
    music.play();
  }
  document.getElementById('play').className = 'icon icon-pause';
}

// Swap the list (keeping the current song's place if it's in the new one); queue.js rebuilds on 'listchange'.
// nowId: the song playing, when the caller changed `songs` itself before calling (discover.js inserts into it).
function setList(list, key, nowId = songs[index]?.id) {
  if (!list.length) return;
  songs = list;
  listKey = key;
  index = Math.max(0, songs.findIndex((s) => s.id === nowId)); // by id: a list made again has new song objects
  document.dispatchEvent(new Event('listchange'));
}

(() => {
  const $ = (id) => document.getElementById(id);
  const playicon = $('play');
  const PLACEHOLDER = `${SITE}playback_tree/placeholder.svg`;

  // Every picture on the page falls back: to its data-alt (the album's cover), then the placeholder record label.
  // Image errors don't bubble, so one listener catches them all on the way down.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG') return;
    // Found by name, and not found yet: the server answers within a second rather than hold one of the page's few
    // connections to it (api/discover.js), and keeps looking. Asked once more a little later, it's usually there.
    if (img.src.includes('/discover/image?') && !img.src.includes('&again=1')) {
      const again = `${img.src}&again=1`;
      img.src = PLACEHOLDER;
      setTimeout(() => { if (img.isConnected) img.src = again; }, 4000);
      return;
    }
    const alt = img.dataset.alt;
    delete img.dataset.alt;
    if (alt && alt !== img.src) img.src = alt;
    else if (!img.src.endsWith('placeholder.svg')) img.src = PLACEHOLDER;
  }, true);

  $('master_play').addEventListener('click', () => {
    if (!started) playAt(index);
    else if (music.paused) {
      music.play();
      playicon.className = 'icon icon-pause';
    } else {
      music.pause();
      playicon.className = 'icon icon-play';
    }
  });
  // Played or paused from elsewhere (inside a YouTube video, or one going out of sight): the icon follows.
  music.addEventListener('play', () => { playicon.className = 'icon icon-pause'; });
  music.addEventListener('pause', () => { playicon.className = 'icon icon-play'; });
  // Repeat: off → the queue (the list starts over when it ends) → this song (a "1" on the icon) → off. Remembered.
  const repeat = $('repeat');
  const MODES = { off: 'Repeat', all: 'Repeat: the queue', one: 'Repeat: this song' };
  function setRepeat(mode) {
    repeat.dataset.mode = mode;
    repeat.classList.toggle('clicked', mode !== 'off');
    repeat.setAttribute('aria-pressed', mode !== 'off');
    repeat.setAttribute('aria-label', MODES[mode]);
    try { localStorage.setItem('repeat', mode); } catch {}
  }
  let saved = null;
  try { saved = localStorage.getItem('repeat'); } catch {}
  setRepeat(MODES[saved] ? saved : 'off');
  repeat.addEventListener('click', () => setRepeat({ off: 'all', all: 'one', one: 'off' }[repeat.dataset.mode]));

  // Previous: back to the song's start, or to the song before once it's within its first 3 seconds (as Spotify, Android).
  $('prev').addEventListener('click', () => {
    if (started && music.currentTime > 3 && pref('prevRestart') !== 'off') music.currentTime = 0;
    else playAt((index - 1 + songs.length) % songs.length);
  });
  $('next').addEventListener('click', () => {
    const n = upNext(); // queue.js: Next plays the top of Continue Playing (shuffled order included)
    if (n >= 0) return playAt(n);
    const skip = $('shuffle').classList.contains('clicked') ? 1 + Math.floor(Math.random() * (songs.length - 1)) : 1; // nothing queued (Infinite off)
    playAt((index + skip) % songs.length);
  });

  // Your music changed (a song or folder added or removed): the list playing is taken again, without the removed ones.
  document.addEventListener('librarychange', () => { if (listKey) setList(CATALOG.list(listKey), listKey); });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-song]');
    if (!b) return;
    const key = b.closest('[data-list]')?.dataset.list;
    // Another list, or this one changed since (songs added or removed, the same name): take the page's list as it is now.
    if (key && (key !== listKey || !songs.some((s) => s.id === b.dataset.song))) setList(CATALOG.list(key), key);
    const i = songs.findIndex((s) => s.id === b.dataset.song);
    if (i >= 0 && started && songs[i].id === loaded?.id) $('master_play').click(); // the song in the player: pause or resume it
    else if (i >= 0) playAt(i);
  });

  music.addEventListener('ended', () => setTimeout(() => {
    if (!music.ended) return; // the user picked another song during the gap
    if (repeat.dataset.mode === 'one') return playAt(index);
    const n = upNext(); // queue.js: the top of Continue Playing, -1 when it's empty
    if (n >= 0) return playAt(n);
    if (repeat.dataset.mode === 'all') { // the queue ran out (Infinite off): start the list over
      return playAt($('shuffle').classList.contains('clicked') ? Math.floor(Math.random() * songs.length) : 0);
    }
    playicon.className = 'icon icon-play'; // queue finished: stop
  }, 1000));

  // Auto Mix: the deck is told which song comes next so it can mix into it (deck-audio.js cue()); the queue says which,
  // and says again whenever it changes ('queuechange'). Not into or out of a YouTube video (it plays in YouTube's own
  // player), nor while this song repeats. An album played in order stays gapless.
  function cueNext() {
    const n = upNext(), s = songs[index], next = songs[n];
    const ok = music.automix && started && next && !next.video && !s?.video && repeat.dataset.mode !== 'one';
    const album = /^(album|discover:album):/.test(listKey || '') && n === index + 1 && !$('shuffle').classList.contains('clicked');
    music.cue(ok ? { src: next.src, id: next.id, gapless: album } : null);
  }
  document.addEventListener('queuechange', cueNext);
  // The song Auto Mix mixed into has taken over: it's the one playing now ('play' follows, which shows it).
  music.addEventListener('mixed', () => {
    const i = songs.findIndex((s) => s.id === music.id);
    if (i >= 0) { index = i; loaded = songs[i]; }
  });

  // The header and the record show a song: its cover, title and artist.
  function show(s) {
    for (const img of [$('main_cover'), $('playback_cover')]) {
      if (s.alt) img.dataset.alt = s.alt; // the album's cover, if the song's own picture fails
      else delete img.dataset.alt;
      img.src = s.cover || PLACEHOLDER;
    }
    $('albumtext').textContent = s.title;
    $('albumdescription').textContent = s.artist;
  }

  // Fill the header and record from the song now playing. Registered after queue.js's listener (DOMContentLoaded),
  // so upNext() here is already the song after this one.
  document.addEventListener('DOMContentLoaded', () => music.addEventListener('play', () => {
    const s = songs[index];
    show(s);
    const now = THEME.follows() && known(s.cover);
    if (now) THEME.paint(now); // read before (this song ahead, or played already): with the cover, not after it
    if (pref('ahead') === 'off') return; // Settings: nothing loads ahead, to save data
    const n = upNext();
    if (n >= 0 && songs[n].cover && THEME.follows()) coverColour(songs[n].cover);
    // Only a Discover song is fetched ahead: your own are on this computer, or the server keeps their start ready
    // (api/cache.js), so a 100 MB FLAC isn't pulled in while this one plays.
    if (n >= 0 && !songs[n].lib && !music.automix) music.preload(songs[n].src); // Auto Mix fetches it itself (cue())
    // Songs from your Google Drive: the server fetches the start of the next few ahead (api/cache.js).
    const drive = [s, ...(window.upcoming?.(10) || [])].filter((x) => x?.drive).map((x) => x.trackId);
    if (drive.length) fetch(`${SITE}api/player/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: drive }) }).catch(() => {});
  }));

  // The song, remembered (localStorage 'nowPlaying'): which one, its second and length, and its list, so a reload or
  // the next start of the app puts it back, paused there, with the same queue. Your songs are kept by id, Discover's
  // as their result (which rebuilds them). Saved when a song starts or pauses, every 5 s while it plays, and when the
  // window is hidden or closed.
  // ponytail: up to 500 songs around the one playing (Infinite can run for hours); keep more if a longer queue is missed.
  function remember() {
    const s = songs[index];
    if (!started || !s) return;
    const from = Math.max(0, index - 100);
    try {
      localStorage.setItem('nowPlaying', JSON.stringify({ list: listKey, id: s.id, at: music.currentTime,
        length: isFinite(music.duration) ? music.duration : 0, songs: songs.slice(from, from + 500).map((x) => x.result || x.id) }));
    } catch {} // private mode: it plays, it just isn't remembered
  }
  let savedAt = 0;
  music.addEventListener('play', remember);
  music.addEventListener('pause', remember);
  music.addEventListener('timeupdate', () => { if (Date.now() - savedAt > 5000) { savedAt = Date.now(); remember(); } });
  window.addEventListener('pagehide', remember);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') remember(); });
  CATALOG.ready.then(() => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('nowPlaying')); } catch {}
    if (started || pref('resume') === 'off' || !Array.isArray(saved?.songs)) return; // something already playing, or nothing kept
    const list = saved.songs.map((x) => (typeof x === 'string' ? CATALOG.find(x) : CATALOG.fromResult(x))).filter(Boolean);
    if (!list.some((s) => s.id === saved.id)) return; // gone from your library since
    if (saved.list && !CATALOG.list(saved.list).length) CATALOG.addList(saved.list, list); // a list made at runtime (Discover's, Home's)
    setList(list, saved.list, saved.id);
    started = true; // Play carries on with it (music.play), not the page's list
    loaded = songs[index];
    music.id = songs[index].id;
    music.src = songs[index].src;
    music.resume(saved.at, saved.length);
    show(songs[index]);
  });

  // Your taste (api/taste.js): how long you actually listened to each song (seeks and scratching don't count) goes to
  // the server when the song changes, ends, or the page is hidden, with the list it played in (a playlist's plays
  // rank it in the side panel). A Discover song carries its API result; a library
  // song is described the same way here. Without the server (GitHub Pages) the beacon just finds nothing to talk to.
  let heard = 0;
  let last = null;
  let current = null;
  let currentList = null;
  const secs = (t = '') => t.split(':').reduce((m, x) => m * 60 + Number(x), 0);
  const described = (s) => s.result || {
    source: 'library', id: s.id, title: s.title, artist: s.artist, album: CATALOG.album(s.album)?.title, albumId: s.album,
    durationSec: secs(s.time), artworkUrl: s.cover, category: 'library',
    playback: { kind: 'audio', urls: { low: s.src, medium: s.src, high: s.src } },
    tags: { genres: [CATALOG.album(s.album)?.genre].filter(Boolean), kinds: [] },
  };
  function report() {
    if (current && heard >= 1 && pref('learn') !== 'off') { // Settings can keep your plays out of For you
      const song = described(current);
      navigator.sendBeacon?.(`${SITE}api/plays`, JSON.stringify({ song, listenedSec: Math.round(heard), durationSec: Math.round(music.duration) || song.durationSec, list: currentList }));
    }
    heard = 0;
    last = null;
  }
  music.addEventListener('timeupdate', () => {
    const t = music.currentTime;
    const step = last === null ? 0 : t - last;
    if (!music.paused && music.scratchRate === null && step > 0 && step < 2) heard += step;
    last = t;
  });
  music.addEventListener('play', () => {
    if (songs[index] === current) return; // a resume
    report();
    current = songs[index];
    currentList = listKey;
  });
  music.addEventListener('ended', report);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') report(); });

  // The cover's dominant vivid colour, for the parts that follow it (colours.js: the record's lights via --tint, and any
  // colour Settings sets to follow the cover). The picture itself never waits on this: it shows whatever its site allows.
  // Reading its colours needs a same-origin or CORS copy: a fresh CORS fetch (not the cached, header-less copy the
  // <img> may have), else the server's same-origin copy (/discover/art); if neither works the colours stay as they are.
  // Each cover's colour is read once, and the next song's while this one plays (the play listener above), so the
  // colours change with the cover rather than after it.
  const label = $('playback_cover');
  const colours = new Map(); // cover address → [r, g, b], null (unreadable), or the promise of one
  const address = (src) => new URL(src, location.href).href;
  const picture = (src) => new Promise((done) => {
    const pic = new Image();
    pic.onload = () => done(pic);
    pic.onerror = () => done(null);
    pic.src = src;
  });
  async function readable(src) {
    if (new URL(src).origin === location.origin) return picture(src);
    try {
      const res = await fetch(src, { mode: 'cors', cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      return await createImageBitmap(await res.blob());
    } catch {
      return picture(`${SITE}discover/art?u=${encodeURIComponent(src)}`);
    }
  }
  function coverColour(cover) {
    const src = address(cover);
    if (!colours.has(src)) {
      const reading = readable(src).then((pic) => pic && tint(pic)).catch(() => null);
      colours.set(src, reading);
      reading.then((c) => colours.set(src, c));
    }
    return colours.get(src);
  }
  const known = (cover) => { const c = cover && colours.get(address(cover)); return Array.isArray(c) ? c : null; };
  label.addEventListener('load', async () => {
    const src = label.src;
    if (src.endsWith('placeholder.svg') || !THEME.follows()) return; // Settings: nothing follows the cover
    const c = await coverColour(src);
    if (c && label.src === src) THEME.paint(c); // not when the song changed meanwhile
  });

  function tint(pic) {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    ctx.canvas.width = ctx.canvas.height = 32;
    let px;
    try {
      ctx.drawImage(pic, 0, 0, 32, 32);
      px = ctx.getImageData(0, 0, 32, 32).data;
    } catch { return null; } // a tainted canvas (file://): keep the colour
    const bins = Array.from({ length: 12 }, () => [0, 0, 0, 0]); // r, g, b, weight per 30deg of hue
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const max = Math.max(r, g, b), c = max - Math.min(r, g, b);
      const h = c === 0 ? 0 : max === r ? ((g - b) / c + 6) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
      const w = (c / 255) ** 2 + 0.0005; // vivid pixels count most, greys barely
      const bin = bins[Math.floor(h * 2) % 12];
      bin[0] += r * w; bin[1] += g * w; bin[2] += b * w; bin[3] += w;
    }
    const [r, g, b, w] = bins.reduce((best, bin) => (bin[3] > best[3] ? bin : best));
    const k = 235 / Math.max(r / w, g / w, b / w, 1); // same hue, lifted so it reads on the dark record
    const ch = (v) => Math.min(255, Math.round(v / w * k));
    return [ch(r), ch(g), ch(b)];
  }
})();
