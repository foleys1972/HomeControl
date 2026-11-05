// Settings lock: changes to Home Control's setup need a PIN entered in the last few minutes on that device.
// The PIN is either a Settings PIN (set here, confirmed with the household password, so it works without an
// alarm) or the Yale alarm PIN; when both are set, either one unlocks. With neither set, Settings stay open.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import * as store from './store.js';
import * as auth from './auth.js';
import * as yale from './yale.js';

const PIN_RE = /^\d{4,8}$/;
const failures = { count: 0, until: 0 };
const refuse = (status, msg) => Object.assign(new Error(msg), { status });
const hash = (pin, salt) => scryptSync(String(pin), salt, 64).toString('hex');
const own = () => store.get().settingsPin ?? null;
const log = (msg) => console.log(new Date().toISOString(), `settings lock: ${msg}`);

export const ownPinSet = () => Boolean(own()?.hash);
/** Settings are locked when there's any PIN to unlock them with. */
export const active = () => ownPinSet() || yale.pinSet();

function matches(pin) {
  const p = own();
  if (!p?.hash || !PIN_RE.test(String(pin ?? ''))) return false;
  return timingSafeEqual(Buffer.from(hash(pin, p.salt), 'hex'), Buffer.from(p.hash, 'hex'));
}

/** Throws unless `pin` is the Settings PIN or the alarm PIN. Five wrong tries lock it for five minutes. */
export function check(pin) {
  if (failures.until > Date.now()) throw refuse(429, `Too many wrong PINs — try again in ${Math.ceil((failures.until - Date.now()) / 60_000)} min`);
  if (matches(pin) || yale.pinMatches(pin)) { failures.count = 0; return; }
  failures.count += 1;
  if (failures.count >= 5) { failures.until = Date.now() + 5 * 60_000; failures.count = 0; log('locked for 5 minutes after wrong PINs'); }
  throw refuse(403, 'Wrong PIN');
}

function checkPassword(ip, password) {
  const r = auth.checkPassword(ip, password);
  if (!r.ok) throw refuse(403, r.error === 'Wrong password' ? 'Wrong Home Control password' : r.error);
}

/** Set or change the Settings PIN. Needs the household (Home Control) password, not the old PIN. */
export function setPin(ip, pin, password) {
  if (!PIN_RE.test(String(pin ?? ''))) throw refuse(400, 'The PIN must be 4 to 8 digits');
  checkPassword(ip, password);
  const salt = randomBytes(16).toString('hex');
  store.update((c) => { c.settingsPin = { salt, hash: hash(pin, salt) }; });
  failures.count = 0; failures.until = 0;
  log(`Settings PIN set from ${ip}`);
  return { ok: true };
}

export function removePin(ip, password) {
  checkPassword(ip, password);
  store.update((c) => { delete c.settingsPin; });
  log(`Settings PIN removed from ${ip}`);
  return { ok: true };
}
