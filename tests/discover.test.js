// Discover's source mapping, offline: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const archive = require('../api/archive');
const jamendo = require('../api/jamendo');
const youtube = require('../api/youtube');

const item = { identifier: 'gd77', title: 'Live 1977', creator: 'Grateful Dead' };
const file = (name, format, extra = {}) => ({ name, format, ...extra });

test('Archive: each tier picks its format from an original and its derivatives', () => {
  const [t] = archive.tracks(item, [
    file('__ia_thumb.jpg', 'Item Tile', { source: 'original' }),
    file('t01.flac', 'Flac', { source: 'original', length: '239.8', title: 'Scarlet', track: '01' }),
    file('t01.mp3', 'VBR MP3', { source: 'derivative', original: 't01.flac', length: '03:59' }),
    file('t01.ogg', 'Ogg Vorbis', { source: 'derivative', original: 't01.flac' }),
  ]);
  const name = (u) => u.split('/').pop();
  assert.deepEqual(Object.fromEntries(Object.entries(t.playback.urls).map(([k, u]) => [k, name(u)])), { low: 't01.mp3', medium: 't01.mp3', high: 't01.flac' });
  assert.equal(t.title, 'Scarlet');
  assert.equal(t.artist, 'Grateful Dead');
  assert.equal(t.durationSec, 240);
  assert.equal(t.id, 'gd77/t01.flac');
  assert.equal(t.artworkAlt, 'https://archive.org/download/gd77/__ia_thumb.jpg'); // no uploaded cover: the tile is a waveform, kept as fallback
});

test('Archive: an MP3-only track plays at every tier; long, unknown-length and non-audio files drop out', () => {
  const list = archive.tracks(item, [
    file('b side.mp3', 'VBR MP3', { source: 'original', length: '1:02:03', track: '2' }), // an hour: too long
    file('a side.mp3', 'VBR MP3', { source: 'original', length: '00:39', track: '1' }),
    file('c.mp3', 'VBR MP3', { source: 'original' }), // no length
    file('cover.jpg', 'JPEG', { source: 'original' }),
  ]);
  assert.equal(list.length, 1);
  assert.equal(new Set(Object.values(list[0].playback.urls)).size, 1);
  assert.ok(list[0].playback.urls.medium.endsWith('/a%20side.mp3'));
  assert.equal(list[0].title, 'a side');
  assert.equal(list[0].artworkUrl, 'https://archive.org/services/img/gd77'); // no thumbnail file: the Archive's own image
  assert.deepEqual(['39.8', '00:39', '1:02:03', undefined].map(archive.seconds), [40, 39, 3723, 0]);
});

test('Jamendo: the stream URL carries each tier as its format', () => {
  const t = jamendo.map({ id: 7, name: 'Song', artist_name: 'A', album_name: '', duration: 200, image: 'i.jpg', shareurl: 's',
    audio: 'https://prod-1.storage.jamendo.com/?trackid=7&format=mp31&from=app' });
  const format = (u) => new URL(u).searchParams.get('format');
  assert.deepEqual([t.playback.urls.low, t.playback.urls.medium, t.playback.urls.high].map(format), ['mp31', 'mp32', 'flac']);
  assert.equal(t.album, undefined); // a single
  assert.equal(jamendo.map({ id: 8, duration: 3600, audio: 'https://x/?format=mp31' }), null); // too long
});

test('YouTube: ISO durations and escaped titles', () => {
  assert.deepEqual(['PT3M21S', 'PT1H2M', 'P0D', 'PT45S', ''].map(youtube.iso), [201, 3720, 0, 45, 0]);
  assert.equal(youtube.decode('Don&#39;t &amp; Won&#x27;t &quot;Live&quot;'), 'Don\'t & Won\'t "Live"');
});

test('Archive: an item outside the curated collections is a community upload; a Live Music Archive one is live', () => {
  const song = (extra) => archive.tracks({ identifier: 'x', title: 'T', creator: 'A', ...extra }, [file('a.mp3', 'VBR MP3', { source: 'original', length: '3:00' })])[0];
  assert.equal(song({ collection: ['opensource_audio'] }).community, true);
  assert.equal(song({ collection: ['opensource_audio'] }).category, 'community');
  assert.equal(song({ collection: ['netlabels'] }).community, undefined);
  assert.equal(song({ mediatype: 'etree', collection: ['GratefulDead', 'etree'] }).category, 'live');
  assert.deepEqual(song({ collection: ['netlabels'], subject: 'Rock; flac; A; 1977; bootleg' }).tags.genres, ['Rock']); // formats, years and the artist aren't genres
});

test('Taste: a full listen outweighs a skip, a recent play outweighs an old one', () => {
  const { profile, weight } = require('../api/taste');
  assert.ok(weight(200, 200) > weight(60, 200));
  assert.ok(weight(4, 200) < 0); // a skip counts against
  const now = Date.UTC(2026, 8, 26);
  const play = (genre, at, listened = 200) => ({ song_id: genre, listened, duration: 200, at,
    song: { source: 'jamendo', id: genre, title: genre, artist: `${genre} band`, category: 'independent', tags: { genres: [genre], kinds: [] } } });
  const recent = profile([play('jazz', now - 30 * 864e5), play('rock', now - 864e5)], 0, 7 * 864e5, now);
  assert.equal(recent.genres[0].name, 'rock');
  const skipped = profile([play('jazz', now, 4), play('rock', now, 100)], 0, 0, now);
  assert.deepEqual(skipped.genres.map((g) => g.name), ['rock']);
});

test('Cover copies only come from the sites songs come from', () => {
  const { artAllowed } = require('../api/discover');
  assert.ok(artAllowed('https://dn720301.ca.archive.org/0/items/x/__ia_thumb.jpg'));
  assert.ok(artAllowed('https://usercontent.jamendo.com?type=album&id=1'));
  assert.ok(!artAllowed('http://archive.org/x.jpg')); // https only
  assert.ok(!artAllowed('https://evil.example/archive.org.jpg'));
  assert.ok(!artAllowed('https://127.0.0.1/x.jpg'));
});

test('Archive: a waveform-only item asks the picture finder; an item with an uploaded cover keeps its tile', () => {
  const files = (extra = []) => [file('__ia_thumb.jpg', 'Item Tile', { source: 'original' }), file('a.mp3', 'VBR MP3', { source: 'original', length: '3:00', title: 'Saibo', creator: 'Shreya Ghoshal' }), ...extra];
  const waveform = archive.tracks({ identifier: 'x', collection: ['opensource_audio'] }, files())[0];
  assert.equal(waveform.artworkUrl, '/discover/image?song=Saibo&artist=Shreya+Ghoshal');
  assert.equal(waveform.artworkAlt, 'https://archive.org/download/x/__ia_thumb.jpg'); // the waveform, if nothing is found
  const covered = archive.tracks({ identifier: 'x' }, files([file('cover.jpg', 'JPEG', { source: 'original' })]))[0];
  assert.equal(covered.artworkUrl, 'https://archive.org/download/x/__ia_thumb.jpg');
});
