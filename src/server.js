// home-control: local-only home dashboard. Binds to 127.0.0.1 behind nginx (LAN-only) on the server.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import * as auth from './auth.js';
import * as hue from './hue.js';
import * as sky from './skyq.js';
import * as guide from './guide.js';
import * as netmon from './netmon.js';
import * as android from './android.js';
import * as adb from './adb.js';
import * as devices from './devices.js';
import * as hive from './hive.js';
import * as smarttv from './smarttv.js';
import * as ring from './ring.js';
import * as yale from './yale.js';
import * as routines from './routines.js';
import * as cameras from './cameras.js';

const DEFAULT_FAVOURITE_NUMBERS = ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110', '301', '401', '501'];

async function favourites() {
  const c = store.get();
  if (!Array.isArray(c.favourites)) {
    const list = await guide.channels();
    const sids = DEFAULT_FAVOURITE_NUMBERS.map((n) => list.find((ch) => ch.number === n)?.sid).filter(Boolean);
    store.update((cfg) => { cfg.favourites = sids; });
  }
  return store.get().favourites;
}

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
// Deployed build id (written by deploy/push.sh); open pages reload themselves when it changes
const VERSION = (() => {
  try { return readFileSync(path.join(PUBLIC, '..', 'VERSION'), 'utf8').trim(); } catch { return `dev-${Date.now()}`; }
})();
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8790);
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/theme.js': ['theme.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  // installable app (Add to Home Screen) and the wall tablet's keep-awake clip
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
  '/icon-maskable-512.png': ['icon-maskable-512.png', 'image/png'],
  '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'],
  '/keepawake.mp4': ['keepawake.mp4', 'video/mp4'],
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', ...(isJson ? { 'Content-Type': 'application/json' } : {}), ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

function clientIp(req) {
  // nginx sets X-Real-IP; only trust it when the direct peer is local
  const peer = req.socket.remoteAddress || '';
  return /^(::ffff:)?127\.|^::1$/.test(peer) ? req.headers['x-real-ip'] || peer : peer;
}

// Home network only: private (LAN) addresses plus local loopback, but not the router itself — routers that rewrite
// port-forwarded internet traffic make it appear to come from the router. Belt and braces with nginx.
function isHomeNetwork(req) {
  const ip = String(clientIp(req)).replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1') return true;
  return devices.isPrivateIp(ip) && ip !== devices.defaultGateway();
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 16_384) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw Object.assign(new Error('Bad JSON'), { status: 400 }); }
}

// Settings without secrets: secrets are reported only as set / not set.
function publicSettings() {
  const c = store.get();
  return {
    hue: { ip: c.hue.ip, paired: Boolean(c.hue.username) },
    sky: c.sky,
    android: c.android,
    smarttv: c.smarttv ?? [],
    cameras: cameras.settings(),
    switches: c.switches,
    cisco: { passwordSet: Boolean(c.cisco.password), enableSet: Boolean(c.cisco.enable) },
    pingTargets: c.pingTargets,
    showAdult: Boolean(c.showAdult),
  };
}

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

function applySettings(body) {
  store.update((c) => {
    if (body.hue?.ip && IP_RE.test(body.hue.ip) && body.hue.ip !== c.hue.ip) { c.hue.ip = body.hue.ip; c.hue.username = null; }
    for (const s of body.sky ?? []) {
      const box = c.sky.find((b) => b.id === s.id);
      if (box && IP_RE.test(s.ip)) box.ip = s.ip;
      if (box && typeof s.name === 'string' && s.name.trim()) box.name = s.name.trim().slice(0, 40);
    }
    for (const s of body.android ?? []) {
      const d = c.android.find((x) => x.id === s.id);
      if (d && IP_RE.test(s.ip)) d.ip = s.ip;
      if (d && typeof s.name === 'string' && s.name.trim()) d.name = s.name.trim().slice(0, 40);
    }
    for (const s of body.smarttv ?? []) {
      const d = (c.smarttv ?? []).find((x) => x.id === s.id);
      if (d && IP_RE.test(s.ip)) d.ip = s.ip;
      if (d && typeof s.name === 'string' && s.name.trim()) d.name = s.name.trim().slice(0, 40);
    }
    for (const s of body.switches ?? []) {
      const sw = c.switches.find((b) => b.id === s.id);
      if (sw && IP_RE.test(s.ip)) sw.ip = s.ip;
    }
    // secrets: only overwrite when a non-empty value is sent
    if (typeof body.cisco?.password === 'string' && body.cisco.password) c.cisco.password = body.cisco.password;
    if (typeof body.cisco?.enable === 'string' && body.cisco.enable) c.cisco.enable = body.cisco.enable;
    if (typeof body.showAdult === 'boolean') c.showAdult = body.showAdult;
  });
}

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const ip = clientIp(req);

  if ((req.method === 'POST' || req.method === 'DELETE') && req.headers['x-requested-with'] !== 'home-control') {
    return send(res, 403, { error: 'Missing request header' });
  }

  // --- unauthenticated: session state, first-time setup, login -----------------------------
  if (route === 'GET /api/session') return send(res, 200, { setup: !auth.isSetUp(), authed: auth.isAuthed(req) });
  if (route === 'POST /api/setup') {
    if (auth.isSetUp()) return send(res, 409, { error: 'Already set up' });
    const { password } = await readJson(req);
    try { auth.setPassword(password); } catch (e) { return send(res, 400, { error: e.message }); }
    return send(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie() });
  }
  if (route === 'POST /api/login') {
    const { password } = await readJson(req);
    const r = auth.checkPassword(ip, password);
    return r.ok ? send(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie() }) : send(res, 401, { error: r.error });
  }
  if (route === 'POST /api/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });

  if (!auth.isAuthed(req)) return send(res, 401, { error: 'Not logged in' });

  // --- authenticated -------------------------------------------------------------------------
  if (route === 'GET /api/state') {
    const [lights, tv] = await Promise.all([hue.summary().catch((e) => ({ error: e.message })), sky.summary().catch(() => [])]);
    return send(res, 200, { lights, tv, android: android.summary(), smarttv: smarttv.summary(), ring: ring.summary(), yale: yale.summary(), cameras: cameras.summary(), routines: routines.summary(), hive: hive.summary(), network: netmon.summary(), version: VERSION, at: new Date().toISOString() });
  }
  if (route === 'POST /api/hue/pair') return send(res, 200, await hue.pair().catch((e) => ({ ok: false, error: `Bridge not answering (${e.name})` })));

  let m;
  if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/hue\/(group|light)\/(\d+)$/))) {
    const body = await readJson(req);
    await (m[1] === 'group' ? hue.setGroup(m[2], body) : hue.setLight(m[2], body));
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/sky\/([\w-]+)\/key$/))) {
    const { key } = await readJson(req);
    try { return send(res, 200, await sky.sendKey(m[1], String(key))); } catch (e) {
      console.error(new Date().toISOString(), `sky ${m[1]}: key ${key} failed: ${e.message}`);
      return send(res, 502, { error: e.message });
    }
  }
  // --- TV guide, favourites, apps --------------------------------------------------------------
  if (route === 'GET /api/channels') {
    const [list, favs] = await Promise.all([guide.channels(), favourites()]);
    const showAdult = Boolean(store.get().showAdult);
    const fav = new Set(favs);
    return send(res, 200, {
      channels: list.filter((c) => showAdult || c.genre !== 'Adult').map((c) => ({ ...c, fav: fav.has(c.sid) })),
      favourites: favs,
      genres: Object.values(guide.GENRES).filter((g) => showAdult || g !== 'Adult'),
    });
  }
  if (route === 'GET /api/guide') {
    const now = Math.floor(Date.now() / 1000);
    const from = Math.max(now - 86400, Number(url.searchParams.get('from')) || now - 1800);
    const to = Math.min(now + 8 * 86400, Number(url.searchParams.get('to')) || now + 4 * 3600);
    const sids = (url.searchParams.get('sids') || '').split(',').filter((s) => /^\d{1,6}$/.test(s)).slice(0, 500);
    if (to <= from || to - from > 2 * 86400) return send(res, 400, { error: 'Bad time window' });
    return send(res, 200, { from, to, schedule: await guide.schedule(sids, from, to) });
  }
  if (route === 'POST /api/favourites') {
    const { sid, fav } = await readJson(req);
    if (!/^\d{1,6}$/.test(String(sid))) return send(res, 400, { error: 'Bad channel' });
    await favourites();
    store.update((c) => {
      const set = new Set(c.favourites);
      if (fav) set.add(String(sid)); else set.delete(String(sid));
      c.favourites = [...set];
    });
    return send(res, 200, { favourites: store.get().favourites });
  }
  if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/img\/(logo|art)\/([\w-]+)$/))) {
    try {
      const buf = await (m[1] === 'logo' ? guide.logo(m[2]) : guide.artwork(m[2]));
      const type = buf[0] === 0x89 ? 'image/png' : 'image/jpeg';
      return send(res, 200, buf, { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' });
    } catch (e) {
      return send(res, e.status || 502, { error: e.message });
    }
  }
  if (route === 'GET /api/sky/apps') return send(res, 200, { apps: sky.APPS });
  if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/sky\/([\w-]+)\/(watch|app)$/))) {
    const body = await readJson(req);
    const what = m[2] === 'watch' ? `watch sid ${body.sid}` : `app ${body.appId}`;
    try {
      const r = m[2] === 'watch' ? await sky.watch(m[1], String(body.sid)) : await sky.launchApp(m[1], String(body.appId));
      console.log(new Date().toISOString(), `sky ${m[1]}: ${what} ok`);
      return send(res, 200, r);
    } catch (e) {
      console.error(new Date().toISOString(), `sky ${m[1]}: ${what} failed: ${e.message}`);
      return send(res, 502, { error: e.message });
    }
  }

  // --- Android TV / Shield / Fire TV (ADB) ------------------------------------------------------
  if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/smarttv\/([\w-]+)\/(volume|mute|app)$/))) {
    const [, id, action] = m;
    try {
      const body = await readJson(req);
      const r = action === 'volume' ? await smarttv.volume(id, body)
        : action === 'mute' ? await smarttv.mute(id, Boolean(body.on))
          : await smarttv.app(id, String(body.app), Boolean(body.stop));
      console.log(new Date().toISOString(), `smarttv ${id}: ${action} ${body.app ?? body.level ?? body.step ?? body.on ?? ''} ok`);
      return send(res, 200, r);
    } catch (e) {
      console.error(new Date().toISOString(), `smarttv ${id}: ${action} failed: ${e.message}`);
      return send(res, 502, { error: e.message });
    }
  }
  if ((m = url.pathname.match(/^\/api\/android\/([\w-]+)\/(apps|key|app|approve|wake)$/))) {
    const [, id, action] = m;
    try {
      if (req.method === 'GET' && action === 'apps') return send(res, 200, { apps: await android.apps(id) });
      if (req.method === 'POST') {
        const body = await readJson(req);
        const r = action === 'key' ? await android.key(id, String(body.key))
          : action === 'app' ? await android.launch(id, String(body.pkg))
            : action === 'approve' ? await android.approve(id)
              : action === 'wake' ? await android.wake(id) : null;
        if (r) { console.log(new Date().toISOString(), `android ${id}: ${action} ${body.key ?? body.pkg ?? ''} ok`); return send(res, 200, r); }
      }
    } catch (e) {
      console.error(new Date().toISOString(), `android ${id}: ${action} failed: ${e.message}`);
      return send(res, 502, { error: e.message, code: e.code });
    }
  }
  if (route === 'GET /api/android/fingerprint') return send(res, 200, { fingerprint: adb.keyFingerprint() });

  // --- device management (Settings) -------------------------------------------------------------
  if (route === 'GET /api/devices/discover') {
    try { return send(res, 200, { found: await devices.discover() }); } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (route === 'POST /api/devices') {
    try { return send(res, 200, devices.add(await readJson(req))); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (req.method === 'DELETE' && (m = url.pathname.match(/^\/api\/devices\/(sky|android)\/([\w-]+)$/))) {
    try { return send(res, 200, devices.remove(m[1], m[2])); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  // --- Hue: add / rename lights ------------------------------------------------------------------
  if (route === 'POST /api/hue/search') {
    const { serials } = await readJson(req);
    try { return send(res, 200, await hue.searchLights(Array.isArray(serials) ? serials : [])); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (route === 'GET /api/hue/new') {
    try { return send(res, 200, await hue.newLights()); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/hue\/light\/(\d+)\/name$/))) {
    const { name } = await readJson(req);
    try { return send(res, 200, await hue.renameLight(m[1], name)); } catch (e) { return send(res, 400, { error: e.message }); }
  }

  // --- Hive heating (HomeKit) ------------------------------------------------------------------
  if ((m = url.pathname.match(/^\/api\/hive\/(pair|unpair|set|boost|cancel-boost|switch|cloud-signin|cloud-code|cloud-signout|hotwater|hotwater-boost)$/)) && req.method === 'POST') {
    const body = await readJson(req);
    try {
      const r = m[1] === 'pair' ? await hive.pair(String(body.code ?? ''), body.ip, body.port)
        : m[1] === 'unpair' ? await hive.unpair()
          : m[1] === 'set' ? await hive.set(body.id, { target: body.target, mode: body.mode })
            : m[1] === 'boost' ? await hive.boost(body.id, body.minutes, body.target)
              : m[1] === 'cancel-boost' ? await hive.cancelBoost(body.id)
                : m[1] === 'cloud-signin' ? await hive.cloudSignIn(body.email, body.password)
                  : m[1] === 'cloud-code' ? await hive.cloudCode(body.code)
                    : m[1] === 'cloud-signout' ? await hive.cloudSignOut()
                      : m[1] === 'hotwater' ? await hive.setHotWater(String(body.id), String(body.mode))
                        : m[1] === 'hotwater-boost' ? await hive.boostHotWater(String(body.id), body.minutes)
                          : await hive.setSwitch(body.id, body.on);
      console.log(new Date().toISOString(), `hive: ${m[1]} ok`);
      return send(res, 200, r);
    } catch (e) {
      console.error(new Date().toISOString(), `hive: ${m[1]} failed: ${e.message}`);
      return send(res, 502, { error: e.message });
    }
  }

  // --- Cameras (RTSP via ffmpeg) -----------------------------------------------------------------------
  if (route === 'POST /api/cameras') {
    try { const cam = cameras.add(await readJson(req)); console.log(new Date().toISOString(), `cameras: added "${cam.name}"`); return send(res, 200, cam); }
    catch (e) { console.error(new Date().toISOString(), `cameras: add failed: ${e.message}`); return send(res, 400, { error: e.message }); }
  }
  if ((m = url.pathname.match(/^\/api\/cameras\/([\w-]+)(?:\/(snapshot|live|ptz))?$/))) {
    try {
      if (req.method === 'DELETE' && !m[2]) return send(res, 200, cameras.remove(m[1]));
      if (req.method === 'GET' && m[2] === 'snapshot') return send(res, 200, await cameras.snapshot(m[1]), { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=5' });
      if (req.method === 'GET' && m[2] === 'live') return cameras.watch(m[1], res, (headers) => res.writeHead(200, { ...SECURITY_HEADERS, ...headers }));
      if (req.method === 'POST' && m[2] === 'ptz') return send(res, 200, await cameras.ptz(m[1], await readJson(req)));
    } catch (e) { return send(res, e.status ?? 502, { error: e.message }); }
  }

  // --- Routines ------------------------------------------------------------------------------------------
  if (route === 'GET /api/routines') return send(res, 200, { routines: routines.summary() });
  if (route === 'POST /api/routines') {
    try {
      const r = routines.save(await readJson(req));
      console.log(new Date().toISOString(), `routines: saved "${r.name}"`);
      return send(res, 200, r);
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if ((m = url.pathname.match(/^\/api\/routines\/([\w-]+)(?:\/(run|enable|disable))?$/))) {
    try {
      if (req.method === 'DELETE' && !m[2]) return send(res, 200, routines.remove(m[1]));
      if (req.method === 'POST' && m[2] === 'run') return send(res, 200, await routines.run(m[1]));
      if (req.method === 'POST' && m[2]) return send(res, 200, routines.setEnabled(m[1], m[2] === 'enable'));
    } catch (e) { return send(res, 400, { error: e.message }); }
  }

  // --- Ring (cloud account) -------------------------------------------------------------------------
  if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/ring\/(signin|code|signout|light|siren)$/))) {
    const body = await readJson(req);
    try {
      const r = m[1] === 'signin' ? await ring.signIn(body.email, body.password)
        : m[1] === 'code' ? await ring.verifyCode(body.code)
          : m[1] === 'signout' ? ring.signOut()
            : m[1] === 'light' ? await ring.setLight(body.id, Boolean(body.on))
              : await ring.setSiren(body.id, Boolean(body.on));
      console.log(new Date().toISOString(), `ring: ${m[1]} ${body.id ?? ''} ok`);
      return send(res, 200, r ?? { ok: true });
    } catch (e) {
      console.error(new Date().toISOString(), `ring: ${m[1]} failed: ${e.message}`);
      return send(res, 502, { error: e.message });
    }
  }
  if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/ring\/snapshot\/(\d+)$/))) {
    try {
      const shot = await ring.snapshot(m[1]);
      return send(res, 200, shot.buf, { 'Content-Type': shot.type });
    } catch (e) { return send(res, 404, { error: e.message }); }
  }

  // --- Yale alarm (cloud account) -------------------------------------------------------------------
  if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/yale\/(signin|signout|arm|disarm|pin)$/))) {
    const body = await readJson(req);
    try {
      if (m[1] === 'pin') {
        // changing the disarm PIN needs the household password, so a signed-in wall tablet can't be used to reset it
        const ok = auth.checkPassword(String(clientIp(req)).replace(/^::ffff:/, ''), body.password);
        if (!ok.ok) {
          console.warn(new Date().toISOString(), `yale: pin refused: ${ok.error}`);
          return send(res, 403, { error: ok.error === 'Wrong password' ? 'Wrong household password' : ok.error });
        }
      }
      const r = m[1] === 'signin' ? await yale.signIn(body.email, body.password)
        : m[1] === 'signout' ? yale.signOut()
          : m[1] === 'arm' ? await yale.arm(String(body.mode))
            : m[1] === 'disarm' ? await yale.disarm(body.pin)
              : yale.setPin(body.pin);
      console.log(new Date().toISOString(), `yale: ${m[1]} ${body.mode ?? ''} ok`);
      return send(res, 200, r ?? { ok: true });
    } catch (e) {
      console.error(new Date().toISOString(), `yale: ${m[1]} failed: ${e.message}`);
      return send(res, e.status ?? 502, { error: e.message });
    }
  }

  if (route === 'GET /api/settings') return send(res, 200, publicSettings());
  if (route === 'POST /api/settings') {
    const body = await readJson(req);
    try { applySettings(body); cameras.update(body.cameras ?? []); } catch (e) { return send(res, 400, { error: e.message }); }
    return send(res, 200, publicSettings());
  }

  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  if (!isHomeNetwork(req)) {
    console.warn(new Date().toISOString(), `blocked non-home request from ${clientIp(req)} ${req.method} ${url.pathname}`);
    return send(res, 403, 'Home Control is only available on the home network.', { 'Content-Type': 'text/plain' });
  }
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const file = STATIC[url.pathname];
    if (req.method !== 'GET' || !file) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const body = await readFile(path.join(PUBLIC, file[0]));
    return send(res, 200, body, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
  } catch (e) {
    console.error(new Date().toISOString(), req.method, url.pathname, e.message);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
  }
});

store.load();
netmon.start();
android.start();
smarttv.start();
ring.start();
yale.start();
routines.start();
cameras.start();
hive.start();
guide.pruneArtwork();
setInterval(() => guide.pruneArtwork(), 86400_000).unref();
server.listen(PORT, HOST, () => console.log(`home-control listening on http://${HOST}:${PORT} (data: ${store.DATA_DIR})`));
