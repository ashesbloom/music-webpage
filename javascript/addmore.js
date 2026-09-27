// ACRUX Add More Songs: the panel at the top of My Music (library.js mounts it with mountAddMore).
//   - The intake tile: drop songs, folders or a .zip (or choose them); each file goes to the server (POST /api/import),
//     which copies it into ACRUX and plays it from this computer. Or, with Play from where it is (remembered in the
//     settings), pick a folder on the server's own list (a page can't see disk paths): it's linked in place, nothing
//     copied. Or paste a Google Drive link: a song, an album, or a folder of albums; the server looks through it and
//     plays its songs through its cache.
//   - Your added music: everything you added, as sleeves in a crate (like My Playlists). A sleeve opens what it holds
//     (the album; the albums of a folder of albums; the song) and plays it; a Drive or linked one also refreshes or goes.
//   - The bar at the bottom: how much is downloaded from Drive, how long songs stay, how many upcoming songs get ready,
//     and the Google Drive sign-in.
// Loaded once per page (not rerun by nav.js), so an import carries on while you move around the site.
(() => {
  const SONG = /\.(mp3|flac|m4a|aac|ogg|oga|opus|wav|aiff?)$/i;
  const ZIP = /\.zip$/i;
  // A picture that may be its folder's cover (the server keeps the best-named one); back, CD and booklet scans stay home.
  const PIC = /^(?!.*\b(back|cd\d*|disc\d*|disk\d*|inlay|tray|inside|inner|booklet|matrix|label|spine)\b).*\.(jpe?g|png|webp)$/i;
  const PLACEHOLDER = 'placeholder.svg';
  const AUDIENCE = 'https://console.cloud.google.com/auth/audience'; // where the test users (the accounts allowed to sign in) are listed
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const ic = (name) => `<i class="icon icon-${name}" aria-hidden="true"></i>`;
  const bytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
  const count = (n, word) => `${Number(n).toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  // The albums of one thing you added, by title.
  const albumsOf = (id) => CATALOG.albums.filter((al) => al.source === id).sort((a, b) => a.title.localeCompare(b.title));
  const api = (path, init) => fetch(`${SITE}api/${path}`, init);
  const sendJson = (path, method, body) => api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  let el = null;      // the mounted panel
  let info = null;    // GET /api/sources: { sources, drive, cache, settings }; null until the server answers
  let offline = false;
  const scans = {};   // Drive link id -> its latest scan event
  let adding = null;  // while a drop is being added: { done, total, added, skipped: [{ name, why }], left, current }
  let note = '';      // how the last drop went
  let driveNote = ''; // how the last Drive link went (HTML)
  const linking = () => info?.settings.keepCopy === 0; // Play from where it is
  const todo = [];    // files waiting to be sent: { file, rel, batch }
  let workers = 0;

  // ---------- drawing ----------

  function skeleton() {
    el.innerHTML = `
      <div class="am_intake">
        <div class="pill am_mode" role="group" aria-label="Songs from this computer">
          <button type="button" class="tool" data-act="mode" data-keep="1" aria-pressed="true">Keep a copy in ACRUX</button>
          <button type="button" class="tool" data-act="mode" data-keep="0" aria-pressed="false">Play from where it is</button>
        </div>
        <div class="am_drop">
          <span class="am_disc">${ic('plus')}</span>
          <div class="am_txt"><strong data-copy>Drop songs, folders or a .zip</strong><strong data-link>Choose a folder of songs</strong>
            <span data-copy>They’re copied into ACRUX and play from this computer. MP3, FLAC, M4A, OGG, Opus, WAV and AIFF.</span>
            <span data-link>Nothing is copied: they play from that folder, and <em>Refresh</em> picks up what changed in it.
              MP3, FLAC, M4A, OGG, Opus, WAV and AIFF.</span></div>
          <div class="am_btns">
            <button type="button" class="am_btn" data-act="files" data-copy>${ic('plus')}Choose files</button>
            <button type="button" class="am_btn" data-act="folder">${ic('folder-open')}Choose a folder</button>
          </div>
          <input type="file" class="am_pick" multiple hidden accept="audio/*,.flac,.m4a,.opus,.oga,.aif,.aiff,.zip,image/jpeg,image/png,image/webp">
          <input type="file" class="am_pick_dir" webkitdirectory hidden>
        </div>
        <p class="am_status" role="status" aria-live="polite"></p>
        <p class="am_or"><span>or from Google Drive</span></p>
        <form class="am_drive">
          <label class="find am_find">${ic('link')}<input class="am_link" type="url" required autocomplete="off"
            placeholder="Paste a link to a song, an album or a folder" aria-label="Google Drive link to a song, an album or a folder of albums"></label>
          <button class="pl_playall am_add">Add</button>
        </form>
        <p class="am_msg" role="status" aria-live="polite"></p>
      </div>
      <section class="am_added" aria-labelledby="am_added_h" hidden>
        <h3 id="am_added_h">Your added music</h3>
        <ul class="crate am_crate"></ul>
      </section>
      <div class="am_bar"></div>`;
    el.classList.add('am');
  }

  // What a Drive link is doing while it's looked through, or null when it's done.
  function scanning(s) {
    const scan = scans[s.id];
    if (s.status !== 'scanning' && (!scan || ['ready', 'error'].includes(scan.status))) return null;
    if (scan?.status === 'reading') return `Reading songs · ${Number(scan.read).toLocaleString()} of ${Number(scan.total).toLocaleString()}`;
    return `Looking through it${scan?.found ? ` · ${count(scan.found, 'song')} found` : '…'}`;
  }

  // One thing you added, as a sleeve: its cover (an album's, a mosaic of four for several albums, the groove when
  // none), its name and what it holds; it links to where it plays. Drive ones refresh and go; all of them play.
  function sleeve(s) {
    const albums = albumsOf(s.id);
    const songs = albums.flatMap((al) => CATALOG.list(`album:${al.id}`));
    const local = s.kind === 'local';
    const one = albums.length === 1 && albums[0];
    const title = local && !one ? 'This computer' : s.isFile ? songs[0]?.title || s.title : one ? one.title : s.title; // copied-in music: named after its album while it's one
    const covers = [...new Set(albums.map((al) => al.cover).filter((c) => !c.endsWith(PLACEHOLDER)))];
    const cover = covers.length >= 4 && !one
      ? `<span class="cv cv_mo">${covers.slice(0, 4).map((c) => `<img alt="" loading="lazy" src="${c}">`).join('')}</span>`
      : covers.length && (!local || one) ? `<span class="cv"><img alt="" loading="lazy" src="${covers[0]}"></span>`
        : `<span class="cv cv_gv" style="--c1: #a21e1e; --c2: #1a0505"><b>${esc(title)}</b></span>`;
    const busy = !local && scanning(s);
    const failed = !busy && s.status.startsWith('error') && s.status.replace(/^error:\s*/, '');
    const what = local && !one ? `${count(s.songs, 'song')} · ${count(albums.length, 'album')}`
      : s.isFile ? `Song${songs[0] ? ` · ${songs[0].artist}` : ''}`
        : one ? `Album · ${count(s.songs, 'song')}` : `${count(albums.length, 'album')} · ${count(s.songs, 'song')}`;
    const href = s.isFile && songs[0] ? CATALOG.page(`view=album&id=${songs[0].album}&song=${encodeURIComponent(songs[0].id)}`)
      : one ? CATALOG.page(`view=album&id=${one.id}`) : albums.length ? CATALOG.page(`view=albums&source=${encodeURIComponent(s.id)}`) : null;
    const inner = `<span class="cr_sl"><span class="cr_disc"></span>${cover}</span>
      <span class="cr_nm">${esc(title)}</span>
      <span class="cr_mt${failed ? ' am_err' : ''}">${esc(busy || (failed ? `Stopped: ${failed}` : what))}</span>`;
    return `<li class="am_item${busy ? ' am_busy' : ''}" data-id="${esc(s.id)}" style="--lab: ${local ? 'var(--glow)' : 'var(--accent)'}">
      ${href ? `<a class="crate_item" href="${href}">${inner}</a>` : `<div class="crate_item">${inner}</div>`}
      <div class="am_acts">
        ${songs.length ? `<button type="button" class="round red" data-act="play" aria-label="Play">${ic('play')}</button>` : ''}
        ${local ? '' : `<button type="button" class="round" data-act="rescan" aria-label="Refresh"${busy ? ' aria-disabled="true"' : ''}>${ic('rotate')}</button>
          <button type="button" class="round" data-act="remove" aria-label="Remove">${ic('trash')}</button>`}
      </div></li>`;
  }

  function bar() {
    const d = info.drive;
    const hasDrive = info.sources.some((s) => s.kind === 'drive');
    const select = (key, label, values, name) => `<select data-set="${key}" aria-label="${label}">${[...new Set([...values, info.settings[key]])]
      .sort((a, b) => (a || Infinity) - (b || Infinity)).map((v) => `<option value="${v}"${v === info.settings[key] ? ' selected' : ''}>${name(v)}</option>`).join('')}</select>`;
    const days = (v) => ({ 0: 'until space runs out', 1: '1 day', 7: '1 week', 14: '2 weeks', 30: '1 month' }[v] || `${v} days`);
    const signIn = d.connected
      ? `<span>Signed in to Google Drive <button type="button" class="am_link_btn" data-act="disconnect">Sign out</button></span>`
      : d.client ? `<span><a class="am_link_btn" href="${SITE}api/drive/connect">${d.expired ? 'Sign in to Google Drive again' : 'Sign in to Google Drive'}</a>
          for private folders and steadier downloads. Only accounts listed as
          <a class="am_link_btn" href="${AUDIENCE}" target="_blank" rel="noopener">test users</a> can sign in.</span>`
        : `<span><button type="button" class="am_link_btn" data-act="setup">Set up Google sign-in</button> for private folders and steadier downloads</span>`;
    const held = d.held ? `<div class="am_held"><p class="am_err">Google Drive is holding back downloads from this computer for about ${d.held}
      more min (too many in a row). Songs you’ve already played still play.</p>${d.connected ? '' : `<p>Signed-in downloads aren’t held back like
      this. ${d.client ? `<a class="am_btn" href="${SITE}api/drive/connect">Sign in to Google Drive</a>`
        : `<button type="button" class="am_btn" data-act="setup">${ic('link')}Set up Google sign-in</button>`}</p>`}</div>` : '';
    const wizard = '<span><button type="button" class="am_link_btn" data-act="wizard">Set up ACRUX</button>: keys, sources and your phone</span>';
    if (!hasDrive) return held + wizard + signIn;
    return `${held}${wizard}
      <span>${info.cache.bytes ? `Downloaded from Drive: ${bytes(info.cache.bytes)} of` : 'Nothing downloaded from Drive yet. Room for'}
        ${select('cacheGB', 'Space for songs from Drive', [2, 5, 10, 20, 50, 100], (v) => `${v} GB`)}</span>
      <span>Keep each song ${select('keepDays', 'How long a song stays downloaded', [1, 3, 7, 14, 30, 0], days)}
        ${info.settings.keepDays ? 'after you last play it' : ''}</span>
      <span>Get the next ${select('prefetch', 'Songs to get ready', [0, 1, 2, 3, 5, 8, 10], String)} songs ready</span>
      ${signIn}`;
  }

  function update() {
    if (!el?.isConnected) return;
    if (offline) {
      el.classList.remove('am');
      el.innerHTML = `${ic('plus')}<span>Adding songs needs the ACRUX server: run npm start</span>`;
      return;
    }
    el.querySelector('.am_status').textContent = adding
      ? `Adding ${Math.min(adding.done + 1, adding.total)} of ${adding.total}${adding.current ? ` · ${adding.current}` : ''}`
      : note;
    el.querySelector('.am_intake').classList.toggle('busy', !!adding);
    el.querySelector('.am_intake').classList.toggle('linking', linking());
    for (const b of el.querySelectorAll('.am_mode .tool')) b.setAttribute('aria-pressed', String(b.dataset.keep === (linking() ? '0' : '1')));
    el.querySelector('.am_msg').innerHTML = driveNote;
    if (!info) return;
    const shown = info.sources.filter((s) => s.kind !== 'local' || s.songs);
    el.querySelector('.am_added').hidden = !shown.length;
    el.querySelector('.am_crate').innerHTML = shown.map(sleeve).join('');
    el.querySelector('.am_bar').innerHTML = bar();
  }

  // ---------- server ----------

  async function refresh() {
    try {
      const res = await api('sources');
      if (!res.headers.get('content-type')?.includes('json')) throw new Error(res.status);
      info = await res.json();
      offline = false;
    } catch {
      offline = true;
    }
    update();
  }

  // Your music changed: the catalog fetches it again, and My Music is drawn again if it's open (music playing on).
  async function reloadLibrary() {
    await CATALOG.reload();
    if (el?.isConnected) window.navReload?.();
  }

  // How far each Drive or linked folder has been read, on the catalog's live connection (which also redraws the page
  // as songs arrive).
  let listening = false;
  function listen() {
    if (listening || !CATALOG.events) return;
    listening = true;
    CATALOG.events.addEventListener('scan', (e) => {
      const scan = JSON.parse(e.data);
      scans[scan.source] = scan;
      if (scan.status === 'ready' || scan.status === 'error') refresh();
      else update();
    });
  }

  // ---------- adding from this computer ----------

  async function upload(item) {
    try {
      const res = await api(`import?name=${encodeURIComponent(item.rel)}&batch=${item.batch}`, { method: 'POST', body: item.file });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'The server didn’t take it');
      adding.added += body.added.length;
      adding.skipped.push(...body.skipped);
    } catch (err) {
      adding.skipped.push({ name: item.rel, why: err.message === 'Failed to fetch' ? 'The server stopped answering' : err.message });
    }
  }

  function finish() {
    const a = adding;
    const shown = a.skipped.slice(0, 3).map((s) => `${s.name.split('/').pop()} (${s.why.toLowerCase().replace(/\.$/, '')})`).join(', ');
    note = [
      a.added ? `Added ${count(a.added, 'song')}.` : 'No songs were added.',
      a.skipped.length ? `Skipped ${a.skipped.length}: ${shown}${a.skipped.length > 3 ? `, and ${a.skipped.length - 3} more` : ''}.` : '',
      a.left ? `Left out ${count(a.left, 'file')} that aren’t songs.` : '',
    ].filter(Boolean).join(' ');
    adding = null;
    update();
    refresh();
    if (a.added) reloadLibrary();
  }

  // Sends files two at a time; each drop's folder pictures go first, so its songs find them.
  async function add(files) {
    const base = (f) => f.rel.split('/').pop();
    const wanted = files.filter((f) => SONG.test(f.rel) || ZIP.test(f.rel) || PIC.test(base(f)));
    if (!wanted.length) {
      note = files.length ? 'Nothing to add there: drop songs, folders of songs, or a .zip.' : note;
      return update();
    }
    const batch = Math.random().toString(36).slice(2, 10);
    adding ??= { done: 0, total: 0, added: 0, skipped: [], left: 0, current: '' };
    adding.total += wanted.length;
    adding.left += files.length - wanted.length;
    note = '';
    update();
    for (const f of wanted.filter((x) => PIC.test(base(x)))) {
      adding.current = f.rel;
      update();
      await upload({ ...f, batch });
      adding.done++;
    }
    todo.push(...wanted.filter((x) => !PIC.test(base(x))).map((f) => ({ ...f, batch })));
    while (workers < 2 && todo.length) {
      workers++;
      (async () => {
        while (todo.length) {
          const item = todo.shift();
          adding.current = item.rel;
          update();
          await upload(item);
          adding.done++;
          update();
        }
        if (--workers === 0) finish();
      })();
    }
    if (!workers && !todo.length && adding.done >= adding.total) finish(); // only pictures
  }

  // Everything in a dropped folder, with its path (the folder's name first).
  async function walk(entry, dir = '') {
    if (entry.isFile) return [{ file: await new Promise((done, failed) => entry.file(done, failed)), rel: dir + entry.name }];
    const reader = entry.createReader();
    const out = [];
    for (let batch; (batch = await new Promise((done, failed) => reader.readEntries(done, failed))).length;) {
      for (const child of batch) out.push(...(await walk(child, `${dir}${entry.name}/`)));
    }
    return out;
  }

  // ---------- Google Drive ----------

  async function addDrive(link) {
    driveNote = 'Opening the link…';
    update();
    try {
      const res = await sendJson('sources', 'POST', { url: link });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        driveNote = body.kind === 'song' ? 'Added. Reading the song…' : 'Added. Looking through it: its albums show up below as they’re found.';
        const input = el?.querySelector('.am_link');
        if (input) input.value = '';
        return refresh();
      }
      driveNote = `<span class="am_err">${esc(body.error || 'That didn’t work. Try again.')}</span>`;
      if (body.needsAuth) {
        driveNote += info?.drive.client ? ` <a class="am_link_btn" href="${SITE}api/drive/connect">Sign in to Google Drive</a>`
          : ' <button type="button" class="am_link_btn" data-act="setup">Set up Google sign-in</button>';
      }
    } catch {
      driveNote = '<span class="am_err">The ACRUX server isn’t answering.</span>';
    }
    update();
  }

  // Play from where it is: a page can't learn where a folder is on disk, so the server lists this computer's folders
  // (GET /api/local/dirs, starting in Music) and the one you pick is linked in place (POST /api/local/link). Its songs
  // are read in the background, and its sleeve shows how far that got.
  function openFolders(then) {
    document.getElementById('am_folders')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
      <dialog class="edit_pl am_setup" id="am_folders" aria-labelledby="am_folders_h" closedby="any"><form>
        <h2 id="am_folders_h">Play a folder from where it is</h2>
        <p class="edit_note">Its songs, and those in every folder inside it, play from right there: nothing is copied. Removing
          it from ACRUX later leaves your files alone.</p>
        <p class="am_path"></p>
        <ul class="am_dirs"></ul>
        <p class="edit_note am_setup_msg" role="status"></p>
        <div class="edit_foot"><button type="button" value="cancel">Cancel</button><button class="edit_done">Play this folder</button></div>
      </form></dialog>`);
    const dialog = document.getElementById('am_folders');
    const msg = dialog.querySelector('.am_setup_msg');
    const say = (text, bad) => { msg.textContent = text === 'Failed to fetch' ? 'The ACRUX server isn’t answering.' : text; msg.classList.toggle('am_err', !!bad); };
    let here = '';
    const open = async (dir) => {
      try {
        const res = await api(`local/dirs?dir=${encodeURIComponent(dir)}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'ACRUX can’t open that folder.');
        here = body.dir;
        dialog.querySelector('.am_path').textContent = here;
        const row = (dir, icon, name) => `<li><button type="button" data-dir="${esc(dir)}">${ic(icon)}${esc(name)}</button></li>`;
        dialog.querySelector('.am_dirs').innerHTML = (body.parent ? row(body.parent, 'chevron-left', 'Up') : '')
          + body.dirs.map((d) => row(d.dir, 'folder-closed', d.name)).join('');
        say('');
      } catch (err) { say(err.message, true); }
    };
    dialog.querySelector('.am_dirs').addEventListener('click', (e) => { const b = e.target.closest('[data-dir]'); if (b) open(b.dataset.dir); });
    dialog.querySelector('[value=cancel]').addEventListener('click', () => dialog.close());
    dialog.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      say('Linking…');
      try {
        const res = await sendJson('local/link', 'POST', { dir: here });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'That didn’t work. Try again.');
        dialog.close();
        note = 'Linked. Reading its songs: its albums show up below as they’re found.';
        refresh();
        then?.(here);
      } catch (err) { say(err.message, true); }
    });
    dialog.showModal();
    open('');
  }

  // Plays everything a sleeve holds, album by album (its own list, so the queue follows it).
  function play(id) {
    const list = albumsOf(id).flatMap((al) => CATALOG.list(`album:${al.id}`));
    if (!list.length) return;
    const key = `source:${id}`;
    CATALOG.addList(key, list);
    setList(list, key);
    playAt(0);
  }

  // Whether a request went through; if not, the panel says why (the server's reason, else `failed`).
  async function done(request, failed) {
    const res = await request.catch(() => null);
    if (res?.ok) return true;
    const why = (await res?.json().catch(() => null))?.error;
    driveNote = `<span class="am_err">${esc(why || `That ${failed}: the ACRUX server isn’t answering.`)}</span>`;
    update();
    return false;
  }

  // ---------- mounting ----------

  // For Set up ACRUX (setup.js), which adds music the same ways.
  // busy: a drop is being added (catalog.js waits for it to finish before drawing the page again).
  window.AddMore = { openFolders, add, busy: () => !!adding };

  window.mountAddMore = (target) => {
    if (!target) return;
    el = target;
    skeleton();
    update();
    refresh();
    listen();

    const intake = el.querySelector('.am_intake');
    const pick = el.querySelector('.am_pick');
    const pickDir = el.querySelector('.am_pick_dir');
    const picked = (input) => {
      add([...input.files].map((file) => ({ file, rel: file.webkitRelativePath || file.name })));
      input.value = '';
    };
    pick.addEventListener('change', () => picked(pick));
    pickDir.addEventListener('change', () => picked(pickDir));
    intake.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      intake.classList.add('over');
    });
    intake.addEventListener('dragleave', (e) => { if (!intake.contains(e.relatedTarget)) intake.classList.remove('over'); });
    intake.addEventListener('drop', async (e) => {
      e.preventDefault();
      intake.classList.remove('over');
      if (linking()) { // a drop says what's in it, not where it is
        note = 'To play songs from where they are, pick their folder with Choose a folder.';
        return update();
      }
      const entries = [...e.dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean); // before any await
      const files = [...e.dataTransfer.files];
      add(entries.length ? (await Promise.all(entries.map((entry) => walk(entry)))).flat() : files.map((file) => ({ file, rel: file.name })));
    });

    el.querySelector('.am_drive').addEventListener('submit', (e) => {
      e.preventDefault();
      addDrive(el.querySelector('.am_link').value.trim());
    });

    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.getAttribute('aria-disabled') === 'true') return;
      const id = b.closest('[data-id]')?.dataset.id;
      const act = b.dataset.act;
      if (act === 'files') pick.click();
      else if (act === 'folder') linking() ? openFolders() : pickDir.click();
      else if (act === 'play') play(id);
      else if (act === 'setup') window.openSetup?.('keys', 1, 'private'); // Connect Google from Make a project, sign-in steps after the key
      else if (act === 'wizard') window.openSetup?.();
      else if (act === 'mode' && info) { // remembered in the settings, so the panel opens on it next time
        info.settings.keepCopy = Number(b.dataset.keep);
        note = '';
        update();
        await sendJson('settings', 'PUT', { keepCopy: info.settings.keepCopy }).catch(() => {});
      } else if (act === 'rescan') {
        scans[id] = { status: 'listing' };
        update();
        if (!(await done(api(`sources/${encodeURIComponent(id)}/scan`, { method: 'POST' }), 'couldn’t be looked through again'))) {
          delete scans[id];
          update();
        }
      } else if (act === 'remove') {
        const name = b.closest('.am_item').querySelector('.cr_nm').textContent;
        const what = id.startsWith('dir:') ? 'Its songs leave your library; the files stay where they are.'
          : 'Its songs leave your library and their downloaded copies are deleted. Your Google Drive isn’t touched.';
        if (!confirm(`Remove “${name}” from ACRUX? ${what}`)) return;
        if (!(await done(api(`sources/${encodeURIComponent(id)}`, { method: 'DELETE' }), `“${name}” couldn’t be removed`))) return;
        delete scans[id];
        driveNote = `Removed “${esc(name)}”.`;
        refresh();
        reloadLibrary();
      } else if (act === 'disconnect') {
        if (!confirm('Sign out of Google Drive? Private folders stop opening until you sign in again.')) return;
        await api('drive/disconnect', { method: 'POST' }).catch(() => {});
        refresh();
      }
    });
    el.addEventListener('change', async (e) => {
      const key = e.target.dataset.set;
      if (!key) return;
      await sendJson('settings', 'PUT', { [key]: Number(e.target.value) }).catch(() => {});
      refresh();
    });
  };
})();
