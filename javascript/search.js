// ACRUX right panel: search, with the songs you opened from it kept as "Recent searches".
// While you type, the results take the history's place; with an empty box the history comes back.
// Searches the catalog (catalog.js): playlists, albums, artists and songs; a song opens its album.
(() => {
  const form = document.querySelector('.search');
  const input = document.getElementById('inputbox');
  const section = document.querySelector('.history');
  const list = document.querySelector('.history_list');
  if (!form || !input || !section || !list) return;
  const heading = section.querySelector('h5');
  const view = (q) => CATALOG.page(q);
  const catalog = [
    ...CATALOG.playlists.filter((p) => !p.hidden).map((p) => ({ name: p.title, meta: `Playlist · ${p.songs.length} songs`,
      cover: p.photo || CATALOG.list(`playlist:${p.id}`)[0]?.cover || '', href: view(`view=playlist&id=${p.id}`) })),
    ...CATALOG.albums.map((a) => ({ name: a.title, meta: `Album · ${CATALOG.artist(a.artist).name}`, cover: a.cover, href: view(`view=album&id=${a.id}`) })),
    ...CATALOG.artists.map((a) => ({ name: a.name, meta: 'Artist', cover: a.photo || '', href: view(`view=artist&id=${a.id}`) })),
    ...CATALOG.songs.map((s) => ({ name: s.title, meta: `Song · ${s.artist}`, cover: s.cover, href: view(`view=album&id=${s.album}&song=${s.id}`) })),
  ];

  const KEY = 'searchHistory';
  const MAX = 12;
  function read() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  }
  // A saved search links to where that result lives now (older ones pointed at pages since replaced); gone ones drop out.
  const current = (e) => e && catalog.find((c) => c.name === e.name && c.meta === e.meta);

  function show(entries, title) {
    heading.textContent = title;
    section.classList.toggle('searching', title === 'Results');
    list.replaceChildren(...entries.map((e) => {
      const a = document.createElement('a');
      a.href = e.href;
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
      return li;
    }));
  }

  function render() {
    const q = input.value.trim().toLowerCase();
    if (q) show(catalog.filter((s) => s.name.toLowerCase().includes(q)), 'Results');
    else show(read().map(current).filter(Boolean).slice(0, MAX), 'Recent searches');
  }

  function remember(entry) {
    const next = [entry, ...read().filter((e) => e && e.name !== entry.name)].slice(0, MAX);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {} // private mode: the search still works, it just isn't remembered
  }

  list.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    remember({
      name: a.querySelector('.h_name').textContent,
      meta: a.querySelector('.h_meta').textContent,
      href: a.href,
      cover: a.querySelector('img').getAttribute('src') || '',
    });
  });
  input.addEventListener('input', render);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value.trim()) list.querySelector('a')?.click(); // Enter opens the first result
  });
  render();
})();
