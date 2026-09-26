// ACRUX turntable: spins the record with a small motor model, and lets you grab it to scratch or seek like vinyl.
// Uses `music` (a DeckAudio, see deck-audio.js). One turn of the record is 3.7 s of the song.
(() => {
  // Calibration knobs.
  const IDLE = 30;           // deg/s while paused: one turn per 12 s
  const PLAY = 360 / 3.7;    // deg/s while playing, and the scratch gearing: turning the record at PLAY = normal speed
  const MOTOR_TAU = 0.4;     // s: how smoothly the record speeds up or slows down on Play/Pause (visual only)
  const MOTOR_ACCEL = 400;   // deg/s²: how hard the motor pulls a released record back up to speed
  const FLICK_DECEL = 250;   // deg/s²: how quickly a forward flick loses its extra speed (flick friction)
  const FOLLOW = 0.03;       // s: how closely the song chases the record while a hand is on it
  const MAX_RATE = 4;        // fastest scratch, as a multiple of normal speed
  const HOLD_MS = 200;       // touch: a still press this long grabs (a hand stopping the record)
  const SLOP_PX = 6;         // touch: moving further than this grabs at once; less, and it's a tap (the label button)

  const playback = document.querySelector('.playback');
  const platter = document.querySelector('.record');
  const disc = document.getElementById('record');
  if (!playback || !platter || !disc || typeof music === 'undefined') return;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const clampRate = (r) => Math.max(-MAX_RATE, Math.min(MAX_RATE, r));

  let angle = 0;                    // where the record is, deg; clockwise (forward) is positive
  let heard = 0;                    // where the song is, in the same degrees, while a hand is on the record
  let v = still.matches ? 0 : IDLE; // record speed, deg/s
  let held = null;                  // { id, cx, cy, rMin, a, t, v } while a hand is on the record
  let catching = false;             // let go while playing: the motor is bringing the record back to speed
  let cued = false;                 // moved by hand while paused: it stays where the hand left it until Play
  let releasedAt = 0;
  let last = performance.now();

  function stopCatching() {
    catching = false;
    music.scratchRate = null; // normal playback again (or silence, if paused)
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (held) {
      if (now - held.t > 50) held.v *= Math.exp(-dt / 0.03); // the hand stopped, so a release now isn't a flick
      // The song chases the record under the hand, closing at most the whole gap per frame (slow frames never overshoot).
      const rate = clampRate((angle - heard) * Math.min(1, dt / FOLLOW) / (PLAY * Math.max(dt, 0.001)));
      music.scratchRate = rate;
      heard += rate * PLAY * dt;
    } else {
      if (catching && music.paused) stopCatching(); // Pause mid catch-up goes quiet at once
      if (catching) {
        const step = (v < PLAY ? MOTOR_ACCEL : FLICK_DECEL) * dt;
        v = Math.abs(PLAY - v) <= step ? PLAY : v + Math.sign(PLAY - v) * step;
        music.scratchRate = clampRate(v / PLAY);
        if (v === PLAY) stopCatching(); // exactly back at speed: hand the song back to normal playback
      } else {
        if (!music.paused) cued = false;
        const target = still.matches || cued ? 0 : music.paused ? IDLE : PLAY;
        v += (target - v) * (1 - Math.exp(-dt / MOTOR_TAU));
      }
      angle += v * dt;
    }
    disc.style.rotate = angle % 360 ? `${angle % 360}deg` : ''; // at rest, no rotate at all: it renders exactly as before
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // The disc under a point: its centre, and a dead zone at the spindle where the angle is unsteady.
  function hitDisc(plate, x, y) {
    const r = plate.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return Math.hypot(x - cx, y - cy) <= r.width / 2 ? { cx, cy, rMin: r.width * 0.05 } : null;
  }

  function grab(e, hit, host) {
    held = { id: e.pointerId, host, ...hit, a: Math.atan2(e.clientY - hit.cy, e.clientX - hit.cx) * 180 / Math.PI, t: performance.now(), v: 0 };
    heard = angle;
    catching = false;
    music.scratchRate = 0; // a hand on the record stops it
    try { host.setPointerCapture(e.pointerId); } catch {} // synthetic test events have no pointer to capture
    host.classList.add('grabbing');
    hint?.remove(); // they've found it
    if (e.pointerType !== 'mouse' && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(10); // before any tap, Chrome blocks it and logs an error
  }

  function release(e) {
    if (!held || e.pointerId !== held.id) return;
    v = Math.max(-MAX_RATE * PLAY, Math.min(MAX_RATE * PLAY, held.v)); // a flick keeps its momentum
    held.host.classList.remove('grabbing');
    held = null;
    releasedAt = performance.now();
    if (music.paused) { // cued like a real record: the song and the record stay where you left them
      cued = true;
      v = 0;
      music.scratchRate = null;
    } else if (still.matches) {
      music.scratchRate = null;
    } else {
      catching = true;
    }
  }

  // A record you can turn: `plate` is the disc, `host` the element that takes the pointer (the disc and what's on it).
  // The deck's record, and on phones the rising record at the bottom too (phone.js); both drive the same song.
  function surface(host, plate) {
    host.addEventListener('pointerdown', (e) => {
      if (held || e.button !== 0 || e.target.closest('button')) return;
      const hit = hitDisc(plate, e.clientX, e.clientY);
      if (!hit) return;
      if (e.pointerType === 'mouse') {
        e.preventDefault(); // no text selection or image drag
        grab(e, hit, host);
        return;
      }
      // Touch and pen: moving grabs at once (the record is touch-action: none, so it never scrolls the page; the page
      // scrolls from anywhere off the record), so does a still hold, and a tap is left for the label's button.
      const done = () => {
        clearTimeout(timer);
        host.removeEventListener('pointermove', moved);
        host.removeEventListener('pointerup', done);
        host.removeEventListener('pointercancel', done);
      };
      const moved = (m) => {
        if (m.pointerId === e.pointerId && Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) > SLOP_PX) { done(); grab(e, hit, host); }
      };
      const timer = setTimeout(() => { done(); grab(e, hit, host); }, HOLD_MS);
      host.addEventListener('pointermove', moved);
      host.addEventListener('pointerup', done);
      host.addEventListener('pointercancel', done);
    });
    host.addEventListener('pointermove', (e) => {
      if (!held || e.pointerId !== held.id) return;
      const dx = e.clientX - held.cx, dy = e.clientY - held.cy;
      if (Math.hypot(dx, dy) < held.rMin) return; // too close to the spindle for a steady angle
      const a = Math.atan2(dy, dx) * 180 / Math.PI;
      const turn = ((a - held.a + 540) % 360) - 180; // shortest signed change since the last move
      const now = performance.now();
      const dt = Math.max((now - held.t) / 1000, 0.001);
      held.a = a;
      held.t = now;
      angle += turn;
      held.v += (turn / dt - held.v) * Math.min(1, dt / 0.04); // hand speed, smoothed over ~40 ms (for flicks)
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) host.addEventListener(type, release);
    host.addEventListener('touchmove', (e) => { if (held) e.preventDefault(); }, { passive: false }); // no scrolling mid-scratch
    plate.addEventListener('dragstart', (e) => e.preventDefault());
    host.addEventListener('contextmenu', (e) => { if (hitDisc(plate, e.clientX, e.clientY)) e.preventDefault(); }); // long-press menu
  }
  surface(playback, platter);
  const rising = document.querySelector('.pv_disc'); // hidden (no size) except on the phone's home page
  if (rising) surface(rising.parentElement, rising);

  // Once ever: the first time a song plays, a small note says the record turns. It fades by itself (CSS), or goes
  // as soon as a record is grabbed. On the phone's home page it sits above the rising record, else on the deck.
  let hint = null;
  let hinted = true;
  try { hinted = localStorage.getItem('seekHint') === '1'; } catch {}
  if (!hinted) music.addEventListener('play', function first() {
    music.removeEventListener('play', first);
    try { localStorage.setItem('seekHint', '1'); } catch {}
    const onPhoneHome = rising?.offsetWidth > 0;
    hint = Object.assign(document.createElement('p'), { className: 'seek_hint', textContent: 'Turn the record to seek' });
    (onPhoneHome ? rising.parentElement : playback).append(hint);
    hint.addEventListener('animationend', () => hint?.remove());
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (held) release({ pointerId: held.id }); // the hand can't be followed while the tab is hidden
    if (catching) stopCatching();
  });

  // Touch has no hover: a tap on the label shows its play/pause button for a few seconds.
  const ctrl = document.querySelector('.label_ctrl');
  let hideCtrl = 0;
  ctrl?.addEventListener('click', (e) => {
    if (e.target.closest('button') || matchMedia('(hover: hover)').matches) return;
    if (performance.now() - releasedAt < 400) return; // the end of a scratch, not a tap
    ctrl.classList.add('show');
    clearTimeout(hideCtrl);
    hideCtrl = setTimeout(() => ctrl.classList.remove('show'), 3000);
  });

  music.addEventListener('error', () => {
    document.getElementById('play').className = 'icon icon-play'; // nothing is playing: Play will try again
    document.getElementById('albumtext').textContent =
      location.protocol === 'file:' ? 'Start with node server.js to play' : "Couldn't load this song";
  });
})();
