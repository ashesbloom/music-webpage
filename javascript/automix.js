// ACRUX Auto Mix, the DJ half: from two songs' analyses (automix-analyze.js) it decides how one hands over to the next
// and exactly when: a beat-matched EQ blend on the phrase, a cut on the downbeat, an echo out, a filter sweep, a fade,
// a segue, or gapless for an album. It also ranks songs for Infinite (score, chain). Pure: the page loads it as a
// script (AUTOMIX) and node --test requires it. The craft behind every rule: docs/superpowers/specs/2026-09-28-auto-mix-design.md.
(() => {
  const BARS = [32, 16, 8, 4]; // blend lengths, longest first
  const TARGET = -14;          // the LUFS every song is levelled to while Auto Mix is on (Spotify's default)

  // Beats: the steady grid, or the listed ones, in seconds.
  function beatList(a) {
    if (a.grid) {
      const { t0, period } = a.grid;
      return Array.from({ length: Math.floor((a.dur - t0) / period) + 1 }, (_, i) => t0 + i * period);
    }
    return (a.beats || []).map((ms) => ms / 1000);
  }
  // The time of beat i (fractional), carried on past either end at the nearest spacing.
  function timeAt(beats, i) {
    const n = beats.length;
    if (i <= 0) return beats[0] + i * (beats[1] - beats[0]);
    if (i >= n - 1) return beats[n - 1] + (i - n + 1) * (beats[n - 1] - beats[n - 2]);
    const k = Math.floor(i);
    return beats[k] + (i - k) * (beats[k + 1] - beats[k]);
  }

  // Camelot: "8B" is C major, "8A" A minor; one number round the wheel is a fifth, and a semitone up is 7 numbers on.
  const parse = (code) => { const m = /^(\d{1,2})([AB])$/.exec(code || ''); return m ? [Number(m[1]), m[2]] : null; };
  const shift = (code, semitones) => {
    const k = parse(code);
    return k ? `${((k[0] - 1 + 7 * semitones) % 12 + 12) % 12 + 1}${k[1]}` : code;
  };
  // How well two keys sit together: 1 the same, 0.9 a step round the wheel or the relative major/minor, 0.6 two steps
  // (the "energy boost") or a diagonal, 0.1 a clash, 0.7 when either key is unknown.
  function harmony(x, y) {
    const a = parse(x), b = parse(y);
    if (!a || !b) return 0.7;
    const d = Math.min(Math.abs(a[0] - b[0]), 12 - Math.abs(a[0] - b[0]));
    if (a[1] === b[1]) return [1, 0.9, 0.6][d] ?? 0.1;
    return [0.9, 0.6][d] ?? 0.1;
  }

  // The tempo ratio A must play at to meet B, allowing half and double time: s = k·bpmB/bpmA, k in {1, 2, ½}.
  function match(bpmA, bpmB) {
    let best = null;
    for (const k of [1, 2, 0.5]) {
      const s = k * bpmB / bpmA;
      if (!best || Math.abs(Math.log(s)) < Math.abs(Math.log(best.s))) best = { k, s };
    }
    return best;
  }

  // The gain that brings a song to TARGET: at most 12 dB down or 6 dB up, and never so far up that its peaks pass -1 dBFS.
  function trim(a) {
    if (!a) return 1;
    const db = Math.min(Math.max(TARGET - a.lufs, -12), 6, -1 - a.peakDb);
    return 10 ** (Math.max(db, -12) / 20);
  }

  // Lanes: [t, value] points, t in seconds from B's start (negative: A's seconds before it). Curves are 8 steps.
  const steps = (t0, t1, f) => Array.from({ length: 9 }, (_, i) => [t0 + (t1 - t0) * i / 8, f(i / 8)]);
  const rise = (t0, t1) => steps(t0, t1, (x) => Math.sin(Math.PI / 2 * x));   // equal power in
  const fall = (t0, t1) => steps(t0, t1, (x) => Math.cos(Math.PI / 2 * x));   // equal power out
  const sweep = (t0, t1, f0, f1) => steps(t0, t1, (x) => f0 * (f1 / f0) ** x);

  function plan(a, b, opts = {}) {
    const base = { aOut: null, bIn: 0, pre: 0, len: 0, handover: 0, ratio: 1, k: 1, lock: false, beatA0: 0, beatB0: 0,
      lanes: { a: {}, b: {} }, echo: null, trimB: opts.gapless ? opts.trimA ?? trim(a) : trim(b) };
    const done = (p) => { Object.assign(base, p); base.summary = summary(a, b, base); return base; };
    // An album in order, or a song not analysed: B starts on the very next sample after A's last.
    if (opts.gapless || !a || !b) return done({ type: 'gapless' });
    const after = opts.after || 0; // nothing may start before this (seconds of A)
    const end = Math.max(a.end, after);
    const fade = (d, from = a.end - d) => {
      const at = Math.max(from, after);
      const len = Math.max(a.end - at, 0.5);
      return done({ type: 'fade', aOut: at, bIn: b.start, len, handover: len / 2,
        lanes: { a: { gain: fall(0, len) }, b: { gain: b.startDb < -9 ? [] : rise(0, Math.min(len, 2)) } } });
    };
    if (a.dur < 60 || b.dur < 60) return fade(2); // previews
    const segue = () => done({ type: 'segue', aOut: end, bIn: b.start, len: 0.05, lanes: { a: { gain: fall(0, 0.05) }, b: {} } });

    const A = a.beat ? beatList(a) : [], B = b.beat ? beatList(b) : [];
    const barA = (j) => timeAt(A, a.downbeat + 4 * j), barB = (j) => timeAt(B, b.downbeat + 4 * j);
    const { k, s } = a.beat && b.beat ? match(a.bpm, b.bpm) : { k: 1, s: 1 };
    const near = a.beat && b.beat && Math.abs(s - 1) <= 0.08;
    const semis = 12 * Math.log2(s);
    const h = harmony(Math.abs(semis) >= 0.5 ? shift(a.key?.camelot, Math.round(semis)) : a.key?.camelot, b.key?.camelot);
    let b0 = 0; // B's first bar with music in it
    while (b0 < b.nbars && barB(b0) < b.start - 0.05) b0++;
    const line = (j, every, offset) => ((j - offset) % every + every) % every === 0;
    const aBusy = (j) => a.bars.busy[j] === 1, bBusy = (j) => b.bars.busy[j] === 1;
    const loose = (x, j) => x.bars.loose?.[j] === 1;

    if (near) {
      const barLenB = 4 * 60 / b.bpm, beatB = barLenB / 4;
      const conf = Math.min(a.downbeatConf, b.downbeatConf);
      const cap = h < 0.6 || conf < 0.15 ? 4
        : h >= 0.9 && Math.abs(s - 1) <= 0.02 && conf >= 0.5 ? 32
        : Math.abs(s - 1) <= 0.04 && conf >= 0.5 ? 16 : 8;
      const ramp = Math.abs(s - 1) > 0.002;
      for (const L of BARS.filter((x) => x <= cap)) {
        let bj = b0; // B's cue: its first bar, or later in a long, quiet intro so its main part comes in as A leaves
        const intro = [];
        for (let j = b0; j < b.intro; j++) intro.push(j);
        if (b.intro - b0 > L && !intro.some(bBusy)) bj = b.intro - L;
        if (bj + L > b.nbars) continue;
        const preBars = ramp ? 8 : 0;
        const aBar = (m) => Math.floor(m * k); // A's bar under B's bar m of the blend (k of A's bars to one of B's)
        let aj = -1; // A's out point: the latest phrase line that lets the blend end with A's music
        for (let j = a.nbars - Math.ceil(L * k); j >= preBars; j--) {
          if (!line(j, L === 4 ? 4 : 8, a.phraseOffset)) continue;
          if (barA(j - preBars) < after) break;
          aj = j;
          break;
        }
        if (aj < 0) continue;
        // No two voices at once: busy bars in both while both are up (B past 10% of the blend, A before 95%).
        let clash = 0;
        for (let m = Math.ceil(0.1 * L); m < Math.floor(0.95 * L); m++) if (aBusy(aj + aBar(m)) && bBusy(bj + m)) clash++;
        if (clash > 1) continue;
        // Only where the beats were tracked cleanly.
        let shaky = false;
        for (let m = -preBars; m < L; m++) if (loose(a, aj + (m < 0 ? m : aBar(m))) || (m >= 0 && loose(b, bj + m))) shaky = true;
        if (shaky) continue;
        const T = L * barLenB, half = T / 2;
        const aOut = barA(aj);
        return done({ type: 'blend', bars: L, aOut, bIn: barB(bj), pre: ramp ? aOut - barA(aj - 8) : 0, len: T,
          handover: half, ratio: s, k, lock: true, beatA0: a.downbeat + 4 * aj, beatB0: b.downbeat + 4 * bj, h,
          lanes: {
            a: { gain: [[0.75 * T, 1], ...fall(0.75 * T, T)], low: [[half - beatB, 1], [half, 0]],
              mid: [[half, 1], [0.75 * T, 0.3], [T, 0]], high: [[0.6 * T, 1], [T, 0]] },
            b: { gain: rise(0, half), low: [[half - beatB, 0], [half, 1]],
              mid: h < 0.6 ? [[0, 0.2], [half, 0.2], [0.75 * T, 1]] : [[0, 0.35], [0.25 * T, 0.35], [0.75 * T, 1]],
              high: [[0, 0.25], [half, 1]] },
          } });
      }
      // No blend fits: B drops in on a downbeat. A cold ending plays out and B comes in where A's next bar would be;
      // otherwise on the last 4-bar line of A's music.
      let aj = a.nbars;
      if (!(a.cold && barA(a.nbars) - a.end <= barLenB)) while (aj > 0 && !line(aj, 4, a.phraseOffset)) aj--;
      if (barA(aj) >= after) {
        return done({ type: 'cut', aOut: barA(aj), bIn: barB(b0), len: 0.02, h,
          lanes: { a: { gain: [[0, 1], [0.015, 0]] }, b: { gain: [[0, 0], [0.003, 1]] } } });
      }
    }

    if (a.beat && b.beat && !a.cold) {
      // Tempos too far apart to match: throw A out with an echo on a phrase line in its outro (8 bars in, or the
      // end of its music), or sweep it away with a filter when B opens quietly.
      let aj = Math.min(a.outro + 8, a.nbars);
      while (aj > 0 && !line(aj, 4, a.phraseOffset)) aj--;
      const beatA = 60 / a.bpm;
      const aOut = barA(aj), bIn = barB(b0);
      const quiet = b.bars.energy.slice(b0, b0 + 4);
      if (aOut - beatA >= after) {
        if (quiet.length && quiet.reduce((x, y) => x + y, 0) / quiet.length <= -6) {
          const T = 8 * 4 * 60 / b.bpm;
          return done({ type: 'filter', aOut, bIn, len: T, handover: T / 2, h,
            lanes: { a: { hp: sweep(0, T, 20, 1500), gain: [[T / 2, 1], ...fall(T / 2, T)] },
              b: { gain: rise(0, T / 2), low: [[T / 2 - 0.05, 0], [T / 2, 1]] } } });
        }
        const barLenB = 4 * 60 / b.bpm;
        return done({ type: 'echo', aOut, bIn, pre: beatA, len: 8 * beatA, h, echo: { delay: 0.75 * beatA, feedback: 0.5 },
          lanes: { a: { echo: [[-beatA, 0], [-beatA + 0.01, 1], [0, 1], [0.01, 0]], gain: [[0, 1], [0.01, 0]] },
            b: { low: [[0, 0], [barLenB - barLenB / 4, 0], [barLenB, 1]] } } });
      }
    }
    if (a.cold) return segue();
    if (a.fade) return fade(Math.min(8, a.end - (a.fade.start + 0.3 * (a.end - a.fade.start))));
    return fade(4);
  }

  function summary(a, b, p) {
    const key = (x) => x?.key?.camelot || '?';
    return `${p.type}${p.bars ? ` ${p.bars} bars` : ''} · ${a?.bpm || '-'}→${b?.bpm || '-'} BPM${p.ratio !== 1 ? ` (A ×${p.ratio.toFixed(3)})` : ''}`
      + ` · ${key(a)}→${key(b)}${p.h !== undefined ? ` (fit ${p.h})` : ''} · out at ${p.aOut == null ? 'the end' : `${p.aOut.toFixed(2)} s`}`;
  }

  // The plan in the deck's frames (sample rate sr), as the worklet takes it.
  function toFrames(p, a, b, sr) {
    const lanes = (side) => Object.fromEntries(Object.entries(side).map(([name, pts]) => [name, pts.map(([t, v]) => [t * sr, v])]));
    return {
      type: p.type, aOut: p.aOut == null ? null : p.aOut * sr, bIn: p.bIn * sr, pre: p.pre * sr, ratio: p.ratio, k: p.k, lock: p.lock,
      beatsA: p.lock ? Float64Array.from(beatList(a), (t) => t * sr) : null, beatsB: p.lock ? Float64Array.from(beatList(b), (t) => t * sr) : null,
      beatA0: p.beatA0, beatB0: p.beatB0, lanes: { a: lanes(p.lanes.a), b: lanes(p.lanes.b) },
      handover: p.handover * sr, len: p.len * sr, echo: p.echo && { delay: p.echo.delay * sr, feedback: p.echo.feedback }, trimB: p.trimB,
    };
  }

  // How well song b follows song a in a mix (summaries: bpm, camelot, energy): tempo within 8% (half and double time
  // count), key, and energy that holds or rises a little.
  function score(a, b) {
    const t = a?.bpm && b?.bpm ? Math.max(0, 1 - Math.abs(Math.log(match(a.bpm, b.bpm).s)) / Math.log(1.08)) : 0.5;
    const de = (b?.energy ?? 0.5) - (a?.energy ?? 0.5);
    const e = de >= 0 ? Math.max(0, 1 - Math.abs(de - 0.05) / 0.3) : Math.max(0, 1 + de / 0.25);
    return 0.4 * t + 0.35 * harmony(a?.camelot, b?.camelot) + 0.25 * e;
  }
  // Orders items so each follows the one before as well as it can, starting after seed (greedy). Items without a
  // summary (get(x) is null) keep their order, after the rest.
  function chain(seed, items, get) {
    const known = items.filter((x) => get(x)), rest = items.filter((x) => !get(x));
    const out = [];
    let prev = seed;
    while (known.length) {
      let best = 0;
      if (prev) known.forEach((x, i) => { if (score(prev, get(x)) > score(prev, get(known[best]))) best = i; });
      const [x] = known.splice(best, 1);
      out.push(x);
      prev = get(x);
    }
    return [...out, ...rest];
  }

  const api = { plan, toFrames, trim, score, chain, harmony, match, shift, beatList, timeAt, TARGET, VERSION: 1 }; // VERSION: automix-analyze.js's
  if (typeof module === 'object') module.exports = api;
  else window.AUTOMIX = api;
})();
