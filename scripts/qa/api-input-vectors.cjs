'use strict';
/* Node 22+. NONMUTATING localhost-only companion. No fixtures, DB, credentials or valid submissions.
 * Run SERIAL ONLY after the frozen api-scenarios.cjs exits:
 * QA_TMP=<absolute fresh directory> QA_AFTER_REPORT=<absolute api-scenarios.json>
 * node scripts/qa/api-input-vectors.cjs [--resume]
 * QA_API_URL defaults http://localhost:4000/api; QA_MAX_ATTEMPTS=60 (20..100),
 * QA_MAX_HOURS=12 (1..24); QA_REQUEST_TIMEOUT_MS=15000 (1000..60000).
 * Required predecessor: full 398-case PASS, cleanup PASS, no activity/lock.
 * Implementation is NOT RUN until explicitly invoked after the full runner.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash,randomUUID} = require('node:crypto');
const RESOURCES=Object.freeze(['pages','services','pricing','blog','categories','tags','popups','settings','coworking','virtual-office','dedicated-desk','business-address','mailbox','podcast-packages','meeting-rooms','events-space','photo-studio','llc-services','workshops','webinars','memberships']);
const TARGET=20, VERSION=1, MAX_RETRIES=4, OVERSIZED_BYTES=150*1024;
const secretKey=/(password|secret|token|api.?key|private.?key|credential|smtp)/i;
const sha=x=>createHash('sha256').update(x).digest('hex');
function localURL(raw){
 let u;try{u=new URL(raw);}catch{throw new Error('Local URL required');}
 if(!['http:','https:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.hash)throw new Error('Local URL required');
 return u;
}
function integer(raw,fallback,min,max){const n=raw===undefined?fallback:Number(raw);if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error('Invalid bounded setting');return n;}
function retryMs(value,now=Date.now()){
 if(value===null||value===undefined||!String(value).trim())return 61000;
 const v=String(value).trim(),n=/^\d+(?:\.\d+)?$/.test(v)?Number(v)*1000:Date.parse(v)-now;
 return Number.isFinite(n)&&n>=0&&n<Number.MAX_SAFE_INTEGER-250?Math.ceil(n)+250:61000;
}
function freshStats(){return {status:'NOT RUN',total:0,pass:0,fail:0,consecutive:0,flaky:0,latencyMs:0,averageLatencyMs:0,minLatencyMs:null,maxLatencyMs:0,requests:0,retries429:0,retriesNetwork:0,retries5xx:0,backoffMs:0};}
function advance(s,ok,ms){
 if(s.lastOutcome!==undefined&&s.lastOutcome!==ok)s.flaky++;
 s.lastOutcome=ok;s.total++;s[ok?'pass':'fail']++;s.consecutive=ok?s.consecutive+1:0;
 s.latencyMs+=ms;s.averageLatencyMs=+(s.latencyMs/s.total).toFixed(2);
 s.minLatencyMs=s.minLatencyMs===null?ms:Math.min(s.minLatencyMs,ms);s.maxLatencyMs=Math.max(s.maxLatencyMs,ms);s.status=s.consecutive>=TARGET?'PASS':'INCOMPLETE';
}
function noSecrets(value){if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){assert.ok(!secretKey.test(key),'Forbidden public key');noSecrets(child);}}
function publicList(r){
 assert.equal(r.status,200);const b=r.body;assert.ok(b&&Array.isArray(b.items));
 assert.ok(Number.isSafeInteger(b.total)&&b.total>=0);assert.ok(Number.isSafeInteger(b.page)&&b.page>=1);assert.ok(Number.isSafeInteger(b.limit)&&b.limit>=1&&b.limit<=100);
 assert.ok(b.items.length<=b.limit&&b.items.length<=b.total);noSecrets(b);
 for(const row of b.items){assert.equal(row.status,'PUBLISHED');assert.notEqual(row.metadata?.enabled,false);}return b;
}
function postBody(kind){
 if(kind==='malformed')return '{"qaUnknown":';
 if(kind==='oversized')return JSON.stringify({qaUnknown:'x'.repeat(OVERSIZED_BYTES-Buffer.byteLength('{"qaUnknown":""}'))});
 if(kind==='login')return JSON.stringify({email:'not-an-email',password:'',qaUnknown:true});
 throw new Error('Unapproved POST vector');
}
function catalog(){
 const out=[],add=(id,p,expected,check,method='GET',body)=>out.push({id,path:p,expected,check,method,body});
 for(const kind of RESOURCES){
  const p='/public/'+kind,search=value=>p+'?search='+encodeURIComponent(value);
  const absent=r=>{const b=publicList(r);assert.equal(b.total,0);assert.equal(b.items.length,0);};
  add('public.'+kind+'.search.sql',c=>search(c.marker+"' OR 1=1 --"),200,absent);
  add('public.'+kind+'.search.script',c=>search(c.marker+'<script>alert(1)</script>'),200,absent);
  add('public.'+kind+'.search.unicode',()=>search('کراچی 中文 café 😀'),200,publicList);
  add('public.'+kind+'.search.length200',c=>search(c.marker+'x'.repeat(200-c.marker.length)),200,publicList);
  add('public.'+kind+'.search.length201',c=>search(c.marker+'x'.repeat(201-c.marker.length)),400);
  add('public.'+kind+'.detail.attack-slug',c=>p+'/'+encodeURIComponent(c.marker+"' OR 1=1 --<script>"),404);
  add('public.'+kind+'.public-safety',()=>p+'?limit=100',200,publicList);
 }
 for(const endpoint of ['/inquiries','/bookings'])for(const [vector,status]of [['malformed',400],['oversized',413]])add(endpoint.slice(1)+'.json.'+vector,()=>endpoint,status,undefined,'POST',postBody(vector));
 add('auth.login.malformed-dto',()=>'/auth/login',400,undefined,'POST',postBody('login'));
 add('auth.me.no-credentials',()=>'/auth/me',401);return out;
}
function requestURL(base,p,method,body){
 if(typeof p!=='string'||!p.startsWith('/')||p.startsWith('//')||/[\\#\r\n]/.test(p))throw new Error('Unapproved route');
 const b=localURL(base),u=localURL(base+p);
 if(b.pathname!=='/api'||b.search||u.origin!==b.origin||!u.pathname.startsWith('/api/'))throw new Error('Unapproved destination');
 const pub=/^\/api\/public\/([a-z-]+)(?:\/[^/]+)?$/.exec(u.pathname);
 if(method==='GET'){
  if(body!==undefined||!(u.pathname==='/api/auth/me'||(pub&&RESOURCES.includes(pub[1]))))throw new Error('Unapproved read');
 }else if(method==='POST'){
  if(u.search||!((['/api/inquiries','/api/bookings'].includes(u.pathname)&&[postBody('malformed'),postBody('oversized')].includes(body))||(u.pathname==='/api/auth/login'&&body===postBody('login'))))throw new Error('Unapproved POST');
 }else throw new Error('Unapproved method');return u;
}
function transient(e){return e?.name==='TimeoutError'||e?.name==='AbortError'||['ECONNREFUSED','ECONNRESET','EPIPE','ETIMEDOUT','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(e?.cause?.code||e?.code)||(e instanceof TypeError&&e.message==='fetch failed');}
class Stop extends Error{}
async function predecessor(filename){
 if(!filename||!path.isAbsolute(filename)||path.basename(filename)!=='api-scenarios.json')throw new Error('Absolute QA_AFTER_REPORT required');
 const bytes=await fs.readFile(filename),r=JSON.parse(bytes);
 if(!r.finishedAt||r.current||r.pending||r.status!=='PASS'||r.fullCoverage!==true||r.cleanup?.status!=='PASS'||r.selected?.length!==398||new Set(r.selected).size!==398||r.selected.some(id=>!Number.isSafeInteger(r.scenarios?.[id]?.consecutive)||r.scenarios[id].consecutive<TARGET||r.scenarios[id].status!=='PASS'))throw new Error('Finished full PASS predecessor required');
 if(r.fingerprint!==sha(await fs.readFile(path.join(__dirname,'api-scenarios.cjs'))))throw new Error('Frozen predecessor fingerprint mismatch');
 if(r.sourceVersion!==await require('./api-scenarios.cjs').sourceFingerprint(path.resolve(__dirname,'../..')))throw new Error('Predecessor source/runtime fingerprint mismatch');
 try{await fs.access(path.join(path.dirname(filename),'.api-scenarios.lock'));}catch(e){if(e.code==='ENOENT')return {file:path.resolve(filename),fingerprint:sha(bytes)};throw e;}
 throw new Error('Full runner lock still present');
}
async function main(){
 const args=process.argv.slice(2);if(args.length>1||args.some(x=>x!=='--resume'))throw new Error('Only --resume supported');
 const out=process.env.QA_TMP;if(!out||!path.isAbsolute(out))throw new Error('Absolute fresh QA_TMP required');
 const bu=localURL(process.env.QA_API_URL||'http://localhost:4000/api');if(bu.pathname!=='/api'||bu.search)throw new Error('QA_API_URL must end in /api');
 const base=bu.href,prior=await predecessor(process.env.QA_AFTER_REPORT);
 const limits={attempts:integer(process.env.QA_MAX_ATTEMPTS,60,20,100),hours:integer(process.env.QA_MAX_HOURS,12,1,24),requestTimeoutMs:integer(process.env.QA_REQUEST_TIMEOUT_MS,15000,1000,60000),maxRetries:MAX_RETRIES,requiredConsecutive:TARGET,responseByteLimit:2*1024*1024};
 const deadline=Date.now()+limits.hours*3600000,scenarios=catalog(),ids=scenarios.map(s=>s.id),fingerprint=sha(await fs.readFile(__filename));
 await fs.mkdir(out,{recursive:true});const file=path.join(out,'api-input-vectors.json'),lockFile=path.join(out,'.api-input-vectors.lock');let report;
 if(args.includes('--resume')){
  report=JSON.parse(await fs.readFile(file,'utf8'));
  if(report.version!==VERSION||report.fingerprint!==fingerprint||report.base!==base||JSON.stringify(report.limits)!==JSON.stringify(limits)||JSON.stringify(report.predecessor)!==JSON.stringify(prior)||JSON.stringify(report.selected)!==JSON.stringify(ids)||!/^qa-iv-[a-f0-9-]{36}$/.test(report.marker))throw new Error('Resume configuration mismatch');
  if(Object.keys(report.scenarios).length!==ids.length)throw new Error('Invalid resume counters');
  for(const id of ids){const s=report.scenarios[id];if(!s||['total','pass','fail','consecutive','flaky','requests','retries429','retriesNetwork','retries5xx'].some(k=>!Number.isSafeInteger(s[k])||s[k]<0)||s.total!==s.pass+s.fail||s.consecutive>TARGET||s.consecutive>s.pass)throw new Error('Invalid resume counters');}
 }else{
  if((await fs.readdir(out)).length)throw new Error('Fresh QA_TMP required, or --resume');
  report={version:VERSION,fingerprint,base,predecessor:prior,limits,selected:ids,marker:'qa-iv-'+randomUUID(),status:'NOT RUN',startedAt:new Date().toISOString(),scenarios:Object.fromEntries(ids.map(id=>[id,freshStats()])),coverageLimits:['Negative vectors only; no valid submissions, fixtures, database clients or credential use.','Public safety checks observed rows only (up to 100/resource plus search results); empty results do not prove draft exclusion or exhaustive secret filtering.','Literal script/SQL search behavior only, not browser execution or exhaustive exploit proof.','No external integrations; supplements, never replaces, the frozen 398-case runner.']};
 }
 let lock;try{lock=await fs.open(lockFile,'wx');await lock.writeFile(String(process.pid));}catch{throw new Error('Companion locked; verify exited before removing stale lock');}
 let stopping=false;const interrupted=()=>{stopping=true;};process.on('SIGINT',interrupted);process.on('SIGTERM',interrupted);
 const check=()=>{if(stopping||Date.now()>=deadline)throw new Stop('Interrupted or deadline');};
 const save=async()=>{
  const counters=freshStats();for(const s of Object.values(report.scenarios))for(const k of ['total','pass','fail','flaky','latencyMs','requests','retries429','retriesNetwork','retries5xx','backoffMs'])counters[k]+=s[k];
  report.counters=Object.fromEntries(Object.entries(counters).filter(([k])=>!['status','consecutive','minLatencyMs','maxLatencyMs'].includes(k)));report.counters.averageLatencyMs=counters.total?+(counters.latencyMs/counters.total).toFixed(2):0;
  report.metricNotes={latency:'Whole iteration including retry/backoff; prior-process interrupted iteration has unknown latency recorded as zero',flaky:'Pass/fail transitions; failed/interrupted iterations reset streak',retries:'429, network, 502/503/504 recoveries are not passes; only final assertions advance streak'};
  report.updatedAt=new Date().toISOString();await fs.writeFile(file+'.tmp',JSON.stringify(report,null,2));await fs.rename(file+'.tmp',file);
 };
 const backoff=async(ms,s)=>{check();if(Date.now()+ms>=deadline)throw new Stop('Backoff exceeds budget');const start=Date.now();while(Date.now()-start<ms){check();await new Promise(r=>setTimeout(r,Math.min(1000,ms-(Date.now()-start))));}s.backoffMs+=Date.now()-start;await save();check();};
 async function req(p,method,body,s){
  const u=requestURL(base,p,method,body);
  for(let retry=0;retry<=MAX_RETRIES;retry++){
   check();s.requests++;await save();let r,text;
   try{
    r=await fetch(u,{method,redirect:'manual',credentials:'omit',headers:{Accept:'application/json',...(method==='POST'?{'Content-Type':'application/json'}:{})},...(body===undefined?{}:{body}),signal:AbortSignal.timeout(Math.min(limits.requestTimeoutMs,Math.max(1,deadline-Date.now())))});
    if(r.status>=300&&r.status<400){await r.body?.cancel();throw new Stop('Redirect rejected');}
    if(method==='POST'&&r.status>=200&&r.status<300){await r.body?.cancel();throw new Stop('Unexpected POST success; no cleanup attempted');}
    const reader=r.body?.getReader(),chunks=[];let bytes=0;
    if(reader)for(;;){const v=await reader.read();if(v.done)break;bytes+=v.value.byteLength;if(bytes>limits.responseByteLimit){await reader.cancel();throw new Stop('Response exceeds cap');}chunks.push(Buffer.from(v.value));}
    text=Buffer.concat(chunks).toString('utf8');
   }catch(e){
    if(e instanceof Stop||!transient(e))throw e;s.retriesNetwork++;await save();if(retry===MAX_RETRIES)throw new Error('Network retries exhausted');await backoff(Math.min(30000,1000*2**retry),s);continue;
   }
   if(r.status===429||[502,503,504].includes(r.status)){
    s[r.status===429?'retries429':'retries5xx']++;await save();await backoff(r.headers.has('retry-after')||r.status===429?retryMs(r.headers.get('retry-after')):Math.min(30000,1000*2**retry),s);if(retry===MAX_RETRIES)throw new Error('HTTP retries exhausted');continue;
   }
   let parsed;try{parsed=JSON.parse(text);}catch{throw new Error('Expected JSON');}noSecrets(parsed);return {status:r.status,body:parsed};
  }
 }
 try{
  if(report.current){const s=report.scenarios[report.current.scenario];if(!s)throw new Stop('Invalid interrupted scenario');advance(s,false,0);s.lastResult='INTERRUPTED_UNCONFIRMED';delete report.current;}
  report.status='INCOMPLETE';delete report.finishedAt;await save();
  for(const scenario of scenarios){
   const s=report.scenarios[scenario.id];
   for(let n=0;n<limits.attempts&&s.consecutive<TARGET;n++){
    check();const latest=await predecessor(prior.file);if(latest.fingerprint!==prior.fingerprint)throw new Stop('Predecessor changed');
    const start=performance.now();let ok=false,fatal=false;report.current={scenario:scenario.id,attempt:s.total+1,startedAt:new Date().toISOString()};await save();
    try{const c={marker:report.marker+'-'+randomUUID().slice(0,8)},r=await req(scenario.path(c),scenario.method,scenario.body,s);assert.equal(r.status,scenario.expected);scenario.check?.(r);ok=true;s.lastResult='EXPECTED_PASS';}
    catch(e){s.lastResult=e instanceof Stop?'SAFETY_OR_BUDGET_STOP':e?.code==='ERR_ASSERTION'?'ASSERTION_FAILED':'REQUEST_FAILED';fatal=e instanceof Stop;}
    advance(s,ok,performance.now()-start);delete report.current;await save();console.log(scenario.id+': '+s.consecutive+'/'+TARGET+' consecutive; pass='+s.pass+' fail='+s.fail);if(fatal||stopping)throw new Stop('Stopped');
   }
   if(s.consecutive<TARGET){report.reason='Scenario exhausted attempts: '+scenario.id;break;}
  }
  report.status=ids.every(id=>report.scenarios[id].consecutive>=TARGET)?'PASS':'INCOMPLETE';
 }catch{report.status='INCOMPLETE';report.reason='Safety/configuration change, interrupted or bounded budget; inspect counters and resume';}
 finally{report.finishedAt=new Date().toISOString();await save();await lock.close();await fs.unlink(lockFile);process.removeListener('SIGINT',interrupted);process.removeListener('SIGTERM',interrupted);}
 console.log(report.status+': '+file);if(report.status!=='PASS')process.exitCode=2;
}
module.exports={RESOURCES,TARGET,MAX_RETRIES,OVERSIZED_BYTES,localURL,integer,retryMs,freshStats,advance,noSecrets,publicList,postBody,catalog,requestURL,transient};
if(require.main===module)main().catch(()=>{console.error('NOT RUN: companion configuration/safety failure. No response bodies or secrets logged.');process.exitCode=1;});
