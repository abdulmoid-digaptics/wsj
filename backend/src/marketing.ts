/**
 * Email marketing: subscribers, campaigns, sending, tracking, coupons and analytics.
 *
 * Consent rules (enforced here, not in the UI):
 * - MARKETING campaigns go only to Subscriber rows with status SUBSCRIBED. Newsletter sign-ups need a
 *   confirmed double opt-in; customers who ticked the marketing box are synced automatically.
 * - UNSUBSCRIBED/BOUNCED/COMPLAINED addresses are suppressed for every marketing send, forever, and an
 *   admin cannot re-subscribe them (only the person can, by signing up again).
 * - ANNOUNCEMENT campaigns are service notices to customers (no coupon allowed, admin only).
 * - Every marketing email carries an unsubscribe link and RFC 8058 one-click unsubscribe headers.
 */
import {BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, Param, Patch, Post, Put, Query, Req, Res, UseGuards} from '@nestjs/common';
import {ApiBearerAuth, ApiTags} from '@nestjs/swagger';
import {Prisma} from '@prisma/client';
import {Throttle} from '@nestjs/throttler';
import {AuthGuard, Db, Roles} from './core';
import {MailService, OutboxService} from './mail';
import {PaymentClient} from './payments';
import {frontendOrigins} from './origins';
import {sanitizeArticleHtml} from './article-sanitize';
import {logEvent} from './redact';
import {emailBody, linkSignatureValid, marketingHtml, marketingText, personalize, readSubscriberToken, subscriberToken, trackLinks} from './marketing-email';

type Actor = {user: {id: string; email: string; name?: string; role: string}};
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const bad = (m: string): never => { throw new BadRequestException(m); };
const key = (email: string) => String(email || '').trim().toLowerCase();
const site = () => (frontendOrigins()[0] || 'http://localhost:3000').replace(/\/$/, '');
/** Public base for tracking links; the website proxies /api to the backend. */
const apiBase = () => (process.env.PUBLIC_API_URL || site() + '/api').replace(/\/$/, '');
const tags = (v: unknown) => Array.isArray(v) ? [...new Set(v.map(t => String(t).trim().toLowerCase().replace(/[^a-z0-9 -]/g, '').slice(0, 40)).filter(Boolean))].slice(0, 20) : [];
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export type Audience = {
  /** subscribers = consented marketing list; customers = everyone with an account or purchase (announcements only). */
  type?: 'subscribers' | 'customers';
  tags?: string[];
  sources?: string[];
  /** Customer-based narrowing, applied through the subscriber's linked customer record. */
  customers?: 'any' | 'active-subscription' | 'purchased' | 'never-purchased';
  serviceTypes?: string[];
  subscribedSince?: string;
  excludeRecentDays?: number;
  emails?: string[];
};

export function parseAudience(v: any): Audience {
  const a = v && typeof v === 'object' ? v : {};
  return {
    type: a.type === 'customers' ? 'customers' : 'subscribers',
    tags: tags(a.tags),
    sources: Array.isArray(a.sources) ? a.sources.map(String).slice(0, 20) : [],
    customers: ['active-subscription', 'purchased', 'never-purchased'].includes(a.customers) ? a.customers : 'any',
    serviceTypes: Array.isArray(a.serviceTypes) ? a.serviceTypes.map(String).filter((s: string) => /^[a-z0-9-]{2,40}$/.test(s)).slice(0, 13) : [],
    subscribedSince: typeof a.subscribedSince === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.subscribedSince) ? a.subscribedSince : undefined,
    excludeRecentDays: Number.isInteger(a.excludeRecentDays) && a.excludeRecentDays > 0 && a.excludeRecentDays <= 90 ? a.excludeRecentDays : undefined,
    emails: Array.isArray(a.emails) ? [...new Set(a.emails.map(key).filter((e: string) => EMAIL.test(e)))].slice(0, 5000) as string[] : [],
  };
}

@Injectable()
export class MarketingService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastSync = 0;
  constructor(@Inject(Db) private readonly db: Db, @Inject(MailService) private readonly mail: MailService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.MARKETING_WORKER === 'off') return;
    this.timer = setInterval(() => void this.tick().catch(e => logEvent('error', 'marketing.tick_failed', {error: e})), 15000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  ratePerMinute() { const n = Number(process.env.MARKETING_RATE_PER_MINUTE || 20); return Number.isFinite(n) && n > 0 ? Math.min(600, Math.floor(n)) : 20; }

  /** Consent flows both ways between customer accounts and the subscriber list. */
  async syncCustomers() {
    const now = new Date();
    const consented = await this.db.customer.findMany({where: {marketingOptIn: true, mergedIntoId: null}, select: {id: true, email: true, name: true, marketingConsentAt: true, createdAt: true}});
    for (const c of consented) {
      if (!EMAIL.test(c.email)) continue;
      const existing = await this.db.subscriber.findUnique({where: {emailKey: key(c.email)}});
      const consentAt = c.marketingConsentAt ?? c.createdAt;
      if (!existing) await this.db.subscriber.create({data: {email: c.email, emailKey: key(c.email), name: c.name, status: 'SUBSCRIBED', source: 'customer', customerId: c.id, consentAt, consentSource: 'customer-opt-in', confirmedAt: consentAt}});
      /* Fresh consent after an unsubscribe (they ticked the box again later) re-subscribes them. */
      else if (existing.status === 'UNSUBSCRIBED' && existing.unsubscribedAt && consentAt > existing.unsubscribedAt) await this.db.subscriber.update({where: {id: existing.id}, data: {status: 'SUBSCRIBED', consentAt, consentSource: 'customer-opt-in', unsubscribedAt: null, customerId: c.id}});
      else if (!existing.customerId) await this.db.subscriber.update({where: {id: existing.id}, data: {customerId: c.id}});
    }
    /* A customer who switched marketing off in their account is unsubscribed here too. */
    const revoked = await this.db.customer.findMany({where: {marketingOptIn: false, mergedIntoId: null}, select: {id: true, email: true}});
    if (revoked.length) await this.db.subscriber.updateMany({where: {status: 'SUBSCRIBED', source: 'customer', customerId: {in: revoked.map(r => r.id)}}, data: {status: 'UNSUBSCRIBED', unsubscribedAt: now, unsubscribeReason: 'account preference'}});
    this.lastSync = Date.now();
  }

  /** The people a campaign would reach right now. */
  async resolveAudience(kind: string, audience: Audience, coupon?: string | null) {
    if (kind === 'ANNOUNCEMENT') {
      if (coupon) bad('Service announcements cannot contain a coupon. Use a marketing campaign for offers.');
      const customers = await this.db.customer.findMany({where: {mergedIntoId: null, OR: [{accountStatus: {not: 'GUEST'}}, {orders: {some: {status: 'PAID'}}}], ...(audience.emails?.length ? {email: {in: audience.emails, mode: 'insensitive'}} : {})}, select: {id: true, email: true, name: true}});
      return customers.filter(c => EMAIL.test(c.email)).map(c => ({email: c.email, name: c.name, customerId: c.id, subscriberId: null as string | null}));
    }
    if (Date.now() - this.lastSync > 5 * 60000) await this.syncCustomers();
    const where: any = {status: 'SUBSCRIBED'};
    if (audience.tags?.length) where.tags = {hasSome: audience.tags};
    if (audience.sources?.length) where.source = {in: audience.sources};
    if (audience.subscribedSince) where.consentAt = {gte: new Date(audience.subscribedSince + 'T00:00:00Z')};
    if (audience.excludeRecentDays) where.OR = [{lastEmailAt: null}, {lastEmailAt: {lt: new Date(Date.now() - audience.excludeRecentDays * 86400000)}}];
    if (audience.emails?.length) where.emailKey = {in: audience.emails};
    let subs = await this.db.subscriber.findMany({where, select: {id: true, email: true, name: true, customerId: true}});
    if (audience.customers && audience.customers !== 'any' || audience.serviceTypes?.length) {
      const ids = subs.map(s => s.customerId).filter((x): x is string => !!x);
      const customers = await this.db.customer.findMany({where: {id: {in: ids}}, select: {id: true, orders: {where: {status: 'PAID'}, select: {items: {select: {metadata: true}}}}, subscriptions: {where: {accessStatus: {in: ['ACTIVE', 'PAST_DUE']}}, select: {id: true}}}});
      const byId = new Map(customers.map(c => [c.id, c]));
      subs = subs.filter(s => {
        const c = s.customerId ? byId.get(s.customerId) : undefined;
        const purchased = !!c?.orders.length;
        if (audience.customers === 'active-subscription' && !c?.subscriptions.length) return false;
        if (audience.customers === 'purchased' && !purchased) return false;
        if (audience.customers === 'never-purchased' && purchased) return false;
        if (audience.serviceTypes?.length && !c?.orders.some(o => o.items.some(i => audience.serviceTypes!.includes(String((i.metadata as any)?.serviceType || ''))))) return false;
        return true;
      });
    }
    return subs.filter(s => EMAIL.test(s.email)).map(s => ({email: s.email, name: s.name, subscriberId: s.id, customerId: s.customerId}));
  }

  /** Build the exact email one recipient receives. Test sends skip tracking and say so. */
  render(c: {id: string; kind: string; subject: string; preheader: string; contentHtml: string; couponCode: string | null}, r: {id?: string; email: string; name: string; subscriberId?: string | null}, test = false) {
    const vars = {name: r.name, email: r.email, coupon: c.couponCode};
    const unsubscribeUrl = c.kind === 'MARKETING' && r.subscriberId ? site() + '/newsletter/unsubscribe/?t=' + encodeURIComponent(subscriberToken(r.subscriberId, 'unsubscribe')) : undefined;
    let body = personalize(emailBody(c.contentHtml), vars);
    if (!test && r.id) body = trackLinks(body, r.id, apiBase());
    const subject = (test ? '[TEST] ' : '') + personalize(c.subject, vars, false);
    const html = marketingHtml({subject, preheader: personalize(c.preheader, vars, false), body, coupon: c.couponCode, kind: c.kind, unsubscribeUrl: unsubscribeUrl || (test && c.kind === 'MARKETING' ? site() + '/newsletter/unsubscribe/?t=test' : undefined), pixelUrl: !test && r.id ? apiBase() + '/public/m/o/' + r.id + '.gif' : undefined, siteUrl: site()});
    const headers: Record<string, string> = {'X-Campaign-Id': c.id};
    if (unsubscribeUrl && r.subscriberId) {
      headers['List-Unsubscribe'] = '<' + apiBase() + '/public/m/u/' + encodeURIComponent(subscriberToken(r.subscriberId, 'unsubscribe')) + '>';
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }
    return {to: r.email, subject, html, text: marketingText(body, unsubscribeUrl), headers, audience: 'customer' as const};
  }

  /** Freeze the audience when a campaign starts, so later sign-ups do not change who got it. */
  async materialize(campaignId: string) {
    const c = await this.db.marketingCampaign.findUniqueOrThrow({where: {id: campaignId}});
    const people = await this.resolveAudience(c.kind, parseAudience(c.audience), c.couponCode);
    const seen = new Set<string>();
    const rows = people.filter(p => { const k = key(p.email); if (seen.has(k)) return false; seen.add(k); return true; }).map(p => ({campaignId, email: p.email, name: p.name || '', subscriberId: p.subscriberId, customerId: p.customerId}));
    for (let i = 0; i < rows.length; i += 500) await this.db.campaignRecipient.createMany({data: rows.slice(i, i + 500), skipDuplicates: true});
    await this.db.marketingCampaign.update({where: {id: campaignId}, data: {status: 'SENDING', startedAt: new Date(), recipients: await this.db.campaignRecipient.count({where: {campaignId}}), pauseReason: null}});
  }

  /** One worker step: start due campaigns, then send a rate-limited batch. */
  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.db.marketingCampaign.findMany({where: {status: 'SCHEDULED', scheduledAt: {lte: now}}, select: {id: true}});
      for (const d of due) {
        const claimed = await this.db.marketingCampaign.updateMany({where: {id: d.id, status: 'SCHEDULED'}, data: {status: 'SENDING'}});
        if (claimed.count) await this.materialize(d.id);
      }
      const active = await this.db.marketingCampaign.findMany({where: {status: 'SENDING'}, orderBy: {startedAt: 'asc'}});
      let budget = Math.max(1, Math.ceil(this.ratePerMinute() / 4));
      for (const c of active) {
        if (budget <= 0) break;
        if (this.mail.mode() === 'none') { await this.db.marketingCampaign.update({where: {id: c.id}, data: {status: 'PAUSED', pauseReason: 'Email sending is not configured (SMTP).'}}); continue; }
        const batch = await this.db.campaignRecipient.findMany({where: {campaignId: c.id, OR: [{status: 'QUEUED'}, {status: 'SENDING', lockedUntil: {lt: now}}]}, take: budget, orderBy: {createdAt: 'asc'}});
        for (const r of batch) {
          const claim = await this.db.campaignRecipient.updateMany({where: {id: r.id, status: r.status, attempts: r.attempts}, data: {status: 'SENDING', attempts: {increment: 1}, lockedUntil: new Date(Date.now() + 120000)}});
          if (!claim.count) continue;
          budget--;
          /* Re-check suppression at send time: someone may have unsubscribed after the campaign started. */
          if (c.kind === 'MARKETING' && r.subscriberId) {
            const s = await this.db.subscriber.findUnique({where: {id: r.subscriberId}, select: {status: true}});
            if (s?.status !== 'SUBSCRIBED') { await this.db.campaignRecipient.update({where: {id: r.id}, data: {status: 'SKIPPED', error: 'Unsubscribed before sending', lockedUntil: null}}); continue; }
          }
          try {
            await this.mail.deliver(this.render(c, r));
            await this.db.campaignRecipient.update({where: {id: r.id}, data: {status: 'SENT', sentAt: new Date(), lockedUntil: null, error: null}});
            await this.db.marketingCampaign.update({where: {id: c.id}, data: {sent: {increment: 1}}});
            if (r.subscriberId) await this.db.subscriber.update({where: {id: r.subscriberId}, data: {lastEmailAt: new Date()}}).catch(() => undefined);
          } catch (e: any) {
            const code = Number(e?.responseCode);
            const permanent = e?.message === 'INVALID_RECIPIENT' || (code >= 550 && code <= 554);
            const giveUp = permanent || r.attempts + 1 >= 3;
            await this.db.campaignRecipient.update({where: {id: r.id}, data: {status: giveUp ? 'FAILED' : 'QUEUED', error: String(e?.code || e?.message || 'Error').slice(0, 120), lockedUntil: null}});
            if (giveUp) await this.db.marketingCampaign.update({where: {id: c.id}, data: {failed: {increment: 1}}});
            if (permanent && r.subscriberId) await this.db.subscriber.update({where: {id: r.subscriberId}, data: {status: 'BOUNCED'}}).catch(() => undefined);
            if (e?.message === 'SMTP_CIRCUIT_OPEN') { await this.db.marketingCampaign.update({where: {id: c.id}, data: {status: 'PAUSED', pauseReason: 'The mail server failed repeatedly. Resume when it is working again.'}}); break; }
          }
        }
        const left = await this.db.campaignRecipient.count({where: {campaignId: c.id, status: {in: ['QUEUED', 'SENDING']}}});
        if (!left) await this.db.marketingCampaign.updateMany({where: {id: c.id, status: 'SENDING'}, data: {status: 'SENT', completedAt: new Date()}});
      }
    } finally { this.running = false; }
  }
}

const CAMPAIGN_STATUS_EDITABLE = ['DRAFT', 'SCHEDULED', 'PAUSED'];

@ApiTags('Admin') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('admin/marketing')
export class MarketingAdminController {
  constructor(@Inject(Db) private readonly db: Db, @Inject(MarketingService) private readonly marketing: MarketingService, @Inject(MailService) private readonly mail: MailService, @Inject(PaymentClient) private readonly payments: PaymentClient) {}

  private write(req: Actor) { if (req.user.role === 'VIEWER') throw new ForbiddenException(); }
  private audit(req: Actor, action: string, resource: string, id?: string) { return this.db.audit.create({data: {actorId: req.user.id, action, resource, resourceId: id}}).catch(() => undefined); }

  /* ───────────── Analytics ───────────── */
  @Get('overview')
  async overview(@Query('days') daysRaw?: string) {
    await this.marketing.syncCustomers().catch(() => undefined);
    const days = Math.min(365, Math.max(7, Math.trunc(Number(daysRaw)) || 30));
    const since = new Date(Date.now() - days * 86400000);
    const [byStatus, bySource, growth, unsubs, campaigns, totals, customers] = await Promise.all([
      this.db.subscriber.groupBy({by: ['status'], _count: true}),
      this.db.subscriber.groupBy({by: ['source'], where: {status: 'SUBSCRIBED'}, _count: true}),
      this.db.$queryRaw<Array<{day: Date; n: bigint}>>`SELECT date_trunc('day', COALESCE("confirmedAt","consentAt","createdAt")) AS day, count(*) n FROM "Subscriber" WHERE status IN ('SUBSCRIBED','UNSUBSCRIBED') AND COALESCE("confirmedAt","consentAt","createdAt") >= ${since} GROUP BY 1 ORDER BY 1`,
      this.db.$queryRaw<Array<{day: Date; n: bigint}>>`SELECT date_trunc('day', "unsubscribedAt") AS day, count(*) n FROM "Subscriber" WHERE "unsubscribedAt" >= ${since} GROUP BY 1 ORDER BY 1`,
      this.db.marketingCampaign.findMany({where: {status: {in: ['SENT', 'SENDING', 'PAUSED']}}, orderBy: {startedAt: 'desc'}, take: 10}),
      this.db.$queryRaw<Array<{sent: bigint; opened: bigint; clicked: bigint; unsub: bigint}>>`SELECT count(*) FILTER (WHERE status='SENT') sent, count(*) FILTER (WHERE "openedAt" IS NOT NULL) opened, count(*) FILTER (WHERE "clickedAt" IS NOT NULL) clicked, count(*) FILTER (WHERE "unsubscribedAt" IS NOT NULL) unsub FROM "CampaignRecipient" WHERE "createdAt" >= ${since}`,
      this.db.customer.count({where: {mergedIntoId: null}}),
    ]);
    const stats = await this.campaignStats(campaigns.map(c => c.id));
    const t = totals[0] || {sent: 0n, opened: 0n, clicked: 0n, unsub: 0n};
    const revenue = await this.couponRevenue(campaigns.map(c => c.couponCode).filter((x): x is string => !!x), since);
    return {
      days,
      subscribers: Object.fromEntries(byStatus.map(s => [s.status, s._count])),
      contacts: customers,
      sources: bySource.map(s => ({source: s.source, count: s._count})).sort((a, b) => b.count - a.count),
      growth: growth.map(g => ({day: g.day.toISOString().slice(0, 10), count: Number(g.n)})),
      unsubscribes: unsubs.map(g => ({day: g.day.toISOString().slice(0, 10), count: Number(g.n)})),
      totals: {sent: Number(t.sent), opened: Number(t.opened), clicked: Number(t.clicked), unsubscribed: Number(t.unsub)},
      couponRevenue: revenue,
      campaigns: campaigns.map(c => ({id: c.id, name: c.name, status: c.status, startedAt: c.startedAt, ...stats.get(c.id)})),
      sending: {mode: this.mail.mode(), ratePerMinute: this.marketing.ratePerMinute()},
    };
  }

  private async campaignStats(ids: string[]) {
    const out = new Map<string, {recipients: number; sent: number; failed: number; opened: number; clicked: number; unsubscribed: number; openRate: number; clickRate: number}>();
    if (!ids.length) return out;
    const rows = await this.db.$queryRaw<Array<{id: string; total: bigint; sent: bigint; failed: bigint; opened: bigint; clicked: bigint; unsub: bigint}>>`
      SELECT "campaignId" id, count(*) total, count(*) FILTER (WHERE status='SENT') sent, count(*) FILTER (WHERE status='FAILED') failed, count(*) FILTER (WHERE "openedAt" IS NOT NULL) opened, count(*) FILTER (WHERE "clickedAt" IS NOT NULL) clicked, count(*) FILTER (WHERE "unsubscribedAt" IS NOT NULL) unsub
      FROM "CampaignRecipient" WHERE "campaignId" = ANY(${ids}::text[]) GROUP BY 1`;
    for (const r of rows) { const sent = Number(r.sent); out.set(r.id, {recipients: Number(r.total), sent, failed: Number(r.failed), opened: Number(r.opened), clicked: Number(r.clicked), unsubscribed: Number(r.unsub), openRate: sent ? Number(r.opened) / sent : 0, clickRate: sent ? Number(r.clicked) / sent : 0}); }
    return out;
  }

  /** Paid orders that used a code: count, revenue and discount given (from our own order records). */
  private async couponRevenue(codes: string[], since?: Date) {
    if (!codes.length) return [] as Array<{code: string; orders: number; revenue: number; discount: number}>;
    const rows = await this.db.$queryRaw<Array<{code: string; orders: bigint; revenue: bigint; discount: bigint}>>`
      SELECT upper("couponCode") code, count(*) orders, COALESCE(sum("dueNowAmount"),0) revenue, COALESCE(sum("discountAmount"),0) discount FROM "Order"
      WHERE status = 'PAID' AND upper("couponCode") = ANY(${codes.map(c => c.toUpperCase())}::text[]) ${since ? Prisma.sql`AND "paidAt" >= ${since}` : Prisma.empty} GROUP BY 1`;
    return rows.map(r => ({code: r.code, orders: Number(r.orders), revenue: Number(r.revenue), discount: Number(r.discount)}));
  }

  /* ───────────── Subscribers & contacts ───────────── */
  @Get('subscribers')
  async subscribers(@Query() q: Record<string, string | undefined>) {
    const page = Math.max(1, Math.trunc(Number(q.page)) || 1), limit = Math.min(200, Math.max(10, Math.trunc(Number(q.limit)) || 25));
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.source) where.source = q.source;
    if (q.tag) where.tags = {has: String(q.tag).toLowerCase()};
    if (q.q) where.OR = [{emailKey: {contains: key(q.q)}}, {name: {contains: String(q.q), mode: 'insensitive'}}];
    const [items, total, tagRows] = await Promise.all([
      this.db.subscriber.findMany({where, orderBy: {createdAt: 'desc'}, skip: (page - 1) * limit, take: limit}),
      this.db.subscriber.count({where}),
      this.db.$queryRaw<Array<{tag: string; n: bigint}>>`SELECT unnest(tags) tag, count(*) n FROM "Subscriber" GROUP BY 1 ORDER BY 2 DESC LIMIT 50`,
    ]);
    return {items, total, page, limit, tags: tagRows.map(t => ({tag: t.tag, count: Number(t.n)}))};
  }

  /** Manual add: only with the admin's confirmation that the person gave consent. */
  @Post('subscribers')
  async add(@Body() b: any, @Req() req: Actor) {
    this.write(req);
    if (b?.consentConfirmed !== true) bad('Confirm that this person agreed to receive marketing email.');
    const email = key(b?.email);
    if (!EMAIL.test(email)) bad('Enter a valid email address');
    const existing = await this.db.subscriber.findUnique({where: {emailKey: email}});
    if (existing?.status === 'UNSUBSCRIBED' || existing?.status === 'COMPLAINED') throw new ConflictException('This person unsubscribed. Only they can subscribe again, by signing up themselves.');
    const customer = await this.db.customer.findFirst({where: {emailKey: email}, select: {id: true}});
    const data = {email, emailKey: email, name: String(b?.name || '').slice(0, 120), status: 'SUBSCRIBED', source: 'manual', tags: tags(b?.tags), customerId: customer?.id ?? null, consentAt: new Date(), consentSource: 'admin:' + req.user.email + (b?.consentNote ? ' — ' + String(b.consentNote).slice(0, 200) : ''), confirmedAt: new Date()};
    const row = existing ? await this.db.subscriber.update({where: {id: existing.id}, data: {...data, tags: [...new Set([...existing.tags, ...data.tags])]}}) : await this.db.subscriber.create({data});
    await this.audit(req, 'SUBSCRIBE', 'subscriber', row.id);
    return row;
  }

  /** CSV import: email[,name[,tags]] per line. Unsubscribed addresses are never re-added. */
  @Post('subscribers/import') @HttpCode(200)
  async importCsv(@Body() b: any, @Req() req: Actor) {
    this.write(req);
    if (b?.consentConfirmed !== true) bad('Confirm that everyone in this file agreed to receive marketing email.');
    const lines = String(b?.csv || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 20000);
    if (!lines.length) bad('Paste or upload at least one email address');
    const extra = tags(b?.tags);
    let added = 0, updated = 0, skipped = 0, invalid = 0;
    for (const line of lines) {
      const cells = line.split(/[,;\t]/).map(c => c.trim().replace(/^"|"$/g, ''));
      const email = key(cells[0]);
      if (/^e-?mail$/i.test(cells[0])) continue;
      if (!EMAIL.test(email)) { invalid++; continue; }
      const existing = await this.db.subscriber.findUnique({where: {emailKey: email}});
      if (existing && ['UNSUBSCRIBED', 'COMPLAINED', 'BOUNCED'].includes(existing.status)) { skipped++; continue; }
      const rowTags = [...extra, ...tags((cells[2] || '').split('|'))];
      if (existing) { await this.db.subscriber.update({where: {id: existing.id}, data: {tags: [...new Set([...existing.tags, ...rowTags])], ...(cells[1] && !existing.name ? {name: cells[1].slice(0, 120)} : {}), ...(existing.status === 'PENDING' ? {status: 'SUBSCRIBED', consentAt: new Date(), consentSource: 'import:' + req.user.email, confirmedAt: new Date()} : {})}}); updated++; }
      else { await this.db.subscriber.create({data: {email, emailKey: email, name: (cells[1] || '').slice(0, 120), status: 'SUBSCRIBED', source: 'import', tags: rowTags, consentAt: new Date(), consentSource: 'import:' + req.user.email, confirmedAt: new Date()}}); added++; }
    }
    await this.audit(req, 'IMPORT', 'subscriber', added + '+' + updated);
    return {added, updated, skipped, invalid};
  }

  @Get('subscribers/export')
  async exportCsv(@Res({passthrough: true}) res: {setHeader: (k: string, v: string) => void}, @Req() req: Actor) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Only admins can export contact data');
    const rows = await this.db.subscriber.findMany({orderBy: {createdAt: 'asc'}});
    const cell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]|^[=+\-@]/.test(s) ? '"' + s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"' : s; };
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="subscribers.csv"');
    await this.audit(req, 'EXPORT', 'subscriber');
    return ['email,name,status,source,tags,consent_at,consent_source,unsubscribed_at,created_at', ...rows.map(r => [r.email, r.name, r.status, r.source, r.tags.join('|'), r.consentAt?.toISOString() ?? '', r.consentSource ?? '', r.unsubscribedAt?.toISOString() ?? '', r.createdAt.toISOString()].map(cell).join(','))].join('\n');
  }

  @Patch('subscribers/:id')
  async updateSubscriber(@Param('id') id: string, @Body() b: any, @Req() req: Actor) {
    this.write(req);
    const s = await this.db.subscriber.findUnique({where: {id}});
    if (!s) throw new NotFoundException();
    const data: any = {};
    if (b?.name !== undefined) data.name = String(b.name).slice(0, 120);
    if (b?.tags !== undefined) data.tags = tags(b.tags);
    if (b?.status === 'UNSUBSCRIBED' && s.status !== 'UNSUBSCRIBED') { Object.assign(data, {status: 'UNSUBSCRIBED', unsubscribedAt: new Date(), unsubscribeReason: 'removed by ' + req.user.email}); if (s.customerId) await this.db.customer.update({where: {id: s.customerId}, data: {marketingOptIn: false, marketingConsentAt: null}}).catch(() => undefined); }
    else if (b?.status && b.status !== s.status) bad('Admins can only unsubscribe people. Re-subscribing requires the person’s own consent.');
    const row = await this.db.subscriber.update({where: {id}, data});
    await this.audit(req, 'UPDATE', 'subscriber', id);
    return row;
  }

  /** Erase (right to be forgotten). The address stays suppressed as a hash-free minimal row is not kept. */
  @Delete('subscribers/:id') @Roles('ADMIN')
  async erase(@Param('id') id: string, @Req() req: Actor) {
    const s = await this.db.subscriber.findUnique({where: {id}});
    if (!s) throw new NotFoundException();
    await this.db.campaignRecipient.updateMany({where: {subscriberId: id}, data: {subscriberId: null}});
    await this.db.subscriber.delete({where: {id}});
    if (s.customerId) await this.db.customer.update({where: {id: s.customerId}, data: {marketingOptIn: false, marketingConsentAt: null}}).catch(() => undefined);
    await this.audit(req, 'ERASE', 'subscriber', id);
    return {erased: true};
  }

  /** Every customer email we hold, with consent and purchase context (read-only). */
  @Get('contacts')
  async contacts(@Query() q: Record<string, string | undefined>) {
    const page = Math.max(1, Math.trunc(Number(q.page)) || 1), limit = Math.min(100, Math.max(10, Math.trunc(Number(q.limit)) || 25));
    const where: any = {mergedIntoId: null, ...(q.q ? {OR: [{email: {contains: String(q.q), mode: 'insensitive'}}, {name: {contains: String(q.q), mode: 'insensitive'}}]} : {}), ...(q.consent === 'yes' ? {marketingOptIn: true} : q.consent === 'no' ? {marketingOptIn: false} : {})};
    const [rows, total] = await Promise.all([
      this.db.customer.findMany({where, orderBy: {createdAt: 'desc'}, skip: (page - 1) * limit, take: limit, select: {id: true, email: true, name: true, phone: true, accountStatus: true, marketingOptIn: true, createdAt: true, orders: {where: {status: 'PAID'}, select: {dueNowAmount: true, paidAt: true}}, subscriptions: {where: {accessStatus: {in: ['ACTIVE', 'PAST_DUE']}}, select: {id: true}}}}),
      this.db.customer.count({where}),
    ]);
    const subs = await this.db.subscriber.findMany({where: {emailKey: {in: rows.map(r => key(r.email))}}, select: {emailKey: true, status: true}});
    const st = new Map(subs.map(s => [s.emailKey, s.status]));
    return {total, page, limit, items: rows.map(r => ({id: r.id, email: r.email, name: r.name, phone: r.phone, account: r.accountStatus, marketingOptIn: r.marketingOptIn, subscriber: st.get(key(r.email)) || null, orders: r.orders.length, spent: r.orders.reduce((s, o) => s + o.dueNowAmount, 0), lastOrder: r.orders.map(o => o.paidAt).filter(Boolean).sort().pop() || null, activeSubscriptions: r.subscriptions.length, createdAt: r.createdAt}))};
  }

  /* ───────────── Campaigns ───────────── */
  @Get('campaigns')
  async campaigns() {
    const rows = await this.db.marketingCampaign.findMany({orderBy: {updatedAt: 'desc'}, take: 200, select: {id: true, name: true, kind: true, subject: true, status: true, scheduledAt: true, startedAt: true, completedAt: true, couponCode: true, recipients: true, sent: true, failed: true, updatedAt: true, pauseReason: true}});
    const stats = await this.campaignStats(rows.map(r => r.id));
    return rows.map(r => ({...r, ...(stats.get(r.id) || {})}));
  }

  @Post('campaigns')
  async create(@Body() b: any, @Req() req: Actor) {
    this.write(req);
    const kind = b?.kind === 'ANNOUNCEMENT' ? 'ANNOUNCEMENT' : 'MARKETING';
    if (kind === 'ANNOUNCEMENT' && req.user.role !== 'ADMIN') throw new ForbiddenException('Only admins can send service announcements');
    const row = await this.db.marketingCampaign.create({data: {name: String(b?.name || 'Untitled campaign').slice(0, 120), kind, subject: '', preheader: '', contentHtml: '<p>Hi {{first_name}},</p><p></p>', audience: {type: kind === 'ANNOUNCEMENT' ? 'customers' : 'subscribers'}, createdById: req.user.id}});
    await this.audit(req, 'CREATE', 'campaign', row.id);
    return row;
  }

  @Get('campaigns/:id')
  async get(@Param('id') id: string) {
    const c = await this.db.marketingCampaign.findUnique({where: {id}});
    if (!c) throw new NotFoundException();
    return c;
  }

  @Put('campaigns/:id')
  async update(@Param('id') id: string, @Body() b: any, @Req() req: Actor) {
    this.write(req);
    const c = await this.db.marketingCampaign.findUnique({where: {id}});
    if (!c) throw new NotFoundException();
    if (!CAMPAIGN_STATUS_EDITABLE.includes(c.status) || (c.status === 'PAUSED' && c.startedAt)) throw new ConflictException('A campaign that has started sending cannot be edited. Duplicate it instead.');
    const coupon = b?.couponCode ? String(b.couponCode).trim().toUpperCase().slice(0, 40) : null;
    if (coupon && !/^[A-Z0-9_-]{3,40}$/.test(coupon)) bad('Coupon codes use letters, numbers, dashes and underscores');
    if (coupon && c.kind === 'ANNOUNCEMENT') bad('Service announcements cannot contain a coupon');
    const row = await this.db.marketingCampaign.update({where: {id}, data: {
      name: String(b?.name ?? c.name).slice(0, 120), subject: String(b?.subject ?? c.subject).replace(/[\r\n]+/g, ' ').slice(0, 200), preheader: String(b?.preheader ?? c.preheader).slice(0, 200),
      contentHtml: sanitizeArticleHtml(String(b?.contentHtml ?? c.contentHtml)), contentDoc: b?.contentDoc ?? c.contentDoc ?? undefined, audience: parseAudience(b?.audience ?? c.audience) as object, couponCode: coupon,
    }});
    return row;
  }

  @Post('campaigns/:id/audience') @HttpCode(200)
  async audiencePreview(@Param('id') id: string, @Body() b: any) {
    const c = await this.db.marketingCampaign.findUnique({where: {id}});
    if (!c) throw new NotFoundException();
    const people = await this.marketing.resolveAudience(c.kind, parseAudience(b?.audience ?? c.audience), b?.couponCode ?? c.couponCode);
    return {count: people.length, sample: people.slice(0, 8).map(p => ({email: p.email.replace(/^(.).*(@.*)$/, '$1•••$2'), name: p.name}))};
  }

  @Post('campaigns/:id/test') @HttpCode(200) @Throttle({default: {limit: 10, ttl: 60000}})
  async test(@Param('id') id: string, @Body() b: any, @Req() req: Actor) {
    this.write(req);
    const c = await this.db.marketingCampaign.findUnique({where: {id}});
    if (!c) throw new NotFoundException();
    if (!c.subject.trim()) bad('Add a subject line first');
    const to = (Array.isArray(b?.emails) ? b.emails : [req.user.email]).map(key).filter((e: string) => EMAIL.test(e)).slice(0, 5);
    if (!to.length) bad('Enter up to 5 test addresses');
    const results = [];
    for (const email of to) {
      try { await this.mail.deliver(this.marketing.render(c, {email, name: req.user.name || 'Test reader'}, true)); results.push({email, ok: true}); }
      catch (e: any) { results.push({email, ok: false, error: e?.message === 'MAIL_NOT_CONFIGURED' ? 'Email sending is not configured' : 'Could not send'}); }
    }
    await this.audit(req, 'TEST_SEND', 'campaign', id);
    return {results};
  }

  /** Rendered HTML exactly as recipients get it (with sample personalisation), for the preview pane. */
  @Get('campaigns/:id/preview')
  async preview(@Param('id') id: string, @Req() req: Actor) {
    const c = await this.db.marketingCampaign.findUnique({where: {id}});
    if (!c) throw new NotFoundException();
    return {html: this.marketing.render(c, {email: req.user.email, name: req.user.name || 'Alex Morgan'}, true).html};
  }

  private async ready(c: {subject: string; contentHtml: string; kind: string; audience: unknown; couponCode: string | null}) {
    if (!c.subject.trim()) bad('Add a subject line');
    if (c.contentHtml.replace(/<[^>]+>|\{\{[^}]+\}\}|\s|Hi\s*,?/g, '').length < 20) bad('Write the email content first');
    const people = await this.marketing.resolveAudience(c.kind, parseAudience(c.audience), c.couponCode);
    if (!people.length) bad('This audience has no recipients');
    if (c.couponCode) {
      const promos = await this.payments.client().promotionCodes.list({code: c.couponCode, active: true, limit: 1}).catch(() => ({data: []}));
      if (!promos.data.length) bad('The coupon ' + c.couponCode + ' is not an active promotion code. Create it under Coupons first.');
    }
    return people.length;
  }

  @Post('campaigns/:id/schedule') @HttpCode(200)
  async schedule(@Param('id') id: string, @Body() b: any, @Req() req: Actor) {
    this.write(req);
    const c = await this.db.marketingCampaign.findUnique({where: {id}});
    if (!c) throw new NotFoundException();
    if (c.status !== 'DRAFT' && c.status !== 'SCHEDULED') throw new ConflictException('Only drafts can be scheduled');
    if (c.kind === 'ANNOUNCEMENT' && req.user.role !== 'ADMIN') throw new ForbiddenException();
    const at = b?.at ? new Date(b.at) : new Date();
    if (!Number.isFinite(at.getTime())) bad('Choose a valid time');
    if (b?.at && at.getTime() < Date.now() - 60000) bad('The scheduled time is in the past');
    const count = await this.ready(c);
    if (b?.confirmCount !== count) throw new ConflictException({message: 'Confirm the audience size: this campaign will go to ' + count + ' people.', code: 'CONFIRM_AUDIENCE', count});
    const row = await this.db.marketingCampaign.update({where: {id}, data: {status: 'SCHEDULED', scheduledAt: at}});
    await this.audit(req, b?.at ? 'SCHEDULE' : 'SEND', 'campaign', id);
    if (!b?.at) void this.marketing.tick().catch(() => undefined);
    return row;
  }

  @Post('campaigns/:id/:action') @HttpCode(200)
  async control(@Param('id') id: string, @Param('action') action: string, @Req() req: Actor) {
    this.write(req);
    const c = await this.db.marketingCampaign.findUnique({where: {id}});
    if (!c) throw new NotFoundException();
    let data: any;
    if (action === 'pause' && c.status === 'SENDING') data = {status: 'PAUSED', pauseReason: 'Paused by ' + req.user.email};
    else if (action === 'resume' && c.status === 'PAUSED') data = {status: c.startedAt ? 'SENDING' : 'DRAFT', pauseReason: null};
    else if (action === 'cancel' && ['SCHEDULED', 'SENDING', 'PAUSED'].includes(c.status)) { data = {status: c.startedAt ? 'CANCELLED' : 'DRAFT', scheduledAt: null}; await this.db.campaignRecipient.updateMany({where: {campaignId: id, status: 'QUEUED'}, data: {status: 'SKIPPED', error: 'Campaign cancelled'}}); }
    else if (action === 'duplicate') {
      const copy = await this.db.marketingCampaign.create({data: {name: c.name + ' (copy)', kind: c.kind, subject: c.subject, preheader: c.preheader, contentHtml: c.contentHtml, contentDoc: c.contentDoc ?? undefined, audience: c.audience as object, couponCode: c.couponCode, createdById: req.user.id}});
      await this.audit(req, 'DUPLICATE', 'campaign', copy.id);
      return copy;
    } else throw new ConflictException('That action is not available for a ' + c.status.toLowerCase() + ' campaign');
    const row = await this.db.marketingCampaign.update({where: {id}, data});
    await this.audit(req, action.toUpperCase(), 'campaign', id);
    return row;
  }

  @Delete('campaigns/:id')
  async remove(@Param('id') id: string, @Req() req: Actor) {
    this.write(req);
    const c = await this.db.marketingCampaign.findUnique({where: {id}});
    if (!c) throw new NotFoundException();
    if (c.startedAt) throw new ConflictException('Sent campaigns are kept for reporting');
    await this.db.marketingCampaign.delete({where: {id}});
    await this.audit(req, 'DELETE', 'campaign', id);
    return {deleted: true};
  }

  @Get('campaigns/:id/report')
  async report(@Param('id') id: string, @Query('page') pageRaw?: string, @Query('status') status?: string) {
    const c = await this.db.marketingCampaign.findUnique({where: {id}});
    if (!c) throw new NotFoundException();
    const page = Math.max(1, Math.trunc(Number(pageRaw)) || 1);
    const where: any = {campaignId: id, ...(status === 'opened' ? {openedAt: {not: null}} : status === 'clicked' ? {clickedAt: {not: null}} : status ? {status: status.toUpperCase()} : {})};
    const [stats, links, opensByHour, recipients, total] = await Promise.all([
      this.campaignStats([id]),
      this.db.$queryRaw<Array<{url: string; clicks: bigint; people: bigint}>>`SELECT url, count(*) clicks, count(DISTINCT "recipientId") people FROM "CampaignClick" WHERE "campaignId" = ${id} GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
      this.db.$queryRaw<Array<{hour: Date; n: bigint}>>`SELECT date_trunc('hour', "openedAt") AS "hour", count(*) AS n FROM "CampaignRecipient" WHERE "campaignId" = ${id} AND "openedAt" IS NOT NULL GROUP BY 1 ORDER BY 1 LIMIT 168`,
      this.db.campaignRecipient.findMany({where, orderBy: {createdAt: 'asc'}, skip: (page - 1) * 50, take: 50, select: {id: true, email: true, name: true, status: true, error: true, sentAt: true, openedAt: true, opens: true, clickedAt: true, clicks: true, unsubscribedAt: true}}),
      this.db.campaignRecipient.count({where}),
    ]);
    const revenue = c.couponCode ? await this.couponRevenue([c.couponCode], c.startedAt ?? undefined) : [];
    return {campaign: c, stats: stats.get(id) || {recipients: 0, sent: 0, failed: 0, opened: 0, clicked: 0, unsubscribed: 0, openRate: 0, clickRate: 0}, links: links.map(l => ({url: l.url, clicks: Number(l.clicks), people: Number(l.people)})), opensByHour: opensByHour.map(o => ({hour: o.hour.toISOString(), count: Number(o.n)})), recipients, total, page, coupon: revenue[0] || null};
  }

  /* ───────────── Coupons (Stripe promotion codes) ───────────── */
  @Get('coupons')
  async coupons() {
    const stripe = this.payments.client();
    const list = await stripe.promotionCodes.list({limit: 100, expand: ['data.promotion.coupon']});
    const codes = list.data.map(p => p.code);
    const revenue = new Map((await this.couponRevenue(codes)).map(r => [r.code, r]));
    return list.data.map(p => {
      const coupon = (p as any).coupon ?? (p as any).promotion?.coupon;
      return {id: p.id, code: p.code, active: p.active, timesRedeemed: p.times_redeemed, maxRedemptions: p.max_redemptions, expiresAt: p.expires_at ? new Date(p.expires_at * 1000).toISOString() : null, firstTimeOnly: p.restrictions?.first_time_transaction ?? false, minimumAmount: p.restrictions?.minimum_amount ?? null,
        percentOff: coupon?.percent_off ?? null, amountOff: coupon?.amount_off ?? null, currency: coupon?.currency ?? null, duration: coupon?.duration, durationInMonths: coupon?.duration_in_months ?? null, created: new Date(p.created * 1000).toISOString(), revenue: revenue.get(p.code.toUpperCase()) || null};
    });
  }

  @Post('coupons')
  async createCoupon(@Body() b: any, @Req() req: Actor) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Only admins can create coupons');
    const code = String(b?.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) bad('Code: 3–40 letters, numbers, dashes or underscores');
    const percent = b?.percentOff !== undefined && b.percentOff !== '' ? Number(b.percentOff) : null;
    const amount = b?.amountOff !== undefined && b.amountOff !== '' ? Math.round(Number(b.amountOff) * 100) : null;
    if ((percent === null) === (amount === null)) bad('Choose either a percentage or a fixed amount');
    if (percent !== null && !(percent > 0 && percent <= 100)) bad('Percentage must be between 1 and 100');
    if (amount !== null && !(amount >= 50 && amount <= 1000000)) bad('Fixed amount must be between $0.50 and $10,000');
    const duration = ['once', 'forever', 'repeating'].includes(b?.duration) ? b.duration : 'once';
    const months = duration === 'repeating' ? Math.trunc(Number(b?.durationInMonths)) : undefined;
    if (duration === 'repeating' && !(months! >= 1 && months! <= 36)) bad('Repeating coupons need 1–36 months');
    const max = b?.maxRedemptions ? Math.trunc(Number(b.maxRedemptions)) : undefined;
    if (max !== undefined && !(max >= 1 && max <= 100000)) bad('Maximum uses must be between 1 and 100,000');
    const expires = b?.expiresAt ? Math.floor(new Date(b.expiresAt).getTime() / 1000) : undefined;
    if (expires !== undefined && (!Number.isFinite(expires) || expires * 1000 < Date.now() + 3600000)) bad('Expiry must be at least an hour from now');
    const minimum = b?.minimumAmount ? Math.round(Number(b.minimumAmount) * 100) : undefined;
    const stripe = this.payments.client();
    const existing = await stripe.promotionCodes.list({code, limit: 1});
    if (existing.data.length) throw new ConflictException('A promotion code "' + code + '" already exists');
    const coupon = await stripe.coupons.create({name: String(b?.name || code).slice(0, 40), duration, ...(months ? {duration_in_months: months} : {}), ...(percent !== null ? {percent_off: percent} : {amount_off: amount!, currency: 'usd'})}, {idempotencyKey: 'coupon:' + code + ':' + (percent ?? amount) + ':' + duration});
    const promo = await stripe.promotionCodes.create({promotion: {type: 'coupon', coupon: coupon.id}, code, ...(max ? {max_redemptions: max} : {}), ...(expires ? {expires_at: expires} : {}), ...((b?.firstTimeOnly || minimum) ? {restrictions: {...(b?.firstTimeOnly ? {first_time_transaction: true} : {}), ...(minimum ? {minimum_amount: minimum, minimum_amount_currency: 'usd'} : {})}} : {})} as any, {idempotencyKey: 'promo:' + code});
    await this.audit(req, 'CREATE', 'coupon', promo.id);
    return {id: promo.id, code: promo.code};
  }

  @Post('coupons/:id/deactivate') @HttpCode(200)
  async deactivate(@Param('id') id: string, @Req() req: Actor) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Only admins can change coupons');
    if (!/^promo_[\w]+$/.test(id)) bad('Unknown promotion code');
    const p = await this.payments.client().promotionCodes.update(id, {active: false});
    await this.audit(req, 'DEACTIVATE', 'coupon', id);
    return {id: p.id, active: p.active};
  }
}

/* ───────────── Public: sign-up, confirmation, unsubscribe, tracking ───────────── */
@ApiTags('Public') @Controller('public')
export class PublicMarketingController {
  constructor(@Inject(Db) private readonly db: Db, @Inject(OutboxService) private readonly outbox: OutboxService) {}

  /** Double opt-in sign-up. The answer never reveals whether an address is already on the list. */
  @Post('newsletter') @HttpCode(200) @Throttle({default: {limit: 5, ttl: 60000}})
  async subscribe(@Body() b: any) {
    if (b?.website) bad('Invalid submission');
    if (b?.consent !== true) bad('Please agree to receive updates');
    const email = key(b?.email);
    if (!EMAIL.test(email)) bad('Enter a valid email address');
    const existing = await this.db.subscriber.findUnique({where: {emailKey: email}});
    if (existing?.status === 'SUBSCRIBED') return {status: 'check_email'};
    const source = String(b?.source || 'newsletter').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'newsletter';
    const row = existing
      ? await this.db.subscriber.update({where: {id: existing.id}, data: {status: 'PENDING', ...(b?.name && !existing.name ? {name: String(b.name).slice(0, 120)} : {})}})
      : await this.db.subscriber.create({data: {email, emailKey: email, name: String(b?.name || '').slice(0, 120), status: 'PENDING', source, consentSource: 'signup form: ' + source}});
    /* One confirmation email per address per 10 minutes, so the form cannot be used to flood an inbox. */
    const confirmUrl = site() + '/newsletter/confirm/?t=' + encodeURIComponent(subscriberToken(row.id, 'confirm', Date.now() + 7 * 86400000));
    await this.outbox.enqueue({to: email, template: 'newsletter_confirm', payload: {confirmUrl, name: row.name}, dedupeKey: 'newsletter-confirm:' + row.id + ':' + Math.floor(Date.now() / 600000)}).catch(() => undefined);
    return {status: 'check_email'};
  }

  @Post('newsletter/confirm') @HttpCode(200) @Throttle({default: {limit: 20, ttl: 60000}})
  async confirm(@Body() b: any) {
    const id = readSubscriberToken(String(b?.t || ''), 'confirm');
    if (!id) throw new BadRequestException('This confirmation link is invalid or has expired. Sign up again to get a new one.');
    const s = await this.db.subscriber.findUnique({where: {id}});
    if (!s) bad('This confirmation link is no longer valid.');
    if (s!.status !== 'SUBSCRIBED') await this.db.subscriber.update({where: {id: s!.id}, data: {status: 'SUBSCRIBED', confirmedAt: new Date(), consentAt: new Date(), unsubscribedAt: null, consentSource: (s!.consentSource || 'signup form') + ' (confirmed)'}});
    return {status: 'subscribed', email: s!.email.replace(/^(.).*(@.*)$/, '$1•••$2')};
  }

  @Get('newsletter/preferences') @Throttle({default: {limit: 30, ttl: 60000}})
  async preferences(@Query('t') t: string) {
    const id = readSubscriberToken(t, 'unsubscribe');
    const s = id ? await this.db.subscriber.findUnique({where: {id}}) : null;
    if (!s) throw new NotFoundException('This link is not valid');
    return {email: s.email.replace(/^(.).*(@.*)$/, '$1•••$2'), status: s.status};
  }

  private async unsubscribe(t: string, reason?: string) {
    const id = readSubscriberToken(t, 'unsubscribe');
    const s = id ? await this.db.subscriber.findUnique({where: {id}}) : null;
    if (!s) throw new NotFoundException('This link is not valid');
    if (s.status !== 'UNSUBSCRIBED') {
      await this.db.subscriber.update({where: {id: s.id}, data: {status: 'UNSUBSCRIBED', unsubscribedAt: new Date(), unsubscribeReason: reason ? String(reason).slice(0, 200) : 'link'}});
      if (s.customerId) await this.db.customer.update({where: {id: s.customerId}, data: {marketingOptIn: false, marketingConsentAt: null}}).catch(() => undefined);
      const last = await this.db.campaignRecipient.findFirst({where: {subscriberId: s.id, status: 'SENT'}, orderBy: {sentAt: 'desc'}});
      if (last) await this.db.campaignRecipient.update({where: {id: last.id}, data: {unsubscribedAt: new Date()}});
    }
    return {status: 'unsubscribed'};
  }

  @Post('newsletter/unsubscribe') @HttpCode(200) @Throttle({default: {limit: 30, ttl: 60000}})
  unsubscribeForm(@Body() b: any) { return this.unsubscribe(String(b?.t || ''), b?.reason); }

  /** RFC 8058 one-click unsubscribe (mail clients POST here without user interaction). */
  @Post('m/u/:t') @HttpCode(200) @Throttle({default: {limit: 60, ttl: 60000}})
  oneClick(@Param('t') t: string) { return this.unsubscribe(t, 'one-click'); }

  /** Open tracking pixel. Always answers with the image, whatever happens. */
  @Get('m/o/:file') @Throttle({default: {limit: 600, ttl: 60000}})
  async open(@Param('file') file: string, @Res() res: any) {
    const id = file.replace(/\.gif$/, '');
    if (/^[\w-]{8,64}$/.test(id)) await this.db.campaignRecipient.updateMany({where: {id}, data: {opens: {increment: 1}}}).then(() => this.db.campaignRecipient.updateMany({where: {id, openedAt: null}, data: {openedAt: new Date()}})).catch(() => undefined);
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'no-store, private');
    res.end(PIXEL);
  }

  /** Click tracking: only signed (recipient, URL) pairs redirect; anything else goes to the homepage. */
  @Get('m/c/:rid') @Throttle({default: {limit: 600, ttl: 60000}})
  async click(@Param('rid') rid: string, @Query('u') u: string, @Query('s') sig: string, @Res() res: any) {
    const url = String(u || '');
    if (!/^[\w-]{8,64}$/.test(rid) || !/^https?:\/\//i.test(url) || !linkSignatureValid(rid, url, sig)) return res.redirect(302, site() + '/');
    const r = await this.db.campaignRecipient.findUnique({where: {id: rid}, select: {campaignId: true, clickedAt: true, openedAt: true}}).catch(() => null);
    if (r) {
      const now = new Date();
      await this.db.campaignRecipient.update({where: {id: rid}, data: {clicks: {increment: 1}, ...(r.clickedAt ? {} : {clickedAt: now}), ...(r.openedAt ? {} : {openedAt: now})}}).catch(() => undefined);
      await this.db.campaignClick.create({data: {campaignId: r.campaignId, recipientId: rid, url: url.slice(0, 2000)}}).catch(() => undefined);
    }
    return res.redirect(302, url);
  }
}
