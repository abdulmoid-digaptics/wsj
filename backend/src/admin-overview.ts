/**
 * "Today" dashboard data for every staff role: what needs attention, what is coming up and a few
 * business numbers. Read-only, small and fast (counts and sums only, no customer details beyond
 * the next few bookings). Each figure is computed independently so one failing query never blanks
 * the whole dashboard.
 */
import {Controller, Get, Inject, Query, UseGuards} from '@nestjs/common';
import {ApiBearerAuth, ApiTags} from '@nestjs/swagger';
import {AuthGuard, Db, Roles} from './core';

const VENUE_TZ = 'America/Chicago';
const venueDay = (d: Date) => new Intl.DateTimeFormat('en-CA', {timeZone: VENUE_TZ, year: 'numeric', month: '2-digit', day: '2-digit'}).format(d);

@ApiTags('Admin') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('admin/overview')
export class AdminOverviewController {
  constructor(@Inject(Db) private readonly db: Db) {}

  /* Short cache so the dashboard and the menu badges (polled every minute by each open admin tab)
     do not re-run every query; "Refresh" passes fresh=1 to bypass it. */
  private static cache: {at: number; data: unknown} | null = null;

  @Get() @Roles('ADMIN', 'EDITOR', 'VIEWER')
  async overview(@Query('fresh') fresh?: string) {
    const hit = AdminOverviewController.cache;
    if (fresh !== '1' && hit && Date.now() - hit.at < 60000) return hit.data;
    const data = await this.compute();
    AdminOverviewController.cache = {at: Date.now(), data};
    return data;
  }

  /** Ctrl+K record search: customers, orders, articles and inquiries (5 each, summaries only). */
  @Get('search') @Roles('ADMIN', 'EDITOR', 'VIEWER')
  async search(@Query('q') raw?: string) {
    const q = String(raw || '').trim().slice(0, 80);
    if (q.length < 2) return {customers: [], orders: [], posts: [], inquiries: []};
    const like = {contains: q, mode: 'insensitive' as const};
    const safe = async <T>(fn: () => Promise<T>): Promise<T | []> => { try { return await fn(); } catch { return []; } };
    const [customers, orders, posts, inquiries] = await Promise.all([
      safe(() => this.db.customer.findMany({where: {mergedIntoId: null, OR: [{email: like}, {name: like}, {phone: like}]}, select: {id: true, name: true, email: true}, take: 5, orderBy: {createdAt: 'desc'}})),
      safe(() => this.db.order.findMany({where: {OR: [{id: {startsWith: q.toLowerCase()}}, {contactEmail: like}, {contactName: like}, {customer: {email: like}}]}, select: {id: true, status: true, dueNowAmount: true, currency: true, createdAt: true, customer: {select: {email: true, name: true}}}, take: 5, orderBy: {createdAt: 'desc'}})),
      safe(() => this.db.content.findMany({where: {kind: 'blog', OR: [{title: like}, {slug: like}]}, select: {id: true, title: true, slug: true, status: true}, take: 5, orderBy: {updatedAt: 'desc'}})),
      safe(() => this.db.inquiry.findMany({where: {OR: [{name: like}, {email: like}, {message: like}]}, select: {id: true, name: true, email: true, status: true}, take: 5, orderBy: {createdAt: 'desc'}})),
    ]);
    return {customers, orders, posts, inquiries};
  }

  private async compute() {
    const now = new Date();
    const today = venueDay(now);
    const in7 = new Date(now.getTime() + 7 * 86400000);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => { try { return await fn(); } catch { return fallback; } };
    const n = (rows: Array<{n: bigint | number | null}>) => Number(rows[0]?.n ?? 0);

    const [newInquiries, openSupport, pendingOrders, failedOrders, failedEmails, scheduledPosts, draftPosts,
      revenueMonth, paidOrdersMonth, activeSubs, newCustomers30, subscribers, coworkingToday, upcoming] = await Promise.all([
      safe(() => this.db.inquiry.count({where: {status: 'NEW'}}), 0),
      safe(() => this.db.supportRequest.count({where: {status: {in: ['OPEN', 'IN_PROGRESS']}}}), 0),
      safe(() => this.db.order.count({where: {status: 'PENDING', OR: [{expiresAt: null}, {expiresAt: {gt: now}}]}}), 0),
      safe(() => this.db.order.count({where: {status: 'FAILED', updatedAt: {gt: new Date(now.getTime() - 7 * 86400000)}}}), 0),
      safe(() => this.db.emailOutbox.count({where: {status: {in: ['FAILED', 'DEAD']}}}), 0),
      safe(() => this.db.content.count({where: {kind: 'blog', status: 'PUBLISHED', publishAt: {gt: now}}}), 0),
      safe(() => this.db.content.count({where: {kind: 'blog', status: 'DRAFT'}}), 0),
      safe(async () => n(await this.db.$queryRaw<Array<{n: bigint}>>`SELECT COALESCE(SUM("dueNowAmount"),0)::bigint n FROM "Order" WHERE status IN ('PAID','PARTIALLY_PAID') AND COALESCE("paidAt","updatedAt") >= ${monthStart}`), 0),
      safe(() => this.db.order.count({where: {status: {in: ['PAID', 'PARTIALLY_PAID']}, OR: [{paidAt: {gte: monthStart}}, {paidAt: null, updatedAt: {gte: monthStart}}]}}), 0),
      safe(() => this.db.subscription.count({where: {accessStatus: 'ACTIVE'}}), 0),
      safe(() => this.db.customer.count({where: {createdAt: {gt: new Date(now.getTime() - 30 * 86400000)}, mergedIntoId: null}}), 0),
      safe(() => this.db.subscriber.count({where: {status: 'SUBSCRIBED'}}), 0),
      safe(async () => n(await this.db.$queryRaw<Array<{n: bigint}>>`SELECT count(*)::bigint n FROM "CoworkingDay" d JOIN "Order" o ON o.id = d."orderId" WHERE d.status = 'ACTIVE' AND d.day = ${today}::date AND o.status IN ('PAID','PARTIALLY_PAID')`), 0),
      safe(() => this.db.$queryRaw<Array<{orderId: string; startAt: Date; service: string | null; customer: string | null}>>`
        SELECT o.id AS "orderId", (s.value->>'startAt')::timestamptz AS "startAt",
               (SELECT i.description FROM "OrderItem" i WHERE i."orderId" = o.id AND i.metadata->>'slug' = s.value->>'planSlug' LIMIT 1) AS service,
               COALESCE(NULLIF(c.name, ''), c.email) AS customer
        FROM "Order" o JOIN "Customer" c ON c.id = o."customerId"
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.metadata->'schedule') = 'array' THEN o.metadata->'schedule' ELSE '[]'::jsonb END) s(value)
        WHERE o.status IN ('PAID','PARTIALLY_PAID') AND s.value->>'startAt' IS NOT NULL
          AND (s.value->>'startAt')::timestamptz BETWEEN ${now} AND ${in7}
        ORDER BY 2 ASC LIMIT 6`, [] as Array<{orderId: string; startAt: Date; service: string | null; customer: string | null}>),
    ]);

    return {
      generatedAt: now.toISOString(),
      attention: {newInquiries, openSupport, pendingOrders, failedOrders, failedEmails},
      content: {scheduledPosts, draftPosts},
      business: {revenueMonthCents: revenueMonth, paidOrdersMonth, activeSubscriptions: activeSubs, newCustomers30, subscribers, currency: 'usd'},
      today: {coworkingDays: coworkingToday},
      upcoming: upcoming.map(u => ({orderId: u.orderId, startAt: new Date(u.startAt).toISOString(), service: u.service || 'Booking', customer: u.customer || 'Customer'})),
    };
  }
}
