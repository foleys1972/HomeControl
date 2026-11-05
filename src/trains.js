// Live train departures for the hallway screen, from one of two sources (picked in Settings > Train times):
//  - 'free': traintimes.org.uk's public live departure board (no account or key). It has no API, so its page is read
//    once a minute and parsed; a change to the page's layout can break this.
//  - 'raildata': National Rail's own Live Departure Board API on the Rail Data Marketplace (raildata.org.uk), with a
//    free key that is checked with National Rail before it's saved and never leaves the server.
// Station search uses the public Huxley 2 service (huxley2.azurewebsites.net). The station is picked on the hallway
// screen and kept in the config; the board is fetched every minute.
import * as store from './store.js';

const TRAINTIMES = 'https://traintimes.org.uk/live';
const RAILDATA = 'https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120/GetDepartureBoard';
const HUXLEY = 'https://huxley2.azurewebsites.net';
const UA = 'HomeControl/1.0 (home hallway screen; one request a minute)';
const CRS_RE = /^[A-Z]{3}$/;
const KEY_RE = /^[\w-]{16,128}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ROWS = 10;
export const SOURCES = ['free', 'raildata'];

const log = (msg) => console.log(new Date().toISOString(), `trains: ${msg}`);
const station = () => store.get().trains ?? null;
const apiKey = () => store.get().raildata?.key ?? null;
// favourite trains: [{ time: '07:49', days: [1, 2, 3, 4, 5] }] (0 = Sunday); the screen warns when one is late or cancelled
const favourites = () => store.get().trainFavourites ?? [];
// a saved key means National Rail unless the free board was picked since
const source = () => store.get().trainsSource ?? (apiKey() ? 'raildata' : 'free');

let cache = { at: 0, crs: null, source: null, departures: [], messages: [], error: null };

async function get(url, headers = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(15_000) });
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('National Rail refused the Rail Data key'), { status: 400 });
  if (!r.ok) throw new Error(`Train times service error (HTTP ${r.status})`);
  return r;
}

// National Rail messages and the free board come as HTML; the screen shows plain text
const plain = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&rsquo;/g, '’')
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

// --- National Rail (Rail Data Marketplace) -------------------------------------------------------------------
function nrService(s) {
  const dest = (s.destination ?? []).map((d) => d.locationName + (d.via ? ` ${d.via}` : '')).join(' & ');
  return {
    std: s.std ?? null,
    etd: s.etd ?? null, // 'On time', 'Delayed', 'Cancelled' or an expected time
    platform: s.platform ?? null,
    destination: dest || 'Unknown',
    operator: s.operator ?? null,
    cancelled: Boolean(s.isCancelled),
    reason: s.cancelReason ?? s.delayReason ?? null,
  };
}

async function raildataBoard(crs, key = apiKey()) {
  if (!key) throw new Error('No Rail Data key saved — add one in Settings, or switch to the free board');
  const j = await (await get(`${RAILDATA}/${crs}?numRows=${ROWS}`, { 'x-apikey': key })).json();
  return {
    name: j.locationName ?? null,
    departures: (j.trainServices ?? []).map(nrService),
    messages: (j.nrccMessages ?? []).map((m) => plain(m.value ?? m.Value)).filter(Boolean).slice(0, 3),
  };
}

// --- traintimes.org.uk (free board page) -----------------------------------------------------------------------
// One row: <td>times + status</td><td>destination<br><small>From …<br>reason</small></td><td>platform</td><td>link</td>
// Times are '20:13', or '20:12a<br>20:14d' when it calls (arrives then departs); status is 'On time', a later time,
// 'Delayed', 'Cancelled' or 'Unknown'. Rows that only arrive (the train ends here) are left out.
function ttRow(tr) {
  const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  if (cells.length < 3) return null;
  const parts = cells[0].split(/<br\s*\/?>/i).map(plain).filter(Boolean);
  const times = parts.filter((p) => /^\d\d:\d\d[ad]?$/.test(p));
  const dep = times.find((p) => p.endsWith('d')) ?? times.find((p) => /^\d\d:\d\d$/.test(p));
  if (!dep) return null;
  const status = parts.find((p) => !/^\d\d:\d\d[ad]$/.test(p) && p !== dep) ?? null;
  const etd = !status ? 'On time' : /^\d\d:\d\d$/.test(status) ? status : /cancel/i.test(status) ? 'Cancelled'
    : /on time/i.test(status) ? 'On time' : 'Delayed';
  const [destHtml, ...rest] = cells[1].split(/<br\s*\/?>/i);
  const notes = rest.map(plain).filter((t) => t && !/^From /.test(t));
  return {
    std: dep.slice(0, 5),
    etd,
    platform: plain(cells[2]) || null,
    destination: plain(destHtml) || 'Unknown',
    operator: null,
    cancelled: etd === 'Cancelled',
    reason: notes[0] ? notes[0].charAt(0).toUpperCase() + notes[0].slice(1) : null,
  };
}

async function freeBoard(crs) {
  const html = await (await get(`${TRAINTIMES}/${crs}`)).text();
  const table = /<table[^>]*id=['"]liveboard['"][^>]*>([\s\S]*?)<\/table>/i.exec(html);
  const name = /Live departure board for ([^<]+?)\s*(?:<|-\s*Accessible)/i.exec(html)?.[1]?.trim() ?? null;
  if (!table) {
    // a page with no table is either "no trains" or a layout change; say which we think it is
    if (name && /no (train|departure|service)s?/i.test(html)) return { name, departures: [], messages: [] };
    throw new Error('Couldn’t read the free train board (its page may have changed)');
  }
  const rows = [...table[1].matchAll(/<tr(?![^>]*align)[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => ttRow(m[1])).filter(Boolean);
  const warning = /<(?:div|p|ul)[^>]*id=['"]warning['"][^>]*>([\s\S]*?)<\/(?:div|p|ul)>/i.exec(html);
  return { name, departures: rows.slice(0, ROWS), messages: warning ? [plain(warning[1])].filter(Boolean) : [] };
}

const board = (crs, src = source()) => (src === 'raildata' ? raildataBoard(crs) : freeBoard(crs));

// --- settings -------------------------------------------------------------------------------------------------
/** Stations matching a name, for the station picker. A three-letter station code is always offered too. */
export async function search(q) {
  q = String(q ?? '').trim().slice(0, 60);
  if (q.length < 2) return [];
  const code = /^[a-z]{3}$/i.test(q) ? [{ name: q.toUpperCase(), crs: q.toUpperCase() }] : [];
  try {
    const list = await (await get(`${HUXLEY}/crs/${encodeURIComponent(q)}`)).json();
    const found = (Array.isArray(list) ? list : []).slice(0, 12).map((s) => ({ name: s.stationName, crs: s.crsCode }));
    return found.some((s) => s.crs === code[0]?.crs) ? found : [...code, ...found];
  } catch {
    if (code.length) return code;
    throw new Error('Station search is not answering. Type the three-letter station code instead (e.g. KGX).');
  }
}

export async function setStation(p) {
  const crs = String(p?.crs ?? '').toUpperCase();
  let name = String(p?.name ?? '').trim().slice(0, 60);
  if (!CRS_RE.test(crs) || !name) throw new Error('Pick a station from the list');
  if (name === crs) name = (await board(crs).catch(() => ({}))).name ?? crs; // a typed code: take the name from the board
  store.update((c) => { c.trains = { crs, name }; });
  await refresh(true).catch((e) => { cache.error = e.message; });
  return summary();
}

/** Replace the favourite trains. Each is a departure time and the days of the week it's caught (0 = Sunday). */
export function setFavourites(list) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!Array.isArray(list) || list.length > 12) throw bad('Up to 12 favourite trains');
  const byTime = new Map();
  for (const f of list) {
    const time = String(f?.time ?? '');
    if (!TIME_RE.test(time)) throw bad('Give the train’s departure time, like 07:49');
    const days = (Array.isArray(f?.days) ? f.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (!days.length) throw bad('Pick at least one day');
    byTime.set(time, [...new Set([...(byTime.get(time) ?? []), ...days])].sort());
  }
  const clean = [...byTime].sort(([a], [b]) => a.localeCompare(b)).map(([time, days]) => ({ time, days }));
  store.update((c) => { c.trainFavourites = clean; });
  log(`${clean.length} favourite train(s) saved`);
  return summary();
}

export async function setSource(src) {
  if (!SOURCES.includes(src)) throw Object.assign(new Error('Unknown train times source'), { status: 400 });
  if (src === 'raildata' && !apiKey()) throw Object.assign(new Error('Save a Rail Data key first'), { status: 400 });
  store.update((c) => { c.trainsSource = src; });
  log(`source set to ${src}`);
  await refresh(true).catch((e) => { cache.error = e.message; });
  return summary();
}

/** Save the Rail Data Marketplace key after checking National Rail accepts it, and switch to it. */
export async function setKey(key) {
  key = String(key ?? '').trim();
  if (!KEY_RE.test(key)) throw Object.assign(new Error('That doesn’t look like a Rail Data key — copy the Consumer key from your subscription'), { status: 400 });
  await raildataBoard(station()?.crs ?? 'KGX', key);
  store.update((c) => { c.raildata = { key }; c.trainsSource = 'raildata'; });
  log('Rail Data key saved');
  await refresh(true).catch((e) => { cache.error = e.message; });
  return summary();
}

export function removeKey() {
  store.update((c) => { delete c.raildata; c.trainsSource = 'free'; });
  log('Rail Data key removed');
  refresh(true).catch((e) => { cache.error = e.message; });
  return summary();
}

// --- refresh --------------------------------------------------------------------------------------------------
export async function refresh(force = false) {
  const st = station();
  if (!st) return cache;
  const src = source();
  if (!force && Date.now() - cache.at < 55_000 && cache.crs === st.crs && cache.source === src && !cache.error) return cache;
  const b = await board(st.crs, src);
  cache = { at: Date.now(), crs: st.crs, source: src, error: null, departures: b.departures, messages: b.messages };
  return cache;
}

export function summary() {
  const st = station();
  const fresh = cache.crs === st?.crs && cache.source === source();
  return { station: st, source: source(), favourites: favourites(), ...(fresh ? cache : { at: 0, departures: [], messages: [], error: cache.error }) };
}

export const settings = () => ({ keySet: Boolean(apiKey()), source: source() });

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
