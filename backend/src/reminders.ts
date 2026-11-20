/**
 * Customer reminders promised by the account preferences ("Booking reminders", "Renewal reminders").
 * - Booking: about 24 hours before a paid, scheduled reservation.
 * - Renewal: 7 days before an annual renewal, 3 days before a monthly one, unless cancellation is scheduled.
 * Each reminder is queued through the outbox with a dedupe key, so it is sent once even if this runs
 * many times, and delivery failures are retried by the outbox worker.
 */
import {Inject, Injectable, OnModuleDestroy, OnModuleInit} from '@nestjs/common';
import {Db} from './core';
import {OutboxService} from './mail';
import {logEvent} from './redact';

const VENUE_TZ = 'America/Chicago';
const fmtWhen = (d: Date) => new Intl.DateTimeFormat('en-US', {timeZone: VENUE_TZ, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'}).format(d);
const fmtDay = (d: Date) => new Intl.DateTimeFormat('en-US', {timeZone: VENUE_TZ, month: 'long', day: 'numeric', year: 'numeric'}).format(d);
const money = (cents: number, currency: string) => new Intl.NumberFormat('en-US', {style: 'currency', currency: currency.toUpperCase()}).format(cents / 100);
const prefOn = (prefs: unknown, key: string) => !(prefs && typeof prefs === 'object' && (prefs as Record<string, unknown>)[key] === false);

@Injectable()
export class ReminderService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(@Inject(Db) private readonly db: Db, @Inject(OutboxService) private readonly outbox: OutboxService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.REMINDER_WORKER === 'off') return;
    setTimeout(() => void this.run().catch(e => logEvent('error', 'reminders.failed', {error: e})), 30000);
    this.timer = setInterval(() => void this.run().catch(e => logEvent('error', 'reminders.failed', {error: e})), 30 * 60000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async run(now = new Date()) {
    return {bookings: await this.bookingReminders(now), renewals: await this.renewalReminders(now)};
  }

  /** Paid orders with a scheduled start between 1 and 26 hours from now. */
  async bookingReminders(now = new Date()) {
    const rows = await this.db.$queryRaw<Array<{orderId: string; customerId: string; startAt: Date; planSlug: string}>>`
      SELECT o.id AS "orderId", o."customerId", (s.value->>'startAt')::timestamptz AS "startAt", s.value->>'planSlug' AS "planSlug"
      FROM "Order" o CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.metadata->'schedule') = 'array' THEN o.metadata->'schedule' ELSE '[]'::jsonb END) s(value)
      WHERE o.status = 'PAID' AND s.value->>'startAt' IS NOT NULL
        AND (s.value->>'startAt')::timestamptz BETWEEN ${new Date(now.getTime() + 3600000)} AND ${new Date(now.getTime() + 26 * 3600000)}`;
    let queued = 0;
    for (const r of rows) {
      const customer = await this.db.customer.findUnique({where: {id: r.customerId}, select: {id: true, email: true, name: true, notificationPrefs: true, mergedIntoId: true}});
      if (!customer || customer.mergedIntoId || !customer.email || !prefOn(customer.notificationPrefs, 'bookingReminders')) continue;
      const item = await this.db.orderItem.findFirst({where: {orderId: r.orderId, metadata: {path: ['slug'], equals: r.planSlug}}, select: {description: true, quantity: true, metadata: true}});
      const hours = (item?.metadata as {billingUnit?: string} | null)?.billingUnit === 'PER_HOUR' ? item?.quantity : undefined;
      const res = await this.outbox.enqueue({customerId: customer.id, to: customer.email, template: 'booking_reminder', payload: {name: customer.name, serviceName: item?.description || 'your booking', when: fmtWhen(r.startAt), ...(hours ? {duration: hours + ' hour' + (hours === 1 ? '' : 's')} : {})}, dedupeKey: 'booking-reminder:' + r.orderId + ':' + r.startAt.toISOString()});
      if (res?.created) queued++;
    }
    return queued;
  }

  /** Active, auto-renewing subscriptions approaching their renewal date. */
  async renewalReminders(now = new Date()) {
    const subs = await this.db.subscription.findMany({
      where: {accessStatus: 'ACTIVE', cancelAtPeriodEnd: false, currentPeriodEnd: {gt: now, lte: new Date(now.getTime() + 7 * 86400000)}},
      select: {id: true, customerId: true, interval: true, intervalCount: true, unitAmount: true, quantity: true, currency: true, currentPeriodEnd: true, plan: {select: {name: true}}, order: {select: {items: {select: {description: true, billingType: true}}}}},
    });
    let queued = 0;
    for (const s of subs) {
      const end = s.currentPeriodEnd!;
      const lead = s.interval === 'YEAR' ? 7 : 3;
      if (end.getTime() - now.getTime() > lead * 86400000) continue;
      const customer = await this.db.customer.findUnique({where: {id: s.customerId}, select: {id: true, email: true, name: true, notificationPrefs: true, mergedIntoId: true}});
      if (!customer || customer.mergedIntoId || !customer.email || !prefOn(customer.notificationPrefs, 'renewalReminders')) continue;
      const planName = s.plan?.name || s.order?.items.find(i => i.billingType === 'RECURRING')?.description || 'your plan';
      const res = await this.outbox.enqueue({customerId: customer.id, to: customer.email, template: 'renewal_reminder', payload: {name: customer.name, planName, amount: money(s.unitAmount * (s.quantity || 1), s.currency || 'usd'), date: fmtDay(end), interval: s.interval === 'YEAR' ? 'year' : 'month'}, dedupeKey: 'renewal-reminder:' + s.id + ':' + end.toISOString().slice(0, 10)});
      if (res?.created) queued++;
    }
    return queued;
  }
}
