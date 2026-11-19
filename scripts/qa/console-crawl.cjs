'use strict';
// Local-only crawl: every sitemap route at desktop and phone widths. Records CSP violations,
// uncaught page errors, console errors, failed requests and same-origin HTTP errors.
// Usage: QA_BASE_URL=http://localhost:3000 QA_TMP=<absolute dir> node scripts/qa/console-crawl.cjs
const {chromium}=require('playwright');
const fs=require('node:fs');const path=require('node:path');
const base=new URL(process.env.QA_BASE_URL||'http://localhost:3000');
if(!['localhost','127.0.0.1'].includes(base.hostname)||base.username||base.password)throw new Error('Local QA URLs only');
const out=process.env.QA_TMP;if(!out||!path.isAbsolute(out))throw new Error('Set absolute QA_TMP');
const widths=(process.env.QA_WIDTHS||'1440,390').split(',').map(Number);
const limit=Number(process.env.QA_ROUTE_LIMIT||1000);
(async()=>{
 const xml=await (await fetch(new URL('/sitemap.xml',base))).text();
 let routes=[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>{const u=new URL(m[1]);return u.pathname+u.search;});
 routes=[...new Set(['/','/contact-us/','/account/','/login/','/admin',...routes])].slice(0,limit);
 const browser=await chromium.launch({headless:true});const findings=[];
 for(const width of widths){
  const context=await browser.newContext({viewport:{width,height:width<600?844:900}});
  for(const route of routes){
   const page=await context.newPage();const issues=[];
   // A signed-out session probe is expected to answer 401; it is not a defect.
   const expected401=u=>/\/api\/(auth\/me|account\/auth\/session)\/?$/.test(u);
   page.on('console',m=>{const t=m.text();if(/status of 401/.test(t)&&['/admin','/account/','/login/'].includes(route))return;if(m.type()==='error'||/Content Security Policy|Refused to/i.test(t))issues.push({kind:/Content Security Policy|Refused to/i.test(t)?'csp':'console',text:t.slice(0,300)});});
   page.on('pageerror',e=>issues.push({kind:'pageerror',text:String(e.message).slice(0,300)}));
   page.on('requestfailed',r=>{const f=r.failure()?.errorText||'';if(!/ERR_ABORTED/.test(f))issues.push({kind:'requestfailed',text:r.url().slice(0,200)+' '+f});});
   page.on('response',r=>{try{const u=new URL(r.url());if(u.origin===base.origin&&u.pathname.startsWith('/api/')&&r.status()>=300&&r.status()<400)issues.push({kind:'api-redirect',text:r.status()+' '+u.pathname});if(u.origin===base.origin&&r.status()>=400&&!(r.status()===401&&expected401(u.pathname)))issues.push({kind:'http',text:r.status()+' '+u.pathname});}catch{}});
   try{await page.goto(new URL(route,base).href,{waitUntil:'networkidle',timeout:60000});await page.mouse.wheel(0,4000);await page.waitForTimeout(800);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);if(overflow>1)issues.push({kind:'overflow',text:'horizontal overflow '+overflow+'px'});}
   catch(e){issues.push({kind:'navigation',text:String(e.message).slice(0,200)});}
   for(const i of issues)findings.push({width,route,...i});
   await page.close();
  }
  await context.close();
 }
 await browser.close();
 fs.writeFileSync(path.join(out,'console-crawl.json'),JSON.stringify({base:base.href,routes:routes.length,widths,findings},null,1));
 const byKind={};for(const f of findings)byKind[f.kind]=(byKind[f.kind]||0)+1;
 console.log(JSON.stringify({routes:routes.length,widths,findings:findings.length,byKind}));
 process.exitCode=findings.length?1:0;
})().catch(e=>{console.error(e);process.exitCode=2;});
