import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// Explicit opt-in and hard-coded source identity: pg_dump reads the local development
// database only. The archive stays in memory and is restored into a tmpfs container.
test('fresh local database copy has a consistent exclusive migration',
  {skip:process.env.INVENTORY_TEST_CURRENT_RESTORE==='1' ? false : 'requires explicit local restore opt-in',timeout:180000},async () => {
  const name=`wsj-current-restore-${randomUUID()}`, password=randomUUID();
  const docker=(...args:string[])=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']}).trim();
  // Refuse unexpected container configuration rather than connecting elsewhere.
  assert.equal(docker('exec','wsj-postgres-1','sh','-c','printf "%s:%s" "$POSTGRES_DB" "$POSTGRES_USER"'),'wsj:wsj');
  const archive=execFileSync('docker',['exec','wsj-postgres-1','pg_dump','-U','wsj','-Fc','wsj'],{timeout:60000,maxBuffer:256*1024*1024,stdio:['ignore','pipe','pipe']});
  const container=docker('run','--pull=never','--detach','--rm','--name',name,'--tmpfs','/var/lib/postgresql/data',
    '-e',`POSTGRES_PASSWORD=${password}`,'-e','POSTGRES_DB=restore_test','postgres:17-alpine');
  try {
    let ready=false;
    for(let i=0;i<60&&!ready;i++) {
      ready=spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-d','restore_test'],{stdio:'ignore',timeout:5000}).status===0;
      if(!ready) await delay(250);
    }
    assert.ok(ready);
    execFileSync('docker',['exec','-i',container,'pg_restore','--exit-on-error','--no-owner','--no-privileges','-U','postgres','-d','restore_test'],
      {input:archive,timeout:60000,stdio:['pipe','pipe','pipe']});
    const sql=(stmt:string)=>docker('exec',container,'psql','-XAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','restore_test','-c',stmt);
    assert.equal(sql(`SELECT count(*) FROM information_schema.columns WHERE table_name='InventoryClaimLine' AND column_name='exclusive' AND is_nullable='NO'`),'1');
    const migration=readFileSync(path.resolve(__dirname,'../prisma/migrations/20261122000000_inventory_exclusive_claims/migration.sql'));
    const checksum=createHash('sha256').update(migration).digest('hex');
    assert.equal(sql(`SELECT checksum FROM _prisma_migrations WHERE migration_name='20261122000000_inventory_exclusive_claims' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`),checksum);
    assert.equal(sql('SELECT count(*) FROM "InventoryClaimLine" WHERE exclusive IS NULL'),'0');
    // Exercise the restored schema without printing any customer data.
    assert.match(sql('SELECT count(*) FROM "Booking"'),/^\d+$/);
    assert.match(sql('SELECT count(*) FROM "InventoryClaimLine"'),/^\d+$/);
  } finally { docker('rm','-f',container); }
});
