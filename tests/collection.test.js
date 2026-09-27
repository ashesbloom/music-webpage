// Your collection, offline: song refs, playlist changes and who may reach the API. node --test tests/collection.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.ACRUX_DATA ??= fs.mkdtempSync(path.join(os.tmpdir(), 'acrux-test-')); // a scratch database, never your library
const playlists = require('../api/playlists');
const collection = require('../api/collection');

const ew = { source: 'library', id: 'nectar-1', title: 'Ew', src: 'playback_tree/songs/joji/nector/1.mp3' };
const archive = { source: 'archive', id: 'item/01 a.flac', title: 'A', artist: 'B', durationSec: 60,
  playback: { kind: 'audio', urls: { low: 'https://archive.org/a', medium: 'https://archive.org/a', high: 'https://archive.org/a' } } };

test('Refs: library songs by id, built-in ones with their file only under playback_tree/songs; Discover songs checked', () => {
  assert.deepEqual(playlists.ref({ source: 'library', id: 'lib:abc' }), { source: 'library', id: 'lib:abc' });
  assert.deepEqual(playlists.ref(ew), ew);
  assert.equal(playlists.ref({ ...ew, src: 'playback_tree/songs/../../.env.mp3' }).src, undefined); // no way out of the folder
  assert.equal(playlists.ref({ ...ew, src: 'data/acrux.db' }).src, undefined);
  assert.equal(playlists.ref({ source: 'library', id: 'bad id!' }), null);
  assert.equal(playlists.keyOf(playlists.ref(archive)), 'archive:item/01 a.flac');
  assert.equal(playlists.ref({ source: 'archive', id: 'x' }), null); // no playback: not a song
});

test('Playlists: made, added to without repeats, reordered, duplicated, deleted', () => {
  const { id } = playlists.create({ title: '  Road Trip  ', songs: [ew] });
  assert.equal(playlists.get(id).title, 'Road Trip');
  assert.deepEqual(playlists.addSongs(id, [ew, archive]), { added: 1, skipped: 1 });
  playlists.setSongs(id, [archive, ew, archive]);
  assert.deepEqual(playlists.get(id).songs.map(playlists.keyOf), ['archive:item/01 a.flac', 'nectar-1']);
  const copy = playlists.duplicate(id).id;
  assert.equal(playlists.get(copy).title, 'Road Trip (Copy)');
  assert.deepEqual(playlists.get(copy).songs, playlists.get(id).songs);
  assert.throws(() => playlists.create({ title: ' ' }), /needs a name/);
  assert.equal(playlists.update(id, { groove: ['#fff', 'red'] }).groove, null); // not two #rrggbb colours
  playlists.remove(id);
  assert.equal(playlists.get(id), null);
});

test('Gate: this computer and the site’s files always; from the Wi-Fi, the API only for invite links', () => {
  const req = (address, cookie = '') => ({ socket: { remoteAddress: address }, headers: { cookie } });
  const url = (p) => new URL(p, 'http://x');
  assert.equal(collection.gate(req('127.0.0.1'), url('/api/library')), true);
  assert.equal(collection.gate(req('192.168.1.20'), url('/library.html')), true);
  assert.equal(collection.gate(req('192.168.1.20'), url('/api/library')), false);
  assert.equal(collection.gate(req('192.168.1.20', 'acrux_guest=not-a-real-guest-token'), url('/api/collection')), false);
  assert.equal(collection.gate(req('192.168.1.20'), url('/api/invites/abc123/join')), true);
});
