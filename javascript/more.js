// ACRUX ⋯ tray: actions for a song. The header's ⋯ opens it for the song in the player; showTray(song, button, from)
// opens it for any other (song rows; `from`: the playlist the row is in). It opens beside its button (upwards from the
// phone's bottom player). Also the ♥ and ↓ buttons every page draws (favButton, keepButton) and "Save to computer"
// links (saveHref), which work wherever they are. Uses CATALOG and player.js (songs, index). shareLink() and
// placeTray() are shared with library.js.
async function shareLink(data, label) {
  try {
    if (navigator.share) return await navigator.share(data);
    await navigator.clipboard.writeText(data.url);
    if (!label) return;
    const was = label.textContent;
    label.textContent = 'Link copied';
    await new Promise((done) => setTimeout(done, 1200));
    label.textContent = was;
  } catch {} // share sheet dismissed, or no clipboard access
}

// A tray (a popover menu) opens beside its button: below it, or above it in the lower half of the screen, by its
// right edge but never past the screen's left. On phones every tray rises from the bottom as a sheet (CSS) instead.
function placeTray(tray, anchor) {
  if (matchMedia('(max-width: 699px)').matches) {
    tray.style.top = tray.style.right = tray.style.bottom = '';
    return;
  }
  const r = anchor.getBoundingClientRect();
  const { clientWidth: w, clientHeight: h } = document.documentElement;
  const up = r.top > h / 2;
  tray.style.top = up ? 'auto' : `${r.bottom + 8}px`;
  tray.style.bottom = up ? `${h - r.top + 8}px` : 'auto';
  tray.style.right = `${Math.max(8, Math.min(w - r.right, w - parseFloat(getComputedStyle(tray).width) - 8))}px`; // the CSS width, even while closed
}

const escAttr = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ♥: a song (id), album, artist or playlist. Songs are found by id; the others carry what draws them in your
// favorites (info: { title, sub, cover, href }). Only the owner can ♥ or download: until the collection says this is
// the owner's computer, the page is a `viewer` (insert.css hides them).
function favButton(kind, id, info = {}, cls = 'pl_fav') {
  const data = Object.entries(info).map(([k, v]) => ` data-fav-${k}="${escAttr(v)}"`).join('');
  return `<button class="${cls}" data-fav-kind="${kind}" data-fav-id="${escAttr(id)}"${data}><i class="icon icon-heart" aria-hidden="true"></i></button>`;
}
// ↓ Download: a song ("song:<id>") or a whole list ("list:<key>") kept for playing offline.
function keepButton(target, cls = 'pl_dl') {
  if (!keepOf(target)) return `<span class="${cls}"></span>`;
  return `<button class="${cls}" data-keep="${escAttr(target)}"><i class="icon icon-download" aria-hidden="true"></i></button>`;
}
// A target's songs that can be kept, and where they stand: 'here' (all on this computer), 'done', 'waiting' or 'can'.
function keepOf(target) {
  const [kind, ...rest] = target.split(':');
  const id = rest.join(':');
  const list = (kind === 'song' ? [CATALOG.find(id)] : CATALOG.list(id)).filter((s) => CATALOG.keepState(s));
  if (!list.length) return null;
  const states = list.map(CATALOG.keepState);
  const state = states.every((x) => x === 'here') ? 'here' : states.some((x) => x === 'can') ? 'can'
    : states.some((x) => x === 'waiting') ? 'waiting' : 'done';
  return { list, state };
}
const KEEP_LABEL = { here: 'On this computer', done: 'Downloaded · remove the download', waiting: 'Downloading… · stop', can: 'Download · play offline' };
// Save to computer: the file, or a ZIP. The server knows your playlists and albums; built-in lists send their songs.
function saveHref(what) {
  const api = `${SITE}api/save`;
  if (what.song) return `${api}?song=${encodeURIComponent(JSON.stringify(CATALOG.ref(what.song)))}`;
  if (what.playlist?.server) return `${api}?playlist=${encodeURIComponent(what.playlist.id)}`;
  if (what.album?.lib) return `${api}?album=${encodeURIComponent(what.album.id)}`;
  const list = CATALOG.list(what.key).filter((s) => !s.video && !s.result?.preview).map(CATALOG.ref);
  return list.length ? `${api}?name=${encodeURIComponent(what.name)}&songs=${encodeURIComponent(JSON.stringify(list))}` : null;
}

// Draws every ♥ and ↓ on the page as things stand (after any change, and once the page has drawn them).
function paintMarks(root = document) {
  root.querySelectorAll('[data-fav-kind]').forEach((b) => {
    const on = CATALOG.marked(b.dataset.favKind, b.dataset.favId);
    b.setAttribute('aria-pressed', on);
    b.setAttribute('aria-label', on ? 'Remove from favorites' : 'Add to favorites');
  });
  root.querySelectorAll('[data-keep]').forEach((b) => {
    const k = keepOf(b.dataset.keep);
    b.dataset.state = k?.state || '';
    b.setAttribute('aria-label', k ? KEEP_LABEL[k.state] : '');
    b.title = k ? KEEP_LABEL[k.state] : '';
  });
}
document.addEventListener('collectionchange', () => paintMarks());

// A small note by a button that did something ("Added to Road Trip"), or went wrong.
function flash(el, message) {
  const tip = document.createElement('span');
  tip.className = 'flash';
  tip.setAttribute('role', 'status');
  tip.textContent = message;
  document.body.append(tip);
  const r = el.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - tip.offsetWidth / 2, innerWidth - tip.offsetWidth - 8))}px`;
  tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`;
  setTimeout(() => tip.remove(), 2200);
}

async function toggleFav(b) {
  const kind = b.dataset.favKind;
  const id = b.dataset.favId;
  const info = kind === 'song' ? CATALOG.find(id) : { title: b.dataset.favTitle, sub: b.dataset.favSub, cover: b.dataset.favCover, href: b.dataset.favHref };
  if (!info) return;
  b.setAttribute('aria-pressed', !CATALOG.marked(kind, id)); // at once; the server's answer confirms it
  try { await CATALOG.toggleMark(kind, id, info); } catch (err) { flash(b, err.message); paintMarks(); }
}
async function toggleKeep(b) {
  const k = keepOf(b.dataset.keep);
  if (!k || k.state === 'here') return;
  const off = k.state === 'done' || k.state === 'waiting';
  const refs = k.list.filter((s) => (CATALOG.keepState(s) === 'can') !== off).map(CATALOG.ref);
  try {
    const out = await CATALOG.change('offline', off ? 'DELETE' : 'PUT', { songs: refs });
    if (!off && out.skipped) flash(b, `${out.skipped} can’t be kept offline (videos and previews)`);
  } catch (err) { flash(b, err.message); }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fav-kind], button[data-keep]');
  if (!b) return;
  b.closest('.tray')?.hidePopover(); // a menu item: the menu closes
  if (b.dataset.favKind) toggleFav(b); else toggleKeep(b);
});

(() => {
  const btn = document.getElementById('more');
  if (!btn) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="tray" id="more_tray" popover>
      <button data-act="add" data-need="edit">Add to Playlist<i class="icon icon-chevron-right" aria-hidden="true"></i></button>
      <button data-act="unlist" data-need="from" hidden>Remove from This Playlist</button>
      <hr data-need="edit">
      <button data-act="fav" data-need="owner"></button>
      <button data-act="keep" data-need="owner"></button>
      <a data-act="save" data-need="save" download>Save to Computer</a>
      <button data-act="info">Get Info</button>
      <hr>
      <a data-act="album">Go to Album</a>
      <a data-act="artist">Go to Artist</a>
      <hr>
      <button data-act="share"><i class="icon icon-share" aria-hidden="true"></i><span>Share</span></button>
    </div>
    <div class="tray tray_add" id="add_tray" popover>
      <form class="add_new"><input name="title" placeholder="New playlist" aria-label="New playlist name" autocomplete="off" maxlength="100"><button>Create</button></form>
      <div class="add_lists"></div>
    </div>
    <dialog class="song_info" id="song_info" aria-labelledby="info_name" closedby="any">
      <img alt="">
      <h3 id="info_name"></h3>
      <p></p>
      <form method="dialog"><button>Done</button></form>
    </dialog>`);
  const tray = document.getElementById('more_tray');
  const add = document.getElementById('add_tray');
  const info = document.getElementById('song_info');
  let target = null; // the song showTray() opened it for; null = the one in the player
  let from = null;   // the playlist its row is in
  let anchor = btn;
  let picked = null; // the song Add to Playlist is for (it outlives the first tray)
  const song = () => target || songs[index];

  window.showTray = (s, el, list = null) => {
    target = s;
    from = list;
    anchor = el;
    tray.togglePopover(true);
  };

  tray.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') {
      target = null;
      from = null;
      anchor = btn;
      return;
    }
    placeTray(tray, anchor);
    const s = song();
    const me = CATALOG.me();
    const editable = CATALOG.playlists.some((p) => p.server && p.editable);
    const keep = me.owner && keepOf(`song:${s.id}`);
    const save = !s.video && !s.result?.preview && CATALOG.keepState(s) && saveHref({ song: s });
    const need = { edit: me.owner || editable, owner: !!me.owner, from: !!from, save: !!save };
    tray.querySelectorAll('[data-need]').forEach((el) => { el.hidden = !need[el.dataset.need]; });
    tray.querySelector('[data-act=fav]').textContent = CATALOG.marked('song', s.id) ? 'Remove from Favorites' : 'Add to Favorites';
    const k = tray.querySelector('[data-act=keep]');
    k.hidden = !keep || keep.state === 'here';
    if (keep) k.textContent = { done: 'Remove Download', waiting: 'Stop Downloading', can: 'Download' }[keep.state] || '';
    if (save) tray.querySelector('[data-act=save]').href = save;
    const album = CATALOG.album(s.album); // a Discover song has none: its own album and artist pages (discover.js)
    const toAlbum = tray.querySelector('[data-act=album]');
    const toArtist = tray.querySelector('[data-act=artist]');
    const albumHref = album ? CATALOG.page(`view=album&id=${album.id}`) : s.albumHref;
    const artistHref = album ? CATALOG.page(`view=artist&id=${album.artist}`) : s.artistHref;
    toAlbum.hidden = !albumHref;
    toArtist.hidden = !artistHref;
    toAlbum.previousElementSibling.hidden = !albumHref && !artistHref;
    if (albumHref) toAlbum.href = albumHref;
    if (artistHref) toArtist.href = artistHref;
  });

  // Add to Playlist: a new one by name, or one you can change (yours; a guest: the ones they can edit).
  function openAdd() {
    picked = song();
    const lists = CATALOG.pinnedFirst(CATALOG.playlists.filter((p) => p.server && p.editable));
    add.querySelector('.add_lists').innerHTML = lists.map((p) => `<button data-to="${escAttr(p.id)}"><i class="icon icon-folder-open" aria-hidden="true"></i>${escAttr(p.title)}</button>`).join('')
      || '<p class="add_none">No playlists of yours yet: name one above.</p>';
    add.querySelector('.add_new').hidden = !CATALOG.me().owner;
    add.querySelector('input').value = '';
    placeTray(add, anchor);
    tray.togglePopover(false);
    add.togglePopover(true);
    add.querySelector(CATALOG.me().owner ? 'input' : 'button')?.focus();
  }
  async function addTo(id, el) {
    const p = CATALOG.playlist(id);
    try {
      const out = await CATALOG.change(`playlists/${encodeURIComponent(id)}/songs`, 'POST', { songs: [CATALOG.ref(picked)] });
      flash(anchor.isConnected ? anchor : btn, out.added ? `Added to ${p.title}` : `Already in ${p.title}`);
      add.togglePopover(false);
      if (new URLSearchParams(location.search).get('id') === id) window.navReload?.(); // the page showing that playlist
    } catch (err) { flash(el, err.message); }
  }
  add.addEventListener('click', (e) => {
    const b = e.target.closest('[data-to]');
    if (b) addTo(b.dataset.to, b);
  });
  add.querySelector('.add_new').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = e.target.title.value.trim();
    if (!title) return;
    try {
      const { id } = await CATALOG.change('playlists', 'POST', { title, songs: [CATALOG.ref(picked)] });
      flash(anchor.isConnected ? anchor : btn, `Added to ${title}`);
      add.togglePopover(false);
      if (!new URLSearchParams(location.search).get('id')) window.navReload?.(); // a list of playlists may be showing
      return id;
    } catch (err) { flash(e.target, err.message); }
  });

  tray.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const s = song();
    const album = CATALOG.album(s.album);
    if (act === 'add') return openAdd();
    if (act === 'info') {
      info.querySelector('img').src = s.cover;
      info.querySelector('h3').textContent = s.title;
      info.querySelector('p').textContent = `${s.artist} — ${album ? album.title : s.albumTitle} · ${s.time}`;
      tray.togglePopover(false);
      info.showModal();
    } else if (act === 'share') {
      await shareLink({ title: `${s.title} — ${s.artist}`, url: album ? CATALOG.page(`view=album&id=${album.id}`) : s.sourceUrl }, tray.querySelector('[data-act=share] span'));
      tray.togglePopover(false);
    } else if (act === 'fav' || act === 'keep' || act === 'unlist') {
      const list = from;
      tray.togglePopover(false);
      try {
        if (act === 'fav') await CATALOG.toggleMark('song', s.id, s);
        if (act === 'keep') {
          const off = ['done', 'waiting'].includes(CATALOG.keepState(s));
          await CATALOG.change('offline', off ? 'DELETE' : 'PUT', { songs: [CATALOG.ref(s)] });
        }
        if (act === 'unlist' && list) { // only from a row in a playlist you can change
          const rest = CATALOG.list(`playlist:${list}`).filter((x) => x.id !== s.id).map(CATALOG.ref);
          await CATALOG.change(`playlists/${encodeURIComponent(list)}/songs`, 'PUT', { songs: rest });
          window.navReload?.();
        }
      } catch (err) { flash(anchor.isConnected ? anchor : btn, err.message); }
    } else if (act === 'save') {
      tray.togglePopover(false);
    }
  });
})();
