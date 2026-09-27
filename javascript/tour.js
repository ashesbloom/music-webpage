// ACRUX record tour: three short cards beside the real record, each with its move shown on the record itself.
//   1. Turn the record to seek: a hand grabs the record's edge and drags it along, the record turns with it, and the
//      header's seek bar moves ahead.
//   2. The label plays and pauses: a finger taps the red label.
//   3. The colour follows the cover: the record's colours change.
// Shown after Set up ACRUX (Show me the record) and when a phone joins with the QR code (window.startTour).
(() => {
  const phone = () => matchMedia('(max-width: 699px)').matches;
  const cards = () => [
    { demo: 'seek', title: 'Turn the record to seek',
      text: phone() ? 'Hold the record with a finger and turn it. Forward skips ahead, back goes back. Let go and the song plays on from there.'
        : 'Hold the record and drag it round. Forward skips ahead, back goes back. Let go and the song plays on from there.' },
    { demo: 'press', title: phone() ? 'Press the red button to play or pause' : 'Press the label to play or pause',
      text: phone() ? 'The big red button on the record plays and pauses.' : 'The red label in the middle of the record is the play button. Press it once to pause and again to play.' },
    { demo: 'hue', title: 'The colour follows the cover',
      text: 'Each album’s cover sets the colour of the label, the dots around the edge and the glow. Play something else and the record changes with it.' },
  ];
  const HAND = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V13c0 4-2.5 7-6 7-2.5 0-4-1.2-5.5-3.5L4 14a1.4 1.4 0 0 1 2.3-1.6L8 14"/></svg>';
  const rect = (el) => { const r = el?.getBoundingClientRect(); return r && r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 ? r : null; };
  const seen = (r) => r && { left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.min(r.right, innerWidth), bottom: Math.min(r.bottom, innerHeight),
    get width() { return this.right - this.left; }, get height() { return this.bottom - this.top; } }; // the part on screen
  // What the tour points at. A phone seeks by turning the rising record at the bottom, and plays with its big red button;
  // a computer by turning the record in the left column (its stage), and plays with the record's label.
  const parts = () => {
    if (phone()) {
      const disc = rect(document.querySelector('.pv_disc'));
      return { box: seen(disc), rec: disc, label: rect(document.getElementById('master_play')), seek: null, turn: '.pv_disc' };
    }
    return { box: rect(document.querySelector('.playback')), rec: rect(document.querySelector('.playback .record')),
      label: rect(document.querySelector('.label_ctrl')), seek: rect(document.getElementById('seek')), turn: '.playback .record' };
  };
  const px = (el, props) => { for (const [k, v] of Object.entries(props)) el.style[k] = `${v}px`; };

  function start() {
    document.querySelector('.tr')?.remove();
    const list = cards();
    let n = 0;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="tr">
        <div class="tr_stage" aria-hidden="true">
          <svg class="tr_trail"><defs><marker id="tr_arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10z" fill="#fff"/></marker></defs><path class="tr_arc" marker-end="url(#tr_arrow)"/></svg>
          <span class="tr_hand">${HAND}</span>
          <span class="tr_tap"></span>
        </div>
        <span class="tr_knob" aria-hidden="true"></span>
        <section class="tr_card" role="dialog" aria-labelledby="tr_h">
          <h2 id="tr_h" tabindex="-1"></h2><p></p>
          <div class="tr_foot"><span class="tr_count"></span>
            <span><button type="button" class="tr_skip">Skip</button><button type="button" class="tr_next"></button></span></div>
        </section>
      </div>`);
    const el = document.body.lastElementChild;
    const stage = el.querySelector('.tr_stage');
    const card = el.querySelector('.tr_card');
    const root = document.documentElement; // carries tr_seek / tr_hue while those cards show

    // Everything is measured from the page as it is: the record column (the stage, which clips the demo to what you
    // can see), the record, its label, and the header's seek bar.
    function place() {
      const c = list[n];
      const { box, rec, label, seek } = parts();
      el.dataset.demo = box && rec ? c.demo : '';
      if (box && rec) {
        px(stage, { left: box.left, top: box.top, width: box.width, height: box.height });
        const cx = rec.left + rec.width / 2 - box.left;
        const cy = rec.top + rec.height / 2 - box.top;
        // The drag: an arc on the grooves, facing the part of the record you can see, clockwise (forward).
        const toward = Math.atan2(box.height / 2 - cy, box.width / 2 - cx);
        const r = (rec.width / 2) * 0.8;
        const at = (a) => `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
        const spread = (22 * Math.PI) / 180;
        const arc = `M ${at(toward - spread)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${at(toward + spread)}`;
        stage.querySelector('.tr_arc').setAttribute('d', arc);
        stage.querySelector('.tr_hand').style.offsetPath = `path('${arc}')`;
        // The tap: on the label, at the part of it nearest the middle of what you can see.
        if (label) {
          const lx = label.left + label.width / 2 - box.left;
          const ly = label.top + label.height / 2 - box.top;
          const a = Math.atan2(box.height / 2 - ly, box.width / 2 - lx);
          const d = Math.min(label.width, label.height) * 0.3;
          px(stage.querySelector('.tr_tap'), { left: lx + d * Math.cos(a), top: ly + d * Math.sin(a) });
        }
        // The header's seek bar moves along while the record turns.
        const knob = el.querySelector('.tr_knob');
        knob.hidden = !seek;
        if (seek) {
          px(knob, { top: seek.top + seek.height / 2 });
          knob.style.setProperty('--k0', `${seek.left + seek.width * 0.3}px`);
          knob.style.setProperty('--k1', `${seek.left + seek.width * 0.55}px`);
        }
      }
      const w = card.offsetWidth;
      const h = card.offsetHeight;
      let x = (innerWidth - w) / 2;
      let y = (innerHeight - h) / 2;
      card.dataset.side = '';
      if (box && !phone()) { // beside the record column, level with the record's middle
        x = Math.min(box.right + 28, innerWidth - w - 16);
        y = Math.min(Math.max((rec ? rec.top + rec.height / 2 : box.top + box.height / 2) - h / 2, 16), innerHeight - h - 16);
        card.dataset.side = 'left';
      } else if (box) { // above the rising record
        y = Math.max(box.top - h - 16, 72);
        card.dataset.side = 'bottom';
      }
      px(card, { left: Math.max(x, 16), top: y });
    }
    function show() {
      const c = list[n];
      card.querySelector('h2').textContent = c.title;
      card.querySelector('p').textContent = c.text;
      card.querySelector('.tr_count').textContent = `${n + 1} of ${list.length}`;
      card.querySelector('.tr_next').textContent = n === list.length - 1 ? 'Start listening' : 'Next';
      card.querySelector('.tr_skip').hidden = n === list.length - 1;
      root.dataset.trTurn = parts().turn;
      root.classList.toggle('tr_seek', c.demo === 'seek');
      root.classList.toggle('tr_hue', c.demo === 'hue');
      place();
      card.querySelector('h2').focus({ preventScroll: true });
    }
    function end() {
      root.classList.remove('tr_seek', 'tr_hue');
      delete root.dataset.trTurn;
      removeEventListener('resize', place);
      el.remove();
    }
    card.querySelector('.tr_next').addEventListener('click', () => (n === list.length - 1 ? end() : (n++, show())));
    card.querySelector('.tr_skip').addEventListener('click', end);
    card.addEventListener('keydown', (e) => { if (e.key === 'Escape') end(); });
    addEventListener('resize', place);
    show();
  }

  window.startTour = start;
})();
