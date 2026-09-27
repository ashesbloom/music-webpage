// ACRUX home rows from your listening (api/taste.js, GET /api/home): Recently Played, Recently Added (songs you added,
// and Discover songs new to you), By Artist and By Albums (your most played, with pictures found by name when their
// source had none: api/images.js). My Favorites is the songs you ♥ (CATALOG's Favorites), redrawn whenever that
// changes. Without the server (GitHub Pages), or before your first songs, the rows stay as the
// page has them. nav.js runs this again whenever the home page is swapped in.
(() => {
  if (document.body.dataset.page !== 'home') return;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const picture = (params) => `${SITE}discover/image?${new URLSearchParams(params)}`;
  const img = (src, alt, label = '') => `<img alt="${esc(label)}" loading="lazy" src="${esc(src)}"${alt ? ` data-alt="${esc(alt)}"` : ''}>`;
  const card = (href, pic, name) => `<a class="card" href="${esc(href)}">${pic}<span class="card_label">${esc(name)}</span></a>`;
  const own = (list, name) => list.find((x) => (x.name || x.title).toLowerCase() === String(name).toLowerCase()); // in your library?

  // A row of song cards, playable in order like an album (the same markup as the page's own cards).
  function songs(row, key, results) {
    const list = results.map(CATALOG.fromResult).filter(Boolean);
    if (!row || !list.length) return;
    CATALOG.addList(key, list);
    row.dataset.list = key;
    row.classList.remove('demo'); // filled: the app shows it now (index.html)
    row.innerHTML = list.map((s) => `<li><button class="song_items card" data-song="${esc(s.id)}">${img(s.cover, s.alt)}<span class="card_label">${esc(s.title)}</span></button></li>`).join('');
  }

  // My Favorites: the newest ♥ first; empty, the page's "No favorites yet" shows (insert.css).
  function favorites() {
    const row = $('favorites');
    if (!row?.isConnected) return document.removeEventListener('collectionchange', favorites); // home swapped out
    const list = CATALOG.list('playlist:favorites');
    row.dataset.list = 'playlist:favorites';
    row.innerHTML = list.map((s) => `<li><button class="song_items card" data-song="${esc(s.id)}">${img(s.cover, s.alt)}<span class="card_label">${esc(s.title)}</span></button></li>`).join('');
  }
  CATALOG.ready.then(() => {
    favorites();
    document.addEventListener('collectionchange', favorites);
  });

  // Drawn now, and again in place when a play or new songs change them (catalog.js: homechange).
  const drawn = $('recent'); // this copy of the page: a later visit to Home runs this again for its own
  const rows = () => Promise.all([CATALOG.get('home'), CATALOG.ready]) // kept by the catalog until then
    .then(([home]) => {
      if (!drawn?.isConnected) return document.removeEventListener('homechange', rows); // home swapped out
      if (!(home?.plays || home?.added.length)) return;
      songs($('recent'), 'home:recent', home.recent);
      songs($('added'), 'home:added', home.added);
      if (home.artists.length) {
        $('artists').classList.remove('demo');
        $('artists').innerHTML = home.artists.map((a) => {
          const mine = own(CATALOG.artists, a.name);
          const href = mine ? CATALOG.page(`view=artist&id=${mine.id}`) : CATALOG.discover('artist', a.source, a.id) || CATALOG.page(`view=discover&q=${encodeURIComponent(a.name)}`);
          return `<li class="side">${card(href, img(mine?.photo || picture({ artist: a.name }), null, a.name), a.name)}</li>`;
        }).join('');
      }
      if (home.albums.length) {
        $('playlists').classList.remove('demo');
        $('playlists').innerHTML = home.albums.map((a) => {
          const mine = a.source === 'library' && own(CATALOG.albums, a.name);
          const href = mine ? CATALOG.page(`view=album&id=${mine.id}`) : CATALOG.discover('album', a.source, a.id) || CATALOG.page(`view=discover&q=${encodeURIComponent(a.name)}`);
          const cover = mine?.cover || a.cover || picture({ album: a.name, artist: a.artist });
          return `<li class="box">${card(href, img(cover, picture({ album: a.name, artist: a.artist }), `${a.name} by ${a.artist}`), a.name)}</li>`;
        }).join('');
      }
    })
    .catch(() => {}); // no server: the page's own rows stay
  rows();
  document.addEventListener('homechange', rows);
})();
