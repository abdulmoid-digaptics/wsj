/**
 * Minimal Stripe REST client (no SDK dependency) + webhook signature verification.
 * API version is pinned to match the main Workspace Junction backend (stripe-node 23.1.0).
 */
import crypto from 'node:crypto';

export const STRIPE_API_VERSION = '2026-10-28.endive';
const API = 'https://api.stripe.com/v1';

/** Encode nested objects/arrays the way Stripe expects: a[b][0][c]=v */
export function formEncode(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') formEncode(item, `${key}[${i}]`, out);
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === 'object') {
      formEncode(v, key, out);
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out.join('&');
}

export class StripeError extends Error {
  constructor(message, { status, type, code } = {}) {
    super(message);
    this.status = status; this.type = type; this.code = code;
  }
}

export function createStripe(secretKey, { timeoutMs = 20000, maxRetries = 2, fetchImpl = fetch } = {}) {
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not set');

  async function request(method, path, params, { idempotencyKey } = {}) {
    const headers = {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Version': STRIPE_API_VERSION,
      'Content-Type': 'application/x-www-form-urlencoded'
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let url = API + path;
    let body;
    if (params && method === 'GET') url += '?' + formEncode(params);
    else if (params) body = formEncode(params);

    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, { method, headers, body, signal: ac.signal });
        const json = await res.json().catch(() => ({}));
        if (res.ok) return json;
        const e = json && json.error ? json.error : {};
        const err = new StripeError(e.message || `Stripe request failed (${res.status})`, { status: res.status, type: e.type, code: e.code });
        /* Retry only on rate limits / server errors. The idempotency key makes POST retries safe. */
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) { lastErr = err; await sleep(400 * 2 ** attempt); continue; }
        throw err;
      } catch (err) {
        if (err instanceof StripeError) throw err;
        lastErr = new StripeError('Network error talking to Stripe', { type: 'api_connection_error' });
        if (attempt < maxRetries) { await sleep(400 * 2 ** attempt); continue; }
        throw lastErr;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  return {
    createCheckoutSession: (params, opts) => request('POST', '/checkout/sessions', params, opts),
    retrieveCheckoutSession: id => request('GET', `/checkout/sessions/${encodeURIComponent(id)}`)
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Verify a Stripe-Signature header against the raw request body.
 * Same algorithm as stripe.webhooks.constructEvent: HMAC-SHA256 over `${t}.${payload}`.
 * Returns the parsed event or throws.
 */
export function verifyWebhook(rawBody, signatureHeader, secret, { toleranceSec = 300, now = Date.now() } = {}) {
  if (!secret) throw new Error('Webhook secret not configured');
  if (typeof signatureHeader !== 'string' || !signatureHeader) throw new Error('Missing Stripe-Signature header');
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  let t = null; const sigs = [];
  for (const part of signatureHeader.split(',')) {
    const [k, v] = part.split('=', 2).map(s => (s || '').trim());
    if (k === 't') t = Number(v);
    else if (k === 'v1' && v) sigs.push(v);
  }
  if (!Number.isFinite(t) || !sigs.length) throw new Error('Malformed Stripe-Signature header');
  if (Math.abs(now / 1000 - t) > toleranceSec) throw new Error('Webhook timestamp outside tolerance');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex');
  const exp = Buffer.from(expected, 'hex');
  const match = sigs.some(s => {
    const got = Buffer.from(s, 'hex');
    return got.length === exp.length && crypto.timingSafeEqual(got, exp);
  });
  if (!match) throw new Error('Webhook signature mismatch');
  return JSON.parse(payload);
}

/** Build a valid signature header (used by tests and the local webhook simulator). */
export function signPayload(payload, secret, t = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex');
  return `t=${t},v1=${sig}`;
}
