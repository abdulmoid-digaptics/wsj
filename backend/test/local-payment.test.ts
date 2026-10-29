import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BookingController,BookingAdminController} from '../src/booking';
import {PaymentClient} from '../src/payments';
const {createLocalPaymentFixture}=require('../../scripts/qa/local-payment-fixture.cjs');
test('actual booking controller uses authoritative prices and isolated checkout transport',async()=>{
 const fixture=createLocalPaymentFixture('http://localhost:3100');let record:any;const writes:any[]=[];
 const db:any={booking:{create:async({data}:any)=>{record={id:'local-booking',...data};writes.push(data);return record;},update:async({data}:any)=>Object.assign(record,data),delete:async()=>{record=undefined;}}};
 const previous=process.env.FRONTEND_URL;process.env.FRONTEND_URL='http://localhost:3100';
 try{
  const result=await new BookingController(db,fixture).create({customerName:'Local fixture',customerEmail:'local@example.invalid',serviceType:'qa',serviceName:'Local fixture',planId:'silver',addOns:['printing']} as any);
  assert.equal(result.status,'pending_payment');assert.equal(new URL(result.checkoutUrl!).origin,'http://localhost:3100');
  assert.equal(writes[0].subtotalPrice,100);assert.equal(writes[0].totalPrice,115);assert.equal(record.status,'PENDING');
  assert.deepEqual(fixture.calls.map((x:any)=>x.kind),['checkout']);
  assert.equal(fixture.calls[0].input.line_items[0].price_data.unit_amount,10000);assert.equal(fixture.calls[0].input.line_items[1].price_data.unit_amount,1500);
 }finally{if(previous===undefined)delete process.env.FRONTEND_URL;else process.env.FRONTEND_URL=previous;}
});
test('checkout fixture failure removes its pending record',async()=>{
 let removed=0;const db:any={booking:{create:async()=>({id:'local'}),delete:async()=>{removed++;}}};
 const previous=process.env.FRONTEND_URL;process.env.FRONTEND_URL='http://localhost:3100';
 try{await assert.rejects(()=>new BookingController(db,{client:()=>({checkout:{sessions:{create:async()=>{throw new Error('fixture unavailable');}}}})} as any).create({customerName:'Local',customerEmail:'local@example.invalid',serviceType:'qa',serviceName:'Local',planId:'silver'} as any));assert.equal(removed,1);}
 finally{if(previous===undefined)delete process.env.FRONTEND_URL;else process.env.FRONTEND_URL=previous;}
});
test('refund fixture rejects nonlocal intents and creates deterministic local refunds',async()=>{
 const fixture=createLocalPaymentFixture('http://localhost:3100');const client=fixture.client();
 await assert.rejects(()=>client.refunds.create({payment_intent:'pi_external'}));
 const a=await client.refunds.create({payment_intent:'pi_local_fixture'});const b=await client.refunds.create({payment_intent:'pi_local_fixture'});assert.equal(a.id,b.id);assert.match(a.id,/^re_local_/);
});
test('production provider cannot select fixture when Stripe key is absent',()=>{
 const old=process.env.STRIPE_SECRET_KEY;delete process.env.STRIPE_SECRET_KEY;
 try{assert.throws(()=>new PaymentClient().client(),/Payments are not configured/);}
 finally{if(old!==undefined)process.env.STRIPE_SECRET_KEY=old;}
});
