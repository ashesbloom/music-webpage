// Library check: paste into the DevTools console on library.html?view=playlist&id=late-night-joji, served by
// `node server.js` (desktop width). Covers the song table, sorting (and that playback follows it), Find, the ⋯ menu's
// eight actions and the Edit dialog. Logs PASS or FAIL.
(() => {
  const $ = (s) => document.querySelector(s);
  const rows = () => [...document.querySelectorAll('.pl_list > li:not([hidden]) .pl_play')].map((b) => b.textContent);
  const pick = (value) => $(`#pl_sort [data-value="${value}"]`).click();
  const type = (text) => { const input = $('.find input'); input.value = text; input.dispatchEvent(new Event('input')); };
  const ok = {};

  ok.rows = rows().length === 12;
  ok.menu = document.querySelectorAll('#pl_menu > button').length === 8;
  pick('title');
  ok.sorted = rows()[0] === 'Afterthought' && songs.map((s) => s.title).join() === rows().join();
  pick('desc');
  ok.descending = rows()[0] === 'Yukon';
  pick('asc');
  pick('order');
  ok.backInOrder = rows()[0] === 'Glimpse of Us';
  type('glimpse');
  ok.find = rows().length === 1;
  type('');
  $('.pl_tools [data-act=edit]').click();
  ok.edit = $('#edit_pl').open && $('#edit_pl [name=name]').value === 'Late Night Joji';
  $('#edit_pl').close();

  const failed = Object.keys(ok).filter((k) => !ok[k]);
  console.log(failed.length ? `FAIL: ${failed.join(', ')}` : 'PASS', ok);
})();
