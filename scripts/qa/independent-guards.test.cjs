'use strict';
/* Independent, pure reproductions. No env, HTTP, DB, browser, subprocess or app writes.
 * Run: node scripts/qa/independent-guards.test.cjs
 * Tests intentionally describe observed defects, not acceptance or fixed behavior.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const source=read('scripts/qa/api-scenarios.cjs');

test('reproduction: accepted POST is replayed after lost response body',async()=>{
 const start=source.indexOf('  async function req('),end=source.indexOf('\n  try {\n    // Health',start);
 assert.ok(start>=0&&end>start,'req extraction boundaries changed; review harness');
 let calls=0;const report={owned:[]};const active={retriesNetwork:0};
 const sandbox={base:'http://localhost:4000/api',report,active,FormData,AbortSignal,
  localURL:s=>new URL(s),save:async()=>{},backoff:async()=>{},owned:()=>{},
  transientNetwork:e=>e.cause?.code==='ECONNRESET',safeErrorCode:()=> 'ECONNRESET',RESOURCES:[],
  raw:async()=>{calls++;return{status:201,headers:new Headers(),json:async()=>{if(calls===1){const e=new TypeError('terminated');e.cause={code:'ECONNRESET'};throw e;}return{id:'second-created-booking'};}};},Headers};
 vm.createContext(sandbox);vm.runInContext(source.slice(start,end)+'\nthis.request=req;',sandbox);
 const result=await sandbox.request('/bookings','POST',{customerName:'qa-pure'});
 assert.equal(result.status,201);assert.equal(calls,2,'Reproduction changed: write no longer replayed');
 assert.equal(active.retriesNetwork,1);
});

test('reproduction: main fingerprint binds runner only, unlike layout sourceHash',()=>{
 assert.match(source,/fingerprint=createHash\('sha256'\)\.update\(await fs\.readFile\(__filename\)\)/);
 assert.doesNotMatch(source,/sourceHash|backend\/src|backend\/prisma/);
 const resume=source.slice(source.indexOf('if(resume){'),source.indexOf('else {if((await fs.readdir(out))'));
 assert.doesNotMatch(resume,/current|consecutive|finishedAt|waitingUntil/);
});

test('reproduction: main skips PASS streaks without resetting interrupted iteration',()=>{
 const loop=source.slice(source.indexOf('for(const scenario of selected)'),source.indexOf('report.status=selected.every'));
 assert.match(loop,/if\(active.consecutive>=TARGET\)continue/);
 assert.doesNotMatch(source,/if\(report\.current\)/);
 assert.match(read('scripts/qa/api-input-vectors.cjs'),/if\(report\.current\)/);
});

test('reproduction: modal flow matrix has no opened-state geometry or later booking steps',()=>{
 const layout=read('scripts/qa/layout-audit.cjs');
 const booking=layout.slice(layout.indexOf('async function booking('),layout.indexOf('async function mobileMenu('));
 assert.doesNotMatch(booking,/measure\(|Continue|Review request|Choose Workspace|Select Plan/);
 const editor=layout.slice(layout.indexOf("'new-editor-open'"),layout.indexOf("'new-editor-cancelled'"));
 assert.doesNotMatch(editor,/measure\(/);
 const metric=layout.slice(layout.indexOf('const actionable='),layout.indexOf('const smallControls='));
 assert.match(metric,/nav a\[href\]/);
 assert.doesNotMatch(metric,/[,'"]a\[href\]/,'All-link matrix changed: re-review target exclusions');
});

test('DTO metadata reproduction: implicit conversion accepts numeric customerName only with emitted design metadata',()=>{
 const req=createRequire(path.join(ROOT,'backend/package.json'));
 req('reflect-metadata');
 const ts=req('typescript');const {plainToInstance}=req('class-transformer');const {validateSync}=req('class-validator');
 function load(metadata){
  const code=ts.transpileModule(read('backend/src/dto.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:metadata}}).outputText;
  const mod={exports:{}};vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:'independent-in-memory-dto.cjs'})(req,mod,mod.exports);return mod.exports;
 }
 const payload={customerName:123,customerEmail:'pure@example.invalid',serviceType:'qa',serviceName:'qa',subtotalPrice:1,totalPrice:1};
 const errors=metadata=>validateSync(plainToInstance(load(metadata).BookingDto,payload,{enableImplicitConversion:true}),{whitelist:true,forbidNonWhitelisted:true}).map(e=>e.property);
 assert.ok(errors(false).includes('customerName'));
 assert.ok(!errors(true).includes('customerName'),'Runtime parity fixed: update reproduction to positive rejection guard');
});

test('reproduction: contextual workspace mapping selects shared-token predecessor',()=>{
 const src=read('components/booking-dialog.tsx');
 const ids=[...src.slice(src.indexOf('const WORKSPACE_TYPES='),src.indexOf('const PLANS=')).matchAll(/id:'([^']+)'/g)].map(m=>({id:m[1]}));
 const fn=src.slice(src.indexOf('function mapService('),src.indexOf('\nfunction addonPrice')).replace('s?:string','s').replace('):string{','){');
 const context={WORKSPACE_TYPES:ids};vm.createContext(context);vm.runInContext(fn+';this.map=mapService;',context);
 assert.equal(context.map('Dedicated Desk'),'hot-desk');
 assert.equal(context.map('Virtual Office'),'private-office');
 assert.equal(context.map('Conference Room'),'meeting-room');
});

test('reproduction: legacy integration cleanup begins after baseline writes and logs out bootstrap admin',()=>{
 const legacy=read('backend/test/api.test.ts');
 const firstTry=legacy.indexOf(' try {');
 assert.ok(firstTry>legacy.indexOf("const created=await call('/admin/pages'"));
 assert.ok(firstTry>legacy.indexOf("const popup=await call('/admin/popups'"));
 assert.ok(firstTry>legacy.indexOf('const uploaded=await fetch'));
 assert.match(legacy,/call\('\/auth\/logout','POST',\{\},token\)/);
 assert.match(read('backend/src/auth.ts'),/tokenVersion:\{increment:1\}/);
});
