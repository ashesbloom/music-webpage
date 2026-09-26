// ACRUX server: the site's files plus the Discover and taste API (api/). Run: node server.js (PORT env var overrides 3000;
// HOST=0.0.0.0 for the LAN). API keys come from .env (gitignored): JAMENDO_CLIENT_ID, YOUTUBE_API_KEY.
const http = require('http');
const fs = require('fs');
const path = require('path');

try { process.loadEnvFile(); } catch {} // no .env: Discover's sections say which key is missing
const discover = require('./api/discover');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // HOST=0.0.0.0 to open it to phones on the same Wi-Fi
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', // the Browse tiles are videos
};

function send(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(message);
}

http.createServer(async (req, res) => {
  res.on('close', () => console.log(req.method, req.url.replace(/([?&]u=)[^&]*/, '$1…'), res.statusCode));
  let url;
  let file;
  try {
    url = new URL(req.url, 'http://localhost');
    file = path.join(ROOT, decodeURIComponent(url.pathname));
  } catch {
    return send(res, 400, 'Bad Request');
  }
  if (url.pathname.startsWith('/discover/') || url.pathname.startsWith('/api/')) return discover(req, res, url); // it checks its own methods
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
  if (file.includes('\0')) return send(res, 400, 'Bad Request');
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');
  // Never serve dotfiles (.env holds the API keys, .git) or the database.
  const parts = path.relative(ROOT, file).split(path.sep);
  if (parts.some((part) => part.startsWith('.')) || parts[0] === 'data') return send(res, 404, 'Not Found');

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

  const size = stat.size;
  const headers = {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
  };
  let start = 0;
  let end = size - 1;
  let status = 200;

  // Single byte range: "bytes=a-b", "bytes=a-" or "bytes=-n" (last n bytes). Anything else is ignored (full file).
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2]) && !(range[1] && range[2] && Number(range[2]) < Number(range[1]))) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else {
      start = Math.max(size - Number(range[2]), 0);
    }
    if (start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Cache-Control': 'no-store' });
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }

  headers['Content-Length'] = size === 0 ? 0 : end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || size === 0) return res.end();
  fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
}).listen(PORT, HOST, () => console.log(`Serving ${ROOT} at http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}/`));
