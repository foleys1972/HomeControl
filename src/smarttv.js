// Network-only smart TVs (e.g. the Vestel-built Sharp Aquos LC-50CUI): no remote-key API, so control is what the
// TV exposes on the LAN — volume and mute through its UPnP media renderer (RenderingControl), and opening or
// closing YouTube / Netflix through DIAL (the protocol phones use to cast). Status is polled in the background.
import * as store from './store.js';

const DIAL_PORT = 56789; // Application-URL from the TV's DIAL description (port 56790 /dd.xml)
const UPNP_PORT = 52723; // AwoX/MStar media renderer
export const APPS = ['YouTube', 'Netflix'];

const status = new Map(); // id -> { online, volume, mute, apps: { YouTube: 'running' | 'stopped' }, at }

async function soap(ip, action, args = '') {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel>${args}</u:${action}></s:Body></s:Envelope>`;
  const r = await fetch(`http://${ip}:${UPNP_PORT}/aw/MediaRenderer_RenderingControl/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"urn:schemas-upnp-org:service:RenderingControl:1#${action}"` },
    body,
    signal: AbortSignal.timeout(4000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`TV refused ${action} (HTTP ${r.status})`);
  return text;
}
const tag = (xml, name) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];

async function appState(ip, app) {
  const r = await fetch(`http://${ip}:${DIAL_PORT}/apps/${app}`, { signal: AbortSignal.timeout(4000) });
  return r.ok ? tag(await r.text(), 'state') ?? 'unknown' : 'unavailable';
}

async function probe(dev) {
  try {
    const [vol, mute, ...apps] = await Promise.all([soap(dev.ip, 'GetVolume'), soap(dev.ip, 'GetMute'), ...APPS.map((a) => appState(dev.ip, a))]);
    status.set(dev.id, {
      online: true,
      volume: Number(tag(vol, 'CurrentVolume')),
      mute: tag(mute, 'CurrentMute') === '1',
      apps: Object.fromEntries(APPS.map((a, i) => [a, apps[i]])),
      at: Date.now(),
    });
  } catch {
    // TV in standby or off: it drops off the network
    status.set(dev.id, { online: false, at: Date.now() });
  }
}

export function start() {
  const tick = async () => {
    for (const dev of store.get().smarttv ?? []) {
      const st = status.get(dev.id);
      if (!st || Date.now() - st.at > (st.online ? 15_000 : 60_000)) await probe(dev).catch(() => {});
    }
    setTimeout(tick, 5000);
  };
  tick();
}

export function summary() {
  return (store.get().smarttv ?? []).map((d) => ({ id: d.id, name: d.name, ip: d.ip, ...(status.get(d.id) ?? { checking: true }) }));
}

// --- actions -----------------------------------------------------------------------------
function need(id) {
  const dev = (store.get().smarttv ?? []).find((d) => d.id === id);
  if (!dev) throw new Error('Unknown TV');
  return dev;
}

/** body: { level } (0–100) or { step } (e.g. -2 / +2) */
export async function volume(id, { level, step }) {
  const dev = need(id);
  let v = Number(level);
  if (level == null) v = Number(tag(await soap(dev.ip, 'GetVolume'), 'CurrentVolume')) + Number(step || 0);
  if (!Number.isFinite(v)) throw new Error('Volume must be a number');
  v = Math.max(0, Math.min(100, Math.round(v)));
  await soap(dev.ip, 'SetVolume', `<DesiredVolume>${v}</DesiredVolume>`);
  await probe(dev);
  return { ok: true, volume: v };
}

export async function mute(id, on) {
  const dev = need(id);
  await soap(dev.ip, 'SetMute', `<DesiredMute>${on ? 1 : 0}</DesiredMute>`);
  await probe(dev);
  return { ok: true, mute: Boolean(on) };
}

/** Open (or with stop: true, close) YouTube / Netflix through DIAL. */
export async function app(id, name, stop = false) {
  const dev = need(id);
  if (!APPS.includes(name)) throw new Error('Unknown app');
  const url = `http://${dev.ip}:${DIAL_PORT}/apps/${name}`;
  // DIAL: POST launches; DELETE on the running instance (the app description's <link rel="run">) stops it
  let r;
  if (stop) {
    const desc = await (await fetch(url, { signal: AbortSignal.timeout(4000) })).text();
    const run = /<link[^>]*rel="run"[^>]*href="([^"]+)"/.exec(desc)?.[1] ?? 'run';
    r = await fetch(`${url}/${run}`, { method: 'DELETE', signal: AbortSignal.timeout(8000) });
  } else {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: '', signal: AbortSignal.timeout(8000) });
  }
  if (!r.ok) throw new Error(`TV refused to ${stop ? 'close' : 'open'} ${name} (HTTP ${r.status})`);
  setTimeout(() => probe(dev).catch(() => {}), 2500);
  return { ok: true };
}
