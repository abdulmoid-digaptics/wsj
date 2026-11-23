import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {emailBody, linkSignature, linkSignatureValid, marketingHtml, personalize, readSubscriberToken, subscriberToken, trackLinks} from '../src/marketing-email';
import {MarketingService, parseAudience} from '../src/marketing';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value-that-is-long-enough-123456';

test('chart renderer copy in the backend matches the website', () => {
  const a = fs.readFileSync(path.resolve(__dirname, '../src/article-chart.ts'), 'utf8').replace(/\r\n/g, '\n');
  const b = fs.readFileSync(path.resolve(__dirname, '../../lib/article/chart.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(a, b);
});

test('subscriber tokens are purpose-bound, tamper-proof and confirm links expire', () => {
  const now = Date.now();
  const u = subscriberToken('sub-12345678', 'unsubscribe');
  assert.equal(readSubscriberToken(u, 'unsubscribe'), 'sub-12345678');
  assert.equal(readSubscriberToken(u, 'confirm'), null, 'an unsubscribe token cannot confirm');
  const c = subscriberToken('sub-12345678', 'confirm', now + 1000);
  assert.equal(readSubscriberToken(c, 'confirm', now), 'sub-12345678');
  assert.equal(readSubscriberToken(c, 'confirm', now + 2000), null, 'expired');
  const [body, sig] = u.split('.');
  assert.equal(readSubscriberToken(Buffer.from('other-id-999').toString('base64url') + '.' + sig, 'unsubscribe'), null);
  assert.equal(readSubscriberToken(body + '.x' + sig.slice(2), 'unsubscribe'), null);
});

test('click tracking only redirects signed links', () => {
  const sig = linkSignature('rec-12345678', 'https://example.com/a');
  assert.equal(linkSignatureValid('rec-12345678', 'https://example.com/a', sig), true);
  assert.equal(linkSignatureValid('rec-12345678', 'https://evil.example/', sig), false);
  assert.equal(linkSignatureValid('rec-other1', 'https://example.com/a', sig), false);
  const html = trackLinks('<a href="https://example.com/a?x=1&amp;y=2">go</a> <a href="mailto:a@b.c">mail</a>', 'rec-12345678', 'https://site.test/api');
  assert.match(html, /href="https:\/\/site\.test\/api\/public\/m\/c\/rec-12345678\?u=https%3A%2F%2Fexample\.com%2Fa%3Fx%3D1%26y%3D2&amp;s=/);
  assert.match(html, /href="mailto:a@b.c"/, 'mailto links are left alone');
});

test('email body is safe and inline-styled; personalisation is escaped', () => {
  const body = emailBody('<script>x</script><h2 onclick="a()">Hi</h2><p class="lead">Text</p><figure data-type="embed"><div class="wj-embed-frame"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe></div></figure>');
  assert.ok(!/<script|onclick|class=|<iframe/.test(body), body);
  assert.match(body, /<h2 style="[^"]+">Hi<\/h2>/);
  assert.match(body, /img\.youtube\.com\/vi\/dQw4w9WgXcQ/);
  assert.equal(personalize('Hi {{first_name}} <{{email}}>', {name: '<b>Ann</b> Lee', email: 'a@b.c'}), 'Hi &lt;b&gt;Ann&lt;/b&gt; <a@b.c>');
  assert.equal(personalize('Hi {{ first_name }}', {name: '', email: 'a@b.c'}), 'Hi there');
  const html = marketingHtml({subject: 'S', preheader: 'P', body, coupon: 'SAVE10', kind: 'MARKETING', unsubscribeUrl: 'https://site.test/u?t=1', siteUrl: 'https://site.test'});
  assert.match(html, /SAVE10/);
  assert.match(html, /Unsubscribe/);
  assert.match(html, /1S280 Summit Ave/, 'physical address in every email');
  assert.doesNotMatch(marketingHtml({subject: 'S', preheader: '', body, kind: 'ANNOUNCEMENT', siteUrl: 'x'}), /Unsubscribe/);
});

test('audience input is normalised', () => {
  const a = parseAudience({type: 'nope', tags: [' VIP ', 'vip', '<x>'], customers: 'bad', serviceTypes: ['coworking', 'DROP TABLE'], subscribedSince: '2026-01-01', excludeRecentDays: 500, emails: ['A@B.co', 'nope']});
  assert.equal(a.type, 'subscribers');
  assert.deepEqual(a.tags, ['vip', 'x']);
  assert.equal(a.customers, 'any');
  assert.deepEqual(a.serviceTypes, ['coworking']);
  assert.equal(a.excludeRecentDays, undefined);
  assert.deepEqual(a.emails, ['a@b.co']);
});

test('marketing goes only to SUBSCRIBED people; announcements refuse coupons', async () => {
  let where: any;
  const db: any = {
    customer: {findMany: async () => []},
    subscriber: {findMany: async (args: any) => { where = args.where; return [{id: 's1', email: 'ok@example.com', name: 'Ok', customerId: null}]; }, updateMany: async () => ({count: 0})},
  };
  const service = new MarketingService(db, {mode: () => 'none'} as never);
  const people = await service.resolveAudience('MARKETING', parseAudience({tags: ['vip']}));
  assert.equal(where.status, 'SUBSCRIBED');
  assert.deepEqual(where.tags, {hasSome: ['vip']});
  assert.equal(people.length, 1);
  await assert.rejects(service.resolveAudience('ANNOUNCEMENT', parseAudience({}), 'SAVE10'), /cannot contain a coupon/);
});

test('a recipient who unsubscribes mid-campaign is skipped, and failures are retried then dead-lettered', async () => {
  const updates: any[] = [];
  const recipients = [{id: 'r1', status: 'QUEUED', attempts: 0, subscriberId: 's-unsub', email: 'gone@example.com', name: ''}, {id: 'r2', status: 'QUEUED', attempts: 2, subscriberId: 's-ok', email: 'ok@example.com', name: ''}];
  const db: any = {
    marketingCampaign: {findMany: async ({where}: any) => (where.status === 'SENDING' ? [{id: 'c1', kind: 'MARKETING', subject: 'S', preheader: '', contentHtml: '<p>x</p>', couponCode: null}] : []), update: async () => ({}), updateMany: async (a: any) => { updates.push(['campaign', a.data]); return {count: 1}; }},
    campaignRecipient: {findMany: async () => recipients, updateMany: async () => ({count: 1}), update: async (a: any) => { updates.push([a.where.id, a.data]); return {}; }, count: async () => 0},
    subscriber: {findUnique: async ({where}: any) => ({status: where.id === 's-unsub' ? 'UNSUBSCRIBED' : 'SUBSCRIBED'}), update: async () => ({})},
  };
  const mail = {mode: () => 'smtp', deliver: async () => { throw Object.assign(new Error('timeout'), {code: 'ETIMEDOUT'}); }};
  await new MarketingService(db, mail as never).tick();
  assert.deepEqual(updates.find(u => u[0] === 'r1')?.[1].status, 'SKIPPED');
  assert.deepEqual(updates.find(u => u[0] === 'r2')?.[1].status, 'FAILED', 'third attempt gives up');
  assert.ok(updates.some(u => u[0] === 'campaign' && u[1].status === 'SENT'));
});
