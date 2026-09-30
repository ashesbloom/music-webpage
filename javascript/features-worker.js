// ACRUX Song Features, the Worker: everything a song gives, worked out once from its decoded sound (22 050 Hz stereo)
// for every part of ACRUX that wants it: Auto Mix, a visualizer, anything later. javascript/features.js runs it and
// keeps what it finds on the server (api/features.js). Per song, in two stages:
//   1. `mix`: automix-analyze.js's analysis, what Auto Mix plans from. First, and fast (about a second).
//   2. the rest: the frames (curves at 50 fps, matrices at 25 fps), rhythm from Beat This! (a trained beat and
//      downbeat tracker: JKU Linz, ISMIR 2024, MIT; javascript/models), structure, key per section, loudness. About
//      15-20 s of this thread for a 5-minute song, once per song: a newer song's stage 1 goes in between.
// The pure parts are exported for node --test (tests/features.test.js). All of it sits in one function scope:
// automix-analyze.js, imported into this Worker, has top-level names of its own (mean, levels…).
(() => {
const FEATURES_VERSION = 1;
const SR = 22050;
const FPS = 50, HOP = 441, NFFT = 1024; // Beat This!'s frontend: 22 050 Hz, 1024-point FFT, hop 441 (50 fps)
const NMEL = 128, FMIN = 30, FMAX = 11000;
const CHUNK = 1500, BORDER = 6;         // Beat This! runs on 30 s chunks, 6 frames either side thrown away

const M = typeof module === 'object' ? require('./automix-analyze.js') : (importScripts('automix-analyze.js'), {
  analyze, makeFft, kWeighting, key, // automix-analyze.js's globals, once imported
});

// ---------- Beat This!'s frontend: its LogMelSpect, exactly ----------
// torchaudio's MelSpectrogram(sample_rate=22050, n_fft=1024, hop_length=441, f_min=30, f_max=11000, n_mels=128,
// mel_scale="slaney", normalized="frame_length", power=1), then log1p(1000·x): a periodic Hann window, frames centred
// on each hop (reflect padding), magnitudes over √1024, triangular Slaney mel filters with no area normalisation.
const hzToMel = (f) => (f < 1000 ? f / (200 / 3) : 15 + Math.log(f / 1000) / (Math.log(6.4) / 27));
const melToHz = (m) => (m < 15 ? m * (200 / 3) : 1000 * Math.exp((Math.log(6.4) / 27) * (m - 15)));
function melFilters(n = NMEL, fmin = FMIN, fmax = FMAX) {
  const bins = NFFT / 2 + 1;
  const all = Float64Array.from({ length: bins }, (_, k) => (k * Math.floor(SR / 2)) / (bins - 1)); // linspace(0, sr // 2)
  const m0 = hzToMel(fmin), m1 = hzToMel(fmax);
  const pts = Float64Array.from({ length: n + 2 }, (_, i) => melToHz(m0 + ((m1 - m0) * i) / (n + 1)));
  const fb = Array.from({ length: n }, () => new Float64Array(bins));
  for (let m = 0; m < n; m++) {
    for (let k = 0; k < bins; k++) {
      const down = (all[k] - pts[m]) / (pts[m + 1] - pts[m]);
      const up = (pts[m + 2] - all[k]) / (pts[m + 2] - pts[m + 1]);
      fb[m][k] = Math.max(0, Math.min(down, up));
    }
  }
  return { fb, centres: Array.from({ length: n }, (_, m) => pts[m + 1]) };
}
const nframes = (len) => 1 + Math.floor(len / HOP);

// One pass of the STFT over the song: Beat This!'s log-mel, and every per-frame measure that comes from the spectrum.
function spectrum(left, right) {
  const len = left.length, T = nframes(len), bins = NFFT / 2 + 1;
  const mono = new Float32Array(len);
  for (let i = 0; i < len; i++) mono[i] = (left[i] + right[i]) / 2;
  const at = (i) => mono[i < 0 ? -i : i >= len ? 2 * (len - 1) - i : i]; // reflect padding
  const win = Float64Array.from({ length: NFFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NFFT));
  const fft = M.makeFft(NFFT);
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT), mag = new Float64Array(bins);
  const { fb, centres } = melFilters();
  const lo = fb.map((row) => row.findIndex((v) => v > 0)), hi = fb.map((row) => row.findLastIndex((v) => v > 0));
  const hz = (k) => (k * SR) / NFFT;
  const pc = new Int8Array(bins).fill(-1), share = new Float32Array(bins);
  for (let k = 1; k < bins; k++) {
    const f = hz(k);
    if (f >= 180 && f < 5000) { const p = 12 * Math.log2(f / 440) + 69; pc[k] = ((Math.floor(p) % 12) + 12) % 12; share[k] = 1 - (p - Math.floor(p)); }
  }
  const out = {
    T, mel: new Float32Array(T * NMEL), chroma: new Float32Array(T * 12),
    low: new Float32Array(T), mid: new Float32Array(T), high: new Float32Array(T), brightness: new Float32Array(T),
    rolloff: new Float32Array(T), flatness: new Float32Array(T), voice: new Float32Array(T), onset: new Float32Array(T),
    kick: new Float32Array(T), centres,
  };
  const kickBands = centres.map((c) => c < 150);
  for (let f = 0; f < T; f++) {
    const s = f * HOP - NFFT / 2;
    for (let i = 0; i < NFFT; i++) { re[i] = at(s + i) * win[i]; im[i] = 0; }
    fft(re, im);
    let total = 0, weighted = 0, low = 0, mid = 0, high = 0, logSum = 0, sum = 0, n = 0, vLog = 0, vSum = 0, vn = 0;
    for (let k = 0; k < bins; k++) {
      const m = Math.hypot(re[k], im[k]) / 32; // over √1024
      mag[k] = m;
      const p = m * m, fk = hz(k);
      if (k) { total += p; weighted += fk * m; }
      if (fk < 150) low += p; else if (fk < 4000) mid += p; else high += p;
      if (fk >= FMIN && fk < FMAX) { logSum += Math.log(p + 1e-12); sum += p + 1e-12; n++; }
      if (fk >= 300 && fk < 3400) { vLog += Math.log(p + 1e-12); vSum += p + 1e-12; vn++; }
      if (pc[k] >= 0) { const c = out.chroma.subarray(f * 12, f * 12 + 12); c[pc[k]] += m * share[k]; c[(pc[k] + 1) % 12] += m * (1 - share[k]); }
    }
    const row = out.mel.subarray(f * NMEL, (f + 1) * NMEL);
    for (let b = 0; b < NMEL; b++) {
      let v = 0;
      for (let k = lo[b]; k <= hi[b]; k++) v += fb[b][k] * mag[k];
      row[b] = Math.log1p(1000 * v);
    }
    let magSum = 0;
    for (let k = 1; k < bins; k++) magSum += mag[k];
    let cum = 0, roll = 0;
    for (let k = 1; k < bins; k++) { cum += mag[k] * mag[k]; if (cum >= 0.85 * total) { roll = hz(k); break; } }
    const dB = (v) => 10 * Math.log10(v + 1e-12);
    out.low[f] = dB(low); out.mid[f] = dB(mid); out.high[f] = dB(high);
    out.brightness[f] = magSum ? weighted / magSum : 0;
    out.rolloff[f] = roll;
    out.flatness[f] = n ? Math.exp(logSum / n) / (sum / n) : 0;
    const vFlat = vn ? Math.exp(vLog / vn) / (vSum / vn) : 1;
    out.voice[f] = dB((vSum / Math.max(vn, 1)) * (1 - vFlat)); // tonal energy in the voice band: a voice or a lead
    if (f) { // onsets: log-mel spectral flux (and in the bands under 150 Hz: the kick)
      let fl = 0, kk = 0;
      const prev = out.mel.subarray((f - 1) * NMEL, f * NMEL);
      for (let b = 0; b < NMEL; b++) { const d = Math.max(0, row[b] - prev[b]); fl += d; if (kickBands[b]) kk += d; }
      out.onset[f] = fl; out.kick[f] = kk;
    }
  }
  return out;
}

// Level, loudness, zero crossings and the stereo image, per frame (the 20 ms around each frame time).
function levels(left, right) {
  const len = left.length, T = nframes(len);
  const out = { rms: new Float32Array(T), zcr: new Float32Array(T), width: new Float32Array(T), balance: new Float32Array(T), loudness: new Float32Array(T) };
  const k = [left, right].map(() => M.kWeighting(SR).map((c) => ({ c, x1: 0, x2: 0, y1: 0, y2: 0 })));
  const kBlock = new Float64Array(T); // K-weighted mean square per hop, channels summed (BS.1770)
  for (let f = 0; f < T; f++) {
    const a = Math.max(0, f * HOP - (HOP >> 1)), b = Math.min(len, f * HOP + (HOP >> 1) + 1);
    let l2 = 0, r2 = 0, m2 = 0, s2 = 0, zc = 0, prev = 0;
    for (let i = a; i < b; i++) {
      const l = left[i], r = right[i], m = (l + r) / 2, s = (l - r) / 2;
      l2 += l * l; r2 += r * r; m2 += m * m; s2 += s * s;
      if (i > a && (m >= 0) !== (prev >= 0)) zc++;
      prev = m;
    }
    const n = Math.max(b - a, 1);
    out.rms[f] = 10 * Math.log10((l2 + r2) / (2 * n) + 1e-12);
    out.zcr[f] = (zc * SR) / n / 2; // crossings a second, halved: roughly the dominant frequency
    const ms = Math.sqrt(m2 / n), ss = Math.sqrt(s2 / n), rl = Math.sqrt(l2 / n), rr = Math.sqrt(r2 / n);
    out.width[f] = ms + ss ? ss / (ms + ss) : 0;
    out.balance[f] = rl + rr ? (rr - rl) / (rl + rr) : 0; // -1 all left, +1 all right
  }
  [left, right].forEach((ch, c) => { // one filter pass per channel, summed into the hop blocks
    const fs = k[c];
    for (let f = 0; f < T; f++) {
      const a = f * HOP, b = Math.min(len, a + HOP);
      let sum = 0;
      for (let i = a; i < b; i++) {
        let v = ch[i];
        for (const x of fs) {
          const [b0, b1, b2, a1, a2] = x.c;
          const y = b0 * v + b1 * x.x1 + b2 * x.x2 - a1 * x.y1 - a2 * x.y2;
          x.x2 = x.x1; x.x1 = v; x.y2 = x.y1; x.y1 = y; v = y;
        }
        sum += v * v;
      }
      kBlock[f] += sum / Math.max(b - a, 1);
    }
  });
  const lufs = (ms) => -0.691 + 10 * Math.log10(ms + 1e-12);
  const pre = new Float64Array(T + 1);
  for (let f = 0; f < T; f++) pre[f + 1] = pre[f] + kBlock[f];
  const mean = (a, b) => (pre[Math.min(b, T)] - pre[Math.max(a, 0)]) / Math.max(Math.min(b, T) - Math.max(a, 0), 1);
  for (let f = 0; f < T; f++) out.loudness[f] = lufs(mean(f - 10, f + 10)); // momentary: 400 ms
  // Loudness range (EBU Tech 3342): short-term (3 s) loudness each second, gated at -70 LUFS and 20 LU under their mean.
  const short = [];
  for (let f = 0; f + 3 * FPS <= T; f += FPS) short.push(lufs(mean(f, f + 3 * FPS)));
  const heard = short.filter((v) => v > -70);
  const gate = heard.length ? lufs(heard.reduce((s, v) => s + 10 ** ((v + 0.691) / 10), 0) / heard.length) - 20 : 0;
  const kept = heard.filter((v) => v > gate).sort((x, y) => x - y);
  out.lra = kept.length ? kept[Math.floor(0.95 * (kept.length - 1))] - kept[Math.floor(0.1 * (kept.length - 1))] : 0;
  return out;
}

// ---------- Beat This!: chunking, as its split_piece / aggregate_prediction ("keep_first"), and peak picking ----------
function chunkStarts(T) {
  const starts = [];
  for (let s = -BORDER; s < T - BORDER; s += CHUNK - 2 * BORDER) starts.push(s);
  if (T > CHUNK - 2 * BORDER) starts[starts.length - 1] = T - (CHUNK - BORDER);
  return starts;
}
// The chunk starting at frame s of mel (T × 128), zero-padded where it runs past either end: [data, frames].
function chunkAt(mel, T, s) {
  const from = Math.max(s, 0), to = Math.min(s + CHUNK, T), left = Math.max(0, -s), right = Math.max(0, Math.min(BORDER, s + CHUNK - T));
  const n = left + (to - from) + right, data = new Float32Array(n * NMEL);
  data.set(mel.subarray(from * NMEL, to * NMEL), left * NMEL);
  return [data, n];
}
// Chunk predictions → the whole piece's: each chunk's border frames dropped, earlier chunks winning where they overlap.
function aggregate(preds, starts, T) {
  const out = new Float32Array(T).fill(-1000);
  for (let c = preds.length - 1; c >= 0; c--) {
    const p = preds[c], s = starts[c];
    for (let i = BORDER; i < p.length - BORDER; i++) { const f = s + i; if (f >= 0 && f < T) out[f] = p[i]; }
  }
  return out;
}
// Peaks: local maxima within ±3 frames with logit > 0; runs of adjacent peaks become their mean (deduplicate_peaks).
function peaks(logits) {
  const T = logits.length, found = [];
  for (let f = 0; f < T; f++) {
    let max = -Infinity;
    for (let d = -3; d <= 3; d++) if (f + d >= 0 && f + d < T) max = Math.max(max, logits[f + d]);
    if (logits[f] === max && logits[f] > 0) found.push(f);
  }
  const out = [];
  let p = null, c = 0;
  for (const q of found) {
    if (p !== null && q - p <= 1) { c++; p += (q - p) / c; } else { if (p !== null) out.push(p); p = q; c = 1; }
  }
  if (p !== null) out.push(p);
  return out;
}
// Beats and downbeats in seconds, each downbeat on its nearest beat (Beat This!'s "minimal" postprocessing).
function beatsFrom(beatLogits, downLogits) {
  const beats = peaks(beatLogits).map((f) => f / FPS);
  let downs = peaks(downLogits).map((f) => f / FPS);
  if (beats.length) {
    downs = downs.map((d) => {
      let best = 0;
      for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i] - d) < Math.abs(beats[best] - d)) best = i;
      return beats[best];
    });
  }
  return { beats, downbeats: [...new Set(downs)].sort((a, b) => a - b) };
}
// Beats in a bar, steadily: the model's own downbeats come too often on harder music (the small model with its minimal
// peak picking marks a third to a half of all beats in jazz or a Chopin waltz), so, like its optional bar-tracking
// step, the bar is taken as one meter all through. For each meter (2-7 beats) and each beat it could start on: how much
// stronger the downbeat activation is on those beats than on the others. The best wins; a longer meter that only
// repeats a shorter one (6 over 3, 8 over 4) gives way to it. Weak evidence: no meter. act: the downbeat activation
// (0-1) at each beat. -> { meter, phase, confidence } or null.
// ponytail: one meter a song; a song that changes meter keeps its first bars' meter. Track bars piecewise if that matters.
function meter(act) {
  if (act.length < 16) return null;
  const all = act.reduce((s, v) => s + v, 0);
  let best = null;
  for (let m = 2; m <= 7; m++) {
    for (let p = 0; p < m; p++) {
      let on = 0, n = 0;
      for (let i = p; i < act.length; i += m) { on += act[i]; n++; }
      const contrast = on / n - (all - on) / (act.length - n);
      if (!best || contrast > best.confidence) best = { meter: m, phase: p, confidence: contrast };
    }
  }
  for (let m = 2; m < best.meter; m++) { // the shortest meter that does nearly as well, and that the best one repeats
    if (best.meter % m) continue;
    for (let p = 0; p < m; p++) {
      if ((best.phase - p) % m) continue;
      let on = 0, n = 0;
      for (let i = p; i < act.length; i += m) { on += act[i]; n++; }
      const contrast = on / n - (all - on) / (act.length - n);
      if (contrast >= 0.85 * best.confidence) { best = { meter: m, phase: p, confidence: contrast }; break; }
    }
  }
  best.confidence = +best.confidence.toFixed(3);
  return best.confidence >= 0.1 ? best : null;
}

let session = null;
async function beatThis(mel, T, cancelled) {
  if (!session) {
    const base = new URL('./', self.location.href);
    if (!self.ort) importScripts(new URL('vendor/ort/ort.wasm.min.js', base).href);
    self.ort.env.wasm.numThreads = 1; // one core: the page and the sound keep the rest
    self.ort.env.wasm.wasmPaths = new URL('vendor/ort/', base).href;
    session = await self.ort.InferenceSession.create(new URL('models/beat-this-small0.onnx', base).href);
  }
  const starts = chunkStarts(T), beat = [], down = [];
  for (const s of starts) {
    await new Promise((done) => setTimeout(done, 0)); // let a newer song's stage 1 (and a cancel) in between chunks
    if (cancelled()) return null;
    const [data, n] = chunkAt(mel, T, s);
    const out = await session.run({ spect: new self.ort.Tensor('float32', data, [1, n, NMEL]) });
    beat.push(out.beat.data); down.push(out.downbeat.data);
  }
  return { beat: aggregate(beat, starts, T), downbeat: aggregate(down, starts, T) };
}

// ---------- structure ----------

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const cosine = (u, v) => {
  let d = 0, a = 0, b = 0;
  for (let i = 0; i < u.length; i++) { d += u[i] * v[i]; a += u[i] * u[i]; b += v[i] * v[i]; }
  return a && b ? d / Math.sqrt(a * b) : 0;
};
// Bars: from downbeat to downbeat; without downbeats, 4 beats; without beats, 2 s. [{ start, end }] in seconds.
function barsOf(beats, downbeats, dur) {
  const lines = downbeats.length >= 4 ? downbeats : beats.length >= 8 ? beats.filter((_, i) => i % 4 === 0) : [];
  if (!lines.length) return Array.from({ length: Math.floor(dur / 2) }, (_, i) => ({ start: 2 * i, end: 2 * i + 2 }));
  return lines.slice(0, -1).map((t, i) => ({ start: t, end: lines[i + 1] }));
}
// Sections from bar-level features: a self-similarity matrix, Foote novelty (the 4 bars after each bar line against the
// 4 before), boundaries at its peaks (4 bars apart at least), and labels A, B, C…: a section like an earlier one gets
// its letter. vectors: one feature vector a bar.
function structure(vectors) {
  const n = vectors.length;
  const dims = vectors[0]?.length || 0;
  const mu = Array.from({ length: dims }, (_, d) => mean(vectors.map((v) => v[d])));
  const sd = Array.from({ length: dims }, (_, d) => Math.sqrt(mean(vectors.map((v) => (v[d] - mu[d]) ** 2))) || 1);
  const z = vectors.map((v) => v.map((x, d) => (x - mu[d]) / sd[d]));
  const ssm = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) ssm[i * n + j] = ssm[j * n + i] = cosine(z[i], z[j]);
  const avg = (a, b) => Array.from({ length: dims }, (_, d) => mean(z.slice(a, b).map((v) => v[d])));
  const nov = Array.from({ length: n }, (_, j) => {
    const w = Math.min(4, j, n - j);
    if (w < 2) return 0;
    const u = avg(j - w, j), v = avg(j, j + w);
    return Math.sqrt(u.reduce((s, x, d) => s + (x - v[d]) ** 2, 0));
  });
  const nm = mean(nov), nsd = Math.sqrt(mean(nov.map((v) => (v - nm) ** 2)));
  const bounds = [0];
  for (let j = 1; j < n; j++) {
    if (nov[j] < nm + 0.5 * nsd || nov.slice(Math.max(0, j - 2), j + 3).some((v) => v > nov[j])) continue;
    if (j - bounds.at(-1) >= 4 && n - j >= 4) bounds.push(j);
  }
  bounds.push(n);
  const sections = [];
  const letters = [];
  for (let s = 0; s + 1 < bounds.length; s++) {
    const v = avg(bounds[s], bounds[s + 1]);
    let label = letters.findIndex((c) => cosine(c, v) >= 0.8);
    if (label < 0) { letters.push(v); label = letters.length - 1; }
    sections.push({ from: bounds[s], to: bounds[s + 1], label: String.fromCharCode(65 + Math.min(label, 25)) });
  }
  return { ssm, sections, novelty: nov };
}

// ---------- the frames file ----------
// "ACXF", a version byte, three spare, the JSON header's length (u32 LE), the header, then each row's bytes in order.
// A row is one measure (width 1) or one matrix (width > 1) at `fps`, 8 bits a value between its min and max.
function encode(rows, extra = {}) {
  const meta = rows.map(({ name, fps, width, data, unit }) => {
    let min = Infinity, max = -Infinity;
    for (const v of data) if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
    if (!Number.isFinite(min)) { min = 0; max = 0; }
    return { name, fps, width, frames: width ? Math.floor(data.length / width) : 0, min: +min.toFixed(5), max: +max.toFixed(5), unit };
  });
  const head = new TextEncoder().encode(JSON.stringify({ v: FEATURES_VERSION, rows: meta, ...extra }));
  const total = rows.reduce((s, r) => s + r.data.length, 0);
  const buf = new Uint8Array(12 + head.length + total);
  buf.set([65, 67, 88, 70, FEATURES_VERSION, 0, 0, 0]);
  new DataView(buf.buffer).setUint32(8, head.length, true);
  buf.set(head, 12);
  let at = 12 + head.length;
  rows.forEach((r, i) => {
    const { min, max } = meta[i], span = max - min || 1;
    for (let k = 0; k < r.data.length; k++) {
      const v = r.data[k];
      buf[at++] = Number.isFinite(v) ? Math.round(Math.min(255, Math.max(0, ((v - min) / span) * 255))) : 0;
    }
  });
  return buf.buffer;
}

// Every 2 frames averaged: 50 fps → 25 fps, for a matrix `width` wide.
function halve(data, width) {
  const T = Math.floor(data.length / width / 2), out = new Float32Array(T * width);
  for (let f = 0; f < T; f++) for (let d = 0; d < width; d++) out[f * width + d] = (data[2 * f * width + d] + data[(2 * f + 1) * width + d]) / 2;
  return out;
}

// ---------- all of it ----------

// The song's features from its sound, its Auto Mix analysis (for levels and structure it already found) and the
// spectrum automix-analyze.js kept (for key per section). rhythm: Beat This!'s logits, or null (no model: no rhythm).
function describe(left, right, mix, sp, rhythm, S = spectrum(left, right)) {
  const L = levels(left, right), T = S.T, dur = left.length / SR;
  // 25 fps matrices: the mel spectrogram in 64 bands (pairs of Beat This!'s 128), chroma, and MFCC (the DCT of the
  // log mel energies, 13 coefficients).
  const mel64 = new Float32Array(T * 64);
  for (let f = 0; f < T; f++) for (let b = 0; b < 64; b++) mel64[f * 64 + b] = (S.mel[f * NMEL + 2 * b] + S.mel[f * NMEL + 2 * b + 1]) / 2;
  const chroma = halve(S.chroma, 12);
  for (let f = 0; f < chroma.length / 12; f++) {
    const c = chroma.subarray(f * 12, f * 12 + 12), top = Math.max(...c);
    if (top) for (let k = 0; k < 12; k++) c[k] /= top;
  }
  const mel128 = halve(S.mel, NMEL), T25 = mel128.length / NMEL, mfcc = new Float32Array(T25 * 13);
  const dct = Array.from({ length: 13 }, (_, c) => Float64Array.from({ length: NMEL }, (__, b) => Math.cos((Math.PI * c * (b + 0.5)) / NMEL) * Math.sqrt((c ? 2 : 1) / NMEL)));
  const logE = new Float64Array(NMEL);
  for (let f = 0; f < T25; f++) {
    for (let b = 0; b < NMEL; b++) logE[b] = 2 * Math.log(Math.expm1(mel128[f * NMEL + b]) / 1000 + 1e-8); // log mel energy
    for (let c = 0; c < 13; c++) { let s = 0; for (let b = 0; b < NMEL; b++) s += dct[c][b] * logE[b]; mfcc[f * 13 + c] = s; }
  }
  // Harmonic change: how different the chroma of the next 0.5 s is from the last 0.5 s.
  const harmony = new Float32Array(T);
  for (let f = 25; f + 25 < T; f++) {
    const u = new Float32Array(12), v = new Float32Array(12);
    for (let d = 1; d <= 25; d++) for (let k = 0; k < 12; k++) { u[k] += S.chroma[(f - d) * 12 + k]; v[k] += S.chroma[(f + d - 1) * 12 + k]; }
    harmony[f] = 1 - cosine(u, v);
  }
  const sig = (x) => 1 / (1 + Math.exp(-x));
  const beatAct = rhythm ? Float32Array.from(rhythm.beat, sig) : new Float32Array(T);
  const downAct = rhythm ? Float32Array.from(rhythm.downbeat, sig) : new Float32Array(T);

  // Rhythm: beats, downbeats, time signature, tempo per bar, and how clear the pulse is (the model's confidence at
  // its beats, times how even they are).
  const { beats, downbeats: modelDowns } = rhythm ? beatsFrom(rhythm.beat, rhythm.downbeat) : { beats: [], downbeats: [] };
  const gaps = beats.slice(1).map((t, i) => t - beats[i]);
  const period = median(gaps);
  const near = (row, t) => { const f = Math.round(t * FPS); let v = 0; for (let d = -2; d <= 2; d++) v = Math.max(v, row[Math.min(T - 1, Math.max(0, f + d))]); return v; };
  const steady = gaps.length ? gaps.filter((g) => Math.abs(g - period) <= 0.1 * period).length / gaps.length : 0; // gaps within 10%
  const bar = steady >= 0.5 ? meter(beats.map((t) => near(downAct, t))) : null; // no steady beat (rubato, ambient): no bars
  const downbeats = bar ? beats.filter((_, i) => i % bar.meter === bar.phase) : modelDowns;
  const bars = barsOf(beats, bar ? downbeats : [], dur);
  const pulse = beats.length ? mean(beats.map((t) => near(beatAct, t))) * steady : 0;

  // Onsets: onset-strength peaks (local maxima within 60 ms, over the median plus 1.5 × its spread).
  const om = median(S.onset), mad = median(Array.from(S.onset, (v) => Math.abs(v - om))) || 1e-6;
  const onsets = [];
  for (let f = 3; f + 3 < T && onsets.length < 6000; f++) {
    const v = S.onset[f];
    if (v > om + 1.5 * mad * 1.4826 && v >= Math.max(...S.onset.subarray(f - 3, f + 4))) onsets.push(Math.round((f / FPS) * 1000));
  }

  // Structure: each bar's timbre (mel), harmony (chroma) and activity (onsets, level).
  const frame = (t) => Math.min(T - 1, Math.max(0, Math.round(t * FPS)));
  const vectors = bars.map(({ start, end }) => {
    const a = frame(start), b = Math.max(frame(end), a + 1), v = new Array(64 + 12 + 2).fill(0);
    for (let f = a; f < b; f++) {
      for (let k = 0; k < 64; k++) v[k] += mel64[f * 64 + k] / (b - a);
      for (let k = 0; k < 12; k++) v[64 + k] += (2 * S.chroma[f * 12 + k]) / (b - a);
      v[76] += S.onset[f] / (b - a);
      v[77] += L.loudness[f] / (b - a);
    }
    return v;
  });
  const st = vectors.length >= 8 ? structure(vectors) : { ssm: new Float32Array(0), sections: [], novelty: [] };
  const body = median(Array.from(L.loudness).filter((v) => v > -70).sort((x, y) => x - y).slice(-Math.floor(T / 2))) || -70;
  const voiceTop = [...S.voice].sort((x, y) => x - y)[Math.floor(0.9 * (T - 1))];
  const voiced = (a, b) => { let n = 0; for (let f = a; f < b; f++) if (S.voice[f] >= voiceTop - 10 && L.loudness[f] > body - 20) n++; return n / Math.max(b - a, 1); };
  const sections = st.sections.map(({ from, to, label }) => {
    const start = bars[from].start, end = bars[to - 1].end, a = frame(start), b = Math.max(frame(end), a + 1);
    const heard = Array.from(L.loudness.subarray(a, b)).filter((v) => v > -70);
    const k = sp && M.key(sp, sp.frame(start), sp.frame(end));
    return { start: +start.toFixed(3), end: +end.toFixed(3), label, bars: to - from,
      loudness: +(heard.length ? 10 * Math.log10(mean(heard.map((v) => 10 ** (v / 10)))) : -70).toFixed(1),
      energy: +(mean(Array.from(S.onset.subarray(a, b))) / (om || 1)).toFixed(2), voice: +voiced(a, b).toFixed(2),
      key: k ? k.camelot : null };
  });
  // Drops: a section at least 6 dB louder than the one before. Builds: the 4 bars before a drop when their onsets rise.
  const drops = [], builds = [];
  sections.forEach((s, i) => {
    if (!i || s.loudness < sections[i - 1].loudness + 6) return;
    drops.push(s.start);
    const b = bars.findIndex((x) => x.start >= s.start - 1e-6);
    if (b >= 4) {
      const e = (j) => mean(Array.from(S.onset.subarray(frame(bars[j].start), frame(bars[j].end) + 1)));
      if (e(b - 1) > 1.3 * e(b - 4)) builds.push({ start: +bars[b - 4].start.toFixed(3), end: +s.start.toFixed(3) });
    }
  });
  let peak = 0;
  for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const peakDb = 20 * Math.log10(peak || 1e-9);
  const barLen = (j) => (mix?.grid ? 4 * mix.grid.period : mix?.bpm ? 240 / mix.bpm : 0) * j;

  const summary = {
    v: FEATURES_VERSION, dur: +dur.toFixed(3), start: mix?.start ?? 0, end: mix?.end ?? dur,
    rhythm: rhythm ? {
      bpm: period ? +(60 / period).toFixed(2) : null, meter: bar?.meter ?? null, meterConfidence: bar?.confidence ?? 0,
      confidence: +mean(beats.map((t) => near(beatAct, t))).toFixed(3), steady: +steady.toFixed(3), pulse: +pulse.toFixed(3),
      beats: beats.map((t) => Math.round(t * 1000)), downbeats: downbeats.map((t) => Math.round(t * 1000)),
      tempo: bar && bars.length ? bars.map(({ start, end }) => {
        const n = beats.filter((t) => t >= start - 1e-6 && t < end - 1e-6).length;
        return +((60 * n) / (end - start)).toFixed(1);
      }) : [],
    } : null,
    onsets, sections, drops: drops.map((t) => +t.toFixed(3)), builds,
    key: mix?.key ?? null,
    loudness: { lufs: mix?.lufs ?? null, lra: +L.lra.toFixed(1), peakDb: +peakDb.toFixed(2), plr: mix ? +(peakDb - mix.lufs).toFixed(1) : null },
    energy: mix?.energy ?? null, brightness: Math.round(median(Array.from(S.brightness).filter((_, f) => L.loudness[f] > body - 20))),
    voice: +voiced(0, T).toFixed(2),
    shape: mix ? { intro: +barLen(mix.intro).toFixed(2), outro: mix.outro ? +barLen(mix.outro).toFixed(2) : null, fade: mix.fade?.start ?? null, cold: mix.cold } : null,
  };
  const n = bars.length && st.ssm.length ? bars.length : 0;
  const frames = encode([
    { name: 'rms', fps: FPS, width: 1, data: L.rms, unit: 'dBFS' },
    { name: 'loudness', fps: FPS, width: 1, data: L.loudness, unit: 'LUFS (400 ms)' },
    { name: 'low', fps: FPS, width: 1, data: S.low, unit: 'dB, under 150 Hz' },
    { name: 'mid', fps: FPS, width: 1, data: S.mid, unit: 'dB, 150-4000 Hz' },
    { name: 'high', fps: FPS, width: 1, data: S.high, unit: 'dB, over 4 kHz' },
    { name: 'onset', fps: FPS, width: 1, data: S.onset, unit: 'log-mel flux' },
    { name: 'kick', fps: FPS, width: 1, data: S.kick, unit: 'log-mel flux under 150 Hz' },
    { name: 'brightness', fps: FPS, width: 1, data: S.brightness, unit: 'Hz (spectral centroid)' },
    { name: 'rolloff', fps: FPS, width: 1, data: S.rolloff, unit: 'Hz (85% of the energy)' },
    { name: 'flatness', fps: FPS, width: 1, data: S.flatness, unit: '0 tonal .. 1 noise' },
    { name: 'zcr', fps: FPS, width: 1, data: L.zcr, unit: 'Hz' },
    { name: 'width', fps: FPS, width: 1, data: L.width, unit: '0 mono .. 1 wide' },
    { name: 'balance', fps: FPS, width: 1, data: L.balance, unit: '-1 left .. 1 right' },
    { name: 'beat', fps: FPS, width: 1, data: beatAct, unit: 'probability (Beat This!)' },
    { name: 'downbeat', fps: FPS, width: 1, data: downAct, unit: 'probability (Beat This!)' },
    { name: 'voice', fps: FPS, width: 1, data: S.voice, unit: 'dB, tonal 300-3400 Hz' },
    { name: 'harmony', fps: FPS, width: 1, data: harmony, unit: 'chroma change over 1 s' },
    { name: 'mel', fps: FPS / 2, width: 64, data: halve(mel64, 64), unit: 'log mel, 30 Hz-11 kHz' },
    { name: 'chroma', fps: FPS / 2, width: 12, data: chroma, unit: 'C..B, 1 = the frame’s strongest' },
    { name: 'mfcc', fps: FPS / 2, width: 13, data: mfcc, unit: 'MFCC 0-12' },
    { name: 'ssm', fps: 0, width: n, data: n ? st.ssm : new Float32Array(0), unit: 'bar-by-bar similarity' },
  ], { bars: n ? bars.map((b) => Math.round(b.start * 1000)) : [] });
  return { summary, frames };
}

// ---------- the Worker ----------
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  const queue = []; // stage 2 jobs, oldest first
  const cancelled = new Set();
  let running = false;
  async function drain() {
    if (running) return;
    running = true;
    while (queue.length) {
      const job = queue.shift();
      if (cancelled.delete(job.id)) continue;
      let summary = null, frames = null, error = null;
      try {
        let rhythm = null;
        const S = spectrum(job.left, job.right); // Beat This!'s log-mel, and the rest of the spectrum's measures
        try { rhythm = await beatThis(S.mel, S.T, () => cancelled.has(job.id)); } catch (err) { console.warn('Song Features: no rhythm model -', err.message || err); }
        if (cancelled.delete(job.id)) continue;
        ({ summary, frames } = describe(job.left, job.right, job.mix, job.sp, rhythm, S));
      } catch (err) { error = String(err.message || err); console.error('Song Features:', err); }
      self.postMessage({ id: job.id, stage: 'features', summary, frames, error }, frames ? [frames] : []);
    }
    running = false;
  }
  self.onmessage = ({ data }) => {
    if (data.cancel) { cancelled.add(data.cancel); return; }
    const { id, left, right, sr, features } = data;
    let mix = null, sp = null;
    if (sr !== SR) { self.postMessage({ id, stage: 'mix', mix: null }); return; }
    try {
      const keep = {};
      mix = M.analyze(left, right, sr, keep);
      sp = keep.sp;
    } catch (err) { console.error('Auto Mix analysis:', err); }
    self.postMessage({ id, stage: 'mix', mix });
    if (features) { queue.push({ id, left, right, mix, sp }); drain(); }
  };
}
if (typeof module === 'object') {
  module.exports = { spectrum, levels, melFilters, chunkStarts, chunkAt, aggregate, peaks, beatsFrom, meter, barsOf, structure,
    encode, halve, describe, FEATURES_VERSION, SR, FPS, NMEL };
}
})();
