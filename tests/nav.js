// Navigation check: paste into the DevTools console on the home page (served by `node server.js`) while a song plays.
// Walks Home -> My Music -> Albums -> back -> back and checks the music never stopped or changed. Logs PASS or FAIL.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const src = music.src, paused = music.paused;
  const same = () => music.src === src && music.paused === paused;
  const ok = {};
  $('.tiles a[href$="library.html"]').click(); await wait(800);
  ok.myMusic = !!$('#library .crate') && same();
  $('.di[href*="view=albums"]').click(); await wait(800);
  ok.albums = !!$('.al_grid') && same();
  $('[data-back]').click(); await wait(800);
  ok.backToMyMusic = !!$('#library .crate') && location.search === '' && same();
  $('[data-back]').click(); await wait(800);
  ok.backHome = !!$('.tiles') && same();
  const failed = Object.keys(ok).filter((k) => !ok[k]);
  console.log(failed.length ? `FAIL: ${failed.join(', ')}` : 'PASS', ok);
})();
