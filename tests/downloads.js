// Your Downloaded Songs check: paste into the DevTools console on library.html?view=downloads, served by
// `node server.js`, with at least one download or cached song. Covers: no song both in a card and a row, every Cached
// row has its ⏳, and Play starts a song of the page. Logs PASS or FAIL.
(() => {
  const ok = {};
  const cardSongs = new Set([...document.querySelectorAll('.al_grid .al')].flatMap((a) => {
    const q = new URL(a.href).searchParams;
    return CATALOG.list(`${q.get('view')}:${q.get('id')}`).map((s) => s.id);
  }));
  ok.noRepeats = [...document.querySelectorAll('.pl_list .pl_play')].every((b) => !cardSongs.has(b.dataset.song));
  ok.countdowns = [...document.querySelectorAll('[data-list="playlist:cached"] .pl_row:not(.pl_head)')].every((li) => li.querySelector('.pl_left'));
  const play = document.querySelector('[data-act=play]:not([aria-disabled])');
  if (play) {
    play.click();
    ok.plays = listKey === 'playlist:downloads' && songs.length > 0;
  }
  const failed = Object.keys(ok).filter((k) => !ok[k]);
  console.log(failed.length ? `FAIL: ${failed.join(', ')}` : 'PASS', ok);
})();
