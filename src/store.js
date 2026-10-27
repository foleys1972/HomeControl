// Settings + secrets in one JSON file (mode 0600) under the data directory. Written atomically.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.HOME_CONTROL_DATA || path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'config.json');

// A fresh install starts empty: devices are added on the Settings page (or found with "Find devices").
const DEFAULTS = () => ({
  auth: { hash: null, salt: null, secret: randomBytes(32).toString('hex') },
  hue: { ip: null, username: null },
  sky: [],
  android: [], // Android TV / Shield / Fire TV devices controlled over ADB
  smarttv: [], // network-only smart TVs (no ADB): volume/mute over UPnP, YouTube/Netflix over DIAL
  switches: [],
  cisco: { password: null, enable: null },
  pingTargets: [
    { name: 'Internet (Cloudflare)', host: '1.1.1.1', port: 443 },
    { name: 'Internet (Google)', host: '8.8.8.8', port: 443 },
  ],
});

let config = null;

export function load() {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (existsSync(FILE)) {
    config = { ...DEFAULTS(), ...JSON.parse(readFileSync(FILE, 'utf8')) };
  } else {
    config = DEFAULTS();
    save();
  }
  return config;
}

export function get() {
  return config ?? load();
}

export function save() {
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  renameSync(tmp, FILE);
}

export function update(fn) {
  fn(get());
  save();
}

export function appendLine(name, obj) {
  appendFileSync(path.join(DATA_DIR, name), JSON.stringify(obj) + '\n', { mode: 0o600 });
}

export function readLines(name, max = 500) {
  const file = path.join(DATA_DIR, name);
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).slice(-max);
  return lines.flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}
