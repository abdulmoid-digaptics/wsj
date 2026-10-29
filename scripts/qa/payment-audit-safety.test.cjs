'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {assertLocalPaymentSafety}=require('./api-scenarios.cjs');
test('local mutation audit refuses live and test payment keys without disclosing them',()=>{
 for(const key of ['sk_live_fixture_not_real','sk_test_fixture_not_real']){
  for(const sources of [[{STRIPE_SECRET_KEY:key},{}],[{},{STRIPE_SECRET_KEY:key}]]){
   assert.throws(()=>assertLocalPaymentSafety(...sources),error=>error.code==='QA_EXTERNAL_PAYMENT_CONFIGURED'&&!error.message.includes(key));
  }
 }
});
test('absent payment configuration is allowed but does not claim booking integration passes',()=>{
 assert.doesNotThrow(()=>assertLocalPaymentSafety({},{}));
 assert.doesNotThrow(()=>assertLocalPaymentSafety({STRIPE_SECRET_KEY:'  '}));
});
test('main verifies isolated runtime identity and source before database cleanup or login',()=>{
 const main=fs.readFileSync(path.join(__dirname,'api-scenarios.cjs'),'utf8');
 const identity=main.indexOf("assert.equal(health.headers.get('x-qa-runtime'),env.QA_RUNTIME_ID)");
 const source=main.indexOf("assert.equal(health.headers.get('x-qa-source'),sourceVersion)");
 const mutations=main.indexOf('await db.$connect();await cleanup();');
 assert.ok(identity>0&&source>identity&&mutations>source);
 const companion=fs.readFileSync(path.join(__dirname,'api-input-vectors.cjs'),'utf8');
 assert.ok(companion.includes('r.sourceVersion!==await'));
});
test('both mutation suites check payment configuration before any output or network work',()=>{
 const main=fs.readFileSync(path.join(__dirname,'api-scenarios.cjs'),'utf8');
 const pub=fs.readFileSync(path.join(__dirname,'public-functional.cjs'),'utf8');
 assert.ok(main.indexOf('assertLocalPaymentSafety(env, process.env);')<main.indexOf('await fs.mkdir(out'));
 assert.ok(pub.indexOf('assertLocalPaymentSafety(env,process.env);')<pub.indexOf('fs.mkdirSync(OUT'));
 assert.ok(pub.indexOf('assertLocalPaymentSafety(env,process.env);')<pub.indexOf('(async()=>'));
});
