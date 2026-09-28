// Auto Mix's listening half on made-up songs whose beats, bars, chords and structure are known.
// node --test tests/automix-analyze.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze, loudness, camelot } = require('../javascript/automix-analyze.js');
const { song, pad } = require('./automix-songs.js');

const cache = new Map(); // each made-up song is analysed once
const hear = (opts, make = song) => {
  const key = make.name + JSON.stringify(opts);
  if (!cache.has(key)) { const s = make(opts); cache.set(key, analyze(s.left, s.right, s.sr)); }
  return cache.get(key);
};
const barTime = (a, j) => a.grid.t0 + (a.downbeat + 4 * j) * a.grid.period; // the made-up songs keep strict time
const close = (x, y, tol, what) => assert.ok(Math.abs(x - y) <= tol, `${what}: ${x} not within ${tol} of ${y}`);

test('analysis: tempo, grid, bars, phrases, key and structure of a 124 BPM track', () => {
  const a = hear({});
  close(a.bpm, 124, 0.05, 'bpm');
  assert.ok(a.beat && a.steady && a.grid, 'a strict grid');
  close(barTime(a, 0), 0, 0.03, 'bar 0 on the first kick');
  close(barTime(a, 8), 8 * 4 * 60 / 124, 0.03, 'bar 8');
  assert.equal(a.phraseOffset, 0);
  assert.equal(a.key?.camelot, '8B'); // C major
  assert.equal(a.intro, 8);
  assert.equal(a.outro, 56);
  assert.equal(a.nbars, 64);
  assert.deepEqual(a.bars.busy.slice(6, 10), [0, 0, 1, 1]); // the chords come in at bar 8
  assert.equal(a.cold, false);
  assert.equal(a.fade, null);
});

test('analysis: leading silence, another tempo, a shorter intro', () => {
  const a = hear({ lead: 1.3, bpm: 128 });
  close(a.start, 1.3, 0.06, 'start');
  close(a.bpm, 128, 0.05, 'bpm');
  close(barTime(a, 0), 1.3, 0.03, 'bar 0 after the silence');
  const b = hear({ bpm: 90, bars: 48, intro: 4, outro: 44 });
  close(b.bpm, 90, 0.05, 'bpm');
  assert.equal(b.intro, 4);
  assert.equal(b.outro, 44);
  assert.equal(b.phraseOffset, 4);
});

test('analysis: a pad has no beat but has a key; loudness is BS.1770', () => {
  const p = hear({}, pad);
  assert.equal(p.beat, false);
  assert.equal(p.key?.camelot, '8A'); // A minor
  const sr = 22050, sine = Float32Array.from({ length: sr * 5 }, (_, i) => 0.1 * Math.sin(2 * Math.PI * 1000 * i / sr));
  close(loudness(sine, sine, sr), -20, 0.4, 'LUFS of a -20 dBFS stereo 1 kHz sine');
});

test('Camelot codes: C major is 8B, A minor 8A, a fifth is one step', () => {
  assert.equal(camelot(0, false), '8B');
  assert.equal(camelot(9, true), '8A');
  assert.equal(camelot(7, false), '9B');
  assert.equal(camelot(4, true), '9A');
});
