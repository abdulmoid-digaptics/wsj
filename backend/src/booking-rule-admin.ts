import {BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, Post, Put, Req, UseGuards} from '@nestjs/common';
import {ApiBearerAuth} from '@nestjs/swagger';
import {Prisma} from '@prisma/client';
import {AuthGuard, Db, Roles} from './core';
import {BookingRule, evaluateBookingRules, RuleBooking, RuleCondition, validateBookingRule} from './booking-rules';

type Tx = Prisma.TransactionClient;
type RequestWithActor = {user: {id: string}};
type Config = Omit<BookingRule, 'id'>;
type RecordView = BookingRule & {locationId: string; version: number};
const targets = {targets: {select: {resourceId: true}, orderBy: {resourceId: 'asc'}}} as const;
type Row = Prisma.BookingRuleConfigGetPayload<{include: typeof targets}>;
const configKeys = ['enabled', 'priority', 'condition', 'targetResourceIds', 'beforeMinutes', 'afterMinutes', 'activeFrom', 'activeUntil', 'excludedDates'];
const invalid = (message: string): never => {throw new BadRequestException(message);};
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(k => !allowed.includes(k))) return invalid('Unexpected configuration shape or property');
  return value as Record<string, unknown>;
}
function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483647) return invalid('A positive integer expectedVersion is required');
  return value;
}
// PostgreSQL TEXT/JSONB cannot represent NUL or unpaired surrogate code units.
function safeString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && !/[\0\uD800-\uDFFF]/u.test(v);
}
function conditionShape(value: unknown, locationId: string, budget = {left: 500}, depth = 0): void {
  if (depth > 8 || --budget.left < 0) return invalid('Condition too complex');
  const node = object(value, ['any','all','field','op','value']);
  if ('any' in node || 'all' in node) {
    const children = node.any ?? node.all;
    if (Object.keys(node).length !== 1 || !Array.isArray(children) || children.length < 1 || children.length > 50) return invalid('Expected exactly one nonempty all/any group');
    for (const child of children) conditionShape(child, locationId, budget, depth+1);
  } else {
    const values = Array.isArray(node.value) ? node.value : [node.value];
    if (values.some(v => !safeString(v) || (node.field === 'locationId' && v !== locationId))) return invalid('Invalid condition value for this location');
  }
}
/** Strict JSON boundary. Optional fields are omitted, never null; updates are full replacements. */
export function parseBookingRuleConfig(body: unknown, locationId: string, replace = false): Config {
  const data = object(body, replace ? [...configKeys,'expectedVersion'] : configKeys);
  if (replace) version(data.expectedVersion);
  const {expectedVersion: _, ...fields} = data;
  conditionShape(fields.condition, locationId);
  const config = fields as Config;
  try { validateBookingRule({id:'validation', ...config}); }
  catch (e) { return invalid(e instanceof Error ? e.message : 'Invalid rule'); }
  if (config.priority < -2147483648 || config.priority > 2147483647) return invalid('Priority outside signed 32-bit range');
  if (config.targetResourceIds.some(v => !safeString(v))) return invalid('Invalid target resource ID');
  for (const instant of [config.activeFrom, config.activeUntil]) {
    if (instant !== undefined && (+instant.slice(11,13) > 23 || !/^(?!0000)\d{4}-/.test(new Date(instant).toISOString()))) return invalid('Invalid active instant');
  }
  if (config.excludedDates?.some(v => typeof v !== 'string' || v.startsWith('0000')) || new Set(config.excludedDates).size !== (config.excludedDates?.length ?? 0)) return invalid('Expected distinct UTC exception dates');
  return config;
}
function stored(config: Config) {
  return {enabled:config.enabled, priority:config.priority, condition:config.condition as Prisma.InputJsonObject,
    beforeMinutes:config.beforeMinutes, afterMinutes:config.afterMinutes,
    activeFrom:config.activeFrom ? new Date(config.activeFrom) : null, activeUntil:config.activeUntil ? new Date(config.activeUntil) : null,
    excludedDates:(config.excludedDates ?? []).map(v => new Date(v+'T00:00:00Z'))};
}
function view(row: Row): RecordView {
  return {id:row.id, locationId:row.locationId, version:row.version, priority:row.priority, enabled:row.enabled,
    beforeMinutes:row.beforeMinutes, afterMinutes:row.afterMinutes, condition:row.condition as RuleCondition,
    targetResourceIds:row.targets.map(t => t.resourceId), excludedDates:row.excludedDates.map(d => d.toISOString().slice(0,10)),
    ...(row.activeFrom && {activeFrom:row.activeFrom.toISOString()}), ...(row.activeUntil && {activeUntil:row.activeUntil.toISOString()})};
}
// A shared lock also protects an empty rule set against newly inserted rules. Writers must
// first acquire the exclusive lock on the same location. Never lock resources before locations.
async function lockLocation(tx: Tx, locationId: string, write: boolean) {
  const lock = write ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`;
  const rows = await tx.$queryRaw<{id:string}[]>`SELECT id FROM "InventoryLocation" WHERE id = ${locationId} ${lock}`;
  if (!rows.length) throw new NotFoundException('Location not found');
}
async function listRules(tx: Tx, locationId: string, enabledOnly = false) {
  const rows = await tx.bookingRuleConfig.findMany({where:{locationId, archivedAt:null, ...(enabledOnly && {enabled:true})}, include:targets, orderBy:[{priority:'desc'},{id:'asc'}]});
  return rows.map(view);
}
/** Evaluate before claiming inventory in the SAME caller-owned READ COMMITTED transaction.
 * If processing multiple locations, acquire their location locks in stable ID order. */
export async function loadLocationBookingRules(tx: Tx, locationId: string) {
  if ('$transaction' in tx) throw new Error('A caller-owned interactive transaction is required');
  await lockLocation(tx, locationId, false);
  return listRules(tx, locationId, true);
}
export async function evaluateLocationBookingRules(tx: Tx, booking: RuleBooking) {
  return evaluateBookingRules(await loadLocationBookingRules(tx, booking.locationId), booking);
}
async function scopedRule(tx: Tx, locationId: string, id: string) {
  const row = await tx.bookingRuleConfig.findFirst({where:{id,locationId,archivedAt:null}, include:targets});
  if (!row) throw new NotFoundException('Rule not found');
  return row;
}
async function checkTargets(tx: Tx, locationId: string, ids: string[]) {
  if (await tx.physicalResource.count({where:{locationId, id:{in:ids}}}) !== ids.length) throw new BadRequestException('Unknown or out-of-location target resource');
}
async function writeTransaction<T>(db: Db, locationId: string, work: (tx: Tx) => Promise<T>) {
  try {return await db.$transaction(async tx => {await lockLocation(tx,locationId,true); return work(tx);}, {isolationLevel:'ReadCommitted'});}
  catch(e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && ['P2003','P2034'].includes(e.code)) throw new ConflictException('Resource or configuration changed; reload and retry');
    throw e;
  }
}
function audit(tx: Tx, req: RequestWithActor, action: string, resourceId: string) {
  return tx.audit.create({data:{actorId:req.user.id, action, resource:'booking-rule', resourceId}});
}
function assertVersion(row: Row, expected: number) {
  if (row.version !== expected) throw new ConflictException('Stale rule version');
}

/** Dormant: registration is intentionally left to a separate rollout. */
@ApiBearerAuth() @UseGuards(AuthGuard) @Roles('ADMIN')
@Controller('admin/inventory/locations/:locationId/booking-rules')
export class BookingRuleAdminController {
  constructor(@Inject(Db) private readonly db: Db) {}
  @Get() list(@Param('locationId') loc: string) {
    return this.db.$transaction(async tx => {await lockLocation(tx,loc,false); return listRules(tx,loc);});
  }
  @Get(':id') get(@Param('locationId') loc: string, @Param('id') id: string) {
    return this.db.$transaction(async tx => {await lockLocation(tx,loc,false); return view(await scopedRule(tx,loc,id));});
  }
  @Post() async create(@Param('locationId') loc: string, @Body() body: unknown, @Req() req: RequestWithActor) {
    const input = parseBookingRuleConfig(body,loc);
    return writeTransaction(this.db,loc,async tx => {
      await checkTargets(tx,loc,input.targetResourceIds);
      const rule = await tx.bookingRuleConfig.create({data:{locationId:loc,...stored(input)}});
      await tx.bookingRuleTarget.createMany({data:input.targetResourceIds.map(resourceId => ({ruleId:rule.id,locationId:loc,resourceId}))});
      await audit(tx,req,'CREATE',rule.id);
      return view(await scopedRule(tx,loc,rule.id));
    });
  }
  @Put(':id') async replace(@Param('locationId') loc: string, @Param('id') id: string, @Body() body: unknown, @Req() req: RequestWithActor) {
    const input = parseBookingRuleConfig(body,loc,true), expected = (body as {expectedVersion:number}).expectedVersion;
    return writeTransaction(this.db,loc,async tx => {
      assertVersion(await scopedRule(tx,loc,id),expected);
      await checkTargets(tx,loc,input.targetResourceIds);
      await tx.bookingRuleConfig.update({where:{id}, data:{...stored(input),version:{increment:1}}});
      await tx.bookingRuleTarget.deleteMany({where:{ruleId:id}});
      await tx.bookingRuleTarget.createMany({data:input.targetResourceIds.map(resourceId => ({ruleId:id,locationId:loc,resourceId}))});
      await audit(tx,req,'UPDATE',id);
      return view(await scopedRule(tx,loc,id));
    });
  }
  @Delete(':id') async remove(@Param('locationId') loc: string, @Param('id') id: string, @Body() body: unknown, @Req() req: RequestWithActor) {
    const expected = version(object(body,['expectedVersion']).expectedVersion);
    return writeTransaction(this.db,loc,async tx => {
      assertVersion(await scopedRule(tx,loc,id),expected);
      const row = await tx.bookingRuleConfig.update({where:{id},data:{archivedAt:new Date(),enabled:false,version:{increment:1}}});
      await audit(tx,req,'DELETE',id);
      return {id,locationId:loc,version:row.version};
    });
  }
}
