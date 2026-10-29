import 'dotenv/config';
import {frontendOrigins} from '../src/origins';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const base='http://localhost:4000/api';
if(process.env.SMTP_HOST)throw new Error('Integration inquiry tests require SMTP_HOST unset to prevent email sending');
test('live PostgreSQL API security and CRUD',async()=>{
 const call=async(p:string,method='GET',data?:any,token?:string)=>{let r=await fetch(base+p,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});if(r.status===429){await new Promise(resolve=>setTimeout(resolve,Math.min(61,Number(r.headers.get('retry-after')||60))*1000));r=await fetch(base+p,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});}return {status:r.status,body:await r.json()};};
 assert.equal((await call('/health')).status,200);
 assert.equal((await call('/admin/pages')).status,401);
 assert.equal((await call('/auth/login','POST',{email:'bad',password:'x'})).status,400);
 const auth=await call('/auth/login','POST',{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD});assert.equal(auth.status,201);const token=auth.body.accessToken;assert.ok(token);assert.equal(auth.body.user.role,'ADMIN');
 assert.equal((await call('/auth/me','GET',undefined,token)).status,200);
 const slug='integration-'+Date.now();const created=await call('/admin/pages','POST',{title:'Integration page',slug,status:'DRAFT',content:{html:'<p>Test</p>'}},token);assert.equal(created.status,201);const id=created.body.id;
 assert.equal((await call('/public/pages/'+slug)).status,404);
 assert.equal((await call('/admin/pages/'+id,'PATCH',{status:'PUBLISHED'},token)).status,200);
 assert.equal((await call('/public/pages/'+slug)).status,200);
 assert.equal((await call('/admin/pages','POST',{title:'Bad',slug:'x',unexpected:true},token)).status,400);
 const viewer=await call('/admin/users','POST',{name:'Test viewer',email:slug+'@example.com',password:'Test-password-98765',role:'VIEWER'},token);assert.equal(viewer.status,201);assert.equal(viewer.body.passwordHash,undefined);
 const vlogin=await call('/auth/login','POST',{email:slug+'@example.com',password:'Test-password-98765'});const vt=vlogin.body.accessToken;
 assert.equal((await call('/admin/pages','POST',{title:'No',slug:'no'},vt)).status,403);assert.equal((await call('/admin/users','GET',undefined,vt)).status,403);
 const inquiry=await call('/inquiries','POST',{name:'Integration test',email:'test@example.com',message:'API integration test'});assert.equal(inquiry.status,201);assert.ok(['NOT_CONFIGURED','SENT','FAILED'].includes(inquiry.body.emailStatus));
 assert.equal((await call('/admin/inquiries/'+inquiry.body.id,'DELETE',undefined,token)).status,200);
 assert.equal((await call('/admin/users/'+viewer.body.id,'PATCH',{active:false},token)).status,200);assert.equal((await call('/auth/me','GET',undefined,vt)).status,401);
 assert.equal((await call('/admin/users/'+viewer.body.id,'DELETE',undefined,token)).status,200);
 assert.equal((await call('/admin/pages/'+id,'PATCH',{title:null},token)).status,400);
 assert.equal((await call('/admin/pages/'+id,'DELETE',undefined,token)).status,200);
 const cookieBlocked=await fetch(base+'/admin/pages',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'access_token='+token},body:JSON.stringify({title:'Blocked',slug:'blocked'})});assert.equal(cookieBlocked.status,403);
 const popup=await call('/admin/popups','POST',{title:'Test popup',slug,status:'PUBLISHED',metadata:{trigger:'manual'}},token);assert.equal(popup.status,201);
 assert.equal((await call('/popup-events','POST',{popupId:popup.body.id,event:'view',sessionId:slug})).status,201);
 const stats=await call('/admin/popup-stats','GET',undefined,token);assert.equal(stats.status,200);assert.equal(stats.body.items.find((x:any)=>x.popupId===popup.body.id).views,1);
 assert.equal((await call('/admin/popups/'+popup.body.id,'DELETE',undefined,token)).status,200);
 const badForm=new FormData();badForm.append('file',new Blob(['<script>alert(1)</script>'],{type:'image/png'}),'malicious.png');assert.equal((await fetch(base+'/admin/media',{method:'POST',headers:{Authorization:'Bearer '+token},body:badForm})).status,400);
 const goodForm=new FormData();goodForm.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'pixel.png');const uploaded=await fetch(base+'/admin/media',{method:'POST',headers:{Authorization:'Bearer '+token},body:goodForm});assert.equal(uploaded.status,201);const media=await uploaded.json();assert.equal((await fetch(media.url)).status,200);assert.equal((await call('/admin/media/'+media.id,'DELETE',undefined,token)).status,200);

 // Null values must not bypass optional field validation.
 assert.equal((await call('/admin/pages','POST',{title:'Null content',slug:slug+'-null',content:null},token)).status,400);
 assert.equal((await call('/admin/users','POST',{name:'Bytes',email:slug+'-bytes@example.com',password:'😀'.repeat(20),role:'VIEWER'},token)).status,400);
 assert.equal((await call('/public/blog?limit=101')).status,400);
 assert.equal((await call('/public/blog?page=0')).status,400);
 assert.equal((await call('/public/blog?page=99999999999')).status,400);
 assert.equal((await call('/inquiries','POST',{name:'   ',email:'test@example.com',message:'    '})).status,400);
 assert.equal((await call('/inquiries','POST',{name:'Spam',email:'spam@example.com',message:'spam test',website:'https://spam.example'})).status,400);
 assert.equal((await call('/admin/users/'+auth.body.user.id,'PATCH',{role:'EDITOR'},token)).status,400);
 assert.equal((await call('/admin/users/'+auth.body.user.id,'DELETE',undefined,token)).status,400);
 const records:Array<{kind:string,id:string}>=[];
 try {
 for(const resource of ['blog','pricing','popups']){
  const m=resource==='pricing'?{price:35,features:['Real feature'],enabled:false}:{publishAt:'2099-01-01T00:00:00Z'};
  const row=await call('/admin/'+resource,'POST',{title:'Scheduled integration '+resource,slug:slug+'-'+resource,status:'PUBLISHED',metadata:m,content:{html:'<p>Safe</p><script>bad()</script>'}},token);
  assert.equal(row.status,201);records.push({kind:resource,id:row.body.id});
  assert.equal((await call('/public/'+resource+'/'+row.body.slug)).status,404);
  const list=await call('/public/'+resource+'?search=Scheduled%20integration');assert.equal(list.body.items.some((x:any)=>x.id===row.body.id),false);
  if(resource==='popups')assert.equal((await call('/popup-events','POST',{popupId:row.body.id,event:'view'})).status,404);
  const patch=await call('/admin/'+resource+'/'+row.body.id,'PATCH',{metadata:resource==='pricing'?{price:35,features:['Real feature'],enabled:true}:{publishAt:'2000-01-01T00:00:00Z',smtpPassword:'not-a-real-secret'}},token);assert.equal(patch.status,200);
  const visible=await call('/public/'+resource+'/'+row.body.slug);assert.equal(visible.status,200);assert.equal(visible.body.metadata.smtpPassword,undefined);assert.ok(!visible.body.content.html.includes('<script>'));
 }
 assert.equal((await call('/admin/pricing','POST',{title:'Invalid',slug:slug+'-invalid',metadata:{price:-1}},token)).status,400);
 assert.equal((await call('/admin/popups','POST',{title:'Invalid schedule',slug:slug+'-dates',metadata:{startsAt:'2030-01-01T00:00:00Z',endsAt:'2020-01-01T00:00:00Z'}},token)).status,400);
 }finally{for(const row of records)await call('/admin/'+row.kind+'/'+row.id,'DELETE',undefined,token);}

 // Regression: explicit CORS allowlist and cookie CSRF share the same policy.
 for(const origin of frontendOrigins()){
 const cors=await fetch(base+'/health',{headers:{Origin:origin}});assert.equal(cors.status,200);assert.equal(cors.headers.get('access-control-allow-origin'),origin);assert.equal(cors.headers.get('access-control-allow-credentials'),'true');assert.equal(cors.headers.get('x-ratelimit-limit'),'2000');
 const preflight=await fetch(base+'/admin/pages',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
 const cookieWrite=await fetch(base+'/admin/pages',{method:'POST',headers:{Origin:origin,Cookie:'access_token='+token,'Content-Type':'application/json'},body:JSON.stringify({title:'Allowed origin integration',slug:slug+'-origin-'+new URL(origin).port})});assert.equal(cookieWrite.status,201);const cw=await cookieWrite.json();assert.equal((await call('/admin/pages/'+cw.id,'DELETE',undefined,token)).status,200);
 }
 const badOrigin='http://localhost:9999';const rejected=await fetch(base+'/health',{headers:{Origin:badOrigin}});assert.equal(rejected.headers.get('access-control-allow-origin'),null);
 const badCookie=await fetch(base+'/admin/pages',{method:'POST',headers:{Origin:badOrigin,Cookie:'access_token='+token,'Content-Type':'application/json'},body:JSON.stringify({title:'Blocked origin',slug:slug+'-blocked'})});assert.equal(badCookie.status,403);
 const reads=await Promise.all(Array.from({length:130},()=>fetch(base+'/public/settings?limit=1')));for(const read of reads){assert.equal(read.status,200);assert.equal(read.headers.get('x-ratelimit-limit'),'2000');}
 const notFoundDetail=await fetch(base+'/public/pages/nonexistent-integration-'+slug);assert.equal(notFoundDetail.status,404);assert.equal(notFoundDetail.headers.get('x-ratelimit-limit'),'2000');
 assert.equal((await call('/auth/logout','POST',{},token)).status,201);assert.equal((await call('/auth/me','GET',undefined,token)).status,401);
});

