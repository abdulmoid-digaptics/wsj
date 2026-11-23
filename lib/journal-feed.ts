import {loadSite, text} from '@/lib/site';
import {absoluteUrl, authorName, excerptOf, JOURNAL_PATH, metaObject, newestFirst} from '@/components/journal/journal-data';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** RSS 2.0 feed of the latest published Journal posts (noindex posts are left out). */
export async function journalFeed(): Promise<Response> {
  const site = await loadSite();
  const cats = new Map((site.categories || []).map(c => [String(c.id), text(c.name)]));
  const posts = newestFirst(site.posts).filter(p => metaObject(p, 'seo').noindex !== true).slice(0, 30);
  const self = absoluteUrl('/feed/');
  const items = posts.map(p => {
    const url = absoluteUrl(p.path);
    const date = Date.parse(p.date || '');
    const categories = (p.categories || []).map(id => cats.get(String(id))).filter((n): n is string => Boolean(n) && !/^uncategori/i.test(n!));
    const image = p.featuredImage ? absoluteUrl(p.featuredImage) : '';
    return [
      '<item>',
      `<title>${esc(text(p.title))}</title>`,
      `<link>${esc(url)}</link>`,
      `<guid isPermaLink="true">${esc(url)}</guid>`,
      Number.isFinite(date) ? `<pubDate>${new Date(date).toUTCString()}</pubDate>` : '',
      `<dc:creator>${esc(authorName(p) || 'Workspace Junction')}</dc:creator>`,
      ...categories.map(c => `<category>${esc(c)}</category>`),
      `<description>${esc(excerptOf(p, 300))}</description>`,
      image ? `<enclosure url="${esc(image)}" type="${/\.png$/i.test(image) ? 'image/png' : /\.webp$/i.test(image) ? 'image/webp' : 'image/jpeg'}" length="0" />` : '',
      '</item>',
    ].filter(Boolean).join('');
  }).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>Workspace Junction Journal</title>
<link>${esc(absoluteUrl(JOURNAL_PATH))}</link>
<atom:link href="${esc(self)}" rel="self" type="application/rss+xml" />
<description>Guides and stories on coworking, business addresses, studios and growing a business in Oakbrook Terrace and Chicagoland.</description>
<language>en-us</language>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>`;
  return new Response(xml, {headers: {'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600'}});
}
