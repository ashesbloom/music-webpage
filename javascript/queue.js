// ACRUX queue: the Queue button slides it over the side panel. "History" (the songs played, kept in
// localStorage.playHistory) sits above the Infinite / Auto Mix buttons and "Continue Playing", so it only shows
// when you scroll up. Uses CATALOG and player.js (songs, index, music, playAt).
// The queue decides what plays next: the player's end-of-song and Next take upNext(), the top of Continue Playing.
// With Infinite on, the list plays to its end once, then songs like its last one carry on for as long as you listen
// (your own songs by that artist or in that genre first, then the server's radio: /discover/radio). Repeat (the whole
// list) loops the list instead.
(() => {
  const btn = document.getElementById('queue_btn');
  const panel = document.getElementById('sidebar');
  if (!btn || !panel) return;
  panel.insertAdjacentHTML('beforeend', `
    <section class="queue" id="queue" aria-label="Queue">
      <div class="q_bar"><h5>Queue</h5><button class="q_min" aria-label="Minimize queue"><i class="icon icon-chevron-right" aria-hidden="true"></i></button></div>
      <section class="q_hist" aria-labelledby="q_hist_h"><h5 id="q_hist_h">History</h5><ol class="q_list"></ol></section>
      <div class="q_up">
        <div class="q_modes">
          <button class="q_mode" id="infinite" aria-label="Infinite Queue" aria-pressed="true"><i class="icon icon-infinity" aria-hidden="true"></i></button>
          <button class="q_mode" id="automix" aria-label="Auto Mix · coming soon" aria-pressed="false"><i class="icon icon-automix" aria-hidden="true"></i></button>
        </div>
        <h5>Continue Playing</h5>
        <p class="q_note q_shuffle">Shuffle is on: songs play in random order</p>
        <p class="q_note q_repeat">Repeating this song</p>
        <p class="q_note q_loop">Repeating the queue: it starts over when it ends</p>
        <ol class="q_list q_next"></ol>
        <p class="q_note q_empty">End of queue</p>
      </div>
    </section>`);
  const queue = document.getElementById('queue');
  const bar = queue.querySelector('.q_bar');
  const up = queue.querySelector('.q_up');
  const hist = queue.querySelector('.q_hist ol');
  const next = queue.querySelector('.q_next');
  const infinite = document.getElementById('infinite');
  const on = (b) => b.getAttribute('aria-pressed') === 'true';

  // Continue Playing, as indexes into songs. Infinite off empties it (playback stops after this song). On, it's the
  // rest of the list (album order from here, or every other song in a fresh random order while shuffle is on), then
  // the songs like it, which are added to the end of `songs` (from radioFrom on). With Repeat on the whole list, the
  // list wraps round instead.
  let order = [];
  let current = index;
  let radioFrom = -1;  // where the added songs start in songs (-1: none yet)
  let radioSeed = null; // the song they're like
  const looping = () => document.getElementById('repeat')?.dataset.mode === 'all';
  function build() {
    if (!on(infinite)) return void (order = []);
    const base = radioFrom >= 0 ? radioFrom : songs.length; // the list itself
    const shuffled = document.getElementById('shuffle')?.classList.contains('clicked');
    const inList = index < base;
    order = looping() ? Array.from({ length: base - 1 }, (_, i) => (index + 1 + i) % base)
      : !inList ? [] // past the list: only songs like it from here
      : shuffled ? Array.from({ length: base }, (_, i) => i).filter((i) => i !== index)
      : Array.from({ length: base - index - 1 }, (_, i) => index + 1 + i);
    if (shuffled) {
      for (let i = order.length - 1; i > 0; i--) { // Fisher-Yates
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    if (!looping() && radioFrom >= 0) order.push(...songs.map((_, i) => i).filter((i) => i >= radioFrom && (inList || i > index)));
    more();
  }

  // Tops the queue up with songs like the last one in it once fewer than 5 are left. They're found on this computer
  // first (the same artist, then the same genre), then online; songs already in the list or played lately are left out.
  let asking = false;
  const genreOf = (s) => CATALOG.album(s.album)?.genre || s.result?.tags?.genres?.[0] || '';
  async function more() {
    if (asking || !on(infinite) || looping() || order.length >= 5 || !songs.length) return;
    const seed = songs[order.at(-1) ?? index];
    if (!seed) return;
    asking = true;
    try {
      const have = new Set([...songs.map((s) => s.id), ...read().map((e) => e?.id)]);
      const fresh = (s) => s && !have.has(s.id) && !s.video && have.add(s.id);
      const mine = CATALOG.songs.filter((s) => s.artist === seed.artist).concat(CATALOG.songs.filter((s) => genreOf(seed) && genreOf(s) === genreOf(seed)))
        .filter(fresh).sort(() => Math.random() - 0.5).slice(0, 8);
      let online = [];
      try {
        if (pref('radio') === 'off') throw new Error('Settings: Infinite stays in your music');
        const res = await fetch(`${SITE}discover/radio`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seed: { source: seed.result?.source || 'library', id: seed.result?.id || seed.id, title: seed.title, artist: seed.artist,
            artistId: seed.result?.artistId, genres: [genreOf(seed), ...(seed.result?.tags?.genres || [])].filter(Boolean) } }) });
        if (res.ok) online = (await res.json()).results.map(CATALOG.fromResult).filter(fresh);
      } catch {} // no server: your own songs only
      const add = [...mine, ...online];
      if (!add.length || !on(infinite) || looping()) return;
      if (radioFrom < 0) {
        radioFrom = songs.length;
        radioSeed = seed;
      }
      songs = [...songs, ...add]; // a copy: the list itself (a playlist's songs) stays as it is
      order.push(...add.map((_, k) => songs.length - add.length + k));
      render();
    } finally {
      asking = false;
    }
  }
  window.upNext = () => order[0] ?? -1;
  window.upcoming = (k) => order.slice(0, k).map((i) => songs[i]); // the next k songs (player.js tells the Drive cache)

  const KEY = 'playHistory';
  const MAX = 30;
  const store = (key, value) => { try { localStorage.setItem(key, value); } catch {} }; // private mode: works, isn't remembered
  function read() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  }
  const sameSite = (href) => { try { return new URL(href).origin === location.origin; } catch { return false; } };
  const entry = (s) => {
    const album = CATALOG.album(s.album); // a Discover song has none: it links back to its search instead
    return { id: s.id, name: s.title, artist: s.artist, cover: s.cover, album: album ? album.title : s.albumTitle, href: album ? CATALOG.page(`view=album&id=${s.album}`) : s.href };
  };

  // Infinite (on by default: the album loops, as it always has) and Auto Mix remember their state.
  for (const [b, fallback] of [[infinite, 'true'], [document.getElementById('automix'), 'false']]) {
    let saved = null;
    try { saved = localStorage.getItem(b.id); } catch {}
    b.setAttribute('aria-pressed', (saved ?? fallback) === 'true');
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', on);
      store(b.id, on);
      if (b === infinite) build();
      render();
    });
  }

  // A song in the list playing now plays in place; any other links to its album.
  function row(e) {
    const song = e.id && songs.find((s) => s.id === e.id);
    const el = document.createElement(song ? 'button' : 'a');
    if (song) el.dataset.id = song.id;
    else el.href = e.href;
    const img = document.createElement('img');
    img.alt = '';
    img.src = e.cover;
    const name = document.createElement('span');
    name.className = 'q_name';
    name.textContent = e.name;
    const meta = document.createElement('span');
    meta.className = 'q_meta';
    meta.textContent = `${e.artist} — ${e.album}`;
    const text = document.createElement('span');
    text.append(name, meta);
    el.append(img, text);
    const li = document.createElement('li');
    li.append(el);
    return li;
  }

  function render() {
    const rows = order.map((i) => row(entry(songs[i])));
    const at = order.findIndex((i) => radioFrom >= 0 && i >= radioFrom);
    if (at >= 0) { // where the list ends and the songs like it begin
      const li = document.createElement('li');
      li.className = 'q_radio';
      li.textContent = `Songs like “${radioSeed?.title || 'this'}”`;
      rows.splice(at, 0, li);
    }
    next.replaceChildren(...rows);
    const played = read().filter((e) => e && typeof e.name === 'string' && sameSite(e.href));
    if (played[0]?.id === songs[index]?.id) played.shift(); // playing now, not history yet
    hist.replaceChildren(...played.reverse().map(row)); // oldest first, the newest just above Continue Playing
  }

  const align = () => { queue.scrollTop = up.offsetTop - bar.offsetHeight; }; // History sits above the fold
  const drawer = matchMedia('(max-width: 1199px)'); // the panel is a popover drawer there, a column above
  function setOpen(open) {
    btn.setAttribute('aria-pressed', open);
    panel.classList.toggle('queue_open', open);
    if (!open) return;
    if (drawer.matches && !panel.matches(':popover-open')) panel.showPopover();
    panel.scrollTop = 0;
    align();
  }

  // On desktop, once a song has played 3 s (seeks and scratching don't count), the queue opens, once per song: closed
  // again, it stays closed until the next song. Opened that way, it closes again 5 s into a pause, unless you opened it
  // yourself or have used it since (scrolled, clicked, typed in it).
  const CLOSE_AFTER = 5000;
  let auto = false; // open because of the song, not you
  let closing = 0;
  const keep = () => { auto = false; clearTimeout(closing); };
  for (const type of ['pointerdown', 'wheel', 'keydown', 'focusin']) queue.addEventListener(type, keep, { passive: true });
  music.addEventListener('pause', () => {
    if (!auto || drawer.matches || !panel.classList.contains('queue_open')) return;
    clearTimeout(closing);
    closing = setTimeout(() => { if (auto && music.paused) { auto = false; setOpen(false); } }, CLOSE_AFTER);
  });
  music.addEventListener('play', () => clearTimeout(closing));
  let heard = 0;
  let last = null;
  let heardFor = null;  // the song `heard` counts for
  let openedFor = null; // the song it last opened for
  music.addEventListener('timeupdate', () => {
    if (songs[index] !== heardFor) { heardFor = songs[index]; heard = 0; last = null; }
    const t = music.currentTime;
    const step = last === null ? 0 : t - last;
    last = t;
    if (music.paused || music.scratchRate !== null || step <= 0 || step >= 2) return;
    heard += step;
    if (heard < 3 || drawer.matches || songs[index] === openedFor || pref('queueAuto') === 'off') return;
    openedFor = songs[index];
    if (btn.getAttribute('aria-pressed') !== 'true') {
      setOpen(true);
      auto = true;
    }
  });

  btn.addEventListener('click', () => { keep(); setOpen(btn.getAttribute('aria-pressed') !== 'true'); }); // phones hide it: the queue is on the home page (phone.js)
  queue.querySelector('.q_min').addEventListener('click', () => { keep(); setOpen(false); btn.focus(); });
  panel.addEventListener('toggle', (e) => { if (e.newState === 'closed') setOpen(false); });
  queue.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) playAt(songs.findIndex((s) => s.id === b.dataset.id));
  });
  document.getElementById('shuffle')?.addEventListener('click', () => { build(); render(); }); // after its own onclick flips it
  document.getElementById('repeat')?.addEventListener('click', () => { build(); render(); }); // after player.js moved its mode
  document.addEventListener('listchange', () => { current = index; radioFrom = -1; radioSeed = null; build(); render(); }); // player.js swapped the list
  music.addEventListener('play', () => {
    if (index !== current) { // a new song, not a resume: use up the queue down to it, or start a new one
      current = index;
      const at = order.indexOf(index);
      if (at >= 0) order.splice(0, at + 1);
      else build();
      if (!order.length) build(); // Infinite: the next round
      more(); // running low: more songs like these
    }
    const now = entry(songs[index]);
    const played = read();
    if (played[0]?.id !== now.id) store(KEY, JSON.stringify([now, ...played].slice(0, MAX)));
    render();
    if (panel.classList.contains('queue_open')) align();
  });
  build();
  render();
})();
