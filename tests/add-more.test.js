// Add More Songs, offline: Drive links, the zip reader, names without tags and a folder linked in place.
// node --test tests/add-more.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
process.env.ACRUX_DATA ??= fs.mkdtempSync(path.join(os.tmpdir(), 'acrux-test-')); // never your library
const { parseLink } = require('../api/drive');
const { zipEntries, entryStream } = require('../api/local');
const { fromName } = require('../api/tracks');

const ID = '1Bz7f-9ivU40Pj6UBI-TxSY_iQsQRmldt';

test('Drive: every kind of folder and song link gives its id; a Docs link is turned away', () => {
  for (const link of [
    `https://drive.google.com/drive/folders/${ID}`,
    `https://drive.google.com/drive/u/0/folders/${ID}?usp=sharing`,
    `https://drive.google.com/open?id=${ID}`,
    `https://drive.google.com/file/d/${ID}/view?usp=drive_link`,
    `https://drive.google.com/uc?id=${ID}&export=download`,
    `  ${ID}  `,
  ]) assert.equal(parseLink(link).id, ID, link);
  assert.equal(parseLink(`https://drive.google.com/drive/folders/${ID}?resourcekey=0-abc`).resourceKey, '0-abc');
  assert.throws(() => parseLink(`https://docs.google.com/document/d/${ID}/edit`), /Google Docs/);
  assert.throws(() => parseLink('https://example.com/folders/abcdefghijk'), /isn’t a Google Drive link/);
});

// The desktop app and a dev server share the Keychain's sign-in but not its client: the app downloads with the key, so
// Google holding the key back must show (held), not hide behind a sign-in it can't use.
test('Drive: a sign-in without its client doesn’t hide Google holding back the key', async () => {
  const drive = require('../api/drive');
  process.env.GOOGLE_API_KEY = 'test-key';
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  // Off the Mac the sign-in is a file; on it, a real Keychain sign-in (if any) plays this part, only read.
  if (process.platform !== 'darwin') fs.writeFileSync(path.join(process.env.ACRUX_DATA, 'google-drive-token'), 'a-token');
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>Our systems have detected unusual traffic… automated queries', { status: 403 });
  try {
    await assert.rejects(drive.add(`https://drive.google.com/drive/folders/${ID}`), /holding back/);
    assert.equal(drive.held(), true);
    assert.equal((await drive.status()).connected, false);
  } finally {
    globalThis.fetch = real;
  }
});

// A weak network drops connections: Drive calls try again (like a busy answer) instead of failing the song at once.
test('Drive: a dropped connection is tried again', async () => {
  const drive = require('../api/drive');
  process.env.GOOGLE_API_KEY = 'test-key';
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ error: { message: 'File not found', errors: [{ reason: 'notFound' }] } }), { status: 404 });
  };
  try {
    await assert.rejects(drive.add(`https://drive.google.com/drive/folders/${ID}`), /isn’t shared by link/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = real;
  }
});

// A zip by hand: one stored entry, one deflated; the reader must give both back byte for byte.
function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, body, deflate] of files) {
    const data = deflate ? zlib.deflateRawSync(body) : body;
    const n = Buffer.from(name);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(deflate ? 8 : 0, 8); h.writeUInt32LE(zlib.crc32(body), 14);
    h.writeUInt32LE(data.length, 18); h.writeUInt32LE(body.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(deflate ? 8 : 0, 10); c.writeUInt32LE(zlib.crc32(body), 16);
    c.writeUInt32LE(data.length, 20); c.writeUInt32LE(body.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(h, n, data);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

test('Zip: stored and deflated entries read back as they went in', async () => {
  const song = Buffer.from('ID3 pretend song '.repeat(200));
  const file = path.join(os.tmpdir(), `acrux-test-${process.pid}.zip`);
  fs.writeFileSync(file, zip([['Album/01 Song.mp3', song, false], ['Album/cover.jpg', Buffer.from('not really a jpeg'), true]]));
  try {
    const entries = await zipEntries(file);
    assert.deepEqual(entries.map((e) => e.name), ['Album/01 Song.mp3', 'Album/cover.jpg']);
    const read = async (e) => Buffer.concat(await (await entryStream(file, e)).toArray());
    assert.deepEqual(await read(entries[0]), song);
    assert.equal((await read(entries[1])).toString(), 'not really a jpeg');
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('Names: an untagged file’s track number, title and album come from its path', () => {
  assert.deepEqual(fromName('Nectar/07 - Run.flac'), { n: 7, disc: null, title: 'Run', artist: null, album: 'Nectar', year: null });
  assert.deepEqual(fromName('1-03 Song.mp3'), { n: 3, disc: 1, title: 'Song', artist: null, album: null, year: null });
  assert.deepEqual(fromName('In Rainbows/08. Radiohead - 4 Minute Warning.flac'),
    { n: 8, disc: null, title: '4 Minute Warning', artist: 'Radiohead', album: 'In Rainbows', year: null });
  assert.deepEqual(fromName('Fleetwood Mac - Rumours (1977) [2020 PBTHAL 45 RPM LP 24-96 FLAC] vtwin88cube/02.-Dreams.flac'),
    { n: 2, disc: null, title: 'Dreams', artist: 'Fleetwood Mac', album: 'Rumours', year: 1977 });
  assert.equal(fromName('1999 - Prince.flac').n, null); // a year isn't a track number
  // a Drive folder's own song, untagged: named from the folder it's in (its paths start inside it)
  assert.deepEqual(fromName('01 - Planet Telex.flac', 'Radiohead - The Bends [24 bit FLAC] vinyl'),
    { n: 1, disc: null, title: 'Planet Telex', artist: 'Radiohead', album: 'The Bends', year: null });
});

// A tenth of a second of 8 kHz mono sound, every sample `level`.
function wav(level) {
  const b = Buffer.alloc(44 + 1600);
  b.write('RIFF', 0); b.writeUInt32LE(36 + 1600, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(1600, 40);
  for (let i = 44; i < b.length; i += 2) b.writeInt16LE(level, i);
  return b;
}

test('Linked folder: plays in place; nothing outside it is served, nothing is deleted, and only this computer may link', async (t) => {
  const library = require('../api/library');
  const local = require('../api/local');
  const server = http.createServer((req, res) => library(req, res, new URL(req.url, 'http://x'))).listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acrux-linked-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'acrux-outside-'));
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true }); fs.rmSync(outside, { recursive: true }); });
  const api = (p, init) => fetch(`http://127.0.0.1:${server.address().port}/api/${p}`, init);
  const song = path.join(root, 'Album', '01 Song.wav');
  fs.mkdirSync(path.dirname(song));
  fs.writeFileSync(song, wav(1000));
  fs.writeFileSync(path.join(outside, 'secret.wav'), wav(-1000));
  fs.symlinkSync(path.join(outside, 'secret.wav'), path.join(root, 'Album', '02 Escape.wav')); // leads out: skipped

  const { id } = await (await api('local/link', { method: 'POST', body: JSON.stringify({ dir: root }) })).json();
  await local.scan(id);
  const mine = (await (await api('library')).json()).tracks.filter((x) => x.source === id);
  assert.deepEqual(mine.map((x) => x.name), [`${path.basename(root)}/Album/01 Song.wav`]);
  const audio = () => api(`tracks/${encodeURIComponent(mine[0].id)}/audio`);
  assert.deepEqual(Buffer.from(await (await audio()).arrayBuffer()), wav(1000));

  fs.rmSync(song); // swapped for a symlink out of the folder: refused, not followed
  fs.symlinkSync(path.join(outside, 'secret.wav'), song);
  assert.equal((await audio()).status, 404);

  const wifi = { status: 0, writeHead(s) { this.status = s; }, end() {} }; // a phone on the Wi-Fi can't look around the disk
  await library({ method: 'GET', headers: {}, socket: { remoteAddress: '192.168.1.20' } }, wifi, new URL('http://x/api/local/dirs'));
  assert.equal(wifi.status, 403);

  assert.equal((await api(`sources/${encodeURIComponent(id)}`, { method: 'DELETE' })).status, 200); // unlinked: files stay
  assert.deepEqual(fs.readdirSync(path.join(root, 'Album')).sort(), ['01 Song.wav', '02 Escape.wav']);
  assert.ok(fs.existsSync(path.join(outside, 'secret.wav')));
});
