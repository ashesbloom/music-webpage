// Keyboard shortcuts: which key asks for what (javascript/keys.js). node --test tests/keys.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { keyAction } = require('../javascript/keys');

const key = (k, more = {}) => ({ key: k, code: '', ...more });

test('keys ask for their actions', () => {
  assert.equal(keyAction(key(' ')), 'playpause');
  assert.equal(keyAction(key('K', { shiftKey: false })), 'playpause'); // Caps Lock on
  assert.equal(keyAction(key('N', { shiftKey: true })), 'next');
  assert.equal(keyAction(key('n')), null);
  assert.equal(keyAction(key('ArrowRight')), 'fwd5');
  assert.equal(keyAction(key('ArrowUp', { shiftKey: true })), 'volup');
  assert.equal(keyAction(key('ArrowUp')), null); // plain arrows up and down scroll the page
  assert.equal(keyAction(key('&', { code: 'Digit5' })), 'pct5'); // AZERTY's 5 key without Shift
  assert.equal(keyAction(key('?', { shiftKey: true })), 'help');
  assert.equal(keyAction(key(undefined)), null); // Chrome's autofill
});

test('Ctrl/⌘ combos only in the desktop app, Alt never', () => {
  assert.equal(keyAction(key('ArrowRight', { metaKey: true }), false), null); // the browser's Back/Forward
  assert.equal(keyAction(key('ArrowRight', { metaKey: true }), true), 'next');
  assert.equal(keyAction(key('ArrowDown', { ctrlKey: true }), true), 'voldown');
  assert.equal(keyAction(key('/', { ctrlKey: true }), false), 'help');
  assert.equal(keyAction(key('t', { ctrlKey: true }), true), null);
  assert.equal(keyAction(key('m', { altKey: true })), null);
});

test('held keys repeat only seeking and volume', () => {
  assert.equal(keyAction(key('k', { repeat: true })), null);
  assert.equal(keyAction(key('ArrowLeft', { repeat: true })), 'back5');
  assert.equal(keyAction(key('ArrowDown', { shiftKey: true, repeat: true })), 'voldown');
});
