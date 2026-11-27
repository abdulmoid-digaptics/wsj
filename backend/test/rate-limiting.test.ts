import 'reflect-metadata';
import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {Controller, Get, HttpCode, Module, Post} from '@nestjs/common';
import {APP_GUARD} from '@nestjs/core';
import {Throttle, ThrottlerModule} from '@nestjs/throttler';
import {THROTTLER_LIMIT, THROTTLER_TTL} from '@nestjs/throttler/dist/throttler.constants';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET ||= 'rate-limit-test-secret-that-is-long-enough-1234';
process.env.FRONTEND_URL ||= 'http://localhost:3000';

import {createApplication} from '../src/application';
import {EmailCooldown, WsjThrottlerGuard, clientIp, ipBucket, trackerFor, verifiedUserKey, RATE_LIMIT_MESSAGE} from '../src/throttler-guard';
import {RedisThrottlerStorage, createThrottlerStorage} from '../src/throttler-storage';
import {AuthController} from '../src/auth';
import {AccountAuthController} from '../src/account-auth';
import {StripeWebhookController, PublicBookingController} from '../src/booking';
import {PublicCatalogController} from '../src/catalog';
import {PublicBillingController} from '../src/billing';
import {PublicController} from '../src/public';
import {PublicMarketingController} from '../src/marketing';

/* ── A small app that uses the production guard, storage selection and error filter ── */
/* Test files are compiled without legacy decorator support, so decorators are applied explicitly. */
class ProbeController {
  read() { return {ok: true}; }
  login() { return {ok: true}; }
  webhook() { return {received: true}; }
  contact() { return {ok: true}; }
}
const method = (name: keyof ProbeController, ...decorators: MethodDecorator[]) =>
  Reflect.decorate(decorators, ProbeController.prototype, name, Object.getOwnPropertyDescriptor(ProbeController.prototype, name));
method('read', Get('probe'));
method('login', Post('auth/login'), HttpCode(200), Throttle({default: {limit: 5, ttl: 60000}}));
method('webhook', Post('webhooks/stripe'), HttpCode(200), Throttle({default: {limit: 600, ttl: 60000}}));
method('contact', Post('contact'), HttpCode(200), Throttle({default: {limit: 50, ttl: 60000}}), EmailCooldown(2, 60000));
Reflect.decorate([Controller()], ProbeController);
class ProbeModule {}
Reflect.decorate([Module({imports: [ThrottlerModule.forRoot({throttlers: [{ttl: 60000, limit: 120}], storage: createThrottlerStorage({}).storage})], controllers: [ProbeController], providers: [{provide: APP_GUARD, useClass: WsjThrottlerGuard}]})], ProbeModule);

let app: Awaited<ReturnType<typeof createApplication>>;
let base = '';
before(async () => {
  app = await createApplication(ProbeModule);
  app.useLogger(false);
  await app.listen(0, '127.0.0.1');
  base = 'http://127.0.0.1:' + app.getHttpServer().address().port + '/api';
});
after(async () => { await app?.close(); });

/* Requests arrive from loopback (our nginx), so X-Forwarded-For selects the simulated client. */
const call = (path: string, ip: string, init: RequestInit = {}) => fetch(base + path, {...init, headers: {'x-forwarded-for': ip, ...(init.body ? {'content-type': 'application/json'} : {}), ...(init.headers as Record<string, string> || {})}});

test('global default: the 121st request in a minute is rejected with the standard 429 envelope', async () => {
  for (let i = 0; i < 120; i++) assert.equal((await call('/probe', '203.0.113.10')).status, 200, 'request ' + (i + 1));
  const res = await call('/probe', '203.0.113.10');
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'RATE_LIMITED');
  assert.equal(body.error.message, RATE_LIMIT_MESSAGE);
  assert.equal(typeof body.requestId, 'string');
  assert.ok(Number(res.headers.get('retry-after')) > 0, 'Retry-After in seconds');
  /* A different client is unaffected. */
  assert.equal((await call('/probe', '203.0.113.11')).status, 200);
});

test('successful responses carry standard and legacy rate limit headers', async () => {
  const res = await call('/probe', '203.0.113.20');
  assert.equal(res.headers.get('ratelimit-limit'), '120');
  assert.equal(res.headers.get('ratelimit-remaining'), '119');
  assert.ok(Number(res.headers.get('ratelimit-reset')) > 0);
  assert.equal(res.headers.get('x-ratelimit-limit'), '120');
});

test('login drops the 6th attempt within 60 seconds and sends Retry-After', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call('/auth/login', '198.51.100.5', {method: 'POST', body: '{}'})).status, 200);
  const res = await call('/auth/login', '198.51.100.5', {method: 'POST', body: '{}'});
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error.code, 'RATE_LIMITED');
  const retry = Number(res.headers.get('retry-after'));
  assert.ok(retry > 0 && retry <= 60, 'Retry-After between 1 and 60 seconds, got ' + retry);
});

test('spoofing the left-most X-Forwarded-For entry does not reset the budget', async () => {
  for (let i = 0; i < 5; i++) await call('/auth/login', 'fake-' + i + ', 198.51.100.77', {method: 'POST', body: '{}'});
  const res = await call('/auth/login', '10.0.0.' + 99 + ', 198.51.100.77', {method: 'POST', body: '{}'});
  assert.equal(res.status, 429);
});

test('Stripe webhook accepts a burst of deliveries from one address', async () => {
  const results = await Promise.all(Array.from({length: 150}, () => call('/webhooks/stripe', '54.187.174.169', {method: 'POST', body: '{}'})));
  assert.deepEqual([...new Set(results.map(r => r.status))], [200]);
});

test('per-email cooldown applies across different IPs', async () => {
  const body = JSON.stringify({email: 'Flood@Example.com'});
  assert.equal((await call('/contact', '192.0.2.1', {method: 'POST', body})).status, 200);
  assert.equal((await call('/contact', '192.0.2.2', {method: 'POST', body})).status, 200);
  const res = await call('/contact', '192.0.2.3', {method: 'POST', body: JSON.stringify({email: 'flood@example.com '})});
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('retry-after')) > 0);
  assert.equal((await call('/contact', '192.0.2.3', {method: 'POST', body: JSON.stringify({email: 'other@example.com'})})).status, 200);
});

/* ── Route policies on the real controllers ── */
const limit = (proto: any, method: string) => [Reflect.getMetadata(THROTTLER_LIMIT + 'default', proto[method]), Reflect.getMetadata(THROTTLER_TTL + 'default', proto[method])];

test('route policies match the security tiers', () => {
  assert.deepEqual(limit(AuthController.prototype, 'login'), [5, 60000]);
  assert.deepEqual(limit(AccountAuthController.prototype, 'login'), [5, 60000]);
  assert.deepEqual(limit(AccountAuthController.prototype, 'exchange'), [5, 60000]);
  assert.deepEqual(limit(AccountAuthController.prototype, 'requestLink'), [3, 900000]);
  assert.deepEqual(limit(AccountAuthController.prototype, 'forgot'), [3, 900000]);
  assert.deepEqual(limit(PublicCatalogController.prototype, 'checkout'), [5, 60000]);
  assert.deepEqual(limit(PublicBillingController.prototype, 'checkout'), [5, 60000]);
  assert.deepEqual(limit(StripeWebhookController.prototype, 'handle'), [600, 60000]);
  assert.deepEqual(limit(PublicController.prototype, 'inquiry'), [5, 60000]);
  assert.deepEqual(limit(PublicMarketingController.prototype, 'subscribe'), [5, 60000]);
  assert.ok(Reflect.getMetadata('wsj:email-cooldown', PublicController.prototype.inquiry));
  assert.ok(Reflect.getMetadata('wsj:email-cooldown', PublicMarketingController.prototype.subscribe));
  assert.ok(PublicBookingController);
});

/* ── Client identity ── */
test('client IP ignores forgeable headers unless Cloudflare is explicitly trusted', () => {
  const req = {ip: '::ffff:203.0.113.9', headers: {'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9'}};
  assert.equal(clientIp(req, {}), '203.0.113.9');
  assert.equal(clientIp(req, {TRUST_CLOUDFLARE_IP: 'true'}), '1.2.3.4');
  assert.equal(clientIp({ip: '203.0.113.9', headers: {'cf-connecting-ip': 'not-an-ip'}}, {TRUST_CLOUDFLARE_IP: 'true'}), '203.0.113.9');
});

test('IPv6 clients are grouped by /64', () => {
  assert.equal(ipBucket('2001:db8:abcd:12:1::5'), '2001:db8:abcd:12::/64');
  assert.equal(ipBucket('2001:db8:abcd:12:ffff:1:2:3'), '2001:db8:abcd:12::/64');
  assert.equal(ipBucket('203.0.113.9'), '203.0.113.9');
});

test('verified staff tokens are keyed by user; forged tokens fall back to IP', () => {
  const token = jwt.sign({sub: 'u-123', v: 1}, process.env.JWT_SECRET!, {algorithm: 'HS256'});
  assert.equal(verifiedUserKey({headers: {authorization: 'Bearer ' + token}}), 'user:u-123');
  assert.equal(verifiedUserKey({headers: {}, cookies: {access_token: token}}), 'user:u-123');
  const forged = jwt.sign({sub: 'u-123'}, 'wrong-secret-wrong-secret-wrong-secret!!', {algorithm: 'HS256'});
  assert.equal(trackerFor({ip: '203.0.113.9', headers: {authorization: 'Bearer ' + forged}}), 'ip:203.0.113.9');
});

/* ── Storage selection and Redis behaviour ── */
test('storage falls back to memory without REDIS_URL or without the Redis client', () => {
  assert.equal(createThrottlerStorage({}).kind, 'memory');
  const warn = console.warn; console.warn = () => undefined;
  try {
    assert.equal(createThrottlerStorage({REDIS_URL: 'redis://127.0.0.1:6379'}, () => { throw new Error('Cannot find module ioredis'); }).kind, 'memory');
  } finally { console.warn = warn; }
});

test('Redis storage maps counters and blocks, and falls back to memory on Redis errors', async () => {
  const replies: unknown[][] = [[1, 60000, 0, 0], [6, 41000, 1, 60000]];
  const fake = {eval: async () => replies.shift()};
  const storage = new RedisThrottlerStorage(fake);
  assert.deepEqual(await storage.increment('k', 60000, 5, 60000, 'default'), {totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0});
  assert.deepEqual(await storage.increment('k', 60000, 5, 60000, 'default'), {totalHits: 6, timeToExpire: 41, isBlocked: true, timeToBlockExpire: 60});
  const warn = console.warn; console.warn = () => undefined;
  try {
    const broken = new RedisThrottlerStorage({eval: async () => { throw new Error('ECONNREFUSED'); }});
    const record = await broken.increment('k2', 60000, 5, 60000, 'default');
    assert.equal(record.totalHits, 1);
    assert.equal(record.isBlocked, false);
  } finally { console.warn = warn; }
});
