import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync,mkdtempSync,cpSync,rmSync,mkdirSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const backend=path.resolve(__dirname,'..'), dump=path.join(backend,'../backups/wsj-before-customer-accounts-20261111-082020.dump');
const target='20261120000000_inventory_line_windows';
// This never connects to the source of the archive. No original data is logged.
const enabled=process.env.INVENTORY_TEST_RESTORE==='1' && existsSync(dump);
test('restored copy upgrades through legacy inventory, backfills claim lines, preserves existing bookings',
  {skip:enabled?false:'requires local archive, cached postgres:17-alpine, INVENTORY_TEST_RESTORE=1',timeout:180000},async () => {
  const name=`wsj-inventory-restore-${randomUUID()}`, password=randomUUID();
  const docker=(...args:string[]) => execFileSync('docker',args,{encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe']}).trim();
  const container=docker('run','--pull=never','--detach','--rm','--name',name,'--tmpfs','/var/lib/postgresql/data',
    '-e',`POSTGRES_PASSWORD=${password}`,'-e','POSTGRES_DB=restore_test','-p','127.0.0.1::5432','postgres:17-alpine');
  let scratch:string|undefined;
  try {
    const port=/^127\.0\.0\.1:(\d+)$/.exec(docker('port',container,'5432/tcp'))?.[1]; assert.ok(port);
    const url=`postgresql://postgres:${password}@127.0.0.1:${port}/restore_test`;
    let ready=false;
    for(let i=0;i<60&&!ready;i++) {
      ready=spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-d','restore_test'],{stdio:'ignore',timeout:5000}).status===0;
      if(!ready) await delay(250);
    }
    assert.ok(ready);
    execFileSync('docker',['exec','-i',container,'pg_restore','--exit-on-error','--no-owner','--no-privileges','-U','postgres','-d','restore_test'],
      {input:readFileSync(dump),timeout:60000,stdio:['pipe','pipe','pipe']});
    const sql=(stmt:string) => docker('exec',container,'psql','-XAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','restore_test','-c',stmt);
    // Compare counts and a stable fingerprint of booking IDs without emitting them.
    const fingerprint=()=>sql(`SELECT count(*)::text || ':' || md5(coalesce(string_agg(id,',' ORDER BY id),'')) FROM "Booking"`);
    const before=fingerprint();
    const auditFingerprint=()=>sql(`SELECT count(*)::text || ':' || md5(coalesce(string_agg(id,',' ORDER BY id),'')) FROM "Audit"`);
    const auditBefore=auditFingerprint();
    assert.equal(sql(`SELECT count(*) FROM information_schema.columns WHERE table_name='Audit' AND column_name='details'`),'0');
    scratch=mkdtempSync(path.join(tmpdir(),'wsj-inventory-history-'));
    const prisma=path.join(backend,'prisma'), historical=path.join(scratch,'schema.prisma');
    cpSync(path.join(prisma,'schema.prisma'),historical); mkdirSync(path.join(scratch,'migrations'));
    for(const m of readdirSync(path.join(prisma,'migrations')).filter(m=>m<target||m==='migration_lock.toml')) {
      cpSync(path.join(prisma,'migrations',m),path.join(scratch,'migrations',m),{recursive:true});
    }
    const deploy=(schema:string)=>execFileSync(process.execPath,[path.join(backend,'node_modules/prisma/build/index.js'),'migrate','deploy','--schema',schema],
      {cwd:backend,env:{...process.env,DATABASE_URL:url},timeout:60000,stdio:'pipe'});
    deploy(historical);
    sql(`INSERT INTO "InventoryLocation" VALUES ('restore-site','restore','UTC');
      INSERT INTO "PhysicalResource"(id,"locationId",name,kind) VALUES ('r1','restore-site','one','room'),('r2','restore-site','two','room');
      INSERT INTO "InventoryClaim"(id,kind,state,"ownerRef","startsAt","endsAt","updatedAt") VALUES
      ('c1','CLOSURE','CONFIRMED','restore-check','2090-06-14 14:01:03.987+05:30','2090-06-14 15:30:00+05:30',now()),
      ('c2','CLOSURE','RELEASED','restore-check','2095-07-01 00:00:00.001-07','2095-07-01 00:00:00.002-07',now());
      INSERT INTO "InventoryClaimLine" VALUES ('c1','r1',1),('c1','r2',1),('c2','r1',1);`);
    const current=path.join(prisma,'schema.prisma'); deploy(current); deploy(current);
    assert.equal(sql(`SELECT count(*) FROM "InventoryClaimLine" l JOIN "InventoryClaim" c ON c.id=l."claimId"
      WHERE c."ownerRef"='restore-check' AND l."startsAt"=c."startsAt" AND l."endsAt"=c."endsAt"`),'3');
    // Historical lines carry no reliable exclusivity metadata: backfill all conservatively.
    assert.equal(sql(`SELECT count(*) FROM "InventoryClaimLine" l JOIN "InventoryClaim" c ON c.id=l."claimId"
      WHERE c."ownerRef"='restore-check' AND l.exclusive=true`),'3');
    assert.equal(fingerprint(),before);
    assert.equal(auditFingerprint(),auditBefore);
    assert.equal(sql(`SELECT count(*) FROM information_schema.columns WHERE table_name='Audit' AND column_name='details' AND data_type='jsonb' AND is_nullable='YES'`),'1');
    assert.equal(sql(`SELECT count(*) FROM _prisma_migrations WHERE migration_name='20261126000000_audit_details' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`),'1');
  } finally {
    try { if(scratch) rmSync(scratch,{recursive:true,force:true}); } finally { docker('rm','-f',container); }
  }
});
