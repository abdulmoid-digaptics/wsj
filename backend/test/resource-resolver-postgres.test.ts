import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {PrismaClient} from '@prisma/client';
import {resolveReservationPlan} from '../src/resource-resolver';
import {ResourceInventory} from '../src/resource-inventory';
import type {BookingRule} from '../src/booking-rules';
const enabled=process.env.INVENTORY_TEST_DOCKER==='1';
test('event rules atomically block exactly three rooms and release them',{skip:enabled?false:'set INVENTORY_TEST_DOCKER=1',timeout:180000},async()=>{
 const name='wsj-rules-test-'+randomUUID(),password=randomUUID();
 const docker=(...args:string[])=>execFileSync('docker',args,{encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe']}).trim();
 const container=docker('run','--pull=never','--detach','--rm','--name',name,'--tmpfs','/var/lib/postgresql/data','-e',`POSTGRES_PASSWORD=${password}`,'-e','POSTGRES_DB=inventory_test','-p','127.0.0.1::5432','postgres:16-alpine');let db:PrismaClient|undefined;
 try{
  const port=/^127\.0\.0\.1:(\d+)$/.exec(docker('port',container,'5432/tcp'))?.[1];assert.ok(port);
  let ready=false;for(let i=0;i<50&&!ready;i++){ready=spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-d','inventory_test'],{stdio:'ignore',timeout:5000}).status===0;if(!ready)await delay(250);}assert.ok(ready);
  const url=`postgresql://postgres:${password}@127.0.0.1:${port}/inventory_test`;
  execFileSync(process.execPath,[path.join(process.cwd(),'node_modules/prisma/build/index.js'),'migrate','deploy'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:url},timeout:60000,stdio:'pipe'});
  db=new PrismaClient({datasourceUrl:url});const inv=new ResourceInventory(db);
  const loc=await db.inventoryLocation.create({data:{name:'Test',timeZone:'America/Chicago'}});
  const event=await db.serviceCategory.create({data:{name:'Events',slug:'event-'+randomUUID()}}),meeting=await db.serviceCategory.create({data:{name:'Meeting',slug:'meeting-'+randomUUID()}});
  const createResource=(name:string,serviceId:string)=>db!.physicalResource.create({data:{name,kind:'room',locationId:loc.id,capacity:1,mappings:{create:{serviceId}}}});
  const eventSpace=await createResource('Event space',event.id),rooms=await Promise.all([1,2,3,4].map(i=>createResource('Room '+i,meeting.id)));
  const rule:BookingRule={id:'event-rule',enabled:true,priority:1,condition:{all:[{field:'serviceKey',op:'eq',value:'events'},{field:'status',op:'eq',value:'CONFIRMED'}]},targetResourceIds:rooms.slice(0,3).map(r=>r.id),beforeMinutes:30,afterMinutes:0};
  const mapped=(r:typeof eventSpace)=>({id:r.id,locationId:r.locationId,capacity:r.capacity,active:r.active});
  const plan=resolveReservationPlan({policy:{serviceId:event.id,serviceKey:'events',locationId:loc.id,durationMinutes:60,requirements:[{resource:mapped(eventSpace),units:1}]},startAt:'2090-01-01T15:00:00Z',rules:[rule],ruleTargets:rooms.map(mapped)});
  const [claim]=await inv.holdBatch({items:[plan.item],ownerRef:'synthetic-event',ttlSeconds:300});await inv.confirm(claim.id);
  const request=(id:string)=>({locationId:loc.id,serviceId:meeting.id,startsAt:new Date('2090-01-01T14:45:00Z'),endsAt:new Date('2090-01-01T15:45:00Z'),resources:[{resourceId:id,units:1}]});
  for(const room of rooms.slice(0,3))assert.equal((await inv.availability(request(room.id))).available,false);
  assert.equal((await inv.availability(request(rooms[3].id))).available,true);
  await inv.release(claim.id);for(const room of rooms)assert.equal((await inv.availability(request(room.id))).available,true);
 }finally{try{await db?.$disconnect();}finally{docker('rm','-f',container);}}
});
