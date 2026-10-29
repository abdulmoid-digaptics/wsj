'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
const dotenv=require('../../backend/node_modules/dotenv');const {localURL,sourceFingerprint}=require('./api-scenarios.cjs');
async function main(){
 const env=dotenv.parse(await fs.readFile(process.env.QA_ENV_FILE));const base=localURL(process.env.QA_API_URL||'http://127.0.0.1:4001/api').href;
 const expectedSource=await sourceFingerprint(path.resolve(__dirname,'../..'));
 const evidence={startedAt:new Date().toISOString(),status:'INCOMPLETE',checks:[],runtimeIdentityMatched:false};
 try{for(let i=0;i<20;i++){
  const r=await fetch(base+'/health',{headers:{Origin:'http://localhost:3100'},redirect:'manual',signal:AbortSignal.timeout(10000)});const body=await r.json();
  assert.equal(r.status,200);assert.equal(body.status,'ok');assert.equal(r.headers.get('access-control-allow-origin'),'http://localhost:3100');assert.equal(r.headers.get('x-qa-runtime'),env.QA_RUNTIME_ID);assert.equal(r.headers.get('x-qa-payments'),'local-fixture');assert.equal(r.headers.get('x-qa-source'),expectedSource);evidence.runtimeIdentityMatched=true;evidence.checks.push({health:200,cors:true,identity:true});
 }evidence.status='PASS';}catch(error){evidence.errorCode=error.cause?.code||error.code||error.name;process.exitCode=1;}
 evidence.finishedAt=new Date().toISOString();await fs.writeFile(path.join(process.env.QA_TMP,'local-payment-readiness.json'),JSON.stringify(evidence,null,2),{flag:'wx'});console.log('Local payment readiness '+evidence.status+' '+evidence.checks.length+'/20');
}
module.exports={main};
if(require.main===module)main().catch(error=>{console.error('Readiness failed: '+(error.code||error.name));process.exitCode=1;});
