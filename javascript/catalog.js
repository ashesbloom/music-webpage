// ACRUX catalog: every song, album, artist and playlist the site knows. Static until the phase 3 backend.
// Load it first: it sets SITE (asset and page URLs, from this script's own location, so any page depth works).
const SITE = new URL('../', document.currentScript.src).href;
const CATALOG = (() => {
  const cover = (file) => `${SITE}playback_tree/covers/${file}`;
  const artists = [
    { id: 'acdc', name: 'AC/DC', photo: cover('artist_acdc.jpg') },
    { id: 'brent', name: 'Brent Faiyaz' },
    { id: 'joji', name: 'Joji', photo: cover('artist_joji.jpg') },
    { id: 'nirvana', name: 'Nirvana', photo: cover('artist_nirvana.jpg') },
    { id: 'radiohead', name: 'Radiohead', photo: cover('artist_radiohead.jpg') },
    { id: 'weeknd', name: 'The Weeknd', photo: cover('artist_weekend.jpg') },
  ];
  const albums = [
    { id: 'nectar', title: 'Nectar', artist: 'joji', genre: 'Alternative', year: 2020, cover: cover('joji/joji_nector.jpg'),
      desc: 'The follow-up to 2018’s BALLADS 1 builds on the Japanese singer’s daring aesthetic—an arty blur of bedroom trip-hop, alt-R&B and slow-winding IDM that always seems to zig when you think it’ll zag.' },
    { id: 'smithereens', title: 'Smithereens', artist: 'joji', genre: 'Alternative', year: 2022, cover: cover('joji/joji_smithereens.jpg'),
      desc: 'Joji’s third album, released in 2022. Nine short, stripped-back songs about love that is already slipping away, led by the piano ballad Glimpse of Us.' },
    // No audio for these yet: their pages say so.
    { id: 'amnesiac', title: 'Amnesiac', artist: 'radiohead', genre: 'Alternative', year: 2001, cover: cover('radiohead_amnesiac.png') },
    { id: 'nevermind', title: 'Nevermind', artist: 'nirvana', genre: 'Grunge', year: 1991, cover: cover('nirvana.jpg') },
    { id: 'wasteland', title: 'Wasteland', artist: 'brent', genre: 'R&B', year: 2022, cover: cover('waste_land.jpg') },
  ];
  // [title, time, cover file (album cover if none), audio file name (track number if none)]
  const tracks = {
    nectar: ['nector', [
      ['Ew', '3:27'], ['Modus', '3:27'], ['Tick Tock', '2:12'], ['Daylight', '2:43', 'joji_daylight.jpg'],
      ['Gimme Love', '3:34', 'joji_golden.jpg'], ['Run', '3:15', 'joji_run.jpg'], ['Sanctuary', '3:00', 'joji%20santuary.jpg'],
      ['High Hopes', '3:02'], ['Nitrous', '2:11'], ['Pretty Boy', '2:36'], ['Normal People', '2:46'], ['Afterthought', '3:14'],
      ['Mr.Hollywood', '3:22'], ['777', '3:01'], ['Reanimator', '3:03'], ['Like You Do', '4:00'], ['Your Man', '2:43'], ['Upgrade', '1:29'],
    ]],
    smithereens: ['smithereens', [
      ['Feeling Like the End', '3:27'], ['Glimpse of Us', '3:27', 'joji_glimps_of_us.jpg', '2r'], ['Die For You', '2:12'],
      ['Before the Day Is Over', '2:43'], ['Dissolve', '3:34'], ['Night Rider', '3:15'], ['BlahBlahBlah', '3:00'], ['Yukon', '3:02'], ['1AM Freestyle', '2:11'],
    ]],
  };
  const songs = Object.entries(tracks).flatMap(([album, [folder, list]]) => list.map(([title, time, art, file], i) => ({
    id: `${album}-${i + 1}`, n: i + 1, title, time, album, artist: 'Joji',
    cover: art ? cover(`joji/${art}`) : albums.find((a) => a.id === album).cover,
    src: `${SITE}playback_tree/songs/joji/${folder}/${file || i + 1}.mp3`,
  })));
  // Mock playlists (phase 3 makes them yours). A cover is `favorites` (heart), `photo`, `groove` colours, or else a
  // mosaic of the first four song covers. `hidden` lists open from the Library but aren't in My Playlists.
  const playlists = [
    { id: 'favorites', title: 'Favorites', favorites: true, songs: [] },
    { id: 'late-night-joji', title: 'Late Night Joji', desc: 'Slow ones for after midnight: Joji, mostly.',
      songs: ['smithereens-2', 'nectar-1', 'nectar-7', 'nectar-4', 'smithereens-3', 'nectar-6', 'smithereens-1', 'nectar-5', 'smithereens-8', 'nectar-12', 'smithereens-5', 'nectar-18'] },
    { id: 'lo-fi', title: 'Lo-Fi', groove: ['#e8a73c', '#2c1905'],
      songs: ['nectar-2', 'nectar-9', 'nectar-11', 'nectar-13', 'smithereens-7', 'smithereens-9', 'nectar-17', 'nectar-15', 'smithereens-6'] },
    { id: 'party', title: 'Party Playlists', groove: ['#e8457f', '#2a0714'],
      songs: ['nectar-3', 'nectar-14', 'nectar-5', 'nectar-10', 'nectar-8', 'nectar-16', 'nectar-4', 'nectar-17'] },
    { id: 'summer-20', title: 'Summer ’20', photo: cover('joji/joji_daylight.jpg'),
      songs: ['nectar-4', 'nectar-5', 'nectar-6', 'nectar-7', 'nectar-16', 'nectar-18', 'nectar-3', 'nectar-1'] },
    { id: 'slow-burn', title: 'Slow Burn', groove: ['#d63a2e', '#1c0404'],
      songs: ['smithereens-5', 'smithereens-4', 'smithereens-3', 'nectar-12', 'nectar-11', 'nectar-7', 'smithereens-2'] },
    { id: 'recently-added', title: 'Recently Added', hidden: true,
      songs: ['nectar-7', 'nectar-2', 'nectar-3', 'nectar-16', 'nectar-17', 'nectar-13', 'nectar-14', 'nectar-15'] },
  ];
  const song = (id) => songs.find((s) => s.id === id);
  const album = (id) => albums.find((a) => a.id === id);
  const artist = (id) => artists.find((a) => a.id === id);
  const playlist = (id) => playlists.find((p) => p.id === id);
  // "album:nectar" or "playlist:lo-fi" -> its songs, in order
  const list = (key = '') => {
    const [kind, id] = key.split(':');
    if (kind === 'album') return songs.filter((s) => s.album === id);
    return (playlist(id)?.songs || []).map(song).filter(Boolean);
  };
  const page = (query) => `${SITE}library.html${query ? `?${query}` : ''}`;
  return { artists, albums, songs, playlists, song, album, artist, playlist, list, page };
})();
