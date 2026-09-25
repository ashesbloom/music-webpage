// ACRUX side panel divider (desktop): drag the line between Browse and the side panel to resize the panel.
// Arrow keys nudge it, a double-click puts the default back. The CSS caps (--menu-w) keep the layout whole;
// the width is remembered per browser and restored by a one-line script in each page's <head>.
(() => {
  const bar = document.querySelector('.divider');
  const panel = document.getElementById('sidebar');
  if (!bar || !panel) return;
  const root = document.documentElement;
  const STEP = 16; // px per arrow key
  let dragging = null;

  const width = () => Math.round(panel.getBoundingClientRect().width);
  const show = () => bar.setAttribute('aria-valuenow', width());
  const setWidth = (px) => { root.style.setProperty('--menu-pref', `${Math.round(px)}px`); show(); };
  function remember() {
    setWidth(width()); // keep the capped width, not wherever the pointer went
    try { localStorage.setItem('panelWidth', width()); } catch {}
  }

  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = e.pointerId;
    try { bar.setPointerCapture(e.pointerId); } catch {} // synthetic test events have no pointer to capture
    bar.classList.add('dragging');
    document.body.classList.add('resizing');
  });
  bar.addEventListener('pointermove', (e) => {
    if (e.pointerId === dragging) setWidth(panel.getBoundingClientRect().right - e.clientX);
  });
  function stop(e) {
    if (e.pointerId !== dragging) return;
    dragging = null;
    bar.classList.remove('dragging');
    document.body.classList.remove('resizing');
    remember();
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) bar.addEventListener(type, stop);

  bar.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: STEP, ArrowRight: -STEP }[e.key];
    if (!step) return;
    e.preventDefault();
    setWidth(width() + step);
    remember();
  });
  bar.addEventListener('dblclick', () => {
    root.style.removeProperty('--menu-pref');
    try { localStorage.removeItem('panelWidth'); } catch {}
    show();
  });
  show();
})();
