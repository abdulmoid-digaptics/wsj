'use strict';
// Reconcile only this audit's UUID-marked fixtures. Importing has no DB effects.
const fs=require('node:fs/promises');
const path=require('node:path');
const {createRequire}=require('node:module');
const ROOT=path.resolve(__dirname,'../..');
const markerPattern=/^(?:qa-[a-f0-9-]{36}|integration-[a-f0-9-]{36})$/;
function definitions(marker){return [
 ['content',{OR:[{slug:{startsWith:marker}},{title:{startsWith:marker}}]}],
 ['user',{OR:[{email:{startsWith:marker}},{name:{startsWith:marker}}]}],
 ['inquiry',{OR:[{name:{startsWith:marker}},{email:{startsWith:marker}},{message:{startsWith:marker}}]}],
 ['booking',{OR:[{customerName:{startsWith:marker}},{customerEmail:{startsWith:marker}}]}],
 ['media',{originalName:{startsWith:marker}}],
];}
function localDatabase(raw){const u=new URL(raw);if(!['postgres:','postgresql:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Error('Local PostgreSQL required');return u;}
function within(root,target){const rel=path.relative(path.resolve(root),path.resolve(target));return !path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);}
async function cleanupMarker({db,marker,owned=[],uploadDir,root=ROOT}){
 if(!markerPattern.test(marker))throw Error('Valid UUID audit marker required');
 if(!db||!uploadDir)throw Error('Cleanup configuration required');
 const allowed=new Set(definitions(marker).map(([name])=>name));
 const records=[];const remember=(table,id)=>{if(!allowed.has(table)||typeof id!=='string')throw Error('Invalid owned fixture reference');if(!records.some(x=>x.table===table&&x.id===id))records.push({table,id});};
 for(const row of owned)remember(row.table,row.id);
 // Discover accepted writes whose response was lost before their ID was saved.
 for(const [table,where]of definitions(marker))for(const row of await db[table].findMany({where,select:{id:true}}))remember(table,row.id);
 // An API-returned ID is not ownership proof. Reject any surviving ID that does
 // not independently match this unguessable run marker before deleting anything.
 for(const [table,where]of definitions(marker)){
  const ids=records.filter(x=>x.table===table).map(x=>x.id);if(!ids.length)continue;
  const all=await db[table].findMany({where:{id:{in:ids}},select:{id:true}});
  const marked=await db[table].findMany({where:{AND:[where,{id:{in:ids}}]},select:{id:true}});
  const matches=new Set(marked.map(x=>x.id));if(all.some(x=>!matches.has(x.id)))throw Error('Refusing unmarked fixture ID');
 }
 const popupIds=(await db.content.findMany({where:{kind:'popups',slug:{startsWith:marker},title:{startsWith:marker}},select:{id:true}})).map(x=>x.id);
 const eventWhere={OR:[{sessionId:{startsWith:marker}},...(popupIds.length?[{popupId:{in:popupIds}}]:[])]};
 await db.popupEvent.deleteMany({where:eventWhere});
 const ids=records.map(x=>x.id),userIds=records.filter(x=>x.table==='user').map(x=>x.id);
 if(ids.length)await db.audit.deleteMany({where:{OR:[{resourceId:{in:ids}},...(userIds.length?[{actorId:{in:userIds}}]:[])]}});
 const counts={};
 for(const [table,where]of definitions(marker)){
  const tableIds=records.filter(x=>x.table===table).map(x=>x.id);if(!tableIds.length){counts[table]=0;continue;}
  if(table==='media'){
   if(!within(root,uploadDir))throw Error('Uploads outside workspace require separate review');
   const media=await db.media.findMany({where:{AND:[where,{id:{in:tableIds}}]}});
   if(media.length){
    const realRoot=await fs.realpath(root),realUploads=await fs.realpath(uploadDir);if(!within(realRoot,realUploads))throw Error('External upload symlink refused');
    for(const row of media){if(!/^[a-f0-9-]+\.(png|jpg|webp|pdf)$/.test(row.filename))throw Error('Unsafe owned upload filename');await fs.unlink(path.join(realUploads,row.filename)).catch(error=>{if(error.code!=='ENOENT')throw error;});}
   }
  }
  const result=await db[table].deleteMany({where:{AND:[where,{id:{in:tableIds}}]}});counts[table]=result.count;
  if(await db[table].count({where})||await db[table].count({where:{id:{in:tableIds}}}))throw Error('Fixture cleanup verification failed');
 }
 if(await db.popupEvent.count({where:eventWhere}))throw Error('Fixture event cleanup verification failed');
 return {status:'PASS',at:new Date().toISOString(),counts};
}
async function reconcileReport(reportFile){
 if(!path.isAbsolute(reportFile)||path.basename(reportFile)!=='api-scenarios.json')throw Error('Absolute audit report required');
 const report=JSON.parse(await fs.readFile(reportFile,'utf8'));if(!markerPattern.test(report.marker))throw Error('Invalid audit report marker');
 const lockFile=path.join(path.dirname(reportFile),'.api-scenarios.lock');
 const pidText=await fs.readFile(lockFile,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 if(pidText){
  const pid=Number(pidText);if(!Number.isSafeInteger(pid)||pid<1)throw Error('Invalid runner lock');
  let alive=null;
  try{process.kill(pid,0);alive=true;}
  catch(error){if(error.code==='ESRCH')alive=false;else if(error.code!=='EPERM')throw error;}
  if(alive===true)throw Error('Runner is still active; cleanup refused');
  if(alive===null){
   // The sandbox blocks the kill(pid,0) liveness probe itself (EPERM), not the
   // target process. Only an operator who directly observed termination may
   // proceed, and only when the report has been idle well past any normal
   // per-iteration write.
   if(process.env.QA_RUNNER_CONFIRMED_STOPPED!=='1')throw Error('Cannot verify runner liveness in this sandbox; set QA_RUNNER_CONFIRMED_STOPPED=1 only after directly observing the owning process exit');
   const idleMs=Date.now()-Date.parse(report.updatedAt);
   if(!Number.isFinite(idleMs)||idleMs<120000)throw Error('Report updated too recently to safely assume the runner stopped');
  }
 }
 const backendRequire=createRequire(path.join(ROOT,'backend/package.json'));
 const env=backendRequire('dotenv').parse(await fs.readFile(path.join(ROOT,'backend/.env')));localDatabase(env.DATABASE_URL);
 const {PrismaClient}=backendRequire('@prisma/client');const db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}},log:[]});
 const backup=reportFile+'.before-reconcile.json';await fs.writeFile(backup,JSON.stringify(report,null,2),{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
 try{
  await db.$connect();const first=await cleanupMarker({db,marker:report.marker,owned:report.owned||[],uploadDir:path.resolve(ROOT,'backend',env.UPLOAD_DIR||'uploads')});
  // Verify a second discovery pass after the stopped process has no writer.
  const second=await cleanupMarker({db,marker:report.marker,owned:[],uploadDir:path.resolve(ROOT,'backend',env.UPLOAD_DIR||'uploads')});
  report.reconciliation={at:new Date().toISOString(),reason:'Owner stopped audit for independent safety fixes',first,second};
  report.cleanup=second;report.owned=[];report.pending=null;report.status='INCOMPLETE';report.finishedAt=new Date().toISOString();report.reason='Stopped for harness safety fixes; fixtures independently reconciled';
  await fs.writeFile(reportFile+'.tmp',JSON.stringify(report,null,2));await fs.rename(reportFile+'.tmp',reportFile);
  if(pidText)await fs.unlink(lockFile);
  console.log(JSON.stringify({reconciled:true,marker:report.marker,first:first.counts,verified:second.status}));
 }finally{await db.$disconnect();}
}
module.exports={cleanupMarker,definitions,localDatabase,within,markerPattern,reconcileReport};
if(require.main===module)reconcileReport(process.env.QA_CLEANUP_REPORT||'').catch(error=>{const code=typeof error?.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'SAFETY';console.error('Cleanup blocked ['+code+']; no credentials or response bodies logged.');process.exitCode=1;});
