# Song Features: design (spec)

## Context
ACRUX gets one shared analysis layer for every song: Auto Mix, a coming visualizer, and anything later read from it.
Everything is worked out once per song, off the page's main thread, from sound the deck has already decoded. Nothing
is downloaded just to analyse a song.

**Decisions (2026-09-30):**
- **Permissive toolkit:** ACRUX's own signal processing, plus **Beat This!** for beats, downbeats and meter (Foscarin,
  Schlüter, Widmer, ISMIR 2024; code and weights MIT). Essentia.js was ruled out: it's AGPL-3.0, and its models are
  non-commercial.
- **When:** on play (the song playing and the one cued next), plus an idle backlog of songs already on this computer.

## Architecture
```
decoded song (DeckAudio._level / the cue / the backlog)
  └─ FEATURES.song(id, whole)                 javascript/features.js
       resample once to 22 050 Hz stereo (OfflineAudioContext), channels transferred
       └─ Worker javascript/features-worker.js
            stage 1: automix-analyze.js analyze() → `mix` (Auto Mix, unchanged)             ~0.7 s
            stage 2: spectrum + levels + Beat This! (onnxruntime-web, 1 thread) + describe  ~4 s per minute of song
       ├─ PUT /api/mix/:id                    Auto Mix's analysis, as before
       └─ PUT /api/features/:id/frames, then PUT /api/features/:id      api/features.js
readers: FEATURES.get(id) · FEATURES.frames(id) · music.analyser (live) · 'featuresready'
```
- **Stage 1 first:** a newer song's stage 1 runs between the chunks of an older song's stage 2, so Auto Mix never
  waits on the model.
- **Every song:** DeckAudio asks for features for every song, with Auto Mix on or off. It applies Auto Mix's level
  trim only when Auto Mix is on.
- **The backlog** (`features.js`) runs only for the owner, in one tab (a Web Lock), after 15 s with nothing playing:
  - one song at a time, from `GET /api/features/missing`, most played first. That lists local files, fully cached
    Drive songs, and Discover songs kept offline;
  - it fetches with `?local=1`, so the server answers 409 rather than go to Drive, and the fetch doesn't count as a
    play;
  - it stops the moment a song plays.

## What comes out (version 1)
**Frames file** (`ACXF`: a magic word, a version byte, a JSON header, then rows of 8-bit values, each scaled between
its row's min and max; stored gzipped):
- **50 fps:**
  - `rms`, `loudness` (400 ms, LUFS);
  - `low`, `mid`, `high` (dB);
  - `onset` and `kick` (log-mel flux);
  - `brightness` (spectral centroid), `rolloff`, `flatness`, `zcr`;
  - `width`, `balance`;
  - `beat` and `downbeat` (probabilities from Beat This!);
  - `voice` (tonal energy from 300 to 3400 Hz), `harmony` (chroma change).
- **25 fps:** `mel` (64 bands), `chroma` (12), `mfcc` (13).
- `ssm`: a bar-by-bar self-similarity matrix. `bars` in the header gives each bar's start time.

Size: about 3 KB per second of song (0.9 MB for 5 minutes before gzip, 0.7 MB gzipped).

**Summary JSON:**
- **Rhythm:** bpm, meter, meterConfidence, confidence, steady (the share of beat gaps within 10% of each other),
  pulse, beats, downbeats (ms), and tempo per bar.
- **Onsets** (ms).
- **Sections:** start, end, label A…, bars, loudness, energy, voice share and key for each; plus drops and builds.
- **Key; loudness:** LUFS, LRA (EBU Tech 3342), peak, PLR.
- **Song-wide:** energy, brightness, voice share, and shape (intro, outro, fade, cold).

**Live:** `music.analyser`, an AnalyserNode after the mix and the volume, made when first asked for.

## Beat This!, exactly
- **Model:** `javascript/models/beat-this-small0.onnx`, 10.5 MB, exported from the official small0 checkpoint by
  `tests/features-beatthis-export.py`. ONNX matches PyTorch within 3.4e-5.
- **Runtime:** `javascript/vendor/ort/` holds onnxruntime-web 1.30.0 (MIT), WebAssembly build only: 14.3 MB.
- **Frontend, as LogMelSpect:** 22 050 Hz mono; a periodic Hann window over 1024 points; hop 441; centred with reflect
  padding; magnitude ÷ √1024; 128 Slaney mel bands from 30 Hz to 11 kHz; `log1p(1000·x)`.
- **Inference and peak picking:** 1500-frame chunks with 6-frame borders, keeping the first chunk's frames where they
  overlap; a 7-frame max-pool, logit > 0; adjacent peaks merged; downbeats snapped to their nearest beat.
- **Parity:** on the reference signal and on 5 real songs (jazz, metal, a Chopin waltz, disco, a jig), the JS port
  gives exactly PyTorch's beats and downbeats.
- **Meter** (ours): the small model marks too many downbeats on harder music. So the meter is chosen as the one
  pattern of every Nth beat whose downbeat activation stands out most (2 to 7 beats). A shorter meter that a longer
  one only repeats wins, and a meter is given only when at least half the beat gaps are steady.

## Results on 17 genres (Internet Archive)
- **4/4 with high confidence:** disco 0.999, house 0.94, folk 0.91, live rock 0.87, and the ballad, hip-hop, reggae,
  techno and band-waltz songs.
- **No meter:** jazz, the jig, piano, the Chopin waltz, ambient, metal and speech. Their beats aren't steady enough.
- **Beats that Auto Mix's own analysis missed:** metal, rock, jazz and piano. Jazz came out at 273 BPM (double time).
- **Time:** stage 2 takes about 4 s per minute of song on one thread of an Apple-silicon Mac (17 s for a 3.5-minute
  song in Chrome). No main-thread long tasks during a whole run.

## Limits (ponytail)
- One meter a song, and 3/4 is proven only on made-up activations. None of the 17 songs had a steady 3/4 beat.
- The small model's tempo can be twice the real one (jazz). A trained tempo model or the larger final0 checkpoint
  (82 MB) would help.
- A removed song's features stay on disk, about 0.5 MB each.
- Auto Mix still uses its own beats. Switching it to Beat This! needs a 17-genre re-check first.

## Tests
- `tests/features.test.js`:
  - the frontend and peak picking against PyTorch;
  - meter;
  - the frames round-trip;
  - A-B-A sections;
  - the API;
  - the backlog list.
- Existing tests unchanged: automix-plan, automix-analyze, add-more and collection.
