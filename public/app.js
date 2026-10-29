// Home Control front end. Plain DOM + hash routing; all text via textContent, styles via el.style (CSP-safe).

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

// --- icons (24px stroke icons) ------------------------------------------------------------------
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  guide: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M8 2v4M16 2v4M7 14h4M7 17h7',
  remote: 'M9 2h6a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM10 16h.01M14 16h.01M10 19h.01M14 19h.01',
  bulb: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V17h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z',
  network: 'M2 8.8a15 15 0 0 1 20 0M5 12.6a10 10 0 0 1 14 0M8.5 16.4a5 5 0 0 1 7 0M12 20h.01',
  settings: 'M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  star: 'M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.4L12 17.4l-5.7 3 1.1-6.4-4.6-4.5 6.4-.9z',
  power: 'M12 2v9M18.4 6.6a9 9 0 1 1-12.8 0',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M7 4h3.5v16H7zM13.5 4H17v16h-3.5z',
  back: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  left: 'M15 18l-6-6 6-6', right: 'M9 18l6-6-6-6', up: 'M18 15l-6-6-6 6', down: 'M6 9l6 6 6-6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  x: 'M18 6 6 18M6 6l12 12',
  tv: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 22h8M12 19v3',
  apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  rewind: 'M11 18 3 12l8-6zM21 18l-8-6 8-6z', ff: 'M13 18l8-6-8-6zM3 18l8-6-8-6z',
  record: 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z', stop: 'M6 6h12v12H6z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  camera: 'M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  siren: 'M7 18v-6a5 5 0 0 1 10 0v6M5 21h14v-3H5zM12 2v2M4.2 5.2l1.4 1.4M19.8 5.2l-1.4 1.4',
  vol: 'M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13', mute: 'M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  switch: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  flame: 'M12 22c3.9 0 7-2.9 7-6.8 0-3.1-2-5.4-3.6-7.2-.3 2-1.5 3.3-2.9 3.6.4-3.3-1.2-6.4-3.9-8.6.2 3.3-1.9 5.6-3.6 7.6C3.9 12.1 5 13.9 5 15.2 5 19.1 8.1 22 12 22z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1.5v2M12 20.5v2M4.6 4.6 6 6M18 18l1.4 1.4M1.5 12h2M20.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
  moon: 'M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z',
  auto: 'M12 21.5a9.5 9.5 0 1 1 0-19 9.5 9.5 0 0 1 0 19zM12 2.5v19M12 7h5M12 11h7M12 15h6',
};

// --- theme: auto (follow device) / light / dark, remembered per device ------------------------------
const THEMES = { auto: { label: 'Auto', icon: 'auto' }, light: { label: 'Light', icon: 'sun' }, dark: { label: 'Dark', icon: 'moon' } };
function themePref() {
  try { return localStorage.getItem('hc-theme') || 'auto'; } catch { return 'auto'; }
}
function setTheme(t) {
  try { localStorage.setItem('hc-theme', t); } catch {}
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const effective = t === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', effective === 'light' ? '#f4f5f8' : '#0b0d12'));
  renderThemeButtons();
}
function renderThemeButtons() {
  const t = themePref();
  const next = { auto: 'light', light: 'dark', dark: 'auto' }[t];
  const label = `Theme: ${THEMES[t].label} (switch to ${THEMES[next].label})`;
  const btn = $('#theme-btn');
  btn.replaceChildren(icon(THEMES[t].icon), h('span', {}, `${THEMES[t].label} theme`));
  btn.title = label;
  const mob = $('#mobile-theme');
  mob.replaceChildren(icon(THEMES[t].icon));
  mob.setAttribute('aria-label', label);
}
const cycleTheme = () => setTheme({ auto: 'light', light: 'dark', dark: 'auto' }[themePref()]);
function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', `i ${cls}`);
  const p = document.createElementNS(s.namespaceURI, 'path');
  p.setAttribute('d', ICONS[name]);
  s.append(p);
  return s;
}

// --- api ------------------------------------------------------------------------------------------
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'X-Requested-With': 'home-control', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') { showAuth(false); throw new Error('Not logged in'); }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

// --- formatting -----------------------------------------------------------------------------------
const hhmm = (sec) => new Date(sec * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const nowSec = () => Math.floor(Date.now() / 1000);
const pct = (ev) => Math.max(0, Math.min(100, ((nowSec() - ev.st) / ev.d) * 100));
const mins = (sec) => (sec >= 3600 ? `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m` : `${Math.round(sec / 60)} min`);
const se = (ev) => (ev.s && ev.e ? `S${ev.s} E${ev.e}` : ev.e ? `Ep ${ev.e}` : '');
const logoUrl = (sid) => `/api/img/logo/${sid}`;
const artUrl = (uuid) => (uuid ? `/api/img/art/${uuid}` : null);
const bri2pct = (b) => (b == null ? 0 : Math.round((b / 254) * 100));

// --- app state -------------------------------------------------------------------------------------
const S = {
  state: null,
  channels: [],
  bySid: new Map(),
  genres: [],
  apps: [],
  guide: { day: 0, start: null, genre: 'Favourites', q: '' },
  remoteBox: null,
  favNow: { at: 0, data: {} },
  dragging: false,
};

const PAGES = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'guide', label: 'TV Guide', icon: 'guide' },
  { id: 'remote', label: 'Remote', icon: 'remote' },
  { id: 'cameras', label: 'Cameras', icon: 'camera' },
  { id: 'apps', label: 'Apps', icon: 'apps', desktopOnly: true }, // phones: linked from Home and Remote
  { id: 'heating', label: 'Heating', icon: 'flame' },
  { id: 'lights', label: 'Lights', icon: 'bulb' },
  { id: 'routines', label: 'Routines', icon: 'clock', desktopOnly: true }, // phones: clock icon in the top bar
  { id: 'network', label: 'Network', icon: 'network', desktopOnly: true },
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'wall', label: 'Wall tablet', icon: 'home', hidden: true }, // full-screen, not in the menus
];

// --- which device we're controlling (Sky boxes + Android/Fire TVs; shared by Remote, Apps; per device) ----
function allDevices() {
  return [
    ...(S.state?.tv ?? []).map((b) => ({ ...b, kind: 'sky' })),
    ...(S.state?.android ?? []).map((d) => ({ ...d, android: true })),
  ];
}
function activeBoxId() {
  const devs = allDevices();
  let id = null;
  try { id = localStorage.getItem('hc-box'); } catch {}
  return devs.some((b) => b.id === id) ? id : devs[0]?.id;
}
const activeBox = () => allDevices().find((b) => b.id === activeBoxId());
function setActiveBox(id) {
  try { localStorage.setItem('hc-box', id); } catch {}
  renderBoxPicker();
  rerender();
}
const CONN_TEXT = { closed: 'Debugging is off', offline: 'Off or not on the network', unauthorised: 'Needs approval on the TV', waiting: 'Approve it on the TV…', checking: 'Checking…' };
function boxStatusText(b) {
  if (b.android) return b.conn === 'ok' ? (b.awake ? (b.app?.label ?? 'Home screen') : 'Asleep') : CONN_TEXT[b.conn] ?? 'Offline';
  return !b.online ? 'Offline' : b.standby ? 'Standby' : nowLine(b).title;
}
function boxDot(b) {
  if (b.android) return b.conn === 'ok' ? (b.awake ? 'live' : '') : b.conn === 'unauthorised' || b.conn === 'waiting' ? 'warn' : 'bad';
  return !b.online ? 'bad' : b.standby ? '' : 'live';
}
const KIND_ICON = { sky: 'tv', androidtv: 'tv', shield: 'remote', firetv: 'remote' };

function renderBoxPicker() {
  // Sidebar shows just the current device; the full list opens in a sheet (keeps the menu on screen)
  const box = activeBox();
  $('#box-picker').replaceChildren(h('div', { class: 'bp-label' }, 'Controlling'),
    box ? h('button', { class: 'bp-item', 'aria-pressed': 'true', onclick: chooseBox, title: 'Change device' },
      h('span', { class: `dot ${boxDot(box)}` }),
      h('span', { class: 'bp-text' }, h('b', {}, box.name), h('small', {}, boxStatusText(box)))) : null,
    h('button', { class: 'btn ghost bp-change', onclick: chooseBox }, 'Change device'));
  const short = box ? box.name.replace(/^Sky Q\s*/, '').replace(/[()]/g, '').trim() || box.name : 'Sky';
  $('#box-chip').replaceChildren(icon('tv'), h('span', {}, short.charAt(0).toUpperCase() + short.slice(1)), icon('down'));
}

function chooseBox() {
  const sheet = $('#sheet');
  const boxes = allDevices();
  sheet.replaceChildren(h('div', { class: 'sheet-card' }, h('div', { class: 'sheet-body pad-top' },
    h('h2', {}, 'Control which device?'),
    boxes.map((b) => h('button', { class: `bp-item big ${b.id === activeBoxId() ? 'sel' : ''}`, 'aria-pressed': String(b.id === activeBoxId()), onclick: () => { sheet.close(); setActiveBox(b.id); } },
      h('span', { class: `dot ${boxDot(b)}` }),
      h('span', { class: 'bp-text' }, h('b', {}, b.name), h('small', {}, boxStatusText(b))))),
    h('button', { class: 'btn', onclick: () => sheet.close() }, 'Cancel'))));
  sheet.showModal();
}
$('#box-chip').addEventListener('click', chooseBox);
$('#theme-btn').addEventListener('click', cycleTheme);
$('#mobile-theme').addEventListener('click', cycleTheme);

function currentPage() {
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1];
  return PAGES.some((p) => p.id === id) ? id : 'home';
}

function buildNav() {
  $('#nav').replaceChildren(...PAGES.filter((p) => !p.hidden).map((p) => h('a', { href: `#/${p.id}`, 'data-page': p.id }, icon(p.icon), p.label)));
  // Settings lives in the phone's top bar, so the tab bar keeps six roomy tabs
  $('#tabbar').replaceChildren(...PAGES.filter((p) => !p.desktopOnly && !p.hidden && p.id !== 'settings').map((p) => h('a', { href: `#/${p.id}`, 'data-page': p.id }, icon(p.icon), p.label.replace('TV ', ''))));
  $('#mobile-settings').replaceChildren(icon('settings'));
  $('#mobile-routines').replaceChildren(icon('clock'));
  $('#mobile-network').replaceChildren(icon('network'));
}

function markNav(page) {
  document.querySelectorAll('[data-page]').forEach((a) => (a.dataset.page === page ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('#mobile-title').textContent = PAGES.find((p) => p.id === page).label;
}

// --- auth --------------------------------------------------------------------------------------------
let setupMode = false;
function showAuth(setup) {
  setupMode = setup;
  stopPolling();
  $('#shell').hidden = true;
  $('#auth').hidden = false;
  $('#auth-title').textContent = setup ? 'Welcome to Home Control' : 'Home Control';
  $('#auth-hint').textContent = setup ? 'Choose a household password (8+ characters).' : 'Sign in to continue.';
  $('#auth-confirm').hidden = !setup;
  $('#auth-confirm').required = setup;
  $('#auth-submit').textContent = setup ? 'Create password' : 'Sign in';
  $('#auth-password').autocomplete = setup ? 'new-password' : 'current-password';
  $('#auth-password').focus();
}
$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('#auth-password').value;
  $('#auth-error').textContent = '';
  if (setupMode && password !== $('#auth-confirm').value) { $('#auth-error').textContent = "Passwords don't match"; return; }
  try {
    await api('POST', setupMode ? '/api/setup' : '/api/login', { password });
    $('#auth-password').value = $('#auth-confirm').value = '';
    boot();
  } catch (err) {
    $('#auth-error').textContent = err.message;
  }
});

// --- data loading ---------------------------------------------------------------------------------------
async function loadChannels() {
  const d = await api('GET', '/api/channels');
  S.channels = d.channels;
  S.bySid = new Map(d.channels.map((c) => [c.sid, c]));
  S.genres = d.genres;
}

async function toggleFav(sid, fav) {
  await api('POST', '/api/favourites', { sid, fav });
  const ch = S.bySid.get(sid);
  if (ch) ch.fav = fav;
  S.favNow.at = 0;
  toast(fav ? `${ch?.name ?? 'Channel'} added to favourites` : `${ch?.name ?? 'Channel'} removed from favourites`);
}

// Box action feedback: actions that may wake a box from standby take a few seconds.
const wakeNote = (box) => (box?.standby ? ' — waking it up first' : '');

async function favouritesOnNow() {
  if (Date.now() - S.favNow.at < 60_000) return S.favNow.data;
  const favs = S.channels.filter((c) => c.fav);
  if (!favs.length) return {};
  const now = nowSec();
  const d = await api('GET', `/api/guide?from=${now - 60}&to=${now + 3 * 3600}&sids=${favs.map((c) => c.sid).join(',')}`);
  S.favNow = { at: Date.now(), data: d.schedule };
  return d.schedule;
}

// --- actions ----------------------------------------------------------------------------------------------
async function skyKey(boxId, key) {
  try { await api('POST', `/api/sky/${boxId}/key`, { key }); setTimeout(refresh, 1500); } catch (e) { toast(e.message); }
}
async function watchOn(boxId, sid) {
  const box = S.state?.tv.find((b) => b.id === boxId);
  const ch = S.bySid.get(sid);
  toast(`Switching ${box?.name ?? 'Sky'} to ${ch?.name ?? 'channel'}${wakeNote(box)}…`);
  try {
    await api('POST', `/api/sky/${boxId}/watch`, { sid });
    toast(`${box?.name ?? 'Sky'} → ${ch?.number ?? ''} ${ch?.name ?? ''}`);
    setTimeout(refresh, 2500);
  } catch (e) { toast(e.message); }
}
async function launchApp(boxId, app) {
  const box = S.state?.tv.find((b) => b.id === boxId);
  toast(`Opening ${app.title} on ${box?.name ?? 'Sky'}${wakeNote(box)}…`);
  try {
    await api('POST', `/api/sky/${boxId}/app`, { appId: app.id });
    toast(`${app.title} opened on ${box?.name ?? 'Sky'}`);
    setTimeout(refresh, 4000);
  } catch (e) { toast(e.message); }
}
async function hueSet(kind, id, state) {
  try { await api('POST', `/api/hue/${kind}/${id}`, state); refresh(); } catch (e) { toast(e.message); }
}

// --- programme sheet --------------------------------------------------------------------------------------
function openProgramme(sid, ev) {
  const ch = S.bySid.get(sid);
  const sheet = $('#sheet');
  const airing = ev.st <= nowSec() && ev.st + ev.d > nowSec();
  const boxes = (S.state?.tv ?? []).filter((b) => b.online);
  const art = artUrl(ev.uuid);
  const close = () => sheet.close();
  const favBtn = h('button', { class: 'btn', onclick: async () => { await toggleFav(sid, !ch.fav); close(); rerender(); } },
    icon('star', ch?.fav ? 'fill' : ''), ch?.fav ? 'Remove favourite' : 'Add to favourites');
  sheet.replaceChildren(h('div', { class: 'sheet-card' },
    h('div', { class: 'sheet-art', style: art ? { backgroundImage: `url("${art}")` } : {} },
      h('button', { class: 'sheet-close', 'aria-label': 'Close', onclick: close }, icon('x'))),
    h('div', { class: 'sheet-body' },
      h('div', { class: 'sheet-ch' }, h('img', { src: logoUrl(sid), alt: '', loading: 'lazy' }),
        h('div', {}, h('b', {}, ch?.name ?? ''), h('div', { class: 'muted num' }, `${ch?.number ?? ''} · ${ch?.genre ?? ''}`))),
      h('h2', {}, ev.t),
      h('div', { class: 'meta' },
        airing ? h('span', { class: 'badge live' }, 'Live') : null,
        ev.new ? h('span', { class: 'badge new' }, 'New') : null,
        h('span', { class: 'num' }, `${new Date(ev.st * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${hhmm(ev.st)}–${hhmm(ev.st + ev.d)} · ${mins(ev.d)}`),
        se(ev) ? h('span', { class: 'badge' }, se(ev)) : null,
        ev.hd ? h('span', { class: 'badge' }, 'HD') : null),
      airing ? h('div', { class: 'progress' }, h('i', { style: { width: `${pct(ev)}%` } })) : null,
      ev.sy ? h('p', { class: 'syn' }, ev.sy) : null,
      h('div', { class: 'actions' },
        airing ? [...boxes].sort((a, b) => (a.id === activeBoxId() ? -1 : b.id === activeBoxId() ? 1 : 0)).map((b, i) =>
          h('button', { class: `btn ${i === 0 ? 'primary' : ''}`, onclick: () => { close(); watchOn(b.id, sid); } }, icon('play', 'fill'), i === 0 ? `Watch on ${b.name}` : `On ${b.name}`)) : null,
        !airing ? h('span', { class: 'muted' }, ev.st > nowSec() ? `Starts in ${mins(ev.st - nowSec())}` : 'Already shown') : null,
        ev.st - 90 > nowSec() ? h('button', { class: 'btn primary', onclick: () => { close(); showRoutine(sid, ev); } }, icon('clock'), 'Set up for this show') : null,
        favBtn))));
  sheet.showModal();
}
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') e.target.close(); });

// --- pages ------------------------------------------------------------------------------------------------
function pageHead(title, sub, ...actions) {
  // phones already show the page name in the top bar, so the same name here is hidden there
  const repeat = PAGES.some((p) => p.label === title);
  return h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: repeat ? 'page-name' : '' }, title), sub ? h('p', {}, sub) : null), h('div', { class: 'chips' }, actions));
}

function nowLine(b) {
  if (!b.online) return { title: 'Offline', sub: b.ip };
  if (b.standby) return { title: 'Standby', sub: `${b.model ?? 'Sky Q'} · up ${b.uptimeH} h` };
  if (b.now) return { title: b.now.t, sub: `${b.channel?.number ?? ''} ${b.channel?.name ?? ''}`.trim() };
  if (b.channel) return { title: b.channel.name, sub: `Channel ${b.channel.number ?? ''}` };
  if (b.recording) return { title: b.recording.title, sub: 'From your recordings' };
  if (b.app) return { title: b.app.title, sub: 'App' };
  return { title: 'On', sub: b.state === 'PAUSED_PLAYBACK' ? 'Paused' : 'Sky Q' };
}

function heroCard(b) {
  const n = nowLine(b);
  const art = b.now?.uuid ? artUrl(b.now.uuid) : null;
  const live = b.online && !b.standby;
  return h('div', { class: `hero ${art ? 'has-art' : ''} ${!live ? 'standby' : ''}` },
    art ? h('div', { class: 'art', style: { backgroundImage: `url("${art}")` } }) : null,
    h('div', { class: 'hero-top' },
      h('span', { class: 'hero-room' }, h('span', { class: `dot ${!b.online ? 'bad' : live ? 'live' : ''}` }), b.name),
      b.channel?.sid ? h('img', { class: 'hero-logo', src: logoUrl(b.channel.sid), alt: b.channel.name }) : null),
    h('div', {},
      h('h3', {}, n.title),
      h('div', { class: 'hero-sub' }, n.sub, b.now && se(b.now) ? ` · ${se(b.now)}` : ''),
      b.now ? [
        h('div', { class: 'progress' }, h('i', { style: { width: `${pct(b.now)}%` } })),
        h('div', { class: 'hero-times muted' }, h('span', {}, `${hhmm(b.now.st)}–${hhmm(b.now.st + b.now.d)}`),
          h('span', {}, b.next ? `Next ${hhmm(b.next.st)} · ${b.next.t}` : '')),
      ] : null,
      h('div', { class: 'hero-actions' },
        b.now ? h('button', { class: 'btn', onclick: () => openProgramme(b.channel.sid, b.now) }, icon('info'), 'Details') : null,
        h('a', { class: 'btn', href: '#/remote', onclick: () => { try { localStorage.setItem('hc-box', b.id); } catch {} } }, icon('remote'), 'Remote'),
        h('a', { class: 'btn', href: '#/apps', onclick: () => { try { localStorage.setItem('hc-box', b.id); } catch {} } }, icon('apps'), 'Apps'),
        h('button', { class: `btn ${live ? '' : 'primary'}`, disabled: !b.online, onclick: () => skyKey(b.id, live ? 'power' : 'sky') }, icon('power'), live ? 'Standby' : 'Turn on'))));
}

// --- network-only smart TVs (Sharp Aquos): volume, mute, YouTube / Netflix ------------------------------
const SMART_APPS = ['YouTube', 'Netflix'];
async function smartTv(id, action, body, note) {
  if (note) toast(note);
  try { await api('POST', `/api/smarttv/${id}/${action}`, body); } catch (e) { toast(e.message); }
  refresh();
}
function smartTvRow(t) {
  const off = !t.online;
  const sub = off ? (t.checking ? 'Checking…' : 'Off or in standby')
    : [t.mute ? 'Muted' : `Volume ${t.volume}`, ...SMART_APPS.filter((a) => t.apps?.[a] === 'running').map((a) => `${a} open`)].join(' · ');
  return h('div', { class: 'tv-row smart' },
    h('div', { class: `ico ${off ? '' : 'live'}` }, icon('tv')),
    h('div', { class: 'tv-text' }, h('b', {}, t.name), h('small', { class: 'num' }, sub)),
    h('div', { class: 'tv-actions' },
      h('button', { class: 'icon-btn', 'aria-label': 'Volume down', title: 'Volume down', disabled: off, onclick: () => smartTv(t.id, 'volume', { step: -2 }) }, icon('minus')),
      h('button', { class: `icon-btn ${t.mute ? 'on' : ''}`, 'aria-label': t.mute ? 'Unmute' : 'Mute', title: t.mute ? 'Unmute' : 'Mute', 'aria-pressed': String(Boolean(t.mute)), disabled: off, onclick: () => smartTv(t.id, 'mute', { on: !t.mute }) }, icon(t.mute ? 'mute' : 'vol')),
      h('button', { class: 'icon-btn', 'aria-label': 'Volume up', title: 'Volume up', disabled: off, onclick: () => smartTv(t.id, 'volume', { step: 2 }) }, icon('plus'))),
    off ? null : h('div', { class: 'tv-apps' }, SMART_APPS.map((a) => {
      const running = t.apps?.[a] === 'running';
      return h('button', { class: 'chip', 'aria-pressed': String(running), onclick: () => smartTv(t.id, 'app', { app: a, stop: running }, running ? `Closing ${a}…` : `Opening ${a} on ${t.name}…`) }, running ? `Close ${a}` : a);
    })));
}

// --- Ring doorbell & cameras (cloud account) ------------------------------------------------------
const RING_EVENT = { ding: 'Doorbell pressed', motion: 'Motion', on_demand: 'Live view' };
function ringWhen(iso) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`;
}
async function ringPost(action, body, note) {
  try { await api('POST', `/api/ring/${action}`, body); if (note) toast(note); } catch (e) { toast(e.message); }
  refresh();
}
function ringCamCard(d) {
  const slot = Math.floor(Date.now() / 120_000); // matches the server's 2-minute snapshot cache
  const status = [d.online ? 'Online' : 'Offline', d.battery != null ? `Battery ${d.battery}%` : null, d.shared ? 'Shared with you' : null].filter(Boolean).join(' · ');
  return h('div', { class: 'card cam-card' },
    h('div', { class: 'cam-shot' }, h('img', { src: `/api/ring/snapshot/${d.id}?v=${slot}`, alt: `Latest snapshot from ${d.name}`, loading: 'lazy', onerror: (e) => e.currentTarget.remove() }),
      h('span', { class: 'cam-ico' }, icon(d.type === 'doorbell' ? 'bell' : 'tv'))),
    h('div', { class: 'cam-body' },
      h('div', { class: 'tv-text' }, h('b', {}, d.name), h('small', {}, status)),
      d.light == null && d.siren == null ? null : h('div', { class: 'cam-actions' },
        d.light == null ? null : h('button', { class: `btn ${d.light ? 'primary' : ''}`, onclick: () => ringPost('light', { id: d.id, on: !d.light }, d.light ? 'Light off' : 'Light on') }, icon('bulb'), d.light ? 'Light off' : 'Light on'),
        d.siren == null ? null : h('button', { class: 'btn remove', onclick: async () => {
          if (d.siren) return ringPost('siren', { id: d.id, on: false }, 'Siren off');
          if (await confirmSheet(`Sound the siren on ${d.name}?`, 'It is loud and keeps going until you stop it here or in the Ring app, or it times out.', 'Sound siren')) ringPost('siren', { id: d.id, on: true }, 'Siren on');
        } }, icon('siren'), d.siren ? 'Stop siren' : 'Siren'))));
}
function ringSection(r, homeCams = [], { title = true } = {}) {
  const signedIn = Boolean(r?.signedIn);
  if (!signedIn && !homeCams.length) return [];
  const cams = signedIn ? (r.devices ?? []).filter((d) => d.type !== 'chime') : [];
  return [
    title ? h('div', { class: 'section-title' }, h('h2', {}, 'Doorbell & cameras'), h('a', { href: '#/cameras' }, 'All cameras →')) : null,
    signedIn && r.error ? h('div', { class: 'card notice' }, h('p', { class: 'muted' }, r.error)) : null,
    cams.length || homeCams.length ? h('div', { class: 'cam-grid' }, cams.map(ringCamCard), homeCams.map(cameraCard))
      : h('div', { class: 'card muted' }, r.at ? 'No doorbells or cameras on this Ring account.' : 'Loading Ring devices…'),
    signedIn && (r.events ?? []).length ? h('ul', { class: 'timeline ring-events' }, r.events.map((e) => h('li', {},
      h('span', { class: `dot ${e.kind === 'ding' ? 'live' : e.kind === 'motion' ? 'warn' : ''}` }),
      h('time', {}, ringWhen(e.at)),
      h('span', {}, `${RING_EVENT[e.kind] ?? e.kind} · ${e.device}`)))) : null,
  ].filter(Boolean); // spread into replaceChildren(), which would print a null as text
}
function ringSettingsCard() {
  const r = S.state?.ring ?? {};
  const msg = h('p', { class: 'desc', role: 'status' });
  if (r.signedIn) {
    const n = (r.devices ?? []).length;
    return h('div', { class: 'card' }, h('h3', {}, 'Ring doorbell & cameras'),
      h('p', { class: 'desc' }, `Signed in to Ring as ${r.account}. Your password is not stored — only a sign-in token. ${n} device${n === 1 ? '' : 's'} found.`),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn ghost remove', onclick: async () => {
        if (!(await confirmSheet('Sign out of Ring?', 'Home Control will stop showing your doorbell and cameras until you sign in again. The Ring app is not affected.', 'Sign out'))) return;
        await ringPost('signout', {}, 'Signed out of Ring');
        rerender();
      } }, icon('logout'), 'Sign out')));
  }
  const email = h('input', { type: 'email', autocomplete: 'username', placeholder: 'you@example.com', 'aria-label': 'Ring email' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Ring password' });
  const code = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '6-digit code', 'aria-label': 'Ring code' });
  const codeRow = h('div', { class: 'fields', hidden: true }, h('label', { class: 'field' }, 'Code from Ring', code));
  const btn = h('button', { type: 'button', class: 'btn primary' }, 'Sign in to Ring');
  let step = 'password';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (step === 'password') {
        msg.textContent = 'Signing in…';
        const res = await api('POST', '/api/ring/signin', { email: email.value, password: password.value });
        password.value = '';
        if (res.mfa) {
          step = 'code';
          codeRow.hidden = false;
          btn.textContent = 'Confirm code';
          msg.textContent = `Ring has sent a code to ${res.destination}. Enter it below.`;
          code.focus();
        } else { toast('Signed in to Ring'); await refresh(); location.hash = '#/home'; }
      } else {
        msg.textContent = 'Checking the code…';
        await api('POST', '/api/ring/code', { code: code.value });
        toast('Signed in to Ring');
        await refresh();
        location.hash = '#/home';
      }
    } catch (e) { msg.textContent = e.message; }
    btn.disabled = false;
  });
  return h('div', { class: 'card' }, h('h3', {}, 'Ring doorbell & cameras'),
    h('p', { class: 'desc' }, 'Sign in with the same email and password as the Ring app. Ring will send you a code. Your password is used once and not stored.'),
    h('div', { class: 'fields' }, h('label', { class: 'field' }, 'Ring email', email), h('label', { class: 'field' }, 'Ring password', password)),
    codeRow, h('div', { class: 'row' }, btn), msg);
}

// --- Yale alarm (cloud account) -------------------------------------------------------------------------------
const ALARM_STATE = { armed: 'Armed', part: 'Part armed', disarmed: 'Disarmed' };
async function yalePost(action, body, note) {
  try { await api('POST', `/api/yale/${action}`, body ?? {}); if (note) toast(note); } catch (e) { toast(e.message); }
  await refresh();
}
function alarmNotes(y) {
  const open = (y.sensors ?? []).filter((d) => d.open);
  const low = (y.sensors ?? []).filter((d) => d.lowBattery);
  const tamper = (y.sensors ?? []).filter((d) => d.tamper);
  return [
    open.length ? `${open.map((d) => d.name).join(', ')} open` : null,
    low.length ? `Low battery: ${low.map((d) => d.name).join(', ')}` : null,
    tamper.length ? `Tamper: ${tamper.map((d) => d.name).join(', ')}` : null,
  ].filter(Boolean);
}
function alarmCard(y) {
  const state = y.mode ?? 'unknown';
  const notes = alarmNotes(y);
  const doors = (y.sensors ?? []).filter((d) => d.kind === 'door');
  const sub = y.error ? y.error : !y.at ? 'Checking the alarm…' : notes.length ? notes.join(' · ') : doors.length ? 'All doors and windows closed' : 'Yale alarm';
  const arm = (mode) => h('button', { class: 'btn', onclick: () => yalePost('arm', { mode }, mode === 'arm' ? 'Alarm armed' : 'Alarm part armed') },
    icon(mode === 'arm' ? 'shield' : 'moon'), mode === 'arm' ? 'Arm' : 'Part arm');
  return h('div', { class: `card alarm ${state}` },
    h('div', { class: 'alarm-head' }, h('div', { class: 'alarm-ico' }, icon('shield')),
      h('div', { class: 'tv-text' }, h('b', {}, ALARM_STATE[state] ?? 'Alarm'), h('small', { class: notes.length || y.error ? 'warn' : '' }, sub))),
    y.at ? h('div', { class: 'alarm-actions' },
      state !== 'armed' ? arm('arm') : null,
      state !== 'part' ? arm('home') : null,
      state !== 'disarmed' ? h('button', { class: 'btn primary', onclick: () => pinSheet(y) }, icon('power'), 'Disarm') : null) : null);
}
function alarmSection(y) {
  if (!y?.signedIn) return [];
  return [h('div', { class: 'section-title' }, h('h2', {}, 'Alarm')), alarmCard(y)];
}
function pinSheet(y) {
  if (!y.pinSet) { toast('Set an alarm PIN in Settings first'); location.hash = '#/settings'; return; }
  const sheet = $('#sheet');
  let pin = '';
  const dots = h('div', { class: 'pin-dots', 'aria-live': 'polite' });
  const msg = h('p', { class: 'error', role: 'alert' });
  const show = () => {
    dots.replaceChildren(...Array.from({ length: Math.max(4, pin.length) }, (_, i) => h('i', { class: i < pin.length ? 'on' : '' })));
    dots.setAttribute('aria-label', `${pin.length} digits entered`);
  };
  const ok = h('button', { class: 'btn primary block', onclick: async () => {
    if (pin.length < 4) { msg.textContent = 'Enter your alarm PIN'; return; }
    ok.disabled = true;
    try { await api('POST', '/api/yale/disarm', { pin }); sheet.close(); toast('Alarm disarmed'); refresh(); }
    catch (e) { msg.textContent = e.message; pin = ''; show(); }
    ok.disabled = false;
  } }, 'Disarm');
  const key = (label, fn, aria) => h('button', { type: 'button', class: 'pin-key', 'aria-label': aria ?? label, onclick: () => { fn(); msg.textContent = ''; show(); } }, label);
  const digit = (d) => key(String(d), () => { if (pin.length < 8) pin += d; });
  sheet.replaceChildren(h('div', { class: 'sheet-card' }, h('div', { class: 'sheet-body pad-top pin-sheet' },
    h('h2', {}, 'Disarm the alarm'), h('p', { class: 'syn' }, 'Enter your Home Control alarm PIN.'), dots,
    h('div', { class: 'pinpad' }, [1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit), key('Clear', () => { pin = ''; }, 'Clear PIN'), digit(0), key('⌫', () => { pin = pin.slice(0, -1); }, 'Delete last digit')),
    msg, h('div', { class: 'actions' }, ok, h('button', { class: 'btn block', onclick: () => sheet.close() }, 'Cancel')))));
  show();
  sheet.showModal();
}
function yaleSettingsCard() {
  const y = S.state?.yale ?? {};
  const msg = h('p', { class: 'desc', role: 'status' });
  if (y.signedIn) {
    const pinIn = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 8, placeholder: '4 to 8 digits', 'aria-label': 'New alarm PIN' });
    const pw = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Household password' });
    const save = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
      save.disabled = true;
      try { await api('POST', '/api/yale/pin', { pin: pinIn.value, password: pw.value }); pinIn.value = ''; pw.value = ''; msg.textContent = 'Alarm PIN saved.'; refresh(); }
      catch (e) { msg.textContent = e.message; }
      save.disabled = false;
    } }, y.pinSet ? 'Change PIN' : 'Set PIN');
    const n = (y.sensors ?? []).length;
    return h('div', { class: 'card' }, h('h3', {}, 'Yale alarm'),
      h('p', { class: 'desc' }, `Signed in to Yale as ${y.account}. Your password is not stored — only a sign-in token. ${n} sensor${n === 1 ? '' : 's'} found.`),
      h('p', { class: 'desc' }, y.pinSet ? 'Disarming needs the alarm PIN. To change it, enter a new PIN and the household password.'
        : 'Set a PIN to disarm the alarm from Home Control. Setting it needs the household password, so nobody can change it from the hallway screen.'),
      h('div', { class: 'fields' }, h('label', { class: 'field' }, y.pinSet ? 'New alarm PIN' : 'Alarm PIN', pinIn), h('label', { class: 'field' }, 'Household password', pw)),
      h('div', { class: 'row' }, save, h('button', { type: 'button', class: 'btn ghost remove', onclick: async () => {
        if (!(await confirmSheet('Sign out of Yale?', 'Home Control will stop showing and arming the alarm until you sign in again. The Yale app and your alarm are not affected.', 'Sign out'))) return;
        await yalePost('signout', {}, 'Signed out of Yale');
        rerender();
      } }, icon('logout'), 'Sign out')), msg);
  }
  const email = h('input', { type: 'email', autocomplete: 'username', placeholder: 'you@example.com', 'aria-label': 'Yale email' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Yale password' });
  const btn = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
    btn.disabled = true;
    msg.textContent = 'Signing in…';
    try { await api('POST', '/api/yale/signin', { email: email.value, password: password.value }); password.value = ''; toast('Signed in to Yale'); await refresh(); rerender(); }
    catch (e) { msg.textContent = e.message; }
    btn.disabled = false;
  } }, 'Sign in to Yale');
  return h('div', { class: 'card' }, h('h3', {}, 'Yale alarm'),
    h('p', { class: 'desc' }, 'Sign in with the same email and password as the Yale Alarm app. Your password is used once and not stored.'),
    h('div', { class: 'fields' }, h('label', { class: 'field' }, 'Yale email', email), h('label', { class: 'field' }, 'Yale password', password)),
    h('div', { class: 'row' }, btn), msg);
}

// --- routines ------------------------------------------------------------------------------------------------
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
function routineWhen(r) {
  if (r.trigger.type === 'once') {
    const d = new Date(r.trigger.at);
    return `Once · ${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  }
  const days = r.trigger.days.join(',');
  const which = days === '0,1,2,3,4,5,6' ? 'Every day' : days === '1,2,3,4,5' ? 'Weekdays' : days === '0,6' ? 'Weekends' : DAY_ORDER.filter((d) => r.trigger.days.includes(d)).map((d) => DAY_NAMES[d]).join(', ');
  return `${which} at ${r.trigger.time}`;
}
function routineAction(a) {
  if (a.type === 'alarm') return a.mode === 'home' ? 'Part arm the alarm' : 'Arm the alarm';
  if (a.type === 'lights') return `${a.name || 'Lights'}: ${a.on ? (a.bri != null ? `dim to ${a.bri}%` : 'on') : 'off'}`;
  if (a.type === 'heating') return `Heating ${a.target}°${a.minutes ? ` for ${mins(a.minutes * 60)}, then back to schedule` : ''}`;
  const legacy = a.box != null && a.device == null; // saved before TV actions: name was the channel
  const tv = (legacy ? null : a.name) || (S.state?.tv ?? []).find((b) => b.id === (a.device ?? a.box))?.name || a.device || a.box;
  const what = a.do ?? 'channel';
  if (what === 'channel') return `${tv}: switch to ${(legacy ? a.name : a.channel) || 'channel'}`;
  return `${tv}: ${{ on: 'turn on', off: 'turn off', volume: `volume ${a.level}`, mute: 'mute', unmute: 'unmute', app: `open ${a.app}` }[what]}`;
}
function routineNext(r) {
  if (!r.enabled) return r.trigger.type === 'once' && r.lastRun ? 'Done' : 'Off';
  if (!r.next) return '';
  const d = new Date(r.next);
  const today = d.toDateString() === new Date().toDateString();
  return `Next: ${today ? 'today' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
async function routinesApi(method, url, body, note) {
  try { const r = await api(method, url, body); if (note) toast(note); return r; } catch (e) { toast(e.message); throw e; } finally { refresh(); }
}

function renderRoutines(main) {
  const list = S.state?.routines ?? [];
  // with no routines yet, the empty card has its own New routine button
  main.replaceChildren(pageHead('Routines', 'Lights, heating and TV on a schedule — run by the server, so your phone can be off',
    list.length ? h('button', { class: 'btn primary', onclick: () => routineEditor() }, icon('plus'), 'New routine') : null));
  if (!list.length) {
    main.append(h('div', { class: 'card' }, h('h3', {}, 'No routines yet'),
      h('p', { class: 'muted' }, 'For example: porch light on at 20:00 and off at 22:00 every day. Or open a future programme in the TV Guide and choose "Set up for this show" to dim the lights and warm the room when it starts.'),
      h('div', { class: 'add-actions' }, h('button', { class: 'btn primary', onclick: () => routineEditor() }, icon('plus'), 'New routine'), h('a', { class: 'btn', href: '#/guide' }, icon('guide'), 'Open TV Guide'))));
    return;
  }
  const sorted = [...list].sort((a, b) => (b.enabled - a.enabled) || ((a.next ?? Infinity) - (b.next ?? Infinity)));
  main.append(h('div', { class: 'routine-list' }, sorted.map((r) => h('div', { class: `card routine ${r.enabled ? '' : 'off'}` },
    h('div', { class: 'routine-head' },
      h('div', { class: 'ico' }, icon(r.programme ? 'guide' : 'clock')),
      h('div', { class: 'tv-text' }, h('b', {}, r.name), h('small', {}, routineWhen(r))),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: r.enabled, 'aria-label': `${r.name} on/off`,
        onchange: (e) => routinesApi('POST', `/api/routines/${r.id}/${e.target.checked ? 'enable' : 'disable'}`) }), h('span'))),
    h('ul', { class: 'routine-actions' }, r.actions.map((a) => h('li', {}, routineAction(a)))),
    h('div', { class: 'routine-foot' },
      h('span', { class: 'muted' }, [routineNext(r), r.lastResult && r.lastResult !== 'ok' ? `Last run: ${r.lastResult}` : null].filter(Boolean).join(' · ')),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => routinesApi('POST', `/api/routines/${r.id}/run`, null, `Ran "${r.name}"`) }, icon('play'), 'Run now'),
        h('button', { class: 'btn ghost', onclick: () => routineEditor(r) }, 'Edit'),
        h('button', { class: 'btn ghost remove', onclick: async () => {
          if (await confirmSheet(`Delete "${r.name}"?`, 'It stops running. Nothing else changes.', 'Delete')) routinesApi('DELETE', `/api/routines/${r.id}`, null, 'Routine deleted');
        } }, icon('x'), 'Delete')))))));
}

// datetime-local value (local time) <-> ms
const toLocalInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16); };
const fromLocalInput = (v) => new Date(v).getTime();

function routineEditor(r = null, preset = null) {
  const draft = r ? JSON.parse(JSON.stringify(r)) : preset ?? { name: '', enabled: true, trigger: { type: 'daily', time: '20:00', days: [0, 1, 2, 3, 4, 5, 6] }, actions: [] };
  const sheet = $('#sheet');
  const rooms = S.state?.lights?.paired ? S.state.lights.rooms ?? [] : [];
  const thermostats = S.state?.hive?.thermostats ?? [];
  const boxes = S.state?.tv ?? [];
  // every TV a routine can control, with what it can do
  const TV_DO = {
    sky: [['on', 'Turn on'], ['off', 'Standby'], ['channel', 'Change channel']],
    android: [['on', 'Wake'], ['off', 'Sleep']],
    smarttv: [['volume', 'Set volume'], ['mute', 'Mute'], ['unmute', 'Unmute'], ['app', 'Open app']],
  };
  const tvs = [
    ...boxes.map((b) => ({ kind: 'sky', id: b.id, name: b.name })),
    ...(S.state?.android ?? []).map((d) => ({ kind: 'android', id: d.id, name: d.name })),
    ...(S.state?.smarttv ?? []).map((d) => ({ kind: 'smarttv', id: d.id, name: d.name })),
  ];
  const msg = h('p', { class: 'error', role: 'alert' });
  const name = h('input', { value: draft.name, placeholder: 'Porch light on', 'aria-label': 'Routine name' });

  // when
  const time = h('input', { type: 'time', value: draft.trigger.type === 'daily' ? draft.trigger.time : '20:00', 'aria-label': 'Time' });
  let days = new Set(draft.trigger.type === 'daily' ? draft.trigger.days : [0, 1, 2, 3, 4, 5, 6]);
  const dayChips = h('div', { class: 'chips day-chips' }, DAY_ORDER.map((d) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(days.has(d)), onclick: (e) => {
    days.has(d) ? days.delete(d) : days.add(d);
    e.currentTarget.setAttribute('aria-pressed', String(days.has(d)));
  } }, DAY_NAMES[d])));
  const at = h('input', { type: 'datetime-local', value: toLocalInput(draft.trigger.type === 'once' ? draft.trigger.at : Date.now() + 3_600_000), 'aria-label': 'Date and time' });
  const daily = h('div', { class: 'fields' }, h('label', { class: 'field' }, 'Time', time), h('div', { class: 'field' }, 'Days', dayChips));
  const once = h('div', { class: 'fields' }, h('label', { class: 'field' }, 'Date and time', at));
  let kind = draft.trigger.type;
  const showKind = () => { daily.hidden = kind !== 'daily'; once.hidden = kind !== 'once'; };
  const kindSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'When' }, [['daily', 'Every week'], ['once', 'Once']].map(([k, label]) =>
    h('button', { type: 'button', 'aria-pressed': String(kind === k), onclick: (e) => {
      kind = k; showKind();
      e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
    } }, label)));
  showKind();

  // actions
  const rows = h('div', { class: 'routine-rows' });
  const readers = [];
  const addRow = (a) => {
    let row;
    const remove = h('button', { type: 'button', class: 'btn ghost remove', 'aria-label': 'Remove this action', onclick: () => { row.remove(); readers.splice(readers.indexOf(read), 1); } }, icon('x'));
    let read;
    if (a.type === 'lights') {
      const target = h('select', { 'aria-label': 'Room or light' },
        h('optgroup', { label: 'Rooms' }, rooms.map((x) => h('option', { value: `group:${x.id}`, selected: a.kind === 'group' && a.id === x.id }, x.name))),
        h('optgroup', { label: 'Lights' }, rooms.flatMap((x) => x.lights).filter((x, i, all) => all.findIndex((y) => y.id === x.id) === i)
          .map((x) => h('option', { value: `light:${x.id}`, selected: a.kind === 'light' && a.id === x.id }, x.name))));
      const mode = h('select', { 'aria-label': 'Set to' }, [['on', 'On'], ['dim', 'Dim to'], ['off', 'Off']].map(([v, l]) =>
        h('option', { value: v, selected: (a.on === false && v === 'off') || (a.on && a.bri != null && v === 'dim') || (a.on && a.bri == null && v === 'on') }, l)));
      const bri = h('input', { type: 'number', min: 1, max: 100, value: a.bri ?? 30, 'aria-label': 'Brightness %' });
      const briWrap = h('label', { class: 'field small' }, 'Brightness %', bri);
      const sync = () => { briWrap.hidden = mode.value !== 'dim'; };
      mode.addEventListener('change', sync); sync();
      read = () => {
        const [k, id] = target.value.split(':');
        const label = target.selectedOptions[0]?.textContent ?? '';
        return { type: 'lights', kind: k, id, name: label, on: mode.value !== 'off', ...(mode.value === 'dim' ? { bri: Number(bri.value) } : {}) };
      };
      row = h('div', { class: 'routine-row' }, h('div', { class: 'row-ico' }, icon('bulb')),
        rooms.length ? h('div', { class: 'fields' }, h('label', { class: 'field' }, 'Lights', target), h('label', { class: 'field' }, 'Set to', mode), briWrap)
          : h('p', { class: 'muted' }, 'Pair the Hue bridge in Settings to add lights.'), remove);
      if (!rooms.length) read = null;
    } else if (a.type === 'alarm') {
      const mode = h('select', { 'aria-label': 'Alarm' }, h('option', { value: 'arm', selected: a.mode !== 'home' }, 'Full arm'), h('option', { value: 'home', selected: a.mode === 'home' }, 'Part arm (night)'));
      read = () => ({ type: 'alarm', mode: mode.value });
      row = h('div', { class: 'routine-row' }, h('div', { class: 'row-ico' }, icon('shield')),
        h('div', { class: 'fields' }, h('label', { class: 'field' }, 'Alarm', mode), h('p', { class: 'muted' }, 'Routines can arm the alarm. Disarming always needs your PIN.')), remove);
    } else if (a.type === 'heating') {
      const which = h('select', { 'aria-label': 'Thermostat' }, thermostats.length ? thermostats.map((t) => h('option', { value: t.id, selected: a.id === t.id }, t.name)) : h('option', { value: '' }, 'Heating'));
      const temp = h('input', { type: 'number', min: 5, max: 32, step: 0.5, value: a.target ?? 21, 'aria-label': 'Temperature' });
      const dur = h('select', { 'aria-label': 'For how long' },
        h('option', { value: '', selected: !a.minutes }, 'Until changed'),
        [30, 60, 90, 120, 150, 180, 240, 300, 360].map((m) => h('option', { value: m, selected: a.minutes === m }, `For ${mins(m * 60)}, then schedule`)));
      read = () => ({ type: 'heating', id: which.value || null, target: Number(temp.value), ...(dur.value ? { minutes: Number(dur.value) } : {}) });
      row = h('div', { class: 'routine-row' }, h('div', { class: 'row-ico' }, icon('flame')),
        h('div', { class: 'fields' }, h('label', { class: 'field' }, 'Heating', which), h('label', { class: 'field small' }, 'Temperature °C', temp), h('label', { class: 'field' }, 'How long', dur)), remove);
    } else {
      const kind0 = a.kind ?? 'sky';
      const id0 = a.device ?? a.box;
      const group = (k, label) => h('optgroup', { label }, tvs.filter((t) => t.kind === k).map((t) => h('option', { value: `${t.kind}:${t.id}`, selected: t.kind === kind0 && t.id === id0 }, t.name)));
      const dev = h('select', { 'aria-label': 'TV' }, group('sky', 'Sky boxes'), group('android', 'Android TV, Shield, Fire TV'), group('smarttv', 'Other TVs'));
      const what = h('select', { 'aria-label': 'Do' });
      const chans = [...S.channels].sort((x, y) => (y.fav - x.fav) || (Number(x.number) - Number(y.number)));
      const ch = h('select', { 'aria-label': 'Channel' }, chans.map((c) => h('option', { value: c.sid, selected: a.sid === c.sid }, `${c.number} ${c.name}`)));
      const level = h('input', { type: 'number', min: 0, max: 100, value: a.level ?? 20, 'aria-label': 'Volume' });
      const app = h('select', { 'aria-label': 'App' }, ['YouTube', 'Netflix'].map((x) => h('option', { value: x, selected: a.app === x }, x)));
      const chWrap = h('label', { class: 'field' }, 'Channel', ch);
      const levelWrap = h('label', { class: 'field small' }, 'Volume (0–100)', level);
      const appWrap = h('label', { class: 'field' }, 'App', app);
      const kindNow = () => dev.value.split(':')[0];
      const fill = (keep) => {
        const opts = TV_DO[kindNow()] ?? [];
        what.replaceChildren(...opts.map(([v, l]) => h('option', { value: v, selected: v === keep }, l)));
        sync();
      };
      const sync = () => { chWrap.hidden = what.value !== 'channel'; levelWrap.hidden = what.value !== 'volume'; appWrap.hidden = what.value !== 'app'; };
      dev.addEventListener('change', () => fill(what.value));
      what.addEventListener('change', sync);
      fill(a.do ?? (a.sid ? 'channel' : TV_DO[kind0]?.[0]?.[0]));
      read = () => {
        const [kind, device] = dev.value.split(':');
        const out = { type: 'tv', kind, device, do: what.value, name: dev.selectedOptions[0]?.textContent ?? '' };
        if (what.value === 'channel') Object.assign(out, { sid: ch.value, channel: ch.selectedOptions[0]?.textContent ?? '' });
        if (what.value === 'volume') out.level = Number(level.value);
        if (what.value === 'app') out.app = app.value;
        return out;
      };
      row = h('div', { class: 'routine-row' }, h('div', { class: 'row-ico' }, icon('tv')),
        h('div', { class: 'fields' }, h('label', { class: 'field' }, 'TV', dev), h('label', { class: 'field' }, 'Do', what), chWrap, levelWrap, appWrap), remove);
    }
    if (read) readers.push(read);
    rows.append(row);
  };
  draft.actions.forEach(addRow);

  const save = h('button', { type: 'button', class: 'btn primary' }, r ? 'Save changes' : 'Save routine');
  save.addEventListener('click', async () => {
    msg.textContent = '';
    if (kind === 'daily' && !days.size) { msg.textContent = 'Pick at least one day'; return; }
    const body = {
      id: r?.id, name: name.value, enabled: draft.enabled !== false, programme: draft.programme ?? null,
      trigger: kind === 'daily' ? { type: 'daily', time: time.value, days: [...days] } : { type: 'once', at: fromLocalInput(at.value) },
      actions: readers.map((f) => f()),
    };
    save.disabled = true;
    try { await api('POST', '/api/routines', body); sheet.close(); toast(r ? 'Routine saved' : `Routine "${body.name}" added`); await refresh(); if (currentPage() !== 'routines') location.hash = '#/routines'; }
    catch (e) { msg.textContent = e.message; }
    save.disabled = false;
  });

  sheet.replaceChildren(h('div', { class: 'sheet-card' }, h('div', { class: 'sheet-body pad-top routine-editor' },
    h('h2', {}, r ? 'Edit routine' : draft.programme ? 'Set up for this show' : 'New routine'),
    draft.programme ? h('p', { class: 'muted' }, `Runs a minute before ${draft.programme.title} starts.`) : null,
    h('label', { class: 'field' }, 'Name', name),
    h('div', { class: 'field' }, 'When', kindSeg), daily, once,
    h('div', { class: 'field' }, 'Do this'), rows,
    h('div', { class: 'row add-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => addRow({ type: 'lights', on: true }) }, icon('bulb'), 'Lights'),
      h('button', { type: 'button', class: 'btn', onclick: () => addRow({ type: 'heating', target: 21 }) }, icon('flame'), 'Heating'),
      S.state?.yale?.signedIn ? h('button', { type: 'button', class: 'btn', onclick: () => addRow({ type: 'alarm', mode: 'arm' }) }, icon('shield'), 'Alarm') : null,
      tvs.length ? h('button', { type: 'button', class: 'btn', onclick: () => addRow({ type: 'tv' }) }, icon('tv'), 'TV') : null),
    msg,
    h('div', { class: 'actions' }, save, h('button', { type: 'button', class: 'btn', onclick: () => sheet.close() }, 'Cancel')))));
  sheet.showModal();
  if (!r) name.focus();
}

/** "Set up for this show": a one-off routine a minute before the programme starts */
function showRoutine(sid, ev) {
  const ch = S.bySid.get(sid);
  const box = (S.state?.tv ?? []).find((b) => b.id === activeBoxId()) ?? (S.state?.tv ?? [])[0];
  const room = S.state?.lights?.paired ? (S.state.lights.rooms ?? []).find((x) => x.type === 'Room') : null;
  const actions = [];
  if (box) actions.push({ type: 'tv', kind: 'sky', device: box.id, do: 'channel', sid, name: box.name, channel: `${ch?.number ?? ''} ${ch?.name ?? ''}`.trim() });
  if (room) actions.push({ type: 'lights', kind: 'group', id: room.id, name: room.name, on: true, bri: 30 });
  actions.push({ type: 'heating', target: 21, minutes: Math.min(360, Math.max(30, Math.ceil(ev.d / 1800) * 30)) });
  routineEditor(null, { name: `Ready for ${ev.t}`.slice(0, 60), enabled: true, trigger: { type: 'once', at: (ev.st - 60) * 1000 }, actions, programme: { sid, title: ev.t, st: ev.st } });
}

// --- wall tablet: full-screen dashboard for a tablet left on a wall or worktop ------------------------------------
let wakeLock = null;
let wakeVideo = null;
async function keepAwake(on) {
  // Wake Lock needs HTTPS; on plain http a silent looping clip keeps tablets awake instead
  if (!on) { wakeLock?.release().catch(() => {}); wakeLock = null; wakeVideo?.pause(); return; }
  if ('wakeLock' in navigator) { try { wakeLock = await navigator.wakeLock.request('screen'); return; } catch {} }
  if (!wakeVideo) {
    wakeVideo = h('video', { class: 'keepawake', src: '/keepawake.mp4', loop: true, playsinline: true, 'aria-hidden': 'true' });
    wakeVideo.muted = true;
    document.body.append(wakeVideo);
  }
  wakeVideo.play().catch(() => {}); // may need a first tap: the wall view retries on every tap
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && currentPage() === 'wall') keepAwake(true); });

function wallClock() {
  const now = new Date();
  return [h('b', {}, now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })), h('span', {}, now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))];
}

function renderWall(main) {
  if (S.dragging) return;
  const s = S.state ?? {};
  const doorbell = (s.ring?.devices ?? []).find((d) => d.type === 'doorbell') ?? (s.ring?.devices ?? []).find((d) => d.type === 'camera');
  const lastRing = (s.ring?.events ?? []).find((e) => e.kind === 'ding');
  const t = s.hive?.thermostats?.[0];
  const rooms = s.lights?.paired ? (s.lights.rooms ?? []).filter((r) => r.type === 'Room') : [];
  const down = (s.network?.targets ?? []).filter((x) => x.up === false);
  const nextRoutines = (s.routines ?? []).filter((r) => r.next).sort((a, b) => a.next - b.next).slice(0, 3);
  const slot = Math.floor(Date.now() / 120_000);
  const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60_000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${ringWhen(iso)}`; };

  main.replaceChildren(h('div', { class: 'wall', onclick: () => keepAwake(true) },
    h('header', { class: 'wall-top' },
      h('div', { class: 'wall-clock' }, wallClock()),
      h('div', { class: 'wall-status' },
        h('span', { class: 'chip' }, h('span', { class: `dot ${down.length ? 'bad' : 'ok'}` }), down.length ? `${down[0].name} down` : 'Internet OK'),
        t ? h('span', { class: 'chip' }, icon('flame'), `${t.current?.toFixed(1) ?? '–'}°`) : null,
        h('button', { class: 'icon-btn', 'aria-label': 'Full screen', title: 'Full screen', onclick: (e) => {
          e.stopPropagation();
          document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {});
        } }, icon('expand')),
        h('a', { class: 'icon-btn', href: '#/home', 'aria-label': 'Leave wall mode', title: 'Leave wall mode' }, icon('x')))),
    h('div', { class: 'wall-grid' },
      ...(s.cameras ?? []).map(cameraCard),
      doorbell ? h('div', { class: 'card wall-door' },
        h('div', { class: 'cam-shot' }, h('img', { src: `/api/ring/snapshot/${doorbell.id}?v=${slot}`, alt: `Latest picture from ${doorbell.name}`, onerror: (e) => e.currentTarget.remove() }),
          h('span', { class: 'cam-ico' }, icon('bell'))),
        h('div', { class: 'cam-body' }, h('div', { class: 'tv-text' }, h('b', {}, doorbell.name),
          h('small', {}, lastRing ? `Doorbell rang ${ago(lastRing.at)}` : 'No rings today')))) : null,
      s.yale?.signedIn ? alarmCard(s.yale) : null,
      t ? thermostatCard(t, s.hive.boost) : null,
      rooms.length ? h('div', { class: 'card wall-lights' }, h('h3', {}, 'Lights'),
        h('div', { class: 'wall-rooms' }, rooms.map((r) => h('button', { class: `wall-room ${r.on ? 'on' : ''}`, 'aria-pressed': String(r.on), onclick: () => hueSet('group', r.id, { on: !r.on }) },
          icon('bulb'), h('b', {}, r.name), h('small', {}, r.on ? `${bri2pct(r.bri)}%` : 'Off'))))) : null,
      h('div', { class: 'card wall-tv' }, h('h3', {}, 'On TV'),
        (s.tv ?? []).map((b) => { const n = nowLine(b); return h('div', { class: 'wall-tv-row' },
          h('span', { class: `dot ${!b.online ? 'bad' : b.standby ? '' : 'live'}` }),
          h('div', { class: 'tv-text' }, h('b', {}, n.title), h('small', {}, `${b.name}${n.sub ? ` · ${n.sub}` : ''}`)),
          b.now ? h('div', { class: 'progress' }, h('i', { style: { width: `${pct(b.now)}%` } })) : null); })),
      nextRoutines.length ? h('div', { class: 'card wall-routines' }, h('h3', {}, 'Coming up'),
        nextRoutines.map((r) => h('div', { class: 'wall-tv-row' }, icon('clock'),
          h('div', { class: 'tv-text' }, h('b', {}, r.name), h('small', {}, routineNext(r).replace('Next: ', '')))))) : null)));
  keepAwake(true);
}

// --- home-network cameras (RTSP, via the server's ffmpeg) ------------------------------------------------
const camSnap = (id) => `/api/cameras/${id}/snapshot?v=${Math.floor(Date.now() / 10_000)}`;
function cameraLive(cam) {
  const sheet = $('#sheet');
  const img = h('img', { class: 'cam-live', src: `/api/cameras/${cam.id}/live`, alt: `${cam.name}, live` });
  const status = h('small', { class: 'muted' }, 'Connecting… (a few seconds)');
  img.addEventListener('load', () => { status.textContent = 'Live · 5 frames a second'; }, { once: true });
  img.addEventListener('error', () => { status.textContent = 'Camera not answering'; });
  const close = () => sheet.close();
  sheet.replaceChildren(h('div', { class: 'sheet-card cam-sheet' },
    h('div', { class: 'cam-shot' }, img, h('button', { class: 'sheet-close', 'aria-label': 'Close', onclick: close }, icon('x'))),
    h('div', { class: 'sheet-body' }, h('div', { class: 'tv-text' }, h('b', {}, cam.name), status), cam.ptz ? ptzPad(cam) : null)));
  // closing the sheet drops the connection, which stops the server's live feed (and any movement)
  sheet.addEventListener('close', () => { img.src = ''; img.remove(); if (cam.ptz) api('POST', `/api/cameras/${cam.id}/ptz`, { stop: true }).catch(() => {}); }, { once: true });
  sheet.showModal();
}
// Hold an arrow to move; the app repeats the move while held and the server stops the camera if that stops.
function ptzPad(cam) {
  let timer = null;
  const send = (body) => api('POST', `/api/cameras/${cam.id}/ptz`, body).catch((e) => toast(e.message));
  const hold = (pan, tilt) => {
    const start = (e) => { e.preventDefault(); if (timer) return; send({ pan, tilt }); timer = setInterval(() => send({ pan, tilt }), 700); };
    const end = () => { if (!timer) return; clearInterval(timer); timer = null; send({ stop: true }); };
    return { onpointerdown: start, onpointerup: end, onpointerleave: end, onpointercancel: end, oncontextmenu: (e) => e.preventDefault() };
  };
  return h('div', { class: 'cam-ptz' }, h('div', { class: 'dpad' },
    h('button', { class: 'up', 'aria-label': 'Tilt up', ...hold(0, 0.5) }, icon('up')),
    h('button', { class: 'left', 'aria-label': 'Pan left', ...hold(-0.5, 0) }, icon('left')),
    h('button', { class: 'ok', 'aria-label': 'Stop', onclick: () => send({ stop: true }) }, icon('stop')),
    h('button', { class: 'right', 'aria-label': 'Pan right', ...hold(0.5, 0) }, icon('right')),
    h('button', { class: 'down', 'aria-label': 'Tilt down', ...hold(0, -0.5) }, icon('down'))),
    h('small', { class: 'muted' }, 'Hold an arrow to move the camera'));
}
function cameraCard(cam) {
  return h('div', { class: 'card cam-card' },
    h('button', { class: 'cam-shot', 'aria-label': `Watch ${cam.name} live`, onclick: () => cameraLive(cam) },
      h('img', { src: camSnap(cam.id), alt: `Latest picture from ${cam.name}`, loading: 'lazy', onerror: (e) => e.currentTarget.remove() }),
      h('span', { class: 'cam-ico' }, icon('play', 'fill'))),
    h('div', { class: 'cam-body' }, h('div', { class: 'tv-text' }, h('b', {}, cam.name), h('small', {}, cam.live ? 'Being watched now' : 'Tap the picture to watch live'))));
}
function renderCameras(main) {
  const s = S.state ?? {};
  const body = ringSection(s.ring, s.cameras ?? [], { title: false });
  main.replaceChildren(pageHead('Cameras', 'Ring and home cameras — tap a picture to watch live'),
    ...(body.length ? body : [h('div', { class: 'card' }, h('h3', {}, 'No cameras yet'),
      h('p', { class: 'muted' }, 'Sign in to Ring, or add a home-network camera (RTSP), in Settings.'), h('a', { class: 'btn primary', href: '#/settings' }, 'Open Settings'))]));
}
function camerasSettingsCard(list) {
  const msg = h('p', { class: 'error', role: 'alert' });
  const name = h('input', { placeholder: 'Dog camera', 'aria-label': 'Camera name' });
  const url = h('input', { placeholder: 'rtsp://<camera-ip>:554/…', 'aria-label': 'RTSP address' });
  return h('div', { class: 'card' }, h('h3', {}, 'Cameras'),
    h('p', { class: 'desc' }, 'Home-network cameras with an RTSP stream. Use the camera\'s small sub-stream if it has one; the server turns it into pictures and a live view.'),
    list.map((c) => h('div', { class: 'fields dev-row' },
      h('label', { class: 'field' }, 'Name', h('input', { name: `camera.${c.id}.name`, value: c.name })),
      h('label', { class: 'field' }, 'RTSP address', h('input', { name: `camera.${c.id}.url`, value: c.url })),
      h('button', { type: 'button', class: 'btn ghost remove', 'aria-label': `Remove ${c.name}`, onclick: async () => {
        if (!(await confirmSheet(`Remove ${c.name}?`, 'It disappears from Home Control. Nothing on the camera changes.', 'Remove'))) return;
        try { await api('DELETE', `/api/cameras/${c.id}`); toast(`${c.name} removed`); await refresh(); rerender(); } catch (e) { toast(e.message); }
      } }, icon('x'), 'Remove'))),
    h('div', { class: 'fields dev-row' }, h('label', { class: 'field' }, 'Name', name), h('label', { class: 'field' }, 'RTSP address', url),
      h('button', { type: 'button', class: 'btn', onclick: async () => {
        msg.textContent = '';
        try { await api('POST', '/api/cameras', { name: name.value, url: url.value }); toast(`${name.value} added`); await refresh(); rerender(); } catch (e) { msg.textContent = e.message; }
      } }, icon('plus'), 'Add camera')),
    msg);
}

async function renderHome(main) {
  const s = S.state;
  const greeting = (() => { const hr = new Date().getHours(); return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; })();
  const lightsOn = s?.lights?.rooms?.filter((r) => r.on) ?? [];
  const down = s?.network.targets.filter((t) => t.up === false) ?? [];
  const rail = h('div', { class: 'rail' }, Array.from({ length: 4 }, () => h('div', { class: 'prog-card' }, h('div', { class: 'thumb skeleton' }), h('div', { class: 'body' }, h('b', {}, ' ')))));

  main.replaceChildren(
    pageHead(greeting, new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })),
    // at-a-glance strip: heating, lights, internet, switches
    h('div', { class: 'status-strip' },
      heatingTile(s?.hive),
      h('a', { class: 'card stat', href: '#/lights' }, h('div', { class: `ico ${lightsOn.length ? 'on' : ''}` }, icon('bulb')),
        h('div', {}, h('b', {}, lightsOn.length ? `${lightsOn.length} room${lightsOn.length > 1 ? 's' : ''} lit` : 'All lights off'), h('span', {}, lightsOn.map((r) => r.name).join(', ') || 'Philips Hue'))),
      h('a', { class: 'card stat', href: '#/network' }, h('div', { class: `ico ${down.length ? 'bad' : 'ok'}` }, icon('network')),
        h('div', {}, h('b', {}, down.length ? `${down.length} connection${down.length > 1 ? 's' : ''} down` : 'Internet OK'),
          h('span', { class: 'num' }, s?.network.targets.map((t) => `${t.name.replace('Internet ', '').replace(/[()]/g, '')} ${t.last ?? '–'} ms`).join(' · ') ?? ''))),
      h('a', { class: 'card stat', href: '#/network' }, h('div', { class: 'ico' }, icon('switch')),
        h('div', {}, h('b', {}, s?.network.ciscoConfigured ? `${s.network.switches.filter((x) => x.ok).length}/${s.network.switches.length} switches OK` : 'Switch monitoring off'),
          h('span', {}, s?.network.ciscoConfigured ? 'Cisco 3560s' : 'Add credentials in Settings')))),
    ...alarmSection(s?.yale),
    h('div', { class: 'heroes' }, (s?.tv ?? []).map(heroCard)),
    // replaceChildren() doesn't flatten arrays, so spread the optional section
    ...((s?.android ?? []).length || (s?.smarttv ?? []).length ? [
      h('div', { class: 'section-title' }, h('h2', {}, 'Other TVs'), h('a', { href: '#/apps' }, 'Apps →')),
      h('div', { class: 'tv-list' }, (s.smarttv ?? []).map(smartTvRow), (s.android ?? []).map((d) => {
        const dev = { ...d, android: true };
        const go = (page) => () => { try { localStorage.setItem('hc-box', d.id); } catch {} location.hash = `#/${page}`; };
        const tone = boxDot(dev);
        return h('div', { class: 'tv-row' },
          h('div', { class: `ico ${tone === 'live' ? 'live' : tone === 'bad' ? 'bad' : tone === 'warn' ? 'warn' : ''}` }, icon(KIND_ICON[d.kind] ?? 'tv')),
          h('div', { class: 'tv-text' }, h('b', {}, d.name), h('small', {}, boxStatusText(dev))),
          h('div', { class: 'tv-actions' },
            d.conn === 'ok' ? h('button', { class: 'icon-btn', 'aria-label': d.awake ? 'Sleep' : 'Wake', title: d.awake ? 'Sleep' : 'Wake', onclick: () => androidKey(d.id, d.awake ? 'sleep' : 'wake') }, icon('power'))
              : d.conn === 'offline' && d.canWake ? h('button', { class: 'icon-btn', 'aria-label': 'Wake', title: 'Wake', onclick: () => androidWake(dev) }, icon('power')) : null,
            h('button', { class: 'icon-btn', 'aria-label': 'Remote', title: 'Remote', onclick: go('remote') }, icon('remote')),
            h('button', { class: 'icon-btn', 'aria-label': 'Apps', title: 'Apps', onclick: go('apps') }, icon('apps'))));
      })),
    ] : []),
    ...ringSection(s?.ring, s?.cameras ?? []),
    h('div', { class: 'section-title' }, h('h2', {}, 'On now on your favourites'), h('a', { href: '#/guide' }, 'Full guide →')),
    rail,
    h('div', { class: 'section-title' }, h('h2', {}, 'Lights'), h('a', { href: '#/lights' }, 'All lights →')),
    s?.lights?.paired && s.lights.online
      ? h('div', { class: 'quick-lights' }, s.lights.rooms.filter((r) => r.type === 'Room').map((r) =>
        h('button', { class: `light-chip ${r.on ? 'on' : ''}`, onclick: () => hueSet('group', r.id, { on: !r.on }) }, icon('bulb'), r.name)))
      : h('div', { class: 'card muted' }, s?.lights?.paired ? 'Hue bridge not answering.' : 'Pair the Hue bridge in Settings to control lights here.'),
  );

  // favourites "on now" rail (async)
  try {
    const sched = await favouritesOnNow();
    const now = nowSec();
    const cards = S.channels.filter((c) => c.fav).map((c) => {
      const ev = (sched[c.sid] ?? []).find((e) => e.st <= now && e.st + e.d > now);
      if (!ev) return null;
      const art = artUrl(ev.uuid);
      return h('button', { class: 'prog-card', onclick: () => openProgramme(c.sid, ev) },
        h('div', { class: 'thumb', style: art ? { backgroundImage: `url("${art}")` } : {} },
          h('img', { class: 'ch-logo', src: logoUrl(c.sid), alt: c.name, loading: 'lazy' }),
          h('div', { class: 'progress' }, h('i', { style: { width: `${pct(ev)}%` } }))),
        h('div', { class: 'body' }, h('b', {}, ev.t), h('span', { class: 'num' }, `${c.number} · ${c.name} · until ${hhmm(ev.st + ev.d)}`)));
    }).filter(Boolean);
    rail.replaceChildren(...(cards.length ? cards : [h('div', { class: 'card muted' }, 'Star channels in the TV Guide to see what’s on them here.')]));
  } catch {
    rail.replaceChildren(h('div', { class: 'card muted' }, 'Guide unavailable right now.'));
  }
}

// --- guide ---------------------------------------------------------------------------------------------------
const CH_COL = () => (innerWidth < 600 ? 150 : 220);
const PX_MIN = () => (innerWidth < 600 ? 4 : 5.5);
const WINDOW_H = 8;

function guideStart() {
  const g = S.guide;
  if (g.start) return g.start;
  const d = new Date();
  if (g.day === 0) { d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0); return Math.floor(d / 1000) - 1800; }
  d.setDate(d.getDate() + g.day);
  d.setHours(18, 0, 0, 0);
  return Math.floor(d / 1000);
}

function guideChannels() {
  const g = S.guide;
  const q = g.q.trim().toLowerCase();
  return S.channels.filter((c) =>
    (g.genre === 'All' ? true : g.genre === 'Favourites' ? c.fav : c.genre === g.genre) &&
    (!q || c.name.toLowerCase().includes(q) || c.number.startsWith(q)));
}

async function renderGuide(main) {
  const g = S.guide;
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    return { i, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }) };
  });
  const genreChips = ['Favourites', 'All', ...S.genres.filter((x) => x !== 'Radio')].map((name) =>
    h('button', { class: 'chip', 'aria-pressed': String(g.genre === name), onclick: () => { g.genre = name; rerender(); } }, name === 'Favourites' ? icon('star') : null, name));
  const dayChips = days.map((d) => h('button', { class: 'chip', 'aria-pressed': String(g.day === d.i), onclick: () => { g.day = d.i; g.start = null; rerender(); } }, d.label));
  const search = h('input', { type: 'search', placeholder: 'Find a channel', value: g.q, 'aria-label': 'Find a channel' });
  search.addEventListener('input', () => { g.q = search.value; clearTimeout(search._t); search._t = setTimeout(() => drawGrid(), 250); });
  const shift = (hrs) => { g.start = guideStart() + hrs * 3600; drawGrid(); };

  const scroller = h('div', { class: 'guide-scroll' });
  main.replaceChildren(
    pageHead('TV Guide', 'Tap a programme for details or to watch it now'),
    h('div', { class: 'guide-tools' },
      h('div', { class: 'chips' }, dayChips),
      h('div', { class: 'row' },
        h('div', { class: 'chips' }, genreChips),
        h('div', { class: 'chips' },
          h('label', { class: 'search' }, icon('search'), search),
          h('button', { class: 'icon-btn', 'aria-label': 'Earlier', onclick: () => shift(-2) }, icon('left')),
          h('button', { class: 'btn', onclick: () => { g.day = 0; g.start = null; rerender(); } }, 'Now'),
          h('button', { class: 'icon-btn', 'aria-label': 'Later', onclick: () => shift(2) }, icon('right'))))),
    h('div', { class: 'guide-wrap' }, scroller));

  async function drawGrid() {
    const chans = guideChannels().slice(0, 500);
    const start = guideStart();
    const end = start + WINDOW_H * 3600;
    const px = PX_MIN();
    const col = CH_COL();
    const width = (WINDOW_H * 60) * px;
    if (!chans.length) {
      scroller.replaceChildren(h('div', { class: 'g-empty' }, g.genre === 'Favourites' && !g.q ? 'No favourites yet — choose "All" and tap the ☆ next to a channel.' : 'No channels match.'));
      return;
    }
    scroller.replaceChildren(h('div', { class: 'g-empty' }, 'Loading guide…'));
    let sched;
    try {
      sched = (await api('GET', `/api/guide?from=${start}&to=${end}&sids=${chans.map((c) => c.sid).join(',')}`)).schedule;
    } catch (e) {
      scroller.replaceChildren(h('div', { class: 'g-empty' }, `Guide unavailable: ${e.message}`));
      return;
    }
    const ticks = [];
    for (let t = Math.ceil(start / 1800) * 1800; t < end; t += 1800) {
      ticks.push(h('span', { style: { left: `${((t - start) / 60) * px}px` } }, hhmm(t)));
    }
    const now = nowSec();
    const rows = chans.map((c) => {
      const events = (sched[c.sid] ?? []).map((ev) => {
        const l = Math.max(0, ((ev.st - start) / 60) * px);
        const r = Math.min(width, ((ev.st + ev.d - start) / 60) * px);
        if (r - l < 4) return null;
        const live = ev.st <= now && ev.st + ev.d > now;
        return h('button', {
          class: `g-ev ${live ? 'live' : ''} ${ev.st + ev.d <= now ? 'past' : ''}`,
          style: { left: `${l + 2}px`, width: `${r - l - 4}px` },
          title: `${hhmm(ev.st)} ${ev.t}`,
          onclick: () => openProgramme(c.sid, ev),
        }, h('b', {}, ev.t), r - l > 90 ? h('span', {}, `${hhmm(ev.st)} – ${hhmm(ev.st + ev.d)}`) : null);
      });
      return h('div', { class: 'g-row' },
        h('div', { class: 'g-ch', style: { width: `${col}px` } },
          h('img', { src: logoUrl(c.sid), alt: '', loading: 'lazy' }),
          h('div', { class: 'meta' }, h('b', {}, c.number), h('span', { title: c.name }, c.name)),
          h('button', { class: `star ${c.fav ? 'on' : ''}`, 'aria-label': c.fav ? `Remove ${c.name} from favourites` : `Add ${c.name} to favourites`,
            onclick: async (e) => { await toggleFav(c.sid, !c.fav); e.currentTarget.classList.toggle('on', c.fav); if (g.genre === 'Favourites') drawGrid(); } }, icon('star'))),
        h('div', { class: 'g-track', style: { width: `${width}px` } }, events));
    });
    const nowX = ((now - start) / 60) * px;
    scroller.replaceChildren(h('div', { class: 'g-grid', style: { width: `${col + width}px` } },
      h('div', { class: 'g-head' },
        h('div', { class: 'g-corner', style: { width: `${col}px` } }, new Date(start * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })),
        h('div', { class: 'g-times', style: { width: `${width}px` } }, ticks)),
      rows,
      nowX > 0 && nowX < width ? h('div', { class: 'g-now', style: { left: `${col + nowX}px` } }) : null));
  }
  await drawGrid();
}

// --- remote -----------------------------------------------------------------------------------------------------
function boxBanner(box) {
  if (box?.android) return androidBanner(box);
  const n = box ? nowLine(box) : { title: 'No Sky box', sub: '' };
  const live = box?.online && !box.standby;
  return h('div', { class: 'card box-banner' },
    box?.channel?.sid ? h('img', { class: 'logo-tile', src: logoUrl(box.channel.sid), alt: '' }) : h('div', { class: 'logo-tile icon-tile' }, icon('tv')),
    h('div', { class: 'bb-text' },
      h('small', {}, 'Controlling ', h('b', {}, box?.name ?? '—')),
      h('b', { class: 'bb-title' }, n.title),
      h('span', { class: 'muted' }, n.sub)),
    h('div', { class: 'bb-actions' },
      box ? h('button', { class: `btn ${live ? '' : 'primary'}`, disabled: !box.online, onclick: () => skyKey(box.id, live ? 'power' : 'sky') }, icon('power'), live ? 'Standby' : 'Turn on') : null));
}

// --- Android TV / Shield / Fire TV ----------------------------------------------------------------
async function androidKey(id, key) {
  try { await api('POST', `/api/android/${id}/key`, { key }); setTimeout(refresh, 1500); } catch (e) { toast(e.message); }
}
async function androidLaunch(dev, app) {
  toast(`Opening ${app.label} on ${dev.name}${dev.awake ? '' : ' — waking it up first'}…`);
  try { await api('POST', `/api/android/${dev.id}/app`, { pkg: app.pkg }); toast(`${app.label} opened on ${dev.name}`); setTimeout(refresh, 3000); } catch (e) { toast(e.message); }
}
async function androidWake(dev) {
  toast(dev.conn === 'ok' ? `Waking ${dev.name}…` : `Sending a wake-up signal to ${dev.name} — this can take up to 30 seconds…`);
  try {
    const r = await api('POST', `/api/android/${dev.id}/wake`);
    toast(r.conn === 'closed' ? `${dev.name} is back on the network, but debugging is off` : `${dev.name} is awake`);
  } catch (e) { toast(e.message); }
  refresh();
}
async function androidApprove(dev) {
  toast(`Look at ${dev.name}: choose "Always allow from this computer", then OK`);
  try {
    // returns straight away; the regular status refresh shows "connected" once the TV accepts (up to 2 min)
    await api('POST', `/api/android/${dev.id}/approve`);
  } catch (e) { toast(e.message); }
  refresh();
}

const ENABLE_HELP = {
  firetv: 'On the Fire TV: Settings → My Fire TV → Developer options → turn on ADB debugging. (If Developer options is missing: Settings → My Fire TV → About → select the device name 7 times.)',
  shield: 'On the Shield: Settings → Device Preferences → About → select Build 7 times. Then Settings → Device Preferences → Developer options → turn on Network debugging.',
  androidtv: 'On the TV: Settings → Device Preferences → About → select Build 7 times. Then Developer options → turn on USB debugging (and Network/ADB debugging if listed).',
};

function connectionHelp(dev) {
  if (dev.conn === 'ok' || dev.conn === 'checking') return null;
  if (dev.conn === 'unauthorised' || dev.conn === 'waiting') {
    return h('div', { class: 'card notice' }, h('h3', {}, `Connect ${dev.name}`),
      h('p', { class: 'muted' }, 'Turn the TV on, press Connect, then on the TV tick "Always allow from this computer" and choose OK. You only do this once.'),
      h('button', { class: 'btn primary', disabled: dev.conn === 'waiting', onclick: () => androidApprove(dev) }, dev.conn === 'waiting' ? 'Waiting for the TV…' : 'Connect'));
  }
  if (dev.conn === 'closed') {
    return h('div', { class: 'card notice' }, h('h3', {}, 'Turn on debugging to control this device'),
      h('p', { class: 'muted' }, ENABLE_HELP[dev.kind] ?? ENABLE_HELP.androidtv),
      h('p', { class: 'muted' }, 'Within a minute of switching it on, a Connect button appears here.'));
  }
  return h('div', { class: 'card notice' }, h('h3', {}, `${dev.name} isn't answering`),
    h('p', { class: 'muted' }, `It's in deep standby, switched off at the wall, or not on the network (${dev.ip}).`),
    dev.canWake ? h('p', { class: 'muted' }, 'Waking it from here needs "Network standby" or "Wake on LAN / Wake on Wireless LAN" turned on in the TV\'s network settings (and "Quick start" in power settings if it has it).') : null,
    dev.canWake ? h('button', { class: 'btn primary', onclick: () => androidWake(dev) }, icon('power'), 'Try to wake it') : null);
}

function androidBanner(dev) {
  const ok = dev.conn === 'ok';
  return h('div', { class: 'card box-banner' },
    h('div', { class: 'logo-tile icon-tile', style: dev.app?.color ? { background: dev.app.color } : {} }, icon(KIND_ICON[dev.kind] ?? 'tv')),
    h('div', { class: 'bb-text' },
      h('small', {}, 'Controlling ', h('b', {}, dev.name)),
      h('b', { class: 'bb-title' }, boxStatusText(dev)),
      h('span', { class: 'muted' }, [dev.model, dev.ip].filter(Boolean).join(' · '))),
    h('div', { class: 'bb-actions' },
      ok ? h('button', { class: `btn ${dev.awake ? '' : 'primary'}`, onclick: () => androidKey(dev.id, dev.awake ? 'sleep' : 'wake') }, icon('power'), dev.awake ? 'Sleep' : 'Wake') : null,
      !ok && dev.conn === 'offline' && dev.canWake ? h('button', { class: 'btn primary', onclick: () => androidWake(dev) }, icon('power'), 'Wake') : null));
}

function renderAndroidRemote(main, dev) {
  const id = dev.id;
  const key = (k, label, cls = '') => h('button', { class: `rkey ${cls}`, 'aria-label': k, disabled: dev.conn !== 'ok', onclick: () => androidKey(id, k) }, label);
  const tv = dev.kind === 'androidtv';
  main.replaceChildren(
    pageHead('Remote', `Controlling ${dev.name}`),
    androidBanner(dev),
    connectionHelp(dev) ?? '',
    h('div', { class: 'remote-layout' },
      h('div', { class: 'remote' },
        h('div', { class: 'row3' }, key('power', icon('power'), 'power'), key('home', icon('home')), key('settings', icon('settings'))),
        h('div', { class: 'dpad' },
          h('button', { class: 'up', 'aria-label': 'Up', onclick: () => androidKey(id, 'up') }, icon('up')),
          h('button', { class: 'left', 'aria-label': 'Left', onclick: () => androidKey(id, 'left') }, icon('left')),
          h('button', { class: 'ok', 'aria-label': 'Select', onclick: () => androidKey(id, 'select') }, 'OK'),
          h('button', { class: 'right', 'aria-label': 'Right', onclick: () => androidKey(id, 'right') }, icon('right')),
          h('button', { class: 'down', 'aria-label': 'Down', onclick: () => androidKey(id, 'down') }, icon('down'))),
        h('div', { class: 'row3' }, key('back', icon('back')), key('menu', '☰'), key('search', icon('search'))),
        h('div', { class: 'row3' }, key('rewind', icon('rewind', 'fill')), key('playpause', h('span', { class: 'pp' }, icon('play', 'fill'), icon('pause', 'fill'))), key('fastforward', icon('ff', 'fill'))),
        h('div', { class: 'row3' }, key('volumedown', icon('minus')), key('mute', 'Mute'), key('volumeup', icon('plus'))),
        tv ? h('div', { class: 'row3' }, key('channeldown', 'CH −'), key('input', 'Input'), key('channelup', 'CH +')) : null),
      h('div', {},
        h('div', { class: 'section-title first' }, h('h2', {}, 'Apps'), h('a', { href: '#/apps' }, 'All apps →')),
        h('div', { class: 'apps compact', id: 'android-apps' }, dev.conn === 'ok' ? h('div', { class: 'muted' }, 'Loading apps…') : h('div', { class: 'muted' }, 'Connect the device to see its apps.')))));
  if (dev.conn === 'ok') loadAndroidApps(dev).then((apps) => { const el = $('#android-apps'); if (el) el.replaceChildren(...apps.slice(0, 8).map((a) => androidTile(dev, a))); });
}

const androidAppCache = new Map();
async function loadAndroidApps(dev) {
  const c = androidAppCache.get(dev.id);
  if (c && Date.now() - c.at < 5 * 60_000) return c.apps;
  const { apps } = await api('GET', `/api/android/${dev.id}/apps`);
  androidAppCache.set(dev.id, { at: Date.now(), apps });
  return apps;
}
function androidTile(dev, a) {
  return h('button', { class: 'app-tile', style: { background: a.color, color: a.fg || '#fff' }, title: a.pkg, onclick: () => androidLaunch(dev, a) }, h('span', { class: 'app-name' }, a.label));
}

function renderRemote(main) {
  if (activeBox()?.android) return renderAndroidRemote(main, activeBox());
  const box = activeBox();
  const id = box?.id;
  const key = (k, label, cls = '') => h('button', { class: `rkey ${cls}`, 'aria-label': k, onclick: () => skyKey(id, k) }, label);
  const favs = S.channels.filter((c) => c.fav);
  const onNow = S.favNow.data;
  const t = nowSec();

  main.replaceChildren(
    pageHead('Remote', 'Everything your Sky remote does'),
    boxBanner(box),
    h('div', { class: 'remote-layout' },
      h('div', { class: 'remote' },
        h('div', { class: 'row3' }, key('power', icon('power'), 'power'), key('home', 'Home'), key('i', icon('info'))),
        h('div', { class: 'dpad' },
          h('button', { class: 'up', 'aria-label': 'Up', onclick: () => skyKey(id, 'up') }, icon('up')),
          h('button', { class: 'left', 'aria-label': 'Left', onclick: () => skyKey(id, 'left') }, icon('left')),
          h('button', { class: 'ok', 'aria-label': 'Select', onclick: () => skyKey(id, 'select') }, 'OK'),
          h('button', { class: 'right', 'aria-label': 'Right', onclick: () => skyKey(id, 'right') }, icon('right')),
          h('button', { class: 'down', 'aria-label': 'Down', onclick: () => skyKey(id, 'down') }, icon('down'))),
        h('div', { class: 'row3' }, key('backup', icon('back')), key('channelup', 'CH +'), key('search', icon('search'))),
        h('div', { class: 'row3' }, key('rewind', icon('rewind', 'fill')), key('channeldown', 'CH −'), key('fastforward', icon('ff', 'fill'))),
        h('div', { class: 'row3' }, key('play', icon('play', 'fill')), key('pause', icon('pause', 'fill')), key('record', icon('record', 'fill'), 'power')),
        h('div', { class: 'row3' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, d))),
        h('div', { class: 'row3' }, key('sky', 'Sky'), key('0', '0'), key('stop', icon('stop', 'fill'))),
        h('div', { class: 'colors' }, [['red', '#ef4444'], ['green', '#22c55e'], ['yellow', '#facc15'], ['blue', '#3b82f6']].map(([k, c]) =>
          h('button', { 'aria-label': k, style: { background: c }, onclick: () => skyKey(id, k) })))),
      h('div', {},
        h('div', { class: 'section-title first' }, h('h2', {}, 'Favourite channels'), h('a', { href: '#/guide' }, 'Edit in guide →')),
        favs.length
          ? h('div', { class: 'ch-grid' }, favs.map((c) => {
            const ev = (onNow[c.sid] ?? []).find((e) => e.st <= t && e.st + e.d > t);
            const playing = box?.channel?.sid === c.sid;
            return h('button', { class: `ch-tile ${playing ? 'playing' : ''}`, title: `Watch ${c.name} on ${box?.name ?? 'Sky'}`, onclick: () => watchOn(id, c.sid) },
              h('img', { class: 'logo-tile', src: logoUrl(c.sid), alt: '', loading: 'lazy' }),
              h('span', { class: 'ch-text' }, h('b', {}, `${c.number} ${c.name}`), h('small', {}, ev ? ev.t : ' ')));
          }))
          : h('div', { class: 'card muted' }, 'Star channels in the TV Guide to tune them from here.'),
        h('div', { class: 'section-title' }, h('h2', {}, 'Apps'), h('a', { href: '#/apps' }, 'All apps →')),
        h('div', { class: 'apps compact' }, S.apps.slice(0, 6).map(appTile)))));
  if (!S.apps.length || Date.now() - S.favNow.at > 60_000) {
    Promise.all([loadApps(), favouritesOnNow().catch(() => null)]).then(() => { if (currentPage() === 'remote') renderRemote(main); });
  }
}

async function loadApps() {
  if (!S.apps.length) S.apps = (await api('GET', '/api/sky/apps').catch(() => ({ apps: [] }))).apps;
}

function appTile(a) {
  return h('button', { class: 'app-tile', style: { background: a.color, color: a.fg || '#fff' }, onclick: () => launchApp(activeBoxId(), a) },
    h('span', { class: 'app-name' }, a.title));
}

function deviceRow() {
  const cur = activeBoxId();
  return h('div', { class: 'device-row' }, allDevices().map((d) =>
    h('button', { class: 'device-card', 'aria-pressed': String(d.id === cur), onclick: () => setActiveBox(d.id) },
      h('span', { class: 'dc-top' }, icon(KIND_ICON[d.kind] ?? 'tv'), h('span', { class: `dot ${boxDot(d)}` })),
      h('b', {}, d.name),
      h('small', {}, boxStatusText(d)))));
}

async function renderApps(main) {
  const dev = activeBox();
  const head = pageHead('Apps', 'Choose a device, then an app — it wakes up first if it is asleep');
  if (!dev) { main.replaceChildren(head); return; }
  if (dev.android) {
    const grid = h('div', { class: 'apps' }, dev.conn === 'ok' ? Array.from({ length: 8 }, () => h('div', { class: 'app-tile skeleton' })) : []);
    main.replaceChildren(head, deviceRow(), androidBanner(dev), connectionHelp(dev) ?? '', grid);
    if (dev.conn === 'ok') {
      try { grid.replaceChildren(...(await loadAndroidApps(dev)).map((a) => androidTile(dev, a))); } catch (e) { grid.replaceChildren(h('div', { class: 'card error' }, e.message)); }
    }
    return;
  }
  await loadApps();
  main.replaceChildren(head, deviceRow(), boxBanner(dev), h('div', { class: 'apps' }, S.apps.map(appTile)));
}

// --- lights ---------------------------------------------------------------------------------------------------------
function renderLights(main) {
  if (S.dragging) return;
  const l = S.state?.lights;
  const anyOn = l?.rooms?.some((r) => r.on);
  main.replaceChildren(pageHead('Lights', 'Philips Hue',
    l?.paired && anyOn ? h('button', { class: 'btn', onclick: () => l.rooms.filter((r) => r.on && r.type === 'Room').forEach((r) => hueSet('group', r.id, { on: false })) }, icon('power'), 'All off') : null));
  if (!l?.paired) {
    main.append(h('div', { class: 'card' }, h('h3', {}, 'Connect your Hue bridge'),
      h('p', { class: 'muted' }, 'Open Settings, press the round button on the Hue bridge, then choose "Pair with bridge".'), h('a', { class: 'btn primary', href: '#/settings' }, 'Open Settings')));
    return;
  }
  if (!l.online) { main.append(h('div', { class: 'card error' }, l.error)); return; }
  main.append(h('div', { class: 'grid' }, l.rooms.map((r) => h('div', { class: `card room ${r.on ? 'on' : ''}` },
    h('div', { class: 'room-head' },
      h('div', {}, h('h3', {}, r.name), h('span', {}, `${r.lights.filter((x) => x.on).length} of ${r.lights.length} on${r.on ? ` · ${bri2pct(r.bri)}%` : ''}`)),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: r.on, 'aria-label': `${r.name} on/off`, onchange: (e) => hueSet('group', r.id, { on: e.target.checked }) }), h('span'))),
    h('input', { type: 'range', min: 1, max: 254, value: r.bri ?? 1, 'aria-label': `${r.name} brightness`,
      onpointerdown: () => { S.dragging = true; },
      onchange: (e) => { S.dragging = false; hueSet('group', r.id, { bri: Number(e.target.value) }); } }),
    h('details', {}, h('summary', {}, `${r.lights.length} light${r.lights.length === 1 ? '' : 's'}`),
      r.lights.map((x) => h('div', { class: 'light-row' },
        h('span', {}, x.name, !x.reachable ? h('span', { class: 'muted' }, ' · unreachable') : null),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: x.on, 'aria-label': x.name, onchange: (e) => hueSet('light', x.id, { on: e.target.checked }) }), h('span')))))))));
}

// --- network ----------------------------------------------------------------------------------------------------------
function sparkline(history) {
  const w = 300, ht = 44, n = Math.max(history.length, 2);
  const max = Math.max(20, ...history.filter((v) => v != null));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${ht}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'spark');
  let d = '';
  const pts = [];
  history.forEach((v, i) => {
    const x = (i / (n - 1)) * w;
    if (v == null) {
      const r = document.createElementNS(ns, 'rect');
      [['x', x - 2], ['y', 0], ['width', 4], ['height', ht], ['class', 'gap']].forEach(([k, val]) => r.setAttribute(k, val));
      svg.append(r);
      return;
    }
    const y = ht - 3 - (v / max) * (ht - 8);
    d += `${d && history[i - 1] != null ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    pts.push([x, y]);
  });
  if (pts.length > 1) {
    const area = document.createElementNS(ns, 'path');
    area.setAttribute('d', `M${pts[0][0]},${ht} ${pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} L${pts.at(-1)[0]},${ht}Z`);
    area.setAttribute('class', 'area');
    svg.append(area);
  }
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', d);
  svg.append(p);
  return svg;
}

function renderNetwork(main) {
  const n = S.state?.network;
  if (!n) return;
  const when = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  main.replaceChildren(
    pageHead('Network', 'Live reachability and switch health'),
    h('div', { class: 'grid' }, n.targets.map((t) => h('div', { class: 'card' },
      h('div', { class: 'stat' }, h('div', { class: `ico ${t.up === false ? 'bad' : t.up ? 'ok' : ''}` }, icon('network')),
        h('div', {}, h('b', {}, t.name), h('span', { class: 'num' }, t.up == null ? 'Checking…' : t.up ? `${t.last ?? '–'} ms now · ${t.avg ?? '–'} ms average` : 'Unreachable'))),
      sparkline(t.history)))),
    h('div', { class: 'section-title' }, h('h2', {}, 'Switches')),
    h('div', { class: 'grid' }, !n.ciscoConfigured
      ? h('div', { class: 'card' }, h('h3', {}, 'Switch monitoring is off'), h('p', { class: 'muted' }, 'Add the Cisco telnet password and enable secret in Settings.'), h('a', { class: 'btn', href: '#/settings' }, 'Open Settings'))
      : n.switches.map((s) => h('div', { class: 'card' },
        h('div', { class: 'stat' }, h('div', { class: `ico ${s.ok === false ? 'bad' : s.ok ? 'ok' : ''}` }, icon('switch')),
          h('div', {}, h('b', {}, s.name), h('span', { class: 'num' }, s.ok === false ? s.error : s.tc ? `${s.tc.count} topology changes · last ${s.tc.ago} ago` : 'First check within a minute…'))),
        s.root ? h('p', { class: 'muted num' }, `Spanning-tree root ${s.root}`) : null,
        s.ports ? h('div', { class: 'ports' }, s.ports.map((p) => h('span', { class: `port ${p.status === 'connected' ? 'up' : ''}`, title: `${p.name || 'no description'} · ${p.status} · ${p.speed}` }, p.port))) : null))),
    h('div', { class: 'section-title' }, h('h2', {}, 'Events')),
    h('ul', { class: 'timeline' }, n.events.length
      ? n.events.map((e) => h('li', {}, h('span', { class: `dot ${e.type === 'recovered' ? 'ok' : e.type === 'topology' ? '' : 'bad'}` }), h('time', { datetime: e.ts }, when(e.ts)), h('span', {}, e.msg)))
      : h('li', {}, h('span', { class: 'dot ok' }), h('span', { class: 'muted' }, 'No events yet'))));
}

function heatingTile(hv) {
  const t = hv?.thermostats?.[0];
  return h('a', { class: 'card stat', href: '#/heating' }, h('div', { class: `ico ${t?.heating ? 'heat' : ''}` }, icon('flame')),
    h('div', {}, h('b', {}, !hv?.paired ? 'Heating not connected' : !hv.online ? 'Hive not answering' : t ? `${t.current?.toFixed(1) ?? '–'}° · target ${t.target?.toFixed(1) ?? '–'}°` : 'No thermostat'),
      h('span', {}, !hv?.paired ? 'Pair Hive in Settings' : t ? `${MODE_LABEL[t.mode] ?? t.mode}${t.heating ? ' · heating now' : ''}${hv.boost ? ' · boost on' : ''}` : '')));
}

// --- heating (Hive over HomeKit) -------------------------------------------------------------------------------------------
async function hivePost(action, body, okMsg) {
  try {
    await api('POST', `/api/hive/${action}`, body ?? {});
    if (okMsg) toast(okMsg);
  } catch (e) { toast(e.message); }
  await refresh();
}

const MODE_LABEL = { off: 'Off', schedule: 'Schedule', manual: 'Manual' };
// thermostat id -> { value, timer, sentAt }: what you set, shown until Hive reports it (its API lags a few seconds)
const pendingTarget = new Map();
const PENDING_MS = 90_000;
function shownTarget(t) {
  const p = pendingTarget.get(t.id);
  if (!p) return t.target;
  if (p.sentAt && (t.target === p.value || Date.now() - p.sentAt > PENDING_MS)) { pendingTarget.delete(t.id); return t.target; }
  return p.value;
}

// The heating card is drawn as the Hive thermostat itself: a 270° ring filled up to the target, with a marker
// for the room temperature, the room temperature in the middle and − / + in the gap at the bottom.
const DIAL = { lo: 10, hi: 28, r: 82, c: 100 };
const fmtTemp = (v) => (v == null ? '–' : `${Number(v).toFixed(1).replace(/\.0$/, '')}°`);
const svgEl = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids);
  return el;
};
const dialAngle = (temp) => 135 + 270 * Math.max(0, Math.min(1, (temp - DIAL.lo) / (DIAL.hi - DIAL.lo)));
const dialPoint = (deg) => [DIAL.c + DIAL.r * Math.cos((deg * Math.PI) / 180), DIAL.c + DIAL.r * Math.sin((deg * Math.PI) / 180)];
function dialArc(from, to) {
  const [x0, y0] = dialPoint(from);
  const [x1, y1] = dialPoint(Math.max(from + 0.01, to));
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${DIAL.r} ${DIAL.r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function heatState(t) {
  if (t.mode === 'off') return { key: 'off', label: 'Off' };
  return t.heating ? { key: 'heating', label: 'Heating now' } : { key: 'idle', label: 'Idle' };
}

function thermostatCard(t, boost) {
  const shown = shownTarget(t);
  const nudge = (delta) => {
    // always count from what's on screen, never from a value Hive hasn't caught up with yet
    const cur = shownTarget(t) ?? 20;
    const value = Number(Math.min(t.max, Math.max(t.min, Math.round((cur + delta) * 2) / 2)).toFixed(1)); // half-degree steps
    clearTimeout(pendingTarget.get(t.id)?.timer);
    const entry = { value, sentAt: null };
    // during a boost, change the boost's temperature and keep its time left (a plain set could end the boost)
    entry.timer = setTimeout(async () => {
      entry.sentAt = Date.now();
      if (boosting) await hivePost('boost', { id: t.id, minutes: minsLeft || 30, target: value }, `Boosting to ${fmtTemp(value)}`);
      else await hivePost('set', { id: t.id, target: value }, `${t.name} set to ${fmtTemp(value)}`);
    }, 900);
    pendingTarget.set(t.id, entry);
    rerender();
  };
  // Hive account: Hive runs the boost itself (t.boosting / t.boostMins); HomeKit: our own timed boost
  const boosting = t.boosting ?? Boolean(boost && boost.thermostat === t.id);
  const minsLeft = t.boostMins ?? (boosting && boost ? Math.max(0, Math.round((boost.until - Date.now()) / 60_000)) : 0);
  const state = heatState(t);
  const off = t.mode === 'off';
  const fmt = fmtTemp;

  const ring = svgEl('svg', { class: 'dial-ring', viewBox: '0 0 200 200', 'aria-hidden': 'true' },
    svgEl('path', { class: 'dial-track', d: dialArc(135, 405) }),
    off || shown == null ? '' : svgEl('path', { class: 'dial-fill', d: dialArc(135, dialAngle(shown)) }),
    t.current == null ? '' : (() => { const [x, y] = dialPoint(dialAngle(t.current)); return svgEl('circle', { class: 'dial-now', cx: x.toFixed(2), cy: y.toFixed(2), r: 6 }); })());

  return h('div', { class: `card thermo ${state.key}` },
    h('div', { class: 'thermo-head' },
      h('h3', {}, t.name),
      h('span', { class: `heat-pill ${state.key}` }, state.key === 'heating' ? icon('flame') : null, state.label)),
    h('div', { class: 'dial', role: 'group', 'aria-label': `${t.name}: ${fmt(t.current)} now, set to ${fmt(shown)}` },
      ring,
      h('div', { class: 'dial-centre' },
        h('b', { class: 'num' }, fmt(t.current)),
        h('span', {}, off ? 'Heating is off' : `${boosting ? 'Boosting to' : state.key === 'heating' ? 'Heating to' : 'Set to'} ${fmt(shown)}`)),
      h('button', { class: 'dial-btn minus', 'aria-label': `Lower to ${fmt((shown ?? 20) - 0.5)}`, disabled: off, onclick: () => nudge(-0.5) }, icon('minus')),
      h('button', { class: 'dial-btn plus', 'aria-label': `Raise to ${fmt((shown ?? 20) + 0.5)}`, disabled: off, onclick: () => nudge(0.5) }, icon('plus'))),
    h('div', { class: 'seg thermo-modes', role: 'group', 'aria-label': 'Heating mode' },
      ['schedule', 'manual', 'off'].filter((m) => t.modes.includes(m)).map((m) =>
        h('button', { 'aria-pressed': String(t.mode === m), onclick: () => hivePost('set', { id: t.id, mode: m }, `${t.name}: ${MODE_LABEL[m]}`) }, MODE_LABEL[m]))),
    // during a boost: what's happening and Cancel; − / + change its temperature, Extend adds time
    boosting ? h('div', { class: 'boost-on' }, icon('flame'), h('span', {}, minsLeft ? `Boosting to ${fmt(t.target)}, ${minsLeft} min left` : `Boosting to ${fmt(t.target)}`),
      h('button', { class: 'btn', onclick: () => hivePost('cancel-boost', { id: t.id }, 'Boost cancelled') }, 'Cancel')) : null,
    boosting
      ? h('div', { class: 'boost-row two' }, h('span', {}, 'Extend'),
        [[30, '+30 min'], [60, '+1 hour']].map(([mins, label]) =>
          h('button', { class: 'btn', onclick: () => hivePost('boost', { id: t.id, minutes: Math.min(360, (minsLeft || 0) + mins), target: shown }, `Boost extended by ${label.slice(1)}`) }, label)))
      : h('div', { class: 'boost-row' }, h('span', {}, 'Boost'),
        [[30, '30 min'], [60, '1 hour'], [120, '2 hours']].map(([mins, label]) =>
          h('button', { class: 'btn', onclick: () => hivePost('boost', { id: t.id, minutes: mins, target: Math.max(21, Math.min(t.max, (t.target ?? 20) + 1)) }, `Boost for ${label}`) }, label))));
}

function hotWaterCard(w) {
  const label = { schedule: 'Schedule', on: 'On', off: 'Off' };
  const current = w.boosting ? 'boost' : w.mode === 'manual' ? 'on' : w.mode;
  const state = w.on ? { key: 'heating', label: 'Heating water' } : { key: w.mode === 'off' ? 'off' : 'idle', label: w.mode === 'off' ? 'Off' : 'Not heating' };
  return h('div', { class: `card thermo water ${state.key}` },
    h('div', { class: 'thermo-head' },
      h('h3', {}, w.name),
      h('span', { class: `heat-pill ${state.key}` }, state.key === 'heating' ? icon('flame') : null, state.label)),
    h('div', { class: 'seg thermo-modes', role: 'group', 'aria-label': 'Hot water mode' },
      ['schedule', 'on', 'off'].map((m) => h('button', { 'aria-pressed': String(current === m), onclick: () => hivePost('hotwater', { id: w.id, mode: m }, `${w.name}: ${label[m]}`) }, label[m]))),
    w.boosting ? h('div', { class: 'boost-on' }, icon('flame'), h('span', {}, w.boostMins ? `Boosting, ${w.boostMins} min left` : 'Boosting'),
      h('button', { class: 'btn', onclick: () => hivePost('hotwater', { id: w.id, mode: 'schedule' }, 'Hot water boost cancelled') }, 'Cancel')) : null,
    w.boosting
      ? h('div', { class: 'boost-row two' }, h('span', {}, 'Extend'),
        [[30, '+30 min'], [60, '+1 hour']].map(([mins, l]) => h('button', { class: 'btn', onclick: () => hivePost('hotwater-boost', { id: w.id, minutes: Math.min(240, (w.boostMins || 0) + mins) }, `Hot water boost extended by ${l.slice(1)}`) }, l)))
      : h('div', { class: 'boost-row two' }, h('span', {}, 'Boost'),
        [[30, '30 min'], [60, '1 hour']].map(([mins, l]) => h('button', { class: 'btn', onclick: () => hivePost('hotwater-boost', { id: w.id, minutes: mins }, `Hot water boost for ${l}`) }, l))));
}

function renderHeating(main) {
  const hv = S.state?.hive;
  const head = pageHead('Heating', hv?.source === 'cloud' ? `Signed in to Hive as ${hv.account ?? 'your Hive account'}` : 'Hive hub on your network (HomeKit)');
  if (!hv?.paired) {
    main.replaceChildren(head, h('div', { class: 'card' }, h('h3', {}, 'Connect your Hive hub'),
      h('p', { class: 'muted' }, 'Go to Settings → Hive heating and sign in with your Hive account (the same email and password as the Hive app).'),
      h('a', { class: 'btn primary', href: '#/settings' }, 'Open Settings')));
    return;
  }
  if (!hv.online) {
    main.replaceChildren(head, h('div', { class: 'card notice' }, h('h3', {}, 'Hive hub not answering'), h('p', { class: 'muted' }, hv.error ?? `Trying ${hv.hub}…`)));
    return;
  }
  main.replaceChildren(head,
    h('div', { class: 'grid thermo-grid' }, (hv.thermostats ?? []).map((t) => thermostatCard(t, hv.boost)), (hv.hotwater ?? []).map(hotWaterCard)),
    (hv.switches ?? []).length ? h('div', { class: 'section-title' }, h('h2', {}, 'Switches')) : '',
    (hv.switches ?? []).length ? h('div', { class: 'grid' }, hv.switches.map((w) => h('div', { class: 'card toggle-row' }, h('b', {}, w.name),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: w.on, 'aria-label': w.name, onchange: (e) => hivePost('switch', { id: w.id, on: e.target.checked }) }), h('span'))))) : '');
}

function hiveAccountSection(hv) {
  const msg = h('p', { class: 'desc', role: 'status' });
  if (hv.source === 'cloud') {
    return h('div', {}, h('p', { class: 'desc' }, `Signed in to Hive as ${hv.account}. Your password is not stored — only a sign-in token.`),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/heating' }, icon('flame'), 'Open Heating'),
        h('button', { type: 'button', class: 'btn ghost remove', onclick: async () => {
          if (!(await confirmSheet('Sign out of Hive?', 'Home Control will stop controlling the heating until you sign in again. The Hive app is not affected.', 'Sign out'))) return;
          await hivePost('cloud-signout', {}, 'Signed out of Hive');
          rerender();
        } }, icon('logout'), 'Sign out')));
  }
  const email = h('input', { type: 'email', autocomplete: 'username', placeholder: 'you@example.com', 'aria-label': 'Hive email' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Hive password' });
  const code = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '6-digit code', 'aria-label': 'SMS code' });
  const codeRow = h('div', { class: 'fields', hidden: true }, h('label', { class: 'field' }, 'Code from Hive (SMS)', code));
  const btn = h('button', { type: 'button', class: 'btn primary' }, 'Sign in to Hive');
  let step = 'password';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (step === 'password') {
        msg.textContent = 'Signing in…';
        const r = await api('POST', '/api/hive/cloud-signin', { email: email.value, password: password.value });
        password.value = '';
        if (r.mfa) {
          step = 'code';
          codeRow.hidden = false;
          btn.textContent = 'Confirm code';
          msg.textContent = `Hive has sent a code${r.destination ? ` to ${r.destination}` : ''}. Enter it below.`;
          code.focus();
        } else { toast('Signed in to Hive'); await refresh(); location.hash = '#/heating'; }
      } else {
        msg.textContent = 'Checking the code…';
        await api('POST', '/api/hive/cloud-code', { code: code.value });
        toast('Signed in to Hive');
        await refresh();
        location.hash = '#/heating';
      }
    } catch (e) { msg.textContent = e.message; }
    btn.disabled = false;
  });
  return h('div', {},
    h('p', { class: 'desc' }, 'Sign in with the same email and password as the Hive app. Hive may text you a code. Your password is used once and not stored.'),
    h('div', { class: 'fields' }, h('label', { class: 'field' }, 'Hive email', email), h('label', { class: 'field' }, 'Hive password', password)),
    codeRow, h('div', { class: 'row' }, btn), msg);
}

function hiveSettingsCard() {
  const hv = S.state?.hive ?? {};
  if (hv.source === 'cloud' || !hv.paired) {
    return h('div', { class: 'card' }, h('h3', {}, 'Hive heating'), hiveAccountSection(hv),
      hv.source === 'cloud' ? null : h('details', {}, h('summary', {}, 'Advanced: pair locally over HomeKit (only hubs that show a HomeKit code)'), hiveHomeKitSection(hv)));
  }
  return h('div', { class: 'card' }, h('h3', {}, 'Hive heating'), hiveHomeKitSection(hv));
}

function hiveHomeKitSection(hv) {
  const msg = h('p', { class: 'desc', role: 'status' }, hv.paired ? `Paired with the Hive hub at ${hv.hub}.` : 'Not paired. Enter the 8-digit HomeKit code from the Hive hub (on the hub or its box).');
  const code = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', placeholder: '123-45-678', 'aria-label': 'HomeKit code' });
  const ip = h('input', { value: hv.hub ? hv.hub.split(':')[0] : '', placeholder: 'Hive hub IP address', inputmode: 'decimal', 'aria-label': 'Hive hub IP address' });
  return h('div', {}, msg,
    hv.paired
      ? h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/heating' }, icon('flame'), 'Open Heating'),
        h('button', { type: 'button', class: 'btn ghost remove', onclick: async () => {
          if (!(await confirmSheet('Unpair the Hive hub?', 'Home Control will stop controlling the heating. You can pair again with the HomeKit code.', 'Unpair'))) return;
          await hivePost('unpair', {}, 'Hive unpaired');
          rerender();
        } }, icon('x'), 'Unpair'))
      : [
        h('div', { class: 'fields' }, h('label', { class: 'field' }, 'HomeKit code', code), h('label', { class: 'field' }, 'Hive hub IP', ip)),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          msg.textContent = 'Pairing with the Hive hub… (a few seconds)';
          try {
            await api('POST', '/api/hive/pair', { code: code.value, ip: ip.value.trim() });
            code.value = '';
            toast('Hive paired');
            await refresh();
            location.hash = '#/heating';
          } catch (err) {
            msg.textContent = err.message;
            btn.disabled = false;
          }
        } }, 'Pair with Hive')),
        h('p', { class: 'desc' }, 'Tip: each wrong code counts against the hub — after several it locks pairing for a while. The code is only used once and is not stored.'),
      ]);
}

// --- settings: device management -----------------------------------------------------------------------------------------
const KIND_LABEL = { androidtv: 'Android TV', shield: 'NVIDIA Shield', firetv: 'Fire TV' };

function confirmSheet(title, text, okLabel) {
  return new Promise((resolve) => {
    const sheet = $('#sheet');
    const done = (v) => { sheet.close(); resolve(v); };
    sheet.replaceChildren(h('div', { class: 'sheet-card' }, h('div', { class: 'sheet-body pad-top' },
      h('h2', {}, title), h('p', { class: 'syn' }, text),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary danger', onclick: () => done(true) }, okLabel), h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel')))));
    sheet.addEventListener('close', () => resolve(false), { once: true });
    sheet.showModal();
  });
}

function removeButton(type, d) {
  return h('button', { type: 'button', class: 'btn ghost remove', 'aria-label': `Remove ${d.name}`, onclick: async () => {
    if (!(await confirmSheet(`Remove ${d.name}?`, 'It disappears from Home Control. Nothing on the device itself changes, and you can add it again later.', 'Remove'))) return;
    try { await api('DELETE', `/api/devices/${type}/${d.id}`); toast(`${d.name} removed`); await refresh(); rerender(); } catch (e) { toast(e.message); }
  } }, icon('x'), 'Remove');
}

async function addDevice(body) {
  await api('POST', '/api/devices', body);
  toast(`${body.name} added`);
  S.favNow.at = 0;
  await refresh();
  rerender();
}

function addDeviceCard() {
  const msg = h('span', { class: 'muted', role: 'status' });
  const type = h('select', { 'aria-label': 'Device type' },
    h('option', { value: 'sky' }, 'Sky Q box'),
    h('option', { value: 'android:androidtv' }, 'Android TV'),
    h('option', { value: 'android:shield' }, 'NVIDIA Shield'),
    h('option', { value: 'android:firetv' }, 'Fire TV / Fire TV Stick'),
    h('option', { value: 'hive', disabled: true }, 'Hive heating — pair it in the Hive heating card above'));
  const name = h('input', { placeholder: 'e.g. Kitchen TV', 'aria-label': 'Name' });
  const ip = h('input', { placeholder: 'Device IP address', inputmode: 'decimal', 'aria-label': 'IP address' });
  const found = h('div', { class: 'found' });
  const submit = async () => {
    const [t, kind] = type.value.split(':');
    msg.textContent = '';
    try { await addDevice({ type: t, kind, name: name.value, ip: ip.value.trim() }); } catch (e) { msg.textContent = e.message; }
  };
  const find = async (btn) => {
    btn.disabled = true;
    found.replaceChildren(h('p', { class: 'muted' }, 'Looking for Sky boxes and Android / Fire devices… (about 10 seconds)'));
    try {
      const { found: list } = await api('GET', '/api/devices/discover');
      found.replaceChildren(...(list.length ? list.map((f) => h('div', { class: 'found-row' },
        h('div', {}, h('b', {}, f.name), h('div', { class: 'muted' }, `${f.ip} · ${f.type === 'sky' ? 'Sky Q' : KIND_LABEL[f.kind]} · ${f.note}`)),
        // Fill the form rather than adding straight away: the device type is a best guess, so it can be corrected first
        h('button', { type: 'button', class: 'btn', onclick: () => {
          type.value = f.type === 'sky' ? 'sky' : `android:${f.kind}`;
          name.value = f.name;
          ip.value = f.ip;
          msg.textContent = 'Check the type and name, then press Add device.';
          name.focus();
        } }, icon('plus'), 'Use')))
        : [h('p', { class: 'muted' }, 'Nothing new found — everything on the network is already added.')]));
    } catch (e) {
      found.replaceChildren(h('p', { class: 'error' }, e.message));
    }
    btn.disabled = false;
  };
  return h('div', { class: 'card' }, h('h3', {}, 'Add a device'),
    h('p', { class: 'desc' }, 'Add a Sky Q box or an Android TV, Shield or Fire TV by its IP address — or let Home Control look for them.'),
    h('div', { class: 'fields' },
      h('label', { class: 'field' }, 'Type', type),
      h('label', { class: 'field' }, 'Name', name),
      h('label', { class: 'field' }, 'IP address', ip)),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn primary', onclick: submit }, icon('plus'), 'Add device'),
      h('button', { type: 'button', class: 'btn', onclick: (e) => find(e.currentTarget) }, icon('search'), 'Find devices on the network'),
      msg),
    found);
}

function hueLightsCard(s) {
  if (!s.hue.paired) return null;
  const lights = [...new Map((S.state?.lights?.rooms ?? []).flatMap((r) => r.lights).map((l) => [l.id, l])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const status = h('p', { class: 'muted', role: 'status' });
  const serials = h('input', { placeholder: 'Optional: serial numbers, e.g. 1A2B3C, 4D5E6F', 'aria-label': 'Bulb serial numbers' });
  const search = async (btn) => {
    btn.disabled = true;
    try {
      await api('POST', '/api/hue/search', { serials: serials.value.split(/[\s,]+/).filter(Boolean) });
      status.textContent = 'Searching for new lights… make sure new bulbs are powered on.';
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const n = await api('GET', '/api/hue/new');
        status.textContent = `${n.active ? 'Searching…' : 'Search finished.'} ${n.found.length ? `Found: ${n.found.map((f) => f.name).join(', ')}` : 'No new lights yet.'}`;
        if (!n.active) break;
      }
      await refresh();
    } catch (e) { status.textContent = e.message; }
    btn.disabled = false;
  };
  return h('div', { class: 'card' }, h('h3', {}, 'Lights'),
    h('p', { class: 'desc' }, 'Add new Hue bulbs to the bridge, or rename existing lights. New lights then appear on the Lights page (add them to a room in the Hue app).'),
    h('div', { class: 'fields' }, h('label', { class: 'field' }, 'Bulb serials (only if a normal search misses them)', serials)),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: (e) => search(e.currentTarget) }, icon('search'), 'Search for new lights')),
    status,
    lights.length ? h('details', {}, h('summary', {}, `Rename lights (${lights.length})`),
      lights.map((l) => {
        const input = h('input', { value: l.name, 'aria-label': `Name for ${l.name}` });
        return h('div', { class: 'light-row' }, input,
          h('button', { type: 'button', class: 'btn', onclick: async () => {
            try { await api('POST', `/api/hue/light/${l.id}/name`, { name: input.value }); toast(`Renamed to ${input.value.trim()}`); refresh(); } catch (e) { toast(e.message); }
          } }, 'Save'));
      })) : null);
}

// --- settings ------------------------------------------------------------------------------------------------------------
async function renderSettings(main) {
  const s = await api('GET', '/api/settings');
  const msg = h('span', { class: 'muted', role: 'status' });
  const pairMsg = h('p', { class: 'desc' }, s.hue.paired ? 'Paired — lights are available.' : 'Press the round button on the bridge, then pair within 30 seconds.');
  const form = h('form', { class: 'settings' },
    h('div', { class: 'card' }, h('h3', {}, 'Philips Hue'), pairMsg,
      h('div', { class: 'fields' }, h('label', { class: 'field' }, 'Bridge IP', h('input', { name: 'hue.ip', value: s.hue.ip ?? '', placeholder: 'Hue bridge IP address', inputmode: 'decimal' }))),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: async () => {
        pairMsg.textContent = 'Pairing…';
        try { const r = await api('POST', '/api/hue/pair'); pairMsg.textContent = r.ok ? 'Paired — lights are available.' : r.error; if (r.ok) refresh(); } catch (e) { pairMsg.textContent = e.message; }
      } }, s.hue.paired ? 'Pair again' : 'Pair with bridge'))),
    hueLightsCard(s),
    hiveSettingsCard(),
    ringSettingsCard(),
    yaleSettingsCard(),
    h('div', { class: 'card' }, h('h3', {}, 'Sky Q boxes'), h('p', { class: 'desc' }, 'Names appear on the Home page and remote.'),
      s.sky.map((b) => h('div', { class: 'fields dev-row' },
        h('label', { class: 'field' }, 'Name', h('input', { name: `sky.${b.id}.name`, value: b.name })),
        h('label', { class: 'field' }, 'IP address', h('input', { name: `sky.${b.id}.ip`, value: b.ip, inputmode: 'decimal' })),
        removeButton('sky', b)))),
    h('div', { class: 'card' }, h('h3', {}, 'Android TV, Shield & Fire TV'), h('p', { class: 'desc' }, 'Controlled over ADB. Each device asks once to allow this server.'),
      (s.android ?? []).map((d) => h('div', { class: 'fields dev-row' },
        h('label', { class: 'field' }, `Name · ${KIND_LABEL[d.kind] ?? 'Android'}`, h('input', { name: `android.${d.id}.name`, value: d.name })),
        h('label', { class: 'field' }, 'IP address', h('input', { name: `android.${d.id}.ip`, value: d.ip, inputmode: 'decimal' })),
        removeButton('android', d)))),
    camerasSettingsCard(s.cameras ?? []),
    (s.smarttv ?? []).length ? h('div', { class: 'card' }, h('h3', {}, 'Other smart TVs'), h('p', { class: 'desc' }, 'No remote over the network: volume, mute and YouTube / Netflix only.'),
      s.smarttv.map((d) => h('div', { class: 'fields' },
        h('label', { class: 'field' }, 'Name', h('input', { name: `smarttv.${d.id}.name`, value: d.name })),
        h('label', { class: 'field' }, 'IP address', h('input', { name: `smarttv.${d.id}.ip`, value: d.ip, inputmode: 'decimal' }))))) : null,
    addDeviceCard(),
    h('div', { class: 'card' }, h('h3', {}, 'Appearance'), h('p', { class: 'desc' }, 'Saved on this device. Auto follows your phone or computer.'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Theme' }, Object.entries(THEMES).map(([k, v]) =>
        h('button', { type: 'button', 'aria-pressed': String(themePref() === k), onclick: (e) => {
          setTheme(k);
          e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        } }, icon(v.icon), v.label)))),
    h('div', { class: 'card' }, h('h3', {}, 'TV Guide'),
      h('div', { class: 'toggle-row' }, h('span', {}, 'Show adult channels'),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', name: 'showAdult', checked: s.showAdult }), h('span')))),
    h('div', { class: 'card' }, h('h3', {}, 'Cisco switches'), h('p', { class: 'desc' }, `Read-only monitoring. Password ${s.cisco.passwordSet ? 'set' : 'not set'} · enable secret ${s.cisco.enableSet ? 'set' : 'not set'} — never shown.`),
      h('div', { class: 'fields' }, s.switches.map((sw) => h('label', { class: 'field' }, `${sw.name} IP`, h('input', { name: `switch.${sw.id}.ip`, value: sw.ip, inputmode: 'decimal' })))),
      h('div', { class: 'fields' },
        h('label', { class: 'field' }, 'Telnet password', h('input', { name: 'cisco.password', type: 'password', autocomplete: 'off', placeholder: s.cisco.passwordSet ? 'unchanged' : '' })),
        h('label', { class: 'field' }, 'Enable secret', h('input', { name: 'cisco.enable', type: 'password', autocomplete: 'off', placeholder: s.cisco.enableSet ? 'unchanged' : '' })))),
    h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn primary' }, 'Save settings'), msg),
    h('div', { class: 'card toggle-row' }, h('span', {}, 'Signed in on this device'),
      h('button', { type: 'button', class: 'btn', onclick: async () => { await api('POST', '/api/logout'); showAuth(false); } }, icon('logout'), 'Sign out')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const body = {
      hue: { ip: f['hue.ip'].value.trim() },
      sky: s.sky.map((b) => ({ id: b.id, name: f[`sky.${b.id}.name`].value, ip: f[`sky.${b.id}.ip`].value.trim() })),
      android: (s.android ?? []).map((d) => ({ id: d.id, name: f[`android.${d.id}.name`].value, ip: f[`android.${d.id}.ip`].value.trim() })),
      cameras: (s.cameras ?? []).map((c) => ({ id: c.id, name: f[`camera.${c.id}.name`].value, url: f[`camera.${c.id}.url`].value.trim() })),
      smarttv: (s.smarttv ?? []).map((d) => ({ id: d.id, name: f[`smarttv.${d.id}.name`].value, ip: f[`smarttv.${d.id}.ip`].value.trim() })),
      switches: s.switches.map((sw) => ({ id: sw.id, ip: f[`switch.${sw.id}.ip`].value.trim() })),
      cisco: { password: f['cisco.password'].value, enable: f['cisco.enable'].value },
      showAdult: f.showAdult.checked,
    };
    try {
      await api('POST', '/api/settings', body);
      msg.textContent = 'Saved.';
      if (body.showAdult !== s.showAdult) await loadChannels();
      setTimeout(() => rerender(), 800);
    } catch (err) {
      msg.textContent = err.message;
    }
  });
  main.replaceChildren(pageHead('Settings', 'Devices and account'), form);
}

// --- render loop -----------------------------------------------------------------------------------------------------------
const RENDER = { cameras: renderCameras, wall: renderWall, routines: renderRoutines, heating: renderHeating, home: renderHome, guide: renderGuide, remote: renderRemote, apps: renderApps, lights: renderLights, network: renderNetwork, settings: renderSettings };
const LIVE = new Set(['home', 'remote', 'apps', 'heating', 'lights', 'network', 'routines', 'wall', 'cameras']); // pages re-rendered by polling

function rerender() {
  const page = currentPage();
  markNav(page);
  document.body.classList.toggle('wall-mode', page === 'wall');
  if (page !== 'wall') keepAwake(false);
  const main = $('#main');
  Promise.resolve(RENDER[page](main)).catch((e) => toast(e.message));
}

function updateChrome() {
  const now = new Date();
  document.querySelector('.wall-clock')?.replaceChildren(...wallClock());
  $('#clock').replaceChildren(now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    h('small', {}, now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })));
  const n = S.state?.network;
  if (n) {
    const down = n.targets.filter((t) => t.up === false);
    $('#net-chip').replaceChildren(h('span', { class: `dot ${down.length ? 'bad' : 'ok'}` }), down.length ? `${down[0].name} down` : 'Network healthy');
  }
}

let pollTimer = null;
let loadedVersion = null;
async function refresh() {
  try {
    S.state = await api('GET', '/api/state');
    // A new version was deployed since this page loaded: reload to pick it up (unless a dialog is open)
    if (S.state.version) {
      if (!loadedVersion) loadedVersion = S.state.version;
      else if (S.state.version !== loadedVersion && !$('#sheet').open && !S.dragging) { location.reload(); return; }
    }
    updateChrome();
    renderBoxPicker();
    const page = currentPage();
    if (LIVE.has(page) && !$('#sheet').open && !(page === 'lights' && S.dragging)) rerender();
  } catch (e) {
    if (e.message !== 'Not logged in') toast(`Can't reach the server: ${e.message}`);
  }
}
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

async function boot() {
  $('#auth').hidden = true;
  $('#shell').hidden = false;
  buildNav();
  setTheme(themePref());
  await Promise.all([refresh(), loadChannels().catch(() => toast('Channel list unavailable — is the Sky box on the network?'))]);
  rerender();
  stopPolling();
  pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, 6000);
}

window.addEventListener('hashchange', () => { $('#main').scrollTo?.(0, 0); window.scrollTo(0, 0); rerender(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && pollTimer) refresh(); });
setInterval(updateChrome, 15_000);

(async () => {
  const s = await api('GET', '/api/session');
  if (s.authed) boot(); else showAuth(s.setup);
})();
