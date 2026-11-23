import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {PrismaClient} from '@prisma/client';
import {BillingService,BillingWebhookService,type PricedLine} from '../src/billing';
import {BookingRuleAdminController} from '../src/booking-rule-admin';
import {ReservationPolicyAdminController} from '../src/reservation-policy-admin';
import {ResourceInventory} from '../src/resource-inventory';
import {makeEvent,stripeFixture} from './billing-fixture';

process.env.JWT_SECRET=process.env.JWT_SECRET||'test-jwt-secret-value-that-is-long-enough-123456';
process.env.FRONTEND_URL='http://localhost:3100';
const enabled=process.env.INVENTORY_TEST_DOCKER==='1';
const admin={user:{id:'synthetic-admin'}};

// Disposable database and fake Stripe only. No real customer data, email or payment.
test('checkout holds inventory with the order and settles it from payment events',{skip:enabled?false:'set INVENTORY_TEST_DOCKER=1',timeout:240000},async t=>{
 const docker=(...args:string[])=>execFileSync('docker',args,{encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe']}).trim();
 const name='wsj-inventory-checkout-'+randomUUID(),password=randomUUID();
 const container=docker('run','--pull=never','--detach','--rm','--name',name,'--tmpfs','/var/lib/postgresql/data','-e',`POSTGRES_PASSWORD=${password}`,'-e','POSTGRES_DB=checkout_test','-p','127.0.0.1::5432','postgres:16-alpine');
 const previous=process.env.INVENTORY_CHECKOUT_ENFORCEMENT;let db:PrismaClient|undefined;
 try{
  const port=/^127\.0\.0\.1:(\d+)$/.exec(docker('port',container,'5432/tcp'))?.[1];assert.ok(port);
  let ready=false;for(let i=0;i<80&&!ready;i++){ready=spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-d','checkout_test'],{stdio:'ignore',timeout:5000}).status===0;if(!ready)await delay(250);}assert.ok(ready);
  const url=`postgresql://postgres:${password}@127.0.0.1:${port}/checkout_test?connection_limit=20`;
  execFileSync(process.execPath,[path.join(process.cwd(),'node_modules/prisma/build/index.js'),'migrate','deploy'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:url},timeout:60000,stdio:'pipe'});
  db=new PrismaClient({datasourceUrl:url});const client=db;
  const stripe=stripeFixture();const billing=new BillingService(client as never,stripe as never);const webhooks=new BillingWebhookService(client as never,billing);
  const inv=new ResourceInventory(client);
  const loc=await client.inventoryLocation.create({data:{name:'Main',timeZone:'America/Chicago'}});
  const events=await client.serviceCategory.create({data:{name:'Events',slug:'events'}}),meetings=await client.serviceCategory.create({data:{name:'Meetings',slug:'meeting-rooms'}}),desks=await client.serviceCategory.create({data:{name:'Desks',slug:'dedicated'}});
  const room=(label:string,serviceId:string,capacity=1)=>client.physicalResource.create({data:{name:label,kind:'room',locationId:loc.id,capacity,mappings:{create:{serviceId}}}});
  const eventSpace=await room('Event space',events.id),rooms=await Promise.all([1,2,3,4].map(i=>room('Room '+i,meetings.id))),deskPool=await room('Desk pool',desks.id,5);
  const plan=(serviceId:string,slug:string)=>client.catalogPlan.create({data:{serviceId,slug,name:slug,unitAmountCents:10000}});
  const eventPlan=await plan(events.id,'event-hire'),deskPlan=await plan(desks.id,'desk-day');
  await new BookingRuleAdminController(client as never).create(loc.id,{enabled:true,priority:1,condition:{field:'serviceKey',op:'eq',value:'events'},targetResourceIds:rooms.slice(0,3).map(r=>r.id),beforeMinutes:30,afterMinutes:0},admin);
  const policies=new ReservationPolicyAdminController(client as never);
  await policies.create(loc.id,{serviceId:events.id,catalogPlanId:eventPlan.id,enabled:true,durationMinutes:120,requirements:[{resourceId:eventSpace.id,units:1}]},admin);
  await policies.create(loc.id,{serviceId:desks.id,catalogPlanId:deskPlan.id,enabled:true,durationMinutes:480,requirements:[{resourceId:deskPool.id,units:1}]},admin);
  const line=(slug:string):PricedLine=>({planId:null,slug,name:slug,description:slug,currency:'usd',unitAmount:10000,quantity:1,amount:10000,billingType:'ONE_TIME',interval:null,intervalCount:1,metadata:{source:'CATALOG',kind:'PLAN',slug}});
  const checkout=async(slug:string,startAt:string|undefined,extra:Record<string,unknown>={})=>billing.createCheckout({customerName:'Synthetic Buyer',customerEmail:'buyer-'+randomUUID()+'@example.invalid',acceptAccountTerms:true,items:[{planSlug:slug,...(startAt?{startAt}:{})}],...extra} as never,await billing.totalsFor([line(slug)]));
  const claimsOf=(orderId:string)=>client.inventoryClaim.findMany({where:{ownerRef:'order:'+orderId},include:{lines:true}});
  const sessionOf=async(orderId:string)=>(await client.order.findUniqueOrThrow({where:{id:orderId}})).stripeCheckoutSessionId!;
  const roomFree=async(id:string,start:string,end:string)=>(await inv.availability({locationId:loc.id,serviceId:meetings.id,startsAt:new Date(start),endsAt:new Date(end),resources:[{resourceId:id,units:1}]})).available;
  process.env.INVENTORY_CHECKOUT_ENFORCEMENT='on';

  await t.test('two buyers racing for one event slot: exactly one order and hold',async()=>{
   const results=await Promise.allSettled([1,2].map(()=>checkout('event-hire','2090-03-01T15:00:00Z')));
   const won=results.filter(r=>r.status==='fulfilled');assert.equal(won.length,1,JSON.stringify(results.map(r=>r.status==='rejected'?String(r.reason):'ok')));
   const lost=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.match(String(lost.reason?.response?.message??lost.reason),/no longer available/);
   assert.equal(await client.order.count(),1,'the losing order rolled back with its hold');
   const orderId=(won[0] as PromiseFulfilledResult<any>).value.orderId;const [claim]=await claimsOf(orderId);
   assert.equal(claim.state,'HELD');assert.equal(claim.lines.length,4,'event space plus three rule-locked rooms');
   const session=stripe.calls.find(c=>c.kind==='checkout.sessions.create')!.input as any;
   assert.ok(session.expires_at,'payment page expires before the hold');assert.ok(claim.expiresAt!.getTime()>=(session.expires_at+300)*1000);
   assert.equal(await roomFree(rooms[0].id,'2090-03-01T14:45:00Z','2090-03-01T15:15:00Z'),false);
   assert.equal(await roomFree(rooms[3].id,'2090-03-01T14:45:00Z','2090-03-01T15:15:00Z'),true,'fourth room stays available');
   // Paid webhook confirms, replay is harmless.
   const event=makeEvent('checkout.session.completed',{id:await sessionOf(orderId),metadata:{orderId},payment_status:'paid',amount_total:10000});
   await webhooks.process(event as never);await webhooks.process(makeEvent('checkout.session.completed',{id:await sessionOf(orderId),metadata:{orderId},payment_status:'paid',amount_total:10000}) as never);
   assert.equal((await claimsOf(orderId))[0].state,'CONFIRMED');
   assert.equal(await client.billingEvent.count({where:{orderId,action:'INVENTORY_CONFIRMED'}}),1);
  });

  await t.test('expired checkout releases its hold; a later paid event cannot reclaim it silently',async()=>{
   const created=await checkout('event-hire','2090-04-01T15:00:00Z');const sessionId=await sessionOf(created.orderId);
   await webhooks.process(makeEvent('checkout.session.expired',{id:sessionId,metadata:{orderId:created.orderId}}) as never);
   assert.equal((await claimsOf(created.orderId))[0].state,'RELEASED');
   assert.equal(await roomFree(rooms[1].id,'2090-04-01T14:45:00Z','2090-04-01T15:15:00Z'),true);
   await webhooks.process(makeEvent('checkout.session.completed',{id:sessionId,metadata:{orderId:created.orderId},payment_status:'paid',amount_total:10000}) as never);
   assert.equal((await claimsOf(created.orderId))[0].state,'RELEASED','never resurrected');
   assert.equal(await client.billingEvent.count({where:{orderId:created.orderId,action:'INVENTORY_LOST'}}),1,'staff alerted to rebook or refund');
  });

  await t.test('payment arriving after the hold lapsed is flagged, not confirmed',async()=>{
   const created=await checkout('event-hire','2090-05-01T15:00:00Z');
   await client.inventoryClaim.updateMany({where:{ownerRef:'order:'+created.orderId},data:{expiresAt:new Date(Date.now()-1000)}});
   await webhooks.process(makeEvent('checkout.session.completed',{id:await sessionOf(created.orderId),metadata:{orderId:created.orderId},payment_status:'paid',amount_total:10000}) as never);
   assert.equal((await client.order.findUniqueOrThrow({where:{id:created.orderId}})).status,'PAID');
   assert.notEqual((await claimsOf(created.orderId))[0].state,'CONFIRMED');
   assert.equal(await client.billingEvent.count({where:{orderId:created.orderId,action:'INVENTORY_LOST'}}),1);
  });

  await t.test('six simultaneous desk checkouts against five desks: five holds',async()=>{
   const results=await Promise.allSettled(Array.from({length:6},()=>checkout('desk-day','2090-06-01T14:00:00Z')));
   assert.equal(results.filter(r=>r.status==='fulfilled').length,5);
   const remaining=await inv.availability({locationId:loc.id,serviceId:desks.id,startsAt:new Date('2090-06-01T14:00:00Z'),endsAt:new Date('2090-06-01T22:00:00Z'),resources:[{resourceId:deskPool.id,units:1}]});
   assert.equal(remaining.resources[0].remainingUnits,0);
  });

  await t.test('fails closed on missing time, unknown location, manual payment and past times',async()=>{
   const before=await client.order.count();
   await assert.rejects(checkout('event-hire',undefined),/requires a date and time/);
   await assert.rejects(checkout('event-hire','2090-07-01T15:00:00Z',{locationId:'elsewhere'}),/not available at the selected location/);
   await assert.rejects(checkout('event-hire','2090-07-01T15:00:00Z',{paymentMethod:'MANUAL'}),/card payment/);
   await assert.rejects(checkout('event-hire','2001-07-01T15:00:00Z'),/future/);
   await assert.rejects(checkout('event-hire','2090-07-01T15:00:00'),/timezone/);
   assert.equal(await client.order.count(),before,'no orphan orders');
  });

  await t.test('Stripe failure returns the hold immediately',async()=>{
   stripe.failCheckout=true;
   await assert.rejects(checkout('event-hire','2090-08-01T15:00:00Z'),/Unable to start checkout/);
   stripe.failCheckout=false;
   const failed=await client.order.findFirstOrThrow({where:{status:'FAILED'},orderBy:{createdAt:'desc'}});
   assert.equal((await claimsOf(failed.id))[0].state,'RELEASED');
  });

  await t.test('with enforcement off, checkout behaves exactly as before',async()=>{
   process.env.INVENTORY_CHECKOUT_ENFORCEMENT='off';
   const created=await checkout('event-hire','2090-03-01T15:00:00Z');
   assert.equal((await claimsOf(created.orderId)).length,0);
  });
 }finally{
  if(previous===undefined)delete process.env.INVENTORY_CHECKOUT_ENFORCEMENT;else process.env.INVENTORY_CHECKOUT_ENFORCEMENT=previous;
  try{await db?.$disconnect();}finally{docker('rm','-f',container);}
 }
});
