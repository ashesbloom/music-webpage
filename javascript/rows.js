// ACRUX home rows scroll sideways, like Netflix. Over a row, the mouse wheel (or a vertical trackpad swipe) glides the row
// left or right instead of scrolling the page; at the row's end the page scrolls on. A scroll that began on the page keeps
// scrolling the page when the cursor passes over a row. Edge fades show the side where more cards wait.
(() => {
  const rows = document.querySelectorAll('.row-1, .row-2, .row-3');
  if (!rows.length) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const GLIDE = 0.09;  // s: how quickly the row catches up with the wheel
  const FADE = '48px'; // edge fade where more cards wait
  const PASS_MS = 250; // a wheel this soon after the page scrolled belongs to the page
  let pageWheelAt = -Infinity;

  // Runs after the rows' own listeners: a wheel no row took is the page scrolling.
  document.addEventListener('wheel', (e) => { if (!e.defaultPrevented) pageWheelAt = e.timeStamp; }, { passive: true });

  function fades(row) {
    const max = row.scrollWidth - row.clientWidth;
    row.style.setProperty('--fade-l', row.scrollLeft > 1 ? FADE : '0px');
    row.style.setProperty('--fade-r', row.scrollLeft < max - 1 ? FADE : '0px');
  }
  const resized = new ResizeObserver((entries) => entries.forEach((e) => fades(e.target)));

  for (const row of rows) {
    let target = null; // where the glide is heading, px
    let pos = 0;       // where it is (kept here: scrollLeft may round)
    let last = 0;
    function glide(now) {
      if (Math.abs(row.scrollLeft - pos) > 2) { target = null; return; } // scrolled some other way (touch, keys): let it be
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      pos += (target - pos) * (1 - Math.exp(-dt / GLIDE));
      if (Math.abs(target - pos) < 0.5) pos = target;
      row.scrollLeft = pos;
      if (pos === target) target = null;
      else requestAnimationFrame(glide);
    }

    row.addEventListener('wheel', (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return; // pinch zoom and sideways swipes: the browser's own
      if (e.timeStamp - pageWheelAt < PASS_MS) return; // the page was already scrolling: keep scrolling it
      const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? row.clientWidth : 1);
      const from = target ?? row.scrollLeft;
      const to = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, from + px));
      if (Math.abs(to - from) < 1) return; // at the row's end: the page scrolls on
      e.preventDefault();
      if (still.matches) { row.scrollLeft = to; return; }
      if (target === null) {
        pos = row.scrollLeft;
        last = performance.now();
        requestAnimationFrame(glide);
      }
      target = to;
    }, { passive: false });
    row.addEventListener('scroll', () => fades(row), { passive: true });
    resized.observe(row);
  }
})();
