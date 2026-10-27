// Minimal HomeKit (HAP over IP) controller: pair-setup with the accessory's setup code (SRP-6a, 3072-bit,
// SHA-512), pair-verify (X25519 + Ed25519), an encrypted session (ChaCha20-Poly1305), and JSON
// /accessories + /characteristics requests. Node built-ins only.
import {
  createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman,
  generateKeyPairSync, hkdfSync, randomBytes, randomUUID, sign, verify,
} from 'node:crypto';
import net from 'node:net';

// --- TLV8 -----------------------------------------------------------------------------------
export const T = { method: 0, identifier: 1, salt: 2, publicKey: 3, proof: 4, encrypted: 5, state: 6, error: 7, retryDelay: 8, signature: 10 };
const ERRORS = { 1: 'unknown error', 2: 'wrong setup code', 3: 'too many attempts — wait and try again', 4: 'unknown peer', 5: 'already paired with another controller', 6: 'busy — another pairing is in progress', 7: 'too many attempts — the hub is locked for a while' };

export function tlvEncode(items) {
  const parts = [];
  for (const [type, value] of items) {
    const v = Buffer.isBuffer(value) ? value : typeof value === 'number' ? Buffer.from([value]) : Buffer.from(value);
    if (!v.length) { parts.push(Buffer.from([type, 0])); continue; }
    for (let i = 0; i < v.length; i += 255) {
      const chunk = v.subarray(i, i + 255);
      parts.push(Buffer.from([type, chunk.length]), chunk);
    }
  }
  return Buffer.concat(parts);
}

export function tlvDecode(buf) {
  const out = {};
  let last = null;
  for (let i = 0; i < buf.length;) {
    const type = buf[i], len = buf[i + 1];
    const v = buf.subarray(i + 2, i + 2 + len);
    out[type] = last === type && out[type] ? Buffer.concat([out[type], v]) : Buffer.from(v);
    last = type;
    i += 2 + len;
  }
  return out;
}

// --- crypto helpers ---------------------------------------------------------------------------
const N = BigInt('0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF');
const G = 5n;
const N_BYTES = 384;
const H = (...bufs) => createHash('sha512').update(Buffer.concat(bufs)).digest();
const toBig = (buf) => BigInt(`0x${buf.toString('hex') || '0'}`);
function toBuf(n, pad = 0) {
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const b = Buffer.from(hex, 'hex');
  return pad && b.length < pad ? Buffer.concat([Buffer.alloc(pad - b.length), b]) : b;
}
function modPow(base, exp, mod) {
  let r = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return r;
}
const hkdf = (ikm, salt, info) => Buffer.from(hkdfSync('sha512', ikm, Buffer.from(salt), Buffer.from(info), 32));
const nonce = (label) => Buffer.concat([Buffer.alloc(4), Buffer.from(label)]); // 12 bytes, e.g. "PS-Msg05"

function seal(key, nonce12, plain, aad) {
  const c = createCipheriv('chacha20-poly1305', key, nonce12, { authTagLength: 16 });
  if (aad) c.setAAD(aad, { plaintextLength: plain.length });
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}
function open(key, nonce12, data, aad) {
  const d = createDecipheriv('chacha20-poly1305', key, nonce12, { authTagLength: 16 });
  if (aad) d.setAAD(aad, { plaintextLength: data.length - 16 });
  d.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
}

const rawPub = (keyObj) => Buffer.from(keyObj.export({ format: 'jwk' }).x, 'base64url');
const edPublic = (raw) => createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(raw).toString('base64url') }, format: 'jwk' });
const xPublic = (raw) => createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: Buffer.from(raw).toString('base64url') }, format: 'jwk' });

// --- HTTP over (optionally encrypted) TCP --------------------------------------------------------
class Connection {
  constructor(sock, host) {
    this.sock = sock;
    this.host = host;
    this.plain = Buffer.alloc(0);
    this.cipher = Buffer.alloc(0);
    this.keys = null; // { read, write, readCount, writeCount }
    this.pending = [];
    this.closed = false;
    sock.on('data', (d) => this.onData(d));
    sock.on('close', () => { this.closed = true; this.pending.splice(0).forEach((p) => p.reject(new Error('HomeKit connection closed'))); });
    sock.on('error', () => {});
  }

  onData(d) {
    if (!this.keys) {
      this.plain = Buffer.concat([this.plain, d]);
    } else {
      this.cipher = Buffer.concat([this.cipher, d]);
      while (this.cipher.length >= 2) {
        const len = this.cipher.readUInt16LE(0);
        if (this.cipher.length < 2 + len + 16) break;
        const aad = this.cipher.subarray(0, 2);
        const frame = this.cipher.subarray(2, 2 + len + 16);
        const n = Buffer.alloc(12);
        n.writeBigUInt64LE(BigInt(this.keys.readCount++), 4);
        try {
          this.plain = Buffer.concat([this.plain, open(this.keys.read, n, frame, aad)]);
        } catch {
          this.sock.destroy();
          return;
        }
        this.cipher = this.cipher.subarray(2 + len + 16);
      }
    }
    this.parse();
  }

  parse() {
    for (;;) {
      const headEnd = this.plain.indexOf('\r\n\r\n');
      if (headEnd < 0) return;
      const head = this.plain.subarray(0, headEnd).toString();
      const [statusLine, ...lines] = head.split('\r\n');
      const headers = Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf(':')).trim().toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
      let rest = this.plain.subarray(headEnd + 4);
      let body;
      if (headers['transfer-encoding']?.toLowerCase() === 'chunked') {
        const chunks = [];
        let p = 0;
        for (;;) {
          const crlf = rest.indexOf('\r\n', p);
          if (crlf < 0) return;
          const size = parseInt(rest.subarray(p, crlf).toString(), 16);
          if (rest.length < crlf + 2 + size + 2) return;
          if (size === 0) { rest = rest.subarray(crlf + 4); break; }
          chunks.push(rest.subarray(crlf + 2, crlf + 2 + size));
          p = crlf + 2 + size + 2;
        }
        body = Buffer.concat(chunks);
      } else {
        const len = Number(headers['content-length'] ?? 0);
        if (rest.length < len) return;
        body = rest.subarray(0, len);
        rest = rest.subarray(len);
      }
      this.plain = rest;
      if (statusLine.startsWith('EVENT/')) continue; // unsolicited notifications are ignored
      const status = Number(statusLine.split(' ')[1]);
      const p = this.pending.shift();
      if (p) p.resolve({ status, headers, body });
    }
  }

  write(buf) {
    if (!this.keys) { this.sock.write(buf); return; }
    for (let i = 0; i < buf.length; i += 1024) {
      const chunk = buf.subarray(i, i + 1024);
      const aad = Buffer.alloc(2);
      aad.writeUInt16LE(chunk.length);
      const n = Buffer.alloc(12);
      n.writeBigUInt64LE(BigInt(this.keys.writeCount++), 4);
      this.sock.write(Buffer.concat([aad, seal(this.keys.write, n, chunk, aad)]));
    }
  }

  request(method, path, body = null, contentType = 'application/hap+json', timeoutMs = 10_000) {
    if (this.closed) return Promise.reject(new Error('HomeKit connection closed'));
    const b = body ? (Buffer.isBuffer(body) ? body : Buffer.from(body)) : Buffer.alloc(0);
    const head = `${method} ${path} HTTP/1.1\r\nHost: ${this.host}\r\n${b.length || method !== 'GET' ? `Content-Type: ${contentType}\r\nContent-Length: ${b.length}\r\n` : ''}\r\n`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.sock.destroy(); reject(new Error('HomeKit request timed out')); }, timeoutMs);
      this.pending.push({ resolve: (r) => { clearTimeout(timer); resolve(r); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.write(Buffer.concat([Buffer.from(head), b]));
    });
  }

  close() { this.sock.destroy(); }
}

function connect(ip, port) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: ip, port });
    const t = setTimeout(() => { sock.destroy(); reject(new Error('Hive hub not reachable')); }, 5000);
    sock.on('connect', () => { clearTimeout(t); sock.setKeepAlive(true, 30_000); resolve(new Connection(sock, `${ip}:${port}`)); });
    sock.on('error', (e) => { clearTimeout(t); reject(new Error(`Hive hub not reachable (${e.code ?? e.message})`)); });
  });
}

async function tlvPost(conn, path, items) {
  const step = `${path === '/pair-setup' ? 'pairing' : 'connection'} step ${items.find(([t]) => t === T.state)?.[1] ?? '?'}`;
  const r = await conn.request('POST', path, tlvEncode(items), 'application/pairing+tlv8', 60_000).catch((e) => {
    if (/closed/.test(e.message) && path === '/pair-setup' && step.endsWith(' 1')) {
      throw new Error('The Hive hub refused to start pairing (it hung up before the code was even sent). It is not accepting new HomeKit pairings right now.');
    }
    if (/closed/.test(e.message) && path === '/pair-setup' && step.endsWith(' 3')) {
      throw new Error('The Hive hub hung up when the code was checked — most likely the code is wrong. Check it and try again (careful: repeated wrong codes lock pairing for a while).');
    }
    throw new Error(`${e.message} (${step})`);
  });
  const t = tlvDecode(r.body);
  if (t[T.error]) throw new Error(`Pairing failed: ${ERRORS[t[T.error][0]] ?? `error ${t[T.error][0]}`}`);
  return t;
}

// --- pair-setup --------------------------------------------------------------------------------
/**
 * Pair with an unpaired accessory using its setup code ("123-45-678").
 * Returns the long-term pairing record to store (keep it secret).
 */
export async function pairSetup(ip, port, setupCode) {
  const code = String(setupCode).replace(/\D/g, '');
  if (code.length !== 8) throw new Error('The HomeKit code has 8 digits, like 123-45-678');
  const pin = `${code.slice(0, 3)}-${code.slice(3, 5)}-${code.slice(5)}`;
  const conn = await connect(ip, port);
  try {
    // M1 -> M2: salt and accessory SRP public key
    const m2 = await tlvPost(conn, '/pair-setup', [[T.state, 1], [T.method, 0]]);
    const salt = m2[T.salt];
    const B = toBig(m2[T.publicKey]);
    // SRP-6a client
    const I = Buffer.from('Pair-Setup');
    const a = toBig(randomBytes(32));
    const A = modPow(G, a, N);
    const Ab = toBuf(A);
    const Bb = toBuf(B);
    const k = toBig(H(toBuf(N), toBuf(G, N_BYTES)));
    const u = toBig(H(toBuf(A, N_BYTES), toBuf(B, N_BYTES)));
    const x = toBig(H(salt, H(I, Buffer.from(`:${pin}`))));
    const base = (((B - ((k * modPow(G, x, N)) % N)) % N) + N) % N;
    const S = modPow(base, a + u * x, N);
    const K = H(toBuf(S));
    const hN = H(toBuf(N));
    const hG = H(toBuf(G));
    const hGroup = Buffer.from(hN.map((byte, i) => byte ^ hG[i]));
    const M1 = H(hGroup, H(I), salt, Ab, Bb, K);
    // M3 -> M4: prove we know the code, check the accessory does too
    const m4 = await tlvPost(conn, '/pair-setup', [[T.state, 3], [T.publicKey, Ab], [T.proof, M1]]);
    if (!m4[T.proof] || !H(Ab, M1, K).equals(m4[T.proof])) throw new Error('Pairing failed: the hub could not be verified');
    // M5 -> M6: exchange long-term Ed25519 keys, encrypted with the SRP session key
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const ltpk = rawPub(publicKey);
    const controllerId = Buffer.from(randomUUID().toUpperCase());
    const encKey = hkdf(K, 'Pair-Setup-Encrypt-Salt', 'Pair-Setup-Encrypt-Info');
    const iosX = hkdf(K, 'Pair-Setup-Controller-Sign-Salt', 'Pair-Setup-Controller-Sign-Info');
    const sig = sign(null, Buffer.concat([iosX, controllerId, ltpk]), privateKey);
    const sub = tlvEncode([[T.identifier, controllerId], [T.publicKey, ltpk], [T.signature, sig]]);
    const m6 = await tlvPost(conn, '/pair-setup', [[T.state, 5], [T.encrypted, seal(encKey, nonce('PS-Msg05'), sub)]]);
    const acc = tlvDecode(open(encKey, nonce('PS-Msg06'), m6[T.encrypted]));
    const accX = hkdf(K, 'Pair-Setup-Accessory-Sign-Salt', 'Pair-Setup-Accessory-Sign-Info');
    const accInfo = Buffer.concat([accX, acc[T.identifier], acc[T.publicKey]]);
    if (!verify(null, accInfo, edPublic(acc[T.publicKey]), acc[T.signature])) throw new Error('Pairing failed: the hub signature did not check out');
    return {
      ip, port,
      controllerId: controllerId.toString(),
      controllerLtsk: privateKey.export({ format: 'pem', type: 'pkcs8' }),
      controllerLtpk: ltpk.toString('hex'),
      accessoryId: acc[T.identifier].toString(),
      accessoryLtpk: acc[T.publicKey].toString('hex'),
    };
  } finally {
    conn.close();
  }
}

// --- pair-verify + encrypted session -------------------------------------------------------------
/** Open an authenticated, encrypted session with a paired accessory. */
export async function session(pairing) {
  const conn = await connect(pairing.ip, pairing.port);
  try {
    const { privateKey: eph, publicKey: ephPub } = generateKeyPairSync('x25519');
    const myCurve = rawPub(ephPub);
    const m2 = await tlvPost(conn, '/pair-verify', [[T.state, 1], [T.publicKey, myCurve]]);
    const accCurve = m2[T.publicKey];
    const shared = diffieHellman({ privateKey: eph, publicKey: xPublic(accCurve) });
    const key = hkdf(shared, 'Pair-Verify-Encrypt-Salt', 'Pair-Verify-Encrypt-Info');
    const sub = tlvDecode(open(key, nonce('PV-Msg02'), m2[T.encrypted]));
    if (sub[T.identifier]?.toString() !== pairing.accessoryId) throw new Error('Unexpected HomeKit accessory');
    const accInfo = Buffer.concat([accCurve, sub[T.identifier], myCurve]);
    if (!verify(null, accInfo, edPublic(Buffer.from(pairing.accessoryLtpk, 'hex')), sub[T.signature])) throw new Error('HomeKit accessory signature did not check out');
    const ltsk = createPrivateKey(pairing.controllerLtsk);
    const myInfo = Buffer.concat([myCurve, Buffer.from(pairing.controllerId), accCurve]);
    const enc = seal(key, nonce('PV-Msg03'), tlvEncode([[T.identifier, Buffer.from(pairing.controllerId)], [T.signature, sign(null, myInfo, ltsk)]]));
    await tlvPost(conn, '/pair-verify', [[T.state, 3], [T.encrypted, enc]]);
    conn.keys = {
      write: hkdf(shared, 'Control-Salt', 'Control-Write-Encryption-Key'),
      read: hkdf(shared, 'Control-Salt', 'Control-Read-Encryption-Key'),
      readCount: 0, writeCount: 0,
    };
    return {
      async get(path) {
        const r = await conn.request('GET', path);
        if (r.status >= 400) throw new Error(`HomeKit ${path}: HTTP ${r.status}`);
        return r.body.length ? JSON.parse(r.body.toString()) : {};
      },
      async put(path, obj) {
        const r = await conn.request('PUT', path, JSON.stringify(obj));
        if (r.status >= 400) throw new Error(`HomeKit write failed: HTTP ${r.status} ${r.body.toString().slice(0, 200)}`);
        return r.status === 204 || !r.body.length ? {} : JSON.parse(r.body.toString());
      },
      /** Remove this controller's pairing from the accessory. */
      async unpair() {
        const r = await conn.request('POST', '/pairings', tlvEncode([[T.state, 1], [T.method, 4], [T.identifier, Buffer.from(pairing.controllerId)]]), 'application/pairing+tlv8');
        return r.status < 400;
      },
      get closed() { return conn.closed; },
      close: () => conn.close(),
    };
  } catch (e) {
    conn.close();
    throw e;
  }
}
