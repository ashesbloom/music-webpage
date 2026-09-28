// Auto Mix's analyses kept on the server (api/mix.js), on a scratch database. node --test tests/mix.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.ACRUX_DATA ??= fs.mkdtempSync(path.join(os.tmpdir(), 'acrux-test-')); // a scratch database, never your library
const mix = require('../api/mix');
const { analyze } = require('../javascript/automix-analyze.js');
const { song } = require('./automix-songs.js');

test('server: analyses kept per song, summaries for ranking, anything else refused', async () => {
  const call = (method, p, body) => new Promise((done) => {
    const req = Object.assign((async function* () { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); })(), { method, headers: {} });
    const res = { writeHead(status) { this.status = status; }, end(text) { done({ status: this.status, body: text ? JSON.parse(text) : null }); } };
    mix(req, res, new URL(p, 'http://localhost'));
  });
  const made = song();
  const a = analyze(made.left, made.right, made.sr);
  assert.equal((await call('GET', '/api/mix/nectar-1')).status, 404);
  assert.equal((await call('PUT', '/api/mix/nectar-1', a)).status, 200);
  assert.deepEqual((await call('GET', '/api/mix/nectar-1')).body, JSON.parse(JSON.stringify(a)));
  const s = (await call('POST', '/api/mix/summaries', { ids: ['nectar-1', 'nope'] })).body;
  assert.deepEqual(Object.keys(s), ['nectar-1']);
  assert.equal(s['nectar-1'].camelot, '8B');
  assert.equal((await call('PUT', '/api/mix/x', { v: 1, dur: 'long' })).status, 400);
  assert.equal((await call('PUT', '/api/mix/x', { ...a, v: 0 })).status, 400);
  const { peakDb, ...noPeak } = a;
  assert.equal((await call('PUT', '/api/mix/x', noPeak)).status, 400); // trim() needs it: a missing one would play NaN
  assert.equal((await call('PUT', '/api/mix/x', { ...a, bars: { ...a.bars, busy: 'all' } })).status, 400);
  assert.equal((await call('PUT', '/api/mix/x', { ...a, grid: { t0: 0, period: -1 } })).status, 400);
});
