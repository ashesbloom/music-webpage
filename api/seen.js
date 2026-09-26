// Songs you've come across on album and artist pages, kept so a search finds them even where their source can't: the
// Internet Archive searches albums (an item's title, creator and subjects), never the songs inside them, so "Bairiyaa"
// from a "Complete Hindi Songs Collection" is only findable once you've opened that album. It's a source like the
// others to Discover (songs only), searched here in SQLite.
const { db } = require('./db');

db.exec('CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, json TEXT NOT NULL, at INTEGER NOT NULL)');
const put = db.prepare('INSERT OR REPLACE INTO seen (id, title, artist, json, at) VALUES (?, ?, ?, ?, ?)');

// Keeps an album's or artist's songs (results in the shared shape, api/common.js).
function remember(tracks = []) {
  if (!tracks.length) return;
  db.exec('BEGIN');
  try {
    for (const t of tracks) put.run(`${t.source}:${t.id}`, String(t.title).toLowerCase(), String(t.artist).toLowerCase(), JSON.stringify(t), Date.now());
    db.exec('COMMIT');
  } catch {
    db.exec('ROLLBACK');
  }
}

// Albums and artist pages opened before this existed are still in the cache: their songs count too.
if (!db.prepare('SELECT 1 FROM seen LIMIT 1').get()) {
  for (const row of db.prepare("SELECT body FROM cache WHERE key GLOB '*:album:*' OR key GLOB '*:artist:*'").all()) {
    try { remember(JSON.parse(row.body).tracks); } catch {}
  }
}

const PAGE = 20;
// Songs whose title or artist has every word of the search (whole words are checked by the page).
const find = {
  songs: async (q, n) => {
    const words = q.toLowerCase().replace(/[%_\\]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6);
    if (!words.length) return { results: [], more: false };
    const where = words.map(() => '(title LIKE ? OR artist LIKE ?)').join(' AND ');
    const rows = db.prepare(`SELECT json FROM seen WHERE ${where} ORDER BY at DESC LIMIT ? OFFSET ?`)
      .all(...words.flatMap((w) => [`%${w}%`, `%${w}%`]), PAGE + 1, (n - 1) * PAGE);
    return { results: rows.slice(0, PAGE).map((r) => JSON.parse(r.json)), more: rows.length > PAGE };
  },
  albums: async () => ({ results: [], more: false }),
  artists: async () => ({ results: [], more: false }),
};

module.exports = { remember, find };
