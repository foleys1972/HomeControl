// Weather for the hallway screen from Open-Meteo (open-meteo.com): free, no account or key. The location is
// picked on the hallway screen and kept in the config; the forecast is fetched every 15 minutes.
import * as store from './store.js';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

const log = (msg) => console.log(new Date().toISOString(), `weather: ${msg}`);
const location = () => store.get().weather ?? null;

let cache = { at: 0, current: null, days: [], error: null };

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Weather service error (HTTP ${r.status})`);
  return r.json();
}

/** Places matching a town or postcode name, for the location picker. */
export async function search(q) {
  q = String(q ?? '').trim().slice(0, 80);
  if (q.length < 2) return [];
  const j = await getJson(`${GEOCODE}?${new URLSearchParams({ name: q, count: '8', language: 'en', format: 'json' })}`);
  return (j.results ?? []).map((p) => ({
    name: p.name,
    area: [p.admin2 ?? p.admin1, p.country].filter(Boolean).join(', '),
    lat: p.latitude,
    lon: p.longitude,
  }));
}

export async function setLocation(p) {
  const lat = Number(p?.lat);
  const lon = Number(p?.lon);
  const name = String(p?.name ?? '').trim().slice(0, 60);
  if (!name || !(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) throw new Error('Pick a place from the list');
  store.update((c) => { c.weather = { name, area: String(p.area ?? '').slice(0, 80), lat, lon }; });
  await refresh(true);
  return summary();
}

export async function refresh(force = false) {
  const loc = location();
  if (!loc) return cache;
  if (!force && Date.now() - cache.at < 15 * 60_000) return cache;
  const params = new URLSearchParams({
    latitude: String(loc.lat), longitude: String(loc.lon), timezone: 'auto', forecast_days: '4',
    current: 'temperature_2m,weather_code,is_day,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  });
  const j = await getJson(`${FORECAST}?${params}`);
  const d = j.daily ?? {};
  cache = {
    at: Date.now(),
    error: null,
    current: j.current ? { temp: j.current.temperature_2m, code: j.current.weather_code, day: j.current.is_day === 1, wind: j.current.wind_speed_10m } : null,
    days: (d.time ?? []).map((date, i) => ({ date, code: d.weather_code?.[i], max: d.temperature_2m_max?.[i], min: d.temperature_2m_min?.[i], rain: d.precipitation_probability_max?.[i] })),
  };
  return cache;
}

export function summary() {
  return { location: location(), ...cache };
}

export function start() {
  const tick = async () => {
    try { await refresh(); } catch (e) { cache.error = e.message; log(`refresh failed: ${e.message}`); }
    setTimeout(tick, 5 * 60_000); // refresh() itself only calls out every 15 minutes
  };
  tick();
}
