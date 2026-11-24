/**
 * Admin-managed SEO runtime (titles, descriptions, robots, canonicals, social data, redirects, crawler policy).
 * Read from the API with a 60-second data cache. If the API is unavailable the site falls back to the code
 * defaults (lib/seo.ts), so search engines never see an error because of this layer.
 */
export type RuntimeOverride = {
  title?: string; description?: string; canonical?: string; robots?: {index?: boolean; follow?: boolean};
  ogTitle?: string; ogDescription?: string; ogImage?: string; breadcrumb?: string; sitemap?: boolean;
};
export type SeoRuntime = {
  global: {titleSuffix: string; defaultDescription: string; defaultOgImage: string; verification: {google?: string; bing?: string; yandex?: string; pinterest?: string}};
  crawlers: {aiSearch: boolean; aiUser: boolean; gemini: boolean; aiTraining: boolean; llmsTxt: boolean; extraBlocked: string[]};
  pages: Record<string, RuntimeOverride>;
  redirects: {from: string; to: string; status: number}[];
  indexNowKey: string | null;
};

export const EMPTY_RUNTIME: SeoRuntime = {
  global: {titleSuffix: ' | Workspace Junction', defaultDescription: 'Coworking, meeting rooms, creative studios and business services in Oakbrook Terrace, Illinois.', defaultOgImage: 'https://pub-e4b4ffee7e0747098f49cc9765932cee.r2.dev/site/home/hero-coworking-hd.webp', verification: {}},
  crawlers: {aiSearch: true, aiUser: true, gemini: true, aiTraining: false, llmsTxt: true, extraBlocked: []},
  pages: {}, redirects: [], indexNowKey: null,
};

const API = () => process.env.API_URL || 'http://localhost:4000/api';

export async function seoRuntime(): Promise<SeoRuntime> {
  try {
    const r = await fetch(API() + '/public/seo/runtime', {next: {revalidate: 60, tags: ['seo-runtime']}, signal: AbortSignal.timeout(2000)});
    if (!r.ok) return EMPTY_RUNTIME;
    const j = await r.json() as Partial<SeoRuntime>;
    return {...EMPTY_RUNTIME, ...j, global: {...EMPTY_RUNTIME.global, ...(j.global || {})}, crawlers: {...EMPTY_RUNTIME.crawlers, ...(j.crawlers || {})}, pages: j.pages || {}, redirects: j.redirects || []};
  } catch { return EMPTY_RUNTIME; }
}
