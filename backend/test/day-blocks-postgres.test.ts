import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {PrismaClient} from '@prisma/client';
import {BillingService, type PricedLine} from '../src/billing';
import {DayBlockAdminController} from '../src/day-block-admin';
import {unavailableDays} from '../src/day-blocks';
import {stripeFixture} from './billing-fixture';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value-that-is-long-enough-123456';
process.env.FRONTEND_URL = 'http://localhost:3100';
const enabled = process.env.INVENTORY_TEST_DOCKER === '1';
const admin = {user: {id: 'synthetic-admin'}};

// Disposable database and fake Stripe only. No real customer data, email or payment.
test('same-day service blocking on disposable PostgreSQL', {skip: enabled ? false : 'set INVENTORY_TEST_DOCKER=1', timeout: 240000}, async t => {
  const docker = (...args: string[]) => execFileSync('docker', args, {encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const name = 'wsj-day-blocks-' + randomUUID(), password = randomUUID();
  const container = docker('run', '--pull=never', '--detach', '--rm', '--name', name, '--tmpfs', '/var/lib/postgresql/data', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=day_test', '-p', '127.0.0.1::5432', 'postgres:16-alpine');
  let db: PrismaClient | undefined;
  try {
    const port = /^127\.0\.0\.1:(\d+)$/.exec(docker('port', container, '5432/tcp'))?.[1];
    assert.ok(port);
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) { ready = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-d', 'day_test'], {stdio: 'ignore', timeout: 5000}).status === 0; if (!ready) await delay(250); }
    assert.ok(ready);
    const url = `postgresql://postgres:${password}@127.0.0.1:${port}/day_test?connection_limit=20`;
    execFileSync(process.execPath, [path.join(process.cwd(), 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {cwd: process.cwd(), env: {...process.env, DATABASE_URL: url}, timeout: 60000, stdio: 'pipe'});
    db = new PrismaClient({datasourceUrl: url});
    const client = db;
    for (const [slug, label] of [['events', 'Event Space'], ['workshops', 'Workshops'], ['webinars', 'Webinars'], ['meeting-rooms', 'Meeting Rooms'], ['photo-studio', 'Photo Studio'], ['podcast-studio', 'Podcast Studio']]) await client.serviceCategory.create({data: {slug, name: label}});
    const billing = new BillingService(client as never, stripeFixture() as never);
    const controller = new DayBlockAdminController(client as never);

    /* The migration ships both rules switched off. Turning them on is the admin's choice. */
    const seeded = (await controller.overview()).rules;
    assert.equal(seeded.length, 2);
    assert.ok(seeded.every(r => !r.enabled));
    for (const r of seeded) await controller.update(r.id, {name: r.name, enabled: true, triggerServices: r.triggerServices, blockedServices: r.blockedServices, reverse: r.reverse, countUnpaid: r.countUnpaid, note: r.note, expectedVersion: r.version}, admin);

    const line = (service: string, hours: number): PricedLine => ({planId: null, slug: service + '-pkg', name: service + ' package', description: service, currency: 'usd', unitAmount: 5000, quantity: hours, amount: 5000 * hours, billingType: 'ONE_TIME', interval: null, intervalCount: 1, metadata: {source: 'CATALOG', kind: 'PLAN', slug: service + '-pkg', serviceType: service, billingUnit: 'PER_HOUR', units: hours}});
    const book = async (service: string, startAt: string, hours = 2) => billing.createCheckout({customerName: 'Synthetic Buyer', customerEmail: 'buyer-' + randomUUID() + '@example.invalid', acceptAccountTerms: true, items: [{planSlug: service + '-pkg', quantity: hours, startAt}]} as never, await billing.totalsFor([line(service, hours)]));
    const pay = (orderId: string) => client.order.update({where: {id: orderId}, data: {status: 'PAID', paidAt: new Date()}});
    const rejects = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: any) => re.test(String(e?.response?.message ?? e?.message)));

    await t.test('event booked: rooms and studios closed that venue day, open the next', async () => {
      const ev = await book('events', '2090-05-06T15:00:00Z');
      await pay(ev.orderId);
      for (const s of ['meeting-rooms', 'photo-studio', 'podcast-studio']) await rejects(book(s, '2090-05-06T20:00:00Z'), /not available on .*Event Space is booked/);
      await book('meeting-rooms', '2090-05-07T15:00:00Z');
      /* 03:00 UTC on the 7th is still the evening of the 6th in Chicago. */
      await rejects(book('photo-studio', '2090-05-07T03:00:00Z'), /Event Space/);
    });

    await t.test('room booked first: event space and webinars closed, workshops still allowed', async () => {
      const room = await book('meeting-rooms', '2090-05-10T15:00:00Z');
      await pay(room.orderId);
      await rejects(book('events', '2090-05-10T18:00:00Z'), /Meeting Rooms is booked/);
      await rejects(book('webinars', '2090-05-10T18:00:00Z'), /Meeting Rooms/);
      await book('workshops', '2090-05-10T18:00:00Z');
    });

    await t.test('a live unpaid checkout holds the day; expired or cancelled ones do not', async () => {
      const pending = await book('events', '2090-05-12T15:00:00Z');
      await rejects(book('podcast-studio', '2090-05-12T18:00:00Z'), /Event Space/);
      await client.order.update({where: {id: pending.orderId}, data: {expiresAt: new Date(Date.now() - 1000)}});
      await book('podcast-studio', '2090-05-12T18:00:00Z');
      const cancelled = await book('workshops', '2090-05-13T15:00:00Z');
      await client.order.update({where: {id: cancelled.orderId}, data: {status: 'CANCELLED'}});
      await book('meeting-rooms', '2090-05-13T18:00:00Z');
    });

    await t.test('a booking that runs past midnight blocks the following day too', async () => {
      const late = await book('events', '2090-05-15T03:00:00Z', 4); // 22:00-02:00 Chicago, 14th into the 15th
      await pay(late.orderId);
      await rejects(book('meeting-rooms', '2090-05-15T16:00:00Z'), /Event Space/);
    });

    await t.test('two buyers racing for conflicting services on one day: exactly one wins', async () => {
      const before = await client.order.count();
      const results = await Promise.allSettled([book('events', '2090-05-20T15:00:00Z'), book('photo-studio', '2090-05-20T15:00:00Z')]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, JSON.stringify(results.map(r => r.status === 'rejected' ? String((r.reason as any)?.response?.message ?? r.reason) : 'ok')));
      assert.equal(await client.order.count(), before + 1, 'the losing order rolled back');
    });

    await t.test('closed days, the public calendar and disabling a rule', async () => {
      await controller.close({date: '2090-06-01', until: '2090-06-02', services: ['photo-studio'], reason: 'Maintenance'}, admin);
      await controller.close({date: '2090-06-03', services: []}, admin);
      await rejects(book('photo-studio', '2090-06-02T15:00:00Z'), /closed.*Maintenance/);
      await book('podcast-studio', '2090-06-02T15:00:00Z');
      await rejects(book('webinars', '2090-06-03T15:00:00Z'), /closed/);
      const days = await unavailableDays(client, 'photo-studio', '2090-05-30', '2090-06-04');
      assert.deepEqual(days.map(d => d.date), ['2090-06-01', '2090-06-02', '2090-06-03']);
      const check = await controller.check('meeting-rooms', '2090-05-06');
      assert.equal(check.conflicts.length, 1);
      const r1 = (await controller.overview()).rules.find(r => r.triggerServices.includes('events'))!;
      await rejects(controller.update(r1.id, {name: r1.name, enabled: false, triggerServices: r1.triggerServices, blockedServices: r1.blockedServices, expectedVersion: r1.version - 1}, admin), /Someone else changed/);
      await controller.update(r1.id, {name: r1.name, enabled: false, triggerServices: r1.triggerServices, blockedServices: r1.blockedServices, expectedVersion: r1.version}, admin);
      await book('meeting-rooms', '2090-05-06T20:00:00Z');
    });
  } finally {
    await db?.$disconnect().catch(() => undefined);
    spawnSync('docker', ['rm', '-f', name], {stdio: 'ignore', timeout: 30000});
  }
});
