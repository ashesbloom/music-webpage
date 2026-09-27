// Set up ACRUX, offline: keys kept and masked (.env wins), Google's refusals as plain messages, and pairing a phone.
// node --test tests/setup.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
process.env.ACRUX_DATA ??= fs.mkdtempSync(path.join(os.tmpdir(), 'acrux-test-')); // a scratch database, never your library
for (const name of ['YOUTUBE_API_KEY', 'GOOGLE_API_KEY', 'JAMENDO_CLIENT_ID']) delete process.env[name];
const keys = require('../api/keys');
const setup = require('../api/setup');
const collection = require('../api/collection');

// A request from a phone on the Wi-Fi, straight into a router: { status, headers, body }.
function fromWifi(router, method, p, body, cookie = '') {
  return new Promise((done) => {
    const chunks = body ? [Buffer.from(JSON.stringify(body))] : [];
    const req = { method, headers: { cookie, 'user-agent': 'Mozilla/5.0 (iPhone)' }, socket: { remoteAddress: '192.168.1.20' },
      async *[Symbol.asyncIterator]() { yield* chunks; } };
    const res = { writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(text) { done({ status: this.status, headers: this.headers, body: JSON.parse(text || '{}') }); } };
    router(req, res, new URL(`http://x${p}`));
  });
}

test('Keys: kept, shown by their last 4 characters only, and .env wins', async (t) => {
  const server = http.createServer((req, res) => setup(req, res, new URL(req.url, 'http://x'))).listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  t.after(() => server.close());
  const put = (body) => fetch(`http://127.0.0.1:${server.address().port}/api/keys`, { method: 'PUT', body: JSON.stringify(body) });

  const res = await put({ google: ' AIzaTestKey1234 ' });
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(text).google, { set: true, from: 'app', end: '1234' });
  assert.ok(!text.includes('AIzaTestKey1234')); // the key never goes back to the page whole
  assert.equal(keys.key('drive'), 'AIzaTestKey1234'); // one Google key serves Drive and YouTube
  assert.equal(keys.key('youtube'), 'AIzaTestKey1234');

  process.env.YOUTUBE_API_KEY = 'fromEnv9999';
  assert.deepEqual(keys.status('youtube'), { set: true, from: 'env', end: '9999' });
  delete process.env.YOUTUBE_API_KEY;

  assert.equal((await put({ jamendo: 'not a key!' })).status, 400);
  assert.equal((await fromWifi(setup, 'GET', '/api/keys')).status, 403); // phones never see keys
  assert.equal((await fromWifi(setup, 'PUT', '/api/keys', { google: 'AIzaPhone' })).status, 403);
});

test('Key check: each of Google’s refusals becomes the message and fix to show', () => {
  const refusal = (reason, status = 403) => ({ error: { code: status, message: 'x', details: [{ reason }] } });
  assert.equal(setup.explain('youtube', 200, {}).ok, true);
  assert.equal(setup.explain('drive', 404, refusal('notFound', 404)).ok, true); // got as far as "no such file": it works
  const off = setup.explain('drive', 403, refusal('SERVICE_DISABLED'));
  assert.equal(off.ok, false);
  assert.match(off.title, /Google Drive is turned off/);
  const blocked = setup.explain('drive', 403, refusal('API_KEY_SERVICE_BLOCKED'));
  assert.match(blocked.title, /can’t use this key/);
  assert.match(blocked.link, /apis\/credentials$/);
  assert.match(setup.explain('youtube', 400, refusal('API_KEY_INVALID', 400)).title, /doesn’t recognise this key/);
  const quota = setup.explain('youtube', 403, { error: { errors: [{ reason: 'quotaExceeded' }] } });
  assert.equal(quota.ok, true);
  assert.match(quota.title, /used up for today/);
});

test('Pairing: a code works once and for 10 minutes; the phone then plays everything but changes nothing', async () => {
  const { makePair, claimPair } = collection.pairing;
  const once = makePair(0);
  assert.equal(claimPair(once, 1000), true);
  assert.equal(claimPair(once, 1000), false);
  assert.equal(claimPair(makePair(0), 10 * 60e3 + 1), false);
  assert.equal(claimPair('made-up-code', 0), false);

  const joined = await fromWifi(collection, 'POST', '/api/devices/join', { token: makePair() });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.device, 'iPhone');
  const cookie = /acrux_device=[\w-]+/.exec(joined.headers['Set-Cookie'])[0];

  const wifi = { socket: { remoteAddress: '192.168.1.20' } };
  assert.equal(collection.gate({ ...wifi, headers: { cookie } }, new URL('http://x/api/library')), true);
  assert.equal(collection.gate({ ...wifi, headers: {} }, new URL('http://x/api/library')), false);
  assert.equal((await fromWifi(collection, 'GET', '/api/collection', null, cookie)).body.me.device, true);
  assert.equal((await fromWifi(collection, 'POST', '/api/devices/pair', {}, cookie)).status, 403); // only the computer pairs
  assert.equal((await fromWifi(setup, 'PUT', '/api/keys', { google: 'AIzaPhone' }, cookie)).status, 403);
});
