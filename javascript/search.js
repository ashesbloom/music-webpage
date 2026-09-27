// ACRUX right panel: search, with the songs you opened from it kept as "Recent searches", and the Playlists list (the
// ones you pinned, then your most listened-to lately, api/playlists/played; the rest after them in their usual order).
// While you type, the results take the history's place; with an empty box the history comes back. Each saved search
// has a ✕ that forgets it, and Clear forgets them all.
// Searches the catalog (catalog.js, your music included): playlists, albums, artists and songs; a song opens its
// album. The last result searches online on the Discover page (discover.js), so Enter goes there when nothing in the
// library matches.
(() => {
  const form = document.querySelector('.search');
  const input = document.getElementById('inputbox');
  const section = document.querySelector('.history');
  const list = document.querySelector('.history_list');
  playlists();
  if (!form || !input || !section || !list) return;
  const heading = section.querySelector('h5');
  const head = document.createElement('div');
  head.className = 'h_head';
  heading.replaceWith(head);
  head.innerHTML = '<button class="h_clear" type="button">Clear</button>';
  head.prepend(heading);
  const view = (q) => CATALOG.page(q);
  // Filled once the catalog has your music and saved playlists (CATALOG.ready).
  const catalog = [];
  CATALOG.ready.then(() => {
    catalog.push(
      ...CATALOG.playlists.filter((p) => !p.hidden && p.searchable !== false).map((p) => ({ name: p.title, meta: `Playlist · ${p.songs.length} songs`,
        cover: p.photo || CATALOG.list(`playlist:${p.id}`)[0]?.cover || '', href: view(`view=playlist&id=${p.id}`) })),
      ...CATALOG.albums.map((a) => ({ name: a.title, meta: `Album · ${CATALOG.artist(a.artist).name}`, cover: a.cover, href: view(`view=album&id=${a.id}`) })),
      ...CATALOG.artists.map((a) => ({ name: a.name, meta: 'Artist', cover: a.photo || '', href: view(`view=artist&id=${a.id}`) })),
      ...CATALOG.songs.map((s) => ({ name: s.title, meta: `Song · ${s.artist}`, cover: s.cover, href: view(`view=album&id=${s.album}&song=${s.id}`) })),
    );
    render();
  });

  const ONLINE = 'Jamendo · Audius · Internet Archive · YouTube';
  // Its picture is found by name on the server (api/images.js): the artist's photo, or the top song's cover.
  const picture = (q) => `${SITE}discover/image?q=${encodeURIComponent(q)}`;
  const online = (q) => ({ name: `Discover “${q}” online`, meta: ONLINE, cover: picture(q), href: view(`view=discover&q=${encodeURIComponent(q)}`) });

  // Your songs (Discover songs you've played) are searchable like the library's; each opens where it lives and plays.
  CATALOG.get('songs').then((body) => { // kept by the catalog until a play changes it
    const mine = (body?.songs || []).map(CATALOG.fromResult).filter(Boolean)
      .map((s) => ({ name: s.title, meta: `Song · ${s.artist}`, cover: s.cover, href: CATALOG.songPage(s), mine: true }));
    catalog.unshift(...mine);
    if (input.value.trim()) render();
  }).catch(() => {}); // no server: the library alone

  const KEY = 'searchHistory';
  const MAX = 12;
  function read() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  }
  // A saved search links to where that result lives now (older ones pointed at pages since replaced); gone ones drop out.
  const onlineQ = (e) => { try { const u = new URL(e.href, location.href); return u.searchParams.get('view') === 'discover' && u.searchParams.get('q'); } catch { return null; } };
  const current = (e) => {
    if (!e) return null;
    if (e.mine) return e; // a song you played from a search (discover.js): it stays as it was saved
    if (onlineQ(e)) return { ...e, meta: ONLINE, cover: picture(onlineQ(e)) }; // older ones saved a placeholder
    return catalog.find((c) => c.name === e.name && c.meta === e.meta);
  };

  function show(entries, title) {
    heading.textContent = title;
    const saved = title !== 'Results';
    section.classList.toggle('searching', !saved);
    list.replaceChildren(...entries.map((e) => {
      const a = document.createElement('a');
      a.href = e.href;
      if (e.mine) a.dataset.mine = '1';
      const img = document.createElement('img');
      img.alt = '';
      if (e.cover) img.src = e.cover;
      const name = document.createElement('span');
      name.className = 'h_name';
      name.textContent = e.name;
      const meta = document.createElement('span');
      meta.className = 'h_meta';
      meta.textContent = e.meta || '';
      const text = document.createElement('span');
      text.append(name, meta);
      a.append(img, text);
      const li = document.createElement('li');
      li.append(a);
      if (saved) {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'h_x';
        x.dataset.forget = e.name;
        x.setAttribute('aria-label', `Remove “${e.name}” from recent searches`);
        x.innerHTML = '<i class="icon icon-xmark" aria-hidden="true"></i>';
        li.append(x);
      }
      return li;
    }));
  }

  function render() {
    const q = input.value.trim().toLowerCase();
    if (q) show([...catalog.filter((s) => s.name.toLowerCase().includes(q)), online(input.value.trim())], 'Results');
    else show(read().map(current).filter(Boolean).slice(0, MAX), 'Recent searches');
  }

  const store = (entries) => { try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch {} }; // private mode: the search still works, it just isn't remembered
  const remember = (entry) => store([entry, ...read().filter((e) => e && e.name !== entry.name)].slice(0, MAX));

  head.querySelector('.h_clear').addEventListener('click', () => {
    store([]);
    render();
    input.focus(); // the section is gone with its last entry: focus goes back to the search box
  });

  list.addEventListener('click', (e) => {
    const x = e.target.closest('[data-forget]');
    if (x) {
      const li = x.closest('li');
      const to = li.nextElementSibling || li.previousElementSibling; // keyboard focus moves to a neighbour's ✕
      store(read().filter((s) => s?.name !== x.dataset.forget));
      render();
      const name = to?.querySelector('[data-forget]')?.dataset.forget;
      (name ? [...list.querySelectorAll('[data-forget]')].find((b) => b.dataset.forget === name) : input)?.focus();
      return;
    }
    const a = e.target.closest('a');
    if (!a) return;
    remember({
      name: a.querySelector('.h_name').textContent,
      meta: a.querySelector('.h_meta').textContent,
      href: a.href,
      cover: a.querySelector('img').getAttribute('src') || '',
      ...(a.dataset.mine && { mine: true }),
    });
  });
  input.addEventListener('input', render);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value.trim()) list.querySelector('a')?.click(); // Enter opens the first result
  });
  render();

  // Redrawn on every page (nav.js runs this again), so a playlist you've been playing moves up as you browse.
  function playlists() {
    const MAX = 5;
    const nav = document.querySelector('.playlists .nav');
    if (!nav) return;
    const played = CATALOG.get('playlists/played');
    Promise.all([played, CATALOG.ready]).then(([body]) => {
      const rank = new Map((body?.lists || []).map((l, i) => [l.id, i]));
      const shown = CATALOG.pinnedFirst(CATALOG.playlists.filter((p) => !p.hidden)
        .map((p, i) => ({ p, at: rank.has(p.id) ? rank.get(p.id) : 1e6 + i }))
        .sort((a, b) => a.at - b.at).map(({ p }) => p)).slice(0, MAX);
      const here = new URLSearchParams(location.search);
      const open = here.get('view') === 'playlist' && here.get('id');
      nav.querySelectorAll('.sub').forEach((li) => li.remove());
      nav.append(...shown.map((p) => {
        const li = document.createElement('li');
        li.className = 'sub';
        const a = document.createElement('a');
        a.href = CATALOG.page(`view=playlist&id=${encodeURIComponent(p.id)}`);
        if (p.id === open) a.setAttribute('aria-current', 'page');
        a.innerHTML = '<i class="icon icon-folder-open" aria-hidden="true"></i>';
        a.append(p.title);
        li.append(a);
        return li;
      }));
      nav.closest('.playlists').dataset.filled = '';
    });
  }
})();
