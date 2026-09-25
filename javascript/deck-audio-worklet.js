// ACRUX deck: plays the decoded track at any signed rate, so the record can be scratched backwards and forwards.
// Loaded by DeckAudio (deck-audio.js) as an AudioWorklet; render() is the pure DSP core (tests/deck-audio.test.js).

const SMOOTH_MS = 8; // rate changes glide over ~8 ms, so hand movement never zips or clicks
const FADE_MS = 3;   // a seek fades out, jumps and fades back in, 3 ms each way
const STILL = 50;    // below 1/50 of normal speed the sound fades out: a stylus that isn't moving makes no sound

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
          Object.assign(this.s, { pos: 0, rate: 0, motion: 0, seekTo: null, gain: 1, track: data.track });
        }
        if ('target' in data) {
          this.s.target = data.target;
          if (data.snap) Object.assign(this.s, { rate: data.target, motion: Math.min(1, Math.abs(data.target) * STILL) });
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
