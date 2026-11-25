import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {enqueueFinanceNotification, renderMail, type FinanceNotificationMetadata} from '../src/mail';

test('finance notifications are opt-in, allowlisted and deduplicated by the caller key', async () => {
  const original = process.env.FINANCE_NOTIFICATION_EMAIL;
  const entries: any[] = [];
  const seen = new Map<string, string>();
  const outbox = {enqueue: async (entry: any) => {
    entries.push(entry);
    const id = seen.get(entry.dedupeKey);
    if (id) return {id, created: false};
    seen.set(entry.dedupeKey, 'row-1');
    return {id: 'row-1', created: true};
  }};
  try {
    delete process.env.FINANCE_NOTIFICATION_EMAIL;
    assert.equal(await enqueueFinanceNotification(outbox, {event: 'payment.succeeded'}, 'stable'), null);
    process.env.FINANCE_NOTIFICATION_EMAIL = '   ';
    assert.equal(await enqueueFinanceNotification(outbox, {event: 'payment.succeeded'}, 'stable'), null);
    assert.equal(entries.length, 0);
    process.env.FINANCE_NOTIFICATION_EMAIL = ' finance@example.invalid ';
    const metadata = {event: 'payment.succeeded', orderId: 'ord_123', bookingId: 'book_1', invoiceId: 'in_1', subscriptionId: 'sub_1', amount: 1234, currency: 'usd', stripeRef: 'pi_123', status: 'succeeded', secret: 'sk_test_hidden', nested: {token: 'hidden'}} as FinanceNotificationMetadata;
    assert.deepEqual(await enqueueFinanceNotification(outbox, metadata, 'payment:123'), {id: 'row-1', created: true});
    assert.deepEqual(await enqueueFinanceNotification(outbox, metadata, 'payment:123'), {id: 'row-1', created: false});
    assert.deepEqual(entries[0], {to: 'finance@example.invalid', template: 'finance_notification', dedupeKey: 'payment:123', payload: {event: 'payment.succeeded', orderId: 'ord_123', bookingId: 'book_1', invoiceId: 'in_1', subscriptionId: 'sub_1', currency: 'usd', stripeRef: 'pi_123', status: 'succeeded', amount: 1234}});
    const rendered = await renderMail({} as never, {customerId: null, template: entries[0].template, payload: entries[0].payload});
    assert.match(rendered.text, /Event: payment\.succeeded/);
    assert.match(rendered.text, /Amount: \$12\.34/);
    assert.match(rendered.text, /Stripe reference: pi_123/);
    assert.doesNotMatch(rendered.text, /sk_test_hidden|nested|token/);
    assert.equal(rendered.subject, 'Workspace Junction: Finance activity');
    await assert.rejects(enqueueFinanceNotification(outbox, {event: 'x'}, '  '), /dedupe key/);
    await assert.rejects(enqueueFinanceNotification(outbox, {event: 'x', stripeRef: 'sk_test_secret'}, 'k'), /invalid finance/);
    await assert.rejects(enqueueFinanceNotification(outbox, {event: 'x', amount: 1.5}, 'k'), /invalid finance/);
    assert.equal(entries.length, 2);
  } finally {
    if (original === undefined) delete process.env.FINANCE_NOTIFICATION_EMAIL; else process.env.FINANCE_NOTIFICATION_EMAIL = original;
  }
});

test('finance alerts go to every listed recipient, one message each', async () => {
  const previous = process.env.FINANCE_NOTIFICATION_EMAIL;
  process.env.FINANCE_NOTIFICATION_EMAIL = 'a@example.com, b@example.com;a@example.com';
  const calls: Array<{to: string; dedupeKey?: string | null}> = [];
  const outbox = {enqueue: async (entry: {to: string; dedupeKey?: string | null}) => { calls.push(entry); return {id: 'row-' + calls.length, created: true}; }};
  try {
    assert.deepEqual(await enqueueFinanceNotification(outbox as never, {event: 'payment.succeeded'}, 'pay:1'), {id: 'row-1', created: true});
    assert.deepEqual(calls.map(c => [c.to, c.dedupeKey]), [['a@example.com', 'pay:1'], ['b@example.com', 'pay:1:b@example.com']]);
  } finally {
    if (previous === undefined) delete process.env.FINANCE_NOTIFICATION_EMAIL; else process.env.FINANCE_NOTIFICATION_EMAIL = previous;
  }
});
