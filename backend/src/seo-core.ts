/**
 * SEO core: pure helpers shared by the SEO controller, the scheduled monitor and tests.
 *
 * Storage (no schema migration needed):
 * - Content kind 'seo', slug 'config'  -> SeoConfig (page overrides, redirects, crawler policy, IndexNow key).
 *   Never exposed by the generic public content API ('seo' is not a public kind).
 * - Content kind 'seo', slug 'audit'   -> latest crawl audit + score trend.
 * - ContentRevision rows on the config -> change history and rollback (full snapshot before each change).
 * - Audit rows action INDEXNOW / SEO_AUDIT -> submission and monitoring logs.
 * - ContentView rows keyed 'seo-ai|day|source|path' -> AI referral counters (atomic increments, no personal data).
 */
import {randomBytes} from 'node:crypto';

export const SITE_URL = (process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://workspacejunction.com').replace(/\/+$/, '');
export const SITE_HOST = new URL(SITE_URL).host;

export type RobotsOverride = {index?: boolean; follow?: boolean};
export type PageOverride = {
  title?: string; description?: string; canonical?: string; robots?: RobotsOverride;
  ogTitle?: string; ogDescription?: string; ogImage?: string; breadcrumb?: string;
  primaryTopic?: string; secondaryTopics?: string[]; sitemap?: boolean;
  updatedAt?: string; updatedBy?: string;
};
export type RedirectStatus = 301 | 302 | 307 | 308 | 410;
export type RedirectRule = {id: string; from: string; to: string; status: RedirectStatus; note?: string; createdAt: string; createdBy?: string};
export type CrawlerPolicy = {aiSearch: boolean; aiUser: boolean; gemini: boolean; aiTraining: boolean; llmsTxt: boolean; extraBlocked: string[]};
export type GlobalSeo = {
  titleSuffix: string; defaultDescription: string; defaultOgImage: string;
  verification: {google?: string; bing?: string; yandex?: string; pinterest?: string};
  monitorHourUtc: number;
};
export type ScoreWeights = Record<Category, number>;
export type SeoConfig = {
  version: number;
  global: GlobalSeo;
  crawlers: CrawlerPolicy;
  pages: Record<string, PageOverride>;
  redirects: RedirectRule[];
  indexNow: {key: string; enabled: boolean};
  weights: ScoreWeights;
};

export const CATEGORIES = ['technical', 'onpage', 'content', 'schema', 'ai', 'performance', 'links', 'a11y'] as const;
export type Category = typeof CATEGORIES[number];
export const CATEGORY_LABEL: Record<Category, string> = {technical: 'Technical SEO', onpage: 'On-page SEO', content: 'Content and semantic quality', schema: 'Structured data', ai: 'AI and answer readiness', performance: 'Website performance', links: 'Internal linking', a11y: 'Accessibility'};
export const DEFAULT_WEIGHTS: ScoreWeights = {technical: 25, onpage: 20, content: 15, schema: 10, ai: 10, performance: 10, links: 5, a11y: 5};

/**
 * Crawler groups, from each operator's documentation (checked Nov 2026):
 * - Search (always allowed): Googlebot (also AI Overviews / AI Mode), Bingbot (also Copilot), Applebot, DuckDuckBot.
 * - AI search indexes: OAI-SearchBot (ChatGPT search), Claude-SearchBot, PerplexityBot.
 * - User-initiated fetches: ChatGPT-User, Claude-User, Perplexity-User (some operators say robots.txt may not apply).
 * - Gemini: Google-Extended is a control token covering Gemini training AND grounding in Gemini Apps; it does
 *   not affect Google Search or AI Overviews.
 * - Training only: GPTBot, ClaudeBot, Applebot-Extended, CCBot, Meta-ExternalAgent.
 */
export const CRAWLER_GROUPS = {
  search: ['Googlebot', 'Bingbot', 'Applebot', 'DuckDuckBot'],
  aiSearch: ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot'],
  aiUser: ['ChatGPT-User', 'Claude-User', 'Perplexity-User'],
  gemini: ['Google-Extended'],
  aiTraining: ['GPTBot', 'ClaudeBot', 'Applebot-Extended', 'CCBot', 'Meta-ExternalAgent'],
} as const;

export const PRIVATE_PATHS = ['/admin/', '/api/', '/account/', '/login/', '/activate/', '/reset-password/', '/forgot-password/', '/booking-confirmation/', '/journal-preview/'];

export function defaultConfig(): SeoConfig {
  return {
    version: 1,
    global: {titleSuffix: ' | Workspace Junction', defaultDescription: 'Coworking, meeting rooms, creative studios and business services in Oakbrook Terrace, Illinois.', defaultOgImage: 'https://pub-e4b4ffee7e0747098f49cc9765932cee.r2.dev/site/home/hero-coworking-hd.webp', verification: {}, monitorHourUtc: 9},
    /* Search and answer engines are allowed. Model training is a separate business decision and starts off. */
    crawlers: {aiSearch: true, aiUser: true, gemini: true, aiTraining: false, llmsTxt: true, extraBlocked: []},
    pages: {},
    redirects: [],
    indexNow: {key: randomBytes(16).toString('hex'), enabled: true},
    weights: {...DEFAULT_WEIGHTS},
  };
}

/** Merge a stored (possibly older) config over the defaults so new fields always exist. */
export function normaliseConfig(raw: unknown): SeoConfig {
  const d = defaultConfig();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SeoConfig>;
  return {
    version: Number(r.version) || 1,
    global: {...d.global, ...(r.global || {}), verification: {...(r.global?.verification || {})}},
    crawlers: {...d.crawlers, ...(r.crawlers || {}), extraBlocked: Array.isArray(r.crawlers?.extraBlocked) ? r.crawlers!.extraBlocked.filter(x => typeof x === 'string') : []},
    pages: r.pages && typeof r.pages === 'object' ? r.pages : {},
    redirects: Array.isArray(r.redirects) ? r.redirects : [],
    indexNow: {key: /^[a-f0-9]{32}$/.test(String(r.indexNow?.key || '')) ? r.indexNow!.key : d.indexNow.key, enabled: r.indexNow?.enabled !== false},
    weights: {...d.weights, ...(r.weights || {})},
  };
}

/* ───────────── Validation ───────────── */

export class SeoInputError extends Error {}
const bad = (m: string): never => { throw new SeoInputError(m); };

/** Site paths are lowercase-insensitive, start and end with '/', and never contain a scheme, host, query or dot segments. */
export function normalisePath(input: unknown): string {
  let p = String(input ?? '').trim();
  if (!p) bad('Path is required');
  try { if (/^https?:\/\//i.test(p)) { const u = new URL(p); if (u.host !== SITE_HOST && u.host !== 'www.' + SITE_HOST) bad('Only paths on ' + SITE_HOST + ' can be managed'); p = u.pathname; } } catch (e) { if (e instanceof SeoInputError) throw e; bad('Invalid URL'); }
  p = p.split('#')[0].split('?')[0];
  if (!p.startsWith('/')) p = '/' + p;
  if (/\/\.\.?(\/|$)|\/\/|[\s<>"'\\]/.test(p)) bad('Invalid path: ' + p.slice(0, 80));
  if (p.length > 300) bad('Path is too long');
  if (!/\.[a-z0-9]{2,5}$/i.test(p) && !p.endsWith('/')) p += '/';
  return p;
}

/** Redirect destinations: a site path, or an absolute https URL (validated, never javascript:/data:). Prevents open redirects to non-https. */
export function normaliseDestination(input: unknown): string {
  const v = String(input ?? '').trim();
  if (/^https:\/\//i.test(v)) {
    let u: URL; try { u = new URL(v); } catch { return bad('Invalid destination URL'); }
    if (u.username || u.password) bad('Destination must not contain credentials');
    if (u.host === SITE_HOST || u.host === 'www.' + SITE_HOST) return normalisePath(u.pathname) + u.search;
    return u.toString();
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) bad('Destination must be a site path or an https URL');
  const [p, q] = v.split('?');
  return normalisePath(p) + (q ? '?' + q.replace(/[^A-Za-z0-9=&%_.~+-]/g, '') : '');
}

const clip = (v: unknown, max: number) => { const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : undefined; };

export function cleanOverride(body: any, actor: string): PageOverride {
  const o: PageOverride = {};
  const t = clip(body?.title, 120); if (t) o.title = t;
  const d = clip(body?.description, 320); if (d) o.description = d;
  if (body?.canonical) { const c = String(body.canonical).trim(); o.canonical = /^https:\/\//i.test(c) ? normaliseDestination(c) : normalisePath(c); }
  if (body?.robots && typeof body.robots === 'object') {
    const r: RobotsOverride = {};
    if (typeof body.robots.index === 'boolean') r.index = body.robots.index;
    if (typeof body.robots.follow === 'boolean') r.follow = body.robots.follow;
    if (Object.keys(r).length) o.robots = r;
  }
  const ogT = clip(body?.ogTitle, 120); if (ogT) o.ogTitle = ogT;
  const ogD = clip(body?.ogDescription, 320); if (ogD) o.ogDescription = ogD;
  if (body?.ogImage) { const img = String(body.ogImage).trim(); if (!/^https:\/\/[^\s"'<>]{5,500}$/.test(img) && !/^\/[^\s"'<>]{1,300}$/.test(img)) bad('Social image must be an https URL or a site path'); o.ogImage = img; }
  const b = clip(body?.breadcrumb, 80); if (b) o.breadcrumb = b;
  const pt = clip(body?.primaryTopic, 120); if (pt) o.primaryTopic = pt;
  if (Array.isArray(body?.secondaryTopics)) { const s = body.secondaryTopics.map((x: unknown) => clip(x, 80)).filter(Boolean).slice(0, 12) as string[]; if (s.length) o.secondaryTopics = s; }
  if (typeof body?.sitemap === 'boolean') o.sitemap = body.sitemap;
  o.updatedAt = new Date().toISOString();
  o.updatedBy = actor;
  return o;
}

export function cleanRedirect(body: any, actor: string, existing?: RedirectRule): RedirectRule {
  const status = Number(body?.status ?? 301);
  if (![301, 302, 307, 308, 410].includes(status)) bad('Status must be 301, 302, 307, 308 or 410');
  const from = normalisePath(body?.from);
  if (PRIVATE_PATHS.some(p => from.startsWith(p)) || from.startsWith('/_next/')) bad('System paths cannot be redirected');
  if (from === '/') bad('The home page cannot be redirected');
  const to = status === 410 ? '' : normaliseDestination(body?.to);
  if (status !== 410 && to.split('?')[0] === from) bad('A redirect cannot point to itself');
  return {id: existing?.id || randomBytes(6).toString('hex'), from, to, status: status as RedirectStatus, note: clip(body?.note, 200), createdAt: existing?.createdAt || new Date().toISOString(), createdBy: existing?.createdBy || actor};
}

/** Follows internal redirect rules from `from`; returns the chain and whether it loops. */
export function redirectChain(rules: RedirectRule[], from: string, extra: Map<string, string> = new Map()) {
  const map = new Map<string, string>(extra);
  for (const r of rules) if (r.status !== 410) map.set(r.from, r.to);
  const chain = [from]; let cur = from;
  for (let i = 0; i < 20; i++) {
    const next = map.get(cur);
    if (!next || /^https:/.test(next)) { if (next) chain.push(next); return {chain, loop: false}; }
    const nextPath = next.split('?')[0];
    if (chain.includes(nextPath)) { chain.push(nextPath); return {chain, loop: true}; }
    chain.push(nextPath); cur = nextPath;
  }
  return {chain, loop: true};
}

/** Rejects a rule set containing loops; reports chains (more than one hop) for the dashboard. */
export function checkRedirects(rules: RedirectRule[], staticRedirects: Map<string, string> = new Map()) {
  const loops: string[][] = [], chains: string[][] = [];
  for (const r of rules) {
    if (r.status === 410) continue;
    const {chain, loop} = redirectChain(rules, r.from, staticRedirects);
    if (loop) loops.push(chain); else if (chain.length > 2) chains.push(chain);
  }
  return {loops, chains};
}

/* ───────────── CSV ───────────── */

const csvCell = (v: unknown) => { const s = String(v ?? ''); const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s; return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe; };
export function redirectsToCsv(rules: RedirectRule[]) {
  return ['from,to,status,note', ...rules.map(r => [r.from, r.to, r.status, r.note || ''].map(csvCell).join(','))].join('\n') + '\n';
}
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

/* ───────────── Public runtime view (what the website needs; no actor names) ───────────── */

export function runtimeView(cfg: SeoConfig) {
  const pages: Record<string, Omit<PageOverride, 'updatedAt' | 'updatedBy' | 'primaryTopic' | 'secondaryTopics'>> = {};
  for (const [p, o] of Object.entries(cfg.pages)) {
    const {updatedAt: _a, updatedBy: _b, primaryTopic: _c, secondaryTopics: _d, ...pub} = o;
    if (Object.keys(pub).length) pages[p] = pub;
  }
  return {
    global: cfg.global,
    crawlers: cfg.crawlers,
    pages,
    redirects: cfg.redirects.map(r => ({from: r.from, to: r.to, status: r.status})),
    indexNowKey: cfg.indexNow.enabled ? cfg.indexNow.key : null,
  };
}
