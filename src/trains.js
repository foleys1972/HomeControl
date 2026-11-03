// Live train departures for the hallway screen, from National Rail's Darwin feed through the public Huxley 2
// service (huxley2.azurewebsites.net, github.com/jpsingleton/Huxley2): free, no account or key. The station is
// picked on the hallway screen and kept in the config; the board is fetched every minute.
import * as store from './store.js';

const HOST = 'https://huxley2.azurewebsites.net';
const CRS_RE = /^[A-Z]{3}$/;
const ROWS = 10;

const log = (msg) => console.log(new Date().toISOString(), `trains: ${msg}`);
const station = () => store.get().trains ?? null;

let cache = { at: 0, crs: null, departures: [], messages: [], error: null };

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Train times service error (HTTP ${r.status})`);
  return r.json();
}

// National Rail messages come as HTML snippets; the screen shows plain text
const plain = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** Stations matching a name, for the station picker. */
export async function search(q) {
  q = String(q ?? '').trim().slice(0, 60);
  if (q.length < 2) return [];
  const list = await getJson(`${HOST}/crs/${encodeURIComponent(q)}`);
  return (Array.isArray(list) ? list : []).slice(0, 12).map((s) => ({ name: s.stationName, crs: s.crsCode }));
}

export async function setStation(p) {
  const crs = String(p?.crs ?? '').toUpperCase();
  const name = String(p?.name ?? '').trim().slice(0, 60);
  if (!CRS_RE.test(crs) || !name) throw new Error('Pick a station from the list');
  store.update((c) => { c.trains = { crs, name }; });
  await refresh(true);
  return summary();
}

function service(s) {
  const dest = (s.destination ?? []).map((d) => d.locationName + (d.via ? ` ${d.via}` : '')).join(' & ');
  return {
    std: s.std ?? null, // timetabled departure
    etd: s.etd ?? null, // 'On time', 'Delayed', 'Cancelled' or an expected time
    platform: s.platform ?? null,
    destination: dest || 'Unknown',
    operator: s.operator ?? null,
    cancelled: Boolean(s.isCancelled),
    reason: s.cancelReason ?? s.delayReason ?? null,
  };
}

export async function refresh(force = false) {
  const st = station();
  if (!st) return cache;
  if (!force && Date.now() - cache.at < 55_000 && cache.crs === st.crs) return cache;
  const j = await getJson(`${HOST}/departures/${st.crs}/${ROWS}`);
  cache = {
    at: Date.now(),
    crs: st.crs,
    error: null,
    departures: (j.trainServices ?? []).map(service),
    messages: (j.nrccMessages ?? []).map((m) => plain(m.value)).filter(Boolean).slice(0, 3),
  };
  return cache;
}

export function summary() {
  const st = station();
  return { station: st, ...(cache.crs === st?.crs ? cache : { at: 0, departures: [], messages: [], error: cache.error }) };
}

export function start() {
  const tick = async () => {
    try { await refresh(); } catch (e) { cache.error = e.message; log(`refresh failed: ${e.message}`); }
    setTimeout(tick, 60_000);
  };
  tick();
}
