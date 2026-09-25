// Search panel check: paste into the DevTools console on the home page or a playlist page served by `node server.js`
// (at desktop width, where the right panel is always open).
// Covers the right panel: search history (newest first, no repeats, max 12, top three highlighted, fading after),
// results shown in place of the history while typing, bad stored data, and the empty states (no history, no playlists).
// Logs PASS or FAIL. Puts your own history back afterwards.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const KEY = 'searchHistory';
  const saved = localStorage.getItem(KEY);
  const input = $('#inputbox'), form = $('.search'), section = $('.history'), list = $('.history_list'), playlists = $('.playlists');
  const ok = {}, r = {};
  const stay = (e) => { if (e.target.closest('a')) e.preventDefault(); }; // open results without leaving the page
  addEventListener('click', stay, true);
  const type = async (text) => { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); await wait(50); };
  const shown = (el) => !!el && el.getClientRects().length > 0;
  const underSearch = (el) => el.getBoundingClientRect().top - form.getBoundingClientRect().bottom < 40;
  const names = () => [...list.querySelectorAll('.h_name')].map((n) => n.textContent);
  const open = async (q) => { await type(q); list.querySelector('a').click(); await type(''); };
  const store = (v) => { localStorage.setItem(KEY, typeof v === 'string' ? v : JSON.stringify(v)); return type(''); };

  try {
    // 1. No history: the section is hidden and Playlists move up under the search.
    localStorage.removeItem(KEY);
    await type('');
    ok.emptyHidden = !shown(section) && underSearch(playlists);

    // 2. Typing shows results in the same place, not in a pop-up.
    await type('e');
    r.results = names();
    r.heading = section.querySelector('h5').textContent;
    ok.resultsInPlace = shown(section) && r.heading === 'Results' && r.results.join() === 'Smithereens,Ew,Gimme Love' && !$('.resultbox');
    ok.resultsNoFade = getComputedStyle(section).maskImage === 'none';
    await type('zzz');
    ok.noResults = names().length === 0 && shown(section.querySelector('.h_empty'));

    // 3. Opened results become the history: newest first, a repeat moves to the top instead of doubling.
    for (const q of ['ew', 'run', 'gimme', 'smith', 'day']) await open(q);
    await open('run');
    r.history = names();
    ok.order = r.history.join() === 'Run,Daylight,Smithereens,Gimme Love,Ew' && section.querySelector('h5').textContent === 'Recent searches';

    // 4. Enter opens the first result.
    await type('tick');
    form.requestSubmit();
    await type('');
    ok.enter = names()[0] === 'Tick Tock';

    // 5. The newest three are highlighted, and the list fades out after them.
    const img = (i) => list.querySelectorAll('li img')[i].getBoundingClientRect().height;
    r.coverSizes = [0, 2, 3].map(img);
    ok.topThree = r.coverSizes[0] === 44 && r.coverSizes[1] === 44 && r.coverSizes[2] < 44;
    ok.fades = /linear-gradient/.test(getComputedStyle(section).maskImage);

    // 6. At most 12 are kept.
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `Song ${i}`, href: location.href, cover: '' }));
    await store(many);
    list.querySelector('a').click();
    ok.cap = JSON.parse(localStorage.getItem(KEY)).length === 12;

    // 7. Bad stored data: other sites' links and markup in names are not shown as such; broken JSON is ignored.
    await store([{ name: 'Elsewhere', href: 'https://example.com/', cover: '' }, { name: '<b>bold</b>', href: location.href, cover: '' }]);
    ok.safe = names().join() === '<b>bold</b>' && !list.querySelector('b');
    await store('{broken');
    ok.brokenJson = !shown(section);

    // 8. No playlists: the message shows, right under the search when there is no history either.
    const subs = [...playlists.querySelectorAll('.sub')];
    ok.hasPlaylists = !shown(playlists.querySelector('.empty'));
    subs.forEach((li) => li.remove());
    ok.noPlaylists = shown(playlists.querySelector('.empty')) && underSearch(playlists);
    playlists.querySelector('.nav').append(...subs);
  } finally {
    removeEventListener('click', stay, true);
    saved === null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, saved);
    await type('');
  }

  r.failed = Object.keys(ok).filter((k) => !ok[k]);
  r.pass = r.failed.length === 0;
  console.log(r.pass ? 'PASS' : 'FAIL', r);
  return r;
})();
