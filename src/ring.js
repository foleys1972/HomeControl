// Ring doorbells and cameras through the Ring account (cloud — Ring has no local API). Uses the same
// endpoints as the Ring Android app (as the ring-client-api project does): OAuth password sign-in with a
// 2-step code, then a long-lived refresh token. The password is used once and never stored; the token and
// this server's hardware id live in the data dir (mode 600). The API is unofficial and can change.
import { randomUUID } from 'node:crypto';
import * as store from './store.js';

const OAUTH = 'https://oauth.ring.com/oauth/token';
const API = 'https://api.ring.com/clients_api';
const UA = 'android:com.ringapp';
const CLIENT = { client_id: 'ring_official_android', scope: 'client' };

const log = (msg) => console.log(new Date().toISOString(), `ring: ${msg}`);

function cfg() {
  return store.get().ring ?? {};
}
function hardwareId() {
  if (!cfg().hardwareId) store.update((c) => { c.ring = { ...(c.ring ?? {}), hardwareId: randomUUID() }; });
  return cfg().hardwareId;
}

// --- sign-in -------------------------------------------------------------------------------------
let pending = null; // { email, password, at } while waiting for the 2-step code (kept in memory only)

async function token(body, code) {
  const r = await fetch(OAUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, '2fa-support': 'true', '2fa-code': code ?? '', hardware_id: hardwareId() },
    body: JSON.stringify({ ...CLIENT, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

function saveToken(email, t) {
  store.update((c) => {
    c.ring = { ...(c.ring ?? {}), email, refreshToken: t.refresh_token, accessToken: t.access_token, expires: Date.now() + (t.expires_in ?? 3600) * 1000 - 60_000 };
  });
  session = null;
}

function signInError(r) {
  if (r.status === 429) return 'Too many attempts — wait a few minutes';
  const msg = String(r.body.error_description ?? r.body.err_msg ?? r.body.error ?? '');
  if (/verification code/i.test(msg)) return 'That code is not right or has expired';
  if (r.status === 401 || /invalid/i.test(msg)) return 'Wrong email or password';
  return `Ring sign-in failed (${r.status}${msg ? `: ${msg}` : ''})`;
}

export async function signIn(email, password) {
  email = String(email ?? '').trim();
  if (!email || !password) throw new Error('Enter your Ring email and password');
  const r = await token({ grant_type: 'password', username: email, password: String(password) });
  if (r.status === 412 || r.body.tsv_state) {
    // Ring has sent a code (SMS, email or authenticator app)
    pending = { email, password: String(password), at: Date.now() };
    const via = r.body.tsv_state === 'totp' ? 'your authenticator app' : r.body.phone ? r.body.phone : r.body.tsv_state === 'email' ? 'your email' : 'your phone';
    return { mfa: true, destination: via };
  }
  if (r.status !== 200) throw new Error(signInError(r));
  saveToken(email, r.body);
  await devices(true).catch(() => {});
  return { ok: true };
}

export async function verifyCode(code) {
  if (!pending || Date.now() - pending.at > 10 * 60_000) { pending = null; throw new Error('Sign-in expired — enter your email and password again'); }
  const r = await token({ grant_type: 'password', username: pending.email, password: pending.password }, String(code ?? '').trim());
  if (r.status !== 200) throw new Error(signInError(r));
  saveToken(pending.email, r.body);
  pending = null;
  await devices(true).catch(() => {});
  return { ok: true };
}

export function signOut() {
  pending = null;
  store.update((c) => { c.ring = { hardwareId: c.ring?.hardwareId, hidden: c.ring?.hidden }; });
  cache = { at: 0, devices: [], events: [] };
}

export const isSignedIn = () => Boolean(cfg().refreshToken);

async function accessToken() {
  const c = cfg();
  if (!c.refreshToken) throw Object.assign(new Error('Not signed in to Ring'), { code: 'UNPAIRED' });
  if (c.accessToken && Date.now() < c.expires) return c.accessToken;
  const r = await token({ grant_type: 'refresh_token', refresh_token: c.refreshToken });
  if (r.status !== 200) {
    log(`token refresh failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    throw Object.assign(new Error('Ring sign-in has expired — sign in again in Settings'), { code: 'EXPIRED' });
  }
  saveToken(c.email, r.body);
  return r.body.access_token;
}

// The Ring app registers its hardware id as a session before using the API; some endpoints refuse without it.
let session = null;
async function ensureSession(bearer) {
  if (session) return;
  const r = await fetch(`${API}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ device: { hardware_id: hardwareId(), metadata: { api_version: 11, device_model: 'Home Control' }, os: 'android' } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok && r.status !== 429) log(`session failed: HTTP ${r.status}`);
  session = Date.now();
}

async function api(method, path, body, { raw = false, accept = 'application/json' } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const bearer = await accessToken();
    await ensureSession(bearer);
    const r = await fetch(path.startsWith('https://') ? path : `${API}${path}`, {
      method,
      headers: { 'User-Agent': UA, Accept: accept, hardware_id: hardwareId(), authorization: `Bearer ${bearer}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 401 && attempt === 0) { store.update((c) => { c.ring.expires = 0; }); session = null; continue; }
    if (!r.ok) throw new Error(`Ring service error (HTTP ${r.status})`);
    if (raw) return r;
    return r.status === 204 ? {} : r.json().catch(() => ({}));
  }
  throw new Error('Ring rejected the request');
}

// --- devices, events, snapshots --------------------------------------------------------------------
let cache = { at: 0, devices: [], events: [] };
const snapshots = new Map(); // id -> { at, type, buf }

function shape(d, group) {
  // light / siren support as ring-client-api decides it: the field is present in the device data
  return {
    id: d.id,
    location: d.location_id,
    name: d.description ?? 'Ring device',
    kind: d.kind ?? group,
    type: group === 'doorbots' || group === 'authorized_doorbots' ? 'doorbell' : group === 'chimes' ? 'chime' : 'camera',
    online: d.alerts?.connection ? d.alerts.connection === 'online' : true,
    battery: d.battery_life != null && d.battery_life !== '' ? Number(d.battery_life) : null,
    light: d.led_status !== undefined ? d.led_status === 'on' : null,
    siren: d.siren_status !== undefined ? Number(d.siren_status?.seconds_remaining ?? 0) > 0 : null,
    shared: group === 'authorized_doorbots',
  };
}

export async function devices(force = false) {
  if (!isSignedIn()) return [];
  if (!force && Date.now() - cache.at < 60_000) return cache.devices;
  const all = await api('GET', '/ring_devices');
  const list = [];
  for (const group of ['doorbots', 'authorized_doorbots', 'stickup_cams', 'chimes']) for (const d of all[group] ?? []) list.push(shape(d, group));
  cache = { ...cache, at: Date.now(), devices: list, events: await recentEvents(list).catch((e) => { log(`events failed: ${e.message}`); return cache.events; }) };
  return list;
}

// Per-camera event lists (as ring-client-api's getEvents), merged newest first; the older account-wide
// doorbots/history endpoint is the fallback.
async function recentEvents(list) {
  const cams = list.filter((d) => d.type !== 'chime' && d.location);
  const perCam = await Promise.all(cams.map((d) => api('GET', `/locations/${d.location}/devices/${d.id}/events?limit=5`)
    .then((r) => (r.events ?? []).map((e) => ({ id: String(e.event_id ?? e.ding_id_str ?? e.id), at: e.created_at, kind: e.kind, device: d.name })))
    .catch(() => null)));
  if (perCam.some(Boolean)) return perCam.flat().filter((e) => e && e.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 15);
  const h = await api('GET', '/doorbots/history?limit=15');
  return (Array.isArray(h) ? h : []).map((e) => ({ id: String(e.id), at: e.created_at, kind: e.kind, device: e.doorbot?.description ?? '' }));
}

// Devices picked in Settings as not to show (an unused camera, say): still listed there, hidden everywhere else.
const hiddenIds = () => new Set((cfg().hidden ?? []).map(String));

export function setHidden(id, hidden) {
  need(id);
  const set = hiddenIds();
  if (hidden) set.add(String(id)); else set.delete(String(id));
  store.update((c) => { c.ring = { ...(c.ring ?? {}), hidden: [...set] }; });
  return { ok: true };
}

export function summary() {
  const c = cfg();
  const hidden = hiddenIds();
  const devices = cache.devices.map((d) => ({ ...d, hidden: hidden.has(String(d.id)) }));
  const hiddenNames = new Set(devices.filter((d) => d.hidden).map((d) => d.name));
  return { signedIn: Boolean(c.refreshToken), account: c.email ?? null, devices, events: cache.events.filter((e) => !hiddenNames.has(e.device)).slice(0, 8), at: cache.at || null, error: cache.error ?? null };
}

export function start() {
  const tick = async () => {
    if (isSignedIn()) {
      try { await devices(); cache.error = null; } catch (e) { cache.error = e.message; }
    }
    setTimeout(tick, 60_000);
  };
  tick();
}

/** Latest snapshot as stored by Ring (no new capture: waking battery cameras drains them). Cached 2 minutes. */
export async function snapshot(id) {
  const dev = cache.devices.find((d) => String(d.id) === String(id));
  if (!dev || dev.type === 'chime') throw new Error('Unknown camera');
  const hit = snapshots.get(dev.id);
  if (hit && Date.now() - hit.at < 120_000) return hit;
  // app-snaps "next" without extras=force returns the latest stored image (as ring-client-api, minus the force)
  const r = await api('GET', `https://app-snaps.ring.com/snapshots/next/${dev.id}?after-ms=0&max-wait-ms=5000`, null, { raw: true, accept: 'image/jpeg' })
    .catch(() => api('GET', `/snapshots/image/${dev.id}`, null, { raw: true, accept: 'image/jpeg' }));
  const shot = { at: Date.now(), type: r.headers.get('content-type') || 'image/jpeg', buf: Buffer.from(await r.arrayBuffer()) };
  snapshots.set(dev.id, shot);
  return shot;
}

function need(id) {
  const dev = cache.devices.find((d) => String(d.id) === String(id));
  if (!dev) throw new Error('Unknown Ring device — refresh and try again');
  return dev;
}

export async function setLight(id, on) {
  const dev = need(id);
  if (dev.light == null) throw new Error(`${dev.name} has no light`);
  await api('PUT', `/doorbots/${dev.id}/floodlight_light_${on ? 'on' : 'off'}`);
  setTimeout(() => devices(true).catch(() => {}), 1500);
  return { ok: true };
}

export async function setSiren(id, on) {
  const dev = need(id);
  if (dev.siren == null) throw new Error(`${dev.name} has no siren`);
  await api('PUT', `/doorbots/${dev.id}/siren_${on ? 'on' : 'off'}`);
  setTimeout(() => devices(true).catch(() => {}), 1500);
  return { ok: true };
}
