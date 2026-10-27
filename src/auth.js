// One household password (scrypt hash) and stateless signed session cookies.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import * as store from './store.js';

const COOKIE = 'hc_session';
const SESSION_DAYS = 30;
const failures = new Map(); // ip -> { count, until }

export const isSetUp = () => Boolean(store.get().auth.hash);

function hash(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

export function setPassword(password) {
  if (typeof password !== 'string' || password.length < 8) throw new Error('Password must be at least 8 characters');
  const salt = randomBytes(16).toString('hex');
  store.update((c) => { c.auth.salt = salt; c.auth.hash = hash(password, salt); });
}

export function checkPassword(ip, password) {
  const f = failures.get(ip);
  if (f && f.until > Date.now()) return { ok: false, error: 'Too many attempts — wait a minute' };
  const { salt, hash: stored } = store.get().auth;
  const ok = typeof password === 'string' && stored &&
    timingSafeEqual(Buffer.from(hash(password, salt), 'hex'), Buffer.from(stored, 'hex'));
  if (ok) { failures.delete(ip); return { ok: true }; }
  const count = (f?.count ?? 0) + 1;
  failures.set(ip, { count, until: count >= 5 ? Date.now() + 60_000 : 0 });
  return { ok: false, error: 'Wrong password' };
}

function sign(payload) {
  return createHmac('sha256', store.get().auth.secret).update(payload).digest('base64url');
}

export function sessionCookie() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 86400_000 })).toString('base64url');
  return `${COOKIE}=${payload}.${sign(payload)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}

export const clearCookie = () => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

export function isAuthed(req) {
  const raw = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return false;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now();
  } catch {
    return false;
  }
}
