/**
 * SEO management API, IndexNow submissions, scheduled monitoring and AI referral counters.
 * See seo-core.ts for the storage model and seo-audit.ts for the crawler and scoring.
 *
 * Access: reads and page-level edits need a staff session (ADMIN or EDITOR). Site-wide settings,
 * redirects, crawler policy and rollbacks are ADMIN only. Every change stores a full snapshot of the
 * previous configuration (ContentRevision), so any change can be rolled back from the dashboard.
 */
import {BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, Param, Post, Put, Query, Req, UseGuards} from '@nestjs/common';
import {Throttle} from '@nestjs/throttler';
import {createSign} from 'node:crypto';
import {AuthGuard, Db, Roles} from './core';
import {clearPublicCache} from './public';
import {CATEGORY_LABEL, CRAWLER_GROUPS, PRIVATE_PATHS, SITE_HOST, SITE_URL, SeoInputError, checkRedirects, cleanOverride, cleanRedirect, normaliseConfig, normalisePath, parseCsv, redirectsToCsv, runtimeView, type SeoConfig} from './seo-core';
import {type AuditResult, findings, runAudit} from './seo-audit';

type Actor = {user: {id: string; name?: string; email?: string; role: string}};
const AI_SOURCES: Record<string, RegExp> = {
  chatgpt: /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/, perplexity: /(^|\.)perplexity\.ai$/, gemini: /(^|\.)gemini\.google\.com$|(^|\.)bard\.google\.com$/,
  copilot: /(^|\.)copilot\.microsoft\.com$|(^|\.)edgeservices\.bing\.com$/, claude: /(^|\.)claude\.ai$/, grok: /(^|\.)grok\.com$|(^|\.)x\.ai$/, meta: /(^|\.)meta\.ai$/, deepseek: /(^|\.)chat\.deepseek\.com$/, you: /(^|\.)you\.com$/,
};
export const aiSourceFor = (host: string, utm = '') => { const h = host.toLowerCase(); for (const [k, re] of Object.entries(AI_SOURCES)) if (re.test(h) || (utm && re.test(utm.toLowerCase()))) return k; if (/^(chatgpt|openai|perplexity|gemini|copilot|claude)/i.test(utm)) return utm.toLowerCase().replace(/[^a-z].*$/, '').replace('openai', 'chatgpt'); return null; };
const day = (d = new Date()) => d.toISOString().slice(0, 10);
const wrap = <T>(fn: () => T): T => { try { return fn(); } catch (e) { if (e instanceof SeoInputError) throw new BadRequestException(e.message); throw e; } };

let seoInstance: SeoService | undefined;
/** Fire-and-forget IndexNow notification for content publish/update events (no-op when SEO is not loaded). */
export function notifySeoChange(paths: string[], reason: string, actorId?: string) { if (seoInstance && paths.length) void seoInstance.indexNow(paths, reason, actorId).catch(() => undefined); }

@Injectable()
export class SeoService implements OnModuleInit, OnModuleDestroy {
  private cache?: {at: number; cfg: SeoConfig; id: string};
  private timer?: NodeJS.Timeout;
  private auditRunning = false;
  private recentlySubmitted = new Map<string, number>();
  private lastScheduledCheck = new Date();
  constructor(@Inject(Db) private readonly db: Db) { seoInstance = this; }

  async regressions() { return this.db.audit.findMany({where: {resource: 'seo', action: 'SEO_REGRESSION'}, orderBy: {createdAt: 'desc'}, take: 5}); }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.SEO_WORKER === 'off') return;
    this.timer = setInterval(() => void this.tick().catch(e => console.warn('[seo] monitor tick failed', e instanceof Error ? e.message : e)), 15 * 60000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /* ───────── Config ───────── */
  async config(fresh = false): Promise<{cfg: SeoConfig; id: string}> {
    if (!fresh && this.cache && Date.now() - this.cache.at < 15000) return this.cache;
    let row = await this.db.content.findUnique({where: {kind_slug: {kind: 'seo', slug: 'config'}}});
    if (!row) {
      const cfg = normaliseConfig({});
      row = await this.db.content.upsert({where: {kind_slug: {kind: 'seo', slug: 'config'}}, create: {kind: 'seo', slug: 'config', title: 'SEO configuration', status: 'DRAFT', metadata: cfg as any}, update: {}});
    }
    this.cache = {at: Date.now(), cfg: normaliseConfig(row.metadata), id: row.id};
    return this.cache;
  }

  /** Serialised read-modify-write with a full snapshot of the previous state (history and rollback). */
  async update(req: Actor, reason: string, mutate: (cfg: SeoConfig) => void | string) {
    const {id} = await this.config(true);
    let summary = '';
    const next = await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('wsj-seo-config'))`;
      const row = await tx.content.findUniqueOrThrow({where: {id}});
      const before = normaliseConfig(row.metadata);
      const cfg = normaliseConfig(JSON.parse(JSON.stringify(before)));
      summary = wrap(() => mutate(cfg)) || reason;
      const {loops} = checkRedirects(cfg.redirects);
      if (loops.length) throw new BadRequestException('This change would create a redirect loop: ' + loops[0].join(' → '));
      await tx.contentRevision.create({data: {contentId: id, title: summary.slice(0, 200), slug: 'config', status: 'DRAFT', metadata: before as any, reason: 'seo:' + reason, actorId: req.user.id, actorName: req.user.name || req.user.email || 'staff'}});
      await tx.content.update({where: {id}, data: {metadata: cfg as any}});
      await tx.audit.create({data: {actorId: req.user.id, action: 'SEO_' + reason.toUpperCase().replace(/[^A-Z]+/g, '_'), resource: 'seo', resourceId: summary.slice(0, 180)}});
      return cfg;
    });
    this.cache = {at: Date.now(), cfg: next, id};
    clearPublicCache();
    return next;
  }

  async history(limit = 100) {
    const {id} = await this.config();
    const rows = await this.db.contentRevision.findMany({where: {contentId: id}, orderBy: {createdAt: 'desc'}, take: limit, select: {id: true, title: true, reason: true, actorName: true, createdAt: true}});
    return rows.map(r => ({id: r.id, summary: r.title, kind: r.reason.replace(/^seo:/, ''), by: r.actorName, at: r.createdAt}));
  }
  async revision(revId: string) {
    const {id} = await this.config();
    const rev = await this.db.contentRevision.findFirst({where: {id: revId, contentId: id}});
    if (!rev) throw new NotFoundException('Revision not found');
    return rev;
  }

  /* ───────── IndexNow ───────── */
  /** Submits eligible public URLs. Never private, redirected or noindex paths. Deduplicated for 10 minutes per URL. */
  async indexNow(paths: string[], reason: string, actorId?: string) {
    const {cfg} = await this.config();
    if (!cfg.indexNow.enabled) return {submitted: 0, skipped: paths.length, status: 'disabled'};
    if (!/^https:\/\//.test(SITE_URL) || /localhost|127\.0\.0\.1/.test(SITE_HOST) || process.env.NODE_ENV !== 'production') return {submitted: 0, skipped: paths.length, status: 'not-production'};
    const redirected = new Set(cfg.redirects.map(r => r.from));
    const now = Date.now();
    for (const [u, t] of this.recentlySubmitted) if (now - t > 600000) this.recentlySubmitted.delete(u);
    const eligible = [...new Set(paths.map(p => { try { return normalisePath(p); } catch { return ''; } }))].filter(p => p && !PRIVATE_PATHS.some(x => p.startsWith(x)) && !redirected.has(p) && cfg.pages[p]?.robots?.index !== false).map(p => SITE_URL + p).filter(u => !this.recentlySubmitted.has(u));
    if (!eligible.length) return {submitted: 0, skipped: paths.length, status: 'nothing-eligible'};
    let status = 'ok', code = 0, error = '';
    for (let i = 0; i < eligible.length; i += 1000) {
      const batch = eligible.slice(i, i + 1000);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await fetch('https://api.indexnow.org/indexnow', {method: 'POST', headers: {'content-type': 'application/json; charset=utf-8'}, body: JSON.stringify({host: SITE_HOST, key: cfg.indexNow.key, keyLocation: SITE_URL + '/indexnow-key.txt', urlList: batch}), signal: AbortSignal.timeout(15000)});
          code = r.status;
          if (r.status === 200 || r.status === 202) { status = 'ok'; batch.forEach(u => this.recentlySubmitted.set(u, now)); break; }
          status = 'rejected'; error = (await r.text().catch(() => '')).slice(0, 200);
          if (r.status !== 429 && r.status < 500) break;
        } catch (e) { status = 'error'; error = e instanceof Error ? e.message.slice(0, 200) : 'network error'; }
        await new Promise(res => setTimeout(res, 5000));
      }
    }
    await this.db.audit.create({data: {actorId: actorId || null, action: 'INDEXNOW', resource: 'seo', resourceId: status, details: {reason, count: eligible.length, httpStatus: code, error: error || undefined, sample: eligible.slice(0, 20)}}});
    return {submitted: status === 'ok' ? eligible.length : 0, skipped: paths.length - eligible.length, status, httpStatus: code, error: error || undefined};
  }
  async indexNowLog(limit = 50) {
    return this.db.audit.findMany({where: {resource: 'seo', action: 'INDEXNOW'}, orderBy: {createdAt: 'desc'}, take: limit, select: {id: true, resourceId: true, details: true, createdAt: true}});
  }

  /* ───────── Audit ───────── */
  async latestAudit(): Promise<{latest?: AuditResult & {psi?: Record<string, unknown>}; trend: {at: string; overall: number; categories: Record<string, number | null>}[]; psi: Record<string, unknown>}> {
    const row = await this.db.content.findUnique({where: {kind_slug: {kind: 'seo', slug: 'audit'}}});
    const m = (row?.metadata || {}) as any;
    return {latest: m.latest, trend: m.trend || [], psi: m.psi || {}};
  }
  async runAudit(actorId?: string) {
    if (this.auditRunning) throw new BadRequestException('An audit is already running');
    this.auditRunning = true;
    try {
      const {cfg} = await this.config();
      const result = await runAudit({weights: cfg.weights, extraPaths: Object.keys(cfg.pages)});
      const slim = {...result, pages: result.pages.map(({internalLinks, ...p}) => ({...p, links: internalLinks.length}))};
      const prev = await this.latestAudit();
      const point = {at: result.at, overall: result.score.overall, categories: Object.fromEntries(Object.entries(result.score.categories).map(([k, v]) => [k, v.score]))};
      const trend = [...prev.trend, point].slice(-90);
      await this.db.content.upsert({where: {kind_slug: {kind: 'seo', slug: 'audit'}}, create: {kind: 'seo', slug: 'audit', title: 'SEO audit', status: 'DRAFT', metadata: {latest: slim, trend, psi: prev.psi} as any}, update: {metadata: {latest: slim, trend, psi: prev.psi} as any}});
      await this.db.audit.create({data: {actorId: actorId || null, action: 'SEO_AUDIT', resource: 'seo', resourceId: String(result.score.overall), details: {pages: result.counts.pages, broken: result.counts.broken, ms: result.durationMs}}});
      const last = prev.latest;
      if (last && (result.score.overall <= last.score.overall - 5 || result.counts.broken > last.counts.broken || result.counts.nonIndexable > last.counts.nonIndexable + 2)) {
        await this.db.audit.create({data: {action: 'SEO_REGRESSION', resource: 'seo', resourceId: last.score.overall + '->' + result.score.overall, details: {brokenBefore: last.counts.broken, brokenNow: result.counts.broken, nonIndexableBefore: last.counts.nonIndexable, nonIndexableNow: result.counts.nonIndexable}}});
      }
      return slim;
    } finally { this.auditRunning = false; }
  }
  get running() { return this.auditRunning; }

  async savePsi(key: string, value: unknown) {
    const row = await this.db.content.findUnique({where: {kind_slug: {kind: 'seo', slug: 'audit'}}});
    const m = (row?.metadata || {}) as any;
    const psi = {...(m.psi || {}), [key]: value};
    await this.db.content.upsert({where: {kind_slug: {kind: 'seo', slug: 'audit'}}, create: {kind: 'seo', slug: 'audit', title: 'SEO audit', status: 'DRAFT', metadata: {trend: [], psi} as any}, update: {metadata: {...m, psi} as any}});
  }

  /** Every 15 minutes: notify IndexNow about scheduled posts that just went live; once a day (claimed across workers) run the audit. */
  async tick(now = new Date()) {
    const since = this.lastScheduledCheck; this.lastScheduledCheck = now;
    const live = await this.db.content.findMany({where: {kind: 'blog', status: 'PUBLISHED', publishAt: {gt: since, lte: now}}, select: {metadata: true, slug: true}});
    if (live.length) await this.indexNow(live.map(r => String((r.metadata as any)?.path || '/' + r.slug + '/')), 'scheduled-publish');
    const {cfg} = await this.config();
    if (now.getUTCHours() !== cfg.global.monitorHourUtc) return;
    const claimed = await this.db.$transaction(async tx => {
      const got = await tx.$queryRaw<{ok: boolean}[]>`SELECT pg_try_advisory_xact_lock(hashtext('wsj-seo-daily')) AS ok`;
      if (!got[0]?.ok) return false;
      const recent = await tx.audit.findFirst({where: {resource: 'seo', action: 'SEO_AUDIT_CLAIM', createdAt: {gt: new Date(now.getTime() - 20 * 3600000)}}});
      if (recent) return false;
      await tx.audit.create({data: {action: 'SEO_AUDIT_CLAIM', resource: 'seo'}});
      return true;
    });
    if (claimed) await this.runAudit();
  }

  /* ───────── AI referrals ───────── */
  async recordReferral(source: string, path: string) {
    const id = ['seo-ai', day(), source, path].join('|').slice(0, 250);
    await this.db.contentView.upsert({where: {contentId: id}, create: {contentId: id, views: 1}, update: {views: {increment: 1}}});
  }
  async referrals(days = 30) {
    const from = day(new Date(Date.now() - days * 86400000));
    const rows = await this.db.contentView.findMany({where: {contentId: {startsWith: 'seo-ai|', gte: 'seo-ai|' + from}}, select: {contentId: true, views: true}});
    const bySource: Record<string, number> = {}, byPath: Record<string, number> = {}, byDay: Record<string, number> = {};
    let total = 0;
    for (const r of rows) { const [, d, s, p] = r.contentId.split('|'); bySource[s] = (bySource[s] || 0) + r.views; byPath[p] = (byPath[p] || 0) + r.views; byDay[d] = (byDay[d] || 0) + r.views; total += r.views; }
    return {days, total, bySource, topPages: Object.entries(byPath).sort((a, b) => b[1] - a[1]).slice(0, 20), byDay};
  }
}

/* ───────── External integrations (server-side credentials only, read from env / System settings) ───────── */
function serviceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try { const json = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')); return json.client_email && json.private_key ? json as {client_email: string; private_key: string} : null; } catch { return null; }
}
async function googleToken(scope: string) {
  const sa = serviceAccount(); if (!sa) throw new BadRequestException('Google service account is not configured');
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = enc({alg: 'RS256', typ: 'JWT'}) + '.' + enc({iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600});
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key.replace(/\\n/g, '\n'), 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature}), signal: AbortSignal.timeout(10000)});
  if (!r.ok) throw new BadRequestException('Google rejected the service account (' + r.status + ')');
  return String((await r.json()).access_token);
}
export function integrationStatus() {
  const sa = serviceAccount();
  return {
    searchConsole: {connected: !!(sa && process.env.GSC_PROPERTY), needs: 'GOOGLE_SERVICE_ACCOUNT_JSON and GSC_PROPERTY in System settings → Search integrations, and the service-account email added as a user on the Search Console property.', account: sa?.client_email || null, property: process.env.GSC_PROPERTY || null},
    analytics: {connected: !!(sa && process.env.GA4_PROPERTY_ID), needs: 'GA4_PROPERTY_ID and the same service account added as Viewer on the GA4 property.', property: process.env.GA4_PROPERTY_ID || null},
    bing: {connected: !!process.env.BING_WEBMASTER_API_KEY, needs: 'BING_WEBMASTER_API_KEY from Bing Webmaster Tools → Settings → API access.'},
    pageSpeed: {connected: true, keyed: !!process.env.PAGESPEED_API_KEY, needs: 'Works without a key at a low shared quota; add PAGESPEED_API_KEY for reliable daily use.'},
    indexNow: {connected: true, needs: ''},
  };
}
async function searchConsole(days = 28) {
  const token = await googleToken('https://www.googleapis.com/auth/webmasters.readonly');
  const end = day(new Date(Date.now() - 2 * 86400000)), start = day(new Date(Date.now() - (days + 2) * 86400000));
  const q = async (dimensions: string[], rowLimit = 25) => {
    const r = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(process.env.GSC_PROPERTY!) + '/searchAnalytics/query', {method: 'POST', headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'}, body: JSON.stringify({startDate: start, endDate: end, dimensions, rowLimit}), signal: AbortSignal.timeout(15000)});
    if (!r.ok) throw new BadRequestException('Search Console returned ' + r.status + (r.status === 403 ? ': add the service-account email as a user on the property' : ''));
    return ((await r.json()).rows || []) as {keys?: string[]; clicks: number; impressions: number; ctr: number; position: number}[];
  };
  const [totals, queries, pages, devices, countries] = await Promise.all([q([], 1), q(['query']), q(['page']), q(['device'], 5), q(['country'], 10)]);
  return {range: {start, end}, totals: totals[0] || null, queries, pages, devices, countries};
}
async function analytics(days = 28) {
  const token = await googleToken('https://www.googleapis.com/auth/analytics.readonly');
  const r = await fetch('https://analyticsdata.googleapis.com/v1beta/properties/' + encodeURIComponent(process.env.GA4_PROPERTY_ID!) + ':runReport', {method: 'POST', headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'}, body: JSON.stringify({dateRanges: [{startDate: days + 'daysAgo', endDate: 'today'}], dimensions: [{name: 'sessionSource'}, {name: 'sessionMedium'}], metrics: [{name: 'sessions'}, {name: 'conversions'}], limit: 50}), signal: AbortSignal.timeout(15000)});
  if (!r.ok) throw new BadRequestException('Google Analytics returned ' + r.status);
  const rows = ((await r.json()).rows || []).map((x: any) => ({source: x.dimensionValues[0].value, medium: x.dimensionValues[1].value, sessions: Number(x.metricValues[0].value), conversions: Number(x.metricValues[1].value)}));
  return {days, organic: rows.filter((x: any) => x.medium === 'organic'), ai: rows.filter((x: any) => aiSourceFor(x.source, x.source)), all: rows};
}
async function bing() {
  const r = await fetch('https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats?siteUrl=' + encodeURIComponent(SITE_URL + '/') + '&apikey=' + encodeURIComponent(process.env.BING_WEBMASTER_API_KEY!), {signal: AbortSignal.timeout(15000)});
  if (!r.ok) throw new BadRequestException('Bing Webmaster Tools returned ' + r.status);
  const rows = ((await r.json()).d || []) as {Query: string; Clicks: number; Impressions: number; AvgImpressionPosition: number}[];
  return {queries: rows.sort((a, b) => b.Impressions - a.Impressions).slice(0, 25)};
}
async function pageSpeed(path: string, strategy: 'mobile' | 'desktop') {
  const u = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  u.searchParams.set('url', SITE_URL + path); u.searchParams.set('strategy', strategy);
  for (const c of ['performance', 'accessibility', 'seo', 'best-practices']) u.searchParams.append('category', c);
  if (process.env.PAGESPEED_API_KEY) u.searchParams.set('key', process.env.PAGESPEED_API_KEY);
  const r = await fetch(u, {signal: AbortSignal.timeout(90000)});
  if (!r.ok) throw new BadRequestException('PageSpeed Insights returned ' + r.status + (r.status === 429 ? ' (shared quota used up; add PAGESPEED_API_KEY)' : ''));
  const j = await r.json();
  const cats = j.lighthouseResult?.categories || {}, audits = j.lighthouseResult?.audits || {}, field = j.loadingExperience?.metrics || {};
  const pct = (k: string) => typeof cats[k]?.score === 'number' ? Math.round(cats[k].score * 100) : null;
  return {
    at: new Date().toISOString(), path, strategy,
    scores: {performance: pct('performance'), accessibility: pct('accessibility'), seo: pct('seo'), bestPractices: pct('best-practices')},
    lab: {lcp: audits['largest-contentful-paint']?.displayValue, cls: audits['cumulative-layout-shift']?.displayValue, tbt: audits['total-blocking-time']?.displayValue, fcp: audits['first-contentful-paint']?.displayValue},
    field: field.LARGEST_CONTENTFUL_PAINT_MS ? {lcpMs: field.LARGEST_CONTENTFUL_PAINT_MS?.percentile, inpMs: field.INTERACTION_TO_NEXT_PAINT?.percentile, cls: field.CUMULATIVE_LAYOUT_SHIFT_SCORE ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : undefined, category: j.loadingExperience?.overall_category} : null,
    opportunities: Object.values(audits).filter((a: any) => a.details?.type === 'opportunity' && typeof a.score === 'number' && a.score < 0.9).map((a: any) => ({title: a.title, savings: a.displayValue})).slice(0, 8),
    failedA11y: Object.values(audits).filter((a: any) => (cats.accessibility?.auditRefs || []).some((ref: any) => ref.id === a.id && ref.weight > 0) && a.score === 0).map((a: any) => a.title).slice(0, 10),
  };
}

/* ───────── Structured data inspector ───────── */
async function inspectSchema(path: string) {
  const r = await fetch(SITE_URL + path, {headers: {'user-agent': 'WSJ-SEO-Audit/1.0'}, signal: AbortSignal.timeout(20000)});
  const html = await r.text();
  const blocks = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => { try { return {ok: true, json: JSON.parse(m[1])}; } catch (e) { return {ok: false, error: e instanceof Error ? e.message : 'parse error', raw: m[1].slice(0, 500)}; } });
  const ids = new Map<string, number>();
  const entities: {type: string; id?: string; missing: string[]}[] = [];
  const REQ: Record<string, string[]> = {LocalBusiness: ['name', 'address', 'telephone', 'url'], BreadcrumbList: ['itemListElement'], FAQPage: ['mainEntity'], BlogPosting: ['headline', 'datePublished', 'author', 'image'], Service: ['name', 'provider'], WebPage: ['url', 'name'], WebSite: ['url', 'name'], CollectionPage: ['url', 'name'], ItemList: ['itemListElement']};
  const REC: Record<string, string[]> = {LocalBusiness: ['geo', 'openingHoursSpecification', 'image', 'priceRange', 'sameAs'], BlogPosting: ['dateModified', 'publisher', 'mainEntityOfPage'], Service: ['areaServed', 'description']};
  const warnings: string[] = [];
  for (const b of blocks) if (b.ok) for (const n of ((b as any).json['@graph'] || [(b as any).json]) as any[]) {
    const types = ([] as string[]).concat(n['@type'] || []);
    if (n['@id']) ids.set(n['@id'], (ids.get(n['@id']) || 0) + 1);
    const missing = types.flatMap(t => (REQ[t] || []).filter(k => n[k] === undefined));
    for (const t of types) for (const k of REC[t] || []) if (n[k] === undefined) warnings.push(t + ': recommended property ' + k + ' is missing');
    entities.push({type: types.join(', '), id: n['@id'], missing});
  }
  const duplicates = [...ids].filter(([, n]) => n > 1).map(([id]) => id);
  return {path, status: r.status, blocks, entities, duplicates, warnings, richResultsTest: 'https://search.google.com/test/rich-results?url=' + encodeURIComponent(SITE_URL + path), schemaValidator: 'https://validator.schema.org/#url=' + encodeURIComponent(SITE_URL + path)};
}

/* ───────── Controllers ───────── */
@Controller('admin/seo')
@UseGuards(AuthGuard)
@Roles('ADMIN', 'EDITOR')
export class SeoAdminController {
  constructor(@Inject(SeoService) private readonly seo: SeoService) {}

  @Get('overview') @Header('Cache-Control', 'no-store')
  async overview(@Req() req: Actor) {
    const [{cfg}, audit, log, refs, history] = await Promise.all([this.seo.config(true), this.seo.latestAudit(), this.seo.indexNowLog(20), this.seo.referrals(30), this.seo.history(15)]);
    const regressions = await this.seo.regressions();
    return {
      role: req.user.role, config: cfg, siteUrl: SITE_URL, crawlerGroups: CRAWLER_GROUPS, categoryLabels: CATEGORY_LABEL,
      audit: audit.latest ? {...audit.latest, findings: findings(audit.latest as AuditResult)} : null, trend: audit.trend, psi: audit.psi, auditRunning: this.seo.running,
      redirectHealth: checkRedirects(cfg.redirects), indexNowLog: log, aiReferrals: refs, history, regressions, integrations: integrationStatus(),
    };
  }

  @Put('pages') async savePage(@Body() body: any, @Req() req: Actor) {
    const path = wrap(() => normalisePath(body?.path));
    const override = wrap(() => cleanOverride(body?.override || {}, req.user.name || req.user.email || 'staff'));
    const cfg = await this.seo.update(req, 'page', c => { c.pages[path] = override; return 'Updated SEO for ' + path; });
    void this.seo.indexNow([path], 'page-seo-update', req.user.id).catch(() => undefined);
    return {path, override: cfg.pages[path]};
  }
  @Delete('pages') async resetPage(@Query('path') raw: string, @Req() req: Actor) {
    const path = wrap(() => normalisePath(raw));
    await this.seo.update(req, 'page', c => { delete c.pages[path]; return 'Reset SEO for ' + path + ' to defaults'; });
    return {path, reset: true};
  }

  @Put('global') @Roles('ADMIN') async saveGlobal(@Body() body: any, @Req() req: Actor) {
    return this.seo.update(req, 'global', c => {
      const g = body || {};
      if (typeof g.titleSuffix === 'string') c.global.titleSuffix = g.titleSuffix.replace(/[\u0000-\u001f]/g, '').slice(0, 40);
      if (typeof g.defaultDescription === 'string') c.global.defaultDescription = g.defaultDescription.replace(/\s+/g, ' ').trim().slice(0, 300);
      if (typeof g.defaultOgImage === 'string') { if (!/^https:\/\/[^\s"'<>]{5,500}$/.test(g.defaultOgImage)) throw new SeoInputError('Default social image must be an https URL'); c.global.defaultOgImage = g.defaultOgImage; }
      if (g.verification && typeof g.verification === 'object') for (const k of ['google', 'bing', 'yandex', 'pinterest'] as const) { const v = String(g.verification[k] ?? '').trim(); if (v && !/^[A-Za-z0-9_\-=.]{6,120}$/.test(v)) throw new SeoInputError('Verification codes contain only letters, digits, - _ = .'); if (v) c.global.verification[k] = v; else delete c.global.verification[k]; }
      if (Number.isInteger(g.monitorHourUtc) && g.monitorHourUtc >= 0 && g.monitorHourUtc <= 23) c.global.monitorHourUtc = g.monitorHourUtc;
      if (g.weights && typeof g.weights === 'object') for (const k of Object.keys(c.weights) as (keyof typeof c.weights)[]) { const v = Number(g.weights[k]); if (Number.isFinite(v) && v >= 0 && v <= 100) c.weights[k] = Math.round(v); }
      if (typeof g.indexNowEnabled === 'boolean') c.indexNow.enabled = g.indexNowEnabled;
      return 'Updated global SEO settings';
    });
  }
  @Put('crawlers') @Roles('ADMIN') async saveCrawlers(@Body() body: any, @Req() req: Actor) {
    return this.seo.update(req, 'crawlers', c => {
      for (const k of ['aiSearch', 'aiUser', 'gemini', 'aiTraining', 'llmsTxt'] as const) if (typeof body?.[k] === 'boolean') c.crawlers[k] = body[k];
      if (Array.isArray(body?.extraBlocked)) c.crawlers.extraBlocked = body.extraBlocked.map((x: unknown) => String(x).trim()).filter((x: string) => /^[A-Za-z0-9._-]{2,60}$/.test(x) && !(CRAWLER_GROUPS.search as readonly string[]).includes(x)).slice(0, 30);
      return 'Crawler policy: AI search ' + (c.crawlers.aiSearch ? 'on' : 'off') + ', user fetch ' + (c.crawlers.aiUser ? 'on' : 'off') + ', Gemini ' + (c.crawlers.gemini ? 'on' : 'off') + ', training ' + (c.crawlers.aiTraining ? 'on' : 'off');
    });
  }

  @Post('redirects') @Roles('ADMIN') async saveRedirect(@Body() body: any, @Req() req: Actor) {
    const cfg = await this.seo.update(req, 'redirect', c => {
      const existing = body?.id ? c.redirects.find(r => r.id === body.id) : undefined;
      if (body?.id && !existing) throw new SeoInputError('Redirect not found');
      const rule = cleanRedirect(body, req.user.name || req.user.email || 'staff', existing);
      if (c.redirects.some(r => r.from === rule.from && r.id !== rule.id)) throw new SeoInputError('A rule for ' + rule.from + ' already exists');
      c.redirects = existing ? c.redirects.map(r => r.id === rule.id ? rule : r) : [...c.redirects, rule];
      if (c.redirects.length > 2000) throw new SeoInputError('Too many redirect rules (2000 maximum)');
      return (existing ? 'Changed' : 'Added') + ' ' + rule.status + ' ' + rule.from + (rule.to ? ' → ' + rule.to : '');
    });
    const rule = cfg.redirects.find(r => r.from === wrap(() => normalisePath(body?.from)));
    if (rule) void this.seo.indexNow([rule.from, ...(rule.to.startsWith('/') ? [rule.to.split('?')[0]] : [])], 'redirect-change', req.user.id).catch(() => undefined);
    return {rule, health: checkRedirects(cfg.redirects)};
  }
  @Delete('redirects/:id') @Roles('ADMIN') async deleteRedirect(@Param('id') id: string, @Req() req: Actor) {
    await this.seo.update(req, 'redirect', c => { const r = c.redirects.find(x => x.id === id); if (!r) throw new SeoInputError('Redirect not found'); c.redirects = c.redirects.filter(x => x.id !== id); return 'Removed redirect ' + r.from; });
    return {deleted: true};
  }
  @Get('redirects/export') @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="redirects.csv"')
  async exportRedirects() { return redirectsToCsv((await this.seo.config(true)).cfg.redirects); }
  @Post('redirects/import') @Roles('ADMIN') async importRedirects(@Body() body: any, @Req() req: Actor) {
    const text = String(body?.csv || '');
    if (text.length > 500000) throw new BadRequestException('CSV is too large');
    const rows = parseCsv(text);
    const start = rows[0]?.[0]?.toLowerCase().trim() === 'from' ? 1 : 0;
    const errors: string[] = []; let added = 0, updated = 0;
    await this.seo.update(req, 'redirect-import', c => {
      for (const [i, row] of rows.slice(start).entries()) {
        try {
          const existing = c.redirects.find(r => { try { return r.from === normalisePath(row[0]); } catch { return false; } });
          const rule = cleanRedirect({from: row[0], to: row[1], status: row[2] || 301, note: row[3]}, req.user.name || 'staff', existing);
          if (existing) { c.redirects = c.redirects.map(r => r.id === existing.id ? rule : r); updated++; } else { c.redirects.push(rule); added++; }
        } catch (e) { errors.push('Row ' + (i + start + 1) + ': ' + (e instanceof Error ? e.message : 'invalid')); }
      }
      if (errors.length) throw new SeoInputError('Nothing imported. ' + errors.slice(0, 10).join('; '));
      return 'Imported redirects: ' + added + ' added, ' + updated + ' updated';
    });
    return {added, updated};
  }

  @Post('audit/run') @HttpCode(202) @Throttle({default: {limit: 4, ttl: 600000}})
  async runAudit(@Req() req: Actor) {
    if (this.seo.running) return {started: false, running: true};
    void this.seo.runAudit(req.user.id).catch(e => console.warn('[seo] audit failed', e instanceof Error ? e.message : e));
    return {started: true};
  }

  @Get('schema') async schema(@Query('path') raw: string) { return inspectSchema(wrap(() => normalisePath(raw))); }

  @Post('pagespeed') @Throttle({default: {limit: 10, ttl: 600000}})
  async psi(@Body() body: any) {
    const path = wrap(() => normalisePath(body?.path || '/'));
    const strategy = body?.strategy === 'desktop' ? 'desktop' : 'mobile';
    const result = await pageSpeed(path, strategy);
    await this.seo.savePsi(path + '|' + strategy, result);
    return result;
  }

  @Post('indexnow') @Roles('ADMIN') @Throttle({default: {limit: 6, ttl: 600000}})
  async submit(@Body() body: any, @Req() req: Actor) {
    let paths: string[] = Array.isArray(body?.paths) ? body.paths.map(String).slice(0, 10000) : [];
    if (body?.all === true) {
      const xml = await fetch(SITE_URL + '/sitemap.xml', {signal: AbortSignal.timeout(15000)}).then(r => r.text());
      paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname);
    }
    if (!paths.length) throw new BadRequestException('No URLs to submit');
    return this.seo.indexNow(paths, body?.all ? 'manual-full-sitemap' : 'manual', req.user.id);
  }

  @Get('history') async history() { return this.seo.history(200); }
  @Get('history/:id') async revision(@Param('id') id: string) { const r = await this.seo.revision(id); return {id: r.id, summary: r.title, at: r.createdAt, by: r.actorName, snapshot: r.metadata}; }
  @Post('history/:id/rollback') @Roles('ADMIN') async rollback(@Param('id') id: string, @Req() req: Actor) {
    const rev = await this.seo.revision(id);
    const restored = normaliseConfig(rev.metadata);
    await this.seo.update(req, 'rollback', c => { Object.assign(c, restored); return 'Rolled back to the state before: ' + rev.title; });
    return {rolledBack: true};
  }

  @Get('integrations/search-console') async gsc() { if (!integrationStatus().searchConsole.connected) throw new BadRequestException('Search Console is not connected'); return searchConsole(); }
  @Get('integrations/analytics') async ga() { if (!integrationStatus().analytics.connected) throw new BadRequestException('Google Analytics is not connected'); return analytics(); }
  @Get('integrations/bing') async bingStats() { if (!integrationStatus().bing.connected) throw new BadRequestException('Bing Webmaster Tools is not connected'); return bing(); }
}

/** Public, cacheable runtime data for the website (overrides, redirects, crawler policy). Contains nothing private. */
@Controller('public/seo')
export class PublicSeoController {
  constructor(@Inject(SeoService) private readonly seo: SeoService) {}
  @Get('runtime') @Header('Cache-Control', 'public, max-age=30')
  async runtime() { return runtimeView((await this.seo.config()).cfg); }

  /** Called server-side by the website proxy when a visit arrives from an AI assistant. Counts only (no IP, no cookies). */
  @Post('ai-referral') @HttpCode(204) @Throttle({default: {limit: 30, ttl: 60000}})
  async referral(@Body() body: any) {
    const source = String(body?.source || '');
    const path = String(body?.path || '');
    if (!/^[a-z]{2,12}$/.test(source) || !/^\/[a-z0-9/_.-]{0,150}$/i.test(path)) return;
    await this.seo.recordReferral(source, path.toLowerCase());
  }
}
