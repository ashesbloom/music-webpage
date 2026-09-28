// ACRUX Set up: the 2-second intro, the setup window (where your music is, Google Drive, this computer, online), the
// Google and Jamendo key walkthrough with a live check (POST /api/keys/check), and the Done screen with the QR code that
// brings ACRUX to your phone. Then tour.js shows how the record works.
//   - Opens by itself the first time ACRUX runs on this computer (GET /api/setup: not done yet, nothing added), and from
//     My Music → Set up ACRUX (window.openSetup), without the intro.
//   - A phone opening the QR link (?pair=…) becomes one of your devices (POST /api/devices/join), then gets the tour.
// Design: https://claude.ai/artifact/E97gNKRZsqbBwUNDZxqgRh. Loaded once per page (nav.js doesn't rerun it).
(() => {
  const api = (path, init) => fetch(`${SITE}api/${path}`, init);
  const sendJson = (path, method, body) => api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const answer = async (res) => ({ ok: res.ok, ...(await res.json().catch(() => ({}))) });
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const store = (name, value) => { try { value == null ? sessionStorage.removeItem(name) : sessionStorage.setItem(name, value); } catch {} };
  const stored = (name) => { try { return sessionStorage.getItem(name); } catch { return null; } };
  const CLOUD = 'https://console.cloud.google.com';
  const HOME = 'https://ashesbloom.github.io/music-webpage/'; // ACRUX's public pages: the sign-in app's home page and privacy policy
  const STOPS = ['Music', 'Drive', 'Computer', 'Online', 'Keys', 'Tour'];
  const STOP = { music: 0, drive: 1, computer: 2, online: 3, keys: 4, jamendo: 4, done: 5 };

  // Stroke icons (the site's CSS mask icons don't have these).
  const I = {
    cloud: '<path d="M7 18.5h10.2a4.3 4.3 0 0 0 .7-8.55A6.2 6.2 0 0 0 6 9.3a4.6 4.6 0 0 0 1 9.2Z"/>',
    laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z"/>',
    disk: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 14h.01M11 14h6"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M7 7l10 10M17 7 7 17"/>',
    out: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    paste: '<rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9 5V4h6v1"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
  };
  const svg = (name, size = 20) => `<svg class="su_i" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${I[name]}</svg>`;
  const out = (href, label, cls = 'su_ghost') => `<a class="${cls}" href="${href}" target="_blank" rel="noopener">${label}${svg('out', 15)}<span class="su_sr"> (opens in a new tab)</span></a>`;

  // ---------- the intro ----------

  // 2 s: a red dot draws a circle, grooves ripple out into a record, the tonearm drops with a shock ring, then the
  // record flies onto the page's own record (or fades, where it's hidden) and the page shows through.
  function intro() {
    return new Promise((done) => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
      const real = document.querySelector('.playback .record')?.getBoundingClientRect();
      const d = Math.round(Math.min(innerWidth, innerHeight) * 0.5);
      document.body.insertAdjacentHTML('beforeend', `
        <div class="su_intro" aria-hidden="true">
          <div class="su_rec">
            <div class="su_disc"><span class="su_strobe"></span><span class="su_label">ACRUX</span></div>
            <span class="su_shock"></span><span class="su_shock su_s2"></span>
            <svg class="su_trace" viewBox="0 0 100 100"><circle cx="50" cy="50" r="49.6"/></svg>
            <span class="su_rig"><span class="su_dot"></span></span>
            <svg class="su_arm" viewBox="0 0 120 340">
              <defs><linearGradient id="su_metal"><stop offset="0" stop-color="#7d7d7d"/><stop offset=".5" stop-color="#ededed"/><stop offset="1" stop-color="#7d7d7d"/></linearGradient></defs>
              <circle cx="80" cy="40" r="34" fill="#1b1a1a" stroke="#3a3939"/><circle cx="80" cy="40" r="15" fill="url(#su_metal)"/>
              <rect x="70" y="0" width="20" height="20" rx="4" fill="url(#su_metal)"/>
              <path d="M80 40 L80 228 L46 300" fill="none" stroke="url(#su_metal)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
              <rect x="30" y="292" width="30" height="40" rx="5" fill="#a21e1e" stroke="#ededed" transform="rotate(24 45 312)"/>
            </svg>
          </div>
        </div>`);
      const el = document.body.lastElementChild;
      el.style.setProperty('--d', `${d}px`);
      const seen = real && real.width > 0 && real.bottom > 0 && real.right > 0 && real.top < innerHeight;
      if (seen) {
        el.style.setProperty('--x', `${real.left}px`);
        el.style.setProperty('--y', `${real.top}px`);
        el.style.setProperty('--s', `${real.width}px`);
      } else el.classList.add('su_away'); // no record on screen (a phone's inner pages): it just fades
      const end = () => { el.remove(); done(); };
      el.addEventListener('animationend', (e) => { if (e.animationName === 'su_fade') end(); });
      setTimeout(() => el.isConnected && end(), 2600); // in case the animation events never come
    });
  }

  // ---------- the setup window ----------

  const st = {
    picks: { drive: false, local: false, online: false },
    step: 'music',
    guide: 1,         // the Connect Google step shown
    who: 'shared',    // a Drive folder shared by link, or private (Google sign-in)
    link: '',         // a Drive link to add once a key is there
    keys: null,       // GET /api/keys
    info: null,       // GET /api/sources
    checks: {},       // kind -> { busy, results, error }
    added: '',        // what the This computer step did
    driveNote: '',
    pair: null,       // POST /api/devices/pair
    scans: {},        // source id -> latest scan event
  };
  let dialog = null;
  let onScan = null; // its listener for scan progress, while it's open
  let onDrive = null; // and for the Google sign-in finishing in the browser (the app's window stays as it is)

  const route = () => ['music', st.picks.drive && 'drive', st.picks.local && 'computer', st.picks.online && 'online',
    (st.picks.drive || st.picks.online) && 'keys', st.picks.online && 'jamendo', 'done'].filter(Boolean);
  const go = (step) => { st.step = step; draw(); };
  const move = (by) => {
    const r = route();
    const at = r.includes(st.step) ? r.indexOf(st.step) : r.length - 2; // not on the route (resumed after sign-in): just before Done
    go(r[Math.min(Math.max(at + by, 0), r.length - 1)]);
  };

  // The progress line: done stops red, this one the white knob, the rest grey.
  function line(i) {
    const lb = (n) => (n === 0 ? ' su_l"' : n === 5 ? ' su_r"' : `" style="left:${n * 20}%"`); // the ends line up with the edges
    return `<div class="su_tl" role="img" aria-label="Setup, step ${i + 1} of 6: ${STOPS[i]}">
      <span class="su_track"></span><span class="su_fill" style="width:${i * 20}%"></span>
      ${STOPS.map((name, n) => `${n === i ? '' : `<span class="su_stop${n < i ? ' on' : ''}" style="left:${n * 20}%"></span>`}
        <span class="su_lb${n === i ? ' now' : ''}${lb(n)}>${name}</span>`).join('')}
      <span class="su_knob" style="left:${i * 20}%"></span></div>`;
  }
  const head = (title, sub) => `${line(STOP[st.step])}<h2 id="su_h" tabindex="-1">${title}</h2>${sub ? `<p class="su_sub">${sub}</p>` : ''}`;
  const foot = (left, right) => `<div class="su_foot"><div>${left}</div><div class="su_row">${right}</div></div>`;
  const back = '<button type="button" class="su_quiet" data-act="back">Back</button>';
  const next = (label = 'Continue') => `<button type="button" class="su_btn" data-act="next">${label}</button>`;
  const result = (r) => `<div class="su_res ${r.ok ? 'ok' : 'bad'}"><span class="su_mark">${svg(r.ok ? 'check' : 'x', 14)}</span>
    <div><b>${esc(r.title)}</b>${r.fix ? `<p>${esc(r.fix)}</p>` : ''}${r.link ? `<div class="su_row">${out(r.link, esc(r.linkLabel))}
      <button type="button" class="su_ghost" data-act="recheck" data-kind="${r.service === 'jamendo' ? 'jamendo' : 'google'}">Check again</button></div>` : ''}</div></div>`;
  const checks = (kind) => {
    const c = st.checks[kind];
    if (!c) return '';
    return `<div class="su_checks" role="status" aria-live="polite">${c.busy ? '<p class="su_sub">Checking the key…</p>'
      : c.error ? `<p class="su_err">${esc(c.error)}</p>` : c.results.map(result).join('')}</div>`;
  };

  const opt = (k, icon, title, text) => `<button type="button" class="su_opt" data-act="pick" data-k="${k}" aria-pressed="${st.picks[k]}">
    <span class="su_ico">${svg(icon, 22)}</span><span class="su_col"><b>${title}</b><span>${text}</span></span><span class="su_tick">${svg('check', 16)}</span></button>`;

  const screens = {
    music: () => `${head('Where’s your music?', 'Pick one or more. You can add the others later from My Music.')}
      <div class="su_list">
        ${opt('drive', 'cloud', 'Google Drive', 'Albums and songs from your Drive. They stream, and the songs you play are kept on this computer.')}
        ${opt('local', 'laptop', 'This computer', 'Songs and folders you already have. Play them where they are, or keep a copy in ACRUX.')}
        ${opt('online', 'globe', 'Online', 'Free music from the Internet Archive, Audius and Jamendo, plus YouTube. Works right away.')}
      </div>
      ${foot('<button type="button" class="su_quiet" data-act="finish">Just look around</button>', next())}`,

    drive: () => {
      const s = st.info?.settings || { keepDays: 7, cacheGB: 10 };
      const sel = (key, values, name) => `<select class="su_sel" data-set="${key}">${[...new Set([...values, s[key]])].sort((a, b) => (a || Infinity) - (b || Infinity))
        .map((v) => `<option value="${v}"${v === s[key] ? ' selected' : ''}>${name(v)}</option>`).join('')}</select>`;
      const days = (v) => ({ 0: 'Until full', 1: '1 day', 7: '7 days', 14: '14 days', 30: '30 days' }[v] || `${v} days`);
      const radio = (v, title, text) => `<label class="su_radio"><input type="radio" name="su_who" value="${v}"${st.who === v ? ' checked' : ''}>
        <span class="su_col"><b>${title}</b><span>${text}</span></span></label>`;
      return `${head('Google Drive', 'Paste a link to a song, an album, or a folder of albums. Each folder becomes an album, cover and all.')}
      <div class="su_grid">
        <div class="su_stack">
          <label class="su_field">Drive link<input class="su_input" data-field="link" type="url" value="${esc(st.link)}" placeholder="drive.google.com/drive/folders/…" autocomplete="off"></label>
          <fieldset class="su_stack su_set"><legend>Who can open this folder?</legend>
            ${radio('shared', 'Anyone with the link', 'Needs a Google key. About 2 minutes.')}
            ${radio('private', 'Only me', 'Needs Google sign-in. About 5 minutes, once. Downloads stay steady even when you play a lot.')}
          </fieldset>
          <div class="su_stack su_rule"><b class="su_small">On this computer</b>
            <label class="su_pair">Keep each song for ${sel('keepDays', [1, 3, 7, 14, 30, 0], days)}</label>
            <label class="su_pair">Space for songs ${sel('cacheGB', [2, 5, 10, 20, 50, 100], (v) => `${v} GB`)}</label>
          </div>
          <p class="su_sub" role="status">${st.driveNote || (st.keys?.drive.set || st.who === 'private' ? '' : 'The link is added once your Google key is in, a few steps from now.')}</p>
        </div>
        <div class="su_panel">
          <b>How Drive music plays</b>
          <div class="su_flow"><span>${svg('cloud', 22)}<i>Stays in your Drive</i></span><span>${svg('disk', 22)}<i>A copy of what you play stays here</i></span>
            <span><span class="su_mini"></span><i>Plays while it arrives</i></span></div>
          <ul><li>A song downloads the first time you play it, and starts within a couple of seconds.</li>
            <li>The start of the next few songs in your queue is fetched ahead, so skipping is instant.</li>
            <li>Every song downloads only once.</li></ul>
          <p class="su_small su_rule">A song stays that long after you last play it. When the space is full, the songs played longest ago go first. Songs you keep offline are never removed.</p>
        </div>
      </div>
      ${foot(back, `<button type="button" class="su_quiet" data-act="next">Add a link later</button>
        ${st.who === 'private' && !st.info?.drive?.connected ? '<button type="button" class="su_btn" data-act="private">Set up Google sign-in</button>'
          : st.keys?.drive.set || st.info?.drive?.connected ? '<button type="button" class="su_btn" data-act="next" data-add="1">Add it</button>' : next()}`)}`;
    },

    computer: () => {
      const inPlace = st.info?.settings.keepCopy === 0;
      const card = (keep, title, text, a, b) => `<button type="button" class="su_choice" data-act="mode" data-keep="${keep}" aria-pressed="${inPlace === !keep}">
        <b>${title}</b><span>${text}</span><span class="su_fact">${svg('check', 15)}${a}</span><span class="su_fact dim">${b}</span></button>`;
      return `${head('Music on this computer', 'Choose how ACRUX holds your songs. Nothing leaves this computer either way, and you can change it later in My Music.')}
      <div class="su_grid">
        ${card(0, 'Play from where it is', 'ACRUX reads the folder and plays each file in place. Nothing is copied.', 'Uses no extra space', 'Move or delete a file and it leaves ACRUX too')}
        ${card(1, 'Keep a copy in ACRUX', 'ACRUX copies the songs into its own library, so they keep playing if the originals move.', 'Safe from moves and deletes', 'Uses as much space as the songs')}
      </div>
      <div class="su_row su_gap">
        <button type="button" class="su_ghost" data-act="folder">${svg('folder', 17)}Choose a folder</button>
        ${inPlace ? '' : `<button type="button" class="su_ghost" data-act="files">${svg('plus', 17)}Choose songs</button>`}
      </div>
      <p class="su_sub" role="status">${st.added || (inPlace ? 'ACRUX looks for new songs in the folder each time it starts, and when you press Refresh on it.' : 'MP3, FLAC, M4A, OGG, Opus, WAV and AIFF.')}</p>
      <input type="file" class="su_pick" multiple hidden accept="audio/*,.flac,.m4a,.opus,.oga,.aif,.aiff,.zip">
      <input type="file" class="su_pick_dir" webkitdirectory hidden>
      ${foot(back, next())}`;
    },

    online: () => {
      const k = st.keys;
      const row = (title, text, ready, act) => `<li><span class="su_col"><b>${title}</b><span>${text}</span></span>${ready
        ? `<span class="su_ready">${svg('check', 16)}Ready</span>` : `<button type="button" class="su_ghost su_sm" data-act="goto" data-step="${act}">Add key</button>`}</li>`;
      return `${head('Online music', 'Discover searches all of these at once. Three work right now; the other two need a key, now or later.')}
      <ul class="su_lines">
        ${row('Internet Archive', 'Live concerts and community uploads', true)}
        ${row('Audius', 'Independent artists, full songs', true)}
        ${row('iTunes previews', '30-second previews, only when no one has the full song', true)}
        ${row('Jamendo', 'Free, licensed music. The key is free and takes about a minute.', k?.jamendo.set, 'jamendo')}
        ${row('YouTube', 'Music videos, played as a screen on the deck. Uses your Google key, about 99 searches a day.', k?.google.set, 'keys')}
      </ul>
      ${foot(back, `<button type="button" class="su_quiet" data-act="goto" data-step="done">Skip the keys</button>${next('Set up keys')}`)}`;
    },

    keys: () => {
      const g = st.guide;
      const k = st.keys?.google;
      const signedIn = st.info?.drive?.connected;
      const steps = [
        [1, 'Make a project', 'A free space for your keys'], [2, 'Turn on YouTube and Drive', 'Two switches'],
        [3, 'Make an API key', 'One key for both'], [4, 'Paste the key', 'ACRUX checks it'],
        [5, 'Name the app', 'Its name and your email'], [6, 'Add yourself as a test user', 'Only listed accounts sign in'],
        [7, 'Stay signed in', 'Optional'], [8, 'Make a sign-in client', 'Then sign in'],
      ];
      const done = (n) => (n <= 4 ? (g <= 4 ? n < g : !!k?.set) : n < g || (n === 8 && signedIn));
      const item = ([n, t, s]) => `<li class="${done(n) ? 'done' : ''}"><button type="button" data-act="guide" data-n="${n}"${g === n ? ' aria-current="step"' : ''}>
        <span class="su_mk${done(n) ? ' done' : g === n ? ' now' : ''}">${done(n) ? svg('check', 14) : g === n ? '' : n}</span><span class="su_col"><b>${t}</b><span>${s}</span></span></button></li>`;
      const aside = `<aside class="su_aside">
        <div><h2 id="su_h" tabindex="-1">Connect Google</h2><p class="su_sub">One Google project runs both YouTube and Drive. About 3 minutes for the key, 5 more for private folders. You only do it once.</p></div>
        <ol class="su_steps">${steps.slice(0, 4).map(item).join('')}</ol>
        <p class="su_group">Only for private Drive folders</p>
        <ol class="su_steps">${steps.slice(4).map(item).join('')}</ol>
        <p class="su_lock">${svg('lock', 18)}Your keys stay on this computer. ACRUX only ever sends them to Google.</p>
      </aside>`;
      const sketch = (bar, body) => `<div class="su_sk" aria-hidden="true"><div class="su_skbar"><span></span>${bar}</div>${body}</div>
        <p class="su_small">What you’ll see in Google Cloud, simplified. Look for the red outline.</p>`;
      const copy = (label, text) => `<span>${label}</span><code>${text}</code><button type="button" class="su_ghost su_sm" data-act="copy" data-text="${text}">Copy</button>`;
      const pages = {
        1: ['Make a project', 'Open Google Cloud and sign in with your Google account. Open the project menu at the top, choose New project, name it ACRUX, and press Create.',
          sketch('console.cloud.google.com', `<div class="su_box" style="left:16px;top:52px;width:190px">Select a project ▾</div>
            <div class="su_menu" style="left:16px;top:94px"><div class="su_box su_hot">New project</div><div class="su_ln"></div><div class="su_ln short"></div></div>
            <div class="su_form"><span>Project name</span><div class="su_box">ACRUX</div><div class="su_box su_btnish">Create</div></div>`),
          [[`${CLOUD}/projectcreate`, 'Open Google Cloud']], 'I made it'],
        2: ['Turn on YouTube and Drive', 'In your new project, search the API Library for each of these two and press Enable on both: first <b>YouTube Data API v3</b>, then <b>Google Drive API</b>.',
          sketch('APIs &amp; Services / Library', `<div class="su_box" style="left:16px;top:50px;width:300px">${svg('search', 14)}Search APIs</div>
            <div class="su_menu" style="left:16px;top:98px;width:260px"><b>YouTube Data API v3</b><div class="su_ln"></div><div class="su_box su_hot">Enable</div></div>
            <div class="su_menu" style="left:296px;top:98px;width:260px"><b>Google Drive API</b><div class="su_ln"></div><div class="su_box su_hot">Enable</div></div>`),
          [[`${CLOUD}/apis/library`, 'Open the API Library']], 'Both are on'],
        3: ['Make an API key', 'Open Credentials, press Create credentials, then API key. Copy the key Google shows you. If Google offers to restrict it, allow both YouTube Data API v3 and Google Drive API.',
          sketch('APIs &amp; Services / Credentials', `<div class="su_box" style="left:16px;top:50px">${svg('plus', 14)}Create credentials</div>
            <div class="su_menu" style="left:16px;top:92px"><div class="su_box su_hot">API key</div><div class="su_box su_off">OAuth client ID</div><div class="su_box su_off">Service account</div></div>`),
          [[`${CLOUD}/apis/credentials`, 'Open Credentials']], 'I copied it'],
        5: ['Name the app', 'Google asks each app that signs in for a name and a contact. Open Google Auth and press Get started: app name ACRUX, your email as the support email, audience External, your email again as the contact. Then Create.',
          sketch('Google Auth Platform / Overview', `<div class="su_form" style="left:16px;right:auto;width:260px;top:50px"><span>App name</span><div class="su_box">ACRUX</div><span>User support email</span><div class="su_box">you@gmail.com</div></div>
            <div class="su_menu" style="left:310px;top:50px"><b>Audience</b><div class="su_box su_off">Internal</div><div class="su_box su_hot">External</div></div>`),
          [[`${CLOUD}/auth/overview`, 'Open Google Auth']], 'Done'],
        6: ['Add yourself as a test user', 'Until the app is published, Google lets only the accounts on its Test users list sign in, and turns everyone else away with “Access blocked”. Open Audience, press Add users under Test users, add the Google account you’ll sign in with (and anyone else who will), then Save.',
          sketch('Google Auth Platform / Audience', `<div class="su_form" style="left:16px;right:auto;width:320px;top:50px"><b style="color:#fff">Test users</b><div class="su_box su_hot" style="align-self:flex-start">${svg('plus', 14)}Add users</div><div class="su_box">you@gmail.com</div></div>`),
          [[`${CLOUD}/auth/audience`, 'Open Audience']], 'I added myself'],
      };
      let main;
      if (pages[g]) {
        const [title, text, pic, links, next] = pages[g];
        main = `<div class="su_kicker">${g <= 4 ? `Step ${g} of 4` : `Private folders, step ${g - 4} of 4`}</div><h3>${title}</h3><p>${text}</p>${pic}
          ${foot(g === 1 ? back : `<button type="button" class="su_quiet" data-act="guide" data-n="${g === 5 ? 4 : g - 1}">Back</button>`,
            `${links.map(([href, label]) => out(href, label)).join('')}<button type="button" class="su_btn" data-act="guide" data-n="${g + 1}">${next}</button>`)}`;
      } else if (g === 4) {
        main = `<div class="su_kicker">Step 4 of 4</div><h3>Paste the key</h3>
          <p>${k?.from === 'env' ? `The key from your .env file is in use (it ends in ${esc(k.end)}). It always wins over one pasted here.` : 'Paste the key you copied. It stays on this computer.'}</p>
          <label class="su_field">Google API key<span class="su_row"><input class="su_input su_mono" data-field="google" type="text" autocomplete="off" spellcheck="false"
            placeholder="${k?.set ? `Saved: ends in ${esc(k.end)}` : 'Starts with AIza'}"><button type="button" class="su_ghost" data-act="paste" data-for="google">${svg('paste', 16)}Paste</button></span></label>
          <div class="su_row"><button type="button" class="su_ghost" data-act="check" data-kind="google">Check the key</button></div>
          ${checks('google')}
          ${foot('<button type="button" class="su_quiet" data-act="guide" data-n="3">Back</button>',
            st.who === 'private' ? `<button type="button" class="su_quiet" data-act="next">${k?.set ? 'Skip private folders' : 'Skip for now'}</button><button type="button" class="su_btn" data-act="guide" data-n="5">Next: private folders</button>`
              : next(k?.set ? 'Continue' : 'Skip for now'))}`;
      } else if (g === 7) {
        main = `<div class="su_kicker">Private folders, step 3 of 4 (optional)</div><h3>Stay signed in</h3>
          <p>While the app is in Testing, Google signs ACRUX out every 7 days. Publishing it stops that. Google keeps <b>Publish app</b> greyed out
            until the Branding page has a home page, a privacy policy and their domain, so fill these in on Branding and press Save:</p>
          <div class="su_copy">${copy('Application home page', HOME)}${copy('Privacy policy link', `${HOME}privacy.html`)}${copy('Authorized domain', new URL(HOME).host)}</div>
          <p>Then open Audience, press <b>Publish app</b> and Confirm. Still grey? Hold the pointer over it: Google says what’s missing.
            You can also skip this and sign in again once a week.</p>
          ${foot('<button type="button" class="su_quiet" data-act="guide" data-n="6">Back</button>',
            `${out(`${CLOUD}/auth/branding`, 'Open Branding')}${out(`${CLOUD}/auth/audience`, 'Open Audience')}<button type="button" class="su_btn" data-act="guide" data-n="8">Next</button>`)}`;
      } else {
        main = `<div class="su_kicker">Private folders, step 4 of 4</div><h3>Make a sign-in client</h3>
          ${signedIn ? `<div class="su_res ok"><span class="su_mark">${svg('check', 14)}</span><div><b>Signed in to Google Drive.</b><p>Private folders open now, and downloads stay steady.</p></div></div>`
            : `<p>Open Clients, press Create client, choose <b>Desktop app</b>, name it ACRUX, and press Create. Copy the Client ID and secret into these boxes.</p>
          <div class="su_grid"><label class="su_field">Client ID<input class="su_input su_mono" data-field="clientId" type="text" autocomplete="off" spellcheck="false" placeholder="…apps.googleusercontent.com"></label>
            <label class="su_field">Client secret<input class="su_input su_mono" data-field="clientSecret" type="text" autocomplete="off" spellcheck="false" placeholder="GOCSPX-…"></label></div>
          <p class="su_tip">${svg('lock', 18)}<span>Next, Google says <b>“Google hasn’t verified this app”</b>. That’s expected for your own copy: press Advanced, then Go to ACRUX, and allow read-only access to your Drive.</span></p>
          ${st.clientError ? `<p class="su_err" role="status">${esc(st.clientError)}</p>` : ''}`}
          ${foot('<button type="button" class="su_quiet" data-act="guide" data-n="7">Back</button>', signedIn ? next()
            : `${out(`${CLOUD}/auth/clients`, 'Open Clients')}<button type="button" class="su_btn" data-act="client">Save and sign in</button>`)}`;
      }
      return `<div class="su_guide">${aside}<div class="su_main">${line(4)}${main}</div></div>`;
    },

    jamendo: () => {
      const k = st.keys?.jamendo;
      return `${head('Jamendo key', 'Jamendo has free, licensed songs from independent artists. The key is free and takes about a minute.')}
      <ol class="su_num">
        <li><span>Sign up on Jamendo’s developer site.</span>${out('https://devportal.jamendo.com', 'Open Jamendo')}</li>
        <li><span>Make an app. Any name works, for example ACRUX.</span></li>
        <li><span>Copy its Client ID and paste it below.</span></li>
      </ol>
      <label class="su_field">Jamendo Client ID<span class="su_row"><input class="su_input su_mono" data-field="jamendo" type="text" autocomplete="off" spellcheck="false"
        placeholder="${k?.set ? `Saved: ends in ${esc(k.end)}` : '8 letters and numbers'}"><button type="button" class="su_ghost" data-act="check" data-kind="jamendo">Check</button></span></label>
      ${checks('jamendo')}
      ${foot(back, `<button type="button" class="su_quiet" data-act="next">Skip</button>${next(k?.set ? 'Continue' : 'Later')}`)}`;
    },

    done: () => {
      const sources = (st.info?.sources || []).filter((s) => s.kind !== 'local');
      const state = (s) => {
        const e = st.scans[s.id];
        if (e?.status === 'reading') return `Reading ${Number(e.read).toLocaleString()} of ${Number(e.total).toLocaleString()} songs`;
        if (e?.status === 'listing') return `Looking through it: ${Number(e.found || 0).toLocaleString()} songs so far`;
        if (s.status === 'error' || e?.status === 'error') return 'Couldn’t be read. Open My Music to see why.';
        return s.kind === 'linked' ? 'Played from where it is' : 'Ready';
      };
      const ready = 3 + !!st.keys?.jamendo.set + !!st.keys?.google.set;
      const rows = [
        ...sources.map((s) => `<li><span class="su_ico">${svg(s.kind === 'linked' ? 'folder' : 'cloud', 20)}</span><span class="su_col"><b>${esc(s.title)}</b><span>${esc(state(s))}</span></span></li>`),
        st.added && !sources.some((s) => s.kind === 'linked') ? `<li><span class="su_ico">${svg('laptop', 20)}</span><span class="su_col"><b>This computer</b><span>${esc(st.added)}</span></span></li>` : '',
        st.picks.online ? `<li><span class="su_ico">${svg('globe', 20)}</span><span class="su_col"><b>Online</b><span>${ready} of 5 sources ready</span></span></li>` : '',
      ].join('');
      const qr = st.pair?.qr ? `<div class="su_qr">${st.pair.qr}</div><p>Scan it with your phone’s camera. It opens ACRUX and plays your library from this computer.</p>
          <p class="su_small">Or open <b>${esc(st.pair.url.replace(/\?.*/, ''))}</b> after scanning once. The code works for ${st.pair.minutes} minutes, once.
          Your phone and this computer need to be on the same Wi-Fi.</p>`
        : `<p class="su_small">${esc(st.pair?.error || 'Making a code…')}</p>`;
      return `${head('You’re set', 'You can start listening now. Albums show up as ACRUX finds them.')}
      <div class="su_grid su_done">
        <div>${st.driveNote ? `<p class="su_sub" role="status">${st.driveNote}</p>` : ''}<ul class="su_lines">${rows || '<li><span class="su_col"><span>Add music any time from My Music.</span></span></li>'}</ul></div>
        <aside class="su_panel"><b>Bring ACRUX to your phone</b>${qr}</aside>
      </div>
      ${foot(back, '<button type="button" class="su_quiet" data-act="finish">Start listening</button><button type="button" class="su_btn" data-act="tour">Show me the record</button>')}`;
    },
  };

  const WIDE = { drive: 'su_wide', computer: 'su_wide', done: 'su_wide', keys: 'su_guideW' };
  function draw() {
    if (!dialog) return;
    dialog.className = `su ${WIDE[st.step] || ''}`;
    dialog.querySelector('.su_in').innerHTML = `<button type="button" class="su_x" data-act="finish" aria-label="Close setup">${svg('close', 18)}</button>${screens[st.step]()}`;
    dialog.querySelector('#su_h')?.focus({ preventScroll: true });
    if (st.step === 'done') ready();
  }

  // ---------- what the buttons do ----------

  async function loadKeys() { st.keys = await api('keys').then((r) => r.json()).catch(() => null); }
  async function loadSources() { st.info = await api('sources').then((r) => r.json()).catch(() => null); }

  async function check(kind) {
    const input = dialog.querySelector(`[data-field="${kind}"]`);
    const key = input?.value.trim();
    st.checks[kind] = { busy: true };
    draw();
    const res = await sendJson('keys/check', 'POST', key ? { kind, key } : { kind }).then(answer).catch(() => ({ ok: false, error: 'The ACRUX server isn’t answering.' }));
    st.checks[kind] = res.ok ? { results: res.results } : { error: res.error || 'That didn’t work. Try again.' };
    // A key that works for anything is kept (a Google key that only YouTube can use still helps; Drive can be fixed later).
    if (key && res.ok && res.results.some((r) => r.ok)) {
      await sendJson('keys', 'PUT', { [kind]: key }).catch(() => {});
      await loadKeys();
    }
    draw();
  }

  async function addLink() {
    if (!st.link) return;
    st.driveNote = 'Opening the link…';
    draw();
    const res = await sendJson('sources', 'POST', { url: st.link }).then(answer).catch(() => ({ ok: false, error: 'The ACRUX server isn’t answering.' }));
    st.driveNote = res.ok ? 'Added. Its albums show up in My Music as they’re found.' : esc(res.error || 'That didn’t work.');
    if (res.ok) st.link = '';
    await loadSources();
    draw();
  }

  // The Done screen: the phone QR, live scan progress, and the Drive link waiting for a key.
  async function ready() {
    if (!st.pair) {
      st.pair = {};
      const res = await sendJson('devices/pair', 'POST', {}).then(answer).catch(() => ({ ok: false, error: 'The ACRUX server isn’t answering.' }));
      st.pair = res.ok ? res : { error: res.error };
      if (st.link && (st.keys?.drive.set || st.info?.drive?.connected)) return addLink();
      draw();
    }
    if (!onScan && CATALOG.events) { // folders being read, on the catalog's live connection
      onScan = async (e) => {
        const scan = JSON.parse(e.data);
        st.scans[scan.source] = scan;
        if (scan.status === 'ready' || scan.status === 'error') await loadSources();
        if (st.step === 'done') draw();
      };
      CATALOG.events.addEventListener('scan', onScan);
    }
  }

  async function finish(tour) {
    dialog?.close();
    dialog?.remove();
    dialog = null;
    CATALOG.events?.removeEventListener('scan', onScan);
    onScan = null;
    CATALOG.events?.removeEventListener('drive', onDrive);
    onDrive = null;
    store('setupResume', null);
    await sendJson('setup', 'PUT', { done: true }).catch(() => {});
    CATALOG.reload().then(() => window.navReload?.()).catch(() => {});
    if (tour) window.startTour?.();
  }

  async function onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'pick') { st.picks[b.dataset.k] = !st.picks[b.dataset.k]; b.setAttribute('aria-pressed', st.picks[b.dataset.k]); }
    else if (act === 'back') move(-1);
    else if (act === 'goto') go(b.dataset.step);
    else if (act === 'guide') { st.guide = Number(b.dataset.n); draw(); }
    else if (act === 'finish') finish(false);
    else if (act === 'tour') finish(true);
    else if (act === 'check' || act === 'recheck') check(b.dataset.kind);
    else if (act === 'paste') {
      const input = dialog.querySelector(`[data-field="${b.dataset.for}"]`);
      try { input.value = (await navigator.clipboard.readText()).trim(); } catch { input.focus(); } // no clipboard access: paste by hand
    } else if (act === 'private') {
      st.link = dialog.querySelector('[data-field="link"]').value.trim() || st.link;
      st.guide = 1; // Connect Google always starts at Make a project
      go('keys');
    } else if (act === 'copy') {
      navigator.clipboard?.writeText(b.dataset.text).then(() => { b.textContent = 'Copied'; }, () => {});
    } else if (act === 'client') {
      const field = (name) => dialog.querySelector(`[data-field="${name}"]`).value.trim();
      const res = await sendJson('drive/client', 'PUT', { id: field('clientId'), secret: field('clientSecret') }).then(answer).catch(() => ({ ok: false, error: 'The ACRUX server isn’t answering.' }));
      if (!res.ok) { st.clientError = res.error || 'That didn’t work. Check both boxes.'; return draw(); }
      store('setupResume', 'keys:8'); // Google's sign-in leaves the page; setup picks up here when it comes back
      store('setupPicks', JSON.stringify({ picks: st.picks, who: st.who })); // and what you chose, so it carries on from here
      if (st.link) store('setupLink', st.link);
      location.href = `${SITE}api/drive/connect`;
    } else if (act === 'mode') {
      const keepCopy = Number(b.dataset.keep);
      await sendJson('settings', 'PUT', { keepCopy }).catch(() => {});
      if (st.info) st.info.settings.keepCopy = keepCopy;
      st.added = '';
      draw();
    } else if (act === 'folder') {
      if (st.info?.settings.keepCopy === 0) {
        window.AddMore?.openFolders(async (dir) => { st.added = `Linked ${dir}. Its songs show up in My Music as they’re read.`; await loadSources(); draw(); });
      } else dialog.querySelector('.su_pick_dir').click();
    } else if (act === 'files') dialog.querySelector('.su_pick').click();
    else if (act === 'next') {
      if (st.step === 'music' && !Object.values(st.picks).some(Boolean)) return finish(false);
      if (st.step === 'drive') {
        st.link = dialog.querySelector('[data-field="link"]').value.trim() || st.link;
        if (b.dataset.add) await addLink();
      }
      move(1);
    }
  }

  function onChange(e) {
    const t = e.target;
    if (t.name === 'su_who') { st.who = t.value; st.link = dialog.querySelector('[data-field="link"]').value.trim(); draw(); }
    else if (t.dataset.set) {
      if (st.info) st.info.settings[t.dataset.set] = Number(t.value);
      sendJson('settings', 'PUT', { [t.dataset.set]: Number(t.value) }).catch(() => {});
    } else if (t.classList.contains('su_pick') || t.classList.contains('su_pick_dir')) {
      const files = [...t.files].map((file) => ({ file, rel: file.webkitRelativePath || file.name }));
      t.value = '';
      if (!files.length) return;
      window.AddMore?.add(files);
      st.added = `Adding ${files.length} file${files.length === 1 ? '' : 's'}. They show up in My Music as they come in.`;
      draw();
    }
  }

  // who: 'private' when it's opened for private Drive folders (the sign-in steps follow the key's).
  async function open(step = 'music', guide, who) {
    if (dialog) return;
    await Promise.all([loadKeys(), loadSources()]);
    st.step = step;
    st.guide = guide || 1; // always from Make a project: the list ticks off what's done already
    st.link = stored('setupLink') || st.link;
    store('setupLink', null);
    try { Object.assign(st, JSON.parse(stored('setupPicks')) || {}); } catch {} // back from Google's sign-in
    store('setupPicks', null);
    if (who) st.who = who;
    document.body.insertAdjacentHTML('beforeend', '<dialog class="su" aria-labelledby="su_h"><div class="su_in"></div></dialog>');
    dialog = document.body.lastElementChild;
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('change', onChange);
    dialog.addEventListener('cancel', (e) => e.preventDefault()); // Esc doesn't lose your place: Close (×) does
    dialog.showModal();
    fit();
    draw();
    onDrive = async () => { await loadSources(); if (dialog) draw(); };
    CATALOG.events?.addEventListener('drive', onDrive);
  }
  window.openSetup = (step, guide, who) => open(step, guide, who);

  // Big screens get a bigger window, in proportion (the design is drawn at 1440 × 900); phones get the sheet.
  function fit() {
    if (!dialog) return;
    const z = innerWidth < 700 ? 1 : Math.min(Math.max(Math.min(innerWidth / 1440, innerHeight / 860), 1), 1.5);
    dialog.style.zoom = z;
    dialog.style.setProperty('--room-w', `${(innerWidth - 32) / z}px`); // zoom scales these back to the window's size
    dialog.style.setProperty('--room-h', `${(innerHeight - 32) / z}px`);
  }
  addEventListener('resize', fit);

  // ---------- starting ----------

  function toast(text) {
    document.body.insertAdjacentHTML('beforeend', `<p class="su_toast" role="status">${esc(text)}</p>`);
    const el = document.body.lastElementChild;
    setTimeout(() => el.remove(), 6000);
  }

  async function start() {
    const params = new URLSearchParams(location.search);
    const pair = params.get('pair');
    if (pair) { // a phone opening the QR link
      const res = await sendJson('devices/join', 'POST', { token: pair }).then(answer).catch(() => ({ ok: false, error: 'ACRUX on your computer isn’t answering.' }));
      if (res.ok && res.device) {
        store('tourNext', '1');
        return location.replace(location.pathname); // again, as a device: the whole library loads
      }
      if (!res.owner) toast(res.error || 'That didn’t work.');
      history.replaceState(null, '', location.pathname);
    }
    if (stored('tourNext')) { store('tourNext', null); toast('This phone is connected to ACRUX on your computer.'); return window.startTour?.(); }
    const resume = stored('setupResume');
    if (resume) { const [step, guide] = resume.split(':'); return open(step, Number(guide) || undefined); }
    const s = await api('setup').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!s?.owner || s.done || s.sources) return;
    await intro();
    open('music');
  }
  start();
})();
