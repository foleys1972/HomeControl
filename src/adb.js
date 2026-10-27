// Minimal ADB-over-TCP client (no adb binary needed): RSA auth + one-shot shell commands.
// The device asks "Allow USB debugging?" the first time this server's key connects.
import { createHash, createPrivateKey, generateKeyPairSync, privateEncrypt, constants } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import * as store from './store.js';

const A_CNXN = 0x4e584e43, A_AUTH = 0x48545541, A_OPEN = 0x4e45504f, A_OKAY = 0x59414b4f, A_CLSE = 0x45534c43, A_WRTE = 0x45545257;
const AUTH_TOKEN = 1, AUTH_SIGNATURE = 2, AUTH_RSAPUBLICKEY = 3;
const VERSION = 0x01000000;
const MAX_DATA = 4096; // old Fire OS adbd only accepts small packets
const SHA1_PREFIX = Buffer.from('3021300906052b0e03021a05000414', 'hex');
// HOME_CONTROL_ADB_KEY lets a local test reuse an existing, already-approved adb key file in place.
const KEY_FILE = () => process.env.HOME_CONTROL_ADB_KEY || path.join(store.DATA_DIR, 'adbkey.pem');

// --- key (generated once, kept in the data dir, mode 600) ----------------------------------
let keyCache = null;

function bigFromB64url(s) {
  return BigInt(`0x${Buffer.from(s, 'base64url').toString('hex')}`);
}

function wordsLE(big, n) {
  const buf = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) { buf.writeUInt32LE(Number(big & 0xffffffffn), i * 4); big >>= 32n; }
  return buf;
}

function androidPublicKey(jwk) {
  // struct RSAPublicKey { u32 len; u32 n0inv; u32 n[64]; u32 rr[64]; u32 exponent; } (2048-bit)
  const n = bigFromB64url(jwk.n);
  const e = Number(bigFromB64url(jwk.e));
  const words = 64;
  const r32 = 1n << 32n;
  // n0inv = -1 / n[0] mod 2^32
  let inv = 1n;
  const n0 = n % r32;
  for (let i = 0; i < 5; i++) inv = (((inv * (2n - n0 * inv)) % r32) + r32) % r32;
  const n0inv = (r32 - inv) % r32;
  const rr = (1n << 4096n) % n;
  const out = Buffer.concat([
    Buffer.from(Uint32Array.of(words).buffer),
    Buffer.from(Uint32Array.of(Number(n0inv)).buffer),
    wordsLE(n, words),
    wordsLE(rr, words),
    Buffer.from(Uint32Array.of(e).buffer),
  ]);
  return Buffer.from(`${out.toString('base64')} home-control@server\0`);
}

function key() {
  if (keyCache) return keyCache;
  let pem;
  if (existsSync(KEY_FILE())) {
    pem = readFileSync(KEY_FILE(), 'utf8');
  } else {
    ({ privateKey: pem } = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }));
    writeFileSync(KEY_FILE(), pem, { mode: 0o600 });
  }
  const priv = createPrivateKey(pem);
  keyCache = { priv, pub: androidPublicKey(priv.export({ format: 'jwk' })) };
  return keyCache;
}

export function keyFingerprint() {
  // Same MD5 fingerprint format Android shows in the "Allow USB debugging?" dialog
  const b64 = key().pub.toString().split(' ')[0];
  return createHash('md5').update(Buffer.from(b64, 'base64')).digest('hex').match(/../g).join(':').toUpperCase();
}

// --- packets -------------------------------------------------------------------------------
function packet(cmd, arg0, arg1, data = Buffer.alloc(0)) {
  const h = Buffer.alloc(24);
  let sum = 0;
  for (const b of data) sum = (sum + b) >>> 0;
  h.writeUInt32LE(cmd, 0); h.writeUInt32LE(arg0 >>> 0, 4); h.writeUInt32LE(arg1 >>> 0, 8);
  h.writeUInt32LE(data.length, 12); h.writeUInt32LE(sum, 16); h.writeUInt32LE((cmd ^ 0xffffffff) >>> 0, 20);
  return Buffer.concat([h, data]);
}

class Conn {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.queue = [];
    this.waiters = [];
    sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.drain(); });
    sock.on('close', () => { this.closed = true; this.waiters.splice(0).forEach((w) => w.reject(new Error('Connection closed'))); });
    sock.on('error', () => {});
  }
  drain() {
    while (this.buf.length >= 24) {
      const len = this.buf.readUInt32LE(12);
      if (this.buf.length < 24 + len) return;
      const msg = { cmd: this.buf.readUInt32LE(0), arg0: this.buf.readUInt32LE(4), arg1: this.buf.readUInt32LE(8), data: this.buf.subarray(24, 24 + len) };
      this.buf = this.buf.subarray(24 + len);
      const w = this.waiters.shift();
      if (w) w.resolve(msg); else this.queue.push(msg);
    }
  }
  read(timeoutMs) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.closed) return Promise.reject(new Error('Connection closed'));
    return new Promise((resolve, reject) => {
      const w = { resolve, reject };
      const t = setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); reject(Object.assign(new Error('Timed out'), { code: 'TIMEOUT' })); }, timeoutMs);
      w.resolve = (m) => { clearTimeout(t); resolve(m); };
      w.reject = (e) => { clearTimeout(t); reject(e); };
      this.waiters.push(w);
    });
  }
  write(cmd, a0, a1, data) { this.sock.write(packet(cmd, a0, a1, data)); }
  close() { this.sock.destroy(); }
}

const pending = new Map(); // ip -> promise of a connection waiting for on-screen approval

function connect(ip, port, { approvalWaitMs, sendPublicKey = true }) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: ip, port });
    const t = setTimeout(() => { sock.destroy(); reject(Object.assign(new Error('Not reachable'), { code: 'OFFLINE' })); }, 3000);
    sock.on('error', (e) => { clearTimeout(t); reject(Object.assign(new Error(e.code === 'ECONNREFUSED' ? 'Debugging is off' : 'Not reachable'), { code: e.code === 'ECONNREFUSED' ? 'CLOSED' : 'OFFLINE' })); });
    sock.on('connect', async () => {
      clearTimeout(t);
      const c = new Conn(sock);
      try {
        c.write(A_CNXN, VERSION, MAX_DATA, Buffer.from('host::\0'));
        let m = await c.read(5000);
        let sentSig = false;
        while (m.cmd === A_AUTH && m.arg0 === AUTH_TOKEN) {
          if (!sentSig) {
            const sig = privateEncrypt({ key: key().priv, padding: constants.RSA_PKCS1_PADDING }, Buffer.concat([SHA1_PREFIX, m.data]));
            c.write(A_AUTH, AUTH_SIGNATURE, 0, sig);
            sentSig = true;
            m = await c.read(5000);
          } else {
            if (!sendPublicKey) throw Object.assign(new Error('Not approved on the TV yet'), { code: 'UNAUTHORISED' });
            c.write(A_AUTH, AUTH_RSAPUBLICKEY, 0, key().pub); // shows "Allow USB debugging?" on the TV
            m = await c.read(approvalWaitMs).catch((e) => { throw e.code === 'TIMEOUT' ? Object.assign(new Error('Waiting for approval on the TV'), { code: 'UNAUTHORISED' }) : e; });
          }
        }
        if (m.cmd !== A_CNXN) throw new Error('Unexpected reply from device');
        resolve(c);
      } catch (e) {
        c.close();
        reject(e);
      }
    });
  });
}

/** Run one shell command and return its output. */
export async function shell(ip, command, { port = 5555, timeoutMs = 10_000 } = {}) {
  if (pending.has(ip)) throw Object.assign(new Error('Waiting for approval on the TV'), { code: 'UNAUTHORISED' });
  // Never pops the approval prompt by itself; that only happens via requestApproval() (the user's "Connect").
  const c = await connect(ip, port, { approvalWaitMs: 0, sendPublicKey: false });
  try {
    const local = 1;
    c.write(A_OPEN, local, 0, Buffer.from(`shell:${command}\0`));
    let out = Buffer.alloc(0);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const m = await c.read(Math.max(500, deadline - Date.now()));
      if (m.cmd === A_OKAY) continue;
      if (m.cmd === A_WRTE) { out = Buffer.concat([out, m.data]); c.write(A_OKAY, local, m.arg0); continue; }
      if (m.cmd === A_CLSE) break;
    }
    return out.toString('utf8').replace(/\r\n/g, '\n');
  } finally {
    c.close();
  }
}

/** Ask the device to trust this server (shows the prompt and waits up to 2 minutes for the user). */
export function requestApproval(ip, port = 5555) {
  if (pending.has(ip)) return pending.get(ip);
  const p = connect(ip, port, { approvalWaitMs: 120_000 }).then((c) => { c.close(); return true; }).finally(() => pending.delete(ip));
  pending.set(ip, p);
  return p;
}

export const isAwaitingApproval = (ip) => pending.has(ip);
