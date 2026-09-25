// Side panel divider check: paste into the DevTools console on any ACRUX page at desktop width (1440×900 is typical).
// Drags the line between Browse and the side panel: the panel follows, stays within its caps, the header player stays
// lined up with Browse, and the width is remembered. Keyboard and double-click reset too.
// Logs PASS or FAIL. Puts your own width back afterwards.
(async () => {
  const frame = () => new Promise(requestAnimationFrame);
  const $ = (s) => document.querySelector(s);
  const root = document.documentElement;
  const bar = $('.divider'), panel = $('#sidebar'), browse = $('.explore'), player = $('.playbackarea'), header = $('.header');
  const box = (el) => el.getBoundingClientRect();
  const savedWidth = localStorage.getItem('panelWidth');
  const savedPref = root.style.getPropertyValue('--menu-pref');
  const ok = {}, r = {};
  const lined = () => Math.abs(box(player).left - box(browse).left) <= 1 && Math.abs(box(player).right - box(browse).right) <= 1;
  const send = (type, x) => bar.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 77, pointerType: 'mouse', isPrimary: true,
    button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: box(bar).top + 200,
  }));
  async function drag(toX) {
    send('pointerdown', box(bar).left + box(bar).width / 2);
    send('pointermove', toX);
    await frame();
    send('pointerup', toX);
    await frame();
  }
  const key = async (k) => { bar.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); await frame(); };

  try {
    bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await frame();
    const w0 = box(panel).width;
    ok.linedAtStart = lined();
    ok.onTheLine = Math.abs(box(bar).left + box(bar).width / 2 - box(panel).left) <= 1;

    // 1. Drag to a 400px panel: it follows, and the header player stays lined up with Browse.
    await drag(box(panel).right - 400);
    r.dragged = Math.round(box(panel).width);
    const linedAt400 = lined();
    ok.saved = localStorage.getItem('panelWidth') === String(r.dragged);

    // 2. Too wide: Browse keeps at least 580px and the panel stops at 560px.
    await drag(0);
    r.widest = [Math.round(box(panel).width), Math.round(box(browse).width)];
    ok.capWide = r.widest[0] <= 560 && r.widest[1] >= 579 && lined();
    ok.drag = Math.abs(r.dragged - Math.min(400, r.widest[0])) <= 1 && linedAt400; // small windows cap below 400

    // 3. Too narrow: the panel stops at 240px, and the volume control still fits in the header.
    await drag(innerWidth);
    r.narrowest = Math.round(box(panel).width);
    ok.capNarrow = r.narrowest === 240 && lined() && box($('.volumecontrol')).right <= box(header).right + 1;
    ok.noOverflow = root.scrollWidth <= innerWidth;

    // 4. Keyboard: the left arrow widens the panel, the right arrow narrows it.
    await key('ArrowLeft');
    r.afterLeft = Math.round(box(panel).width);
    await key('ArrowRight');
    ok.keys = r.afterLeft === 256 && Math.round(box(panel).width) === 240 && bar.getAttribute('aria-valuenow') === '240';

    // 5. Double-click: back to the default width, and nothing remembered.
    bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await frame();
    ok.reset = Math.abs(box(panel).width - w0) <= 1 && localStorage.getItem('panelWidth') === null;
  } finally {
    savedWidth === null ? localStorage.removeItem('panelWidth') : localStorage.setItem('panelWidth', savedWidth);
    savedPref ? root.style.setProperty('--menu-pref', savedPref) : root.style.removeProperty('--menu-pref');
  }

  r.failed = Object.keys(ok).filter((k) => !ok[k]);
  r.pass = r.failed.length === 0;
  console.log(r.pass ? 'PASS' : 'FAIL', r);
  return r;
})();
