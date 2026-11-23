import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createECDH, randomBytes} from 'node:crypto';
import {NotificationGuard, NotificationService, safePushEndpoint} from '../src/notifications';
import {ReminderService} from '../src/reminders';

const endpoint = 'https://fcm.googleapis.com/fcm/send/subscription';
const actor = {customerId: 'a'};

 test('push targets are restricted to trusted HTTPS provider paths', () => {
  for (const url of [endpoint, 'https://updates.push.services.mozilla.com/wpush/v2/some-token', 'https://web.push.apple.com/Qtoken', 'https://wns2-par02p.notify.windows.com/w/token']) assert.equal(safePushEndpoint(url), url);
  for (const url of ['https://localhost/a', 'http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com.evil.test/fcm/send/x', 'https://fcm.googleapis.com:443/fcm/send/x', 'https://fcm.googleapis.com@evil.test/fcm/send/x', 'https://fcm.googleapis.com/fcm/send/%2e%2e/admin', 'https://fcm.googleapis.com/fcm/send/a#x', 'https://0.0.0.999/x']) assert.equal(safePushEndpoint(url), null, url);
});

 test('audience selects the existing session guard and never falls back to the other principal', async () => {
  const guards = new NotificationGuard({canActivate: async (ctx: any) => {ctx.switchToHttp().getRequest().user = {id: 'staff'}; return true;}} as any, {canActivate: async (ctx: any) => {ctx.switchToHttp().getRequest().customer = {id: 'account'}; return true;}} as any);
  const req: any = {headers: {}, cookies: {access_token: 'staff-cookie', wsj_customer: 'customer-cookie'}};
  const ctx: any = {switchToHttp: () => ({getRequest: () => req, getResponse: () => ({setHeader() {}})})};
  await guards.canActivate(ctx); assert.deepEqual(req.notificationOwner, {customerId: 'account'});
  req.headers['x-wsj-audience'] = 'staff'; await guards.canActivate(ctx); assert.deepEqual(req.notificationOwner, {userId: 'staff'});
  req.headers['x-wsj-audience'] = 'other'; await assert.rejects(guards.canActivate(ctx), (e: any) => e.getStatus() === 400);
});

 test('device renewal requires an owned old endpoint and preserves its topics', async () => {
  const old = endpoint + '-old';
  const rows = new Map([[old, {id: 'old', endpoint: old, customerId: 'a', topics: ['billing']}]]);
  const db: any = {pushSubscription: {
    findFirst: async ({where}: any) => {const row = rows.get(where.endpoint); return row?.customerId === where.customerId ? row : null;},
    deleteMany: async ({where}: any) => {let count = 0; for (const [k,row] of rows) if (row.id === where.id && row.customerId === where.customerId) {rows.delete(k); count++;} return {count};},
    create: async ({data}: any) => {if (rows.has(data.endpoint)) throw {code: 'P2002'}; rows.set(data.endpoint, {...data, id: 'new'});},
  }};
  db.$transaction = (fn: any) => fn(db);
  const service = new NotificationService(db);
  service.publicKey = () => 'test-only';
  const keys = {p256dh: createECDH('prime256v1').generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url')};
  await assert.rejects(service.subscribe({customerId: 'b'}, {endpoint, keys, previousEndpoint: old}), (e: any) => e.getStatus() === 409);
  assert.equal(rows.size, 1);
  await service.subscribe(actor, {endpoint, keys, previousEndpoint: old});
  assert.deepEqual(rows.get(endpoint)?.topics, ['billing']);
  assert.equal(rows.has(old), false);
  await assert.rejects(service.subscribe({customerId: 'b'}, {endpoint, keys}), (e: any) => e.getStatus() === 409);
  assert.equal(rows.get(endpoint)?.customerId, 'a');
});

 test('confirmation uses verified ownership and deduplicates without outbound sends', async () => {
  const seen = new Map();
  const svc = new NotificationService({customer: {findUnique: async ({where}: any) => where.id === 'shadow' ? {id: 'shadow', mergedIntoId: 'a'} : {id: 'a', mergedIntoId: null}}, notificationRecord: {create: async ({data}: any) => {if (seen.has(data.dedupeKey)) throw {code: 'P2002'}; seen.set(data.dedupeKey, data); return {id: 'notification'};}}} as any);
  const order = {id: 'order', customerId: 'shadow', metadata: {schedule: [{startAt: '2026-11-21T18:00:00Z'}]}};
  const old = process.env.WEB_PUSH_DELIVERY; process.env.WEB_PUSH_DELIVERY = 'off';
  try {
    assert.equal(await svc.bookingConfirmed({id: 'guest-legacy'}), false);
    assert.equal(await svc.paidBookingConfirmed(order, 'lost'), false);
    assert.equal(await svc.paidBookingConfirmed(order, 'confirmed'), true);
    assert.equal(await svc.paidBookingConfirmed(order, 'confirmed'), false);
    assert.equal(seen.get('customer:a:order-booking-confirmed:order')?.customerId, 'a');
  } finally { if (old === undefined) delete process.env.WEB_PUSH_DELIVERY; else process.env.WEB_PUSH_DELIVERY = old; }
});

 test('one-hour sweep supplies exact near-future bounds and converts legacy venue times', async () => {
  const now = new Date('2026-11-21T18:00:00Z');
  const emitted: string[] = [];
  const db: any = {$queryRaw: async (_query: unknown, ...bounds: Date[]) => {assert.deepEqual(bounds.map(t => t.toISOString()), ['2026-11-21T18:45:00.000Z','2026-11-21T19:00:00.000Z','2026-11-21T18:45:00.000Z','2026-11-21T19:00:00.000Z']); return [{id: 'order:r', customerId: 'a', startAt: bounds[1]}];}, booking: {findMany: async () => [{id: 'b', customerId: 'a', bookingDate: '2026-11-21', bookingTime: '13:00'}, {id: 'early', customerId: 'a', bookingDate: '2026-11-21', bookingTime: '12:30'}]}};
  const reminders = new ReminderService(db, {} as any, {bookingReminder: async (r: any) => {emitted.push(r.id); return true;}} as any);
  assert.equal(await reminders.oneHourReminders(now), 2);
  assert.deepEqual(emitted, ['order:r', 'legacy:b']);
});

 test('push fan-out reaches every eligible device in bounded pages even when a stale device is deleted', async () => {
  const sent: string[] = [];
  const pages: number[] = [];
  const rows = Array.from({length: 47}, (_, i) => ({id: String(i + 1).padStart(2, '0'), endpoint: `${endpoint}-${i}`, auth: 'fixture', p256dh: 'fixture', updatedAt: new Date(0)}));
  const db = {pushSubscription: {
    async findMany({where, take}: {where: {id?: {gt: string}}; take: number}) {
      const page = rows.filter(row => !where.id || row.id > where.id.gt).slice(0, take);
      pages.push(page.length);
      return page;
    },
    async deleteMany({where}: {where: {id: string}}) {
      const index = rows.findIndex(row => row.id === where.id);
      if (index !== -1) rows.splice(index, 1);
      return {count: index === -1 ? 0 : 1};
    },
  }};
  const service = new NotificationService(db as unknown as ConstructorParameters<typeof NotificationService>[0]);
  await service['deliver'](actor, {id: 'row', type: 'BOOKING_CONFIRMED', title: 'Confirmed', body: 'Booked', url: '/account/bookings'}, {
    vapidDetails: {subject: 'mailto:qa@example.invalid', publicKey: '', privateKey: ''},
    client: {async sendNotification(device: {endpoint: string}) {
      sent.push(device.endpoint);
      if (device.endpoint === `${endpoint}-19`) throw {statusCode: 410};
    }},
  });
  assert.equal(new Set(sent).size, 47);
  assert.deepEqual(pages, [20, 20, 7]);
  assert.equal(rows.some(row => row.id === '20'), false);
});
