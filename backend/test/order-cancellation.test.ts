import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AccountService} from '../src/account';
import {BillingService} from '../src/billing';
import {fakeDb} from './billing-fixture';

function setup() {
 const db = fakeDb();
 const calls: any[] = [];
 let session: any = {id: 'cs_1', status: 'open', payment_status: 'unpaid'};
 let chargeCreated = Math.floor(Date.now() / 1000);
 let refundStatus = 'succeeded';
 let failRefund = false;
 const stripe = {
  checkout: {sessions: {retrieve: async () => ({...session}), expire: async () => {calls.push('expire'); session = {...session, status: 'expired'}; return {...session};}}},
  paymentIntents: {retrieve: async () => ({id: 'pi_1', status: 'succeeded', latest_charge: {amount_captured: 1000, amount_refunded: 0, currency: 'usd', created: chargeCreated}})},
  refunds: {create: async (params: any, options: any) => {calls.push({params, options}); if (failRefund) throw Error('network'); return {id: 're_1', amount: 1000, status: refundStatus};}},
 };
 const payment = {client: () => stripe};
 const billing = new BillingService(db, payment as never);
 const cards = {ownedIds: async (id: string) => [id], withLock: async (_id: string, work: () => Promise<any>) => work()};
 const service = new AccountService(db, payment as never, billing, cards as never, {} as never);
 const create = async (extra: any = {}) => db.order.create({data: {id: 'order1', customerId: 'customer1', status: 'PAID', mode: 'PAYMENT', currency: 'usd', dueNowAmount: 1000, recurringAmount: 0, paymentMethod: 'STRIPE', stripePaymentIntentId: 'pi_1', stripeCheckoutSessionId: 'cs_1', paidAt: new Date(), ...extra}});
 return {db, service, calls, create, setSession: (s: any) => session = s, setFail: () => failRefund = true, setRefundStatus: (s: string) => refundStatus = s, setChargeCreated: (s: number) => chargeCreated = s};
}

test('ownership is required before any Stripe call', async () => {
 const f = setup(); await f.create(); await assert.rejects(f.service.cancelOrder('other', 'order1')); assert.equal(f.calls.length, 0);
});
test('unpaid checkout is expired before cancellation', async () => {
 const f = setup(); await f.create({status: 'PENDING'}); assert.deepEqual(await f.service.cancelOrder('customer1','order1'), {status:'CANCELLED'}); assert.deepEqual(f.calls,['expire']); assert.equal(f.db.order.rows[0].status,'CANCELLED');
});
test('completed payment race does not cancel or refund', async () => {
 const f = setup(); await f.create({status:'PENDING'}); f.setSession({id:'cs_1',status:'complete',payment_status:'paid'}); await assert.rejects(f.service.cancelOrder('customer1','order1')); assert.equal(f.db.order.rows[0].status,'PENDING'); assert.equal(f.calls.length,0);
});
test('paid one-time order is fully refunded once with deterministic Stripe idempotency', async () => {
 const f = setup(); await f.create(); assert.equal((await f.service.cancelOrder('customer1','order1')).status,'CANCELLED'); await f.service.cancelOrder('customer1','order1'); assert.equal(f.calls.length,1); assert.equal(f.calls[0].options.idempotencyKey,'order-full-refund:order1'); assert.equal(f.calls[0].params.amount,1000);
});
test('out of window and recurring orders cannot refund', async () => {
 for (const extra of [{paidAt:new Date(Date.now()-5*86400000-1000)}, {mode:'SUBSCRIPTION',recurringAmount:1000}]) {const f=setup(); await f.create(extra); await assert.rejects(f.service.cancelOrder('customer1','order1')); assert.equal(f.calls.length,0);}
});
test('uncertain and pending refunds never auto retry', async () => {
 for (const pending of [false,true]) {const f=setup(); await f.create(); if(pending) f.setRefundStatus('pending'); else f.setFail(); await assert.rejects(f.service.cancelOrder('customer1','order1')); await assert.rejects(f.service.cancelOrder('customer1','order1')); assert.equal(f.calls.length,1); assert.equal(f.db.order.rows[0].status,'PAID');}
});


test('delayed payment webhook cannot extend the five-day refund window', async () => {
 const f = setup(); await f.create(); f.setChargeCreated(Math.floor(Date.now() / 1000) - 5 * 86400 - 60);
 await assert.rejects(f.service.cancelOrder('customer1', 'order1')); assert.equal(f.calls.length, 0);
});
