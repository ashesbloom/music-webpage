// iTunes Search: Apple's whole catalogue, but only as 30-second previews. The last resort, for songs no free source has
// in full: the page drops a preview whose artist and title are already there from a full source. No key; about 20
// requests a minute, so answers are cached a day and only the first page is asked. Previews (AAC) send CORS headers.
const { getJson } = require('./common');

const map = (t) => t.previewUrl && ({
  source: 'itunes', id: String(t.trackId), title: t.trackName, artist: t.artistName, album: t.collectionName || undefined,
  durationSec: 30, artworkUrl: t.artworkUrl100?.replace('100x100bb', '600x600bb') || null, artworkAlt: t.artworkUrl100 || undefined,
  playback: { kind: 'audio', urls: { low: t.previewUrl, medium: t.previewUrl, high: t.previewUrl } },
  sourceUrl: t.trackViewUrl, category: 'preview', preview: true,
  tags: { genres: t.primaryGenreName ? [t.primaryGenreName] : [], kinds: [] },
});

const none = { results: [], more: false };
const find = {
  songs: async (q, n) => {
    if (!q || n > 1) return none;
    const body = await getJson(`https://itunes.apple.com/search?${new URLSearchParams({ term: q, entity: 'song', media: 'music', limit: 25 })}`);
    return { results: (body.results || []).map(map).filter(Boolean), more: false };
  },
  albums: async () => none,
  artists: async () => none,
};

module.exports = { find, map };
