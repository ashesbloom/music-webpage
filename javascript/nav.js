// ACRUX in-page navigation, so the music never stops: a link to another page fetches it and swaps in only its middle
// column and side panel. The header player, the record, the queue and the audio carry on. Back and Forward work
// (pushState/popstate). A back button marked [data-back] steps back through that history when there is some,
// otherwise it follows its link. Anything that fails falls back to a normal page load.
(() => {
  const PAGE_SCRIPTS = ['library.js', 'rows.js', 'search.js']; // they build the swapped-in part, so they run again
  // The header logo reads "Home" everywhere but the home page, where it's the ACRUX name.
  const logo = document.querySelector('.logo a');
  const label = () => { if (logo) logo.textContent = /\/(index\.html)?$/.test(location.pathname) ? 'ACRUX' : 'HOME'; };
  label();
  let depth = history.state?.acrux ? history.state.depth : 0;
  if (!history.state?.acrux) history.replaceState({ acrux: true, depth }, '');

  async function go(url, push) {
    let doc;
    try {
      const res = await fetch(url);
      if (!res.ok || !res.headers.get('content-type')?.includes('html')) throw new Error(res.status);
      doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      if (!doc.querySelector('.explore') || !doc.getElementById('sidebar')) throw new Error('not an ACRUX page');
    } catch {
      location.href = url; // a normal load
      return;
    }
    if (push) history.pushState({ acrux: true, depth: ++depth }, '', url);
    // The new URL is in place first, so the swapped-in markup's relative links and images resolve against it.
    document.title = doc.title;
    label();
    for (const key of ['list', 'page']) { // the page's song list, and "home" on the home page
      if (doc.body.dataset[key]) document.body.dataset[key] = doc.body.dataset[key];
      else delete document.body.dataset[key];
    }
    document.querySelector('.explore').replaceWith(document.adoptNode(doc.querySelector('.explore')));
    const panel = document.getElementById('sidebar');
    const keep = panel.querySelector('.queue');
    [...panel.children].forEach((el) => { if (el !== keep && !el.matches('.menu_close')) el.remove(); });
    [...doc.getElementById('sidebar').children].forEach((el) => {
      if (!el.matches('.menu_close')) panel.insertBefore(document.adoptNode(el), keep);
    });
    document.querySelectorAll(':popover-open').forEach((p) => p.hidePopover()); // the drawer and the ⋯ tray
    for (const s of doc.querySelectorAll('script[src]')) {
      if (!PAGE_SCRIPTS.some((name) => s.getAttribute('src').endsWith(`javascript/${name}`))) continue;
      const run = document.createElement('script');
      run.src = new URL(s.getAttribute('src'), location.href).href;
      document.body.append(run);
    }
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
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
  window.addEventListener('popstate', (e) => {
    depth = e.state?.depth ?? 0;
    go(location.href, false);
  });
})();
