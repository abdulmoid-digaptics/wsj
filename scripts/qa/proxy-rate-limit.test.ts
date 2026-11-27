import assert from 'node:assert/strict';
import test from 'node:test';
import {SlidingWindowLimiter, bucketFor, proxyClientIp, proxyRateLimitConfig} from '../../lib/proxy-rate-limit';

const headers = (h: Record<string, string>) => ({get: (n: string) => h[n.toLowerCase()] ?? null});

test('100 requests per 10s pass and the 101st is rejected with Retry-After', () => {
  const l = new SlidingWindowLimiter(10000);
  const t0 = 1_000_000_000_000;
  for (let i = 0; i < 100; i++) assert.equal(l.hit('page:1.2.3.4', 100, t0 + i).allowed, true, 'request ' + (i + 1));
  const d = l.hit('page:1.2.3.4', 100, t0 + 100);
  assert.equal(d.allowed, false);
  assert.ok(!d.allowed && d.retryAfter >= 1 && d.retryAfter <= 10);
  assert.equal(l.hit('page:5.6.7.8', 100, t0 + 100).allowed, true, 'other clients are unaffected');
});

test('the sliding window recovers gradually instead of resetting at the boundary', () => {
  const l = new SlidingWindowLimiter(10000);
  const t0 = 2_000_000_000_000;
  for (let i = 0; i < 100; i++) l.hit('k', 100, t0 + i);
  assert.equal(l.hit('k', 100, t0 + 10_050).allowed, false, 'just after the boundary the previous window still counts');
  assert.equal(l.hit('k', 100, t0 + 15_000).allowed, true, 'half a window later there is room again');
  assert.equal(l.hit('k', 100, t0 + 40_000).allowed, true, 'idle clients start fresh');
});

test('client IP prefers X-Real-IP and otherwise the right-most forwarded address', () => {
  assert.equal(proxyClientIp(headers({'x-real-ip': '203.0.113.5', 'x-forwarded-for': '9.9.9.9'})), '203.0.113.5');
  assert.equal(proxyClientIp(headers({'x-forwarded-for': '9.9.9.9, 203.0.113.6'})), '203.0.113.6');
  assert.equal(proxyClientIp(headers({'x-real-ip': 'garbage'})), 'unknown');
});

test('prefetch and RSC traffic uses its own, larger budget', () => {
  assert.equal(bucketFor('GET', headers({rsc: '1'})), 'prefetch');
  assert.equal(bucketFor('GET', headers({'next-router-prefetch': '1'})), 'prefetch');
  assert.equal(bucketFor('GET', headers({accept: 'text/html'})), 'page');
  assert.equal(bucketFor('POST', headers({rsc: '1'})), 'page', 'Server Actions count as page requests');
  assert.deepEqual(proxyRateLimitConfig({}), {enabled: true, windowMs: 10000, page: 100, prefetch: 400});
  assert.equal(proxyRateLimitConfig({PROXY_RATE_LIMIT: 'off'}).enabled, false);
});

test('memory stays bounded under an IP-spray attack', () => {
  const l = new SlidingWindowLimiter(10000, 1000);
  for (let i = 0; i < 5000; i++) l.hit('page:10.0.' + (i >> 8) + '.' + (i & 255), 100, 3_000_000_000_000 + i);
  assert.ok(l.size <= 1000);
});
