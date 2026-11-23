/**
 * Dependency-free SMTP mailer (implicit TLS on 465, STARTTLS on 587/25) with AUTH LOGIN/PLAIN.
 * Same SMTP_* variables as the main Workspace Junction backend.
 * MAIL_REDIRECT_TO sends every message to one inbox (testing) and notes the intended recipient.
 */
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import crypto from 'node:crypto';

const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');
const encodeHeader = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap76 = s => s.replace(/.{1,76}/g, m => m + '\r\n');
const addrOnly = a => { const m = String(a).match(/<([^>]+)>/); return (m ? m[1] : String(a)).trim(); };
const formatAddr = a => {
  const m = String(a).match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m && m[1] ? `${encodeHeader(m[1].trim())} <${m[2].trim()}>` : addrOnly(a);
};

export function mailConfig(env = process.env) {
  const host = (env.SMTP_HOST || '').trim();
  const from = (env.SMTP_FROM || env.SMTP_USER || '').trim();
  return {
    enabled: Boolean(host && from),
    host,
    port: Number(env.SMTP_PORT || 465),
    user: (env.SMTP_USER || '').trim(),
    pass: (env.SMTP_PASSWORD || env.SMTP_PASS || '').trim(),
    from,
    teamTo: (env.NOTIFY_EMAIL || '').split(',').map(s => s.trim()).filter(Boolean),
    redirectTo: (env.MAIL_REDIRECT_TO || '').split(',').map(s => s.trim()).filter(Boolean),
    replyTo: (env.MAIL_REPLY_TO || '').trim()
  };
}

/** Build an RFC 5322 multipart/alternative message. */
export function buildMessage({ from, to, subject, text, html, replyTo, headers = {} }) {
  const boundary = 'wj_' + crypto.randomBytes(12).toString('hex');
  const domain = addrOnly(from).split('@')[1] || 'localhost';
  const lines = [
    `From: ${formatAddr(from)}`,
    `To: ${to.map(formatAddr).join(', ')}`,
    ...(replyTo ? [`Reply-To: ${formatAddr(replyTo)}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(text)),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(html || `<pre>${escapeHtml(text)}</pre>`)),
    `--${boundary}--`,
    ''
  ];
  return lines.join('\r\n');
}

export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function smtpSession(cfg, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const implicit = cfg.port === 465;
    let socket = implicit
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
      : net.connect({ host: cfg.host, port: cfg.port });
    let buf = '';
    let waiter = null;
    const onData = chunk => {
      buf += chunk.toString('utf8');
      // A full reply ends with a line "NNN <text>" (space after code, not dash).
      const m = buf.match(/(?:^|\r\n)(\d{3}) [^\r\n]*\r\n$/);
      if (m && waiter) { const reply = buf; buf = ''; const w = waiter; waiter = null; w.resolve({ code: Number(m[1]), text: reply }); }
    };
    const fail = err => { if (waiter) { const w = waiter; waiter = null; w.reject(err); } else reject(err); };
    const attach = s => { s.setTimeout(timeoutMs, () => fail(new Error('SMTP timeout'))); s.on('data', onData); s.on('error', fail); };
    attach(socket);
    const read = () => new Promise((res, rej) => { waiter = { resolve: res, reject: rej }; });
    const cmd = async (line, expect) => {
      const p = read();
      socket.write(line + '\r\n');
      const r = await p;
      if (expect && !expect.includes(r.code)) throw new Error(`SMTP ${line.split(' ')[0]} failed: ${r.text.trim().split('\r\n').pop()}`);
      return r;
    };
    const api = {
      read, cmd,
      async upgrade() {
        socket.removeListener('data', onData);
        socket = tls.connect({ socket, servername: cfg.host });
        attach(socket);
        await new Promise((res, rej) => { socket.once('secureConnect', res); socket.once('error', rej); });
      },
      write: d => socket.write(d),
      end: () => { try { socket.end(); } catch {} }
    };
    const ready = () => resolve(api);
    if (implicit) socket.once('secureConnect', ready); else socket.once('connect', ready);
    socket.once('error', reject);
  });
}

export function createMailer(cfg = mailConfig(), log = () => {}) {
  async function deliver({ to, subject, text, html, replyTo }) {
    const s = await smtpSession(cfg);
    try {
      const greet = await s.read();
      if (greet.code !== 220) throw new Error('SMTP greeting failed');
      const name = os.hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'localhost';
      let ehlo = await s.cmd(`EHLO ${name}`, [250]);
      if (cfg.port !== 465 && /STARTTLS/i.test(ehlo.text)) {
        await s.cmd('STARTTLS', [220]);
        await s.upgrade();
        ehlo = await s.cmd(`EHLO ${name}`, [250]);
      }
      if (cfg.user && cfg.pass) {
        if (/AUTH[ =][^\r\n]*PLAIN/i.test(ehlo.text)) {
          await s.cmd(`AUTH PLAIN ${b64(`\u0000${cfg.user}\u0000${cfg.pass}`)}`, [235]);
        } else {
          await s.cmd('AUTH LOGIN', [334]);
          await s.cmd(b64(cfg.user), [334]);
          await s.cmd(b64(cfg.pass), [235]);
        }
      }
      await s.cmd(`MAIL FROM:<${addrOnly(cfg.from)}>`, [250]);
      for (const r of to) await s.cmd(`RCPT TO:<${addrOnly(r)}>`, [250, 251]);
      await s.cmd('DATA', [354]);
      const msg = buildMessage({ from: cfg.from, to, subject, text, html, replyTo })
        .replace(/\r\n\./g, '\r\n..'); // dot-stuffing
      const done = s.read();
      s.write(msg + '\r\n.\r\n');
      const r = await done;
      if (r.code !== 250) throw new Error('SMTP message rejected: ' + r.text.trim());
      await s.cmd('QUIT').catch(() => {});
    } finally {
      s.end();
    }
  }

  /**
   * Send a message. Never throws: email problems must not break checkout.
   * Returns {sent:boolean, to:string[], error?}
   */
  async function send({ to, subject, text, html, replyTo, kind = 'mail' }) {
    const intended = (Array.isArray(to) ? to : [to]).filter(Boolean);
    if (!cfg.enabled) { log('warn', 'mail_disabled', { kind }); return { sent: false, to: intended, error: 'disabled' }; }
    if (!intended.length) return { sent: false, to: [], error: 'no recipient' };
    const redirectList = cfg.redirectTo || [];
    const redirected = redirectList.length > 0 && intended.some(a => !redirectList.map(r => r.toLowerCase()).includes(addrOnly(a).toLowerCase()));
    const finalTo = redirectList.length ? redirectList : intended;
    const finalSubject = redirected ? `[TEST to ${intended.map(addrOnly).join(', ')}] ${subject}` : subject;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await deliver({ to: finalTo, subject: finalSubject, text, html, replyTo: replyTo || cfg.replyTo || undefined });
        log('info', 'mail_sent', { kind, attempt, redirected: Boolean(redirected) });
        return { sent: true, to: finalTo };
      } catch (e) {
        log('error', 'mail_failed', { kind, attempt, message: e.message });
        if (attempt === 3) return { sent: false, to: finalTo, error: e.message };
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
  }

  return { send, config: cfg };
}
