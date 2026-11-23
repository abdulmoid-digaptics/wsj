import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import jwt from 'jsonwebtoken';
import {Module} from '@nestjs/common';
import {Db,AuthGuard} from '../src/core';
import {InventoryAdminController} from '../src/inventory-admin';
import {createApplication} from '../src/application';
import {ResourceInventory} from '../src/resource-inventory';

@Module({controllers:[InventoryAdminController],providers:[Db,AuthGuard]}) class InventoryTestModule {}
const enabled=process.env.INVENTORY_TEST_DOCKER==='1';
test('inventory admin HTTP authorization and conflicts on disposable PostgreSQL',{skip:enabled?false:'set INVENTORY_TEST_DOCKER=1',timeout:180000},async()=>{
 const name='wsj-inventory-api-'+randomUUID(), password=randomUUID();
 const docker=(...args:string[])=>execFileSync('docker',args,{encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe']}).trim();
 const container=docker('run','--pull=never','--detach','--rm','--name',name,'--tmpfs','/var/lib/postgresql/data','-e',`POSTGRES_PASSWORD=${password}`,'-e','POSTGRES_DB=inventory_test','-p','127.0.0.1::5432','postgres:16-alpine');
 const old={database:process.env.DATABASE_URL,secret:process.env.JWT_SECRET,nodeEnv:process.env.NODE_ENV};let app:any;
 try{
  const port=/^127\.0\.0\.1:(\d+)$/.exec(docker('port',container,'5432/tcp'))?.[1];assert.ok(port);
  let ready=false;for(let i=0;i<50&&!ready;i++){ready=spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-d','inventory_test'],{stdio:'ignore',timeout:5000}).status===0;if(!ready)await delay(250);}assert.ok(ready);
  process.env.DATABASE_URL=`postgresql://postgres:${password}@127.0.0.1:${port}/inventory_test`;process.env.JWT_SECRET='isolated-inventory-test-secret-123456789';process.env.NODE_ENV='test';
  execFileSync(process.execPath,[path.join(process.cwd(),'node_modules/prisma/build/index.js'),'migrate','deploy'],{cwd:process.cwd(),env:process.env,timeout:60000,stdio:'pipe'});
  app=await createApplication(InventoryTestModule);await app.listen(0,'127.0.0.1');const db=app.get(Db) as Db;
  const [admin,editor,viewer]=await Promise.all(['ADMIN','EDITOR','VIEWER'].map(role=>db.user.create({data:{name:role,email:role.toLowerCase()+'@example.invalid',passwordHash:'unused',role:role as 'ADMIN'|'EDITOR'|'VIEWER'}})));
  const token=(user:{id:string;tokenVersion:number})=>jwt.sign({sub:user.id,v:user.tokenVersion},process.env.JWT_SECRET!);
  const base=`http://127.0.0.1:${app.getHttpServer().address().port}/api`;
  const call=async(url:string,method='GET',body?:unknown,auth?:string)=>{const response=await fetch(base+url,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(auth?{Authorization:'Bearer '+auth}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json() as any};};
  assert.equal((await call('/admin/inventory/locations')).status,401);
  assert.equal((await call('/admin/inventory/locations','POST',{name:'Test',timeZone:'UTC'},token(viewer))).status,403);
  assert.equal((await call('/admin/inventory/locations','POST',{name:'Test',timeZone:'Wrong/Zone'},token(admin))).status,400);
  const location=await call('/admin/inventory/locations','POST',{name:'Test',timeZone:'America/Chicago'},token(admin));assert.equal(location.status,201);
  const resource=await call('/admin/inventory/resources','POST',{locationId:location.data.id,name:'Room',kind:'room',capacity:1},token(admin));assert.equal(resource.status,201);
  const capacityUrl='/admin/inventory/resources/'+resource.data.id+'/capacity';
  assert.equal((await call(capacityUrl,'PATCH',{capacity:2})).status,401);
  assert.equal((await call(capacityUrl,'PATCH',{capacity:2},token(editor))).status,403);
  assert.equal((await call(capacityUrl,'PATCH',{capacity:2},token(viewer))).status,403);
  for(const body of [{},{capacity:0},{capacity:10001},{capacity:1.5},{capacity:'2'},{capacity:2,extra:true}]) {
   assert.equal((await call(capacityUrl,'PATCH',body,token(admin))).status,400,JSON.stringify(body));
  }
  assert.equal(await db.audit.count({where:{action:'UPDATE_CAPACITY',resourceId:resource.data.id}}),0);
  const changed=await call(capacityUrl,'PATCH',{capacity:2},token(admin));assert.equal(changed.status,200);assert.equal(changed.data.capacity,2);
  const capacityAudit=await db.audit.findMany({where:{action:'UPDATE_CAPACITY',resourceId:resource.data.id}});
  assert.equal(capacityAudit.length,1);assert.equal(capacityAudit[0].actorId,admin.id);
  const service=await db.serviceCategory.create({data:{name:'Meeting',slug:'meeting-'+randomUUID()}});
  assert.equal((await call('/admin/inventory/resources/'+resource.data.id+'/mappings','POST',{serviceId:service.id},token(admin))).status,201);
  const startsAt='2090-01-01T10:00:00Z',endsAt='2090-01-01T11:00:00Z';
  await new ResourceInventory(db).allocate({locationId:location.data.id,serviceId:service.id,startsAt:new Date(startsAt),endsAt:new Date(endsAt),resources:[{resourceId:resource.data.id,units:1}],ownerRef:'test'});
  await new ResourceInventory(db).allocate({locationId:location.data.id,serviceId:service.id,startsAt:new Date(startsAt),endsAt:new Date(endsAt),resources:[{resourceId:resource.data.id,units:1}],ownerRef:'test-2'});
  assert.equal((await call(capacityUrl,'PATCH',{capacity:1},token(admin))).status,409);
  assert.equal((await db.physicalResource.findUniqueOrThrow({where:{id:resource.data.id}})).capacity,2);
  assert.equal(await db.audit.count({where:{action:'UPDATE_CAPACITY',resourceId:resource.data.id}}),1);
  const closure=await call('/admin/inventory/closures','POST',{locationId:location.data.id,startsAt,endsAt,resourceIds:[resource.data.id]},token(admin));assert.equal(closure.status,409);
  assert.ok((await db.audit.count())>=3);
 }finally{
  try{if(app)await app.close();}finally{if(old.database===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=old.database;if(old.secret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=old.secret;if(old.nodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old.nodeEnv;docker('rm','-f',container);}
 }
});
