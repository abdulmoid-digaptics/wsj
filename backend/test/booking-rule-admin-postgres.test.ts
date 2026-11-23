import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {INestApplication,Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import jwt from 'jsonwebtoken';
import {AuthGuard,Db} from '../src/core';
import {BookingRuleAdminController,evaluateLocationBookingRules} from '../src/booking-rule-admin';

// Do not import the app module (timers/outbox/billing). Never accept a supplied DB URL.
@Module({controllers:[BookingRuleAdminController],providers:[Db,AuthGuard]}) class TestModule {}
test('dormant admin CRUD, auth, scoping, atomic audit and concurrency on disposable Postgres',{
  skip:process.env.INVENTORY_TEST_DOCKER==='1'?false:'set INVENTORY_TEST_DOCKER=1',timeout:180000,
},async t=>{
  const docker=(...args:string[])=>execFileSync('docker',args,{encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe']}).trim();
  const name='wsj-rule-admin-'+randomUUID(), password=randomUUID();
  const container=docker('run','--pull=never','--detach','--rm','--name',name,'--tmpfs','/var/lib/postgresql/data','-e',`POSTGRES_PASSWORD=${password}`,'-e','POSTGRES_DB=rule_test','-p','127.0.0.1::5432','postgres:16-alpine');
  const oldDb=process.env.DATABASE_URL,oldSecret=process.env.JWT_SECRET;
  let app:INestApplication|undefined;
  try {
    const port=/^127\.0\.0\.1:(\d+)$/.exec(docker('port',container,'5432/tcp'))?.[1]; assert.ok(port);
    let ready=false;
    for(let i=0;i<80&&!ready;i++) {
      ready=spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-d','rule_test'],{stdio:'ignore',timeout:5000}).status===0;
      if(!ready) await delay(250);
    }
    assert.ok(ready);
    process.env.DATABASE_URL=`postgresql://postgres:${password}@127.0.0.1:${port}/rule_test`;
    process.env.JWT_SECRET=randomUUID();
    execFileSync(process.execPath,[path.resolve('node_modules/prisma/build/index.js'),'migrate','deploy'],{env:process.env,timeout:60000,stdio:'pipe'});
    app=await NestFactory.create(TestModule,{logger:false}); await app.listen(0,'127.0.0.1');
    const db=app.get(Db),base=await app.getUrl();
    const [admin,editor,viewer]=await Promise.all((['ADMIN','EDITOR','VIEWER'] as const).map(role=>db.user.create({data:{role,name:role,email:role+'@example.invalid',passwordHash:'unused'}})));
    const token=(user:typeof admin)=>jwt.sign({sub:user.id,v:user.tokenVersion},process.env.JWT_SECRET!);
    const call=async(url:string,method='GET',body?:unknown,auth:string|null=token(admin))=>{
      const response=await fetch(base+url,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(auth?{Authorization:'Bearer '+auth}:{})},body:body?JSON.stringify(body):undefined});
      return {status:response.status,data:await response.json() as any};
    };
    const [a,b]=await Promise.all(['A','B'].map(name=>db.inventoryLocation.create({data:{name,timeZone:'UTC'}})));
    const [r1,r2,r3]=await Promise.all([a,a,b].map((loc,i)=>db.physicalResource.create({data:{locationId:loc.id,name:'R'+i,kind:'room'}})));
    const route=(loc=a.id)=>`/admin/inventory/locations/${loc}/booking-rules`;
    const input={enabled:true,priority:5,condition:{all:[{field:'locationId',op:'eq',value:a.id},{any:[{field:'serviceKey',op:'eq',value:'meeting'}]}]},targetResourceIds:[r1.id],beforeMinutes:10,afterMinutes:20,activeFrom:'2028-01-01T02:00+02:00',activeUntil:'2028-02-01T00:00Z',excludedDates:['2028-01-10']};
    const booking={locationId:a.id,serviceKey:'meeting',status:'PENDING',start:'2028-01-02T00:00Z',end:'2028-01-02T01:00Z'};
    const evaluate=(override={})=>db.$transaction(tx=>evaluateLocationBookingRules(tx,{...booking,...override}),{isolationLevel:'ReadCommitted'});
    await t.test('each route rejects unauthenticated and non-admin actors',async()=>{
      for(const [verb,suffix] of [['GET',''],['POST',''],['GET','/any'],['PUT','/any'],['DELETE','/any']]) {
        const payload=verb==='GET'?undefined:input;
        assert.equal((await call(route()+suffix,verb,payload,null)).status,401);
        for(const user of [viewer,editor]) assert.equal((await call(route()+suffix,verb,payload,token(user))).status,403);
      }
      assert.equal(await db.audit.count(),0);
    });
    const created=await call(route(),'POST',input); assert.equal(created.status,201); const id=created.data.id,url=route()+'/'+id;
    await t.test('round-trips canonical UTC range, nested JSON and exact targets; evaluator filters by location/date',async()=>{
      assert.deepEqual(created.data,{...input,id,locationId:a.id,version:1,activeFrom:'2028-01-01T00:00:00.000Z',activeUntil:'2028-02-01T00:00:00.000Z'});
      assert.deepEqual((await call(route())).data,[created.data]); assert.deepEqual((await call(url)).data,created.data);
      assert.deepEqual(await evaluate(),[{resourceId:r1.id,start:new Date('2028-01-01T23:50Z'),end:new Date('2028-01-02T01:20Z'),ruleIds:[id]}]);
      assert.deepEqual(await evaluate({locationId:b.id}),[]); assert.deepEqual(await evaluate({start:'2028-01-10T00:00Z',end:'2028-01-10T01:00Z'}),[]);
    });
    await t.test('location locking protects even an empty rule set until caller commit',async()=>{
      await db.$transaction(async tx=>{
        assert.deepEqual(await evaluateLocationBookingRules(tx,{...booking,locationId:b.id}),[]);
        await assert.rejects(db.$queryRaw`SELECT id FROM "InventoryLocation" WHERE id=${b.id} FOR UPDATE NOWAIT`,(e:any)=>e.meta?.code==='55P03');
      },{isolationLevel:'ReadCommitted'});
    });
    await t.test('rejects malformed/cross-location writes, including FK-level races or direct resource moves',async()=>{
      for(const rid of [r3.id,randomUUID()]) {
        assert.equal((await call(route(),'POST',{...input,targetResourceIds:[rid]})).status,400);
        assert.equal((await call(url,'PUT',{...input,targetResourceIds:[rid],expectedVersion:1})).status,400);
      }
      assert.equal((await call(url,'PUT',{...input,expectedVersion:1,locationId:b.id})).status,400);
      assert.equal((await call(route(b.id)+'/'+id)).status,404);
      assert.equal((await call(route(b.id)+'/'+id,'DELETE',{expectedVersion:1})).status,404);
      await assert.rejects(db.bookingRuleTarget.create({data:{ruleId:id,resourceId:r3.id,locationId:a.id}}),(e:any)=>e.code==='P2003');
      await assert.rejects(db.physicalResource.update({where:{id:r1.id},data:{locationId:b.id}}),(e:any)=>e.code==='P2003');
      assert.deepEqual((await call(url)).data,created.data); assert.equal(await db.audit.count(),1);
    });
    await t.test('an audit failure rolls back create, target replacement and archive',async()=>{
      await db.$executeRaw`ALTER TABLE "Audit" ADD CONSTRAINT test_fail_audit CHECK (resource <> 'booking-rule') NOT VALID`;
      try {
        assert.equal((await call(route(),'POST',input)).status,500);
        assert.equal((await call(url,'PUT',{...input,targetResourceIds:[r2.id],expectedVersion:1})).status,500);
        assert.equal((await call(url,'DELETE',{expectedVersion:1})).status,500);
        assert.deepEqual((await call(route())).data,[created.data]); assert.equal(await db.bookingRuleTarget.count(),1);
      } finally {await db.$executeRaw`ALTER TABLE "Audit" DROP CONSTRAINT test_fail_audit`;}
    });
    await t.test('two concurrent edits with same version cannot both commit; soft delete retains audit',async()=>{
      const replacement={...input,activeFrom:undefined,activeUntil:undefined,excludedDates:undefined,targetResourceIds:[r2.id],expectedVersion:1};
      const results=await Promise.all([call(url,'PUT',replacement),call(url,'PUT',replacement)]);
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      const current=(await call(url)).data; assert.equal(current.version,2); assert.deepEqual(current.targetResourceIds,[r2.id]);
      assert.equal(current.activeFrom,undefined);assert.equal(current.activeUntil,undefined);assert.deepEqual(current.excludedDates,[]);
      assert.equal((await call(url,'DELETE',{expectedVersion:1})).status,409);
      assert.deepEqual((await call(url,'DELETE',{expectedVersion:2})).data,{id,locationId:a.id,version:3});
      assert.equal((await call(url)).status,404);assert.deepEqual((await call(route())).data,[]);assert.deepEqual(await evaluate(),[]);
      const archived=await db.bookingRuleConfig.findUniqueOrThrow({where:{id}});assert.ok(archived.archivedAt);assert.equal(archived.enabled,false);
      const audits=await db.audit.findMany({where:{resourceId:id,actorId:admin.id,resource:'booking-rule'}});
      assert.deepEqual(audits.map(x=>x.action).sort(),['CREATE','DELETE','UPDATE']);assert.equal(await db.audit.count(),3);
    });
  } finally {
    try {if(app) await app.close();} finally {
      if(oldDb===undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL=oldDb;
      if(oldSecret===undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET=oldSecret;
      docker('rm','-f',container);
    }
  }
});
