/**
 * Deterministic booking rule evaluation. This module only computes intended locks;
 * the caller must enforce those locks atomically with the physical inventory claim.
 * All times are instants. Intervals use [start, end), so adjoining bookings do not overlap.
 */
export type RuleFact = 'serviceKey' | 'status' | 'locationId';
export type RuleCondition =
  | {field: RuleFact; op: 'eq'; value: string}
  | {field: RuleFact; op: 'in'; value: string[]}
  | {all: RuleCondition[]}
  | {any: RuleCondition[]};
export type BookingRule = {
  id: string;
  enabled: boolean;
  priority: number;
  condition: RuleCondition;
  targetResourceIds: string[];
  beforeMinutes: number;
  afterMinutes: number;
  activeFrom?: string;
  activeUntil?: string;
  excludedDates?: string[];
};
export type RuleBooking = {serviceKey: string; status: string; locationId: string; start: string; end: string};
export type EvaluatedLock = {resourceId: string; start: Date; end: Date; ruleIds: string[]};
const MAX_MINUTES = 7 * 24 * 60;
const ISO_INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/;
const FACTS = new Set(['serviceKey', 'status', 'locationId']);

function instant(value: unknown): number {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) throw new Error('An explicit timezone is required');
  // Date.parse normalizes 24:00 to the following day. Reject it instead of
  // silently shifting a rule boundary or booking onto a different calendar day.
  if (Number(value.slice(11, 13)) > 23) throw new Error('Invalid timestamp');
  const result = Date.parse(value);
  const datePart = value.slice(0, 10);
  const localDate = Date.parse(datePart + 'T00:00:00Z');
  if (!Number.isFinite(result) || !Number.isFinite(localDate) || new Date(localDate).toISOString().slice(0, 10) !== datePart) throw new Error('Invalid timestamp');
  return result;
}
function conditionValid(condition: RuleCondition, depth = 0): void {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition) || depth > 8) throw new Error('Invalid rule condition');
  // Reject ambiguous trees instead of silently ignoring fields. An ignored branch can
  // make a rule lock resources under different circumstances than the admin intended.
  const keys = Object.keys(condition);
  const groupKeys = keys.filter(key => key === 'all' || key === 'any');
  if (groupKeys.length && (groupKeys.length !== 1 || keys.length !== 1)) throw new Error('Invalid rule condition shape');
  if (!groupKeys.length && (keys.length !== 3 || !keys.every(key => ['field', 'op', 'value'].includes(key)))) throw new Error('Invalid rule condition shape');
  if ('all' in condition || 'any' in condition) {
    const group = 'all' in condition ? condition.all : (condition as {any: RuleCondition[]}).any;
    if (!Array.isArray(group) || !group.length || group.length > 50) throw new Error('Rule group must contain conditions');
    for (const child of group) conditionValid(child, depth + 1);
    return;
  }
  if (!('field' in condition) || !FACTS.has(condition.field)) throw new Error('Invalid rule field');
  if (condition.op === 'eq' && typeof condition.value === 'string' && condition.value.length > 0 && condition.value.length <= 200) return;
  if (condition.op === 'in' && Array.isArray(condition.value) && condition.value.length > 0 && condition.value.length <= 50 && condition.value.every(v => typeof v === 'string' && v.length > 0 && v.length <= 200)) return;
  throw new Error('Invalid rule comparison');
}
function matches(condition: RuleCondition, booking: RuleBooking): boolean {
  if ('all' in condition) return condition.all.every(item => matches(item, booking));
  if ('any' in condition) return condition.any.some(item => matches(item, booking));
  return condition.op === 'eq' ? booking[condition.field] === condition.value : condition.value.includes(booking[condition.field]);
}
export function validateBookingRule(rule: BookingRule): void {
  if (!rule || typeof rule.id !== 'string' || !rule.id.trim() || typeof rule.enabled !== 'boolean' || !Number.isSafeInteger(rule.priority)) throw new Error('Invalid rule');
  conditionValid(rule.condition);
  if (!Array.isArray(rule.targetResourceIds) || !rule.targetResourceIds.length || rule.targetResourceIds.length > 100 || rule.targetResourceIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 200) || new Set(rule.targetResourceIds).size !== rule.targetResourceIds.length) throw new Error('Invalid target resources');
  for (const value of [rule.beforeMinutes, rule.afterMinutes]) if (!Number.isInteger(value) || value < 0 || value > MAX_MINUTES) throw new Error('Invalid rule buffer');
  const from = rule.activeFrom === undefined ? undefined : instant(rule.activeFrom);
  const until = rule.activeUntil === undefined ? undefined : instant(rule.activeUntil);
  if (from !== undefined && until !== undefined && from >= until) throw new Error('Invalid active range');
  if (rule.excludedDates !== undefined && (!Array.isArray(rule.excludedDates) || rule.excludedDates.length > 366 || rule.excludedDates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date))) throw new Error('Invalid excluded date');
}
/** excludedDates are UTC calendar dates; callers must display that policy explicitly. */
export function evaluateBookingRules(rules: BookingRule[], booking: RuleBooking): EvaluatedLock[] {
  const start = instant(booking.start), end = instant(booking.end);
  if (start >= end) throw new Error('Booking end must follow start');
  const locks: EvaluatedLock[] = [];
  for (const rule of [...rules].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    validateBookingRule(rule);
    if (!rule.enabled || !matches(rule.condition, booking) || (rule.activeFrom && start < instant(rule.activeFrom)) || (rule.activeUntil && start >= instant(rule.activeUntil)) || rule.excludedDates?.includes(new Date(start).toISOString().slice(0, 10))) continue;
    const lockStart = start - rule.beforeMinutes * 60000, lockEnd = end + rule.afterMinutes * 60000;
    for (const resourceId of rule.targetResourceIds) {
      // All rule windows contain the same booking interval and therefore overlap.
      // Union their buffers so a resource is claimed once with every contributing rule.
      const existing = locks.find(lock => lock.resourceId === resourceId);
      if (existing) {
        existing.start = new Date(Math.min(existing.start.getTime(), lockStart));
        existing.end = new Date(Math.max(existing.end.getTime(), lockEnd));
        existing.ruleIds.push(rule.id);
      } else locks.push({resourceId, start: new Date(lockStart), end: new Date(lockEnd), ruleIds: [rule.id]});
    }
  }
  return locks;
}
