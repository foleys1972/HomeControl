// Yale Smart Alarm (the "Yale Alarm" app, formerly Yale Smart Living) through the Yale account — cloud only.
// Uses the same endpoints as the Yale app, as the yale-smart-alarm-client project does (Apache-2.0,
// github.com/domwillcode/yale-smart-alarm-client): password sign-in once, then the refresh token. The password
// is never stored. Disarming needs the Home Control alarm PIN (scrypt hash, set with the Yale password).
// The API is unofficial and can change.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import * as store from './store.js';

const HOST = 'https://mob.yalehomesystem.co.uk/yapi';
const CLIENT = 'VnVWWDZYVjlXSUNzVHJhcUVpdVNCUHBwZ3ZPakxUeXNsRU1LUHBjdTpkd3RPbE15WEtENUJ5ZW1GWHV0am55eGhrc0U3V0ZFY2p0dFcyOXRaSWNuWHlSWHFsWVBEZ1BSZE1xczF4R3VwVTlxa1o4UE5ubGlQanY5Z2hBZFFtMHpsM0h4V3dlS0ZBcGZzakpMcW1GMm1HR1lXRlpad01MRkw3MGR0bmNndQ=='; // the Yale app's public client id, as yale-smart-alarm-client sends it
const MODES = { arm: 'armed', home: 'part', disarm: 'disarmed' };

const log = (msg) => console.log(new Date().toISOString(), `yale: ${msg}`);

function cfg() {
  return store.get().yale ?? {};
}

// --- sign-in -------------------------------------------------------------------------------------
async function token(body) {
  const r = await fetch(`${HOST}/o/token/`, {
    method: 'POST',
    headers: { Authorization: `Basic ${CLIENT}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

function saveToken(email, t) {
  store.update((c) => {
    c.yale = { ...(c.yale ?? {}), email, refreshToken: t.refresh_token, accessToken: t.access_token, expires: Date.now() + (t.expires_in ?? 3600) * 1000 - 60_000 };
  });
}

// The token answer names the API host to use for this account (the Yale app does the same).
async function findHost(bearer) {
  const r = await fetch(`${HOST}/services/`, { headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const url = r?.ok ? (await r.json().catch(() => ({}))).yapi : null;
  if (typeof url === 'string' && /^https:\/\/[\w.-]+\.yalehomesystem\.co\.uk\//.test(url)) store.update((c) => { c.yale.host = url.replace(/\/+$/, ''); });
}

export async function signIn(email, password) {
  email = String(email ?? '').trim();
  if (!email || !password) throw new Error('Enter your Yale email and password');
  const r = await token({ grant_type: 'password', username: email, password: String(password) });
  if (r.status === 401 || r.status === 400) throw new Error('Wrong email or password');
  if (r.status !== 200 || !r.body.refresh_token) throw new Error(`Yale sign-in failed (HTTP ${r.status})`);
  saveToken(email, r.body);
  await findHost(r.body.access_token);
  await refresh(true).catch(() => {});
  return { ok: true };
}

export function signOut() {
  store.update((c) => { c.yale = { pin: c.yale?.pin }; });
  cache = { at: 0, mode: null, sensors: [] };
}

export const isSignedIn = () => Boolean(cfg().refreshToken);

async function accessToken() {
  const c = cfg();
  if (!c.refreshToken) throw Object.assign(new Error('Not signed in to Yale'), { code: 'UNPAIRED' });
  if (c.accessToken && Date.now() < c.expires) return c.accessToken;
  const r = await token({ grant_type: 'refresh_token', refresh_token: c.refreshToken });
  if (r.status !== 200 || !r.body.access_token) {
    log(`token refresh failed: HTTP ${r.status}`);
    throw Object.assign(new Error('Yale sign-in has expired — sign in again in Settings'), { code: 'EXPIRED' });
  }
  saveToken(c.email, { refresh_token: c.refreshToken, ...r.body });
  return r.body.access_token;
}

async function api(method, path, form) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const bearer = await accessToken();
    const r = await fetch(`${cfg().host ?? HOST}${path}`, {
      method,
      headers: { Authorization: `Bearer ${bearer}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if ((r.status === 401 || r.status === 403) && attempt === 0) { store.update((c) => { c.yale.expires = 0; }); continue; }
    if (!r.ok) throw new Error(`Yale service error (HTTP ${r.status})`);
    return r.json().catch(() => ({}));
  }
  throw new Error('Yale rejected the request');
}

// --- status ----------------------------------------------------------------------------------------
let cache = { at: 0, mode: null, sensors: [] };

const KIND = { 'device_type.door_contact': 'door', 'device_type.pir': 'motion', 'device_type.keypad': 'keypad', 'device_type.door_lock': 'lock', 'device_type.bx': 'siren', 'device_type.ext_siren': 'siren' };

function sensor(d) {
  const status = `${d.status1 ?? ''} ${d.status2 ?? ''} ${d.status_fault ?? ''}`;
  const kind = KIND[d.type] ?? 'other';
  // locks: the bridge's status bits when present (16 = door closed, 1 = locked), as yale-smart-alarm-client reads them
  let locked = null;
  if (kind === 'lock') {
    const bits = d.minigw_lock_status ? parseInt(d.minigw_lock_status, 16) : NaN;
    locked = Number.isNaN(bits) ? (/device_status\.lock/.test(status) ? true : /device_status\.unlock/.test(status) ? false : null)
      : (bits & 16) !== 16 ? 'dooropen' : (bits & 1) === 1;
  }
  return {
    id: String(d.device_id ?? d.address ?? d.name),
    name: String(d.name || 'Sensor'),
    kind,
    open: kind === 'door' ? (/dc_open/.test(status) ? true : /dc_close/.test(status) ? false : null) : locked === 'dooropen' ? true : null,
    locked: locked === 'dooropen' ? false : locked,
    lowBattery: /low_battery|battery_low/.test(status),
    tamper: /tamper/.test(status),
  };
}

export async function refresh(force = false) {
  if (!isSignedIn()) return cache;
  if (!force && Date.now() - cache.at < 25_000) return cache;
  const [mode, devices] = await Promise.all([api('GET', '/api/panel/mode/'), api('GET', '/api/panel/device_status/')]);
  const raw = Array.isArray(mode.data) ? mode.data[0]?.mode : null;
  cache = { at: Date.now(), mode: MODES[raw] ?? null, sensors: (Array.isArray(devices.data) ? devices.data : []).map(sensor), error: null };
  return cache;
}

export function summary() {
  const c = cfg();
  return { signedIn: Boolean(c.refreshToken), account: c.email ?? null, pinSet: Boolean(c.pin?.hash), mode: cache.mode, sensors: cache.sensors, at: cache.at || null, error: cache.error ?? null };
}

export function start() {
  const tick = async () => {
    if (isSignedIn()) {
      try { await refresh(true); } catch (e) { cache.error = e.message; }
    }
    setTimeout(tick, 30_000);
  };
  tick();
}

// --- arming --------------------------------------------------------------------------------------
async function setMode(mode) {
  const r = await api('POST', '/api/panel/mode/', { area: '1', mode });
  if (r.code !== '000') throw new Error(r.message ? `Yale refused: ${r.message}` : 'Yale refused the change');
  cache = { ...cache, mode: MODES[mode] };
  setTimeout(() => refresh(true).catch(() => {}), 3000);
  log(`${mode} ok`);
  return { ok: true, mode: MODES[mode] };
}

/** Full arm ('arm') or part arm ('home'). Arming needs no PIN; disarming does. */
export function arm(mode) {
  if (!['arm', 'home'].includes(mode)) throw new Error('Unknown alarm mode');
  return setMode(mode);
}

// --- disarm PIN ------------------------------------------------------------------------------------
const failures = { count: 0, until: 0 };
const pinHash = (pin, salt) => scryptSync(String(pin), salt, 64).toString('hex');
const refuse = (status, msg) => Object.assign(new Error(msg), { status });

const owner = { count: 0, until: 0 }; // wrong Yale passwords when setting the PIN

/** Set or change the alarm PIN. Needs the Yale account password (checked with Yale), so a signed-in wall tablet
 *  can't be used to change it. */
export async function setPin(pin, password) {
  if (!/^\d{4,8}$/.test(String(pin ?? ''))) throw refuse(400, 'The PIN must be 4 to 8 digits');
  const c = cfg();
  if (!c.refreshToken || !c.email) throw refuse(400, 'Sign in to Yale first');
  if (!password) throw refuse(400, 'Enter your Yale password');
  if (owner.until > Date.now()) throw refuse(429, `Too many wrong passwords — try again in ${Math.ceil((owner.until - Date.now()) / 60_000)} min`);
  const r = await token({ grant_type: 'password', username: c.email, password: String(password) });
  if (r.status === 400 || r.status === 401) {
    owner.count += 1;
    if (owner.count >= 3) { owner.until = Date.now() + 5 * 60_000; owner.count = 0; }
    log('pin refused: wrong Yale password');
    throw refuse(403, 'Wrong Yale password');
  }
  if (r.status !== 200 || !r.body.refresh_token) throw refuse(502, `Yale could not check the password (HTTP ${r.status})`);
  owner.count = 0;
  saveToken(c.email, r.body);
  const salt = randomBytes(16).toString('hex');
  store.update((c) => { c.yale = { ...(c.yale ?? {}), pin: { salt, hash: pinHash(pin, salt) } }; });
  failures.count = 0; failures.until = 0;
  return { ok: true };
}

function checkPin(pin) {
  const p = cfg().pin;
  if (!p?.hash) throw refuse(400, 'Set an alarm PIN in Settings first');
  if (failures.until > Date.now()) throw refuse(429, `Too many wrong PINs — try again in ${Math.ceil((failures.until - Date.now()) / 60_000)} min`);
  const ok = /^\d{4,8}$/.test(String(pin ?? '')) && timingSafeEqual(Buffer.from(pinHash(pin, p.salt), 'hex'), Buffer.from(p.hash, 'hex'));
  if (ok) { failures.count = 0; return; }
  failures.count += 1;
  if (failures.count >= 5) { failures.until = Date.now() + 5 * 60_000; failures.count = 0; log('disarm locked for 5 minutes after wrong PINs'); }
  throw refuse(403, 'Wrong PIN');
}

export function disarm(pin) {
  checkPin(pin);
  return setMode('disarm');
}
