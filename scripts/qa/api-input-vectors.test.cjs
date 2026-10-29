'use strict';
// Pure tests only: no fetch, server startup, DB, credentials or filesystem writes.
const test=require('node:test');
const assert=require('node:assert/strict');
const v=require('./api-input-vectors.cjs');
const base='http://localhost:4000/api',marker='qa-iv-12345678-1234-1234-1234-123456789abc-12345678';
test('153 unique cases cover all 21 resources and six negative-only auth/body cases',()=>{
 const c=v.catalog();assert.equal(c.length,153);assert.equal(new Set(c.map(x=>x.id)).size,153);assert.equal(v.RESOURCES.length,21);
 for(const r of v.RESOURCES)assert.equal(c.filter(x=>x.id.startsWith('public.'+r+'.')).length,7);
 for(const s of c){assert.ok([200,400,401,404,413].includes(s.expected));v.requestURL(base,s.path({marker}),s.method,s.body);}
});
test('literal prefix searches and exact UTF-16 boundaries',()=>{
 for(const kind of v.RESOURCES){
  const c=v.catalog().filter(s=>s.id.startsWith('public.'+kind+'.'));
  for(const label of ['sql','script']){const x=c.find(s=>s.id.endsWith('.'+label));assert.ok(new URL(base+x.path({marker})).searchParams.get('search').startsWith(marker));assert.throws(()=>x.check({status:200,body:{items:[],total:1,page:1,limit:50}}));}
  for(const length of [200,201]){const s=c.find(x=>x.id.endsWith('.length'+length));assert.equal(new URL(base+s.path({marker})).searchParams.get('search').length,length);assert.equal(s.expected,length===200?200:400);}
  const unicode=c.find(s=>s.id.endsWith('.unicode'));unicode.check({status:200,body:{items:[],total:0,page:1,limit:50}});unicode.check({status:200,body:{items:[{status:'PUBLISHED'}],total:1,page:1,limit:50}});
  const attack=c.find(s=>s.id.endsWith('.attack-slug'));assert.equal(attack.expected,404);assert.match(decodeURIComponent(attack.path({marker})),/<script>/);
 }
});
test('all POSTs are malformed/unknown fields only, never valid submission DTOs',()=>{
 assert.throws(()=>JSON.parse(v.postBody('malformed')));assert.equal(Buffer.byteLength(v.postBody('oversized')),150*1024);
 assert.deepEqual(Object.keys(JSON.parse(v.postBody('oversized'))),['qaUnknown']);
 for(const s of v.catalog().filter(x=>x.method==='POST')){assert.equal(s.expected,s.id.endsWith('oversized')?413:400);if(!s.id.startsWith('auth.'))assert.ok([v.postBody('malformed'),v.postBody('oversized')].includes(s.body));}
 assert.throws(()=>v.postBody('valid'));assert.throws(()=>v.requestURL(base,'/inquiries','POST','{}'));assert.throws(()=>v.requestURL(base,'/bookings','POST',JSON.stringify({customerEmail:'real@example.com'})));
});
test('nonlocal URLs, credentials, redirects-as-destinations and unapproved methods rejected',()=>{
 for(const raw of ['https://example.com/api','http://localhost.evil/api','http://0.0.0.0/api','file:///api','http://user:password@localhost/api','http://localhost/api#x'])assert.throws(()=>v.localURL(raw));
 for(const raw of ['http://localhost/api','http://127.0.0.1:4000/api','https://[::1]/api'])assert.ok(v.localURL(raw));
 for(const p of ['//example.com/a','/../admin/users','/public/pages#x','/public/pages\\bad','/admin/pages','https://example.com'])assert.throws(()=>v.requestURL(base,p,'GET'));
 for(const method of ['DELETE','PATCH','PUT','OPTIONS'])assert.throws(()=>v.requestURL(base,'/public/pages',method));
 assert.throws(()=>v.requestURL('https://example.com/api','/public/pages','GET'));
});
test('actual Retry-After waits preserve seconds/date and use conservative fallback',()=>{
 assert.equal(v.retryMs('120',0),120250);assert.equal(v.retryMs('0',0),250);assert.equal(v.retryMs('1.5',0),1750);
 assert.equal(v.retryMs('Thu, 01 Jan 1970 00:02:00 GMT',0),120250);
 for(const x of [null,undefined,'','garbage','-1'])assert.equal(v.retryMs(x,Date.now()),61000);
});
test('twenty consecutive outcomes only, failures reset and flaky transitions counted',()=>{
 const s=v.freshStats();for(let n=0;n<19;n++)v.advance(s,true,10);assert.equal(s.status,'INCOMPLETE');v.advance(s,false,20);assert.equal(s.consecutive,0);
 for(let n=0;n<20;n++)v.advance(s,true,10);assert.equal(s.status,'PASS');assert.equal(s.consecutive,20);assert.equal(s.total,40);assert.equal(s.pass,39);assert.equal(s.fail,1);assert.equal(s.flaky,2);assert.equal(s.minLatencyMs,10);assert.equal(s.maxLatencyMs,20);
});
test('minimal leak checks reject drafts and nested sensitive keys without assuming fixtures',()=>{
 const response=items=>({status:200,body:{items,total:items.length,page:1,limit:100}});
 v.publicList(response([]));v.publicList(response([{status:'PUBLISHED',metadata:{enabled:true}}]));
 for(const row of [{status:'DRAFT'},{status:'ARCHIVED'},{status:'PUBLISHED',metadata:{enabled:false}},{status:'PUBLISHED',metadata:{smtpPassword:'not-recorded'}}])assert.throws(()=>v.publicList(response([row])));
 for(const key of ['passwordHash','accessToken','api_key','privateKey','credential','smtpHost'])assert.throws(()=>v.noSecrets({nested:[{[key]:'not-recorded'}]}));
});
test('bounded settings and transient network classification',()=>{
 assert.equal(v.integer(undefined,60,20,100),60);for(const x of ['19','101','NaN','20.5'])assert.throws(()=>v.integer(x,60,20,100));
 assert.equal(v.transient({cause:{code:'ECONNRESET'}}),true);assert.equal(v.transient({name:'TimeoutError'}),true);assert.equal(v.transient(new TypeError('fetch failed')),true);assert.equal(v.transient(new Error('assertion')),false);
});
