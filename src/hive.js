// Hive heating over HomeKit (local, no cloud): pairing, thermostat status, target temperature, mode
// (Off / Manual / Schedule), boost with automatic revert, and any switches the hub exposes (e.g. hot water).
import dgram from 'node:dgram';
import * as hap from './hap.js';
import * as cloud from './hivecloud.js';
import * as store from './store.js';

const SVC = { info: '3E', thermostat: '4A', switch: '49' };
const CH = { name: '23', curState: 'F', targetState: '33', curTemp: '11', targetTemp: '35', on: '25' };
export const MODES = { off: 0, manual: 1, schedule: 3 };
const MODE_NAME = { 0: 'off', 1: 'manual', 2: 'manual', 3: 'schedule' };
const shortType = (t) => String(t).toUpperCase().replace(/^0+/, '').split('-')[0];

const cfg = () => {
  const c = store.get();
  if (!c.hive) store.update((x) => { x.hive = { ip: null, port: 9124, pairing: null, boost: null }; });
  return store.get().hive;
};

// --- mDNS: find the hub's current HomeKit port (it can change after a hub restart) ---------------
function readName(buf, off) {
  const labels = [];
  let jumped = false, end = off;
  for (let guard = 0; guard < 50; guard++) {
    const len = buf[off];
    if (len === 0) { if (!jumped) end = off + 1; break; }
    if ((len & 0xc0) === 0xc0) { if (!jumped) end = off + 2; off = ((len & 0x3f) << 8) | buf[off + 1]; jumped = true; continue; }
    labels.push(buf.subarray(off + 1, off + 1 + len).toString());
    off += 1 + len;
  }
  return [labels.join('.'), end];
}

function mdnsHapPorts(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const found = []; // { ip, port, id }
    const q = Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
      ...'_hap._tcp.local'.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0, 0, 12, 0, 1])]);
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', () => {});
    sock.on('message', (msg, rinfo) => {
      try {
        const counts = [msg.readUInt16BE(4), msg.readUInt16BE(6), msg.readUInt16BE(8), msg.readUInt16BE(10)];
        let off = 12;
        for (let i = 0; i < counts[0]; i++) off = readName(msg, off)[1] + 4;
        let port = null, id = null;
        for (let i = 0; i < counts[1] + counts[2] + counts[3]; i++) {
          const [, o] = readName(msg, off);
          const type = msg.readUInt16BE(o), len = msg.readUInt16BE(o + 8), data = o + 10;
          if (type === 33) port = msg.readUInt16BE(data + 4); // SRV
          if (type === 16) { // TXT
            for (let p = data; p < data + len;) { const l = msg[p]; const kv = msg.subarray(p + 1, p + 1 + l).toString(); if (kv.startsWith('id=')) id = kv.slice(3); p += 1 + l; }
          }
          off = data + len;
        }
        if (port) found.push({ ip: rinfo.address, port, id });
      } catch {}
    });
    sock.bind(() => sock.send(q, 5353, '224.0.0.251'));
    setTimeout(() => { sock.close(); resolve(found); }, timeoutMs);
  });
}

// --- session (one at a time, requests serialised) -------------------------------------------
let sess = null;
let chain = Promise.resolve();
let layout = null; // { thermostats: [...], switches: [...] }

async function openSession() {
  const h = cfg();
  if (!h.pairing) throw Object.assign(new Error('Hive is not paired yet (Settings → Hive heating)'), { code: 'UNPAIRED' });
  try {
    return await hap.session(h.pairing);
  } catch (e) {
    // the hub may have restarted on another port: look it up by its HomeKit id and retry once
    const hit = (await mdnsHapPorts()).find((f) => f.id === h.pairing.accessoryId) ?? (await mdnsHapPorts()).find((f) => f.ip === h.pairing.ip);
    if (!hit || (hit.port === h.pairing.port && hit.ip === h.pairing.ip)) throw e;
    store.update((c) => { c.hive.pairing.ip = hit.ip; c.hive.pairing.port = hit.port; c.hive.ip = hit.ip; c.hive.port = hit.port; });
    return hap.session(store.get().hive.pairing);
  }
}

function withSession(fn) {
  const run = chain.then(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!sess || sess.closed) { sess = null; sess = await openSession(); }
      try {
        return await fn(sess);
      } catch (e) {
        sess?.close();
        sess = null;
        if (attempt === 1 || e.code === 'UNPAIRED') throw e;
      }
    }
  });
  chain = run.catch(() => {});
  return run;
}

async function loadLayout(s) {
  const acc = await s.get('/accessories');
  const thermostats = [];
  const switches = [];
  for (const a of acc.accessories ?? []) {
    const info = a.services.find((x) => shortType(x.type) === SVC.info);
    const accName = info?.characteristics.find((c) => shortType(c.type) === CH.name)?.value;
    for (const svc of a.services) {
      const t = shortType(svc.type);
      const chars = Object.fromEntries(svc.characteristics.map((c) => [shortType(c.type), c]));
      const svcName = chars[CH.name]?.value || accName;
      if (t === SVC.thermostat) {
        const tt = chars[CH.targetTemp];
        thermostats.push({
          id: `${a.aid}`, aid: a.aid, name: svcName || 'Heating',
          iid: { curState: chars[CH.curState]?.iid, targetState: chars[CH.targetState]?.iid, curTemp: chars[CH.curTemp]?.iid, targetTemp: tt?.iid },
          min: tt?.minValue ?? 5, max: tt?.maxValue ?? 32, step: tt?.minStep ?? 0.5,
          modes: chars[CH.targetState]?.['valid-values'] ?? [0, 1, 3],
        });
      } else if (t === SVC.switch && chars[CH.on]) {
        switches.push({ id: `${a.aid}.${chars[CH.on].iid}`, aid: a.aid, iid: chars[CH.on].iid, name: svcName || 'Switch' });
      }
    }
  }
  return { thermostats, switches };
}

// --- status -------------------------------------------------------------------------------------
let status = { at: 0, online: false };
let recheck = null; // timer for the follow-up poll after a change
// Hive's API keeps reporting old values for a few seconds after a change: check again once it has caught up
function recheckSoon() { clearTimeout(recheck); recheck = setTimeout(() => poll().catch(() => {}), 6000); }

async function pollCloud() {
  try {
    const r = await cloud.status();
    status = {
      at: Date.now(), online: true, paired: true, source: 'cloud',
      thermostats: r.heating.map((t) => ({ ...t, mode: t.mode === 'boost' ? 'manual' : t.mode, boosting: t.mode === 'boost' })),
      hotwater: r.hotwater.map((w) => ({ ...w, boosting: w.mode === 'boost' })),
      switches: [],
    };
  } catch (e) {
    status = { ...status, at: Date.now(), online: false, paired: true, source: 'cloud', error: e.message };
  }
}

async function poll() {
  if (cloud.isSignedIn()) return pollCloud();
  if (!cfg().pairing) { status = { at: Date.now(), online: false, paired: false }; return; }
  try {
    const data = await withSession(async (s) => {
      if (!layout) layout = await loadLayout(s);
      const ids = [
        ...layout.thermostats.flatMap((t) => Object.values(t.iid).filter(Boolean).map((iid) => `${t.aid}.${iid}`)),
        ...layout.switches.map((w) => `${w.aid}.${w.iid}`),
      ];
      return ids.length ? (await s.get(`/characteristics?id=${ids.join(',')}`)).characteristics : [];
    });
    const val = (aid, iid) => data.find((c) => c.aid === aid && c.iid === iid)?.value;
    status = {
      at: Date.now(), online: true, paired: true,
      thermostats: layout.thermostats.map((t) => ({
        id: t.id, name: t.name, min: t.min, max: t.max, step: t.step,
        current: val(t.aid, t.iid.curTemp), target: val(t.aid, t.iid.targetTemp),
        mode: MODE_NAME[val(t.aid, t.iid.targetState)] ?? 'unknown', heating: val(t.aid, t.iid.curState) === 1,
        modes: t.modes.map((m) => MODE_NAME[m]).filter((v, i, a) => v && a.indexOf(v) === i),
      })),
      switches: layout.switches.map((w) => ({ id: w.id, name: w.name, on: Boolean(val(w.aid, w.iid)) })),
    };
  } catch (e) {
    status = { ...status, at: Date.now(), online: false, paired: Boolean(cfg().pairing), error: e.message };
  }
}

export function start() {
  const tick = async () => {
    await poll().catch(() => {});
    await checkBoost().catch(() => {});
    setTimeout(tick, cloud.isSignedIn() ? 60_000 : 30_000);
  };
  tick();
}

export function summary() {
  const h = cfg();
  if (cloud.isSignedIn()) return { ...status, paired: true, source: 'cloud', account: cloud.accountName(), boost: null };
  return { ...status, paired: Boolean(h.pairing), boost: h.boost ? { thermostat: h.boost.thermostat, until: h.boost.until, target: h.boost.target } : null, hub: h.ip ? `${h.ip}:${h.port}` : null };
}

// --- pairing ------------------------------------------------------------------------------------
export async function pair(code, ip, port) {
  const h = cfg();
  const where = { ip: ip || h.ip, port: Number(port) || h.port };
  // Prefer the port the hub is advertising right now
  const live = (await mdnsHapPorts()).find((f) => f.ip === where.ip);
  if (live) where.port = live.port;
  const pairing = await hap.pairSetup(where.ip, where.port, code);
  store.update((c) => { c.hive = { ...c.hive, ip: where.ip, port: where.port, pairing }; });
  sess?.close(); sess = null; layout = null;
  await poll();
  return summary();
}

export async function unpair() {
  if (cfg().pairing) await withSession((s) => s.unpair()).catch(() => {});
  sess?.close(); sess = null; layout = null;
  store.update((c) => { c.hive.pairing = null; c.hive.boost = null; });
  status = { at: Date.now(), online: false, paired: false };
  return summary();
}

// --- control ------------------------------------------------------------------------------------
function thermostat(id) {
  const t = layout?.thermostats.find((x) => x.id === String(id)) ?? layout?.thermostats[0];
  if (!t) throw new Error('No Hive thermostat found');
  return t;
}

export async function set(id, { target, mode }) {
  if (cloud.isSignedIn()) {
    await cloud.setHeating(id, { target, mode });
    // Hive's API keeps reporting the old values for a few seconds after a change, so polling now would show a
    // stale target. Record what was set, and check Hive again once it has caught up.
    const t = (status.thermostats ?? []).find((x) => x.id === String(id));
    if (t) {
      if (target != null) t.target = Math.round(Number(target) * 2) / 2;
      if (mode != null) t.mode = mode;
    }
    recheckSoon();
    return summary();
  }
  const writes = [];
  await withSession(async (s) => {
    if (!layout) layout = await loadLayout(s);
    const t = thermostat(id);
    if (mode != null) {
      if (!(mode in MODES)) throw new Error('Mode must be off, manual or schedule');
      writes.push({ aid: t.aid, iid: t.iid.targetState, value: MODES[mode] });
    }
    if (target != null) {
      const v = Number((Math.round(Number(target) / t.step) * t.step).toFixed(1));
      if (!(v >= t.min && v <= t.max)) throw new Error(`Temperature must be between ${t.min}° and ${t.max}°`);
      writes.push({ aid: t.aid, iid: t.iid.targetTemp, value: v });
    }
    if (writes.length) await s.put('/characteristics', { characteristics: writes });
  });
  await poll();
  return summary();
}

export async function setSwitch(id, on) {
  await withSession(async (s) => {
    if (!layout) layout = await loadLayout(s);
    const w = layout.switches.find((x) => x.id === String(id));
    if (!w) throw new Error('No such switch');
    await s.put('/characteristics', { characteristics: [{ aid: w.aid, iid: w.iid, value: Boolean(on) }] });
  });
  await poll();
  return summary();
}

/** Boost: manual mode at `target` for `minutes`, then put mode and temperature back as they were. */
export async function boost(id, minutes, target) {
  if (cloud.isSignedIn()) {
    await cloud.boostHeating(id, minutes, target);
    const t = (status.thermostats ?? []).find((x) => x.id === String(id));
    if (t) Object.assign(t, { mode: 'manual', boosting: true, boostMins: Math.round(Number(minutes)), ...(target != null ? { target: Math.round(Number(target) * 2) / 2 } : {}) });
    recheckSoon();
    return summary();
  }
  const mins = Math.max(15, Math.min(360, Number(minutes) || 60));
  if (!status.online) await poll();
  const t = (status.thermostats ?? []).find((x) => x.id === String(id)) ?? status.thermostats?.[0];
  if (!t) throw new Error('No Hive thermostat found');
  const prev = cfg().boost?.thermostat === t.id ? cfg().boost.previous : { mode: t.mode, target: t.target };
  const boostTarget = Number((Number(target) || Math.min(t.max, Math.max(21, (t.target ?? 20) + 1))).toFixed(1));
  await set(t.id, { mode: 'manual', target: boostTarget });
  store.update((c) => { c.hive.boost = { thermostat: t.id, until: Date.now() + mins * 60_000, target: boostTarget, previous: prev }; });
  return summary();
}

export async function cancelBoost(id) {
  if (cloud.isSignedIn()) {
    const t = (status.thermostats ?? []).find((x) => x.id === id) ?? (status.thermostats ?? []).find((x) => x.boosting);
    if (t) await cloud.cancelBoost(t.id);
    await poll();
    return summary();
  }
  const b = cfg().boost;
  if (!b) return summary();
  store.update((c) => { c.hive.boost = null; });
  await set(b.thermostat, { mode: b.previous.mode === 'unknown' ? 'schedule' : b.previous.mode, target: b.previous.target });
  return summary();
}

async function checkBoost() {
  if (cloud.isSignedIn()) return; // Hive ends its own boosts
  const b = cfg().boost;
  if (!b || Date.now() < b.until) return;
  // Only put things back if nobody changed the heating during the boost (Hive app, wall thermostat, etc.)
  const t = (status.thermostats ?? []).find((x) => x.id === b.thermostat);
  const untouched = t && t.mode === 'manual' && (b.target == null || Math.abs((t.target ?? 0) - b.target) < 0.05);
  if (untouched) {
    await cancelBoost();
  } else {
    store.update((c) => { c.hive.boost = null; });
    console.log(new Date().toISOString(), 'hive: boost ended; heating was changed elsewhere, so it was left as is');
  }
}

// --- Hive account (cloud) -------------------------------------------------------------------
export async function cloudSignIn(email, password) {
  const r = await cloud.signIn(email, password);
  if (r.ok) await poll();
  return { ...r, ...summary() };
}
export async function cloudCode(code) {
  await cloud.verifyCode(code);
  await poll();
  return summary();
}
export async function cloudSignOut() {
  cloud.signOut();
  status = { at: Date.now(), online: false, paired: Boolean(cfg().pairing) };
  await poll();
  return summary();
}
export async function setHotWater(id, mode) {
  await cloud.setHotWater(id, mode);
  await poll();
  return summary();
}
export async function boostHotWater(id, minutes) {
  await cloud.boostHotWater(id, minutes);
  const w = (status.hotwater ?? []).find((x) => x.id === String(id));
  if (w) Object.assign(w, { boosting: true, on: true, boostMins: Math.round(Number(minutes)) });
  recheckSoon();
  return summary();
}
