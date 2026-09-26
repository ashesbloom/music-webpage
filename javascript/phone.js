// ACRUX on phones: the home page is the iPod screen (the record, then the queue, over the rising record pinned to the
// bottom), and every other page shows its content over a mini player that goes back there. This moves the player out
// of the header and the queue out of the side panel into the page, and puts them back above phone width. It also adds
// the rising record's parts (styled in insert.css; turntable.js turns it). Runs after queue.js (it makes #queue).
(() => {
  const phone = matchMedia('(max-width: 699px)');
  const area = document.querySelector('.playbackarea');
  const queue = document.getElementById('queue');
  const deck = document.querySelector('.playback');
  if (!area || !queue || !deck) return;

  // The rising record: the disc, and in the seek bar (so --p reaches them) the groove arc, the curved title and the needle.
  area.insertAdjacentHTML('afterbegin', '<div class="pv_disc"></div>');
  area.querySelector('.play_bar').insertAdjacentHTML('beforeend', `
    <svg class="pv_arc" viewBox="0 0 390 250" aria-hidden="true">
      <defs><path id="pv_t" d="M50 105 A205 205 0 0 1 340 105"/><path id="pv_a" d="M77 109 A184 184 0 0 1 313 109"/></defs>
      <path class="pv_track" d="M13 97 A238 238 0 0 1 377 97"/>
      <path class="pv_prog" pathLength="1" d="M13 97 A238 238 0 0 1 377 97"/>
      <path class="pv_hit" d="M13 97 A238 238 0 0 1 377 97"/>
      <text class="pv_title" text-anchor="middle"><textPath href="#pv_t" startOffset="50%"></textPath></text>
      <text class="pv_artist" text-anchor="middle"><textPath href="#pv_a" startOffset="50%"></textPath></text>
    </svg>
    <span class="pv_needle"></span>`);
  const title = document.getElementById('albumtext');
  const artist = document.getElementById('albumdescription');
  const [curvedTitle, curvedArtist] = area.querySelectorAll('.pv_arc textPath');
  const fit = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s); // the groove holds about this many characters
  const copy = () => {
    curvedTitle.textContent = fit(title.textContent, 26);
    curvedArtist.textContent = fit(artist.textContent, 30);
  };
  copy();
  new MutationObserver(copy).observe(title.parentElement, { subtree: true, childList: true, characterData: true });

  function place() {
    if (phone.matches) deck.after(area, queue);
    else {
      document.querySelector('.logo').after(area);
      document.getElementById('sidebar').append(queue);
    }
  }
  place();
  phone.addEventListener('change', place);

  // The mini player: a tap on it (not on its buttons or seek bar) opens the iPod screen, and the music carries on (nav.js).
  area.addEventListener('click', (e) => {
    if (!phone.matches || document.body.dataset.page === 'home' || e.target.closest('button, input, .play_bar')) return;
    document.querySelector('.logo a').click();
  });

  // Seeking by touch: a press on the groove (the band along the arc, .pv_hit) or on the mini player's bar jumps there,
  // and a drag scrubs. It works the seek input, so seekbar.js follows it and seeks on release. The rest of the rising
  // record still turns (turntable.js), since the press never reaches it.
  const seek = document.getElementById('seek');
  const bar = area.querySelector('.play_bar');
  const CX = 195, CY = 97 + Math.sqrt(238 ** 2 - 182 ** 2); // the groove's centre, in the 390 x 250 stage
  const A0 = Math.atan2(97 - CY, 13 - CX), A1 = Math.atan2(97 - CY, 377 - CX); // its two ends
  function scrub(e) {
    const r = bar.getBoundingClientRect();
    const p = document.body.dataset.page === 'home'
      ? (Math.atan2(e.clientY - r.top - CY, e.clientX - r.left - CX) - A0) / (A1 - A0)
      : (e.clientX - r.left) / r.width;
    seek.value = Math.min(1, Math.max(0, p)) * 100;
    seek.dispatchEvent(new Event('input'));
  }
  bar.addEventListener('pointerdown', (e) => {
    if (!phone.matches || e.button !== 0) return;
    e.stopPropagation(); // not a grab of the record
    try { bar.setPointerCapture(e.pointerId); } catch {}
    bar.classList.add('scrub');
    scrub(e);
  });
  bar.addEventListener('pointermove', (e) => { if (bar.hasPointerCapture(e.pointerId)) scrub(e); });
  // Only the bar's own capture ending is the release: moving a touch's capture here from .pv_hit fires one there too.
  bar.addEventListener('lostpointercapture', (e) => {
    if (e.target !== bar) return;
    bar.classList.remove('scrub');
    seek.dispatchEvent(new Event('change'));
  });
})();
