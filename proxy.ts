/**
 * Request proxy (Next 16 "proxy", formerly middleware). Two jobs, both cheap:
 * 1. Dashboard redirect rules (301/302/307/308) and 410 Gone, managed in Admin → SEO → Redirects.
 *    Rules are fetched from the API at most once a minute; if the API is down the last known rules are kept
 *    (or none), so the site never fails because of this layer. Code redirects in next.config run first.
 * 2. AI referral counting: when a page visit arrives from an AI assistant (ChatGPT, Perplexity, Gemini,
 *    Copilot, Claude...), a count of source + landing page is sent to the API. No IP, cookie or user data is stored.
 */
import {NextResponse, type NextFetchEvent, type NextRequest} from 'next/server';

const API = process.env.API_URL || 'http://localhost:4000/api';
type Rule = {to: string; status: number};
let cache: {at: number; rules: Map<string, Rule>} | undefined;
let pending: Promise<Map<string, Rule>> | undefined;

async function rules(): Promise<Map<string, Rule>> {
  if (cache && Date.now() - cache.at < 60000) return cache.rules;
  pending ??= (async () => {
    try {
      const r = await fetch(API + '/public/seo/runtime', {cache: 'no-store', signal: AbortSignal.timeout(800)});
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json() as {redirects?: {from: string; to: string; status: number}[]};
      const map = new Map<string, Rule>();
      for (const x of j.redirects || []) if (typeof x.from === 'string' && x.from.startsWith('/')) map.set(x.from, {to: x.to, status: x.status});
      cache = {at: Date.now(), rules: map};
    } catch { cache = {at: Date.now() - 30000, rules: cache?.rules || new Map()}; }
    pending = undefined;
    return cache!.rules;
  })();
  return pending;
}

const AI: [string, RegExp][] = [
  ['chatgpt', /(^|\.)(chatgpt\.com|chat\.openai\.com)$/], ['perplexity', /(^|\.)perplexity\.ai$/], ['gemini', /(^|\.)(gemini|bard)\.google\.com$/],
  ['copilot', /(^|\.)(copilot\.microsoft\.com|edgeservices\.bing\.com)$/], ['claude', /(^|\.)claude\.ai$/], ['grok', /(^|\.)(grok\.com|x\.ai)$/], ['meta', /(^|\.)meta\.ai$/], ['deepseek', /(^|\.)chat\.deepseek\.com$/], ['you', /(^|\.)you\.com$/],
];
function aiSource(req: NextRequest) {
  const utm = (req.nextUrl.searchParams.get('utm_source') || '').toLowerCase();
  let host = '';
  try { const ref = req.headers.get('referer'); if (ref) host = new URL(ref).hostname.toLowerCase(); } catch { /* bad referer */ }
  for (const [name, re] of AI) if ((host && re.test(host)) || (utm && re.test(utm))) return name;
  return null;
}

const GONE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Page removed | Workspace Junction</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui,sans-serif;max-width:640px;margin:15vh auto;padding:0 24px;color:#193c32"><h1>This page has been removed</h1><p>The content you are looking for is no longer available.</p><p><a href="/">Go to the Workspace Junction home page</a> or <a href="/contact-us/">contact us</a>.</p></body></html>';

export async function proxy(req: NextRequest, event: NextFetchEvent) {
  const path = req.nextUrl.pathname;
  const key = path.endsWith('/') || /\.[a-z0-9]{2,5}$/i.test(path) ? path : path + '/';
  const map = await rules();
  const hit = map.get(key);
  if (hit) {
    if (hit.status === 410) return new NextResponse(GONE, {status: 410, headers: {'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex', 'cache-control': 'public, max-age=300'}});
    if ([301, 302, 307, 308].includes(hit.status) && hit.to) {
      const dest = hit.to.startsWith('/') ? new URL(hit.to, req.nextUrl.origin) : new URL(hit.to);
      if (!hit.to.includes('?')) dest.search = req.nextUrl.search;
      return NextResponse.redirect(dest, hit.status);
    }
  }
  /* Count AI-assistant referrals on real page views only (not prefetches, RSC payloads or bots). */
  if (req.method === 'GET' && !req.headers.get('rsc') && !req.headers.get('next-router-prefetch') && req.headers.get('purpose') !== 'prefetch' && (req.headers.get('accept') || '').includes('text/html')) {
    const source = aiSource(req);
    if (source) {
      const ip = (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '').split(',')[0].trim();
      event.waitUntil(fetch(API + '/public/seo/ai-referral', {method: 'POST', headers: {'content-type': 'application/json', ...(ip ? {'x-forwarded-for': ip} : {})}, body: JSON.stringify({source, path: key.toLowerCase().slice(0, 150)}), signal: AbortSignal.timeout(1500)}).then(() => undefined, () => undefined));
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/|api/|uploads/|icons/|media/|favicon|sw\\.js|manifest|.*\\.(?:png|jpe?g|gif|webp|avif|svg|ico|css|js|map|woff2?|ttf|xml|json|webmanifest)$).*)'],
};
