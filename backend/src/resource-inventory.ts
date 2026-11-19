import { Prisma, PrismaClient } from '@prisma/client';

export type InventoryLine = { resourceId: string; units: number };
export type InventoryWindow = { locationId: string; startsAt: Date; endsAt: Date };
export type InventoryRequest = InventoryWindow & { serviceId: string; resources: InventoryLine[] };
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
function linesOf(v: InventoryLine[]) {
  if (!Array.isArray(v) || !v.length || v.length > 64) fail('INVALID_INPUT', 'Request 1 to 64 distinct resources');
  const seen = new Set<string>();
  return Array.from(v, line => {
    const resourceId = text(line?.resourceId, 'resourceId'), units = line?.units;
    if (!Number.isInteger(units) || units < 1 || units > 2147483647 || seen.has(resourceId)) {
      fail('INVALID_INPUT', 'Each resource needs one positive integer quantity');
    }
    seen.add(resourceId); return {resourceId, units};
  });
}
type Tx = Prisma.TransactionClient;
type Plan = InventoryWindow & { serviceId: string | null; resources: InventoryLine[] };
function planOf(v: InventoryRequest): Plan {
  return {...windowOf(v), serviceId: text(v?.serviceId, 'serviceId'), resources: linesOf(v?.resources)};
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
async function inspect(tx: Tx, p: Plan) {
  const ids = p.resources.map(l => l.resourceId), rows = await lock(tx, ids);
  if (rows.some(r => r.locationId !== p.locationId || (p.serviceId !== null && !r.active))) {
    fail('UNAVAILABLE', 'Resource inactive or outside requested location');
  }
  if (p.serviceId !== null) {
    // Keep the selected mappings and their service valid until the claim commits.
    const maps = await tx.$queryRaw<{resourceId:string}[]>`
      SELECT m."resourceId" FROM "ResourceServiceMapping" m JOIN "ServiceCategory" s ON s.id=m."serviceId"
      WHERE m."resourceId" IN (${Prisma.join(ids)}) AND s.id=${p.serviceId} AND s.active AND s."archivedAt" IS NULL
      ORDER BY m."resourceId" COLLATE "C" FOR SHARE OF m,s`;
    if (maps.length !== ids.length) fail('UNAVAILABLE', 'No active service mapping for every requested resource');
  }
  const now = await clock(tx);
  if (+p.endsAt <= +now) fail('INVALID_INPUT', 'Requested interval has ended');
  // Compute PEAK simultaneous use, not the sum of all intersecting bookings.
  // Group coincident events first for exact half-open [start,end) semantics.
  const peaks = await tx.$queryRaw<{resourceId:string; peak:bigint}[]>`
    WITH occupied AS (
      SELECT l."resourceId", CASE WHEN c.kind='CLOSURE' THEN r.capacity ELSE l.units END AS units,
        greatest(c."startsAt", ${p.startsAt}) AS lo, least(c."endsAt", ${p.endsAt}) AS hi
      FROM "InventoryClaimLine" l JOIN "InventoryClaim" c ON c.id=l."claimId"
      JOIN "PhysicalResource" r ON r.id=l."resourceId"
      WHERE l."resourceId" IN (${Prisma.join(ids)}) AND c."startsAt" < ${p.endsAt} AND c."endsAt" > ${p.startsAt}
      AND (c.state='CONFIRMED' OR (c.state='HELD' AND c."expiresAt" > ${now}))
    ), events AS (
      SELECT "resourceId", lo AS t, units AS delta FROM occupied UNION ALL
      SELECT "resourceId", hi AS t, -units AS delta FROM occupied
    ), usage AS (
      SELECT "resourceId", sum(sum(delta)) OVER (PARTITION BY "resourceId" ORDER BY t) AS used
      FROM events GROUP BY "resourceId", t
    ) SELECT "resourceId", max(used)::bigint AS peak FROM usage GROUP BY "resourceId"`;
  const peak = new Map(peaks.map(r => [r.resourceId, Number(r.peak)]));
  const wanted = new Map(p.resources.map(l => [l.resourceId,l.units]));
  const resources = rows.map(r => ({resourceId:r.id, capacity:r.capacity, requestedUnits:p.serviceId === null ? r.capacity : wanted.get(r.id)!, remainingUnits:Math.max(0,r.capacity - (peak.get(r.id) ?? 0))}));
  return { available: resources.every(r => r.remainingUnits >= r.requestedUnits), resources, checkedAt:now };
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
  async availability(input: InventoryRequest) {
    const p = planOf(input); return this.run(tx => inspect(tx, p));
  }
  async hold(input: InventoryRequest & { ownerRef:string; ttlSeconds:number }) {
    const p = planOf(input), ttl = input.ttlSeconds;
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 86400) fail('INVALID_INPUT', 'ttlSeconds must be 1 to 86400');
    return this.create(p, text(input.ownerRef,'ownerRef'), ttl);
  }
  async allocate(input: InventoryRequest & { ownerRef:string }) {
    return this.create(planOf(input), text(input.ownerRef,'ownerRef'), null);
  }
  async close(input: InventoryClosure) {
    if (!Array.isArray(input?.resourceIds) || input.resourceIds.length > 64) fail('INVALID_INPUT', 'Invalid closure resource list');
    return this.create({...windowOf(input), serviceId:null, resources:linesOf(input.resourceIds.map(resourceId => ({resourceId,units:1})))}, text(input.ownerRef,'ownerRef'), null);
  }
  private create(p: Plan, ownerRef:string, ttl:number | null) {
    return this.run(async tx => {
      const status = await inspect(tx,p);
      if (!status.available) fail('UNAVAILABLE', 'Insufficient physical capacity during this interval');
      return tx.inventoryClaim.create({data:{kind:p.serviceId === null ? 'CLOSURE' : 'ALLOCATION', state:ttl === null ? 'CONFIRMED' : 'HELD',
        serviceId:p.serviceId, ownerRef, startsAt:p.startsAt, endsAt:p.endsAt,
        expiresAt:ttl === null ? null : new Date(Math.min(+status.checkedAt + ttl*1000,+p.endsAt)),
        lines:{create:status.resources.map(r => ({resourceId:r.resourceId, units:r.requestedUnits}))}}, include});
    });
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
