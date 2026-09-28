// ACRUX deck: one Web Audio engine for all playback. It stands in for `new Audio()` with the surface the player uses
// (src, play/pause, paused, ended, currentTime, duration, volume, muted; play/pause/timeupdate/ended/error/canplay events),
// plus scratchRate for the record (turntable.js). It needs the site served over http (node server.js), not file://.
// A YouTube song (src "youtube:<videoId>") plays in YouTube's own player instead, as a screen on the deck (.playback
// gets .video): YouTube's rules want the video seen (at least 200×200, uncovered, never playing out of sight), so
// sound alone isn't allowed. The same surface drives it, so the header, queue and seek bar work unchanged.
// Auto Mix (automix.js plans, the worklet plays): with `automix` on, each song is levelled and the song cue() names is
// fetched ahead, analysed and mixed into, down to the sample; 'mixstart', 'mixed' (it has taken over: src, id,
// currentTime and duration are now its own) then 'play', and 'mixend' say how it goes.
const DECK_WORKLET = new URL('deck-audio-worklet.js', document.currentScript.src).href;
const MIX_WORKER = new URL('automix-analyze.js', document.currentScript.src).href;
const MIX_API = new URL('../api/mix/', document.currentScript.src).href;
const ANALYSES = new Map(); // song id → the promise of its analysis, for this session
let analyser = null;        // the Worker, made on first use
let jobs = 0;
const analysing = new Map(); // job → its resolve

// A decoded song described for mixing (automix-analyze.js): resampled natively to 22 050 Hz, analysed in the Worker.
async function analyse(buffer) {
  const sr = 22050;
  const offline = new OfflineAudioContext(2, Math.ceil(buffer.duration * sr), sr);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const song = await offline.startRendering();
  if (!analyser) {
    analyser = new Worker(MIX_WORKER);
    analyser.onmessage = ({ data }) => { analysing.get(data.id)?.(data.analysis); analysing.delete(data.id); };
    analyser.onerror = () => { for (const done of analysing.values()) done(null); analysing.clear(); analyser = null; };
  }
  const id = ++jobs;
  return new Promise((done) => {
    analysing.set(id, done);
    analyser.postMessage({ id, left: song.getChannelData(0), right: song.getChannelData(1), sr });
  });
}

class DeckAudio extends EventTarget {
  constructor(src) {
    super();
    this.paused = true;
    this.ended = false;
    this._volume = 1;
    this._muted = false;
    this._scratch = null; // signed rate while the record is held or catching up; null = normal playback
    this._frames = 0;     // length of the audio decoded so far; 0 until the first part is decoded
    this._partial = false; // only the start of the song is decoded yet (the rest is still downloading)
    this._estimate = 0;   // the whole song's length (frames), estimated from its size while partial
    this._stalled = false; // playback caught up with the download: waiting for more
    this._wantPos = null; // a seek past what's decoded yet, done once it arrives
    this._startAt = 0;    // the second to start from, set before the song is decoded (resume(), or a seek before Play)
    this._hint = NaN;     // its length, known before it's decoded (resume())
    this._pos = 0;        // playhead (frames) at the worklet's last report...
    this._rate = 0;       // ...its rate then...
    this._at = 0;         // ...and when (ctx.currentTime)
    this._seekAt = -1;    // when the last seek was sent: reports just before it are stale
    this._track = 0;      // bumps on every src change, so a slow decode or late report can't leak into a newer song
    this._loading = null;
    this._next = null;    // { url, bytes } fetched ahead by preload()
    this._timer = 0;
    this._vid = null;     // the YouTube video this src is, or null
    this._yt = null;      // YouTube's player, once made (a promise); _yp is the player itself once ready
    this._yp = null;
    this._serial = 0;     // numbers each song loaded: the one playing (_track) and the one cued next
    this.id = null;       // the song's id (player.js): Auto Mix keeps its analysis under it
    this._automix = false;
    this._trim = 1;       // this song's level while Auto Mix is on (automix.js trim())
    this._cue = null;     // the next song: { url, id, gapless, track, stop, buffer, frames, analysis, b, loaded, plan, armed, started }
    this._whole = null;   // { promise, resolve }: this song decoded in full, for its analysis
    this._mixing = null;  // { p (0..1), show } while a mix plays
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
    const vid = /^youtube:([\w-]{11})$/.exec(url)?.[1] || null;
    this._uncue(true);
    this._mixing = null;
    this._planAfterMix = false;
    this._whole?.resolve(null);
    this._whole = null;
    if (this._vid && !vid) this._yp?.stopVideo();
    this._vid = vid;
    document.querySelector('.playback')?.classList.toggle('video', !!vid);
    this._src = new URL(url, location.href).href;
    if (this._next && this._next.url !== this._src) { // fetched ahead for a song that isn't the one now: it stops
      this._next.stop.abort();
      this._next = null;
    }
    this.paused = true;
    this.ended = false;
    this._frames = this._estimate = 0;
    this._partial = this._stalled = false;
    this._wantPos = null;
    this._startAt = 0;
    this._hint = NaN;
    this._pos = this._rate = 0;
    this._track = ++this._serial;
    this._trim = 1;
    this._abort?.abort(); // the last song's download stops now, not at its next chunk: a stalled one held a connection
    this._loading = null; // the new song loads on play(), like <audio preload="none">
    this._apply();
    if (this._automix && !vid) this._level();
    this.node?.port.postMessage({ trim: 1 });
  }

  // Loads the song and plays it as soon as its start is decoded: the download streams in, and at 256 KB (and each
  // doubling after) the part so far is decoded and handed to the worklet, which keeps its place when a longer part
  // replaces a shorter one; the whole file replaces the last part. So a song starts in about a second instead of after
  // its whole download. A part that won't decode (some browsers refuse a cut-off FLAC) is skipped: the whole file
  // still plays. A song preload() already fetched is decoded whole at once.
  _loadTrack() {
    if (this._loading) return;
    const track = this._track;
    const url = this._src;
    const ready = this._init();
    const preloaded = this._next?.url === url ? this._next.bytes : null;
    if (preloaded) this._abort = this._next.stop; // its download is this song's now: moving on stops it
    this._next = null;
    let total = 0;
    let last = null; // the previous part: { frames, bytes }

    const post = (buffer, bytes, whole) => {
      if (track !== this._track) return;
      if (whole) { this._whole?.resolve(buffer); this._whole = null; } // Auto Mix analyses the whole song (_level)
      if (buffer.length <= this._frames) { // not longer than what's playing (a slower, shorter part)
        if (whole) { // the whole song turned out no longer than the last part: it's complete as it is
          this._partial = this._stalled = false;
          this._apply();
        }
        return;
      }
      const first = !this._frames;
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice());
      this._frames = buffer.length;
      this._partial = !whole;
      // The song's length while partial: from how fast frames grew between the last two parts (the file's start holds
      // tags and cover art, which would inflate a plain bytes ratio), or that ratio for the first part.
      const perByte = last ? (buffer.length - last.frames) / (bytes - last.bytes) : buffer.length / bytes;
      this._estimate = whole || !total ? buffer.length : Math.round(buffer.length + (total - bytes) * perByte);
      last = { frames: buffer.length, bytes };
      this.node.port.postMessage({ channels, track, keep: !first }, channels.map((ch) => ch.buffer));
      if (first && this._startAt) { // where it was asked to start, now that seeking works
        const at = this._startAt;
        this._startAt = 0;
        this.currentTime = at;
      }
      if (this._wantPos !== null && this._wantPos < this._frames) {
        const want = this._wantPos;
        this._wantPos = null;
        this.currentTime = want / this.ctx.sampleRate;
      }
      this._stalled = this._wantPos !== null; // still short of a place asked for: keep waiting there, silent
      this._apply(first);
      if (first) this.dispatchEvent(new Event('canplay')); // decoded: seeking works from here
    };
    const decode = (bytes, size, whole) => ready.then(() => this.ctx.decodeAudioData(bytes)).then((buffer) => post(buffer, size, whole));

    const stream = async () => {
      if (track !== this._track) throw new Error('moved on'); // a failed preload's fallback, after the song changed
      const res = await fetch(url, { signal: (this._abort = new AbortController()).signal });
      if (!res.ok) throw new Error(`${res.status} ${res.url}`);
      total = Number(res.headers.get('content-length')) || 0;
      if (!res.body) return res.arrayBuffer();
      const reader = res.body.getReader();
      const parts = [];
      let got = 0;
      let at = 256 * 1024;
      const joined = () => {
        const all = new Uint8Array(got);
        let o = 0;
        for (const part of parts) { all.set(part, o); o += part.length; }
        return all.buffer;
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (track !== this._track) { reader.cancel(); throw new Error('moved on'); }
        parts.push(value);
        got += value.length;
        if (got >= at && got < total) {
          at *= 2;
          decode(joined(), got, false).catch(() => {}); // this part didn't decode: the next, or the whole file, will
        }
      }
      return joined();
    };

    const bytes = preloaded ? preloaded.catch(stream) : stream(); // a failed preload just loads normally
    this._loading = bytes
      .then((data) => decode(data, data.byteLength, true))
      .catch((err) => {
        if (track !== this._track) return;
        console.error('DeckAudio:', err);
        this._whole?.resolve(null);
        this._loading = null; // Play tries again
        this.paused = true;
        this._frames = 0;
        this._apply();
        this.dispatchEvent(new Event('error'));
      });
  }

  // Pushes the state to the worklet (rate) and the gain (volume, mute, silence when stopped).
  // snap: jump straight to the rate (Play starts at full speed) instead of gliding.
  _apply(snap = false) {
    const moving = !this._vid && this._frames > 0 && !this._stalled && (this._scratch !== null || !this.paused);
    const rate = moving ? this._scratch ?? 1 : 0;
    if (this.node) this.node.port.postMessage({ target: rate, snap });
    if (this.gain) {
      const level = moving && !this._muted ? this._volume : 0;
      this.gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.003); // a few ms: clean start and stop
    }
    if (this._vid && this._yp) {
      this._yp.setVolume(this._volume * 100);
      if (this._muted) this._yp.mute(); else this._yp.unMute();
    }
    const ticking = this._vid ? !this.paused : moving;
    if (ticking && !this._timer) this._timer = setInterval(() => { this._mixTick(); this.dispatchEvent(new Event('timeupdate')); }, 250);
    if (!ticking && this._timer) { clearInterval(this._timer); this._timer = 0; }
  }

  _report(data) {
    const c = this._cue;
    if ('mixStart' in data) {
      if (c?.track !== data.mixStart || !c.armed) return; // not a mix called off since (a seek crossed this message)
      c.started = true;
      this._mixing = { p: 0, show: !c.quick && c.plan?.type !== 'gapless' };
      if (this._mixing.show) this.dispatchEvent(new Event('mixstart'));
      return;
    }
    if ('handover' in data) return this._handover(data.handover);
    if ('mixEnd' in data) {
      if (!this._mixing || data.mixEnd !== this._track) return;
      const shown = this._mixing.show;
      this._mixing = null;
      if (shown) this.dispatchEvent(new Event('mixend'));
      if (this._planAfterMix) { this._planAfterMix = false; this._plan(); } // the song after this one, held back (_plan)
      return;
    }
    const { pos, rate, track } = data;
    if (track !== this._track || this.ctx.currentTime - this._seekAt < 0.02) return; // stale
    if (this._mixing && 'mix' in data) this._mixing.p = data.mix;
    this._pos = pos;
    this._rate = rate;
    this._at = this.ctx.currentTime;
    if (this._partial) { // the end of what's downloaded, not of the song: wait there for more
      if (!this._stalled && !this.paused && this._scratch === null && pos >= this._frames - 1) {
        this._stalled = true;
        this._apply();
      }
      return;
    }
    if (!this.paused && this._scratch === null && this._frames && pos >= this._frames - 1 && !c?.armed && !c?.started) {
      this.paused = true;
      this.ended = true;
      this._apply();
      this.dispatchEvent(new Event('ended'));
    }
  }

  // YouTube's player in .deck_video on the deck: made on the first video, then reused.
  _player() {
    return this._yt ??= new Promise((resolve, reject) => {
      if (window.YT?.Player) return resolve(window.YT);
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => reject(new Error('The YouTube player didn’t load.'));
      document.head.append(script);
    }).then((YT) => new Promise((ready) => {
      const box = document.createElement('div');
      box.className = 'deck_video';
      box.append(document.createElement('div'));
      (document.querySelector('.playback') || document.body).append(box);
      const S = YT.PlayerState;
      new YT.Player(box.firstElementChild, {
        playerVars: { playsinline: 1, rel: 0 },
        events: {
          onReady: (e) => { this._yp = e.target; this._apply(); ready(e.target); },
          onStateChange: ({ data }) => { // played, paused or ended from inside the video
            if (!this._vid) return;
            if (data === S.PLAYING) this._starting = false;
            if (data === S.PLAYING && this.paused) this.play();
            else if (data === S.PAUSED && !this.paused && !this._starting) this.pause(); // swapping videos passes through PAUSED
            else if (data === S.ENDED && !this.ended) {
              this.paused = this.ended = true;
              this._apply();
              this.dispatchEvent(new Event('ended'));
            }
          },
          onError: () => { if (this._vid) this.dispatchEvent(new Event('error')); },
        },
      });
      // Out of sight (a phone page without the deck, a hidden column), it doesn't play on.
      new IntersectionObserver(([e]) => { if (!e.isIntersecting && this._vid) this.pause(); }).observe(box);
    }));
  }

  play() {
    if (this._vid) {
      const vid = this._vid;
      if (this.ended) this.currentTime = 0;
      this.paused = this.ended = false;
      this._apply();
      this._player().then((p) => {
        if (vid !== this._vid || this.paused) return;
        if (p.getVideoData?.().video_id === vid) p.playVideo();
        else {
          this._starting = true;
          p.loadVideoById({ videoId: vid, startSeconds: this._startAt });
          this._startAt = 0;
        }
      }, (err) => {
        console.error('DeckAudio:', err);
        this.paused = true;
        this._apply();
        this.dispatchEvent(new Event('error'));
      });
      queueMicrotask(() => this.dispatchEvent(new Event('play')));
      return Promise.resolve();
    }
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
    if (this._vid) this._yp?.pauseVideo();
    queueMicrotask(() => this.dispatchEvent(new Event('pause')));
  }

  get scratchRate() { return this._scratch; }
  set scratchRate(rate) {
    if (this._vid) return; // no record to scratch
    if (rate !== null && this._scratch === null) this._interrupt();
    this._scratch = rate;
    this._apply();
  }

  get currentTime() {
    if (this._vid) return this._yp?.getVideoData?.().video_id === this._vid ? this._yp.getCurrentTime() || 0 : this._startAt;
    if (!this._frames) return this._startAt;
    const sr = this.ctx.sampleRate;
    if (this._wantPos !== null) return this._wantPos / sr;
    const rate = this.paused && this._scratch === null ? 0 : this._rate;
    const pos = this._pos + rate * (this.ctx.currentTime - this._at) * sr;
    return Math.min(Math.max(pos, 0), this._frames - 1) / sr;
  }
  set currentTime(seconds) {
    if (!this._vid) this._interrupt();
    if (!(this._vid ? this._yp?.getVideoData?.().video_id === this._vid : this._frames)) { // not loaded yet: start there
      this._startAt = Math.max(seconds, 0);
      this.dispatchEvent(new Event('timeupdate'));
      return;
    }
    if (this._vid) {
      this._yp.seekTo(Math.max(seconds, 0), true);
      this.ended = false;
      this.dispatchEvent(new Event('timeupdate'));
      return;
    }
    const want = Math.max(seconds * this.ctx.sampleRate, 0);
    if (this._partial && want > this._frames - 1) { // not downloaded that far yet: wait there, silent, until it is
      this._wantPos = want;
      this._stalled = true;
      this._apply();
      this.dispatchEvent(new Event('timeupdate'));
      return;
    }
    this._wantPos = null;
    this._pos = Math.min(want, this._frames - 1);
    this._at = this._seekAt = this.ctx.currentTime;
    this.ended = false;
    this.node.port.postMessage({ seek: this._pos, track: this._track }); // dropped if another song has taken over
    this.dispatchEvent(new Event('timeupdate'));
  }

  get duration() {
    if (this._vid) return (this._yp?.getVideoData?.().video_id === this._vid && this._yp.getDuration()) || this._hint;
    return this._frames ? (this._partial ? this._estimate : this._frames) / this.ctx.sampleRate : this._hint;
  }

  // A song put back as it was (player.js, after a reload or a new start): the seek bar shows its place and length
  // before it's decoded, and Play starts it there.
  resume(seconds, length) {
    this._startAt = Math.max(Number(seconds) || 0, 0);
    this._hint = Number(length) || NaN;
    this.dispatchEvent(new Event('timeupdate'));
  }

  get volume() { return this._volume; }
  set volume(value) { this._volume = value; this._apply(); }
  get muted() { return this._muted; }
  set muted(value) { this._muted = value; this._apply(); }

  // ---- Auto Mix ----

  get automix() { return this._automix; }
  set automix(on) {
    this._automix = !!on;
    if (on) {
      if (this._frames && !this._vid) this._level();
      return;
    }
    if (this._cue?.started || this._mixing) this.node?.port.postMessage({ commit: {} }); // one under way finishes
    else this._uncue();
    this._trim = 1;
    this.node?.port.postMessage({ trim: 1, glide: 1 });
  }
  get mixing() { return this._mixing?.show ? this._mixing : null; } // { p } for the queue's icon

  // The song to mix into next ({ src, id, gapless }), or null. It's fetched when this one nears its end (_mixTick),
  // then decoded, analysed, planned and handed to the worklet (_plan).
  cue(next) {
    const c = this._cue;
    if (c?.started) return; // mixing into it already
    const url = next ? new URL(next.src, location.href).href : null;
    if (c && c.url === url && c.id === next.id) {
      if (c.gapless !== !!next.gapless) { c.gapless = !!next.gapless; if (c.armed) this._plan(); }
      return;
    }
    this._uncue();
    if (!next || !this._automix || this._vid || url.startsWith('youtube:')) return;
    this._cue = { url, id: next.id, gapless: !!next.gapless, track: ++this._serial };
    this._mixTick();
  }
  // Lets the cued song go (unless it's playing already; `now`: even then, when this song is being replaced).
  _uncue(now = false) {
    const c = this._cue;
    if (!c || (c.started && !now)) return;
    this._cue = null;
    c.stop?.abort();
    if (c.loaded && !c.started) this.node?.port.postMessage({ cancel: true });
  }

  // The next song is fetched once this one is all in and near its end: about 2½ minutes before the mix point (1 minute
  // with Settings → Load ahead off), guessing that point 45 s from the end. One song ahead at most.
  _mixTick() {
    const c = this._cue;
    const lead = (pref('ahead') === 'off' ? 60 : 150) + 45;
    if (!c || c.stop || !this._frames || this._partial || this.duration - this.currentTime > lead) return;
    c.stop = new AbortController();
    this._fetchCue(c);
  }
  async _fetchCue(c) {
    try {
      const res = await fetch(c.url, { signal: c.stop.signal });
      if (!res.ok) throw new Error(`${res.status} ${res.url}`);
      const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
      if (this._cue !== c) return;
      Object.assign(c, { buffer, frames: buffer.length, analysis: this._analysis(c.id, () => Promise.resolve(buffer)) });
      c.analysis.then((b) => { c.b = b; });
      await this._plan();
    } catch (err) {
      if (this._cue === c && !c.loaded) { console.warn('Auto Mix: the next song didn’t load', err); this._cue = null; }
    }
  }

  // Plans the mix (automix.js, once both songs are analysed), puts the next song in the worklet's other voice and arms it.
  async _plan() {
    const c = this._cue;
    if (!c || c.quick || (!c.buffer && !c.loaded) || c.started) return; // quick: Next has taken it already (take())
    const [a, b] = c.gapless ? [null, null] : await Promise.all([this._analysis(this.id), c.analysis]);
    if (this._cue !== c || c.started) return;
    // The last mix may still be finishing (the song before fading out of the worklet's other voice): wait for its end.
    if (this._mixing) { this._planAfterMix = true; return; }
    const plan = AUTOMIX.plan(a, b, { gapless: c.gapless, trimA: this._trim, after: this.currentTime + 1 });
    this._load(c);
    const frames = AUTOMIX.toFrames(plan, a, b, this.ctx.sampleRate);
    Object.assign(c, { plan, armed: true, handAt: frames.bIn + frames.handover });
    this.node.port.postMessage({ mix: frames });
    if (pref('automixDebug')) console.info('Auto Mix:', plan.summary);
  }
  _load(c) { // the cued song into the worklet's other voice (a copy of each channel, handed over)
    if (c.loaded) return;
    const channels = Array.from({ length: c.buffer.numberOfChannels }, (_, i) => c.buffer.getChannelData(i).slice());
    this.node.port.postMessage({ cue: { channels, track: c.track } }, channels.map((ch) => ch.buffer));
    c.loaded = true;
    c.buffer = null;
  }

  // Next (or a click) on the song Auto Mix has ready: it starts now, from its first sound, without loading again.
  take(src) {
    const c = this._cue;
    if (!c || c.url !== new URL(src, location.href).href || !(c.loaded || c.buffer)) return false;
    if (this._mixing && !c.started) return false; // the last mix is still finishing: this one loads as usual
    const sr = this.ctx.sampleRate;
    this._load(c);
    if (!c.started) {
      if (!c.armed) {
        c.plan = AUTOMIX.plan(null, null, { gapless: true, trimA: c.gapless ? this._trim : AUTOMIX.trim(c.b) });
        this.node.port.postMessage({ mix: AUTOMIX.toFrames(c.plan, null, null, sr) });
        c.armed = true;
      }
      c.quick = true;
      c.handAt = (c.b?.start || 0) * sr;
      this.node.port.postMessage({ commit: { bIn: c.handAt } });
    } else this.node.port.postMessage({ commit: {} });
    this.paused = false;
    this.ended = false;
    this.ctx.resume();
    this._apply(true);
    return true;
  }

  // A seek or a scratch. Before the next song takes over, the mix is called off (this song comes back as it was) and
  // planned again half a second later; after, the mix just finishes.
  _interrupt() {
    const c = this._cue;
    if (c?.armed || c?.started) {
      this.node.port.postMessage({ disarm: true });
      if (this._mixing?.show) this.dispatchEvent(new Event('mixend'));
      this._mixing = null;
      c.armed = c.started = false;
      clearTimeout(this._replan);
      this._replan = setTimeout(() => this._plan(), 500);
    } else if (this._mixing) this.node.port.postMessage({ finish: true }); // the song going out goes now
  }

  // The next song has taken over (the worklet made it its main voice): from here DeckAudio describes it, and says so
  // with 'mixed' then 'play', like a song just started.
  _handover(track) {
    const c = this._cue;
    if (!c || c.track !== track) return;
    this._cue = null;
    this._abort?.abort();
    Object.assign(this, { _src: c.url, id: c.id, _track: track, _frames: c.frames, _estimate: c.frames, _partial: false,
      _stalled: false, _wantPos: null, _startAt: 0, _hint: NaN, _loading: Promise.resolve(), _pos: c.handAt,
      _at: this.ctx.currentTime, ended: false, _trim: this._automix ? c.plan?.trimB ?? 1 : 1 });
    if (!this._automix) this.node.port.postMessage({ trim: 1, glide: 1 });
    this.dispatchEvent(new Event('mixed'));
    this.dispatchEvent(new Event('play'));
    this.dispatchEvent(new Event('timeupdate'));
  }

  // This song's analysis (from the server, or worked out once it's decoded in full) and its level from it. Turned on
  // when the song is all in already, it's fetched and decoded again for that (usually from the browser's cache).
  _level() {
    const id = this.id, track = this._track;
    if (!ANALYSES.has(id) && !this._whole && (this._partial || !this._frames)) {
      let resolve;
      this._whole = { promise: new Promise((r) => { resolve = r; }), resolve };
    }
    const src = this._src, pending = this._whole?.promise; // taken now: _whole is let go once the song is in
    const whole = pending ? () => pending
      : () => fetch(src).then((r) => r.arrayBuffer()).then((bytes) => this.ctx.decodeAudioData(bytes)).catch(() => null);
    this._analysis(id, whole).then((a) => {
      if (track !== this._track || !this._automix || !a) return;
      this._trim = AUTOMIX.trim(a);
      this.node?.port.postMessage({ trim: this._trim, glide: this.currentTime > 1 ? 3 : 0.05 });
    });
  }
  // A song's analysis: kept for the session, and on the server (api/mix.js) so each song is analysed once; else worked
  // out from whole() (its decoded buffer, or null, asked for only then) and sent there.
  _analysis(id, whole = () => Promise.resolve(null)) {
    if (id && ANALYSES.has(id)) return ANALYSES.get(id);
    const url = MIX_API + encodeURIComponent(id || '');
    const job = (id ? fetch(url).then((r) => (r.ok ? r.json() : null)) : Promise.resolve(null)).catch(() => null)
      .then((saved) => (saved?.v === AUTOMIX.VERSION ? saved : whole().then((buffer) => buffer && analyse(buffer)).then((a) => {
        if (a && id) fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).catch(() => {});
        return a;
      })))
      .catch(() => null);
    if (id) {
      ANALYSES.set(id, job);
      job.then((a) => { if (!a && ANALYSES.get(id) === job) ANALYSES.delete(id); }); // not kept: tried again next time
    }
    return job;
  }

  // Fetches a song's bytes ahead of time (one at a time), so switching to it skips the download.
  preload(url) {
    if (url.startsWith('youtube:')) return; // YouTube loads its own
    url = new URL(url, location.href).href;
    if (url === this._src || this._next?.url === url) return;
    this._next?.stop.abort(); // the one fetched before isn't next any more
    const stop = new AbortController();
    // Only after the current song has loaded, so the two downloads don't share the bandwidth. If you skip to it first,
    // the song before is let go (src), and this starts at once.
    const bytes = Promise.resolve(this._loading).then(() => fetch(url, { signal: stop.signal })).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.url}`);
      return r.arrayBuffer();
    });
    bytes.catch(() => {}); // a failed preload just means a normal load later
    this._next = { url, bytes, stop };
  }
}
