# Player: ⋯ More tray, Queue panel, Auto Mix / Infinite Queue

## Context
The ACRUX header player has only shuffle, prev, play, next and repeat. The user wants the Apple Music features shown in their two reference images:
- a ⋯ **More** tray with six song actions;
- a **Queue** button next to volume that slides the right panel over to a queue;
- in the queue: **Auto Mix** and **Infinite Queue** buttons, a "Continue Playing" list, and a "History" section that appears when you scroll up.

The existing controls stay exactly as they are; we only add to them.

**Decisions the user made:**
- ⋯ sits at the end of the row, after repeat.
- Infinite Queue works now. Auto Mix is a saved toggle until the backend exists.
- Add to Playlist and Favorite appear but are disabled ("Coming soon").

Keep regression testing minimal (the user asked, to save usage).

## Design spec

**Header (all 4 pages: `index.html`, `playlist/playlist.html`, `playlist/playlist2.html`, `search_pages/smithereens.html`)**
- `.playbutton` becomes shuffle, prev, play, next, repeat, **⋯**. It reuses the `.playbutton button` style unchanged.
- `.volumecontrol` becomes **Queue**, mute, volume bar, number. Queue shares the `.mute_button` look (the rule gets a second selector). When the queue is open (`aria-pressed=true`) the button is `var(--glow)`.
- **Phone (<700px):** `.volumecontrol` is hidden today. Change that to hide every child except the Queue button. It then sits in the top header beside the ☰ button (`margin-left:auto`).

**⋯ More tray.** A native `popover`, so light-dismiss and Esc come free. It's styled like reference image 1, in ACRUX colours: dark translucent card, 12px radius, hairline separators, red `--accent` hover.
```
Add to Playlist        Soon  ›    (aria-disabled)
──────────────
Add to Favorites       Soon       (aria-disabled)
Get Info                          → <dialog>: cover, title, "Artist — Album", duration
──────────────
Go to Album                       → album page link
Go to Artist                      → playlist/playlist.html (what the "By Artist" row links to today)
──────────────
⇪ Share                           → navigator.share(); else copy link and show "Link copied"
```
- It opens above the button when the button is in the lower half of the screen (the phone's bottom player), otherwise below it, right-aligned to the button.
- JS sets `top`/`bottom`/`right` in `beforetoggle`, so nothing needs measuring and nothing flashes.
- It acts on the current song, `songs[index]`.

**Queue panel.** It slides in over the side panel (`#sidebar`).
- Queue button (or the panel's `›` minimize button) toggles `.queue_open` on `#sidebar`.
- `.queue` is `position:absolute; inset:0`, with its own scroll. It uses `translate: 100% 0` and hidden visibility, then `0` when open. The transition is `0.5s cubic-bezier(0.2,0.7,0.2,1)`, the same easing the sleeve cards use.
- **Below 1200px** the panel is the popover drawer: Queue calls `showPopover()` first. Closing the drawer resets the queue to closed.
- **At 1200px and wider**, never call `showPopover()`: the panel is a normal column.

Panel layout, top to bottom:
```
[ Queue                          › ]   sticky bar (blurred), minimize
  History                              ← hidden above on open; scroll up to see it
    played songs, oldest → newest (dimmed)
  [  ∞ Infinite  ] [  ◎ Auto Mix  ]    red pills when on (--accent)
  Continue Playing
    (note) Shuffle is on: songs play in random order   ← CSS body:has(#shuffle.clicked)
    (note) Repeating this song                         ← CSS body:has(#repeat.clicked)
    rows: cover 44px · title · "Artist — Album"
    (empty) End of queue                               ← .q_next:not(:has(li))
```
- **Opening:** `queue.scrollTop` is set so the ∞/Auto Mix row sits just under the sticky bar, which puts History above the fold. It re-aligns on each song change. The lower block has `min-height` of the panel so it can always scroll that far.
- **Continue Playing:** the album songs after `songs[index]`. With Infinite on it wraps round to the start, because the album loops today; with Infinite off it shows only the rest.
- **History:** kept in `localStorage.playHistory` (max 30), the same idea as `searchHistory`. Entries are `{name, artist, cover, album, href}`, deduped against the newest one, and the song now playing is left out.
- **Clicking a row** plays it with `document.getElementById(song.id).click()`. That goes through each player's existing `.song_items` handler; every page has those buttons for its songs. A History song from another album links to that album's page instead.
- **Infinite Queue:** `aria-pressed`, saved in `localStorage.infinite`, default **on**, so today's looping is unchanged. **Off** stops after the album's last song (the guard below).
- **Auto Mix:** `aria-pressed`, saved in `localStorage.automix`, with `title="Auto Mix: blends songs together (coming soon)"`. It doesn't change playback yet.

## Component hierarchy / code

```
header
 ├─ .playbutton  … #repeat, button#more.more[popovertarget=more_tray]      (static, 4 pages)
 └─ .volumecontrol  button#queue_btn.queue_btn[aria-pressed], #mute_button…  (static, 4 pages)
body  (injected by more.js)   div#more_tray.tray[popover]  +  dialog#song_info
#sidebar (injected by queue.js)  section#queue.queue
   .q_bar(h5 "Queue", button.q_min) · section.q_hist(h5, ol.q_list) ·
   div.q_up( .q_modes(#infinite, #automix) · h5 · p.q_note×2 · ol.q_list.q_next · p.q_empty )
```
The tray, dialog and queue are injected from one template each (`insertAdjacentHTML`, static strings only). Rows are built with `createElement`/`textContent`, as in `search.js`. That avoids pasting about 40 lines into four pages that phase 2 merges into one shell anyway.

**New `javascript/queue.js`** (IIFE, the same shape as `search.js`; uses the globals `SITE`, `songs`, `index`, `music`, `ALBUM`):
```js
inject section into #sidebar; restore #infinite/#automix aria-pressed from localStorage (try/catch)
const drawer = matchMedia('(max-width: 1199px)')
setOpen(open): btn aria-pressed; sidebar.classList.toggle('queue_open'); sidebar.scrollTop = 0;
               if (open && drawer.matches && !sidebar.matches(':popover-open')) sidebar.showPopover(); align()
sidebar 'toggle' → if closed: setOpen(false)
render(): next = songs.slice(index+1) (+ songs.slice(0,index) if infinite); history from storage
music 'play' → push songs[index] to playHistory (dedupe), render(), align() if open
#infinite/#automix click → flip aria-pressed, save, render()
row click → document.getElementById(String(song.id))?.click()
```
**New `javascript/more.js`:** inject the tray and dialog. In `beforetoggle` (opening), position the tray and set the album link's `href`. Get Info fills the dialog and calls `showModal()`. Share calls `navigator.share?.()`, falling back to `navigator.clipboard.writeText()`. After an action, `hidePopover()`.

**Player scripts** (`support.js`, `playlist2.js`), two data/guard additions each, nothing else changed:
```js
const ALBUM = { name: 'Nectar', href: `${SITE}playlist/playlist.html` };   // playlist2.js: 'Smithereens', playlist2.html
// in the 'ended' handler, before the final else:
} else if (index === songs.length - 1 && document.getElementById('infinite')?.getAttribute('aria-pressed') === 'false') {
    playicon.className = 'icon icon-play'; // Infinite Queue off: stop after the album's last song
} else {
```
While implementing, check that `DeckAudio.play()` after `ended` restarts from 0; if not, also set `music.currentTime = 0` in the guard.

**`style/insert.css`**, around 90 lines:
- `.tray`, `.tray > *`, `.tray hr`, `.tray [aria-disabled]`, `#song_info`
- `.queue` (+ `.queue_open .queue`), `.q_bar`, `.q_modes`, `.q_mode[aria-pressed=true]`, `.q_list` rows, `.q_hist:not(:has(li)){display:none}`, notes and empty-state via `:has`
- `.menu { overflow-x:hidden }` so the off-screen queue doesn't add a horizontal scrollbar; `.menu.queue_open { overflow-y:hidden }`
- desktop `.menu[popover]`: `position: static` → `relative`; `.menu_close { z-index:2 }`; drawer `.q_bar { padding-right:60px }` to clear the ×
- phone: `.volumecontrol` rule as described above
- `.queue` added to the reduced-motion `transition:none` list
- 5 hand-drawn mask icons in the icon list: `icon-ellipsis`, `icon-list`, `icon-infinity`, `icon-automix` (ring overlapping a dot, like the reference), `icon-share`

Script tags `more.js` and `queue.js` go after the player scripts in all 4 pages.

## Backend plan (phase 3): Auto Mix and Infinite Queue
- **Data:**
  - `tracks(id, title, artist_id, album_id, duration, file, bpm, key, lufs, analysis_json)`
  - `plays(user_id, track_id, played_at, completed)`
  - `POST /api/history` replaces `localStorage.playHistory`; the History section reads `GET /api/history`.
- **Infinite Queue (autoplay):** `GET /api/queue/next?seed=<recent ids>&exclude=<history>&limit=10`. It ranks by same artist/album, co-plays from `plays`, and closeness of audio features (bpm, key, energy). The client fetches more when 3 or fewer songs are left and Infinite is on. They show as a dimmed "Autoplay" group under Continue Playing.
- **Auto Mix:** a server job on track upload uses ffmpeg plus a beat tracker (aubio/essentia) to find the BPM, beat and downbeat grid, key (Camelot), mix-in/out points and LUFS. It stores these in `analysis_json`, served by `GET /api/tracks/:id/analysis`.
  - The client `DeckAudio` gets a second deck (a second worklet voice and gain).
  - Near the outgoing song's mix-out point it starts the next song on a downbeat. Rates are matched through the worklet's variable-rate playback, which already exists for scratching, within ±8%. It then does an equal-power crossfade over 8–16 bars, with a low-cut on the outgoing song.
  - If the BPM gap is over 8% or the keys clash, it does a plain 6s crossfade.
  - Loudness is levelled from LUFS.
- **Phase 2 dependency:** once the two player scripts merge into one data-driven player, the queue becomes the player's source of truth. `ended` asks the queue for the next song, so the shuffled order finally shows in Continue Playing and the `getElementById(...).click()` bridge goes. Mark it with a `ponytail:` comment in `queue.js`.

On approval, also save this spec as `docs/superpowers/specs/2026-09-26-queue-and-more-design.md`, following the record-scratch convention.

## Out of scope (skipped)
- Per-row ⋯ menus in the queue and a "Clear" button (not in the list of six).
- Favorites and playlist storage (phase 3).
- Real artist pages.
- Remembering whether the queue was open across pages.

## Verification (kept minimal)
1. `node --check` on `queue.js`, `more.js`, `support.js`, `playlist2.js`.
2. One console snippet, `tests/queue.js`, like the existing ones. It asserts:
   - the tray has 6 items;
   - Continue Playing has `songs.length-1` rows with Infinite on, and `songs.length-1-index` with it off;
   - opening the queue leaves `scrollTop > 0` once History has entries.
3. The user checks by eye with `node server.js`: open and close at desktop, tablet (drawer) and phone widths; play a song; scroll up to History; turn Infinite off on the last song and confirm playback stops. Don't re-run the old suite; `deck-audio.js` is untouched.
4. Afterwards, update memory:
   - The header now has ⋯ and Queue buttons; that edit was explicitly requested.
   - The Auto Mix and Favorites work is in phase 3.
   - New feedback: keep regression testing minimal.
