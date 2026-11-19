import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {BadRequestException, HttpException, NotFoundException} from '@nestjs/common';
import {ThrottlerException} from '@nestjs/throttler';
import {Prisma} from '@prisma/client';
import {Errors, requestIdOf} from '../src/errors';
import {redact} from '../src/redact';
import {backoffMs, InvalidRecipientError, MailService, OutboxService, safeMail, smtpBreaker} from '../src/mail';
import {clearLoginFailures, loginLocked, recordLoginFailure} from '../src/auth';

function run(error: unknown, headers: Record<string, string> = {}) {
  let status = 0, body: any, logged = '';
  const res = {headersSent: false, h: {} as Record<string, string>, setHeader(k: string, v: string) { this.h[k] = v; }, status(s: number) { status = s; return this; }, json(b: unknown) { body = b; return this; }};
  const req = {method: 'POST', originalUrl: '/api/x?token=abc', headers};
  const original = console.error;
  console.error = (line: string) => { logged += line; };
  try { new Errors().catch(error, {switchToHttp: () => ({getResponse: () => res, getRequest: () => req})} as never); } finally { console.error = original; }
  return {status, body, logged, headers: res.h};
}

test('errors use one safe, backwards-compatible shape with a request id', () => {
  const bad = run(new BadRequestException(['name must be a string']));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.success, false);
  assert.deepEqual(bad.body.message, ['name must be a string'], 'existing message stays where the site reads it');
  assert.equal(bad.body.statusCode, 400);
  assert.equal(bad.body.error.code, 'VALIDATION_ERROR');
  assert.match(bad.body.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(bad.headers['X-Request-Id'], bad.body.requestId);

  assert.equal(run(new NotFoundException()).body.error.code, 'NOT_FOUND');
  const limited = run(new ThrottlerException());
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMITED');

  const crash = run(new Error('db password=hunter2 at postgres://u:secretpw@h/db'));
  assert.equal(crash.status, 500);
  assert.equal(crash.body.message, 'Unable to complete your request. Please try again.');
  assert.doesNotMatch(JSON.stringify(crash.body), /hunter2|secretpw|stack|at /);
  assert.doesNotMatch(crash.logged, /hunter2|secretpw/, 'logs are redacted');
  assert.match(crash.logged, /http\.unhandled/);

  const stripe = run(Object.assign(new Error('Your card number 4242 4242 4242 4242 is invalid'), {type: 'StripeConnectionError'}));
  assert.equal(stripe.status, 503);
  assert.equal(stripe.body.error.code, 'PAYMENT_PROVIDER_ERROR');
  assert.doesNotMatch(JSON.stringify(stripe.body) + stripe.logged, /4242 4242/);

  const pool = run(new Prisma.PrismaClientKnownRequestError('Timed out fetching a new connection', {code: 'P2024', clientVersion: 'x'}));
  assert.equal(pool.status, 503);
  assert.equal(pool.body.error.code, 'DATABASE_UNAVAILABLE');
  assert.equal(run(new Prisma.PrismaClientKnownRequestError('dup', {code: 'P2002', clientVersion: 'x'})).status, 409);
  const custom = run(new HttpException({message: 'Hold expired', retryAfter: 30}, 409));
  assert.deepEqual(custom.body.error.details, {retryAfter: 30}, 'structured fields are preserved');
});

test('request ids: a safe caller id is reused, anything else is replaced', () => {
  assert.equal(requestIdOf({headers: {'x-request-id': 'abc12345-trace'}}), 'abc12345-trace');
  assert.notEqual(requestIdOf({headers: {'x-request-id': 'bad\r\nSet-Cookie: x'}}), 'bad\r\nSet-Cookie: x');
  assert.match(requestIdOf({headers: {}}), /^[0-9a-f-]{36}$/);
});

test('redaction removes card numbers, keys, tokens and passwords', () => {
  const out = redact('pan 4000056655665556 / 4242-4242-4242-4242 key sk_test_51Habcdefghijk whsec_abcdefghijkl Bearer eyJabc.def.ghi token=xyz password: "p4ss" pi_1234567890abcdefghijkl_secret_xyz postgresql://u:pw@host/db');
  for (const leak of ['4000056655665556', '4242-4242', 'sk_test_51H', 'whsec_abc', 'eyJabc', 'xyz', 'p4ss', ':pw@']) assert.ok(!out.includes(leak), leak + ' leaked: ' + out);
});

test('email header injection, bad recipients and lists are refused', () => {
  assert.throws(() => safeMail({to: 'a@b.com\r\nBcc: victim@x.com', subject: 's', text: 't'}), InvalidRecipientError);
  assert.throws(() => safeMail({to: 'a@b.com, c@d.com', subject: 's', text: 't'}), InvalidRecipientError);
  assert.throws(() => safeMail({to: 'Evil <a@b.com>', subject: 's', text: 't'}), InvalidRecipientError);
  assert.throws(() => safeMail({to: 'not-an-email', subject: 's', text: 't'}), InvalidRecipientError);
  const ok = safeMail({to: ' person@example.com ', subject: 'Hi\r\nBcc: x@y.com', text: 't', replyTo: 'x@y.com\nBcc: z@q.com'});
  assert.equal(ok.to, 'person@example.com');
  assert.doesNotMatch(ok.subject, /[\r\n]/);
  assert.equal(ok.replyTo, undefined, 'unsafe reply-to dropped');
});

test('retry backoff grows exponentially with bounded jitter', () => {
  assert.equal(backoffMs(1, () => 0.5), 60000);
  assert.equal(backoffMs(3, () => 0.5), 240000);
  assert.equal(backoffMs(1, () => 0), 48000);
  assert.equal(backoffMs(1, () => 1), 72000);
  assert.ok(backoffMs(30, () => 1) <= 6 * 3600000 * 1.2);
});

test('a permanently undeliverable email is dead-lettered at once; a temporary failure retries', async () => {
  const updates: any[] = [];
  const rows = [{id: 'bad', status: 'PENDING', attempts: 0, toEmail: 'broken address', template: 'purchase_receipt', payload: {}, customerId: null}, {id: 'tmp', status: 'PENDING', attempts: 0, toEmail: 'ok@example.com', template: 'purchase_receipt', payload: {}, customerId: null}];
  let served = false;
  const db = {emailOutbox: {
    findMany: async () => { if (served) return []; served = true; return rows; },
    updateMany: async () => ({count: 1}),
    update: async (a: any) => { updates.push(a); return a; },
  }, customerToken: {updateMany: async () => ({}), create: async () => ({})}};
  const mail = Object.assign(new MailService(), {mode: () => 'smtp' as const, deliver: async (m: any) => { if (!/^[^\s@]+@[^\s@]+$/.test(m.to)) throw new InvalidRecipientError(); throw Object.assign(new Error('timeout'), {code: 'ETIMEDOUT'}); }});
  const prev = console.error; console.error = () => undefined;
  try { await new OutboxService(db as never, mail as never).drain(); } finally { console.error = prev; }
  const bad = updates.find(u => u.where.id === 'bad'), tmp = updates.find(u => u.where.id === 'tmp');
  assert.equal(bad.data.status, 'DEAD');
  assert.equal(bad.data.lastError, 'INVALID_RECIPIENT');
  assert.equal(tmp.data.status, 'FAILED');
  assert.equal(tmp.data.lastError, 'ETIMEDOUT');
});

test('SMTP circuit breaker fails fast once open', async () => {
  const saved = {...process.env};
  Object.assign(process.env, {SMTP_HOST: '127.0.0.1', SMTP_FROM: 'noreply@example.com', SMTP_PORT: '9'});
  smtpBreaker.openUntil = Date.now() + 60000;
  try {
    await assert.rejects(new MailService().deliver({to: 'a@example.com', subject: 's', text: 't'}), /SMTP_CIRCUIT_OPEN/);
  } finally {
    smtpBreaker.openUntil = 0; smtpBreaker.failures = 0;
    for (const k of ['SMTP_HOST', 'SMTP_FROM', 'SMTP_PORT']) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

test('admin sign-in locks an account after 10 failures and unlocks after 15 minutes', () => {
  const key = 'lock-test@example.com', t0 = 1_000_000;
  for (let i = 0; i < 9; i++) recordLoginFailure(key, t0);
  assert.equal(loginLocked(key, t0), false);
  recordLoginFailure(key, t0);
  assert.equal(loginLocked(key, t0 + 1000), true);
  assert.equal(loginLocked(key, t0 + 16 * 60000), false);
  recordLoginFailure(key, t0); clearLoginFailures(key);
  assert.equal(loginLocked(key, t0), false);
});

test('no card number or CVC is stored, collected or logged by the application', () => {
  const root = path.resolve(__dirname, '..', '..');
  const schema = fs.readFileSync(path.join(root, 'backend/prisma/schema.prisma'), 'utf8');
  assert.doesNotMatch(schema, /\b(cardNumber|pan|cvc|cvv|card_number|securityCode)\b\s+String/i, 'no card-number or CVC column');
  const scan = (dir: string, out: string[] = []) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (['node_modules', '.next', '.next-audit', 'dist', '.git'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full, out); else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  const offenders = [...scan(path.join(root, 'app')), ...scan(path.join(root, 'components')), ...scan(path.join(root, 'lib'))]
    .filter(file => /autocomplete=["']cc-(number|csc)["']|name=["'](cardNumber|card_number|cvc|cvv)["']/i.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, [], 'card details are only entered in Stripe-hosted fields');
});
