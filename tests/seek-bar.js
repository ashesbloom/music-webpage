// Seek bar check: paste into the DevTools console on any ACRUX page served by `node server.js`.
// Plays a song and watches the header seek bar frame by frame: it must glide (move on nearly every frame, never
// backwards, in step with the song), follow the thumb while dragged, and land where it was let go without snapping back.
// Logs PASS or FAIL with the numbers. Takes ~4 s and leaves the song paused.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise(requestAnimationFrame);
  const bar = document.querySelector('.play_bar');
  const slider = document.getElementById('slider');
  const seek = document.getElementById('seek');
  const filled = () => slider.getBoundingClientRect().width / bar.getBoundingClientRect().width;
  const ok = {}, r = {};

  if (music.paused) document.getElementById('master_play').click();
  for (let i = 0; i < 150 && !isFinite(music.duration); i++) await wait(100);
  music.currentTime = 20;
  await wait(500);

  // 1. While playing: moves on nearly every frame, never backwards, and matches the song.
  let frames = 0, moved = 0, back = 0, maxErr = 0, prev = filled();
  for (const t0 = performance.now(); performance.now() - t0 < 2000;) {
    await frame();
    const f = filled();
    frames++;
    if (f > prev) moved++;
    if (f < prev - 1e-4) back++;
    maxErr = Math.max(maxErr, Math.abs(f - music.currentTime / music.duration));
    prev = f;
  }
  r.movedShare = +(moved / frames).toFixed(2);
  r.maxErrPct = +(maxErr * 100).toFixed(2);
  ok.glides = r.movedShare > 0.8;
  ok.forward = back === 0;
  ok.inStep = maxErr < 0.003;

  // 2. Dragging the thumb: the bar follows it at once.
  seek.value = 50;
  seek.dispatchEvent(new Event('input', { bubbles: true }));
  await frame();
  await frame();
  r.whileDragging = +filled().toFixed(3);
  ok.follows = Math.abs(filled() - 0.5) < 0.002;

  // 3. Letting go: the song jumps there and the bar stays, with no snap back to the old spot.
  seek.dispatchEvent(new Event('change', { bubbles: true }));
  const after = [];
  for (let i = 0; i < 10; i++) { await frame(); after.push(filled()); }
  r.landedAt = +(music.currentTime / music.duration).toFixed(3);
  ok.lands = Math.abs(r.landedAt - 0.5) < 0.01 && after.every((f) => Math.abs(f - 0.5) < 0.01);

  if (!music.paused) document.getElementById('master_play').click();
  r.failed = Object.keys(ok).filter((k) => !ok[k]);
  r.pass = r.failed.length === 0;
  console.log(r.pass ? 'PASS' : 'FAIL', r);
  return r;
})();
