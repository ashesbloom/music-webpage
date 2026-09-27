// ACRUX desktop app (Electron). It runs the unchanged server.js in a utility process (its SQLite calls are synchronous
// and would freeze a window sharing their thread), keeps your data in the app's own folder, and shows the page in a
// window. Links off the site open in your browser, Google's sign-in too (Google refuses it inside embedded windows).
// Updates (api/update.js) arrive as a newer copy of those files in the app's folder, run from there after a restart.
// Dev: npm run app. Build: npm run dist (electron-builder; its config is package.json's "build").
const { app, BrowserWindow, Menu, utilityProcess, shell, dialog, screen } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');

const DATA = app.getPath('userData'); // ~/Library/Application Support/ACRUX, %APPDATA%\ACRUX
const LOG = path.join(DATA, 'server.log');
const WINDOW = path.join(DATA, 'window.json'); // its size, place and page when last left, to reopen as it was
const BUNDLED = path.join(__dirname, '..'); // the ACRUX files the app shipped with
const UPDATES = path.join(DATA, 'app');     // newer ones downloaded since (api/update.js)
const BAD = path.join(UPDATES, 'bad.json'); // downloaded versions that didn't start: never run again
// This file, as the updates know the app's shell: a release that changes it (or Electron) needs a new download.
const SHELL = crypto.createHash('sha256').update(fs.readFileSync(__filename, 'utf8').replace(/\r/g, '')).digest('hex');
let win = null;
let server = null;
let quitting = false;
let up = false; // the server said it's ready

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
// Which ACRUX to run: a downloaded update when it's newer than the app's own and hasn't failed before, else the app's own.
function root() {
  const { version } = readJson(path.join(UPDATES, 'current.json'), {});
  const dir = typeof version === 'string' && path.join(UPDATES, path.basename(version));
  const ok = dir && version.localeCompare(app.getVersion(), undefined, { numeric: true }) > 0
    && !readJson(BAD, []).includes(version) && fs.existsSync(path.join(dir, 'server.js'));
  return ok ? { dir, version } : { dir: BUNDLED, version: null };
}
// A downloaded version whose server didn't start: marked bad, and ACRUX starts again on its own files.
function fallBack(version) {
  fs.writeFileSync(BAD, JSON.stringify([...readJson(BAD, []), version]));
  fs.rmSync(path.join(UPDATES, 'current.json'), { force: true });
  quitting = true;
  server?.kill();
  app.relaunch();
  app.exit(0);
}

// A port that's free on 127.0.0.1 (0: any), or 0 if it's taken.
const free = (port) => new Promise((done) => {
  const s = net.createServer().once('error', () => done(0));
  s.listen(port, '127.0.0.1', () => { const got = s.address().port; s.close(() => done(got)); });
});

// Pages keep localStorage per origin (history, recent searches, quality, repeat), port included, so ACRUX keeps the
// port it first got: 4747 (away from the dev server's 3000), else whatever the system gives.
async function pickPort() {
  const file = path.join(DATA, 'port');
  let saved = 0;
  try { saved = Number(fs.readFileSync(file, 'utf8')) || 0; } catch {}
  const port = (await free(saved || 4747)) || (await free(0));
  if (port !== saved) fs.writeFileSync(file, String(port));
  return port;
}

function startServer(port, from) {
  const log = fs.createWriteStream(LOG); // a fresh log each launch: the file to send when something breaks
  server = utilityProcess.fork(path.join(from.dir, 'server.js'), [], {
    env: { ...process.env, ACRUX_DATA: DATA, ACRUX_APP: '1', PORT: String(port), HOST: '127.0.0.1', ACRUX_SHELL: SHELL,
      ...(app.isPackaged && { ACRUX_UPDATES: '1' }) },
    stdio: 'pipe',
    serviceName: 'ACRUX server',
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  server.on('exit', (code) => {
    if (quitting) return;
    if (from.version && !up) return fallBack(from.version);
    dialog.showErrorBox('ACRUX stopped', `ACRUX’s server stopped (code ${code}). What it said is in ${LOG}`);
    app.quit();
  });
  return server;
}

// The window as it was left: its place is dropped when no screen shows it now (a monitor unplugged), then it opens
// centred at that size.
function lastWindow() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(WINDOW, 'utf8')); } catch {}
  const b = s.bounds || {};
  const seen = screen.getAllDisplays().some(({ workArea: a }) => b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
  return { size: { width: b.width || 1440, height: b.height || 900, ...(seen && { x: b.x, y: b.y }) }, maximized: !!s.maximized, page: typeof s.page === 'string' ? s.page : '' };
}

function open(base) {
  const last = lastWindow();
  win = new BrowserWindow({ ...last.size, minWidth: 380, minHeight: 600, backgroundColor: '#000', show: false, autoHideMenuBar: true, title: 'ACRUX' });
  win.once('ready-to-show', () => {
    if (last.maximized) win.maximize();
    win.show();
  });
  // Saved when it closes, and a second after it's moved, resized or shows another page (in case ACRUX is stopped hard).
  // The page is kept relative to the server, whose port can change.
  let later = 0;
  const save = () => {
    clearTimeout(later);
    if (!win || win.isDestroyed()) return;
    const url = win.webContents.getURL();
    const state = { bounds: win.getNormalBounds(), maximized: win.isMaximized(), page: url.startsWith(base) ? url.slice(base.length) : '' };
    try { fs.writeFileSync(WINDOW, JSON.stringify(state)); } catch {}
  };
  const soon = () => { clearTimeout(later); later = setTimeout(save, 1000); };
  for (const e of ['resize', 'move']) win.on(e, soon);
  win.webContents.on('did-navigate-in-page', soon);
  win.on('close', save);
  const browser = (url) => { if (/^https?:/.test(url)) shell.openExternal(url); };
  const leave = (e) => {
    if (e.isMainFrame === false || e.url.startsWith(base)) return; // iframes (YouTube) and ACRUX's own pages stay
    e.preventDefault();
    browser(e.url);
  };
  win.webContents.setWindowOpenHandler(({ url }) => { browser(url); return { action: 'deny' }; }); // target=_blank
  win.webContents.on('will-navigate', leave);
  win.webContents.on('will-redirect', leave); // /api/drive/connect → Google: cancelled here, the page keeps playing
  win.on('closed', () => { win = null; });
  win.loadURL(base + last.page);
}

// The menu bar (Alt shows it on Windows): the usual menus, and Controls, whose items the page does (keys.js shortcut()).
// The keys themselves are the page's too, so they skip the search box: the menu only shows the Ctrl/⌘ ones
// (registerAccelerator: false on Windows and Linux; a Mac's menu gets only keys the page left alone). Media keys need
// nothing here: the page's Media Session reaches them. Never globalShortcut them, which takes ACRUX off the OS's
// media controls (and asks a Mac for Accessibility access).
function menu() {
  const does = (label, name, accelerator) => ({ label, accelerator, registerAccelerator: false,
    click: () => win?.webContents.executeJavaScript(`window.shortcut?.(${JSON.stringify(name)})`) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin'
      ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, does('Settings…', 'settings', 'Cmd+,'), { type: 'separator' },
        { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }]
      : [{ label: 'File', submenu: [does('Settings…', 'settings', 'Ctrl+,'), { type: 'separator' }, { role: 'quit' }] }]),
    { role: 'editMenu' },
    { label: 'Controls', submenu: [
      does('Play / Pause', 'playpause'),
      does('Next', 'next', 'CmdOrCtrl+Right'),
      does('Previous', 'prev', 'CmdOrCtrl+Left'),
      { type: 'separator' },
      does('Volume Up', 'volup', 'CmdOrCtrl+Up'),
      does('Volume Down', 'voldown', 'CmdOrCtrl+Down'),
      does('Mute', 'mute'),
      { type: 'separator' },
      does('Shuffle', 'shuffle'),
      does('Repeat', 'repeat'),
    ] },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [does('Keyboard Shortcuts', 'help', 'CmdOrCtrl+/')] },
  ]));
}

async function start() {
  menu();
  const port = await pickPort();
  const base = `http://localhost:${port}/`;
  const from = root();
  if (from.version) setTimeout(() => { if (!up) fallBack(from.version); }, 30e3);
  startServer(port, from).on('message', (m) => {
    if (m === 'ready') {
      up = true;
      open(base);
    }
    // An update downloaded (Settings shows it): a dot on Settings now; Settings' Restart relaunches on it.
    if (m === 'update-ready') win?.webContents.executeJavaScript("document.documentElement.classList.add('update_ready')").catch(() => {});
    if (m === 'restart') {
      quitting = true;
      app.relaunch();
      app.quit();
    }
    // Google Drive connected in your browser: back to My Music, where Set up ACRUX picks up (its setupResume).
    if (m === 'signed-in' && win) {
      win.loadURL(`${base}library.html#addmore`);
      win.show();
      app.focus({ steal: true });
    }
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit()); // the music plays in the window, so closing it ends ACRUX
  app.on('before-quit', () => { quitting = true; server?.kill(); });
}
