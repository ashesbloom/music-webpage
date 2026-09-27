// The desktop app's updates (api/update.js): which releases it takes itself, and zips that try to write outside.
// node --test tests/update.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.ACRUX_DATA ??= fs.mkdtempSync(path.join(os.tmpdir(), 'acrux-test-')); // never your library
const { decide, inside } = require('../api/update');

const run = { version: '1.2.0', electron: '44.4.5', shell: 'abc' };
const rel = (tag) => ({ tag_name: tag });
const files = (version, more = {}) => ({ version, electron: '44.4.5', shell: 'abc', ...more });

test('a newer release with the same shell comes as files', () => {
  assert.equal(decide(rel('v1.3.0'), files('1.3.0'), run), 'files');
  assert.equal(decide(rel('v1.10.0'), files('1.10.0'), { ...run, version: '1.9.0' }), 'files'); // numbers, not letters
});

test('the same or an older version is nothing new', () => {
  assert.equal(decide(rel('v1.2.0'), files('1.2.0'), run), 'none');
  assert.equal(decide(rel('v1.1.9'), files('1.1.9'), run), 'none');
});

test('a release still being built (no files.json yet) waits', () => {
  assert.equal(decide(rel('v1.3.0'), null, run), 'none');
  assert.equal(decide(rel('v1.3.0'), files('1.2.5'), run), 'none');
});

test('a new Electron or desktop/main.js needs the installer', () => {
  assert.equal(decide(rel('v1.3.0'), files('1.3.0', { electron: '45.0.0' }), run), 'shell');
  assert.equal(decide(rel('v1.3.0'), files('1.3.0', { shell: 'def' }), run), 'shell');
});

test('zip entries stay inside the update folder', () => {
  const dir = path.join(os.tmpdir(), 'acrux-up');
  assert.equal(inside(dir, 'api/update.js'), path.join(dir, 'api', 'update.js'));
  assert.throws(() => inside(dir, '../evil.js'));
  assert.throws(() => inside(dir, '/etc/passwd'));
});
