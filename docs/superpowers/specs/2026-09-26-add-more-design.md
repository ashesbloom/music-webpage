# Add More Songs: local import + Google Drive library

## Context

ACRUX's roadmap says Add More Songs comes next, then the local edition. You want two ways to add music, both played from this machine:

1. **Local:** drop songs, folders or a `.zip` on the page. They're copied into ACRUX on this computer, then played from disk. Nothing is uploaded anywhere.
2. **Google Drive:** paste a folder link. The backend indexes it, streams each song through a local cache, and prefetches ahead so skips feel instant. This follows your pasted plan, build-order steps 1–3.

Decisions from Q&A:
- **Stack:** keep the current one (plain JS, `node:http`, `node:sqlite`) and add a single npm package, `music-metadata`. The pasted stack doesn't earn a rewrite:
  - `server.js` already does ranges and streaming.
  - `googleapis` would only wrap three REST calls.
  - keytar is archived.
  - A two-level queue is a few lines.
- **Local songs:** copied into `data/music/`.
- **Scope:** Drive steps 1–3. Quality tiers, transcoding and Drive variants come later.
- **Panel:** the current look, functional. The redesign comes later.

**Adapted to how ACRUX actually plays.** `DeckAudio` (`javascript/deck-audio.js`) fetches a song from byte 0 and decodes it in memory as it arrives. It never sends Range requests and seeks only within what it has decoded. So:
- The Drive cache is a **growing prefix per file**, not sparse chunks with a bitmap.
- No byte-accurate FLAC seeking.
- The current song, and the next one (via `preload()`), are fetched whole by the client. The backend's own job is the **heads of the next K songs**, plus album-open hints.

The plan's 1 MB/4 MB chunks and 3-connection preemption reduce to three rules:
- Client requests always run.
- One background head download runs only while no client download is active.
- A client download that starts aborts the background one. Its bytes are kept, and it resumes from where it stopped.

## Design

### Storage (SQLite tables in `api/library.js`; files under `data/`, which is gitignored and never served statically)

- `sources (id, kind 'local'|'drive', title, folder, resource_key, auth 'key'|'oauth', status, added, synced)`. There is one `local` row; each Drive source's id is `drive:<folderId>`.
- `tracks`:
  - `(id, source, path, name, title, artist, album, album_artist, album_id, track_no, disc_no, year, genre, duration, sample_rate, bits, codec, size, md5, modified, cover, head, added, used)`.
  - `id`: the SHA-1 of the bytes for local songs, which makes duplicates free to detect; the Drive file id for Drive songs.
  - `album_id`: `sha1(source kind + album artist + album)`, shortened.
  - `head`: bytes for about 10 s of audio, `metadataBytes + 10 × size/duration`.
  - `used`: last play, for LRU.
- `settings (key, value)`: `cacheGB` (default 10) and `prefetch` K (default 3).
- Files:
  - `data/music/<Album Artist>/<Album>/<original file name>`, with a short-hash prefix on a name clash.
  - `data/covers/<sha1>.<ext>` for embedded art and folder `cover|folder|front.jpg|png`.
  - `data/drive-cache/<fileId>`, whose file size is how much of the prefix is cached.
- The tracks table is also the hook for the later AI enrichment: a future job updates rows and emits `library`. Nothing is built for it now.

### API (new router `api/library.js`, mounted in `server.js` before `discover`)

| Route | Does |
|---|---|
| `GET /api/library` | `{ tracks, sources }`: everything, so the client builds albums/artists (like `CATALOG.addSaved`) |
| `GET /api/tracks/:id/audio` | Local: the file with Range support. Drive: from the cache, or a live download teed into it |
| `GET /api/covers/:file` | A cover from `data/covers` (name checked against `^[0-9a-f]{40}\.(jpg|png|webp)$`) |
| `POST /api/import?name=<relative path>&batch=<id>` | The raw body is one file (audio, cover image or `.zip`) → `{ added, skipped: [{name, why}] }` |
| `DELETE /api/albums/:id` | Removes a **local** album's files and rows |
| `GET/POST /api/sources`, `POST /api/sources/:id/scan`, `DELETE /api/sources/:id` | List · add a Drive folder `{url}` · rescan · remove (rows + cache) |
| `GET /api/drive/connect`, `GET /api/drive/callback`, `POST /api/drive/disconnect` | OAuth loopback flow |
| `PUT /api/player/state {ids}` · `POST /api/player/intent {album}` | Upcoming Drive track ids · an album page opened |
| `GET/PUT /api/settings` | Cache size, prefetch depth |
| `GET /api/events` | SSE: `scan` {source, found, read, total, status}, `library` (tracks changed) |

**Guards** (security, not optional):
- Every non-GET route rejects a request whose `Origin` isn't this server's own `Host`. This blocks cross-site POSTs to `localhost` (CSRF).
- Import, sources, Drive connect/disconnect and settings `PUT` also require a loopback client. With `HOST=0.0.0.0`, phones on the Wi-Fi can play but can't write to your disk.
- `sendFile` keeps the path check; imported files are named by the server, never from a zip entry path, so a malicious zip can't write outside `data/music`.

### Local import (`api/local.js`)
1. The client POSTs each file raw, 2 at a time. It skips anything that isn't audio or `.zip`; cover images are sent first so their folder's songs can use them.
2. The server streams the body to `data/music/.incoming/<random>`, computing its SHA-1 as it goes.
3. **Zip:** a small reader of the End Of Central Directory record and central directory. It supports stored and deflate (`zlib.createInflateRaw`), skips encrypted entries and refuses ZIP64 with the message "unzip it and drop the folder instead" (`ponytail:` note, matching the ZIP writer in `api/playlists.js`). Each audio or cover entry goes through step 4.
4. **Audio** (mp3, flac, m4a, aac, ogg, oga, opus, wav, aif, aiff):
   - A known SHA-1 is skipped as a duplicate.
   - Otherwise, `parseFile` (music-metadata) reads the tags, duration and format, and extracts the embedded cover.
   - Fallbacks: the title comes from the file name, with "01 - " stripped; the album from the folder name; the artist is "Unknown artist".
   - The cover is the embedded one, else the same batch-and-folder image (an in-memory map), else the placeholder. There's no online lookup, so it stays local.
   - The file moves to its readable path, the row is inserted, and `library` is emitted.

### Google Drive (`api/drive.js`)
- **URL parsing:**
  - Accepted: `/folders/<id>` (also `/u/N/…`, shared drives, `?usp=sharing`), `open?id=<id>`, and a bare id. `resourcekey=` is kept.
  - A `/file/d/` link gets "paste the folder's link".
  - All calls use `supportsAllDrives=true&includeItemsFromAllDrives=true`.
- **Auth:**
  - The API key is `GOOGLE_API_KEY`, falling back to `YOUTUBE_API_KEY` (the same Cloud project; enable the Drive API there).
  - If the folder isn't public: when Drive is connected, OAuth is used; otherwise the API returns `{ needsAuth: true }` and the panel shows "Connect Google Drive".
  - **OAuth:** a desktop client (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in `.env`) with PKCE and a `state`, scope `drive.readonly`, `access_type=offline`. The redirect goes to the loopback host the user is on.
  - The refresh token is kept in the **macOS Keychain**: `security add/find/delete-generic-password -s ACRUX -a google-drive`, called via `execFile`, never a shell. Elsewhere it's a `0600` file in `data/`.
  - Access tokens stay in memory and are refreshed on expiry. On `invalid_grant`, the panel shows "Reconnect".
- **Scan:**
  1. Breadth-first listing, 1000 per page, fields `id,name,mimeType,size,md5Checksum,modifiedTime,resourceKey`. Progress arrives over SSE.
  2. Diff against the source's rows: removed files → delete the row and its cache; a changed `md5`/`modifiedTime` → re-read the tags and drop the cache; new files → read the tags.
  3. Tags: an `alt=media` fetch piped through a byte counter into `parseWebStream(..., {mimeType, size}, {skipPostHeaders: true})`, aborted once it resolves. That's one request per track, 4 at a time. Bytes consumed + 10 s of audio give `head`.
  4. Folder cover images are downloaded (capped at 2 MB).
- **Errors:**
  - `429`/`5xx`/`rateLimitExceeded`/`userRateLimitExceeded`: exponential backoff with jitter, 5 tries.
  - `downloadQuotaExceeded`/`cannotDownloadFile`: the file is marked cooling for 5 minutes.
  - A tag-read failure keeps the name-derived metadata.
- **`ponytail:`** rescans re-list the folder instead of using the Changes API (one request per 1000 files per folder). Shortcuts aren't followed.

### Cache, stream and prefetch (`api/cache.js`)
- **Jobs:** `jobs: Map<fileId, { have, upto, ctrl, events, consumers }>`. `want(track, upto, foreground)` starts or extends a job.
  - It downloads with `Range: bytes=<have>-[upto-1]` and appends to `data/drive-cache/<id>`, updating `have` and emitting progress.
  - Errors back off as in the scan.
- **Stream:**
  - A complete file is served with `sendFile`, ranges included.
  - Otherwise the server sends `200` with `Content-Length: size`, calls `want(track, ∞, fg)`, and pipes from the file up to `have`. It waits on progress events and honours backpressure.
  - When the last client leaves and the file isn't upcoming, its download stops. The prefix is kept.
- **Priorities:**
  - Client downloads (current song and `preload()`): P0/P2/P4.
  - One background queue:
    1. Heads of the upcoming K (P3/P5, in queue order).
    2. Heads of the first 2 tracks of the last 2 opened albums (P6).
  - Background work runs only while no client download is active; a client download that starts aborts it.
  - A new `player/state` cancels background jobs for tracks that dropped out.
- **LRU:** when a job ends and `data/drive-cache` is over `cacheGB`, delete by oldest `tracks.used`, skipping active and upcoming files.
- **`ponytail:`** one connection per file. Parallel ranged chunks can come in if one Drive connection can't fill a fast link. Pinning albums for offline listening is left for later.

### Client
- **`javascript/catalog.js`:**
  - `ready` also fetches `/api/library` and turns tracks into songs `{ id: 'lib:<id>', trackId, n, title, time, album, artist, cover, src: SITE+'api/tracks/<id>/audio', local|drive }`, albums (existing artists matched by name, else a new `lib-<slug>` artist) and artists. It mutates the arrays in place.
  - `reload()` swaps these entries and resets `ready`.
- **`javascript/addmore.js` (new), mounted by `library.js`** into My Music's `.addmore` section:
  - A drop zone (files, folders via `webkitGetAsEntry`, zips) and Choose files / Choose a folder buttons (`<input multiple>` / `webkitdirectory`). Progress reads "Adding 12 of 40 · …", then a summary with the skipped songs.
  - A Drive link field and Add button, with a Connect Google Drive button when needed.
  - The source list (This computer · N songs; each Drive folder with scan progress, Rescan and Remove).
  - A cache line: "2.1 GB of [10 GB] · prefetch next [3] songs".
  - On an SSE `library` event, it calls `CATALOG.reload()` and then `window.navReload()`. The page re-renders and the music keeps playing.
- **Small hooks:**
  - `queue.js`: `window.upcoming = (k) => order.slice(0, k).map((i) => songs[i])`.
  - `player.js`, on `play`: PUT the upcoming Drive ids.
  - `library.js`: POST intent when a Drive album page opens; "Remove album" in the ⋯ menu for local albums; `genre · year` joined without empties; mount addmore.
  - `search.js`: build its list after `CATALOG.ready`, so new albums are searchable.
  - `nav.js`: `window.navReload = () => go(location.href, false)`.
  - `index.html` and `library.html`: add the `addmore.js` script.
- **`style/insert.css`:** the panel, in the existing dashed-tile/dark/red look.

### Shared refactor
- The Range file serving and `TYPES` move from `server.js` into `api/common.js` as `sendFile(req, res, file, type)`, used by static files, local tracks, complete cache files and covers. `TYPES` gains m4a, ogg, opus, wav, aac and aiff.

## Build order (inline, one task at a time)
0. Save this design as `docs/superpowers/specs/2026-09-26-add-more-design.md` (the repo's spec convention).
1. Add `package.json` (`music-metadata`, scripts `start`/`test`) and run `npm install`; add `node_modules/` to `.gitignore`. Move `sendFile` and `TYPES` into `common.js`.
2. `api/library.js`: tables, settings, SSE, guards, the library/covers/tracks routes; mount it in `server.js`.
3. `api/local.js`: import, the zip reader, tags, album removal.
4. Client: catalog, addmore.js (local part), library.js/search.js/nav.js hooks, CSS. **Local import works end to end here.**
5. `api/drive.js`: URL parsing, API key, OAuth and Keychain, scan and diff.
6. `api/cache.js`: prefix cache stream, background heads, LRU; plus the player/queue/intent hooks.
7. addmore.js Drive part (link field, connect, sources, cache settings).
8. README (setup: `npm install`, the Drive API, the OAuth desktop client, publishing the consent screen "In production" so refresh tokens don't expire after 7 days) and a memory update (`acrux-roadmap`).

## Verification (kept small, per your testing preference)
- `node --check` on every changed JS file.
- One new `tests/add-more.test.js` (`node --test tests/add-more.test.js`):
  - Drive URL parsing for every listed format, plus the file-link error.
  - The zip reader on a hand-built zip (one stored entry, one deflated).
  - The file-name fallback ("01 - Song.flac" → track 1, "Song").
- Manual, local:
  - `node server.js`, then zip `playback_tree/songs/joji/smithereens` and `curl -X POST --data-binary @x.zip -H 'Origin: http://localhost:3000' 'localhost:3000/api/import?name=x.zip'`.
  - Check `GET /api/library`, `curl -I` a track's audio, a duplicate import that gets skipped, and a cross-origin POST that gets refused.
- Manual, Drive (needs your key/client in `.env` and a folder link): add a public folder, watch the scan progress, play a song, and check that `data/drive-cache` grows and the next songs' heads appear.
- You do the visual check of the panel.

## Known limits (stated, not fixed)
- Some browsers won't decode a cut-off FLAC, so there the song starts only after its whole download (DeckAudio's existing fallback).
- Decoded songs live in memory, so very long files use a lot of RAM.
- The quality pill doesn't apply to local or Drive songs until tiers exist (step 4). No commits unless you ask; when you do, they get no Co-Authored-By trailer.
