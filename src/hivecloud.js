// Hive via the Hive account (cloud): AWS Cognito SRP sign-in (+ SMS code), token refresh, and the
// beekeeper API the Hive app uses. The password is used once at sign-in and never stored; only the
// refresh token and this server's Cognito device key are kept (data dir, mode 600).
// Hive's user pool tracks devices: a refresh token is bound to the device it was issued to, so we
// register ("remember") this server as a device at sign-in and send its key with every refresh —
// without that, refreshes fail and the sign-in only lasts as long as the first 1-hour token.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import * as store from './store.js';

const POOL_ID = 'eu-west-1_SamNfoWtf'; // from https://sso.hivehome.com (window.HiveSSOPoolId)
const CLIENT_ID = '3rl4i0ajrmtdm8sbre54p9dvd9'; // window.HiveSSOPublicCognitoClientId (no client secret)
const COGNITO = 'https://cognito-idp.eu-west-1.amazonaws.com/';
const API = 'https://beekeeper-uk.hivehome.com/1.0';

// --- Cognito SRP (matches amazon-cognito-identity-js AuthenticationHelper) --------------------
const N_HEX = 'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF';
const N = BigInt(`0x${N_HEX}`);
const G = 2n;

function padHex(n) {
  let h = (typeof n === 'bigint' ? n.toString(16) : n);
  if (h.length % 2) h = `0${h}`;
  else if ('89abcdefABCDEF'.includes(h[0])) h = `00${h}`;
  return h;
}
const hexHash = (hex) => createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
const big = (hex) => BigInt(`0x${hex}`);
function modPow(b, e, m) {
  let r = 1n;
  b %= m;
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}
const K_MULT = big(hexHash(padHex(N) + padHex(G)));

function hkdf(ikm, salt) {
  const prk = createHmac('sha256', salt).update(ikm).digest();
  return createHmac('sha256', prk).update(Buffer.concat([Buffer.from('Caldera Derived Key'), Buffer.from([1])])).digest().subarray(0, 16);
}

/** "Tue Oct 27 16:20:05 UTC 2026" — Cognito's exact format (day of month not zero-padded). */
export function cognitoTimestamp(d = new Date()) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC ${d.getUTCFullYear()}`;
}

/** SRP client. `a` can be injected for testing. */
export function srpClient(aHex = randomBytes(128).toString('hex')) {
  const a = big(aHex);
  const A = modPow(G, a, N);
  return {
    A: A.toString(16),
    claim({ userIdForSrp, password, saltHex, bHex, secretBlock, timestamp }) {
      const B = big(bHex);
      if (B % N === 0n) throw new Error('Bad server value');
      const u = big(hexHash(padHex(A) + padHex(B)));
      const poolName = POOL_ID.split('_')[1];
      const userPassHash = createHash('sha256').update(`${poolName}${userIdForSrp}:${password}`).digest('hex');
      const x = big(hexHash(padHex(saltHex) + userPassHash));
      const base = (((B - ((K_MULT * modPow(G, x, N)) % N)) % N) + N) % N;
      const S = modPow(base, a + u * x, N);
      const key = hkdf(Buffer.from(padHex(S), 'hex'), Buffer.from(padHex(u), 'hex'));
      const msg = Buffer.concat([Buffer.from(poolName), Buffer.from(userIdForSrp), Buffer.from(secretBlock, 'base64'), Buffer.from(timestamp)]);
      return createHmac('sha256', key).update(msg).digest('base64');
    },
  };
}

async function cognito(target, body) {
  const r = await fetch(COGNITO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const type = String(j.__type ?? '').split('#').pop();
    const friendly = {
      NotAuthorizedException: 'Wrong email or password (or the sign-in expired — start again)',
      UserNotFoundException: 'No Hive account with that email',
      CodeMismatchException: 'That SMS code is not right',
      ExpiredCodeException: 'That SMS code has expired — sign in again',
      TooManyRequestsException: 'Too many attempts — wait a few minutes',
      LimitExceededException: 'Too many attempts — wait a few minutes',
    }[type];
    throw new Error(friendly ?? `Hive sign-in failed (${type || r.status}: ${j.message ?? ''})`);
  }
  return j;
}

// --- sign-in flow -------------------------------------------------------------------------------
let pendingMfa = null; // { session, username, challenge, at }

function saveTokens(username, res) {
  const t = res.AuthenticationResult;
  store.update((c) => {
    c.hive = c.hive ?? {};
    const prev = c.hive.cloud?.username === username ? c.hive.cloud : {};
    c.hive.cloud = {
      username,
      refreshToken: t.RefreshToken ?? prev.refreshToken,
      idToken: t.IdToken,
      expires: Date.now() + (t.ExpiresIn ?? 3600) * 1000 - 60_000,
      device: prev.device ?? null,
    };
  });
}

/** Device verifier for ConfirmDevice (matches amazon-cognito-identity-js generateHashDevice). */
export function deviceVerifier(deviceGroupKey, deviceKey, password, saltHex = randomBytes(16).toString('hex')) {
  const salt = padHex(big(saltHex));
  const hashed = createHash('sha256').update(`${deviceGroupKey}${deviceKey}:${password}`).digest('hex');
  const verifier = padHex(modPow(G, big(hexHash(salt + hashed)), N));
  return { Salt: Buffer.from(salt, 'hex').toString('base64'), PasswordVerifier: Buffer.from(verifier, 'hex').toString('base64') };
}

// Register and remember this server as a Hive device, so its refresh token keeps working.
async function rememberDevice(res) {
  const meta = res.AuthenticationResult?.NewDeviceMetadata;
  if (!meta?.DeviceKey) return; // pool not tracking devices: plain refresh works
  const access = res.AuthenticationResult.AccessToken;
  const password = randomBytes(40).toString('base64');
  const confirm = await cognito('ConfirmDevice', {
    AccessToken: access, DeviceKey: meta.DeviceKey, DeviceName: 'Home Control',
    DeviceSecretVerifierConfig: deviceVerifier(meta.DeviceGroupKey, meta.DeviceKey, password),
  });
  if (confirm.UserConfirmationNecessary) {
    await cognito('UpdateDeviceStatus', { AccessToken: access, DeviceKey: meta.DeviceKey, DeviceRememberedStatus: 'remembered' });
  }
  store.update((c) => { c.hive.cloud.device = { key: meta.DeviceKey, groupKey: meta.DeviceGroupKey, password }; });
}

async function completeSignIn(email, res) {
  saveTokens(email, res);
  try { await rememberDevice(res); } catch (e) { console.error(new Date().toISOString(), `hive: device registration failed: ${e.message}`); }
}

export async function signIn(username, password) {
  const email = String(username ?? '').trim();
  if (!email || !password) throw new Error('Enter your Hive email and password');
  const srp = srpClient();
  const init = await cognito('InitiateAuth', {
    AuthFlow: 'USER_SRP_AUTH', ClientId: CLIENT_ID, AuthParameters: { USERNAME: email, SRP_A: srp.A },
  });
  const p = init.ChallengeParameters;
  const timestamp = cognitoTimestamp();
  const signature = srp.claim({ userIdForSrp: p.USER_ID_FOR_SRP, password: String(password), saltHex: p.SALT, bHex: p.SRP_B, secretBlock: p.SECRET_BLOCK, timestamp });
  const res = await cognito('RespondToAuthChallenge', {
    ChallengeName: 'PASSWORD_VERIFIER', ClientId: CLIENT_ID,
    ChallengeResponses: { USERNAME: p.USER_ID_FOR_SRP, PASSWORD_CLAIM_SECRET_BLOCK: p.SECRET_BLOCK, TIMESTAMP: timestamp, PASSWORD_CLAIM_SIGNATURE: signature },
  });
  if (res.AuthenticationResult) { await completeSignIn(email, res); return { ok: true }; }
  if (res.ChallengeName === 'SMS_MFA' || res.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
    pendingMfa = { session: res.Session, username: p.USER_ID_FOR_SRP, email, challenge: res.ChallengeName, at: Date.now() };
    return { mfa: true, destination: res.ChallengeParameters?.CODE_DELIVERY_DESTINATION ?? null };
  }
  throw new Error(`Hive asked for an unsupported sign-in step (${res.ChallengeName})`);
}

export async function verifyCode(code) {
  if (!pendingMfa || Date.now() - pendingMfa.at > 3 * 60_000) { pendingMfa = null; throw new Error('Sign-in expired — enter your email and password again'); }
  const field = pendingMfa.challenge === 'SMS_MFA' ? 'SMS_MFA_CODE' : 'SOFTWARE_TOKEN_MFA_CODE';
  const res = await cognito('RespondToAuthChallenge', {
    ChallengeName: pendingMfa.challenge, ClientId: CLIENT_ID, Session: pendingMfa.session,
    ChallengeResponses: { USERNAME: pendingMfa.username, [field]: String(code).trim() },
  });
  if (!res.AuthenticationResult) throw new Error('Hive did not complete the sign-in');
  const { email } = pendingMfa;
  pendingMfa = null;
  await completeSignIn(email, res);
  return { ok: true };
}

export function signOut() {
  pendingMfa = null;
  store.update((c) => { if (c.hive) delete c.hive.cloud; });
}

export const isSignedIn = () => Boolean(store.get().hive?.cloud?.refreshToken);
export const accountName = () => store.get().hive?.cloud?.username ?? null;

async function idToken() {
  const c = store.get().hive?.cloud;
  if (!c?.refreshToken) throw Object.assign(new Error('Not signed in to Hive'), { code: 'UNPAIRED' });
  if (c.idToken && Date.now() < c.expires) return c.idToken;
  const params = { REFRESH_TOKEN: c.refreshToken, ...(c.device?.key ? { DEVICE_KEY: c.device.key } : {}) };
  const res = await cognito('InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: CLIENT_ID, AuthParameters: params })
    .catch((e) => {
      console.error(new Date().toISOString(), `hive: token refresh failed: ${e.message}`);
      throw Object.assign(new Error(`Hive sign-in has expired — sign in again in Settings (${e.message})`), { code: 'EXPIRED' });
    });
  saveTokens(c.username, res);
  return store.get().hive.cloud.idToken;
}

async function api(method, path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: '*/*', authorization: await idToken() },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 401 && attempt === 0) { store.update((c) => { c.hive.cloud.expires = 0; }); continue; }
    if (!r.ok) throw new Error(`Hive service error (HTTP ${r.status})`);
    return r.status === 204 ? {} : r.json().catch(() => ({}));
  }
  throw new Error('Hive rejected the request');
}

// --- devices -----------------------------------------------------------------------------------
const MODE = { SCHEDULE: 'schedule', MANUAL: 'manual', OFF: 'off', BOOST: 'boost' };
let products = { at: 0, list: [] };

export async function status() {
  const all = await api('GET', '/nodes/all?products=true&devices=true&actions=true');
  products = { at: Date.now(), list: all.products ?? [] };
  const heating = products.list.filter((p) => p.type === 'heating' || p.type === 'trvcontrol').map((p) => ({
    id: p.id, type: p.type, name: p.state?.name ?? 'Heating',
    current: p.props?.temperature ?? null, target: p.state?.target ?? null,
    mode: MODE[p.state?.mode] ?? String(p.state?.mode ?? '').toLowerCase(), heating: Boolean(p.props?.working),
    boostMins: p.state?.mode === 'BOOST' ? (p.props?.boost ?? p.state?.boost ?? null) : null, // props.boost = minutes left
    online: p.props?.online !== false, min: 5, max: 32, step: 0.5, modes: ['schedule', 'manual', 'off'],
  }));
  const hotwater = products.list.filter((p) => p.type === 'hotwater').map((p) => ({
    id: p.id, name: p.state?.name ?? 'Hot water',
    mode: MODE[p.state?.mode] ?? String(p.state?.mode ?? '').toLowerCase(),
    on: p.props?.working ?? p.state?.status === 'ON',
    boostMins: p.state?.mode === 'BOOST' ? (p.props?.boost ?? p.state?.boost ?? null) : null, // props.boost = minutes left
  }));
  return { heating, hotwater };
}

function product(id) {
  const p = products.list.find((x) => x.id === id);
  if (!p) throw new Error('Unknown Hive device — refresh and try again');
  return p;
}

export async function setHeating(id, { target, mode }) {
  const p = product(id);
  const body = {};
  if (mode != null) {
    const m = { schedule: 'SCHEDULE', manual: 'MANUAL', off: 'OFF' }[mode];
    if (!m) throw new Error('Mode must be schedule, manual or off');
    body.mode = m;
  }
  if (target != null) {
    const v = Math.round(Number(target) * 2) / 2;
    if (!(v >= 5 && v <= 32)) throw new Error('Temperature must be between 5° and 32°');
    body.target = v;
  }
  await api('POST', `/nodes/${p.type}/${id}`, body);
}

export async function boostHeating(id, minutes, target) {
  const p = product(id);
  const mins = Math.max(15, Math.min(360, Math.round((Number(minutes) || 60) / 5) * 5));
  const t = Math.round((Number(target) || Math.max(21, (p.state?.target ?? 20) + 1)) * 2) / 2;
  await api('POST', `/nodes/${p.type}/${id}`, { mode: 'BOOST', boost: mins, target: t });
}

export async function cancelBoost(id) {
  const p = product(id);
  const prev = p.props?.previous?.mode ?? 'SCHEDULE';
  await api('POST', `/nodes/${p.type}/${id}`, { mode: prev === 'BOOST' ? 'SCHEDULE' : prev });
}

export async function setHotWater(id, mode) {
  const p = product(id);
  const m = { schedule: 'SCHEDULE', on: 'ON', off: 'OFF' }[mode];
  if (!m) throw new Error('Hot water mode must be schedule, on or off');
  // Hive models "on" as manual mode with status ON
  await api('POST', `/nodes/hotwater/${p.id}`, m === 'ON' ? { mode: 'MANUAL', status: 'ON' } : m === 'OFF' ? { mode: 'OFF' } : { mode: 'SCHEDULE' });
}

export async function boostHotWater(id, minutes) {
  const p = product(id);
  const mins = Math.max(15, Math.min(240, Math.round((Number(minutes) || 60) / 5) * 5));
  await api('POST', `/nodes/hotwater/${p.id}`, { mode: 'BOOST', boost: mins });
}
