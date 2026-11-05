// Routines: actions run by the server ("porch light on at 20:00 every day", "hall light on when the doorbell rings
// after dark", "when this programme starts, dim the lounge and warm it to 21°"). Kept in the config file; timed
// ones are checked every 15 seconds, event ones run when Ring or Yale reports the event.
// Times are UK time (Europe/London) whatever the server's own clock zone is, so they follow the clock changes.
import { randomUUID } from 'node:crypto';
import * as store from './store.js';
import * as hue from './hue.js';
import * as hive from './hive.js';
import * as sky from './skyq.js';
import * as android from './android.js';
import * as smarttv from './smarttv.js';
import * as yale from './yale.js';
import * as events from './events.js';
import * as sun from './sun.js';

const TZ = 'Europe/London';
const CATCH_UP_MS = 10 * 60_000; // a routine missed by a restart still runs if we're back within 10 minutes
const COOLDOWN_MS = 60_000; // an event routine won't run again within a minute (motion comes in bursts)
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

// What each kind of TV can do in a routine. Saved routines from before (Sky box + channel) still load.
const TV_DO = { sky: ['on', 'off', 'channel'], android: ['on', 'off'], smarttv: ['volume', 'mute', 'unmute', 'app'] };
function cleanTv(a) {
  const kind = a.kind ?? 'sky';
  const device = String(a.device ?? a.box ?? '');
  const what = a.do ?? (a.sid ? 'channel' : 'on');
  if (!TV_DO[kind] || !/^[\w-]+$/.test(device)) throw new Error('Pick a TV');
  if (!TV_DO[kind].includes(what)) throw new Error('That TV can\'t do that');
  const legacy = a.box != null && a.device == null; // old format: name held the channel, not the TV
  const out = { type: 'tv', kind, device, do: what, name: legacy ? '' : String(a.name ?? '').slice(0, 60) };
  if (what === 'channel') {
    if (!/^\d+$/.test(String(a.sid))) throw new Error('Pick a channel');
    Object.assign(out, { sid: String(a.sid), channel: String((legacy ? a.name : a.channel) ?? '').slice(0, 60) });
  }
  if (what === 'volume') {
    const level = Math.round(Number(a.level));
    if (!(level >= 0 && level <= 100)) throw new Error('Volume must be 0–100');
    out.level = level;
  }
  if (what === 'app') {
    if (!smarttv.APPS.includes(a.app)) throw new Error('Pick an app');
    out.app = a.app;
  }
  return out;
}

function cleanAction(a) {
  if (a?.type === 'lights') {
    if (!['group', 'light'].includes(a.kind) || !/^\d+$/.test(String(a.id))) throw new Error('Pick a room or light');
    const out = { type: 'lights', kind: a.kind, id: String(a.id), name: String(a.name ?? '').slice(0, 40), on: Boolean(a.on) };
    if (out.on && a.bri != null) out.bri = Math.max(1, Math.min(100, Math.round(Number(a.bri))));
    // "on for 5 minutes": switched off again afterwards, unless it was already on
    if (out.on && a.minutes != null && a.minutes !== '') {
      const m = Math.round(Number(a.minutes));
      if (!(m >= 1 && m <= 240)) throw new Error('Lights can stay on for 1 to 240 minutes');
      out.minutes = m;
    }
    return out;
  }
  if (a?.type === 'heating') {
    const target = Math.round(Number(a.target) * 2) / 2;
    if (!(target >= 5 && target <= 32)) throw new Error('Heating must be between 5° and 32°');
    const out = { type: 'heating', id: a.id == null ? null : String(a.id), target };
    if (a.minutes != null) out.minutes = Math.max(30, Math.min(360, Math.round(Number(a.minutes) / 30) * 30));
    return out;
  }
  if (a?.type === 'tv') return cleanTv(a);
  // routines can arm the alarm but never disarm it; Run now asks for the PIN, scheduled runs don't
  if (a?.type === 'alarm') {
    if (!['arm', 'home'].includes(a.mode)) throw new Error('Pick full arm or part arm');
    return { type: 'alarm', mode: a.mode };
  }
  throw new Error('Unknown action');
}

function cleanTrigger(t) {
  if (t?.type === 'daily') {
    if (!TIME_RE.test(String(t.time))) throw new Error('Time must look like 20:00');
    return { type: 'daily', time: String(t.time), days: cleanDays(t.days) };
  }
  if (t?.type === 'once') {
    const at = Number(t.at);
    if (!Number.isFinite(at) || at < Date.now() - 60_000) throw new Error('That time has already passed');
    return { type: 'once', at };
  }
  if (t?.type === 'manual') return { type: 'manual' }; // a scene: runs only when someone taps it
  if (t?.type === 'sun') {
    if (!['sunrise', 'sunset'].includes(t.event)) throw new Error('Pick sunrise or sunset');
    const offset = Math.round(Number(t.offset ?? 0));
    if (!(offset >= -180 && offset <= 180)) throw new Error('Up to 3 hours before or after');
    const days = cleanDays(t.days);
    needPlace();
    return { type: 'sun', event: t.event, offset, days };
  }
  if (t?.type === 'event') return cleanEvent(t);
  throw new Error('Choose when the routine runs');
}

function cleanDays(d) {
  const days = [...new Set((Array.isArray(d) ? d : [0, 1, 2, 3, 4, 5, 6]).map(Number).filter((x) => x >= 0 && x <= 6))].sort();
  if (!days.length) throw new Error('Pick at least one day');
  return days;
}

// sunset times and "only after dark" need to know where the house is: the place picked for the weather
const place = () => store.get().weather ?? null;
function needPlace() {
  if (!place()) throw new Error('Sunset times need your location: pick it in the weather box on the Hallway screen first');
}

const RING_KINDS = ['ding', 'motion'];
const ALARM_MODES = ['armed', 'part', 'disarmed'];
function cleanEvent(t) {
  if (t.source === 'ring') {
    if (!RING_KINDS.includes(t.kind)) throw new Error('Pick doorbell press or motion');
    return { type: 'event', source: 'ring', kind: t.kind, device: String(t.device ?? '').slice(0, 60) }; // '' = any Ring device
  }
  if (t.source === 'alarm') {
    if (!ALARM_MODES.includes(t.mode)) throw new Error('Pick armed, part armed or disarmed');
    return { type: 'event', source: 'alarm', mode: t.mode };
  }
  if (t.source === 'door') {
    if (!['open', 'closed'].includes(t.state)) throw new Error('Pick opened or closed');
    const minutes = t.state === 'open' ? Math.round(Number(t.minutes ?? 0)) : 0;
    if (!(minutes >= 0 && minutes <= 240)) throw new Error('Left open for up to 240 minutes');
    // sensor '' = any door
    return { type: 'event', source: 'door', sensor: String(t.sensor ?? '').slice(0, 80), name: String(t.name ?? '').slice(0, 60), state: t.state, minutes };
  }
  throw new Error('Pick what the routine reacts to');
}

// "Only if…" conditions, checked whenever the routine would run by itself (not when someone taps it)
function cleanOnly(o) {
  if (!o) return null;
  const out = {};
  if (o.dark === 'dark' || o.dark === 'light') { needPlace(); out.dark = o.dark; }
  if (o.from || o.to) {
    if (!TIME_RE.test(String(o.from)) || !TIME_RE.test(String(o.to))) throw new Error('Times must look like 07:00');
    if (o.from === o.to) throw new Error('The from and to times are the same');
    Object.assign(out, { from: String(o.from), to: String(o.to) });
  }
  if (ALARM_MODES.includes(o.alarm)) out.alarm = o.alarm;
  return Object.keys(out).length ? out : null;
}

const SCENE_ICONS = new Set(['home', 'door', 'moon', 'sun', 'tv', 'bulb', 'flame', 'shield', 'power', 'play']);
function cleanScene(sc) {
  if (!sc) return null;
  return { icon: SCENE_ICONS.has(sc.icon) ? sc.icon : 'play' };
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
    only: cleanOnly(body.only),
    actions,
    scene: cleanScene(body.scene),
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
// lights switched on "for N minutes": key -> { timer, restoreOff }, so a second ring restarts the clock
const offTimers = new Map();
async function lightIsOn(a) {
  const rooms = (await hue.summary().catch(() => null))?.rooms ?? [];
  if (a.kind === 'group') return Boolean(rooms.find((r) => String(r.id) === a.id)?.on);
  return Boolean(rooms.flatMap((r) => r.lights ?? []).find((l) => String(l.id) === a.id)?.on);
}

async function runAction(a) {
  if (a.type === 'lights') {
    const set = (state) => (a.kind === 'group' ? hue.setGroup(a.id, state) : hue.setLight(a.id, state));
    const key = `${a.kind}:${a.id}`;
    const pending = offTimers.get(key);
    if (pending) { clearTimeout(pending.timer); offTimers.delete(key); }
    // only switch it off afterwards if it was off before (or we'd put out a light someone is using)
    const restoreOff = a.on && a.minutes ? (pending ? pending.restoreOff : !(await lightIsOn(a))) : false;
    const result = await set(a.on ? (a.bri != null ? { bri: Math.round((a.bri / 100) * 254) } : { on: true }) : { on: false });
    if (restoreOff) {
      const timer = setTimeout(() => {
        offTimers.delete(key);
        set({ on: false }).then(() => log(`${a.name || key} off after ${a.minutes} min`), (e) => log(`${a.name || key} off after ${a.minutes} min FAILED: ${e.message}`));
      }, a.minutes * 60_000);
      timer.unref?.();
      offTimers.set(key, { timer, restoreOff });
    }
    return result;
  }
  if (a.type === 'heating') {
    // with a duration, boost (Hive returns to its own schedule afterwards); without, set a manual temperature
    const id = a.id ?? hive.summary().thermostats?.[0]?.id;
    return a.minutes ? hive.boost(id, a.minutes, a.target) : hive.set(id, { mode: 'manual', target: a.target });
  }
  if (a.type === 'tv') {
    const kind = a.kind ?? 'sky';
    const id = a.device ?? a.box;
    const what = a.do ?? 'channel';
    if (kind === 'android') return android.key(id, what === 'on' ? 'wake' : 'sleep');
    if (kind === 'smarttv') {
      if (what === 'volume') return smarttv.volume(id, { level: a.level });
      if (what === 'app') return smarttv.app(id, a.app);
      return smarttv.mute(id, what === 'mute');
    }
    if (what === 'channel') return sky.watch(id, a.sid); // wakes the box first if it's in standby
    // the Sky power key toggles, so only press it when the box isn't already where we want it
    const box = (await sky.summary()).find((b) => b.id === id);
    if (!box?.online) throw new Error('Sky box not answering');
    if (what === 'on' && box.standby) return sky.sendKey(id, 'sky');
    if (what === 'off' && !box.standby) return sky.sendKey(id, 'power');
    return null;
  }
  if (a.type === 'alarm') return yale.armScheduled(a.mode);
}

const describe = (a) => (a.type === 'lights' ? `${a.name || `${a.kind} ${a.id}`} ${a.on ? (a.bri != null ? `${a.bri}%` : 'on') : 'off'}${a.on && a.minutes ? ` for ${a.minutes} min` : ''}`
  : a.type === 'heating' ? `heating ${a.target}°${a.minutes ? ` for ${a.minutes} min` : ''}`
  : a.type === 'alarm' ? (a.mode === 'home' ? 'part arm the alarm' : 'arm the alarm')
  : `${a.name || a.device || a.box}: ${a.do === 'channel' || !a.do ? `channel ${a.channel || a.sid}` : a.do === 'volume' ? `volume ${a.level}` : a.do === 'app' ? `open ${a.app}` : a.do}`);

export async function run(id, why = 'manual', pin) {
  const r = list().find((x) => x.id === id);
  if (!r) throw new Error('No such routine');
  if (why === 'manual' && r.actions.some((a) => a.type === 'alarm')) yale.checkPin(pin); // someone pressed Run now
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

/** Sunrise / sunset (plus the routine's offset) on a UK day, as a timestamp; null without a location */
function sunAt(t, day) {
  const p = place();
  if (!p) return null;
  const s = sun.times(day, p.lat, p.lon);
  const base = t.event === 'sunset' ? s.set : s.rise;
  return base == null ? null : base + t.offset * 60_000;
}

/** Do the routine's "only if…" conditions hold right now? */
export function allowed(r, now = Date.now()) {
  const o = r.only;
  if (!o) return true;
  if (o.dark) {
    const p = place();
    if (!p) return false;
    if (sun.isDark(now, ukNow(new Date(now)).day, p.lat, p.lon) !== (o.dark === 'dark')) return false;
  }
  if (o.from && o.to) {
    const m = ukNow(new Date(now)).minutes;
    const toMin = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3));
    const from = toMin(o.from);
    const to = toMin(o.to);
    if (!(from < to ? m >= from && m < to : m >= from || m < to)) return false; // 22:00–06:00 runs across midnight
  }
  if (o.alarm && yale.summary().mode !== o.alarm) return false;
  return true;
}

/** Does this event set the routine off? (conditions are checked separately) */
export function matches(r, e) {
  const t = r.trigger;
  if (!r.enabled || t.type !== 'event' || t.source !== e.source) return false;
  if (t.source === 'ring') return t.kind === e.kind && (!t.device || t.device === e.device);
  if (t.source === 'alarm') return t.mode === e.mode;
  if (t.source === 'door') return !t.minutes && t.state === e.state && (!t.sensor || t.sensor === e.sensor);
  return false;
}

/** A door left open: true once a matching door has been open for the routine's minutes (once per opening) */
export function heldOpen(r, sensors, now = Date.now()) {
  const t = r.trigger;
  if (!r.enabled || t.type !== 'event' || t.source !== 'door' || !t.minutes || t.state !== 'open') return false;
  return sensors.some((s) => s.open === true && s.changed && (!t.sensor || t.sensor === s.id)
    && now - s.changed >= t.minutes * 60_000 && !(r.lastRun >= s.changed));
}

export function due(r, now = Date.now()) {
  if (!r.enabled || r.trigger.type === 'manual' || r.trigger.type === 'event') return false;
  if (r.trigger.type === 'once') return now >= r.trigger.at && now - r.trigger.at < CATCH_UP_MS && !(r.lastRun >= r.trigger.at);
  const uk = ukNow(new Date(now));
  if (r.trigger.type === 'sun') {
    if (!r.trigger.days.includes(uk.weekday)) return false;
    const at = sunAt(r.trigger, uk.day);
    return at != null && now >= at && now - at < CATCH_UP_MS && !(r.lastRun >= at);
  }
  if (!r.trigger.days.includes(uk.weekday)) return false;
  const [h, m] = r.trigger.time.split(':').map(Number);
  const late = (uk.minutes - (h * 60 + m)) * 60_000;
  if (late < 0 || late >= CATCH_UP_MS) return false;
  return !(r.lastRun && ukNow(new Date(r.lastRun)).day === uk.day && r.lastRun >= now - late - 60_000);
}

// runs a routine by itself (timed or event), if its conditions hold and it hasn't just run
const lastAuto = new Map(); // id -> ms
const skipped = new Map(); // id -> ms: a timed routine whose conditions failed stays "due" for a while; say so once
async function auto(r, why) {
  if (!allowed(r)) {
    if (r.trigger.type !== 'event' && Date.now() - (skipped.get(r.id) ?? 0) < CATCH_UP_MS) return;
    skipped.set(r.id, Date.now());
    log(`"${r.name}" (${why}) skipped: its "only if" conditions weren't met`);
    return;
  }
  if (r.trigger.type === 'event' && Date.now() - (lastAuto.get(r.id) ?? 0) < COOLDOWN_MS) return;
  lastAuto.set(r.id, Date.now());
  await run(r.id, why).catch((e) => log(`"${r.name}" failed: ${e.message}`));
}

const eventWhy = (e) => (e.source === 'ring' ? `${e.device || 'Ring'} ${e.kind === 'ding' ? 'rang' : 'saw motion'}`
  : e.source === 'alarm' ? `alarm ${e.mode}` : `${e.name || 'door'} ${e.state === 'open' ? 'opened' : 'closed'}`);

export function start() {
  events.on((e) => { for (const r of list().filter((x) => matches(x, e))) auto(r, eventWhy(e)); });
  let busy = false;
  const tick = async () => {
    if (!busy) {
      busy = true;
      for (const r of list().filter((x) => due(x))) await auto(r, 'scheduled');
      const sensors = yale.summary().sensors ?? [];
      for (const r of list().filter((x) => heldOpen(x, sensors))) {
        lastAuto.delete(r.id); // fires once per opening anyway, so no cooldown
        await auto(r, `${r.trigger.name || 'a door'} open ${r.trigger.minutes} min`);
      }
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
  if (!r.enabled || r.trigger.type === 'manual' || r.trigger.type === 'event') return null;
  if (r.trigger.type === 'once') return r.trigger.at > now ? r.trigger.at : null;
  if (r.trigger.type === 'sun') {
    for (let d = 0; d < 8; d++) {
      const uk = ukNow(new Date(now + d * 86_400_000));
      if (!r.trigger.days.includes(uk.weekday)) continue;
      const at = sunAt(r.trigger, uk.day);
      if (at != null && at > now) return at - (at % 60_000);
    }
    return null;
  }
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
