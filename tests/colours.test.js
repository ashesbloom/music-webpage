// Colours: the controls always show, and the parts set to follow the album cover take its colour (javascript/colours.js).
// node --test tests/colours.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { work, contrast, rgb, PRESETS } = require('../javascript/colours');

const theme = (base, own = {}) => ({ base, ...own });
const record = { on: true, parts: ['record'] };
const shows = (out) => contrast(rgb(out['player-ink']), rgb(out.player));

test('the player bar buttons keep ACRUX’s look, and show on any colours', () => {
  const acrux = work(null, record, null);
  assert.equal(acrux.header, PRESETS.acrux[3]);
  assert.equal(acrux['player-ink'], acrux.header); // dark on the grey bar, as it's always been
  assert.equal(acrux['player-text'], '#ffffff');
  const blackout = work(theme('blackout'), record, null);
  assert.notEqual(blackout['player-ink'], blackout.header); // black on nearly black: not that
  assert.ok(shows(blackout) >= 3);
  const white = work(theme('acrux', { header: '#ffffff', player: '#ffffff' }), record, null);
  assert.ok(shows(white) >= 3);
  assert.equal(white['player-text'], '#111111');
  assert.equal(white['header-text'], '#111111');
});

test('the parts that follow the cover take its colour, and only while that’s on', () => {
  const cover = [200, 40, 40];
  const out = work(null, { on: true, parts: ['record', 'glow', 'header'] }, cover);
  assert.equal(out.glow, '#c82828');
  assert.equal(out.tint, '#c82828');
  assert.notEqual(out.header, PRESETS.acrux[3]); // some of the cover's hue
  assert.equal(out.player, PRESETS.acrux[4]); // not picked: the theme's
  const off = work(null, { on: false, parts: ['record', 'glow'] }, cover);
  assert.equal(off.glow, PRESETS.acrux[2]);
  assert.equal(off.tint, undefined);
  assert.equal(work(null, { on: true, parts: ['glow'] }, null).glow, PRESETS.acrux[2]); // no cover read yet
});
