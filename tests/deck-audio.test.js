// DSP checks for the deck worklet, and Auto Mix's second voice: node --test tests/deck-audio.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { render, makeState, load } = require('../javascript/deck-audio-worklet.js');

const SR = 48000;
const ramp = (n) => Float32Array.from({ length: n }, (_, i) => i / n); // rising line, so direction shows
const run = (channels, s, frames) => {
  const out = [new Float32Array(frames), new Float32Array(frames)];
  render(channels, s, out);
  return out;
};
const moving = (rate, pos = 0) => Object.assign(makeState(SR), { rate, target: rate, pos, motion: rate ? 1 : 0 });

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

test('a record held still is silent, even over a loud sample', () => {
  const dc = new Float32Array(48000).fill(0.5);
  const [still] = run([dc], Object.assign(makeState(SR), { pos: 100 }), 480); // grabbed while paused: never moving
  assert.ok(still.every((x) => x === 0), 'a record that never moves makes no sound');
  const s = moving(1, 100);
  s.target = 0; // the hand stops a moving record
  const [l] = run([dc], s, 4800); // 100 ms later
  assert.ok(Math.abs(l[4799]) < 0.01, `a stopped record still outputs ${l[4799]}`);
});

test('more of the same track keeps the playhead; a new track starts at 0', () => {
  const s = moving(1, 500);
  load(s, { track: 1, keep: true }); // a longer decoded part of the song playing
  assert.equal(s.pos, 500);
  assert.equal(s.rate, 1);
  load(s, { track: 2 });
  assert.equal(s.pos, 0);
  assert.equal(s.track, 2);
});

// ---- Auto Mix: the second voice ----
const { Deck, makeIsolator, frameAt, beatAt } = require('../javascript/deck-audio-worklet.js');
const AUTOMIX = require('../javascript/automix.js');
const close = (x, y, tol, what) => assert.ok(Math.abs(x - y) <= tol, `${what}: ${x} not within ${tol} of ${y}`);
const deckWith = (a, b, plan) => {
  const d = new Deck(SR);
  d.message({ channels: [a], track: 1 });
  d.message({ target: 1, snap: true });
  d.message({ cue: { channels: [b], track: 2 } });
  d.message({ mix: plan });
  return d;
};
const play = (d, frames) => {
  const left = [], msgs = [];
  for (let n = 0; n < frames; n += 128) {
    const out = [new Float32Array(128), new Float32Array(128)];
    for (const m of d.process(out)) msgs.push({ ...m, at: n });
    left.push(...out[0]);
  }
  return { left, msgs };
};

test('engine: gapless: B\'s first sample follows A\'s last', () => {
  const a = Float32Array.from({ length: 1000 }, (_, i) => 0.4 * (i + 1) / 1000);
  const b = Float32Array.from({ length: 1000 }, (_, i) => -0.4 * (i + 1) / 1000);
  const plan = AUTOMIX.toFrames(AUTOMIX.plan(null, null, { gapless: true }), null, null, SR);
  const { left, msgs } = play(deckWith(a, b, plan), 2048);
  for (let i = 0; i < 2000; i++) close(left[i], i < 1000 ? a[i] : b[i - 1000], 1e-6, `sample ${i}`);
  assert.deepEqual(msgs.filter((m) => !('pos' in m)).map((m) => Object.keys(m)[0]), ['mixStart', 'handover', 'mixEnd']);
});

test('engine: beat lock: A 3% slower and B drifting, their beats line up to 1 ms over the blend', () => {
  const beatsA = Float64Array.from({ length: 200 }, (_, i) => 48000 + i * 24000); // 120 BPM
  const beatsB = new Float64Array(200); // ~123.6 BPM, each beat ±0.5% off
  for (let i = 1; i < 200; i++) beatsB[i] = beatsB[i - 1] + 23300 * (1 + 0.005 * Math.sin(i));
  const silent = (n) => new Float32Array(n);
  const beatA0 = 64, beatB0 = 0, L = 32; // B's beat 0 comes in on A's beat 64, for 8 bars
  const plan = { type: 'blend', aOut: beatsA[beatA0], bIn: beatsB[beatB0], pre: beatsA[beatA0] - beatsA[beatA0 - 32], ratio: 24000 / 23300, k: 1,
    lock: true, beatsA, beatsB, beatA0, beatB0, lanes: { a: {}, b: {} }, handover: 16 * 23300, len: L * 23300, echo: null, trimB: 1 };
  const d = deckWith(silent(6e6), silent(6e6), plan);
  d.voices[0].s.pos = beatsA[beatA0 - 40];
  let last = null, started = false, worst = 0, jump = 0;
  for (let n = 0; n < 40 * 24000 && d.mix; n += 128) {
    d.process([new Float32Array(128), new Float32Array(128)]);
    const A = d.voices[d.mix?.a ?? 0].s, B = d.voices[d.mix?.b ?? 1].s;
    if (!d.mix) break;
    if (last !== null) jump = Math.max(jump, Math.abs(A.pos - last - 128 * (started ? 24000 / 23300 : 1)));
    last = A.pos;
    if (d.mix.started) {
      started = true;
      const want = frameAt(beatsA, beatA0 + beatAt(beatsB, B.pos) - beatB0);
      worst = Math.max(worst, Math.abs(A.pos - want));
    }
  }
  assert.ok(started, 'B started');
  assert.ok(worst < 48, `off by ${worst} frames`);
  assert.ok(jump < 128 * 0.06, `A's playhead jumped ${jump} frames in a block`); // no skips at the handoff to the lock
});

test('engine: the isolator is flat at unity and kills a band at 0', () => {
  const iso = makeIsolator(SR);
  let seed = 7;
  const noise = Float32Array.from({ length: SR }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1);
  const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
  close(20 * Math.log10(rms(noise.map((x) => iso(x, 0, 1, 1, 1))) / rms(noise)), 0, 0.3, 'dB at unity');
  const low = Float32Array.from({ length: SR }, (_, i) => Math.sin(2 * Math.PI * 50 * i / SR));
  const kill = makeIsolator(SR);
  const killed = low.map((x) => kill(x, 0, 0, 1, 1));
  assert.ok(20 * Math.log10(rms(killed.slice(SR / 2)) / rms(low)) < -30, 'a 50 Hz tone with the low killed');
});

test('engine: commit finishes a mix at once: B is main, A gone within 170 ms', () => {
  const beats = Float64Array.from({ length: 100 }, (_, i) => i * 24000);
  const plan = { type: 'blend', aOut: 48000, bIn: 0, pre: 0, ratio: 1, k: 1, lock: true, beatsA: beats, beatsB: beats, beatA0: 2, beatB0: 0,
    lanes: { a: {}, b: { gain: [[0, 0], [96000, 1]] } }, handover: 96000, len: 192000, echo: null, trimB: 1 };
  const d = deckWith(new Float32Array(1e6), new Float32Array(1e6), plan);
  play(d, 50000);
  assert.ok(d.mix?.started, 'mixing');
  d.message({ commit: {} });
  const { msgs } = play(d, 0.17 * SR);
  assert.ok(msgs.some((m) => m.handover === 2) && msgs.some((m) => m.mixEnd === 2), JSON.stringify(msgs.filter((m) => !('pos' in m))));
  assert.equal(d.main, 1);
  assert.equal(d.mix, null);
});

test('engine: called off under way (a seek before the handover), A comes back and B stays loaded', () => {
  const beats = Float64Array.from({ length: 100 }, (_, i) => i * 24000);
  const plan = { type: 'blend', aOut: 48000, bIn: 0, pre: 0, ratio: 1, k: 1, lock: true, beatsA: beats, beatsB: beats, beatA0: 2, beatB0: 0,
    lanes: { a: { gain: [[0, 1], [192000, 0]] }, b: { gain: [[0, 0], [96000, 1]] } }, handover: 96000, len: 192000, echo: null, trimB: 1 };
  const d = deckWith(new Float32Array(1e6).fill(0.1), new Float32Array(1e6).fill(0.2), plan);
  play(d, 60000);
  d.message({ disarm: true });
  const { msgs, left } = play(d, 0.05 * SR);
  assert.ok(msgs.some((m) => m.mixEnd === 1), 'ends with A as the song');
  assert.equal(d.main, 0);
  assert.ok(d.voices[1].channels, 'B kept for another try');
  close(left.at(-1), 0.1, 1e-3, 'A at full level, B gone');
});

test('engine: a new song in the middle of a blend, then a mix without EQ: no error', () => {
  const beats = Float64Array.from({ length: 100 }, (_, i) => i * 24000);
  const blend = { type: 'blend', aOut: 48000, bIn: 0, pre: 0, ratio: 1, k: 1, lock: true, beatsA: beats, beatsB: beats, beatA0: 2, beatB0: 0,
    lanes: { a: { low: [[0, 1], [96000, 0]] }, b: { low: [[0, 0], [96000, 1]] } }, handover: 96000, len: 192000, echo: null, trimB: 1 };
  const d = deckWith(new Float32Array(1e6), new Float32Array(1e6), blend);
  play(d, 60000); // B is in, the isolators are on
  d.message({ channels: [new Float32Array(2e5).fill(0.1)], track: 3 }); // another song picked
  d.message({ cue: { channels: [new Float32Array(2e5)], track: 4 } });
  d.message({ mix: AUTOMIX.toFrames(AUTOMIX.plan(null, null, { gapless: true }), null, null, SR) });
  assert.doesNotThrow(() => play(d, 4096));
});

test('engine: after the handover, a seek ends the mix at once (the old song gone within a block)', () => {
  const beats = Float64Array.from({ length: 100 }, (_, i) => i * 24000);
  const plan = { type: 'blend', aOut: 48000, bIn: 0, pre: 0, ratio: 1, k: 1, lock: true, beatsA: beats, beatsB: beats, beatA0: 2, beatB0: 0,
    lanes: { a: { gain: [[0, 1], [480000, 0]] }, b: {} }, handover: 1000, len: 480000, echo: null, trimB: 1 };
  const d = deckWith(new Float32Array(2e6).fill(0.1), new Float32Array(2e6).fill(0.2), plan);
  play(d, 60000);
  assert.equal(d.main, 1, 'B has taken over');
  d.message({ seek: 0, track: 2 });
  const { msgs, left } = play(d, 1024);
  assert.ok(msgs.some((m) => m.mixEnd === 2), 'the mix ended');
  close(left.at(-1), 0.2, 1e-3, 'only B left');
});

test('engine: a seek meant for another song is ignored', () => {
  const d = new Deck(SR);
  d.message({ channels: [new Float32Array(1e5)], track: 5 });
  d.message({ seek: 50000, track: 4 });
  assert.equal(d.voices[0].s.seekTo, null);
  d.message({ seek: 50000, track: 5 });
  assert.equal(d.voices[0].s.seekTo, 50000);
});

test('engine: a level that is not a number is ignored', () => {
  const d = new Deck(SR);
  d.message({ channels: [new Float32Array(1e5).fill(0.1)], track: 1 });
  d.message({ target: 1, snap: true });
  d.message({ trim: NaN });
  const { left } = play(d, 512);
  assert.ok(Number.isFinite(left.at(-1)) && left.at(-1) > 0.05, `output ${left.at(-1)}`);
});
