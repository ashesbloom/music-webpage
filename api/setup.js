// ACRUX first run, mounted by server.js: whether setup is done, the API keys pasted in it, and checking a key.
//   GET · PUT /api/setup                   { owner, done, sources } · { done: true } (setup finished or skipped)
//   GET · PUT /api/keys                    which keys are set (last 4 characters only) · { google?, jamendo? }
//   POST /api/keys/check { kind, key? }    asks Google or Jamendo whether the key works -> { results: [message] }
// All of it answers only the computer running ACRUX: phones and guests on the Wi-Fi never see or set keys.
const { fail, json, sameSite, loopback } = require('./common');
const keys = require('./keys');
const tracks = require('./tracks');

const ROUTES = /^\/api\/(setup|keys)(\/|$)/;
const CLOUD = 'https://console.cloud.google.com';
const GOOGLE = {
  youtube: { name: 'YouTube', api: 'YouTube Data API v3', url: 'https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=' },
  drive: { name: 'Google Drive', api: 'Google Drive API', url: 'https://www.googleapis.com/drive/v3/files/1ACRUXkeyCheckNoSuchFile000000000?fields=id&key=' }, // "not found" = the key works
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// Google's reason for turning a request down, from either of its error shapes.
function reasonOf(body) {
  const e = body?.error;
  return e?.details?.find((d) => d.reason)?.reason || e?.errors?.[0]?.reason || e?.status || '';
}

// One service's answer, as the message the page shows: { service, ok, title, fix?, link?, linkLabel? }.
function explain(service, status, body) {
  const g = GOOGLE[service];
  const reason = reasonOf(body);
  const ok = (title) => ({ service, ok: true, title });
  // Drive: a key that gets as far as "no such file" works (the file asked for doesn't exist on purpose).
  if ((status >= 200 && status < 300) || (service === 'drive' && status === 404)) {
    return ok(service === 'youtube' ? 'YouTube is on. You get about 99 searches a day.' : 'Google Drive is on.');
  }
  if (/quotaExceeded|dailyLimitExceeded|RATE_LIMIT_EXCEEDED/.test(reason)) {
    return ok('YouTube searches are used up for today. They come back at midnight Pacific time.');
  }
  if (/SERVICE_DISABLED|accessNotConfigured/.test(reason)) {
    return { service, ok: false, title: `${g.name} is turned off in this project.`,
      fix: `Open the API Library, search for ${g.api} and press Enable. Then check again.`,
      link: `${CLOUD}/apis/library`, linkLabel: 'Open the API Library' };
  }
  if (/API_KEY_SERVICE_BLOCKED|API_KEY_HTTP_REFERRER_BLOCKED|API_KEY_IP_ADDRESS_BLOCKED/.test(reason)) {
    return { service, ok: false, title: `${g.name} can’t use this key yet.`,
      fix: `The key is limited to other Google services. Open Credentials, choose this key, and add ${g.api} under API restrictions. Then check again.`,
      link: `${CLOUD}/apis/credentials`, linkLabel: 'Open Credentials' };
  }
  if (/API_KEY_INVALID|keyInvalid|badRequest/.test(reason) || status === 400) {
    return { service, ok: false, title: 'Google doesn’t recognise this key.',
      fix: 'Copy it again from Credentials. It starts with AIza and has no spaces.',
      link: `${CLOUD}/apis/credentials`, linkLabel: 'Open Credentials' };
  }
  return { service, ok: false, title: `${g.name} turned the key down.`, fix: body?.error?.message || `Google answered ${status}.` };
}

async function probe(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return null;
  }
}
const offline = { ok: false, title: 'ACRUX can’t reach the internet right now.', fix: 'Check the connection, then check again.' };

async function check(kind, key) {
  if (kind === 'google') {
    const answers = await Promise.all(Object.keys(GOOGLE).map(async (service) => {
      const got = await probe(GOOGLE[service].url + encodeURIComponent(key)); // 1 YouTube quota unit, not a search (100)
      return got ? explain(service, got.status, got.body) : { service, ...offline };
    }));
    return answers;
  }
  const got = await probe(`https://api.jamendo.com/v3.0/tracks/?${new URLSearchParams({ client_id: key, format: 'json', limit: 1 })}`);
  if (!got) return [{ service: 'jamendo', ...offline }];
  if (got.status === 200 && got.body?.headers?.status === 'success') return [{ service: 'jamendo', ok: true, title: 'Jamendo works. Its songs now show up in Discover.' }];
  return [{ service: 'jamendo', ok: false, title: 'Jamendo doesn’t recognise this Client ID.',
    fix: 'Copy it again from your app on the Jamendo developer site. It’s 8 letters and numbers.',
    link: 'https://devportal.jamendo.com', linkLabel: 'Open Jamendo' }];
}

const KEY = /^[\w.-]{0,200}$/; // Google keys and Jamendo ids: letters, digits, "-", "_" (empty clears it)
const cleanKey = (v) => {
  if (v === undefined) return undefined;
  const k = String(v).trim();
  if (!KEY.test(k)) throw fail('That doesn’t look like a key: it should be letters and numbers, with no spaces.', 400);
  return k;
};
const keyStatus = () => ({ google: keys.status('youtube'), drive: keys.status('drive'), jamendo: keys.status('jamendo') });

module.exports = async function setup(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  try {
    if (m !== 'GET' && !sameSite(req)) return send(res, 403, { error: 'Only ACRUX itself can do that' });
    if (p === '/api/setup' && m === 'GET') {
      const owner = loopback(req);
      return send(res, 200, { owner, done: tracks.stored.get('setupDone') === '1', sources: owner ? tracks.sources.list().filter((s) => s.kind !== 'local').length : 0 });
    }
    if (!loopback(req)) return send(res, 403, { error: 'Only on the computer running ACRUX' });
    if (p === '/api/setup' && m === 'PUT') {
      if ((await json(req))?.done) tracks.stored.set('setupDone', '1');
      return send(res, 200, { done: tracks.stored.get('setupDone') === '1' });
    }
    if (p === '/api/keys' && m === 'GET') return send(res, 200, keyStatus());
    if (p === '/api/keys' && m === 'PUT') {
      const body = await json(req);
      keys.save({ google: cleanKey(body?.google), jamendo: cleanKey(body?.jamendo) });
      return send(res, 200, keyStatus());
    }
    if (p === '/api/keys/check' && m === 'POST') {
      const body = await json(req);
      const kind = body?.kind === 'jamendo' ? 'jamendo' : 'google';
      const key = cleanKey(body?.key) || keys.key(kind === 'jamendo' ? 'jamendo' : 'youtube');
      if (!key) throw fail('Paste a key first.', 400);
      return send(res, 200, { results: await check(kind, key) });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    return send(res, err.status || 500, { error: err.expose ? err.message : 'Something went wrong' });
  }
};
module.exports.ROUTES = ROUTES;
module.exports.explain = explain;
