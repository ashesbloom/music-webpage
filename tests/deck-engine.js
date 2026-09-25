// Engine check: paste into the DevTools console on a freshly loaded ACRUX home page served by `node server.js`.
// It covers the engine's edge cases: iPhones play through the silent switch, a failed load can be retried, Pause works
// while a song is still loading, and the next song downloads only after the current one has loaded.
// Logs PASS or FAIL with the details. Takes ~15 s.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 15000) => {
    for (const t0 = performance.now(); !fn() && performance.now() - t0 < ms;) await wait(50);
    return fn();
  };
  const playButton = document.getElementById('master_play');
  const icon = document.getElementById('play');
  const card = (id) => document.querySelector(`.row-1 button[id="${id}"]`);
  const realFetch = window.fetch;
  const ok = {}, r = {};

  // 1. iPhone silent switch: the engine asks Safari (16.4+) for a 'playback' audio session, which ignores the switch.
  Object.defineProperty(navigator, 'audioSession', { value: { type: 'auto' }, configurable: true });
  const probe = new DeckAudio(music.src);
  probe._init();
  ok.audioSession = navigator.audioSession.type === 'playback';
  delete navigator.audioSession;
  probe.ctx.close();

  // 1b. If the audio module fails to load once (a network blip), the next Play loads it again.
  const flaky = new DeckAudio(music.src);
  const realAddModule = AudioWorklet.prototype.addModule;
  AudioWorklet.prototype.addModule = function () { return Promise.reject(new TypeError('blip')); };
  await flaky._init().catch(() => {});
  AudioWorklet.prototype.addModule = realAddModule;
  await wait(0);
  ok.moduleRetry = await flaky._init().then(() => !!flaky.node, () => false);
  flaky.ctx.close();

  // 2. A failed load goes back to paused, and Play works again once the network is back.
  window.fetch = (url, ...rest) => (/\.mp3$/.test(String(url)) ? Promise.reject(new TypeError('offline')) : realFetch(url, ...rest));
  playButton.click();
  await until(() => music.paused, 3000);
  r.afterFailure = { paused: music.paused, icon: icon.className, text: document.getElementById('albumtext').textContent };
  ok.failureShown = music.paused && icon.className.includes('icon-play') && /Couldn't load/.test(r.afterFailure.text);
  window.fetch = realFetch;
  playButton.click();
  ok.retryPlays = await until(() => !music.paused && music.currentTime > 0.5);

  // 3. Pause works while a song is still loading (the whole file loads before it can play).
  playButton.click();
  await wait(300);
  window.fetch = (url, ...rest) => (/\.mp3$/.test(String(url)) ? wait(1500).then(() => realFetch(url, ...rest)) : realFetch(url, ...rest));
  card(18).click(); // a song nothing has preloaded
  await wait(300);
  playButton.click(); // Pause, mid-load
  await wait(2500);
  window.fetch = realFetch;
  r.pauseWhileLoading = { paused: music.paused, icon: icon.className, time: +music.currentTime.toFixed(2) };
  ok.pauseWhileLoading = music.paused && icon.className.includes('icon-play') && music.currentTime < 0.1;

  // 4. The next song downloads only after the current one has loaded, so it doesn't slow the start.
  const calls = [];
  window.fetch = (url, ...rest) => {
    calls.push({ file: String(url).split('/').pop(), currentLoaded: music.duration > 0 });
    return realFetch(url, ...rest);
  };
  card(5).click(); // Gimme Love (5.mp3); the next song is 6.mp3
  await until(() => calls.some((c) => c.file === '6.mp3'));
  window.fetch = realFetch;
  r.fetches = calls;
  const next = calls.find((c) => c.file === '6.mp3');
  ok.preloadAfterLoad = calls[0]?.file === '5.mp3' && !!next && next.currentLoaded;

  if (!music.paused) playButton.click();
  r.failed = Object.keys(ok).filter((k) => !ok[k]);
  r.pass = r.failed.length === 0;
  console.log(r.pass ? 'PASS' : 'FAIL', r);
  return r;
})();
