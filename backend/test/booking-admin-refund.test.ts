import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BookingAdminController} from '../src/booking';

function fixture(result:any={id:'re_1',status:'succeeded'},outbox?:any){
 let item:any={id:'booking-1',status:'CONFIRMED',stripePaymentIntentId:'pi_1',stripeResponse:{checkoutSessionId:'cs_1'},updatedAt:new Date('2026-01-01')};
 const calls:any[]=[]; let failUpdate=false;
 const db:any={booking:{
  findUnique:async()=>({...item}),
  updateMany:async({where,data}:any)=>{if(where.updatedAt!==item.updatedAt||where.status!==item.status||where.stripePaymentIntentId!==item.stripePaymentIntentId)return {count:0}; item={...item,...data,updatedAt:new Date(item.updatedAt.getTime()+1)};return {count:1};},
  update:async({data}:any)=>{if(failUpdate)throw Error('database unavailable');item={...item,...data};return item;},
 },audit:{create:async()=>({})}};
 const payments:any={client:()=>({refunds:{create:async(...args:any[])=>{calls.push(args);if(result instanceof Error)throw result;return result;}}})};
 const controller=new BookingAdminController(db,payments,outbox);
 return {controller,calls,get item(){return item;},setItem(value:any){item={...item,...value};},failUpdate(){failUpdate=true;},recoverUpdate(){failUpdate=false;}};
}
const request:any={user:{id:'admin'}};
const refund=(f:ReturnType<typeof fixture>)=>f.controller.update('booking-1',{status:'REFUNDED'} as any,request);

test('successful refund uses a stable payment-intent key and persists only succeeded state',async()=>{
 const f=fixture();const updated=await refund(f);
 assert.equal(updated.status,'REFUNDED');assert.equal((updated.stripeResponse as any).refundId,'re_1');
 assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0][0],{payment_intent:'pi_1'});
 assert.match(f.calls[0][1].idempotencyKey,/^legacy-booking-refund-[a-f0-9]{64}$/);
 const second=fixture();await refund(second);assert.equal(second.calls[0][1].idempotencyKey,f.calls[0][1].idempotencyKey);
 await refund(f);assert.equal(f.calls.length,1);
});

test('timeout is unknown and retry is blocked without a second Stripe call',async()=>{
 const f=fixture(new Error('timeout'));await assert.rejects(refund(f),/outcome unknown/);
 assert.equal(f.item.status,'CONFIRMED');assert.ok(f.item.stripeResponse.refundAttempt);
 await assert.rejects(refund(f),/manual reconciliation/);assert.equal(f.calls.length,1);
});

test('pending, failed and missing refund states are not marked refunded or retried',async()=>{
 for(const status of ['pending','failed','canceled',null,undefined]){
  const f=fixture({id:'re_1',status});await assert.rejects(refund(f),/not confirmed/);
  assert.equal(f.item.status,'CONFIRMED');await assert.rejects(refund(f),/manual reconciliation/);assert.equal(f.calls.length,1);
 }
});

test('database failure after successful Stripe response leaves an attempt that blocks retry',async()=>{
 const f=fixture();f.failUpdate();await assert.rejects(refund(f),/database unavailable/);f.recoverUpdate();
 assert.equal(f.item.status,'CONFIRMED');await assert.rejects(refund(f),/manual reconciliation/);assert.equal(f.calls.length,1);
});

test('existing refund evidence blocks new Stripe calls',async()=>{
 for(const evidence of [{refundId:'re_old'},{refundAttempt:{startedAt:'old'}}]){
  const f=fixture();f.setItem({stripeResponse:evidence});await assert.rejects(refund(f),/manual reconciliation/);assert.equal(f.calls.length,0);
 }
});

test('concurrent attempts are claimed once',async()=>{
 const f=fixture();const results=await Promise.allSettled([refund(f),refund(f)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.calls.length,1);
});

test('missing payment prevents Stripe calls',async()=>{
 const f=fixture();f.setItem({stripePaymentIntentId:null});await assert.rejects(refund(f),/No payment/);assert.equal(f.calls.length,0);
});


test('confirmed booking refund queues one internal notice with the real amount',async()=>{
 const old=process.env.FINANCE_NOTIFICATION_EMAIL; process.env.FINANCE_NOTIFICATION_EMAIL='finance@example.invalid';
 const queued:any[]=[];const outbox={enqueue:async(entry:any)=>{queued.push(entry);return {id:'mail-1',created:true};}};
 try {const f=fixture({id:'re_1',status:'succeeded',amount:12500,currency:'usd'},outbox);await refund(f);await refund(f);assert.equal(queued.length,1);assert.equal(queued[0].to,'finance@example.invalid');assert.equal(queued[0].payload.event,'booking_refunded');assert.equal(queued[0].payload.amount,12500);assert.equal(queued[0].dedupeKey,'finance:booking-refunded:re_1');}
 finally {if(old===undefined) delete process.env.FINANCE_NOTIFICATION_EMAIL; else process.env.FINANCE_NOTIFICATION_EMAIL=old;}
});
