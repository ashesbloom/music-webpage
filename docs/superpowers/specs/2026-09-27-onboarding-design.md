# First run: intro, setup, keys walkthrough, record tour

Approved design (canvas): https://claude.ai/artifact/E97gNKRZsqbBwUNDZxqgRh. The canvas is the source for the look, the copy and
the flow. This file records the decisions and what the backend has to do.

## Why

A new person has to edit `.env` to get YouTube, Jamendo or Google Drive working, and the only guide is the README. The
first run should welcome them and set up their music. It should also walk them through the Google keys without needing any technical knowledge.
Then a short tour shows how the record works.

## Flow

1. **Intro, 2 s, first launch only.**
   - A red dot traces a circle, grooves ripple out into a record, and the tonearm drops with a red shock ring.
   - The record slides into its place: tucked under the middle column on desktop, rising from the bottom on a phone.
   - The ACRUX wordmark blurs in and the setup window opens.
   - Later launches keep today's logo blur-in.
   - With reduced motion, the intro shows its last frame.
2. **Setup window.** A small glass window over the dimmed app, with the record still spinning behind it.
   - **Progress:** a straight line across the window's content width, with stops for Music, Drive, Computer, Online,
     Keys and Tour.
     - Stops already done are red.
     - The current stop is a white knob with a red ring.
     - The stops for sources that weren't picked are skipped.
   - **Where's your music?** Pick any of Google Drive, This computer and Online. *Just look around* skips setup.
   - **Google Drive:**
     - A link field.
     - "Who can open this folder?": *Anyone with the link* needs an API key; *Only me* needs Google sign-in.
     - "On this computer": how long to keep each song (default 7 days) and how much space to use (default 10 GB). These
       are the same `keepDays` and cache-size settings as today.
     - "How Drive music plays": the cache explained in three short lines.
   - **This computer:** choose *Play from where it is* or *Keep a copy in ACRUX*, then choose a folder. This is already
     built: it uses `keepCopy`, `GET /api/local/dirs` and `POST /api/local/link`.
   - **Online:** Internet Archive, Audius and iTunes previews show *Ready*. Jamendo and YouTube show *Add key*.
3. **Keys walkthrough ("Connect Google").**
   - **Order:** make a project, turn on YouTube Data API v3 and the Drive API, make an API key, paste it. Then, only for
     private folders: name the app, add yourself as a test user, stay signed in (optional), make the sign-in client and
     sign in. This replaces the old sign-in dialog in `addmore.js`.
   - **Stay signed in:** Google keeps *Publish app* greyed out until Branding has a home page, a privacy policy and their
     authorized domain. The step gives ACRUX's own pages (`https://ashesbloom.github.io/music-webpage/` and its
     `privacy.html`) to copy in. Unpublished, Google signs you out every 7 days.
   - **Each step shows:**
     - a drawn sketch of the Google Cloud page (not a screenshot), with a red outline on what to click;
     - an *Open …* button to the right Google Cloud page;
     - *Next*.
   - **The pasted key is checked right away**, and the result is one of the messages on the "Key check messages" board.
   - **Jamendo** has its own three-step card and check.
   - **"Your keys stay on this computer"** shows on every key screen.
4. **Done.**
   - Each source shows its live state, such as "212 of 1,024 songs" while a Drive folder is read.
   - A **Bring ACRUX to your phone** QR.
   - *Start listening* or *Show me the record*.
5. **Record tour.** Three cards next to the real record:
   - turn the record to seek;
   - the label plays and pauses;
   - the colour follows the cover.

   Each card has *Skip* and *Next*. It shows once (`localStorage.tourDone`, the same pattern as `seekHint`).

Setup can be reopened later with **Set up ACRUX** in My Music. It then opens without the intro.

## Phones

- **Layout:** setup is a sheet above the rising record. Its progress is the arc along the record's edge, and the big
  red button is *Continue*.
- **A phone connects by scanning the Done screen's QR:**
  - It opens ACRUX on the computer's Wi-Fi address and makes the phone one of your devices.
  - A device can browse and play the whole library.
  - Setup, keys, sources and linked folders stay computer-only (the `mine()` guard).
- **A phone never opens setup:** setup only opens on the computer running ACRUX. A phone joins with the QR code, then
  gets the record tour.

**Deferred until there's an Android app:** the canvas's pairing code, *Get ACRUX for Mac or Windows* and *Stay on
phone*. A phone that sets up its own keys needs an app that runs its own server.

## Backend

### Keys

- **Saving:** `PUT /api/keys { youtube?, google?, jamendo? }` stores keys in the settings store (`tracks.stored`), like
  the Drive sign-in client already is.
- **Reading:** a small helper reads each key with `.env` winning. `youtube.js`, `jamendo.js` and `drive.js` use it in
  place of `process.env` directly.
- **Status:** `GET /api/keys` says which keys are set and where they come from, with only the last 4 characters of each.
  A key never goes back to the page whole.
- **Access:** all key routes use `mine()`.

### Key check

`POST /api/keys/check { kind, key }` makes one cheap request per service and maps Google's error reason to the
message shown:

| Google says | Message |
|---|---|
| OK | The key works. |
| API not enabled (`accessNotConfigured` / `SERVICE_DISABLED`) | Google Drive (or YouTube) is turned off in this project. |
| Key restricted (`API_KEY_SERVICE_BLOCKED`) | Drive can't use this key yet (limited to other services). |
| Key invalid (`API_KEY_INVALID`, `keyInvalid`) | Google doesn't recognise this key. |
| Quota used up (`quotaExceeded`) | YouTube searches are used up for today. |

- **Cost:** the YouTube check uses a request of 1 quota unit, never a search (100 units).
- **Other messages:** "Account isn't a test user" comes from the sign-in callback, and "Drive is holding back
  downloads" is today's `held` state. Both use the same message style.

### First run

- `GET /api/settings` gains `setupDone`, and the page sets it when setup finishes or is skipped.
- The intro and setup show when `setupDone` is unset and the library has no added sources.

### Your devices (the QR)

- **Making the code:** `POST /api/devices/pair` (computer only) does three things:
  - turns on the Wi-Fi listener (as `PUT /api/sharing` does);
  - makes a single-use token that lasts 10 minutes;
  - returns `http://<LAN IP>:<port>/?pair=<token>` with a QR as SVG.
- **Joining:** opening that link sets a device cookie that is kept like guests' tokens, with the role `device`.
- **What a device can do:**
  - Devices play and browse everything, and their listening counts toward your taste. Playlist guests keep their
    listening out of it, as today.
  - A device can't use anything behind `mine()`.
- **Managing devices:** My Music lists your devices with *Remove*.
- **QR library:** `qrcode-generator` (zero dependencies, MIT), used on the server. This is the one new package.

## Files

- **Page:**
  - `javascript/setup.js`: intro, window, steps and walkthrough.
  - `javascript/tour.js`: the 3 cards.
  - Styles in `style/insert.css`.
  - Loaded by `index.html` and `library.html`, and started on first run or from My Music.
- **Server:**
  - `api/setup.js`: keys, key check, `setupDone`, devices.
  - Mounted in `server.js`, next to `library.js`.

## Testing

`tests/setup.test.js`, run with `ACRUX_DATA` pointing at a scratch folder:

- keys are stored and masked;
- `.env` wins over a stored key;
- the key-check mapping gives the right message for each Google error reason, using canned responses (no network);
- a pairing token works once and not after 10 minutes;
- a device can't use a `mine()` route.

By hand: `ACRUX_DATA=/tmp/acrux-fresh node server.js`, then walk the whole flow on a desktop browser and on a phone on
the same Wi-Fi.

## Not in this spec

- The Android app and the desktop (Electron) build.
- The pairing code and phone-only setup, which wait for the Android app.
- Accounts for people outside your network.
