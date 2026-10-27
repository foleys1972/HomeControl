// TV guide: channel list from the Sky main box, schedules from Sky's EPG service (awk.epgsky.com), channel
// logos and programme artwork proxied and cached on disk so the browser only ever talks to this server.
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import * as store from './store.js';

const EPG = 'https://awk.epgsky.com/hawk/linear/schedule';
const LOGO = (sid) => `https://d2n0069hmnqmmx.cloudfront.net/epgdata/1.0/newchanlogos/240/240/skychb${sid}.png`;
const ART = (uuid) => `https://images.metadata.sky.com/pd-image/${uuid}/16-9/640`;
const CACHE = path.join(store.DATA_DIR, 'cache');

export const GENRES = {
  12: 'Entertainment', 14: 'Movies', 15: 'Sports', 16: 'News', 17: 'Documentaries', 18: 'Kids',
  19: 'Music', 20: 'Radio', 21: 'Shopping', 22: 'Religion', 23: 'International', 26: 'Adult',
};

const gatewayIp = () => (store.get().sky.find((b) => b.id === 'main') || store.get().sky[0]).ip;

// --- channels ----------------------------------------------------------------------------
let channelCache = { at: 0, list: [] };

export async function channels() {
  if (Date.now() - channelCache.at < 6 * 3600_000 && channelCache.list.length) return channelCache.list;
  const r = await fetch(`http://${gatewayIp()}:9006/as/services`, { signal: AbortSignal.timeout(6000) });
  const j = await r.json();
  const seen = new Set();
  const list = (j.services || [])
    .filter((s) => s.schedule !== false && !seen.has(s.sid) && seen.add(s.sid))
    .map((s) => ({ sid: String(s.sid), number: String(s.c), name: s.t, genre: GENRES[s.sg] || 'Other', hd: s.sf === 'hd' }));
  channelCache = { at: Date.now(), list };
  return list;
}

export async function channelBySid(sid) {
  return (await channels()).find((c) => c.sid === String(sid)) ?? null;
}

// --- schedules ---------------------------------------------------------------------------
const dayCache = new Map(); // `${yyyymmdd}:${sid}` -> { at, events }
const DAY_TTL = 30 * 60_000;

const ymd = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

function trim(e) {
  return {
    t: e.t, st: e.st, d: e.d, sy: e.sy || '', uuid: e.programmeuuid || null,
    s: e.seasonnumber || null, e: e.episodenumber || null, new: Boolean(e.new), hd: Boolean(e.hd),
  };
}

async function fetchDay(day, sids) {
  const missing = sids.filter((sid) => {
    const c = dayCache.get(`${day}:${sid}`);
    return !c || Date.now() - c.at > DAY_TTL;
  });
  // Sky's EPG takes at most 20 channels per request; fetch a few batches at a time
  const batches = [];
  for (let i = 0; i < missing.length; i += 20) batches.push(missing.slice(i, i + 20));
  const one = async (batch) => {
    try {
      const r = await fetch(`${EPG}/${day}/${batch.join(',')}`, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return; // don't cache a refusal as "no programmes"
      const j = await r.json();
      const got = new Set();
      for (const ch of j.schedule || []) {
        dayCache.set(`${day}:${ch.sid}`, { at: Date.now(), events: (ch.events || []).map(trim) });
        got.add(String(ch.sid));
      }
      for (const sid of batch) if (!got.has(sid)) dayCache.set(`${day}:${sid}`, { at: Date.now(), events: [] });
    } catch {
      // leave whatever was cached; the guide shows gaps rather than failing
    }
  };
  for (let i = 0; i < batches.length; i += 4) await Promise.all(batches.slice(i, i + 4).map(one));
  if (dayCache.size > 8000) for (const [k, v] of dayCache) if (Date.now() - v.at > 4 * 3600_000) dayCache.delete(k);
}

/** Events overlapping [from, to] (epoch seconds) for the given channel ids. */
export async function schedule(sids, from, to) {
  const days = [];
  for (let t = from * 1000 - 86400_000; t <= to * 1000; t += 86400_000) days.push(ymd(t));
  const uniqueDays = [...new Set(days)];
  await Promise.all(uniqueDays.map((d) => fetchDay(d, sids)));
  const out = {};
  for (const sid of sids) {
    const seen = new Set();
    out[sid] = uniqueDays
      .flatMap((d) => dayCache.get(`${d}:${sid}`)?.events ?? [])
      .filter((e) => e.st < to && e.st + e.d > from && !seen.has(e.st) && seen.add(e.st))
      .sort((a, b) => a.st - b.st);
  }
  return out;
}

/** Current and next programme on a channel. */
export async function nowNext(sid) {
  const now = Math.floor(Date.now() / 1000);
  const ev = (await schedule([String(sid)], now - 60, now + 6 * 3600))[sid] || [];
  const i = ev.findIndex((e) => e.st <= now && e.st + e.d > now);
  return { now: i >= 0 ? ev[i] : null, next: i >= 0 ? ev[i + 1] ?? null : ev[0] ?? null };
}

// --- images (disk cache) -----------------------------------------------------------------
async function cachedImage(kind, key, url) {
  const dir = path.join(CACHE, kind);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${key}.img`);
  if (existsSync(file)) return readFileSync(file);
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw Object.assign(new Error('Image not found'), { status: 404 });
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 600_000) throw Object.assign(new Error('Image too large'), { status: 502 });
  writeFileSync(file, buf);
  return buf;
}

export function logo(sid) {
  if (!/^\d{1,6}$/.test(sid)) return Promise.reject(Object.assign(new Error('Bad id'), { status: 400 }));
  return cachedImage('logos', sid, LOGO(sid));
}

export function artwork(uuid) {
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) return Promise.reject(Object.assign(new Error('Bad id'), { status: 400 }));
  return cachedImage('art', uuid.toLowerCase(), ART(uuid));
}

export function pruneArtwork(maxAgeDays = 3) {
  const dir = path.join(CACHE, 'art');
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (Date.now() - statSync(p).mtimeMs > maxAgeDays * 86400_000) unlinkSync(p);
  }
}
