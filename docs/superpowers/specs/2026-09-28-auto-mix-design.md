# Auto Mix: design (spec)

## Context
Auto Mix is ACRUX's flagship feature. It was deliberately left out of the queue work: today the `#automix` pill in `javascript/queue.js` is a saved toggle labelled "coming soon". The goal is continuous, DJ-quality playback with no gaps, no clashing beats or keys, and no two vocals on top of each other. It has to work with ACRUX's own sources (your files, Drive and Discover) and with its Web Audio deck. The icon also becomes a live, moving piece of UI.

**Your decisions (2026-09-28):**
- **Albums** played in order stay gapless.
- **Tempo** is matched with vinyl varispeed: only the outgoing song's last bars change speed, by up to 4%.
- **Ordering:** Auto Mix orders only the songs Infinite adds.
- **Icon:** the crossfader curves animate.

## What the research says (distilled)
**Products**
- [Apple Music AutoMix](https://musictech.com/news/gear/apple-music-automix-ai/) analyses tempo and key. It time-stretches and beatmatches near a "sweet spot" at the end of a track. When keys clash it falls back to a natural break or a plain overlap.
- [Spotify Mix](https://newsroom.spotify.com/2025-08-19/mix-your-favorite-playlists-seamlessly-by-adding-your-own-transitions/) offers crossfade, beatmatch and EQ fades, with Fade and Rise presets. It shows BPM and [Camelot keys](https://routenote.com/blog/spotify-mix-customizable-transitions/). [Smart Reorder](https://newsroom.spotify.com/2026-02-25/smart-reorder-playlist-mixing/) re-sequences a playlist by BPM and key.
- [djay Automix](https://help.algoriddim.com/user-manual/djay-pro-windows/mixing-basics/automix) looks for the earliest suitable blend point. Its transition styles are Filter, Echo, Riser and stems (Neural Mix), and it sets their length in bars.
- [Mixxx AutoDJ](https://mixxx.org/news/2020-07-09-intro-outro-sections/) defaults to "Full Intro + Outro": when the outro is longer than the intro, the next track starts during the outro so that both end together. Its analyser finds each track's first sound.

**Research**
- [Vande Veire & De Bie (auto-DJ)](https://lenvdv.github.io/2018-03-20-autodj/) builds on beat tracking (98%), downbeats (98%) and structure boundaries (94%) found with a self-similarity matrix and Foote novelty, snapped to downbeats and phrase multiples. It uses three transition types chosen by energy: double drop, rolling and relaxed. It picks songs by harmonic compatibility and energy, and avoids overlapping vocals.
- [Zehren et al.](https://direct.mit.edu/comj/article/46/3/67/117159/Automatic-Detection-of-Cue-Points-for-the) estimate cue points from structure, and about 90% of them are usable in a DJ mix. [Argüello](https://arxiv.org/html/2407.06823v1) treats cue points as object detection, trained on 21k expert cues.

**The craft rules the algorithm encodes**
1. Mix on phrase boundaries (4, 8, 16 or 32 bars), aligning downbeat with downbeat.
2. Blend the outgoing song's outro with the incoming song's intro. Let the incoming song's main section arrive as the outgoing song leaves.
3. Never play two basslines at once: swap the bass on a downbeat, within a beat.
4. Never overlap two vocals. Shorten or move the blend instead.
5. Keep keys compatible on the Camelot wheel: the same key, ±1, the relative major/minor, or +2 as an energy boost. On a clash, keep the overlap short.
6. Match tempo within a few percent. Beyond that, don't beatmatch: echo out, sweep a filter, or fade.
7. Match loudness so the level in the room never jumps.
8. Respect the music: albums the artist sequenced stay gapless, beatless music gets a natural fade, and a cold ending gets a tight segue.

## Architecture
```
player.js ──cue(next)──▶ DeckAudio (deck-audio.js) ──channels, plan──▶ worklet: 2 voices + mix DSP (soft clip) ──▶ volume ──▶ out
    ▲ 'mixed','play'          │  decode ahead, analysis cache, plan()                  │ reports pos / handover / progress
    │                         ├─▶ Worker automix-analyze.js (BPM, beats, bars, key, LUFS, structure)
queue.js (upNext, ranking)    └─▶ /api/mix/:id (server cache, api/mix.js)          automix.js: plan(), score()
```
The rest of the app keeps using the one `music` object, so the seek bar, turntable, keys, Media Session and taste reporting work unchanged. Mixing happens inside DeckAudio.

## 1. Analysis (once per song, in a Worker, cached)
**Input.** DeckAudio gets the decoded `AudioBuffer`. An `OfflineAudioContext` resamples it natively to 2 channels at 22 050 Hz, and both channels are transferred to `javascript/automix-analyze.js`, which is a Worker that also exports functions for the tests. The steps:
- **Levels:** peak = max|L|,|R| + 0.5 dB of margin. Loudness is integrated BS.1770 K-weighted LUFS, with filters designed for 22 050 Hz, 400 ms blocks, a −70 LUFS absolute gate and a −10 LU relative gate.
- **Silence:** the first and last 50 ms windows above −50 dBFS set `start` and `end`. A silence longer than 20 s near the end, such as a hidden track, ends the music there.
- **STFT:** Hann window, 2048-sample frames, 512-sample hop (43 frames per second). It yields:
  - an onset envelope: log-magnitude spectral flux over 40 bands from 30 Hz to 8 kHz;
  - a kick envelope: flux from 30 to 150 Hz;
  - chroma: 55 Hz to 5 kHz folded into 12 pitch classes;
  - low, mid and high band energy;
  - mid-band spectral flatness.
- **Tempo:** autocorrelation of the onset envelope over 60–200 BPM, weighted by a log-normal prior centred on 120 BPM (as librosa does) and refined with a parabola. The onsets are taken relative to their own last second first, so slow swells don't count as rhythm.
- **Beats:** Ellis dynamic programming with tightness 100 on the 23 ms onset envelope.
  - A least-squares line through all the beats (outliers over 40 ms dropped) within 14 ms RMS, with 85% inliers, makes the song `steady`, with an exact grid `{t0, period}` that also covers beatless intros and outros.
  - Otherwise each beat is put on the line through the 8 beats on either side, and the beats more than 25 ms off are marked `loose` (in `bars.loose`).
  - The grid may start up to 50 ms before 0, because the tracker runs about 16 ms early; the same happens in both songs, so the lock cancels it out.
- **Is there a beat?** All three must hold:
  - onsets on the beats with a median of 0.05 or more, with the song normalised to RMS 0.1;
  - 65% of the beats on an onset more than twice the song's typical one;
  - the median of local 16-beat line fits within 16 ms.

  On real songs this separates house, techno, disco, rock, live rock, metal, jazz, reggae, folk and hip-hop (beat) from ambient, a Chopin prelude, an acoustic ballad and speech (none). Refining beats on a broadband energy envelope was tried and dropped: it followed bass and vocals, not drums.
- **Downbeats (4/4):** of the four phases, choose the one that maximises the z-scored kick onset plus the chroma change on its beats. Kicks land on beat 1, and chords change on bar lines. The winning margin gives `downbeatConf`.
- **Structure:** bar-level features (band energies in dB, onset density, chroma) feed a cosine self-similarity matrix and Foote-style novelty (the 4 bars after each bar line against the 4 before). Peaks become boundaries, snapped to the nearest 4-bar line. The phrase offset (0–7) is the one that maximises novelty on bars ≡ offset mod 8. From these:
  - Each bar gets an energy in dB, relative to the median of the loud bars.
  - `intro` ends at the first boundary after which the energy is within 3 dB of the body and the low band is present.
  - `outro` starts at the last boundary after which the energy stays more than 3 dB below.
  - `fade` = each of the last four 5 s stretches is 2 dB or more under the one before, and the level is 9 dB or more down in all (a step down to a quiet outro isn't a fade). `cold` = at full level within 2 s of `end`.
- **Busy bars (vocal or lead proxy):** mid-band (300–3400 Hz) energy × (1 − flatness); `busy` = within 4 dB of the song's usual busiest level. `ponytail:` this is a heuristic; the upgrade is a small singing-voice model if clashes still slip through.
- **Key:** tonal frames (weighted by 1 − flatness) are summed into a chroma, then correlated with the Temperley (Kostka-Payne) major and minor profiles, 24 keys in all. The result is `{pc, minor, camelot, conf}`; the key is `null` when r < 0.5 or it leads the best key with another Camelot number by under 0.03 (a key and its relative share their notes and mix the same).
- **Energy:** a 0–1 value from the LUFS and the onset rate, used for ordering.

**Output:** JSON `{v:1, dur, start, end, lufs, peakDb, bpm, beat, steady, grid|beats, downbeat, downbeatConf, barsAt, phraseOffset, key, bars:{energy[], busy[]}, intro, outro, fade, cold, energy}`. It is about 1–4 KB.

**Cache:**
- On the server: `api/mix.js` stores it in SQLite through `api/db.js` (`db`).
  - Table `mix(id PRIMARY KEY, v, bpm, camelot, lufs, energy, body, at)`.
  - `GET /api/mix/:id` returns the analysis, or 404.
  - `PUT /api/mix/:id` validates the JSON (64 KB at most, numbers in range, `v` known).
  - `POST /api/mix/summaries {ids ≤ 100}` returns `{id: {bpm, camelot, lufs, energy}}`.
  - It is mounted in `server.js` before the `/api/` fallthrough and reuses `json()` from `api/common.js`.
- On the client: a Map for the session. GitHub Pages has no server, so there the analysis is simply redone.

## 2. The DJ brain: `plan(a, b, opts)` (in `javascript/automix.js`, pure)
`opts = {gapless, after}`. `after` is the earliest A time allowed, used after a seek. The planner returns `{type, aOut, bIn, pre, len, ratio, k, lock, lanes, handover, trimB}`. All times are seconds in each song's own timeline.

1. **Gapless:** `opts.gapless` → B starts on A's last sample (`aOut = a.dur`, `bIn = 0`).
2. **Tempo relation:** choose k ∈ {1, 2, ½} to minimise |log(b.bpm·k / a.bpm)|, then ratio s = b.bpm·k / a.bpm.
   - A beat blend needs both songs to have `beat`, both regions steady, and |s−1| ≤ 8%.
   - At |s−1| ≤ 4% the blend can be long; from 4 to 8% it is at most 8 bars.
3. **Harmony:** A's pitch moves by 12·log₂(s) semitones (rounded when ≥ 0.5). The Camelot score h is 1 for the same key, 0.9 for ±1 or the relative key, 0.6 for +2 or a diagonal step, 0.1 otherwise, and 0.7 when a key is unknown.
4. **Choosing the type:**
   - A beat blend is possible:
     - it becomes a **blend**, with length L from {32, 16, 8, 4} bars;
     - the cap is 32 when h ≥ 0.9 and |s−1| ≤ 2%, 16 when h ≥ 0.6 and |s−1| ≤ 4%, 8 up to 8% off, and 4 on a key clash;
     - if L comes out under 4, it becomes a **cut**.
   - Both songs have a beat but the tempos are too far apart: an **echo** out, or a **filter** if B's intro is beatless for 4 bars or more.
   - Either song is beatless or unsteady: a **fade**. If A has a `cold` ending it becomes a **segue** instead.
   - Previews under 60 s get a 2 s fade.
5. **Placement (Full intro + outro):**
   - B's cue `bIn` is its first downbeat. If B's intro is longer than L and has no busy bars, the cue moves later into the intro, so that B's main section arrives exactly as A leaves.
   - A's out point `aOut` is the latest phrase boundary (8 bars, or 4 when L = 4) where aOut + L ≤ the end of A's music, and aOut ≥ `after`.
   - **Vocal guard:** if busy bars in A and B overlap for more than 1 bar while both are above 0.3 gain, try the next smaller L. If none fits, use a cut.
   - When a downbeat is uncertain (`downbeatConf` low), L is capped at 4 bars; the beats themselves still line up.
6. **Loudness:** trim = clamp(−14 − lufs, −12, +6) dB, and never higher than −1 − peakDb. A's trim is set when it starts, or glides in over 3 s once its analysis arrives. While two songs overlap, the worklet soft-clips above −0.9 dBFS (a DynamicsCompressorNode would add make-up gain to every song).

**Transition recipes.** t is in bars from B's cue; negative t is on A before B starts. EQ bands: low < 200 Hz, high > 3 kHz, mid is the rest.

| type | outgoing A | incoming B | handover |
|---|---|---|---|
| blend (L) | rate glides 1→s over bars −8…0, then locked to B. Low: 1→0 on the swap beat (the last beat before L/2). Mid: 1 to L/2, 0.3 at ¾L, 0 at L. High: 1 to 0.6L, then 0 at L. Gain: 1 to ¾L, then a cosine down to 0 at L. | Gain: sine 0→1 over 0…L/2. Low: killed, then 0→1 on the swap beat. Mid: 0.35 from 0 to L/4, then up to 1 at ¾L (held at 0.2 until L/2 on a key clash). High: 0.25→1 over 0…L/2. | L/2 |
| cut (L < 4) | Gain to 0 in 15 ms on the phrase downbeat. | Starts on that downbeat, gain up in 3 ms. | 0 |
| echo | Echo send 0→1 on beat −1; delay ¾ beat, feedback 0.5, a 250 Hz high-pass in the loop. Dry signal cut at 0 in 10 ms; the tail rings for about 2 bars. | Starts at 0 with the low killed for bar 0, which comes back over 1 beat. | 0 |
| filter | High-pass 20 Hz → 1.5 kHz (exponential) over 0…L (8 bars, or 8 s); gain a cosine down from L/2 to L. Not locked. | Gain: sine up over 0…L/2; low killed until L/2. | L/2 |
| fade | A cosine down over D. D = A's natural fade from −6 dB, at most 8 s, else 4 s. | A sine up over min(D, 2 s), unless B fades in on its own. | D/2 |
| segue | A cold ending plays out. | Starts on A's next virtual downbeat when both have a beat and the gap is ≤ 1 bar, else 0.3 s after `end`. | 0 |
| gapless | Plays to its last sample. | Starts on the very next sample. | 0 |

## 3. Engine: two voices in the worklet (`javascript/deck-audio-worklet.js`)
Everything is keyed to **musical position**, not the clock, so pausing, stalling or a background tab freezes the mix in place.
- **Voices.** There are two voices, each with its own channels and state (the existing `makeState` and `render` interpolation). `main` is the voice DeckAudio reports.
  - The existing messages (`{channels, track, keep}`, `{target, snap}`, `{seek}`) go to `main`.
  - New messages: `{cue: {channels, track}}` loads the other voice, which stays idle; `{mix: plan in frames}` arms it; `{commit}` finishes it now (A fades out over 150 ms and B becomes main at unity); `{cancel}` drops B.
- **Start.** When A's playhead crosses `aOut`, B starts at `bIn` at the exact sample inside the block, with A's overshoot carried over.
- **Lock (varispeed).** A's position is derived from B's every sample: `posA = gridA.frameAt(k·gridB.beatAt(posB) + offset)` (with k = 2, one of B's beats spans two of A's). This mapping is piecewise-linear between beats.
  - It keeps both songs' beats aligned exactly, even when the drummer drifts.
  - It gives A the speed of the ratio s with no feedback loop. B always plays at rate 1.
  - Before B starts, A's rate follows the pre-roll glide times the play/pause target.
- **Mix DSP per voice** (only while a transition is active; otherwise the single voice takes the fast path):
  - a 3-band isolator: low = a Butterworth low-pass at 200 Hz, high = a high-pass at 3 kHz, mid = x − low − high, so it's exact at unity;
  - a TPT state-variable filter for sweeps;
  - a 2 s echo line with feedback, a high-pass and a send;
  - the trim gain.
  The lanes are evaluated once per 128-frame block at t (from B's position after the start, A's before it) and ramped linearly across the block.
- **Reports.** `{pos, rate, track}` for main, plus `{mixStart}`, `{handover}` (main flips), `{mixEnd}` (A's channels are freed) and a progress value p for the icon.
- `render`, `makeState` and `load` keep their current behaviour and exports; `tests/deck-audio.test.js` still passes.

## 4. DeckAudio and the player (`deck-audio.js`, `player.js`)
- **DeckAudio additions:**
  - `music.id`, the analysis key, is set by playAt along with src.
  - `music.automix`: turning it off commits any mix in progress, disarms the next one and removes the trims.
  - `music.cue({src, id, gapless} | null)` does the following:
    1. It fetches B: `preload()`, extended to fetch your own files and Drive songs too when Auto Mix is on.
    2. It decodes B in full.
    3. It gets B's analysis from the cache, or runs it.
    4. It plans, posts `{cue}` and `{mix}`, and re-plans if A's analysis arrives later.
  - Events: `mixstart`, `mixed` (handover; `src`, `currentTime` and `duration` are now B's), then `play`, then `mixend`.
- **Interruptions:**
  - Pause freezes the mix.
  - A seek or a scratch before the next song has taken over calls the mix off: this song comes back as it was, and the mix is planned again. After the takeover, the mix finishes at once.
  - The song after the next is only loaded into the worklet once the last mix has ended (the song going out still sits in the other voice until then).
  - A seek before B has started re-plans with `after` = the new position + 2 bars.
  - Setting `src` to the cued song (Next, or a click in the queue) starts B at once from its first sound, with a 150 ms fade on A. Any other src resets both voices.
- **When the next song is fetched.** It starts once A has fully loaded and A is at most 150 s from its planned `aOut` (A's length − 45 s until its analysis is known). With Settings → load ahead off, it starts 60 s before instead, the least a mix needs.
  - If B isn't armed by the time its pre-roll should start, there's no beat mix. If B has decoded by A's end, it starts on the next sample instead of after today's 1 s gap and load.
  - Only one song is held ahead. A's audio is dropped at `mixEnd`.
- **Analysis runs** once A is decoded in full: a server GET first (sent when src is set), the Worker only on a miss, then a PUT.
- **player.js:**
  - After each new song, and on the queue's new `queuechange` event, it calls `cueNext()`. That cues `songs[upNext()]` when Auto Mix is on, repeat isn't `one` and neither song is YouTube.
  - `gapless` = the list is an album (`album:` or `discover:album:`), n === index + 1, and shuffle is off.
  - On `mixed`, it sets `index = cued` and `loaded = songs[index]`. The `play` that follows updates the header, record, queue, Media Session and taste report as for any new song.
  - With `localStorage.automixDebug` set, it logs a one-line summary of each plan: type, bars, BPMs, Camelot keys and ratio. That's for tuning by ear.
- **Not mixable:** YouTube (it plays in YouTube's own player) and repeat-one. Both keep today's behaviour.

## 5. Ordering the songs Infinite adds (`queue.js` `more()`)
With Auto Mix on, the added songs are fetched with `POST /api/mix/summaries`.
- They are chained greedily from the last song in the queue: each pick is the best `score(prev, cand)` from `automix.js`: 0.4 × tempo fit (within 8%, with ×2 and ½) + 0.35 × Camelot score + 0.25 × energy fit (a gentle rise is favoured).
- Songs with no analysis keep their random order and go after the ranked ones.
- Your list itself is never reordered.

## 6. The icon (`queue.js`, `style/insert.css`)
- The `<i class="icon icon-automix">` mask becomes an inline `<svg class="am">` with two paths, a fade-in curve and a fade-out curve. Both pass through a crossing point M(x); `amPath(x)` writes their `d`, and x = 0.5 draws today's shape.
- **Motion:**
  - On hover, x glides between 0.3 and 0.7 on a spring, like a crossfader being worked, and settles back on leave.
  - Clicking it on springs x 0.5 → 0.8 → 0.5 with overshoot, the curves swap and the pill turns red. Clicking it off relaxes it.
  - During a real mix (`mixstart` to `mixend`), x = 0.15 + 0.7·p follows the live progress in `requestAnimationFrame`. The label becomes "Auto Mix · mixing into ‘Song’".
  - With `prefers-reduced-motion` on, nothing oscillates or springs: it only changes state.
- The label loses "· coming soon", and the `.icon-automix` mask CSS is removed.

## Files
- **New:**
  - `javascript/automix-analyze.js`: the Worker, with exports for the tests.
  - `javascript/automix.js`: `plan()`, `score()` and the Camelot helpers, loaded before deck-audio.js in `index.html` and `library.html`.
  - `api/mix.js`: the analysis cache.
  - `tests/automix.test.js`.
  - `docs/superpowers/specs/2026-09-28-auto-mix-design.md`.
- **Edited:** `javascript/deck-audio-worklet.js`, `javascript/deck-audio.js`, `javascript/player.js`, `javascript/queue.js`, `style/insert.css`, `server.js` (the mount) and `index.html` and `library.html` (one script tag each). `package.json` already includes `api/**` and `javascript/**`.

## Verification (kept small, per your rule)
1. `node --check` on each changed file.
2. `tests/automix.test.js` (node --test), all on synthetic audio generated in the test:
   - **Analysis:** a 124 BPM kick with accented downbeats, 8-bar phrases with an energy step, and C-major chords. The BPM is within ±0.1, the downbeat phase and phrase offset are correct, the key is 8B, and the intro and outro bars are right.
   - **plan():** a table test. Close tempos with compatible keys → blend 16; 12% apart → echo; beatless → fade; album next → gapless; a key clash → L ≤ 4; overlapping busy bars → shorter L or a cut.
   - **Worklet:** with a 3% tempo gap and a drifting grid, the beats stay aligned within 1 ms over 32 bars. Outside the swap beat, the isolator bands sum back to the input, and the handover lands on the planned frame.
3. `npm test` still passes, including the unchanged `deck-audio.test.js`.
4. **Listening by you** (`npm start`, Auto Mix on, `localStorage.automixDebug=1`):
   - two house or electronic songs → a long blend;
   - pop → pop;
   - an album in order → gapless;
   - hip-hop around 90 BPM → house at 124 → echo;
   - ambient → acoustic → fade;
   - hover and click the icon, and watch it during a mix.

## Out of scope (ponytail)
- Time-stretch or key lock: a WSOLA stretcher is the upgrade if the up-to-4% pitch shift is ever heard.
- Stem separation, for vocal-aware or Neural Mix-style blends.
- An ML vocal detector.
- A "Mix now" button.
- Analysing songs in the background before they're queued.
- Mixing YouTube songs.
- Per-user transition styles.
