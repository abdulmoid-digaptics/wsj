'use strict';
// Separate LOCAL entry point, not shipped/imported by the production application.
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..');
const br=createRequire(path.join(root,'backend/package.json'));
const {assertLocalPaymentSafety,sourceFingerprint}=require('./api-scenarios.cjs');
const {createLocalPaymentFixture,localOrigin}=require('./local-payment-fixture.cjs');
function validateLocalEnv(env,inherited=process.env){
 assertLocalPaymentSafety(env,inherited);
 if(env.SMTP_HOST?.trim()||inherited.SMTP_HOST?.trim())throw new Error('SMTP must be absent');
 const db=new URL(env.DATABASE_URL);if(!['postgres:','postgresql:'].includes(db.protocol)||!['localhost','127.0.0.1','[::1]'].includes(db.hostname))throw new Error('Local database required');
 for(const origin of [env.FRONTEND_URL,...(env.FRONTEND_URLS||'').split(',')].filter(Boolean))localOrigin(origin);
 if(!/^[a-f0-9-]{36}$/.test(env.QA_RUNTIME_ID||''))throw new Error('Unguessable runtime identity required');
 if(!/^whsec_local_[a-f0-9-]{36}$/.test(env.STRIPE_WEBHOOK_SECRET||''))throw new Error('Local signature fixture secret required');
 const port=Number(env.PORT);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Explicit local port required');
 return env;
}
function fixtureProcessEnvironment(env,inherited=process.env){
 validateLocalEnv(env,inherited);
 // Prisma's generated client loads backend/.env on import. Explicitly reserve
 // these process-only values BEFORE that import so dotenv cannot fill them.
 // Never edit .env or permit an inherited provider key through validation.
 return {...env,STRIPE_SECRET_KEY:'',SMTP_HOST:''};
}
async function main(){
 if(!process.env.QA_ENV_FILE||!path.isAbsolute(process.env.QA_ENV_FILE))throw new Error('Absolute QA_ENV_FILE required');
 const env=validateLocalEnv(br('dotenv').parse(fs.readFileSync(process.env.QA_ENV_FILE)));
 Object.assign(process.env,fixtureProcessEnvironment(env));process.env.NODE_ENV='test';process.env.UPLOAD_DIR=path.join(root,'backend/uploads');
 // Fail closed on accidental provider/mail/network calls. PostgreSQL and local
 // HTTP remain allowed. This guard applies to TCP sockets as well as fetch.
 const net=require('node:net');const connect=net.Socket.prototype.connect;
 net.Socket.prototype.connect=function(...args){
  const first=Array.isArray(args[0])?args[0][0]:args[0];const options=typeof first==='object'?first:null;
  const host=options?.host||(typeof args[1]==='string'?args[1]:'localhost');
  if(!['localhost','127.0.0.1','::1','[::1]'].includes(host))throw new Error('QA_EXTERNAL_NETWORK_REFUSED');
  return connect.apply(this,args);
 };
 const dns=require('node:dns');
 const lookup=dns.lookup;
 dns.lookup=function(host,...args){if(!['localhost','127.0.0.1','::1','[::1]'].includes(host))throw new Error('QA_EXTERNAL_DNS_REFUSED');return lookup.call(this,host,...args);};
 for(const method of ['resolve','resolve4','resolve6','resolveAny','resolveCname','resolveMx','resolveNaptr','resolveNs','resolvePtr','resolveSoa','resolveSrv','resolveTxt','reverse'])dns[method]=()=>{throw new Error('QA_EXTERNAL_DNS_REFUSED');};
 for(const method of Object.keys(dns.promises))if(method==='lookup'||method.startsWith('resolve')||method==='reverse')dns.promises[method]=async()=>{throw new Error('QA_EXTERNAL_DNS_REFUSED');};
 br('reflect-metadata');
 const {Module}=br('@nestjs/common');
 const {AppModule,createApplication}=require('../../backend/dist/application');
 const {PaymentClient}=require('../../backend/dist/payments');
 const fixture=createLocalPaymentFixture(env.FRONTEND_URL);
 class LocalAuditModule{}
 Module({imports:Reflect.getMetadata('imports',AppModule),controllers:Reflect.getMetadata('controllers',AppModule),providers:Reflect.getMetadata('providers',AppModule).map(p=>p===PaymentClient?{provide:PaymentClient,useValue:fixture}:p)})(LocalAuditModule);
 const app=await createApplication(LocalAuditModule);
 const sourceVersion=await sourceFingerprint(root);
 app.use((_req,res,next)=>{res.setHeader('X-QA-Runtime',env.QA_RUNTIME_ID);res.setHeader('X-QA-Payments','local-fixture');res.setHeader('X-QA-Source',sourceVersion);next();});
 await app.listen(Number(env.PORT),'127.0.0.1');
 console.log('[local-audit] isolated runtime ready on loopback port '+env.PORT);
 if(process.env.QA_SELF_CHECK==='true'){
  const output=process.env.QA_TMP;process.env.QA_TMP=process.env.QA_READINESS_TMP||output;
  try{await require('./local-payment-readiness.cjs').main();}finally{process.env.QA_TMP=output;}
  if(process.exitCode){await app.close();return;}
 }
 if(process.env.QA_RUN_SCENARIOS==='true'){
  if(process.env.QA_SELF_CHECK!=='true')throw new Error('Readiness required before scenario run');
  try{await require('./api-scenarios.cjs').main();}finally{await app.close();}
 }
}
module.exports={validateLocalEnv,fixtureProcessEnvironment};
if(require.main===module)main().catch(error=>{console.error('[local-audit] startup refused: '+(error.code||error.name||'Error'));process.exitCode=1;});
