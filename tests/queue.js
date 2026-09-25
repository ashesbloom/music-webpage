// Queue and ⋯ tray check: paste into the DevTools console on the home page or a playlist page served by `node server.js`
// (at desktop width). Covers the tray's six items, Continue Playing with Infinite on and off (empty) and shuffled, and History waiting
// above the fold when the queue opens. Logs PASS or FAIL. Puts your play history and Infinite setting back afterwards.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const saved = localStorage.getItem('playHistory');
  const inf = $('#infinite'), wasOn = inf.getAttribute('aria-pressed') === 'true';
  const setInf = (on) => { if ((inf.getAttribute('aria-pressed') === 'true') !== on) inf.click(); }; // each click re-renders
  const ok = {};

  ok.trayItems = $('#more_tray').querySelectorAll(':scope > :is(button, a)').length === 6;
  setInf(true);
  ok.infiniteOn = $('.q_next').children.length === songs.length - 1;
  setInf(false);
  ok.infiniteOffEmpty = $('.q_next').children.length === 0 && upNext() === -1;

  setInf(true);
  $('#shuffle').click(); // on: a new random order, and upNext() is its top row
  ok.shuffledTop = $('.q_next').children.length === songs.length - 1 && songs[upNext()].title === $('.q_next .q_name').textContent;
  $('#shuffle').click();
  const fake = [1, 2, 3].map((i) => ({ name: `Test ${i}`, artist: 'Joji', cover: songs[0].cover, album: 'Test', href: location.href }));
  localStorage.setItem('playHistory', JSON.stringify(fake));
  setInf(true);
  ok.historyRows = $('.q_hist ol').children.length === 3;
  $('#queue_btn').click();
  await wait(600);
  ok.historyAboveFold = $('#queue').scrollTop > 0
    && Math.abs($('.q_up').getBoundingClientRect().top - $('.q_bar').getBoundingClientRect().bottom) < 2;
  $('.q_min').click();
  await wait(600);
  ok.closed = getComputedStyle($('#queue')).visibility === 'hidden';

  if (saved === null) localStorage.removeItem('playHistory');
  else localStorage.setItem('playHistory', saved);
  setInf(!wasOn);
  setInf(wasOn);
  const failed = Object.keys(ok).filter((k) => !ok[k]);
  console.log(failed.length ? `FAIL: ${failed.join(', ')}` : 'PASS', ok);
})();
