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
      if (navigator.audioSession) navigator.audioSession.type = 'playback'; // iPhone: play through the silent switch
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(this.ctx.destination);
    }
    if (!this._ready) {
      // audioWorklet only exists on https or localhost; anywhere else this rejects and becomes an 'error' event
      this._ready = Promise.resolve().then(() => this.ctx.audioWorklet.addModule(DECK_WORKLET)).then(() => {
        this.node = new AudioWorkletNode(this.ctx, 'deck-audio', { numberOfInputs: 0, outputChannelCount: [2] });
        this.node.connect(this.gain);
        this.node.port.onmessage = ({ data }) => this._report(data);
      });
      this._ready.catch(() => { this._ready = null; }); // a failed module load is retried on the next play()
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
        this._loading = null; // Play tries again
        this.paused = true;
        this._apply();
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
    queueMicrotask(() => this.dispatchEvent(new Event('play'))); // after the caller's handler finishes, as <audio> does
    return Promise.resolve();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this._apply();
    queueMicrotask(() => this.dispatchEvent(new Event('pause')));
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
    // Only after the current song has loaded, so the two downloads don't share the bandwidth.
    const bytes = Promise.resolve(this._loading).then(() => fetch(url)).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.url}`);
      return r.arrayBuffer();
    });
    bytes.catch(() => {}); // a failed preload just means a normal load later
    this._next = { url, bytes };
  }
}
