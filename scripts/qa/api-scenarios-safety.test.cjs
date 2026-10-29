'use strict';
/* Parent-owned positive regression tests for the three QA-confirmed defects:
 * uncertain write replay, source-unbound resume/interrupted streaks, and the
 * contextual booking workspace mapping bug. Pure: no env, HTTP, DB or browser.
 * Run: node scripts/qa/api-scenarios-safety.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const source = read('scripts/qa/api-scenarios.cjs');

test('fix: a write method never retries a transient failure after the server may have accepted it', async () => {
  const start = source.indexOf('  async function req('), end = source.indexOf('\n  try {\n    // Health', start);
  assert.ok(start >= 0 && end > start, 'req extraction boundaries changed; review harness');
  let calls = 0; const report = { owned: [] }; const active = { retriesNetwork: 0 };
  const sandbox = {
    base: 'http://localhost:4000/api', report, active, FormData, AbortSignal, Headers,
    localURL: s => new URL(s), save: async () => {}, backoff: async () => { throw new Error('backoff must not be called for a non-retryable write'); }, owned: () => {},
    transientNetwork: e => e.cause?.code === 'ECONNRESET', safeErrorCode: () => 'ECONNRESET', RESOURCES: [],
    retryableOnTransient: m => ['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(m),
    raw: async () => { calls++; const e = new TypeError('terminated'); e.cause = { code: 'ECONNRESET' }; throw e; },
  };
  vm.createContext(sandbox); vm.runInContext(source.slice(start, end) + '\nthis.request=req;', sandbox);
  await assert.rejects(() => sandbox.request('/bookings', 'POST', { customerName: 'qa-pure' }));
  assert.equal(calls, 1, 'A write must fail its iteration on the first transient error, not replay');
  assert.equal(active.retriesNetwork, 1, 'The transient failure is still recorded as a diagnostic');
});

test('fix: a transient failure on a read is still retried, since GET cannot duplicate state', async () => {
  const start = source.indexOf('  async function req('), end = source.indexOf('\n  try {\n    // Health', start);
  let calls = 0; const report = { owned: [] }; const active = { retriesNetwork: 0 };
  const sandbox = {
    base: 'http://localhost:4000/api', report, active, FormData, AbortSignal, Headers,
    localURL: s => new URL(s), save: async () => {}, backoff: async () => {}, owned: () => {},
    transientNetwork: e => e.cause?.code === 'ECONNRESET', safeErrorCode: () => 'ECONNRESET', RESOURCES: [],
    retryableOnTransient: m => ['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(m),
    raw: async () => { calls++; if (calls === 1) { const e = new TypeError('terminated'); e.cause = { code: 'ECONNRESET' }; throw e; } return { status: 200, headers: new Headers(), json: async () => ({ status: 'ok' }) }; },
  };
  vm.createContext(sandbox); vm.runInContext(source.slice(start, end) + '\nthis.request=req;', sandbox);
  const result = await sandbox.request('/health', 'GET');
  assert.equal(result.status, 200); assert.equal(calls, 2);
});

test('fix: resume binds to backend source and resets an unconfirmed interrupted iteration', () => {
  assert.match(source, /async function sourceFingerprint\(root\)/);
  assert.match(source, /for \(const dir of \['backend\/src','backend\/prisma'\]\)/);
  assert.match(source, /report\.sourceVersion!==sourceVersion/);
  assert.match(source, /if\(report\.current\)\{const row=report\.scenarios\[report\.current\.scenario\];if\(row\)\{advance\(row,false,0\)/);
});

test('fix: contextual workspace mapping prefers an exact phrase over a shared single word', () => {
  const src = read('components/booking-dialog.tsx');
  const ids = [...src.slice(src.indexOf('const WORKSPACE_TYPES='), src.indexOf('const PLANS=')).matchAll(/id:'([^']+)'/g)].map(m => ({ id: m[1] }));
  const fn = src.slice(src.indexOf('function mapService('), src.indexOf('\ninterface S{')).replace('s?:string', 's').replace('):string{', '){');
  const context = { WORKSPACE_TYPES: ids }; vm.createContext(context); vm.runInContext(fn + ';this.map=mapService;', context);
  assert.equal(context.map('Dedicated Desk'), 'dedicated-desk');
  assert.equal(context.map('Virtual Office'), 'virtual-office');
  assert.equal(context.map('Conference Room'), 'conference-room');
  // A single shared word with no exact phrase present still falls back correctly.
  assert.equal(context.map('I need a quiet room to work'), 'meeting-room');
});
