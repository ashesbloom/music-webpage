// ACRUX deck: one Web Audio engine for all playback. It stands in for `new Audio()` with the surface the player uses
// (src, play/pause, paused, ended, currentTime, duration, volume, muted; play/pause/timeupdate/ended/error/canplay events),
// plus scratchRate for the record (turntable.js). It needs the site served over http (node server.js), not file://.
// A YouTube song (src "youtube:<videoId>") plays in YouTube's own player instead, as a screen on the deck (.playback
// gets .video): YouTube's rules want the video seen (at least 200×200, uncovered, never playing out of sight), so
// sound alone isn't allowed. The same surface drives it, so the header, queue and seek bar work unchanged.
const DECK_WORKLET = new URL('deck-audio-worklet.js', document.currentScript.src).href;

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
    this._track++;
    this._abort?.abort(); // the last song's download stops now, not at its next chunk: a stalled one held a connection
    this._loading = null; // the new song loads on play(), like <audio preload="none">
    this._apply();
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
    if (ticking && !this._timer) this._timer = setInterval(() => this.dispatchEvent(new Event('timeupdate')), 250);
    if (!ticking && this._timer) { clearInterval(this._timer); this._timer = 0; }
  }

  _report({ pos, rate, track }) {
    if (track !== this._track || this.ctx.currentTime - this._seekAt < 0.02) return; // stale
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
    if (!this.paused && this._scratch === null && this._frames && pos >= this._frames - 1) {
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
    this.node.port.postMessage({ seek: this._pos });
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
