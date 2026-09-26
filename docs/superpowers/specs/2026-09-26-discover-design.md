# Phase 3 kickoff: the backend foundation and Discover

## Context
The ACRUX UI is finished. Every storage-backed action says "Coming soon" and the catalog is static (`javascript/catalog.js`). Phase 3 starts the backend. The first feature is **Discover**: free online music from Jamendo and the Internet Archive, plus YouTube on an explicit tap, built to the user's v2 plan. The "add more music" panel and the local edition come later.

**User decisions (this session)**
- Search bar: typing still shows library matches, plus a final row, "Discover “q” online →". Enter opens that row when nothing in the library matches.
- Quality: a Low / Medium / High pill on the Discover bar. It is remembered and defaults to Medium.
- YouTube: a sticky video card at the top of Discover's YouTube section. Leaving the page stops it.
- The user has both API keys and will put them in `.env` (gitignored), never in chat.

**Facts checked live**
- Jamendo stream URLs and Archive `/download/` both send `Access-Control-Allow-Origin`, so `DeckAudio`'s `fetch()` streams them directly with **no proxy**.
- Jamendo stream URLs take `format=mp31|mp32|flac`, which gives the three tiers.
- `GET /v3.0/tracks/similar?id=` exists.
- Archive item files are grouped as an original plus derivatives (`original` field), with formats `Flac`, `VBR MP3`, `Ogg Vorbis`, `64Kbps MP3` and so on.
- Archive's `services/img` thumbnail has **no** CORS header, but `/download/{id}/__ia_thumb.jpg` does. Discover uses the latter so the record tint (canvas) still works.
- Node is v26, so `node:sqlite` and `fetch` are built in. The backend adds **zero dependencies**, keeping the README's "0 dependencies" badge true.

## Approach (chosen)
The Discover API is mounted inside the existing `server.js` on the same origin, backed by SQLite through `node:sqlite`. This fits the plan to ship ACRUX as a locally hosted app.
- Rejected: a separate Express API, because it adds dependencies and CORS for nothing.
- Rejected: serverless functions to make Discover work on GitHub Pages, because that diverges from the local-app goal.
- Consequence: **GitHub Pages can't run Discover.** There the page says "Discover needs the ACRUX server (`node server.js`)".

---

## UI feature inventory: what exists, what needs a backend
| UI feature | Today | Backend it needs | When |
|---|---|---|---|
| Record deck (scratch, seek, spin, cover tint), header player, volume, phone iPod deck, panel divider | Client only | None | — |
| Queue: Continue Playing, Infinite, shuffle order | Client (`queue.js`) | Autoplay recommendations when Infinite runs out (`/api/queue/next`) | Later |
| Queue History | `localStorage.playHistory` | `plays` table, `GET/POST /api/history` | Local edition |
| Auto Mix toggle | Saved toggle, no effect | Track analysis (BPM, key, LUFS, mix points) plus a second deck voice | Later |
| ⋯ tray: Add to Playlist, Add to Favorites | "Coming soon" | Playlists and favorites tables | Local edition |
| ⋯ tray: Get Info, Go to Album/Artist, Share | Works (catalog) | Catalog API | Local edition |
| Side-panel search and Recent searches | Static catalog, `localStorage.searchHistory` | Library search API. **The online row is built now** | Now + local edition |
| Home rows: Recently Played, Recently Added | Static curated lists | `plays`, `added_at` | Local edition |
| Home "My Favorites" row, Favorites playlist, "Only Favorites" filter | Empty state / "Coming soon" | favorites | Local edition |
| Library: dial, crate, playlist, album, albums, artist views, sort and find | Client from static `CATALOG` | Catalog API (songs, albums, artists, playlists) from a scanned library | Local edition |
| Playlist actions: Edit (save), Pin, Duplicate, Order Songs, Delete, Upload photo | "Coming soon" | Playlist CRUD, image upload | Local edition |
| Download (song, playlist, album) | "Coming soon" | Download / offline endpoint | Later |
| Collaborators, "Invite with link" | Names only / "Coming soon" | Accounts and invites | Later |
| `search_pages/*` stubs | Static | Generated from data, or deleted | Local edition |
| **Discover page, streaming quality, YouTube card** | Doesn't exist | **This build** | **Now** |
| Add more music panel | Doesn't exist | Import / scan | Next, per the user |

---

## Backend design (new `api/` folder; `server.js` mounts it)

**`server.js`** (small edit)
- Add `try { process.loadEnvFile(); } catch {}` at the top. This reads `.env` if present.
- Add `if (pathname.startsWith('/discover/')) return discover(req, res, url);` before the static-file code.

**`api/db.js`** (about 40 lines): SQLite at `data/acrux.db`.
- `cache(key TEXT PRIMARY KEY, body TEXT, expires INTEGER)`
- `quota(day TEXT PRIMARY KEY, used INTEGER)`
- `cached(key, ttlMs, load)`:
  - Returns the stored JSON if it hasn't expired.
  - Otherwise it awaits `load()`, stores the result and returns it.
  - Errors are never cached.
- The quota day is the Pacific date (`toLocaleDateString('en-CA', {timeZone:'America/Los_Angeles'})`), because YouTube resets at midnight PT.
- `quota.used()` and `quota.spend(n)` read and update today's count.
- Nothing else is pre-created. Later tables (plays, favorites, playlists) arrive with their features.

**Shared result model** (every provider maps to this):
```
{ source: 'jamendo'|'archive'|'youtube', id, title, artist, album?, durationSec, artworkUrl,
  playback: { kind:'audio', urls:{low,medium,high} } | { kind:'embed', videoId },
  license?, sourceUrl }
```

**`api/jamendo.js`**
- **Search.** `GET https://api.jamendo.com/v3.0/tracks/?client_id&format=json&limit=20&imagesize=300&search=q&boost=popularity_month`.
- **Empty query.** An empty `q` uses `order=popularity_week` instead. That is Discover's landing: "Popular this week".
- **`similar(id)`.** Calls `/tracks/similar/?id=&limit=12`.
- **`map(t)`:**
  - `id` is `String(t.id)`, `artist` is `artist_name`, `album` is `album_name` or undefined (singles have none).
  - `artworkUrl` is `image`, falling back to `album_image`; `license` is `license_ccurl`; `sourceUrl` is `shareurl`.
  - `urls` are `t.audio` with `format` set to `mp31`, `mp32` and `flac` for low, medium and high.
- **Errors.** Jamendo returns HTTP 200 with `headers.status === 'failed'`, which is treated as an error (`error_message`). A missing key gives "Add JAMENDO_CLIENT_ID to .env".

**`api/archive.js`**
- **Search.** `advancedsearch.php`:
  - `q=(<sanitised q>) AND mediatype:audio AND collection:(etree OR netlabels OR audio_music OR georgeblood OR 78rpm)`.
  - `fl[]=identifier,title,creator,licenseurl`, `rows=8`, `output=json`.
  - Sanitising strips the Lucene specials `+ - ! ( ) { } [ ] ^ " ~ * ? : \ /`.
- **Files.** Then `GET /metadata/{id}/files` for each item, in parallel.
- **Politeness.** Every request sends `User-Agent: ACRUX/1.0 (personal music player)`, and each result is cached for 24 h.
- **`tracks(item, files)`** is pure and is the unit under test:
  - Audio files are grouped by their original file (`f.source==='original' ? f.name : f.original`).
  - Each tier takes the first match from its preference list:
    - high: `Flac`, `24bit Flac`, `VBR MP3`, `128Kbps MP3`, `MP3`, `Ogg Vorbis`
    - medium: `VBR MP3`, `128Kbps MP3`, `MP3`, `64Kbps MP3`, `Flac`, `Ogg Vorbis`
    - low: `64Kbps MP3`, `VBR MP3`, `128Kbps MP3`, `MP3`, `Ogg Vorbis`, `Flac`
  - Ogg comes last because Safari can't decode it.
  - `durationSec` is parsed from `length`, which comes as `"39.8"`, `"00:39"` or `"1:02:03"`.
  - Title comes from `f.title`, falling back to the file name without its extension. Artist is `f.creator || item.creator`, album is the item title, and groups are ordered by track number.
  - Up to **3 tracks per item and 24 in total**.
  - Download URLs are `https://archive.org/download/{id}/{path, each segment encoded}`.
  - `artworkUrl` is `/download/{id}/__ia_thumb.jpg` (CORS-safe) when the files include an `Item Tile`. Otherwise it is null, and the client uses `playback_tree/placeholder.svg`. `sourceUrl` is `/details/{id}`, and `license` is `licenseurl`.
- **Duration cap.** Both audio providers drop tracks with unknown length or longer than 15 min.
  `// ponytail: DeckAudio decodes whole files into memory (an hour of Archive concert is GBs); lift when it streams`

**`api/youtube.js`**
- **Search.**
  - `search.list?part=snippet&type=video&videoCategoryId=10&videoEmbeddable=true&maxResults=15&q&key` costs 100 units.
  - Then `videos.list?part=contentDetails&id=…` fetches durations for 1 unit.
  - Each search spends **101** units, recorded before the calls, since Google charges failed calls too.
- **Refusals.** It refuses with 429 when `10000 - used < 101`. A Google `quotaExceeded` response sets today's `used` to the limit.
- **Map.** Titles have their HTML entities decoded (the API returns `&#39;`). `artist` is the channel title, and `durationSec` comes from the ISO 8601 duration (`PT3M21S`). Artwork is the high thumbnail, and `playback` is `{kind:'embed', videoId}`.

**`api/discover.js`** (routes, JSON only, `Cache-Control: no-store`)
- `GET /discover/search?q=` returns `{ q, jamendo:{results}|{error}, archive:{results}|{error} }`.
  - It uses `Promise.allSettled`, so one failing source never hides the other. Each is cached for 24 h under the key `jamendo:q` or `archive:q` (lower-cased, trimmed, max 100 chars).
  - An empty `q` returns Jamendo "popular this week" only.
- `GET /discover/youtube?q=` returns `{ results, quota:{used, remaining, limit} }`, cached for 7 days. A cache hit spends nothing.
  - An empty `q` returns just `{ quota }` for free, so the button can show "≈ N searches left today" before the tap.
  - A missing key gives 503 "Add YOUTUBE_API_KEY to .env".
- `GET /discover/similar/:id` returns `{ results }`, cached for 24 h. The id must match `/^\d+$/`, or the route answers 400.
- Every upstream call uses `AbortSignal.timeout(8000)`. Keys stay on the server and are never sent to the browser or logged.

**Other files**
- `.gitignore` adds `.env` and `data/`.
- README "Run it locally" gets a short Discover section: the `.env` keys, and that Discover needs `node server.js`.

---

## Frontend design

**Where it lives.** `library.html?view=discover`, rendered by a new **`javascript/discover.js`**.
- It reuses the library shell, so audio survives navigation.
- `library.js` gets `if (view === 'discover') return;` so `discover.js` owns `#library`.
- `nav.js` adds `'discover.js'` to `PAGE_SCRIPTS`.
- `library.html` gets the script tag after `library.js`.

**Entry points**
- The home **Discover** tile links to `library.html?view=discover`. Today it points at the Smithereens album.
- The side-panel search gets the online row.
- The side-panel Library nav gets a "Discover" link (existing `icon-magnifying-glass`) in `index.html` and `library.html`.

**Page layout.** It reuses the playlist page's classes: `pl_bar`, `pill`/`tool`, `kicker`, `pl_list`/`pl_row`, `songname`, `pl_playall`, home `row-1` cards.
```
[‹]                                   ( Low | Medium | High )        ← pl_bar, quality pill
DISCOVER
“night drive”            (or "Popular this week" with no query)
Free & Creative Commons music · Jamendo · Internet Archive

Jamendo                                                      ← h3.songname + small source badge
  ♡ [thumb] Title  [JAMENDO]   Artist   Album   3:21   ⋯     ← pl_row, data-list="discover:jamendo:<q>"
More like “Title”                                            ← row-1 cards, appear once a Jamendo song plays
Internet Archive
  ♡ [thumb] Title  [ARCHIVE]   Artist   Item    4:02   ⋯
[ ▶ Explore more on YouTube ]  ≈ 97 searches left today     ← pl_playall
  ┌──────── video card (sticky, 16:9, min 200×200) ────────┐
  YouTube rows (thumb, title, channel, time) → load in card
```
- **Section states:** "Searching…", "Nothing on Jamendo for “q”", the API's error text, and, when `/discover/*` isn't JSON (Pages or static hosting), one page note: "Discover needs the ACRUX server (`node server.js`)".
- **Escaping:** everything third-party goes through `esc()` (the same one-liner as `library.js`). All URLs are attribute-escaped.
- **CSS:** about 40 lines in `style/insert.css` for the source badge, the text quality pill, the sticky `.yt_card` (`position:sticky; top:0; aspect-ratio:16/9; min-height:200px; min-width:200px`), and the section notes. No restyling of existing parts.

**Playing Jamendo and Archive tracks: the existing player and queue, unchanged in spirit**
- **Mapping.** Results become song objects:
  - `{ id:'jamendo:123', title, artist, albumTitle, time:'m:ss', cover, urls, source, sourceUrl, href: <this Discover URL> }`.
  - `src` is a **getter**, `get src(){ return this.urls[quality()] || this.urls.medium }`. Quality therefore applies to the next load and to prefetch with no re-mapping. `player.js`'s existing `music.preload(songs[upNext()].src)` gives Discover prefetch for free.
- **`catalog.js`.** Adds a runtime list registry, `addList(key, songs)`, and `list(key)` checks it first. `player.js`'s `[data-song]` / `[data-list]` click path then works for Discover rows untouched.
- **`player.js`.** Two one-line fixes:
  - `setList` keeps its place by `id`, not object identity.
  - `#playback_cover` gets `crossOrigin='anonymous'` so remote covers still tint the record. Same-origin covers are unaffected.
- **`queue.js`.** `entry(s)` falls back when a song has no catalog album: `album: al?.title ?? s.albumTitle`, `href: al ? … : s.href`. A Discover song in History then links back to its Discover search.
- **`more.js`.** Guards `CATALOG.album(...)` in the same way:
  - Go to Album and Go to Artist are hidden for Discover songs.
  - Get Info shows `artist — albumTitle · time`.
  - Share uses `s.sourceUrl`.
- **Now-playing glow.** It uses the same 3-line `mark()` pattern as `library.js`. The listener is removed once the page is swapped out.

**More like this.** When a Jamendo song starts playing (from Discover), `discover.js` fetches `/discover/similar/:id` and renders "More like “Title”" as a `row-1` card row under the Jamendo list. It is playable in its own list `discover:similar:<id>`. No new button or icon is needed.

**YouTube**
- The "Explore more on YouTube" tap calls `/discover/youtube?q=`.
- The IFrame API (`https://www.youtube.com/iframe_api`) loads lazily once and is kept as `window.ytReady` (a promise), since `discover.js` reruns on navigation.
- Tapping a row calls `loadVideoById` in the sticky card. That tap is the user gesture, so it plays.
- **Coordination:**
  - When the video starts playing and `DeckAudio` isn't paused, `#master_play` is clicked so the header icon stays right.
  - When `music` plays, `pauseVideo()`.
  - When a video ends, the next result is **cued, not autoplayed** (the plan's "cue the next video only").
- Navigating away removes the iframe, which satisfies YouTube's no-background-play rule.
- YouTube rows are not `[data-song]`, so the header controls, queue and record stay `DeckAudio`-only.

**Search panel (`search.js`)**
- While typing, `show([...hits, online(q)])`. The online row links to `CATALOG.page('view=discover&q=' + encodeURIComponent(q))`, with meta "Jamendo · Internet Archive · YouTube".
- Enter already opens the first link, so it becomes the online row when nothing local matches. No extra code.

---

## Build order
1. `.gitignore` (`.env`, `data/`). `api/db.js`. Mount `api/discover.js` in `server.js`.
2. `api/jamendo.js`, then `/discover/search` (Jamendo half) and `/discover/similar/:id`.
3. `api/archive.js` with tier picking, completing `/discover/search`.
4. `api/youtube.js`, `/discover/youtube` and the quota.
5. Frontend:
   - `catalog.js` registry, and the small fixes in `player.js`, `queue.js` and `more.js`.
   - `discover.js` (page, quality pill, playback, More like this).
   - The YouTube card.
   - `search.js` online row, home tile and nav links, `nav.js` and `library.js` one-liners, CSS.
6. README Discover section. On approval, also save this spec as `docs/superpowers/specs/2026-09-26-discover-design.md` (the record-scratch/queue convention). **No commit unless asked**, and never with a Co-Authored-By trailer (see memory).

**Execution:** inline, in this session (saves usage). This plan is detailed enough to act as both the spec and the implementation plan.

## Verification (kept minimal, per memory)
1. `node --check` on each new or changed JS file.
2. **One** new test file, `tests/discover.test.js` (`node --test`), with inline fixtures and no network:
   - Archive `tracks()`: a Flac original with VBR MP3 and Ogg derivatives gives high = flac, medium = VBR mp3, low = VBR mp3. An MP3-only item gives that MP3 for every tier. A 40-min file is dropped. Lengths `"39.8"`, `"00:39"` and `"1:02:03"` all parse.
   - Jamendo `map()`: the three `format=` URLs are correct.
   - YouTube: the ISO duration parses, and `&#39;` is decoded.
3. A live smoke test with the user's `.env`, run once:
   - `curl localhost:3000/discover/search?q=lofi` returns both sections.
   - `/discover/similar/<an id from it>` returns results.
   - `/discover/youtube?q=lofi` twice: the second call is a cache hit, so `quota.used` doesn't change.
4. The user checks by eye with `node server.js`:
   - Search, then the online row.
   - Play a Jamendo track: the record tints, the queue and prefetch continue, and "More like this" appears.
   - Switch quality.
   - Play an Archive track and seek.
   - Explore YouTube: the card plays, and playing the record pauses it.
   - Navigate away: the video stops.
5. Afterwards, update memory (`acrux-roadmap`): phase 3 has started, Discover is built, the backend lives in `api/` + `node:sqlite` with keys in `.env`, and the next step is the add-more-music panel, then the local edition.

## Skipped (add when needed)
- **License display:** only the source badge and artist are shown. Add a license link in Get Info before sharing publicly.
- **Tables:** no favorites, playlist or history tables yet; they arrive with the local edition.
- **Deduplication:** no cross-source deduplication and no MusicBrainz or Last.fm, per the plan.
- **Stream proxy:** none needed, since both hosts allow CORS.
- **Rate limiting:** `HOST=0.0.0.0` exposes the YouTube quota to the whole LAN. The quota guard is the only protection; add auth with accounts.

---

## Revision 2 (2026-09-26, after first use)
The user found too few songs, no albums or artists, an unlabelled quality switch that seemed to do nothing, and no visible YouTube. Their choices: load **as you scroll**, and use **both** tabs and rows.
- **API:**
  - `/discover/search?q=` returns page 1 of `songs`, `albums` and `artists` (Jamendo and the Archive merged).
  - `&kind=songs|albums|artists&page=n` returns the next page, as `{ results, more, errors }`.
  - `/discover/album?source=&id=` and `/discover/artist?source=&id=` return a full album, or an artist with their albums and top tracks.
  - `/discover/youtube` with no `q` returns the trending music chart. It costs 1 unit and is cached for a day.
- **Jamendo:**
  - `/tracks/similar` always returns 0, so "More like this" now finds popular tracks that share the track's genre tags.
  - Albums and artists come from `namesearch`, ordered by `popularity_total`.
  - Paging uses 20 per page with an offset.
- **Archive:**
  - Live Music Archive items are `mediatype:etree`, so the old filter missed all of them, the Grateful Dead's 11k shows included.
  - The filter is now `(mediatype:etree OR (mediatype:audio AND collection:(…))) AND NOT collection:stream_only`.
  - Items are albums and creators are artists.
- **Page:**
  - Tabs: All (Artists and Albums rows, 10 songs, YouTube) · Songs · Albums · Artists (each loads more on scroll through an IntersectionObserver) · YouTube.
  - Album and artist pages use the library's hero and row layout.
  - Quality has a visible label and a caption for the chosen tier. Switching reloads the playing song at the same spot, using a new `canplay` event on `DeckAudio`.
  - Row artist and album cells link to the Discover pages, and so do the ⋯ tray's Go to Album and Go to Artist.

---

## Revision 3 (2026-09-26): covers, fast starts, more sources, taste
The user asked for a taste-driven Discover, a record cover that always shows, lower latency, and far more songs (the Radiohead test). A research sub-agent surveyed free sources.
- **Cover bug:** `#playback_cover.crossOrigin` plus Archive file servers that send no image CORS left every Archive song's record blank.
  - The label now has no crossOrigin.
  - A document-level image `error` listener tries `data-alt` (the album art), then the placeholder.
  - The tint is read through a fresh CORS fetch, else `/discover/art` (a proxy limited to the sources' hosts).
- **Fast start:**
  - `DeckAudio` streams the download and decodes it at 256 KB and each doubling. The worklet takes `keep: true` parts without moving the playhead.
  - While partial it doesn't end, it stalls if it catches up, and a seek past the download waits there. Duration is estimated from part growth.
  - Measured: Jamendo Medium plays in 2.0 s (was 9.6 s), FLAC in 3.4 s (was 31 s).
- **Sources:**
  - Archive: creator, title and subject over audio and etree, spoken word blocked, sorted by downloads. Community uploads are marked; the user accepted the legal grey area.
  - Audius: full songs, no key.
  - iTunes: 30 s previews, dropped when a full source or YouTube has the song.
  - YouTube: artist catalogues via MusicBrainz, then the Topic channel's uploads list.
  - Per-source requests, with the next page warmed. Archive item track lists are cached.
- **Taste:**
  - `POST /api/plays` carries the seconds heard (library, Discover and YouTube).
  - The `songs`, `plays` and `artist_genres` tables drive `GET /api/taste`: genres, kinds, categories, artists, albums and songs, all-time and with a 7-day half-life over 30 days.
  - `GET /discover/foryou` gives On repeat, Your recent mix, Because you like…, More from… and Artists like (ListenBrainz). It is rebuilt every 5 plays, in the background.
  - The Discover landing shows it with "Your taste" chips.
