// ACRUX library (library.html): My Music, a playlist or an album, Albums, and an Artist, chosen by the URL:
// none = My Music, ?view=playlist&id=lo-fi, ?view=album&id=nectar, ?view=albums (&source=local|drive:<id>: the albums
// you added from there), ?view=artist&id=joji.
// It renders from CATALOG before player.js loads, so the page's song list (body data-list) is set by then; its
// buttons use player.js (playAt, setList), queue.js (upNext) and more.js (showTray, shareLink) once clicked.
// Your playlists (catalog.js, from the server: api/collection.js) can be made, edited, reordered, duplicated, pinned,
// ♥'d, downloaded and deleted, and shared with people on your Wi-Fi (Collaborators). The demo playlists only play,
// pin, ♥, download and duplicate. Your own albums (added on the Add More Songs panel, addmore.js) can be removed.
// The ♥ and ↓ buttons and "Save to computer" links are more.js's (favButton, keepButton, saveHref).
// It waits for your music and collection (catalog.js: CATALOG.ready), which come from the server, and for the page's
// other scripts (more.js draws its ♥ and ↓).
// (No top-level names: nav.js runs this file again for each library page.)
Promise.all([CATALOG.ready, new Promise((done) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', done, { once: true }) : done()))]).then(() => {
  const root = document.getElementById('library');
  if (!root) return;
  const q = new URLSearchParams(location.search);
  const view = q.get('view') || 'mymusic';
  if (view === 'discover' || view === 'settings') return; // discover.js and settings.js render those
  const id = q.get('id');
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const ic = (name) => `<i class="icon icon-${name}" aria-hidden="true"></i>`;
  const owner = !!CATALOG.me().owner; // this computer: it may change things (a guest may only change songs in theirs)
  // Goes to another library page in place (after a playlist is made, copied or deleted).
  const goTo = (url) => {
    history.replaceState(history.state, '', url);
    if (window.navReload) window.navReload(); else location.assign(url);
  };
  const secs = (t) => t.split(':').reduce((m, s) => m * 60 + Number(s), 0);
  const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const about = (al) => [al.genre, al.year, al.format].filter(Boolean).map(esc).join(' · '); // an album of yours may have none
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

  // Collaborators on a playlist you made: you (the owner) and whoever joined from an invite link.
  const crew = (p) => ['You', ...(p.people || []).map((x) => x.name)];
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
    ${CATALOG.pinnedFirst(lists).map((p) => `<li><a class="crate_item" href="${CATALOG.page(`view=playlist&id=${p.id}`)}" style="--lab: ${lab(p)}">
      <span class="cr_sl"><span class="cr_disc"></span>${cover(p)}</span>
      <span class="cr_nm">${CATALOG.marked('pin', p.id) ? `<span class="pin_mark" title="Pinned">${ic('pin')}</span>` : ''}${esc(p.title)}</span><span class="cr_mt">${count(p.songs.length, 'song')}</span></a></li>`).join('')}
    ${owner ? `<li><button class="crate_item crate_new" data-act="new"><span class="cr_sl"><span class="cv">${ic('plus')}<b>New Playlist</b></span></span></button></li>` : ''}
  </ul>`;

  function myMusic() {
    const lists = CATALOG.playlists.filter((p) => !p.hidden);
    const dial = [
      ['Playlists', 'grid', CATALOG.page('view=playlist'), 162],
      ['Albums', 'disc', CATALOG.page('view=albums'), 126],
      ['Your Favorites', 'heart', CATALOG.page('view=playlist&id=favorites'), 90],
      // The songs you added (Add More Songs); before you've added any, the Discover songs you've played.
      ['Recently Added', 'clock', CATALOG.playlist('recently-added').yours ? CATALOG.page('view=playlist&id=recently-added') : CATALOG.page('view=discover&mine=1'), 54],
      ['Artists', 'mic', CATALOG.page('view=artist'), 18],
    ];
    return `
      <header class="lib_head"><span class="kicker">Your library</span>
        <div class="lib_titlebar"><a class="round" href="${SITE}index.html" data-back aria-label="Back">${ic('chevron-left')}</a><h1>My Music</h1></div></header>
      ${CATALOG.me().guest ? '' : `<section class="lib_sec" id="addmore"><h2>Add More Songs</h2>
        <div class="addmore">${ic('plus')}<span>Adding songs needs the ACRUX server: run npm start</span></div></section>`}
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
    const mine = CATALOG.pinnedFirst(CATALOG.playlists.filter((p) => !p.favorites && !p.hidden));
    const all = `<div class="lib_titlebar"><a class="round" href="${CATALOG.page()}" data-back aria-label="Back">${ic('chevron-left')}</a><h1>All Playlists</h1></div>
      ${crate(CATALOG.playlists.filter((p) => !p.hidden))}`;
    return `<div class="ar_split">
      <nav class="ar_list" aria-label="Playlists">${listTop('Playlists')}
        <a class="ar" href="${CATALOG.page('view=playlist')}" title="All Playlists"${id ? '' : ' aria-current="page"'}><span class="av">${ic('grid')}</span>All Playlists</a>
        ${library.map(link).join('')}
        <h2>My Playlists</h2>
        ${mine.map(link).join('')}
        ${owner ? `<button class="ar ar_new" data-act="new" title="New Playlist"><span class="av">${ic('plus')}</span>New Playlist</button>` : ''}
      </nav>
      <section class="ar_main pl_pane">${id ? songsView() : all}</section></div>`;
  }

  function songsView() {
    const isAlbum = view === 'album';
    const item = isAlbum ? CATALOG.album(id) : CATALOG.playlist(id);
    if (!item) return notFound(isAlbum ? 'album' : 'playlist');
    key = `${view}:${id}`;
    document.body.dataset.list = key;
    if (isAlbum && item.drive) { // its first songs may be next: the server gets their start ready (api/cache.js)
      if (pref('ahead') !== 'off') fetch(`${SITE}api/player/intent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ album: id.slice(4) }) }).catch(() => {});
    }
    const all = CATALOG.list(key);
    list = all;
    const editable = !isAlbum && item.server && item.editable; // yours, or a guest's who may edit it: its songs change
    const yours = !isAlbum && item.server && owner;            // its name, cover, people; delete it
    const listed = !isAlbum && !item.hidden && !item.favorites; // a playlist in My Playlists: pin, ♥, duplicate
    const artist = isAlbum && CATALOG.artist(item.artist);
    const mins = Math.round(all.reduce((t, s) => t + secs(s.time), 0) / 60);
    const none = all.length ? '' : ' aria-disabled="true"';
    const row = (s) => `<li class="pl_row" data-id="${esc(s.id)}">
      ${favButton('song', s.id)}
      <span class="pl_song"><span class="pl_thumb"><img alt="" loading="lazy" src="${s.cover}"></span><button class="pl_play" data-song="${esc(s.id)}">${esc(s.title)}</button></span>
      <span class="pl_cell">${esc(s.artist)}</span><span class="pl_cell">${esc(albumOf(s).title)}</span>
      ${keepButton(`song:${s.id}`)}
      <span class="pl_time">${s.time}</span>
      <button class="pl_more" data-more="${esc(s.id)}" aria-label="More">${ic('ellipsis')}</button></li>`;
    const fields = { title: (s) => s.title, artist: (s) => s.artist, album: (s) => albumOf(s).title, time: (s) => secs(s.time) };
    resort = (by, asc) => {
      list = sorted(all, fields[by], asc);
      root.querySelector('.pl_list').innerHTML = list.map(row).join('');
      filter();
      mark();
      paintMarks(root);
      if (listKey === key) setList(list, key); // playback follows the new order, if it's this list playing
    };
    const back = isAlbum ? CATALOG.page('view=albums') : CATALOG.page();
    const noun = isAlbum ? 'Album' : 'Playlist';
    const artistName = artist ? artist.name : '';
    const favInfo = { title: item.title, sub: isAlbum ? artistName : 'Playlist', cover: item.cover || item.photo || all[0]?.cover || '', href: location.href };
    const keep = owner && keepOf(`list:${key}`);
    const save = saveHref(isAlbum ? { album: item, key, name: `${artistName} - ${item.title}` } : { playlist: item, key, name: item.title });
    // The ⋯ menu: what this list allows. Labels that follow its state (pinned, ♥, downloaded) are set as it opens.
    const menu = [
      listed && owner && `<button data-act="pin">${ic('pin')}<span data-label="pin"></span></button>`,
      keep && keep.state !== 'here' && `<button data-keep="list:${esc(key)}">${ic('download')}<span data-label="keep"></span></button>`,
      save && `<a href="${esc(save)}" download>${ic('download')}Save to Computer</a>`,
      yours && `<button data-act="edit">${ic('pen')}Edit…</button><button data-act="people">${ic('users')}Collaborators…</button>`,
      editable && all.length > 1 && `<button data-act="order">${ic('order')}Order Songs</button>`,
      listed && owner && `<button data-act="duplicate">${ic('copy')}Duplicate</button>`,
      owner && (listed || isAlbum) && `<button data-act="favitem">${ic('heart')}<span data-label="fav"></span></button>`,
    ].filter(Boolean).join('');
    return `
      <div class="pl_bar">
        <a class="round" href="${back}" data-back aria-label="Back">${ic('chevron-left')}</a>
        <div class="pl_tools">
          <div class="pill">${yours ? `<button class="tool" data-act="edit" aria-label="Edit playlist">${ic('pen')}</button>` : ''}<button class="tool" data-act="share" aria-label="Share">${ic('share')}</button></div>
          <div class="pill"><button class="tool" popovertarget="pl_menu" aria-label="More">${ic('ellipsis')}</button><button class="tool" popovertarget="pl_sort" aria-label="Sort">${ic('sort')}</button></div>
          ${find(`Find in ${noun}`)}
        </div>
      </div>
      <div class="tray" id="pl_menu" popover>
        ${menu}${menu ? '<hr>' : ''}<button data-act="share">${ic('share')}<span>Share</span></button>
        ${yours ? `<hr><button data-act="delete">${ic('trash')}Delete Playlist</button>` : ''}
        ${isAlbum && item.lib && owner ? `<hr><button data-act="remove">${ic('trash')}Remove Album</button>` : ''}
      </div>
      ${sortMenu('pl_sort', [['order', `${noun} Order`], ['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['time', 'Time']])}
      <section class="pl_hero">
        <div class="pl_cover" style="--lab: ${lab(item)}">${cover(item)}</div>
        <div class="pl_info">
          <span class="kicker">${noun}</span>
          <h1>${esc(item.title)}</h1>
          ${artist ? `<p class="pl_meta"><a href="${CATALOG.page(`view=artist&id=${artist.id}`)}">${esc(artist.name)}</a>${about(item) ? ` · ${about(item)}` : ''}</p>` : ''}
          ${item.desc ? `<p class="pl_desc">${esc(item.desc)}</p>` : ''}
          ${yours ? people(item) : ''}
          <span class="lib_muted">${count(all.length, 'song')}${all.length ? ` · ${mins} min` : ''}</span>
          <div class="pl_btns">
            <button class="round red" data-act="shuffle" aria-label="Shuffle"${none}>${ic('shuffle')}</button>
            <button class="pl_playall" data-act="play"${none}>${ic('play')}Play</button>
            ${keep ? keepButton(`list:${key}`, 'round red pl_keep') : ''}
            ${owner && isAlbum && all.length ? saveButton(item) : ''}
            ${owner && listed && !yours ? `<button class="round red" data-act="duplicate" aria-label="Add to My Playlists">${ic('plus')}</button>` : ''}
            ${owner && (listed || isAlbum) ? ((btn) => (yours ? btn : `<span hidden>${btn}</span>`))(favButton(isAlbum ? 'album' : 'playlist', item.id, favInfo, 'round red pl_heart')) : ''}
          </div>
        </div>
      </section>
      ${all.length ? `<div class="pl_order_bar" hidden><span>Drag songs into place, or use the arrows.</span><button data-act="order-cancel">Cancel</button><button class="pl_playall" data-act="order-done">Done</button></div>
      <div class="pl_row pl_head" aria-hidden="true"><span class="pl_fav"></span><span>Song</span><span class="pl_cell">Artist</span><span class="pl_cell">Album</span><span class="pl_dl"></span><span class="pl_time">Time</span><span></span></div>
      <ol class="pl_list" data-find>${all.map(row).join('')}</ol>`
      : `<p class="pl_empty">${item.favorites ? 'Songs you ♥ show up here.' : isAlbum ? 'No songs from this album in your library yet.'
        : editable ? 'No songs yet. Add some from any song’s ⋯ menu: Add to Playlist.' : 'No songs here yet.'}</p>`}`;
  }

  function albumsView() {
    const from = q.get('source'); // the albums of one thing you added (addmore.js)
    const all = from ? CATALOG.albums.filter((al) => al.source === from) : CATALOG.albums;
    const title = from ? CATALOG.sourceTitle(from) : 'Albums';
    const card = (al) => `<li><a class="al" href="${CATALOG.page(`view=album&id=${al.id}`)}"><span class="al_art"><span class="al_rec"></span><img alt="" loading="lazy" src="${al.cover}"></span>
      <span class="al_t">${esc(al.title)}</span><span class="al_a">${esc(CATALOG.artist(al.artist).name)}</span></a></li>`;
    const fields = { title: (a) => a.title, artist: (a) => CATALOG.artist(a.artist).name, genre: (a) => a.genre, year: (a) => a.year };
    resort = (by, asc, show) => {
      const shown = show === 'fav' ? all.filter((al) => CATALOG.marked('album', al.id)) : all;
      root.querySelector('.al_grid').innerHTML = sorted(shown, fields[by], asc).map(card).join('')
        || '<li class="lib_muted al_none">No favorite albums yet: ♥ one on its page.</li>';
      filter();
    };
    return `
      <div class="pl_bar">
        <div class="lib_titlebar"><a class="round" href="${CATALOG.page()}" data-back aria-label="Back">${ic('chevron-left')}</a><h1>${esc(title)}</h1></div>
        <div class="pl_tools"><button class="tool tool_solo" popovertarget="al_sort" aria-label="Filter and sort">${ic('sort')}</button>${find('Find in Albums')}</div>
      </div>
      ${sortMenu('al_sort', [['title', 'Title'], ['artist', 'Artist'], ['genre', 'Genre'], ['year', 'Year']],
        `${radio('show', 'all', 'All Albums', true)}${owner ? radio('show', 'fav', 'Only Favorites', false) : ''}<hr>`)}
      <ul class="al_grid" data-find>${sorted(all, fields.title, true).map(card).join('')}</ul>`;
  }

  function artistView() {
    const who = id || (CATALOG.artist('joji') ? 'joji' : 'all'); // no demo (the app): All Artists
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
    const people = [{ id: 'all', name: 'All Artists' }, ...[...CATALOG.artists].sort((a, b) => CATALOG.marked('artist', b.id) - CATALOG.marked('artist', a.id))]; // ♥ ones first
    const track = (s) => `<li class="ar_trk" data-id="${s.id}"><span class="ar_n"><span>${s.n}</span>${ic('play')}${ic('pause')}</span><button class="pl_play" data-song="${s.id}">${esc(s.title)}</button>
      <span class="pl_time">${s.time}</span><button class="pl_more" data-more="${s.id}" aria-label="More">${ic('ellipsis')}</button></li>`;
    const album = (al) => {
      const songs = CATALOG.list(`album:${al.id}`);
      const href = CATALOG.page(`view=album&id=${al.id}`);
      return `<article class="ar_album" data-list="album:${al.id}">
        <a href="${href}" aria-label="${esc(al.title)}"><img alt="" loading="lazy" src="${al.cover}"></a>
        <div>
          <div class="ar_al_head"><div><h2><a href="${href}">${esc(al.title)}</a></h2><p>${about(al)}</p></div>
            ${owner && keepOf(`list:album:${al.id}`) ? keepButton(`list:album:${al.id}`, 'round red') : ''}</div>
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
            ${owner && who !== 'all' ? favButton('artist', who, { title: person.name, sub: 'Artist', cover: person.photo || '', href: location.href }, 'round red pl_heart') : ''}</div></div>
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

  // New Playlist, or Edit on one of yours: name, description, cover (as it is, a groove colour, or a photo you pick),
  // and whether search finds it. A new one opens once made.
  const GROOVES = [['#a21e1e', '#1a0505'], ['#e8a73c', '#2c1905'], ['#e8457f', '#2a0714'], ['#4fb3c9', '#06232a'], ['#b07cf0', '#1b0b30']];
  function openEdit(p) {
    document.getElementById('edit_pl')?.remove(); // built fresh: nav.js may have swapped in another playlist
    const title = p ? p.title : 'New Playlist';
    const same = (g) => p?.groove && g[0] === p.groove[0] && g[1] === p.groove[1];
    document.body.insertAdjacentHTML('beforeend', `
      <dialog class="edit_pl" id="edit_pl" aria-labelledby="edit_h" closedby="any"><form method="dialog">
        <h2 id="edit_h">${p ? 'Edit Playlist' : 'New Playlist'}</h2>
        <div class="edit_covers" role="radiogroup" aria-label="Cover">
          ${p ? `<button type="button" class="edit_cv" data-cover="keep" aria-pressed="true" aria-label="Keep this cover">${cover(p)}</button>` : ''}
          ${GROOVES.filter((g) => !same(g)).slice(0, p ? 2 : 3).map((g, i) => `<button type="button" class="edit_cv" data-cover="${g.join(',')}" aria-pressed="${!p && !i}" aria-label="Groove cover">${cover({ title, groove: g })}</button>`).join('')}
          <label class="edit_cv edit_up" data-cover="photo" aria-pressed="false">${ic('image')}<span>Upload photo</span><input type="file" accept="image/jpeg,image/png,image/webp" hidden></label>
        </div>
        <label>Name<input class="edit_field" name="name" autocomplete="off" maxlength="100" value="${esc(p?.title || '')}" required></label>
        <label>Description<textarea class="edit_field" name="desc" rows="3" maxlength="500" placeholder="Description (optional)">${esc(p?.desc || '')}</textarea></label>
        <label class="edit_check"><input type="checkbox" name="searchable"${p?.searchable === false ? '' : ' checked'}>Show in Search</label>
        <p class="edit_note" role="status"></p>
        <div class="edit_foot"><button value="cancel" formnovalidate>Cancel</button><button type="button" class="edit_done">${p ? 'Done' : 'Create'}</button></div>
      </form></dialog>`);
    const dialog = document.getElementById('edit_pl');
    const form = dialog.querySelector('form');
    const done = dialog.querySelector('.edit_done');
    const photo = dialog.querySelector('input[type=file]');
    const pick = (b) => dialog.querySelectorAll('.edit_cv').forEach((x) => x.setAttribute('aria-pressed', x === b));
    const ready = () => done.setAttribute('aria-disabled', !form.name.value.trim());
    ready();
    form.name.addEventListener('input', ready);
    dialog.addEventListener('click', (e) => {
      const b = e.target.closest('.edit_cv:not(.edit_up)');
      if (b) pick(b);
    });
    photo.addEventListener('change', () => {
      const file = photo.files[0];
      if (!file) return;
      const up = dialog.querySelector('.edit_up');
      up.style.backgroundImage = `url("${URL.createObjectURL(file)}")`;
      up.classList.add('picked');
      pick(up);
    });
    done.addEventListener('click', async () => {
      if (done.getAttribute('aria-disabled') === 'true') return;
      const chosen = dialog.querySelector('.edit_cv[aria-pressed="true"]')?.dataset.cover || 'keep';
      const body = { title: form.name.value.trim(), desc: form.desc.value.trim(), searchable: form.searchable.checked };
      if (chosen !== 'keep' && chosen !== 'photo') Object.assign(body, { groove: chosen.split(','), photo: null });
      done.setAttribute('aria-disabled', 'true');
      try {
        const pid = p ? p.id : (await CATALOG.change('playlists', 'POST', body)).id;
        if (p) await CATALOG.change(`playlists/${encodeURIComponent(pid)}`, 'PATCH', body);
        if (chosen === 'photo' && photo.files[0]) await CATALOG.change(`playlists/${encodeURIComponent(pid)}/photo`, 'PUT', photo.files[0]);
        dialog.close();
        goTo(CATALOG.page(`view=playlist&id=${encodeURIComponent(pid)}`));
      } catch (err) {
        dialog.querySelector('.edit_note').textContent = err.message;
        ready();
      }
    });
    dialog.showModal();
  }

  // Who can change the playlist: you, and the people who joined from its invite link (on your Wi-Fi). Each can edit
  // (add, remove and reorder songs) or only listen; you can take them off it. The link works for people on your Wi-Fi
  // while ACRUX listens there (the switch below), and Reset link makes a new one (the old stops working).
  function openPeople(p) {
    document.getElementById('people_pl')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
      <dialog class="edit_pl" id="people_pl" aria-labelledby="people_h" closedby="any"><form method="dialog">
        <h2 id="people_h">Collaborators</h2>
        <p class="edit_note">People you invite can add, remove and reorder songs in ${esc(p.title)}, from their phone or laptop on your Wi-Fi.</p>
        <ul class="pp_list"></ul>
        <label class="edit_check pp_wifi"><input type="checkbox" name="wifi">Let people on your Wi-Fi open invite links</label>
        <p class="edit_note pp_where"></p>
        <div class="pp_link" hidden><input class="edit_field" readonly aria-label="Invite link"><button type="button" data-pp="copy"><span>Copy</span></button></div>
        <div class="pp_acts"><button type="button" class="pp_invite" data-pp="invite">${ic('plus')}Invite with link</button><button type="button" class="pp_reset" data-pp="reset" hidden>Reset link</button></div>
        <p class="edit_note pp_err" role="status"></p>
        <div class="edit_foot"><span></span><button class="edit_done">Done</button></div>
      </form></dialog>`);
    const dialog = document.getElementById('people_pl');
    const wifi = dialog.querySelector('[name=wifi]');
    const err = (m = '') => { dialog.querySelector('.pp_err').textContent = m; };
    function draw() {
      const now = CATALOG.playlist(p.id) || p;
      dialog.querySelector('.pp_list').innerHTML = `<li class="pp_row">${face('You', 0)}<span>You</span><small>Owner</small></li>`
        + (now.people || []).map((x, i) => `<li class="pp_row">${face(x.name, i + 1)}<span>${esc(x.name)}</span>
          <select class="pp_role" data-gid="${esc(x.gid)}" aria-label="What ${esc(x.name)} can do"><option value="edit"${x.role === 'edit' ? ' selected' : ''}>Can edit</option><option value="view"${x.role === 'view' ? ' selected' : ''}>Can listen</option></select>
          <button type="button" class="pp_kick" data-gid="${esc(x.gid)}" aria-label="Remove ${esc(x.name)}">${ic('xmark')}</button></li>`).join('');
      const sh = CATALOG.sharing() || {};
      wifi.checked = !!sh.on;
      wifi.disabled = !!sh.open;
      dialog.querySelector('.pp_where').textContent = sh.open ? 'ACRUX is open to everyone on your network (started with HOST=0.0.0.0).'
        : !sh.address ? 'This computer isn’t on a Wi-Fi network right now.'
        : sh.on ? `Guests open it at ${sh.address}. Turn this off to stop anyone new from joining.` : 'Off: invite links only open on this computer.';
    }
    async function link(method) {
      err();
      try {
        if (!(CATALOG.sharing() || {}).on) await CATALOG.change('sharing', 'PUT', { on: true }); // an invite is for the Wi-Fi
        const out = await CATALOG.change(`playlists/${encodeURIComponent(p.id)}/invite`, method);
        const box = dialog.querySelector('.pp_link');
        box.hidden = false;
        box.querySelector('input').value = out.url;
        dialog.querySelector('[data-pp=reset]').hidden = false;
        draw();
      } catch (e) { err(e.message); }
    }
    dialog.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-pp], .pp_kick');
      if (!b) return;
      if (b.dataset.pp === 'invite') return link('POST');
      if (b.dataset.pp === 'reset') return link('DELETE');
      if (b.dataset.pp === 'copy') return shareLink({ title: `Join ${p.title} on ACRUX`, url: dialog.querySelector('.pp_link input').value }, b.querySelector('span'));
      try {
        await CATALOG.change(`playlists/${encodeURIComponent(p.id)}/people/${encodeURIComponent(b.dataset.gid)}`, 'DELETE');
        draw();
      } catch (e2) { err(e2.message); }
    });
    dialog.addEventListener('change', async (e) => {
      err();
      try {
        if (e.target === wifi) await CATALOG.change('sharing', 'PUT', { on: wifi.checked });
        else if (e.target.matches('.pp_role')) await CATALOG.change(`playlists/${encodeURIComponent(p.id)}/people/${encodeURIComponent(e.target.dataset.gid)}`, 'PATCH', { role: e.target.value });
      } catch (e2) { err(e2.message); }
      draw();
    });
    dialog.addEventListener('close', () => window.navReload?.()); // the faces on the page
    draw();
    if (p.invited) link('POST'); // the link you made before
    dialog.showModal();
  }

  // Order Songs: the rows get a grip (drag them), arrows (for the keyboard) and a ✕; Done saves the new order.
  function startOrder() {
    const ol = root.querySelector('.pl_list');
    const bar = root.querySelector('.pl_order_bar');
    const before = ol.innerHTML;
    root.querySelector('.find input').value = '';
    filter();
    ol.classList.add('ordering');
    bar.hidden = false;
    ol.innerHTML = [...ol.children].map((li) => {
      const s = CATALOG.find(li.dataset.id);
      return `<li class="pl_row pl_ord" data-id="${esc(s.id)}" draggable="true">
        <span class="pl_grip" aria-hidden="true">${ic('bars')}</span>
        <span class="pl_song"><span class="pl_thumb"><img alt="" src="${s.cover}"></span><span class="pl_name">${esc(s.title)}</span></span>
        <span class="pl_cell">${esc(s.artist)}</span><span class="pl_cell">${esc(albumOf(s).title)}</span>
        <button class="pl_mv" data-move="-1" aria-label="Move ${esc(s.title)} up">${ic('chevron-left')}</button>
        <button class="pl_mv pl_down" data-move="1" aria-label="Move ${esc(s.title)} down">${ic('chevron-left')}</button>
        <button class="pl_mv" data-drop aria-label="Remove ${esc(s.title)} from the playlist">${ic('xmark')}</button></li>`;
    }).join('');
    let dragged = null;
    const move = (e) => {
      e.preventDefault();
      const over = e.target.closest('.pl_ord');
      if (!dragged || !over || over === dragged) return;
      const r = over.getBoundingClientRect();
      over[e.clientY > r.top + r.height / 2 ? 'after' : 'before'](dragged);
    };
    ol.ondragstart = (e) => { dragged = e.target.closest('.pl_ord'); dragged?.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
    ol.ondragover = move;
    ol.ondrop = (e) => e.preventDefault();
    ol.ondragend = () => { dragged?.classList.remove('dragging'); dragged = null; };
    ol.onclick = (e) => {
      const b = e.target.closest('[data-move], [data-drop]');
      if (!b) return;
      const li = b.closest('li');
      if (b.hasAttribute('data-drop')) {
        const next = li.nextElementSibling || li.previousElementSibling;
        li.remove();
        return next?.querySelector('[data-drop]')?.focus();
      }
      const to = b.dataset.move === '-1' ? li.previousElementSibling : li.nextElementSibling;
      if (!to) return;
      to[b.dataset.move === '-1' ? 'before' : 'after'](li);
      b.focus();
    };
    const stop = () => {
      ol.classList.remove('ordering');
      bar.hidden = true;
      ol.ondragstart = ol.ondragover = ol.ondrop = ol.ondragend = ol.onclick = null;
    };
    orderDone = async (save) => {
      if (!save) {
        ol.innerHTML = before;
        return stop();
      }
      const ids = [...ol.children].map((li) => li.dataset.id);
      try {
        await CATALOG.change(`playlists/${encodeURIComponent(id)}/songs`, 'PUT', { songs: ids.map((x) => CATALOG.ref(CATALOG.find(x))) });
        stop();
        window.navReload?.();
      } catch (err) { flash(bar, err.message); }
    };
  }
  let orderDone = null;

  // ＋ on an album: saved as a playlist of yours (api/playlists.js); saving it again updates that one. Saved: a ✓ to it.
  const savedOf = (al) => `from-${`library:${al.id}`.replace(/[^\w-]+/g, '-')}`.slice(0, 120);
  const saveButton = (al) => (CATALOG.playlist(savedOf(al))
    ? `<a class="round red" href="${CATALOG.page(`view=playlist&id=${encodeURIComponent(savedOf(al))}`)}" aria-label="In My Playlists · open it">${ic('check')}</a>`
    : `<button class="round red" data-act="savealbum" aria-label="Add to My Playlists">${ic('plus')}</button>`);
  async function saveAlbum(al, b) {
    b.setAttribute('aria-disabled', 'true');
    try {
      await CATALOG.change('playlists', 'POST', { title: al.title, from: `library:${al.id}`, photo: al.cover,
        songs: CATALOG.list(`album:${al.id}`).map(CATALOG.ref) });
      await CATALOG.refresh();
      b.outerHTML = saveButton(al);
    } catch (err) {
      b.removeAttribute('aria-disabled');
      alert(err.message);
    }
  }

  // Duplicate: a copy of yours, or of a demo playlist (its songs go along), that you can change. It opens.
  async function duplicate(p) {
    try {
      const { id: copy } = p.server ? await CATALOG.change(`playlists/${encodeURIComponent(p.id)}/duplicate`, 'POST')
        : await CATALOG.change('playlists', 'POST', { title: `${p.title} (Copy)`, desc: p.desc, groove: p.groove, photo: p.photo,
          songs: CATALOG.list(`playlist:${p.id}`).map(CATALOG.ref) });
      goTo(CATALOG.page(`view=playlist&id=${encodeURIComponent(copy)}`));
    } catch (err) { alert(err.message); }
  }
  async function deletePlaylist(p) {
    if (!confirm(`Delete “${p.title}”? Its songs stay in your library. This can’t be undone.`)) return;
    try {
      await CATALOG.change(`playlists/${encodeURIComponent(p.id)}`, 'DELETE');
      goTo(CATALOG.page('view=playlist'));
    } catch (err) { alert(err.message); }
  }

  // An invite link (…&invite=<token>) opened on a guest's phone or laptop: say who you are, then you're in.
  async function join(token) {
    const clean = () => { const u = new URL(location.href); u.searchParams.delete('invite'); history.replaceState(history.state, '', u); };
    if (owner) return clean(); // your own link, on this computer
    let info;
    try { info = await CATALOG.call(`invites/${encodeURIComponent(token)}`); } catch (err) { clean(); return alert(err.message); }
    document.body.insertAdjacentHTML('beforeend', `
      <dialog class="edit_pl" id="join_pl" aria-labelledby="join_h"><form>
        <h2 id="join_h">Join “${esc(info.playlist.title)}”</h2>
        <p class="edit_note">${info.role === 'edit' ? 'You’ll be able to add, remove and reorder its songs, and listen.' : 'You’ll be able to listen to it.'}</p>
        <label>Your name<input class="edit_field" name="name" autocomplete="nickname" maxlength="40" required placeholder="So the others know who added what"></label>
        <p class="edit_note" role="status"></p>
        <div class="edit_foot"><span></span><button class="edit_done">Join</button></div>
      </form></dialog>`);
    const dialog = document.getElementById('join_pl');
    dialog.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await CATALOG.call(`invites/${encodeURIComponent(token)}/join`, 'POST', { name: e.target.name.value.trim() });
        dialog.close();
        clean();
        await CATALOG.reload(); // your songs in it, now that the server knows you
        goTo(CATALOG.page(`view=playlist&id=${encodeURIComponent(info.playlist.id)}`));
      } catch (err) { dialog.querySelector('[role=status]').textContent = err.message; }
    });
    dialog.showModal();
  }

  // Removes an album you added, after asking: copied in, its files too; from Drive, its downloaded copies (Drive itself
  // isn't touched); from a linked folder, nothing on disk. The server says why when it can't (an album inside a folder
  // of albums). Then back.
  async function removeAlbum(al) {
    const what = al.drive ? 'Its downloaded copies are deleted; your Google Drive isn’t touched.'
      : al.source === 'local' ? 'Its song files are deleted too. This can’t be undone.' : 'Its files stay where they are.';
    if (!confirm(`Remove “${al.title}” from ACRUX? ${what}`)) return;
    const res = await fetch(`${SITE}api/albums/${al.id.slice(4)}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) return alert((await res?.json().catch(() => null))?.error || 'That album couldn’t be removed. Is the ACRUX server running?');
    await CATALOG.reload();
    root.querySelector('[data-back]')?.click();
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
  paintMarks(root);
  if (view === 'mymusic') window.mountAddMore?.(root.querySelector('#addmore .addmore'));
  if (q.get('invite')) join(q.get('invite'));

  // The ⋯ menu's labels follow what's true as it opens: pinned or not, ♥ or not, downloaded or not.
  root.querySelector('#pl_menu')?.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    const menu = e.target;
    const kind = view === 'album' ? 'album' : 'playlist';
    const label = (name, text) => { const el = menu.querySelector(`[data-label=${name}]`); if (el) el.textContent = text; };
    label('pin', CATALOG.marked('pin', id) ? 'Unpin Playlist' : 'Pin Playlist');
    label('fav', CATALOG.marked(kind, id) ? 'Remove from Favorites' : 'Favorite');
    const k = menu.querySelector('[data-keep]') && keepOf(menu.querySelector('[data-keep]').dataset.keep);
    label('keep', { done: 'Remove Download', waiting: 'Stop Downloading', can: 'Download' }[k?.state] || 'Download');
  });
  // Your Favorites, when a ♥ goes: the song leaves the list.
  const onCollection = () => {
    if (!root.isConnected) return document.removeEventListener('collectionchange', onCollection);
    if (view === 'playlist' && id === 'favorites' && !root.querySelector('.ordering')) window.navReload?.();
  };
  document.addEventListener('collectionchange', onCollection);
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
    const here = view === 'playlist' && CATALOG.playlist(id);
    if (b.dataset.more) return showTray(CATALOG.find(b.dataset.more) || list.find((s) => s.id === b.dataset.more), b, here?.server && here.editable ? id : null);
    if (b.getAttribute('role') === 'menuitemradio') {
      menu.querySelectorAll(`[data-group="${b.dataset.group}"]`).forEach((r) => r.setAttribute('aria-checked', r === b));
      const pick = (group) => menu.querySelector(`[data-group="${group}"][aria-checked="true"]`)?.dataset.value;
      resort?.(pick('by'), pick('dir') === 'asc', pick('show'));
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
    } else if (b.dataset.act === 'remove') {
      removeAlbum(CATALOG.album(id));
    } else if (b.dataset.act === 'pin') {
      CATALOG.toggleMark('pin', id, { title: here.title, sub: 'Playlist', href: location.href }).then(() => window.navReload?.(), (err) => alert(err.message));
    } else if (b.dataset.act === 'favitem') {
      const fav = root.querySelector('.pl_heart');
      if (fav) fav.click(); // the ♥ by Play does it (and shows it)
    } else if (b.dataset.act === 'order') {
      startOrder();
    } else if (b.dataset.act === 'order-done' || b.dataset.act === 'order-cancel') {
      orderDone?.(b.dataset.act === 'order-done');
    } else if (b.dataset.act === 'duplicate') {
      duplicate(here);
    } else if (b.dataset.act === 'savealbum') {
      saveAlbum(CATALOG.album(id), b);
    } else if (b.dataset.act === 'delete') {
      deletePlaylist(here);
    }
    menu?.togglePopover(false);
  });

  // nav.js runs this again for each library page it swaps in: then the player already exists.
  const hook = () => { music.addEventListener('play', mark); mark(); }; // mark() now: a song may already be playing
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
});
