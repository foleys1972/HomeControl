// Routines: scheduled actions run by the server ("porch light on at 20:00 every day", "when this programme
// starts, dim the lounge and warm it to 21°"). Kept in the config file; checked every 15 seconds.
// Times are UK time (Europe/London) whatever the server's own clock zone is, so they follow the clock changes.
import { randomUUID } from 'node:crypto';
import * as store from './store.js';
import * as hue from './hue.js';
import * as hive from './hive.js';
import * as sky from './skyq.js';

const TZ = 'Europe/London';
const CATCH_UP_MS = 10 * 60_000; // a routine missed by a restart still runs if we're back within 10 minutes
const log = (msg) => console.log(new Date().toISOString(), `routines: ${msg}`);

/** { day: 'YYYY-MM-DD', minutes: minutes since midnight, weekday: 0–6 (Sun = 0) } in UK time */
function ukNow(d = new Date()) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
      .formatToParts(d).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
  } catch {
    // runtime without time-zone data: fall back to the server clock
    return { day: d.toISOString().slice(0, 10), minutes: d.getHours() * 60 + d.getMinutes(), weekday: d.getDay() };
  }
}

const list = () => store.get().routines ?? [];

// --- validation -----------------------------------------------------------------------------------------
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function cleanAction(a) {
  if (a?.type === 'lights') {
    if (!['group', 'light'].includes(a.kind) || !/^\d+$/.test(String(a.id))) throw new Error('Pick a room or light');
    const out = { type: 'lights', kind: a.kind, id: String(a.id), name: String(a.name ?? '').slice(0, 40), on: Boolean(a.on) };
    if (out.on && a.bri != null) out.bri = Math.max(1, Math.min(100, Math.round(Number(a.bri))));
    return out;
  }
  if (a?.type === 'heating') {
    const target = Math.round(Number(a.target) * 2) / 2;
    if (!(target >= 5 && target <= 32)) throw new Error('Heating must be between 5° and 32°');
    const out = { type: 'heating', id: a.id == null ? null : String(a.id), target };
    if (a.minutes != null) out.minutes = Math.max(30, Math.min(360, Math.round(Number(a.minutes) / 30) * 30));
    return out;
  }
  if (a?.type === 'tv') {
    if (!/^[\w-]+$/.test(String(a.box)) || !/^\d+$/.test(String(a.sid))) throw new Error('Pick a Sky box and channel');
    return { type: 'tv', box: String(a.box), sid: String(a.sid), name: String(a.name ?? '').slice(0, 60) };
  }
  throw new Error('Unknown action');
}

function cleanTrigger(t) {
  if (t?.type === 'daily') {
    if (!TIME_RE.test(String(t.time))) throw new Error('Time must look like 20:00');
    const days = [...new Set((Array.isArray(t.days) ? t.days : [0, 1, 2, 3, 4, 5, 6]).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
    if (!days.length) throw new Error('Pick at least one day');
    return { type: 'daily', time: String(t.time), days };
  }
  if (t?.type === 'once') {
    const at = Number(t.at);
    if (!Number.isFinite(at) || at < Date.now() - 60_000) throw new Error('That time has already passed');
    return { type: 'once', at };
  }
  throw new Error('Choose when the routine runs');
}

function clean(body, prev = {}) {
  const name = String(body.name ?? '').trim().slice(0, 60);
  if (!name) throw new Error('Give the routine a name');
  const actions = (Array.isArray(body.actions) ? body.actions : []).map(cleanAction);
  if (!actions.length) throw new Error('Add at least one action');
  return {
    id: prev.id ?? randomUUID().slice(0, 8),
    name,
    enabled: body.enabled !== false,
    trigger: cleanTrigger(body.trigger),
    actions,
    programme: body.programme ? { sid: String(body.programme.sid), title: String(body.programme.title ?? '').slice(0, 80), st: Number(body.programme.st) || null } : prev.programme ?? null,
    lastRun: prev.lastRun ?? null,
    lastResult: prev.lastResult ?? null,
  };
}

// --- CRUD -------------------------------------------------------------------------------------------------
export const all = () => list();

export function save(body) {
  let saved;
  store.update((c) => {
    c.routines = c.routines ?? [];
    const i = body.id ? c.routines.findIndex((r) => r.id === body.id) : -1;
    saved = clean(body, i >= 0 ? c.routines[i] : {});
    if (i >= 0) c.routines[i] = saved; else c.routines.push(saved);
  });
  return saved;
}

export function setEnabled(id, enabled) {
  store.update((c) => { const r = (c.routines ?? []).find((x) => x.id === id); if (!r) throw new Error('No such routine'); r.enabled = Boolean(enabled); });
  return list().find((r) => r.id === id);
}

export function remove(id) {
  store.update((c) => { c.routines = (c.routines ?? []).filter((r) => r.id !== id); });
  return { ok: true };
}

// --- running ----------------------------------------------------------------------------------------------
async function runAction(a) {
  if (a.type === 'lights') {
    const state = a.on ? (a.bri != null ? { bri: Math.round((a.bri / 100) * 254) } : { on: true }) : { on: false };
    return a.kind === 'group' ? hue.setGroup(a.id, state) : hue.setLight(a.id, state);
  }
  if (a.type === 'heating') {
    // with a duration, boost (Hive returns to its own schedule afterwards); without, set a manual temperature
    const id = a.id ?? hive.summary().thermostats?.[0]?.id;
    return a.minutes ? hive.boost(id, a.minutes, a.target) : hive.set(id, { mode: 'manual', target: a.target });
  }
  if (a.type === 'tv') return sky.watch(a.box, a.sid);
}

const describe = (a) => (a.type === 'lights' ? `${a.name || `${a.kind} ${a.id}`} ${a.on ? (a.bri != null ? `${a.bri}%` : 'on') : 'off'}`
  : a.type === 'heating' ? `heating ${a.target}°${a.minutes ? ` for ${a.minutes} min` : ''}` : `TV → ${a.name || a.sid}`);

export async function run(id, why = 'manual') {
  const r = list().find((x) => x.id === id);
  if (!r) throw new Error('No such routine');
  const results = [];
  for (const a of r.actions) {
    try { await runAction(a); results.push({ ok: true, what: describe(a) }); } catch (e) { results.push({ ok: false, what: describe(a), error: e.message }); }
  }
  const failed = results.filter((x) => !x.ok);
  log(`"${r.name}" (${why}): ${results.map((x) => (x.ok ? x.what : `${x.what} FAILED: ${x.error}`)).join('; ')}`);
  store.update((c) => {
    const s = (c.routines ?? []).find((x) => x.id === id);
    if (!s) return;
    s.lastRun = Date.now();
    s.lastResult = failed.length ? `${failed.length} of ${results.length} failed: ${failed.map((x) => x.error).join('; ')}` : 'ok';
    if (s.trigger.type === 'once' && why === 'scheduled') s.enabled = false; // one-off: done
  });
  return { ok: !failed.length, results };
}

export function due(r, now = Date.now()) {
  if (!r.enabled) return false;
  if (r.trigger.type === 'once') return now >= r.trigger.at && now - r.trigger.at < CATCH_UP_MS && !(r.lastRun >= r.trigger.at);
  const uk = ukNow(new Date(now));
  if (!r.trigger.days.includes(uk.weekday)) return false;
  const [h, m] = r.trigger.time.split(':').map(Number);
  const late = (uk.minutes - (h * 60 + m)) * 60_000;
  if (late < 0 || late >= CATCH_UP_MS) return false;
  return !(r.lastRun && ukNow(new Date(r.lastRun)).day === uk.day && r.lastRun >= now - late - 60_000);
}

export function start() {
  let busy = false;
  const tick = async () => {
    if (!busy) {
      busy = true;
      for (const r of list().filter((x) => due(x))) await run(r.id, 'scheduled').catch((e) => log(`"${r.name}" failed: ${e.message}`));
      // tidy up one-off routines a day after they ran
      const stale = list().filter((r) => r.trigger.type === 'once' && !r.enabled && r.lastRun && Date.now() - r.lastRun > 86_400_000);
      if (stale.length) store.update((c) => { c.routines = c.routines.filter((r) => !stale.some((s) => s.id === r.id)); });
      busy = false;
    }
    setTimeout(tick, 15_000);
  };
  tick();
}

/** For the UI: next run time (ms) of a routine, or null */
export function nextRun(r, now = Date.now()) {
  if (!r.enabled) return null;
  if (r.trigger.type === 'once') return r.trigger.at > now ? r.trigger.at : null;
  for (let d = 0; d < 8; d++) {
    const probe = now + d * 86_400_000;
    const uk = ukNow(new Date(probe));
    if (!r.trigger.days.includes(uk.weekday)) continue;
    const [h, m] = r.trigger.time.split(':').map(Number);
    const at = probe + ((h * 60 + m) - uk.minutes) * 60_000;
    if (at > now) return at - (new Date(at).getSeconds() * 1000 + new Date(at).getMilliseconds());
  }
  return null;
}

export const summary = () => list().map((r) => ({ ...r, next: nextRun(r) }));
