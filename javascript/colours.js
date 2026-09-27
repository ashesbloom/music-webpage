// ACRUX colours: the six a theme sets, the parts that take the playing album cover's colour instead, and the ink for
// what sits on the header and the player bar, picked so the controls show whatever those colours are.
// Kept per device: localStorage.theme (Settings: the preset and your own colours), localStorage.cover ({ on, parts }:
// which parts follow the cover, "record" being the record's lights) and localStorage.coverColour (the last cover's).
// Loaded in each page's <head>, so the colours are on before the page shows; Settings and player.js call paint() when
// one of those changes.
const THEME = (() => {
  const PRESETS = { // name, then accent, highlight, header, player bar, side panel, background
    acrux: ['ACRUX', '#a21e1e', '#f13c3c', '#2b2b2b', '#4d4d4d', '#1d1d1d', '#1f1f1f'],
    midnight: ['Midnight', '#1e4fa2', '#3c8cf1', '#232a36', '#3d4757', '#161b23', '#191e27'],
    forest: ['Forest', '#1e7a45', '#3cd17a', '#26302a', '#414d45', '#171d19', '#1a211c'],
    violet: ['Violet', '#6a1ea2', '#b04cf6', '#2c2533', '#4a3f55', '#1c1722', '#1f1a25'],
    graphite: ['Graphite', '#5c5c5c', '#e0e0e0', '#2b2b2b', '#454545', '#1a1a1a', '#1d1d1d'],
    blackout: ['Blackout', '#a21e1e', '#f13c3c', '#000000', '#0a0a0a', '#000000', '#000000'],
  };
  const PARTS = ['accent', 'glow', 'header', 'player', 'menu', 'explore'];
  const HEX = /^#[0-9a-f]{6}$/i;
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const hex = (c) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, w) => a.map((v, i) => v + (b[i] - v) * w); // w of b
  const read = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };

  // WCAG contrast: 1 (the same colour) to 21 (black on white).
  const lum = (c) => c.map((v) => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const clearest = (bg, ...inks) => inks.reduce((a, b) => (contrast(bg, rgb(b)) > contrast(bg, rgb(a)) ? b : a));

  // What each part takes from the cover's colour (player.js: its most vivid hue, lifted to read on black): the highlight
  // is it, the accent a deeper tone of it, and the panels keep their own darkness with some of its hue.
  const FROM_COVER = {
    glow: (c) => c,
    accent: (c) => c.map((v) => v * 0.67),
    header: (c, own) => mix(own, c, 0.22),
    player: (c, own) => mix(own, c, 0.28),
    menu: (c, own) => mix(own, c, 0.12),
    explore: (c, own) => mix(own, c, 0.12),
  };

  // Which parts follow the cover: on, with the record, unless Settings says otherwise.
  const follow = () => {
    const f = read('cover');
    return { on: f?.on !== false, parts: Array.isArray(f?.parts) ? f.parts : ['record'] };
  };

  // Every colour the page uses, as CSS variables without their "--": the theme's, those following the cover (`cover`,
  // [r, g, b], or null before a cover's been read), and the inks.
  function work(theme, f, cover) {
    const base = PRESETS[theme?.base] ? theme.base : 'acrux';
    const c = f.on && cover;
    const out = {};
    PARTS.forEach((p, i) => {
      const own = rgb(HEX.test(theme?.[p]) ? theme[p] : PRESETS[base][i + 1]);
      out[p] = hex(c && f.parts.includes(p) ? FROM_COVER[p](c, own) : own);
    });
    if (c && f.parts.includes('record')) out.tint = hex(c);
    const [header, player] = [out.header, out.player].map(rgb);
    // The player bar's buttons: the header's colour, as ACRUX has them (dark on the grey bar), while it stands out from
    // the bar; else a grey that does (Blackout: black on nearly black).
    out['player-ink'] = contrast(header, player) >= 1.4 ? out.header : clearest(player, '#9f9f9f', '#1d1d1d');
    out['player-text'] = clearest(player, '#ffffff', '#111111');
    out['header-text'] = clearest(header, '#ffffff', '#111111');
    return out;
  }

  let cover = (() => { try { const c = localStorage.getItem('coverColour'); return HEX.test(c) ? rgb(c) : null; } catch { return null; } })();
  // Works the colours out again and puts them on the page: after Settings changes, or with a new cover's colour.
  function paint(newCover) {
    if (newCover) {
      cover = newCover.map(Math.round);
      try { localStorage.setItem('coverColour', hex(cover)); } catch {}
    }
    const style = document.documentElement.style;
    const out = work(read('theme'), follow(), cover);
    if (!out.tint) style.removeProperty('--tint'); // the record keeps the highlight
    for (const [name, value] of Object.entries(out)) style.setProperty(`--${name}`, value);
  }

  // player.js reads covers only when something follows them.
  const follows = () => { const f = follow(); return f.on && f.parts.length > 0; };
  if (typeof document !== 'undefined') paint();
  return { PRESETS, PARTS, follow, follows, paint, work, contrast, rgb };
})();
if (typeof document === 'undefined') module.exports = THEME; // tests/colours.test.js
