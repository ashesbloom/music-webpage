// ACRUX library (library.html): My Music, a playlist or an album, Albums, and an Artist, chosen by the URL:
// none = My Music, ?view=playlist&id=lo-fi, ?view=album&id=nectar, ?view=albums, ?view=artist&id=joji.
// It renders from CATALOG before player.js loads, so the page's song list (body data-list) is set by then; its
// buttons use player.js (playAt, setList), queue.js (upNext) and more.js (showTray, shareLink) once clicked.
// ponytail: actions that need saving (pin, favorite, edit, duplicate, delete, reorder, download) say "Coming soon"
// until the phase 3 backend; the Edit dialog opens but can't save yet.
// It waits for your saved playlists (catalog.js: CATALOG.ready), which come from the server.
CATALOG.ready.then(() => {
  const root = document.getElementById('library');
  if (!root) return;
  const q = new URLSearchParams(location.search);
  const view = q.get('view') || 'mymusic';
  if (view === 'discover') return; // discover.js renders that one
  const id = q.get('id');
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const ic = (name) => `<i class="icon icon-${name}" aria-hidden="true"></i>`;
  const soon = (label, icon = '') => `<button aria-disabled="true">${icon}${label}<small>Coming soon</small></button>`;
  const secs = (t) => t.split(':').reduce((m, s) => m * 60 + Number(s), 0);
  const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const albumOf = (s) => CATALOG.album(s.album) || { title: s.albumTitle || '' }; // a Discover song has no library album
  const find = (label) => `<label class="find">${ic('magnifying-glass')}<input type="search" placeholder="${label}" aria-label="${label}"></label>`;
  const radio = (group, value, label, on) =>
    `<button role="menuitemradio" data-group="${group}" data-value="${value}" aria-checked="${on}">${ic('check')}${label}</button>`;
  const sortMenu = (menuId, options, top = '') => `<div class="tray tray_sort" id="${menuId}" popover>${top}
    <span class="tray_lb">Sort by</span>${options.map(([value, label], i) => radio('by', value, label, i === 0)).join('')}
    <hr>${radio('dir', 'asc', 'Ascending', true)}${radio('dir', 'desc', 'Descending', false)}</div>`;

  // A playlist's cover: a heart (Favorites), its photo, its groove colours, or a mosaic of its first four song covers.
  function cover(p) {
    if (p.favorites) return `<span class="cv cv_fav">${ic('heart')}</span>`;
    if (p.photo || p.cover) return `<span class="cv"><img alt="" src="${p.photo || p.cover}"></span>`;
    const arts = [...new Set(CATALOG.list(`playlist:${p.id}`).map((s) => s.cover))];
    if (!p.groove && arts.length >= 4) return `<span class="cv cv_mo">${arts.slice(0, 4).map((c) => `<img alt="" src="${c}">`).join('')}</span>`;
    const [c1, c2] = p.groove || ['#a21e1e', '#1a0505'];
    return `<span class="cv cv_gv" style="--c1: ${c1}; --c2: ${c2}"><b>${esc(p.title)}</b></span>`;
  }
  const lab = (p) => (p.favorites ? 'var(--glow)' : p.groove?.[0] || 'var(--accent)'); // the colour of the record's label

  // Collaborators on a playlist you made: you (the owner) and whoever you invited (mock `collab` names until phase 3).
  const crew = (p) => ['You', ...(p.collab || [])];
  const face = (name, i) => `<span class="pp_av" style="--c: ${['var(--accent)', '#e8a73c', '#4fb3c9', '#b07cf0'][i % 4]}">${esc(name[0])}</span>`;
  const and = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
  const people = (p) => `<button class="pl_people" data-act="people">
    <span class="pp_stack">${crew(p).slice(0, 3).map(face).join('')}</span>
    <span>${crew(p).length > 1 ? esc(and(crew(p))) : 'Add collaborators'}</span><span class="pp_add">${ic('plus')}</span></button>`;

  let list = [];      // the songs this view plays, in the order shown
  let key = '';       // its player.js list key
  let resort = null;  // re-sorts the view after a sort menu pick

  // ---------- views ----------

  // The head of an Artist / Playlists list, with the button that folds the list down to its pictures.
  const listTop = (title) => `<div class="ar_top"><h2>${title}</h2><button class="ar_fold" aria-expanded="true" aria-label="Minimize list">${ic('chevron-left')}</button></div>`;

  // The record crate of playlists (My Music, and All Playlists), ending in a New Playlist sleeve.
  const crate = (lists) => `<ul class="crate">
    ${lists.map((p) => `<li><a class="crate_item" href="${CATALOG.page(`view=playlist&id=${p.id}`)}" style="--lab: ${lab(p)}">
      <span class="cr_sl"><span class="cr_disc"></span>${cover(p)}</span>
      <span class="cr_nm">${esc(p.title)}</span><span class="cr_mt">${count(p.songs.length, 'song')}</span></a></li>`).join('')}
    <li><button class="crate_item crate_new" data-act="new"><span class="cr_sl"><span class="cv">${ic('plus')}<b>New Playlist</b></span></span></button></li>
  </ul>`;

  function myMusic() {
    const lists = CATALOG.playlists.filter((p) => !p.hidden);
    const dial = [
      ['Playlists', 'grid', CATALOG.page('view=playlist'), 162],
      ['Albums', 'disc', CATALOG.page('view=albums'), 126],
      ['Your Favorites', 'heart', CATALOG.page('view=playlist&id=favorites'), 90],
      ['Recently Added', 'clock', CATALOG.page('view=discover&mine=1'), 54], // your songs: Discover songs you've played
      ['Artists', 'mic', CATALOG.page('view=artist'), 18],
    ];
    return `
      <header class="lib_head"><span class="kicker">Your library</span>
        <div class="lib_titlebar"><a class="round" href="${SITE}index.html" data-back aria-label="Back">${ic('chevron-left')}</a><h1>My Music</h1></div></header>
      <section class="lib_sec"><h2>Add More Songs</h2>
        <div class="addmore">${ic('plus')}<span>Space reserved for Add More Songs, built later</span></div></section>
      <section class="lib_sec lib_dial"><h2>Library</h2>
        <nav class="dial" aria-label="Library">
          <span class="dial_disc"></span><span class="dial_label">Library</span><span class="dial_base"></span><span class="dial_arm"></span><span class="dial_pivot"></span>
          ${dial.map(([label, icon, href, a], i) => `<a class="di${i ? '' : ' on'}" href="${href}" style="--a: ${a}"><span class="di_ic">${ic(icon)}</span>${label}</a>`).join('')}
        </nav></section>
      <section class="lib_sec">
        <div class="lib_row"><h2>My Playlists</h2><span class="lib_muted">${count(lists.length, 'playlist')}</span></div>
        ${crate(lists)}</section>`;
  }

  // Playlists, laid out like the Artist page: the list on the left (Library ones, then yours), the chosen
  // playlist on the right; with none chosen, All Playlists shows them as the crate.
  function playlistsView() {
    if (id && !CATALOG.playlist(id)) return notFound('playlist');
    root.classList.add('lib_flush');
    const link = (p) => `<a class="ar ar_pl" href="${CATALOG.page(`view=playlist&id=${p.id}`)}" title="${esc(p.title)}"${p.id === id ? ' aria-current="page"' : ''}>${cover(p)}<span class="ar_name">${esc(p.title)}</span></a>`;
    const library = CATALOG.playlists.filter((p) => p.favorites || p.hidden);
    const mine = CATALOG.playlists.filter((p) => !p.favorites && !p.hidden);
    const all = `<div class="lib_titlebar"><a class="round" href="${CATALOG.page()}" data-back aria-label="Back">${ic('chevron-left')}</a><h1>All Playlists</h1></div>
      ${crate(CATALOG.playlists.filter((p) => !p.hidden))}`;
    return `<div class="ar_split">
      <nav class="ar_list" aria-label="Playlists">${listTop('Playlists')}
        <a class="ar" href="${CATALOG.page('view=playlist')}" title="All Playlists"${id ? '' : ' aria-current="page"'}><span class="av">${ic('grid')}</span>All Playlists</a>
        ${library.map(link).join('')}
        <h2>My Playlists</h2>
        ${mine.map(link).join('')}
        <button class="ar ar_new" data-act="new" title="New Playlist"><span class="av">${ic('plus')}</span>New Playlist</button>
      </nav>
      <section class="ar_main pl_pane">${id ? songsView() : all}</section></div>`;
  }

  function songsView() {
    const isAlbum = view === 'album';
    const item = isAlbum ? CATALOG.album(id) : CATALOG.playlist(id);
    if (!item) return notFound(isAlbum ? 'album' : 'playlist');
    key = `${view}:${id}`;
    document.body.dataset.list = key;
    const all = CATALOG.list(key);
    list = all;
    const mine = !isAlbum && !item.hidden && !item.favorites; // a playlist you made, so editable
    const artist = isAlbum && CATALOG.artist(item.artist);
    const mins = Math.round(all.reduce((t, s) => t + secs(s.time), 0) / 60);
    const none = all.length ? '' : ' aria-disabled="true"';
    const row = (s) => `<li class="pl_row" data-id="${s.id}">
      <button class="pl_fav" aria-disabled="true" aria-label="Favorite · coming soon">${ic('heart')}</button>
      <span class="pl_song"><span class="pl_thumb"><img alt="" loading="lazy" src="${s.cover}"></span><button class="pl_play" data-song="${s.id}">${esc(s.title)}</button></span>
      <span class="pl_cell">${esc(s.artist)}</span><span class="pl_cell">${esc(albumOf(s).title)}</span>
      <button class="pl_dl" aria-disabled="true" aria-label="Download · coming soon">${ic('download')}</button>
      <span class="pl_time">${s.time}</span>
      <button class="pl_more" data-more="${s.id}" aria-label="More">${ic('ellipsis')}</button></li>`;
    const fields = { title: (s) => s.title, artist: (s) => s.artist, album: (s) => albumOf(s).title, time: (s) => secs(s.time) };
    resort = (by, asc) => {
      list = sorted(all, fields[by], asc);
      root.querySelector('.pl_list').innerHTML = list.map(row).join('');
      filter();
      mark();
      if (listKey === key) setList(list, key); // playback follows the new order, if it's this list playing
    };
    const back = isAlbum ? CATALOG.page('view=albums') : CATALOG.page();
    const noun = isAlbum ? 'Album' : 'Playlist';
    return `
      <div class="pl_bar">
        <a class="round" href="${back}" data-back aria-label="Back">${ic('chevron-left')}</a>
        <div class="pl_tools">
          <div class="pill">${mine ? `<button class="tool" data-act="edit" aria-label="Edit playlist">${ic('pen')}</button>` : ''}<button class="tool" data-act="share" aria-label="Share">${ic('share')}</button></div>
          <div class="pill"><button class="tool" popovertarget="pl_menu" aria-label="More">${ic('ellipsis')}</button><button class="tool" popovertarget="pl_sort" aria-label="Sort">${ic('sort')}</button></div>
          ${find(`Find in ${noun}`)}
        </div>
      </div>
      <div class="tray" id="pl_menu" popover>
        ${mine ? soon('Pin Playlist', ic('pin')) : ''}${soon('Download', ic('download'))}
        ${mine ? `<button data-act="edit">${ic('pen')}Edit…</button><button data-act="people">${ic('users')}Collaborators…</button>${soon('Order Songs', ic('order'))}${soon('Duplicate', ic('copy'))}` : ''}
        ${soon('Favorite', ic('heart'))}
        <hr><button data-act="share">${ic('share')}<span>Share</span></button>
        ${mine ? `<hr>${soon('Delete Playlist', ic('trash'))}` : ''}
      </div>
      ${sortMenu('pl_sort', [['order', `${noun} Order`], ['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['time', 'Time']])}
      <section class="pl_hero">
        <div class="pl_cover" style="--lab: ${lab(item)}">${cover(item)}</div>
        <div class="pl_info">
          <span class="kicker">${noun}</span>
          <h1>${esc(item.title)}</h1>
          ${artist ? `<p class="pl_meta"><a href="${CATALOG.page(`view=artist&id=${artist.id}`)}">${esc(artist.name)}</a> · ${esc(item.genre)} · ${item.year}</p>` : ''}
          ${item.desc ? `<p class="pl_desc">${esc(item.desc)}</p>` : ''}
          ${mine ? people(item) : ''}
          <span class="lib_muted">${count(all.length, 'song')}${all.length ? ` · ${mins} min` : ''}</span>
          <div class="pl_btns">
            <button class="round red" data-act="shuffle" aria-label="Shuffle"${none}>${ic('shuffle')}</button>
            <button class="pl_playall" data-act="play"${none}>${ic('play')}Play</button>
            ${item.saved ? `<a class="round red" href="${SITE}api/download?playlist=${encodeURIComponent(item.id)}" download aria-label="Download all · best quality, as a ZIP">${ic('download')}</a>`
              : `<button class="round red" aria-disabled="true" aria-label="Download · coming soon">${ic('download')}</button>`}
          </div>
        </div>
      </section>
      ${all.length ? `<div class="pl_row pl_head" aria-hidden="true"><span class="pl_fav"></span><span>Song</span><span class="pl_cell">Artist</span><span class="pl_cell">Album</span><span class="pl_dl"></span><span class="pl_time">Time</span><span></span></div>
      <ol class="pl_list" data-find>${all.map(row).join('')}</ol>`
      : `<p class="pl_empty">${item.favorites ? 'Songs you favorite will show up here.' : 'No songs from this album in your library yet.'}</p>`}`;
  }

  function albumsView() {
    const all = CATALOG.albums;
    const card = (al) => `<li><a class="al" href="${CATALOG.page(`view=album&id=${al.id}`)}"><span class="al_art"><span class="al_rec"></span><img alt="" loading="lazy" src="${al.cover}"></span>
      <span class="al_t">${esc(al.title)}</span><span class="al_a">${esc(CATALOG.artist(al.artist).name)}</span></a></li>`;
    const fields = { title: (a) => a.title, artist: (a) => CATALOG.artist(a.artist).name, genre: (a) => a.genre, year: (a) => a.year };
    resort = (by, asc) => {
      root.querySelector('.al_grid').innerHTML = sorted(all, fields[by], asc).map(card).join('');
      filter();
    };
    return `
      <div class="pl_bar">
        <div class="lib_titlebar"><a class="round" href="${CATALOG.page()}" data-back aria-label="Back">${ic('chevron-left')}</a><h1>Albums</h1></div>
        <div class="pl_tools"><button class="tool tool_solo" popovertarget="al_sort" aria-label="Filter and sort">${ic('sort')}</button>${find('Find in Albums')}</div>
      </div>
      ${sortMenu('al_sort', [['title', 'Title'], ['artist', 'Artist'], ['genre', 'Genre'], ['year', 'Year']],
        `${radio('show', 'all', 'All Albums', true)}${soon('Only Favorites')}<hr>`)}
      <ul class="al_grid" data-find>${sorted(all, fields.title, true).map(card).join('')}</ul>`;
  }

  function artistView() {
    const who = id || 'joji';
    const person = who === 'all' ? { id: 'all', name: 'All Artists' } : CATALOG.artist(who);
    if (!person) return notFound('artist');
    root.classList.add('lib_flush');
    const albums = CATALOG.albums.filter((al) => who === 'all' || al.artist === who);
    key = `artist:${who}`;
    list = albums.flatMap((al) => CATALOG.list(`album:${al.id}`));
    const none = list.length ? '' : ' aria-disabled="true"';
    const face = (a) => (a.photo ? `<img alt="" loading="lazy" src="${a.photo}">`
      : a.id === 'all' ? `<span class="av">${ic('mic')}</span>`
      : `<span class="av av_ini">${esc(a.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>`);
    const people = [{ id: 'all', name: 'All Artists' }, ...CATALOG.artists];
    const track = (s) => `<li class="ar_trk" data-id="${s.id}"><span class="ar_n"><span>${s.n}</span>${ic('play')}${ic('pause')}</span><button class="pl_play" data-song="${s.id}">${esc(s.title)}</button>
      <span class="pl_time">${s.time}</span><button class="pl_more" data-more="${s.id}" aria-label="More">${ic('ellipsis')}</button></li>`;
    const album = (al) => {
      const songs = CATALOG.list(`album:${al.id}`);
      const href = CATALOG.page(`view=album&id=${al.id}`);
      return `<article class="ar_album" data-list="album:${al.id}">
        <a href="${href}" aria-label="${esc(al.title)}"><img alt="" loading="lazy" src="${al.cover}"></a>
        <div>
          <div class="ar_al_head"><div><h2><a href="${href}">${esc(al.title)}</a></h2><p>${esc(al.genre)} · ${al.year}</p></div>
            <button class="round red" aria-disabled="true" aria-label="Download · coming soon">${ic('download')}</button></div>
          ${songs.length ? `<ol class="ar_tracks">${songs.slice(0, 5).map(track).join('')}</ol>` : '<p class="lib_muted">No songs from this album in your library yet.</p>'}
          ${songs.length > 5 ? `<a class="ar_all" href="${href}">Show all ${songs.length} songs</a>` : ''}
        </div></article>`;
    };
    return `<div class="ar_split">
      <nav class="ar_list" aria-label="Artists">${listTop('Artists')}
        ${people.map((a) => `<a class="ar" href="${CATALOG.page(`view=artist&id=${a.id}`)}" title="${esc(a.name)}"${a.id === who ? ' aria-current="page"' : ''}>${face(a)}${esc(a.name)}</a>`).join('')}
      </nav>
      <section class="ar_main">
        <div>
          <div class="ar_head"><div class="lib_titlebar"><a class="round" href="${CATALOG.page()}" data-back aria-label="Back">${ic('chevron-left')}</a><h1>${esc(person.name)}</h1></div><div class="ar_btns">
            <button class="round red" data-act="play" aria-label="Play ${esc(person.name)}"${none}>${ic('play')}</button>
            <button class="round red" data-act="shuffle" aria-label="Shuffle ${esc(person.name)}"${none}>${ic('shuffle')}</button>
            <button class="round red" aria-disabled="true" aria-label="Favorite · coming soon">${ic('heart')}</button></div></div>
          <p class="lib_muted ar_meta">${count(albums.length, 'album')}, ${count(list.length, 'song')}</p>
        </div>
        ${albums.map(album).join('') || '<p class="lib_muted">No albums in your library yet.</p>'}
      </section></div>`;
  }

  function notFound(what) {
    return `<header class="lib_head"><span class="kicker">Library</span><h1>No such ${what}</h1>
      <p class="lib_muted">It may have been renamed or removed. <a href="${CATALOG.page()}">Back to My Music</a></p></header>`;
  }

  // ---------- behaviour ----------

  function sorted(items, field, asc) {
    const out = field ? [...items].sort((a, b) => {
      const x = field(a), y = field(b);
      return typeof x === 'number' ? x - y : String(x).localeCompare(y);
    }) : [...items];
    return asc ? out : out.reverse();
  }

  function filter() {
    const t = root.querySelector('.find input')?.value.trim().toLowerCase() || '';
    root.querySelectorAll('[data-find] > li').forEach((li) => { li.hidden = t !== '' && !li.textContent.toLowerCase().includes(t); });
  }

  // The row of the song playing now glows (after the first play).
  function mark() {
    if (!root.isConnected) return music.removeEventListener('play', mark); // a page nav.js has swapped out
    const now = started && songs[index].id;
    root.querySelectorAll('[data-id]').forEach((li) => li.classList.toggle('now', li.dataset.id === now));
  }

  // Play this view's list from the top, or shuffled (the queue shuffles it; the first of that order plays).
  function start(shuffled) {
    const shuffle = document.getElementById('shuffle');
    setList(list, key);
    if (shuffle.classList.contains('clicked') !== shuffled) shuffle.click();
    const n = shuffled ? upNext() : -1; // -1 with Infinite off: nothing queued, so shuffle picks here
    playAt(n >= 0 ? n : shuffled ? Math.floor(Math.random() * songs.length) : 0);
  }

  function openEdit(p) {
    let dialog = document.getElementById('edit_pl');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', `
        <dialog class="edit_pl" id="edit_pl" aria-labelledby="edit_h" closedby="any"><form method="dialog">
          <h2 id="edit_h"></h2>
          <div class="edit_covers" aria-label="Cover"></div>
          <label>Name<input class="edit_field" name="name" autocomplete="off"></label>
          <label>Description<textarea class="edit_field" name="desc" rows="3" placeholder="Description (optional)"></textarea></label>
          <label class="edit_check"><input type="checkbox" checked>Show in Search</label>
          <p class="edit_note">Saving changes comes with the library backend.</p>
          <div class="edit_foot"><button value="cancel">Cancel</button><button type="button" class="edit_done" aria-disabled="true">Done</button></div>
        </form></dialog>`);
      dialog = document.getElementById('edit_pl');
      dialog.addEventListener('click', (e) => {
        const pick = e.target.closest('.edit_cv:not([aria-disabled])');
        if (pick) dialog.querySelectorAll('.edit_cv').forEach((b) => b.setAttribute('aria-pressed', b === pick));
      });
    }
    const title = p ? p.title : 'New Playlist';
    dialog.querySelector('h2').textContent = p ? 'Edit Playlist' : 'New Playlist';
    dialog.querySelector('[name=name]').value = p ? p.title : '';
    dialog.querySelector('[name=desc]').value = p?.desc || '';
    dialog.querySelector('.edit_covers').innerHTML =
      `<button type="button" class="edit_cv" aria-pressed="true" aria-label="Current cover">${cover(p || { title })}</button>
       <button type="button" class="edit_cv" aria-pressed="false" aria-label="Groove cover">${cover({ title, groove: ['#e8a73c', '#2c1905'] })}</button>
       <button type="button" class="edit_cv edit_up" aria-disabled="true" aria-label="Upload a photo · coming soon">${ic('image')}Upload photo</button>`;
    dialog.showModal();
  }

  // Who can change the playlist. Inviting and roles need the backend, so for now it only shows them.
  function openPeople(p) {
    document.getElementById('people_pl')?.remove(); // built fresh: nav.js may have swapped in another playlist
    document.body.insertAdjacentHTML('beforeend', `
      <dialog class="edit_pl" id="people_pl" aria-labelledby="people_h" closedby="any"><form method="dialog">
        <h2 id="people_h">Collaborators</h2>
        <p class="edit_note">People you invite can add, remove and reorder songs in ${esc(p.title)}.</p>
        <ul class="pp_list">${crew(p).map((name, i) => `<li class="pp_row">${face(name, i)}<span>${esc(name)}</span><small>${i ? 'Can edit' : 'Owner'}</small></li>`).join('')}</ul>
        <button type="button" class="pp_invite" aria-disabled="true">${ic('plus')}Invite with link<small>Coming soon</small></button>
        <p class="edit_note">Inviting comes with the library backend.</p>
        <div class="edit_foot"><span></span><button class="edit_done">Done</button></div>
      </form></dialog>`);
    document.getElementById('people_pl').showModal();
  }

  // A song opened from search (?song=): scroll its row into view and highlight it.
  function reveal() {
    const row = root.querySelector(`.pl_row[data-id="${CSS.escape(q.get('song') || '')}"]`);
    if (!row) return;
    row.classList.add('found');
    row.scrollIntoView({ block: 'center' });
  }

  const render = { mymusic: myMusic, playlist: playlistsView, album: songsView, albums: albumsView, artist: artistView }[view];
  root.innerHTML = render ? render() : notFound('page');
  document.title = `${root.querySelector('h1')?.textContent || 'Library'} – ACRUX`;

  // The dial's arm swings to whichever item you point at or tab to.
  const dial = root.querySelector('.dial');
  const aim = (e) => {
    const item = e.target.closest('.di');
    if (!item) return;
    dial.querySelectorAll('.di').forEach((d) => d.classList.toggle('on', d === item));
    dial.style.setProperty('--on', item.style.getPropertyValue('--a'));
  };
  dial?.addEventListener('pointerover', aim);
  dial?.addEventListener('focusin', aim);

  // Menus open by their button (more.js), or as a sheet on phones.
  root.querySelectorAll('[popover]').forEach((pop) => pop.addEventListener('beforetoggle', (e) => {
    if (e.newState === 'open') placeTray(pop, root.querySelector(`[popovertarget="${pop.id}"]`));
  }));

  const findBox = root.querySelector('.find input');
  findBox?.addEventListener('input', filter);
  findBox?.addEventListener('keydown', (e) => { if (e.key === 'Enter') findBox.blur(); }); // the keyboard's search key closes it

  // The Artist / Playlists list folds to its pictures by itself when the middle column gets narrow (the side panel
  // dragged wider), or when you press its button. Your choice holds until the column next crosses that width.
  const split = root.querySelector('.ar_split');
  const fold = split?.querySelector('.ar_fold');
  if (fold) {
    const NARROW = 720; // px, the same as the container query in insert.css
    let narrow = null;
    const folded = () => split.classList.contains('mini') || (!split.classList.contains('open') && narrow);
    const sync = () => {
      fold.setAttribute('aria-expanded', !folded());
      fold.setAttribute('aria-label', folded() ? 'Expand list' : 'Minimize list');
    };
    fold.addEventListener('click', () => {
      const was = folded();
      split.classList.toggle('mini', !was);
      split.classList.toggle('open', was);
      sync();
    });
    new ResizeObserver(([entry]) => {
      const now = entry.contentRect.width < NARROW;
      if (narrow !== null && now !== narrow) split.classList.remove('mini', 'open');
      narrow = now;
      sync();
    }).observe(root);
  }
  reveal();

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act], [data-more], [role=menuitemradio]');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    const menu = b.closest('[popover]');
    if (b.dataset.more) return showTray(CATALOG.song(b.dataset.more) || list.find((s) => s.id === b.dataset.more), b);
    if (b.getAttribute('role') === 'menuitemradio') {
      menu.querySelectorAll(`[data-group="${b.dataset.group}"]`).forEach((r) => r.setAttribute('aria-checked', r === b));
      const pick = (group) => menu.querySelector(`[data-group="${group}"][aria-checked="true"]`).dataset.value;
      resort?.(pick('by'), pick('dir') === 'asc');
    } else if (b.dataset.act === 'share') {
      shareLink({ title: document.title, url: location.href }, b.querySelector('span'));
    } else if (b.dataset.act === 'edit') {
      openEdit(CATALOG.playlist(id));
    } else if (b.dataset.act === 'people') {
      openPeople(CATALOG.playlist(id));
    } else if (b.dataset.act === 'new') {
      openEdit(null);
    } else if (b.dataset.act === 'play' || b.dataset.act === 'shuffle') {
      start(b.dataset.act === 'shuffle');
    }
    menu?.togglePopover(false);
  });

  // nav.js runs this again for each library page it swaps in: then the player already exists.
  const hook = () => { music.addEventListener('play', mark); mark(); }; // mark() now: a song may already be playing
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
});
