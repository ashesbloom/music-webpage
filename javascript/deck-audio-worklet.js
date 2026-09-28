// ACRUX deck: plays the decoded track at any signed rate, so the record can be scratched backwards and forwards, and
// for Auto Mix mixes it into the next song: a second voice, beat-locked to it, through a 3-band isolator, a sweep filter
// and an echo. Loaded by DeckAudio (deck-audio.js) as an AudioWorklet; render() and Deck are the pure DSP
// (tests/deck-audio.test.js, tests/automix.test.js). The mix plans come from automix.js, in frames.

const SMOOTH_MS = 8; // rate changes glide over ~8 ms, so hand movement never zips or clicks
const FADE_MS = 3;   // a seek fades out, jumps and fades back in, 3 ms each way
const STILL = 50;    // below 1/50 of normal speed the sound fades out: a stylus that isn't moving makes no sound
const EQ_MS = 20;    // the isolator fades in and out over 20 ms (its all-pass phase isn't the dry signal's)
const TRIM_MS = 50;  // a song's level (Auto Mix's trim) glides over 50 ms unless told to take longer

function makeState(sampleRate) {
  return {
    pos: 0,       // playhead, in frames (fractional)
    rate: 0,      // current rate: 1 = normal, negative = backwards
    motion: 0,    // 0..1 level from how fast the record moves (silent when still)
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
      out[c][i] = s.gain * s.motion * (y1 + 0.5 * t * (y2 - y0 + t * (2 * y0 - 5 * y1 + 4 * y2 - y3 + t * (3 * (y1 - y2) + y3 - y0))));
    }
    s.rate += (s.target - s.rate) * s.k;
    s.motion += (Math.min(1, Math.abs(s.rate) * STILL) - s.motion) * s.k;
    s.pos = Math.min(Math.max(s.pos + s.rate, 0), last);
  }
}

// A new track starts at its beginning; more of the same track (a longer decoded part) keeps the playhead where it is.
function load(s, { track, keep }) {
  if (!keep) Object.assign(s, { pos: 0, rate: 0, motion: 0, seekTo: null, gain: 1, track });
}

// ---- Auto Mix ----

// Catmull-Rom read at a fractional position, silent outside the song (a mix can run past either end of one).
function read(ch, pos) {
  const last = ch.length - 1;
  if (!(pos >= 0 && pos <= last)) return 0;
  const i1 = Math.floor(pos), t = pos - i1;
  const y0 = ch[Math.max(i1 - 1, 0)], y1 = ch[i1], y2 = ch[Math.min(i1 + 1, last)], y3 = ch[Math.min(i1 + 2, last)];
  return y1 + 0.5 * t * (y2 - y0 + t * (2 * y0 - 5 * y1 + 4 * y2 - y3 + t * (3 * (y1 - y2) + y3 - y0)));
}

// Beat times (frames) ↔ beat numbers, carried on past either end at the nearest spacing.
function frameAt(beats, i) {
  const n = beats.length;
  if (i <= 0) return beats[0] + i * (beats[1] - beats[0]);
  if (i >= n - 1) return beats[n - 1] + (i - n + 1) * (beats[n - 1] - beats[n - 2]);
  const k = Math.floor(i);
  return beats[k] + (i - k) * (beats[k + 1] - beats[k]);
}
function beatAt(beats, pos) {
  const n = beats.length;
  if (pos <= beats[0]) return (pos - beats[0]) / (beats[1] - beats[0]);
  if (pos >= beats[n - 1]) return n - 1 + (pos - beats[n - 1]) / (beats[n - 1] - beats[n - 2]);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (beats[mid] <= pos) lo = mid; else hi = mid; }
  return lo + (pos - beats[lo]) / (beats[hi] - beats[lo]);
}

// RBJ biquads [b0, b1, b2, a1, a2], run as transposed direct form II.
function biquad(type, f, sr) {
  const w = 2 * Math.PI * f / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2), a0 = 1 + al;
  const b = type === 'lp' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : type === 'hp' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [1 - al, -2 * c, 1 + al];
  return [b[0] / a0, b[1] / a0, b[2] / a0, -2 * c / a0, (1 - al) / a0];
}
function run(k, z, x) {
  const y = k[0] * x + z[0];
  z[0] = k[1] * x - k[3] * y + z[1];
  z[1] = k[2] * x - k[4] * y;
  return y;
}

// A DJ isolator: low < 200 Hz, mid, high > 3 kHz, split by Linkwitz-Riley crossovers (each two Butterworths), the low
// band through the upper crossover's all-pass so the bands stay in phase: at unity the sum is flat, a band at 0 kills it.
function makeIsolator(sr) {
  const k = { lo: biquad('lp', 200, sr), hi: biquad('hp', 200, sr), lo2: biquad('lp', 3000, sr), hi2: biquad('hp', 3000, sr), ap: biquad('ap', 3000, sr) };
  const z = () => Array.from({ length: 2 }, () => Array.from({ length: 9 }, () => [0, 0]));
  const s = z();
  return (x, c, gl, gm, gh) => {
    const q = s[c];
    const low = run(k.ap, q[8], run(k.lo, q[1], run(k.lo, q[0], x)));
    const rest = run(k.hi, q[3], run(k.hi, q[2], x));
    const mid = run(k.lo2, q[5], run(k.lo2, q[4], rest));
    const high = run(k.hi2, q[7], run(k.hi2, q[6], rest));
    return gl * low + gm * mid + gh * high;
  };
}

// A state-variable high-pass (Zavalishin's TPT form: stays clean while its cutoff sweeps), per channel.
function makeSweep() {
  const s = [[0, 0], [0, 0]];
  let a1 = 0, a2 = 0, a3 = 0;
  return {
    tune(f, sr) { const g = Math.tan(Math.PI * Math.min(f, sr * 0.45) / sr); a1 = 1 / (1 + g * (g + Math.SQRT2)); a2 = g * a1; a3 = g * a2; },
    run(x, c) {
      const q = s[c];
      const v3 = x - q[1], v1 = a1 * q[0] + a2 * v3, v2 = q[1] + a2 * q[0] + a3 * v3;
      q[0] = 2 * v1 - q[0]; q[1] = 2 * v2 - q[1];
      return x - Math.SQRT2 * v1 - v2;
    },
  };
}

// An echo: 2 s of delay per channel, fed back through a 250 Hz high-pass so the repeats thin out as they fade.
function makeEcho(sr) {
  const size = Math.ceil(2 * sr), buf = [new Float32Array(size), new Float32Array(size)], hp = [[0, 0], [0, 0]];
  const a = 1 / (1 + 2 * Math.PI * 250 / sr);
  let w = 0;
  return {
    run(x, c, send, delay, feedback) {
      const wet = buf[c][(w - Math.round(delay) + size) % size];
      const h = hp[c], y = a * (h[1] + wet - h[0]);
      h[0] = wet; h[1] = y;
      buf[c][w] = send * x + feedback * y;
      return wet;
    },
    next() { w = (w + 1) % size; },
  };
}

const LANES = { gain: 1, low: 1, mid: 1, high: 1, hp: 20, echo: 0 };
// A lane's value at t: straight lines between its [t, value] points, held before the first and after the last.
function lane(points, t, value) {
  if (!points || !points.length) return value;
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i];
    if (t <= t1) { const [t0, v0] = points[i - 1]; return t1 > t0 ? v0 + (v1 - v0) * (t - t0) / (t1 - t0) : v1; }
  }
  return points[points.length - 1][1];
}
const values = (side, t) => Object.fromEntries(Object.entries(LANES).map(([name, v]) => [name, lane(side[name], t, v)]));
const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const soft = (x) => (Math.abs(x) <= 0.9 ? x : Math.sign(x) * (0.9 + 0.1 * Math.tanh((Math.abs(x) - 0.9) / 0.1))); // two songs at once never clip

function makeVoice(sampleRate) {
  return { channels: null, s: makeState(sampleRate), trim: 1, trimTo: 1, trimK: 1 - Math.exp(-1 / (sampleRate * TRIM_MS / 1000)),
    eq: 0, iso: null, sweep: null, echo: null, now: { ...LANES }, was: { ...LANES } };
}

// The deck: voice `main` is the song DeckAudio reports; while a mix runs, the other voice is the next song.
// Messages (from DeckAudio): {channels, track, keep} the main song (or more of it), {target, snap} a rate, {seek} a
// frame (for song `track`: a seek meant for another song is dropped), {trim, glide} its level; {cue: {channels,
// track}} the next song into the other voice; {mix: plan} arm the mix (not over one under way); {commit: {bIn}} finish
// it now (A fades out in 150 ms; B starts now at bIn if it hadn't); {disarm} call it off
// but keep the next song (a mix under way: B fades out in 20 ms and A comes back as it was, unless B has already
// taken over, when it finishes instead); {cancel} the same, and forget the next song; {finish} end one that has
// taken over at once (a seek or scratch of the new song: the old one goes within a block). process() returns the messages
// for DeckAudio: {pos, rate, track[, mix]} every 8 blocks (~21 ms), and {mixStart}, {handover} (main is now B) with
// B's track, and {mixEnd} with the main voice's.
class Deck {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.voices = [makeVoice(sampleRate), makeVoice(sampleRate)];
    this.main = 0;
    this.mix = null;
    this.blocks = 0;
    this.rate = 0; // the main voice's rate over the last block (a locked voice has no rate of its own)
    this.out = [];  // messages for DeckAudio, sent after the next block
  }

  message(data) {
    const v = this.voices[this.main], o = this.voices[1 - this.main];
    if (data.channels) {
      v.channels = data.channels;
      load(v.s, data);
      if (!data.keep) { this.mix = null; o.channels = null; this.clear(); }
    }
    if ('target' in data) {
      for (const x of this.voices) {
        x.s.target = data.target;
        if (data.snap) Object.assign(x.s, { rate: data.target, motion: Math.min(1, Math.abs(data.target) * STILL) });
      }
    }
    if ('seek' in data && (data.track === undefined || data.track === v.s.track)) {
      v.s.seekTo = data.seek;
      if (this.mix?.handed) this.mix.cut = true; // the new song moved: the old one goes now, not by its fade
    }
    if (data.finish && this.mix?.started) {
      if (this.mix.handed) this.mix.cut = true;
      else this.commit({});
    }
    if ('trim' in data && Number.isFinite(data.trim)) {
      v.trimTo = data.trim;
      v.trimK = 1 - Math.exp(-1 / (this.sr * Math.max(data.glide || TRIM_MS / 1000, 0.001)));
    }
    if (data.cue) {
      o.channels = data.cue.channels;
      load(o.s, { track: data.cue.track });
      Object.assign(o, { eq: 0, iso: null, sweep: null, echo: null });
    }
    if (data.mix && o.channels && !this.mix?.started) this.arm(data.mix);
    if (data.commit) this.commit(data.commit);
    if (data.disarm || data.cancel) {
      if (this.mix?.handed) this.commit({});
      else if (this.mix?.started) this.abort(!!data.cancel);
      else { this.mix = null; if (data.cancel) o.channels = null; }
    }
  }

  // Both voices back to plain playback: no isolator, filter or echo, lanes at rest.
  clear() {
    for (const v of this.voices) Object.assign(v, { eq: 0, iso: null, sweep: null, echo: null, now: { ...LANES }, was: { ...LANES } });
  }

  arm(plan) {
    const A = this.voices[this.main], B = this.voices[1 - this.main];
    this.clear();
    this.mix = { ...plan, a: this.main, b: 1 - this.main, started: false, handed: false, ending: false };
    A.was = values(plan.lanes.a, -Infinity);
    B.trimTo = B.trim = Number.isFinite(plan.trimB) ? plan.trimB : 1;
    B.was = values(plan.lanes.b, 0);
    for (const [v, side] of [[A, plan.lanes.a], [B, plan.lanes.b]]) {
      v.iso = side.low || side.mid || side.high ? makeIsolator(this.sr) : null;
      v.sweep = side.hp ? makeSweep() : null;
      v.echo = side.echo ? makeEcho(this.sr) : null;
    }
  }

  // B starts: `over` frames of A past its out point (at A's rate) become B's first frames.
  start(over, rateA) {
    const m = this.mix, A = this.voices[m.a], B = this.voices[m.b];
    B.s.pos = m.bIn + over / Math.max(Math.abs(rateA), 1e-6);
    Object.assign(B.s, { target: A.s.target, rate: A.s.target, motion: A.s.motion, gain: 1, seekTo: null });
    m.started = true;
    this.out.push({ mixStart: B.s.track });
  }

  commit({ bIn }) {
    const m = this.mix;
    if (!m) return;
    const A = this.voices[m.a], B = this.voices[m.b];
    if (!m.started) {
      if (bIn !== undefined) m.bIn = bIn;
      this.start(0, 1);
    }
    const t = B.s.pos - m.bIn, q = 0.15 * this.sr, e = 0.02 * this.sr;
    const hold = (v) => Object.fromEntries(Object.entries(v.now).map(([name, x]) => [name, [[t, x]]]));
    m.lanes = { a: { ...hold(A), gain: [[t, A.now.gain], [t + q, 0]], echo: [[t, 0]] },
      b: { gain: [[t, B.now.gain], [t + e, 1]], low: [[t, B.now.low], [t + e, 1]], mid: [[t, B.now.mid], [t + e, 1]], high: [[t, B.now.high], [t + e, 1]] } };
    m.lock = false;
    m.pre = 0;
    m.handover = Math.min(m.handover, t);
    m.len = t + q;
    A.s.rate = A.s.target;
  }

  // Called off under way: A back to how it was (unlocked, at its own speed), B out in 20 ms.
  abort(forget) {
    const m = this.mix, A = this.voices[m.a], B = this.voices[m.b];
    const t = B.s.pos - m.bIn, e = 0.02 * this.sr;
    const back = (name, to) => [[t, A.now[name]], [t + e, to]];
    m.lanes = { a: { gain: back('gain', 1), low: back('low', 1), mid: back('mid', 1), high: back('high', 1), hp: [[t, 20]], echo: [[t, 0]] },
      b: { gain: [[t, B.now.gain], [t + e, 0]] } };
    Object.assign(m, { lock: false, pre: 0, handover: Infinity, len: t + e, aborted: true, forget });
    A.s.rate = A.s.target;
  }

  process(out) {
    if (this.mix) this.mixBlock(out);
    else {
      const v = this.voices[this.main];
      if (!v.channels) for (const ch of out) ch.fill(0);
      else {
        render(v.channels, v.s, out);
        if (v.trim !== 1 || v.trimTo !== 1) {
          for (let i = 0; i < out[0].length; i++) {
            v.trim += (v.trimTo - v.trim) * v.trimK;
            for (const ch of out) ch[i] *= v.trim;
          }
        }
      }
      this.rate = v.s.rate;
    }
    if (++this.blocks % 8 === 0) {
      const v = this.voices[this.main], m = this.mix;
      const msg = { pos: v.s.pos, rate: this.rate, track: v.s.track };
      if (m?.started) msg.mix = Math.min(1, Math.max(0, (this.voices[m.b].s.pos - m.bIn) / Math.max(m.len, 1)));
      this.out.push(msg);
    }
    const msgs = this.out;
    this.out = [];
    return msgs;
  }

  mixBlock(out) {
    const m = this.mix, A = this.voices[m.a], B = this.voices[m.b], sr = this.sr, n = out[0].length;
    const lastA = A.channels ? A.channels[0].length : 0;
    const aOut = m.aOut ?? lastA; // null: straight after A's last sample
    const t = m.started ? B.s.pos - m.bIn : A.s.pos - aOut;
    A.now = values(m.lanes.a, t);
    B.now = values(m.lanes.b, Math.max(t, 0));
    if (m.cut) { A.now = { ...LANES, gain: 0 }; B.now = { ...LANES }; m.ending = true; } // out within this block
    if (A.sweep) A.sweep.tune(A.now.hp, sr);
    const startMain = this.main, startPos = this.voices[startMain].s.pos;
    const eqStep = 1 / (sr * EQ_MS / 1000);
    for (let i = 0; i < n; i++) {
      const x = i / n;
      if (!m.started && A.s.pos >= aOut) this.start(A.s.pos - aOut, A.s.rate * (m.pre > 0 ? m.ratio : 1));
      const tt = m.started ? B.s.pos - m.bIn : -1;
      if (m.started && !m.handed && tt >= m.handover) {
        m.handed = true;
        this.main = m.b;
        this.out.push({ handover: B.s.track });
      }
      if (m.started && tt >= m.len) m.ending = true;
      for (const [v, on] of [[A, m.started && !m.ending], [B, m.started && !m.ending]]) {
        const want = on && v.iso ? 1 : 0;
        v.eq = want > v.eq ? Math.min(1, v.eq + eqStep) : Math.max(0, v.eq - eqStep);
      }
      let l = 0, r = 0;
      for (const v of m.started ? [A, B] : [A]) {
        const s = v.s;
        if (s.seekTo !== null) { s.gain = Math.max(0, s.gain - s.fadeStep); if (s.gain === 0) { s.pos = s.seekTo; s.seekTo = null; } }
        else if (s.gain < 1) s.gain = Math.min(1, s.gain + s.fadeStep);
        const g = v.was.gain + (v.now.gain - v.was.gain) * x;
        const level = s.gain * (v === A && m.lock && m.started ? B.s.motion : s.motion);
        v.trim += (v.trimTo - v.trim) * v.trimK;
        for (let c = 0; c < Math.min(out.length, 2); c++) {
          let y = read(v.channels[Math.min(c, v.channels.length - 1)], s.pos) * level;
          if (v.eq > 0 && v.iso) {
            const eqd = v.iso(y, c, v.was.low + (v.now.low - v.was.low) * x, v.was.mid + (v.now.mid - v.was.mid) * x, v.was.high + (v.now.high - v.was.high) * x);
            y += (eqd - y) * v.eq;
          }
          if (v.sweep && v.now.hp > 25) y = v.sweep.run(y, c);
          const wet = v.echo ? v.echo.run(y, c, v.was.echo + (v.now.echo - v.was.echo) * x, m.echo.delay, m.echo.feedback) : 0;
          const o = (y * g + wet) * v.trim;
          if (c === 0) l += o; else r += o;
        }
        if (out.length === 1) r = l;
        v.echo?.next();
      }
      out[0][i] = soft(l);
      for (let c = 1; c < out.length; c++) out[c][i] = soft(r);
      // Advance: B at its own rate, A locked to B's beats (or on its own, gliding to B's tempo before B starts).
      for (const v of [A, B]) {
        v.s.rate += (v.s.target - v.s.rate) * v.s.k;
        v.s.motion += (Math.min(1, Math.abs(v.s.rate) * STILL) - v.s.motion) * v.s.k;
      }
      if (m.started) B.s.pos += B.s.rate;
      if (m.started && m.lock) A.s.pos = frameAt(m.beatsA, m.beatA0 + m.k * (beatAt(m.beatsB, B.s.pos) - m.beatB0));
      else A.s.pos += A.s.rate * (m.started || !(m.pre > 0) ? 1 : 1 + (m.ratio - 1) * smoothstep((A.s.pos - (aOut - m.pre)) / m.pre));
    }
    A.was = A.now;
    B.was = B.now;
    this.rate = this.main === startMain ? (this.voices[this.main].s.pos - startPos) / n : this.voices[this.main].s.rate;
    if (m.ending && ((A.eq === 0 && B.eq === 0) || m.cut)) { // the one that goes: A, or B when the mix was called off
      const gone = m.aborted ? B : A;
      if (!m.aborted || m.forget) gone.channels = null;
      this.clear();
      this.mix = null;
      this.out.push({ mixEnd: this.voices[this.main].s.track });
    }
  }
}

if (typeof registerProcessor === 'function') {
  registerProcessor('deck-audio', class extends AudioWorkletProcessor {
    constructor() {
      super();
      this.deck = new Deck(sampleRate);
      this.port.onmessage = ({ data }) => this.deck.message(data);
    }

    process(inputs, outputs) {
      for (const msg of this.deck.process(outputs[0])) this.port.postMessage(msg);
      return true;
    }
  });
}

if (typeof module === 'object') module.exports = { render, makeState, load, Deck, makeIsolator, frameAt, beatAt };
