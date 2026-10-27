// Minimal telnet client for the Cisco 3560s: line password + enable, read-only `show` commands only.
import net from 'node:net';

const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;
const SAFE_PIPES = new Set(['include', 'i', 'exclude', 'e', 'begin', 'b', 'section', 's', 'count']);

export function isSafeShow(cmd) {
  const c = String(cmd).trim();
  if (!/^show\s+\S/i.test(c) || /^show\s+tech/i.test(c) || /[;\r\n]/.test(c)) return false;
  return c.split('|').slice(1).every((seg) => SAFE_PIPES.has(seg.trim().split(/\s+/)[0].toLowerCase()));
}

export function run(ip, { password, enable }, commands, timeoutMs = 45000) {
  if (!password) return Promise.reject(new Error('Cisco password not set (Settings)'));
  if (!commands.every(isSafeShow)) return Promise.reject(new Error('Only show commands are allowed'));
  return new Promise((resolve, reject) => {
    const sock = net.connect(23, ip);
    let text = '';
    let waiter = null;
    const fail = (e) => { clearTimeout(timer); sock.destroy(); reject(e); };
    const timer = setTimeout(() => fail(new Error(`Timed out talking to ${ip}`)), timeoutMs);

    sock.on('data', (buf) => {
      const reply = [];
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== IAC) { text += String.fromCharCode(buf[i]); continue; }
        const cmd = buf[++i];
        if (cmd === DO || cmd === DONT || cmd === WILL || cmd === WONT) {
          const opt = buf[++i];
          if (cmd === DO) reply.push(IAC, WONT, opt);
          if (cmd === WILL) reply.push(IAC, DONT, opt);
        } else if (cmd === SB) {
          while (i < buf.length && !(buf[i] === IAC && buf[i + 1] === SE)) i++;
          i++;
        }
      }
      if (reply.length) sock.write(Buffer.from(reply));
      if (waiter && waiter.re.test(text)) { const w = waiter; waiter = null; w.resolve(text); }
    });
    sock.on('error', fail);
    sock.on('close', () => { if (waiter) fail(new Error('Connection closed')); });

    const expect = (re) => new Promise((res) => {
      if (re.test(text)) return res(text);
      waiter = { re, resolve: res };
    });
    const send = (line) => { text = ''; sock.write(line + '\r\n'); };
    const PROMPT = /[\w.-]+[>#]\s*$/;

    (async () => {
      await expect(/Password:\s*$/i);
      send(password);
      const after = await expect(new RegExp(`${PROMPT.source}|Password:\\s*$|% (Bad|Login invalid)`, 'i'));
      if (/Password:\s*$|% (Bad|Login invalid)/i.test(after)) throw new Error('Cisco password rejected');
      if (/>\s*$/.test(after)) {
        if (!enable) throw new Error('Enable secret not set (Settings)');
        send('enable');
        await expect(/Password:\s*$/i);
        send(enable);
        const en = await expect(new RegExp(`${PROMPT.source}|Password:\\s*$|% (Bad|Access denied)`, 'i'));
        if (!/#\s*$/.test(en)) throw new Error('Enable secret rejected');
      }
      send('terminal length 0');
      await expect(/#\s*$/);
      const out = [];
      for (const c of commands) {
        send(c);
        const raw = await expect(/\r?\n[\w.-]+#\s*$/);
        out.push(raw.split(/\r?\n/).slice(1, -1).join('\n'));
      }
      sock.write('exit\r\n');
      clearTimeout(timer);
      sock.end();
      resolve(out);
    })().catch(fail);
  });
}
