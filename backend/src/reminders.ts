/**
 * Customer reminders promised by the account preferences ("Booking reminders", "Renewal reminders").
 * - Booking: about 24 hours before a paid, scheduled reservation.
 * - Renewal: 7 days before an annual renewal, 3 days before a monthly one, unless cancellation is scheduled.
 * Each reminder is queued through the outbox with a dedupe key, so it is sent once even if this runs
 * many times, and delivery failures are retried by the outbox worker.
 */
import {Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional} from '@nestjs/common';
import {Db} from './core';
import {OutboxService} from './mail';
import {logEvent} from './redact';
import {NotificationService} from './notifications';
import {bookingWallTime} from './booking-time';

const VENUE_TZ = 'America/Chicago';
const fmtWhen = (d: Date) => new Intl.DateTimeFormat('en-US', {timeZone: VENUE_TZ, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'}).format(d);
const fmtDay = (d: Date) => new Intl.DateTimeFormat('en-US', {timeZone: VENUE_TZ, month: 'long', day: 'numeric', year: 'numeric'}).format(d);
const money = (cents: number, currency: string) => new Intl.NumberFormat('en-US', {style: 'currency', currency: currency.toUpperCase()}).format(cents / 100);
const prefOn = (prefs: unknown, key: string) => !(prefs && typeof prefs === 'object' && (prefs as Record<string, unknown>)[key] === false);

@Injectable()
export class ReminderService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private pushTimer?: NodeJS.Timeout;
  private startTimer?: NodeJS.Timeout;
  private reminderRunning = false;
  constructor(@Inject(Db) private readonly db: Db, @Inject(OutboxService) private readonly outbox: OutboxService, @Optional() @Inject(NotificationService) private readonly notifications?: NotificationService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.REMINDER_WORKER === 'off') return;
    const tick = () => void this.oneHourReminders().catch(() => console.warn('[notifications] booking reminder scan failed'));
    this.startTimer = setTimeout(() => { void this.run().catch(e => logEvent('error', 'reminders.failed', {error: e})); tick(); }, 30000);
    this.timer = setInterval(() => void this.run().catch(e => logEvent('error', 'reminders.failed', {error: e})), 30 * 60000);
    if (this.notifications) this.pushTimer = setInterval(tick, 5 * 60000);
  }
  onModuleDestroy() {
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.timer) clearInterval(this.timer);
    if (this.pushTimer) clearInterval(this.pushTimer);
  }

  /** Every five minutes, deliver for starts 45–60 minutes away (bounded catch-up). */
  async oneHourReminders(now = new Date()) {
    const notifications = this.notifications;
    if (!notifications || this.reminderRunning) return 0;
    this.reminderRunning = true;
    try {
      const after = new Date(now.getTime() + 45 * 60000);
      const before = new Date(now.getTime() + 60 * 60000);
      const rows = await this.db.$queryRaw<Array<{id: string; customerId: string; startAt: Date}>>`
        SELECT 'order:' || o.id AS id, o."customerId", c."startsAt" AS "startAt"
        FROM "InventoryClaim" c JOIN "Order" o ON c."ownerRef" = 'order:' || o.id
        WHERE c.state = 'CONFIRMED' AND o.status = 'PAID' AND c."startsAt" > ${after} AND c."startsAt" <= ${before}
        UNION
        SELECT 'order:' || o.id AS id, o."customerId", (line.value->>'startAt')::timestamptz AS "startAt"
        FROM "Order" o CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.metadata->'schedule') = 'array' THEN o.metadata->'schedule' ELSE '[]'::jsonb END) line(value)
        WHERE o.status = 'PAID' AND (line.value->>'startAt')::timestamptz > ${after} AND (line.value->>'startAt')::timestamptz <= ${before}
          AND NOT EXISTS (SELECT 1 FROM "InventoryClaim" c WHERE c."ownerRef" = 'order:' || o.id)`;
      const day = (date: Date) => new Intl.DateTimeFormat('sv-SE', {timeZone: VENUE_TZ, year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);
      const legacy = await this.db.booking.findMany({where: {status: 'CONFIRMED', customerId: {not: null}, bookingDate: {in: [...new Set([day(after), day(before)])]}}, select: {id: true, customerId: true, bookingDate: true, bookingTime: true}});
      for (const row of legacy) {
        if (!row.customerId || !row.bookingDate || !row.bookingTime) continue;
        try {
          const startAt = bookingWallTime(row.bookingDate, row.bookingTime, VENUE_TZ);
          if (startAt > after && startAt <= before) rows.push({id: 'legacy:' + row.id, customerId: row.customerId, startAt});
        } catch { /* Incomplete or ambiguous historical wall times are not pushed. */ }
      }
      let created = 0;
      for (const row of rows) {
        try { if (await notifications.bookingReminder(row, row.startAt)) created++; }
        catch { console.warn('[notifications] could not persist booking reminder'); }
      }
      return created;
    } finally { this.reminderRunning = false; }
  }

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
