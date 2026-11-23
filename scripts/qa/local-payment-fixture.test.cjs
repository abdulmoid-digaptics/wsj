'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createLocalPaymentFixture}=require('./local-payment-fixture.cjs');
const {validateLocalEnv,fixtureProcessEnvironment,createFixtureApplication}=require('./local-payment-app.cjs');
const env=()=>({DATABASE_URL:'postgresql://local:local@localhost:5432/local',FRONTEND_URL:'http://localhost:3100',PORT:'4001',QA_RUNTIME_ID:randomUUID(),STRIPE_WEBHOOK_SECRET:'whsec_local_'+randomUUID()});
test('fixture refuses remote, credentialed and non-HTTP checkout destinations',()=>{
 for(const url of ['https://stripe.com','http://localhost.evil','http://user:pass@localhost','file:///tmp','https://localhost','http://localhost/path'])assert.throws(()=>createLocalPaymentFixture(url));
});
test('local app requires no external payment/mail config, local DB and runtime identity',()=>{
 assert.doesNotThrow(()=>validateLocalEnv(env(),{}));
 assert.throws(()=>validateLocalEnv(env(),{STRIPE_SECRET_KEY:'sk_test_inherited_fixture'}));
 assert.throws(()=>validateLocalEnv(env(),{SMTP_HOST:'smtp.example.invalid'}));
 for(const patch of [{STRIPE_SECRET_KEY:'sk_test_not_real'},{STRIPE_SECRET_KEY:'sk_live_not_real'},{SMTP_HOST:'smtp.example.invalid'},{DATABASE_URL:'postgresql://local:local@remote.invalid:5432/local'},{QA_RUNTIME_ID:''},{STRIPE_WEBHOOK_SECRET:'whsec_external'},{FRONTEND_URL:'https://example.com'},{PORT:'0'}])assert.throws(()=>validateLocalEnv({...env(),...patch},{}));
});
test('Prisma dotenv inheritance is blocked before application import, not by weakening guards',()=>{
 const local=fixtureProcessEnvironment(env(),{});assert.equal(local.STRIPE_SECRET_KEY,'');assert.equal(local.SMTP_HOST,'');
 assert.throws(()=>fixtureProcessEnvironment(env(),{STRIPE_SECRET_KEY:'sk_test_inherited_fixture'}));
});
test('fixture reaches a PaymentClient provided by an imported module, and fails closed otherwise',async()=>{
 const fixture=createLocalPaymentFixture('http://localhost:3100');
 const Module=()=>()=>{};const AppModule=class{};Reflect.defineMetadata=Reflect.defineMetadata||(()=>{});
 const meta={imports:[],controllers:[],providers:[]};const origGet=Reflect.getMetadata;Reflect.getMetadata=(k,t)=>t===AppModule?meta[k]:origGet?.(k,t);
 try{
  // PaymentClient is NOT in AppModule's own providers: it lives in an imported infrastructure module.
  class PaymentClient{client(){throw new Error('real provider used');}}
  const imported=new PaymentClient();let closed=0;
  const createApplication=async()=>({get:()=>imported,close:async()=>{closed++;}});
  const {fixtureClient}=await createFixtureApplication({AppModule,createApplication,PaymentClient,fixture,Module});
  assert.equal(imported.client(),fixtureClient);assert.equal(closed,0);
  assert.match((await imported.client().checkout.sessions.create({metadata:{bookingId:'b1'}})).id,/^cs_local_/);
  // An instance that bypasses the prototype (e.g. a provider factory) must stop the runtime.
  class OtherClient{constructor(){this.client=()=>({});}}
  const rogue=new OtherClient();
  await assert.rejects(createFixtureApplication({AppModule,createApplication:async()=>({get:()=>rogue,close:async()=>{closed++;}}),PaymentClient:OtherClient,fixture,Module}),e=>e.code==='QA_FIXTURE_NOT_WIRED');
  assert.equal(closed,1);
 }finally{Reflect.getMetadata=origGet;}
});
test('local checkout never constructs a provider session and has deterministic URLs',async()=>{
 const fixture=createLocalPaymentFixture('http://127.0.0.1:3100');const input={metadata:{bookingId:'local-id'}};
 const a=await fixture.client().checkout.sessions.create(input),b=await fixture.client().checkout.sessions.create(input);
 assert.equal(a.id,b.id);assert.match(a.id,/^cs_local_/);assert.equal(a.url,'http://127.0.0.1:3100/booking-confirmation/?booking=local-id');
 assert.deepEqual((await fixture.client().promotionCodes.list({code:'INVALID'})).data,[]);
});
