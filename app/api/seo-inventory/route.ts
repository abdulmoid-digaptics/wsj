import {NextResponse} from 'next/server';
import redirects from '@/data/redirects.json';
import {loadSite} from '@/lib/site';
import {FIGMA_PAGES, FIGMA_ONLY_PATHS} from '@/lib/figma-pages';
import {LEGACY_NOINDEX, PAGE_SEO, indexable, normPath} from '@/lib/seo';
import {seoRuntime} from '@/lib/seo-runtime';

/**
 * Complete route inventory for Admin → SEO (staff only; verified against /auth/me like /api/studio-revalidate).
 * Every known route is classified: indexable, non-indexable, redirected, private/admin, utility or legacy.
 */
const API = process.env.API_URL || 'http://localhost:4000/api';
const PRIVATE: [string, string][] = [['/admin/', 'Administrative'], ['/account/', 'Private or authenticated'], ['/login/', 'Utility or transactional'], ['/activate/', 'Utility or transactional'], ['/reset-password/', 'Utility or transactional'], ['/forgot-password/', 'Utility or transactional'], ['/booking-confirmation/', 'Utility or transactional'], ['/journal-preview/', 'Draft or unpublished'], ['/newsletter/confirm/', 'Utility or transactional'], ['/newsletter/unsubscribe/', 'Utility or transactional']];

export async function GET(request: Request) {
  const authorization = request.headers.get('authorization');
  const cookie = request.headers.get('cookie');
  if (!authorization && !cookie) return NextResponse.json({error: 'No session'}, {status: 401});
  try {
    const me = await fetch(API + '/auth/me', {headers: {...(authorization ? {authorization} : {}), ...(cookie ? {cookie} : {})}, cache: 'no-store', signal: AbortSignal.timeout(4000)});
    if (!me.ok) return NextResponse.json({error: 'Invalid session'}, {status: 401});
    if (!['ADMIN', 'EDITOR'].includes(String((await me.json())?.role || ''))) return NextResponse.json({error: 'Not permitted'}, {status: 403});
  } catch { return NextResponse.json({error: 'API unavailable'}, {status: 503}); }

  const [s, rt] = await Promise.all([loadSite(), seoRuntime()]);
  const rows = new Map<string, {path: string; title: string; source: string; classification: string; reason?: string; registry: boolean; override: boolean; modified?: string}>();
  const add = (path: string, title: string, source: string, modified?: string) => {
    const p = normPath(path);
    const ov = rt.pages[p];
    const rule = rt.redirects.find(r => r.from === p);
    let classification = 'Public and indexable', reason: string | undefined;
    if (rule) { classification = rule.status === 410 ? 'Broken or deprecated' : 'Redirected'; reason = rule.status + (rule.to ? ' → ' + rule.to : ' Gone'); }
    else if (ov?.canonical && normPath(ov.canonical.replace(/^https?:\/\/[^/]+/, '')) !== p) { classification = 'Canonical duplicate'; reason = 'Canonical: ' + ov.canonical; }
    else if (!indexable(p, rt)) { classification = 'Public but non-indexable'; reason = ov?.robots?.index === false ? 'noindex set in the dashboard' : LEGACY_NOINDEX.test(p) ? 'Legacy one-plan package page (plans live on the service page)' : 'Utility page'; }
    rows.set(p, {path: p, title, source, classification, reason, registry: !!PAGE_SEO[p], override: !!ov, modified});
  };
  for (const p of s.pages) add(p.path, p.title, 'page', p.modified);
  for (const p of s.posts) add(p.path, p.title, 'article', p.modified || p.date);
  for (const [p, page] of Object.entries(FIGMA_PAGES)) if (!rows.has(normPath(p))) add(p, page.title, FIGMA_ONLY_PATHS.includes(p) ? 'designed page' : 'designed page');
  for (const c of s.categories) add('/category/' + c.slug + '/', c.name, 'category archive');
  add('/blogs/', 'Journal', 'journal index');
  for (const r of redirects as {source: string; destination: string}[]) rows.set(normPath(r.source), {path: normPath(r.source), title: '', source: 'code redirect', classification: 'Redirected', reason: '301 → ' + r.destination, registry: false, override: false});
  for (const r of rt.redirects) if (!rows.has(r.from)) rows.set(r.from, {path: r.from, title: '', source: 'dashboard redirect', classification: r.status === 410 ? 'Broken or deprecated' : 'Redirected', reason: r.status + (r.to ? ' → ' + r.to : ' Gone'), registry: false, override: false});
  for (const [p, label] of PRIVATE) rows.set(p, {path: p, title: '', source: 'application route', classification: label, reason: 'Disallowed in robots.txt and sent with X-Robots-Tag: noindex', registry: false, override: false});
  const list = [...rows.values()].sort((a, b) => a.path.localeCompare(b.path));
  const counts: Record<string, number> = {};
  for (const r of list) counts[r.classification] = (counts[r.classification] || 0) + 1;
  return NextResponse.json({counts, routes: list}, {headers: {'Cache-Control': 'no-store'}});
}