import fs from 'node:fs/promises';
import path from 'node:path';
import {parseHTML} from 'linkedom';
const R=path.resolve(import.meta.dirname,'../..');
const read=async n=>JSON.parse(await fs.readFile(path.join(R,'data',n),'utf8'));
const site=await read('site.json'), records=await read('migration-content.json');
const missing=[], lookup=new Map(), local=new Set();
for(const a of site.assets){
 if(!a.localPath||!a.localPath.startsWith('/media/')){missing.push({sourceUrl:a.sourceUrl,error:'No local media path'});continue;}
 try {const st=await fs.stat(path.join(R,'public',a.localPath));if(!st.size)throw Error('Empty file');a.bytes=st.size;a.status='downloaded';delete a.error;}catch(e){missing.push({sourceUrl:a.sourceUrl,path:a.localPath,error:e.message});continue;}
 local.add(a.localPath);lookup.set(a.sourceUrl,a.localPath);lookup.set(new URL(a.sourceUrl).pathname,a.localPath);
}
const changes={mediaReferences:0};
const provenance=new Set(['sourceUrl','source','canonicalUrl','usedBy']);
function media(s){return s.replace(/(?:(?:https?:)?\/\/(?:www\.)?workspacejunction\.com)?\/(?:wp-content\/uploads|media)\/[^\s"'<>\\),]+/g,raw=>{
 const clean=raw.replaceAll('&amp;','&');let target=lookup.get(clean);if(!target){try{const u=new URL(clean,'https://workspacejunction.com');target=u.pathname.startsWith('/media/')&&local.has(decodeURI(u.pathname))?decodeURI(u.pathname):lookup.get(u.pathname);}catch{}}
 if(target&&raw!==target){changes.mediaReferences++;return target;}return raw;
});}
const redirects=[
 ['/podcast/','/podcast-studio/'],
 ['/freelancers-solopreneurs/','/use-cases/freelancers-solopreneurs/'],
 ['/law-firms-attorneys/','/use-cases/law-firms-attorneys/'],
 ['/business-consultants/','/use-cases/business-consultants/'],
 ['/webinars_list/','/webinars/'],['/workshops_list/','/workshops/'],['/events_list/','/events/'],
 ['/meeting-room-rental-vs-rent-work-space-vs-office-space-rental/','/meeting-room-rental-guide/'],
 ['/office-space-for-rent-oakbrook-terrace-chicago/','/office-space-for-rent-oakbrook-terrace/']
].map(([source,destination])=>({source,destination}));
const routes=new Set([...site.pages,...site.posts,...site.categories].map(p=>p.path));
for(const r of redirects)if(!routes.has(r.destination))throw Error('Missing redirect destination '+r.destination);
function walk(v,k=''){
 if(provenance.has(k)||k==='assets')return v;
 if(typeof v==='string')return media(v);
 if(Array.isArray(v))return v.map(x=>walk(x,k));
 if(v&&typeof v==='object')for(const key of Object.keys(v))v[key]=walk(v[key],key);
 return v;
}
walk(site);walk(records);
// Preserve source anchor URLs: exact redirects resolve stale slugs without altering source copy.
const references=new Set(),remote=[];
function scan(s,context){for(const m of s.matchAll(/\/media\/[^\s"'<>\\),]+/g))references.add(m[0].replace(/[?#].*$/,''));for(const m of s.matchAll(/(?:https?:)?\/\/workspacejunction\.com\/(?:media|wp-content\/uploads)\/[^\s"'<>]+/g))remote.push({context,url:m[0]});}
for(const p of [...site.pages,...site.posts]){scan(p.content||'',p.path);if(p.featuredImage)scan(p.featuredImage,p.path+':featuredImage');for(const i of p.images||[])scan(i,p.path+':images');}
for(const r of records){scan(r.content?.html||'',r.kind+':'+r.slug);if(r.metadata?.featuredImage)scan(r.metadata.featuredImage,r.slug+':featuredImage');}
const missingReferences=[];for(const p of references)try{const st=await fs.stat(path.join(R,'public',decodeURI(p)));if(!st.size)missingReferences.push(p);}catch{missingReferences.push(p);}
const duplicateBackendKeys=records.map(r=>r.kind+':'+r.slug).filter((k,i,a)=>a.indexOf(k)!==i);
const unsafe=[...site.pages,...site.posts].filter(p=>/<(?:script|iframe|form)\b|\son\w+=/i.test(p.content)).map(p=>p.path);
const linkTargets=new Set();for(const p of [...site.pages,...site.posts]){const d=parseHTML('<html><body>'+p.content+'</body></html>').document;for(const a of d.querySelectorAll('a[href]')){try{const u=new URL(a.getAttribute('href'),'https://workspacejunction.com');if(u.hostname==='workspacejunction.com'&&!u.pathname.startsWith('/media/'))linkTargets.add(u.pathname);}catch{}}}
const normalize=p=>p==='/'?p:p.replace(/\/+$/,'')+'/';const available=new Set([...routes].map(normalize));available.add('/');for(const r of redirects)available.add(normalize(r.source));
const unrepresentedInternalTargets=[...linkTargets].filter(p=>!available.has(normalize(p))).sort();
const summary={verifiedAt:new Date().toISOString(),offlineOnly:true,pages:site.pages.length,posts:site.posts.length,categories:site.categories.length,assets:site.assets.length,downloaded:site.assets.filter(a=>a.status==='downloaded').length,mediaBytes:site.assets.reduce((n,a)=>n+(a.bytes||0),0),backendRecords:records.length,duplicateBackendKeys,nonRESTPosts:site.posts.filter(p=>p.contentSource!=='public-rest').map(p=>p.path),remainingMissing:missing,referencedLocalFiles:references.size,missingReferences,remainingRemoteRenderMedia:remote,unsafeContent:unsafe,redirectCount:redirects.length,unrepresentedInternalTargets,changes};
await fs.writeFile(path.join(R,'data/site.json'),JSON.stringify(site,null,2));await fs.writeFile(path.join(R,'data/migration-content.json'),JSON.stringify(records,null,2));await fs.writeFile(path.join(R,'data/redirects.json'),JSON.stringify(redirects,null,2));await fs.writeFile(path.join(R,'data/verification.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));if(missing.length||missingReferences.length||remote.length||duplicateBackendKeys.length||unsafe.length)process.exitCode=1;
