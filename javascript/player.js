// ACRUX player: one DeckAudio playing a list of catalog songs (catalog.js loads first).
// The list is the page's <body data-list> ("album:nectar", "playlist:lo-fi"). Any [data-song] button plays that song,
// in the list of its nearest [data-list]. queue.js decides what comes next (upNext); the library pages use playAt/setList.
let songs = CATALOG.list(document.body.dataset.list);
if (!songs.length) songs = CATALOG.list('album:nectar'); // an empty page list still leaves the header player something to play
let listKey = document.body.dataset.list;
let index = 0;
let started = false; // until the first play, Play starts songs[index] from its list
const music = new DeckAudio(songs[0].src);

function playAt(i) {
  index = i;
  started = true;
  music.src = songs[i].src;
  music.play();
  document.getElementById('play').className = 'icon icon-pause';
}

// Swap the list (keeping the current song's place if it's in the new one); queue.js rebuilds on 'listchange'.
function setList(list, key) {
  if (!list.length) return;
  const now = songs[index];
  songs = list;
  listKey = key;
  index = Math.max(0, songs.findIndex((s) => s.id === now.id)); // by id: a list made again has new song objects
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

  $('prev').addEventListener('click', () => playAt((index - 1 + songs.length) % songs.length));
  $('next').addEventListener('click', () => {
    const n = upNext(); // queue.js: Next plays the top of Continue Playing (shuffled order included)
    if (n >= 0) return playAt(n);
    const skip = $('shuffle').classList.contains('clicked') ? 1 + Math.floor(Math.random() * (songs.length - 1)) : 1; // nothing queued (Infinite off)
    playAt((index + skip) % songs.length);
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-song]');
    if (!b) return;
    const key = b.closest('[data-list]')?.dataset.list;
    if (key && key !== listKey) setList(CATALOG.list(key), key);
    const i = songs.findIndex((s) => s.id === b.dataset.song);
    if (i >= 0 && i === index && started) $('master_play').click(); // the song already playing: pause or resume it
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

  // Fill the header and record from the song now playing. Registered after queue.js's listener (DOMContentLoaded),
  // so upNext() here is already the song after this one.
  document.addEventListener('DOMContentLoaded', () => music.addEventListener('play', () => {
    const s = songs[index];
    for (const img of [$('main_cover'), $('playback_cover')]) {
      if (s.alt) img.dataset.alt = s.alt; // the album's cover, if the song's own picture fails
      else delete img.dataset.alt;
      img.src = s.cover || PLACEHOLDER;
    }
    $('albumtext').textContent = s.title;
    $('albumdescription').textContent = s.artist;
    const n = upNext();
    if (n >= 0) music.preload(songs[n].src);
  }));

  // Your taste (api/taste.js): how long you actually listened to each song (seeks and scratching don't count) goes to
  // the server when the song changes, ends, or the page is hidden. A Discover song carries its API result; a library
  // song is described the same way here. Without the server (GitHub Pages) the beacon just finds nothing to talk to.
  let heard = 0;
  let last = null;
  let current = null;
  const secs = (t = '') => t.split(':').reduce((m, x) => m * 60 + Number(x), 0);
  const described = (s) => s.result || {
    source: 'library', id: s.id, title: s.title, artist: s.artist, album: CATALOG.album(s.album)?.title, albumId: s.album,
    durationSec: secs(s.time), artworkUrl: s.cover, category: 'library',
    playback: { kind: 'audio', urls: { low: s.src, medium: s.src, high: s.src } },
    tags: { genres: [CATALOG.album(s.album)?.genre].filter(Boolean), kinds: [] },
  };
  function report() {
    if (current && heard >= 1) {
      const song = described(current);
      navigator.sendBeacon?.(`${SITE}api/plays`, JSON.stringify({ song, listenedSec: Math.round(heard), durationSec: Math.round(music.duration) || song.durationSec }));
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
  });
  music.addEventListener('ended', report);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') report(); });

  // Tint the record player (strobe dots, label ring, glow, deck lights, sleeve cards, search ring) with the cover's
  // dominant vivid colour via --tint. The picture itself never waits on this: it shows whatever its site allows.
  // Reading its colours needs a same-origin or CORS copy: a fresh CORS fetch (not the cached, header-less copy the
  // <img> may have), else the server's same-origin copy (/discover/art); if neither works the tint stays as it is.
  const label = $('playback_cover');
  label.addEventListener('load', async () => {
    const src = label.src;
    if (src.endsWith('placeholder.svg')) return;
    let pic = label;
    if (new URL(src).origin !== location.origin) {
      try {
        const res = await fetch(src, { mode: 'cors', cache: 'no-store' });
        if (!res.ok) throw new Error(res.status);
        pic = await createImageBitmap(await res.blob());
      } catch {
        pic = await new Promise((done) => {
          const copy = new Image();
          copy.onload = () => done(copy);
          copy.onerror = () => done(null);
          copy.src = `${SITE}discover/art?u=${encodeURIComponent(src)}`;
        });
      }
      if (!pic || label.src !== src) return; // no readable copy, or the song changed meanwhile
    }
    tint(pic);
  });

  function tint(pic) {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    ctx.canvas.width = ctx.canvas.height = 32;
    let px;
    try {
      ctx.drawImage(pic, 0, 0, 32, 32);
      px = ctx.getImageData(0, 0, 32, 32).data;
    } catch { return; } // a tainted canvas (file://): keep the colour
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
    document.documentElement.style.setProperty('--tint', `rgb(${ch(r)} ${ch(g)} ${ch(b)})`);
  }
})();
