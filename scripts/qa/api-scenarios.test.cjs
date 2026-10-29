'use strict';
// Pure guard/catalog tests only. They never connect, read .env, mutate data or
// claim endpoint evidence. Run: node --test scripts/qa/api-scenarios.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {localURL,integer,retryMs,advance,catalog,TARGET,transientNetwork,safeErrorCode}=require('./api-scenarios.cjs');
test('local URL guard rejects remote hosts, credentials and non-HTTP schemes',()=>{
 for(const value of ['https://example.com/api','http://localhost.example.com/api','http://user:password@localhost:4000/api','file:///tmp/test','http://0.0.0.0:4000/api','http://localhost:4000/api?token=secret','http://localhost:4000/api#fragment'])assert.throws(()=>localURL(value));
 for(const value of ['http://localhost:4000/api','http://127.0.0.1:4000/api','http://[::1]:4000/api'])assert.ok(localURL(value));
});
test('local pagination queries require explicit opt-in without relaxing destination guards',()=>{
 const paginated='http://localhost:4000/api/public/pages?page=2&limit=100&search=qa';
 assert.throws(()=>localURL(paginated));
 const allowed=localURL(paginated,true);
 assert.equal(allowed.hostname,'localhost');assert.equal(allowed.searchParams.get('page'),'2');assert.equal(allowed.searchParams.get('limit'),'100');
 assert.ok(localURL('http://127.0.0.1:4000/api/public/blog?limit=1',true));
 assert.ok(localURL('http://[::1]:4000/api/public/settings?page=1',true));
 for(const value of ['https://example.com/api?page=1','http://localhost.example.com/api?page=1','http://user:password@localhost:4000/api?page=1','http://localhost:4000/api?page=1#fragment','file:///tmp/test?page=1'])assert.throws(()=>localURL(value,true));
});
test('bounded settings reject fractional, missing-range and unbounded values',()=>{
 assert.equal(integer(undefined,60,20,100),60);
 for(const value of ['19','101','Infinity','20.5','nope',''])assert.throws(()=>integer(value,60,20,100));
});
test('Retry-After supports seconds and HTTP dates without shortening wait',()=>{
 assert.equal(retryMs('60',0),60250);
 assert.equal(retryMs('Thu, 01 Jan 1970 00:01:00 GMT',0),60250);
 assert.equal(retryMs(null,0),61000);
 assert.equal(retryMs('broken',0),61000);
});
test('20 consecutive real passes required; a failure resets the streak',()=>{
 const s={total:0,pass:0,fail:0,flaky:0,consecutive:0,latencyMs:0};
 for(let i=0;i<19;i++)advance(s,true,10);
 assert.notEqual(s.status,'PASS');advance(s,false,20);assert.equal(s.consecutive,0);assert.equal(s.fail,1);
 for(let i=0;i<TARGET;i++)advance(s,true,10);
 assert.equal(s.status,'PASS');assert.equal(s.total,40);assert.equal(s.pass,39);assert.equal(s.fail,1);assert.equal(s.flaky,2);assert.equal(s.consecutive,20);assert.equal(s.averageLatencyMs,10.25);
});
test('every implemented public resource has explicit list/detail and CRUD scenarios',()=>{
 const rows=catalog(),ids=rows.map(x=>x.id);assert.equal(ids.length,398);assert.equal(new Set(ids).size,ids.length);
 const resources=['pages','services','pricing','blog','categories','tags','popups','settings','coworking','virtual-office','dedicated-desk','business-address','mailbox','podcast-packages','meeting-rooms','events-space','photo-studio','llc-services','workshops','webinars','memberships'];
 for(const kind of resources)for(const suffix of ['list.valid','list.missing','list.malformed','list.boundary.lower','list.boundary.upper','detail.valid','detail.missing','detail.malformed','detail.boundary','visibility'])assert.ok(ids.includes('public.'+kind+'.'+suffix));
 for(const kind of resources)assert.ok(ids.includes('admin.'+kind+'.crud'));
 for(const name of ['login','inquiries','bookings','popup-events','admin','public','health'])assert.ok(ids.includes('throttle.'+name+'.trigger-reset'));
 assert.ok(ids.includes('cookie.cors'));assert.ok(ids.includes('bookings.crud.validation.boundary'));
});
test('transport recovery retries network errors, not filesystem denials',()=>{
 assert.equal(transientNetwork({cause:{code:'ECONNRESET'}}),true);
 assert.equal(transientNetwork({name:'TimeoutError'}),true);
 assert.equal(transientNetwork(new TypeError('fetch failed')),true);
 assert.equal(transientNetwork({code:'EPERM'}),false);
 assert.equal(transientNetwork(new Error('Validation failed')),false);
 assert.equal(safeErrorCode({cause:{code:'ECONNREFUSED'}}),'ECONNREFUSED');
 assert.equal(safeErrorCode({code:'unstructured-sensitive-value'}),'UNKNOWN');
});
