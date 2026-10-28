// IP cameras on the home network that publish an RTSP stream (e.g. the TAS-Tech dog camera). Browsers can't play
// RTSP, so ffmpeg turns it into JPEG snapshots (cached and refreshed in the background) and, while someone is
// watching, a 5 fps MJPEG live feed shared by all viewers. Use a camera's small sub-stream: the server's CPU is modest.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as store from './store.js';
import { isPrivateIp } from './devices.js';

const FFMPEG = process.env.HOME_CONTROL_FFMPEG || 'ffmpeg';
const SNAP_FRESH_MS = 10_000; // serve the cached picture and refresh it in the background after this
const SNAP_MAX_AGE_MS = 120_000; // older than this, wait for a new one
const LIVE_IDLE_MS = 5_000; // stop the live feed this long after the last viewer leaves
const LIVE_MAX_MS = 10 * 60_000; // and never keep one viewer's feed running longer than this
const log = (msg) => console.log(new Date().toISOString(), `cameras: ${msg}`);

const list = () => store.get().cameras ?? [];
const need = (id) => { const c = list().find((x) => x.id === id); if (!c) throw Object.assign(new Error('Unknown camera'), { status: 404 }); return c; };

// --- settings ------------------------------------------------------------------------------------
function cleanUrl(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { throw new Error('Enter the camera\'s RTSP address, like rtsp://<camera-ip>:554/0/video1'); }
  if (u.protocol !== 'rtsp:') throw new Error('The address must start with rtsp://');
  if (!isPrivateIp(u.hostname)) throw new Error('The camera must be on the home network');
  return u.toString();
}

export function add({ name, url }) {
  const cam = { id: randomUUID().slice(0, 8), name: String(name ?? '').trim().slice(0, 40), url: cleanUrl(url) };
  if (!cam.name) throw new Error('Give the camera a name');
  store.update((c) => { c.cameras = [...(c.cameras ?? []), cam]; });
  return cam;
}

export function update(changes = []) {
  store.update((c) => {
    for (const ch of changes) {
      const cam = (c.cameras ?? []).find((x) => x.id === ch.id);
      if (!cam) continue;
      if (typeof ch.name === 'string' && ch.name.trim()) cam.name = ch.name.trim().slice(0, 40);
      if (ch.url && ch.url !== cam.url) cam.url = cleanUrl(ch.url);
    }
  });
}

export function remove(id) {
  stopLive(id);
  snaps.delete(id);
  store.update((c) => { c.cameras = (c.cameras ?? []).filter((x) => x.id !== id); });
  return { ok: true };
}

export const summary = () => list().map((c) => ({ id: c.id, name: c.name, snapshotAt: snaps.get(c.id)?.at ?? null, live: lives.get(c.id)?.clients.size ?? 0 }));
export const settings = () => list().map((c) => ({ id: c.id, name: c.name, url: c.url }));

// --- snapshots -----------------------------------------------------------------------------------
const snaps = new Map(); // id -> { at, buf }
const pending = new Map(); // id -> Promise<buf>

function grab(cam) {
  if (pending.has(cam.id)) return pending.get(cam.id);
  const p = new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', cam.url, '-frames:v', '1', '-q:v', '5', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = []; let err = '';
    const t = setTimeout(() => ff.kill('SIGKILL'), 15_000);
    ff.stdout.on('data', (d) => out.push(d));
    ff.stderr.on('data', (d) => { err += d; });
    ff.on('error', (e) => { clearTimeout(t); reject(new Error(e.code === 'ENOENT' ? 'ffmpeg is not installed on the server' : e.message)); });
    ff.on('close', () => {
      clearTimeout(t);
      const buf = Buffer.concat(out);
      if (buf.length > 1000) { snaps.set(cam.id, { at: Date.now(), buf }); resolve(buf); } else reject(new Error(`Camera not answering${err ? ` (${err.trim().split('\n').pop()})` : ''}`));
    });
  }).finally(() => pending.delete(cam.id));
  pending.set(cam.id, p);
  return p;
}

export async function snapshot(id) {
  const cam = need(id);
  const hit = snaps.get(id);
  // while live, the newest live frame is the freshest picture there is
  const live = lives.get(id);
  if (live?.last) return live.last;
  if (hit && Date.now() - hit.at < SNAP_FRESH_MS) return hit.buf;
  if (hit && Date.now() - hit.at < SNAP_MAX_AGE_MS) { grab(cam).catch((e) => log(`${cam.name}: ${e.message}`)); return hit.buf; }
  return grab(cam);
}

// --- live view (MJPEG over HTTP, one ffmpeg per camera shared by every viewer) --------------------------
const lives = new Map(); // id -> { ff, clients: Set<res>, last, idle }
const BOUNDARY = 'hcframe';

function startLive(cam) {
  const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', cam.url, '-an', '-vf', 'fps=5', '-q:v', '7', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const live = { ff, clients: new Set(), last: null, idle: null };
  let buf = Buffer.alloc(0);
  ff.stdout.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    // JPEG frames end with FF D9 (the entropy-coded data can't contain it: FF bytes there are always followed by 00)
    for (let end = buf.indexOf(Buffer.from([0xff, 0xd9])); end !== -1; end = buf.indexOf(Buffer.from([0xff, 0xd9]))) {
      const frame = buf.subarray(0, end + 2);
      buf = buf.subarray(end + 2);
      live.last = frame;
      for (const res of live.clients) {
        res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
        res.write(frame);
        res.write('\r\n');
      }
    }
  });
  ff.stderr.on('data', (d) => log(`${cam.name} live: ${String(d).trim()}`));
  ff.on('error', (e) => log(`${cam.name} live: ${e.message}`));
  ff.on('close', () => {
    for (const res of live.clients) res.end();
    if (lives.get(cam.id) === live) lives.delete(cam.id);
    if (live.last) snaps.set(cam.id, { at: Date.now(), buf: live.last });
  });
  lives.set(cam.id, live);
  log(`${cam.name}: live view started`);
  return live;
}

function stopLive(id) {
  const live = lives.get(id);
  if (!live) return;
  lives.delete(id);
  live.ff.kill('SIGTERM');
  log(`${list().find((c) => c.id === id)?.name ?? id}: live view stopped`);
}

/** Streams the camera to an HTTP response as multipart MJPEG until the viewer goes away. */
export function watch(id, res, sendHeaders) {
  const cam = need(id);
  const live = lives.get(id) ?? startLive(cam);
  clearTimeout(live.idle);
  // X-Accel-Buffering: nginx must pass each frame straight through, not buffer the response
  sendHeaders({ 'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`, 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'close' });
  live.clients.add(res);
  const cap = setTimeout(() => res.end(), LIVE_MAX_MS);
  res.on('close', () => {
    clearTimeout(cap);
    live.clients.delete(res);
    if (!live.clients.size) live.idle = setTimeout(() => stopLive(id), LIVE_IDLE_MS);
  });
}
