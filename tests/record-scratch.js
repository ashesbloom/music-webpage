// Record scratch check: paste into the DevTools console on any ACRUX page served by `node server.js`.
// It plays a song and drives the record with pointer events: pull back a quarter turn, push forward half a turn,
// flick, scratch while paused, and the edge cases (Pause mid catch-up, lost pointer, hidden tab, end of song, slow frames).
// Logs PASS or FAIL with the numbers. Takes ~25 s and leaves the next song playing.
(async () => {
  const TURN = 3.7; // seconds of song per turn of the record
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise(requestAnimationFrame);
  const playback = document.querySelector('.playback');
  const box = document.querySelector('.record').getBoundingClientRect();
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2, R = box.width * 0.4; // 80% out from the centre
  const togglePlay = () => document.getElementById('master_play').click();
  let id = 1000;
  const point = (deg) => ({ clientX: cx + R * Math.cos(deg * Math.PI / 180), clientY: cy + R * Math.sin(deg * Math.PI / 180) });
  const send = (type, deg, target = playback) => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: id, pointerType: 'mouse', isPrimary: true,
    button: 0, buttons: type === 'pointerup' ? 0 : 1, ...point(deg),
  }));
  // Grab at `from` degrees (screen angles: 180 is left of centre, the side the tucked record shows), turn to `to`
  // over `ms`, hold still `holdMs`, and report the song position just before letting go.
  async function drag(from, to, ms, holdMs = 0, letGo = true) {
    id++;
    const start = point(from);
    send('pointerdown', from, document.elementFromPoint(start.clientX, start.clientY));
    const t0 = performance.now();
    let minRate = Infinity;
    for (let k = 0; k < 1;) {
      await frame();
      k = Math.min((performance.now() - t0) / ms, 1);
      send('pointermove', from + (to - from) * k);
      minRate = Math.min(minRate, music.scratchRate ?? 1);
    }
    await wait(holdMs);
    const result = { pos: music.currentTime, stillRate: music.scratchRate, minRate };
    if (letGo) send('pointerup', to);
    return result;
  }
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const angle = () => parseFloat(getComputedStyle(document.getElementById('record')).rotate) || 0;
  const r = {}, ok = {};

  if (music.paused) togglePlay();
  for (let i = 0; i < 150 && !isFinite(music.duration); i++) await wait(100);
  music.currentTime = 30;
  await wait(1200);

  // 1. Pull back a quarter turn while playing: ~0.93 s back, played in reverse, then silent under a still hand.
  let p0 = music.currentTime;
  let d = await drag(225, 135, 450, 300);
  r.back = +(d.pos - p0).toFixed(2);
  r.backMinRate = +d.minRate.toFixed(2);
  r.backStillRate = +(d.stillRate ?? 1).toFixed(3);
  ok.back = near(r.back, -TURN / 4, 0.12) && r.backMinRate < -0.5 && Math.abs(r.backStillRate) < 0.05;

  // 2. Let go: the motor brings it back to normal playback.
  await wait(800);
  const t1 = music.currentTime;
  await wait(1000);
  r.afterRelease = +(music.currentTime - t1).toFixed(2);
  ok.release = music.scratchRate === null && !music.paused && near(r.afterRelease, 1, 0.08);

  // 3. Push forward half a turn: ~1.85 s ahead.
  p0 = music.currentTime;
  d = await drag(135, 315, 600, 300);
  r.forward = +(d.pos - p0).toFixed(2);
  ok.forward = near(r.forward, TURN / 2, 0.15);
  await wait(800);

  // 4. Flick forward and let go at speed: it carries on well past the drag itself.
  p0 = music.currentTime;
  const tf = performance.now();
  await drag(135, 225, 60);
  for (let i = 0; i < 100 && music.scratchRate !== null; i++) await wait(50);
  r.flickExtra = +(music.currentTime - p0 - (performance.now() - tf) / 1000 - TURN / 4).toFixed(2);
  ok.flick = r.flickExtra > 0.5 && music.scratchRate === null;

  // 5. Pause while it is still catching up after a flick: silent at once.
  await drag(135, 225, 60);
  await frame();
  togglePlay();
  await frame();
  await frame();
  ok.pauseMidCatch = music.paused && music.scratchRate === null;

  // 6. Scratch while paused: you hear it, and the song stays paused where you left it.
  await wait(1300);
  p0 = music.currentTime;
  await drag(225, 180, 300, 200);
  await wait(100);
  const p1 = music.currentTime;
  await wait(500);
  r.pausedMove = +(p1 - p0).toFixed(2);
  ok.paused = near(r.pausedMove, -TURN / 8, 0.08) && music.paused && music.scratchRate === null && near(music.currentTime, p1, 0.01);
  const a0 = angle();
  await wait(500);
  ok.cuedStill = angle() === a0; // left where the hand put it, like cueing a record

  // 7. Losing the pointer mid-scratch (switching windows) lets go instead of leaving the record held.
  togglePlay();
  await wait(1500);
  const a1 = angle();
  await wait(200);
  ok.spinsAfterPlay = angle() !== a1;
  await drag(225, 200, 200, 0, false);
  playback.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: id }));
  ok.lostPointer = !playback.classList.contains('grabbing');
  await wait(1000);
  ok.lostPointer = ok.lostPointer && music.scratchRate === null;

  // 8. Hiding the tab mid catch-up returns to normal speed rather than leaving the song running fast.
  await drag(135, 225, 60);
  await frame();
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  ok.hiddenTab = music.scratchRate === null;
  delete document.hidden;

  // 8b. Hiding the tab while the record is held lets go, rather than leaving the song at the hand's speed.
  await drag(225, 200, 150, 0, false);
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  ok.hiddenWhileHeld = !playback.classList.contains('grabbing') && music.scratchRate === null;
  delete document.hidden;

  // 9. Flicking past the end of the song while playing: one 'ended', then the player moves to the next song.
  await wait(500);
  let ends = 0;
  const count = () => ends++;
  music.addEventListener('ended', count);
  music.currentTime = music.duration - 1;
  await wait(100);
  const src = music.src;
  await drag(135, 315, 100);
  await wait(3500);
  music.removeEventListener('ended', count);
  r.ends = ends;
  ok.end = ends === 1 && music.src !== src;

  // 10. Slow frames (a busy phone): the song still settles under a still hand instead of swinging back and forth.
  const realFrame = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 100); // 10 frames a second
  await wait(300);
  await drag(225, 180, 400, 0, false);
  const rates = [];
  for (let i = 0; i < 10; i++) { await wait(100); rates.push(music.scratchRate ?? 1); }
  send('pointerup', 180);
  window.requestAnimationFrame = realFrame;
  let flips = 0;
  for (let i = 1; i < rates.length; i++) if (Math.sign(rates[i]) * Math.sign(rates[i - 1]) < 0) flips++;
  r.slowFrameRates = rates.map((x) => +x.toFixed(2));
  ok.slowFrames = flips === 0 && Math.abs(rates[rates.length - 1]) < 0.05;

  r.failed = Object.keys(ok).filter((k) => !ok[k]);
  r.pass = r.failed.length === 0;
  console.log(r.pass ? 'PASS' : 'FAIL', r);
  return r;
})();
