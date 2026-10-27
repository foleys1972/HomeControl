// Philips Hue bridge, local v1 REST API. Pairing needs the bridge's link button pressed first.
import * as store from './store.js';

const TIMEOUT = 4000;

async function call(method, urlPath, body) {
  const { ip } = store.get().hue;
  const res = await fetch(`http://${ip}${urlPath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  return res.json();
}

export async function pair() {
  const r = await call('POST', '/api', { devicetype: 'home-control#server' });
  const ok = Array.isArray(r) && r[0]?.success?.username;
  if (ok) {
    store.update((c) => { c.hue.username = r[0].success.username; });
    return { ok: true };
  }
  const err = Array.isArray(r) && r[0]?.error;
  return { ok: false, error: err?.type === 101 ? 'Press the round button on the Hue bridge, then try again within 30 seconds' : (err?.description || 'Pairing failed') };
}

let cache = { at: 0, data: null };

export async function summary() {
  const { username } = store.get().hue;
  if (!username) return { paired: false };
  if (Date.now() - cache.at < 1500 && cache.data) return cache.data;
  try {
    const [groups, lights] = await Promise.all([call('GET', `/api/${username}/groups`), call('GET', `/api/${username}/lights`)]);
    if (Array.isArray(groups) && groups[0]?.error) {
      return { paired: false, error: groups[0].error.description };
    }
    const rooms = Object.entries(groups)
      .filter(([, g]) => g.type === 'Room' || g.type === 'Zone')
      .map(([id, g]) => ({
        id,
        name: g.name,
        type: g.type,
        on: Boolean(g.state?.any_on),
        allOn: Boolean(g.state?.all_on),
        bri: g.action?.bri ?? null,
        lights: g.lights.map((lid) => ({
          id: lid,
          name: lights[lid]?.name ?? `Light ${lid}`,
          on: Boolean(lights[lid]?.state?.on),
          bri: lights[lid]?.state?.bri ?? null,
          reachable: lights[lid]?.state?.reachable !== false,
        })),
      }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'Room' ? -1 : 1));
    cache = { at: Date.now(), data: { paired: true, online: true, rooms } };
  } catch (e) {
    cache = { at: Date.now(), data: { paired: true, online: false, error: `Bridge not answering (${e.name})` } };
  }
  return cache.data;
}

function cleanState({ on, bri }) {
  const s = {};
  if (typeof on === 'boolean') s.on = on;
  if (Number.isInteger(bri)) { s.bri = Math.max(1, Math.min(254, bri)); s.on = true; }
  return s;
}

export async function setGroup(id, state) {
  const { username } = store.get().hue;
  if (!username || !/^\d+$/.test(id)) throw new Error('Bad request');
  cache.at = 0;
  return call('PUT', `/api/${username}/groups/${id}/action`, cleanState(state));
}

// --- adding lights to the bridge ---------------------------------------------------------
/** Start a bridge search for new bulbs (~40 s). Optional 6-character serials for bulbs that won't show up on their own. */
export async function searchLights(serials = []) {
  const { username } = store.get().hue;
  if (!username) throw new Error('Pair the Hue bridge first');
  const clean = serials.map((s) => String(s).trim().toUpperCase()).filter((s) => /^[0-9A-F]{6}$/.test(s)).slice(0, 10);
  if (serials.length && !clean.length) throw new Error('Serial numbers are 6 characters, like 1A2B3C (printed on the bulb)');
  const r = await call('POST', `/api/${username}/lights`, clean.length ? { deviceid: clean } : undefined);
  if (Array.isArray(r) && r[0]?.error) throw new Error(r[0].error.description);
  cache.at = 0;
  return { ok: true };
}

/** Progress of the last search: { active, found: [{ id, name }] } */
export async function newLights() {
  const { username } = store.get().hue;
  if (!username) throw new Error('Pair the Hue bridge first');
  const r = await call('GET', `/api/${username}/lights/new`);
  const found = Object.entries(r).filter(([k]) => k !== 'lastscan').map(([id, v]) => ({ id, name: v.name }));
  return { active: r.lastscan === 'active', found };
}

export async function renameLight(id, name) {
  const { username } = store.get().hue;
  if (!username || !/^\d+$/.test(id)) throw new Error('Bad request');
  const clean = String(name ?? '').trim().slice(0, 32);
  if (!clean) throw new Error('Give the light a name');
  const r = await call('PUT', `/api/${username}/lights/${id}`, { name: clean });
  if (Array.isArray(r) && r[0]?.error) throw new Error(r[0].error.description);
  cache.at = 0;
  return { ok: true };
}

export async function setLight(id, state) {
  const { username } = store.get().hue;
  if (!username || !/^\d+$/.test(id)) throw new Error('Bad request');
  cache.at = 0;
  return call('PUT', `/api/${username}/lights/${id}/state`, cleanState(state));
}
