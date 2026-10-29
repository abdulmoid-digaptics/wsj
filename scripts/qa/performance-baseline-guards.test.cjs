const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const runner=path.join(__dirname,'performance-baseline.mjs');
function reject(env,pattern){
 const result=spawnSync(process.execPath,[runner],{env:{...process.env,QA_BASE_URL:'http://localhost:3100',QA_API_URL:'http://localhost:4000/api',QA_SAMPLES:'3',QA_TMP:os.tmpdir(),...env},encoding:'utf8',timeout:15000});
 assert.equal(result.status,1,result.stderr);
 assert.match(result.stderr,pattern);
}
test('refuses remote frontend and API destinations',()=>{
 reject({QA_BASE_URL:'https://example.com'},/Local QA URLs only/);
 reject({QA_API_URL:'https://example.com/api'},/Local QA URLs only/);
});
test('refuses credential-bearing URLs',()=>reject({QA_BASE_URL:'http://user:pass@localhost:3100'},/Local QA URLs only/));
test('requires absolute output folder',()=>reject({QA_TMP:'relative-output'},/Set absolute QA_TMP/));
test('requires bounded integer sample count',()=>{
 for(const count of ['1','11','3.5','invalid'])reject({QA_SAMPLES:count},/QA_SAMPLES must be an integer from 3 to 10/);
});
test('preserves existing summary evidence',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wsj-performance-guard-'));
 try{fs.writeFileSync(path.join(dir,'performance-baseline-summary.json'),'preserve');reject({QA_TMP:dir},/Use a fresh QA_TMP/);assert.equal(fs.readFileSync(path.join(dir,'performance-baseline-summary.json'),'utf8'),'preserve');}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('fails before launching Chrome when API is unavailable',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wsj-performance-offline-'));
 try{reject({QA_TMP:dir,QA_API_URL:'http://127.0.0.1:1/api'},/fetch failed/);assert.deepEqual(fs.readdirSync(dir),[]);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

async function mockedReadiness(cors,html,pattern){
 const http=require('node:http');
 const {spawn}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wsj-performance-ready-'));
 const server=http.createServer((req,res)=>{
  if(cors&&req.headers.origin)res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
  if(req.url==='/api/health')res.end('{"status":"ok"}');
  else if(req.url.startsWith('/api/public/pricing'))res.end('{"items":[{"title":"Published fixture"}]}');
  else if(req.url==='/api/public/popups')res.end('{"items":[]}');
  else res.end(html);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const result=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[runner],{env:{...process.env,QA_BASE_URL:base,QA_API_URL:base+'/api',QA_SAMPLES:'3',QA_TMP:dir}});
   let stderr='';child.stderr.on('data',data=>stderr+=data);child.on('error',reject);child.on('close',status=>resolve({status,stderr}));
  });
  assert.equal(result.status,1,result.stderr);assert.match(result.stderr,pattern);assert.deepEqual(fs.readdirSync(dir),[]);
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
}
test('refuses missing CORS permission before launching Chrome',()=>mockedReadiness(false,'source-home pricing-section',/QA frontend origin is not allowed/));
test('refuses missing source disclosure before launching Chrome',()=>mockedReadiness(true,'pricing-section',/Full-content.pricing readiness guard failed/));
