// Auto Mix's DJ half: the mix it plans between made-up songs (analysed first), and how it ranks songs for Infinite.
// node --test tests/automix-plan.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../javascript/automix-analyze.js');
const AUTOMIX = require('../javascript/automix.js');
const { song, pad } = require('./automix-songs.js');

const cache = new Map(); // each made-up song is analysed once
const hear = (opts, make = song) => {
  const key = make.name + JSON.stringify(opts);
  if (!cache.has(key)) { const s = make(opts); cache.set(key, analyze(s.left, s.right, s.sr)); }
  return cache.get(key);
};
const barTime = (a, j) => AUTOMIX.timeAt(AUTOMIX.beatList(a), a.downbeat + 4 * j);
const close = (x, y, tol, what) => assert.ok(Math.abs(x - y) <= tol, `${what}: ${x} not within ${tol} of ${y}`);

test('keys that sit together: the same, a step round the wheel, the relative, two steps; a clash; unknown', () => {
  assert.equal(AUTOMIX.harmony('8A', '8A'), 1);
  assert.equal(AUTOMIX.harmony('8A', '9A'), 0.9);
  assert.equal(AUTOMIX.harmony('8A', '8B'), 0.9);
  assert.equal(AUTOMIX.harmony('12B', '2B'), 0.6);
  assert.equal(AUTOMIX.harmony('8B', '2B'), 0.1);
  assert.equal(AUTOMIX.harmony(null, '2B'), 0.7);
  assert.equal(AUTOMIX.shift('8B', 1), '3B'); // C major up a semitone is C# major
});

test('plan: close tempos, same key: a 16-bar blend, B\'s intro under A\'s last phrase, beat-locked', () => {
  const a = hear({}), b = hear({ bpm: 126 });
  const p = AUTOMIX.plan(a, b);
  assert.equal(p.type, 'blend');
  assert.equal(p.bars, 16); // 32 would put A's chords over B's; at 16, A's end just as B's start (the bass swap)
  close(p.aOut, barTime(a, 48), 1e-6, 'out on A\'s last phrase');
  close(p.bIn, barTime(b, 0), 1e-6, 'in on B\'s first bar');
  assert.equal(p.lock, true);
  close(p.ratio, 126 / 124, 0.002, 'A speeds up to B');
  assert.ok(p.pre > 0, 'A glides to B\'s tempo first');
  close(p.handover, p.len / 2, 1e-9, 'handover at the bass swap');
});

test('plan: tempos far apart: echo out (filter when B opens quietly); beatless: fade; albums: gapless', () => {
  const a = hear({});
  assert.equal(AUTOMIX.plan(a, hear({ bpm: 140, intro: 0 })).type, 'echo');
  assert.equal(AUTOMIX.plan(a, hear({ bpm: 140 })).type, 'filter');
  const f = AUTOMIX.plan(a, hear({}, pad));
  assert.equal(f.type, 'fade');
  close(f.aOut, a.end - 4, 1e-6, 'a 4 s fade at the end');
  const g = AUTOMIX.plan(a, hear({ bpm: 126 }), { gapless: true, trimA: 0.5 });
  assert.equal(g.type, 'gapless');
  assert.equal(g.aOut, null);
  assert.equal(g.trimB, 0.5); // an album keeps one level
  assert.equal(AUTOMIX.plan(a, null).type, 'gapless'); // not analysed
});

test('plan: a key clash keeps the blend to 4 bars; busy to the end on both sides: a cut on the downbeat', () => {
  const clash = AUTOMIX.plan(hear({}), hear({ bpm: 126, key: 6 }));
  assert.equal(clash.type, 'blend');
  assert.equal(clash.bars, 4);
  const a = hear({ outro: 64 }); // chords to the last bar, then a cold stop
  assert.equal(a.cold, true);
  const cut = AUTOMIX.plan(a, hear({ bpm: 126, intro: 0 }));
  assert.equal(cut.type, 'cut');
  close(cut.aOut, barTime(a, 64), 1e-6, 'B comes in where A\'s next bar would be');
});

test('plan: a 30-second preview gets a 2 s fade', () => {
  const a = hear({}), preview = { ...hear({ bpm: 126 }), dur: 30, end: 29.5 };
  const p = AUTOMIX.plan(a, preview);
  assert.equal(p.type, 'fade');
  close(p.len, 2, 1e-6, 'fade length');
});

test('plan: nothing starts before `after`', () => {
  const a = hear({}), b = hear({ bpm: 126 });
  const p = AUTOMIX.plan(a, b, { after: 110 });
  assert.ok(p.aOut - p.pre >= 110, `pre-roll starts at ${p.aOut - p.pre}`);
});

test('score and chain: close tempo and key first, unknown songs last', () => {
  const seed = { bpm: 124, camelot: '8B', energy: 0.5 };
  const near = { bpm: 125, camelot: '9B', energy: 0.55 }, far = { bpm: 150, camelot: '2A', energy: 0.2 };
  assert.ok(AUTOMIX.score(seed, near) > AUTOMIX.score(seed, far));
  const known = { far, near };
  assert.deepEqual(AUTOMIX.chain(seed, ['far', 'x', 'near'], (id) => known[id]), ['near', 'far', 'x']);
});

test('plan: half time (B at half A\'s tempo): A has the bars for the whole blend', () => {
  const a = hear({});
  const half = (x) => ({ ...x, bpm: x.bpm / 2, grid: { t0: x.grid.t0 * 2, period: x.grid.period * 2 }, dur: x.dur * 2, start: x.start * 2, end: x.end * 2 });
  const p = AUTOMIX.plan(a, half(hear({ bpm: 126 })));
  assert.equal(p.type, 'blend');
  assert.equal(p.k, 2);
  assert.ok(p.aOut + p.len * p.ratio <= a.end + 0.5, `A runs out: the blend needs A until ${(p.aOut + p.len * p.ratio).toFixed(1)} s, its music ends at ${a.end} s`);
});

// Real songs, not made-up dance tracks: the analyses of four In Rainbows songs (live drums that drift, vocals in most
// bars, a natural fade), as ACRUX made them. Auto Mix has to respect how each song ends.
const RAINBOWS = require('./automix-inrainbows.json');
const barLen = (a) => 4 * 60 / a.bpm;

test('plan, real songs: a song that fades out is mixed inside its own fade', () => {
  const a = RAINBOWS['Down Is The New Up'], b = RAINBOWS.Videotape;
  const p = AUTOMIX.plan(a, b);
  assert.equal(p.type, 'fade', p.summary);
  assert.ok(p.aOut >= a.fade.start && a.end - p.aOut >= 4, `out at ${p.aOut}: inside the fade (${a.fade.start}–${a.end}) with room to overlap`);
});

test('plan, real songs: no blend fits, and the song isn’t cut short', () => {
  const a = RAINBOWS['Jigsaw Falling Into Place'], b = RAINBOWS.Videotape;
  const p = AUTOMIX.plan(a, b);
  assert.ok(p.type !== 'cut' || a.end - p.aOut <= barLen(a), `${p.summary}: ${(a.end - p.aOut).toFixed(1)} s of music cut`);
});

test('plan, real songs: a live-played song isn’t sped up past 4% (its pitch would show)', () => {
  const p = AUTOMIX.plan(RAINBOWS.Videotape, RAINBOWS['Jigsaw Falling Into Place']);
  assert.ok(Math.abs(p.ratio - 1) <= 0.04, p.summary);
});

// Real songs across genres (tests/automix-genres.json: the analyses of Internet Archive songs, their sources listed):
// what a check over 17 genres found wrong.
const GENRES = require('./automix-genres.json');

test('plan, genres: a DJ outro with a synth lead isn’t a last verse: techno is swept out over house’s quiet intro', () => {
  const p = AUTOMIX.plan(GENRES.techno, GENRES.house);
  assert.equal(p.type, 'filter', p.summary);
});

test('plan, genres: a cut waits for the song’s last hit (disco, hip-hop)', () => {
  for (const [x, y] of [['disco', 'reggae'], ['hiphop', 'folk']]) {
    const a = GENRES[x], p = AUTOMIX.plan(a, GENRES[y]);
    assert.ok(p.type !== 'cut' || p.aOut >= a.end - 0.05, `${x} → ${y}: ${p.summary}, music ends ${a.end}`);
  }
});

test('plan, genres: no mix skips a last verse that’s still sung (folk), and none leaves a gap after it', () => {
  const a = GENRES.folk;
  for (const y of ['disco', 'reggae', 'hiphop', 'ballad']) {
    const p = AUTOMIX.plan(a, GENRES[y]);
    const aGone = p.aOut + (p.type === 'blend' ? p.len * p.ratio : 0); // where A's sound ends (a blend: its last bar)
    assert.ok(a.end - aGone <= 2 * barLen(a), `folk → ${y}: ${p.summary}, music ends ${a.end}`); // its last bar may ring under B
    assert.ok(Math.abs(p.ratio - 1) <= 0.04, `folk → ${y}: ${p.summary}: its singing shouldn’t be pitched`);
    assert.ok(!(p.type === 'filter' && p.aOut >= a.end - barLen(a)), `folk → ${y}: a filter after A's music has ended brings B up from silence`);
  }
});
