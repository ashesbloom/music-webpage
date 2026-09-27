// ACRUX Discover API, mounted by server.js. JSON only (but /discover/art); answers are cached in SQLite (api/db.js).
//   GET /discover/search?q=&source=&kind=&page=     a page of one kind (songs | albums | artists) from one source (no q:
//                                                   what's popular): { results, more }; &warm=0 skips fetching the next
//   POST /discover/batch { q, asks: [{ source, kind, page, warm }] }   several of those at once, answered a line of
//                                                   JSON each ({ i, results, more, error }) as each source answers
//   GET /discover/album?source=&id=                 an album with all its tracks
//   GET /discover/artist?source=&id=                an artist, their albums and top tracks
//   GET /discover/similar/:id                       Jamendo tracks like this one ("More like this")
//   GET /discover/youtube?q= | ?artist= | (none)    a search (101 units) | an artist's channel catalogue
//                                                   (a few units) | trending music (1 unit); each returns the quota
//   GET /discover/foryou                            rows built from your taste (api/taste.js)
//   POST /discover/radio { seed }                   songs like one song, for the queue once a list runs out
//   GET /discover/art?u=                            a same-origin copy of a cover, so the record can read its colours
//   GET /discover/image?artist=|album=&artist=|song=&artist=|q=   a picture for something that came without one
//                                                   (api/images.js); 404 when none is found, so the page falls back
//   GET /api/home · GET /api/songs                  the home page's rows · your songs (Discover songs you've played)
//   GET /api/download?album=src:id                  a Discover album as a ZIP, each song in the best quality its source
//                                                   has (your playlists and albums: /api/save, api/collection.js)
//   GET /api/taste · POST /api/plays                your taste metrics · one listen, from the player
// The page asks each source on its own, so one slow or failing source never holds up or hides the others.
const { cached } = require('./db');
const { fail, json, loopback } = require('./common');
const jamendo = require('./jamendo');
const archive = require('./archive');
const audius = require('./audius');
const itunes = require('./itunes');
const youtube = require('./youtube');
const mbz = require('./musicbrainz');
const taste = require('./taste');
const images = require('./images');
const seen = require('./seen');
const playlists = require('./playlists');
const tracks = require('./tracks');

const DAY = 864e5;
const SOURCES = { jamendo: [jamendo, 'Jamendo'], archive: [archive, 'the Internet Archive'], audius: [audius, 'Audius'], itunes: [itunes, 'iTunes'],
  seen: [seen, 'your albums'] }; // seen: songs on album and artist pages you've opened (api/seen.js)
const PAGES = { jamendo, archive, audius }; // the sources with album and artist pages
const KINDS = ['songs', 'albums', 'artists'];

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
const shown = (err, name) => (err.expose ? err.message : `${name[0].toUpperCase()}${name.slice(1)} didn’t answer. Try again in a moment.`);
const logged = (err, name) => {
  if (!err.expose) console.error(`Discover · ${name}:`, err.message);
  return shown(err, name);
};

// Page n of one kind from one source. Once answered, page n+1 is fetched into the cache in the background (unless
// warm is off), so scrolling finds it ready. An empty page is kept only 10 minutes: sources sometimes answer nothing.
function kindPage(name, kind, q, n, warm = true) {
  const [source] = SOURCES[name];
  if (name === 'seen') return source.find[kind](q, n); // grows as you browse: never cached
  const ttl = (page) => (page.results.length ? DAY : 10 * 60e3);
  const page = (i) => cached(`${name}:${kind}:${i}:${q.toLowerCase()}`, ttl, () => source.find[kind](q, i));
  return page(n).then((result) => {
    if (warm && result.more && n < 500) page(n + 1).catch(() => {});
    return result;
  });
}

// One search: a page of one kind from one source, as { results, more } or { results: [], more: false, error }.
function search(name, kind, q, page, warm) {
  if (!SOURCES[name]) return Promise.resolve({ results: [], more: false, error: `source is ${Object.keys(SOURCES).join(', ')}` });
  if (!KINDS.includes(kind)) return Promise.resolve({ results: [], more: false, error: 'kind is songs, albums or artists' });
  const n = Math.min(Math.max(parseInt(page, 10) || 1, 1), 500);
  return kindPage(name, kind, q, n, warm).catch((err) => ({ results: [], more: false, error: logged(err, SOURCES[name][1]) }));
}

// Covers the record may read, from the sites the songs come from. The Archive's file servers send no CORS headers.
const ART = [/(^|\.)archive\.org$/, /^usercontent\.jamendo\.com$/, /(^|\.)audius\.co$/, /^v\.monophonic\.digital$/, /(^|\.)mzstatic\.com$/,
  /^i\.ytimg\.com$/, /(^|\.)dzcdn\.net$/, /(^|\.)wikimedia\.org$/, /(^|\.)coverartarchive\.org$/];
function artAllowed(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && ART.some((host) => host.test(url.hostname));
  } catch { return false; }
}
async function art(res, u) {
  if (!artAllowed(u)) return send(res, 400, { error: 'Not a cover Discover knows' });
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'ACRUX/1.0' }, signal: AbortSignal.timeout(8000) });
    const type = r.headers.get('content-type') || '';
    const body = Buffer.from(await r.arrayBuffer());
    if (!r.ok || !type.startsWith('image/') || !artAllowed(r.url) || body.length > 2e6) return send(res, 502, { error: 'No such cover' });
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'max-age=604800' });
    res.end(body);
  } catch {
    send(res, 502, { error: 'No such cover' });
  }
}

// An album or artist id each source could have given.
const validId = (name, kind, id) => !!{ jamendo: /^\d{1,12}$/, audius: /^\w{1,20}$/, archive: kind === 'artist' ? /^.{1,200}$/ : /^[\w.-]{1,200}$/ }[name]?.test(id);

// An artist's YouTube catalogue, when MusicBrainz knows their channel: { artist, results } or { results: [] }.
async function youtubeArtist(name) {
  const found = await cached(`mb:artist:${name.toLowerCase()}`, 30 * DAY, () => mbz.artist(name));
  if (!found?.channel) return { results: [] };
  return { artist: found.name, results: await cached(`youtube:catalog:${found.channel}`, 7 * DAY, () => youtube.catalog(found.channel)) };
}

module.exports = async function discover(req, res, url) {
  const param = (name) => String(url.searchParams.get(name) || '').trim();
  const q = param('q').replace(/\s+/g, ' ').slice(0, 100);
  const path = url.pathname;
  try {
    if (path === '/api/plays') {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST a play' });
      const guest = !loopback(req) && /(?:^|;\s*)acrux_guest=/.test(req.headers.cookie || ''); // a guest's listening isn't yours
      if (!guest) {
        taste.record(await json(req));
        tracks.emit('plays', {}); // open pages redraw Home's rows and your songs (catalog.js)
      }
      res.writeHead(204).end();
      return;
    }
    if (path === '/discover/batch' && req.method === 'POST') {
      const body = await json(req);
      const bq = String(body?.q || '').trim().replace(/\s+/g, ' ').slice(0, 100);
      const asks = (Array.isArray(body?.asks) ? body.asks : []).slice(0, 40);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
      await Promise.all(asks.map((a, i) => search(String(a?.source), String(a?.kind), bq, a?.page, a?.warm !== false)
        .then((r) => res.write(`${JSON.stringify({ i, ...r })}\n`))));
      return res.end();
    }
    if (path === '/discover/radio' && req.method === 'POST') return send(res, 200, { results: await taste.radio((await json(req))?.seed) });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method Not Allowed' });
    if (path === '/api/taste') return send(res, 200, taste.taste());
    if (path === '/discover/foryou') return send(res, 200, await taste.forYou());
    if (path === '/discover/art') return art(res, param('u'));
    if (path === '/api/home') return send(res, 200, taste.home());
    if (path === '/api/songs') return send(res, 200, taste.mine());
    if (path === '/api/download') {
      const [name, id] = [param('album').split(':')[0], param('album').split(':').slice(1).join(':')];
      if (!validId(name, 'album', id)) return send(res, 400, { error: 'Not an album or playlist Discover knows' });
      const page = await cached(`${name}:album:${id}`, DAY, () => PAGES[name].albumPage(id));
      const files = page.tracks.filter((t) => t.playback?.kind === 'audio' && !t.preview && playlists.allowed(t.playback.urls.high))
        .map((t) => ({ title: t.title, load: playlists.fromUrl(t.playback.urls.high) }));
      return playlists.download(req, res, `${page.artist} - ${page.title}`, files);
    }
    if (path === '/discover/image') {
      // Answered within a second: a picture still being looked up (MusicBrainz goes one request a second) would hold one
      // of the page's few connections to this server. The lookup carries on and is kept; the page asks once more a few
      // seconds later (player.js).
      // ponytail: a lookup slower than that second try shows the placeholder until the page is drawn again.
      const lookup = images.image(Object.fromEntries(['artist', 'album', 'song', 'q', 'item'].map((k) => [k, param(k).slice(0, 200)]))).catch(() => null);
      const url = await Promise.race([lookup, new Promise((done) => setTimeout(done, 1000, null))]);
      return url ? art(res, url) : send(res, 404, { error: 'No picture found' });
    }

    if (path === '/discover/search') {
      const [name, kind] = [param('source'), param('kind')];
      if (!SOURCES[name] || !KINDS.includes(kind)) return send(res, 400, (await search(name, kind)));
      return send(res, 200, await search(name, kind, q, param('page'), param('warm') !== '0'));
    }

    if (path === '/discover/album' || path === '/discover/artist') {
      const name = param('source');
      const id = param('id');
      const kind = path.endsWith('album') ? 'album' : 'artist';
      if (!validId(name, kind, id)) return send(res, 400, { error: 'Not an album or artist Discover knows' });
      try {
        const page = await cached(`${name}:${kind}:${id}`, DAY, () => PAGES[name][`${kind}Page`](id));
        seen.remember(page.tracks); // its songs become searchable, even where the source can't find them
        return send(res, 200, page);
      } catch (err) {
        return send(res, err.expose ? err.status : 502, { error: logged(err, SOURCES[name][1]) });
      }
    }

    if (path.startsWith('/discover/similar/')) {
      const id = path.slice('/discover/similar/'.length);
      if (!/^\d{1,12}$/.test(id)) return send(res, 400, { error: 'Not a Jamendo track id' });
      const results = await cached(`jamendo:similar:${id}`, DAY, () => jamendo.similar(id)).catch((err) => (logged(err, 'Jamendo'), []));
      return send(res, 200, { results });
    }

    if (path === '/discover/youtube') {
      try { // a repeat costs nothing: searches and catalogues are kept a week, the chart a day
        const artist = param('artist').slice(0, 100);
        const body = artist ? await youtubeArtist(artist)
          : { results: q ? await cached(`youtube:${q.toLowerCase()}`, 7 * DAY, () => youtube.search(q)) : await cached('youtube:trending', DAY, () => youtube.trending()) };
        return send(res, 200, { ...body, quota: youtube.status() });
      } catch (err) {
        return send(res, err.expose ? err.status : 502, { error: logged(err, 'YouTube'), quota: youtube.status() });
      }
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    if (err.expose) return send(res, err.status, { error: err.message });
    console.error('Discover:', err);
    send(res, 500, { error: 'Something went wrong' });
  }
};

module.exports.artAllowed = artAllowed;
