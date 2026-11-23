import {BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, Post, Put, Query, Req, UseGuards} from '@nestjs/common';
import {ApiBearerAuth, ApiTags} from '@nestjs/swagger';
import {AuthGuard, Db, Roles} from './core';
import {dayConflicts, MAX_RANGE_DAYS, venueDays} from './day-blocks';

type Actor = {user: {id: string}};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const bad = (message: string): never => {throw new BadRequestException(message);};
const validDay = (v: unknown) => typeof v === 'string' && DAY.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

function slugs(value: unknown, field: string, known: Set<string>, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > 50) return bad(field + ' must list ' + (allowEmpty ? 'up to 50' : '1 to 50') + ' services');
  const list = [...new Set(value.map(v => (typeof v === 'string' ? v.trim().toLowerCase() : '')))];
  for (const s of list) if (!SLUG.test(s) || !known.has(s)) bad('Unknown service: ' + (s || '(blank)'));
  return list;
}

export type RuleInput = {name: string; enabled: boolean; triggerServices: string[]; blockedServices: string[]; reverse: boolean; countUnpaid: boolean; weekdays: number[]; activeFrom: string | null; activeUntil: string | null; note: string | null};

/** Strict, complete rule shape. Unknown keys are rejected so a typo never silently changes behaviour. */
export function parseRule(body: unknown, known: Set<string>): RuleInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('Expected a rule object');
  const b = body as Record<string, unknown>;
  const allowed = ['name', 'enabled', 'triggerServices', 'blockedServices', 'reverse', 'countUnpaid', 'weekdays', 'activeFrom', 'activeUntil', 'note', 'expectedVersion'];
  const extra = Object.keys(b).filter(k => !allowed.includes(k));
  if (extra.length) bad('Unexpected field: ' + extra[0]);
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || name.length > 120) bad('Give the rule a name (up to 120 characters)');
  const triggerServices = slugs(b.triggerServices, 'When booked', known);
  const blockedServices = slugs(b.blockedServices, 'Block', known);
  const overlap = triggerServices.filter(s => blockedServices.includes(s));
  if (overlap.length) bad('A service cannot both trigger and be blocked by the same rule: ' + overlap.join(', '));
  const weekdays = b.weekdays === undefined ? [] : Array.isArray(b.weekdays) ? [...new Set(b.weekdays as unknown[])] : bad('Weekdays must be a list');
  if (weekdays.some(d => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6)) bad('Weekdays must be 0 (Sunday) to 6 (Saturday)');
  const activeFrom = b.activeFrom === undefined || b.activeFrom === null || b.activeFrom === '' ? null : validDay(b.activeFrom) ? b.activeFrom as string : bad('Start date must be YYYY-MM-DD');
  const activeUntil = b.activeUntil === undefined || b.activeUntil === null || b.activeUntil === '' ? null : validDay(b.activeUntil) ? b.activeUntil as string : bad('End date must be YYYY-MM-DD');
  if (activeFrom && activeUntil && activeFrom > activeUntil) bad('The start date must be on or before the end date');
  for (const k of ['enabled', 'reverse', 'countUnpaid'] as const) if (b[k] !== undefined && typeof b[k] !== 'boolean') bad(k + ' must be true or false');
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 500) : null;
  return {name, enabled: b.enabled === true, triggerServices, blockedServices, reverse: b.reverse === true, countUnpaid: b.countUnpaid !== false, weekdays: (weekdays as number[]).sort(), activeFrom, activeUntil, note};
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
type RuleRow = {id: string; name: string; enabled: boolean; triggerServices: string[]; blockedServices: string[]; reverse: boolean; countUnpaid: boolean; weekdays: number[]; activeFrom: Date | null; activeUntil: Date | null; note: string | null; version: number; updatedAt: Date};
const ruleView = (r: RuleRow) => ({...r, activeFrom: iso(r.activeFrom), activeUntil: iso(r.activeUntil)});
const toData = (r: RuleInput) => ({...r, activeFrom: r.activeFrom ? new Date(r.activeFrom + 'T00:00:00Z') : null, activeUntil: r.activeUntil ? new Date(r.activeUntil + 'T00:00:00Z') : null});

@ApiTags('Admin') @ApiBearerAuth() @UseGuards(AuthGuard) @Roles('ADMIN')
@Controller('admin/day-blocks')
export class DayBlockAdminController {
  constructor(@Inject(Db) private readonly db: Db) {}

  private async services() {
    const rows = await this.db.serviceCategory.findMany({where: {archivedAt: null}, select: {slug: true, name: true, minBookingHours: true, active: true}, orderBy: {displayOrder: 'asc'}});
    return rows;
  }
  private audit(req: Actor, action: string, resourceId: string) {
    return this.db.audit.create({data: {actorId: req.user.id, action, resource: 'day-block', resourceId}}).catch(() => undefined);
  }

  /** Everything the admin screen needs in one request. */
  @Get()
  async overview(@Query('from') from?: string) {
    const start = validDay(from) ? from! : new Date().toISOString().slice(0, 10);
    const [services, rules, closures] = await Promise.all([
      this.services(),
      this.db.dayBlockRule.findMany({where: {archivedAt: null}, orderBy: [{createdAt: 'asc'}]}),
      this.db.dayBlackout.findMany({where: {date: {gte: new Date(start + 'T00:00:00Z')}}, orderBy: {date: 'asc'}, take: 500}),
    ]);
    return {services, rules: rules.map(ruleView), closures: closures.map(c => ({id: c.id, date: iso(c.date), services: c.services, reason: c.reason}))};
  }

  @Post('rules')
  async create(@Body() body: unknown, @Req() req: Actor) {
    const input = parseRule(body, new Set((await this.services()).map(s => s.slug)));
    const row = await this.db.dayBlockRule.create({data: toData(input)});
    await this.audit(req, 'CREATE', row.id);
    return ruleView(row);
  }

  @Put('rules/:id')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Actor) {
    const expected = (body as {expectedVersion?: unknown})?.expectedVersion;
    if (!Number.isInteger(expected)) bad('expectedVersion is required');
    const input = parseRule(body, new Set((await this.services()).map(s => s.slug)));
    /* Optimistic concurrency: two admins editing the same rule cannot overwrite each other. */
    const result = await this.db.dayBlockRule.updateMany({where: {id, archivedAt: null, version: expected as number}, data: {...toData(input), version: {increment: 1}}});
    if (!result.count) {
      if (!(await this.db.dayBlockRule.findFirst({where: {id, archivedAt: null}}))) throw new NotFoundException('Rule not found');
      throw new ConflictException('Someone else changed this rule. Reload and try again.');
    }
    await this.audit(req, 'UPDATE', id);
    return ruleView((await this.db.dayBlockRule.findUnique({where: {id}}))!);
  }

  @Delete('rules/:id')
  async remove(@Param('id') id: string, @Req() req: Actor) {
    const result = await this.db.dayBlockRule.updateMany({where: {id, archivedAt: null}, data: {archivedAt: new Date(), enabled: false, version: {increment: 1}}});
    if (!result.count) throw new NotFoundException('Rule not found');
    await this.audit(req, 'DELETE', id);
    return {id, deleted: true};
  }

  /** Close a day (or a date range) for some or all services. */
  @Post('closures')
  async close(@Body() body: unknown, @Req() req: Actor) {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    if (!validDay(b.date)) bad('Choose a date (YYYY-MM-DD)');
    const until = b.until === undefined || b.until === null || b.until === '' ? b.date as string : validDay(b.until) ? b.until as string : bad('End date must be YYYY-MM-DD');
    if (until < (b.date as string)) bad('The end date must be on or after the start date');
    const span = (Date.parse(until) - Date.parse(b.date as string)) / 86400000;
    if (span > 366) bad('Close at most 366 days at a time');
    const services = slugs(b.services ?? [], 'Services', new Set((await this.services()).map(s => s.slug)), true);
    const reason = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim().slice(0, 200) : null;
    const rows = [];
    for (let t = Date.parse(b.date as string); t <= Date.parse(until); t += 86400000) rows.push({date: new Date(t), services, reason, createdById: req.user.id});
    await this.db.dayBlackout.createMany({data: rows});
    await this.audit(req, 'CLOSE', (b.date as string) + '..' + until);
    return {created: rows.length};
  }

  @Delete('closures/:id')
  async reopen(@Param('id') id: string, @Req() req: Actor) {
    const result = await this.db.dayBlackout.deleteMany({where: {id}});
    if (!result.count) throw new NotFoundException('Closure not found');
    await this.audit(req, 'REOPEN', id);
    return {id, deleted: true};
  }

  /** "Could someone book X on this date?" with the reason, for staff answering customers. */
  @Get('check')
  async check(@Query('service') service: string, @Query('date') date: string, @Query('until') until?: string) {
    if (!validDay(date)) bad('Choose a date');
    const end = validDay(until) ? until! : date;
    const span = (Date.parse(end) - Date.parse(date)) / 86400000;
    if (span < 0 || span > MAX_RANGE_DAYS) bad('Choose a range of up to ' + MAX_RANGE_DAYS + ' days');
    const all = await this.services();
    if (!all.some(s => s.slug === service)) bad('Unknown service');
    const names = Object.fromEntries(all.map(s => [s.slug, s.name]));
    const dates = span === 0 ? venueDays(new Date(date + 'T18:00:00Z'), 1) : Array.from({length: span + 1}, (_, i) => new Date(Date.parse(date) + i * 86400000).toISOString().slice(0, 10));
    return {service, conflicts: await dayConflicts(this.db, service, dates, names)};
  }
}
