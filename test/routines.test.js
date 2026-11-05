// Event and sunset routines: `npm test` (Node's own test runner, no dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.HOME_CONTROL_DATA = mkdtempSync(path.join(tmpdir(), 'hc-test-'));
const store = await import('../src/store.js');
const sun = await import('../src/sun.js');
const routines = await import('../src/routines.js');

const LONDON = { name: 'London', lat: 51.5074, lon: -0.1278 };
const uk = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
const light = { type: 'lights', kind: 'group', id: '3', name: 'Hallway', on: true };

test('sunrise and sunset match published London times within a couple of minutes', () => {
  const near = (ms, hhmm) => {
    const [h, m] = uk(ms).split(':').map(Number);
    const [eh, em] = hhmm.split(':').map(Number);
    assert.ok(Math.abs(h * 60 + m - (eh * 60 + em)) <= 2, `${uk(ms)} vs ${hhmm}`);
  };
  const summer = sun.times('2026-06-21', LONDON.lat, LONDON.lon);
  near(summer.rise, '04:43'); near(summer.set, '21:21');
  const winter = sun.times('2026-12-21', LONDON.lat, LONDON.lon);
  near(winter.rise, '08:04'); near(winter.set, '15:53');
});

test('sunset routines and "after dark" need a location', () => {
  store.update((c) => { delete c.weather; });
  assert.throws(() => routines.save({ name: 'Porch', trigger: { type: 'sun', event: 'sunset', offset: 0 }, actions: [light] }), /location/);
  assert.throws(() => routines.save({ name: 'Bell', trigger: { type: 'event', source: 'ring', kind: 'ding' }, only: { dark: 'dark' }, actions: [light] }), /location/);
});

test('a sunset routine is due just after sunset (plus offset) and only once', () => {
  store.update((c) => { c.weather = LONDON; });
  const r = routines.save({ name: 'Porch', trigger: { type: 'sun', event: 'sunset', offset: -15, days: [4] }, actions: [light] }); // Thursdays
  const set = sun.times('2026-11-05', LONDON.lat, LONDON.lon).set - 15 * 60_000; // 5 Nov 2026 is a Thursday
  assert.equal(routines.due(r, set - 60_000), false);
  assert.equal(routines.due(r, set + 30_000), true);
  assert.equal(routines.due({ ...r, lastRun: set + 31_000 }, set + 60_000), false);
  assert.equal(routines.due(r, set + 11 * 60_000), false); // too late to catch up
  const next = routines.nextRun(r, Date.parse('2026-11-05T09:00:00Z'));
  assert.equal(uk(next), uk(set));
  // the following Thursday when today's has gone
  assert.ok(routines.nextRun(r, set + 60_000) > set + 6 * 86_400_000);
});

test('event routines match the right events and are never "due" on the clock', () => {
  const bell = routines.save({ name: 'Bell', trigger: { type: 'event', source: 'ring', kind: 'ding', device: 'Front door' }, actions: [{ ...light, minutes: 5 }] });
  assert.equal(bell.actions[0].minutes, 5);
  assert.equal(routines.matches(bell, { source: 'ring', kind: 'ding', device: 'Front door' }), true);
  assert.equal(routines.matches(bell, { source: 'ring', kind: 'motion', device: 'Front door' }), false);
  assert.equal(routines.matches(bell, { source: 'ring', kind: 'ding', device: 'Garden' }), false);
  assert.equal(routines.matches({ ...bell, enabled: false }, { source: 'ring', kind: 'ding', device: 'Front door' }), false);
  assert.equal(routines.due(bell), false);
  assert.equal(routines.nextRun(bell), null);

  const anyCam = routines.save({ name: 'Motion', trigger: { type: 'event', source: 'ring', kind: 'motion' }, actions: [light] });
  assert.equal(routines.matches(anyCam, { source: 'ring', kind: 'motion', device: 'Garden' }), true);

  const armed = routines.save({ name: 'Leaving', trigger: { type: 'event', source: 'alarm', mode: 'armed' }, actions: [{ ...light, on: false }] });
  assert.equal(routines.matches(armed, { source: 'alarm', mode: 'armed' }), true);
  assert.equal(routines.matches(armed, { source: 'alarm', mode: 'part' }), false);

  const opened = routines.save({ name: 'Door', trigger: { type: 'event', source: 'door', sensor: 's1', state: 'open' }, actions: [light] });
  assert.equal(routines.matches(opened, { source: 'door', sensor: 's1', state: 'open' }), true);
  assert.equal(routines.matches(opened, { source: 'door', sensor: 's2', state: 'open' }), false);
  assert.equal(routines.matches(opened, { source: 'door', sensor: 's1', state: 'closed' }), false);
});

test('"left open for N minutes" fires once per opening', () => {
  const r = routines.save({ name: 'Back door', trigger: { type: 'event', source: 'door', sensor: 's1', state: 'open', minutes: 10 }, actions: [light] });
  const t0 = Date.parse('2026-11-05T12:00:00Z');
  const sensors = [{ id: 's1', open: true, changed: t0 }, { id: 's2', open: true, changed: t0 - 3_600_000 }];
  assert.equal(routines.matches(r, { source: 'door', sensor: 's1', state: 'open' }), false); // not on the opening itself
  assert.equal(routines.heldOpen(r, sensors, t0 + 9 * 60_000), false);
  assert.equal(routines.heldOpen(r, sensors, t0 + 10 * 60_000), true);
  assert.equal(routines.heldOpen({ ...r, lastRun: t0 + 10 * 60_000 }, sensors, t0 + 20 * 60_000), false);
  assert.equal(routines.heldOpen(r, [{ id: 's1', open: false, changed: t0 }], t0 + 20 * 60_000), false);
});

test('"only if" conditions: after dark and time windows (including across midnight)', () => {
  store.update((c) => { c.weather = LONDON; });
  const r = routines.save({ name: 'Bell', trigger: { type: 'event', source: 'ring', kind: 'ding' }, only: { dark: 'dark' }, actions: [light] });
  assert.deepEqual(r.only, { dark: 'dark' });
  assert.equal(routines.allowed(r, Date.parse('2026-11-05T12:00:00Z')), false); // midday
  assert.equal(routines.allowed(r, Date.parse('2026-11-05T19:00:00Z')), true); // evening
  assert.equal(routines.allowed(r, Date.parse('2026-11-05T05:00:00Z')), true); // before sunrise

  const night = { ...r, only: { from: '22:00', to: '06:00' } };
  assert.equal(routines.allowed(night, Date.parse('2026-11-05T23:30:00Z')), true);
  assert.equal(routines.allowed(night, Date.parse('2026-11-05T05:59:00Z')), true);
  assert.equal(routines.allowed(night, Date.parse('2026-11-05T06:00:00Z')), false);
  assert.equal(routines.allowed(night, Date.parse('2026-11-05T12:00:00Z')), false);
  // summer time: the window is UK time, not UTC
  const morning = { ...r, only: { from: '07:00', to: '09:00' } };
  assert.equal(routines.allowed(morning, Date.parse('2026-07-01T06:30:00Z')), true); // 07:30 BST
  assert.equal(routines.allowed(morning, Date.parse('2026-07-01T08:30:00Z')), false); // 09:30 BST

  assert.equal(routines.save({ name: 'x', trigger: { type: 'manual' }, only: {}, actions: [light] }).only, null);
  assert.throws(() => routines.save({ name: 'x', trigger: { type: 'manual' }, only: { from: '22:00', to: '22:00' }, actions: [light] }), /same/);
});

test('bad event triggers are refused', () => {
  assert.throws(() => routines.save({ name: 'x', trigger: { type: 'event', source: 'ring', kind: 'on_demand' }, actions: [light] }), /doorbell/);
  assert.throws(() => routines.save({ name: 'x', trigger: { type: 'event', source: 'alarm', mode: 'off' }, actions: [light] }), /armed/);
  assert.throws(() => routines.save({ name: 'x', trigger: { type: 'event', source: 'door', state: 'open', minutes: 999 }, actions: [light] }), /240/);
  assert.throws(() => routines.save({ name: 'x', trigger: { type: 'event', source: 'toaster' }, actions: [light] }), /reacts/);
  assert.throws(() => routines.save({ name: 'x', trigger: { type: 'manual' }, actions: [{ ...light, minutes: 0 }] }), /1 to 240/);
});
