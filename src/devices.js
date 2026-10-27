// Adding / removing devices from Settings, and a "find devices" scan of the home network.
import { execFileSync } from 'node:child_process';
import dgram from 'node:dgram';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import * as store from './store.js';

const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** A private (home-network, RFC 1918) IPv4 address that is not a network or broadcast address. */
export function isPrivateIp(ip) {
  const m = String(ip).match(IP_RE);
  if (!m) return false;
  const [a, b, , d] = m.slice(1).map(Number);
  if (m.slice(1).some((x) => Number(x) > 255) || d === 0 || d === 255) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** The router (default gateway) from the Linux routing table; null elsewhere. */
export function defaultGateway() {
  try {
    const row = readFileSync('/proc/net/route', 'utf8').split('\n').slice(1).map((l) => l.trim().split(/\s+/)).find((f) => f[1] === '00000000');
    if (!row) return null;
    const hex = row[2];
    return [6, 4, 2, 0].map((i) => parseInt(hex.slice(i, i + 2), 16)).join('.'); // little-endian
  } catch { return null; }
}
const KINDS = { androidtv: 'Android TV', shield: 'NVIDIA Shield', firetv: 'Fire TV' };

function slug(name, taken) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'device';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

function validate({ name, ip }) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Give the device a name');
  if (!isPrivateIp(ip)) throw new Error('IP must be a home-network address (the kind your router hands out)');
}

function allIds(c) {
  return new Set([...c.sky.map((d) => d.id), ...(c.android ?? []).map((d) => d.id)]);
}

function ipTaken(c, ip) {
  return [...c.sky, ...(c.android ?? [])].find((d) => d.ip === ip);
}

export function add({ type, kind, name, ip }) {
  validate({ name, ip });
  const c = store.get();
  const clash = ipTaken(c, ip);
  if (clash) throw new Error(`${ip} is already added as "${clash.name}"`);
  const id = slug(name, allIds(c));
  const clean = name.trim().slice(0, 40);
  if (type === 'sky') {
    store.update((cfg) => { cfg.sky.push({ id, name: clean, ip }); });
  } else if (type === 'android') {
    if (!KINDS[kind]) throw new Error('Choose Android TV, NVIDIA Shield or Fire TV');
    store.update((cfg) => { cfg.android = cfg.android ?? []; cfg.android.push({ id, name: clean, ip, kind }); });
  } else {
    throw new Error('Unsupported device type');
  }
  return { ok: true, id };
}

export function remove(type, id) {
  const key = type === 'sky' ? 'sky' : type === 'android' ? 'android' : null;
  if (!key) throw new Error('Unsupported device type');
  const before = (store.get()[key] ?? []).length;
  store.update((cfg) => { cfg[key] = (cfg[key] ?? []).filter((d) => d.id !== id); });
  if ((store.get()[key] ?? []).length === before) throw new Error('No such device');
  return { ok: true };
}

// --- discovery ---------------------------------------------------------------------------
function tcpOpen(ip, port, timeout = 700) {
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeout, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
}

function arpIps() {
  try {
    return readFileSync('/proc/net/arp', 'utf8').split('\n').slice(1).map((l) => l.split(/\s+/)[0]).filter((ip) => IP_RE.test(ip));
  } catch {
    // not Linux (local development on Windows): read `arp -a`
    try {
      return [...execFileSync('arp', ['-a'], { encoding: 'utf8', timeout: 5000 }).matchAll(/(192\.168\.1\.\d{1,3})\s+[0-9a-f-]{17}/gi)].map((m) => m[1]);
    } catch {
      return [];
    }
  }
}

function ssdp() {
  return new Promise((resolve) => {
    const found = new Map(); // ip -> Set(location)
    const sock = dgram.createSocket('udp4');
    sock.on('message', (msg, r) => {
      const loc = /location:\s*(\S+)/i.exec(msg.toString());
      if (!found.has(r.address)) found.set(r.address, new Set());
      if (loc) found.get(r.address).add(loc[1]);
    });
    sock.on('error', () => {});
    sock.bind(() => sock.send(Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n'), 1900, '239.255.255.250'));
    setTimeout(() => { sock.close(); resolve(found); }, 3000);
  });
}

async function describeSsdp(locations) {
  for (const loc of [...locations].slice(0, 3)) {
    try {
      const x = await (await fetch(loc, { headers: { 'User-Agent': 'SKY_skyplus' }, signal: AbortSignal.timeout(2000) })).text();
      const name = (x.match(/<(?:\w+:)?friendlyName>([^<]+)</) || [])[1];
      const model = (x.match(/<(?:\w+:)?modelName>([^<]+)</) || [])[1];
      const maker = (x.match(/<(?:\w+:)?manufacturer>([^<]+)</) || [])[1];
      if (name || model) return { name, model, maker };
    } catch {}
  }
  return {};
}

function guessKind(text) {
  const t = text.toLowerCase();
  if (t.includes('shield') || t.includes('nvidia')) return 'shield';
  if (t.includes('amazon') || /\baft\w*/.test(t) || t.includes('fire')) return 'firetv';
  return 'androidtv';
}

/** Sky boxes and Android/Fire devices on the network that aren't added yet. */
export async function discover() {
  const c = store.get();
  const ssdpMap = await ssdp();
  const ips = [...new Set([...arpIps(), ...[...ssdpMap.keys()].filter(isPrivateIp)])].filter((ip) => !ipTaken(c, ip) && ip !== defaultGateway());
  const out = [];
  for (let i = 0; i < ips.length; i += 16) {
    const batch = await Promise.all(ips.slice(i, i + 16).map(async (ip) => {
      const [sky, adb, cast] = await Promise.all([tcpOpen(ip, 9006), tcpOpen(ip, 5555), tcpOpen(ip, 8009)]);
      if (!sky && !adb && !cast) return null;
      const desc = await describeSsdp(ssdpMap.get(ip) ?? []);
      if (sky) {
        try {
          const info = await (await fetch(`http://${ip}:9006/as/system/information`, { signal: AbortSignal.timeout(2500) })).json();
          return { ip, type: 'sky', name: info.airplayID || 'Sky Q box', note: `${info.hardwareName ?? 'Sky Q'}${info.gateway ? ' · main box' : ' · Mini'}` };
        } catch {}
      }
      const label = [desc.name, desc.model, desc.maker].filter(Boolean).join(' · ');
      if (!adb && !/android|shield|amazon|fire|aft/i.test(label)) return null; // cast-only speakers etc.
      return { ip, type: 'android', kind: guessKind(label), name: desc.name || KINDS[guessKind(label)], note: `${label || 'Android device'}${adb ? ' · debugging on' : ' · debugging off'}` };
    }));
    out.push(...batch.filter(Boolean));
  }
  return out.sort((a, b) => Number(a.ip.split('.')[3]) - Number(b.ip.split('.')[3]));
}
