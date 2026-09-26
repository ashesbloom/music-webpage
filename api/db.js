// ACRUX backend storage: one SQLite file (data/acrux.db, gitignored) through Node's built-in node:sqlite.
// Holds the Discover query cache and today's YouTube quota count; api/taste.js adds your plays.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DIR, { recursive: true });
const db = new DatabaseSync(path.join(DIR, 'acrux.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS quota (day TEXT PRIMARY KEY, used INTEGER NOT NULL);
`);

const getCache = db.prepare('SELECT body FROM cache WHERE key = ? AND expires > ?');
const putCache = db.prepare('INSERT OR REPLACE INTO cache (key, body, expires) VALUES (?, ?, ?)');

// The stored value while it's fresh, else load() and store what it returns. A load() that throws stores nothing;
// ttlMs may be a function of the value (e.g. keep an empty answer only briefly). Callers asking for the same key while
// it loads share that one load (e.g. a page being warmed ahead).
const loading = new Map();
function cached(key, ttlMs, load) {
  const row = getCache.get(key, Date.now());
  if (row) return Promise.resolve(JSON.parse(row.body));
  if (!loading.has(key)) {
    loading.set(key, Promise.resolve().then(load).then((value) => {
      putCache.run(key, JSON.stringify(value), Date.now() + (typeof ttlMs === 'function' ? ttlMs(value) : ttlMs));
      return value;
    }).finally(() => loading.delete(key)));
  }
  return loading.get(key);
}

// YouTube's daily quota resets at midnight Pacific time, so the count is kept per Pacific date.
const day = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const getUsed = db.prepare('SELECT used FROM quota WHERE day = ?');
const setUsed = db.prepare('INSERT OR REPLACE INTO quota (day, used) VALUES (?, ?)');
const quota = {
  used: () => getUsed.get(day())?.used ?? 0,
  spend(units) { setUsed.run(day(), quota.used() + units); },
  set(units) { setUsed.run(day(), units); },
};

module.exports = { db, cached, quota };
