#!/usr/bin/env node
'use strict';
/* Local, serial, evidence-first layout audit. No server startup or package installs.
 * Run: QA_TMP=<absolute NEW directory> node scripts/qa/layout-audit.cjs
 * Resume: same command/config/source, QA_RESUME=1, same QA_TMP.
 * QA_BASE_URL=http://localhost:3000 QA_API_URL=http://localhost:4000[/api]
 * QA_HEIGHT=900 QA_TIMEOUT_MS=30000 QA_HEADLESS=1. Widths are intentionally fixed.
 * Login is the sole permitted write request; backend login creates an auth audit entry.
 * No booking submit, editor save, uploads, logout, existing-record edit or payment.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {chromium} = require('@playwright/test');
const ROOT = path.resolve(__dirname, '../..');
const WIDTHS = [375, 414, 768, 1024, 1280, 1440, 1920, 3840];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const stamp = () => new Date().toISOString();
const localHost = h => ['localhost', '127.0.0.1', '[::1]'].includes(h);
function localURL(raw, api = false) {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol) || !localHost(u.hostname) || u.username || u.password || u.search || u.hash) throw Error('Only credential-free loopback URLs are allowed');
  if (!api && u.pathname !== '/') throw Error('QA_BASE_URL must be an origin');
  u.pathname = api ? u.pathname.replace(/\/$/, '').replace(/^(?:\/)?$/, '/api') : '/';
  return u.href.replace(/\/$/, '');
}
const BASE = localURL(process.env.QA_BASE_URL || 'http://localhost:3000');
const API = localURL(process.env.QA_API_URL || 'http://localhost:4000', true);
const OUT = process.env.QA_TMP;
const RESUME = process.env.QA_RESUME === '1';
const HEIGHT = Number(process.env.QA_HEIGHT || 900);
const TIMEOUT = Number(process.env.QA_TIMEOUT_MS || 30000);
if (!OUT || !path.isAbsolute(OUT)) throw Error('QA_TMP must be an absolute, fresh output directory');
if (!Number.isInteger(HEIGHT) || HEIGHT < 600 || HEIGHT > 2160 || !Number.isInteger(TIMEOUT) || TIMEOUT < 5000 || TIMEOUT > 120000) throw Error('Invalid QA_HEIGHT or QA_TIMEOUT_MS');
const out = path.resolve(OUT);
// Do not allow evidence to overwrite application inputs or the credential file.
if (out === ROOT || out.startsWith(ROOT + path.sep)) throw Error('QA_TMP must be outside the project source tree');
let secrets = [], sequence = 0, browser, lockHeld = false;
const safeText = text => secrets.reduce((s, secret) => secret ? s.split(secret).join('[PRIVATE]') : s, String(text)).replace(/Bearer\s+[\w.\-]+/gi, 'Bearer [PRIVATE]');
const file = relative => {
  const p = path.resolve(out, relative);
  if (!p.startsWith(out + path.sep)) throw Error('Invalid evidence path');
  return p;
};
async function atomic(relative, value) {
  const p = file(relative); await fs.mkdir(path.dirname(p), {recursive:true});
  await fs.writeFile(p + '.partial', JSON.stringify(value, null, 2));
  await fs.rename(p + '.partial', p);
}
async function sourceHash() {
  const hashes = [];
  async function walk(rel) {
    const entries = await fs.readdir(path.join(ROOT, rel), {withFileTypes:true});
    for (const e of entries.sort((a,b) => a.name.localeCompare(b.name))) {
      const child = path.join(rel,e.name);
      if (e.isDirectory()) await walk(child);
      else if (e.isFile()) hashes.push([child.replaceAll('\\','/'), sha(await fs.readFile(path.join(ROOT,child)))]);
    }
  }
  for (const dir of ['app','components','lib','public','backend/src','backend/prisma']) await walk(dir);
  const rootInputs=(await fs.readdir(ROOT)).filter(n=>/^(?:next\.config\.|postcss\.config\.|tsconfig\.json$|\.env(?:\.|$))/.test(n));
  const dataInputs=(await fs.readdir(path.join(ROOT,'data'))).filter(n=>n.endsWith('.json')).map(n=>'data/'+n);
  for (const name of [...rootInputs,...dataInputs,'package.json','package-lock.json','scripts/qa/layout-audit.cjs','backend/.env','backend/package.json']) hashes.push([name, sha(await fs.readFile(path.join(ROOT,name)))]);
  return sha(JSON.stringify(hashes));
}
function credentials(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?(ADMIN_EMAIL|ADMIN_PASSWORD)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1,-1).replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/\\\\/g,'\\');
    else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1,-1);
    else v = v.replace(/\s+#.*$/, '').trim();
    env[m[1]] = v;
  }
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) throw Error('backend/.env needs ADMIN_EMAIL and ADMIN_PASSWORD; values are never printed');
  secrets = Object.values(env); return env;
}
async function health() {
  const response = await fetch(API + '/health', {redirect:'manual', signal:AbortSignal.timeout(10000)});
  if (!response.ok || response.status >= 300) throw Error('API health prerequisite failed; integrated audit refused');
  const result = await response.json().catch(() => null);
  if (!result || result.status !== 'ok') throw Error('API health did not confirm status ok');
  return {checkedAt:stamp(), status:response.status};
}
async function evidence(row, relative) {
  if (!row.evidence.some(item => item.file === relative)) row.evidence.push({file:relative, sha256:sha(await fs.readFile(file(relative)))});
}
async function aria(page, row, label) {
  // Called before and after every navigation, viewport change and UI action.
  const text = await page.locator('body').ariaSnapshot({timeout:TIMEOUT});
  // Content-address identical snapshots instead of storing gigabytes of repeated
  // full-page trees while traversing every route at every width.
  const safe = safeText(text);
  const rel = `snapshots/${sha(safe)}.aria.txt`;
  await fs.mkdir(path.dirname(file(rel)), {recursive:true});
  await fs.writeFile(file(rel), safe, {flag:'wx'}).catch(error => {if(error.code !== 'EEXIST') throw error;});
  await evidence(row,rel);
  (row.snapshotSteps ||= []).push({step:++sequence,label,file:rel});
  return text; // Reading the returned snapshot precedes the next action.
}
async function action(page, row, label, fn) {
  await aria(page,row,'before-' + label);
  try { return await fn(); }
  finally { await aria(page,row,'after-' + label); }
}
async function settle(page) {
  await page.locator('body').waitFor({state:'visible'});
  await page.evaluate(async () => {
    await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r,3000))]);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}
async function navigate(page, row, route) {
  const url = new URL(route, BASE + '/');
  if (url.origin !== new URL(BASE).origin) throw Error('Nonlocal route refused');
  let error;
  for (let attempt=1; attempt<=2; attempt++) {
    try {
      const response = await action(page,row,`navigate-${attempt}`, () => page.goto(url.href,{waitUntil:'domcontentloaded',timeout:TIMEOUT}));
      await settle(page); await aria(page,row,'settled');
      if (!response || response.status() >= 400) throw Error('Navigation HTTP ' + (response?.status() || 'no response'));
      row.httpStatus = response.status(); row.finalPath = new URL(page.url()).pathname;
      if (row.finalPath.replace(/\/$/,'') !== url.pathname.replace(/\/$/,'')) row.redirect = row.finalPath;
      return;
    } catch (e) {error=e; row.recovery.push({attempt,error:safeText(e.message)});}
  }
  throw error;
}
async function screenshot(page,row,label,selector) {
  const rel = `screenshots/${row.id}/${++sequence}-${label}.png`;
  await fs.mkdir(path.dirname(file(rel)),{recursive:true});
  if (selector) await action(page,row,'reveal-' + label, () => page.locator(selector).scrollIntoViewIfNeeded({timeout:5000}));
  const target = selector ? page.locator(selector) : page;
  await target.screenshot({path:file(rel),timeout:10000,animations:'disabled'});
  await evidence(row,rel); return rel;
}
async function lazyScan(page,row) {
  // Bounded traversal triggers native lazy images. Coverage is explicit, not assumed.
  let y=0, steps=0, max=0;
  do {
    max = await page.evaluate(() => Math.max(document.body.scrollHeight,document.documentElement.scrollHeight));
    y = Math.min(y + HEIGHT * .8,max);
    await action(page,row,'lazy-scroll', () => page.evaluate(y => window.scrollTo({top:y,behavior:'instant'}),y));
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    steps++;
  } while (y + HEIGHT < max && steps < 40);
  row.scrollCoverage = {steps,documentHeight:max,complete:y+HEIGHT>=max};
  await action(page,row,'return-top', () => page.evaluate(() => window.scrollTo({top:0,behavior:'instant'})));
  await page.evaluate(async () => Promise.race([Promise.all([...document.images].filter(i => i.currentSrc).map(i => i.decode().catch(()=>{}))),new Promise(r => setTimeout(r,2500))]));
}
async function measure(page,row) {
  row.metrics = await page.evaluate(() => {
    const visible = el => {const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0'&&!el.closest('[inert]');};
    const selector = el => {const p=[];for(let e=el;e&&e!==document.body;e=e.parentElement){let n=1;for(let s=e.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===e.tagName)n++;p.unshift(e.tagName.toLowerCase()+`:nth-of-type(${n})`);}return 'body > '+p.join(' > ');};
    const rect = el => {const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
    const details = el => ({selector:selector(el),tag:el.tagName.toLowerCase(),label:(el.getAttribute('aria-label')||el.textContent||el.getAttribute('alt')||'').trim().slice(0,160),rect:rect(el)});
    const root=document.documentElement,body=document.body;
    const width=Math.max(root.scrollWidth,body.scrollWidth), viewport=root.clientWidth;
    const overflowElements=[...body.querySelectorAll('*')].filter(el=>visible(el)&&!el.closest('dialog:not([open])')).filter(el=>{const r=el.getBoundingClientRect();return r.right>viewport+2||r.left < -2;}).slice(0,30).map(details);
    const brokenImages=[...document.images].filter(visible).filter(i=>i.complete&&i.currentSrc&&i.naturalWidth===0).map(i=>({...details(i),src:new URL(i.currentSrc).pathname}));
    const pendingImages=[...document.images].filter(visible).filter(i=>!i.complete||!i.currentSrc).map(details);
    const clipping=[];
    const cardSelector='[class*="card"], [class*="tile"], .bk-type, .bk-plan, .adm-table-card';
    // Text leaf ranges versus clipping ancestors catches intrinsic min-size/height failures.
    // Intentional ellipsis/line-clamp is diagnostic, never a definitive layout failure.
    for (const el of body.querySelectorAll('h1,h2,h3,h4,p,span,small,strong,a,button,label,li')) {
      if(!visible(el)||!el.closest(cardSelector)||![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;
      let clipped=null;
      for(let a=el;a&&a!==body;a=a.parentElement){
        const s=getComputedStyle(a),r=a.getBoundingClientRect();
        if(!/(hidden|clip)/.test(s.overflowX+' '+s.overflowY))continue;
        for(const n of el.childNodes){if(n.nodeType!==3||!n.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(n);
          for(const t of range.getClientRects())if((/(hidden|clip)/.test(s.overflowX)&&(t.left<r.left-2||t.right>r.right+2))||(/(hidden|clip)/.test(s.overflowY)&&(t.top<r.top-2||t.bottom>r.bottom+2)))clipped=a;
        }
        if(clipped)break;
      }
      if(clipped){const s=getComputedStyle(el);clipping.push({...details(el),clippingAncestor:selector(clipped),intentionalTruncation:s.textOverflow==='ellipsis'||Number(s.webkitLineClamp)>0});}
    }
    // Separate 44px diagnostics: excludes prose/inline links, disabled and hidden controls.
    const actionable=[...body.querySelectorAll('button,input:not([type=hidden]),select,textarea,[role=button],nav a[href]')].filter(visible).filter(el=>{const r=el.getBoundingClientRect();return r.right>0&&r.left<innerWidth&&!el.matches(':disabled,[aria-disabled=true]');});
    const smallControls=actionable.filter(el=>{const r=el.getBoundingClientRect();return r.width<43.5||r.height<43.5;}).map(details);
    const main=document.querySelector('main');
    return {viewport:{width:innerWidth,height:innerHeight},documentOverflow:{pixels:Math.max(0,width-viewport),scrollWidth:width,clientWidth:viewport,offenders:overflowElements},mainH1:main?[...main.querySelectorAll('h1')].filter(visible).length:null,pageH1:[...body.querySelectorAll('h1')].filter(visible).length,brokenImages,pendingImages,intrinsicCardTextClipping:clipping,actionable44px:{checked:actionable.length,diagnostics:smallControls},notes:['Geometry heuristics do not prove absence of all overlaps.','Off-canvas navigation and intentional truncation need human review.','44px controls are separate diagnostics, not inline-link failures.']};
  });
  const m=row.metrics;
  row.findings=[];
  if(m.documentOverflow.pixels>2)row.findings.push({type:'document-overflow',pixels:m.documentOverflow.pixels});
  if(row.kind==='public'&&m.mainH1!==1)row.findings.push({type:'main-h1-count',count:m.mainH1});
  if(m.brokenImages.length)row.findings.push({type:'broken-images',count:m.brokenImages.length});
  if(m.pendingImages.length)row.findings.push({type:'pending-images',count:m.pendingImages.length,diagnostic:true});
  if(m.intrinsicCardTextClipping.length)row.findings.push({type:'intrinsic-card-text-clipping',count:m.intrinsicCardTextClipping.length,reviewRequired:true});
  if(m.actionable44px.diagnostics.length)row.findings.push({type:'44px-actionable-controls',count:m.actionable44px.diagnostics.length,diagnostic:true});
  const targets=[...m.brokenImages,...m.intrinsicCardTextClipping,...(m.documentOverflow.pixels>2?m.documentOverflow.offenders:[]),...m.actionable44px.diagnostics].slice(0,4);
  for(let i=0;i<targets.length;i++)await screenshot(page,row,`finding-${i}`,targets[i].selector).catch(e=>row.captureErrors.push(safeText(e.message)));
  if(row.findings.length)await screenshot(page,row,'findings-viewport');
}
function newRow(kind,route,width) {
  const id=kind+'-'+width+'-'+sha(route).slice(0,16);
  return {id,kind,route,width,startedAt:stamp(),status:'running',evidence:[],recovery:[],captureErrors:[],checks:{}};
}
async function verified(kind,route,width,fingerprint) {
  const row=newRow(kind,route,width);
  if(!RESUME)return false;
  try {
    const prior=JSON.parse(await fs.readFile(file('rows/'+row.id+'.json'),'utf8'));
    if(prior.status!=='verified'||prior.fingerprint!==fingerprint||prior.route!==route||prior.width!==width||!prior.evidence?.length||!prior.metrics&&!Object.keys(prior.checks||{}).length)return false;
    for(const e of prior.evidence)if(sha(await fs.readFile(file(e.file)))!==e.sha256)return false;
    return prior;
  }catch{return false;}
}
async function persist(row,fingerprint) {
  row.fingerprint=fingerprint;row.finishedAt=stamp();
  await atomic('rows/'+row.id+'.json',row);
}
async function makeContext() {
  const context=await browser.newContext({viewport:{width:1440,height:HEIGHT},reducedMotion:'reduce',serviceWorkers:'block',acceptDownloads:false});
  const blocked=[]; let loginAllowance=0;
  const allowedOrigins=new Set([new URL(BASE).origin,new URL(API).origin]);
  await context.route('**/*',async route => {
    const req=route.request();let u;
    try{u=new URL(req.url());}catch{return route.abort();}
    const method=req.method();
    const embeddedExternal=[...u.searchParams.values()].some(v=>{if(!/^(?:https?:)?\/\//i.test(v))return false;try{return !allowedOrigins.has(new URL(v,u).origin);}catch{return true;}});
    const allowed=allowedOrigins.has(u.origin)&&localHost(u.hostname)&&!embeddedExternal;
    const login=allowed&&u.href===API+'/auth/login'&&method==='POST'&&loginAllowance>0;
    if(login)loginAllowance--;
    if(!allowed||!['GET','HEAD','OPTIONS'].includes(method)&&!login){blocked.push({path:u.pathname,method,reason:allowed?'mutation-blocked':'external-blocked'});return route.abort('blockedbyclient');}
    return route.continue();
  });
  if(context.routeWebSocket)await context.routeWebSocket('**/*',ws=>{const u=new URL(ws.url());if(localHost(u.hostname)&&allowedOrigins.has(u.origin.replace(/^ws/,'http')))ws.connectToServer();else ws.close();});
  context.on('page',p=>{p.on('dialog',d=>d.dismiss());});
  return {context,blocked,allowLogin:()=>{loginAllowance=1;}};
}
async function booking(page,row) {
  const trigger=page.locator('main button[aria-haspopup="dialog"], main a[href="#wj-booking"]').first();
  await trigger.waitFor({state:'visible',timeout:10000});
  await action(page,row,'focus-booking-trigger',()=>trigger.focus());
  const original=await page.evaluate(()=>({y:scrollY,body:document.body.style.cssText,root:document.documentElement.style.overflow}));
  await action(page,row,'booking-keyboard-open',()=>page.keyboard.press('Enter'));
  const dialog=page.locator('dialog.bk-overlay[open]');await dialog.waitFor({state:'visible',timeout:10000});await aria(page,row,'booking-open');
  row.checks.nativeDialog=await dialog.evaluate(el=>el instanceof HTMLDialogElement&&el.matches(':modal'));
  row.checks.bodyLock=await page.evaluate(()=>getComputedStyle(document.body).position==='fixed'&&getComputedStyle(document.body).overflow==='hidden'&&getComputedStyle(document.documentElement).overflow==='hidden');
  const before=await page.evaluate(()=>{const b=document.querySelector('.bk-body'),h=document.querySelector('.bk-header');return{y:scrollY,scroll:b.scrollTop,range:b.scrollHeight-b.clientHeight,header:h.getBoundingClientRect().top};});
  await action(page,row,'booking-body-scroll',()=>page.locator('.bk-body').evaluate(el=>el.scrollTo({top:el.scrollHeight,behavior:'instant'})));
  const after=await page.evaluate(()=>({y:scrollY,scroll:document.querySelector('.bk-body').scrollTop,header:document.querySelector('.bk-header').getBoundingClientRect().top}));
  row.checks.independentBodyScroll=before.range>2?after.scroll>before.scroll&&after.y===before.y:'not-applicable-content-fits';
  row.checks.pinnedHeader=Math.abs(after.header-before.header)<2;
  // Real wheel gesture verifies the document cannot independently scroll under modal.
  await action(page,row,'booking-pointer',()=>page.mouse.move(row.width-2,HEIGHT-2));
  await action(page,row,'booking-background-wheel',()=>page.mouse.wheel(0,600));
  await page.waitForTimeout(150);
  row.checks.backgroundScrollBlocked=await page.evaluate(y=>Math.abs(scrollY-y)<2,before.y);
  await action(page,row,'booking-tab',()=>page.keyboard.press('Tab'));
  row.checks.keyboardFocusInside=await dialog.evaluate(el=>el.contains(document.activeElement));
  await screenshot(page,row,'booking-dialog','.bk-modal');
  await action(page,row,'booking-escape',()=>page.keyboard.press('Escape'));
  await dialog.waitFor({state:'detached',timeout:5000});await aria(page,row,'booking-closed');
  row.checks.focusRestored=await trigger.evaluate(el=>document.activeElement===el);
  row.checks.bodyStyleRestored=await page.evaluate(o=>document.body.style.cssText===o.body&&document.documentElement.style.overflow===o.root&&Math.abs(scrollY-o.y)<2,original);
}
async function mobileMenu(page,row) {
  const trigger=page.getByRole('button',{name:'Open menu',exact:true});
  if(!await trigger.isVisible()){row.checks.mobileMenu='not-applicable-hidden-at-this-width';return;}
  await action(page,row,'menu-open',()=>trigger.click());
  const panel=page.getByRole('dialog',{name:'Navigation menu'});await panel.waitFor({state:'visible'});await aria(page,row,'menu-open-confirmed');
  row.checks.mobileMenuOpened=await trigger.getAttribute('aria-expanded')==='true';
  await screenshot(page,row,'mobile-menu','#wj-mobile-menu');
  await action(page,row,'menu-close-button',()=>page.getByRole('button',{name:'Close menu',exact:true}).click());
  await panel.waitFor({state:'detached'});await aria(page,row,'menu-closed-confirmed');
  row.checks.mobileMenuClosed=await trigger.getAttribute('aria-expanded')==='false';
  await action(page,row,'menu-reopen',()=>trigger.click());
  await panel.waitFor({state:'visible'});
  await action(page,row,'menu-escape',()=>page.keyboard.press('Escape'));
  await panel.waitFor({state:'detached'});await aria(page,row,'menu-escape-confirmed');
  row.checks.mobileMenuFocusRestored=await trigger.evaluate(el=>el===document.activeElement);
}
async function scrollAdmin(page,row,selector) {
  const before=await page.locator(selector).evaluate(el=>({range:el.scrollHeight-el.clientHeight,top:el.scrollTop,y:window.scrollY,docRange:document.documentElement.scrollHeight-innerHeight}));
  await action(page,row,'admin-scroll',()=>page.locator(selector).evaluate(el=>{el.scrollTo({top:el.scrollHeight,behavior:'instant'});window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'});}));
  const after=await page.locator(selector).evaluate(el=>({top:el.scrollTop,y:scrollY}));
  row.checks[selector+'Scroll']=before.range>2?after.top>before.top:before.docRange>2?after.y>before.y:'not-applicable-content-fits';
  await screenshot(page,row,'admin-scroll-proof',selector);
  await action(page,row,'admin-scroll-reset',()=>page.locator(selector).evaluate(el=>{el.scrollTo({top:0,behavior:'instant'});window.scrollTo({top:0,behavior:'instant'});}));
}
async function run() {
  const auth=credentials(await fs.readFile(path.join(ROOT,'backend/.env'),'utf8'));
  const data=JSON.parse(await fs.readFile(path.join(ROOT,'data/site.json'),'utf8'));
  const routes=[...new Set(['/',...['pages','posts','categories'].flatMap(k=>{
    if(!Array.isArray(data[k]))throw Error('Missing imported '+k);
    return data[k].map(x=>{if(typeof x.path!=='string'||!x.path.startsWith('/')||x.path.startsWith('//')||/[?#\\]/.test(x.path))throw Error('Invalid imported path');return x.path;});
  }),'/terms-and-privacy/','/admin/'])].sort();
  const config={version:1,base:BASE,api:API,widths:WIDTHS,height:HEIGHT,timeout:TIMEOUT,headless:process.env.QA_HEADLESS!=='0',sourceHash:await sourceHash(),routes};
  const fingerprint=sha(JSON.stringify(config));
  try {const entries=await fs.readdir(out);if(!RESUME&&entries.length)throw Error('QA_TMP must be fresh/empty; use QA_RESUME=1 explicitly');}
  catch(e){if(e.code==='ENOENT'){if(RESUME)throw Error('Resume directory does not exist');await fs.mkdir(out,{recursive:true});}else throw e;}
  if(RESUME){const manifest=JSON.parse(await fs.readFile(file('manifest.json'),'utf8'));if(manifest.fingerprint!==fingerprint)throw Error('Resume refused: configuration or source changed. Use a fresh QA_TMP.');}
  const lock=await fs.open(file('audit.lock'),'wx').catch(()=>{throw Error('Audit lock exists. Confirm no audit is running, then remove stale audit.lock manually.');});await lock.writeFile(String(process.pid));await lock.close();lockHeld=true;
  const prerequisite=await health();
  if(!RESUME)await atomic('manifest.json',{fingerprint,config,createdAt:stamp(),prerequisite,limitations:['Client-side request isolation cannot guarantee a local server never makes its own outbound requests.','Login necessarily creates an auth audit record. No content mutations permitted.','Automated geometry is heuristic, not proof of all overlaps; review evidence.','Bounded lazy-image traversal may leave very long pages partially covered.','Live database state is not fingerprinted: resumed rows remain dated evidence, not a fresh verification of changing database records. Use a fresh directory after database changes.','No axe, payment, booking submit or save-form tests are included.']});
  await atomic('last-health.json',prerequisite);
  browser=await chromium.launch({headless:config.headless});
  const summary={fingerprint,startedAt:stamp(),verified:0,resumed:0,failed:0,rows:[],plannedPublicRows:routes.length*WIDTHS.length,adminNavigation:[],limitations:[]};
  async function unit(kind,route,width,fn) {
    const prior=await verified(kind,route,width,fingerprint);
    if(prior){summary.resumed++;summary.verified++;summary.rows.push({id:prior.id,status:prior.status,findings:prior.findings?.length||0});return prior;}
    const row=newRow(kind,route,width);
    try{await fn(row);row.status='verified';summary.verified++;}
    catch(e){row.status='failed';row.error=safeText(e.message);summary.failed++;}
    await persist(row,fingerprint);summary.rows.push({id:row.id,status:row.status,findings:row.findings?.length||0});
    await atomic('progress.json',summary);console.log(`${row.status}: ${kind} ${width} ${route}`);return row;
  }
  // Public pages, including dedicated unauthenticated admin login at every width.
  const publicSession=await makeContext();const page=await publicSession.context.newPage();page.setDefaultTimeout(TIMEOUT);
  for(const width of WIDTHS)for(const route of routes)await unit(route.startsWith('/admin')?'admin-login':'public',route,width,async row=>{
    await action(page,row,'viewport',()=>page.setViewportSize({width,height:HEIGHT}));
    await navigate(page,row,route);await lazyScan(page,row);await measure(page,row);
    if(route.startsWith('/admin')){row.checks.loginVisible=await page.locator('.adm-login').isVisible();if(!row.checks.loginVisible)throw Error('Admin login missing');await screenshot(page,row,'login-proof','.adm-auth');}
    if(route==='/'&&[375,1440].includes(width)){await action(page,row,'main-proof-top',()=>page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'})));await screenshot(page,row,'main-proof');}
  });
  for(const width of WIDTHS)await unit('public-flows','/',width,async row=>{
    await action(page,row,'viewport',()=>page.setViewportSize({width,height:HEIGHT}));await navigate(page,row,'/');
    await booking(page,row);await mobileMenu(page,row);
  });
  summary.blockedPublicRequests=publicSession.blocked;await page.close();await publicSession.context.close();
  // Dedicated authenticated, read-only admin session, never persisted as storage state.
  const admin=await makeContext();const ap=await admin.context.newPage();ap.setDefaultTimeout(TIMEOUT);
  const loginRow=newRow('admin-auth','/admin/',1440);
  try {
    await navigate(ap,loginRow,'/admin/');
    await action(ap,loginRow,'private-email',()=>ap.locator('.adm-login input[name=email]').fill(auth.ADMIN_EMAIL));
    await action(ap,loginRow,'private-password',()=>ap.locator('.adm-login input[name=password]').fill(auth.ADMIN_PASSWORD));
    admin.allowLogin();
    await action(ap,loginRow,'admin-login',()=>ap.getByRole('button',{name:'Sign in',exact:true}).click());
    await ap.locator('.adm-shell').waitFor({state:'visible',timeout:TIMEOUT});await aria(ap,loginRow,'authenticated');
    loginRow.checks.authenticated=true;loginRow.status='verified';
    await persist(loginRow,fingerprint);
    const labels=await ap.locator('nav[aria-label="Admin navigation"] button').allTextContents();
    if(labels.length<2)throw Error('Admin navigation incomplete');summary.adminNavigation=labels.map(x=>x.trim());
    for(const width of WIDTHS)for(const label of summary.adminNavigation)await unit('admin-screen',label,width,async row=>{
      await action(ap,row,'viewport',()=>ap.setViewportSize({width,height:HEIGHT}));
      const toggle=ap.getByRole('button',{name:'Open navigation',exact:true});
      if(await toggle.isVisible())await action(ap,row,'open-admin-navigation',()=>toggle.click());
      await action(ap,row,'admin-nav',()=>ap.locator('nav[aria-label="Admin navigation"]').getByRole('button',{name:label,exact:true}).click());
      await ap.locator('.adm-content h1').waitFor({state:'visible'});
      await ap.locator('.adm-table-card[aria-busy="false"]').waitFor({state:'visible',timeout:TIMEOUT});await aria(ap,row,'screen-loaded');
      const title=(await ap.locator('.adm-content h1').textContent()).replace(/\.$/,'').trim();
      if(title!==label)throw Error('Wrong admin screen accepted');
      if(await ap.locator('.adm-content > .adm-alert').count())throw Error('Admin screen reports API/load error');
      row.checks.screenLoaded=true;await measure(ap,row);await scrollAdmin(ap,row,'.adm-content');
      const create=ap.getByRole('button',{name:'Create new',exact:true});
      if(await create.isVisible()){
        await action(ap,row,'new-editor-open',()=>create.click());
        await ap.locator('.adm-dialog').waitFor({state:'visible'});await aria(ap,row,'new-editor-visible');
        row.checks.newEditorOpened=await ap.locator('#adm-dialog-title').textContent().then(s=>s.startsWith('Create '));
        await scrollAdmin(ap,row,'.adm-dialog');
        await screenshot(ap,row,'new-editor','.adm-dialog');
        await action(ap,row,'new-editor-cancel',()=>ap.locator('.adm-dialog').getByRole('button',{name:'Cancel',exact:true}).click());
        await ap.locator('.adm-dialog').waitFor({state:'detached'});await aria(ap,row,'new-editor-cancelled');row.checks.newEditorCancelled=true;
      }else row.checks.newEditor='not-applicable-no-create-button';
    });
  }catch(e){summary.failed++;summary.limitations.push('Authenticated admin coverage blocked: '+safeText(e.message));loginRow.error=safeText(e.message);loginRow.status='failed';await persist(loginRow,fingerprint);}
  finally {summary.blockedAdminRequests=admin.blocked;await ap.close();await admin.context.close();}
  summary.sourceStable=(await sourceHash())===config.sourceHash;
  if(!summary.sourceStable)summary.limitations.push('Source changed during audit. Evidence may mix versions; rerun into a fresh QA_TMP.');
  summary.finishedAt=stamp();summary.complete=summary.failed===0&&summary.sourceStable;
  summary.findingRows=summary.rows.filter(r=>r.findings>0).length;
  summary.executionOnly=true; // complete is coverage/flow completion, not a clean visual verdict.
  summary.falseChecks=[];
  for(const r of summary.rows){const row=JSON.parse(await fs.readFile(file('rows/'+r.id+'.json'),'utf8'));for(const [check,value]of Object.entries(row.checks||{}))if(value===false)summary.falseChecks.push({id:row.id,check});}
  summary.complete=summary.complete&&!summary.falseChecks.length;
  await atomic('progress.json',summary);await atomic('report.json',summary);
  console.log(JSON.stringify({complete:summary.complete,verified:summary.verified,resumed:summary.resumed,failed:summary.failed,falseChecks:summary.falseChecks.length,output:out}));
  if(!summary.complete)process.exitCode=1;
}
run().catch(e=>{console.error(safeText(e.message));process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close().catch(()=>{});
  if(lockHeld)await fs.unlink(file('audit.lock')).catch(()=>{});
});
