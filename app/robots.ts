import type {MetadataRoute} from 'next';
export const dynamic = 'force-static';

const PRIVATE = ['/admin/', '/api/', '/account/', '/login/', '/activate/', '/reset-password/', '/forgot-password/', '/booking-confirmation/', '/journal-preview/'];
/* Search engines and AI answer engines (ChatGPT, Claude, Perplexity, Gemini, Apple, Bing Copilot) are
   explicitly welcome on public pages, so the business can be cited in AI answers. Private areas stay closed. */
const AI_AND_SEARCH = ['Googlebot', 'Bingbot', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot', 'Applebot-Extended', 'DuckDuckBot', 'CCBot'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      ...AI_AND_SEARCH.map(userAgent => ({userAgent, allow: '/', disallow: PRIVATE})),
      {userAgent: '*', allow: '/', disallow: PRIVATE},
    ],
    sitemap: 'https://workspacejunction.com/sitemap.xml',
    host: 'https://workspacejunction.com',
  };
}
