// ACRUX in-page navigation, so the music never stops: a link to another page fetches it and swaps in only its middle
// column and side panel. The header player, the record, the queue and the audio carry on. Back and Forward work
// (pushState/popstate). A back button marked [data-back] steps back through that history when there is some,
// otherwise it follows its link. Anything that fails falls back to a normal page load.
(() => {
  const PAGE_SCRIPTS = ['library.js', 'discover.js', 'settings.js', 'home.js', 'rows.js', 'search.js']; // they build the swapped-in part, so they run again
  // The header logo reads "Home" everywhere but the home page, where it's the ACRUX name.
  const logo = document.querySelector('.logo a');
  const label = () => { if (logo) logo.textContent = /\/(index\.html)?$/.test(location.pathname) ? 'ACRUX' : 'HOME'; };
  label();
  let depth = history.state?.acrux ? history.state.depth : 0;
  if (!history.state?.acrux) history.replaceState({ acrux: true, depth }, '');

  // Each page's HTML, fetched once per window: every library view is the same library.html, drawn by its scripts.
  const pages = new Map(); // pathname -> HTML
  // The page scripts' text, fetched once per window too: run from here, a swapped-in page is drawn in the same frame,
  // with no blank moment while they download again.
  const code = new Map(); // script URL -> a promise of its text
  const scriptText = (src) => {
    if (!code.has(src)) {
      code.set(src, fetch(src).then((res) => { if (!res.ok) throw new Error(res.status); return res.text(); })
        .catch((err) => { code.delete(src); throw err; }));
    }
    return code.get(src);
  };
  // stay: keep the page where it's scrolled (the same page drawn again with new data).
  async function go(url, push, stay = false) {
    let doc, scripts, texts;
    try {
      const path = new URL(url, location.href).pathname;
      let html = pages.get(path);
      if (!html) {
        const res = await fetch(url);
        if (!res.ok || !res.headers.get('content-type')?.includes('html')) throw new Error(res.status);
        html = await res.text();
      }
      doc = new DOMParser().parseFromString(html, 'text/html');
      if (!doc.querySelector('.explore') || !doc.getElementById('sidebar')) throw new Error('not an ACRUX page');
      pages.set(path, html);
      scripts = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))
        .filter((src) => PAGE_SCRIPTS.some((name) => src.endsWith(`javascript/${name}`))).map((src) => new URL(src, new URL(url, location.href)).href);
      texts = await Promise.all(scripts.map(scriptText)); // ready before the swap: the old page stays up until then
    } catch {
      location.href = url; // a normal load
      return;
    }
    document.dispatchEvent(new Event('pageleave')); // the page going away stops its requests (discover.js)
    if (push) history.pushState({ acrux: true, depth: ++depth }, '', url);
    // The new URL is in place first, so the swapped-in markup's relative links and images resolve against it.
    document.title = doc.title;
    label();
    for (const key of ['list', 'page']) { // the page's song list, and "home" on the home page
      if (doc.body.dataset[key]) document.body.dataset[key] = doc.body.dataset[key];
      else delete document.body.dataset[key];
    }
    const top = document.querySelector('.explore').scrollTop;
    document.querySelector('.explore').replaceWith(document.adoptNode(doc.querySelector('.explore')));
    const panel = document.getElementById('sidebar');
    const keep = panel.querySelector('.queue');
    [...panel.children].forEach((el) => { if (el !== keep && !el.matches('.menu_close')) el.remove(); });
    [...doc.getElementById('sidebar').children].forEach((el) => {
      if (!el.matches('.menu_close')) panel.insertBefore(document.adoptNode(el), keep);
    });
    document.querySelectorAll(':popover-open').forEach((p) => p.hidePopover()); // the drawer and the ⋯ tray
    scripts.forEach((src, i) => {
      const run = document.createElement('script');
      run.textContent = `${texts[i]}\n//# sourceURL=${src}`; // runs as it's added; errors still name the file
      document.body.append(run);
    });
    if (stay) { // back to where it was once the scripts have drawn it (a second at most)
      const explore = document.querySelector('.explore');
      let frames = 0;
      const hold = () => { explore.scrollTop = top; if (explore.scrollTop < top && frames++ < 60) requestAnimationFrame(hold); };
      requestAnimationFrame(hold);
    } else if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
    else {
      window.scrollTo(0, 0);
      document.querySelector('.explore').scrollTop = 0;
    }
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !url.pathname.endsWith('.html')) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return; // a jump within the page
    e.preventDefault();
    if (a.hasAttribute('data-back') && depth > 0) history.back();
    else go(url.href, true);
  });
  // Draws this page again, e.g. after songs were added (addmore.js), with the music playing on.
  window.navReload = () => go(location.href, false, true);
  window.addEventListener('popstate', (e) => {
    depth = e.state?.depth ?? 0;
    go(location.href, false);
  });
})();
