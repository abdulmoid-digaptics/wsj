#!/usr/bin/env node
/**
 * Create the Stripe webhook endpoint for the landing pages and save its signing secret
 * into server/.env (STRIPE_WEBHOOK_SECRET). Run once on the server after the site is reachable.
 *
 *   node scripts/setup-webhook.mjs            # create if missing
 *   node scripts/setup-webhook.mjs --recreate # replace an existing endpoint (new secret)
 *
 * Uses STRIPE_SECRET_KEY and PUBLIC_URL from server/.env. The main app's webhook is not touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(dir, '.env');
if (!fs.existsSync(envPath)) { console.error('server/.env not found'); process.exit(1); }
const raw = fs.readFileSync(envPath, 'utf8');
const get = k => { const m = raw.match(new RegExp(`^${k}=(.*)$`, 'm')); return m ? m[1].trim().replace(/^"|"$/g, '') : ''; };
const sk = get('STRIPE_SECRET_KEY');
const publicUrl = get('PUBLIC_URL').replace(/\/+$/, '');
if (!sk) { console.error('STRIPE_SECRET_KEY missing in server/.env'); process.exit(1); }
if (!publicUrl.startsWith('https://')) { console.error('PUBLIC_URL must be https'); process.exit(1); }

const url = `${publicUrl}/api/webhooks/stripe`;
const events = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'];
const api = async (method, p, body) => {
  const r = await fetch('https://api.stripe.com/v1' + p, {
    method, headers: { Authorization: `Bearer ${sk}`, 'Stripe-Version': '2026-10-28.endive', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? new URLSearchParams(body).toString() : undefined
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ? j.error.message : `HTTP ${r.status}`);
  return j;
};

const mode = sk.includes('_live_') ? 'LIVE' : 'TEST';
const list = await api('GET', '/webhook_endpoints?limit=100');
const existing = list.data.filter(w => w.url === url);
if (existing.length && !process.argv.includes('--recreate')) {
  console.log(`[${mode}] Webhook already exists for ${url} (${existing[0].id}).`);
  console.log('Stripe only shows a signing secret when an endpoint is created. If server/.env has no STRIPE_WEBHOOK_SECRET, run again with --recreate.');
  process.exit(0);
}
for (const w of existing) { await api('DELETE', `/webhook_endpoints/${w.id}`); console.log('deleted old endpoint', w.id); }

const body = { url, description: 'Workspace Junction landing pages (offers)', 'metadata[app]': 'wj-landing-pages' };
events.forEach((e, i) => { body[`enabled_events[${i}]`] = e; });
const ep = await api('POST', '/webhook_endpoints', body);

const line = `STRIPE_WEBHOOK_SECRET=${ep.secret}`;
const updated = /^STRIPE_WEBHOOK_SECRET=.*$/m.test(raw) ? raw.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, line) : raw.replace(/\s*$/, '\n') + line + '\n';
fs.writeFileSync(envPath, updated, { mode: 0o600 });
console.log(`[${mode}] Created webhook ${ep.id} -> ${url}`);
console.log('Events:', events.join(', '));
console.log('Saved STRIPE_WEBHOOK_SECRET to server/.env. Now restart: pm2 restart wj-landing-pages');
