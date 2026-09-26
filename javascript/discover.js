// ACRUX Discover (library.html?view=discover…): free music from Jamendo, Audius, the Internet Archive and YouTube, with
// iTunes previews as a last resort, through the server's Discover API (api/discover.js). The side panel's search opens it.
//   &q=…&tab=all|songs|albums|artists|youtube   search results (no q: For you, what's popular, and trending on YouTube)
//   &album=jamendo:123 · &album=archive:<item>   an album page (the library album page's layout)
//   &artist=audius:45 · &artist=archive:<name>   an artist page
//   &mine=1                                      your songs (Discover songs you've played): the library's Recently Added
//   …&song=<id>                                  on an album page or your songs: scrolls to that song and plays it
// Each source is asked on its own and drawn as it answers; Songs, Albums and Artists load more as you scroll.
// Discover songs play on the record like any song: their lists go to CATALOG.addList, so player.js's
// [data-song]/[data-list] clicks, the queue and its prefetch work unchanged. YouTube plays only in this page's video
// card (YouTube's rules: visible, at least 200×200, no background play), so leaving the page stops it.
(() => {
  const root = document.getElementById('library');
  const params = new URLSearchParams(location.search);
  if (!root || params.get('view') !== 'discover') return;
  const q = (params.get('q') || '').trim();
  const TABS = { all: 'All', songs: 'Songs', albums: 'Albums', artists: 'Artists', youtube: 'YouTube' };
  const tab = TABS[params.get('tab')] ? params.get('tab') : 'all';
  const split = (v) => { const i = (v || '').indexOf(':'); return i > 0 ? [v.slice(0, i), v.slice(i + 1)] : null; };
  const albumRef = split(params.get('album'));
  const artistRef = split(params.get('artist'));
  const mineView = params.has('mine'); // your songs: the library's Recently Added
  // Full songs first; iTunes only fills in what none of them has.
  const SOURCES = q ? ['jamendo', 'audius', 'archive', 'itunes'] : ['jamendo', 'audius'];

  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const enc = encodeURIComponent;
  const ic = (name) => `<i class="icon icon-${name}" aria-hidden="true"></i>`;
  const time = (sec) => (sec ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}` : '');
  const BADGE = { jamendo: 'Jamendo', archive: 'Archive', audius: 'Audius', itunes: 'Preview', youtube: 'YouTube', library: 'Library' };
  const NAME = { jamendo: 'Jamendo', archive: 'the Internet Archive', audius: 'Audius' };
  const PLACEHOLDER = `${SITE}playback_tree/placeholder.svg`;
  const link = (query) => CATALOG.page(`view=discover${query ? `&${query}` : ''}`);
  const at = (kind, source, id) => (NAME[source] && id ? link(`${kind}=${enc(`${source}:${id}`)}`) : null);
  const tabLink = (t) => link([q && `q=${enc(q)}`, t !== 'all' && `tab=${t}`].filter(Boolean).join('&'));
  const bare = (s) => String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]/g, '');
  const songKey = (r) => `${bare(r.artist)}|${bare(r.title)}`; // "the same song" across sources

  // Streaming quality, remembered. A song reads it each time it loads (its src getter); switching reloads the song
  // playing now at the same spot.
  const TIERS = { low: 'Low · 96 kbps MP3, saves data', medium: 'Medium · about 200 kbps MP3', high: 'High · lossless FLAC where the source has it, larger downloads' };
  const quality = CATALOG.quality;

  // An API result -> a song the player, queue, ⋯ tray and taste report understand (catalog.js; `result` is reported).
  const found = new Map(); // id -> song, for the ⋯ buttons
  function song(r) {
    const s = CATALOG.fromResult(r);
    if (s) found.set(s.id, s);
    return s;
  }
  const picture = (params) => `${SITE}discover/image?${new URLSearchParams(params)}`; // found by name (api/images.js)

  const img = (src, alt) => `<img alt="" loading="lazy" src="${esc(src || PLACEHOLDER)}"${alt ? ` data-alt="${esc(alt)}"` : ''}>`;
  const badges = (r) => `<span class="dc_badge">${BADGE[r.source]}</span>${r.community ? '<span class="dc_badge" title="Uploaded by an Internet Archive user">Community</span>' : ''}`;
  const cell = (text, href) => (href ? `<a class="pl_cell dc_link" href="${esc(href)}">${esc(text)}</a>` : `<span class="pl_cell">${esc(text)}</span>`);
  // A song row. Its source badges sit on a small line under the title, so the title keeps the width; on an album or
  // artist page (plain), where every song comes from the same place (the header says so), there are none.
  const row = (s, plain = false) => `<li class="pl_row" data-id="${esc(s.id)}">
      <button class="pl_fav" aria-disabled="true" aria-label="Favorite · coming soon">${ic('heart')}</button>
      <span class="pl_song"><span class="pl_thumb">${img(s.cover, s.alt)}</span><span class="dc_titles"><button class="pl_play" data-song="${esc(s.id)}" title="${esc(s.title)}">${esc(s.title)}</button>${plain ? '' : `<span class="dc_badges">${badges(s.result)}</span>`}</span></span>
      ${cell(s.artist, s.artistHref)}${cell(s.albumTitle, s.albumHref)}
      <span class="pl_dl"></span>
      <span class="pl_time">${s.time}</span>
      <button class="pl_more" data-more="${esc(s.id)}" aria-label="More">${ic('ellipsis')}</button></li>`;
  const songCard = (s) => `<li><button class="song_items card" data-song="${esc(s.id)}">${img(s.cover, s.alt)}<span class="card_label">${esc(s.title)}</span></button></li>`;
  const albumCard = (a) => `<li><a class="al" href="${esc(at('album', a.source, a.id))}"><span class="al_art"><span class="al_rec"></span>${img(a.artworkUrl, a.artworkAlt)}</span>
      <span class="al_t">${esc(a.title)}</span><span class="al_a">${esc(a.artist)}${a.year ? ` · ${esc(a.year)}` : ''}</span></a></li>`;
  const artistCard = (a) => `<li><a class="al dc_ar" href="${esc(at('artist', a.source, a.id) || link(`q=${enc(a.name)}`))}"><span class="al_art">${img(a.artworkUrl || picture({ artist: a.name }))}</span>
      <span class="al_t">${esc(a.name)}</span><span class="al_a">${a.source ? BADGE[a.source] : 'Discover'}</span></a></li>`;
  const videoRow = (v, i) => `<li class="pl_row" data-video-row="${i}">
      <span class="pl_fav"></span>
      <span class="pl_song"><span class="pl_thumb">${img(v.artworkUrl)}</span><span class="dc_titles"><button class="pl_play" data-video="${i}" title="${esc(v.title)}">${esc(v.title)}</button><span class="dc_badges"><span class="dc_badge">YouTube</span></span></span></span>
      <span class="pl_cell">${esc(v.artist)}</span><span class="pl_cell">${esc(v.album || '')}</span>
      <span class="pl_dl"></span>
      <span class="pl_time">${time(v.durationSec)}</span><span></span></li>`;
  const head = (title, t, href = t && tabLink(t)) => `<div class="dc_head"><h2>${title}</h2>${href ? `<a href="${esc(href)}">See all ${ic('chevron-right')}</a>` : ''}</div>`;
  const note = (text) => `<p class="pl_empty">${esc(text)}</p>`;

  const bar = (back) => `
    <div class="pl_bar">
      <a class="round" href="${esc(back)}" data-back aria-label="Back">${ic('chevron-left')}</a>
      <div class="pl_tools dc_q">
        <span class="dc_label" id="dc_q_label">Quality</span>
        <div class="pill dc_pill" role="group" aria-labelledby="dc_q_label">
          ${Object.keys(TIERS).map((t) => `<button class="tool" data-tier="${t}" aria-pressed="${t === quality()}" title="${TIERS[t]}">${t[0].toUpperCase()}${t.slice(1)}</button>`).join('')}
        </div>
        <span class="lib_muted dc_q_note"></span>
      </div>
    </div>`;

  // The API answers JSON; anything else (GitHub Pages, a plain file server) means the ACRUX server isn't behind the page.
  const api = async (path) => {
    const res = await fetch(`${SITE}discover/${path}`);
    if (!res.headers.get('content-type')?.includes('json')) throw new Error('no server');
    return res.json();
  };
  let offlineShown = false;
  const offline = () => {
    if (offlineShown) return;
    offlineShown = true;
    root.querySelectorAll('.dc_sec, .pl_hero, .dc_notes, .dc_foryou').forEach((s) => s.remove());
    root.insertAdjacentHTML('beforeend', note('Discover needs the ACRUX server, so it can’t run on this static copy. Run “node server.js” and open the site from there.'));
  };
  // Results render once the player exists (they need its globals), however fast the API answers.
  const ready = new Promise((done) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', done) : done()));
  const load = (path) => Promise.all([api(path), ready]).then(([body]) => body);
  const shownErrors = new Set();
  const problem = (text) => {
    if (!text || shownErrors.has(text)) return;
    shownErrors.add(text);
    root.querySelector('.dc_notes')?.insertAdjacentHTML('beforeend', note(text));
  };

  // A list of songs to play: registered with the catalog, so the player plays it like an album.
  const songList = (key, results, plain = false) => {
    CATALOG.addList(key, results.map(song).filter(Boolean));
    return `<ol class="pl_list" data-list="${esc(key)}">${CATALOG.list(key).map((s) => row(s, plain)).join('')}</ol>`;
  };

  // ---------- relevance ----------

  // Your songs (Discover songs you've played): they come first in a search, and "Recently Added" lists them.
  const yours = fetch(`${SITE}api/songs`).then((res) => (res.headers.get('content-type')?.includes('json') ? res.json() : { songs: [] }))
    .then((b) => b.songs || [], () => []);
  let yourIds = new Set();
  yours.then((mine) => { yourIds = new Set(mine.map((r) => `${r.source}:${r.id}`)); });
  const wordsOf = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/\(.*?\)|\[.*?\]/g, ' ').split(/[^a-z0-9]+/).filter(Boolean);
  const qWords = wordsOf(q);
  const whole = (text) => { const w = wordsOf(text); return qWords.length > 0 && qWords.every((x) => w.includes(x)); };
  // A name matches when it has every word of the search as a whole word ("Saibo Shreya Ghoshal", not "NOOBSAIBOT").
  const relevant = (name) => bare(name) === bare(q) || whole(name);
  // How well a song answers the search: yours first, then the title, then the artist, then all its words (title, artist,
  // album and tags) together; free full songs (the Archive first) over the rest; previews always last. A song matching
  // nowhere is left out: name fragments ("CryptoSaibot" for "saibo") count for nothing.
  const isYours = (r) => !!r.plays || yourIds.has(`${r.source}:${r.id}`);
  function matches(r) { // how well its words answer the search: 0 = not at all
    let n = 0;
    if (bare(r.title) === bare(q)) n += 60;
    else if (whole(r.title)) n += 40;
    if (bare(r.artist) === bare(q)) n += 50;
    else if (whole(r.artist)) n += 30;
    else if (!n && whole(`${r.title} ${r.artist} ${r.album || ''} ${[...(r.tags?.genres || []), ...(r.tags?.kinds || [])].join(' ')}`)) n += 20;
    return n;
  }
  function score(r) {
    if (!q) return 0;
    const n = (isYours(r) ? 1000 : 0) + matches(r) + ({ archive: 3, jamendo: 2, audius: 1 }[r.source] || 0);
    return r.preview && !isYours(r) ? n - 2000 : n; // a preview you've played is still yours: it stays up top
  }

  // ---------- YouTube ----------

  // An artist's YouTube catalogue (their Topic channel: a few quota units, then free for a week) when the search is an
  // artist MusicBrainz knows; else trending (no search) or, on a tap, a search (101 units, about 99 a day).
  let videos = [];
  let current = -1;
  let yt = null; // the video card's player, once made (a promise)
  let ytCatalog = Promise.resolve();
  const ytSection = (limit) => `
    <section class="dc_sec dc_yt" data-limit="${limit}">
      <div class="dc_head"><h2>${q ? 'YouTube' : 'Trending on YouTube'}</h2>${tab === 'all' ? `<a href="${esc(tabLink('youtube'))}">See all ${ic('chevron-right')}</a>` : ''}</div>
      <div class="dc_card" hidden><div></div></div>
      <ol class="pl_list dc_videos"><li>${note('Loading…')}</li></ol>
      <p class="lib_muted dc_quota"></p>
    </section>`;
  function showVideos(body, title) {
    const sec = root.querySelector('.dc_yt');
    if (!sec) return;
    if (body.quota) sec.querySelector('.dc_quota').textContent = `≈ ${body.quota.searchesLeft} YouTube searches left today`;
    if (title) sec.querySelector('h2').textContent = title;
    if (body.error) return (sec.querySelector('.dc_videos').innerHTML = `<li>${note(body.error)}</li>`);
    videos = (body.results || []).slice(0, Number(sec.dataset.limit) || undefined);
    sec.querySelector('.dc_videos').innerHTML = videos.length ? videos.map(videoRow).join('') : `<li>${note(`Nothing on YouTube for “${q}”.`)}</li>`;
  }
  function searchButton() {
    root.querySelector('.dc_videos').innerHTML = `<li class="dc_go"><button class="pl_playall" data-act="youtube">${ic('play')}Search YouTube for “${esc(q)}”</button><span class="lib_muted">Each search uses one of about 99 a day.</span></li>`;
  }
  async function searchVideos() {
    root.querySelector('.dc_videos').innerHTML = `<li>${note('Searching YouTube…')}</li>`;
    let body;
    try { body = await load(`youtube?q=${enc(q)}`); } catch { body = { error: 'YouTube needs the ACRUX server.' }; }
    showVideos(body);
  }
  function loadVideos() {
    if (!root.querySelector('.dc_yt')) return;
    const failed = () => showVideos({ error: 'YouTube needs the ACRUX server.' });
    if (!q) return load('youtube').then((body) => showVideos(body), failed);
    ytCatalog = load(`youtube?artist=${enc(q)}`).then((body) => {
      if (body.results?.length) {
        body.results.forEach((r) => fullKeys.add(songKey(r)));
        showVideos(body, `${body.artist} on YouTube · ${body.results.length} songs`);
      } else if (tab === 'youtube') searchVideos(); // opening the YouTube tab is the tap
      else searchButton();
    }, failed);
  }
  const ytApi = () => (window.YT?.Player ? Promise.resolve(window.YT) : (window.ytReady ??= new Promise((resolve, reject) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { window.ytReady = null; reject(new Error('The YouTube player didn’t load.')); };
    document.head.append(script);
  })));
  // Watching a video counts for your taste too: the seconds it played, reported when it stops or changes.
  let since = 0;
  let heard = 0;
  function heardVideo(v) {
    if (since) heard += (performance.now() - since) / 1000;
    since = 0;
    if (v && heard >= 1) navigator.sendBeacon?.(`${SITE}api/plays`, JSON.stringify({ song: v, listenedSec: Math.round(heard), durationSec: v.durationSec }));
    heard = 0;
  }
  function onState(e) {
    const S = window.YT.PlayerState;
    if (e.data === S.PLAYING) {
      since = performance.now();
      if (!music.paused) document.getElementById('master_play').click(); // pause the record (and its icon)
    } else if (since) {
      heard += (performance.now() - since) / 1000;
      since = 0;
    }
    if (e.data === S.ENDED) {
      heardVideo(videos[current]);
      if (videos[current + 1]) e.target.cueVideoById(videos[++current].playback.videoId); // cued, not played
    }
  }
  async function playVideo(i) {
    heardVideo(videos[current]);
    current = i;
    const box = root.querySelector('.dc_card');
    box.hidden = false;
    root.querySelectorAll('[data-video-row]').forEach((li) => li.classList.toggle('dc_on', Number(li.dataset.videoRow) === i));
    const { videoId } = videos[i].playback;
    try {
      const YT = await ytApi();
      if (yt) return (await yt).loadVideoById(videoId);
      yt = new Promise((done) => new YT.Player(box.firstElementChild, {
        videoId, playerVars: { autoplay: 1, playsinline: 1, rel: 0 }, events: { onReady: (e) => done(e.target), onStateChange: onState },
      }));
    } catch (err) {
      root.querySelector('.dc_videos').insertAdjacentHTML('beforebegin', note(err.message));
    }
  }

  // ---------- one kind from every source ----------

  // Fills `holder` (a song list, or an album / artist grid or row) from every source as each answers. iTunes previews
  // come after the full sources (and YouTube's catalogue), without the songs they already have. Songs by an artist
  // matching the search go to the top (a source that answers first with loose matches doesn't bury them), and a capped
  // row gives each source its share. With `scroll`, the next pages load as the end of the list comes near (the
  // "Loading more…" line right after it).
  const fullKeys = new Set(); // songs a full source (or YouTube) has, so their previews are left out
  function feed(kind, holder, { cap = Infinity, scroll = false } = {}) {
    const key = holder.dataset.list;
    if (kind === 'songs') CATALOG.addList(key, []);
    // A song search also looks through the albums you've opened (the Archive can't search the songs inside albums).
    const sources = kind === 'songs' && q ? ['seen', ...SOURCES] : SOURCES;
    const state = Object.fromEntries(sources.map((s) => [s, { n: 0, more: kind === 'songs' || s !== 'itunes', busy: false }]));
    const seen = new Set();
    const share = Number.isFinite(cap) ? Math.ceil(cap / sources.length) : Infinity;
    let count = 0;
    const add = (source, results) => {
      let fresh = results.filter((r) => !seen.has(`${r.source}:${r.id}`));
      if (kind === 'songs' && source === 'itunes') fresh = fresh.filter((r) => !fullKeys.has(songKey(r)));
      if (q && kind !== 'songs') fresh = fresh.filter((r) => relevant(r.name || r.title) || (kind === 'albums' && relevant(r.artist))); // not "NOOBSAIBOT" for "saibo"
      if (kind === 'songs' && q) fresh = fresh.filter((r) => matches(r) || isYours(r)); // it answers the search somewhere
      if (kind === 'songs') fresh.sort((a, b) => score(b) - score(a));
      fresh = fresh.slice(0, Math.min(share, cap - count));
      if (!fresh.length) return;
      count += fresh.length;
      for (const r of fresh) {
        seen.add(`${r.source}:${r.id}`);
        if (kind === 'songs' && source !== 'itunes') fullKeys.add(songKey(r));
      }
      if (kind === 'songs') {
        // Each song goes in by relevance (score), after those that score the same: the list and the rows stay in step.
        const list = CATALOG.list(key);
        for (const s of fresh.map(song).filter(Boolean)) {
          const at = list.findIndex((x) => score(x.result) < score(s.result));
          const i = at < 0 ? list.length : at;
          list.splice(i, 0, s);
          const after = holder.children[i];
          if (after) after.insertAdjacentHTML('beforebegin', row(s));
          else holder.insertAdjacentHTML('beforeend', row(s));
        }
        if (listKey === key) setList(list, key); // playing this list: the queue follows (it keeps the song playing)
        mark();
        if (holder.classList.contains('dc_songs')) artistsOf(fresh);
      } else if (holder.classList.contains('dc_artists')) {
        fresh.forEach((r) => fromSources.set(bare(r.name), r));
        return showArtists();
      } else {
        holder.insertAdjacentHTML('beforeend', fresh.map(kind === 'albums' ? albumCard : artistCard).join(''));
      }
      holder.closest('.dc_sec').hidden = false;
    };
    const next = (source) => {
      const st = state[source];
      if (!st.more || st.busy || count >= cap) return Promise.resolve();
      st.busy = true;
      st.n++;
      return load(`search?q=${enc(q)}&source=${source}&kind=${kind}&page=${st.n}${scroll ? '' : '&warm=0'}`).then((r) => {
        problem(r.error);
        st.more = r.more;
        add(source, r.results);
      }, (err) => {
        st.more = false;
        if (err.message === 'no server') offline();
      }).finally(() => { st.busy = false; });
    };
    // Your own songs that match go in first, before any source answers (and whether or not one returns them).
    const first = kind === 'songs' && q ? yours.then((mine) => add('yours', mine.filter((r) => matches(r)))) : Promise.resolve();
    const round = () => {
      const full = Promise.allSettled(sources.filter((s) => s !== 'itunes').map(next));
      if (kind !== 'songs' || !state.itunes) return full;
      const youtube = Promise.race([ytCatalog, new Promise((done) => setTimeout(done, 3000))]); // its songs aren't previewed either
      return full.then(() => youtube).then(() => next('itunes'));
    };
    const firstRound = first.then(round).then(() => count);
    if (!scroll) return firstRound;
    const flag = holder.nextElementSibling; // the "Loading more…" line
    const io = new IntersectionObserver(async ([entry]) => {
      if (!root.isConnected) return io.disconnect();
      if (!entry.isIntersecting || Object.values(state).some((st) => st.busy)) return;
      if (!Object.values(state).some((st) => st.more)) {
        io.disconnect();
        flag.textContent = count ? 'That’s everything.' : '';
        return;
      }
      await round();
      io.unobserve(flag); // observing again reports at once if the end is still in view
      io.observe(flag);
    }, { rootMargin: '0px 0px 900px' });
    firstRound.then((n) => {
      if (!n && !Object.values(state).some((st) => st.more)) {
        const sec = holder.closest('.dc_sec');
        sec.innerHTML = note(q ? `No ${kind} found for “${q}”.` : `No ${kind} to show right now.`);
        sec.hidden = false;
      } else io.observe(flag);
    });
    return firstRound;
  }

  // The All tab's Artists row, ranked and rebuilt as results arrive, one card per name:
  //   an artist search ("Shreya Ghoshal"): that artist first (their own page where a source has one), then who they're
  //     credited with; uploaders who only name them in a title don't count;
  //   a song search ("saibo"): the artists credited on the songs whose title matches;
  //   then the sources' own artists. Their names are split like credits too (the Archive's "creator" is free text:
  //     "Atif Aslam, Shreya Ghoshal, Sachin Gupta"); in an artist search only that artist and their co-credits stay.
  const credits = (r) => String(r.artist).split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\/|\s-\s)\s*/i).map((n) => n.trim())
    .filter((n) => n && !/^unknown artist$/i.test(n) && !/www\.|\.com\b/i.test(n));
  const fromSources = new Map(); // bare name -> artist result
  const songsSoFar = [];
  function showArtists() {
    const row = root.querySelector('.dc_artists');
    if (!row || !q) return;
    const ranked = new Map(); // bare name -> { data, rank }; an artist with a page beats a bare name
    const offer = (data, rank) => {
      const key = bare(data.name);
      if (!key) return;
      const had = ranked.get(key);
      const keep = had && (had.data.source || !data.source) ? had.data : data;
      const name = [data.name, had?.data.name].find((n) => n && /[A-Z]/.test(n)) || data.name; // "Radiohead" over "radiohead"
      ranked.set(key, { rank: Math.max(rank, had?.rank ?? 0), data: { ...keep, name } });
    };
    const target = bare(q);
    const theirs = songsSoFar.filter((r) => credits(r).some((n) => bare(n) === target));
    const sources = [...fromSources.values()];
    const artistSearch = theirs.length > 0 || sources.some((a) => credits({ artist: a.name }).some((n) => bare(n) === target));
    if (theirs.length) {
      offer({ name: credits(theirs[0]).find((n) => bare(n) === target) }, 100);
      theirs.flatMap(credits).forEach((n) => offer({ name: n }, 50));
    } else if (!artistSearch) {
      songsSoFar.filter((r) => whole(r.title)).flatMap(credits).forEach((n) => offer({ name: n }, 30));
    }
    for (const a of sources) {
      const names = credits({ artist: a.name });
      if (bare(a.name) === target) offer(a, 100); // exactly the artist searched for: their own page
      else if (names.some((n) => bare(n) === target)) names.forEach((n) => offer({ name: n }, bare(n) === target ? 100 : 40));
      else if (!artistSearch) names.forEach((n) => offer(names.length === 1 ? a : { name: n }, 20));
    }
    const top = [...ranked.values()].sort((a, b) => b.rank - a.rank).slice(0, 16);
    row.innerHTML = top.map((x) => artistCard(x.data)).join('');
    row.closest('.dc_sec').hidden = !top.length;
  }
  function artistsOf(results) {
    songsSoFar.push(...results.filter((r) => !r.preview));
    showArtists();
  }

  // ---------- For you (no search) ----------

  const chip = (text, href, icon) => `<a class="dc_chip" href="${esc(href)}">${icon ? ic(icon) : ''}${esc(text)}</a>`;
  function chips(p) {
    return [
      ...p.genres.slice(0, 4).map((g) => chip(g.name, link(`q=${enc(g.name)}`))),
      ...p.kinds.slice(0, 3).map((k) => chip(k.name, link(`q=${enc(k.name)}`))),
      ...p.artists.slice(0, 3).map((a) => chip(a.name, at('artist', a.source, a.id) || link(`q=${enc(a.name)}`), 'mic')),
      ...p.albums.slice(0, 2).map((a) => chip(a.name, at('album', a.source, a.id) || link(`q=${enc(a.name)}`), 'disc')),
    ].join('');
  }
  async function forYou() {
    const sec = root.querySelector('.dc_foryou');
    let body;
    try { body = await load('foryou'); } catch { return sec.remove(); }
    const t = body.taste;
    if (!t?.plays) return sec.remove();
    sec.innerHTML = `
      <section class="dc_sec dc_taste">
        <div class="dc_head"><h2>Your taste</h2><span class="lib_muted">from ${t.plays} listen${t.plays === 1 ? '' : 's'}</span></div>
        ${t.recent.genres.length || t.recent.artists.length ? `<div class="dc_chips"><span class="dc_label">Lately</span>${chips(t.recent)}</div>` : ''}
        <div class="dc_chips"><span class="dc_label">All-time</span>${chips(t.allTime)}</div>
      </section>
      ${body.rows.map((r, i) => {
        if (r.artists) return `<section class="dc_sec">${head(esc(r.title))}<ul class="row-1">${r.artists.map(artistCard).join('')}</ul></section>`;
        const key = `discover:foryou:${i}`;
        CATALOG.addList(key, r.songs.map(song).filter(Boolean)); // a video you watched plays on YouTube, not here
        if (!CATALOG.list(key).length) return '';
        return `<section class="dc_sec">${head(esc(r.title))}${r.note ? `<p class="lib_muted">${esc(r.note)}</p>` : ''}<ul class="row-1" data-list="${esc(key)}">${CATALOG.list(key).map(songCard).join('')}</ul></section>`;
      }).join('')}`;
    mark();
  }

  // ---------- pages ----------

  function searchPage() {
    const intro = q ? 'Songs, albums and artists from Jamendo, Audius, the Internet Archive and YouTube, with iTunes previews for the rest.'
      : 'Picked from what you listen to, what’s popular on Jamendo and Audius this week, and trending on YouTube.';
    const tabs = Object.entries(TABS).map(([t, label]) => `<a class="tool" href="${esc(tabLink(t))}"${t === tab ? ' aria-current="page"' : ''}>${label}</a>`).join('');
    const kindSection = (kind) => `<section class="dc_sec dc_kind" hidden>${kind === 'songs'
      ? `<ol class="pl_list" data-list="${esc(`discover:songs:${q}`)}"></ol>` : '<ul class="al_grid"></ul>'}<p class="pl_empty dc_more">Loading more…</p></section>`;
    const body = {
      all: `${q ? '' : `<div class="dc_foryou">${note('Looking at what you listen to…')}</div>`}
        <section class="dc_sec" id="dc_similar" hidden></section>
        <section class="dc_sec" hidden>${head('Artists', 'artists')}<ul class="row-1 dc_artists"></ul></section>
        <section class="dc_sec" hidden>${head('Albums', 'albums')}<ul class="row-1 dc_albums"></ul></section>
        <section class="dc_sec" hidden>${head(q ? 'Songs' : 'Popular this week', 'songs')}<ol class="pl_list dc_songs" data-list="${esc(`discover:all:${q}`)}"></ol></section>
        ${ytSection(8)}`,
      songs: `<section class="dc_sec" id="dc_similar" hidden></section>${kindSection('songs')}`,
      albums: kindSection('albums'),
      artists: kindSection('artists'),
      youtube: ytSection(0),
    }[tab];
    root.innerHTML = `${bar(`${SITE}index.html`)}
      <section class="pl_info">
        <span class="kicker">Discover</span>
        <h1>${q ? `“${esc(q)}”` : 'For you'}</h1>
        <p class="lib_muted">${intro}</p>
        <nav class="pill dc_pill dc_tabs" aria-label="Show">${tabs}</nav>
      </section>
      <div class="dc_notes"></div>
      ${body}`;
    document.title = `${q ? `${q} · ` : ''}Discover – ACRUX`;

    loadVideos();
    if (tab === 'all') {
      if (!q) forYou();
      Promise.all([
        feed('artists', root.querySelector('.dc_artists'), { cap: 16 }),
        feed('albums', root.querySelector('.dc_albums'), { cap: 16 }),
        feed('songs', root.querySelector('.dc_songs'), { cap: 20 }),
      ]).then((counts) => {
        if (q && !counts.some(Boolean)) problem(`Nothing on Jamendo, Audius or the Internet Archive for “${q}”. Try YouTube below.`);
      });
    } else if (tab !== 'youtube') {
      feed(tab, root.querySelector('.dc_kind .pl_list, .dc_kind .al_grid'), { scroll: true });
    }
  }

  // Play a page's list from the top, or shuffled (as the library pages do).
  function start(key, shuffled) {
    const shuffle = document.getElementById('shuffle');
    setList(CATALOG.list(key), key);
    if (shuffle.classList.contains('clicked') !== shuffled) shuffle.click();
    const n = shuffled ? upNext() : -1;
    playAt(n >= 0 ? n : shuffled ? Math.floor(Math.random() * songs.length) : 0);
  }
  const playButtons = (key, none, more = '') => `<div class="pl_btns">
      <button class="round red" data-act="shuffle" data-key="${esc(key)}" aria-label="Shuffle"${none}>${ic('shuffle')}</button>
      <button class="pl_playall" data-act="play" data-key="${esc(key)}"${none}>${ic('play')}Play</button>${more}</div>`;

  // An album can be saved as your playlist (api/playlists.js; the same album saved again updates it) and downloaded
  // as a ZIP of its songs, each in the best quality its source has.
  let shown = null; // the album on this page: { a, source, id }
  const savedId = (source, id) => `from-${`${source}:${id}`.replace(/[^\w-]+/g, '-')}`.slice(0, 120);
  const savedLink = (pid) => `<a class="round red" href="${esc(CATALOG.page(`view=playlist&id=${pid}`))}" aria-label="Saved to your playlists · open it">${ic('check')}</a>`;
  const albumButtons = (source, id) => `<span class="dc_save"><button class="round red" data-act="save" aria-label="Save as playlist">${ic('plus')}</button></span>
      <a class="round red" href="${esc(`${SITE}api/download?album=${enc(`${source}:${id}`)}`)}" download aria-label="Download all · best quality, as a ZIP">${ic('download')}</a>`;
  async function saveAlbum(button) {
    const { a, source, id } = shown;
    button.setAttribute('aria-disabled', 'true');
    try {
      const res = await fetch(`${SITE}api/playlists`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: a.title, from: `${source}:${id}`, cover: a.artworkUrl, songs: a.tracks }) });
      if (!res.ok) throw new Error(res.status);
      const { id: pid } = await res.json();
      CATALOG.addSaved({ id: pid, title: a.title, cover: a.artworkUrl, from: `${source}:${id}`, songs: a.tracks });
      button.parentElement.innerHTML = savedLink(pid);
    } catch {
      button.removeAttribute('aria-disabled');
      button.setAttribute('aria-label', 'Couldn’t save · try again');
    }
  }
  const onSource = (source, url) => `<a href="${esc(url)}" target="_blank" rel="noopener">on ${NAME[source] || BADGE[source]} ↗</a>`;

  function albumPage([source, id]) {
    root.innerHTML = `${bar(link(''))}${note('Loading…')}`;
    load(`album?source=${enc(source)}&id=${enc(id)}`).then((a) => {
      if (a.error) return (root.querySelector('.pl_empty').textContent = a.error);
      const key = `discover:album:${source}:${id}`;
      const mins = Math.round(a.tracks.reduce((t, r) => t + r.durationSec, 0) / 60);
      const artistLink = at('artist', source, a.artistId);
      root.querySelector('.pl_empty').outerHTML = `
        <section class="pl_hero">
          <div class="pl_cover" style="--lab: var(--accent)"><span class="cv">${img(a.artworkUrl)}</span></div>
          <div class="pl_info">
            <span class="kicker">Album · ${BADGE[source]}${a.community ? ' · Community upload' : ''}</span>
            <h1>${esc(a.title)}</h1>
            <p class="pl_meta">${artistLink ? `<a href="${esc(artistLink)}">${esc(a.artist)}</a>` : esc(a.artist)}${a.year ? ` · ${esc(a.year)}` : ''} · ${onSource(source, a.sourceUrl)}</p>
            <span class="lib_muted">${a.tracks.length} song${a.tracks.length === 1 ? '' : 's'}${a.tracks.length ? ` · ${mins} min` : ''}</span>
            ${playButtons(key, a.tracks.length ? '' : ' aria-disabled="true"', a.tracks.length ? albumButtons(source, id) : '')}
          </div>
        </section>
        ${a.tracks.length ? `<section class="dc_sec"><div class="pl_row pl_head" aria-hidden="true"><span class="pl_fav"></span><span>Song</span><span class="pl_cell">Artist</span><span class="pl_cell">Album</span><span class="pl_dl"></span><span class="pl_time">Time</span><span></span></div>
        ${songList(key, a.tracks, true)}</section>` : note('No playable songs in this album (Discover skips songs over 15 minutes).')}`;
      document.title = `${a.title} – ACRUX`;
      shown = { a, source, id };
      CATALOG.ready.then(() => { // saved before: the button says so and opens the playlist
        const slot = root.querySelector('.dc_save');
        if (slot && CATALOG.playlist(savedId(source, id))) slot.innerHTML = savedLink(savedId(source, id));
      });
      mark();
      reveal();
    }, offline);
  }

  function artistPage([source, id]) {
    root.innerHTML = `${bar(link(''))}${note('Loading…')}`;
    load(`artist?source=${enc(source)}&id=${enc(id)}`).then((r) => {
      if (r.error) return (root.querySelector('.pl_empty').textContent = r.error);
      const { artist: a, albums, tracks } = r;
      const key = `discover:artist:${source}:${id}`;
      root.querySelector('.pl_empty').outerHTML = `
        <section class="pl_hero">
          <div class="pl_cover"><span class="cv dc_round">${img(a.artworkUrl || picture({ artist: a.name }))}</span></div>
          <div class="pl_info">
            <span class="kicker">Artist · ${BADGE[source]}</span>
            <h1>${esc(a.name)}</h1>
            <p class="pl_meta">${albums.length} album${albums.length === 1 ? '' : 's'} · ${onSource(source, a.sourceUrl)} · <a href="${esc(link(`q=${enc(a.name)}`))}">search everywhere</a></p>
            ${playButtons(key, tracks.length ? '' : ' aria-disabled="true"')}
          </div>
        </section>
        ${albums.length ? `<section class="dc_sec">${head('Albums', null, link(`q=${enc(a.name)}&tab=albums`))}<ul class="row-1">${albums.map(albumCard).join('')}</ul></section>` : ''}
        <section class="dc_sec">${head('Top songs')}${tracks.length ? songList(key, tracks, true) : note('No playable songs yet.')}</section>`;
      document.title = `${a.name} – ACRUX`;
      mark();
    }, offline);
  }

  function minePage() {
    root.innerHTML = `${bar(CATALOG.page())}${note('Loading…')}`;
    Promise.all([yours, ready]).then(([mine]) => {
      const key = 'discover:mine';
      root.querySelector('.pl_empty').outerHTML = `
        <section class="pl_info">
          <span class="kicker">My Music</span>
          <h1>Recently Added</h1>
          <p class="lib_muted">Songs you found on Discover and played, newest first. ${mine.length} song${mine.length === 1 ? '' : 's'}.</p>
          ${playButtons(key, mine.length ? '' : ' aria-disabled="true"')}
        </section>
        ${mine.length ? `<section class="dc_sec">${songList(key, mine)}</section>` : note('Songs you play from Discover will show up here.')}`;
      document.title = 'Recently Added – ACRUX';
      mark();
      reveal();
    });
  }

  // A link to a song (&song=): scroll to it, light it up, and play it (unless it's already playing).
  function reveal() {
    const id = params.get('song');
    const button = id && [...root.querySelectorAll('[data-song]')].find((b) => b.dataset.song === id);
    if (!button) return;
    button.closest('li').classList.add('found');
    button.scrollIntoView({ block: 'center' });
    if (!(started && songs[index].id === id)) button.click();
  }

  // After a search, the song you play from it takes the search's place in Recent searches (search.js): next time it's
  // one tap to that song, on its album page or in your songs.
  function rememberSong(s) {
    if (!q || !s.result || !(listKey || '').startsWith('discover:')) return;
    try {
      const saved = JSON.parse(localStorage.getItem('searchHistory')) || [];
      const online = (e) => e?.href && new URL(e.href, location.href).searchParams.get('q')?.toLowerCase() === q.toLowerCase() && !e.mine;
      const entry = { name: s.title, meta: `Song · ${s.artist}`, cover: s.cover, href: CATALOG.songPage(s), mine: true };
      const rest = saved.filter((e) => !online(e) && !(e?.mine && e.href === entry.href));
      localStorage.setItem('searchHistory', JSON.stringify([entry, ...rest].slice(0, 12)));
    } catch {} // private mode: nothing remembered
  }

  // ---------- behaviour ----------

  // The row playing now glows (player.js globals: songs, index, started).
  function mark() {
    const now = started && songs[index].id;
    root.querySelectorAll('[data-id]').forEach((li) => li.classList.toggle('now', li.dataset.id === now));
  }

  // What the chosen quality means, and whether the song playing has other qualities at all (many don't).
  function caption() {
    const s = started && songs[index];
    const single = s?.urls && new Set(Object.values(s.urls)).size === 1;
    root.querySelector('.dc_q_note').textContent = TIERS[quality()] + (single ? ' · the song playing comes in one quality only' : '');
  }
  function setQuality(t) {
    try { localStorage.setItem('quality', t); } catch {} // private mode: stays Medium
    root.querySelectorAll('[data-tier]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tier === t));
    caption();
    const s = started && songs[index];
    if (!s?.urls || s.src === music.src) return; // not a Discover song, or the same file in this quality
    const pos = music.currentTime;
    const playing = !music.paused;
    music.src = s.src;
    const url = music.src;
    music.addEventListener('canplay', () => { if (music.src === url) music.currentTime = pos; }, { once: true });
    if (playing) music.play();
  }

  // More like this: while a Discover list plays a Jamendo song, a row of songs in its genres sits at the top.
  let similarFor = null;
  function similar(s) {
    const sec = root.querySelector('#dc_similar');
    const key = listKey || '';
    if (!sec || !s.jamendoId || s.jamendoId === similarFor || !key.startsWith('discover:') || key.startsWith('discover:similar:')) return;
    similarFor = s.jamendoId;
    api(`similar/${s.jamendoId}`).then((body) => {
      if (similarFor !== s.jamendoId || !body.results?.length) return;
      const list = `discover:similar:${s.jamendoId}`;
      CATALOG.addList(list, body.results.map(song));
      sec.innerHTML = `${head(`More like “${esc(s.title)}”`)}<ul class="row-1" data-list="${esc(list)}">${CATALOG.list(list).map(songCard).join('')}</ul>`;
      sec.hidden = false;
    }).catch(() => {}); // no row, nothing lost
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-more], [data-tier], [data-act], [data-video]');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    if (b.dataset.more) return showTray(found.get(b.dataset.more), b); // more.js
    if (b.dataset.video) return playVideo(Number(b.dataset.video));
    if (b.dataset.tier) return setQuality(b.dataset.tier);
    if (b.dataset.act === 'youtube') return searchVideos();
    if (b.dataset.act === 'save') return saveAlbum(b);
    if (b.dataset.act === 'play' || b.dataset.act === 'shuffle') start(b.dataset.key, b.dataset.act === 'shuffle');
  });

  if (albumRef) albumPage(albumRef);
  else if (artistRef) artistPage(artistRef);
  else if (mineView) minePage();
  else searchPage();

  const onPlay = () => {
    if (!root.isConnected) { // a page nav.js has swapped out: count the video heard there, then stop listening
      heardVideo(videos[current]);
      return music.removeEventListener('play', onPlay);
    }
    mark();
    caption();
    similar(songs[index]);
    rememberSong(songs[index]);
    yt?.then((p) => p.pauseVideo?.());
  };
  ready.then(() => {
    music.addEventListener('play', onPlay);
    mark();
    caption();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && root.isConnected) heardVideo(videos[current]); });
})();
