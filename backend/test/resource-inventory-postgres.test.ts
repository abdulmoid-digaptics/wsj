import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {PrismaClient} from '@prisma/client';
import {ResourceInventory, InventoryError} from '../src/resource-inventory';

// Explicit opt-in. Never accept DATABASE_URL or a caller-supplied test server.
// Uses a cached image, a fresh tmpfs database, and a random loopback port.
const enabled = process.env.INVENTORY_TEST_DOCKER === '1';
test('resource inventory on isolated PostgreSQL', {skip:enabled ? false : 'set INVENTORY_TEST_DOCKER=1 with postgres:16-alpine cached', timeout:180000}, async t => {
  const name = `wsj-inventory-test-${randomUUID()}`, password = randomUUID();
  const docker = (...args:string[]) => execFileSync('docker',args,{encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe']}).trim();
  const container = docker('run','--pull=never','--detach','--rm','--name',name,'--tmpfs','/var/lib/postgresql/data','-e',`POSTGRES_PASSWORD=${password}`,'-e','POSTGRES_DB=inventory_test','-p','127.0.0.1::5432','postgres:16-alpine');
  let db:PrismaClient | undefined;
  try {
    const port = /^127\.0\.0\.1:(\d+)$/.exec(docker('port',container,'5432/tcp'))?.[1];
    assert.ok(port,'Expected loopback-only disposable port');
    const url = `postgresql://postgres:${password}@127.0.0.1:${port}/inventory_test?connection_limit=16`;
    let ready = false;
    for (let i=0; i<50 && !ready; i++) {
      ready = spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-d','inventory_test'],{stdio:'ignore',timeout:5000}).status === 0;
      if (!ready) await delay(250);
    }
    assert.ok(ready,'Disposable Postgres did not start');
    const backend = path.resolve(__dirname,'..');
    execFileSync(process.execPath,[path.join(backend,'node_modules/prisma/build/index.js'),'migrate','deploy','--schema',path.join(backend,'prisma/schema.prisma')],{cwd:backend,env:{...process.env,DATABASE_URL:url},timeout:60000,stdio:'pipe'});
    db = new PrismaClient({datasourceUrl:url}); const client = db, inv = new ResourceInventory(client);
    const loc = await client.inventoryLocation.create({data:{name:'Site',timeZone:'UTC'}});
    const svc = async (slug:string) => client.serviceCategory.create({data:{slug,name:slug}});
    const s = await svc('desk'), other = await svc('office');
    const resource = async (capacity:number) => client.physicalResource.create({data:{name:randomUUID(),locationId:loc.id,kind:'workspace',capacity,mappings:{create:[{serviceId:s.id},{serviceId:other.id}]}}});
    const at = (h:number) => new Date(Date.UTC(2090,0,1,h));
    const request = (ids:string[], units=1, lo=10, hi=12) => ({locationId:loc.id,serviceId:s.id,resources:ids.map(resourceId => ({resourceId,units})),startsAt:at(lo),endsAt:at(hi),ownerRef:randomUUID()});
    const assertRace = <T>(result:PromiseSettledResult<T>[], expected:number) => {
      assert.equal(result.filter(r => r.status === 'fulfilled').length,expected,JSON.stringify(result));
      for (const r of result) if (r.status === 'rejected') assert.ok(r.reason instanceof InventoryError && r.reason.code === 'UNAVAILABLE',String(r.reason));
    };
    await t.test('contending holds across services stop at physical capacity', async () => {
      const r = await resource(3);
      const race = await Promise.allSettled(Array.from({length:12},(_,i) => inv.hold({...request([r.id]),serviceId:i%2 ? s.id : other.id,ttlSeconds:120})));
      assertRace(race,3);
      assert.equal((await inv.availability(request([r.id]))).available,false);
      assert.equal(await client.inventoryClaimLine.count({where:{resourceId:r.id}}),3);
    });
    await t.test('reverse-order multi-resource race has one whole winner and no partial loser', async () => {
      const a = await resource(1), b = await resource(1), spare = await resource(1);
      assertRace(await Promise.allSettled([inv.allocate(request([a.id,b.id])),inv.allocate(request([b.id,a.id]))]),1);
      await assert.rejects(inv.allocate(request([spare.id,a.id])),{code:'UNAVAILABLE'});
      assert.equal(await client.inventoryClaimLine.count({where:{resourceId:spare.id}}),0);
      assert.equal((await inv.availability(request([spare.id]))).available,true);
    });
    await t.test('peak capacity across disjoint intervals and adjacent boundaries',async () => {
      const r = await resource(2);
      await inv.allocate(request([r.id],1,10,11)); await inv.allocate(request([r.id],1,11,12));
      assert.equal((await inv.availability(request([r.id]))).resources[0].remainingUnits,1);
      await inv.allocate(request([r.id])); await assert.rejects(inv.allocate(request([r.id])),{code:'UNAVAILABLE'});
      assert.equal((await inv.availability(request([r.id],2,12,13))).available,true);
    });
    await t.test('a closure races atomically with a live allocation; release restores capacity',async () => {
      const r = await resource(4), base = request([r.id]), input = {...base,resourceIds:[r.id]};
      const race = await Promise.allSettled([inv.close(input),inv.allocate(base)]);
      assertRace(race,1);
      const winner = race.find(r => r.status === 'fulfilled')!;
      if (winner.status !== 'fulfilled') throw Error('missing winner');
      await inv.release(winner.value.id);
      const closure = await inv.close(input);
      assert.equal(closure.lines[0].units,4); await assert.rejects(inv.confirm(closure.id),{code:'INVALID_STATE'});
      assert.equal((await inv.availability(base)).available,false);
      await inv.release(closure.id); assert.equal((await inv.release(closure.id)).state,'RELEASED');
      assert.equal((await inv.availability(base)).resources[0].remainingUnits,4);
    });
    await t.test('confirmed holds retain capacity; release cannot resurrect a claim',async () => {
      const r = await resource(1), base = request([r.id]);
      const held = await inv.hold({...base,ttlSeconds:120}); await assert.rejects(inv.expire(held.id),{code:'INVALID_STATE'});
      assert.equal((await inv.confirm(held.id)).state,'CONFIRMED'); assert.equal((await inv.confirm(held.id)).expiresAt,null);
      await assert.rejects(inv.allocate(base),{code:'UNAVAILABLE'}); await inv.release(held.id);
      await assert.rejects(inv.confirm(held.id),{code:'INVALID_STATE'}); await inv.allocate(base);
    });
    await t.test('late confirmation queued behind a resource lock uses post-lock database time',async () => {
      const r = await resource(1), base = request([r.id]);
      const h = await inv.hold({...base,ttlSeconds:1});
      let queued!:Promise<void>;
      await client.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "PhysicalResource" WHERE id=${r.id} FOR UPDATE`;
        queued = assert.rejects(inv.confirm(h.id),{code:'HOLD_EXPIRED'});
        await delay(1200);
      });
      await queued; assert.equal((await inv.expire(h.id)).state,'EXPIRED');
      const h2 = await inv.hold({...base,ttlSeconds:1}); await delay(1200);
      await inv.allocate(base); // No sweep: expired HELD row is ignored.
      await assert.rejects(inv.confirm(h2.id),{code:'HOLD_EXPIRED'});
      assert.equal((await client.inventoryClaim.findUniqueOrThrow({where:{id:h2.id}})).state,'EXPIRED');
    });
    await t.test('reject unknown, unmapped, wrong-location and disabled resources; DB checks reject invalid units',async () => {
      const r = await resource(1), base = request([r.id]);
      await assert.rejects(inv.allocate(request(['missing'])),{code:'NOT_FOUND'});
      await assert.rejects(inv.allocate({...base,serviceId:(await svc('other')).id}),{code:'UNAVAILABLE'});
      await assert.rejects(inv.allocate({...base,locationId:'elsewhere'}),{code:'UNAVAILABLE'});
      await assert.rejects(client.physicalResource.update({where:{id:r.id},data:{capacity:0}}));
      const claim = await inv.allocate(base);
      await assert.rejects(client.inventoryClaimLine.update({where:{claimId_resourceId:{claimId:claim.id,resourceId:r.id}},data:{units:0}}));
      await client.physicalResource.update({where:{id:r.id},data:{active:false}});
      await assert.rejects(inv.availability(base),{code:'UNAVAILABLE'});
    });
  } finally {
    try { await db?.$disconnect(); } finally { docker('rm','-f',container); }
  }
});
