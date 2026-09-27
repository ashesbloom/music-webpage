// ACRUX Settings (library.html?view=settings): every choice ACRUX has. Most are kept on this device (localStorage, read
// where they're used with catalog.js's pref(): switches store "off" when off); your music's are the server's
// (/api/settings, the same as Add More's settings bar), and the desktop app's updates are api/update.js's.
// Opened from the side panel's ⚙ (inside ☰ on phones), and in the app with Ctrl/⌘+, or Settings… in its menu.
// (No top-level names: nav.js runs this file again for each library page.)
(() => {
  const root = document.getElementById('library');
  if (!root || new URLSearchParams(location.search).get('view') !== 'settings') return;
  document.title = 'Settings · ACRUX';
  const html = document.documentElement;
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const save = (key, value) => { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch {} };
  const call = (url, method = 'GET', body) => fetch(`${SITE}${url}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.status))));

  // ---------- rows ----------
  const row = (title, text, ctl = '', more = '') => `<div class="set_row"><div class="set_txt"><strong>${title}</strong><span>${text}</span></div>${ctl && `<div class="set_ctl">${ctl}</div>`}${more}</div>`;
  const toggle = (key, title, text, on = pref(key) !== 'off') => row(title, text, `<input type="checkbox" role="switch" class="switch" data-pref="${key}" aria-label="${esc(title)}"${on ? ' checked' : ''}>`);
  const button = (act, label, cls = '') => `<button class="set_btn${cls && ` ${cls}`}" data-act="${act}">${label}</button>`;
  // Options as [value, label] pairs, in the order given (an object would sort number keys). A value set elsewhere stays shown.
  const pairs = (options, value) => {
    const list = Array.isArray(options) ? options : Object.entries(options);
    return list.some(([v]) => String(v) === String(value)) ? list : [[value, String(value)], ...list];
  };
  const select = (name, value, options, label) => `<select data-sel="${name}" aria-label="${esc(label)}">${pairs(options, value)
    .map(([v, t]) => `<option value="${v}"${String(value) === String(v) ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  const seg = (name, value, options, label) => `<div class="set_seg" role="group" aria-label="${esc(label)}" data-seg="${name}">${pairs(options, value)
    .map(([v, t]) => `<button data-v="${v}" aria-pressed="${String(value) === String(v)}">${t}</button>`).join('')}</div>`;
  const card = (id, title, body) => `<section class="set_card" id="set_${id}" aria-labelledby="set_${id}_h"><h2 id="set_${id}_h">${title}</h2>${body}</section>`;

  // ---------- themes ----------
  // A theme is the six colours below. localStorage.theme keeps them ({ base: the preset they started from, custom: one
  // was changed }); colours.js puts them on (in each page's <head>, so it never flashes red), with the parts that follow
  // the album cover (localStorage.cover) taking its colour instead.
  const VARS = { accent: 'Accent', glow: 'Highlight', header: 'Header', player: 'Player bar', menu: 'Side panel', explore: 'Background' };
  const THEMES = THEME.PRESETS;
  const SWATCHES = ['#000000', '#0a0a0a', '#141414', '#1d1d1d', '#2b2b2b', '#4d4d4d', '#8a8a8a', '#ffffff', '#a21e1e', '#f13c3c',
    '#ff7a1a', '#f5c518', '#3cd17a', '#1e7a45', '#19b3b3', '#3c8cf1', '#1e4fa2', '#6a1ea2', '#b04cf6', '#ff4fa3'];
  const HEX = /^#[0-9a-f]{6}$/i;
  const preset = (name) => Object.fromEntries(Object.keys(VARS).map((v, i) => [v, THEMES[name][i + 1]]));
  let theme = {};
  try { theme = JSON.parse(localStorage.getItem('theme')) || {}; } catch {}
  if (!THEMES[theme.base]) theme = { base: 'acrux', ...preset('acrux') };
  const colour = (v) => (HEX.test(theme[v]) ? theme[v] : preset(theme.base)[v]).toLowerCase();
  function applyTheme() {
    save('theme', theme.base === 'acrux' && !theme.custom ? null : JSON.stringify(theme)); // ACRUX as it comes: nothing kept
    THEME.paint();
    root.querySelectorAll('.set_theme').forEach((b) => b.setAttribute('aria-pressed', !theme.custom && b.dataset.theme === theme.base));
    root.querySelectorAll('.set_color').forEach((b) => b.style.setProperty('--c', colour(b.dataset.var)));
  }
  let editing = null; // the colour whose palette is open
  function palette() {
    const box = root.querySelector('.set_palette');
    root.querySelectorAll('.set_color').forEach((b) => b.setAttribute('aria-expanded', b.dataset.var === editing));
    box.hidden = !editing;
    if (!editing) return;
    const c = colour(editing);
    box.setAttribute('aria-label', `${VARS[editing]} colour`);
    box.innerHTML = `<div class="set_swatches">${SWATCHES.map((s) => `<button data-c="${s}" style="--c:${s}" aria-label="${s}" aria-pressed="${s === c}"></button>`).join('')}</div>
      <label class="set_any"><input type="color" value="${c}" aria-label="Any colour">Any colour <input type="text" value="${c}" aria-label="Hex code" spellcheck="false" maxlength="7"></label>`;
  }
  const setColour = (c, redraw = true) => {
    if (!HEX.test(c) || !editing) return;
    theme[editing] = c.toLowerCase();
    theme.custom = true;
    applyTheme();
    if (redraw) palette();
  };

  // ---------- the page ----------
  const infinite = () => document.getElementById('infinite'); // the queue's own button (queue.js keeps it)
  const infiniteOn = () => (infinite() ? infinite().getAttribute('aria-pressed') === 'true' : pref('infinite', 'true') === 'true');
  const quality = CATALOG.quality();
  const gb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);
  root.innerHTML = `<div class="settings">
    <div class="lib_titlebar"><a class="round" href="${SITE}index.html" data-back aria-label="Back"><i class="icon icon-chevron-left" aria-hidden="true"></i></a><h1>Settings</h1></div>
    ${window.ACRUX_APP ? card('updates', 'Updates', '<div class="set_up"></div>') : ''}
    ${card('look', 'Appearance', `
      ${row('Theme', 'Colours for the whole of ACRUX, on this device.', '', `<div class="set_themes">${Object.entries(THEMES).map(([id, t]) => `<button class="set_theme" data-theme="${id}" style="--a:${t[1]};--b:${t[2]}" aria-pressed="false"><i aria-hidden="true"></i>${t[0]}</button>`).join('')}</div>`)}
      ${row('Your colours', 'Pick any colour for any part; Reset goes back to the theme.', button('reset-colours', 'Reset'),
        `<div class="set_colors">${Object.entries(VARS).map(([v, name]) => `<button class="set_color" data-var="${v}" aria-expanded="false"><i aria-hidden="true"></i>${name}</button>`).join('')}</div><div class="set_palette" role="group" hidden></div>`)}
      ${row('Colours from the album cover', 'The parts you pick take each song’s cover colour. Off: they all keep your theme’s.',
        `<input type="checkbox" role="switch" class="switch" data-act="follow" aria-label="Colours from the album cover"${THEME.follow().on ? ' checked' : ''}>`,
        `<div class="set_colors" role="group" aria-label="What follows the album cover">${Object.entries({ record: 'Record', ...VARS }).map(([v, name]) =>
          `<button class="set_part" data-part="${v}" style="--c:var(--${v === 'record' ? 'tint, var(--glow)' : v})" aria-pressed="${THEME.follow().parts.includes(v)}"${THEME.follow().on ? '' : ' disabled'}><i aria-hidden="true"></i>${name}</button>`).join('')}</div>`)}`)}
    ${card('play', 'Playback', `
      ${row('Streaming quality', `<span class="set_q">${CATALOG.tiers[quality]}</span>`, seg('quality', quality, { low: 'Low', medium: 'Medium', high: 'High' }, 'Streaming quality'))}
      ${row('Single-key shortcuts', `Space, K, J, L, M and the others. Media keys${window.ACRUX_APP ? ' and Ctrl/⌘ shortcuts' : ''} always work.`,
        `${button('keys', 'Show all shortcuts')}<input type="checkbox" role="switch" class="switch" data-pref="shortcuts" aria-label="Single-key shortcuts"${pref('shortcuts') !== 'off' ? ' checked' : ''}>`)}`)}
    ${card('queue', 'Queue', `
      ${row('Infinite Queue', 'When the list ends, songs like the last one carry on for as long as you listen.', `<input type="checkbox" role="switch" class="switch" data-act="infinite" aria-label="Infinite Queue"${infiniteOn() ? ' checked' : ''}>`)}
      ${toggle('radio', 'Online songs in Infinite', 'Your own songs by that artist or in that genre come first, then Jamendo, Audius and the Internet Archive. Off: only your music.')}
      ${toggle('queueAuto', 'Show the queue when a song starts', 'On a computer it opens 3 s into each song, and closes again 5 s into a pause.')}`)}
    <div class="set_music"></div>
    ${card('layout', 'Layout &amp; help', `
      ${row('Side panel width', 'Back to its standard width.', button('panel', 'Reset'))}
      ${row('The tour', 'The short walk through ACRUX from your first visit.', button('tour', 'Show again'))}`)}
    ${card('data', 'Privacy &amp; data', `
      ${row('Recent searches', 'The list under the search box.', button('searches', 'Clear', 'warn'))}
      ${row('Play history', 'The songs you played, above the queue.', button('history', 'Clear', 'warn'))}
      ${row('Privacy', 'What ACRUX keeps, and where.', `<a class="set_btn" href="${SITE}privacy.html">Privacy policy</a>`)}`)}
    ${card('advanced', 'Advanced', `
      ${toggle('resume', 'Resume where you left off', 'ACRUX opens on the song you were playing, paused at the same second.')}
      ${toggle('prevRestart', 'Previous restarts the song', 'Past its first 3 seconds, Previous goes back to its start; press again for the song before.')}
      ${row('Arrow keys seek by', '← and →; J and L always go 10 seconds.', select('seekStep', pref('seekStep', '5'), { 5: '5 seconds', 10: '10 seconds', 15: '15 seconds' }, 'Arrow keys seek by'))}
      ${toggle('scratch', 'Scratch the record', 'Holding and turning the record scratches the song. Off: the record only spins.')}
      ${toggle('ahead', 'Load the next songs ahead', 'The next songs start at once. Off saves data on slow or metered connections.')}
      ${toggle('learn', 'Learn from what I play', 'Your plays shape the For you rows on Discover. They stay on this computer.')}`)}
  </div>`;
  applyTheme();

  // Your music: the server's own settings, where there is a server (not on the GitHub Pages site).
  call('api/sources').then(({ cache, settings: s }) => {
    root.querySelector('.set_music').outerHTML = card('music', 'Your music', `
      ${window.openSetup ? row('Set up ACRUX', 'API keys, Google Drive and your phone.', button('setup', 'Set up…')) : ''}
      ${row('Add music', 'Songs, folders and Drive links.', `<a class="set_btn" href="${SITE}library.html#addmore">Add music…</a>`)}
      ${row('Songs you add', 'Keep a copy in ACRUX, or play them from where they are.', seg('keepCopy', s.keepCopy, [[1, 'Keep a copy'], [0, 'Play in place']], 'Songs you add'))}
      ${row('Google Drive cache', `${gb(cache?.bytes || 0)} used · the start of each Drive song, so it plays at once.`, select('cacheGB', s.cacheGB, { 1: 'Up to 1 GB', 2: 'Up to 2 GB', 5: 'Up to 5 GB', 10: 'Up to 10 GB', 20: 'Up to 20 GB', 50: 'Up to 50 GB' }, 'Drive cache size'))}
      ${row('Keep Drive songs for', 'Songs not played for this long leave the cache.', select('keepDays', s.keepDays, [[1, '1 day'], [7, '1 week'], [30, '1 month'], [90, '3 months'], [0, 'Until the cache is full']], 'Keep Drive songs for'))}
      ${row('Get Drive songs ready ahead', 'How many of the next songs in the queue start downloading early.', select('prefetch', s.prefetch, { 0: 'None', 1: '1 song', 3: '3 songs', 5: '5 songs', 10: '10 songs' }, 'Get Drive songs ready ahead'))}`);
  }).catch(() => root.querySelector('.set_music')?.remove());

  // ---------- updates (the desktop app) ----------
  let polling = 0;
  async function updates(send) {
    const box = root.querySelector('.set_up');
    if (!box) return;
    let u;
    try { u = await (send ? call(`api/app/update${send.path || ''}`, send.method || 'POST', send.body) : call('api/app/update')); } catch { return; }
    if (!box.isConnected) return;
    const v = esc(u.latest);
    const status = !u.enabled ? ['Updates come to the installed app', `This is ACRUX ${esc(u.version)}, run from its source.`]
      : { idle: ['ACRUX is up to date', `You have ${esc(u.version)}.`],
        checking: ['Checking for a new version…', `You have ${esc(u.version)}.`],
        available: [`ACRUX ${v} is out`, `You have ${esc(u.version)}.`, button('download', 'Update', 'go')],
        downloading: [`Downloading ACRUX ${v}…`, `${Math.round(u.progress * 100)}%`],
        ready: [`ACRUX ${v} is ready`, `You have ${esc(u.version)}. It’s put in when ACRUX restarts.`, button('restart', 'Restart now', 'go')],
        shell: [`ACRUX ${v} needs a new download`, 'This version changes the app itself, so it comes as a new installer.', `<a class="set_btn go" href="${esc(u.url)}" target="_blank" rel="noopener">Download</a>`],
        error: ['Couldn’t update', esc(u.error)] }[u.status] || ['', ''];
    const bar = ['downloading', 'ready'].includes(u.status) ? `<div class="set_bar" style="--p:${Math.round(u.progress * 100)}%"><i></i></div>` : '';
    const notes = u.enabled && u.notes && ['available', 'downloading', 'ready', 'shell'].includes(u.status) ? `<p class="set_notes">${esc(u.notes)}</p>` : '';
    box.innerHTML = row(status[0], status[1], status[2] || '', bar || notes ? `<div class="set_update">${bar}${notes}</div>` : '')
      + (u.enabled ? row('Download updates automatically', 'New versions download in the background; you choose when to restart.',
        `${button('check', 'Check now')}<input type="checkbox" role="switch" class="switch" data-act="auto" aria-label="Download updates automatically"${u.auto ? ' checked' : ''}>`) : '');
    clearTimeout(polling);
    if (['checking', 'downloading'].includes(u.status)) polling = setTimeout(() => updates(), 800);
    if (u.status === 'ready') html.classList.add('update_ready');
  }
  if (window.ACRUX_APP) updates();
  document.addEventListener('pageleave', () => clearTimeout(polling), { once: true });

  // ---------- what the controls do ----------
  const ACTS = {
    'reset-colours': () => { theme = { base: theme.base, ...preset(theme.base) }; applyTheme(); palette(); },
    keys: () => {
      const on = document.getElementById('keys_on');
      if (on) on.checked = pref('shortcuts') !== 'off';
      document.getElementById('keys_help')?.showModal();
    },
    setup: () => window.openSetup?.(),
    panel: () => { html.style.removeProperty('--menu-pref'); save('panelWidth', null); },
    tour: () => window.startTour?.(),
    searches: (b) => { save('searchHistory', null); document.querySelector('.history_list')?.replaceChildren(); done(b); },
    history: (b) => {
      if (!confirm('Clear the songs you played?')) return;
      save('playHistory', null);
      document.querySelector('.q_hist .q_list')?.replaceChildren();
      done(b);
    },
    check: () => updates({ path: '/check' }),
    download: () => updates({ path: '/download' }),
    restart: () => updates({ path: '/restart' }),
  };
  const done = (b) => { b.textContent = 'Cleared'; b.disabled = true; };
  // What follows the album cover changed: on with the last cover's colour now, and player.js reads this one again.
  const follow = (f) => {
    save('cover', JSON.stringify(f));
    THEME.paint();
    if (THEME.follows()) document.getElementById('playback_cover')?.dispatchEvent(new Event('load'));
  };
  root.addEventListener('click', (e) => {
    const t = e.target;
    const theme_ = t.closest('.set_theme');
    if (theme_) { theme = { base: theme_.dataset.theme, ...preset(theme_.dataset.theme) }; applyTheme(); palette(); return; }
    const part = t.closest('.set_part');
    if (part) {
      const f = THEME.follow();
      f.parts = f.parts.includes(part.dataset.part) ? f.parts.filter((p) => p !== part.dataset.part) : [...f.parts, part.dataset.part];
      part.setAttribute('aria-pressed', f.parts.includes(part.dataset.part));
      return follow(f);
    }
    const chip = t.closest('.set_color');
    if (chip) { editing = editing === chip.dataset.var ? null : chip.dataset.var; palette(); return; }
    const swatch = t.closest('.set_swatches [data-c]');
    if (swatch) return setColour(swatch.dataset.c);
    const opt = t.closest('[data-seg] [data-v]');
    if (opt) {
      const group = opt.closest('[data-seg]');
      group.querySelectorAll('[data-v]').forEach((b) => b.setAttribute('aria-pressed', b === opt));
      if (group.dataset.seg === 'quality') {
        CATALOG.setQuality(opt.dataset.v);
        root.querySelector('.set_q').textContent = CATALOG.tiers[opt.dataset.v];
      } else call('api/settings', 'PUT', { [group.dataset.seg]: Number(opt.dataset.v) }).catch(() => {});
      return;
    }
    const act = t.closest('[data-act]');
    if (act?.tagName === 'BUTTON') ACTS[act.dataset.act]?.(act);
  });
  // Typing a hex code, or dragging in the system's colour picker: the colour follows as it changes.
  root.addEventListener('input', (e) => {
    if (e.target.closest('.set_any')) setColour(e.target.value, false);
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.closest('.set_any')) return palette(); // the picker closed: the palette shows the new colour
    if (t.dataset.pref) {
      save(t.dataset.pref, t.checked ? 'on' : 'off');
    } else if (t.dataset.act === 'follow') {
      root.querySelectorAll('.set_part').forEach((b) => { b.disabled = !t.checked; });
      follow({ ...THEME.follow(), on: t.checked });
    } else if (t.dataset.act === 'infinite') {
      if (!infinite()) save('infinite', String(t.checked));
      else if (infiniteOn() !== t.checked) infinite().click();
    } else if (t.dataset.act === 'auto') {
      updates({ method: 'PUT', body: { auto: t.checked } });
    } else if (t.dataset.sel === 'seekStep') {
      save('seekStep', t.value);
    } else if (t.dataset.sel) {
      call('api/settings', 'PUT', { [t.dataset.sel]: Number(t.value) }).catch(() => {});
    }
  });
})();
