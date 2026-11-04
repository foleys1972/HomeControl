// Live train departures for the hallway screen, from National Rail's Darwin feed. With a Rail Data Marketplace key
// (free, raildata.org.uk, "Live Departure Board" product) the board comes straight from National Rail; without one it
// falls back to the public Huxley 2 service (huxley2.azurewebsites.net, github.com/jpsingleton/Huxley2), which relies
// on the retired OpenLDBWS feed and may stop working. The station is picked on the hallway screen and kept in the
// config; the board is fetched every minute. The key stays on the server.
import * as store from './store.js';

const HUXLEY = 'https://huxley2.azurewebsites.net';
const RAILDATA = 'https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120/GetDepartureBoard';
const CRS_RE = /^[A-Z]{3}$/;
const KEY_RE = /^[\w-]{16,128}$/;
const ROWS = 10;

const log = (msg) => console.log(new Date().toISOString(), `trains: ${msg}`);
const station = () => store.get().trains ?? null;
const apiKey = () => store.get().raildata?.key ?? null;

let cache = { at: 0, crs: null, departures: [], messages: [], error: null };

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('National Rail refused the Rail Data key'), { status: 400 });
  if (!r.ok) throw new Error(`Train times service error (HTTP ${r.status})`);
  return r.json();
}

// National Rail messages come as HTML snippets; the screen shows plain text
const plain = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function board(crs, key = apiKey()) {
  return key
    ? getJson(`${RAILDATA}/${crs}?numRows=${ROWS}`, { 'x-apikey': key })
    : getJson(`${HUXLEY}/departures/${crs}/${ROWS}`);
}

/** Stations matching a name, for the station picker. A three-letter station code is always offered too. */
export async function search(q) {
  q = String(q ?? '').trim().slice(0, 60);
  if (q.length < 2) return [];
  const code = /^[a-z]{3}$/i.test(q) ? [{ name: q.toUpperCase(), crs: q.toUpperCase() }] : [];
  try {
    const list = await getJson(`${HUXLEY}/crs/${encodeURIComponent(q)}`);
    const found = (Array.isArray(list) ? list : []).slice(0, 12).map((s) => ({ name: s.stationName, crs: s.crsCode }));
    return found.some((s) => s.crs === code[0]?.crs) ? found : [...code, ...found];
  } catch (e) {
    if (code.length) return code;
    throw new Error('Station search is not answering. Type the three-letter station code instead (e.g. KGX).');
  }
}

export async function setStation(p) {
  const crs = String(p?.crs ?? '').toUpperCase();
  let name = String(p?.name ?? '').trim().slice(0, 60);
  if (!CRS_RE.test(crs) || !name) throw new Error('Pick a station from the list');
  // a typed code has no name yet: take it from the board
  if (name === crs) name = (await board(crs).catch(() => ({}))).locationName ?? crs;
  store.update((c) => { c.trains = { crs, name }; });
  await refresh(true).catch((e) => { cache.error = e.message; });
  return summary();
}

/** Save the Rail Data Marketplace key after checking National Rail accepts it. */
export async function setKey(key) {
  key = String(key ?? '').trim();
  if (!KEY_RE.test(key)) throw Object.assign(new Error('That doesn’t look like a Rail Data key — copy the Consumer key from your subscription'), { status: 400 });
  await board(station()?.crs ?? 'KGX', key);
  store.update((c) => { c.raildata = { key }; });
  log('Rail Data key saved');
  await refresh(true).catch((e) => { cache.error = e.message; });
  return summary();
}

export function removeKey() {
  store.update((c) => { delete c.raildata; });
  log('Rail Data key removed');
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
  if (!force && Date.now() - cache.at < 55_000 && cache.crs === st.crs && !cache.error) return cache;
  const j = await board(st.crs);
  cache = {
    at: Date.now(),
    crs: st.crs,
    error: null,
    departures: (j.trainServices ?? []).map(service),
    messages: (j.nrccMessages ?? []).map((m) => plain(m.value ?? m.Value)).filter(Boolean).slice(0, 3),
  };
  return cache;
}

export function summary() {
  const st = station();
  const source = apiKey() ? 'raildata' : 'public';
  return { station: st, source, ...(cache.crs === st?.crs ? cache : { at: 0, departures: [], messages: [], error: cache.error }) };
}

export const keySet = () => Boolean(apiKey());

export function start() {
  const tick = async () => {
    try { await refresh(); } catch (e) {
      if (cache.error !== e.message) log(`refresh failed: ${e.message}`); // log once, not every minute
      cache.error = e.message;
    }
    setTimeout(tick, 60_000);
  };
  tick();
}
