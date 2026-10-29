import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {StripeWebhookController} from '../src/booking';
// Actual controller and SDK signature verification, fake DB only. No .env,
// network, SMTP, database, provider objects or real credentials are accessed.
const fixtureSecret='whsec_local_pure_fixture';
async function deliver(db:any,event:any,signatureValid=true){
 const oldKey=process.env.STRIPE_SECRET_KEY,oldSecret=process.env.STRIPE_WEBHOOK_SECRET,oldSmtp=process.env.SMTP_HOST;
 delete process.env.SMTP_HOST; // Pure fixture must never deliver mail.
 process.env.STRIPE_SECRET_KEY='sk_test_local_pure_fixture';
 process.env.STRIPE_WEBHOOK_SECRET=fixtureSecret;
 const payload=JSON.stringify(event),sdk=new Stripe('sk_test_local_pure_fixture');
 const signature=signatureValid?sdk.webhooks.generateTestHeaderString({payload,secret:fixtureSecret}):'invalid';
 const response:any={code:0,body:null,status(code:number){this.code=code;return this;},json(body:any){this.body=body;return this;}};
 try{
  await new StripeWebhookController(db).handle({rawBody:Buffer.from(payload)} as any,signature,response);
  return response;
 }finally{
  if(oldKey===undefined)delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=oldKey;
  if(oldSecret===undefined)delete process.env.STRIPE_WEBHOOK_SECRET;else process.env.STRIPE_WEBHOOK_SECRET=oldSecret;
  if(oldSmtp===undefined)delete process.env.SMTP_HOST;else process.env.SMTP_HOST=oldSmtp;
 }
}
const paid=()=>({id:'evt_local_fixture',object:'event',type:'checkout.session.completed',data:{object:{id:'cs_local_fixture',metadata:{bookingId:'local-booking'},payment_status:'paid',payment_intent:'pi_local_fixture',amount_total:10000}}});
test('database lookup failure returns retryable 503, never false success',async()=>{
 const result=await deliver({booking:{findUnique:async()=>{throw new Error('private DB diagnostic');}}},paid());
 assert.equal(result.code,503);assert.equal(result.body.received,false);
 assert.ok(!JSON.stringify(result.body).includes('private DB diagnostic'));
});
test('failed confirmation save returns retryable 503',async()=>{
 let attemptedStatus:string|undefined;
 const result=await deliver({booking:{findUnique:async()=>({status:'PENDING',serviceName:'Local fixture',totalPrice:100}),update:async(args:any)=>{attemptedStatus=args.data.status;throw new Error('write failed');}}},paid());
 assert.equal(attemptedStatus,'CONFIRMED');assert.equal(result.code,503);assert.equal(result.body.received,false);
});
test('duplicate confirmed payment is acknowledged without another update',async()=>{
 let writes=0;
 const result=await deliver({booking:{findUnique:async()=>({status:'CONFIRMED'}),update:async()=>{writes++;}}},paid());
 assert.equal(result.code,200);assert.equal(result.body.received,true);assert.equal(writes,0);
});
test('invalid signature is rejected before the database is touched',async()=>{
 let reads=0;
 const result=await deliver({booking:{findUnique:async()=>{reads++;}}},paid(),false);
 assert.equal(result.code,400);assert.equal(reads,0);
});
