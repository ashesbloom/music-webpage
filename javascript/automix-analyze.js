// ACRUX Auto Mix, the listening half: hears a song once and describes it for mixing (automix.js plans from this).
// It finds the loudness, where the music starts and ends, the tempo and every beat, the bars and 8-bar phrases, the
// key, which bars are full and busy (a voice or a lead), and where the intro ends and the outro starts.
// deck-audio.js runs it as a Worker on the song resampled to 22 050 Hz; node --test loads it as a module.
// Why each step is done this way: docs/superpowers/specs/2026-09-28-auto-mix-design.md.
const VERSION = 1;
const N = 2048;  // STFT frame: 93 ms at 22 050 Hz
const H = 512;   // its hop: 23 ms, 43 frames a second
const TEMPERLEY = { // key profiles (Temperley, Kostka-Payne), C first
  major: [0.748, 0.060, 0.488, 0.082, 0.670, 0.460, 0.096, 0.715, 0.104, 0.366, 0.057, 0.400],
  minor: [0.712, 0.084, 0.474, 0.618, 0.049, 0.460, 0.105, 0.747, 0.404, 0.067, 0.133, 0.330],
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const zscore = (a) => {
  const m = mean(a), sd = Math.sqrt(mean(a.map((v) => (v - m) ** 2))) || 1;
  return a.map((v) => (v - m) / sd);
};
// The median of the louder half: a song's usual level once it's going ("the body").
const body = (db) => median([...db].sort((x, y) => x - y).slice(db.length >> 1));

// In-place radix-2 FFT of n complex values (re, im).
function makeFft(n) {
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  return (re, im) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const tr = re[b] * cos[k] + im[b] * sin[k];
          const ti = im[b] * cos[k] - re[b] * sin[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  };
}

// A biquad's coefficients, normalised by a0.
const norm = (b0, b1, b2, a0, a1, a2) => [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];

// BS.1770 K-weighting for any sample rate: a +4 dB shelf above about 1.7 kHz (the head), then a 38 Hz high-pass.
function kWeighting(sr) {
  let Q = 0.7071752369554193, fc = 1681.974450955533;
  const A = 10 ** (3.99984385397 / 40);
  let w = 2 * Math.PI * fc / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Q), sq = 2 * Math.sqrt(A) * al;
  const shelf = norm(A * ((A + 1) + (A - 1) * c + sq), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sq),
    (A + 1) - (A - 1) * c + sq, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sq);
  Q = 0.5003270373253953; fc = 38.13547087613982;
  w = 2 * Math.PI * fc / sr; c = Math.cos(w); al = Math.sin(w) / (2 * Q);
  const hp = norm((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
  return [shelf, hp];
}

// Integrated loudness in LUFS (BS.1770-4): K-weighted, 400 ms blocks every 100 ms, gated at -70 LUFS and 10 LU under.
function loudness(left, right, sr) {
  const seg = Math.round(sr * 0.1);
  const n = Math.floor(left.length / seg);
  const z = new Float64Array(n); // per 100 ms: the K-weighted mean square, channels summed
  for (const ch of [left, right]) {
    const filters = kWeighting(sr).map((k) => ({ k, x1: 0, x2: 0, y1: 0, y2: 0 }));
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let i = j * seg; i < (j + 1) * seg; i++) {
        let v = ch[i];
        for (const f of filters) {
          const [b0, b1, b2, a1, a2] = f.k;
          const y = b0 * v + b1 * f.x1 + b2 * f.x2 - a1 * f.y1 - a2 * f.y2;
          f.x2 = f.x1; f.x1 = v; f.y2 = f.y1; f.y1 = y;
          v = y;
        }
        sum += v * v;
      }
      z[j] += sum / seg;
    }
  }
  const blocks = [];
  for (let j = 0; j + 4 <= n; j++) blocks.push((z[j] + z[j + 1] + z[j + 2] + z[j + 3]) / 4);
  const lufs = (ms) => -0.691 + 10 * Math.log10(ms || 1e-12);
  const heard = blocks.filter((b) => lufs(b) > -70);
  if (!heard.length) return -70;
  const gate = lufs(mean(heard)) - 10;
  return lufs(mean(heard.filter((b) => lufs(b) > gate)));
}

// Levels every 50 ms: where the music starts and ends (above -50 dBFS), and each second's level for fades.
// A silence of 20 s or more in the second half (a hidden track after it) ends the music there.
function levels(x, sr) {
  const w = Math.round(sr * 0.05);
  const n = Math.floor(x.length / w);
  const db = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = j * w; i < (j + 1) * w; i++) s += x[i] * x[i];
    db[j] = 10 * Math.log10(s / w + 1e-12);
  }
  const loud = (j) => db[j] > -50;
  let first = 0;
  while (first < n && !loud(first)) first++;
  if (first === n) return { start: 0, end: x.length / sr, seconds: [] }; // silence
  let last = n - 1;
  while (last > first && !loud(last)) last--;
  for (let j = Math.floor(n / 2), run = 0; j <= last; j++) {
    if (loud(j)) run = 0;
    else if (++run * 0.05 >= 20) { last = j - run; break; }
  }
  const seconds = [];
  for (let j = 0; j + 20 <= n; j += 20) {
    let p = 0;
    for (let k = j; k < j + 20; k++) p += 10 ** (db[k] / 10);
    seconds.push(10 * Math.log10(p / 20));
  }
  return { start: first * 0.05, end: Math.min((last + 1) * 0.05, x.length / sr), seconds };
}

// The short-time spectrum, frame by frame (Hann, N, hop H), reduced to what mixing needs: the onset strength (log
// spectral flux over 40 bands, 30 Hz-8 kHz), the kick's (30-150 Hz), energy below 150 Hz / to 4 kHz / above, how
// noise-like the voice band is (spectral flatness, 300-3400 Hz) and the 12 pitch classes (180 Hz-5 kHz).
// Two real frames go through one complex FFT.
function spectra(x, sr) {
  const count = x.length >= N ? Math.floor((x.length - N) / H) + 1 : 0;
  const out = {
    count, fps: sr / H, time: (f) => (f * H + N / 2) / sr, frame: (t) => clamp(Math.round((t * sr - N / 2) / H), 0, Math.max(count - 1, 0)),
    flux: new Float32Array(count), kick: new Float32Array(count), low: new Float32Array(count), mid: new Float32Array(count),
    high: new Float32Array(count), flat: new Float32Array(count), chroma: new Float32Array(count * 12),
  };
  const bins = N / 2 + 1;
  const hz = (k) => k * sr / N;
  const band = new Int8Array(bins).fill(-1), pc = new Int8Array(bins).fill(-1), share = new Float32Array(bins);
  for (let k = 1; k < bins; k++) {
    const f = hz(k);
    if (f >= 30 && f < 8000) band[k] = Math.floor(40 * Math.log(f / 30) / Math.log(8000 / 30));
    if (f >= 180 && f < 5000) { // a bin is shared between the two nearest semitones; below 180 Hz a bin spans several
      const p = 12 * Math.log2(f / 440) + 69;
      pc[k] = ((Math.floor(p) % 12) + 12) % 12;
      share[k] = 1 - (p - Math.floor(p));
    }
  }
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  const fft = makeFft(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const pow = [new Float64Array(bins), new Float64Array(bins)];
  let prevBands = null, prevKick = 0;
  const bands = new Float64Array(40);
  const take = (f, p) => {
    bands.fill(0);
    let kick = 0, low = 0, mid = 0, high = 0, logSum = 0, sum = 0, nFlat = 0;
    const ch = out.chroma.subarray(f * 12, f * 12 + 12);
    for (let k = 1; k < bins; k++) {
      const v = p[k], f0 = hz(k);
      if (band[k] >= 0) bands[band[k]] += v;
      if (f0 < 150) { low += v; if (f0 >= 30) kick += v; } else if (f0 < 4000) mid += v; else high += v;
      if (f0 >= 300 && f0 < 3400) { logSum += Math.log(v + 1e-9); sum += v + 1e-9; nFlat++; }
      if (pc[k] >= 0) { const m = Math.sqrt(v); ch[pc[k]] += m * share[k]; ch[(pc[k] + 1) % 12] += m * (1 - share[k]); }
    }
    let flux = 0;
    for (let b = 0; b < 40; b++) {
      const l = Math.log(1 + bands[b]);
      if (prevBands) flux += Math.max(0, l - prevBands[b]);
      bands[b] = l;
    }
    prevBands = prevBands || new Float64Array(40);
    prevBands.set(bands);
    const lk = Math.log(1 + kick);
    out.flux[f] = flux / 40;
    out.kick[f] = f ? Math.max(0, lk - prevKick) : 0;
    prevKick = lk;
    out.low[f] = low; out.mid[f] = mid; out.high[f] = high;
    out.flat[f] = Math.min(1, Math.exp(logSum / nFlat) / (sum / nFlat));
  };
  for (let f = 0; f < count; f += 2) {
    const two = f + 1 < count;
    for (let i = 0; i < N; i++) {
      re[i] = x[f * H + i] * win[i];
      im[i] = two ? x[(f + 1) * H + i] * win[i] : 0;
    }
    fft(re, im);
    for (let k = 0; k < bins; k++) { // untangle the two real spectra: X = (Z[k] + Z*[N-k]) / 2, Y = (Z[k] - Z*[N-k]) / 2j
      const j = (N - k) % N;
      const xr = (re[k] + re[j]) / 2, xi = (im[k] - im[j]) / 2;
      const yr = (im[k] + im[j]) / 2, yi = (re[j] - re[k]) / 2;
      pow[0][k] = xr * xr + xi * xi;
      pow[1][k] = yr * yr + yi * yi;
    }
    take(f, pow[0]);
    if (two) take(f + 1, pow[1]);
  }
  return out;
}

// The tempo: autocorrelation of the onset strength over 60-200 BPM, weighted towards 120 BPM (a log-normal prior of
// one octave, as librosa does) and refined between lags.
// The onsets are first taken relative to their own last second, so slow swells (a pad fading in and out) don't
// count as rhythm.
function tempo(flux, fps) {
  const n = flux.length;
  const reach = Math.round(fps / 2);
  const sum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sum[i + 1] = sum[i] + flux[i];
  const o = Float64Array.from(flux, (v, i) => {
    const a = Math.max(0, i - reach), b = Math.min(n, i + reach + 1);
    return v - (sum[b] - sum[a]) / (b - a);
  });
  const ac = (l) => { let s = 0; for (let i = 0; i + l < n; i++) s += o[i] * o[i + l]; return s / (n - l); };
  const lo = Math.floor(60 * fps / 200), hi = Math.ceil(60 * fps / 60);
  if (n < hi * 4) return 0;
  const acs = new Float64Array(hi + 2);
  for (let l = lo - 1; l <= hi + 1; l++) acs[l] = ac(l);
  let best = lo, score = -Infinity;
  for (let l = lo; l <= hi; l++) {
    const s = acs[l] * Math.exp(-0.5 * Math.log2(60 * fps / l / 120) ** 2);
    if (s > score) { score = s; best = l; }
  }
  const [y0, y1, y2] = [acs[best - 1], acs[best], acs[best + 1]];
  const bend = y0 - 2 * y1 + y2;
  const lag = best + (bend < 0 ? clamp(0.5 * (y0 - y2) / bend, -0.5, 0.5) : 0);
  return 60 * fps / lag;
}

// Beats by dynamic programming (Ellis 2007, as librosa's beat_track): the path through the onsets that best keeps a
// steady period. Returns frame indexes.
function track(flux, period, tightness = 100) {
  const n = flux.length;
  const sd = Math.sqrt(mean(Array.from(flux, (v) => v * v))) || 1;
  const reach = Math.round(period);
  const win = Array.from({ length: 2 * reach + 1 }, (_, i) => Math.exp(-0.5 * ((i - reach) * 32 / period) ** 2));
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -reach; j <= reach; j++) if (i + j >= 0 && i + j < n) s += flux[i + j] / sd * win[j + reach];
    local[i] = s;
  }
  const top = Math.max(...local);
  const cum = new Float64Array(n), back = new Int32Array(n).fill(-1);
  const from = Math.round(2 * period), to = Math.round(period / 2);
  let first = true;
  for (let i = 0; i < n; i++) {
    let best = -Infinity, arg = -1;
    for (let j = i - from; j <= i - to; j++) {
      const s = (j >= 0 ? cum[j] : 0) - tightness * Math.log((i - j) / period) ** 2;
      if (s > best) { best = s; arg = j; }
    }
    cum[i] = local[i] + best;
    if (first && local[i] < 0.01 * top) back[i] = -1;
    else { back[i] = arg; first = false; }
  }
  const peaks = [];
  for (let i = 1; i < n - 1; i++) if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1]) peaks.push(i);
  if (!peaks.length) return [];
  const med = median(peaks.map((i) => cum[i]));
  let last = peaks[0];
  for (const i of peaks) if (cum[i] >= 0.5 * med) last = i;
  const beats = [];
  for (let b = last; b >= 0; b = back[b]) beats.push(b);
  beats.reverse();
  const strong = 0.5 * Math.sqrt(mean(beats.map((b) => local[b] ** 2)));
  while (beats.length && local[beats[0]] < strong) beats.shift();
  while (beats.length && local[beats.at(-1)] < strong) beats.pop();
  return beats;
}

// Is there a beat to mix on? Three things a groove has that speech, rubato piano and ambient music don't: onsets of
// some strength on the beats (median 0.05 or more, the song at RMS 0.1; a held pad scores 0.004), most beats (65%) on
// an onset over twice the song's typical one, and beats that keep time locally (16 at a time on a line within 16 ms,
// the median). Tried on house, techno, disco, rock, live rock, metal, jazz, reggae, folk and hip-hop (a beat) against
// ambient, a Chopin prelude, an acoustic ballad and speech (none).
function groove(frames, sp, bpm) {
  const on = frames.map((f) => Math.max(sp.flux[f - 1] || 0, sp.flux[f] || 0, sp.flux[f + 1] || 0));
  const typical = median(Array.from(sp.flux));
  if (median(on) < 0.05 || on.filter((v) => v > 2 * typical).length / on.length < 0.65) return false;
  const times = frames.map((f) => sp.time(f)), local = [];
  for (let k = 0; k + 16 <= times.length; k += 8) local.push(fit(times.slice(k, k + 16), 60 / bpm).rms);
  return median(local) <= 0.016;
}

// Beats that don't keep strict time (a live drummer, a tempo change) are each put on a line through the 8 beats either
// side (dropping any over 40 ms off it): the tracker's 23 ms steps even out and the tempo can still move.
// loose: the beats more than 25 ms off their neighbours' line, where the tracker lost the beat.
function smooth(times, period) {
  const beats = [], loose = [];
  for (let k = 0; k < times.length; k++) {
    const a = Math.max(0, k - 8), b = Math.min(times.length, k + 9);
    const g = fit(times.slice(a, b), period);
    const i = Math.round(g.idx[k - a]);
    beats.push(g.t0 + g.period * i);
    loose.push(Math.abs(times[k] - beats[k]) > 0.025);
  }
  return { beats, loose };
}

// A straight line through the beats (least squares, dropping any over 40 ms off, three times): an exact grid when
// the song keeps strict time (a click track, a drum machine).
function fit(times, period) {
  const idx = [0];
  for (let k = 1; k < times.length; k++) idx.push(idx[k - 1] + Math.max(1, Math.round((times[k] - times[k - 1]) / period)));
  let use = times.map(() => true), t0 = times[0], p = period;
  for (let round = 0; round < 4; round++) {
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    times.forEach((t, k) => { if (use[k]) { n++; sx += idx[k]; sy += t; sxx += idx[k] ** 2; sxy += idx[k] * t; } });
    if (n < 2) break;
    p = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    t0 = (sy - p * sx) / n;
    use = times.map((t, k) => Math.abs(t - (t0 + p * idx[k])) < 0.04);
  }
  const res = [];
  times.forEach((t, k) => { if (use[k]) res.push(t - (t0 + p * idx[k])); });
  return { t0, period: p, idx, rms: Math.sqrt(mean(res.map((r) => r * r))), inliers: use.filter(Boolean).length / times.length };
}

// Which beat of four starts the bar: the one with the strongest kick, the biggest change of chord and the biggest
// change of level (sections start on a downbeat). Its lead over the next best phase is how sure it is.
function downbeat(beats, sp) {
  const m = beats.length;
  if (m < 16) return { phase: 0, conf: 0 };
  const f = beats.map((t) => sp.frame(t));
  const span = (a, b, fn) => { const v = []; for (let x = a; x < Math.max(b, a + 1); x++) v.push(fn(x)); return v; };
  const chromaOf = (a, b) => {
    const c = new Float64Array(12);
    for (let x = a; x < Math.max(b, a + 1); x++) for (let k = 0; k < 12; k++) c[k] += sp.chroma[x * 12 + k];
    return c;
  };
  const cosine = (u, v) => {
    let d = 0, a = 0, b = 0;
    for (let k = 0; k < 12; k++) { d += u[k] * v[k]; a += u[k] ** 2; b += v[k] ** 2; }
    return a && b ? d / Math.sqrt(a * b) : 1;
  };
  const level = (a, b) => 10 * Math.log10(mean(span(a, b, (x) => sp.low[x] + sp.mid[x] + sp.high[x])) + 1e-12);
  const kick = [], chord = [], jump = [];
  for (let i = 0; i < m; i++) {
    kick.push(Math.max(...span(Math.max(f[i] - 2, 0), Math.min(f[i] + 3, sp.count), (x) => sp.kick[x])));
    const prev = f[Math.max(i - 1, 0)], next = f[Math.min(i + 1, m - 1)];
    chord.push(i > 0 && i < m - 1 ? 1 - cosine(chromaOf(prev, f[i]), chromaOf(f[i], next)) : 0);
    const a = f[Math.max(i - 4, 0)], b = f[Math.min(i + 4, m - 1)];
    jump.push(i >= 4 && i < m - 4 ? Math.abs(level(f[i], b) - level(a, f[i])) : 0);
  }
  const [zk, zc, zj] = [zscore(kick), zscore(chord), zscore(jump)];
  const score = [0, 1, 2, 3].map((ph) => {
    const v = [];
    for (let i = ph; i < m; i += 4) v.push(zk[i] + zc[i] + zj[i]);
    return mean(v);
  });
  const order = [0, 1, 2, 3].sort((a, b) => score[b] - score[a]);
  return { phase: order[0], conf: score[order[0]] - score[order[1]] };
}

// The key: pitch classes summed over the tonal frames, correlated with the 24 Temperley profiles.
function key(sp, from, to) {
  const acc = new Float64Array(12);
  for (let f = from; f < to; f++) {
    let s = 0;
    for (let k = 0; k < 12; k++) s += sp.chroma[f * 12 + k];
    if (!s) continue;
    const w = 1 - sp.flat[f];
    for (let k = 0; k < 12; k++) acc[k] += w * sp.chroma[f * 12 + k] / s;
  }
  const pearson = (u, v) => {
    const mu = mean(u), mv = mean(v);
    let d = 0, a = 0, b = 0;
    for (let k = 0; k < 12; k++) { d += (u[k] - mu) * (v[k] - mv); a += (u[k] - mu) ** 2; b += (v[k] - mv) ** 2; }
    return a && b ? d / Math.sqrt(a * b) : 0;
  };
  const all = [];
  for (const minor of [false, true]) {
    const p = TEMPERLEY[minor ? 'minor' : 'major'];
    for (let pc = 0; pc < 12; pc++) all.push({ pc, minor, r: pearson(Array.from(acc), p.map((_, k) => p[(k - pc + 12) % 12])) });
  }
  all.sort((a, b) => b.r - a.r);
  // A key and its relative (C major, A minor) share their notes and often score alike; either mixes the same (the
  // same Camelot number), so how sure it is is measured against the best key with another number.
  const [best] = all, number = (k) => camelot(k.pc, k.minor).slice(0, -1);
  const rival = all.find((k) => number(k) !== number(best));
  if (best.r < 0.5 || best.r - rival.r < 0.03) return null;
  return { pc: best.pc, minor: best.minor, camelot: camelot(best.pc, best.minor), conf: +(best.r - rival.r).toFixed(3) };
}

// Camelot wheel code: C major is 8B, A minor 8A; one step round the wheel is a fifth.
function camelot(pc, minor) {
  const major = minor ? (pc + 3) % 12 : pc;
  return `${((major * 7) % 12 + 7) % 12 + 1}${minor ? 'A' : 'B'}`;
}

// keep: an object that gets the spectrum (keep.sp), for Song Features' key per section (features-worker.js).
function analyze(left, right, sr, keep) {
  const len = left.length;
  const mono = new Float32Array(len);
  let peak = 0;
  for (let i = 0; i < len; i++) {
    mono[i] = (left[i] + right[i]) / 2;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const lufs = loudness(left, right, sr);
  const { start, end, seconds } = levels(mono, sr);
  let power = 0, heard = 0; // the spectrum is taken with the song at RMS 0.1, so onset strengths compare across songs
  for (let i = Math.floor(start * sr); i < Math.floor(end * sr); i++) { power += mono[i] * mono[i]; heard++; }
  const gain = 0.1 / (Math.sqrt(power / (heard || 1)) || 1);
  const sp = spectra(mono.map((v) => v * gain), sr);
  if (keep) keep.sp = sp;
  const rough = tempo(sp.flux, sp.fps);
  const result = {
    v: VERSION, dur: len / sr, start: +start.toFixed(3), end: +end.toFixed(3), lufs: +lufs.toFixed(2),
    peakDb: +(20 * Math.log10(peak || 1e-9) + 0.5).toFixed(2), bpm: 0, beat: false, steady: false, grid: null, beats: null,
    downbeat: 0, downbeatConf: 0, phraseOffset: 0, key: key(sp, sp.frame(start), sp.frame(end)), nbars: 0,
    bars: { energy: [], busy: [], loose: [] }, intro: 0, outro: 0, fade: null, cold: false, startDb: 0, endDb: 0, energy: 0,
  };

  // Levels at the start and end, a fade-out (each of the last four 5 s stretches 2 dB or more under the one before,
  // 9 dB down in all: a step down to a quiet outro isn't one) and a cold ending (within 6 dB of the song's level in
  // its last 2 s).
  const sec = seconds.slice(Math.floor(start), Math.ceil(end));
  const level = body(sec);
  const first = Math.floor(start), last = Math.max(Math.ceil(end) - 1, first);
  result.startDb = +(mean(seconds.slice(first, first + 2)) - level).toFixed(1);
  result.endDb = +(mean(seconds.slice(Math.max(last - 1, first), last + 1)) - level).toFixed(1);
  result.cold = result.endDb >= -6;
  if (last - first >= 40) {
    const steps = [3, 2, 1, 0].map((k) => mean(seconds.slice(last + 1 - 5 * (k + 1), last + 1 - 5 * k)));
    if (steps.every((v, i) => !i || v <= steps[i - 1] - 2) && steps[0] - steps[3] >= 9) {
      let at = last;
      while (at > first && seconds[at] < level - 3) at--;
      result.fade = { start: at + 1 };
    }
  }

  // Energy for ordering songs: loudness and how many onsets it has.
  const fm = mean(sp.flux), fsd = Math.sqrt(mean(Array.from(sp.flux, (v) => (v - fm) ** 2)));
  const density = Array.from(sp.flux).filter((v) => v > fm + fsd).length / (sp.count || 1);
  result.energy = +(0.6 * clamp((lufs + 24) / 16, 0, 1) + 0.4 * clamp(density / 0.25, 0, 1)).toFixed(3);

  if (!rough) return result;

  // Beats: tracked, then an exact grid if they keep strict time (a line through all of them within 14 ms RMS), else
  // smoothed one by one.
  const frames = track(sp.flux, 60 / rough * sp.fps);
  if (frames.length < 16 || !groove(frames, sp, rough)) return result;
  const times = frames.map((f) => sp.time(f));
  const g = fit(times, 60 / rough);
  result.beat = true;
  result.steady = g.rms < 0.014 && g.inliers >= 0.85;
  result.bpm = +(60 / g.period).toFixed(3);
  let beats, loose = null;
  if (result.steady) {
    const t0 = g.t0 - Math.floor((g.t0 + 0.05) / g.period) * g.period; // the first beat (the tracker runs ~16 ms early)
    result.grid = { t0: +t0.toFixed(5), period: +g.period.toFixed(6) };
    beats = Array.from({ length: Math.floor((result.dur - t0) / g.period) + 1 }, (_, i) => t0 + i * g.period);
  } else {
    ({ beats, loose } = smooth(times, 60 / rough));
    result.bpm = +(60 / median(beats.slice(1).map((t, k) => t - beats[k]))).toFixed(3);
    result.beats = beats.map((t) => Math.round(t * 1000));
  }

  // Bars from the downbeat on, while they end with the music.
  const db = downbeat(beats, sp);
  result.downbeat = db.phase;
  result.downbeatConf = +db.conf.toFixed(3);
  const bars = [];
  for (let j = 0; db.phase + 4 * j + 4 < beats.length; j++) {
    const from = beats[db.phase + 4 * j], to = beats[db.phase + 4 * j + 4];
    if (to > end + (to - from) / 4) break; // the last beat may die away before its bar line
    bars.push({ from: sp.frame(from), to: sp.frame(to), loose: loose ? loose.slice(db.phase + 4 * j, db.phase + 4 * j + 4).some(Boolean) : false });
  }
  result.nbars = bars.length;
  if (bars.length < 8) return result;

  // Each bar: its level, bass, band levels, onsets, chord, and how busy its voice band is (tonal energy 300-3400 Hz).
  const feats = bars.map(({ from, to }) => {
    const fr = [];
    for (let f = from; f < Math.max(to, from + 1); f++) fr.push(f);
    const chroma = new Float64Array(12);
    for (const f of fr) for (let k = 0; k < 12; k++) chroma[k] += sp.chroma[f * 12 + k];
    const cn = Math.sqrt(chroma.reduce((s, v) => s + v * v, 0)) || 1;
    const dB = (a) => 10 * Math.log10(mean(a) + 1e-12);
    return {
      energy: dB(fr.map((f) => sp.low[f] + sp.mid[f] + sp.high[f])),
      low: dB(fr.map((f) => sp.low[f])), mid: dB(fr.map((f) => sp.mid[f])), high: dB(fr.map((f) => sp.high[f])),
      onsets: mean(fr.map((f) => sp.flux[f])), busy: dB(fr.map((f) => sp.mid[f] * (1 - sp.flat[f]))),
      chroma: Array.from(chroma, (v) => v / cn),
    };
  });
  const level2 = body(feats.map((b) => b.energy));
  const rel = feats.map((b) => b.energy - level2);
  const loudBars = feats.filter((_, j) => rel[j] >= -3);
  const lowRef = median(loudBars.map((b) => b.low));
  const busyRef = body(feats.map((b) => b.busy)); // busy: within 4 dB of the song's usual busiest
  const busy = feats.map((b) => (b.busy >= busyRef - 4 ? 1 : 0));
  result.bars = { energy: rel.map((v) => Math.round(v) || 0), busy, loose: bars.map((b) => (b.loose ? 1 : 0)) };

  // Section boundaries: how different the 4 bars after each bar line are from the 4 before (Foote-style novelty on
  // z-scored levels and the chord). The 8-bar phrase lines fall where the novelty is highest.
  const zs = ['low', 'mid', 'high', 'onsets'].map((k) => zscore(feats.map((b) => b[k])));
  const vec = feats.map((b, j) => [...zs.map((z) => z[j]), ...b.chroma.map((v) => 2 * v)]);
  const avg = (a, b) => {
    const v = new Array(vec[0].length).fill(0);
    for (let j = a; j < b; j++) vec[j].forEach((x, k) => { v[k] += x / (b - a); });
    return v;
  };
  const nov = feats.map((_, j) => {
    const w = Math.min(4, j, feats.length - j);
    if (w < 1) return 0;
    const u = avg(j - w, j), v = avg(j, j + w);
    return Math.sqrt(u.reduce((s, x, k) => s + (x - v[k]) ** 2, 0));
  });
  const phase = [0, 1, 2, 3, 4, 5, 6, 7].map((o) => nov.reduce((s, v, j) => s + ((j - o) % 8 === 0 ? v : 0), 0));
  const offset = phase.indexOf(Math.max(...phase));
  result.phraseOffset = offset;
  const nm = mean(nov), nsd = Math.sqrt(mean(nov.map((v) => (v - nm) ** 2)));
  const lines = new Set();
  nov.forEach((v, j) => {
    if (j < 1 || v < nm + 0.5 * nsd) return;
    for (let d = -2; d <= 2; d++) if (nov[j + d] > v) return;
    const down = j - ((((j - offset) % 4) + 4) % 4); // sections start on a 4-bar line: the nearest one
    const line = j - down >= 2 ? down + 4 : down;
    if (line > 0 && line < feats.length) lines.add(line);
  });
  const boundaries = [...lines].sort((a, b) => a - b);

  // The core: bars at the song's level with its voice or lead going (every loud bar, if nothing is ever busy).
  // The intro ends where the section holding the first core bar starts; the outro starts at the first boundary (or
  // 4-bar line) after the last one.
  const anyBusy = busy.some((b, j) => b && rel[j] >= -3);
  const core = feats.map((b, j) => rel[j] >= -3 && b.low >= lowRef - 8 && (busy[j] === 1 || !anyBusy));
  const firstCore = core.indexOf(true), lastCore = core.lastIndexOf(true);
  if (firstCore < 0) return result;
  const line4 = (j) => j - ((((j - offset) % 4) + 4) % 4);
  const before = boundaries.filter((j) => j <= firstCore);
  result.intro = before.length ? before.at(-1) : Math.max(0, line4(firstCore));
  const after = boundaries.find((j) => j > lastCore);
  const up4 = line4(lastCore + 1) === lastCore + 1 ? lastCore + 1 : line4(lastCore + 1) + 4;
  result.outro = Math.min(after ?? feats.length, up4 <= feats.length ? up4 : feats.length);
  return result;
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = ({ data: { id, left, right, sr } }) => {
    let analysis = null;
    try { analysis = analyze(left, right, sr); } catch (err) { console.error('Auto Mix analysis:', err); }
    self.postMessage({ id, analysis });
  };
}
if (typeof module === 'object') module.exports = { analyze, loudness, levels, spectra, tempo, track, fit, downbeat, key, camelot, makeFft, kWeighting, groove, smooth, VERSION };
