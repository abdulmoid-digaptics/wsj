import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderCancellationEligibility as eligibility} from '../../lib/order-cancellation.ts';

const now = Date.parse('2026-11-18T12:00:00Z');
const paid = {status: 'PAID', mode: 'PAYMENT', paymentMethod: 'STRIPE', paidAt: '2026-11-17T12:00:00Z', recurringAmount: 0, dueNowAmount: 1000, items: [{billingType: 'ONE_TIME'}], subscriptionIds: []};

test('allows preliminary checks for pending Stripe and eligible one-time payments', () => {
  assert.equal(eligibility({status: 'PENDING', paymentMethod: 'STRIPE'}, now).allowed, true);
  assert.equal(eligibility(paid, now).allowed, true);
  assert.equal(eligibility({...paid, paidAt: '2026-11-13T12:00:00Z'}, now).allowed, true);
});
test('does not offer paid cancellation outside the window or with unverifiable dates', () => {
  for (const paidAt of ['2026-11-13T11:59:59Z', '2026-11-19T12:00:00Z', 'invalid', null]) assert.equal(eligibility({...paid, paidAt}, now).allowed, false);
});
test('blocks recurring, non-Stripe, missing data, zero payment and terminal orders', () => {
  for (const change of [{mode: 'SUBSCRIPTION'}, {recurringAmount: 1}, {items: [{billingType: 'RECURRING'}]}, {subscriptionIds: ['sub']}, {paymentMethod: 'CASH'}, {dueNowAmount: 0}, {items: undefined}, {subscriptionIds: undefined}, {status: 'CANCELLED'}]) assert.equal(eligibility({...paid, ...change}, now).allowed, false);
});
