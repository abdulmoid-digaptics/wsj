/**
 * Site crawler and SEO checks. Reads the live sitemap and pages exactly as search engines receive them
 * (server-rendered HTML), so every finding reflects what is actually published.
 *
 * Scoring: each check is pass (1), warning (0.5) or fail (0); not-applicable checks are excluded.
 * Category score = mean of applicable checks x 100; overall = weighted mean over categories that have
 * applicable checks. This is an internal diagnostic, not a Google ranking or AI citation probability.
 */
import {CATEGORIES, CATEGORY_LABEL, type Category, type ScoreWeights, SITE_URL} from './seo-core';

export type CheckState = 'pass' | 'warn' | 'fail' | 'na';
export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type Check = {id: string; category: Category; label: string; state: CheckState; priority: Priority; detail?: string};
export type PageReport = {
  path: string; status: number; ms: number; bytes: number;
  title: string; description: string; canonical: string; robots: string; h1: string[]; headings: string[];
  words: number; schemaTypes: string[]; schemaErrors: string[]; ogImage: boolean; ogTitle: boolean;
  imgs: number; imgNoAlt: number; emptyLinks: number; lang: boolean; questionHeadings: number;
  internalLinks: string[]; inbound: number; checks: Check[];
};
export type AuditResult = {
  at: string; durationMs: number; pages: PageReport[];
  site: {checks: Check[]};
  broken: {from: string; to: string; status: number}[];
  redirectedLinks: {from: string; to: string; status: number}[];
  orphans: string[];
  score: {overall: number; categories: Record<string, {score: number | null; pass: number; warn: number; fail: number; na: number}>};
  counts: {pages: number; indexable: number; nonIndexable: number; missingTitle: number; missingDescription: number; duplicateTitles: number; duplicateDescriptions: number; canonicalIssues: number; schemaInvalid: number; broken: number};
};

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const strip = (s: string) => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (tag: string, name: string) => { const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i')); return m ? decode(m[2] ?? m[3] ?? '') : null; };
const meta = (html: string, key: string, by = 'name') => { for (const m of html.matchAll(/<meta\b[^>]*>/gi)) if ((attr(m[0], by) || '').toLowerCase() === key) return attr(m[0], 'content') || ''; return ''; };
const sitePath = (href: string) => { try { const u = new URL(href, SITE_URL + '/'); if (u.origin !== SITE_URL) return null; return u.pathname; } catch { return null; } };

/** Required properties per schema.org type, limited to what Google documents for rich results. */
const REQUIRED: Record<string, string[]> = {
  LocalBusiness: ['name', 'address'], Organization: ['name'], BreadcrumbList: ['itemListElement'], FAQPage: ['mainEntity'],
  BlogPosting: ['headline', 'datePublished', 'author'], Article: ['headline', 'datePublished', 'author'], Service: ['name', 'provider'],
  Event: ['name', 'startDate', 'location'], Product: ['name'], WebPage: ['url'], WebSite: ['url', 'name'], CollectionPage: ['url'], ItemList: ['itemListElement'],
};

export function analysePage(path: string, status: number, ms: number, html: string, opts: {inSitemap: boolean}): PageReport {
  const head = html.slice(0, html.search(/<\/head>/i) + 7 || 0) || html;
  const body = html.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
  const title = strip((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const description = meta(head, 'description');
  const canonicalTag = (head.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i) || [])[0];
  const canonical = canonicalTag ? (attr(canonicalTag, 'href') || '') : '';
  const robots = meta(head, 'robots');
  const headingTags = [...body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(m => ({level: Number(m[1]), text: strip(m[2])}));
  const h1 = headingTags.filter(h => h.level === 1).map(h => h.text);
  const words = strip(body.replace(/<(header|footer|nav)\b[\s\S]*?<\/\1>/gi, ' ')).split(' ').filter(w => /[a-z0-9]/i.test(w)).length;
  const schemaTypes: string[] = [], schemaErrors: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let json: any; try { json = JSON.parse(m[1]); } catch { schemaErrors.push('JSON-LD block does not parse'); continue; }
    if (!json['@context']) schemaErrors.push('JSON-LD block has no @context');
    const nodes: any[] = Array.isArray(json) ? json : json['@graph'] || [json];
    for (const n of nodes) {
      const types = ([] as string[]).concat(n?.['@type'] || []);
      if (!types.length) { schemaErrors.push('Entity without @type'); continue; }
      schemaTypes.push(...types);
      for (const t of types) for (const req of REQUIRED[t] || []) if (n[req] === undefined || n[req] === '' || (Array.isArray(n[req]) && !n[req].length)) schemaErrors.push(t + ' is missing ' + req);
      if (types.includes('FAQPage')) for (const q of n.mainEntity || []) if (!q?.name || !q?.acceptedAnswer?.text) schemaErrors.push('FAQPage question without name or answer');
    }
  }
  const imgTags = [...body.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  const imgNoAlt = imgTags.filter(t => attr(t, 'alt') === null && !/aria-hidden=["']true/.test(t) && !/role=["']presentation/.test(t)).length;
  const anchors = [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const emptyLinks = anchors.filter(a => !strip(a[2]) && !/aria-label=|title=/.test(a[1]) && !/<img\b[^>]*alt=["'][^"']+/.test(a[2])).length;
  const internalLinks = [...new Set(anchors.map(a => attr('<a ' + a[1] + '>', 'href') || '').filter(h => h && !h.startsWith('#') && !/^(mailto|tel|javascript):/i.test(h)).map(sitePath).filter((p): p is string => !!p && !p.startsWith('/_next/') && !p.startsWith('/api/')))];
  const questionHeadings = headingTags.filter(h => h.level >= 2 && /\?\s*$/.test(h.text)).length;
  const lang = /<html\b[^>]*\blang=["'][a-z]{2}/i.test(html);

  const checks: Check[] = [];
  const add = (id: string, category: Category, label: string, state: CheckState, priority: Priority, detail?: string) => checks.push({id, category, label, state, priority, detail});
  const noindex = /noindex/i.test(robots);
  const canonPath = canonical ? sitePath(canonical) : null;
  add('status', 'technical', 'Returns 200', status === 200 ? 'pass' : 'fail', 'critical', String(status));
  add('canonical', 'technical', 'Self-referencing canonical', !canonical ? 'fail' : canonPath === path ? 'pass' : 'warn', 'high', canonical ? 'Canonical: ' + canonical : 'No canonical tag');
  add('indexable', 'technical', 'Sitemap URL is indexable', !opts.inSitemap ? 'na' : noindex ? 'fail' : 'pass', 'critical', noindex ? 'noindex on a URL listed in the sitemap' : undefined);
  add('ttfb', 'performance', 'Server response under 800 ms', ms <= 800 ? 'pass' : ms <= 1800 ? 'warn' : 'fail', 'medium', ms + ' ms');
  add('html-size', 'performance', 'HTML under 1 MB', html.length <= 1_000_000 ? 'pass' : html.length <= 2_000_000 ? 'warn' : 'fail', 'low', Math.round(html.length / 1024) + ' KB');
  add('title', 'onpage', 'Has a title', title ? 'pass' : 'fail', 'critical');
  add('title-length', 'onpage', 'Title is 30 to 65 characters', !title ? 'na' : title.length >= 30 && title.length <= 65 ? 'pass' : 'warn', 'low', title.length + ' characters');
  add('description', 'onpage', 'Has a meta description', description ? 'pass' : 'fail', 'high');
  add('description-length', 'onpage', 'Description is 70 to 165 characters', !description ? 'na' : description.length >= 70 && description.length <= 165 ? 'pass' : 'warn', 'low', description.length + ' characters');
  add('h1', 'onpage', 'Exactly one H1', h1.length === 1 ? 'pass' : h1.length === 0 ? 'fail' : 'warn', 'high', h1.length + ' H1');
  let skips = 0; for (let i = 1; i < headingTags.length; i++) if (headingTags[i].level > headingTags[i - 1].level + 1) skips++;
  add('heading-order', 'onpage', 'Headings do not skip levels', skips === 0 ? 'pass' : skips <= 2 ? 'warn' : 'fail', 'low', skips + ' skipped levels');
  add('og', 'onpage', 'Social title and image', meta(head, 'og:image', 'property') && meta(head, 'og:title', 'property') ? 'pass' : 'warn', 'medium');
  add('words', 'content', 'At least 300 words of body content', words >= 300 ? 'pass' : words >= 150 ? 'warn' : 'fail', 'medium', words + ' words');
  add('h2', 'content', 'Content organised under H2 sections', headingTags.some(h => h.level === 2) ? 'pass' : 'warn', 'low');
  add('schema', 'schema', 'Structured data present', schemaTypes.length ? 'pass' : 'fail', 'medium', schemaTypes.join(', ') || 'none');
  add('schema-valid', 'schema', 'Structured data valid', !schemaTypes.length && !schemaErrors.length ? 'na' : schemaErrors.length ? 'fail' : 'pass', 'high', schemaErrors.slice(0, 5).join('; ') || undefined);
  add('entity', 'ai', 'Links to the business entity', /#business/.test(html) ? 'pass' : 'warn', 'medium');
  add('answers', 'ai', 'Answer-ready (FAQ or question headings)', schemaTypes.includes('FAQPage') || questionHeadings > 0 ? 'pass' : 'warn', 'low', questionHeadings + ' question headings');
  add('ssr', 'ai', 'Main content in server HTML', words >= 150 ? 'pass' : 'warn', 'high');
  add('alt', 'a11y', 'Images have alt text', !imgTags.length ? 'na' : imgNoAlt === 0 ? 'pass' : 'fail', 'medium', imgNoAlt + ' of ' + imgTags.length + ' missing');
  add('link-names', 'a11y', 'Links have accessible names', emptyLinks === 0 ? 'pass' : 'warn', 'low', emptyLinks + ' empty links');
  add('lang', 'a11y', 'Page language declared', lang ? 'pass' : 'fail', 'medium');
  return {path, status, ms, bytes: html.length, title, description, canonical, robots, h1, headings: headingTags.map(h => 'H' + h.level + ' ' + h.text.slice(0, 90)).slice(0, 60), words, schemaTypes: [...new Set(schemaTypes)], schemaErrors, ogImage: !!meta(head, 'og:image', 'property'), ogTitle: !!meta(head, 'og:title', 'property'), imgs: imgTags.length, imgNoAlt, emptyLinks, lang, questionHeadings, internalLinks, inbound: 0, checks};
}

export function scoreChecks(checks: Check[], weights: ScoreWeights) {
  const categories: AuditResult['score']['categories'] = {};
  let total = 0, weightSum = 0;
  for (const c of CATEGORIES) {
    const list = checks.filter(k => k.category === c);
    const applicable = list.filter(k => k.state !== 'na');
    const pass = list.filter(k => k.state === 'pass').length, warn = list.filter(k => k.state === 'warn').length, fail = list.filter(k => k.state === 'fail').length, na = list.length - applicable.length;
    const score = applicable.length ? Math.round((pass + warn * 0.5) / applicable.length * 100) : null;
    categories[c] = {score, pass, warn, fail, na};
    if (score !== null && weights[c] > 0) { total += score * weights[c]; weightSum += weights[c]; }
  }
  return {overall: weightSum ? Math.round(total / weightSum) : 0, categories};
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Crawl every sitemap URL (concurrency 4), then cross-page checks: duplicates, orphans, broken and redirected links. */
export async function runAudit(opts: {weights: ScoreWeights; fetcher?: Fetcher; limit?: number; extraPaths?: string[]}): Promise<AuditResult> {
  const started = Date.now();
  const f: Fetcher = opts.fetcher || ((u, i) => fetch(u, {...i, headers: {'user-agent': 'WSJ-SEO-Audit/1.0 (+' + SITE_URL + ')', ...(i?.headers || {})}, signal: AbortSignal.timeout(20000)}));
  const siteChecks: Check[] = [];
  const addSite = (id: string, category: Category, label: string, state: CheckState, priority: Priority, detail?: string) => siteChecks.push({id, category, label, state, priority, detail});

  /* Site-level resources */
  const get = async (p: string) => { try { const r = await f(SITE_URL + p, {redirect: 'manual'}); return {status: r.status, text: await r.text(), type: r.headers.get('content-type') || '', headers: r.headers}; } catch { return {status: 0, text: '', type: '', headers: new Headers()}; } };
  const [robots, sitemap, llms, http] = await Promise.all([get('/robots.txt'), get('/sitemap.xml'), get('/llms.txt'), f('http://' + new URL(SITE_URL).host + '/', {redirect: 'manual'}).then(r => ({status: r.status, loc: r.headers.get('location') || ''})).catch(() => ({status: 0, loc: ''}))]);
  addSite('robots', 'technical', 'robots.txt is reachable and lists the sitemap', robots.status === 200 && /sitemap:/i.test(robots.text) ? 'pass' : 'fail', 'critical');
  addSite('robots-open', 'technical', 'robots.txt does not block the whole site', /User-agent:\s*\*\s*\n(?:Allow:[^\n]*\n)*Disallow:\s*\/\s*$/im.test(robots.text) ? 'fail' : 'pass', 'critical');
  addSite('sitemap', 'technical', 'XML sitemap is valid', sitemap.status === 200 && /<urlset/.test(sitemap.text) ? 'pass' : 'fail', 'critical');
  addSite('https', 'technical', 'HTTP redirects to HTTPS', [301, 308].includes(http.status) && http.loc.startsWith('https://') ? 'pass' : 'fail', 'high', http.status + ' ' + http.loc);
  addSite('llms', 'ai', 'llms.txt published', llms.status === 200 ? 'pass' : 'warn', 'low');
  const www = await f('https://www.' + new URL(SITE_URL).host + '/', {redirect: 'manual'}).then(r => ({status: r.status, loc: r.headers.get('location') || ''})).catch(() => ({status: 0, loc: ''}));
  addSite('www', 'technical', 'www host redirects to the canonical host', www.status === 0 ? 'na' : [301, 308].includes(www.status) && www.loc.startsWith(SITE_URL) ? 'pass' : 'warn', 'medium', www.status + ' ' + www.loc);

  const sitemapPaths = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => sitePath(decode(m[1]))).filter((p): p is string => !!p);
  const inSitemap = new Set(sitemapPaths);
  const paths = [...new Set([...sitemapPaths, ...(opts.extraPaths || [])])].slice(0, opts.limit || 1000);
  addSite('sitemap-size', 'technical', 'Sitemap within protocol limits (50,000 URLs)', sitemapPaths.length && sitemapPaths.length <= 50000 ? 'pass' : 'fail', 'high', sitemapPaths.length + ' URLs');

  const pages: PageReport[] = [];
  let i = 0;
  const worker = async () => {
    while (i < paths.length) {
      const p = paths[i++];
      const t0 = Date.now();
      try {
        const r = await f(SITE_URL + p, {redirect: 'manual'});
        const html = r.status === 200 ? await r.text() : '';
        pages.push(analysePage(p, r.status, Date.now() - t0, html, {inSitemap: inSitemap.has(p)}));
      } catch { pages.push(analysePage(p, 0, Date.now() - t0, '', {inSitemap: inSitemap.has(p)})); }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  pages.sort((a, b) => a.path.localeCompare(b.path));

  /* Duplicates */
  const byTitle = new Map<string, string[]>(), byDesc = new Map<string, string[]>();
  for (const p of pages) { if (p.title) byTitle.set(p.title, [...(byTitle.get(p.title) || []), p.path]); if (p.description) byDesc.set(p.description, [...(byDesc.get(p.description) || []), p.path]); }
  for (const p of pages) {
    const dt = (byTitle.get(p.title) || []).filter(x => x !== p.path), dd = (byDesc.get(p.description) || []).filter(x => x !== p.path);
    p.checks.push({id: 'unique-title', category: 'onpage', label: 'Title is unique', state: !p.title ? 'na' : dt.length ? 'fail' : 'pass', priority: 'high', detail: dt.length ? 'Same as ' + dt.slice(0, 3).join(', ') : undefined});
    p.checks.push({id: 'unique-description', category: 'onpage', label: 'Description is unique', state: !p.description ? 'na' : dd.length ? 'warn' : 'pass', priority: 'medium', detail: dd.length ? 'Same as ' + dd.slice(0, 3).join(', ') : undefined});
  }

  /* Internal links: navigation links (on more than half of the pages) do not count as contextual inbound links. */
  const linkFreq = new Map<string, number>();
  for (const p of pages) for (const l of p.internalLinks) linkFreq.set(l, (linkFreq.get(l) || 0) + 1);
  const navLinks = new Set([...linkFreq].filter(([, n]) => n > pages.length / 2).map(([l]) => l));
  const inbound = new Map<string, number>();
  for (const p of pages) for (const l of p.internalLinks) if (!navLinks.has(l) && l !== p.path) inbound.set(l, (inbound.get(l) || 0) + 1);
  const orphans: string[] = [];
  for (const p of pages) {
    p.inbound = inbound.get(p.path) || 0;
    const nav = navLinks.has(p.path);
    if (!p.inbound && !nav && p.path !== '/') orphans.push(p.path);
    p.checks.push({id: 'inbound', category: 'links', label: 'Linked from other pages', state: p.path === '/' || nav ? 'pass' : p.inbound >= 2 ? 'pass' : p.inbound === 1 ? 'warn' : 'fail', priority: 'medium', detail: nav ? 'In site navigation' : p.inbound + ' contextual inbound links'});
    const out = p.internalLinks.filter(l => !navLinks.has(l)).length;
    p.checks.push({id: 'outbound', category: 'links', label: 'Links to related pages', state: out >= 3 ? 'pass' : out >= 1 ? 'warn' : 'fail', priority: 'low', detail: out + ' contextual links'});
  }

  /* Broken and redirected internal links (unique targets not already crawled, max 400 checks). */
  const crawled = new Map(pages.map(p => [p.path, p.status]));
  const targets = [...linkFreq.keys()].filter(l => !crawled.has(l) && !/\.(pdf|jpe?g|png|webp|svg|xml|txt|ico|js|css)$/i.test(l)).slice(0, 400);
  const targetStatus = new Map<string, {status: number; loc: string}>();
  let j = 0;
  const linkWorker = async () => { while (j < targets.length) { const t = targets[j++]; try { const r = await f(SITE_URL + t, {method: 'HEAD', redirect: 'manual'}); targetStatus.set(t, {status: r.status, loc: r.headers.get('location') || ''}); } catch { targetStatus.set(t, {status: 0, loc: ''}); } } };
  await Promise.all([linkWorker(), linkWorker(), linkWorker(), linkWorker()]);
  const broken: AuditResult['broken'] = [], redirectedLinks: AuditResult['redirectedLinks'] = [];
  for (const p of pages) {
    let pb = 0, pr = 0;
    for (const l of p.internalLinks) {
      const s = crawled.has(l) ? {status: crawled.get(l)!, loc: ''} : targetStatus.get(l);
      if (!s) continue;
      if (s.status >= 400 || s.status === 0) { broken.push({from: p.path, to: l, status: s.status}); pb++; }
      else if (s.status >= 300) { redirectedLinks.push({from: p.path, to: l, status: s.status}); pr++; }
    }
    p.checks.push({id: 'broken-links', category: 'links', label: 'No broken internal links', state: pb ? 'fail' : 'pass', priority: 'high', detail: pb ? pb + ' broken' : undefined});
    p.checks.push({id: 'redirected-links', category: 'technical', label: 'Links point to final URLs', state: pr ? 'warn' : 'pass', priority: 'low', detail: pr ? pr + ' links go through a redirect' : undefined});
  }

  const all = [...siteChecks, ...pages.flatMap(p => p.checks)];
  const score = scoreChecks(all, opts.weights);
  const dupT = [...byTitle.values()].filter(v => v.length > 1).reduce((n, v) => n + v.length, 0);
  const dupD = [...byDesc.values()].filter(v => v.length > 1).reduce((n, v) => n + v.length, 0);
  return {
    at: new Date().toISOString(), durationMs: Date.now() - started, pages, site: {checks: siteChecks}, broken, redirectedLinks, orphans, score,
    counts: {
      pages: pages.length, indexable: pages.filter(p => p.status === 200 && !/noindex/i.test(p.robots)).length, nonIndexable: pages.filter(p => p.status !== 200 || /noindex/i.test(p.robots)).length,
      missingTitle: pages.filter(p => !p.title).length, missingDescription: pages.filter(p => !p.description).length, duplicateTitles: dupT, duplicateDescriptions: dupD,
      canonicalIssues: pages.filter(p => p.checks.some(c => c.id === 'canonical' && c.state !== 'pass')).length, schemaInvalid: pages.filter(p => p.schemaErrors.length).length, broken: broken.length,
    },
  };
}

/** Compact findings list for the Audit Center: every non-passing check grouped by check id. */
export function findings(result: AuditResult) {
  const groups = new Map<string, {id: string; category: Category; categoryLabel: string; label: string; priority: Priority; state: CheckState; pages: {path: string; detail?: string}[]}>();
  const push = (path: string, c: Check) => {
    if (c.state === 'pass' || c.state === 'na') return;
    const key = c.id + ':' + c.state;
    const g = groups.get(key) || {id: c.id, category: c.category, categoryLabel: CATEGORY_LABEL[c.category], label: c.label, priority: c.state === 'warn' && c.priority === 'critical' ? 'high' : c.priority, state: c.state, pages: []};
    g.pages.push({path, detail: c.detail}); groups.set(key, g);
  };
  for (const c of result.site.checks) push('(site)', c);
  for (const p of result.pages) for (const c of p.checks) push(p.path, c);
  const order: Record<Priority, number> = {critical: 0, high: 1, medium: 2, low: 3};
  return [...groups.values()].sort((a, b) => order[a.priority] - order[b.priority] || (a.state === 'fail' ? -1 : 1) - (b.state === 'fail' ? -1 : 1) || b.pages.length - a.pages.length);
}
