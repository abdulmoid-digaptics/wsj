import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BillingService, BillingWebhookService} from '../src/billing';

// Local fakes only: no database, SMTP or Stripe requests.
test('paid order enqueue failure is retried and distinct webhook deliveries deduplicate', async () => {
  const old = process.env.FINANCE_NOTIFICATION_EMAIL;
  process.env.FINANCE_NOTIFICATION_EMAIL = 'finance@example.test';
  try {
    let order: any = {id: 'ord_1', status: 'PENDING', customerId: 'cus_1', dueNowAmount: 1000, currency: 'usd'};
    const journal = new Map<string, any>(); const queued = new Map<string, any>(); let fail = true;
    const db: any = {
      order: {findUnique: async () => ({...order}), updateMany: async ({data}: any) => {order = {...order, ...data}; return {count: 1};}},
      billingEvent: {create: async () => ({})},
      webhookEvent: {
        findUnique: async ({where}: any) => journal.get(where.stripeEventId),
        create: async ({data}: any) => {const j = {id: data.stripeEventId, ...data, status: 'PENDING'}; journal.set(j.id, j); return j;},
        update: async ({where, data}: any) => {const j = journal.get(where.id); Object.assign(j, data); return j;},
      },
    };
    const outbox: any = {enqueue: async (message: any) => {if (fail) {fail = false; throw new Error('temporary');} queued.set(message.dedupeKey, message); return {id: 'out_1', created: true};}};
    const billing = new BillingService(db, {} as any, outbox);
    const webhook = new BillingWebhookService(db, billing);
    const event = (id: string, type: string, payment_status = 'paid'): any => ({id, type, data: {object: {id: 'cs_1', metadata: {orderId: 'ord_1'}, payment_status}}});
    await assert.rejects(webhook.process(event('evt_1', 'checkout.session.completed')));
    assert.equal(order.status, 'PAID');
    await webhook.process(event('evt_1', 'checkout.session.completed'));
    await webhook.process(event('evt_2', 'checkout.session.async_payment_succeeded'));
    assert.equal(queued.size, 1);
    assert.deepEqual(queued.get('finance:order:ord_1:paid').payload, {event: 'order_paid', orderId: 'ord_1', amount: 1000, currency: 'usd', stripeRef: 'cs_1', status: 'paid'});
    await webhook.process(event('evt_3', 'checkout.session.completed', 'unpaid'));
    assert.equal(queued.size, 1);
  } finally { if (old === undefined) delete process.env.FINANCE_NOTIFICATION_EMAIL; else process.env.FINANCE_NOTIFICATION_EMAIL = old; }
});

test('invoice paid aliases share a key and failed invoices are distinct', async () => {
  const old = process.env.FINANCE_NOTIFICATION_EMAIL;
  process.env.FINANCE_NOTIFICATION_EMAIL = 'finance@example.test';
  try {
    const queued = new Map<string, any>();
    const db: any = {subscription: {findUnique: async () => null}, customer: {findUnique: async () => null}, invoice: {upsert: async () => ({customerId: 'customer-local'})}};
    const billing = new BillingService(db, {} as any, {enqueue: async (m: any) => {queued.set(m.dedupeKey, m); return {id: 'out_1', created: true};}} as any);
    const webhook: any = new BillingWebhookService(db, billing);
    const invoice: any = {id: 'in_1', currency: 'usd', amount_paid: 2500, amount_due: 2500};
    await webhook.onInvoicePaid(invoice); await webhook.onInvoicePaid(invoice); await webhook.onInvoiceFailed(invoice);
    assert.deepEqual([...queued.keys()], ['finance:invoice:in_1:paid', 'finance:invoice:in_1:payment_failed']);
    assert.equal(queued.get('finance:invoice:in_1:payment_failed').payload.status, 'payment_failed');
  } finally { if (old === undefined) delete process.env.FINANCE_NOTIFICATION_EMAIL; else process.env.FINANCE_NOTIFICATION_EMAIL = old; }
});


test('Stripe refund notices are limited to matched local payments and deduplicated by refund', async () => {
  const old = process.env.FINANCE_NOTIFICATION_EMAIL;
  process.env.FINANCE_NOTIFICATION_EMAIL = 'finance@example.invalid';
  try {
    const queued = new Map<string, any>();
    let match = true;
    const db: any = {order: {findFirst: async () => match ? {id: 'order-1'} : null}, booking: {findFirst: async () => null}};
    const billing = new BillingService(db, {} as any, {enqueue: async (entry: any) => {queued.set(entry.dedupeKey, entry); return {id: 'out-1', created: true};}} as any);
    const webhook: any = new BillingWebhookService(db, billing);
    const refund: any = {id: 're_1', payment_intent: 'pi_1', amount: 2500, currency: 'usd', status: 'succeeded'};
    await webhook.onRefundEvent(refund); await webhook.onRefundEvent(refund);
    assert.equal(queued.size, 1); assert.equal(queued.get('finance:order-refunded:re_1').payload.amount, 2500);
    match = false; await webhook.onRefundEvent({...refund, id: 're_unrelated'}); assert.equal(queued.size, 1);
  } finally { if (old === undefined) delete process.env.FINANCE_NOTIFICATION_EMAIL; else process.env.FINANCE_NOTIFICATION_EMAIL = old; }
});

test('unrelated Stripe invoices do not trigger finance alerts', async () => {
  const old = process.env.FINANCE_NOTIFICATION_EMAIL; process.env.FINANCE_NOTIFICATION_EMAIL = 'finance@example.invalid';
  try {
    let count = 0;
    const db: any = {subscription: {findUnique: async () => null}, customer: {findUnique: async () => null}, invoice: {upsert: async () => ({customerId: null, subscriptionId: null, orderId: null})}};
    const billing = new BillingService(db, {} as any, {enqueue: async () => {count++; return {id: 'out-1', created: true};}} as any);
    const webhook: any = new BillingWebhookService(db, billing);
    await webhook.onInvoicePaid({id: 'in_other', currency: 'usd', amount_paid: 700});
    assert.equal(count, 0);
  } finally { if (old === undefined) delete process.env.FINANCE_NOTIFICATION_EMAIL; else process.env.FINANCE_NOTIFICATION_EMAIL = old; }
});


test('failed checkout alert is retried after an outbox error and ignores mismatched sessions', async () => {
  const old=process.env.FINANCE_NOTIFICATION_EMAIL;process.env.FINANCE_NOTIFICATION_EMAIL='finance@example.invalid';
  try {
    let order:any={id:'order-1',status:'PENDING',customerId:'c-1',stripeCheckoutSessionId:'cs-1',dueNowAmount:5000,currency:'usd'};
    let fail=true;const queued:any[]=[];
    const db:any={order:{findUnique:async()=>({...order}),updateMany:async({data}:any)=>{order={...order,...data};return {count:1};}},billingEvent:{create:async()=>({})}};
    const billing=new BillingService(db,{} as any,{enqueue:async(entry:any)=>{if(fail){fail=false;throw Error('temporary');}queued.push(entry);return {id:'out-1',created:true};}} as any);
    const webhook:any=new BillingWebhookService(db,billing);const session:any={id:'cs-1',metadata:{orderId:'order-1'}};
    await assert.rejects(webhook.onCheckoutFailed(session));assert.equal(order.status,'FAILED');
    await webhook.onCheckoutFailed(session);await webhook.onCheckoutFailed({...session,id:'other-session'});
    assert.equal(queued.length,1);assert.equal(queued[0].payload.event,'order_payment_failed');
  } finally {if(old===undefined)delete process.env.FINANCE_NOTIFICATION_EMAIL;else process.env.FINANCE_NOTIFICATION_EMAIL=old;}
});


test('provider subscription cancellation alert retries without notifying for unlinked subscriptions', async () => {
  const old=process.env.FINANCE_NOTIFICATION_EMAIL;process.env.FINANCE_NOTIFICATION_EMAIL='finance@example.invalid';
  try {
    let linked=true, fail=true;const queued=new Map<string,any>();
    const billing=new BillingService({} as any,{} as any,{enqueue:async(entry:any)=>{if(fail){fail=false;throw Error('temporary');}queued.set(entry.dedupeKey,entry);return {id:'out-1',created:true};}} as any);
    (billing as any).syncSubscription=async()=>linked?{id:'local-sub'}:null;
    const webhook:any=new BillingWebhookService({} as any,billing);
    const sub:any={id:'sub-provider',status:'active',cancel_at_period_end:true,canceled_at:1234};
    await assert.rejects(webhook.onSubscriptionEvent(sub));await webhook.onSubscriptionEvent(sub);await webhook.onSubscriptionEvent(sub);
    assert.equal(queued.size,1);assert.equal([...queued.values()][0].payload.subscriptionId,'local-sub');
    linked=false;await webhook.onSubscriptionEvent({...sub,id:'unrelated'});assert.equal(queued.size,1);
  } finally {if(old===undefined)delete process.env.FINANCE_NOTIFICATION_EMAIL;else process.env.FINANCE_NOTIFICATION_EMAIL=old;}
});
