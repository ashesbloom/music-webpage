# ACRUX — grab-to-scratch record + label play/pause (design)

## Context
The user wants the record to work like real vinyl:
- **Grab and scratch:** hold it with the cursor (or a finger) and pull it back, and the song goes back with the sound reversed. Push it forward and the song goes ahead.
- **Seamless:** no stuttering on the way, and audio sounds the whole time you drag.

Separately, hovering the album art on the record should fade in a clean black gradient that melts into the label's coloured glow, with a play/pause button on top.

The app will later ship as a locally hosted application, so this needs a real audio engine. `<audio>` can't play backwards and stutters when seeked repeatedly. The record's spin moves from CSS to JavaScript, as noted in the CSS `ponytail:` comment.

**Decisions made with the user**

| Topic | Decision |
|---|---|
| Feel | Real vinyl: sound follows the hand exactly. Faster is higher, backwards is reversed, holding still is silent. On release the motor pulls it back up to speed. |
| Seek range | One turn = 3.7 s of song (the record's playing speed). A flick keeps spinning with momentum, fast-forwarding or rewinding audibly until the motor settles. The seek bar stays for big jumps. |
| Touch | Press and hold ~0.2 s to grab, with a short vibration where supported. Quick swipes still scroll the page. |
| Grab while paused | You hear the scratch while moving. Release leaves the song paused at the new spot, and the record returns to its idle spin. |
| Engine | One Web Audio engine for all playback, behind the same interface the player already uses. |
| Play/Pause | Clean audio start and stop (a few ms fade). Only the record's visual spin ramps. |
| Label control | Hover the record's label: black gradient plus a play/pause button that doesn't spin. On desktop it sits in the visible part of the label. On touch, tap the label to show it. |
| file:// | Not supported. The player shows "start with node server.js" instead of failing silently. |

## Design

### 1. `javascript/deck-audio.js` — the engine (new)
`class DeckAudio extends EventTarget` is a stand-in for `new Audio()`, with the exact surface the player uses (checked by grep):
- **Properties:** `src` (setter loads the track), `play()`/`pause()`, `paused`, `ended`, `currentTime` (get/set), `duration` (NaN until decoded), `volume`, `muted`.
- **Events:** `play`, `pause`, `timeupdate` (~4 Hz while sound moves), `ended`, `error`.
- **Loading:** `fetch` → `decodeAudioData`, then the channel data is copied and transferred to the worklet. `play()` before decoding finishes is remembered, and sound starts when ready. The deck tonearm's 0.8 s lowering covers the wait on the web.
- **Preload:** `preload(url)` fetches the next song's bytes (one track cached, not decoded).
- **Graph:** `AudioWorkletNode` → `GainNode` (volume, mute and the play/pause fades) → destination. The `AudioContext` resumes on the first Play click, which counts as a user gesture.
- **Scratch hook:** `scratchRate` is `null` normally, or a signed number (1 = normal speed). While it's a number, the engine plays at that rate even when paused; `null` returns to 1 if playing, or silence if paused.
- **Position:** the worklet reports its position about every 20 ms, and `currentTime` extrapolates between reports.
- **End of track:** when the worklet reaches the end at a positive rate and nobody is holding the record, the engine sets `paused`/`ended` and fires `ended`, so the existing auto-advance works unchanged.

### 2. `javascript/deck-audio-worklet.js` — playback DSP (new)
`AudioWorkletProcessor` holds the decoded channels:
- **Per sample:** `pos += rate`. The rate is smoothed with a one-pole filter (~8 ms) so hand movement never zips or clicks, and output uses cubic Hermite interpolation.
- **Bounds:** the position is clamped to [0, end]. A seek (`{seek}` message) does a 3 ms fade out, jump, fade in, so the seek bar never clicks.
- **Testable core:** the math is a pure function `render(channels, state, out)`, exported for Node when `module` exists; the file registers the processor only when `registerProcessor` exists.

### 3. `javascript/turntable.js` — the record controller (new; replaces the CSS spin layers)
- **Motor (rAF loop):** tracks the platter angle and velocity `v` in °/s.
  - Target speed is idle 30 (paused) or 97.3 (playing), eased with τ ≈ 0.4 s.
  - The loop writes `#record.style.rotate`. Under reduced motion the targets are 0, and only your hand turns it.
- **Grab:** `pointerdown` on the record's disc area (not on buttons) grabs it.
  - Mouse and pen grab at once; touch uses a 200 ms hold timer, cancelled by moving more than 8 px (then the page scrolls).
  - After grabbing: pointer capture, a non-passive `touchmove` preventDefault, `navigator.vibrate(10)`, and a `grabbing` cursor.
  - The hand angle is `atan2` around the record centre, unwrapped (deltas within 10% of the centre are ignored). Hand velocity is smoothed over ~40 ms and falls to 0 when the pointer stops.
- **Scratch:** `music.scratchRate = clamp(v / 97.3, −4, 4)`. So 1 turn = 3.7 s by construction, and the audio stays locked to the angle.
- **Release while playing:** the platter keeps the hand's last velocity (the flick), and the motor eases it to 97.3 while `scratchRate` follows. Once within 0.5 °/s of target, `scratchRate` goes back to `null`, a seamless hand-back at rate ≈ 1. Flick friction is a named constant.
- **Release while paused:** `scratchRate = null` (silent), and the record stays exactly where the hand left it (cued) until Play; the slow idle spin resumes only after the next play/pause.
- **Calibration knobs:** constants at the top of the file (idle/play speed, τ, flick friction, hold delay, max rate).
- **Label control on touch:** tapping `.label_ctrl` toggles `.show` for 3 s.
- **Errors:** on engine `error`, `#albumtext` shows "Start with node server.js to play".
- **Drag conflicts:** `dragstart`/`contextmenu` preventDefault on the record, so neither native image drag nor the long-press menu fights the grab.

### 4. Label hover control (CSS + one line of markup per page)
- **Markup:** inside `.playback` after `.record` (static, not spinning):
  `<div class="label_ctrl"><button class="label_btn" aria-label="Play or pause" onclick="document.getElementById('master_play').click()"><i class="icon icon-play" aria-hidden="true"></i><i class="icon icon-pause" aria-hidden="true"></i></button></div>`
  This is the same wiring as `.deck_start`. The icon swaps via `body:has(#play.icon-pause)`, with no JS.
- **Geometry:** `.label_ctrl` is a circle exactly over the label.
  - Desktop: `--d` and `--cx` move from `.record` to `.playback`, so the record and the control share one formula. The circle is centred at (`--cx`, 50%) with diameter `.36 * --d`. The button sits at the midpoint of the label's visible part, `(cx − .18d + min(100cqw, cx + .18d)) / 2`.
  - Deck: the circle is centred at (`--x0 + 51.5cqh`, 50cqh) with diameter 30.9cqh.
- **Look:**
  - The gradient is `radial-gradient(in oklab, rgb(0 0 0 / .7), rgb(0 0 0 / .45) 45%, transparent 72%)`. Smooth, with no noise. Oklab interpolation plus eased stops avoid banding.
  - The button is a plain big white play/pause icon with no circle or outline (Netflix-style), about 32–56 px, with a soft drop shadow for legibility. It fades in over 200 ms on `:hover`, `:focus-visible` or `.show`.
  - The coloured glow moves to `.playback:has(.label_ctrl:hover, .label_ctrl.show) .inner img`, so the gradient and the `--tint` glow appear together.

### 5. Wiring changes
- `support.js`, `playlist2.js`:
  - `new Audio(url)` becomes `new DeckAudio(url)`.
  - Add one `music.preload(<next song url>)` in the existing `play` listener. Next song: `nector/${(index + 1) % songs.length + 1}.mp3` for Nectar, and `songs[(index + 1) % songs.length].id` for Smithereens.
- 4 pages (`index.html`, `playlist/playlist.html`, `playlist/playlist2.html`, `search_pages/smithereens.html`):
  - `deck-audio.js` goes before the player script and `turntable.js` after it.
  - Add the `.label_ctrl` markup.
- `style/insert.css`:
  - Delete the spin layers (`#record`/`.i2`/`.i3` animations, `spin*` keyframes, the ponytail note); keep the `.record::after` warp.
  - Add `cursor: grab`, `user-select: none`, `-webkit-touch-callout: none` and `-webkit-user-drag: none` on the record.
  - Add the label control styles, and update the reduced-motion rule.
- Nothing else in the player changes: seek bar, next/prev, shuffle/repeat, tint, volume.js.

## Verification
1. **Engine tests:** `node --test tests/deck-audio.test.js` (new, no dependencies), against `render()`:
   - rate 1 reproduces the input;
   - rate −1 plays it reversed;
   - rate 0.5 interpolates;
   - a rate step produces no output jump beyond the smoothing bound (sine input);
   - the position clamps at 0 and at the end.
2. **Browser end-to-end** (`node server.js` + scratchpad `cdp.mjs`, Input.dispatchMouse/TouchEvent):
   - Play: `currentTime` advances about 1 s per second.
   - Drag −90°: position drops by about 0.93 s, and the reported rate goes negative. Drag +180°: position gains about 1.85 s.
   - Hold still: rate is about 0. Release: rate returns to 1 without jumps, and a flick carries further than a plain drag.
   - Paused scratch: still paused after release, at the new position.
   - Touch: a 250 ms hold then drag grabs; a quick swipe scrolls the page instead.
   - Label: hover shows the button (opacity 1), a click toggles pause/play and the icon swaps.
   - file:// shows the server message.
   - Seek bar, next/prev and auto-advance (seek near the end) still work, with no console errors on the 4 pages.
3. `tests/record-spin.js` still passes on desktop, tablet and phone, and reduced motion stops the idle spin.
4. **By ear (the user):** scratch sound, flick feel and hand-back smoothness, tuned with the knobs in `turntable.js`.

