#!/usr/bin/env node
/**
 * Workspace Junction landing pages: static site + Stripe Embedded Checkout API.
 * Zero npm dependencies (Node 20.6+). Run: node server.mjs   (or: npm start)
 *
 * Routes
 *   GET  /api/health                 liveness + config sanity (no secrets)
 *   GET  /api/config                 publishable key, price catalog, promo availability
 *   POST /api/checkout               create an embedded Checkout Session (server-priced)
 *   GET  /api/checkout/status        payment outcome for the confirmation page
 *   POST /api/webhooks/stripe        signed Stripe events (source of truth for "paid")
 *   GET  /*                          static landing pages from the parent folder
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CURRENCY, getPlan, publicCatalog, validateCheckout, promoLimit, claimedBase, PLANS } from './catalog.mjs';
import { createStripe, verifyWebhook, StripeError } from './stripe.mjs';
import { createStore } from './store.mjs';
import { buildSessionParams, HOLD_MINUTES } from './checkout.mjs';
import { createMailer, mailConfig } from './mailer.mjs';
import * as tpl from './emails.mjs';
import { isServablePath } from './static-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------- Environment ---------- */
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);
  else for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const env = process.env;
const PROD = env.NODE_ENV === 'production';
const PORT = Number(env.PORT || 4310);
const HOST = env.HOST || '127.0.0.1';
const PUBLIC_URL = (env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const BASE_PATH = (env.BASE_PATH || '').replace(/\/+$/, '');
const STATIC_ROOT = path.resolve(env.STATIC_ROOT || path.join(__dirname, '..'));
const DATA_DIR = path.resolve(env.DATA_DIR || path.join(__dirname, 'data'));
const TRUST_PROXY = env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true';
const SECRET_KEY = (env.STRIPE_SECRET_KEY || '').trim();
const PUBLISHABLE_KEY = (env.STRIPE_PUBLISHABLE_KEY || '').trim();
const WEBHOOK_SECRET = (env.STRIPE_WEBHOOK_SECRET || '').trim();
const ALLOWED_ORIGINS = new Set(
  (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
    .concat([new URL(PUBLIC_URL).origin])
    .concat(PROD ? [] : [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`])
);

function fatal(msg) { console.error(`[config] ${msg}`); process.exit(1); }
if (PROD) {
  if (!SECRET_KEY) fatal('STRIPE_SECRET_KEY is required in production');
  if (!PUBLISHABLE_KEY) fatal('STRIPE_PUBLISHABLE_KEY is required in production');
  if (!WEBHOOK_SECRET) fatal('STRIPE_WEBHOOK_SECRET is required in production (payments are confirmed by webhook)');
  if (!PUBLIC_URL.startsWith('https://')) fatal('PUBLIC_URL must be https in production');
}
const keyMode = k => (k.includes('_live_') ? 'live' : k.includes('_test_') ? 'test' : 'unset');
if (SECRET_KEY && PUBLISHABLE_KEY && keyMode(SECRET_KEY) !== keyMode(PUBLISHABLE_KEY)) {
  fatal('STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY are from different modes (test vs live)');
}

const stripe = SECRET_KEY ? createStripe(SECRET_KEY) : null;
const store = createStore(DATA_DIR);

/* In development, pages opened from file:// or another local server (Live Server, :5500, ...) may call the API. */
function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (!PROD && (origin === 'null' || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin))) return true;
  return false;
}

const log = (level, msg, extra = {}) =>
  console[level === 'error' ? 'error' : 'log'](JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }));

const mailer = createMailer(mailConfig(), log);
const TEAM_TO = mailer.config.teamTo.length ? mailer.config.teamTo : ['grow@workspacejunction.com'];
/* Customer emails are off unless CUSTOMER_EMAILS=true: the team contacts customers manually. */
const CUSTOMER_EMAILS = String(env.CUSTOMER_EMAILS || 'false').toLowerCase() === 'true';
/* Fire-and-forget: an email problem must never block checkout or the webhook response. */
function mail(message, to) { mailer.send({ ...message, to }).catch(() => {}); }

/* Record a paid order once and send the team + customer emails exactly once. */
function markPaid(orderId, fields, source) {
  const before = store.get(orderId);
  if (!before) return;
  if (before.status !== 'paid' || fields.eventId) store.append({ orderId, ...fields, status: 'paid', confirmedBy: source });
  store.release(orderId);
  const o = store.get(orderId);
  if (o.notifiedPaid) return;
  store.append({ orderId, notifiedPaid: true });
  const plan = getPlan(o.planId);
  mail(tpl.teamOrderPaid(o, plan, source), TEAM_TO);
  const buyer = (o.customer && o.customer.email) || o.customerEmail;
  if (buyer && CUSTOMER_EMAILS) mail(tpl.customerOrderPaid(o, plan), [buyer]);
}
function markClosed(orderId, status, eventId) {
  const o = store.get(orderId);
  if (!o || o.status === 'paid') { if (eventId) store.append({ eventId }); return; }
  store.append({ eventId, orderId, status });
  store.release(orderId);
  const after = store.get(orderId);
  if (!after.notifiedClosed) { store.append({ orderId, notifiedClosed: true }); mail(tpl.teamOrderClosed(after, getPlan(after.planId), status), TEAM_TO); }
}

/* ---------- Helpers ---------- */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com" "https://checkout.stripe.com")',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://js.stripe.com https://*.js.stripe.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://*.stripe.com",
    "connect-src 'self' https://api.stripe.com https://*.stripe.com",
    "frame-src https://js.stripe.com https://*.js.stripe.com https://checkout.stripe.com https://*.stripe.com",
    "form-action 'self' mailto:",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'"
  ].join('; '),
  ...(PUBLIC_URL.startsWith('https://') ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {})
};

function corsHeaders(req) {
  const origin = req && req.headers.origin;
  if (!origin || origin === new URL(PUBLIC_URL).origin || !isAllowedOrigin(origin)) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept', 'Access-Control-Max-Age': '600', Vary: 'Origin' };
}

function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const payload = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    ...(isObj ? { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } : {}),
    ...(res.req ? corsHeaders(res.req) : {}),
    ...headers
  });
  res.end(payload);
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* Fixed-window rate limiter, per IP and bucket. */
const buckets = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset <= now) { buckets.set(key, { n: 1, reset: now + windowMs }); return false; }
  b.n++;
  return b.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k); }, 60_000).unref();

function promoStatus(plan) {
  const limit = promoLimit(plan);
  if (limit === null) return null;
  const claimed = Math.min(limit, claimedBase(plan) + store.paidCount(plan.id));
  const held = store.heldCount(plan.id);
  return { limit, claimed, remaining: Math.max(0, limit - claimed - held) };
}

const maskEmail = e => (typeof e === 'string' && e.includes('@') ? e.replace(/^(.)[^@]*(@.*)$/, '$1***$2') : null);

/* ---------- API handlers ---------- */
async function handleCheckout(req, res) {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) return send(res, 403, { error: 'Origin not allowed.' });
  if (!(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: 'Expected JSON.' });
  if (rateLimited(`co:${clientIp(req)}`, 10, 10 * 60_000)) return send(res, 429, { error: 'Too many attempts. Please wait a few minutes and try again.' }, { 'Retry-After': '600' });
  if (!stripe || !PUBLISHABLE_KEY) return send(res, 503, { error: 'Online payments are not available right now. Please call (773) 986-1908.' });

  let body;
  try { body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8')); }
  catch (e) { return send(res, e.status || 400, { error: e.status === 413 ? 'Request too large.' : 'Invalid request.' }); }

  const v = validateCheckout(body);
  if (!v.ok) return send(res, 400, { error: v.error });
  const { plan, quantity, name, email, phone, notes, preferredDate } = v.value;

  const promo = promoStatus(plan);
  if (promo && promo.remaining <= 0) {
    return send(res, 409, { error: `All ${promo.limit} promotional spots are currently taken. Call (773) 986-1908 to join the waitlist.` });
  }

  const orderId = 'lp_' + crypto.randomUUID().replace(/-/g, '');
  const params = buildSessionParams(v.value, { orderId, publicUrl: PUBLIC_URL });

  let session;
  try {
    session = await stripe.createCheckoutSession(params, { idempotencyKey: `lp-checkout:${orderId}` });
  } catch (e) {
    /* Operators see the provider error type; the buyer never sees provider internals. */
    log('error', 'checkout_session_failed', { orderId, planId: plan.id, type: e.type || 'unknown', code: e.code, status: e.status, message: e instanceof StripeError ? e.message : undefined });
    return send(res, 502, { error: 'We could not start the secure payment form. Please try again or call (773) 986-1908.' });
  }

  if (promo) store.hold(orderId, plan.id, HOLD_MINUTES * 60_000);
  store.append({
    orderId, sessionId: session.id, planId: plan.id, offer: plan.offer, quantity, mode: plan.mode,
    amountExpected: plan.unitAmount * quantity, currency: CURRENCY, status: 'pending',
    customer: { name, email, phone: phone || null }, preferredDate: preferredDate || null, notes: notes || null
  });
  log('info', 'checkout_session_created', { orderId, planId: plan.id, quantity });
  mail(tpl.teamCheckoutStarted(store.get(orderId), plan), TEAM_TO);
  return send(res, 200, { orderId, clientSecret: session.client_secret, publishableKey: PUBLISHABLE_KEY });
}

async function handleStatus(req, res, url) {
  if (rateLimited(`st:${clientIp(req)}`, 60, 60_000)) return send(res, 429, { error: 'Too many requests.' });
  const sessionId = url.searchParams.get('session_id') || '';
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return send(res, 400, { error: 'Invalid session.' });
  if (!stripe) return send(res, 503, { error: 'Payments are not configured.' });
  let s;
  try { s = await stripe.retrieveCheckoutSession(sessionId); }
  catch (e) { return send(res, e.status === 404 ? 404 : 502, { error: e.status === 404 ? 'Session not found.' : 'Could not check payment status.' }); }

  const order = store.findBySession(sessionId) || (s.client_reference_id ? store.get(s.client_reference_id) : null);
  const plan = getPlan(s.metadata && s.metadata.planId);
  /* Webhooks are the source of truth, but if Stripe already reports the session paid we record it
     too, so the confirmation page and promo counters stay right even if a webhook is delayed. */
  const paid = s.status === 'complete' && (s.payment_status === 'paid' || s.payment_status === 'no_payment_required');
  if (paid && order && (order.status !== 'paid' || !order.notifiedPaid)) {
    markPaid(order.orderId, { amountTotal: s.amount_total, currency: s.currency, paymentIntent: s.payment_intent || null, subscription: s.subscription || null }, 'return_url');
  }
  return send(res, 200, {
    status: s.status,                 // open | complete | expired
    paymentStatus: s.payment_status,  // paid | unpaid | no_payment_required
    mode: s.mode,
    planName: plan ? plan.name : null,
    offer: plan ? plan.offer : null,
    page: plan ? plan.page : null,
    quantity: s.metadata ? Number(s.metadata.quantity) || 1 : 1,
    amountTotal: s.amount_total,
    currency: s.currency,
    email: maskEmail(s.customer_details && s.customer_details.email),
    orderId: s.client_reference_id || null
  });
}

async function handleWebhook(req, res) {
  let raw;
  try { raw = await readBody(req, 1024 * 1024); } catch (e) { return send(res, e.status || 400, { error: 'Bad payload' }); }
  if (!WEBHOOK_SECRET) { log('error', 'webhook_secret_missing'); return send(res, 400, { error: 'Webhook not configured' }); }
  let event;
  try { event = verifyWebhook(raw, req.headers['stripe-signature'], WEBHOOK_SECRET); }
  catch (e) { log('error', 'webhook_rejected', { reason: e.message }); return send(res, 400, { error: 'Invalid signature' }); }

  if (store.hasEvent(event.id)) return send(res, 200, { received: true, duplicate: true });
  const s = event.data && event.data.object;
  const orderId = s && (s.client_reference_id || (s.metadata && s.metadata.orderId));
  const ours = s && s.metadata && s.metadata.source === 'landing-pages';

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        if (!ours) break;
        const paid = s.payment_status === 'paid' || s.payment_status === 'no_payment_required';
        const fields = {
          eventId: event.id, sessionId: s.id, planId: s.metadata.planId, offer: s.metadata.offer,
          amountTotal: s.amount_total, currency: s.currency, mode: s.mode,
          paymentIntent: s.payment_intent || null, subscription: s.subscription || null, stripeCustomer: s.customer || null,
          customerEmail: s.customer_details ? s.customer_details.email : null
        };
        /* Orders created on another instance (or before a data reset) are rebuilt from Stripe metadata. */
        if (!store.get(orderId)) {
          const m = s.metadata;
          store.append({ orderId, planId: m.planId, offer: m.offer, status: 'pending', quantity: Number(m.quantity) || 1,
            customer: { name: m.customerName, email: fields.customerEmail, phone: m.phone !== '-' ? m.phone : null },
            preferredDate: m.preferredDate !== '-' ? m.preferredDate : null, notes: m.notes !== '-' ? m.notes : null });
        }
        if (paid) markPaid(orderId, fields, 'webhook');
        else store.append({ ...fields, orderId, status: 'processing', confirmedBy: 'webhook' });
        log('info', 'order_' + (paid ? 'paid' : 'processing'), { orderId, planId: s.metadata.planId, amount: s.amount_total });
        break;
      }
      case 'checkout.session.async_payment_succeeded':
        if (!ours) break;
        markPaid(orderId, { eventId: event.id, amountTotal: s.amount_total, currency: s.currency }, 'webhook');
        log('info', 'order_paid_async', { orderId });
        break;
      case 'checkout.session.async_payment_failed':
        if (!ours) break;
        markClosed(orderId, 'failed', event.id);
        log('info', 'order_payment_failed', { orderId });
        break;
      case 'checkout.session.expired':
        if (!ours) break;
        markClosed(orderId, 'expired', event.id);
        break;
      default:
        break; // other events are acknowledged and ignored
    }
  } catch (e) {
    /* Returning 500 makes Stripe retry, which is what we want if the disk write failed. */
    log('error', 'webhook_processing_failed', { type: event.type, eventId: event.id, message: e.message });
    return send(res, 500, { error: 'Processing failed' });
  }
  return send(res, 200, { received: true });
}

async function handleEnquiry(req, res) {
  if (!isAllowedOrigin(req.headers.origin)) return send(res, 403, { error: 'Origin not allowed.' });
  if (!(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: 'Expected JSON.' });
  if (rateLimited(`eq:${clientIp(req)}`, 6, 10 * 60_000)) return send(res, 429, { error: 'Too many messages. Please call (773) 986-1908.' });
  if (!mailer.config.enabled) return send(res, 503, { error: 'Messaging is unavailable right now.' });
  let b;
  try { b = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8')); } catch { return send(res, 400, { error: 'Invalid request.' }); }
  const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
  if (str(b.website, 200)) return send(res, 200, { ok: true }); // honeypot: bots fill hidden fields
  const q = {
    id: 'eq_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20),
    type: b.type === 'tour' ? 'tour' : 'enquiry',
    offer: str(b.offer, 120) || 'Landing pages', request: str(b.request, 120) || 'General question',
    name: str(b.name, 120), email: str(b.email, 200).toLowerCase(), phone: str(b.phone, 40),
    preferredDate: str(b.preferredDate, 10), notes: str(b.notes, 1500)
  };
  if (q.name.length < 2) return send(res, 400, { error: 'Please enter your full name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(q.email)) return send(res, 400, { error: 'Please enter a valid email address.' });
  if (q.phone && !/^[0-9+().\-\s]{7,40}$/.test(q.phone)) return send(res, 400, { error: 'Please enter a valid phone number.' });
  if (q.preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(q.preferredDate)) return send(res, 400, { error: 'Please enter a valid date.' });
  store.append({ enquiryId: q.id, kind: 'enquiry', ...q });
  const team = await mailer.send({ ...tpl.teamEnquiry(q), to: TEAM_TO, replyTo: q.email });
  if (!team.sent) return send(res, 502, { error: 'We could not send your message. Please call (773) 986-1908.' });
  if (CUSTOMER_EMAILS) mail(tpl.customerEnquiryAck(q), [q.email]);
  log('info', 'enquiry_received', { id: q.id, type: q.type });
  return send(res, 200, { ok: true, id: q.id });
}

/* ---------- Static files ---------- */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2'
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.svg', '.xml', '.txt', '.json']);
const gzCache = new Map();

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain' }); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(STATIC_ROOT, '.' + rel);
  const relToRoot = path.relative(STATIC_ROOT, file);
  /* Never serve outside the site root, the server folder, build outputs (dist/), dotfiles, or docs. */
  if (!isServablePath(relToRoot)) return notFound(res);
  const ext = path.extname(file).toLowerCase();
  if (!TYPES[ext]) return notFound(res);
  let stat;
  try { stat = fs.statSync(file); if (!stat.isFile()) return notFound(res); } catch { return notFound(res); }

  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  /* Pages, CSS and JS revalidate every time (cheap 304s via ETag) so a deploy is live immediately.
     Images rarely change and are cached for a day. */
  const cache = ['.html', '.xml', '.txt', '.css', '.js', '.json'].includes(ext)
    ? 'no-cache'
    : 'public, max-age=86400, stale-while-revalidate=604800';
  const headers = { 'Content-Type': TYPES[ext], 'Cache-Control': cache, ETag: etag, Vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === etag) return send(res, 304, '', headers);

  const gzipOk = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (gzipOk) {
    let hit = gzCache.get(file);
    if (!hit || hit.etag !== etag) { hit = { etag, buf: zlib.gzipSync(fs.readFileSync(file), { level: 9 }) }; gzCache.set(file, hit); }
    return send(res, 200, req.method === 'HEAD' ? '' : hit.buf, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': hit.buf.length });
  }
  res.writeHead(200, { ...SECURITY_HEADERS, ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

function notFound(res) {
  const page = path.join(STATIC_ROOT, '404.html');
  if (fs.existsSync(page)) return send(res, 404, fs.readFileSync(page), { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' });
  return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
}

/* ---------- Router ---------- */
export const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let url;
  try { url = new URL(req.url, 'http://local'); } catch { return send(res, 400, { error: 'Bad request' }); }
  let p = url.pathname;
  if (BASE_PATH && (p === BASE_PATH || p.startsWith(BASE_PATH + '/'))) p = p.slice(BASE_PATH.length) || '/';
  if (p.startsWith('/api/')) res.on('finish', () => log('info', 'req', { m: req.method, p, s: res.statusCode, ms: Date.now() - started }));

  try {
    if (p.startsWith('/api/')) {
      if (req.method === 'OPTIONS') return send(res, isAllowedOrigin(req.headers.origin) ? 204 : 403, '');
      if (p === '/api/health' && req.method === 'GET') {
        return send(res, 200, { ok: true, stripe: Boolean(stripe && PUBLISHABLE_KEY), mode: keyMode(SECRET_KEY), webhook: Boolean(WEBHOOK_SECRET), mail: mailer.config.enabled });
      }
      if (p === '/api/config' && req.method === 'GET') {
        const promos = {};
        for (const plan of PLANS) { const st = promoStatus(plan); if (st) promos[plan.id] = st; }
        return send(res, 200, { publishableKey: PUBLISHABLE_KEY || null, paymentsEnabled: Boolean(stripe && PUBLISHABLE_KEY), enquiriesEnabled: mailer.config.enabled, catalog: publicCatalog(), promos });
      }
      if (p === '/api/checkout' && req.method === 'POST') return await handleCheckout(req, res);
      if (p === '/api/checkout/status' && req.method === 'GET') return await handleStatus(req, res, url);
      if (p === '/api/enquiry' && req.method === 'POST') return await handleEnquiry(req, res);
      if (p === '/api/webhooks/stripe' && req.method === 'POST') return await handleWebhook(req, res);
      return send(res, 404, { error: 'Not found' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain' });
    return serveStatic(req, res, p);
  } catch (e) {
    log('error', 'unhandled', { path: p, message: e.message });
    if (!res.headersSent) send(res, 500, { error: 'Something went wrong.' });
  }
});

server.headersTimeout = 20_000;
server.requestTimeout = 30_000;

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  server.listen(PORT, HOST, () => {
    log('info', 'listening', { url: `http://${HOST}:${PORT}`, publicUrl: PUBLIC_URL, basePath: BASE_PATH || '/', stripeMode: keyMode(SECRET_KEY), webhook: Boolean(WEBHOOK_SECRET), mail: mailer.config.enabled, notify: TEAM_TO, mailRedirect: mailer.config.redirectTo.length ? mailer.config.redirectTo : null, prod: PROD });
    if (!WEBHOOK_SECRET) log('warn', 'STRIPE_WEBHOOK_SECRET not set: payments are confirmed only via the return page until it is added');
  });
  const shutdown = sig => { log('info', 'shutdown', { sig }); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
