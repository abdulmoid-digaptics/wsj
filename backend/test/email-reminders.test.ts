import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ReminderService} from '../src/reminders';
import {emailBody} from '../src/marketing-email';
import {AccountService} from '../src/account';

const outbox = () => { const q: any[] = []; return {q, enqueue: async (e: any) => { q.push(e); return {id: 'o' + q.length, created: true}; }}; };

test('booking reminders go to paid bookings within a day, respecting the preference', async () => {
  const start = new Date(Date.now() + 20 * 3600000);
  const ob = outbox();
  const db: any = {
    $queryRaw: async () => [{orderId: 'o1', customerId: 'c1', startAt: start, planSlug: 'room'}, {orderId: 'o2', customerId: 'c2', startAt: start, planSlug: 'room'}],
    customer: {findUnique: async ({where}: any) => ({id: where.id, email: where.id + '@example.com', name: 'Ann', notificationPrefs: where.id === 'c2' ? {bookingReminders: false} : {}, mergedIntoId: null})},
    orderItem: {findFirst: async () => ({description: 'Board Room', quantity: 3, metadata: {billingUnit: 'PER_HOUR'}})},
  };
  const n = await new ReminderService(db, ob as never).bookingReminders();
  assert.equal(n, 1, 'opted-out customer skipped');
  assert.equal(ob.q[0].template, 'booking_reminder');
  assert.equal(ob.q[0].payload.serviceName, 'Board Room');
  assert.equal(ob.q[0].payload.duration, '3 hours');
  assert.match(ob.q[0].dedupeKey, /^booking-reminder:o1:/);
});

test('renewal reminders: 3 days before monthly, 7 before yearly, never for cancelling plans', async () => {
  const now = new Date('2027-01-10T12:00:00Z');
  const day = 86400000;
  const subs = [
    {id: 'm-soon', interval: 'MONTH', currentPeriodEnd: new Date(now.getTime() + 2 * day)},
    {id: 'm-later', interval: 'MONTH', currentPeriodEnd: new Date(now.getTime() + 5 * day)},
    {id: 'y-soon', interval: 'YEAR', currentPeriodEnd: new Date(now.getTime() + 6 * day)},
  ].map(s => ({...s, customerId: 'c1', intervalCount: 1, unitAmount: 2500, quantity: 1, currency: 'usd', plan: {name: 'Business Address'}, order: null}));
  let where: any;
  const ob = outbox();
  const db: any = {subscription: {findMany: async (a: any) => { where = a.where; return subs; }}, customer: {findUnique: async () => ({id: 'c1', email: 'a@example.com', name: 'Ann', notificationPrefs: {}, mergedIntoId: null})}};
  await new ReminderService(db, ob as never).renewalReminders(now);
  assert.equal(where.cancelAtPeriodEnd, false);
  assert.deepEqual(ob.q.map(e => e.dedupeKey.split(':')[1]), ['m-soon', 'y-soon']);
  assert.equal(ob.q[0].payload.amount, '$25.00');
});

test('campaign emails make site links and images absolute', () => {
  const html = emailBody('<p><a href="/coworking/">Coworking</a> <a href="https://x.test/a">ext</a></p><figure data-type="image"><img src="/media/a.png" alt=""></figure>', 'https://workspacejunction.com');
  assert.match(html, /href="https:\/\/workspacejunction\.com\/coworking\/"/);
  assert.match(html, /src="https:\/\/workspacejunction\.com\/media\/a\.png"/);
  assert.match(html, /href="https:\/\/x\.test\/a"/);
});

test('turning marketing off in the account unsubscribes the email from the marketing list', async () => {
  const calls: any[] = [];
  const db: any = {
    customer: {findUnique: async () => ({id: 'c1', email: 'Ann@Example.com', name: 'Ann', notificationPrefs: {}}), update: async () => ({})},
    subscriber: {updateMany: async (a: any) => { calls.push(['off', a]); return {count: 1}; }, upsert: async (a: any) => { calls.push(['on', a]); return {}; }},
  };
  const service = Object.assign(Object.create(AccountService.prototype), {db, profile: async () => ({})});
  await service.updatePreferences('c1', {marketingOptIn: false});
  assert.equal(calls[0][0], 'off');
  assert.equal(calls[0][1].where.emailKey, 'ann@example.com');
  await service.updatePreferences('c1', {marketingOptIn: true});
  assert.equal(calls[1][0], 'on');
  assert.equal(calls[1][1].create.status, 'SUBSCRIBED');
});
