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
  index = Math.max(0, songs.indexOf(now));
  document.dispatchEvent(new Event('listchange'));
}

(() => {
  const $ = (id) => document.getElementById(id);
  const playicon = $('play');

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
    if ($('repeat').classList.contains('clicked')) return playAt(index);
    const n = upNext(); // queue.js: the top of Continue Playing, -1 when it's empty
    if (n < 0) playicon.className = 'icon icon-play'; // queue finished (Infinite off): stop
    else playAt(n);
  }, 1000));

  // Fill the header and record from the song now playing. Registered after queue.js's listener (DOMContentLoaded),
  // so upNext() here is already the song after this one.
  document.addEventListener('DOMContentLoaded', () => music.addEventListener('play', () => {
    const s = songs[index];
    $('main_cover').src = $('playback_cover').src = s.cover;
    $('albumtext').textContent = s.title;
    $('albumdescription').textContent = s.artist;
    const n = upNext();
    if (n >= 0) music.preload(songs[n].src);
  }));

  // Tint the record player (strobe dots, label ring, glow, deck lights, sleeve cards, search ring) with the cover's dominant vivid colour via --tint.
  const label = $('playback_cover');
  label.addEventListener('load', () => {
    if (label.src.endsWith('placeholder.svg')) return;
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    ctx.canvas.width = ctx.canvas.height = 32;
    let px;
    try {
      ctx.drawImage(label, 0, 0, 32, 32);
      px = ctx.getImageData(0, 0, 32, 32).data;
    } catch { return; } // opened from file://: the canvas is tainted, keep the default red
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
  });
})();
