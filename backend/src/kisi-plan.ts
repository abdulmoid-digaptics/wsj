import {bookingWallTime} from './booking-time';

export type AccessWindow = {sourceKey: string; groupId: string; validFrom: Date; validUntil: Date};
export const jsonObject = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
export function accessPlanId(source: {planId: string | null; metadata: unknown}): string | null {
  const snapshot = jsonObject(jsonObject(source.metadata).catalogPlan);
  return source.planId || (typeof snapshot.id === 'string' ? snapshot.id : null);
}
export function accessWindow(sourceKey: string, groupId: string, from: Date, until: Date, now: Date): AccessWindow | null {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(until.getTime()) || from >= until) throw new Error('Invalid access window. No access was granted.');
  if (until <= now) return null;
  // Keep the original start stable for crash/retry matching; Kisi accepts past valid_from.
  return {sourceKey: sourceKey + ':' + groupId + ':' + from.toISOString() + ':' + until.toISOString(), groupId, validFrom: from, validUntil: until};
}
export function coworkingAccessWindow(sourceKey: string, groupId: string, day: Date, now: Date) {
  const ymd = day.toISOString().slice(0, 10);
  const next = new Date(day); next.setUTCDate(next.getUTCDate() + 1);
  return accessWindow(sourceKey, groupId, bookingWallTime(ymd, '00:00', 'America/Chicago'), bookingWallTime(next.toISOString().slice(0, 10), '00:00', 'America/Chicago'), now);
}
export function hasPaidSubscriptionPeriod(sub: {accessStatus: string; stripeStatus: string; currentPeriodStart: Date | null; currentPeriodEnd: Date | null; graceEndsAt?: Date | null; stripeItemId?: string | null; stripePriceId?: string | null}, invoices: Array<{status: string; lines?: unknown}>, now: Date) {
  if (!['ACTIVE', 'PAST_DUE'].includes(sub.accessStatus) || !['active', 'past_due'].includes(sub.stripeStatus)) return false;
  if (sub.stripeStatus === 'past_due' && (!sub.graceEndsAt || sub.graceEndsAt <= now)) return false;
  if (!sub.currentPeriodStart || !sub.currentPeriodEnd || sub.currentPeriodEnd <= now) return false;
  return invoices.some(invoice => invoice.status === 'paid' && Array.isArray(invoice.lines) && invoice.lines.some(raw => {
    const line = jsonObject(raw);
    const sameItem = sub.stripeItemId ? line.subscriptionItemId === sub.stripeItemId : Boolean(sub.stripePriceId && line.priceId === sub.stripePriceId);
    return sameItem && typeof line.periodStart === 'string' && typeof line.periodEnd === 'string' && Date.parse(line.periodStart) <= sub.currentPeriodStart!.getTime() && Date.parse(line.periodEnd) >= sub.currentPeriodEnd!.getTime();
  }));
}
export function matchingAssignment(row: {assignee_type?: string; assignee_id?: number; applies_to_type?: string; applies_to_id?: number; role_id?: string; valid_from?: string | null; valid_until?: string | null}, userId: string, window: AccessWindow) {
  return row.assignee_type === 'User' && String(row.assignee_id) === userId && row.applies_to_type === 'Group' && String(row.applies_to_id) === window.groupId && row.role_id === 'group_basic' && Boolean(row.valid_from && row.valid_until) && Date.parse(row.valid_from!) === window.validFrom.getTime() && Date.parse(row.valid_until!) === window.validUntil.getTime();
}
