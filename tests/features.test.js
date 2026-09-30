// Song Features (javascript/features-worker.js): the Beat This! port against the original, and the frames file.
// node --test tests/features.test.js
// tests/features-beatthis-reference.json comes from tests/features-beatthis-export.py (PyTorch, beat_this, the small0
// checkpoint): its mel spectrogram and outputs for the test signal below, which both sides make the same way.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../javascript/features-worker.js');
const REF = require('./features-beatthis-reference.json');

// The export's signal(): a click on every beat (the bar's first low and loud), a chord each bar, quiet LCG noise.
function signal({ seconds, bpm, per_bar: perBar }) {
  const SR = 22050, n = Math.trunc(seconds * SR), x = new Float64Array(n), beat = 60 / bpm;
  let seed = 1;
  for (let i = 0; i < n; i++) { seed = (seed * 16807) % 2147483647; x[i] = 0.02 * ((seed / 2147483647) * 2 - 1); }
  const chords = [[220.0, 277.18, 329.63], [196.0, 246.94, 293.66], [174.61, 220.0, 261.63], [164.81, 207.65, 246.94]];
  for (let k = 0; k * beat < seconds; k++) {
    const down = k % perBar === 0, [f, amp] = down ? [60, 0.9] : [1200, 0.35], s = Math.round(k * beat * SR);
    for (let i = 0; i < Math.trunc(0.12 * SR) && s + i < n; i++) { const t = i / SR; x[s + i] += amp * Math.sin(2 * Math.PI * f * t) * Math.exp(-35 * t); }
    if (down) {
      const ch = chords[Math.trunc(k / perBar) % 4];
      for (let i = 0; i < Math.trunc(perBar * beat * SR) && s + i < n; i++) {
        const t = i / SR;
        x[s + i] += 0.08 * ch.reduce((sum, fr) => sum + Math.sin(2 * Math.PI * fr * t), 0) * Math.exp(-1.5 * t);
      }
    }
  }
  return Float32Array.from(x);
}

test('Beat This! frontend: the same log-mel spectrogram as PyTorch', () => {
  const x = signal(REF.signal);
  const S = F.spectrum(x, x);
  assert.equal(S.T, REF.frames);
  let worst = 0;
  for (const [f, row] of Object.entries(REF.mel)) row.forEach((v, b) => { worst = Math.max(worst, Math.abs(S.mel[Number(f) * F.NMEL + b] - v)); });
  assert.ok(worst < 1e-3, `max difference ${worst}`);
});

test('Beat This! chunks and peak picking: its beats and downbeats from its own outputs', () => {
  const starts = F.chunkStarts(REF.frames);
  assert.deepEqual(starts, [-6, REF.frames - 1494]); // two chunks, the second moved back to end with the piece
  const { beats, downbeats } = F.beatsFrom(Float32Array.from(REF.beatLogits), Float32Array.from(REF.downbeatLogits));
  assert.deepEqual(beats.map((t) => +t.toFixed(4)), REF.beats);
  assert.deepEqual(downbeats.map((t) => +t.toFixed(4)), REF.downbeats);
});

test('meter: the downbeat activation’s pattern over the beats gives beats a bar, its first beat, and none from noise', () => {
  const waltz = Array.from({ length: 60 }, (_, i) => (i % 3 === 1 ? 0.7 : i % 6 === 4 ? 0.5 : 0.1)); // 3/4, some bars' 1 doubted
  assert.deepEqual([F.meter(waltz).meter, F.meter(waltz).phase], [3, 1]);
  const four = Array.from({ length: 64 }, (_, i) => (i % 4 === 0 ? 0.9 : i % 4 === 2 ? 0.4 : 0.05)); // 4/4 with a strong 3
  assert.deepEqual([F.meter(four).meter, F.meter(four).phase], [4, 0]);
  assert.equal(F.meter(Array.from({ length: 64 }, (_, i) => 0.3 + 0.01 * Math.sin(i))), null);
});

test('frames file: what the Worker writes, the page reads back (8 bits a value, each row between its min and max)', () => {
  const { decodeFrames } = require('../javascript/features.js');
  const ramp = Float32Array.from({ length: 100 }, (_, i) => -60 + i * 0.6);
  const grid = Float32Array.from({ length: 30 * 4 }, (_, i) => Math.sin(i));
  const buf = F.encode([{ name: 'rms', fps: 50, width: 1, data: ramp, unit: 'dBFS' }, { name: 'm', fps: 25, width: 4, data: grid, unit: '' }], { bars: [0, 2000] });
  const fr = decodeFrames(buf);
  assert.equal(fr.v, F.FEATURES_VERSION);
  assert.deepEqual(fr.bars, [0, 2000]);
  ramp.forEach((v, i) => assert.ok(Math.abs(fr.rows.rms.data[i] - v) <= (59.4 / 255) / 2 + 1e-4));
  assert.ok(Math.abs(fr.at('rms', 1) - ramp[50]) < 0.2, 'rms at 1 s is frame 50');
  assert.equal(fr.at('m', 0.4).length, 4);
});

// A made-up song in three parts, A B A (16 bars each at 120 BPM): kick, bass and a C major pad; then hi-hats and a high
// F# major chord; then A again.
function aba() {
  const SR = 22050, bar = 2, n = 48 * bar * SR, x = new Float32Array(n);
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / SR, b = Math.floor(t / bar), beat = t % 0.5, part = b < 16 || b >= 32 ? 'A' : 'B';
    if (part === 'A') x[i] = 0.5 * Math.sin(2 * Math.PI * 55 * beat) * Math.exp(-20 * beat) + 0.08 * [261.63, 329.63, 392].reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) + 0.15 * Math.sin(2 * Math.PI * 65.4 * t);
    else x[i] = (t % 0.25 < 0.03 ? 0.2 * noise() : 0) + 0.08 * [739.99, 932.33, 1108.73].reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0);
  }
  return x;
}

test('structure: a song that goes A B A gets sections labelled A, B, A', () => {
  const x = aba(), keep = {};
  const M = require('../javascript/automix-analyze.js');
  const mix = M.analyze(x, x, 22050, keep);
  const { summary } = F.describe(x, x, mix, keep.sp, null);
  const labels = summary.sections.map((s) => s.label).filter((l, i, a) => l !== a[i - 1]);
  assert.deepEqual(labels, ['A', 'B', 'A'], JSON.stringify(summary.sections.map((s) => [s.start, s.label])));
});

test('API: features are kept and given back; junk is turned away', async (t) => {
  process.env.ACRUX_DATA ??= require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'acrux-test-'));
  const http = require('http');
  const route = require('../api/features');
  const server = http.createServer((req, res) => route(req, res, new URL(req.url, 'http://x'))).listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((done) => server.once('listening', done));
  const at = `http://127.0.0.1:${server.address().port}/api/features/`;
  const frames = F.encode([{ name: 'rms', fps: 50, width: 1, data: new Float32Array([1, 2, 3]), unit: '' }]);
  assert.equal((await fetch(`${at}lib%3Aabc/frames`, { method: 'PUT', body: Buffer.from(frames) })).status, 200);
  assert.equal((await fetch(`${at}lib%3Aabc/frames`, { method: 'PUT', body: 'not frames at all' })).status, 400);
  const summary = { v: F.FEATURES_VERSION, dur: 10, rhythm: null, onsets: [], sections: [], loudness: {} };
  assert.equal((await fetch(`${at}lib%3Aabc`, { method: 'PUT', body: JSON.stringify(summary) })).status, 200);
  assert.equal((await fetch(`${at}lib%3Aabc`, { method: 'PUT', body: JSON.stringify({ ...summary, onsets: ['x'] }) })).status, 400);
  assert.deepEqual(await (await fetch(`${at}lib%3Aabc`)).json(), summary);
  const back = await (await fetch(`${at}lib%3Aabc/frames`)).arrayBuffer();
  assert.deepEqual(new Uint8Array(back), new Uint8Array(frames));
});

test('backlog list: songs fully on this computer with no features yet; never a Drive song only partly cached', () => {
  process.env.ACRUX_DATA ??= require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'acrux-test-'));
  const tracks = require('../api/tracks');
  const { missing } = require('../api/features');
  const song = (id, source) => tracks.put({ id, source, path: `${id}.mp3`, name: `${id}.mp3`, size: 1000, title: id, album: 'A', album_id: 'a', artist: 'X', album_artist: 'X', added: Date.now() });
  song('backlogLocal', 'local');
  song('backlogDrive', 'drive:nofolder'); // nothing of it cached
  const ids = missing(100).map((s) => s.id);
  assert.ok(ids.includes('lib:backlogLocal'));
  assert.ok(!ids.includes('lib:backlogDrive'));
  assert.ok(!ids.includes('lib:abc'), 'lib:abc has features (the API test kept some)');
  assert.match(missing(100).find((s) => s.id === 'lib:backlogLocal').src, /\/api\/tracks\/backlogLocal\/audio\?local=1$/);
});
