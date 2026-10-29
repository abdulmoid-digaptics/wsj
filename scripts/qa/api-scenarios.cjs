'use strict';
/* Local integration evidence, not a seed script. Node 22+.
 * QA_TMP=C:\absolute\fresh node scripts/qa/api-scenarios.cjs [--resume]
 * Optional QA_API_URL (http://localhost:4000/api), QA_ONLY (exact scenario IDs,
 * comma separated), QA_MAX_ATTEMPTS (20..100, default 60), QA_MAX_HOURS (1..24).
 * Every selected scenario needs 20 consecutive real passes. A transient 429 is
 * retried, never itself a happy-path pass. A partial selection is not full coverage.
 * backend/.env is read privately; no response bodies, credentials or tokens are logged.
 * API currently offline at implementation: endpoint evidence is NOT RUN.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {randomUUID, createHash} = require('node:crypto');
const {createRequire} = require('node:module');
const ROOT = path.resolve(__dirname, '../..');
const backendRequire = createRequire(path.join(ROOT, 'backend/package.json'));
const RESOURCES = ['pages','services','pricing','blog','categories','tags','popups','settings','coworking','virtual-office','dedicated-desk','business-address','mailbox','podcast-packages','meeting-rooms','events-space','photo-studio','llc-services','workshops','webinars','memberships'];
const TARGET = 20;
const VERSION = 1;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function transientNetwork(error) {
  return error?.name==='TimeoutError'||error?.name==='AbortError'||['ECONNREFUSED','ECONNRESET','EPIPE','ETIMEDOUT','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(error?.cause?.code||error?.code)||(error instanceof TypeError&&error.message==='fetch failed');
}
function safeErrorCode(error) {const value=error?.cause?.code||error?.code;return typeof value==='string'&&/^[A-Z0-9_]+$/.test(value)?value:'UNKNOWN';}
// DELETE is idempotent (a retry just repeats or 404s); GET/HEAD/OPTIONS never
// mutate. POST/PATCH create or change state, so a lost response after the
// server accepted the request must not be retried: that would duplicate or
// re-apply the write. Those methods fail the iteration instead; marker-based
// cleanup() independently discovers and removes any write the server accepted.
function retryableOnTransient(method) {return ['GET','HEAD','OPTIONS','DELETE'].includes(method);}
async function sourceFingerprint(root) {
  const hashes=[];
  async function walk(rel) {
    const entries=await fs.readdir(path.join(root,rel),{withFileTypes:true});
    for (const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
      const child=path.join(rel,entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()&&/\.(ts|json|js|cjs)$/.test(entry.name)) hashes.push([child.replaceAll('\\','/'), createHash('sha256').update(await fs.readFile(path.join(root,child))).digest('hex')]);
    }
  }
  for (const dir of ['backend/src','backend/prisma']) await walk(dir);
  await walk('backend/dist');
  for(const file of ['local-payment-app.cjs','local-payment-fixture.cjs']){const rel='scripts/qa/'+file;hashes.push([rel,createHash('sha256').update(await fs.readFile(path.join(root,rel))).digest('hex')]);}
  return createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
}
function localURL(raw, allowQuery = false) {
  let u; try { u = new URL(raw); } catch { throw new Error('Local HTTP(S) URL required'); }
  if (!['http:','https:'].includes(u.protocol) || !['localhost','127.0.0.1','[::1]'].includes(u.hostname) || u.username || u.password || (!allowQuery && u.search) || u.hash) throw new Error('Local HTTP(S) URL required');
  return u;
}
function integer(raw, fallback, min, max) {
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error('Invalid bounded QA setting');
  return n;
}
function retryMs(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return 61000;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(ms) || ms < 0) return 61000;
  return Math.ceil(ms) + 250;
}
function advance(s, ok, latency) {
  if (s.total && s.lastOutcome !== undefined && s.lastOutcome !== ok) s.flaky++;
  s.lastOutcome = ok;
  s.total++; s.latencyMs += latency; s.averageLatencyMs = +(s.latencyMs / s.total).toFixed(2);
  if (ok) { s.pass++; s.consecutive++; }
  else { s.fail++; s.consecutive = 0; }
  s.status = s.consecutive >= TARGET ? 'PASS' : 'INCOMPLETE';
}
function expect(r, status) { assert.equal(r.status, status, 'Unexpected HTTP status'); return r.body; }
function page(r, limit) {
  const b = expect(r, 200); assert.ok(Array.isArray(b.items)); assert.ok(Number.isInteger(b.total));
  assert.ok(b.total >= 0); assert.ok(Number.isInteger(b.page)); assert.ok(Number.isInteger(b.limit));
  if (limit !== undefined) assert.equal(b.limit, limit);
  assert.ok(b.items.length <= b.limit); return b;
}
function catalog() {
  const scenarios = [];
  const add = (id, run) => scenarios.push({id, run});
  for (const kind of RESOURCES) {
    const p = '/public/' + kind;
    add('public.'+kind+'.list.valid', async c => page(await c.req(p)));
    add('public.'+kind+'.list.missing', async c => assert.equal(page(await c.req(p+'?search='+c.marker+'-absent')).total, 0));
    for (const [label, query] of Object.entries({malformed:'page=nope',zero:'page=0',overLimit:'limit=101',overPage:'page=1000001',longSearch:'search='+ 'x'.repeat(201),unknown:'unexpected=1',badStatus:'status=INVALID'})) {
      add('public.'+kind+'.list.'+label, async c => expect(await c.req(p+'?'+query),400));
    }
    for (const [label, query, limit] of [['lower','page=1&limit=1',1],['upper','page=1000000&limit=100',100]]) {
      add('public.'+kind+'.list.boundary.'+label, async c => {const b=page(await c.req(p+'?'+query),limit); if(label==='upper')assert.equal(b.items.length,0);});
    }
    add('public.'+kind+'.detail.valid', async c => {
      const row=await c.content(kind,{status:'PUBLISHED',content:{html:'<p>Safe</p><script>bad()</script>'},metadata:{smtpPassword:'qa-not-a-secret'}});
      const b=expect(await c.req(p+'/'+row.slug),200); assert.equal(b.id,row.id); assert.equal(b.metadata.smtpPassword,undefined); assert.ok(!b.content.html.includes('<script>'));
    });
    add('public.'+kind+'.detail.missing', async c => expect(await c.req(p+'/'+c.marker+'-absent'),404));
    // There is no slug validator on detail routes: malformed/overlong slugs currently mean 404, not 400.
    add('public.'+kind+'.detail.malformed', async c => expect(await c.req(p+'/%21invalid'),404));
    add('public.'+kind+'.detail.boundary', async c => {
      const slug=c.marker+'-'+ 'a'.repeat(199-c.marker.length); assert.equal(slug.length,200);
      const row=await c.content(kind,{slug,status:'PUBLISHED'}); assert.equal(expect(await c.req(p+'/'+slug),200).id,row.id);
      expect(await c.req(p+'/'+'a'.repeat(201)),404);
    });
    add('admin.'+kind+'.crud', async c => {
      const row=await c.content(kind); page(await c.auth('/admin/'+kind+'?search='+c.marker));
      assert.equal(expect(await c.auth('/admin/'+kind+'/'+row.id),200).id,row.id);
      expect(await c.req(p+'/'+row.slug),404);
      const updated=expect(await c.auth('/admin/'+kind+'/'+row.id,'PATCH',{title:c.marker+' updated',status:'PUBLISHED'}),200); assert.equal(updated.title,c.marker+' updated');
      assert.equal(expect(await c.req(p+'/'+row.slug),200).id,row.id);
      expect(await c.auth('/admin/'+kind+'/'+row.id,'DELETE'),200); expect(await c.auth('/admin/'+kind+'/'+row.id),404);
    });
    add('admin.'+kind+'.validation', async c => {
      const body={title:c.marker,slug:c.marker};
      for(const bad of [{...body,unexpected:true},{...body,content:null},{...body,slug:'BAD SLUG'},{...body,title:'x'.repeat(301)},{...body,sortOrder:2147483648}])expect(await c.auth('/admin/'+kind,'POST',bad),400);
      expect(await c.auth('/admin/'+kind+'/not-a-uuid'),404);
    });
    add('public.'+kind+'.visibility', async c => {
      const row=await c.content(kind,{status:'PUBLISHED',metadata:{enabled:false}});
      expect(await c.req(p+'/'+row.slug),404); assert.equal(page(await c.req(p+'?search='+c.marker)).items.some(x=>x.id===row.id),false);
      expect(await c.auth('/admin/'+kind+'/'+row.id,'PATCH',{metadata:{publishAt:'2099-01-01T00:00:00Z'}}),200); expect(await c.req(p+'/'+row.slug),404);
      expect(await c.auth('/admin/'+kind+'/'+row.id,'PATCH',{metadata:{enabled:true,publishAt:'2000-01-01T00:00:00Z'}}),200); expect(await c.req(p+'/'+row.slug),200);
    });
  }
  add('public.unknown-resource', async c => {expect(await c.req('/public/'+c.marker),404);expect(await c.req('/public/'+c.marker+'/missing'),404);});
  add('health', async c => assert.equal(expect(await c.req('/health'),200).status,'ok'));
  add('auth.required', async c => {
    for(const p of ['/auth/me','/admin/pages','/admin/users','/admin/media','/admin/inquiries','/admin/popup-events','/admin/popup-stats','/admin/bookings','/admin/audit'])expect(await c.req(p),401);
    expect(await c.req('/auth/me','GET',undefined,{Authorization:'Bearer invalid'}),401);
  });
  add('auth.login.invalid', async c => {expect(await c.req('/auth/login','POST',{email:'bad',password:'x'}),400);expect(await c.req('/auth/login','POST',{email:c.marker+'@example.invalid',password:'not-a-real-password'}),401);});
  add('auth.lifecycle.roles', async c => {
    for(const role of ['ADMIN','EDITOR','VIEWER']) {
      const u=await c.user(role); const r=await c.req('/auth/login','POST',{email:u.email,password:c.password}); const b=expect(r,201); assert.ok(b.accessToken); assert.equal(b.user.role,role);
      assert.match(r.headers.get('set-cookie')||'',/HttpOnly/i);assert.match(r.headers.get('set-cookie')||'',/SameSite=Strict/i);
      const h={Authorization:'Bearer '+b.accessToken}; assert.equal(expect(await c.req('/auth/me','GET',undefined,h),200).id,u.id);
      expect(await c.req('/admin/users','GET',undefined,h),role==='ADMIN'?200:403);
      expect(await c.req('/admin/settings','GET',undefined,h),role==='ADMIN'?200:403);
      if(role==='VIEWER')expect(await c.req('/admin/pages','POST',{title:c.marker,slug:c.marker+'-denied'},h),403);
      expect(await c.req('/auth/logout','POST',{},h),201); expect(await c.req('/auth/me','GET',undefined,h),401);
    }
  });
  add('users.crud.validation.revocation', async c => {
    const u=await c.user('VIEWER'); page(await c.auth('/admin/users?limit=100'),100); assert.equal(u.passwordHash,undefined);
    const login=expect(await c.req('/auth/login','POST',{email:u.email,password:c.password}),201);
    const updated=expect(await c.auth('/admin/users/'+u.id,'PATCH',{name:c.marker+' updated',active:false}),200);assert.equal(updated.active,false);assert.equal(updated.passwordHash,undefined);
    expect(await c.req('/auth/me','GET',undefined,{Authorization:'Bearer '+login.accessToken}),401);
    expect(await c.auth('/admin/users/'+u.id,'DELETE'),200);expect(await c.auth('/admin/users/'+u.id,'PATCH',{name:c.marker}),404);
    for(const password of ['short','😀'.repeat(20)])expect(await c.auth('/admin/users','POST',{name:c.marker,email:c.marker+'-bad@example.invalid',password,role:'VIEWER'}),400);
  });
  add('auth.self-protection-owned-user', async c => {
    const u=await c.user('ADMIN');const b=expect(await c.req('/auth/login','POST',{email:u.email,password:c.password}),201);const h={Authorization:'Bearer '+b.accessToken};
    expect(await c.req('/admin/users/'+u.id,'PATCH',{role:'EDITOR'},h),400);expect(await c.req('/admin/users/'+u.id,'PATCH',{active:false},h),400);expect(await c.req('/admin/users/'+u.id,'DELETE',undefined,h),400);
  });
  add('media.crud.signature.boundaries', async c => {
    const form=new FormData();form.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=','base64')],{type:'image/png'}),c.marker+'.png');form.append('alt',c.marker);
    const row=expect(await c.auth('/admin/media','POST',form),201);page(await c.auth('/admin/media?search='+c.marker));
    const file=await c.raw(localURL(row.url).href); assert.equal(file.status,200);assert.equal(file.headers.get('x-content-type-options'),'nosniff');await file.arrayBuffer();
    assert.equal(expect(await c.auth('/admin/media/'+row.id,'PATCH',{alt:'a'.repeat(300)}),200).alt.length,300);
    expect(await c.auth('/admin/media/'+row.id,'PATCH',{alt:'a'.repeat(301)}),400);
    const bad=new FormData();bad.append('file',new Blob(['<script>bad()</script>'],{type:'image/png'}),c.marker+'-bad.png');expect(await c.auth('/admin/media','POST',bad),400);
    expect(await c.auth('/admin/media','POST',new FormData()),400);
    const huge=new FormData();huge.append('file',new Blob([new Uint8Array(5*1024*1024+1)],{type:'image/png'}),c.marker+'-large.png');expect(await c.auth('/admin/media','POST',huge),413);
    expect(await c.auth('/admin/media/'+row.id,'DELETE'),200);expect(await c.auth('/admin/media/'+row.id,'DELETE'),404);
  });
  add('inquiries.crud.validation.boundary', async c => {
    const data={name:c.marker,email:c.marker+'@example.invalid',message:'m'.repeat(10000),phone:'1'.repeat(50),service:'s'.repeat(200)};
    const row=expect(await c.req('/inquiries','POST',data),201);assert.equal(row.emailStatus,'NOT_CONFIGURED');
    assert.ok(page(await c.auth('/admin/inquiries?search='+c.marker)).items.some(x=>x.id===row.id));
    for(const status of ['READ','RESOLVED'])assert.equal(expect(await c.auth('/admin/inquiries/'+row.id,'PATCH',{status}),200).status,status);
    expect(await c.auth('/admin/inquiries/'+row.id,'PATCH',{status:'INVALID'}),400);expect(await c.auth('/admin/inquiries/'+row.id,'DELETE'),200);
    for(const bad of [{...data,name:' '},{...data,message:'xx'},{...data,message:'m'.repeat(10001)},{...data,website:'bot'}])expect(await c.req('/inquiries','POST',bad),400);
  });
  add('popup-events.all-types.stats.validation', async c => {
    const popup=await c.content('popups',{status:'PUBLISHED'});
    for(const event of ['view','click','dismiss','submit'])assert.equal(expect(await c.req('/popup-events','POST',{popupId:popup.id,event,sessionId:c.marker}),201).recorded,true);
    const stats=expect(await c.auth('/admin/popup-stats'),200).items.find(x=>x.popupId===popup.id);assert.ok(stats);for(const key of ['views','clicks','dismissals','submissions'])assert.equal(stats[key],1);assert.equal(stats.conversionRate,1);
    assert.ok(page(await c.auth('/admin/popup-events?limit=100'),100).items.some(x=>x.popupId===popup.id));
    expect(await c.req('/popup-events','POST',{popupId:popup.id,event:'invalid'}),400);
    expect(await c.req('/popup-events','POST',{popupId:popup.id,event:'view',sessionId:'s'.repeat(101)}),400);
    expect(await c.req('/popup-events','POST',{popupId:c.marker,event:'view'}),404);
    expect(await c.auth('/admin/popups/'+popup.id,'PATCH',{metadata:{enabled:false}}),200);expect(await c.req('/popup-events','POST',{popupId:popup.id,event:'view'}),404);
  });
  add('bookings.crud.validation.boundary', async c => {
    const data={customerName:c.marker,customerEmail:c.marker+'@example.invalid',serviceType:'qa',serviceName:c.marker,planId:'silver',guests:500,addOns:['printing','storage','mail','podcast','assistant','events'],notes:'n'.repeat(5000)};
    const catalogBody=expect(await c.req('/public/booking-catalog'),200);assert.equal(catalogBody.currency,'usd');
    const row=expect(await c.req('/bookings','POST',data),201);assert.equal(row.status,'pending_payment');assert.equal(localURL(row.checkoutUrl,true).origin,c.origins[0]);
    const stored=expect(await c.auth('/admin/bookings/'+row.id),200);assert.equal(stored.guests,500);assert.equal(stored.subtotalPrice,100);assert.equal(stored.totalPrice,275);assert.equal(stored.status,'PENDING');
    const confirmation=expect(await c.req('/public/bookings/'+row.id+'/confirmation'),200);assert.equal(confirmation.status,'PENDING');for(const field of ['customerEmail','customerPhone','notes','stripeResponse'])assert.equal(confirmation[field],undefined);
    assert.ok(page(await c.auth('/admin/bookings?search='+c.marker)).items.some(x=>x.id===row.id));
    expect(await c.auth('/admin/bookings/'+row.id,'PATCH',{status:'REFUNDED'}),400);
    await c.paid(row.id);await c.paid(row.id);
    const paid=expect(await c.auth('/admin/bookings/'+row.id),200);assert.equal(paid.status,'CONFIRMED');assert.equal(paid.emailStatus,'NOT_CONFIGURED');
    for(const status of ['CANCELLED','COMPLETED','REFUNDED'])assert.equal(expect(await c.auth('/admin/bookings/'+row.id,'PATCH',{status,notes:c.marker}),200).status,status);
    assert.equal(expect(await c.auth('/admin/bookings/'+row.id,'PATCH',{status:'REFUNDED'}),200).status,'REFUNDED');
    expect(await c.auth('/admin/bookings/'+row.id,'PATCH',{status:'INVALID'}),400);expect(await c.auth('/admin/bookings/'+row.id,'DELETE'),200);expect(await c.auth('/admin/bookings/'+row.id),404);expect(await c.req('/public/bookings/'+row.id+'/confirmation'),404);
    for(const bad of [{...data,totalPrice:1},{...data,subtotalPrice:1},{...data,planId:'missing'},{...data,planId:undefined},{...data,guests:501},{...data,guests:0},{...data,addOns:Array(7).fill('printing')},{...data,addOns:['unknown']},{...data,website:'bot'},{...data,customerName:' '}])expect(await c.req('/bookings','POST',bad),400);
    expect(await c.auth('/admin/bookings?status=INVALID'),400);expect(await c.auth('/admin/bookings?page=0'),400);
  });
  add('configuration.pricing.popups', async c => {
    expect(await c.auth('/admin/pricing','POST',{title:c.marker,slug:c.marker,metadata:{price:-1}}),400);
    expect(await c.auth('/admin/popups','POST',{title:c.marker,slug:c.marker,metadata:{startsAt:'2030-01-01T00:00:00Z',endsAt:'2020-01-01T00:00:00Z'}}),400);
  });
  add('cookie.cors', async c => {
    for(const origin of c.origins){const r=await c.req('/health','GET',undefined,{Origin:origin});expect(r,200);assert.equal(r.headers.get('access-control-allow-origin'),origin);assert.equal(r.headers.get('access-control-allow-credentials'),'true');
      const pre=await c.req('/admin/pages','OPTIONS',undefined,{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'});expect(pre,204);assert.equal(pre.headers.get('access-control-allow-origin'),origin);
      expect(await c.req('/admin/pages','POST',{title:c.marker,slug:c.marker+'-'+randomUUID()},{Origin:origin,Cookie:'access_token='+c.token}),201);
    }
    const bad='http://localhost:65534';assert.ok(!c.origins.includes(bad));assert.equal((await c.req('/health','GET',undefined,{Origin:bad})).headers.get('access-control-allow-origin'),null);
    for(const origin of [undefined,bad])expect(await c.req('/admin/pages','POST',{title:c.marker,slug:c.marker+'-denied'},{...(origin?{Origin:origin}:{}),Cookie:'access_token='+c.token}),403);
    expect(await c.req('/auth/me','GET',undefined,{Cookie:'access_token='+c.token}),200);
  });
  // Invalid DTOs consume the same real endpoint throttle, without creating data.
  // Each iteration explicitly observes 429, waits Retry-After, then proves recovery
  // with a successful authenticated login or a valid, owned inquiry/booking.
  for(const [name,endpoint,limit] of [['login','/auth/login',5],['inquiries','/inquiries',5],['bookings','/bookings',3],['popup-events','/popup-events',60],['admin','/admin/audit',120],['public','/public/settings',2000],['health','/health',2000]]) {
    add('throttle.'+name+'.trigger-reset', async c => {
      const loginUser=name==='login'?await c.user('ADMIN'):null;
      let blocked;
      for(let i=0;i<=limit+1;i++){
        const r=await c.req(endpoint,endpoint.startsWith('/admin/')||name==='public'||name==='health'?'GET':'POST',endpoint.startsWith('/admin/')||name==='public'||name==='health'?undefined:{},endpoint.startsWith('/admin/')?{Authorization:'Bearer '+c.token}:{},{raw429:true});
        if(r.status===429){blocked=r;break;}
        expect(r,endpoint.startsWith('/admin/')||name==='public'||name==='health'?200:400);
      }
      assert.ok(blocked,'Expected real throttle rejection');assert.ok(blocked.headers.get('retry-after'),'Retry-After required');
      await c.backoff(blocked.headers.get('retry-after'));
      if(name==='login')expect(await c.req(endpoint,'POST',{email:loginUser.email,password:c.password},{}, {raw429:true}),201);
      else if(name==='inquiries')expect(await c.req(endpoint,'POST',{name:c.marker,email:c.marker+'@example.invalid',message:'recovery'}, {},{raw429:true}),201);
      else if(name==='bookings')expect(await c.req(endpoint,'POST',{customerName:c.marker,customerEmail:c.marker+'@example.invalid',serviceType:'qa',serviceName:c.marker,planId:'silver'},{},{raw429:true}),201);
      else if(name==='popup-events'){const popup=await c.content('popups',{status:'PUBLISHED'});expect(await c.req(endpoint,'POST',{popupId:popup.id,event:'view',sessionId:c.marker},{},{raw429:true}),201);}
      else expect(await c.req(endpoint,'GET',undefined,endpoint.startsWith('/admin/')?{Authorization:'Bearer '+c.token}:{},{raw429:true}),200);
    });
  }
  return scenarios;
}
// A localhost API can still call a real payment provider server-side. Neither
// live nor test Stripe keys authorize external objects during a LOCAL audit.
function assertLocalPaymentSafety(...sources) {
  if (sources.some(env => String(env?.STRIPE_SECRET_KEY || '').trim())) {
    const error = new Error('External payment provider configured; local mutation audit requires isolated payment transport');
    error.code = 'QA_EXTERNAL_PAYMENT_CONFIGURED';
    throw error;
  }
}
async function main() {
  const args=process.argv.slice(2);if(args.some(x=>x!=='--resume'))throw new Error('Only --resume is supported');
  const resume=args.includes('--resume'); const out=process.env.QA_TMP;
  if(!out||!path.isAbsolute(out))throw new Error('Set absolute QA_TMP to a fresh output directory');
  const base=localURL(process.env.QA_API_URL||'http://localhost:4000/api').href.replace(/\/$/,'');
  if(new URL(base).pathname!=='/api')throw new Error('QA_API_URL must end in /api');
  const env=backendRequire('dotenv').parse(await fs.readFile(process.env.QA_ENV_FILE?path.resolve(process.env.QA_ENV_FILE):path.join(ROOT,'backend/.env')));
  assertLocalPaymentSafety(env, process.env);
  if(env.SMTP_HOST?.trim()||process.env.SMTP_HOST?.trim())throw new Error('Refusing all writes while SMTP_HOST is configured');
  // The running backend must use this local .env. Never point this runner at a
  // differently configured server; SMTP state cannot be inspected over HTTP.
  const dburl=new URL(env.DATABASE_URL);if(!['postgres:','postgresql:'].includes(dburl.protocol)||!['localhost','127.0.0.1','[::1]'].includes(dburl.hostname))throw new Error('Local PostgreSQL DATABASE_URL required for marker cleanup');
  if(!env.ADMIN_EMAIL||!env.ADMIN_PASSWORD)throw new Error('Backend admin credentials required');
  const origins=[...new Set([env.FRONTEND_URL,...(env.FRONTEND_URLS||'').split(',')].filter(Boolean).map(x=>localURL(x.trim()).origin))];
  if(!origins.length)throw new Error('Local frontend origins required');
  if(origins.includes('http://localhost:65534'))throw new Error('Reserved rejected test origin is allowlisted');
  const attempts=integer(process.env.QA_MAX_ATTEMPTS,60,20,100);const hours=integer(process.env.QA_MAX_HOURS,12,1,24);const deadline=Date.now()+hours*3600000;
  const all=catalog();const only=process.env.QA_ONLY?process.env.QA_ONLY.split(',').filter(Boolean):null;
  if(only?.some(id=>!all.some(s=>s.id===id)))throw new Error('Unknown QA_ONLY scenario ID');
  const selected=all.filter(s=>!only||only.includes(s.id));
  // Bind evidence to BOTH the runner and the backend source it is testing, so
  // patching backend/src or the schema cannot silently keep old PASS streaks.
  const fingerprint=createHash('sha256').update(await fs.readFile(__filename)).digest('hex');
  const sourceVersion=await sourceFingerprint(ROOT);
  const reportFile=path.join(out,'api-scenarios.json');await fs.mkdir(out,{recursive:true});let report;
  if(resume){
    report=JSON.parse(await fs.readFile(reportFile,'utf8'));
    if(report.version!==VERSION||report.fingerprint!==fingerprint||report.sourceVersion!==sourceVersion||report.base!==base||JSON.stringify(report.selected)!==JSON.stringify(selected.map(s=>s.id))||!/^qa-[a-f0-9-]{36}$/.test(report.marker))throw new Error('Resume configuration does not match original evidence, or backend source changed since this evidence started: use a fresh QA_TMP');
    // An iteration mid-flight when the process stopped is unconfirmed, not a
    // pass: record it as a failure and reset that scenario's streak before
    // resuming, matching the companion runner's interrupted-state handling.
    if(report.current){const row=report.scenarios[report.current.scenario];if(row){advance(row,false,0);row.lastResult='INTERRUPTED_UNCONFIRMED';}delete report.current;}
  }
  else {if((await fs.readdir(out)).length)throw new Error('Use a fresh QA_TMP or --resume');report={version:VERSION,fingerprint,sourceVersion,base,marker:'qa-'+randomUUID(),startedAt:new Date().toISOString(),status:'NOT RUN',selected:selected.map(s=>s.id),fullCoverage:!only,requiredConsecutive:TARGET,owned:[],pending:null,scenarios:Object.fromEntries(all.map(s=>[s.id,{status:'NOT RUN',total:0,pass:0,fail:0,flaky:0,consecutive:0,latencyMs:0,averageLatencyMs:0,retries429:0,retriesNetwork:0}])),coverageGaps:['No API DELETE for popup events: direct local Prisma marker cleanup is required.','No user/media/inquiry detail GET route; only implemented route shapes are exercised.','Bootstrap admin login/expiry refresh creates immutable audit logs without a run marker; these rows are retained, never guessed or deleted.','Mutation safety requires the matching isolated runtime identity/source header and secret-free selected local configuration.','Not an exhaustive combinatorial DTO/security test; no external email/payment/provider integration.'],cleanup:{status:'NOT RUN'}};}
  const save=async()=>{report.updatedAt=new Date().toISOString();const rows=Object.values(report.scenarios);report.counters={total:0,pass:0,fail:0,flaky:0,latencyMs:0,retries429:0,retriesNetwork:0};for(const row of rows)for(const key of Object.keys(report.counters))report.counters[key]+=row[key];report.counters.averageLatencyMs=report.counters.total?+(report.counters.latencyMs/report.counters.total).toFixed(2):0;report.metricNotes={latency:'Whole scenario iteration including backoff and verified cleanup',flaky:'Number of observed pass/fail outcome transitions; failures reset consecutive passes'};const tmp=reportFile+'.tmp';await fs.writeFile(tmp,JSON.stringify(report,null,2));await fs.rename(tmp,reportFile);};
  const lockFile=path.join(out,'.api-scenarios.lock');let lock;
  try{lock=await fs.open(lockFile,'wx');await lock.writeFile(String(process.pid));}catch{throw new Error('Runner lock exists; verify no runner is active before removing stale lock');}
  await save();
  const {PrismaClient}=backendRequire('@prisma/client');const db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}},log:[]});
  const uploadDir=path.resolve(ROOT,'backend',env.UPLOAD_DIR||'uploads');
  let token;let tokenCreatedAt=0;let active;let stopping=false;const interrupted=()=>{stopping=true;};process.on('SIGINT',interrupted);process.on('SIGTERM',interrupted);
  const check=()=>{if(stopping||Date.now()>deadline)throw new Error('Run interrupted or time budget exhausted');};
  const owned=(table,id)=>{if(typeof id==='string'&&!report.owned.some(x=>x.table===table&&x.id===id))report.owned.push({table,id});};
  // Discover records by this unguessable run marker after an interrupted/lost
  // response, and verify ownership again before every destructive operation.
  async function cleanup(){
    report.cleanup={status:'INCOMPLETE'};await save();
    const m=report.marker;
    const definitions=[['content',{OR:[{slug:{startsWith:m}},{title:{startsWith:m}}]}],['user',{OR:[{email:{startsWith:m}},{name:{startsWith:m}}]}],['inquiry',{OR:[{name:{startsWith:m}},{email:{startsWith:m}}]}],['booking',{OR:[{customerName:{startsWith:m}},{customerEmail:{startsWith:m}}]}],['media',{originalName:{startsWith:m}}]];
    for(const [table,where] of definitions)for(const r of await db[table].findMany({where,select:{id:true}}))owned(table,r.id);
    const popupIds=(await db.content.findMany({where:{kind:'popups',slug:{startsWith:m},title:{startsWith:m}},select:{id:true}})).map(r=>r.id);
    await db.popupEvent.deleteMany({where:{OR:[{sessionId:{startsWith:m}},...(popupIds.length?[{popupId:{in:popupIds}}]:[])]}});
    const known=report.owned.map(x=>x.id);const userIds=report.owned.filter(x=>x.table==='user').map(x=>x.id);
    // Resource-linked audits and owned-user auth audits are ours; no broad purge.
    if(known.length)await db.audit.deleteMany({where:{OR:[{resourceId:{in:known}},...(userIds.length?[{actorId:{in:userIds}}]:[])]}});
    for(const [table,where] of definitions){
      const ids=report.owned.filter(x=>x.table===table).map(x=>x.id);if(!ids.length)continue;
      if(table==='media')for(const r of await db.media.findMany({where:{AND:[where,{id:{in:ids}}]}})){
        if(!/^[a-f0-9-]+\.(png|jpg|webp|pdf)$/.test(r.filename))throw new Error('Unsafe owned media filename');
        const rel=path.relative(ROOT,uploadDir);if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Refusing upload cleanup outside workspace');
        const real=await fs.realpath(uploadDir);const realRoot=await fs.realpath(ROOT);const realRel=path.relative(realRoot,real);if(realRel.startsWith('..')||path.isAbsolute(realRel))throw new Error('Refusing symlinked external uploads');
        await fs.unlink(path.join(real,r.filename)).catch(e=>{if(e.code!=='ENOENT')throw e;});
      }
      await db[table].deleteMany({where:{AND:[where,{id:{in:ids}}]}});
      if(await db[table].count({where})||await db[table].count({where:{id:{in:ids}}}))throw new Error('Marker cleanup verification failed');
    }
    assert.equal(await db.popupEvent.count({where:{sessionId:{startsWith:m}}}),0);
    report.owned=[];report.pending=null;report.cleanup={status:'PASS',at:new Date().toISOString()};await save();
  }
  async function backoff(value){const ms=retryMs(value);if(!Number.isSafeInteger(ms)||ms>2147483647||Date.now()+ms>deadline||stopping)throw new Error('Retry-After exceeds remaining bounded wait');report.waitingUntil=new Date(Date.now()+ms).toISOString();await save();const until=Date.now()+ms;while(Date.now()<until){check();await wait(Math.min(1000,until-Date.now()));}delete report.waitingUntil;await save();check();}
  async function raw(url,options={}){check();const u=localURL(url,true);if(u.origin!==new URL(base).origin)throw new Error('Refusing cross-origin request');return fetch(u,{...options,redirect:'manual',signal:AbortSignal.timeout(15000)});}
  async function req(p,method='GET',data,headers={},options={}){
    const url=base+p;localURL(url,true);const form=data instanceof FormData;
    if(!['GET','HEAD','OPTIONS'].includes(method)){report.pending={method,path:p,marker:report.marker};await save();}
    for(let retry=0;retry<=3;retry++){
      let r;
      try {r=await raw(url,{method,headers:{...(data!==undefined&&!form?{'Content-Type':'application/json'}:{}),...headers},...(data!==undefined?{body:form?data:JSON.stringify(data)}:{})});}
      catch(error){
        if(!transientNetwork(error))throw error;
        if(active){active.retriesNetwork++;active.lastTransportCode=safeErrorCode(error);}await save();
        if(!retryableOnTransient(method))throw error;
        if(retry===3)throw error;await backoff('60');continue;
      }
      let body;try{body=await r.json();}catch(error){
        if(transientNetwork(error)){
          if(active){active.retriesNetwork++;active.lastTransportCode=safeErrorCode(error);}await save();
          // The request reached the server; its response body is merely
          // unreadable. For a write, that is an uncertain accepted write, not
          // a safe-to-retry read. Fail the iteration; cleanup() discovers any
          // record the server actually created via the per-iteration marker.
          if(!retryableOnTransient(method))throw error;
          if(retry===3)throw error;await backoff('60');continue;
        }
        body=null;
      }
      const table=p==='/admin/users'?'user':p==='/admin/media'?'media':p==='/inquiries'?'inquiry':p==='/bookings'?'booking':p.startsWith('/admin/')&&RESOURCES.includes(p.split('/')[2])?'content':null;
      if(method==='POST'&&table&&body?.id){owned(table,body.id);await save();}
      if(r.status===429&&!options.raw429){if(active)active.retries429++;await save();if(retry===3)throw new Error('429 retry budget exhausted');await backoff(r.headers.get('retry-after'));continue;}
      return {status:r.status,headers:r.headers,body};
    }
  }
  try {
    // Health is preflight only, not one of the 20 scenario passes.
    try{const health=await req('/health');assert.equal(expect(health,200).status,'ok');assert.match(env.QA_RUNTIME_ID||'',/^[a-f0-9-]{36}$/);assert.equal(health.headers.get('x-qa-runtime'),env.QA_RUNTIME_ID);assert.equal(health.headers.get('x-qa-payments'),'local-fixture');assert.equal(health.headers.get('x-qa-source'),sourceVersion);}catch{report.status='NOT RUN';report.reason='Local API health preflight unavailable or invalid';await save();console.log('NOT RUN: local API preflight unavailable. Evidence: '+reportFile);process.exitCode=2;return;}
    await db.$connect();await cleanup();
    const authResult=expect(await req('/auth/login','POST',{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD}),201);assert.equal(authResult.user.role,'ADMIN');token=authResult.accessToken;tokenCreatedAt=Date.now();assert.ok(token);
    report.status='INCOMPLETE';await save();
    for(const scenario of selected){
      active=report.scenarios[scenario.id];if(active.consecutive>=TARGET)continue;
      // Attempts are bounded per invocation so --resume can genuinely continue.
      for(let i=0;i<attempts&&active.consecutive<TARGET;i++){
        check();
        // The server's normal token lifetime is two hours. Refresh only the
        // bootstrap session, never fixture sessions whose revocation is tested.
        if(Date.now()-tokenCreatedAt>100*60000){const refreshed=expect(await req('/auth/login','POST',{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD}),201);token=refreshed.accessToken;assert.ok(token);tokenCreatedAt=Date.now();report.bootstrapRefreshes=(report.bootstrapRefreshes||0)+1;await save();}
        const started=performance.now();let ok=false;let category;
        const marker=report.marker+'-'+randomUUID().slice(0,8);const password='QA-only-'+randomUUID();
        const c={marker,password,token,origins,req,raw,backoff,paid:async id=>{assert.match(env.STRIPE_WEBHOOK_SECRET||'',/^whsec_local_[a-f0-9-]{36}$/);const payload=JSON.stringify({id:'evt_local_'+id,type:'checkout.session.completed',data:{object:{id:'cs_local_'+id,metadata:{bookingId:id},payment_status:'paid',payment_intent:'pi_local_'+id,amount_total:27500}}});const {createHmac}=backendRequire('node:crypto');const t=Math.floor(Date.now()/1000);const sig='t='+t+',v1='+createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(t+'.'+payload).digest('hex');expect(await req('/webhooks/stripe','POST',JSON.parse(payload),{'stripe-signature':sig}),200);},auth:(p,m,d)=>req(p,m,d,{Authorization:'Bearer '+token})};
        c.content=async(kind,extra={})=>expect(await c.auth('/admin/'+kind,'POST',{title:marker,slug:marker,status:'DRAFT',...extra}),201);
        c.user=async role=>expect(await c.auth('/admin/users','POST',{name:marker,email:marker+'-'+role.toLowerCase()+'@example.invalid',password,role}),201);
        report.current={scenario:scenario.id,attempt:active.total+1,startedAt:new Date().toISOString()};await save();
        try{await scenario.run(c);ok=true;}catch(e){category=e?.code==='ERR_ASSERTION'?'ASSERTION_FAILED':'REQUEST_OR_SAFETY_FAILED';active.lastErrorCode=safeErrorCode(e);active.lastErrorName=typeof e?.name==='string'&&/^[A-Za-z]+$/.test(e.name)?e.name:'Error';if(Number.isInteger(e?.actual)&&Number.isInteger(e?.expected))active.lastStatusMismatch={actual:e.actual,expected:e.expected};}
        try{await cleanup();}catch{ok=false;category='CLEANUP_FAILED';report.cleanup={status:'INCOMPLETE'};}
        advance(active,ok,performance.now()-started);active.lastResult=ok?'EXPECTED_PASS':category;await save();
        console.log(scenario.id+': '+active.consecutive+'/'+TARGET+' consecutive; total='+active.total+' pass='+active.pass+' fail='+active.fail);
        if(category==='CLEANUP_FAILED'||stopping)throw new Error('Cleanup or interruption requires resume');
      }
      if(active.consecutive<TARGET){report.reason='Scenario exhausted bounded attempts: '+scenario.id;break;}
    }
    report.status=selected.every(s=>report.scenarios[s.id].consecutive>=TARGET)?(only?'PASS_SELECTED_ONLY':'PASS'):'INCOMPLETE';
  } catch {report.status='INCOMPLETE';report.reason='Request, safety, cleanup or time bound stopped execution; inspect counters and resume';}
  finally {
    // No seeded admin logout/update: it would invalidate real sessions.
    if(report.status!=='NOT RUN')try{await cleanup();}catch{report.status='INCOMPLETE';report.cleanup={status:'INCOMPLETE'};}
    delete report.current;report.finishedAt=new Date().toISOString();await save();await db.$disconnect().catch(()=>{});await lock.close();await fs.unlink(lockFile).catch(()=>{});process.removeListener('SIGINT',interrupted);process.removeListener('SIGTERM',interrupted);
  }
  console.log(report.status+': '+reportFile);if(!['PASS','PASS_SELECTED_ONLY'].includes(report.status))process.exitCode=2;
}
module.exports={localURL,integer,retryMs,advance,catalog,TARGET,transientNetwork,safeErrorCode,assertLocalPaymentSafety,sourceFingerprint,main};
if(require.main===module)main().catch(error=>{const code=typeof error?.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'VALIDATION';console.error('NOT RUN: runner safety/configuration failure ['+code+']. No secrets logged.');process.exitCode=1;});
