import {text, type Entry, type Category} from '@/lib/site';

/** Absolute site origin for canonicals, Open Graph and JSON-LD. Never a hardcoded production host in callers. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://workspacejunction.com').replace(/\/+$/, '');
export const absoluteUrl = (path?: string) => (!path ? SITE_URL : /^https?:\/\//.test(path) ? path : SITE_URL + (path.startsWith('/') ? path : '/' + path));
const API = () => process.env.API_URL || 'http://localhost:4000/api';

export const JOURNAL_PATH = '/blogs/';
export const PAGE_SIZE = 9;

/** Category/tag display name: fixes the migrated "bussiness" slug typo and title-cases each word. */
export function termName(name: string) {
  return text(name).replace(/\bbuss?iness\b/gi, 'Business').replace(/(^|[\s/-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
}
const meta = (p: Entry) => (p.meta || {}) as Record<string, unknown>;
export const metaString = (p: Entry, key: string) => { const v = meta(p)[key]; return typeof v === 'string' && v.trim() ? v.trim() : undefined; };
export const metaObject = (p: Entry, key: string) => { const v = meta(p)[key]; return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}; };

export const isFeatured = (p: Entry) => p.featured === true || meta(p).featured === true;
export const isPinned = (p: Entry) => meta(p).pinned === true;
export const featuredOrder = (p: Entry) => { const n = Number(meta(p).featuredOrder); return Number.isFinite(n) ? n : 9999; };
export const postTime = (p: Entry) => { const t = Date.parse(p.date || ''); return Number.isFinite(t) ? t : 0; };
export const subtitle = (p: Entry) => metaString(p, 'subtitle');
export const authorName = (p: Entry) => text(p.author || metaString(p, 'author') || '') || undefined;
export const authorAvatar = (p: Entry) => metaString(p, 'authorAvatar');
export const imageAlt = (p: Entry) => metaString(p, 'featuredImageAlt') || text(p.title);

/** Visible category (never the "Uncategorized" bucket, id 1). */
export function categoryOf(p: Entry, categories: Category[]) {
  return categories.find(c => String(c.id) !== '1' && !/^uncategori[sz]ed$/i.test(c.slug) && p.categories?.some(id => String(id) === String(c.id)));
}
export const visibleCategories = (categories: Category[]) => categories.filter(c => String(c.id) !== '1' && !/^uncategori[sz]ed/i.test(c.slug));

/** Reading time: author-provided, else ~220 words a minute. */
export function readingTime(p: Entry) {
  const stored = Number(meta(p).readingMinutes);
  if (Number.isFinite(stored) && stored > 0) return Math.round(stored);
  const words = text(p.content || '').split(' ').filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export const excerptOf = (p: Entry, max = 170) => {
  const raw = text(p.excerpt || p.content || '');
  return raw.length > max ? raw.slice(0, max).replace(/\s+\S*$/, '') + '…' : raw;
};

export function formatDate(value?: string, style: 'long' | 'short' = 'long') {
  const t = Date.parse(value || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-US', style === 'long' ? {month: 'long', day: 'numeric', year: 'numeric'} : {month: 'short', day: 'numeric', year: 'numeric'});
}

export const newestFirst = (posts: Entry[]) => [...posts].sort((a, b) => postTime(b) - postTime(a));

/** Featured posts by admin order, newest first within the same order. */
export const featuredPosts = (posts: Entry[]) => posts.filter(isFeatured).sort((a, b) => featuredOrder(a) - featuredOrder(b) || postTime(b) - postTime(a));

/** Same category or tag first (by overlap, then newest). Falls back to latest only when nothing shares taxonomy. */
export function relatedPosts(posts: Entry[], current: Entry, limit = 3): {items: Entry[]; related: boolean} {
  const ids = (list?: (string | number)[]) => new Set((list || []).map(String).filter(id => id !== '1'));
  const cats = ids(current.categories), tags = ids(current.tags);
  const score = (v: Entry) => (v.categories || []).filter(id => cats.has(String(id))).length * 2 + (v.tags || []).filter(id => tags.has(String(id))).length;
  const others = posts.filter(v => v.path !== current.path && String(v.id) !== String(current.id));
  const shared = others.map(v => ({v, s: score(v)})).filter(x => x.s > 0).sort((a, b) => b.s - a.s || postTime(b.v) - postTime(a.v)).map(x => x.v);
  if (shared.length) return {items: shared.slice(0, limit), related: true};
  return {items: newestFirst(others).slice(0, limit), related: false};
}

/** Popular posts from the view counter; empty when the endpoint is unavailable. */
export async function popularSlugs(limit = 5): Promise<string[]> {
  try {
    const r = await fetch(API() + '/public/blog-popular?limit=' + limit, {next: {revalidate: 300}, signal: AbortSignal.timeout(1500)});
    if (!r.ok) return [];
    const body = await r.json() as {items?: Array<{slug?: string}>};
    return (body.items || []).map(i => String(i.slug || '')).filter(Boolean);
  } catch { return []; }
}

/** Where an old article URL now lives (slug changed), or null. */
export async function resolveRedirect(path: string): Promise<string | null> {
  try {
    const r = await fetch(API() + '/public/blog-redirects/resolve?path=' + encodeURIComponent(path), {next: {revalidate: 60}, signal: AbortSignal.timeout(1500)});
    if (!r.ok) return null;
    const body = await r.json() as {to?: unknown};
    const to = typeof body.to === 'string' ? body.to : '';
    return /^\/[a-z0-9/_-]*$/i.test(to) && to !== path ? to : null;
  } catch { return null; }
}
