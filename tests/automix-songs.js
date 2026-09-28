// Made-up songs for the Auto Mix tests, at 22 050 Hz, so every beat, bar and chord is known exactly.
// A dance track: four-on-the-floor kicks (the downbeat louder) and off-beat hats throughout; from bar `intro` to bar
// `outro`, a bassline and chords, C Am F G, one a bar (`key` semitones up). `lead` seconds of silence come first.
function song({ sr = 22050, bpm = 124, bars = 64, intro = 8, outro = 56, lead = 0, key = 0 } = {}) {
  const beat = 60 / bpm;
  const len = Math.ceil((lead + bars * 4 * beat + 1) * sr);
  const x = new Float32Array(len);
  const add = (t, fn, dur) => {
    const s = Math.round(t * sr);
    for (let i = 0; i < dur * sr && s + i < len; i++) x[s + i] += fn(i / sr);
  };
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const kick = (amp) => (t) => amp * Math.sin(2 * Math.PI * (50 * t + 100 * (1 - Math.exp(-30 * t)) / 30)) * Math.exp(-18 * t);
  const hat = (amp) => () => amp * noise();
  const CHORDS = [[0, 4, 7], [9, 0, 4], [5, 9, 0], [7, 11, 2]];
  const hz = (pc, octave) => 440 * 2 ** ((pc + 12 * (octave + 1) - 69) / 12);
  for (let b = 0; b < bars; b++) {
    const full = b >= intro && b < outro;
    for (let q = 0; q < 4; q++) {
      const t = lead + (b * 4 + q) * beat;
      add(t, kick((full ? 0.35 : 0.2) * (q === 0 ? 1.5 : 1)), 0.25);
      add(t + beat / 2, hat(full ? 0.05 : 0.03), 0.03);
    }
    if (full) {
      const t = lead + b * 4 * beat, ch = CHORDS[b % 4].map((pc) => (pc + key) % 12);
      add(t, (s) => 0.14 * Math.sin(2 * Math.PI * hz(ch[0], 1) * s) * Math.min(1, s * 50), 4 * beat);
      for (const pc of ch) add(t, (s) => 0.05 * Math.sin(2 * Math.PI * hz(pc, 4) * s) * Math.min(1, s * 20), 4 * beat);
    }
  }
  return { left: x, right: x.slice(), sr, beat };
}

// A beatless pad: slow swells of an A-minor chord, 90 s.
function pad({ sr = 22050, secs = 90 } = {}) {
  const x = new Float32Array(secs * sr);
  for (let i = 0; i < x.length; i++) {
    const t = i / sr, swell = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / 12);
    x[i] = 0.1 * swell * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 261.63 * t) + Math.sin(2 * Math.PI * 329.63 * t));
  }
  return { left: x, right: x.slice(), sr };
}

module.exports = { song, pad };
