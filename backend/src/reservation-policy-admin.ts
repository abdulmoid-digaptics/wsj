import {BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, Post, Put, Req, UseGuards} from '@nestjs/common';
import {ApiBearerAuth} from '@nestjs/swagger';
import {Prisma} from '@prisma/client';
import {AuthGuard, Db, Roles} from './core';
import {loadLocationBookingRules} from './booking-rule-admin';
import type {ReservationPolicy, ReservationResource} from './resource-resolver';

type Tx = Prisma.TransactionClient;
type Actor = {user:{id:string}};
type PlanRef = {catalogPlanId:string; legacyPlanId?:never} | {legacyPlanId:string; catalogPlanId?:never};
export type ReservationPolicyScope = PlanRef & {serviceId:string; locationId:string};
type Requirement = {resourceId:string; units:number};
const fields = {requirements:{select:{resourceId:true,units:true},orderBy:{resourceId:'asc'}}} as const;
type Row = Prisma.ReservationPolicyConfigGetPayload<{include:typeof fields}>;
const fail = (message:string):never => {throw new BadRequestException(message);};
function object(input:unknown, keys:string[]):Record<string,unknown> {
  if (!input || typeof input!=='object' || ![Object.prototype,null].includes(Object.getPrototypeOf(input)) || Object.keys(input).some(k=>!keys.includes(k))) return fail('Unexpected property or configuration shape');
  return input as Record<string,unknown>;
}
function id(value:unknown):string {
  if (typeof value!=='string' || !value || value.trim()!==value || value.length>256 || /[\x00-\x1f\x7f\uD800-\uDFFF]/u.test(value)) return fail('Invalid identifier');
  return value;
}
function integer(value:unknown, max=2147483647):number {
  if (typeof value!=='number' || !Number.isInteger(value) || value<1 || value>max) return fail(`Expected an integer from 1 to ${max}`);
  return value;
}
function plan(data:Record<string,unknown>):PlanRef {
  if (('catalogPlanId' in data)===('legacyPlanId' in data)) return fail('Specify exactly one catalogPlanId or legacyPlanId');
  return 'catalogPlanId' in data ? {catalogPlanId:id(data.catalogPlanId)} : {legacyPlanId:id(data.legacyPlanId)};
}
function scope(value:unknown):ReservationPolicyScope {
  const data=object(value,['locationId','serviceId','catalogPlanId','legacyPlanId']);
  return {locationId:id(data.locationId),serviceId:id(data.serviceId),...plan(data)};
}
export function parseReservationPolicy(input:unknown, replace=false) {
  const data=object(input,['serviceId','catalogPlanId','legacyPlanId','enabled','durationMinutes','requirements',...(replace?['expectedVersion']:[])]);
  const reference=plan(data);
  if (typeof data.enabled!=='boolean') return fail('Explicit enabled flag required');
  if (!Array.isArray(data.requirements) || !data.requirements.length || data.requirements.length>64) return fail('Specify 1 to 64 required resources');
  const requirements:Requirement[]=Array.from(data.requirements,r=>{const row=object(r,['resourceId','units']);return {resourceId:id(row.resourceId),units:integer(row.units)};});
  if (new Set(requirements.map(r=>r.resourceId)).size!==requirements.length) return fail('Duplicate required resource');
  return {serviceId:id(data.serviceId),...reference,durationMinutes:integer(data.durationMinutes,10080),enabled:data.enabled,requirements,expectedVersion:replace?integer(data.expectedVersion):undefined};
}
// Same physical location mutex as booking-rule-admin. Always lock ALL locations before ANY resource.
async function locations(tx:Tx, ids:string[], write:boolean) {
  const distinct=[...new Set(ids)], mode=write?Prisma.sql`FOR UPDATE`:Prisma.sql`FOR SHARE`;
  const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "InventoryLocation" WHERE id IN (${Prisma.join(distinct)}) ORDER BY id COLLATE "C" ${mode}`;
  if (rows.length!==distinct.length) throw new NotFoundException('Location not found');
}
async function physical(tx:Tx, ids:string[]) {
  // Use FOR UPDATE immediately, not a shared lock upgraded later when inventory is claimed.
  const distinct=[...new Set(ids)];
  const rows=distinct.length?await tx.$queryRaw<ReservationResource[]>`SELECT id, "locationId", active, capacity FROM "PhysicalResource" WHERE id IN (${Prisma.join(distinct)}) ORDER BY id COLLATE "C" FOR UPDATE`:[];
  return new Map(rows.map(r=>[r.id,r]));
}
async function checkIdentity(tx:Tx, ref:ReservationPolicyScope, bindLegacy:boolean) {
  const svc=await tx.$queryRaw<{slug:string}[]>`SELECT slug FROM "ServiceCategory" WHERE id=${ref.serviceId} AND active AND "archivedAt" IS NULL FOR SHARE`;
  if (!svc.length) return fail('Service unavailable');
  if (ref.catalogPlanId!==undefined) {
    const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "CatalogPlan" WHERE id=${ref.catalogPlanId} AND "serviceId"=${ref.serviceId} AND active AND "archivedAt" IS NULL FOR SHARE`;
    if (!rows.length) return fail('Catalog plan unavailable for this service');
  } else {
    const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "Plan" WHERE id=${ref.legacyPlanId} AND active AND "archivedAt" IS NULL FOR SHARE`;
    if (!rows.length) return fail('Legacy plan unavailable');
    // A global, explicit binding, never inferred from serviceType, plan slug or static booking keys.
    if (bindLegacy) await tx.legacyReservationService.createMany({data:[{planId:ref.legacyPlanId,serviceId:ref.serviceId}],skipDuplicates:true});
    const binding=await tx.legacyReservationService.findUnique({where:{planId:ref.legacyPlanId}});
    if (binding?.serviceId!==ref.serviceId) return fail('Legacy plan not mapped to this service');
  }
  return svc[0].slug;
}
function requiredResources(requirements:Requirement[], resources:Map<string,ReservationResource>, locationId:string) {
  if (!requirements.length || requirements.length>64) return fail('Incomplete reservation policy');
  return requirements.map(({resourceId,units})=>{
    const resource=resources.get(resourceId);
    if (!resource?.active || resource.locationId!==locationId || units<1 || units>resource.capacity) return fail('Required resource unavailable at this location or insufficient configured capacity');
    return {resource,units};
  });
}
async function scoped(tx:Tx, locationId:string, policyId:string) {
  const row=await tx.reservationPolicyConfig.findFirst({where:{locationId,id:id(policyId),archivedAt:null},include:fields});
  if (!row) throw new NotFoundException('Policy not found');
  return row;
}
function version(row:Row, expected:number|undefined) {
  if (row.version!==expected) throw new ConflictException('Stale policy version');
}
async function transaction<T>(db:Db, location:string, write:boolean, work:(tx:Tx)=>Promise<T>) {
  try {return await db.$transaction(async tx=>{await locations(tx,[id(location)],write);return work(tx);},{isolationLevel:'ReadCommitted'});}
  catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && ['P2002','P2003','P2034'].includes(e.code)) throw new ConflictException('Conflicting reservation configuration; reload and retry');
    throw e;
  }
}
function audit(tx:Tx, req:Actor, action:string, resourceId:string) {
  return tx.audit.create({data:{actorId:req.user.id,resource:'reservation-policy',resourceId,action}});
}
async function validateWrite(tx:Tx, ref:ReservationPolicyScope, requirements:Requirement[], create:boolean) {
  const ids=requirements.map(r=>r.resourceId);
  requiredResources(requirements,await physical(tx,ids),ref.locationId);
  await checkIdentity(tx,ref,create);
  if (await tx.resourceServiceMapping.count({where:{serviceId:ref.serviceId,resourceId:{in:ids}}})!==ids.length) return fail('All required resources must be mapped to the service');
  // The composite mapping FK enforces this even against concurrent unmapping.
}
function lines(policyId:string, locationId:string, serviceId:string, requirements:Requirement[]) {
  return requirements.map(r=>({policyId,locationId,serviceId,...r}));
}
/** Deliberately unregistered. Full replacement keeps the scope immutable; archive to free a scope. */
@ApiBearerAuth() @UseGuards(AuthGuard) @Roles('ADMIN')
@Controller('admin/inventory/locations/:locationId/reservation-policies')
export class ReservationPolicyAdminController {
  constructor(@Inject(Db) private readonly db:Db) {}
  @Get() list(@Param('locationId') loc:string) {
    return transaction(this.db,loc,false,tx=>tx.reservationPolicyConfig.findMany({where:{locationId:loc,archivedAt:null},include:fields,orderBy:{id:'asc'}}));
  }
  @Get(':id') get(@Param('locationId') loc:string,@Param('id') policyId:string) {
    return transaction(this.db,loc,false,tx=>scoped(tx,loc,policyId));
  }
  @Post() async create(@Param('locationId') loc:string,@Body() body:unknown,@Req() req:Actor) {
    const {requirements,expectedVersion:_,...data}=parseReservationPolicy(body);
    return transaction(this.db,loc,true,async tx=>{
      await validateWrite(tx,{locationId:loc,...data},requirements,true);
      const row=await tx.reservationPolicyConfig.create({data:{...data,locationId:loc}});
      await tx.reservationPolicyRequirement.createMany({data:lines(row.id,loc,data.serviceId,requirements)});
      await audit(tx,req,'CREATE',row.id);return scoped(tx,loc,row.id);
    });
  }
  @Put(':id') async replace(@Param('locationId') loc:string,@Param('id') policyId:string,@Body() body:unknown,@Req() req:Actor) {
    const data=parseReservationPolicy(body,true);
    return transaction(this.db,loc,true,async tx=>{
      const row=await scoped(tx,loc,policyId);version(row,data.expectedVersion);
      if (row.serviceId!==data.serviceId || row.catalogPlanId!==(data.catalogPlanId??null) || row.legacyPlanId!==(data.legacyPlanId??null)) return fail('Policy scope is immutable');
      await validateWrite(tx,{locationId:loc,...data},data.requirements,false);
      await tx.reservationPolicyConfig.update({where:{id:row.id},data:{durationMinutes:data.durationMinutes,enabled:data.enabled,version:{increment:1}}});
      await tx.reservationPolicyRequirement.deleteMany({where:{policyId}});
      await tx.reservationPolicyRequirement.createMany({data:lines(row.id,loc,data.serviceId,data.requirements)});
      await audit(tx,req,'UPDATE',row.id);return scoped(tx,loc,row.id);
    });
  }
  @Delete(':id') async archive(@Param('locationId') loc:string,@Param('id') policyId:string,@Body() body:unknown,@Req() req:Actor) {
    const expected=integer(object(body,['expectedVersion']).expectedVersion);
    return transaction(this.db,loc,true,async tx=>{
      const row=await scoped(tx,loc,policyId);version(row,expected);
      await tx.reservationPolicyConfig.update({where:{id:row.id},data:{enabled:false,archivedAt:new Date(),version:{increment:1}}});
      await audit(tx,req,'ARCHIVE',row.id);return {id:row.id,locationId:loc,version:row.version+1};
    });
  }
}

/** Supply only server-verified line identities, all at once, before inventory access. Never call
 * once per cart line: the full batch must take location and physical locks in global order.
 * Returns resolveReservationPlan inputs, not availability or claims. Pass resolved items to the
 * inventory batch in THIS transaction; never cache or use these snapshots after commit.
 * An unknown/disabled policy is an error, never permission to skip a required reservation. */
export async function loadReservationPolicies(tx:Tx, selections:readonly ReservationPolicyScope[]) {
  if ('$transaction' in tx) throw new Error('Caller-owned interactive transaction required');
  const [iso]=await tx.$queryRaw<{level:string}[]>`SELECT current_setting('transaction_isolation') AS level`;
  if (iso.level!=='read committed') throw new Error('READ COMMITTED transaction required');
  if (!Array.isArray(selections) || !selections.length || selections.length>64) return fail('Supply 1 to 64 policy scopes');
  const refs=Array.from(selections,scope), locs=[...new Set(refs.map(r=>r.locationId))];
  await locations(tx,locs,false);
  const rulesByLocation=new Map<string,Awaited<ReturnType<typeof loadLocationBookingRules>>>();
  for (const loc of locs) rulesByLocation.set(loc,await loadLocationBookingRules(tx,loc));
  const rows:Row[]=[];
  for (const ref of refs) {
    const row=await tx.reservationPolicyConfig.findFirst({where:{...ref,enabled:true,archivedAt:null},include:fields});
    if (!row) throw new NotFoundException('No enabled reservation policy for this scope');
    rows.push(row);
  }
  const targetIds=(loc:string)=>[...new Set(rulesByLocation.get(loc)!.flatMap(r=>r.targetResourceIds))];
  const resources=await physical(tx,[...rows.flatMap(r=>r.requirements.map(x=>x.resourceId)),...locs.flatMap(targetIds)]);
  const result=[];
  for (const [i,row] of rows.entries()) {
    const serviceKey=await checkIdentity(tx,refs[i],false);
    const policy:ReservationPolicy={locationId:row.locationId,serviceId:row.serviceId,serviceKey,durationMinutes:row.durationMinutes,requirements:requiredResources(row.requirements,resources,row.locationId)};
    // Missing/inactive rule targets are omitted. The resolver rejects a triggered rule with a missing target.
    const ruleTargets=targetIds(row.locationId).map(id=>resources.get(id)).filter((r):r is ReservationResource=>!!r?.active && r.locationId===row.locationId);
    result.push({policyId:row.id,version:row.version,policy,rules:rulesByLocation.get(row.locationId)!,ruleTargets});
  }
  return result;
}
export async function loadReservationPolicy(tx:Tx, ref:ReservationPolicyScope) {
  return (await loadReservationPolicies(tx,[ref]))[0];
}
