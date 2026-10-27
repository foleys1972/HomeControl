// Network health: TCP reachability of the router and internet every 2 s (outages logged), and a
// read-only poll of the Cisco switches every 60 s (topology changes, ports). Events go to events.jsonl.
import net from 'node:net';
import * as store from './store.js';
import * as cisco from './cisco.js';

const events = store.readLines('events.jsonl', 300);
const targets = new Map(); // name -> { up, fails, rtt: [], since }
const switches = new Map(); // id -> latest poll

function event(type, msg, extra = {}) {
  const e = { ts: new Date().toISOString(), type, msg, ...extra };
  events.push(e);
  if (events.length > 300) events.shift();
  store.appendLine('events.jsonl', e);
}

function tcpCheck(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const s = net.connect({ host, port });
    const done = (ok) => { s.destroy(); resolve(ok ? Math.round(performance.now() - t0) : null); };
    s.setTimeout(timeout, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
}

async function pingRound() {
  for (const t of store.get().pingTargets) {
    const rtt = await tcpCheck(t.host, t.port);
    const st = targets.get(t.name) ?? { up: true, fails: 0, rtt: [], since: Date.now() };
    st.rtt.push(rtt);
    if (st.rtt.length > 90) st.rtt.shift();
    if (rtt === null) {
      st.fails++;
      if (st.fails === 2 && st.up) { st.up = false; st.since = Date.now(); event('outage', `${t.name} unreachable`, { target: t.name }); }
    } else {
      if (!st.up) {
        const secs = Math.round((Date.now() - st.since) / 1000) + 2;
        event('recovered', `${t.name} back after ~${secs}s`, { target: t.name, secs });
        st.up = true;
        st.since = Date.now();
      }
      st.fails = 0;
    }
    targets.set(t.name, st);
  }
}

function parseSwitch(tcOut, statusOut, rootOut) {
  const tc = tcOut.match(/Number of topology changes (\d+) last change occurred (\S+) ago\s+from (\S+)/);
  const ports = statusOut.split('\n')
    .map((l) => l.match(/^(\S+)\s+(.*?)\s+(connected|notconnect|disabled|err-disabled)\s+(\S+)\s+(\S+)\s+(\S+)/))
    .filter(Boolean)
    .map((m) => ({ port: m[1], name: m[2].trim(), status: m[3], vlan: m[4], speed: m[6] }));
  const root = (rootOut.match(/Address\s+([0-9a-f.]+)/) || [])[1] ?? null;
  return { tc: tc ? { count: Number(tc[1]), ago: tc[2], from: tc[3] } : null, ports, root };
}

async function switchRound() {
  const { cisco: creds, switches: list } = store.get();
  if (!creds.password) return;
  for (const sw of list) {
    try {
      const [tcOut, statusOut, rootOut] = await cisco.run(sw.ip, creds, [
        'show spanning-tree detail | include occurred|from',
        'show interfaces status',
        'show spanning-tree vlan 2 | include Address',
      ]);
      const now = parseSwitch(tcOut, statusOut, rootOut);
      const prev = switches.get(sw.id);
      if (prev?.tc && now.tc && now.tc.count > prev.tc.count) {
        event('topology', `${sw.name}: +${now.tc.count - prev.tc.count} topology change(s), latest from ${now.tc.from}`, { switch: sw.id });
      }
      if (prev && !prev.ok) event('recovered', `${sw.name} answering again`, { switch: sw.id });
      switches.set(sw.id, { ok: true, at: Date.now(), ...now });
    } catch (e) {
      const prev = switches.get(sw.id);
      if (!prev || prev.ok) event('switch-error', `${sw.name}: ${e.message}`, { switch: sw.id });
      switches.set(sw.id, { ...(prev || {}), ok: false, at: Date.now(), error: e.message });
    }
  }
}

export function start() {
  const loop = (fn, ms) => { const tick = () => fn().catch(() => {}).finally(() => setTimeout(tick, ms)); tick(); };
  loop(pingRound, 2000);
  loop(switchRound, 60_000);
}

export function summary() {
  const cfg = store.get();
  return {
    targets: cfg.pingTargets.map((t) => {
      const st = targets.get(t.name);
      const ok = st?.rtt.filter((x) => x !== null) ?? [];
      return { name: t.name, up: st ? st.up : null, last: st?.rtt.at(-1) ?? null, avg: ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : null, history: st?.rtt.slice(-60) ?? [] };
    }),
    switches: cfg.switches.map((sw) => ({ id: sw.id, name: sw.name, ip: sw.ip, ...(switches.get(sw.id) || { ok: null }) })),
    ciscoConfigured: Boolean(cfg.cisco.password),
    events: events.slice(-50).reverse(),
  };
}
