# ACRUX: less network while playing, cached pages, live Home, remembered state

Status: approved 2026-09-27.

## Context

**What you asked for**
- Playing FLAC makes the app lag, because it pulls too much from the network.
- Pages should be cached once loaded. While a song plays, the network should carry the song, not the app.
- Home should update live. A song you add should show in Albums and Recently Added right away.
- ACRUX should remember everything across a reload, a close, or a reopen, including the song and its playback time.
- Look after the Drive requests, and leave room for Auto Mix.

**What I found and measured**
- **Nothing is cached.** The server sends every page, script, style and cover with `Cache-Control: no-store`
  (`api/common.js:82`). So every page change downloads the page and 3 scripts again, plus the covers.
- **Your FLACs are big.** The Drive OK Computer ones are 24-bit/96 kHz, 95–160 MB a song.
  - Drive always streams; "Play from where it is" only changes music on this computer.
  - When a song starts, the page downloads the whole song, then the whole next one (`player.js:119` →
    `deck-audio.js:332`). That's about 260 MB on your internet line at once, shared with cover lookups and Discover.
- **Decoding is not the main lag.** One 131 MB FLAC starts in 0.3 s and is fully decoded in 1.8 s, with one 111 ms
  freeze and about 290 MB of memory. Fetching the whole next song ahead doubles that memory.
- **The page's own data is tiny.** API calls answer in about 1 ms with 12 B–31 KB. The waste is repeating them on
  every page change.
- **Home doesn't hear about changes.** It loads its rows once per visit. Live events (`/api/events`) reach
  `catalog.js` (favorites only), My Music's Add More panel, and Set up.
- **Nothing remembers** the song, its second, the queue or the page.
  - Already remembered: volume, repeat, shuffle and Infinite, history, panel width, search history and quality.

**Your decisions so far**
- On reopen: the song is ready and paused at the same second, with the same queue.
- Also remember the page you were on, and the window's size and place.
- The next song gets only its first seconds ready. Drive requests get a foundation, and Auto Mix isn't blocked.
- Caching approach A: the browser's own cache, plus one live connection per window. No service worker.

---

## Section 1: songs and Drive

1. **No whole next song.**
   - `player.js` stops calling `music.preload(next)` for your own songs (`/api/tracks/…`, local and Drive).
   - Discover songs (small MP3 streams from the internet) still get fetched ahead.
   - `DeckAudio.preload()` stays as the hook Auto Mix will call, so the next song is decoded before the mix point.
2. **The server's fetch-ahead is unchanged.**
   - The start of the next few songs (tags plus a few seconds, about 2 MB) is fetched one at a time, only while
     nothing is streaming. This is the "Get the next 3 songs ready" setting (`api/cache.js` `pump()`).
   - It's why skipping still starts instantly.
   - When Auto Mix comes, how much of the start it keeps becomes that feature's knob.
3. **One paced line for Drive downloads.** It goes in `request()` in `api/drive.js`, which every Drive call already
   passes through.
   - Downloads made with the API key that nobody is waiting on are spaced a few seconds apart: fetch-ahead starts,
     songs downloaded for offline play, and tag reads during a folder scan.
   - A song you press Play on skips the line.
   - Signed-in downloads aren't paced.
   - The gap is one constant, to raise if Google still holds you back.
   - This is on top of what's there: background work waits while a song streams, and pauses 15 min after a
     hold-back.
4. **Decoding stays as is.** One 111 ms freeze per big FLAC isn't worth a rework, and item 1 halves the peak memory.

**Result:** while a Drive song plays, your internet carries that song. After it has finished downloading, the
upcoming songs' starts follow, about 2 MB each, paced.

## Section 2: cached pages and live updates

1. **Cache headers.** `sendFile` gets a cache choice, and `server.js` passes it:
   - pages, scripts, styles and `playback_tree` images: `no-cache` plus an ETag (size and time), so an unchanged
     file answers "304 Not Modified" with no body, and an app update shows at once;
   - covers (`/api/covers/<content hash>`): kept for a year (`immutable`);
   - cover lookups (`/discover/image`, `/discover/art`): a week, as today;
   - song audio: still not stored. It's already on disk, and caching 100 MB+ FLACs would store them twice;
   - JSON API: still not stored, but held in the page instead (item 3).
2. **Pages in memory.** `nav.js` keeps each page's HTML for the window's life. There are only two, `index.html` and
   `library.html`, and every library view is the same file. So a page change sends no request for the page, and
   the scripts it re-runs answer 304.
3. **Page data in memory.** `/api/songs`, `/api/playlists/played` and `/api/home` are fetched once and kept in
   `CATALOG`. They're fetched again only when the server says something changed. Today `search.js` and
   `discover.js` fetch them on every page change.
4. **One live connection per window.** It's the one `catalog.js` already opens, and `addmore.js` and `setup.js` use
   it instead of opening their own. It carries:
   - `library` (songs added or removed): the catalog reloads. Home redraws Albums, Recently Added and its rows. My
     Music and your album, artist and playlist pages redraw in place, keeping their scroll. Discover pages don't.
   - `plays` (new; the server sends it after a play is counted, batched): Home's Recently Played, By Artist and By
     Albums, and search's "your songs", refresh.
   - `collection`: as today.
5. **Faster.** The server already batches library changes for 1 s. The 2 s the Add More panel adds on top goes, so a
   new song shows about 1 s after it lands.

## Section 3: remembered state

1. **The song.** `player.js` saves `nowPlaying` in localStorage:
   - the list key, the song ids (your songs) or results (Discover), the index, the second and the length;
   - saved when a song starts, on pause and seek, every 5 s while playing, and when the window hides or closes.
2. **On load,** after `CATALOG.ready`:
   - the list is rebuilt, dropping songs no longer in your library;
   - the header, the record and the seek bar show the song at the saved second, paused;
   - Play continues from that second. `DeckAudio` seeks once it's decoded, as it already does for a seek past
     what's loaded, and YouTube songs seek too;
   - the queue rebuilds from the list (a new shuffle order; Infinite's added songs stay in the list).
3. **The window.** `desktop/main.js` saves its size, place and last page in `userData/window.json`, on close and
   (batched) on move or resize. It reopens there, or at the default if that screen is gone. In a browser, a reload
   already keeps the page.

---

## Files (expected)
- `javascript/player.js`, `javascript/deck-audio.js` (a pending position before load),
  `javascript/catalog.js`, `javascript/nav.js`, `javascript/home.js`, `javascript/search.js`,
  `javascript/discover.js`, `javascript/addmore.js`, `javascript/setup.js`
- `api/common.js`, `server.js`, `api/drive.js`, `api/cache.js` (a comment), `api/discover.js` (the `plays` event)
- `desktop/main.js`

## Verification (small)
- `node --check` on the changed files, plus the existing tests.
- Scratch server with a muted headless Chrome:
  - Page changes send no HTML request and get 304 for scripts.
  - Adding a song redraws Home within about 2 s.
  - Playing one of your songs sends no request for the next song.
  - Reloading keeps the song and second, paused.
- You, in the app: play a Drive FLAC, browse around, then close and reopen.
