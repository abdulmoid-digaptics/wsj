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
import {resolveReservationPlan} from '../src/resource-resolver';
import {AuthGuard,Db} from '../src/core';
import {ReservationPolicyAdminController,loadReservationPolicy,loadReservationPolicies,parseReservationPolicy} from '../src/reservation-policy-admin';

// Do not import the app module (timers/outbox/billing). Never accept a supplied DB URL.
@Module({controllers:[ReservationPolicyAdminController],providers:[Db,AuthGuard]}) class TestModule {}
test('dormant reservation policies: auth, constraints, atomic audit and ordered locks on disposable Postgres',{
  skip:process.env.INVENTORY_TEST_DOCKER==='1'?false:'set INVENTORY_TEST_DOCKER=1',timeout:180000,
},async t=>{
  const docker=(...args:string[])=>execFileSync('docker',args,{encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe']}).trim();
  const name='wsj-policy-admin-'+randomUUID(), password=randomUUID();
  const container=docker('run','--pull=never','--detach','--rm','--name',name,'--tmpfs','/var/lib/postgresql/data','-e',`POSTGRES_PASSWORD=${password}`,'-e','POSTGRES_DB=policy_test','-p','127.0.0.1::5432','postgres:16-alpine');
  const oldDb=process.env.DATABASE_URL,oldSecret=process.env.JWT_SECRET;
  let app:INestApplication|undefined;
  try {
    const port=/^127\.0\.0\.1:(\d+)$/.exec(docker('port',container,'5432/tcp'))?.[1]; assert.ok(port);
    let ready=false;
    for(let i=0;i<80&&!ready;i++) {
      ready=spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-d','policy_test'],{stdio:'ignore',timeout:5000}).status===0;
      if(!ready) await delay(250);
    }
    assert.ok(ready);
    process.env.DATABASE_URL=`postgresql://postgres:${password}@127.0.0.1:${port}/policy_test`;
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
    const [svc,other]=await Promise.all(['desk','meeting'].map(slug=>db.serviceCategory.create({data:{slug,name:slug}})));
    const catalog=await db.catalogPlan.create({data:{serviceId:svc.id,slug:'desk-plan',name:'desk',unitAmountCents:100}});
    const legacy=await db.plan.create({data:{serviceType:'unrelated-label',slug:'legacy',name:'legacy',unitAmount:100}});
    const [one,two,foreign,inactive,unmapped]=await Promise.all([a,a,b,a,a].map((loc,i)=>db.physicalResource.create({data:{name:'r'+i,locationId:loc.id,kind:'room',capacity:3,active:i!==3}})));
    await db.resourceServiceMapping.createMany({data:[one,two,foreign,inactive].flatMap(r=>[svc,other].map(s=>({resourceId:r.id,serviceId:s.id})))});
    const route=(loc=a.id)=>`/admin/inventory/locations/${loc}/reservation-policies`;
    const input={serviceId:svc.id,catalogPlanId:catalog.id,enabled:true,durationMinutes:35,requirements:[{resourceId:one.id,units:2}]};
    const ref={serviceId:svc.id,catalogPlanId:catalog.id,locationId:a.id};
    const legacyInput={serviceId:svc.id,legacyPlanId:legacy.id,enabled:true,durationMinutes:90,requirements:[{resourceId:foreign.id,units:1}]};
    const legacyRef={serviceId:svc.id,legacyPlanId:legacy.id,locationId:b.id};
    const load=()=>db.$transaction(tx=>loadReservationPolicy(tx,ref),{isolationLevel:'ReadCommitted'});
    await t.test('all endpoints require a live ADMIN identity',async()=>{
      for(const [method,suffix] of [['GET',''],['POST',''],['GET','/x'],['PUT','/x'],['DELETE','/x']]) {
        for(const [who,status] of [[null,401],[token(viewer),403],[token(editor),403]] as const)
          assert.equal((await call(route()+suffix,method,method==='GET'?undefined:input,who)).status,status);
      }
      assert.equal(await db.audit.count(),0);
    });
    await t.test('rejects malformed, guessed, wrong-service, cross-location and inactive requirements',async()=>{
      for (const changes of [{enabled:'yes'},{durationMinutes:0},{durationMinutes:10081},{legacyPlanId:legacy.id},{catalogPlanId:null},{expectedVersion:1},{serviceKey:'desk'},{serviceId:other.id},{requirements:[]},{requirements:[...input.requirements,...input.requirements]},...([foreign,inactive,unmapped].map(r=>({requirements:[{resourceId:r.id,units:1}]}))),{requirements:[{resourceId:one.id,units:0}]},{requirements:[{resourceId:one.id,units:4}]}]) {
        assert.equal((await call(route(),'POST',{...input,...changes})).status,400);
      }
      assert.equal(await db.reservationPolicyConfig.count(),0);
      assert.equal(await db.audit.count(),0);
    });
    const created=await call(route(),'POST',input);assert.equal(created.status,201);
    const id=created.data.id,url=route()+'/'+id;
    assert.equal((await call(route(),'POST',input)).status,409);
    assert.deepEqual((await call(route())).data,[created.data]);assert.deepEqual((await call(url)).data,created.data);
    assert.equal((await call(route(b.id)+'/'+id)).status,404);
    await t.test('DB rejects XOR violations, changing plan service, unmapping a required resource and duplicates',async()=>{
      for (const [cat,leg] of [[null,null],[catalog.id,legacy.id]]) {
        await assert.rejects(db.$executeRaw`INSERT INTO "ReservationPolicyConfig" (id,"serviceId","locationId","catalogPlanId","legacyPlanId","durationMinutes",enabled) VALUES (${randomUUID()},${svc.id},${b.id},${cat},${leg},10,true)`,(e:any)=>e.meta?.code==='23514');
      }
      await assert.rejects(db.catalogPlan.update({where:{id:catalog.id},data:{serviceId:other.id}}),(e:any)=>e.code==='P2003');
      await assert.rejects(db.resourceServiceMapping.delete({where:{resourceId_serviceId:{resourceId:one.id,serviceId:svc.id}}}),(e:any)=>e.code==='P2003');
      await assert.rejects(db.reservationPolicyRequirement.create({data:{policyId:id,locationId:a.id,serviceId:svc.id,...input.requirements[0]}}),(e:any)=>e.code==='P2002');
    });
    await t.test('legacy mapping is explicit, global, transactional and cannot be overridden at another location',async()=>{
      const legacyResult=await call(route(b.id),'POST',legacyInput);assert.equal(legacyResult.status,201);
      assert.equal((await db.legacyReservationService.findUniqueOrThrow({where:{planId:legacy.id}})).serviceId,svc.id);
      const wrong={...legacyInput,serviceId:other.id,requirements:input.requirements};
      assert.equal((await call(route(),'POST',wrong)).status,400);
      assert.equal((await call(route(),'POST',{...wrong,legacyPlanId:'static-label'})).status,400);
      await db.$transaction(async tx=>{const p=await loadReservationPolicy(tx,legacyRef);assert.equal(p.policy.serviceKey,svc.slug);assert.equal(p.policy.durationMinutes,90);});
    });
    await t.test('trusted output feeds resolver; rule-only exclusive room and policy locks held through caller commit',async()=>{
      const rule=await db.bookingRuleConfig.create({data:{locationId:a.id,enabled:true,priority:2,condition:{field:'serviceKey',op:'eq',value:svc.slug},beforeMinutes:5,afterMinutes:15}});
      await db.bookingRuleTarget.create({data:{ruleId:rule.id,locationId:a.id,resourceId:two.id}});
      await assert.rejects(loadReservationPolicy(db,ref),/interactive transaction/);
      await assert.rejects(db.$transaction(tx=>loadReservationPolicy(tx,ref),{isolationLevel:'RepeatableRead'}),/READ COMMITTED/);
      await assert.rejects(db.$transaction(tx=>loadReservationPolicy(tx,{...ref,requirements:input.requirements} as any)),/Unexpected/);
      await db.$transaction(async tx=>{
        const [p]=await loadReservationPolicies(tx,[ref,legacyRef]);
        const result=resolveReservationPlan({...p,startAt:'2099-01-01T10:00:00Z'});
        assert.equal(result.item.resources[0].units,2);assert.equal(result.item.ruleResources?.[0].units,3);
        assert.equal(new Date(result.item.endsAt).toISOString(),'2099-01-01T10:35:00.000Z');
        for (const loc of [a,b]) await assert.rejects(db.$queryRaw`SELECT id FROM "InventoryLocation" WHERE id=${loc.id} FOR UPDATE NOWAIT`,(e:any)=>e.meta?.code==='55P03');
        for (const r of [one,two,foreign]) await assert.rejects(db.$queryRaw`SELECT id FROM "PhysicalResource" WHERE id=${r.id} FOR UPDATE NOWAIT`,(e:any)=>e.meta?.code==='55P03');
      },{isolationLevel:'ReadCommitted'});
      const waits=await Promise.all([[ref,legacyRef],[legacyRef,ref]].map(refs=>db.$transaction(tx=>loadReservationPolicies(tx,refs),{isolationLevel:'ReadCommitted'})));
      assert.deepEqual(waits.map(v=>v.map(x=>x.policy.durationMinutes)),[[35,90],[90,35]]);
      assert.equal(await db.inventoryClaim.count(),0);
    });
    await t.test('an actual admin replacement waits until the checkout reader commits',async()=>{
      let writer:ReturnType<typeof call>|undefined;
      try {
        await db.$transaction(async tx=>{
          const [{pid}]=await tx.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`;
          const loaded=await loadReservationPolicy(tx,legacyRef);
          writer=call(route(b.id)+'/'+loaded.policyId,'PUT',{...legacyInput,durationMinutes:91,expectedVersion:1});
          let waiting=false;
          for(let i=0;i<100 && !waiting;i++) {
            const [r]=await db.$queryRaw<{waiting:boolean}[]>`SELECT EXISTS(SELECT FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS waiting`;
            waiting=r.waiting;if(!waiting) await delay(10);
          }
          assert.ok(waiting,'admin writer must block, not commit between policy read and claim');
          assert.equal((await tx.reservationPolicyConfig.findUniqueOrThrow({where:{id:loaded.policyId}})).version,1);
        },{isolationLevel:'ReadCommitted'});
      } finally {if(writer) assert.equal((await writer).status,200);}
      assert.equal((await db.$transaction(tx=>loadReservationPolicy(tx,legacyRef))).policy.durationMinutes,91);
    });
    await t.test('audit failure rolls back update, archive and legacy binding creation',async()=>{
      const spare=await db.plan.create({data:{name:'spare',slug:'spare',serviceType:'x',unitAmount:1}});
      await db.$executeRaw`ALTER TABLE "Audit" ADD CONSTRAINT fail_policy_audit CHECK (resource <> 'reservation-policy') NOT VALID`;
      try {
        assert.equal((await call(url,'PUT',{...input,requirements:[{resourceId:two.id,units:1}],expectedVersion:1})).status,500);
        assert.equal((await call(url,'DELETE',{expectedVersion:1})).status,500);
        assert.equal((await call(route(b.id),'POST',{...legacyInput,legacyPlanId:spare.id})).status,500);
        assert.equal(await db.legacyReservationService.count({where:{planId:spare.id}}),0);
        assert.deepEqual((await call(url)).data,created.data);
      } finally {await db.$executeRaw`ALTER TABLE "Audit" DROP CONSTRAINT fail_policy_audit`;}
    });
    await t.test('concurrent writes use optimistic version; disabled/archived fail closed; archive retains lines',async()=>{
      const writers=await Promise.all([45,60].map(durationMinutes=>call(url,'PUT',{...input,enabled:false,durationMinutes,expectedVersion:1})));
      assert.deepEqual(writers.map(w=>w.status).sort(),[200,409]);
      await assert.rejects(load(),/No enabled/);
      assert.equal((await call(route(),'POST',input)).status,409);
      assert.equal((await call(url,'DELETE',{expectedVersion:1})).status,409);
      assert.equal((await call(url,'DELETE',{expectedVersion:2})).status,200);
      assert.equal((await call(url)).status,404);await assert.rejects(load(),/No enabled/);
      const old=await db.reservationPolicyConfig.findUniqueOrThrow({where:{id},include:{requirements:true}});
      assert.ok(old.archivedAt);assert.equal(old.version,3);assert.equal(old.requirements.length,1);
      assert.deepEqual((await db.audit.findMany({where:{resource:'reservation-policy',resourceId:id,actorId:admin.id}})).map(r=>r.action).sort(),['ARCHIVE','CREATE','UPDATE']);
      assert.equal((await call(route(),'POST',input)).status,201);
      await db.physicalResource.update({where:{id:one.id},data:{active:false}});await assert.rejects(load(),/Required resource unavailable/);
    });
  } finally {
    try {if(app) await app.close();} finally {
      if(oldDb===undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL=oldDb;
      if(oldSecret===undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET=oldSecret;
      docker('rm','-f',container);
    }
  }
});

test('strict JSON contract rejects partial scopes, invalid scalars and unknown nested fields',()=>{
 const data={catalogPlanId:'p',serviceId:'s',enabled:false,durationMinutes:1,requirements:[{resourceId:'r',units:1}]};
 for(const body of [null,{}, {...data,catalogPlanId:undefined},{...data,expectedVersion:1},{...data,durationMinutes:1.1},{...data,requirements:[{resourceId:'r',units:'1'}]},{...data,requirements:[{...data.requirements[0],capacity:2}]},{...data,requirements:Array(65).fill(data.requirements[0])}]) assert.throws(()=>parseReservationPolicy(body));
 assert.throws(()=>parseReservationPolicy(data,true));assert.equal(parseReservationPolicy({...data,expectedVersion:2},true).expectedVersion,2);
});
