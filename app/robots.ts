import type {MetadataRoute} from 'next';
import {seoRuntime} from '@/lib/seo-runtime';
export const revalidate = 300;

const PRIVATE = ['/admin/', '/api/', '/account/', '/login/', '/activate/', '/reset-password/', '/forgot-password/', '/booking-confirmation/', '/journal-preview/'];
/* Crawler groups, per each operator's documentation (Nov 2026). The policy is set in Admin → SEO → AI crawlers.
   Search engines are always allowed. AI search indexes and user-initiated fetches are allowed by default so the
   business can be found and cited in AI answers. Google-Extended covers Gemini training and Gemini Apps grounding
   (not Google Search). Training-only crawlers are a separate business decision and are blocked unless enabled. */
const GROUPS = {
  search: ['Googlebot', 'Bingbot', 'Applebot', 'DuckDuckBot'],
  aiSearch: ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot'],
  aiUser: ['ChatGPT-User', 'Claude-User', 'Perplexity-User'],
  gemini: ['Google-Extended'],
  aiTraining: ['GPTBot', 'ClaudeBot', 'Applebot-Extended', 'CCBot', 'Meta-ExternalAgent'],
};

export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://workspacejunction.com').replace(/\/+$/, '');
  /* Staging, previews and local builds must never be indexed. */
  if (!/^https:\/\/(www\.)?workspacejunction\.com$/.test(site)) return {rules: [{userAgent: '*', disallow: '/'}]};
  const {crawlers} = await seoRuntime();
  const allowed = (group: keyof typeof GROUPS) => group === 'search' || Boolean(crawlers[group as Exclude<keyof typeof GROUPS, 'search'>]);
  const rules: MetadataRoute.Robots['rules'] = [];
  for (const group of Object.keys(GROUPS) as (keyof typeof GROUPS)[]) {
    const agents = GROUPS[group].filter(a => !crawlers.extraBlocked.includes(a));
    if (agents.length) rules.push(allowed(group) ? {userAgent: agents, allow: '/', disallow: PRIVATE} : {userAgent: agents, disallow: '/'});
  }
  if (crawlers.extraBlocked.length) rules.push({userAgent: crawlers.extraBlocked, disallow: '/'});
  rules.push({userAgent: '*', allow: '/', disallow: PRIVATE});
  return {rules, sitemap: site + '/sitemap.xml', host: site};
}