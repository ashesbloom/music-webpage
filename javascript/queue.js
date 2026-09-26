// ACRUX queue: the Queue button slides it over the side panel. "History" (the songs played, kept in
// localStorage.playHistory) sits above the Infinite / Auto Mix buttons and "Continue Playing", so it only shows
// when you scroll up. Uses CATALOG and player.js (songs, index, music, playAt).
// The queue decides what plays next: the player's end-of-song and Next take upNext(), the top of Continue Playing.
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

  // Continue Playing, as indexes into songs. Infinite off empties it (playback stops after this song); on refills it
  // with every other song: album order from here, wrapping round, or a fresh random order while shuffle is on.
  let order = [];
  let current = index;
  function build() {
    order = on(infinite) ? songs.map((_, i) => (index + 1 + i) % songs.length).slice(0, -1) : [];
    if (document.getElementById('shuffle')?.classList.contains('clicked')) {
      for (let i = order.length - 1; i > 0; i--) { // Fisher-Yates
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
  }
  window.upNext = () => order[0] ?? -1;

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
  const entry = (s) => ({ id: s.id, name: s.title, artist: s.artist, cover: s.cover, album: CATALOG.album(s.album).title, href: CATALOG.page(`view=album&id=${s.album}`) });

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
    next.replaceChildren(...order.map((i) => row(entry(songs[i]))));
    const played = read().filter((e) => e && typeof e.name === 'string' && sameSite(e.href));
    if (played[0]?.id === songs[index].id) played.shift(); // playing now, not history yet
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

  // On a phone the queue is part of the home page (phone.js): the button scrolls to it, going home first if need be.
  const phone = matchMedia('(max-width: 699px)');
  const toQueue = () => scrollTo({ top: document.querySelector('.playback').offsetHeight, behavior: 'smooth' }); // the player pins, the queue sits under it
  btn.addEventListener('click', () => {
    if (!phone.matches) return setOpen(btn.getAttribute('aria-pressed') !== 'true');
    if (document.body.dataset.page === 'home') return toQueue();
    document.addEventListener('pagechange', toQueue, { once: true });
    document.querySelector('.logo a').click();
  });
  queue.querySelector('.q_min').addEventListener('click', () => { setOpen(false); btn.focus(); });
  panel.addEventListener('toggle', (e) => { if (e.newState === 'closed') setOpen(false); });
  queue.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) playAt(songs.findIndex((s) => s.id === b.dataset.id));
  });
  document.getElementById('shuffle')?.addEventListener('click', () => { build(); render(); }); // after its own onclick flips it
  document.addEventListener('listchange', () => { current = index; build(); render(); }); // player.js swapped the list
  music.addEventListener('play', () => {
    if (index !== current) { // a new song, not a resume: use up the queue down to it, or start a new one
      current = index;
      const at = order.indexOf(index);
      if (at >= 0) order.splice(0, at + 1);
      else build();
      if (!order.length) build(); // Infinite: the next round
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
