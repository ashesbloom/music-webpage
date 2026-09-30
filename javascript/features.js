// ACRUX Song Features, the page side: everything a song gives (javascript/features-worker.js works it out), shared by
// every part of ACRUX that wants it: Auto Mix, a visualizer, anything later. Worked out once per song and kept on the
// server (api/features.js), so any page or device gets it from there.
//   FEATURES.song(id, whole)  { mix, features }: promises of Auto Mix's analysis and the song's features (the summary
//                             below), from the server when it has them, else worked out from the decoded song. whole()
//                             gives its AudioBuffer (or null), and is asked for only then. DeckAudio calls this.
//   FEATURES.get(id)          the summary, or null: rhythm (Beat This!'s beats, downbeats, time signature, tempo per
//                             bar), onsets, sections (A/B/C), drops and builds, key, loudness (LUFS, range, peak),
//                             energy, brightness, voice share, and the song's shape (intro, outro, fade, cold)
//   FEATURES.frames(id)       the per-frame measures and matrices, or null: { rows: { name: { fps, width, frames, unit,
//                             data } }, at(name, t), bars }. At 50 fps: rms, loudness, low, mid, high, onset, kick,
//                             brightness, rolloff, flatness, zcr, width, balance, beat, downbeat, voice, harmony. At
//                             25 fps: mel (64 bands), chroma (12), mfcc (13). ssm: bar-by-bar similarity (bars: their
//                             start times, ms). Fetched only when asked for.
//   FEATURES.has(id)          whether this page has it, or has it on the way
//   document 'featuresready'  (detail: { id }) when a song's features are worked out and kept
// Live sound for a visualizer is DeckAudio's `analyser` (a Web Audio AnalyserNode after the mix).
// While nothing plays, the songs already on this computer that have no features yet are worked out one at a time
// (the backlog): only on the computer running ACRUX, in one tab, never anything fetched from Drive or the internet for
// it, and it stops the moment a song plays.

// The frames file (features-worker.js encode()): "ACXF", a version byte, the JSON header's length, the header, then
// each row's bytes. A byte is its row's min + byte / 255 × (max − min).
function decodeFrames(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'ACXF') return null;
  const len = new DataView(buf).getUint32(8, true);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + len)));
  let at = 12 + len;
  const rows = {};
  for (const r of head.rows) {
    const n = r.width * r.frames, data = new Float32Array(n), span = (r.max - r.min) / 255;
    for (let i = 0; i < n; i++) data[i] = r.min + bytes[at + i] * span;
    at += n;
    rows[r.name] = { ...r, data };
  }
  // A row's value at t seconds (a matrix row: its values at that frame).
  const valueAt = (name, t) => {
    const r = rows[name];
    if (!r || !r.fps || !r.frames) return null;
    const f = Math.min(r.frames - 1, Math.max(0, Math.round(t * r.fps)));
    return r.width === 1 ? r.data[f] : r.data.subarray(f * r.width, (f + 1) * r.width);
  };
  return { v: head.v, bars: head.bars || [], rows, at: valueAt };
}

if (typeof window !== 'undefined') window.FEATURES = (() => {
  const VERSION = 1; // features-worker.js's FEATURES_VERSION: older features are worked out again
  const here = document.currentScript.src;
  const API = new URL('../api/', here).href;
  const WORKER = new URL('features-worker.js', here).href;
  const enc = encodeURIComponent;
  const known = new Map();  // song id → { mix, features } promises, for this session
  const local = new Map();  // song id → its frames (ArrayBuffer), worked out here: without a server they're kept only here
  let worker = null, jobs = 0;
  const waiting = new Map(); // job → { mix, features } resolvers

  function start() {
    if (worker) return worker;
    try { worker = new Worker(WORKER); } catch { return null; }
    worker.onmessage = ({ data }) => {
      const w = waiting.get(data.id);
      if (!w) return;
      if (data.stage === 'mix') w.mix(data.mix);
      else { w.features(data); waiting.delete(data.id); }
    };
    worker.onerror = () => { for (const w of waiting.values()) { w.mix(null); w.features({}); } waiting.clear(); worker = null; };
    return worker;
  }

  // A decoded song (any sample rate) into the Worker: resampled natively to 22 050 Hz stereo, its channels handed over
  // (not copied) when they're ours to give (own: the caller's buffer, or the resampled copy). -> { job, mix, features }
  // (features: { summary, frames } or {}).
  async function run(buffer, features, own = false) {
    let song = buffer;
    if (buffer.sampleRate !== 22050) {
      const offline = new OfflineAudioContext(2, Math.ceil(buffer.duration * 22050), 22050);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start();
      song = await offline.startRendering();
    }
    const mine = own || song !== buffer; // the deck's own buffer is still playing: its channels are copied
    const ch = (i) => (mine ? song.getChannelData(i) : song.getChannelData(i).slice());
    const left = ch(0), right = song.numberOfChannels > 1 ? ch(1) : left.slice();
    const w = start(), job = ++jobs;
    if (!w) return { job, mix: Promise.resolve(null), features: Promise.resolve({}) };
    const out = { job };
    out.mix = new Promise((mix) => { out.features = new Promise((feat) => waiting.set(job, { mix, features: feat })); });
    w.postMessage({ id: job, left, right, sr: 22050, features }, [left.buffer, right.buffer]);
    return out;
  }

  const getJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const put = (url, body, type) => fetch(url, { method: 'PUT', headers: { 'Content-Type': type }, body }).then((r) => r.ok).catch(() => false);
  // Features worked out here: kept on the server (the frames first, so a summary there always has its frames).
  async function keep(id, { summary, frames }) {
    if (!summary) return null;
    if (frames) {
      local.set(id, frames);
      if (local.size > 3) local.delete(local.keys().next().value);
      if (await put(`${API}features/${enc(id)}/frames`, frames, 'application/octet-stream')) await put(`${API}features/${enc(id)}`, JSON.stringify(summary), 'application/json');
    }
    document.dispatchEvent(new CustomEvent('featuresready', { detail: { id } }));
    return summary;
  }

  // What a song gives: from the server, else worked out once from whole() and kept there.
  function song(id, whole = () => Promise.resolve(null)) {
    if (id && known.has(id)) return known.get(id);
    const both = (id ? Promise.all([getJson(`${API}mix/${enc(id)}`), getJson(`${API}features/${enc(id)}`)]) : Promise.resolve([null, null]))
      .then(async ([m, f]) => {
        const savedMix = m?.v === AUTOMIX.VERSION ? m : null, savedFeatures = f?.v === VERSION ? f : null;
        if (savedMix && savedFeatures) return { mix: savedMix, features: savedFeatures };
        const buffer = await whole();
        if (!buffer) return { mix: savedMix, features: savedFeatures };
        const r = await run(buffer, !!id && !savedFeatures); // a song with no id can't be kept: Auto Mix's part only
        const made = r.mix.then((a) => {
          if (a && !savedMix && id) put(`${API}mix/${enc(id)}`, JSON.stringify(a), 'application/json');
          return savedMix || a;
        });
        return { mix: made, features: savedFeatures || r.features.then((x) => keep(id, x)) };
      });
    const entry = { mix: both.then((x) => x.mix).catch(() => null), features: both.then((x) => x.features).catch(() => null) };
    if (id) {
      known.set(id, entry);
      Promise.all([entry.mix, entry.features]).then(([m, f]) => { if (!m && !f && known.get(id) === entry) known.delete(id); }); // tried again next time
    }
    return entry;
  }

  const get = (id) => (known.has(id) ? known.get(id).features : getJson(`${API}features/${enc(id)}`).then((f) => (f?.v === VERSION ? f : null)));
  async function frames(id) {
    if (local.has(id)) return decodeFrames(local.get(id));
    const res = await fetch(`${API}features/${enc(id)}/frames`).catch(() => null);
    return res?.ok ? decodeFrames(await res.arrayBuffer()) : null;
  }

  // ---------- the backlog ----------
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const playing = () => !!window.music && !window.music.paused;
  async function quiet() { // until nothing has played for 15 s
    for (let calm = 0; calm < 3;) { await sleep(5000); calm = playing() ? 0 : calm + 1; }
  }
  // One song from this computer: fetched (?local=1: the server never goes to Drive for it), decoded straight to
  // 22 050 Hz, worked out and kept. A song starting to play stops it. -> whether it worked.
  async function one({ id, src }) {
    const stop = new AbortController();
    let job = null;
    const onPlay = () => { stop.abort(); if (job) worker?.postMessage({ cancel: job }); };
    window.music?.addEventListener('play', onPlay);
    try {
      const res = await fetch(new URL(src, API).href, { signal: stop.signal });
      if (!res.ok) return false;
      const buffer = await new OfflineAudioContext(2, 1, 22050).decodeAudioData(await res.arrayBuffer());
      if (stop.signal.aborted) return true; // tried again later
      const r = await run(buffer, true, true);
      job = r.job;
      const [mix, out] = await Promise.all([r.mix, r.features]);
      if (stop.signal.aborted) return true;
      const saved = await getJson(`${API}mix/${enc(id)}`);
      if (mix && saved?.v !== AUTOMIX.VERSION) put(`${API}mix/${enc(id)}`, JSON.stringify(mix), 'application/json');
      const summary = await keep(id, out);
      if (summary) known.set(id, { mix: Promise.resolve(saved?.v === AUTOMIX.VERSION ? saved : mix), features: Promise.resolve(summary) });
      return !!summary;
    } catch { return stop.signal.aborted; } finally { window.music?.removeEventListener('play', onPlay); }
  }
  async function backlog() {
    await window.CATALOG?.ready;
    if (!window.CATALOG?.me().owner || !navigator.locks) return;
    navigator.locks.request('acrux-song-features', { ifAvailable: true }, async (lock) => {
      if (!lock) return; // another tab has it
      const failed = new Set(); // songs that wouldn't decode: not tried again this session
      for (;;) {
        await quiet();
        const list = await getJson(`${API}features/missing?limit=20`);
        const todo = (list?.songs || []).filter((s) => !failed.has(s.id));
        if (!todo.length) { await sleep(10 * 60e3); continue; }
        for (const s of todo) {
          if (playing()) break;
          if (!(await one(s))) failed.add(s.id);
          await sleep(2000);
        }
      }
    });
  }
  if (!/^file:/.test(location.protocol)) backlog();

  return { song, get, frames, has: (id) => known.has(id), VERSION };
})();
if (typeof module === 'object') module.exports = { decodeFrames };
