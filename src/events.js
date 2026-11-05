// A tiny in-process event feed: Ring, Yale and the like report things as they notice them ("doorbell pressed",
// "back door opened", "alarm armed") and routines listen. Nothing is stored; events seen while the server is
// down are simply missed.
const listeners = new Set();
const log = (msg) => console.log(new Date().toISOString(), `events: ${msg}`);

/** Listen for events; returns a function that stops listening. */
export function on(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** e: { source: 'ring' | 'alarm' | 'door', ... } */
export function emit(e) {
  const event = { at: Date.now(), ...e };
  log(`${event.source}: ${JSON.stringify(Object.fromEntries(Object.entries(event).filter(([k]) => k !== 'source' && k !== 'at')))}`);
  for (const fn of listeners) {
    try { fn(event); } catch (err) { log(`listener failed: ${err.message}`); }
  }
}
