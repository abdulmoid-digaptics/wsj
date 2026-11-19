import { Prisma, PrismaClient } from '@prisma/client';

export type InventoryLine = { resourceId:string; units:number; startsAt?:Date; endsAt?:Date; exclusive?:boolean };
export type InventoryWindow = { locationId: string; startsAt: Date; endsAt: Date };
export type InventoryRequest = InventoryWindow & { serviceId: string; resources: InventoryLine[] };
// Rule lines are server-derived only, never a substitute for mapped physical resources.
export type InventoryBatchItem = InventoryRequest & {ruleResources?:InventoryLine[]};
export type InventoryBatch = {items:InventoryBatchItem[]; ownerRef:string};
export type InventoryHoldBatch = InventoryBatch & {ttlSeconds:number};
export type InventoryClosure = InventoryWindow & { resourceIds: string[]; ownerRef: string };
export type InventoryErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'UNAVAILABLE' | 'INVALID_STATE' | 'HOLD_EXPIRED';
export class InventoryError extends Error {
  constructor(readonly code: InventoryErrorCode, message: string) { super(message); this.name = 'InventoryError'; }
}
const fail = (code: InventoryErrorCode, message: string): never => { throw new InventoryError(code, message); };
function text(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v.trim() || v !== v.trim() || v.length > 256 || /[\x00-\x1f\x7f]/.test(v)) {
    throw new InventoryError('INVALID_INPUT', `Invalid ${name}`);
  }
  return v;
}
function instant(v: unknown): Date {
  if (!(v instanceof Date) || !Number.isFinite(v.getTime()) || v.getUTCFullYear() < 1 || v.getUTCFullYear() > 9999) {
    throw new InventoryError('INVALID_INPUT', 'Provide a valid absolute Date');
  }
  return new Date(v.getTime());
}
function windowOf(v: InventoryWindow) {
  const locationId = text(v?.locationId, 'locationId'), startsAt = instant(v?.startsAt), endsAt = instant(v?.endsAt);
  if (+startsAt >= +endsAt) fail('INVALID_INPUT', 'startsAt must precede endsAt');
  return { locationId, startsAt, endsAt };
}
type Tx = Prisma.TransactionClient;
type Line = {resourceId:string; units:number; startsAt:Date; endsAt:Date; rule:boolean; exclusive:boolean};
type Plan = InventoryWindow & {serviceId:string|null; resources:Line[]};
function linesOf(v: InventoryLine[], parent:InventoryWindow, rule=false):Line[] {
  if (!Array.isArray(v) || !v.length || v.length > 64) fail('INVALID_INPUT','Request 1 to 64 distinct resources');
  return Array.from(v,line => {
    const resourceId = text(line?.resourceId,'resourceId'), units = line.units;
    if (!Number.isInteger(units) || units < 1 || units > 2147483647 || (line.exclusive !== undefined && typeof line.exclusive !== 'boolean')) fail('INVALID_INPUT','Invalid resource quantity');
    const custom = line.startsAt !== undefined || line.endsAt !== undefined;
    const startsAt = custom ? instant(line.startsAt) : parent.startsAt, endsAt = custom ? instant(line.endsAt) : parent.endsAt;
    if (+startsAt >= +endsAt) fail('INVALID_INPUT','Invalid resource interval');
    return {resourceId,units,startsAt,endsAt,rule,exclusive:rule || line.exclusive===true};
  });
}
function distinct(lines:Line[]) {
  if (lines.length > 64 || new Set(lines.map(l => l.resourceId)).size !== lines.length) fail('INVALID_INPUT','Each item needs distinct resources');
  return lines;
}
function planOf(v:InventoryBatchItem, allowRules=false):Plan {
  const parent = windowOf(v), resources = linesOf(v.resources,parent);
  if (v.ruleResources !== undefined) {
    if (!allowRules || !Array.isArray(v.ruleResources)) fail('INVALID_INPUT','Invalid rule resources');
    if (v.ruleResources.length) resources.push(...linesOf(v.ruleResources,parent,true));
  }
  return {...parent,serviceId:text(v.serviceId,'serviceId'),resources:distinct(resources)};
}
function batchOf(v:InventoryBatch) {
  if (!Array.isArray(v?.items) || !v.items.length || v.items.length > 64) fail('INVALID_INPUT','Request 1 to 64 items');
  const plans = Array.from(v.items,i => planOf(i,true));
  if (plans.reduce((n,p) => n+p.resources.length,0)>512) fail('INVALID_INPUT','Maximum 512 resource lines per batch');
  return {plans,ownerRef:text(v.ownerRef,'ownerRef')};
}
function ttlOf(ttl:number) {
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 86400) fail('INVALID_INPUT','ttlSeconds must be 1 to 86400');
  return ttl;
}
async function requireTx(tx:Tx) {
  if (!tx || '$transaction' in tx) fail('INVALID_STATE','An interactive transaction is required');
  const [row] = await tx.$queryRaw<{level:string}[]>`SELECT current_setting('transaction_isolation') AS level`;
  if (row.level !== 'read committed') fail('INVALID_STATE','Inventory requires READ COMMITTED');
}
async function lock(tx: Tx, ids: string[]) {
  // All claim writers lock physical rows, not service mappings. This must be a
  // separate statement from the occupancy read: READ COMMITTED takes a fresh
  // snapshot after a competing writer commits and releases its locks.
  const rows = await tx.$queryRaw<{id:string; capacity:number; locationId:string; active:boolean}[]>`
    SELECT id, capacity, "locationId", active FROM "PhysicalResource"
    WHERE id IN (${Prisma.join(ids)}) ORDER BY id COLLATE "C" FOR UPDATE`;
  if (rows.length !== ids.length) fail('NOT_FOUND', 'Unknown physical resource');
  return rows;
}
async function clock(tx: Tx) {
  const [row] = await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
  return row.now;
}
async function inspect(tx:Tx, plans:Plan[]) {
  const ids = [...new Set(plans.flatMap(p => p.resources.map(l => l.resourceId)))];
  const rows = await lock(tx,ids), byId = new Map(rows.map(r => [r.id,r]));
  for (const p of plans) {
    for (const l of p.resources) {
      const r = byId.get(l.resourceId)!;
      if (r.locationId !== p.locationId || (p.serviceId !== null && (!r.active))) {
        fail('UNAVAILABLE','Resource inactive, or outside requested location');
      }
    }
    if (p.serviceId !== null) {
      const mapped = p.resources.filter(l => !l.rule).map(l => l.resourceId);
      const maps = await tx.$queryRaw<{resourceId:string}[]>`
        SELECT m."resourceId" FROM "ResourceServiceMapping" m JOIN "ServiceCategory" s ON s.id=m."serviceId"
        WHERE m."resourceId" IN (${Prisma.join(mapped)}) AND s.id=${p.serviceId} AND s.active AND s."archivedAt" IS NULL
        ORDER BY m."resourceId" COLLATE "C" FOR SHARE OF m,s`;
      if (maps.length !== mapped.length) fail('UNAVAILABLE','Missing active service mapping');
    }
  }
  const now = await clock(tx);
  if (plans.some(p => +p.endsAt <= +now || p.resources.some(l => +l.endsAt <= +now))) fail('INVALID_INPUT','Requested interval has ended');
  const lines = plans.flatMap(p => p.resources.map(l => Prisma.sql`(${l.resourceId}::text,${l.startsAt}::timestamptz,${l.endsAt}::timestamptz,${p.serviceId === null || l.exclusive ? byId.get(l.resourceId)!.capacity : l.units}::int)`));
  // EXISTS prevents counting an occupied line twice when several items overlap it.
  // Group simultaneous endpoints before the sweep; ignore gaps with no demand.
  const peaks = await tx.$queryRaw<{id:string; peak:bigint; total:bigint}[]>`
    WITH wanted(id,lo,hi,qty) AS (VALUES ${Prisma.join(lines)}), occupied AS (
      SELECT l."resourceId" AS id, l."startsAt" AS lo, l."endsAt" AS hi,
        CASE WHEN c.kind='CLOSURE' THEN r.capacity ELSE l.units END AS qty
      FROM "InventoryClaimLine" l JOIN "InventoryClaim" c ON c.id=l."claimId" JOIN "PhysicalResource" r ON r.id=l."resourceId"
      WHERE (c.state='CONFIRMED' OR (c.state='HELD' AND c."expiresAt" > ${now}))
        AND EXISTS (SELECT 1 FROM wanted w WHERE w.id=l."resourceId" AND w.lo<l."endsAt" AND w.hi>l."startsAt")
    ), events(id,t,existing,proposed) AS (
      SELECT id,lo,qty,0 FROM occupied UNION ALL SELECT id,hi,-qty,0 FROM occupied UNION ALL
      SELECT id,lo,0,qty FROM wanted UNION ALL SELECT id,hi,0,-qty FROM wanted
    ), usage AS (
      SELECT id,sum(sum(existing)) OVER win AS used,sum(sum(proposed)) OVER win AS demand
      FROM events GROUP BY id,t WINDOW win AS (PARTITION BY id ORDER BY t)
    ) SELECT id,max(used)::bigint AS peak,max(used+demand)::bigint AS total FROM usage WHERE demand>0 GROUP BY id`;
  const peak = new Map(peaks.map(r => [r.id,r]));
  const available = rows.every(r => peak.get(r.id)!.total <= BigInt(r.capacity));
  return {available,rows,byId,peak,now};
}
const include = { lines: {orderBy:{resourceId:'asc'}} } as const;
/** Standalone atomic writer. Claim membership, units, resource location and intervals are immutable.
 * Do not write claims or reduce a live resource's capacity outside this locking protocol.
 * Caller owns authorization, trusted ownerRef, replay protection and commercial lifecycle. */
export class ResourceInventory {
  constructor(private readonly db: PrismaClient) {}
  private run<T>(fn: (tx: Tx) => Promise<T>) {
    return this.db.$transaction(fn, { isolationLevel:'ReadCommitted', maxWait:10000, timeout:15000 });
  }
  async availability(input:InventoryRequest) {
    const p = planOf(input);
    return this.run(async tx => {
      const {available,rows,peak,now} = await inspect(tx,[p]);
      const resources = rows.map(r => {const line=p.resources.find(l => l.resourceId===r.id)!;return {resourceId:r.id,capacity:r.capacity,requestedUnits:line.exclusive?r.capacity:line.units,
        remainingUnits:Math.max(0,r.capacity-Number(peak.get(r.id)!.peak))};});
      return {available,resources,checkedAt:now};
    });
  }
  async hold(input:InventoryRequest & {ownerRef:string; ttlSeconds:number}) {
    const p = planOf(input), ownerRef = text(input.ownerRef,'ownerRef'), ttl = ttlOf(input.ttlSeconds);
    return (await this.run(tx => this.create(tx,[p],ownerRef,ttl)))[0];
  }
  async allocate(input:InventoryRequest & {ownerRef:string}) {
    const p = planOf(input), ownerRef = text(input.ownerRef,'ownerRef');
    return (await this.run(tx => this.create(tx,[p],ownerRef,null)))[0];
  }
  async close(input:InventoryClosure) {
    const p = windowOf(input), ownerRef = text(input.ownerRef,'ownerRef');
    if (!Array.isArray(input.resourceIds) || input.resourceIds.length > 64) fail('INVALID_INPUT','Invalid closure resource list');
    const resources = distinct(linesOf(input.resourceIds.map(resourceId => ({resourceId,units:1})),p));
    return (await this.run(tx => this.create(tx,[{...p,serviceId:null,resources}],ownerRef,null)))[0];
  }
  async holdBatch(input:InventoryHoldBatch) {
    const {plans,ownerRef} = batchOf(input), ttl = ttlOf(input.ttlSeconds);
    return this.run(tx => this.create(tx,plans,ownerRef,ttl));
  }
  async allocateBatch(input:InventoryBatch) {
    const {plans,ownerRef} = batchOf(input);
    return this.run(tx => this.create(tx,plans,ownerRef,null));
  }
  /** Caller must use an interactive READ COMMITTED transaction, one inventory operation per
   * transaction, never pre-lock inventory rows in another order, and propagate failures.
   * Only pass server-derived ruleResources from validated persisted rules: they may lock
   * active location resources without service mappings. Authorization belongs to caller. */
  async holdBatchInTransaction(tx:Tx,input:InventoryHoldBatch) {
    const {plans,ownerRef} = batchOf(input), ttl = ttlOf(input.ttlSeconds);
    await requireTx(tx); return this.create(tx,plans,ownerRef,ttl);
  }
  async allocateBatchInTransaction(tx:Tx,input:InventoryBatch) {
    const {plans,ownerRef} = batchOf(input);
    await requireTx(tx); return this.create(tx,plans,ownerRef,null);
  }
  private async create(tx:Tx,plans:Plan[],ownerRef:string,ttl:number|null) {
    const {available,byId,now} = await inspect(tx,plans);
    if (!available) fail('UNAVAILABLE','Insufficient physical capacity during a requested interval');
    const expiresAt = ttl === null ? null : new Date(Math.min(+now+ttl*1000,...plans.map(p => +p.endsAt)));
    const claims = [];
    for (const p of plans) {
      claims.push(await tx.inventoryClaim.create({data:{kind:p.serviceId === null ? 'CLOSURE' : 'ALLOCATION',state:ttl===null?'CONFIRMED':'HELD',
        serviceId:p.serviceId,ownerRef,startsAt:p.startsAt,endsAt:p.endsAt,createdAt:now,updatedAt:now,expiresAt,
        lines:{create:p.resources.map(l => ({resourceId:l.resourceId,startsAt:l.startsAt,endsAt:l.endsAt,
          units:p.serviceId===null || l.exclusive ? byId.get(l.resourceId)!.capacity : l.units}))}},include}));
    }
    return claims;
  }
  async confirmBatchInTransaction(tx:Tx,claimIds:string[]) { return this.batchTransition(tx,claimIds,'confirm'); }
  async releaseBatchInTransaction(tx:Tx,claimIds:string[]) { return this.batchTransition(tx,claimIds,'release'); }
  private async batchTransition(tx:Tx,claimIds:string[],op:'confirm'|'release') {
    if (!Array.isArray(claimIds) || !claimIds.length || claimIds.length>64) fail('INVALID_INPUT','Select 1 to 64 claims');
    const ids = Array.from(claimIds,id => text(id,'claimId'));
    if (new Set(ids).size!==ids.length) fail('INVALID_INPUT','Duplicate claim id');
    await requireTx(tx);
    const lines = await tx.inventoryClaimLine.findMany({where:{claimId:{in:ids}},select:{claimId:true,resourceId:true}});
    if (new Set(lines.map(l => l.claimId)).size!==ids.length) fail('NOT_FOUND','Unknown claim');
    await lock(tx,[...new Set(lines.map(l => l.resourceId))]);
    const claims = await tx.inventoryClaim.findMany({where:{id:{in:ids}},include});
    const byId = new Map(claims.map(c => [c.id,c])), now = await clock(tx);
    const elapsed = (c:typeof claims[number]) => c.state==='EXPIRED' || (c.state==='HELD' && c.expiresAt!==null && +c.expiresAt<=+now);
    if (op==='confirm') {
      if (claims.some(elapsed)) fail('HOLD_EXPIRED','A hold expired before confirmation');
      if (claims.some(c => c.kind!=='ALLOCATION' || c.state==='RELEASED')) fail('INVALID_STATE','Claim cannot be confirmed');
    }
    const result = [];
    for (const id of ids) {
      const c = byId.get(id)!;
      const state = elapsed(c) ? 'EXPIRED' : op==='confirm' ? 'CONFIRMED' : 'RELEASED';
      result.push(c.state===state ? c : await tx.inventoryClaim.update({where:{id},data:{state,expiresAt:state==='EXPIRED'?c.expiresAt:null,updatedAt:now},include}));
    }
    return result;
  }
  async confirm(claimId:string) { return this.transition(claimId,'confirm'); }
  async release(claimId:string) { return this.transition(claimId,'release'); }
  async expire(claimId:string) { return this.transition(claimId,'expire'); }
  private async transition(value:string, op:'confirm'|'release'|'expire') {
    const id = text(value,'claimId');
    const result = await this.run(async tx => {
      // Lines are immutable. Read them to discover the canonical lock set, then
      // re-read the mutable state after the lock (a contender may have won).
      const lines = await tx.inventoryClaimLine.findMany({where:{claimId:id},select:{resourceId:true}});
      if (!lines.length) fail('NOT_FOUND','Claim not found');
      await lock(tx,lines.map(l => l.resourceId));
      const claim = await tx.inventoryClaim.findUniqueOrThrow({where:{id}, include});
      const now = await clock(tx);
      if (claim.state === 'HELD' && claim.expiresAt && +claim.expiresAt <= +now) {
        return tx.inventoryClaim.update({where:{id},data:{state:'EXPIRED'},include});
      }
      if (claim.state === 'EXPIRED') return claim;
      if (op === 'expire') return fail('INVALID_STATE','Only an elapsed hold can expire');
      if (op === 'release') {
        if (claim.state === 'RELEASED') return claim;
        return tx.inventoryClaim.update({where:{id},data:{state:'RELEASED',expiresAt:null},include});
      }
      if (claim.kind !== 'ALLOCATION' || claim.state === 'RELEASED') return fail('INVALID_STATE','Claim cannot be confirmed');
      if (claim.state === 'CONFIRMED') return claim;
      return tx.inventoryClaim.update({where:{id},data:{state:'CONFIRMED',expiresAt:null},include});
    });
    // Throw only AFTER commit so lazy expiry is durable even on late confirmation.
    if (op === 'confirm' && result.state === 'EXPIRED') fail('HOLD_EXPIRED','Hold expired before confirmation');
    return result;
  }
}
