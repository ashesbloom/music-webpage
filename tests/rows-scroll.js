// Home rows check: paste into the DevTools console on the home page served by `node server.js` (desktop width).
// The rows scroll sideways like Netflix: they stay on one line; over a row the mouse wheel moves it right (eased) instead of
// the page; at the row's end, or when the page was already scrolling, the wheel scrolls the page; fades show on the side
// with more cards. Logs PASS or FAIL.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const rows = [...document.querySelectorAll('.explore .row-1, .explore .row-2, .explore .row-3')].filter((row) => row.children.length);
  const played = $('#recent'), browse = $('.explore');
  const ok = {}, r = {};
  const wheel = (el, deltaY, deltaX = 0) => el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, deltaX, deltaMode: 0 }));
  const fades = (row) => [row.style.getPropertyValue('--fade-l') || '0px', row.style.getPropertyValue('--fade-r') || '0px'];

  // 1. One line per row, cards keep a real size, and rows with more cards than fit can scroll.
  r.rows = rows.map((row) => {
    const cards = [...row.children].map((li) => li.getBoundingClientRect());
    return { id: row.id, cards: cards.length, oneLine: cards.every((c) => Math.abs(c.top - cards[0].top) < 1), minW: Math.round(Math.min(...cards.map((c) => c.width))), scrolls: row.scrollWidth > row.clientWidth + 1 };
  });
  ok.oneLine = r.rows.every((x) => x.oneLine && x.minW >= 90);
  ok.overflow = r.rows.every((x) => x.scrolls);

  // 2. At the start: no fade on the left, a fade on the right.
  played.scrollLeft = 0;
  played.dispatchEvent(new Event('scroll'));
  await wait(50);
  r.fadesAtStart = fades(played);
  ok.fadesAtStart = parseFloat(r.fadesAtStart[0]) === 0 && parseFloat(r.fadesAtStart[1]) > 0;

  // 3. Wheel down over the row: the row moves right, easing in over several frames; the page stays put.
  await wait(400); // no page scroll just happened
  const top = browse.scrollTop;
  const cancelled = !wheel(played, 120);
  const early = played.scrollLeft;
  await wait(400);
  r.wheel = { cancelled, early: Math.round(early), settled: Math.round(played.scrollLeft) };
  ok.wheelMovesRow = cancelled && played.scrollLeft > 100 && early < played.scrollLeft && browse.scrollTop === top;

  // 4. At the row's end: the wheel is left for the page, and the fades flip.
  played.scrollLeft = played.scrollWidth;
  played.dispatchEvent(new Event('scroll'));
  await wait(400);
  ok.endPassesThrough = wheel(played, 120);
  r.fadesAtEnd = fades(played);
  ok.fadesAtEnd = parseFloat(r.fadesAtEnd[0]) > 0 && parseFloat(r.fadesAtEnd[1]) === 0;

  // 5. A scroll that started on the page keeps scrolling the page as the cursor passes over a row.
  played.scrollLeft = 0;
  await wait(400);
  wheel(browse, 120);
  ok.noTrap = wheel(played, 120) && played.scrollLeft === 0;

  // 6. A sideways trackpad swipe is the browser's own.
  await wait(400);
  ok.sidewaysNative = wheel(played, 0, 80);

  played.scrollLeft = 0;
  r.failed = Object.keys(ok).filter((k) => !ok[k]);
  r.pass = r.failed.length === 0;
  console.log(r.pass ? 'PASS' : 'FAIL', r);
  return r;
})();
