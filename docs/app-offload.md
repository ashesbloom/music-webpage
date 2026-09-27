# What runs where, before ACRUX ships as an app

ACRUX is a browser page plus a small Node server on the same computer. An app (Electron or Tauri) keeps that same split:
the page becomes the app window, and the server runs inside the app. So the question isn't *server or browser*, but
which work belongs in the page and which in the local backend, and what is slow today.

Measured on this Mac (September 2026):

- **Page:** 18 scripts and the stylesheet, 349 KB unminified.
- **Covers** (`data/covers`): 43 covers take 55 MB. Five are over 2 MB, and the largest is 17 MB (album art embedded in
  FLAC files), served as it is to grids that show it at 160 px.
- **`/api/library`:** about 1,000 songs is 494 KB of JSON, sent uncompressed on every page load and after every change.

## Keep in the local backend

These can't move to the page, or shouldn't:

| What | Why it stays |
|---|---|
| API keys (Jamendo, YouTube, Google) | Anything in the page can be read by anyone who opens it. |
| Google Drive sign-in, Keychain token, Drive downloads | OAuth's loopback redirect, and the refresh token, belong outside the page. |
| The Drive cache and offline copies | They're files that outlive the page, trimmed by size and age. |
| SQLite: library, taste, collection, Discover cache | One store shared by every window, a guest's too. |
| ZIPs for Save to Computer | They mix files on disk with web downloads that have no CORS headers. |
| Collaborators (the Wi-Fi listener, invites, rights) | Guests reach this computer's server, not your window. |
| Proxies for covers and Archive files | Many sources send no CORS headers, so the page can't read them directly. |

## Already in the page

- Decoding, playback and scratching (Web Audio, an AudioWorklet).
- Prefetching the next song.
- Cover tinting.
- The queue and history.
- Recent searches.
- Library search.
- The player keeps going across pages (in-page navigation).

## Worth moving to the page

1. **Open instantly with a saved copy.** Keep `/api/library` and `/api/collection` in IndexedDB with an ETag. The page
   draws from the saved copy at once, then asks the server whether anything changed (a 304 costs nothing). Today every
   page load waits for both before drawing the library.
2. **Cache Discover answers in the browser.** Search pages, albums and artists are already cached in SQLite for a day. A
   service worker with the Cache API would save the round trip too, and let Discover pages you've seen open offline.
3. **Offline in the web edition (not needed in the app).** If ACRUX is also offered as a plain website without the
   server, offline copies could live in the browser's Origin Private File System instead of `data/offline`. The app
   keeps them on disk.

## Optimizations to do before shipping

| Change | Why | Size of the job |
|---|---|---|
| Cover thumbnails (for example 320 px WebP) made when a cover is saved, full size only on album pages | 55 MB of covers load today for a grid of 160 px tiles | Needs an image library (`sharp`, a native dependency) or the app's own image tools; about a day |
| gzip or brotli on JSON responses | `/api/library` shrinks from 494 KB to 71 KB (measured) | A few lines with `zlib`; an hour |
| ETag and `Cache-Control: immutable` on covers and the site's files (covers are already named by their hash) | Pages stop downloading the same pictures again | An hour |
| Send only what changed after an edit, not the whole library and collection again | Every ♥ fetches `/api/collection` whole | Half a day |
| Page long libraries (or send compact rows) | 10,000 songs would be about 5 MB of JSON | Half a day, once libraries get that big |
| Bundle and minify the scripts (esbuild), one file per page | 18 script requests become 1 per page; the scripts gzip to about 67 KB | Half a day; nav.js's page scripts need care |
| DeckAudio decodes a whole song into memory | An hour-long FLAC takes gigabytes; songs over 15 minutes are left out of Discover for this reason | A ring buffer in the worklet; a larger job, best done together with Auto Mix, which needs two songs playing at once |

## The app shell

- **Electron (recommended):** ACRUX leans on Web Audio worklets, `popover`, `<dialog closedby>`, CSS `:has()`,
  container queries and `field-sizing`. Electron ships one Chromium, so these behave the same on every computer, and
  Node runs the server as it does now.
- **Tauri** is much smaller, but uses the system's own web engine (WebKit on macOS, WebView2 on Windows), and the server
  would have to become a Node sidecar or be rewritten in Rust. Worth it only if download size matters more than
  behaving the same everywhere.

Either way, `HOST` and the Wi-Fi listener stay as they are. In the app, the invite switch in Collaborators is how people
on your network join.
