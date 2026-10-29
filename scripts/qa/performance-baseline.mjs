import fs from 'node:fs/promises';
import path from 'node:path';
import lighthouse from 'lighthouse';
import {launch} from 'chrome-launcher';
import {chromium} from '@playwright/test';

async function main(){
// Serial, read-only profiling. Does not replace frozen acceptance reports.
const base=process.env.QA_BASE_URL||'http://localhost:3100';
const api=process.env.QA_API_URL||'http://localhost:4000/api';
const out=process.env.QA_TMP;
const count=Number(process.env.QA_SAMPLES||5);
for(const value of [base,api]){
 const url=new URL(value);
 if(!['localhost','127.0.0.1'].includes(url.hostname)||!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Local QA URLs only');
}
if(!out||!path.isAbsolute(out))throw Error('Set absolute QA_TMP');
if(!Number.isInteger(count)||count<3||count>10)throw Error('QA_SAMPLES must be an integer from 3 to 10');
await fs.mkdir(out,{recursive:true});
const summaryPath=path.join(out,'performance-baseline-summary.json');
try{await fs.access(summaryPath);throw Error('Use a fresh QA_TMP to preserve previous evidence');}catch(error){if(error.code!=='ENOENT')throw error;}
async function readiness(route){
 const options={signal:AbortSignal.timeout(10000)};
 const health=await fetch(api+'/health',options);
 const pricing=await fetch(api+'/public/pricing?limit=1',options);
 const popup=await fetch(api+'/public/popups',{...options,headers:{Origin:new URL(base).origin}});
 await health.arrayBuffer();
 await popup.arrayBuffer();
 const pricingData=await pricing.json();
 if(!health.ok||!pricing.ok||!pricingData.items?.length)throw Error('Healthy API and published pricing required');
 if(!popup.ok||popup.headers.get('access-control-allow-origin')!==new URL(base).origin)throw Error('QA frontend origin is not allowed by API; set FRONTEND_URLS before starting API');
 const response=await fetch(base+route,options);
 const html=await response.text();
 if(!response.ok||!html.includes('pricing-section')||(route==='/'&&!html.includes('source-home')))throw Error('Full-content/pricing readiness guard failed');
 return {htmlBytes:Buffer.byteLength(html),sourceHome:route==='/'?html.includes('source-home'):null,pricing:true};
}
const distribution=values=>{
 const ordered=[...values].sort((a,b)=>a-b),middle=Math.floor(ordered.length/2);
 return {min:ordered[0],median:ordered.length%2?ordered[middle]:(ordered[middle-1]+ordered[middle])/2,max:ordered.at(-1)};
};
const measurements=[];
function summarize(){
 return {kind:'Repeated unchanged full-content baseline, not candidate acceptance',settings:'Default Lighthouse simulated mobile, alternating home/coworking, single Chrome, fresh Lighthouse storage per sample; server/image cache is warmed and not reset',requestedSamplesPerRoute:count,measurements,aggregate:Object.fromEntries(['home','coworking'].map(name=>{
 const rows=measurements.filter(m=>m.name===name&&m.valid);
 return [name,{validSamples:rows.length,invalidSamples:measurements.filter(m=>m.name===name&&!m.valid).length,...(rows.length?{performance:distribution(rows.map(r=>r.scores.performance)),lcpMs:distribution(rows.map(r=>r.lcpMs)),tbtMs:distribution(rows.map(r=>r.tbtMs)),allSamplesMeetTargets:rows.every(r=>r.meetsTargets)}:{})}];
 }))};
}
await readiness('/');
const chrome=await launch({chromePath:chromium.executablePath(),chromeFlags:['--headless','--no-sandbox','--disable-dev-shm-usage']});
try{
 for(let sample=1;sample<=count;sample++)for(const [name,route] of [['home','/'],['coworking','/coworking/']]){
  const content=await readiness(route);
  const result=await lighthouse(base+route,{port:chrome.port,output:'json',logLevel:'error',onlyCategories:['performance','accessibility','best-practices','seo']});
  const stem=sample+'-'+name;
  await fs.writeFile(path.join(out,stem+'.json'),result.report);
  const trace=result.artifacts?.Trace||result.artifacts?.traces?.defaultPass;
  if(trace)await fs.writeFile(path.join(out,stem+'-trace.json'),JSON.stringify(trace));
  await readiness(route);
  const l=result.lhr,a=l.audits;
  const valid=!l.runtimeError&&a['errors-in-console']?.score===1&&l.finalDisplayedUrl===base+route;
  const scores=Object.fromEntries(Object.entries(l.categories).map(([key,value])=>[key,Math.round(value.score*100)]));
  const row={sample,name,time:l.fetchTime,url:l.finalDisplayedUrl,valid,content,scores,lcpMs:a['largest-contentful-paint'].numericValue,tbtMs:a['total-blocking-time'].numericValue,fcpMs:a['first-contentful-paint'].numericValue,cls:a['cumulative-layout-shift'].numericValue,runtimeError:l.runtimeError||null,consoleErrors:a['errors-in-console']?.details?.items||[],insights:Object.fromEntries(Object.entries(a).filter(([key])=>/lcp-breakdown|lcp-discovery|mainthread-work|bootup-time|long-tasks|render-blocking/.test(key)))};
  row.meetsTargets=valid&&scores.performance>=90&&scores.accessibility>=95&&scores['best-practices']>=95&&scores.seo>=95&&row.lcpMs<2500&&row.cls<0.1;
  measurements.push(row);
  await fs.writeFile(summaryPath,JSON.stringify(summarize(),null,2));
  console.log(JSON.stringify({sample,name,valid,scores,lcpMs:row.lcpMs,tbtMs:row.tbtMs}));
  if(!valid)throw Error('Invalid measurement saved for diagnosis; do not use as acceptance');
 }
 const summary=summarize();
 console.log(JSON.stringify(summary.aggregate,null,2));
 if(!measurements.every(m=>m.meetsTargets))process.exitCode=1;
}finally{await chrome.kill();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
