// The API keys: from .env when it has them, else the ones pasted in Set up ACRUX (kept in the settings table).
// One Google key serves both YouTube and Drive. The key named in .env always wins.
const SOURCES = {
  youtube: [['YOUTUBE_API_KEY'], 'googleKey'],
  drive: [['GOOGLE_API_KEY', 'YOUTUBE_API_KEY'], 'googleKey'],
  jamendo: [['JAMENDO_CLIENT_ID'], 'jamendoKey'],
};
// tracks.js on demand, so a module that only reads .env (and its tests) doesn't open the library.
const stored = (name) => require('./tracks').stored.get(name) || '';

function lookup(service) {
  const [env, name] = SOURCES[service];
  for (const e of env) if (process.env[e]) return { key: process.env[e], from: 'env' };
  const key = stored(name);
  return key ? { key, from: 'app' } : { key: '', from: null };
}

module.exports = {
  key: (service) => lookup(service).key,
  // What the page may see: whether it's set, where from, and its last 4 characters. Never the key itself.
  status(service) {
    const { key, from } = lookup(service);
    return { set: !!key, from, end: key ? key.slice(-4) : null };
  },
  save(patch) {
    const tracks = require('./tracks');
    if (typeof patch?.google === 'string') tracks.stored.set('googleKey', patch.google.trim());
    if (typeof patch?.jamendo === 'string') tracks.stored.set('jamendoKey', patch.jamendo.trim());
  },
};
