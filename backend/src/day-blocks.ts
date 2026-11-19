/**
 * Same-day service exclusivity and manual day closures.
 *
 * A "venue day" is a calendar date in America/Chicago. A booking occupies every venue day
 * its [start, start + hours) interval touches. Rules are one-directional unless `reverse`
 * is on: "when a trigger service is booked that day, blocked services are unavailable".
 *
 * Enforcement runs in the same transaction that creates the order, behind a per-day
 * advisory lock, so two buyers can never both check out conflicting services.
 */
import {ConflictException} from '@nestjs/common';
import {Prisma} from '@prisma/client';

export const VENUE_TIME_ZONE = 'America/Chicago';
export const MAX_RANGE_DAYS = 93;

export type DayRule = {
  id: string; name: string; enabled: boolean; triggerServices: string[]; blockedServices: string[];
  reverse: boolean; countUnpaid: boolean; weekdays: number[]; activeFrom: string | null; activeUntil: string | null;
};
export type DayClosure = {date: string; services: string[]; reason: string | null};
export type BookedDay = {date: string; service: string; paid: boolean};
export type DayConflict = {date: string; service: string; reason: string; kind: 'closure' | 'rule'; ruleId?: string; because?: string[]};

const venueDate = new Intl.DateTimeFormat('en-CA', {timeZone: VENUE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'});
/** YYYY-MM-DD of an instant in venue time. */
export const venueDay = (at: Date) => venueDate.format(at);

/** Every venue day a booking touches. The end is exclusive, so 10:00-midnight stays one day. */
export function venueDays(start: Date, minutes: number): string[] {
  if (!Number.isFinite(start.getTime()) || !(minutes > 0)) throw new Error('Invalid booking interval');
  const days = new Set<string>([venueDay(start)]);
  const end = start.getTime() + minutes * 60000 - 1;
  for (let t = start.getTime(); t <= end; t += 3600000) days.add(venueDay(new Date(t)));
  days.add(venueDay(new Date(end)));
  return [...days].sort();
}

const weekday = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay();

export function ruleActiveOn(rule: DayRule, date: string): boolean {
  if (!rule.enabled) return false;
  if (rule.activeFrom && date < rule.activeFrom) return false;
  if (rule.activeUntil && date > rule.activeUntil) return false;
  if (rule.weekdays.length && !rule.weekdays.includes(weekday(date))) return false;
  return true;
}

/** For a candidate service on a date, which already-booked services would make it unavailable. */
export function servicesThatBlock(rules: DayRule[], service: string, date: string): Array<{rule: DayRule; services: string[]}> {
  const out: Array<{rule: DayRule; services: string[]}> = [];
  for (const rule of rules) {
    if (!ruleActiveOn(rule, date)) continue;
    const blockers = new Set<string>();
    if (rule.blockedServices.includes(service)) rule.triggerServices.forEach(s => blockers.add(s));
    if (rule.reverse && rule.triggerServices.includes(service)) rule.blockedServices.forEach(s => blockers.add(s));
    if (blockers.size) out.push({rule, services: [...blockers]});
  }
  return out;
}

const label = (slug: string, names: Record<string, string>) => names[slug] ?? slug.replace(/-/g, ' ');
const pretty = (date: string) => new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC'});

/** Pure decision: conflicts for booking `service` on `dates`, given closures and existing bookings. */
export function findDayConflicts(input: {service: string; dates: string[]; rules: DayRule[]; closures: DayClosure[]; booked: BookedDay[]; names?: Record<string, string>}): DayConflict[] {
  const names = input.names ?? {};
  const conflicts: DayConflict[] = [];
  for (const date of input.dates) {
    const closure = input.closures.find(c => c.date === date && (c.services.length === 0 || c.services.includes(input.service)));
    if (closure) {
      conflicts.push({date, service: input.service, kind: 'closure', reason: label(input.service, names) + ' is closed on ' + pretty(date) + (closure.reason ? ' (' + closure.reason + ')' : '') + '.'});
      continue;
    }
    for (const {rule, services} of servicesThatBlock(input.rules, input.service, date)) {
      const hits = [...new Set(input.booked.filter(b => b.date === date && services.includes(b.service) && b.service !== input.service && (b.paid || rule.countUnpaid)).map(b => b.service))];
      if (hits.length) {
        conflicts.push({date, service: input.service, kind: 'rule', ruleId: rule.id, because: hits,
          reason: label(input.service, names) + ' is not available on ' + pretty(date) + ' because the ' + hits.map(h => label(h, names)).join(' and ') + ' ' + (hits.length > 1 ? 'are' : 'is') + ' booked that day.'});
        break;
      }
    }
  }
  return conflicts;
}

type Q = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function loadDayRules(db: Q): Promise<DayRule[]> {
  const rows = await db.$queryRaw<Array<DayRule & {activeFrom: Date | null; activeUntil: Date | null}>>`
    SELECT id, name, enabled, "triggerServices", "blockedServices", reverse, "countUnpaid", weekdays, "activeFrom", "activeUntil"
    FROM "DayBlockRule" WHERE enabled AND "archivedAt" IS NULL`;
  return rows.map(r => ({...r, weekdays: r.weekdays ?? [], triggerServices: r.triggerServices ?? [], blockedServices: r.blockedServices ?? [], activeFrom: r.activeFrom ? iso(r.activeFrom) : null, activeUntil: r.activeUntil ? iso(r.activeUntil) : null}));
}

export async function loadClosures(db: Q, from: string, to: string): Promise<DayClosure[]> {
  const rows = await db.$queryRaw<Array<{date: Date; services: string[]; reason: string | null}>>`
    SELECT date, services, reason FROM "DayBlackout" WHERE date BETWEEN ${from}::date AND ${to}::date`;
  return rows.map(r => ({date: iso(r.date), services: r.services ?? [], reason: r.reason}));
}

/**
 * Venue days occupied by live orders for the given services. Paid orders always count;
 * unexpired unpaid checkouts are flagged so each rule can decide whether they hold the day.
 * Old fixed-length lines without hour units count only on their start day.
 */
export async function loadBookedDays(db: Q, services: string[], from: string, to: string, excludeOrderId?: string): Promise<BookedDay[]> {
  if (!services.length) return [];
  const rows = await db.$queryRaw<Array<{service: string; paid: boolean; d0: Date; d1: Date}>>`
    WITH lines AS (
      SELECT i.metadata->>'serviceType' AS service,
             o.status IN ('PAID','PARTIALLY_PAID') AS paid,
             (s.value->>'startAt')::timestamptz AS starts,
             CASE WHEN i.metadata->>'billingUnit' = 'PER_HOUR' AND (i.metadata->>'units') ~ '^[0-9]{1,3}$'
                  THEN (i.metadata->>'units')::int * 60 ELSE 60 END AS minutes
      FROM "Order" o
      JOIN "OrderItem" i ON i."orderId" = o.id
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.metadata->'schedule') = 'array' THEN o.metadata->'schedule' ELSE '[]'::jsonb END) s(value)
      WHERE (o.status IN ('PAID','PARTIALLY_PAID') OR (o.status = 'PENDING' AND o."expiresAt" > now()))
        AND (${excludeOrderId ?? null}::text IS NULL OR o.id <> ${excludeOrderId ?? null}::text)
        AND COALESCE(i.metadata->>'kind','PLAN') = 'PLAN'
        AND i.metadata->>'serviceType' = ANY(${services}::text[])
        AND s.value->>'planSlug' = i.metadata->>'slug'
        AND (s.value->>'startAt') IS NOT NULL
    )
    SELECT service, paid, (starts AT TIME ZONE ${VENUE_TIME_ZONE})::date AS d0,
           ((starts + make_interval(mins => minutes) - interval '1 millisecond') AT TIME ZONE ${VENUE_TIME_ZONE})::date AS d1
    FROM lines
    WHERE (starts AT TIME ZONE ${VENUE_TIME_ZONE})::date <= ${to}::date
      AND ((starts + make_interval(mins => minutes) - interval '1 millisecond') AT TIME ZONE ${VENUE_TIME_ZONE})::date >= ${from}::date`;
  const out: BookedDay[] = [];
  for (const r of rows) for (let t = r.d0.getTime(); t <= r.d1.getTime(); t += 86400000) {
    const date = iso(new Date(t));
    if (date >= from && date <= to) out.push({date, service: r.service, paid: r.paid});
  }
  return out;
}

/** Serialise every checkout touching the same venue days. Locks are taken in date order. */
export async function lockVenueDays(db: Q, dates: string[]) {
  for (const date of [...new Set(dates)].sort()) await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'wsj-venue-day:' + date}))`;
}

/** Throws a customer-readable 409 when the service cannot be booked on those days. Call inside the order transaction. */
export async function assertServiceDayAvailable(tx: Q, input: {service: string; start: Date; minutes: number; names?: Record<string, string>}) {
  const dates = venueDays(input.start, input.minutes);
  await lockVenueDays(tx, dates);
  const conflicts = await dayConflicts(tx, input.service, dates, input.names);
  if (conflicts.length) throw new ConflictException(conflicts[0].reason);
}

export async function dayConflicts(db: Q, service: string, dates: string[], names?: Record<string, string>, excludeOrderId?: string) {
  const from = dates[0], to = dates[dates.length - 1];
  const [rules, closures] = await Promise.all([loadDayRules(db), loadClosures(db, from, to)]);
  const relevant = new Set<string>();
  for (const date of dates) for (const {services} of servicesThatBlock(rules, service, date)) services.forEach(s => relevant.add(s));
  relevant.delete(service);
  const booked = await loadBookedDays(db, [...relevant], from, to, excludeOrderId);
  return findDayConflicts({service, dates, rules, closures, booked, names});
}

/** Dates in [from, to] on which the service cannot be booked at all, for the public calendar. */
export async function unavailableDays(db: Q, service: string, from: string, to: string, names?: Record<string, string>) {
  const dates: string[] = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) dates.push(iso(new Date(t)));
  if (!dates.length) return [];
  return (await dayConflicts(db, service, dates, names)).map(c => ({date: c.date, reason: c.reason, kind: c.kind}));
}
