// Record spin check: paste into the DevTools console on any ACRUX page (serve with `node server.js`).
// Clicks Play, then Pause, and samples the record's total rotation: speed must go idle -> playing -> idle
// (12 s and 3.7 s per turn) with a smooth ramp and no jumps. Logs PASS or FAIL with the numbers. Takes ~7 s.
(async () => {
  const els = ['#record', '.record .i2', '.record .i3'].map((s) => document.querySelector(s));
  const deg = (el) => { const r = getComputedStyle(el).rotate; return r === 'none' ? 0 : parseFloat(r); };
  const clock = () => document.timeline.currentTime; // the clock animations actually advance on
  let prev = els.map(deg), acc = [0, 0, 0], t0 = clock(), out = [];
  const sample = async (ms) => {
    const end = clock() + ms;
    while (clock() < end) {
      const t = clock();
      while (clock() - t < 50) await new Promise(requestAnimationFrame);
      const now = els.map(deg);
      now.forEach((a, i) => { let d = a - prev[i]; if (d < -180) d += 360; if (d > 180) d -= 360; acc[i] += d; });
      prev = now;
      out.push([clock() - t0, acc[0] + acc[1] + acc[2]]);
    }
  };
  await sample(1500);                                   // idle (after load's spin-down)
  document.getElementById('master_play').click(); const tPlay = clock() - t0;
  await sample(2500);                                   // spin-up, then playing
  document.getElementById('master_play').click(); const tPause = clock() - t0;
  await sample(2500);                                   // spin-down, then idle
  const v = out.slice(1).map((s, i) => [s[0], (s[1] - out[i][1]) / ((s[0] - out[i][0]) / 1000)]);
  const at = (t) => { const w = v.filter((s) => s[0] > t - 250 && s[0] < t + 250); return w.reduce((a, s) => a + s[1], 0) / w.length; };
  const maxV = Math.max(...v.map((s) => s[1])), minV = Math.min(...v.map((s) => s[1]));
  // Speed changes between samples, after a 3-sample median: a missing ramp is a lasting step and still fails, while a
  // one-frame hitch at a click (a frame that lands mid state change) is a lone blip and is dropped.
  // Position jumps still fail through the raw minV/maxV bounds.
  const vm = v.map((s, i) => (i && i < v.length - 1 ? [v[i - 1][1], s[1], v[i + 1][1]].sort((a, b) => a - b)[1] : s[1]));
  let maxJerk = 0; for (let i = 1; i < vm.length; i++) maxJerk = Math.max(maxJerk, Math.abs(vm[i] - vm[i - 1]));
  const idle = 360 / 12, play = 360 / 3.7;
  const r = { idleBefore: at(tPlay - 300), playing: at(tPause - 300), idleAfter: at(out.at(-1)[0] - 300), minV, maxV, maxJerk, icon: document.getElementById('play').className };
  r.pass = Math.abs(r.idleBefore - idle) < 4 && Math.abs(r.playing - play) < 6 && Math.abs(r.idleAfter - idle) < 4
    && minV > idle - 8 && maxV < play + 10 && maxJerk < 25;
  return Object.fromEntries(Object.entries(r).map(([k, x]) => [k, typeof x === 'number' ? +x.toFixed(1) : x]));
})().then((r) => (console.log(r.pass ? 'PASS' : 'FAIL', r), r));
