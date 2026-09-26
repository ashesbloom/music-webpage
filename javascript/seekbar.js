// ACRUX seek bar: follows the song every frame (smooth while playing, and while the record is scratched),
// shows elapsed / total time, and seeks where the thumb is let go. Uses `music` (a DeckAudio).
(() => {
  const bar = document.querySelector('.play_bar');
  const seek = document.getElementById('seek');
  const elapsed = document.getElementById('current_time');
  const total = document.getElementById('end_time');
  if (!bar || !seek || typeof music === 'undefined') return;
  seek.step = 'any'; // whole percents would move a 3-minute song 1.8 s at a time

  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  let dragging = false;
  let shown = -1;

  function frame() {
    const d = music.duration;
    if (isFinite(d)) {
      const t = dragging ? seek.value / 100 * d : music.currentTime;
      const p = t / d;
      if (Math.abs(p - shown) > 1e-6) {
        shown = p;
        bar.style.setProperty('--p', p);
        if (!dragging) seek.value = p * 100;
      }
      const now = clock(t), end = clock(d); // the " / " between them is CSS (none on the phone's iPod screen)
      if (elapsed.textContent !== now) elapsed.textContent = now;
      if (total.textContent !== end) total.textContent = end;
    } else if (shown !== 0) { // a new song is loading
      shown = 0;
      bar.style.setProperty('--p', 0);
      seek.value = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  seek.addEventListener('input', () => { dragging = true; });
  seek.addEventListener('change', () => {
    dragging = false;
    if (isFinite(music.duration)) music.currentTime = seek.value / 100 * music.duration;
  });
})();
