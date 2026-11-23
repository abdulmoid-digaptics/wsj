import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {applyCloneAction, cloneOverview, cloneSections, deleteCloneRecord, saveCloneRecord, seedClone, simulateCloneUnlock, validCloneDate, validateStoredClone} from '../src/workspace-clone-core';
import {WorkspaceCloneController, WorkspaceCloneService} from '../src/workspace-clone';
import {KisiClient} from '../src/kisi-client';
import {kind} from '../src/public';

const now=new Date('2026-11-23T16:00:00Z');
function reference(){return {version:1,capturedAt:now.toISOString(),sourceLinks:{sheets:'https://docs.google.com/spreadsheets/d/example/edit',kisi:'https://web.kisi.io/organization/9557/dashboard'},workbook:{sheets:[
  {name:'Packages',rows:[['subscription_type','amount','interval','pricing_mode','quantity_unit','kisi_access','kisi_group_id'],['Desk',350,1,'monthly','none','Yes',1060346]]},
  {name:'Weekly Reports',rows:[['report_date','week_ending','active_members','timestamp'],['2026-11-23','2026-11-23',3,now.toISOString()]]},
  {name:'Dashboard_KPIs',rows:[['active_count','expiring_count','failed_count','last_updated'],[3,0,0,now.toISOString()]]},
  {name:'Dashboard_ActiveMembers',rows:[['name','email','plan','status','expires'],['Future','future@example.test','Desk','Active','2026-12-17T00:00:00Z'],['Past','past@example.test','Desk','Active','2026-08-28T00:00:00Z'],['Other','other@example.test','Desk','Active','2026-09-29T00:00:00Z']]},
  {name:'Marketplace Transactions',rows:[['Date','Payment Intent ID','Charge ID','Product','Category','Quantity','Total Amount ($)','Platform Fee ($)','Vendor Payout ($)','Vendor Name','Vendor Email','Vendor Stripe Account','Customer Email','Customer Name','Transfer ID','Currency','Status','Order Reference'],['2026-07-29T08:54:24+02:00','pi_ref','ch_ref','Product','General',1,'10.00','1.00','9.00','Vendor','vendor@example.test','acct_ref','customer@example.test','Customer','tr_ref','usd','succeeded','cs_ref']]},
]},kisi:{organization:'Workspace Junction',placeId:'22548',users:['Future future@example.test--','Past past@example.test-Suspended'],groups:['Desk Workspace Junction 0 1'],doors:[{name:'Front Door',status:'Locked'}],hardware:[],floors:[],digitalCredentials:[],reportCatalog:[],integrations:[],accessEvents:'',auditEvents:''}};}
function setup(){const state=seedClone(reference());state.records.users[0].status='Enabled';state.records.groups[0]={...state.records.groups[0],policyReviewed:true,appAccess:true,doors:'Front Door',primaryDeviceRestriction:false,geofenceRestriction:false,readerProximityRestriction:false,readerTapRestriction:false,timeRestriction:false};saveCloneRecord(state,'access-rights',{user:'future@example.test',group:'Desk',role:'group_basic',validFrom:'2026-11-23T06:00:00Z',validUntil:'2026-11-24T06:00:00Z',status:'Active'},'qa',undefined,now);return state;}

test('reference source is immutable, and source counts remain separate from derived counts',()=>{
 const source=reference(),before=JSON.stringify(source),state=seedClone(source);const o=cloneOverview(state,now);
 assert.equal(o.mode,'LOCAL_ONLY');assert.equal(o.summary.referenceActive,3);assert.equal(o.summary.localActive,1);assert.equal(o.summary.localExpired,2);
 saveCloneRecord(state,'active-members',{name:'Changed locally'},'qa',state.records['active-members'][0].id,now);
 assert.equal(JSON.stringify(source),before);assert.equal(state.records['active-members'][0].provenance,'LOCAL');assert.equal(state.records.kpis[0].active_count,3);
});
test('private snapshot contains the verified workbook and Kisi inventory when available',async t=>{
 let source:any;try{source=JSON.parse(await readFile(path.resolve(__dirname,'../private/workspace-reference.json'),'utf8'));}catch{t.skip('Private user reference is intentionally not committed.');return;}
 const state=validateStoredClone(seedClone(source));assert.equal(state.records.packages.length,37);assert.equal(state.records['weekly-reports'].length,19);assert.equal(state.records.users.length,28);assert.equal(state.records.groups.length,30);assert.equal(state.records['digital-credentials'].length,3);assert.equal(state.records.credentials.length,0);assert.equal(state.records.doors.length,1);
 assert.equal(state.records.packages.find(r=>r.subscription_type==='Meeting Rooms - Collaboration Room')?.amount,35);
 assert.equal(state.records.packages.find(r=>r.subscription_type==='Memberships - Professional Membership')?.yearly_amount,799);
});
test('read-only history and record provenance are protected',()=>{
 const state=setup();assert.throws(()=>saveCloneRecord(state,'weekly-reports',{active_members:0},'qa',state.records['weekly-reports'][0].id));
 for(const data of [{id:'overwrite'},{provenance:'REFERENCE'},{name:{nested:true}},{status:'Not a real status'}])assert.throws(()=>saveCloneRecord(state,'users',data,'qa',state.records.users[0].id));
});
test('dates reject calendar overflow, timezone-free input and clock-format tricks',()=>{
 assert.equal(validCloneDate('2026-02-30'),false);assert.equal(validCloneDate('2026-02-28'),true);assert.equal(validCloneDate('2026-11-23T10:00:00Z',true),true);assert.equal(validCloneDate('November 23 2026 Z',true),false);assert.equal(validCloneDate('2026-11-23T10:00',true),false);
 const state=setup();assert.throws(()=>saveCloneRecord(state,'access-rights',{validFrom:'2026-02-30T10:00:00Z'},'qa',state.records['access-rights'][0].id));
});
test('marketplace splits balance to cents and never accept currency conversion or half cents',()=>{
 const state=setup(),base={date:now.toISOString(),product:'Local item',quantity:1,totalAmount:10,platformFee:1,vendorPayout:9,currency:'usd',status:'succeeded'};
 saveCloneRecord(state,'marketplace',base,'qa',undefined,now);
 for(const delta of [{platformFee:2},{totalAmount:0.005,platformFee:0.005,vendorPayout:0},{currency:'eur'},{quantity:1.5},{totalAmount:-1},{vendorPayout:'invalid'}])assert.throws(()=>saveCloneRecord(state,'marketplace',{...base,...delta},'qa'));
});
test('unknown policy restrictions fail closed even after partial review',()=>{
 const state=setup(),user=state.records.users[0],door=state.records.doors[0];delete state.records.groups[0].geofenceRestriction;
 assert.match(simulateCloneUnlock(state,door.id,user.id,'qa',now),/denied/);assert.equal(door.status,'Locked');
});
test('simulation enforces user suspension, assignment windows, physical restrictions and lockdown',()=>{
 const state=setup(),user=state.records.users[0],door=state.records.doors[0],right=state.records['access-rights'][0];
 assert.match(simulateCloneUnlock(state,door.id,user.id,'qa',now),/allowed/);
 user.status='Suspended';assert.match(simulateCloneUnlock(state,door.id,user.id,'qa',now),/denied/);user.status='Enabled';
 right.validUntil=now.toISOString();assert.match(simulateCloneUnlock(state,door.id,user.id,'qa',now),/denied/);right.validUntil='2026-11-24T06:00:00Z';
 state.records.groups[0].readerProximityRestriction=true;assert.match(simulateCloneUnlock(state,door.id,user.id,'qa',now),/denied/);state.records.groups[0].readerProximityRestriction=false;
 state.localLockdown=true;assert.match(simulateCloneUnlock(state,door.id,user.id,'qa',now),/denied/);assert.equal(door.status,'Locked');
});
test('team access is time-bounded and local offboarding blocks every path',()=>{
 const state=setup(),user=state.records.users[0],door=state.records.doors[0];state.records['access-rights']=[];
 saveCloneRecord(state,'teams',{name:'Team',members:'future@example.test',groups:'Desk',validFrom:'2026-11-23T06:00:00Z',validUntil:'2026-11-24T06:00:00Z'},'qa');
 assert.match(simulateCloneUnlock(state,door.id,user.id,'qa',now),/allowed/);
 state.records.teams[0].validUntil=now.toISOString();assert.match(simulateCloneUnlock(state,door.id,user.id,'qa',now),/denied/);state.records.teams[0].validUntil='2026-11-24T06:00:00Z';
 applyCloneAction(state,'offboard-member','active-members',state.records['active-members'][0].id,{},'qa',now);assert.equal(user.status,'Suspended');assert.equal(state.records.teams[0].members,'');assert.match(simulateCloneUnlock(state,door.id,user.id,'qa',now),/denied/);
});
test('group weekly schedules and exception dates gate local unlocks',()=>{
 const state=setup(),group=state.records.groups[0],user=state.records.users[0],door=state.records.doors[0];group.timeRestriction=true;
 saveCloneRecord(state,'schedules',{name:'Business hours',group:'Desk',weekdays:'1,2,3,4,5',startTime:'09:00',endTime:'17:00',timeZone:'America/Chicago',enabled:true},'qa');
 assert.match(simulateCloneUnlock(state,door.id,user.id,'qa',now),/allowed/);
 state.records.schedules[0].exceptionDates='2026-11-23';assert.match(simulateCloneUnlock(state,door.id,user.id,'qa',now),/denied/);
 assert.throws(()=>saveCloneRecord(state,'schedules',{exceptionDates:'2026-02-30'},'qa',state.records.schedules[0].id));
});
test('renames preserve local links without rewriting audit history',()=>{
 const state=setup();const auditBefore=JSON.stringify(state.records['audit-events']);
 saveCloneRecord(state,'groups',{name:'Renamed desk'},'qa',state.records.groups[0].id,now);assert.equal(state.records['access-rights'][0].group,'Renamed desk');
 assert.equal(JSON.stringify(state.records['audit-events'].slice(1)),auditBefore);
 assert.throws(()=>deleteCloneRecord(state,'groups',state.records.groups[0].id,'qa'));
});
test('visitor check-in creates only local expiring rights and checkout revokes only that visit',()=>{
 const state=setup();saveCloneRecord(state,'visitors',{name:'Guest',email:'guest@example.test',group:'Desk',validFrom:'2026-11-23T06:00:00Z',validUntil:'2026-11-24T06:00:00Z',shareAccess:true,delivery:'Email',accessType:'Access link',status:'Invited'},'qa');
 const visitor=state.records.visitors[0];applyCloneAction(state,'check-in-visitor','visitors',visitor.id,{},'qa',now);assert.equal(visitor.status,'Checked in');const visitorRight=state.records['access-rights'].find(r=>r.visitorId===visitor.id)!;assert.equal(visitorRight.validUntil,visitor.validUntil);assert.equal(visitorRight.provenance,'LOCAL');
 applyCloneAction(state,'check-out-visitor','visitors',visitor.id,{},'qa',now);assert.equal(visitorRight.status,'Revoked');assert.equal(state.records['access-rights'][0].status,'Active');
});
test('local weekly regeneration preserves source history and avoids duplicate local weeks',()=>{
 const state=setup(),referenceCount=state.records['weekly-reports'].length;
 applyCloneAction(state,'generate-report','weekly-reports',undefined,{},'qa',now);applyCloneAction(state,'generate-report','weekly-reports',undefined,{},'qa',now);
 assert.equal(state.records['weekly-reports'].length,referenceCount+1);assert.equal(state.records['weekly-reports'][0].provenance,'REFERENCE');assert.equal(state.records['weekly-reports'].at(-1)!.active_members,1);
});
test('stored clone validation rejects unexpected private data, malformed records and unsafe links',()=>{
 const state=setup();assert.ok(validateStoredClone(state));
 const badLinks=structuredClone(state);badLinks.sourceLinks.kisi='javascript:alert(1)';assert.throws(()=>validateStoredClone(badLinks));
 const arbitrary=structuredClone(state);arbitrary.records.users[0].secret='do-not-store';assert.throws(()=>validateStoredClone(arbitrary));
 const badSection=structuredClone(state);(badSection.records as any).users='not-array';assert.throws(()=>validateStoredClone(badSection));
});
function serviceFixture(){
 let persisted:any=null;const audits:any[]=[];let serial=Promise.resolve();
 const content={findUnique:async()=>persisted?structuredClone(persisted):null,upsert:async({create,update}:any)=>{persisted={...(persisted||create),...update};return persisted;}};
 const tx:any={content,audit:{create:async({data}:any)=>{audits.push(data);return data;}},$queryRaw:async()=>[]};
 const db:any={...tx,$transaction:(fn:any)=>{const result=serial.then(async()=>{const before=structuredClone(persisted);try{return await fn(tx);}catch(error){persisted=before;throw error;}});serial=result.catch(()=>undefined);return result;}};
 const service=new WorkspaceCloneService(db);(service as any).seed=async()=>seedClone(reference());return {service,audits,get:()=>persisted};
}
test('service persists local edits, rejects stale revisions and never needs external fetch',async()=>{
 const original=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw new Error('No network allowed');};
 try{const {service}=serviceFixture();const o=await service.overview();assert.equal(o.revision,0);
 const row=o.sections.find(s=>s.key==='users')!.records[0];const changed=await service.update('users',row.id,{revision:0,data:{notes:'Only local'}},'qa');assert.equal(changed.revision,1);assert.equal(changed.sections.find(s=>s.key==='users')!.records[0].notes,'Only local');
 await assert.rejects(service.update('users',row.id,{revision:0,data:{notes:'Stale'}},'qa'),/Reload/);assert.equal((await service.overview()).revision,1);assert.equal(network,0);
 }finally{globalThis.fetch=original;}
});
test('concurrent local saves cannot overwrite each other',async()=>{
 const {service}=serviceFixture();const o=await service.overview(),row=o.sections.find(s=>s.key==='users')!.records[0];
 const results=await Promise.allSettled([service.update('users',row.id,{revision:0,data:{notes:'one'}},'qa'),service.update('users',row.id,{revision:0,data:{notes:'two'}},'qa')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
});
test('clone authorization is ADMIN only and private content cannot use public content routes',()=>{
 assert.deepEqual(Reflect.getMetadata('roles',WorkspaceCloneController),['ADMIN']);assert.ok(Reflect.getMetadata('__guards__',WorkspaceCloneController)?.length);assert.throws(()=>kind('private-workspace-clone'));
});
test('all live Kisi writes fail before fetch while reference lock is off',async()=>{
 const previous=process.env.KISI_API_KEY,flag=process.env.KISI_LIVE_WRITES,original=globalThis.fetch;process.env.KISI_API_KEY='local-test-key';process.env.KISI_LIVE_WRITES='false';let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('No real request');};
 try{const client=new KisiClient();for(const [url,method] of [['/users','POST'],['/role_assignments','POST'],['/role_assignments/1','DELETE']])await assert.rejects(client.request(url,method),/locked/);assert.equal(calls,0);}finally{globalThis.fetch=original;if(previous===undefined)delete process.env.KISI_API_KEY;else process.env.KISI_API_KEY=previous;if(flag===undefined)delete process.env.KISI_LIVE_WRITES;else process.env.KISI_LIVE_WRITES=flag;}
});
