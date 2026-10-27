// Sky Q boxes: REST on :9006 (system info, recordings), UPnP SkyPlay on :49153 (what's playing), the
// remote-control socket on :49160 (key presses) and DIAL on :8008 (launch apps). None of these need a password.
import dgram from 'node:dgram';
import net from 'node:net';
import * as store from './store.js';
import * as guide from './guide.js';

const UA = { 'User-Agent': 'SKY_skyplus' };
const TIMEOUT = 4000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const boxById = (id) => store.get().sky.find((b) => b.id === id);
const gatewayIp = () => (boxById('main') || store.get().sky[0]).ip;

async function rest(ip, p) {
  const r = await fetch(`http://${ip}:9006${p}`, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// --- UPnP SkyPlay control URL (found once per box) ----------------------------------------
const playUrl = new Map();

async function skyPlayControl(ip) {
  if (playUrl.has(ip)) return playUrl.get(ip);
  for (let n = 0; n < 4; n++) {
    let xml;
    try {
      const r = await fetch(`http://${ip}:49153/description${n}.xml`, { headers: UA, signal: AbortSignal.timeout(TIMEOUT) });
      xml = await r.text();
    } catch {
      continue;
    }
    for (const m of xml.matchAll(/<serviceType>([^<]*SkyPlay[^<]*)<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/g)) {
      const found = { type: m[1], url: `http://${ip}:49153${m[2]}` };
      playUrl.set(ip, found);
      return found;
    }
  }
  return null;
}

async function soap(ip, action) {
  const ctl = await skyPlayControl(ip);
  if (!ctl) throw new Error('No SkyPlay service');
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${ctl.type}">` +
    `<InstanceID>0</InstanceID></u:${action}></s:Body></s:Envelope>`;
  const r = await fetch(ctl.url, {
    method: 'POST',
    headers: { ...UA, 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"${ctl.type}#${action}"` },
    body,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) { playUrl.delete(ip); throw new Error(`SOAP HTTP ${r.status}`); }
  return r.text();
}

const tag = (xml, name) => (xml.match(new RegExp(`<${name}>([^<]*)</${name}>`)) || [])[1] ?? '';

// --- recordings (cached) ------------------------------------------------------------------
let recordings = { at: 0, byId: new Map() };

async function recordingById(id) {
  if (Date.now() - recordings.at > 300_000) {
    const j = await rest(gatewayIp(), '/as/pvr?limit=2000&offset=0');
    recordings = { at: Date.now(), byId: new Map((j.pvrItems || []).map((p) => [String(p.pvrid), { title: p.t, channel: p.cn, synopsis: p.sy || '', uuid: p.programmeuuid || null }])) };
  }
  return recordings.byId.get(String(id)) ?? null;
}

// --- apps via DIAL ------------------------------------------------------------------------
// User-facing apps that the Sky Q DIAL server accepted by these ids (checked 2026-10-27), with a tile colour.
export const APPS = [
  { id: 'Netflix', title: 'Netflix', color: '#e50914' },
  { id: 'YouTube', title: 'YouTube', color: '#ff0033' },
  { id: 'iPlayer', title: 'BBC iPlayer', color: '#f54997' },
  { id: 'prime.video', title: 'Prime Video', color: '#1a98ff' },
  { id: 'DisneyPlus', title: 'Disney+', color: '#113ccf' },
  { id: 'com.sky.itv', title: 'ITVX', color: '#102c3d', fg: '#dfff4f' },
  { id: 'com.sky.all4', title: 'Channel 4', color: '#3c3c3c' },
  { id: 'com.sky.my5', title: 'My5', color: '#c8102e' },
  { id: 'uktv', title: 'U', color: '#ff5f00' },
  { id: 'apple.tv', title: 'Apple TV', color: '#1d1d1f' },
  { id: 'ParamountPlus', title: 'Paramount+', color: '#0064ff' },
  { id: 'DiscoveryPlus', title: 'discovery+', color: '#2175d9' },
  { id: 'hbo_hbomax', title: 'HBO Max', color: '#2b0ad6' },
  { id: 'com.spotify.Spotify.TVv2', title: 'Spotify', color: '#1db954', fg: '#06210f' },
  { id: 'dazn', title: 'DAZN', color: '#0c161c', fg: '#f8fc00' },
  { id: 'tntsports', title: 'TNT Sports', color: '#111111' },
  { id: 'hayu', title: 'hayu', color: '#c7007d' },
  { id: 'crunchyroll', title: 'Crunchyroll', color: '#f47521' },
];

const dialUrls = new Map(); // ip -> Application-URL

function ssdpDial() {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket('udp4');
    sock.on('message', (msg, rinfo) => {
      const loc = /location:\s*(\S+)/i.exec(msg.toString());
      if (loc) found.set(rinfo.address, loc[1]);
    });
    sock.on('error', () => {});
    sock.bind(() => {
      sock.send(Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: urn:dial-multiscreen-org:service:dial:1\r\n\r\n'), 1900, '239.255.255.250');
    });
    setTimeout(() => { sock.close(); resolve(found); }, 3000);
  });
}

async function dialAppUrl(ip, fresh = false) {
  if (!fresh && dialUrls.has(ip)) return dialUrls.get(ip);
  const found = await ssdpDial();
  for (const [addr, loc] of found) {
    try {
      const r = await fetch(loc, { signal: AbortSignal.timeout(TIMEOUT) });
      const appUrl = r.headers.get('application-url');
      if (appUrl) dialUrls.set(addr, appUrl.replace(/\/?$/, '/'));
    } catch {}
  }
  if (!dialUrls.has(ip)) throw new Error('This box did not answer app discovery');
  return dialUrls.get(ip);
}

/** Wake a box from standby (Sky key) and give it time to come up. Returns true if it had to wake it. */
async function wake(box) {
  const info = await rest(box.ip, '/as/system/information').catch(() => null);
  if (!info) throw new Error(`${box.name} is not answering`);
  if (!info.activeStandby) return false;
  await sendKey(box.id, 'sky');
  for (let i = 0; i < 12; i++) {
    await sleep(1000);
    const now = await rest(box.ip, '/as/system/information').catch(() => null);
    if (now && !now.activeStandby) { await sleep(2500); return true; }
  }
  return true;
}

export async function launchApp(boxId, appId) {
  const box = boxById(boxId);
  const app = APPS.find((a) => a.id === appId);
  if (!box || !app) throw new Error('Unknown box or app');
  await wake(box); // a DIAL launch to a box in standby is accepted but shows nothing
  for (const fresh of [false, true]) {
    const url = await dialAppUrl(box.ip, fresh);
    const r = await fetch(url + encodeURIComponent(app.id), { method: 'POST', body: '', signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (r && (r.status === 201 || r.status === 200)) { cache.at = 0; return { ok: true }; }
    if (r && r.status === 404 && !fresh) continue;
    throw new Error(r ? `The box refused to open ${app.title} (HTTP ${r.status})` : 'The box did not respond');
  }
}

async function runningApp(ip) {
  const url = await dialAppUrl(ip).catch(() => null);
  if (!url) return null;
  const states = await Promise.all(APPS.map(async (a) => {
    try {
      const x = await (await fetch(url + encodeURIComponent(a.id), { signal: AbortSignal.timeout(2500) })).text();
      return tag(x, 'state') === 'running' ? a : null;
    } catch {
      return null;
    }
  }));
  return states.find(Boolean) ?? null;
}

// --- per-box status ----------------------------------------------------------------------
async function boxStatus(box) {
  const out = { id: box.id, name: box.name, ip: box.ip, online: false };
  try {
    const info = await rest(box.ip, '/as/system/information');
    Object.assign(out, { online: true, standby: Boolean(info.activeStandby), model: info.hardwareName, uptimeH: Math.round((info.systemUptime || 0) / 360) / 10 });
  } catch {
    return out;
  }
  if (out.standby) return out;
  try {
    const [media, transport] = await Promise.all([soap(box.ip, 'GetMediaInfo'), soap(box.ip, 'GetTransportInfo')]);
    const uri = tag(media, 'CurrentURI');
    out.state = tag(transport, 'CurrentTransportState') || null;
    if (uri.startsWith('xsi://')) {
      const sid = String(parseInt(uri.slice(6), 16));
      const ch = await guide.channelBySid(sid).catch(() => null);
      out.channel = ch ?? { sid, name: `Channel ${sid}` };
      Object.assign(out, await guide.nowNext(sid).catch(() => ({})));
    } else if (uri.startsWith('file://pvr/')) {
      out.recording = (await recordingById(uri.slice(11)).catch(() => null)) ?? { title: 'A recording' };
    } else {
      out.app = await runningApp(box.ip);
    }
  } catch (e) {
    out.playError = e.message;
  }
  return out;
}

let cache = { at: 0, data: null };

export async function summary() {
  if (Date.now() - cache.at < 4000 && cache.data) return cache.data;
  const data = await Promise.all(store.get().sky.map(boxStatus));
  cache = { at: Date.now(), data };
  return data;
}

// --- remote control (port 49160) -----------------------------------------------------------
export const KEYS = {
  power: 0, select: 1, backup: 2, channelup: 6, channeldown: 7, help: 9, search: 10, home: 11, i: 14,
  up: 16, down: 17, left: 18, right: 19, red: 32, green: 33, yellow: 34, blue: 35,
  0: 48, 1: 49, 2: 50, 3: 51, 4: 52, 5: 53, 6: 54, 7: 55, 8: 56, 9: 57,
  play: 64, pause: 65, stop: 66, record: 67, fastforward: 69, rewind: 71, sky: 241,
};

export function sendKey(boxId, key) {
  const box = boxById(boxId);
  if (!box || !(key in KEYS)) return Promise.reject(new Error('Unknown box or key'));
  const code = KEYS[key];
  const cmd = [4, 1, 0, 0, 0, 0, Math.floor(224 + code / 16), code % 16];
  cache.at = 0;
  return new Promise((resolve, reject) => {
    let l = 12;
    const sock = net.connect(49160, box.ip);
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('Sky box did not respond')); }, TIMEOUT);
    sock.on('data', (data) => {
      if (data.length < 24) {
        sock.write(data.subarray(0, l));
        l = 1;
      } else {
        sock.write(Buffer.from(cmd));
        cmd[1] = 0;
        sock.write(Buffer.from(cmd));
        clearTimeout(timer);
        sock.end();
        resolve({ ok: true });
      }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/** Tune a box to a channel: wake it if in standby, then type the channel number. */
export async function watch(boxId, sid) {
  const box = boxById(boxId);
  const ch = await guide.channelBySid(sid);
  if (!box || !ch) throw new Error('Unknown box or channel');
  await wake(box);
  for (const digit of ch.number) { await sendKey(boxId, digit); await sleep(250); }
  cache.at = 0;
  return { ok: true, channel: ch };
}
