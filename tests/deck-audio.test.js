// DSP checks for the deck worklet: node --test tests/
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
