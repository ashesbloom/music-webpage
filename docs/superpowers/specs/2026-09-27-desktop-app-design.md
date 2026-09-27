# ACRUX desktop app (Mac + Windows): design

## Context

ACRUX is a browser page plus a small Node server that run on one computer. You want to ship it as an installable
app for Mac and Windows, for yourself and friends, with no signing costs. A Flutter Android app comes later.

**What you decided (2026-09-27)**
- Audience: you and friends. Builds are free and unsigned, published on GitHub Releases.
- The demo Joji songs (114 MB) are left out of the installer. The app hides every built-in demo item. The website and
  GitHub Pages copy keep the demo unchanged.
- App icon: `playback_tree/favicon.svg` (the dark record with the red label), enlarged.

**What I assumed (tell me if any is wrong)**
- Mac builds come in two versions, Apple Silicon (arm64) and Intel (x64). Windows gets one x64 installer.
- The window keeps a standard title bar. A hidden title bar would need drag areas in the header, and the header
  player is off-limits.
- Closing the window quits ACRUX on both systems, because the music plays inside the window. Staying in the Dock
  after the window closes, as Mac apps usually do, is skipped.
- Media keys and Now Playing are left out of v1. DeckAudio uses Web Audio, so Chromium's media session doesn't pick
  it up, and macOS media keys need an Accessibility permission. They're a follow-up.

## How it works today (the recap you asked for)

- **Page:** plain HTML/CSS/JS with no framework and no bundler. The pages are `index.html` and `library.html`.
  - `javascript/nav.js` swaps page content in place, so the player never unloads.
  - `deck-audio.js` is a Web Audio + AudioWorklet engine. It plays everything and does the scratching.
  - `catalog.js` is the single data source.
  - The page relies on Chromium features: `popover`, `<dialog closedby>`, `:has()`, container queries,
    `field-sizing`.
- **Server:** `server.js` is a plain `http` server on `127.0.0.1:3000`. The `api/` folder holds:
  - **Discover** (Jamendo, Audius, Archive, iTunes, YouTube, MusicBrainz): results are cached in `node:sqlite`, and
    `taste.js` turns plays into recommendations.
  - **Your music:** `library.js`, `local.js` (dropped files and linked folders), `drive.js` (OAuth loopback sign-in,
    Keychain token), `cache.js` (Drive prefix cache), `tracks.js` (the store, plus live events over SSE at
    `/api/events`).
  - **Your collection** (`collection.js`): playlists, ♥ and pins, offline copies, ZIPs, Wi-Fi collaborators and
    phone pairing.
  - **Setup:** `setup.js` and `keys.js` (onboarding and pasted keys).
- **Data:** everything lives in `data/`. The `ACRUX_DATA` override is already respected by `db.js` and `tracks.js`.
- **Dependencies:** music-metadata and qrcode-generator. Both are pure JS, with no native modules.

## Approach: Electron, with the unchanged server in a utility process

- **Why Electron:**
  - Electron 44 ships Node 24.21 and Chromium 152, so `node:sqlite`, `require(esm)` (for music-metadata v11) and
    every Chromium feature ACRUX uses work as they are.
  - There are no native modules, so nothing has to be rebuilt per platform.
  - `docs/app-offload.md` already reached the same conclusion.
- **Why not the alternatives:**
  - Tauri would still need a bundled Node for the server (50–90 MB), and it uses WebKit on the Mac.
  - A Chrome app-mode launcher depends on the user's own browser.
- **Why a utility process for the server:** `DatabaseSync` is synchronous, so the server gets its own process
  (`utilityProcess.fork`) rather than the main process. A slow query or a large ZIP can't freeze the window.

```
ACRUX.app / ACRUX.exe
 └─ desktop/main.js (Electron main)
     ├─ utilityProcess: server.js  ← env ACRUX_DATA=<userData>, ACRUX_APP=1, PORT=<kept port>
     │     posts 'ready' when listening, 'signed-in' after Google's callback
     └─ BrowserWindow → http://localhost:<port>/
           off-site links and Google sign-in → the system browser
```

## Changes

### New: `desktop/main.js` (about 90 lines, the only new code of any size)
- **Single instance.** `app.requestSingleInstanceLock()`. A second launch focuses the existing window.
- **Data** goes in `app.getPath('userData')` (`~/Library/Application Support/ACRUX`, `%APPDATA%\ACRUX`), passed to
  the server as `ACRUX_DATA`.
- **Port.** Pages keep `localStorage` per origin: history, recent searches, quality, repeat and panel width. The port
  therefore has to stay the same between launches.
  - The app prefers 4747, away from the dev server's 3000.
  - If 4747 is taken, the OS picks a free port.
  - The chosen port is saved in `userData/port`.
- **Server.**
  - Started with `utilityProcess.fork(server.js, [], { env, stdio: 'pipe' })`. Its output goes to
    `userData/server.log`, which is truncated at each launch. That's the file friends send when something breaks.
  - The window opens on the server's `'ready'` message.
  - If the server exits unexpectedly, an error box names the log file and the app quits.
  - `before-quit` kills the server.
- **Window.**
  - 1440×900, with a minimum of 380×600, background `#000` (the page's own) and `show: false` until
    `ready-to-show`.
  - Windows auto-hides the menu bar. The Mac keeps the default menu, which carries ⌘Q and copy/paste.
- **Links that leave ACRUX** (http/https only):
  - `setWindowOpenHandler` handles `target=_blank` links.
  - `will-navigate` and `will-redirect` handle links that go to another site.
  - Each one calls `shell.openExternal` and denies the navigation.
  - This also covers Google sign-in: `/api/drive/connect` answers with a 302 to accounts.google.com. That redirect
    is cancelled and opened in the browser, so the app page stays where it was and the music keeps playing. Google
    refuses sign-in inside embedded windows, so the browser is required.
- **After sign-in.** When the server sends `'signed-in'`, the app loads `library.html#addmore` and brings the window
  to the front. Setup then resumes from its saved `setupResume` step, as it already does on the web.
- **Update check** (unsigned builds can't auto-update on a Mac).
  - At launch, the app fetches `api.github.com/repos/ashesbloom/music-webpage/releases/latest`.
  - If that tag is newer than `app.getVersion()`, a dialog offers "ACRUX x.y is out" with Download (opens the
    release page) and Later.
  - Failures stay silent. No dependency is added.

### Server: small edits
- `server.js`:
  - The `listen` callback adds `process.parentPort?.postMessage('ready')`.
  - When `ACRUX_APP` is set, `GET /javascript/edition.js` answers
    `window.ACRUX_APP = true; document.documentElement.classList.add('app');` with `no-store`.
- `api/library.js` `/api/drive/callback`, only when `ACRUX_APP` is set:
  - It answers a small page ("Google Drive is connected. Close this tab and go back to ACRUX."), in the same style as
    the existing error page.
  - It calls `process.parentPort?.postMessage('signed-in')`.
  - The web flow keeps its 302.
- Nothing else changes.
  - `drive.js` keeps the Keychain on the Mac. On Windows it keeps its 0600 token file, now in `%APPDATA%\ACRUX`, a
    folder only your user account can read. That gets a `ponytail:` note: switch to Electron `safeStorage` through
    main if that matters.
  - `process.loadEnvFile()` still works when you run the app from the repo in dev.

### Demo content: hidden in the app, kept on the web
- New `javascript/edition.js`: `window.ACRUX_APP = false;`. The app's server replaces it (above). Both `index.html` and
  `library.html` load it in `<head>` before anything else, so the `app` class exists before the body draws.
- `javascript/catalog.js`, right after `playlists` is defined and before `mockAdded` is read: when `ACRUX_APP` is
  set, it empties `artists`, `albums` and `songs`, drops the `demo: true` playlists, and empties `recently-added`.
  That's one block of about 5 lines. The built-in cover images stay, because the Home sleeves use them as decoration.
- Home's static rows:
  - `index.html` gives `#recent`, `#added`, `#artists` and `#playlists` a `demo` class.
  - `style/insert.css` adds one rule: `.app .demo, .app h3:has(+ .demo) { display: none; }`.
  - `javascript/home.js` removes `demo` from each row it fills from `/api/home`.
  - So a new app user sees no Joji cards and no flash of them, and the rows appear once there's listening history.
  - Favorites keeps its own empty state.
- To verify: `player.js:5` falls back to `album:nectar` when the page list is empty. In the app that list is empty
  too, so the header player must stay idle without errors. Guard it if it doesn't.

### Packaging: `package.json`
- Adds `"version": "1.0.0"`, `"author": "ashesbloom"` and `"main": "desktop/main.js"`.
- Adds the scripts `"app": "electron ."` and `"dist": "electron-builder"`.
- devDependencies: `electron` and `electron-builder`. There are no new runtime dependencies.
- A `"build"` key (no separate config file):
  - `appId: com.ashesbloom.acrux` and `productName: ACRUX`.
  - `directories.buildResources: desktop`, where `icon.png` is rendered at 1024 px from `favicon.svg`.
    electron-builder makes the `.icns` and `.ico` from it.
  - `asar: false`. The app is about 150 files. Plain files rule out any trouble with the server's Range reads and
    `fs.stat` inside an archive.
  - `files` includes `server.js`, `api/**`, `javascript/**`, `style/**`, the three `.html` files, `playback_tree/**`
    and `desktop/main.js`.
    - It leaves out `playback_tree/songs/**` (114 MB) and the unused `playback_tree/*.mp4` and `logo*.jpg` (about
      9.5 MB, referenced nowhere).
    - `search_pages/`, `data/`, `tests/`, `docs/` and `.env` are never listed, so they aren't included.
    - Production `node_modules` come along automatically.
  - `mac`: target `dmg`, arch `[arm64, x64]`, with ad-hoc signing (`identity: "-"`; Apple Silicon won't run an app
    that has no signature at all) and `hardenedRuntime: false` (it only matters for notarization, and with an ad-hoc
    signature it can stop the app from launching).
  - `win`: target `nsis`, x64, default per-user install.
  - `publish`: GitHub, owner `ashesbloom`, repo `music-webpage`.

### Releases: `.github/workflows/release.yml`
- Runs on a pushed `v*` tag.
- Build matrix: `macos-latest` and `windows-latest`. Each runs `npm ci`, then
  `npx electron-builder --publish always` with `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` and
  `CSC_IDENTITY_AUTO_DISCOVERY: false`.
- The result is a draft Release holding the two `.dmg` files and the `.exe`. You publish it.
- Your Mac can also build the Mac installers locally with `npm run dist`. Windows builds only come from CI.

### README
- A new "Install the app" section with direct links to the latest Release, and the first-open steps for unsigned
  builds:
  - **Mac:** open the app once, then System Settings → Privacy & Security → Open Anyway, or run
    `xattr -dr com.apple.quarantine /Applications/ACRUX.app`.
  - **Windows:** SmartScreen → More info → Run anyway.
  - **Collaborators on Wi-Fi:** the first time the invite switch is turned on, the system firewall asks to allow
    ACRUX.
- "Run it locally" stays as it is, for developers.

## Out of scope (each gets its own spec later)
- Signing and notarization, auto-updates on the Mac, Microsoft Store / Mac App Store. The App Store would need a
  sandbox, which breaks linked folders.
- Media keys and Now Playing.
- The pre-ship speed work in `docs/app-offload.md`: cover thumbnails, gzip, ETags, bundling.
- Android (Flutter). A Flutter app means a new UI in Dart, and it can't run the Node server. It would pair with this
  desktop app over Wi-Fi, the way pairing already works, or talk to a hosted server. It needs its own design.

## Steps
1. Save this design as `docs/superpowers/specs/2026-09-27-desktop-app-design.md` (the repo's convention).
2. `npm i -D electron electron-builder`, then make the `package.json` changes.
3. The demo gating: `edition.js`, `catalog.js`, `index.html`, `insert.css`, `home.js`, plus a check of `player.js:5`.
4. The server edits: the `ready` message, the `edition.js` route, and the app-mode sign-in callback.
5. `desktop/main.js`, then render `desktop/icon.png` from the favicon (headless Chrome, which is already installed).
6. `.github/workflows/release.yml` and the README section.
7. Update memory (`acrux-roadmap.md`). No commit unless you ask, and commits carry no co-author trailer.

## Verification (kept small, per your testing rule)
- `node --check` on every changed `.js` file. `node --test tests/setup.test.js` still passes, since it's the suite
  closest to server.js.
- `npm run app` from the repo:
  - The window opens, the data lands in `~/Library/Application Support/ACRUX`, and Home shows no Joji cards.
  - A Discover song plays, and a dropped file plays.
  - Links marked ↗ open in the browser.
  - Quit and relaunch: the port and the recent searches are still there.
- `npm run dist`: open the arm64 `.dmg`, drag the app to Applications, do the first open, and check that a song
  plays. Screenshot it through headless CDP, as the UI rule requires.
- Drive sign-in in the packaged app: the browser tab says it's connected, the app comes to the front on My Music, and
  setup resumes. This needs your Cloud project's Drive API turned on, so you run this step.
- Windows: push a test tag and check that the CI `.exe` installs and plays on a Windows PC (yours or a friend's).
