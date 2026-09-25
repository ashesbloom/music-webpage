# Record Scratch + Label Play/Pause Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user grab the ACRUX record and scratch or seek the song like real vinyl (reverse sound included). Add a hover play/pause control on the record's label.

**Architecture:** All playback moves to one Web Audio engine.
- `DeckAudio` (`javascript/deck-audio.js`) mimics the small part of `HTMLAudioElement` the player already uses, so the two player files barely change.
- An AudioWorklet (`javascript/deck-audio-worklet.js`) plays the decoded track at any signed, smoothed rate.
- `javascript/turntable.js` replaces the CSS spin layers with a small motor model driven by `requestAnimationFrame`. It turns pointer drags on the record into playback rates.

**Tech Stack:** Vanilla JS (classic scripts, plus one AudioWorklet module), Web Audio API, CSS. Tests use Node's built-in `node:test` and a headless Chrome CDP driver. No dependencies, no build.

**Spec:** `docs/superpowers/specs/2026-09-25-record-scratch-design.md`

## Global Constraints

- **No new tooling:** no dependencies, frameworks, build steps or npm packages. Plain `<script>` tags only; the worklet file is the only one loaded another way (`audioWorklet.addModule`).
- **Served, not opened:** the site must be served over http (`node server.js`, GitHub Pages, the future app). A page opened from `file://` shows "Start with node server.js to play".
- **Speeds and gearing:** idle 30°/s (one turn per 12 s), playing 360/3.7 °/s (one turn per 3.7 s). One turn of the record = 3.7 s of song.
- **Scratch:** "real vinyl". The sound follows the hand, backwards is reversed, holding still is silent, and the scratch rate is clamped to ±4× normal.
- **Touch:** press and hold 200 ms to grab; moving more than 8 px first means scroll.
- **Grab while paused:** release leaves the song paused at the new spot.
- **Play/Pause audio:** clean start and stop (a few ms gain fade). No pitch ramp.
- **Phone deck:** its look is unchanged. With reduced motion, the idle phone deck must stay pixel-identical to the baseline screenshots in the scratchpad (`new/before_*.png`).
- **No commits:** don't commit unless the user asks (repo convention on this branch). Tasks end with a checkpoint instead.
- **Tuning values:** named constants at the top of `turntable.js` and `deck-audio-worklet.js`.

Scratchpad (tools, screenshots): `SP=/private/tmp/claude-501/-Users-mayankpandeydk123gmail-com-Git-services-music-webpage/c49622a6-e571-4424-9b97-b7ca8a3757a1/scratchpad`. The CDP driver is `$SP/cdp.mjs`; run it as `cd $SP && node cdp.mjs jobs.json`. Each job is `{url, w, h, mobile?, reducedMotion?, settle?, steps:[{eval}|{wait}|{shot}|{tab}]}`. Start the site with `node server.js &` (port 3000) from the repo root, and stop it with `lsof -ti:3000 | xargs kill`.

## Review Focus

1. **Switching songs quickly while one is still loading** (Next pressed twice, or a card clicked mid-load): the newest song plays and a stale decode never replaces it. Pinned in Task 2, "rapid src" check.
2. **Pressing Pause while the record is still catching up after a flick:** silence immediately, not seconds of fast audio. Pinned in Task 3, `tests/record-scratch.js` step 5.
3. **Losing the pointer or hiding the tab mid-scratch or mid-catch-up:** no record stuck under a phantom hand, no song left at an odd speed. Pinned in Task 3, `tests/record-scratch.js` steps 7–8.
4. **Scratching or flicking past the end of a song while playing:** clamps cleanly, fires `ended` once, and the player moves to the next song. Pinned in Task 3, `tests/record-scratch.js` step 9.
5. **Touching the record to scroll on a phone:** quick swipes scroll the page, long presses grab, and there's no image callout or text selection. Pinned in Task 3, CDP touch checks.

---

### Task 1: Playback DSP core (worklet)

**Files:**
- Create: `javascript/deck-audio-worklet.js`
- Test: `tests/deck-audio.test.js`

**Interfaces:**
- Produces: `makeState(sampleRate) → {pos, rate, target, k, gain, fadeStep, seekTo, track}` and `render(channels: Float32Array[], state, out: Float32Array[])`, exported via `module.exports` in Node.
- The AudioWorklet processor is named `'deck-audio'`.
- Messages in: `{channels, track}`, `{target, snap?}`, `{seek}` (frames). Messages out, every 8 blocks: `{pos, rate, track}`.

- [ ] **Step 1: Write the failing test** — create `tests/deck-audio.test.js`:

```js
// DSP checks for the deck worklet: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { render, makeState } = require('../javascript/deck-audio-worklet.js');

const SR = 48000;
const ramp = (n) => Float32Array.from({ length: n }, (_, i) => i / n); // rising line, so direction shows
const run = (channels, s, frames) => {
  const out = [new Float32Array(frames), new Float32Array(frames)];
  render(channels, s, out);
  return out;
};
const moving = (rate, pos = 0) => Object.assign(makeState(SR), { rate, target: rate, pos });

test('rate 1 plays the samples as they are, mono to both speakers', () => {
  const ch = ramp(1000), s = moving(1);
  const [l, r] = run([ch], s, 500);
  for (let i = 0; i < 500; i++) assert.ok(Math.abs(l[i] - ch[i]) < 1e-6, `sample ${i}`);
  assert.deepEqual(l, r);
  assert.equal(s.pos, 500);
});

test('rate -1 plays backwards', () => {
  const ch = ramp(1000), s = moving(-1, 800);
  const [l] = run([ch], s, 300);
  for (let i = 0; i < 300; i++) assert.ok(Math.abs(l[i] - ch[800 - i]) < 1e-6, `sample ${i}`);
  assert.equal(s.pos, 500);
});

test('rate 0.5 interpolates between samples', () => {
  const ch = ramp(1000), s = moving(0.5, 10);
  const [l] = run([ch], s, 4);
  assert.ok(Math.abs(l[1] - (ch[10] + ch[11]) / 2) < 1e-6); // Catmull-Rom is exact on a straight line
});

test('a sudden rate change glides instead of stepping, with no clicks', () => {
  const sine = Float32Array.from({ length: SR }, (_, i) => Math.sin(2 * Math.PI * 440 * i / SR));
  const s = moving(1, 1000);
  run([sine], s, 128);
  s.target = -3; // yank the record back hard
  run([sine], s, 48); // 1 ms later it is still near its old speed
  assert.ok(s.rate > 0, `rate after 1 ms: ${s.rate}`);
  const [l] = run([sine], s, 2000); // ~40 ms later it has arrived
  assert.ok(s.rate < -2.9, `rate after 40 ms: ${s.rate}`);
  let step = 0;
  for (let i = 1; i < l.length; i++) step = Math.max(step, Math.abs(l[i] - l[i - 1]));
  assert.ok(step < 0.2, `largest sample-to-sample jump ${step}`); // 440 Hz at 3x moves < 0.18 per sample
});

test('the playhead stays inside the track', () => {
  const ch = ramp(100), s = moving(-2, 5);
  run([ch], s, 50);
  assert.equal(s.pos, 0);
  Object.assign(s, { rate: 3, target: 3 });
  run([ch], s, 200);
  assert.equal(s.pos, 99);
});

test('a seek fades out, jumps, then fades back in', () => {
  const ch = new Float32Array(10000).fill(0.5), s = moving(1);
  s.seekTo = 5000;
  const fade = Math.ceil(1 / s.fadeStep); // frames in one 3 ms fade
  const [l] = run([ch], s, 3 * fade);
  assert.ok(l[0] < 0.5 && l[fade - 2] < 0.02, 'fades out before jumping');
  assert.ok(Math.abs(l[3 * fade - 1] - 0.5) < 1e-6, 'back to full level');
  assert.ok(s.pos > 5000 && s.pos < 5000 + 3 * fade, `jumped to ${s.pos}`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/`
Expected: FAIL with `Cannot find module '../javascript/deck-audio-worklet.js'`.

- [ ] **Step 3: Write the implementation** — create `javascript/deck-audio-worklet.js`:

```js
// ACRUX deck: plays the decoded track at any signed rate, so the record can be scratched backwards and forwards.
// Loaded by DeckAudio (deck-audio.js) as an AudioWorklet; render() is the pure DSP core (tests/deck-audio.test.js).

const SMOOTH_MS = 8; // rate changes glide over ~8 ms, so hand movement never zips or clicks
const FADE_MS = 3;   // a seek fades out, jumps and fades back in, 3 ms each way

function makeState(sampleRate) {
  return {
    pos: 0,       // playhead, in frames (fractional)
    rate: 0,      // current rate: 1 = normal, negative = backwards
    target: 0,    // rate being glided to
    k: 1 - Math.exp(-1 / (sampleRate * SMOOTH_MS / 1000)),
    gain: 1,      // seek fade level
    fadeStep: 1 / (sampleRate * FADE_MS / 1000),
    seekTo: null, // frame to jump to once faded out
    track: 0,     // which load this audio belongs to (echoed back to DeckAudio)
  };
}

// Fills every channel of `out` from `channels` at the playhead, then advances it by the (smoothed) rate.
function render(channels, s, out) {
  const last = channels[0].length - 1;
  for (let i = 0; i < out[0].length; i++) {
    if (s.seekTo !== null) {
      s.gain = Math.max(0, s.gain - s.fadeStep);
      if (s.gain === 0) { s.pos = s.seekTo; s.seekTo = null; }
    } else if (s.gain < 1) {
      s.gain = Math.min(1, s.gain + s.fadeStep);
    }
    const i1 = Math.floor(s.pos), t = s.pos - i1;
    const i0 = Math.max(i1 - 1, 0), i2 = Math.min(i1 + 1, last), i3 = Math.min(i1 + 2, last);
    for (let c = 0; c < out.length; c++) {
      const ch = channels[Math.min(c, channels.length - 1)]; // a mono track feeds both speakers
      const y0 = ch[i0], y1 = ch[i1], y2 = ch[i2], y3 = ch[i3];
      // Catmull-Rom interpolation between y1 and y2
      out[c][i] = s.gain * (y1 + 0.5 * t * (y2 - y0 + t * (2 * y0 - 5 * y1 + 4 * y2 - y3 + t * (3 * (y1 - y2) + y3 - y0))));
    }
    s.rate += (s.target - s.rate) * s.k;
    s.pos = Math.min(Math.max(s.pos + s.rate, 0), last);
  }
}

if (typeof registerProcessor === 'function') {
  registerProcessor('deck-audio', class extends AudioWorkletProcessor {
    constructor() {
      super();
      this.channels = null;
      this.s = makeState(sampleRate);
      this.blocks = 0;
      // From DeckAudio: {channels, track} a new track, {target, snap} a rate, {seek} a frame to jump to.
      this.port.onmessage = ({ data }) => {
        if (data.channels) {
          this.channels = data.channels;
          Object.assign(this.s, { pos: 0, rate: 0, seekTo: null, gain: 1, track: data.track });
        }
        if ('target' in data) {
          this.s.target = data.target;
          if (data.snap) this.s.rate = data.target;
        }
        if ('seek' in data) this.s.seekTo = data.seek;
      };
    }

    process(inputs, outputs) {
      const out = outputs[0];
      if (!this.channels) {
        for (const ch of out) ch.fill(0);
        return true;
      }
      render(this.channels, this.s, out);
      if (++this.blocks % 8 === 0) this.port.postMessage({ pos: this.s.pos, rate: this.s.rate, track: this.s.track }); // ~21 ms
      return true;
    }
  });
}

if (typeof module === 'object') module.exports = { render, makeState };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/`
Expected: 6 tests pass, 0 fail.

- [ ] **Step 5: Checkpoint (no commit)**

Run: `git status --short javascript/deck-audio-worklet.js tests/deck-audio.test.js`
Expected: both files listed as untracked (`??`).

---

### Task 2: DeckAudio engine, wired into the player

**Files:**
- Create: `javascript/deck-audio.js`
- Modify: `javascript/support.js:3` and the `play` listener (~line 349); `javascript/playlist2.js:3` and the `play` listener (~line 279)
- Modify: `index.html`, `playlist/playlist.html`, `playlist/playlist2.html`, `search_pages/smithereens.html` (one script tag each)

**Interfaces:**
- Consumes: the worklet processor `'deck-audio'` and its messages (Task 1).
- Produces a global `class DeckAudio extends EventTarget`:
  - `new DeckAudio(url)`;
  - properties `src`, `paused`, `ended`, `currentTime` (get/set, seconds), `duration` (NaN until decoded), `volume`, `muted`;
  - methods `play() → Promise`, `pause()`;
  - `scratchRate` (`null` | signed number; audible even while paused when set);
  - `preload(url)`;
  - events `play`, `pause`, `timeupdate`, `ended`, `error`.
- The global `music` stays the player's single playback object, now a `DeckAudio`.

- [ ] **Step 1: Write the failing browser check**

With the server running, write `$SP/jobs_engine.json` as the JSON array of the job below (substitute `$SP`, and the repo path for the file:// job):

```json
[{"url":"http://localhost:3000/index.html","w":1440,"h":900,"settle":800,"steps":[{"eval":"(async () => {\n  const wait = (ms) => new Promise((r) => setTimeout(r, ms));\n  const r = { isDeck: typeof DeckAudio === 'function' && music instanceof DeckAudio };\n  if (!r.isDeck) return r;\n  document.getElementById('master_play').click();\n  for (let i = 0; i < 150 && !isFinite(music.duration); i++) await wait(100);\n  r.duration = +music.duration.toFixed(1);\n  r.preloaded = (music._next && music._next.url || '').split('/').pop();\n  await wait(500);\n  let t = music.currentTime; await wait(2000); r.speed = +((music.currentTime - t) / 2).toFixed(2);\n  const seek = document.getElementById('seek'); seek.value = 50; seek.dispatchEvent(new Event('change')); await wait(300);\n  r.seekFrac = +(music.currentTime / music.duration).toFixed(2);\n  music.volume = 0.3; await wait(100); r.gainAt30 = +music.gain.gain.value.toFixed(2);\n  music.muted = true; await wait(100); r.gainMuted = +music.gain.gain.value.toFixed(3); music.muted = false; music.volume = 1;\n  document.getElementById('master_play').click(); t = music.currentTime; await wait(600); r.pauseHolds = music.paused && Math.abs(music.currentTime - t) < 0.02;\n  document.getElementById('master_play').click();\n  document.getElementById('next').click(); await wait(100); r.nextSrc = music.src.split('/').pop();\n  for (let i = 0; i < 150 && !isFinite(music.duration); i++) await wait(100); await wait(500);\n  t = music.currentTime; await wait(1000); r.nextPlays = !music.paused && music.currentTime - t > 0.8;\n  const before = music.src; music.currentTime = music.duration - 1; await wait(3500);\n  r.autoAdvanced = music.src !== before && !music.paused;\n  const A = music.src.replace(/\\d+\\.mp3$/, '10.mp3'), B = music.src.replace(/\\d+\\.mp3$/, '3.mp3');\n  music.src = A; music.play(); music.src = B; music.play();\n  for (let i = 0; i < 150 && !isFinite(music.duration); i++) await wait(100);\n  const el = new Audio(B); await new Promise((ok) => el.addEventListener('loadedmetadata', ok));\n  r.rapidSrcKeepsNewest = music.src === B && Math.abs(music.duration - el.duration) < 0.2;\n  r.pass = r.duration > 60 && r.preloaded === '2.mp3' && Math.abs(r.speed - 1) < 0.05 && Math.abs(r.seekFrac - 0.5) < 0.02 && Math.abs(r.gainAt30 - 0.3) < 0.03 && r.gainMuted < 0.01 && r.pauseHolds && r.nextSrc === '2.mp3' && r.nextPlays && r.autoAdvanced && r.rapidSrcKeepsNewest;\n  return r;\n})()"}]},
 {"url":"file:///Users/mayankpandeydk123gmail.com/Git/services/music-webpage/index.html","w":1440,"h":900,"settle":800,"steps":[{"eval":"(async () => { let errors = 0; music.addEventListener('error', () => errors++); document.getElementById('master_play').click(); await new Promise((r) => setTimeout(r, 1500)); return { errors }; })()"}]}]
```

Run: `cd $SP && node cdp.mjs jobs_engine.json`
Expected: FAIL. The first job returns `{"isDeck":false}` and the file:// job returns `{"errors":0}`, because `music` is still an `Audio`.

- [ ] **Step 2: Write the engine** — create `javascript/deck-audio.js`:

```js
// ACRUX deck: one Web Audio engine for all playback. It stands in for `new Audio()` with the surface the player uses
// (src, play/pause, paused, ended, currentTime, duration, volume, muted; play/pause/timeupdate/ended/error events),
// plus scratchRate for the record (turntable.js). It needs the site served over http (node server.js), not file://.
const DECK_WORKLET = new URL('deck-audio-worklet.js', document.currentScript.src).href;

class DeckAudio extends EventTarget {
  constructor(src) {
    super();
    this.paused = true;
    this.ended = false;
    this._volume = 1;
    this._muted = false;
    this._scratch = null; // signed rate while the record is held or catching up; null = normal playback
    this._frames = 0;     // length of the loaded track; 0 until decoded
    this._pos = 0;        // playhead (frames) at the worklet's last report...
    this._rate = 0;       // ...its rate then...
    this._at = 0;         // ...and when (ctx.currentTime)
    this._seekAt = -1;    // when the last seek was sent: reports just before it are stale
    this._track = 0;      // bumps on every src change, so a slow decode or late report can't leak into a newer song
    this._loading = null;
    this._next = null;    // { url, bytes } fetched ahead by preload()
    this._timer = 0;
    if (src) this.src = src;
  }

  // Context, gain and worklet node are made on first use; the context stays suspended until play().
  _init() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(this.ctx.destination);
      // audioWorklet only exists on https or localhost; anywhere else this rejects and becomes an 'error' event
      this._ready = Promise.resolve().then(() => this.ctx.audioWorklet.addModule(DECK_WORKLET)).then(() => {
        this.node = new AudioWorkletNode(this.ctx, 'deck-audio', { numberOfInputs: 0, outputChannelCount: [2] });
        this.node.connect(this.gain);
        this.node.port.onmessage = ({ data }) => this._report(data);
      });
    }
    return this._ready;
  }

  get src() { return this._src; }
  set src(url) {
    this._src = new URL(url, location.href).href;
    this.paused = true;
    this.ended = false;
    this._frames = 0;
    this._pos = this._rate = 0;
    this._track++;
    this._loading = null; // the new song loads on play(), like <audio preload="none">
    this._apply();
  }

  _loadTrack() {
    if (this._loading) return;
    const track = this._track;
    const fetchBytes = () => fetch(this._src).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.url}`);
      return r.arrayBuffer();
    });
    const bytes = this._next?.url === this._src ? this._next.bytes.catch(fetchBytes) : fetchBytes();
    this._next = null;
    this._loading = Promise.all([bytes, this._init()])
      .then(([data]) => this.ctx.decodeAudioData(data))
      .then((buffer) => {
        if (track !== this._track) return; // the user moved on to another song meanwhile
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice());
        this._frames = buffer.length;
        this.node.port.postMessage({ channels, track }, channels.map((ch) => ch.buffer));
        this._apply(true);
      })
      .catch((err) => {
        if (track !== this._track) return;
        console.error('DeckAudio:', err);
        this.dispatchEvent(new Event('error'));
      });
  }

  // Pushes the state to the worklet (rate) and the gain (volume, mute, silence when stopped).
  // snap: jump straight to the rate (Play starts at full speed) instead of gliding.
  _apply(snap = false) {
    const moving = this._frames > 0 && (this._scratch !== null || !this.paused);
    const rate = moving ? this._scratch ?? 1 : 0;
    if (this.node) this.node.port.postMessage({ target: rate, snap });
    if (this.gain) {
      const level = moving && !this._muted ? this._volume : 0;
      this.gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.003); // a few ms: clean start and stop
    }
    if (moving && !this._timer) this._timer = setInterval(() => this.dispatchEvent(new Event('timeupdate')), 250);
    if (!moving && this._timer) { clearInterval(this._timer); this._timer = 0; }
  }

  _report({ pos, rate, track }) {
    if (track !== this._track || this.ctx.currentTime - this._seekAt < 0.02) return; // stale
    this._pos = pos;
    this._rate = rate;
    this._at = this.ctx.currentTime;
    if (!this.paused && this._scratch === null && this._frames && pos >= this._frames - 1) {
      this.paused = true;
      this.ended = true;
      this._apply();
      this.dispatchEvent(new Event('ended'));
    }
  }

  play() {
    this._init();
    this.ctx.resume();
    this._loadTrack();
    if (this.ended) this.currentTime = 0;
    this.paused = false;
    this.ended = false;
    this._apply(true);
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this._apply();
    this.dispatchEvent(new Event('pause'));
  }

  get scratchRate() { return this._scratch; }
  set scratchRate(rate) {
    this._scratch = rate;
    this._apply();
  }

  get currentTime() {
    if (!this._frames) return 0;
    const sr = this.ctx.sampleRate;
    const rate = this.paused && this._scratch === null ? 0 : this._rate;
    const pos = this._pos + rate * (this.ctx.currentTime - this._at) * sr;
    return Math.min(Math.max(pos, 0), this._frames - 1) / sr;
  }
  set currentTime(seconds) {
    if (!this._frames) return;
    this._pos = Math.min(Math.max(seconds * this.ctx.sampleRate, 0), this._frames - 1);
    this._at = this._seekAt = this.ctx.currentTime;
    this.ended = false;
    this.node.port.postMessage({ seek: this._pos });
    this.dispatchEvent(new Event('timeupdate'));
  }

  get duration() { return this._frames ? this._frames / this.ctx.sampleRate : NaN; }

  get volume() { return this._volume; }
  set volume(value) { this._volume = value; this._apply(); }
  get muted() { return this._muted; }
  set muted(value) { this._muted = value; this._apply(); }

  // Fetches a song's bytes ahead of time (one at a time), so switching to it skips the download.
  preload(url) {
    url = new URL(url, location.href).href;
    if (url === this._src || this._next?.url === url) return;
    const bytes = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.url}`);
      return r.arrayBuffer();
    });
    bytes.catch(() => {}); // a failed preload just means a normal load later
    this._next = { url, bytes };
  }
}
```

- [ ] **Step 3: Swap the player onto the engine**

In `javascript/support.js`, line 3:
- replace `const music = new Audio(\`${SITE}playback_tree/songs/joji/nector/1.mp3\`);`
- with `const music = new DeckAudio(\`${SITE}playback_tree/songs/joji/nector/1.mp3\`);`

In the same file, in the `// Fill the header and record from the current track whenever playback starts` block, after the line `document.getElementById('albumdescription').innerHTML = songs[index].artist;`, add:

```js
        music.preload(`${SITE}playback_tree/songs/joji/nector/${(index + 1) % songs.length + 1}.mp3`); // next song
```

In `javascript/playlist2.js`, line 3:
- replace `const music = new Audio(\`${SITE}playback_tree/songs/joji/smithereens/1.mp3\`);`
- with `const music = new DeckAudio(\`${SITE}playback_tree/songs/joji/smithereens/1.mp3\`);`

In its `// Fill the header and record…` block, after the `albumdescription` line, add:

```js
        music.preload(`${SITE}playback_tree/songs/joji/smithereens/${songs[(index + 1) % songs.length].id}.mp3`); // next song
```

- [ ] **Step 4: Load the engine before each player script (4 pages)**

```bash
cd /Users/mayankpandeydk123gmail.com/Git/services/music-webpage && python3 - <<'PY'
pages = {'index.html': '', 'playlist/playlist.html': '../', 'playlist/playlist2.html': '../', 'search_pages/smithereens.html': '../'}
for page, up in pages.items():
    s = open(page).read()
    player = 'playlist2.js' if page.endswith('playlist2.html') else 'support.js'
    old = f'<script src="{up}javascript/{player}"></script>'
    assert s.count(old) == 1, page
    s = s.replace(old, f'<script src="{up}javascript/deck-audio.js"></script>\n' + old)
    open(page, 'w').write(s)
PY
node --check javascript/deck-audio.js && node --check javascript/support.js && node --check javascript/playlist2.js
```

Expected: no output (syntax OK).

- [ ] **Step 5: Run the browser check to verify it passes**

Run: `cd $SP && node cdp.mjs jobs_engine.json`
Expected:
- The first job logs `"pass":true`, with `speed` ≈ 1, `seekFrac` ≈ 0.5, `preloaded` `"2.mp3"` and `rapidSrcKeepsNewest` true.
- The file:// job logs `{"errors":1}`.
- No `!!` lines on the http job. The file:// job's `console.error DeckAudio:` line is expected.

- [ ] **Step 6: Checkpoint (no commit)**

Run: `node --test tests/ && git status --short`
Expected: tests pass. The new engine file and the 6 modified files are listed.

---

### Task 3: Turntable controller (motor, grab, scratch), replacing the CSS spin

**Files:**
- Create: `javascript/turntable.js`
- Create: `tests/record-scratch.js` (a DevTools-console check, like `tests/record-spin.js`)
- Modify: `style/insert.css` (spin section ~lines 257–293, reduced-motion rule ~line 1027)
- Modify: the 4 pages (one script tag each)
- Modify: `tests/record-spin.js` (one comment)
- Modify (scratchpad tooling): `$SP/cdp.mjs` gains a raw `{cdp: [method, params]}` step

**Interfaces:**
- Consumes `music` (DeckAudio: `paused`, `currentTime`, `scratchRate`, events `error`) and the DOM (`.playback`, `.record`, `#record`, `#albumtext`).
- Produces:
  - the class `grabbing` on `.playback` while the record is held;
  - `#record.style.rotate`, set every frame;
  - module-scope `releasedAt` (ms timestamp), which Task 4 reads inside the same IIFE.

- [ ] **Step 1: Write the failing check** — create `tests/record-scratch.js`:

```js
// Record scratch check: paste into the DevTools console on any ACRUX page served by `node server.js`.
// It plays a song and drives the record with pointer events: pull back a quarter turn, push forward half a turn,
// flick, scratch while paused, and the edge cases (Pause mid catch-up, lost pointer, hidden tab, end of song).
// Logs PASS or FAIL with the numbers. Takes ~25 s and leaves the next song playing.
(async () => {
  const TURN = 3.7; // seconds of song per turn of the record
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise(requestAnimationFrame);
  const playback = document.querySelector('.playback');
  const box = document.querySelector('.record').getBoundingClientRect();
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2, R = box.width * 0.4; // 80% out from the centre
  const togglePlay = () => document.getElementById('master_play').click();
  let id = 1000;
  const point = (deg) => ({ clientX: cx + R * Math.cos(deg * Math.PI / 180), clientY: cy + R * Math.sin(deg * Math.PI / 180) });
  const send = (type, deg, target = playback) => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: id, pointerType: 'mouse', isPrimary: true,
    button: 0, buttons: type === 'pointerup' ? 0 : 1, ...point(deg),
  }));
  // Grab at `from` degrees (screen angles: 180 is left of centre, the side the tucked record shows), turn to `to`
  // over `ms`, hold still `holdMs`, and report the song position just before letting go.
  async function drag(from, to, ms, holdMs = 0, letGo = true) {
    id++;
    const start = point(from);
    send('pointerdown', from, document.elementFromPoint(start.clientX, start.clientY));
    const t0 = performance.now();
    let minRate = Infinity;
    for (let k = 0; k < 1;) {
      await frame();
      k = Math.min((performance.now() - t0) / ms, 1);
      send('pointermove', from + (to - from) * k);
      minRate = Math.min(minRate, music.scratchRate ?? 1);
    }
    await wait(holdMs);
    const result = { pos: music.currentTime, stillRate: music.scratchRate, minRate };
    if (letGo) send('pointerup', to);
    return result;
  }
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const r = {}, ok = {};

  if (music.paused) togglePlay();
  for (let i = 0; i < 150 && !isFinite(music.duration); i++) await wait(100);
  music.currentTime = 30;
  await wait(1200);

  // 1. Pull back a quarter turn while playing: ~0.93 s back, played in reverse, then silent under a still hand.
  let p0 = music.currentTime;
  let d = await drag(225, 135, 450, 300);
  r.back = +(d.pos - p0).toFixed(2);
  r.backMinRate = +d.minRate.toFixed(2);
  r.backStillRate = +d.stillRate.toFixed(3);
  ok.back = near(r.back, -TURN / 4, 0.12) && r.backMinRate < -0.5 && Math.abs(r.backStillRate) < 0.05;

  // 2. Let go: the motor brings it back to normal playback.
  await wait(800);
  const t1 = music.currentTime;
  await wait(1000);
  r.afterRelease = +(music.currentTime - t1).toFixed(2);
  ok.release = music.scratchRate === null && !music.paused && near(r.afterRelease, 1, 0.08);

  // 3. Push forward half a turn: ~1.85 s ahead.
  p0 = music.currentTime;
  d = await drag(135, 315, 600, 300);
  r.forward = +(d.pos - p0).toFixed(2);
  ok.forward = near(r.forward, TURN / 2, 0.15);
  await wait(800);

  // 4. Flick forward and let go at speed: it carries on well past the drag itself.
  p0 = music.currentTime;
  const tf = performance.now();
  await drag(135, 225, 60);
  for (let i = 0; i < 100 && music.scratchRate !== null; i++) await wait(50);
  r.flickExtra = +(music.currentTime - p0 - (performance.now() - tf) / 1000 - TURN / 4).toFixed(2);
  ok.flick = r.flickExtra > 0.5 && music.scratchRate === null;

  // 5. Pause while it is still catching up after a flick: silent at once.
  await drag(135, 225, 60);
  await frame();
  togglePlay();
  await frame();
  await frame();
  ok.pauseMidCatch = music.paused && music.scratchRate === null;

  // 6. Scratch while paused: you hear it, and the song stays paused where you left it.
  await wait(1300);
  p0 = music.currentTime;
  await drag(225, 180, 300, 200);
  await wait(100);
  const p1 = music.currentTime;
  await wait(500);
  r.pausedMove = +(p1 - p0).toFixed(2);
  ok.paused = near(r.pausedMove, -TURN / 8, 0.08) && music.paused && music.scratchRate === null && near(music.currentTime, p1, 0.01);

  // 7. Losing the pointer mid-scratch (switching windows) lets go instead of leaving the record held.
  togglePlay();
  await wait(1500);
  await drag(225, 200, 200, 0, false);
  playback.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: id }));
  ok.lostPointer = !playback.classList.contains('grabbing');
  await wait(1000);
  ok.lostPointer = ok.lostPointer && music.scratchRate === null;

  // 8. Hiding the tab mid catch-up returns to normal speed rather than leaving the song running fast.
  await drag(135, 225, 60);
  await frame();
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  ok.hiddenTab = music.scratchRate === null;
  delete document.hidden;

  // 9. Flicking past the end of the song while playing: one 'ended', then the player moves to the next song.
  await wait(500);
  let ends = 0;
  const count = () => ends++;
  music.addEventListener('ended', count);
  music.currentTime = music.duration - 1;
  await wait(100);
  const src = music.src;
  await drag(135, 315, 100);
  await wait(3500);
  music.removeEventListener('ended', count);
  r.ends = ends;
  ok.end = ends === 1 && music.src !== src;

  r.failed = Object.keys(ok).filter((k) => !ok[k]);
  r.pass = r.failed.length === 0;
  console.log(r.pass ? 'PASS' : 'FAIL', r);
  return r;
})();
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd $SP && node -e 'const fs=require("fs");const js=fs.readFileSync("/Users/mayankpandeydk123gmail.com/Git/services/music-webpage/tests/record-scratch.js","utf8");fs.writeFileSync("jobs_scratch.json",JSON.stringify([{url:"http://localhost:3000/index.html",w:1440,h:900,settle:800,steps:[{eval:js}]}]))' && node cdp.mjs jobs_scratch.json
```

Expected: `"pass":false`, and `failed` includes `back`, `forward` and `flick` (nothing turns pointer drags into `scratchRate` yet).

- [ ] **Step 3: Write the controller** — create `javascript/turntable.js`:

```js
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
  const HOLD_MS = 200;       // touch: press and hold this long to grab (a quicker swipe scrolls the page)
  const SLOP_PX = 8;         // touch: moving further than this before the hold completes means scroll instead

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
      const rate = clampRate((angle - heard) / (FOLLOW * PLAY)); // the song chases the record under the hand
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
        const target = still.matches ? 0 : music.paused ? IDLE : PLAY;
        v += (target - v) * (1 - Math.exp(-dt / MOTOR_TAU));
      }
      angle += v * dt;
    }
    disc.style.rotate = `${angle % 360}deg`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // The disc under a point: its centre, and a dead zone at the spindle where the angle is unsteady.
  function hitDisc(x, y) {
    const r = platter.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return Math.hypot(x - cx, y - cy) <= r.width / 2 ? { cx, cy, rMin: r.width * 0.05 } : null;
  }

  function grab(e, hit) {
    held = { id: e.pointerId, ...hit, a: Math.atan2(e.clientY - hit.cy, e.clientX - hit.cx) * 180 / Math.PI, t: performance.now(), v: 0 };
    heard = angle;
    catching = false;
    music.scratchRate = 0; // a hand on the record stops it
    try { playback.setPointerCapture(e.pointerId); } catch {} // synthetic test events have no pointer to capture
    playback.classList.add('grabbing');
    if (e.pointerType !== 'mouse') navigator.vibrate?.(10);
  }

  function release(e) {
    if (!held || e.pointerId !== held.id) return;
    v = Math.max(-MAX_RATE * PLAY, Math.min(MAX_RATE * PLAY, held.v)); // a flick keeps its momentum
    held = null;
    releasedAt = performance.now();
    playback.classList.remove('grabbing');
    if (music.paused || still.matches) music.scratchRate = null; // paused: the song stays where you left it
    else catching = true;
  }

  playback.addEventListener('pointerdown', (e) => {
    if (held || e.button !== 0 || e.target.closest('button')) return;
    const hit = hitDisc(e.clientX, e.clientY);
    if (!hit) return;
    if (e.pointerType === 'mouse') {
      e.preventDefault(); // no text selection or image drag
      grab(e, hit);
      return;
    }
    // Touch and pen: press and hold to grab; moving first means the page scrolls instead.
    const done = () => {
      clearTimeout(timer);
      playback.removeEventListener('pointermove', moved);
      playback.removeEventListener('pointerup', done);
      playback.removeEventListener('pointercancel', done);
    };
    const moved = (m) => {
      if (m.pointerId === e.pointerId && Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) > SLOP_PX) done();
    };
    const timer = setTimeout(() => { done(); grab(e, hit); }, HOLD_MS);
    playback.addEventListener('pointermove', moved);
    playback.addEventListener('pointerup', done);
    playback.addEventListener('pointercancel', done);
  });

  playback.addEventListener('pointermove', (e) => {
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
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) playback.addEventListener(type, release);
  playback.addEventListener('touchmove', (e) => { if (held) e.preventDefault(); }, { passive: false }); // no scrolling mid-scratch
  platter.addEventListener('dragstart', (e) => e.preventDefault());
  playback.addEventListener('contextmenu', (e) => { if (hitDisc(e.clientX, e.clientY)) e.preventDefault(); }); // long-press menu
  document.addEventListener('visibilitychange', () => { if (document.hidden && catching) stopCatching(); });

  music.addEventListener('error', () => {
    document.getElementById('albumtext').textContent =
      location.protocol === 'file:' ? 'Start with node server.js to play' : "Couldn't load this song";
  });
})();
```

- [ ] **Step 4: Replace the CSS spin with grab styles** — in `style/insert.css`:

Replace
```css
/* Record: .record (platter) > #record.i1 (vinyl) > .i2 > .i3 (spin layers) > .inner (label).
```
with
```css
/* Record: .record (platter) > #record.i1 (vinyl, spun by turntable.js) > .i2 > .i3 > .inner (label).
```

Delete the whole block from `/* Spin: always turning at idle speed, with motor inertia…` through `@keyframes spin-down { from { rotate: calc(-1 * var(--a)); } to { rotate: 0turn; } }`: the comment, the `.record { --idle… }` rule, the `#record`, `.record .i2`, `.record .i3` and two `body:has(...)` rules, and the three `@keyframes`. Put this in its place:

```css
/* Grabbing the record (turntable.js): no text selection, image drag or long-press menu in the way. */
.record { cursor: grab; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.record img { -webkit-user-drag: none; }
.playback.grabbing, .playback.grabbing * { cursor: grabbing; }
```

In the `@media (prefers-reduced-motion: reduce)` block, replace
`  #record, .record .i2, .record .i3, .record::after { animation: none !important; }`
with
`  .record::after { animation: none !important; } /* turntable.js keeps the record itself still */`.

- [ ] **Step 5: Load the controller on the 4 pages**

```bash
cd /Users/mayankpandeydk123gmail.com/Git/services/music-webpage && python3 - <<'PY'
pages = {'index.html': '', 'playlist/playlist.html': '../', 'playlist/playlist2.html': '../', 'search_pages/smithereens.html': '../'}
for page, up in pages.items():
    s = open(page).read()
    old = f'<script src="{up}javascript/volume.js"></script>'
    assert s.count(old) == 1, page
    s = s.replace(old, old + f'\n<script src="{up}javascript/turntable.js"></script>')
    open(page, 'w').write(s)
PY
node --check javascript/turntable.js && grep -c 'animation: spin\|@keyframes spin' style/insert.css
```

Expected: `0` (no CSS spin left).

In `tests/record-spin.js`, change the comment `// one-frame hitch at a click (CSS may start the ramp one frame after the pause lands) is a lone blip and is dropped.` to `// one-frame hitch at a click (a frame that lands mid state change) is a lone blip and is dropped.`

- [ ] **Step 6: Run the scratch check on every layout**

```bash
cd $SP && node -e '
const fs=require("fs");const js=fs.readFileSync("/Users/mayankpandeydk123gmail.com/Git/services/music-webpage/tests/record-scratch.js","utf8");
const spin=fs.readFileSync("/Users/mayankpandeydk123gmail.com/Git/services/music-webpage/tests/record-spin.js","utf8");
fs.writeFileSync("jobs_scratch.json",JSON.stringify([
 {url:"http://localhost:3000/index.html",w:1440,h:900,settle:800,steps:[{eval:js}]},
 {url:"http://localhost:3000/playlist/playlist2.html",w:1025,h:871,settle:800,steps:[{eval:js}]},
 {url:"http://localhost:3000/index.html",w:390,h:844,mobile:true,settle:800,steps:[{eval:js}]},
 {url:"http://localhost:3000/index.html",w:1920,h:1080,settle:1500,steps:[{eval:spin}]},
 {url:"http://localhost:3000/index.html",w:390,h:844,mobile:true,settle:1500,steps:[{eval:spin}]},
 {url:"http://localhost:3000/index.html",w:1440,h:900,reducedMotion:true,settle:1500,steps:[{wait:1000},{eval:"getComputedStyle(document.getElementById(\"record\")).rotate"},{wait:1000},{eval:"getComputedStyle(document.getElementById(\"record\")).rotate"}]},
 {url:"file:///Users/mayankpandeydk123gmail.com/Git/services/music-webpage/index.html",w:1440,h:900,settle:800,steps:[{eval:"document.getElementById(\"master_play\").click()"},{wait:1500},{eval:"document.getElementById(\"albumtext\").textContent"}]}
]));' && node cdp.mjs jobs_scratch.json
```

Expected:
- The three scratch jobs log `"pass":true` with `failed: []`.
- Both spin jobs log `"pass":true`.
- The reduced-motion job prints the same angle twice (for example `"0deg"`, `"0deg"`).
- The file:// job prints `"Start with node server.js to play"`.
- No `!!` lines except the expected `DeckAudio:` error on the file:// job.

- [ ] **Step 7: Touch checks (Review Focus 5)**

Add a raw CDP step to `$SP/cdp.mjs`, next to the `if (s.eval)` block inside the steps loop:

```js
      if (s.cdp) console.log('  cdp:', s.cdp[0], JSON.stringify(await send(s.cdp[0], s.cdp[1] || {})));
```

1. Get the deck record's grab point at 390×844 (mobile):
   `{"url":"http://localhost:3000/index.html","w":390,"h":844,"mobile":true,"steps":[{"eval":"(()=>{const b=document.querySelector('.record').getBoundingClientRect();return [Math.round(b.left+b.width/2-b.width*0.4), Math.round(b.top+b.height/2)]})()"}]}`
   Call the result `[X, Y]`.
2. Hold: a job at 390×844 mobile with these steps (substitute X, Y):
   - `{"cdp":["Input.dispatchTouchEvent",{"type":"touchStart","touchPoints":[{"x":X,"y":Y}]}]}`
   - `{"wait":300}`
   - `{"eval":"document.querySelector('.playback').classList.contains('grabbing')"}`
   - `{"cdp":["Input.dispatchTouchEvent",{"type":"touchMove","touchPoints":[{"x":X+20,"y":Y+60}]}]}`
   - `{"wait":50}`
   - `{"eval":"scrollY"}`
   - `{"cdp":["Input.dispatchTouchEvent",{"type":"touchEnd","touchPoints":[]}]}`

   Expected: `true`, then `0` (grabbed; the page didn't scroll).
3. Swipe: a new job with steps:
   - `{"cdp":["Input.dispatchTouchEvent",{"type":"touchStart","touchPoints":[{"x":X,"y":Y}]}]}`
   - `{"cdp":["Input.dispatchTouchEvent",{"type":"touchMove","touchPoints":[{"x":X,"y":Y-60}]}]}`
   - `{"cdp":["Input.dispatchTouchEvent",{"type":"touchMove","touchPoints":[{"x":X,"y":Y-140}]}]}`
   - `{"cdp":["Input.dispatchTouchEvent",{"type":"touchEnd","touchPoints":[]}]}`
   - `{"wait":400}`
   - `{"eval":"[document.querySelector('.playback').classList.contains('grabbing'), scrollY]"}`

   Expected: `[false, >0]` (no grab; the page scrolled). If headless Chrome doesn't scroll from synthetic touches, `scrollY` may stay 0; then only assert `false`, and note it for a check on a real phone.
4. Long-press safety: `getComputedStyle(document.querySelector('.record')).webkitTouchCallout` is `"none"` and `.userSelect` is `"none"`.

- [ ] **Step 8: Checkpoint (no commit)**

Run: `node --test tests/ && git status --short`
Expected: the unit tests pass. The new `turntable.js` and `tests/record-scratch.js`, plus the modified CSS, pages and `tests/record-spin.js`, are listed.

---

### Task 4: Label hover play/pause control

**Files:**
- Modify: the 4 pages (one line of markup each, before the tonearm `<img>`)
- Modify: `style/insert.css` (label glow rules ~lines 273–275, the ≥1200px record block ~line 298, the deck block, the deck `@container` rule)
- Modify: `javascript/turntable.js` (touch tap to reveal)

**Interfaces:**
- Consumes: `#master_play` (clicked by the button), `body:has(#play.icon-pause)` (icon state), `--tint`, `releasedAt` and `playback` inside turntable.js's IIFE.
- Produces: `.label_ctrl` (with the class `show` while revealed on touch) and `.label_btn`.
- `.playback` gains the custom properties `--d` and `--cx` at ≥1200px (moved off `.record`).

- [ ] **Step 1: Write the failing check** — `$SP/jobs_label.json`:

```json
[{"url":"http://localhost:3000/index.html","w":1440,"h":900,"settle":800,"steps":[
  {"eval":"(()=>{const c=document.querySelector('.label_ctrl'), b=document.querySelector('.label_btn');if(!c||!b)return {missing:true};const cr=c.getBoundingClientRect(), rr=document.querySelector('.record').getBoundingClientRect(), br=b.getBoundingClientRect(), pr=document.querySelector('.playback').getBoundingClientRect();window.__btn=[br.left+br.width/2, br.top+br.height/2];return {centred: Math.abs(cr.left+cr.width/2-(rr.left+rr.width/2))<2 && Math.abs(cr.top+cr.height/2-(rr.top+rr.height/2))<2, size:+(cr.width/rr.width).toFixed(3), btnInView: br.right<=pr.right+1 && br.left>=cr.left-1, btn: window.__btn.map(Math.round), opacity:getComputedStyle(c).opacity}})()"}
]}]
```

Run: `cd $SP && node cdp.mjs jobs_label.json`
Expected: FAIL with `{"missing":true}`.

- [ ] **Step 2: Add the markup (4 pages)**

```bash
cd /Users/mayankpandeydk123gmail.com/Git/services/music-webpage && python3 - <<'PY'
ctrl = ('    <div class="label_ctrl"><button class="label_btn" aria-label="Play or pause" '
        'onclick="document.getElementById(\'master_play\').click()"><i class="icon icon-play" aria-hidden="true"></i>'
        '<i class="icon icon-pause" aria-hidden="true"></i></button></div>\n')
pages = {'index.html': '', 'playlist/playlist.html': '../', 'playlist/playlist2.html': '../', 'search_pages/smithereens.html': '../'}
for page, up in pages.items():
    s = open(page).read()
    old = f'    <img class="tonearm" src="{up}playback_tree/tonearm.svg" alt="">'
    assert s.count(old) == 1, page
    s = s.replace(old, ctrl + old)
    open(page, 'w').write(s)
PY
```

- [ ] **Step 3: CSS** — in `style/insert.css`:

(a) Move the label glow onto the control's hover. Replace
```css
.inner img:hover { box-shadow: 0 0 100px var(--tint, var(--glow)); transition: 0.3s linear; }
```
with
```css
.inner .album { transition: box-shadow 0.3s linear; }
.playback:has(.label_ctrl:hover, .label_ctrl.show) .inner img { box-shadow: 0 0 100px var(--tint, var(--glow)); }
```

Then replace `.inner.silver img:hover { box-shadow: 0 0 100px var(--tint, var(--muted)); }` with
`.playback:has(.label_ctrl:hover, .label_ctrl.show) .inner.silver img { box-shadow: 0 0 100px var(--tint, var(--muted)); }`.

(b) Right after the grab styles from Task 3 (`.playback.grabbing, .playback.grabbing * { cursor: grabbing; }`), add:

```css
/* Label control: hovering the record's label shows play/pause over a soft black gradient that melts into the
   label's glow. It sits over the label but doesn't spin; each layout places it (>=1200px block, deck block). */
.label_ctrl {
  position: absolute;
  z-index: 1;
  border-radius: 50%;
  cursor: grab;
  opacity: 0;
  transition: opacity 0.2s;
  background: radial-gradient(circle, rgb(0 0 0 / 0.7), rgb(0 0 0 / 0.55) 30%, rgb(0 0 0 / 0.3) 55%, rgb(0 0 0 / 0.08) 68%, transparent 72%);
  background: radial-gradient(circle in oklab, rgb(0 0 0 / 0.7), rgb(0 0 0 / 0.55) 30%, rgb(0 0 0 / 0.3) 55%, rgb(0 0 0 / 0.08) 68%, transparent 72%);
}
.label_btn {
  position: absolute;
  top: 50%;
  left: var(--bx, 50%);
  translate: -50% -50%;
  display: grid;
  place-items: center;
  width: clamp(44px, 6cqh, 64px);
  aspect-ratio: 1;
  padding: 0;
  border: 1px solid rgb(255 255 255 / 0.18);
  border-radius: 50%;
  background: rgb(20 20 20 / 0.55);
  backdrop-filter: blur(6px);
  color: #fff;
  font-size: clamp(16px, 2.2cqh, 22px);
  scale: 0.85;
  transition: scale 0.2s;
}
.label_ctrl:hover, .label_ctrl.show, .label_ctrl:has(:focus-visible) { opacity: 1; }
.label_ctrl:hover .label_btn, .label_ctrl.show .label_btn, .label_btn:focus-visible { scale: 1; }
.label_btn .icon-pause, body:has(#play.icon-pause) .label_btn .icon-play { display: none; }
body:has(#play.icon-pause) .label_btn .icon-pause { display: inline-block; }
```

(c) In the `@media (min-width: 1200px)` record block, replace
```css
@media (min-width: 1200px) {
  .record {
    --d: 112cqh; /* diameter: 6% clipped at the top and at the bottom */
    position: absolute;
    top: 50%;
    left: calc(clamp(100cqw + 0.05 * var(--d), var(--d) / 2 + 2cqw, 100cqw + 0.09 * var(--d)) - var(--d) / 2);
```
with
```css
@media (min-width: 1200px) {
  .playback { /* shared by the record and its label control */
    --d: 112cqh; /* record diameter: 6% clipped at the top and at the bottom */
    --cx: clamp(100cqw + 0.05 * var(--d), var(--d) / 2 + 2cqw, 100cqw + 0.09 * var(--d)); /* record centre */
  }
  .record {
    position: absolute;
    top: 50%;
    left: calc(var(--cx) - var(--d) / 2);
```

In the same block, after the `.inner::after { /* spindle… */ … }` rule, add:

```css
  .label_ctrl { /* over the label: centred on the record, 36% of its diameter */
    top: 50%;
    left: calc(var(--cx) - 0.18 * var(--d));
    width: calc(0.36 * var(--d));
    aspect-ratio: 1;
    translate: 0 -50%;
    /* the button sits in the middle of the part of the label that shows beside Browse */
    --bx: calc((min(100cqw, var(--cx) + 0.18 * var(--d)) - var(--cx) + 0.18 * var(--d)) / 2);
  }
```

(d) In the deck block (`@media (max-width: 1199px)`), after `.inner { width: 84.6%; … }`, add:

```css
  .label_ctrl { /* over the label: the record's centre is (x0 + 51.5cqh, 50cqh), the label 30.9cqh across */
    top: 34.55cqh;
    left: calc(var(--x0) + 36.05cqh);
    width: 30.9cqh;
    aspect-ratio: 1;
  }
```

In the deck's `@container deck (max-height: 150px)` rule, change `.deck_knob, .deck_start, .deck_pitch { opacity: 0; visibility: hidden; }` to `.deck_knob, .deck_start, .deck_pitch, .label_ctrl { opacity: 0; visibility: hidden; }`.

- [ ] **Step 4: Touch reveal** — in `javascript/turntable.js`, insert this before the line `  music.addEventListener('error', () => {`:

```js
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

```

- [ ] **Step 5: Run the label checks**

Extend `$SP/jobs_label.json`'s first job with these steps after the first eval (the button centre comes from that eval's `btn`, called `[BX, BY]`; run once to read it, then substitute):

- `{"cdp":["Input.dispatchMouseEvent",{"type":"mouseMoved","x":BX,"y":BY}]}`
- `{"wait":400}`
- `{"eval":"[getComputedStyle(document.querySelector('.label_ctrl')).opacity, getComputedStyle(document.querySelector('.inner img')).boxShadow.includes('100px')]"}`
- `{"shot":"label_hover_1440.png"}`
- `{"cdp":["Input.dispatchMouseEvent",{"type":"mousePressed","x":BX,"y":BY,"button":"left","clickCount":1}]}`
- `{"cdp":["Input.dispatchMouseEvent",{"type":"mouseReleased","x":BX,"y":BY,"button":"left","clickCount":1}]}`
- `{"wait":300}`
- `{"eval":"[music.paused, getComputedStyle(document.querySelector('.label_btn .icon-pause')).display]"}`
- `{"cdp":["Input.dispatchMouseEvent",{"type":"mousePressed","x":BX,"y":BY,"button":"left","clickCount":1}]}`
- `{"cdp":["Input.dispatchMouseEvent",{"type":"mouseReleased","x":BX,"y":BY,"button":"left","clickCount":1}]}`
- `{"wait":300}`
- `{"eval":"[music.paused, getComputedStyle(document.querySelector('.label_btn .icon-play')).display]"}`

Add the same geometry eval as jobs at 1280×720, 1920×1080 and 2560×1440, at 1025×871, and at 390×844 mobile. The deck-size jobs also run `{"shot":"label_deck.png"}` after `{"eval":"document.querySelector('.label_ctrl').classList.add('show')"}`.

Expected:
- **Desktop:** `centred:true`, `size` ≈ 0.36 and `btnInView:true` at every size. The hover step prints `["1", true]`. The first click prints `[false, "inline-block"]` (playing, pause icon showing); the second prints `[true, "inline-block"]` (paused, play icon showing).
- **Deck sizes:** `centred:true` and `size` ≈ 0.412.
- **Screenshots:** the gradient is smooth (no banding or grain) and the button sits inside the visible label.

- [ ] **Step 6: Re-run the scratch and spin checks** (the label now covers part of the record, so grabbing must still work there):

Run: `cd $SP && node cdp.mjs jobs_scratch.json`
Expected: the same passes as Task 3, Step 6.

- [ ] **Step 7: Checkpoint (no commit)** — `node --test tests/ && git status --short`, which should list the modified CSS, pages and turntable.js.

---

### Task 5: Full regression pass

**Files:** none new; this task only verifies.

- [ ] **Step 1: Phone deck unchanged.** Run the phone baseline job with `PFX` → `after3` (`sed 's/PFX/after3/g' $SP/jobs_phone.json > $SP/jobs_phone_after3.json && cd $SP && node cdp.mjs jobs_phone_after3.json`). Then run the pixel diff (`sed 's/after_/after3_/' $SP/diff.js > $SP/diff3.js`, the port-3001 scratch server, and a jobs file evaluating `diff3.js`). Expected: `{"scroll_idle":0,"scroll_play":0,"shrink_idle":0,"shrink_scrolled":0,"pl2":0}`.
- [ ] **Step 2: Sizes and console.** Re-run `$SP/jobs_sizes2.json` (13 sizes). Expected: the same measurements as before, `hOverflow:false` everywhere, and no `!!` lines. Look over `w_765x884.png`, `w_1440x900.png` and `w_1920x1080.png`.
- [ ] **Step 3: All four pages.** Run `tests/record-scratch.js` on `playlist/playlist.html` (1440×900) and `search_pages/smithereens.html` (1180×820). Expected: `pass:true`.
- [ ] **Step 4: Unit tests.** `node --test tests/`: all pass.
- [ ] **Step 5: Stop the servers** (`lsof -ti:3000,3001 | xargs kill`). Report the results to the user, including what needs their ears: scratch sound, flick feel and hand-back smoothness, tuned with the knobs at the top of `javascript/turntable.js`.
