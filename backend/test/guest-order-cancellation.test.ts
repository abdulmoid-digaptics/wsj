import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BillingService} from '../src/billing';
import {GuestOrderCancellationController, UnpaidOrderCancellationService} from '../src/guest-order-cancellation';

function setup() {
 process.env.JWT_SECRET = 'test-secret-that-is-at-least-thirty-two-bytes';
 process.env.FRONTEND_URL = 'https://example.test';
 let row: any = {id:'o1',customerId:'c1',status:'PENDING',paymentMethod:'STRIPE',stripeCheckoutSessionId:'cs_1'};
 let session: any = {id:'cs_1',status:'open',payment_status:'unpaid'};
 let race = false; let refunds = 0; let calls = 0;
 const db: any = {order:{findUnique:async () => row && {...row},updateMany:async ({where,data}:any) => {if(race) row.status='PAID'; if(row.status!==where.status || row.stripeCheckoutSessionId!==where.stripeCheckoutSessionId) return {count:0}; Object.assign(row,data); return {count:1};}}};
 const payments: any = {client:()=>({checkout:{sessions:{retrieve:async()=>{calls++;return {...session}},expire:async()=>{session.status='expired';return {...session}}}},refunds:{create:async()=>{refunds++}}})};
 const billing = new BillingService(db,payments); (billing as any).record = async () => {};
 const service = new UnpaidOrderCancellationService(db,payments,billing);
 const controller = new GuestOrderCancellationController(db,{withLock:async (_:string,fn:any)=>fn()} as any,service,billing);
 const proof = billing.receiptProof('o1');
 const invoke = (headers:any = {'origin':'https://example.test','x-order-proof':proof}, id='o1') => controller.cancel(id,{headers},{setHeader:()=>{}});
 return {invoke,proof, row:()=>row, setRow:(v:any)=>Object.assign(row,v), setSession:(v:any)=>session=v, setRace:()=>race=true, refunds:()=>refunds,calls:()=>calls,billing};
}

test('valid order proof expires unpaid checkout and cancels',async()=>{const f=setup(); assert.deepEqual(await f.invoke(),{status:'CANCELLED'}); assert.equal(f.row().status,'CANCELLED')});
test('wrong, missing and expired proofs cannot cancel',async()=>{const f=setup(); for(const p of ['',f.billing.receiptProof('other')]) await assert.rejects(f.invoke({origin:'https://example.test','x-order-proof':p})); const real=Date.now; try {Date.now=()=>real()+2*3600000+1000; await assert.rejects(f.invoke())} finally {Date.now=real} assert.equal(f.calls(),0)});
test('untrusted or absent origin denied',async()=>{const f=setup(); for(const origin of ['https://evil.test',undefined]) await assert.rejects(f.invoke({origin,'x-order-proof':f.proof})); assert.equal(f.calls(),0)});
test('paid and processing orders never refund or cancel',async()=>{for(const status of ['PAID','PARTIALLY_PAID','EXPIRED']){const f=setup(); f.setRow({status}); await assert.rejects(f.invoke());assert.equal(f.refunds(),0);assert.equal(f.calls(),0)} const f=setup();f.setSession({id:'cs_1',status:'complete',payment_status:'unpaid'});await assert.rejects(f.invoke());assert.equal(f.row().status,'PENDING');assert.equal(f.refunds(),0)});
test('CAS refuses concurrent payment',async()=>{const f=setup();f.setRace();await assert.rejects(f.invoke());assert.equal(f.row().status,'PAID');assert.equal(f.refunds(),0)});
