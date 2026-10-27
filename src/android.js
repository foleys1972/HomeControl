// Android TV, NVIDIA Shield and Fire TV devices over ADB: status (awake, current app), remote keys, app list
// and launching. Status is polled in the background so page refreshes never open ADB connections.
import dgram from 'node:dgram';
import { readFileSync } from 'node:fs';
import * as adb from './adb.js';
import * as store from './store.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Android keycodes for the remote
export const KEYS = {
  power: 26, wake: 224, sleep: 223, home: 3, back: 4, menu: 82, settings: 176, input: 178,
  up: 19, down: 20, left: 21, right: 22, select: 23,
  playpause: 85, play: 126, pause: 127, stop: 86, rewind: 89, fastforward: 90, next: 87, previous: 88,
  volumeup: 24, volumedown: 25, mute: 164, channelup: 166, channeldown: 167, search: 84,
};

// Friendly names and tile colours for apps we know; anything else gets a tidied package name.
const CATALOGUE = {
  'com.netflix.ninja': ['Netflix', '#e50914'],
  'com.google.android.youtube.tv': ['YouTube', '#ff0033'],
  'com.amazon.firetv.youtube': ['YouTube', '#ff0033'],
  'com.amazon.amazonvideo.livingroom': ['Prime Video', '#1a98ff'],
  'com.amazon.avod': ['Prime Video', '#1a98ff'],
  'com.disney.disneyplus': ['Disney+', '#113ccf'],
  'uk.co.bbc.iplayer': ['BBC iPlayer', '#f54997'],
  'uk.co.freeview.bbc': ['BBC iPlayer', '#f54997'],
  'bbc.iplayer.android': ['BBC iPlayer', '#f54997'],
  'air.ITVMobilePlayer': ['ITVX', '#102c3d', '#dfff4f'],
  'uk.co.freeview.itv': ['ITVX', '#102c3d', '#dfff4f'],
  'com.channel4.ondemand': ['Channel 4', '#3c3c3c'],
  'uk.co.freeview.ch4_vod': ['Channel 4', '#3c3c3c'],
  'uk.co.freeview.ch5': ['My5', '#c8102e'],
  'uk.co.freeview.uktv': ['U', '#ff5f00'],
  'uk.co.freeview.stv': ['STV Player', '#0089cf'],
  'uk.co.freeview.bbc_sounds': ['BBC Sounds', '#ff6b00'],
  'uk.co.freeview.explore': ['Freeview Explore', '#3d1a78'],
  'uk.co.freeview.onnow': ['Freeview On Now', '#3d1a78'],
  'uk.co.freeview.amc_catchup': ['AMC Catch-up', '#222222'],
  'uk.co.freeview.amc_horror': ['AMC Horror', '#3a0d0d'],
  'com.spotify.tv.android': ['Spotify', '#1db954', '#06210f'],
  'org.jellyfin.androidtv': ['Jellyfin', '#00a4dc'],
  'com.plexapp.android': ['Plex', '#1f1f1f', '#e5a00d'],
  'org.xbmc.kodi': ['Kodi', '#17b2e7'],
  'org.videolan.vlc': ['VLC', '#ff8800'],
  'com.mxtech.videoplayer.ad': ['MX Player', '#1e6fd9'],
  'com.bt.btsport': ['TNT Sports', '#111111'],
  'com.tubitv.ott': ['Tubi', '#7408ff'],
  'com.apple.atve.androidtv.appletv': ['Apple TV', '#1d1d1f'],
  'com.apple.atve.amazon.appletv': ['Apple TV', '#1d1d1f'],
  'com.mediatek.wwtv.tvcenter': ['Live TV', '#334155'],
  'com.mediatek.wwtv.mediaplayer': ['Media Player', '#475569'],
  'com.android.vending': ['Play Store', '#01875f'],
  'com.esaba.downloader': ['Downloader', '#f57c00'],
  'com.nst.iptvsmarterstvbox': ['IPTV Smarters', '#283593'],
  'com.privateinternetaccess.android': ['PIA VPN', '#3f7f2f'],
  'com.wireguard.android': ['WireGuard', '#88171a'],
  'com.nvidia.ota': ['Shield Updates', '#76b900', '#0b1a00'],
  'com.nvidia.shieldtech.accessoryui': ['Shield Accessories', '#76b900', '#0b1a00'],
};

// Most-used apps first on the Apps page; the rest follow alphabetically
const POPULAR = ['Netflix', 'YouTube', 'BBC iPlayer', 'Prime Video', 'Disney+', 'ITVX', 'Channel 4', 'My5', 'U', 'Apple TV',
  'Spotify', 'Jellyfin', 'Plex', 'TNT Sports', 'Live TV', 'STV Player', 'BBC Sounds', 'Tubi'];

// System bits that show up as launchable but aren't apps anyone wants on a remote
const HIDE = [/^com\.mediatek\.(?!wwtv\.(tvcenter|mediaplayer))/, /^mediatek\./, /^com\.mstar\./, /^com\.vestel\./, /^com\.android\.(documentsui|deskclock|providers|settings|tv\.settings)/,
  /^com\.amazon\.(tv\.launcher|ftv\.|ssm|venezia|firebat)/, /^com\.google\.android\.(apps\.tv\.launcherx|tvlauncher|leanbacklauncher)/, /^com\.gathin\./, /launcher/i];

function describe(pkg) {
  const [name, color, fg] = CATALOGUE[pkg] ?? [null, null, null];
  if (name) return { label: name, color, fg: fg ?? null };
  const seg = pkg.split('.').filter((s) => !['com', 'org', 'uk', 'co', 'tv', 'android', 'app', 'ott', 'live', 'ui'].includes(s)).pop() || pkg;
  let hash = 0;
  for (const ch of pkg) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { label: seg.charAt(0).toUpperCase() + seg.slice(1), color: `hsl(${hash % 360} 45% 35%)`, fg: null };
}

const deviceById = (id) => store.get().android.find((d) => d.id === id);

// --- Wake-on-LAN (for TVs that drop off the network in standby) ------------------------------
const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
// A device's MAC is learned from the ARP table while it is reachable (learnMac) and saved with its settings
const macOf = (dev) => dev.mac || null;

/** Remember a device's MAC from the kernel ARP table while it is reachable (Linux; no-op elsewhere). */
function learnMac(dev) {
  try {
    const row = readFileSync('/proc/net/arp', 'utf8').split('\n').find((l) => l.split(/\s+/)[0] === dev.ip);
    const mac = row?.split(/\s+/)[3];
    if (mac && MAC_RE.test(mac) && mac !== '00:00:00:00:00:00' && mac !== dev.mac) store.update(() => { dev.mac = mac.toLowerCase(); });
  } catch {}
}

function sendMagicPacket(mac, ip) {
  const hw = Buffer.from(mac.replace(/:/g, ''), 'hex');
  const pkt = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(hw)]);
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.on('error', () => { s.close(); resolve(); });
    s.bind(() => {
      s.setBroadcast(true);
      let n = 0;
      const shoot = () => {
        for (const [addr, port] of [['255.255.255.255', 9], [ip.replace(/\.\d+$/, '.255'), 9], ['255.255.255.255', 7]]) s.send(pkt, port, addr);
        if (++n < 3) setTimeout(shoot, 300); else setTimeout(() => { s.close(); resolve(); }, 200);
      };
      shoot();
    });
  });
}

/** Wake a device: over ADB if it's reachable, otherwise Wake-on-LAN and wait for it to come back. */
export async function wake(id) {
  const dev = need(id);
  if (status.get(id)?.conn === 'ok') return key(id, 'wake');
  const mac = macOf(dev);
  if (!mac) throw new Error(`${dev.name} is off the network and its network address isn't known yet — turn it on once with its remote so the app can learn it`);
  await sendMagicPacket(mac, dev.ip);
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    await probe(dev).catch(() => {});
    const st = status.get(id);
    if (st?.conn === 'ok') {
      if (!st.awake) await adb.shell(dev.ip, `input keyevent ${KEYS.wake}`).catch(() => {});
      return { ok: true, woke: true };
    }
    if (st?.conn === 'closed' || st?.conn === 'unauthorised') return { ok: true, woke: true, conn: st.conn };
    if (i === 6) await sendMagicPacket(mac, dev.ip);
  }
  throw new Error(`${dev.name} didn't wake. Check "Network standby" / "Wake on LAN" is on in the TV's network settings`);
}

// --- background status -------------------------------------------------------------------
const status = new Map(); // id -> { conn, awake, app, at, model }

const ERR = { CLOSED: 'closed', OFFLINE: 'offline', UNAUTHORISED: 'unauthorised' };

async function probe(dev) {
  const prev = status.get(dev.id) ?? {};
  if (adb.isAwaitingApproval(dev.ip)) { status.set(dev.id, { ...prev, conn: 'waiting', at: Date.now() }); return; }
  try {
    const out = await adb.shell(dev.ip, 'dumpsys power | grep -m1 -E "mWakefulness=|Display Power: state="; dumpsys window | grep -m1 -E "mCurrentFocus=|mFocusedApp="; getprop ro.product.model', { timeoutMs: 6000 });
    const awake = /mWakefulness=Awake|state=ON/.test(out);
    const pkg = (out.match(/(?:mCurrentFocus|mFocusedApp)=\S*\{[^}]*?\s([\w.]+)\/[\w.$]+/) || out.match(/\s([\w.]+)\/[\w.$]+\}/) || [])[1] ?? null;
    const lines = out.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('Failed to write'));
    const model = lines.at(-1);
    learnMac(dev);
    status.set(dev.id, { conn: 'ok', awake, app: pkg && !HIDE.some((r) => r.test(pkg)) ? { pkg, ...describe(pkg) } : null, home: pkg ? HIDE.some((r) => r.test(pkg)) : false, model, at: Date.now() });
  } catch (e) {
    // ADB closed/unapproved still means the device is on the network: good moment to learn its MAC
    if (e.code === 'CLOSED' || e.code === 'UNAUTHORISED') learnMac(dev);
    status.set(dev.id, { ...prev, conn: ERR[e.code] ?? 'offline', error: e.message, at: Date.now() });
  }
}

export function start() {
  const tick = async () => {
    for (const dev of store.get().android ?? []) {
      const st = status.get(dev.id);
      const due = !st || Date.now() - st.at > (st.conn === 'ok' ? 15_000 : 60_000);
      if (due) await probe(dev).catch(() => {});
    }
    setTimeout(tick, 5000);
  };
  tick();
}

export function summary() {
  return (store.get().android ?? []).map((d) => ({ id: d.id, name: d.name, ip: d.ip, kind: d.kind, canWake: Boolean(macOf(d)), ...(status.get(d.id) ?? { conn: 'checking' }) }));
}

// --- actions -----------------------------------------------------------------------------
function need(id) {
  const dev = deviceById(id);
  if (!dev) throw new Error('Unknown device');
  return dev;
}

export async function key(id, name) {
  const dev = need(id);
  if (!(name in KEYS)) throw new Error('Unknown key');
  await adb.shell(dev.ip, `input keyevent ${KEYS[name]}`);
  setTimeout(() => probe(dev).catch(() => {}), 1200);
  return { ok: true };
}

const appCache = new Map(); // id -> { at, apps }

export async function apps(id) {
  const dev = need(id);
  const c = appCache.get(id);
  if (c && Date.now() - c.at < 10 * 60_000) return c.apps;
  const out = await adb.shell(dev.ip,
    'cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.LEANBACK_LAUNCHER; echo ===; ' +
    'cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER', { timeoutMs: 15_000 });
  const [leanback, launcher] = out.split('===');
  const comps = new Map();
  for (const block of [leanback, launcher ?? '']) {
    for (const l of block.split('\n').map((x) => x.trim())) {
      const m = l.match(/^([\w.]+)\/([\w.$]+)$/);
      if (m && !comps.has(m[1]) && !HIDE.some((r) => r.test(m[1]))) comps.set(m[1], l);
    }
  }
  const rank = (a) => { const i = POPULAR.indexOf(a.label); return i < 0 ? (CATALOGUE[a.pkg] ? 100 : 200) : i; };
  const seenLabels = new Set();
  const list = [...comps].map(([pkg, comp]) => ({ pkg, comp, ...describe(pkg) }))
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))
    .filter((a) => !seenLabels.has(a.label) && seenLabels.add(a.label)); // e.g. ITVX app + Freeview ITVX: keep one
  appCache.set(id, { at: Date.now(), apps: list });
  return list;
}

export async function launch(id, pkg) {
  const dev = need(id);
  const app = (await apps(id)).find((a) => a.pkg === pkg);
  if (!app) throw new Error('That app is not installed on this device');
  if (!status.get(id)?.awake) { await adb.shell(dev.ip, `input keyevent ${KEYS.wake}`); await sleep(1500); }
  const out = await adb.shell(dev.ip, `am start -n ${app.comp}`);
  if (/Error|Exception/.test(out)) throw new Error(`Couldn't open ${app.label}`);
  setTimeout(() => probe(dev).catch(() => {}), 2500);
  return { ok: true };
}

/** Pops "Allow USB debugging?" on the device. Returns at once: the wait for the user (up to 2 min) runs in
 * the background and the status poll picks up the result — holding the request open hit nginx's 120 s limit. */
export async function approve(id) {
  const dev = need(id);
  status.set(id, { ...(status.get(id) ?? {}), conn: 'waiting', at: Date.now() });
  adb.requestApproval(dev.ip)
    .then(() => console.log(new Date().toISOString(), `android ${id}: approved on the TV`))
    .catch((e) => console.error(new Date().toISOString(), `android ${id}: approve failed: ${e.message}`))
    .finally(() => probe(dev).catch(() => {}));
  return { ok: false, waiting: true, conn: 'waiting' };
}
