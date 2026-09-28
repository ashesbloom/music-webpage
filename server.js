// ACRUX server: the site's files, your music (api/library.js: songs you add and Google Drive folders) and the Discover
// and taste API (api/). Run: npm install, then node server.js (PORT env var overrides 3000; HOST=0.0.0.0 for the LAN).
// Keys are pasted in Set up ACRUX, or come from .env (gitignored), which wins: JAMENDO_CLIENT_ID, YOUTUBE_API_KEY, and for
// Drive GOOGLE_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
const http = require('http');
const fs = require('fs');
const path = require('path');

try { process.loadEnvFile(); } catch {} // no .env: Discover's sections say which key is missing
const discover = require('./api/discover');
const library = require('./api/library');
const collection = require('./api/collection');
const setup = require('./api/setup');
const update = require('./api/update');
const mix = require('./api/mix');
const { sendFile, loopback } = require('./api/common');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // HOST=0.0.0.0 to open it to phones on the same Wi-Fi
const APP = !!process.env.ACRUX_APP; // run by the desktop app (desktop/main.js), which ships without the demo songs

function send(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(message);
}

async function handler(req, res) {
  res.on('close', () => console.log(req.method, req.url.replace(/([?&]u=)[^&]*/, '$1…'), res.statusCode));
  let url;
  let file;
  try {
    url = new URL(req.url, 'http://localhost');
    file = path.join(ROOT, decodeURIComponent(url.pathname));
  } catch {
    return send(res, 400, 'Bad Request');
  }
  // From the Wi-Fi: only guests (invite links) and the site's own files, unless HOST=0.0.0.0 opened it to everyone.
  if (!collection.gate(req, url)) return send(res, 403, 'Ask the person running ACRUX for an invite link.');
  if (library.ROUTES.test(url.pathname)) return library(req, res, url); // your music: local imports and Drive (api/library.js)
  if (collection.ROUTES.test(url.pathname)) return collection(req, res, url); // playlists, favorites, downloads, guests
  if (setup.ROUTES.test(url.pathname)) return setup(req, res, url); // first run and the API keys pasted in it
  if (update.ROUTES.test(url.pathname)) return update(req, res, url); // the desktop app's updates (Settings)
  if (mix.ROUTES.test(url.pathname)) return mix(req, res, url); // Auto Mix: each song's analysis
  if (url.pathname.startsWith('/discover/') || url.pathname.startsWith('/api/')) return discover(req, res, url); // it checks its own methods
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
  if (APP && url.pathname === '/javascript/edition.js') { // the app edition: catalog.js and Home hide the demo
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    // An update waiting for a restart puts a dot on Settings, on this computer only (a phone can't restart it).
    const ready = update.ready() && loopback(req) ? ", 'update_ready'" : '';
    return res.end(`window.ACRUX_APP = true; document.documentElement.classList.add('app'${ready});`);
  }
  if (file.includes('\0')) return send(res, 400, 'Bad Request');
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');
  // Never serve dotfiles (.env holds the API keys, .git), the database and your music (data/), or node_modules.
  const parts = path.relative(ROOT, file).split(path.sep);
  if (parts.some((part) => part.startsWith('.')) || parts[0] === 'data' || parts[0] === 'node_modules') return send(res, 404, 'Not Found');

  let stat;
  try {
    stat = await fs.promises.stat(file);
    if (stat.isDirectory()) {
      file = path.join(file, 'index.html');
      stat = await fs.promises.stat(file);
    }
  } catch {
    return send(res, 404, 'Not Found');
  }
  if (!stat.isFile()) return send(res, 404, 'Not Found');

  sendFile(req, res, file, stat, undefined, 'check'); // kept by the browser, asked for again each time (304 when unchanged)
}
http.createServer(handler).listen(PORT, HOST, () => {
  console.log(`Serving ${ROOT} at http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}/`);
  process.parentPort?.postMessage('ready'); // the desktop app opens its window now
});
collection.attach({ handler, port: PORT, host: HOST }); // and on the Wi-Fi, for invite links, when that's turned on
