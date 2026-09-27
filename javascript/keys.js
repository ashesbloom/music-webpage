// ACRUX keys: the keyboard shortcuts, and the media keys every device already has (keyboard ⏯ ⏭ ⏮, a Mac's F7–F9,
// headphone and AirPods presses, the lock screen, macOS Now Playing, Windows' media flyout, Linux MPRIS), which reach a
// page only through navigator.mediaSession. Hardware volume keys never come to a page or app: they change the
// computer's volume, as they should. ? shows the shortcuts; the desktop app's Controls menu calls shortcut(name).
// Uses player.js (music, songs, index, started), volume.js (rangeSlider) and catalog.js.

// The action a key press asks for, or null. Letters by e.key (so AZERTY and Dvorak get their own letters), digits by
// e.code (AZERTY types them with Shift). Ctrl/⌘ combos are the desktop app's only: in a browser ⌘← is Back and
// Ctrl↑ is Mission Control. Held keys repeat only seeking and volume.
function keyAction(e, app) {
  if (e.altKey || !e.key) return null; // no key: Chrome's autofill sends keydown without one
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  let name;
  if (e.ctrlKey || e.metaKey) {
    name = k === '/' ? 'help' : app ? { ArrowRight: 'next', ArrowLeft: 'prev', ArrowUp: 'volup', ArrowDown: 'voldown', ',': 'settings' }[k] : null;
  } else {
    const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
    name = digit ? `pct${digit[1]}`
      : e.shiftKey ? { n: 'next', p: 'prev', ArrowUp: 'volup', ArrowDown: 'voldown', '?': 'help' }[k]
        : { ' ': 'playpause', k: 'playpause', ArrowLeft: 'back5', ArrowRight: 'fwd5', j: 'back10', l: 'fwd10', m: 'mute',
          s: 'shuffle', r: 'repeat', f: 'fav', q: 'queue', '/': 'search', '?': 'help' }[k];
  }
  if (!name || (e.repeat && !/^(back|fwd|vol)/.test(name))) return null;
  return name;
}

if (typeof document === 'undefined') module.exports = { keyAction }; // tests/keys.test.js
else (() => {
  const $ = (id) => document.getElementById(id);
  const click = (id) => () => $(id)?.click();
  const seek = (t) => { const d = music.duration; if (d > 0) music.currentTime = Math.max(0, Math.min(t, d - 1)); };
  const vol = (step) => { const bar = $('v_bar'); bar.value = +bar.value + step; rangeSlider(bar.value); };
  const off = () => pref('shortcuts') === 'off';
  const step = () => Number(pref('seekStep')) || 5; // Settings: ← → seek by 5, 10 or 15 s

  const ACTIONS = {
    playpause: click('master_play'), next: click('next'), prev: click('prev'),
    back5: () => seek(music.currentTime - step()), fwd5: () => seek(music.currentTime + step()),
    back10: () => seek(music.currentTime - 10), fwd10: () => seek(music.currentTime + 10),
    volup: () => vol(5), voldown: () => vol(-5), mute: click('mute_button'),
    shuffle: click('shuffle'), repeat: click('repeat'), queue: click('queue_btn'),
    fav: () => { // your own songs only, as the ⋯ tray's Add to Favorites
      const s = started && songs[index];
      if (s && CATALOG.find(s.id)) CATALOG.toggleMark('song', s.id, s).catch(() => {});
    },
    search: () => { // it's in the side panel, a popover on phones
      const box = $('inputbox');
      if (!box) return;
      if (!box.checkVisibility?.()) try { $('sidebar').showPopover(); } catch {}
      box.focus();
      box.select();
    },
    help: () => $('keys_help').showModal(),
    settings: () => document.querySelector('.settings_link')?.click(), // through nav.js: the music plays on
  };
  const run = (name) => {
    const pct = /^pct(\d)$/.exec(name);
    if (pct) seek((music.duration * pct[1]) / 10);
    else ACTIONS[name]?.();
  };
  window.shortcut = run;

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return; // handled already (the divider), or an IME at work
    if (t.closest?.('textarea, select, [contenteditable]:not([contenteditable=false])')) return;
    if (t.tagName === 'INPUT' && !/^(range|checkbox|radio|button|submit)$/.test(t.type)) return; // typing
    if (t.type === 'range' && e.key.startsWith('Arrow')) return; // a slider moves itself
    if (e.key === ' ' && t.matches?.(':focus-visible')) return; // Space presses what Tab reached
    if (off() && !(e.ctrlKey || e.metaKey)) return; // single keys switched off (WCAG 2.1.4)
    const name = keyAction(e, window.ACRUX_APP);
    if (!name) return;
    e.preventDefault(); // Space would scroll the page, / open Firefox's quick find
    // A button focused by a click would be pressed by the next Space (Chrome shows it focused once a key is pressed).
    if (e.key === ' ' && t.matches?.('button, a, [role=button]')) t.blur();
    run(name);
  });

  // The shortcuts, listed: in the ? sheet, and as each button's tooltip. Mod is ⌘ on a Mac, Ctrl elsewhere.
  const MAC = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform);
  const ROWS = [ // [what it does, the button it presses, its keys ("app:" only in the desktop app)]
    ['Play or pause', 'master_play', 'Space', 'K'],
    ['Next song', 'next', 'Shift+N', 'app:Mod+ArrowRight'],
    ['Previous song, or back to its start', 'prev', 'Shift+P', 'app:Mod+ArrowLeft'],
    [`Back / ahead ${step()} seconds`, null, 'ArrowLeft', 'ArrowRight'],
    ['Back / ahead 10 seconds', null, 'J', 'L'],
    ['Jump to 0–90% of the song', null, '0–9'],
    ['Volume up / down', 'v_bar', 'Shift+ArrowUp', 'Shift+ArrowDown', 'app:Mod+ArrowUp', 'app:Mod+ArrowDown'],
    ['Mute', 'mute_button', 'M'],
    ['Shuffle', 'shuffle', 'S'],
    ['Repeat', 'repeat', 'R'],
    ['Add to Favorites', null, 'F'],
    ['Queue', 'queue_btn', 'Q'],
    ['Search', null, '/'],
    ['Keyboard shortcuts', null, '?', 'Mod+/'],
    ['Settings', null, 'app:Mod+,'],
  ];
  const SHOW = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Mod: MAC ? '⌘' : 'Ctrl' };
  const keysOf = (keys) => keys.filter((k) => window.ACRUX_APP || !k.startsWith('app:')).map((k) => k.replace('app:', ''));
  const label = (k) => k.split('+').map((p) => SHOW[p] || p);
  const rows = ROWS.filter(([, , ...keys]) => keysOf(keys).length).map(([what, , ...keys]) => `<dt>${what}</dt><dd>${keysOf(keys).map((k) => label(k).map((p) => `<kbd>${p}</kbd>`).join('')).join('<span>or</span>')}</dd>`).join('');
  document.body.insertAdjacentHTML('beforeend', `
    <dialog class="keys_help" id="keys_help" aria-labelledby="keys_h" closedby="any">
      <h2 id="keys_h">Keyboard shortcuts</h2>
      <dl>${rows}</dl>
      <p>Your keyboard’s media keys, headphones and lock screen work too.</p>
      <label><input type="checkbox" id="keys_on"> Single-key shortcuts</label>
      <form method="dialog"><button>Done</button></form>
    </dialog>`);
  const on = $('keys_on');
  on.checked = !off();
  on.addEventListener('change', () => { try { localStorage.setItem('shortcuts', on.checked ? 'on' : 'off'); } catch {} });
  for (const [what, id, first] of ROWS) {
    const b = id && $(id);
    if (!b) continue;
    b.setAttribute('aria-keyshortcuts', first);
    const tip = `${what} (${label(first).join('+')})`;
    if (b.tagName === 'BUTTON') b.dataset.tip = tip; // shown by the buttons' own hover label (insert.css), not a second one
    else b.title = tip;
  }

  // Media Session: what's playing, for the OS, and its buttons back to the player. It only comes to a page playing a
  // media element, and the deck is Web Audio, so a silent <audio> plays alongside (Chrome wants one of 5 s or more).
  // No seekbackward/seekforward: iOS would show ±10 s instead of the next and previous buttons; seekto keeps the scrubber.
  // ponytail: all-zero silence; if a browser ever skips silent media, make it a near-silent sample.
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const keeper = new Audio(silentWav(10));
  keeper.loop = true;
  let posAt = 0;
  const position = () => {
    const d = music.duration;
    if (d > 0 && isFinite(d)) try { ms.setPositionState({ duration: d, position: Math.min(music.currentTime, d), playbackRate: 1 }); } catch {}
  };
  music.addEventListener('play', () => {
    keeper.play().catch(() => {});
    ms.playbackState = 'playing';
    const s = songs[index];
    if (s) {
      ms.metadata = new MediaMetadata({ title: s.title, artist: s.artist, album: CATALOG.album(s.album)?.title || s.result?.album || '',
        artwork: s.cover ? [{ src: new URL(s.cover, location.href).href }] : [] });
    }
    position();
  });
  for (const type of ['pause', 'ended']) music.addEventListener(type, () => { keeper.pause(); ms.playbackState = 'paused'; position(); });
  music.addEventListener('timeupdate', () => { if (Date.now() - posAt > 1000) { posAt = Date.now(); position(); } });
  const HANDLERS = {
    play: () => music.paused && run('playpause'),
    pause: () => !music.paused && run('playpause'),
    stop: () => !music.paused && run('playpause'),
    previoustrack: () => run('prev'),
    nexttrack: () => run('next'),
    seekto: (d) => { seek(d.seekTime); position(); },
  };
  for (const [action, fn] of Object.entries(HANDLERS)) try { ms.setActionHandler(action, fn); } catch {} // one this browser lacks

  // `seconds` of 8-bit mono silence at 8 kHz, as a WAV blob URL.
  function silentWav(seconds, rate = 8000) {
    const n = seconds * rate;
    const v = new DataView(new ArrayBuffer(44 + n));
    const text = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
    text(0, 'RIFF'); v.setUint32(4, 36 + n, true); text(8, 'WAVEfmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); text(36, 'data'); v.setUint32(40, n, true);
    new Uint8Array(v.buffer, 44).fill(128); // 8-bit PCM's silence is the middle value
    return URL.createObjectURL(new Blob([v], { type: 'audio/wav' }));
  }
})();
