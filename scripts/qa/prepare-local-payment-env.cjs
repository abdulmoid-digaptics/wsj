'use strict';
// Private LOCAL process configuration; never print credentials or provider keys.
const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'../..');const dotenv=require('../../backend/node_modules/dotenv');
const {validateLocalEnv}=require('./local-payment-app.cjs');
function prepare(out){
 if(!out||!path.isAbsolute(out))throw new Error('Absolute fresh QA_ENV_FILE required');
 const source=dotenv.parse(fs.readFileSync(path.join(root,'backend/.env')));
 // Do not inherit or copy Stripe/SMTP config. No .env file is edited.
 const env={};for(const key of ['DATABASE_URL','JWT_SECRET','ADMIN_EMAIL','ADMIN_PASSWORD']){if(!source[key])throw new Error('Required local configuration missing');env[key]=source[key];}
 Object.assign(env,{PORT:'4001',FRONTEND_URL:'http://localhost:3100',FRONTEND_URLS:'http://localhost:3000,http://localhost:3100',QA_RUNTIME_ID:randomUUID(),STRIPE_WEBHOOK_SECRET:'whsec_local_'+randomUUID()});
 validateLocalEnv(env);
 if(Object.values(env).some(value=>/[\r\n']/.test(value)))throw new Error('Unsupported local configuration encoding');
 fs.writeFileSync(out,Object.entries(env).map(([key,value])=>key+"='"+value+"'").join('\n')+'\n',{flag:'wx',mode:0o600});
 console.log('[local-audit] private fixture configuration created; no provider keys copied');
}
module.exports={prepare};
if(require.main===module)try{prepare(process.env.QA_ENV_FILE);}catch(error){console.error('[local-audit] configuration refused: '+(error.code||error.name));process.exitCode=1;}
