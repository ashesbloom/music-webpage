// ACRUX home rows from your listening (api/taste.js, GET /api/home): Recently Played, Recently Added (songs new to
// you, until Add More Songs exists), By Artist and By Albums (your most played, with pictures found by name when their
// source had none: api/images.js). Without the server (GitHub Pages), or before your first songs, the rows stay as the
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
    row.innerHTML = list.map((s) => `<li><button class="song_items card" data-song="${esc(s.id)}">${img(s.cover, s.alt)}<span class="card_label">${esc(s.title)}</span></button></li>`).join('');
  }

  fetch(`${SITE}api/home`)
    .then((res) => (res.headers.get('content-type')?.includes('json') ? res.json() : null))
    .then((home) => {
      if (!home?.plays || !$('recent')?.isConnected) return;
      songs($('recent'), 'home:recent', home.recent);
      songs($('added'), 'home:added', home.added);
      if (home.artists.length) {
        $('artists').innerHTML = home.artists.map((a) => {
          const mine = own(CATALOG.artists, a.name);
          const href = mine ? CATALOG.page(`view=artist&id=${mine.id}`) : CATALOG.discover('artist', a.source, a.id) || CATALOG.page(`view=discover&q=${encodeURIComponent(a.name)}`);
          return `<li class="side">${card(href, img(mine?.photo || picture({ artist: a.name }), null, a.name), a.name)}</li>`;
        }).join('');
      }
      if (home.albums.length) {
        $('playlists').innerHTML = home.albums.map((a) => {
          const mine = a.source === 'library' && own(CATALOG.albums, a.name);
          const href = mine ? CATALOG.page(`view=album&id=${mine.id}`) : CATALOG.discover('album', a.source, a.id) || CATALOG.page(`view=discover&q=${encodeURIComponent(a.name)}`);
          const cover = mine?.cover || a.cover || picture({ album: a.name, artist: a.artist });
          return `<li class="box">${card(href, img(cover, picture({ album: a.name, artist: a.artist }), `${a.name} by ${a.artist}`), a.name)}</li>`;
        }).join('');
      }
    })
    .catch(() => {}); // no server: the page's own rows stay
})();
