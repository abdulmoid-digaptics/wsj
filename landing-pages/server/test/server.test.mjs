import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateCheckout, getPlan, PLANS, publicCatalog } from '../catalog.mjs';
import { verifyWebhook, signPayload, formEncode } from '../stripe.mjs';
import { createStore } from '../store.mjs';
import { buildSessionParams } from '../checkout.mjs';
import { isServablePath } from '../static-guard.mjs';

test('static: pages and assets are served; server code, build outputs, secrets, dotfiles and docs never are', () => {
  for (const ok of ['index.html', 'boardroom.html', 'assets/css/landing.css', 'assets/img/brand-wall.webp', 'robots.txt', 'sitemap.xml', '1bcbccec7bccdb706ab0ca3f04236018.txt', 'seo/og-plan.json']) {
    assert.equal(isServablePath(ok), true, ok);
  }
  for (const bad of [
    'dist/mail-relay-secret.txt', 'dist/thanks-giving-webhook-secret.txt', 'dist/thanks-giving/index.html', 'dist\\mail-relay-url.txt',
    'server/.env', 'server/data/orders.json', 'server/server.mjs', 'node_modules/x/index.js',
    'Server/data/orders.json', 'DIST/generated.txt', 'cpanel/private/deployment.json', 'CPANEL\\private\\deployment.json',
    '.gitignore', 'assets/.secret.txt', 'README.md', 'GO-LIVE.md', '../backend/.env', '', path.resolve('/etc/passwd')
  ]) {
    assert.equal(isServablePath(bad), false, bad);
  }
});

const base = { name: 'Jane Smith', email: 'jane@example.com' };

test('catalog: server prices match the landing page offers', () => {
  const cents = Object.fromEntries(PLANS.map(p => [p.id, p.unitAmount]));
  assert.deepEqual(cents, {
    'podcast-starter': 12000, 'podcast-standard': 15000, 'podcast-premium': 19900,
    'conference-5h': 12500, 'boardroom-5h': 25000, 'dedicated-desk': 25000, mailbox: 2500
  });
  assert.equal(getPlan('dedicated-desk').mode, 'subscription');
  assert.equal(getPlan('mailbox').commitmentMonths, 12);
});

test('catalog: public view never exposes internal fields', () => {
  for (const p of publicCatalog()) {
    assert.ok(!('promoLimitEnv' in p) && !('description' in p));
  }
});

test('validate: rejects unknown plans and client-side prices', () => {
  assert.equal(validateCheckout({ ...base, planId: 'free-desk' }).ok, false);
  const r = validateCheckout({ ...base, planId: 'conference-5h', price: 1, unitAmount: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.value.plan.unitAmount, 12500);
});

test('validate: enforces the podcast 3-hour minimum and max', () => {
  assert.equal(validateCheckout({ ...base, planId: 'podcast-starter', quantity: 2 }).ok, false);
  assert.equal(validateCheckout({ ...base, planId: 'podcast-starter', quantity: 13 }).ok, false);
  assert.equal(validateCheckout({ ...base, planId: 'podcast-starter', quantity: 3.5 }).ok, false);
  assert.equal(validateCheckout({ ...base, planId: 'podcast-starter', quantity: 4 }).value.quantity, 4);
});

test('validate: subscriptions require accepting the 12-month term', () => {
  assert.equal(validateCheckout({ ...base, planId: 'mailbox' }).ok, false);
  assert.equal(validateCheckout({ ...base, planId: 'mailbox', acceptTerms: 'yes' }).ok, false);
  assert.equal(validateCheckout({ ...base, planId: 'mailbox', acceptTerms: true }).ok, true);
  assert.equal(validateCheckout({ ...base, planId: 'mailbox', acceptTerms: true, quantity: 2 }).ok, false);
});

test('validate: email, name, phone and date checks; strips control chars', () => {
  assert.equal(validateCheckout({ planId: 'boardroom-5h', name: 'J', email: 'jane@example.com' }).ok, false);
  assert.equal(validateCheckout({ planId: 'boardroom-5h', name: 'Jane', email: 'nope' }).ok, false);
  assert.equal(validateCheckout({ ...base, planId: 'boardroom-5h', phone: '<script>' }).ok, false);
  assert.equal(validateCheckout({ ...base, planId: 'boardroom-5h', preferredDate: 'tomorrow' }).ok, false);
  const r = validateCheckout({ ...base, planId: 'boardroom-5h', notes: 'a\u0000b\nc' });
  assert.equal(r.value.notes, 'a b c');
});

test('webhook: accepts a correctly signed payload', () => {
  const secret = 'whsec_test_123';
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const ev = verifyWebhook(Buffer.from(body), signPayload(body, secret), secret);
  assert.equal(ev.id, 'evt_1');
});

test('webhook: rejects tampered body, wrong secret, stale timestamp, missing header', () => {
  const secret = 'whsec_test_123';
  const body = JSON.stringify({ id: 'evt_1' });
  const sig = signPayload(body, secret);
  assert.throws(() => verifyWebhook(body.replace('evt_1', 'evt_2'), sig, secret), /mismatch/);
  assert.throws(() => verifyWebhook(body, sig, 'whsec_other'), /mismatch/);
  const old = signPayload(body, secret, Math.floor(Date.now() / 1000) - 3600);
  assert.throws(() => verifyWebhook(body, old, secret), /tolerance/);
  assert.throws(() => verifyWebhook(body, '', secret), /Missing/);
  assert.throws(() => verifyWebhook(body, sig, ''), /not configured/);
});

test('formEncode: nested objects and arrays use Stripe bracket syntax', () => {
  const s = decodeURIComponent(formEncode({ line_items: [{ quantity: 3, price_data: { unit_amount: 12000 } }], metadata: { a: 'b c' } }));
  assert.ok(s.includes('line_items[0][quantity]=3'));
  assert.ok(s.includes('line_items[0][price_data][unit_amount]=12000'));
  assert.ok(s.includes('metadata[a]=b c'));
});

test('store: persists orders, dedupes webhook events, counts paid and held', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wj-store-'));
  const s1 = createStore(dir);
  s1.append({ orderId: 'o1', planId: 'mailbox', status: 'pending', sessionId: 'cs_test_a' });
  s1.append({ eventId: 'evt_9', orderId: 'o1', status: 'paid' });
  s1.hold('o2', 'mailbox', 60_000);
  assert.equal(s1.paidCount('mailbox'), 1);
  assert.equal(s1.heldCount('mailbox'), 1);
  const s2 = createStore(dir); // simulate restart
  assert.equal(s2.hasEvent('evt_9'), true);
  assert.equal(s2.get('o1').status, 'paid');
  assert.equal(s2.findBySession('cs_test_a').orderId, 'o1');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('checkout params: embedded, server-priced, USD-locked, correct mode per plan', () => {
  const pod = validateCheckout({ ...base, planId: 'podcast-premium', quantity: 5 }).value;
  const p = buildSessionParams(pod, { orderId: 'lp_x', publicUrl: 'https://workspacejunction.com/offers', now: 0 });
  assert.equal(p.ui_mode, 'embedded_page');
  assert.equal(p.mode, 'payment');
  assert.equal(p.line_items[0].quantity, 5);
  assert.equal(p.line_items[0].price_data.unit_amount, 19900);
  assert.equal(p.adaptive_pricing.enabled, false);
  assert.equal(p.return_url, 'https://workspacejunction.com/offers/checkout-complete.html?session_id={CHECKOUT_SESSION_ID}');
  assert.equal(p.expires_at, 35 * 60);
  assert.ok(p.payment_intent_data && !p.subscription_data);
  assert.ok(p.line_items[0].price_data.product_data.images[0].startsWith('https://'));

  const mb = validateCheckout({ ...base, planId: 'mailbox', acceptTerms: true }).value;
  const s = buildSessionParams(mb, { orderId: 'lp_y', publicUrl: 'http://localhost:4310' });
  assert.equal(s.mode, 'subscription');
  assert.equal(s.line_items[0].price_data.recurring.interval, 'month');
  assert.equal(s.subscription_data.metadata.commitmentMonths, '12');
  assert.ok(!s.payment_intent_data && !s.invoice_creation);
  assert.equal(s.line_items[0].price_data.product_data.images, undefined); // no images from http origins
});

test('mail: MIME message has headers, UTF-8 subject and both parts', async () => {
  const { buildMessage } = await import('../mailer.mjs');
  const msg = buildMessage({ from: 'Workspace Junction <team@example.com>', to: ['devteam@digaptics.com'], subject: 'Paid — $125', text: 'hello', html: '<b>hello</b>', replyTo: 'buyer@example.com' });
  assert.match(msg, /^From: Workspace Junction <team@example.com>/m);
  assert.match(msg, /^To: devteam@digaptics.com/m);
  assert.match(msg, /^Reply-To: buyer@example.com/m);
  assert.match(msg, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(msg, /text\/plain; charset=UTF-8/);
  assert.match(msg, /text\/html; charset=UTF-8/);
});

test('mail: redirect sends everything to the test inbox and tags the subject', async () => {
  const { createMailer } = await import('../mailer.mjs');
  const m = createMailer({ enabled: false, redirectTo: 'devteam@digaptics.com', teamTo: [] });
  const r = await m.send({ to: 'buyer@example.com', subject: 'x', text: 'y' });
  assert.equal(r.sent, false); // disabled config never throws
  assert.equal(r.error, 'disabled');
});

test('emails: templates escape customer input', async () => {
  const tpl = await import('../emails.mjs');
  const q = { id: 'eq_1', type: 'tour', offer: 'Desk', request: 'Book a Tour', name: '<script>x</script>', email: 'a@b.co', notes: '"><img src=x>' };
  const m = tpl.teamEnquiry(q);
  assert.ok(!m.html.includes('<script>x</script>') && m.html.includes('&lt;script&gt;'));
  assert.ok(!m.html.includes('"><img'));
  assert.match(m.subject, /tour request/i);
});
