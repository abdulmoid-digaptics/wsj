/**
 * Coworking day selection for the Bronze / Silver / Gold / Platinum packs.
 *
 * - Flexible packs (Bronze 1 day, Silver 5, Gold 10: the count comes from the plan's
 *   includedCredits COWORKING_DAY amount) pick ALL their days at checkout. Days need not be
 *   consecutive but must sit inside one window of `windowDays` (30) starting on the first day.
 * - Unlimited packs (Platinum) pick a start date and get `windowDays` consecutive days.
 * - Every day is checked on the server (closed days, same-day service rules, optional daily
 *   seat capacity, and the coworking-only minimum notice) under a per-day advisory lock in the
 *   same transaction that creates the order, so two buyers can never take the last seat.
 * - After purchase, a not-yet-started flexible day can be moved to another available day in the
 *   same window. If nothing is available the customer is pointed to support.
 *
 * Config lives on the coworking ServiceCategory.metadata.coworkingDays and is admin-editable.
 */
import {BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, NotFoundException, Param, Post, Put, Query, Req, UseGuards} from '@nestjs/common';
import {Throttle} from '@nestjs/throttler';
import {randomUUID} from 'node:crypto';
import {AuthGuard, Db, Roles} from './core';
import {CustomerGuard, type CustomerPrincipal} from './account-auth';
import {CardService} from './account-cards';
import {businessTimeToUtc} from './billing-core';
import {dayConflicts, lockVenueDays, venueDay} from './day-blocks';

export const COWORKING_SERVICE = 'coworking';
export type CoworkingConfig = {minNoticeMinutes: number; lastEntryTime: string; windowDays: number; dailyCapacity: number | null};
export const DEFAULT_COWORKING_CONFIG: CoworkingConfig = {minNoticeMinutes: 60, lastEntryTime: '19:00', windowDays: 30, dailyCapacity: null};
export type Allowance = {mode: 'FLEX'; days: number} | {mode: 'CONSECUTIVE'; days: number};
export type DaySelection = {planSlug: string; days: string[]; windowStart: string; windowEnd: string};

type Q = Pick<Db, '$queryRaw' | '$executeRaw'> & Partial<Db>;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (d: string) => new Date(d + 'T00:00:00Z');
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(new Date(toDate(d).getTime() + n * 86400000));
const isRealDay = (d: string) => DAY.test(d) && iso(toDate(d)) === d;
const nice = (d: string) => new Intl.DateTimeFormat('en-US', {timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric'}).format(toDate(d));

/** Coworking day allowance from a plan's includedCredits, or null when the plan has none. */
export function allowanceFor(includedCredits: unknown): Allowance | null {
  if (!Array.isArray(includedCredits)) return null;
  const c = includedCredits.find(x => x && typeof x === 'object' && (x as {kind?: unknown}).kind === 'COWORKING_DAY') as {amount?: unknown; unlimited?: unknown} | undefined;
  if (!c) return null;
  if (c.unlimited === true) return {mode: 'CONSECUTIVE', days: 0};
  const n = Number(c.amount);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? {mode: 'FLEX', days: n} : null;
}

export function normaliseConfig(raw: unknown): CoworkingConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number, dflt: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : dflt);
  return {
    minNoticeMinutes: int(r.minNoticeMinutes, 0, 24 * 60, DEFAULT_COWORKING_CONFIG.minNoticeMinutes),
    lastEntryTime: typeof r.lastEntryTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.lastEntryTime) ? r.lastEntryTime : DEFAULT_COWORKING_CONFIG.lastEntryTime,
    windowDays: int(r.windowDays, 1, 90, DEFAULT_COWORKING_CONFIG.windowDays),
    dailyCapacity: r.dailyCapacity === null || r.dailyCapacity === undefined ? null : int(r.dailyCapacity, 1, 10000, 0) || null,
  };
}

/** A day can still be booked when "now + notice" is before that day's last entry time (venue time). */
export function noticeOk(day: string, cfg: CoworkingConfig, now = new Date()): boolean {
  const today = venueDay(now);
  if (day < today) return false;
  if (day > today) return true;
  return now.getTime() + cfg.minNoticeMinutes * 60000 <= businessTimeToUtc(day, cfg.lastEntryTime).getTime();
}

/** Pure validation of what the customer picked. Returns the days the purchase occupies. */
export function validateSelection(raw: unknown, allowance: Allowance, cfg: CoworkingConfig, planSlug: string, now = new Date()): DaySelection {
  if (!Array.isArray(raw) || !raw.length) throw new BadRequestException(allowance.mode === 'FLEX' ? `Choose your ${allowance.days} coworking day${allowance.days === 1 ? '' : 's'}.` : 'Choose your start date.');
  const days = [...new Set(raw.map(String))].sort();
  if (days.length !== raw.length) throw new BadRequestException('Each day can only be chosen once.');
  if (!days.every(isRealDay)) throw new BadRequestException('One of the chosen dates is not valid.');
  const expected = allowance.mode === 'FLEX' ? allowance.days : 1;
  if (days.length !== expected) throw new BadRequestException(allowance.mode === 'FLEX' ? `This package includes ${allowance.days} day${allowance.days === 1 ? '' : 's'}. Please choose exactly ${allowance.days}.` : 'Choose one start date.');
  const late = days.find(d => !noticeOk(d, cfg, now));
  if (late) throw new BadRequestException(late < venueDay(now) ? `${nice(late)} has already passed.` : `Coworking needs at least ${cfg.minNoticeMinutes} minutes' notice. ${nice(late)} can no longer be booked; please choose another day.`);
  const windowStart = days[0];
  const windowEnd = addDays(windowStart, cfg.windowDays - 1);
  if (days[days.length - 1] > windowEnd) throw new BadRequestException(`All days must fall within ${cfg.windowDays} days of your first day (${nice(windowStart)} to ${nice(windowEnd)}).`);
  const occupied = allowance.mode === 'FLEX' ? days : Array.from({length: cfg.windowDays}, (_, i) => addDays(windowStart, i));
  return {planSlug, days: occupied, windowStart, windowEnd};
}

/** Seats held per day by live orders (paid, or pending and unexpired). */
export async function seatsTaken(db: Q, from: string, to: string, excludeOrderId?: string): Promise<Record<string, number>> {
  const rows = await db.$queryRaw<Array<{day: Date; n: bigint}>>`
    SELECT d.day, count(*)::bigint AS n FROM "CoworkingDay" d JOIN "Order" o ON o.id = d."orderId"
    WHERE d.status = 'ACTIVE' AND d.day BETWEEN ${from}::date AND ${to}::date
      AND (o.status IN ('PAID','PARTIALLY_PAID') OR (o.status = 'PENDING' AND o."expiresAt" > now()))
      AND (${excludeOrderId ?? null}::text IS NULL OR o.id <> ${excludeOrderId ?? null}::text)
    GROUP BY d.day`;
  return Object.fromEntries(rows.map(r => [iso(r.day), Number(r.n)]));
}

export async function loadConfig(db: Q): Promise<CoworkingConfig> {
  const rows = await db.$queryRaw<Array<{metadata: unknown}>>`SELECT metadata FROM "ServiceCategory" WHERE slug = ${COWORKING_SERVICE} LIMIT 1`;
  return normaliseConfig((rows[0]?.metadata as {coworkingDays?: unknown} | null)?.coworkingDays);
}

/** Reasons a day cannot be taken, keyed by date. Closures and same-day rules first, then capacity. */
export async function unavailable(db: Q, dates: string[], cfg: CoworkingConfig, now = new Date(), excludeOrderId?: string): Promise<Record<string, string>> {
  if (!dates.length) return {};
  const sorted = [...new Set(dates)].sort();
  const out: Record<string, string> = {};
  for (const d of sorted) if (!noticeOk(d, cfg, now)) out[d] = d < venueDay(now) ? 'This day has passed.' : `Coworking needs ${cfg.minNoticeMinutes} minutes' notice.`;
  for (const c of await dayConflicts(db as never, COWORKING_SERVICE, sorted, undefined, excludeOrderId)) out[c.date] ??= c.reason;
  if (cfg.dailyCapacity) {
    const taken = await seatsTaken(db, sorted[0], sorted[sorted.length - 1], excludeOrderId);
    for (const d of sorted) if ((taken[d] ?? 0) >= cfg.dailyCapacity) out[d] ??= 'Coworking is fully booked on this day.';
  }
  return out;
}

/** Call inside the order transaction: locks, rechecks and stores the chosen days. */
export async function holdDaysInTransaction(tx: Q & Pick<Db, 'coworkingDay'>, input: DaySelection & {orderId: string; customerId: string}, cfg: CoworkingConfig, now = new Date()) {
  await lockVenueDays(tx as never, input.days);
  const blocked = await unavailable(tx, input.days, cfg, now);
  const first = input.days.find(d => blocked[d]);
  if (first) throw new ConflictException({message: `${nice(first)}: ${blocked[first]} Please choose another day.`, code: 'DAY_UNAVAILABLE', date: first});
  await tx.coworkingDay.createMany({data: input.days.map(d => ({id: randomUUID(), orderId: input.orderId, customerId: input.customerId, planSlug: input.planSlug, day: toDate(d), windowStart: toDate(input.windowStart), windowEnd: toDate(input.windowEnd)}))});
}

type Row = {id: string; orderId: string; customerId: string; planSlug: string; day: Date; windowStart: Date; windowEnd: Date; status: string};

@Injectable()
export class CoworkingDaysService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(CardService) private readonly cards: CardService) {}

  config() { return loadConfig(this.db); }

  async saveConfig(input: Partial<CoworkingConfig>) {
    const cfg = normaliseConfig({...(await this.config()), ...input});
    const svc = await this.db.serviceCategory.findFirst({where: {slug: COWORKING_SERVICE}, select: {id: true, metadata: true}});
    if (!svc) throw new NotFoundException('Coworking service not found');
    const meta = (svc.metadata && typeof svc.metadata === 'object' ? svc.metadata : {}) as Record<string, unknown>;
    await this.db.serviceCategory.update({where: {id: svc.id}, data: {metadata: {...meta, coworkingDays: cfg} as object}});
    return cfg;
  }

  /** Public calendar: unavailable days in [from, to] plus the rules the picker needs. */
  async calendar(from?: string, to?: string) {
    const cfg = await this.config();
    const start = from && isRealDay(from) ? from : venueDay(new Date());
    const end = to && isRealDay(to) && to >= start ? to : addDays(start, 61);
    if ((toDate(end).getTime() - toDate(start).getTime()) / 86400000 > 93) throw new BadRequestException('Choose a range of up to 93 days');
    const dates: string[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);
    const blocked = await unavailable(this.db, dates, cfg);
    return {from: start, to: end, today: venueDay(new Date()), config: {minNoticeMinutes: cfg.minNoticeMinutes, windowDays: cfg.windowDays}, days: Object.entries(blocked).map(([date, reason]) => ({date, reason}))};
  }

  private async owned(accountId: string, id: string) {
    const ids = await this.cards.ownedIds(accountId);
    const row = await this.db.coworkingDay.findUnique({where: {id}, include: {order: {select: {id: true, status: true}}}});
    if (!row || !ids.includes(row.customerId)) throw new NotFoundException('Booking day not found');
    return row;
  }

  /** The customer's packs, grouped by purchase, with what can still be changed. */
  async forCustomer(accountId: string) {
    const ids = await this.cards.ownedIds(accountId);
    const rows = await this.db.coworkingDay.findMany({where: {customerId: {in: ids}, status: 'ACTIVE', order: {status: {in: ['PAID', 'PARTIALLY_PAID']}}}, orderBy: {day: 'asc'}, include: {order: {select: {id: true, createdAt: true, items: {select: {description: true, metadata: true}}}}}});
    const cfg = await this.config();
    const now = new Date();
    const today = venueDay(now);
    const groups = new Map<string, {orderId: string; planSlug: string; planName: string; windowStart: string; windowEnd: string; consecutive: boolean; days: Array<{id: string; date: string; status: 'USED' | 'TODAY' | 'UPCOMING'; canChange: boolean}>}>();
    for (const r of rows) {
      const key = r.orderId + ':' + r.planSlug;
      if (!groups.has(key)) {
        const item = r.order.items.find(i => (i.metadata as {slug?: string} | null)?.slug === r.planSlug) ?? r.order.items[0];
        const credits = (item?.metadata as {catalogPlan?: {includedCredits?: unknown}} | null)?.catalogPlan?.includedCredits;
        groups.set(key, {orderId: r.orderId, planSlug: r.planSlug, planName: item?.description || r.planSlug, windowStart: iso(r.windowStart), windowEnd: iso(r.windowEnd), consecutive: allowanceFor(credits)?.mode === 'CONSECUTIVE', days: []});
      }
      const g = groups.get(key)!;
      const date = iso(r.day);
      g.days.push({id: r.id, date, status: date < today ? 'USED' : date === today ? 'TODAY' : 'UPCOMING', canChange: !g.consecutive && date > today && iso(r.windowEnd) > today});
    }
    return {config: {minNoticeMinutes: cfg.minNoticeMinutes, windowDays: cfg.windowDays}, packs: [...groups.values()].map(g => ({...g, total: g.days.length, used: g.days.filter(d => d.status === 'USED').length, upcoming: g.days.filter(d => d.status !== 'USED').length}))};
  }

  /** Dates in the same window this day could move to. */
  async options(accountId: string, id: string) {
    const row = await this.owned(accountId, id);
    const cfg = await this.config();
    const now = new Date();
    const taken = new Set((await this.db.coworkingDay.findMany({where: {orderId: row.orderId, status: 'ACTIVE'}, select: {day: true}})).map(d => iso(d.day)));
    const dates: string[] = [];
    for (let d = iso(row.windowStart); d <= iso(row.windowEnd); d = addDays(d, 1)) dates.push(d);
    const blocked = await unavailable(this.db, dates, cfg, now);
    const days = dates.map(date => ({date, available: !taken.has(date) && !blocked[date], reason: taken.has(date) ? (date === iso(row.day) ? 'Current day' : 'Already one of your days') : blocked[date] ?? null}));
    return {current: iso(row.day), windowStart: iso(row.windowStart), windowEnd: iso(row.windowEnd), orderId: row.orderId, days, anyAvailable: days.some(d => d.available)};
  }

  /** Move one upcoming day. 409 NO_AVAILABILITY tells the UI to offer "Contact support". */
  async change(accountId: string, id: string, newDay: string) {
    if (typeof newDay !== 'string' || !isRealDay(newDay)) throw new BadRequestException('Choose a valid date.');
    const row = await this.owned(accountId, id);
    if (row.status !== 'ACTIVE') throw new ConflictException('This day was already changed. Refresh to see your current days.');
    if (!['PAID', 'PARTIALLY_PAID'].includes(row.order.status)) throw new ConflictException('Only paid bookings can be changed.');
    const allowanceRow = await this.db.orderItem.findFirst({where: {orderId: row.orderId}, select: {metadata: true}});
    if (allowanceFor((allowanceRow?.metadata as {catalogPlan?: {includedCredits?: unknown}} | null)?.catalogPlan?.includedCredits)?.mode === 'CONSECUTIVE') throw new BadRequestException('Platinum days run consecutively and cannot be moved individually. Please contact support.');
    const cfg = await this.config();
    const now = new Date();
    const old = iso(row.day);
    if (old <= venueDay(now)) throw new BadRequestException('Days that have started or passed cannot be changed.');
    if (newDay < iso(row.windowStart) || newDay > iso(row.windowEnd)) throw new BadRequestException(`Choose a day between ${nice(iso(row.windowStart))} and ${nice(iso(row.windowEnd))}.`);
    if (newDay === old) throw new BadRequestException('That is already your booked day.');
    return this.db.$transaction(async tx => {
      await lockVenueDays(tx as never, [old, newDay]);
      const fresh = await tx.coworkingDay.findUnique({where: {id}});
      if (!fresh || fresh.status !== 'ACTIVE') throw new ConflictException('This day was already changed. Refresh to see your current days.');
      const dup = await tx.coworkingDay.findFirst({where: {orderId: row.orderId, status: 'ACTIVE', day: toDate(newDay)}});
      if (dup) throw new BadRequestException('That day is already one of your booked days.');
      const blocked = await unavailable(tx as never, [newDay], cfg, now);
      if (blocked[newDay]) throw new ConflictException({message: `${nice(newDay)} is not available: ${blocked[newDay]}`, code: 'NO_AVAILABILITY'});
      const created = await tx.coworkingDay.create({data: {id: randomUUID(), orderId: row.orderId, customerId: row.customerId, planSlug: row.planSlug, day: toDate(newDay), windowStart: row.windowStart, windowEnd: row.windowEnd}});
      await tx.coworkingDay.update({where: {id}, data: {status: 'MOVED', movedToId: created.id}});
      await tx.billingEvent.create({data: {orderId: row.orderId, customerId: row.customerId, actorType: 'CUSTOMER', actorId: accountId, action: 'COWORKING_DAY_CHANGED', data: {from: old, to: newDay, dayId: created.id}}});
      return {id: created.id, from: old, to: newDay};
    }, {isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 20000});
  }

  /** Admin view: who is booked on each day in a range. */
  async adminDays(from?: string, to?: string) {
    const start = from && isRealDay(from) ? from : venueDay(new Date());
    const end = to && isRealDay(to) && to >= start ? to : addDays(start, 30);
    const rows = await this.db.coworkingDay.findMany({where: {status: 'ACTIVE', day: {gte: toDate(start), lte: toDate(end)}, order: {status: {in: ['PAID', 'PARTIALLY_PAID']}}}, orderBy: {day: 'asc'}, include: {customer: {select: {name: true, email: true}}}});
    const cfg = await this.config();
    return {from: start, to: end, config: cfg, days: rows.map(r => ({date: iso(r.day), orderId: r.orderId, planSlug: r.planSlug, customer: r.customer.name || r.customer.email, email: r.customer.email}))};
  }
}

type Req = {customer: CustomerPrincipal};

@Controller('public/coworking-days')
export class PublicCoworkingDaysController {
  constructor(@Inject(CoworkingDaysService) private readonly svc: CoworkingDaysService) {}
  @Get('calendar') @Throttle({default: {limit: 240, ttl: 60000}})
  calendar(@Query('from') from?: string, @Query('to') to?: string) { return this.svc.calendar(from, to); }
}

@Controller('account/coworking-days') @UseGuards(CustomerGuard)
export class AccountCoworkingDaysController {
  constructor(@Inject(CoworkingDaysService) private readonly svc: CoworkingDaysService) {}
  @Get() @Throttle({default: {limit: 120, ttl: 60000}})
  list(@Req() req: Req) { return this.svc.forCustomer(req.customer.id); }
  @Get(':id/options') @Throttle({default: {limit: 60, ttl: 60000}})
  options(@Req() req: Req, @Param('id') id: string) { return this.svc.options(req.customer.id, id); }
  @Post(':id/change') @HttpCode(200) @Throttle({default: {limit: 10, ttl: 60000}})
  change(@Req() req: Req, @Param('id') id: string, @Body() body: {date?: string}) { return this.svc.change(req.customer.id, id, String(body?.date ?? '')); }
}

@Controller('admin/coworking-days') @UseGuards(AuthGuard)
export class AdminCoworkingDaysController {
  constructor(@Inject(CoworkingDaysService) private readonly svc: CoworkingDaysService) {}
  @Get() @Roles('ADMIN', 'EDITOR', 'VIEWER')
  days(@Query('from') from?: string, @Query('to') to?: string) { return this.svc.adminDays(from, to); }
  @Get('settings') @Roles('ADMIN', 'EDITOR', 'VIEWER')
  settings() { return this.svc.config(); }
  @Put('settings') @Roles('ADMIN')
  save(@Body() body: Partial<CoworkingConfig>) { return this.svc.saveConfig(body ?? {}); }
}
