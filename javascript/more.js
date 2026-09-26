// ACRUX ⋯ tray: actions for a song. The header's ⋯ opens it for the song in the player; showTray(song, button) opens
// it for any other (the library's song rows). It opens beside its button (upwards from the phone's bottom player).
// Uses CATALOG and player.js (songs, index). shareLink() is shared with library.js.
async function shareLink(data, label) {
  try {
    if (navigator.share) return await navigator.share(data);
    await navigator.clipboard.writeText(data.url);
    if (!label) return;
    const was = label.textContent;
    label.textContent = 'Link copied';
    await new Promise((done) => setTimeout(done, 1200));
    label.textContent = was;
  } catch {} // share sheet dismissed, or no clipboard access
}

(() => {
  const btn = document.getElementById('more');
  if (!btn) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="tray" id="more_tray" popover>
      <button aria-disabled="true">Add to Playlist<small>Coming soon</small><i class="icon icon-chevron-right" aria-hidden="true"></i></button>
      <hr>
      <button aria-disabled="true">Add to Favorites<small>Coming soon</small></button>
      <button data-act="info">Get Info</button>
      <hr>
      <a data-act="album">Go to Album</a>
      <a data-act="artist">Go to Artist</a>
      <hr>
      <button data-act="share"><i class="icon icon-share" aria-hidden="true"></i><span>Share</span></button>
    </div>
    <dialog class="song_info" id="song_info" aria-labelledby="info_name" closedby="any">
      <img alt="">
      <h3 id="info_name"></h3>
      <p></p>
      <form method="dialog"><button>Done</button></form>
    </dialog>`);
  const tray = document.getElementById('more_tray');
  const info = document.getElementById('song_info');
  let target = null; // the song showTray() opened it for; null = the one in the player
  let anchor = btn;
  const song = () => target || songs[index];

  window.showTray = (s, el) => {
    target = s;
    anchor = el;
    tray.togglePopover(true);
  };

  const sheet = matchMedia('(max-width: 699px)'); // phones: the tray rises from the bottom instead
  tray.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') {
      target = null;
      anchor = btn;
      return;
    }
    if (sheet.matches) tray.style.top = tray.style.right = tray.style.bottom = ''; // a sheet from the bottom (CSS)
    else {
      const r = anchor.getBoundingClientRect();
      const { clientWidth: w, clientHeight: h } = document.documentElement;
      const up = r.top > h / 2;
      tray.style.top = up ? 'auto' : `${r.bottom + 8}px`;
      tray.style.bottom = up ? `${h - r.top + 8}px` : 'auto';
      // By the button's right edge, but never past the screen's left edge (the width is the CSS one, even while closed).
      tray.style.right = `${Math.max(8, Math.min(w - r.right, w - parseFloat(getComputedStyle(tray).width) - 8))}px`;
    }
    const album = CATALOG.album(song().album);
    tray.querySelector('[data-act=album]').href = CATALOG.page(`view=album&id=${album.id}`);
    tray.querySelector('[data-act=artist]').href = CATALOG.page(`view=artist&id=${album.artist}`);
  });

  tray.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act; // the "Coming soon" items have none
    const s = song();
    const album = CATALOG.album(s.album);
    if (act === 'info') {
      info.querySelector('img').src = s.cover;
      info.querySelector('h3').textContent = s.title;
      info.querySelector('p').textContent = `${s.artist} — ${album.title} · ${s.time}`;
      tray.togglePopover(false);
      info.showModal();
    } else if (act === 'share') {
      await shareLink({ title: `${s.title} — ${s.artist}`, url: CATALOG.page(`view=album&id=${album.id}`) }, tray.querySelector('[data-act=share] span'));
      tray.togglePopover(false);
    }
  });
})();
