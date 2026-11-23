/**
 * One render pipeline for article HTML, used by the public article page and by the admin preview.
 * - v2 content (written by the block editor) goes through the article policy (lib/article/sanitize).
 * - Older imported posts keep the site's legacy pipeline (safeContent), which maps WordPress links
 *   and optimises local images, so nothing that was published before changes appearance.
 * Then headings get stable ids (for the table of contents) and chart blocks are drawn as SVG.
 */
import {sanitizeArticleHtml, articleText, readingMinutes} from './sanitize';
import {chartSvg, parseChart} from './chart';

export type ArticleHeading = {id: string; text: string; level: 2 | 3};
export type PreparedArticle = {html: string; headings: ArticleHeading[]; minutes: number; text: string};

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const strip = (s: string) => decode(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
export const headingSlug = (s: string) => strip(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';

/** Content stored for a post: v2 objects from the block editor, or older {html} / string values. */
export function articleSource(content: unknown): {html: string; v2: boolean} {
  if (typeof content === 'string') return {html: content, v2: false};
  if (content && typeof content === 'object') {
    const c = content as {html?: unknown; version?: unknown};
    return {html: typeof c.html === 'string' ? c.html : '', v2: c.version === 2};
  }
  return {html: '', v2: false};
}

/** Add ids to h2/h3, draw charts. Input must already be sanitized. */
export function finishArticle(clean: string): PreparedArticle {
  const used = new Map<string, number>();
  const headings: ArticleHeading[] = [];
  let html = clean.replace(/<h([23])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi, (_m, lvl: string, attrs = '', inner: string) => {
    const text = strip(inner);
    if (!text) return `<h${lvl}${attrs}>${inner}</h${lvl}>`;
    const existing = /\sid="([^"]+)"/.exec(attrs)?.[1];
    let id = existing || headingSlug(text);
    const n = used.get(id) || 0;
    used.set(id, n + 1);
    if (n && !existing) id = id + '-' + (n + 1);
    headings.push({id, text, level: Number(lvl) as 2 | 3});
    const rest = existing ? attrs : `${attrs} id="${id}"`;
    return `<h${lvl}${rest}>${inner}</h${lvl}>`;
  });
  html = html.replace(/<figure([^>]*\bdata-type="chart"[^>]*)>([\s\S]*?)<\/figure>/gi, (m, attrs: string, inner: string) => {
    const raw = /\bdata-chart="([^"]*)"/.exec(attrs)?.[1];
    const spec = raw ? parseChart(decode(raw)) : null;
    if (!spec) return m;
    const caption = /<figcaption[^>]*>[\s\S]*?<\/figcaption>/i.exec(inner)?.[0] || '';
    /* The data table stays for screen readers and no-SVG contexts. */
    const table = /<table[\s\S]*<\/table>/i.exec(inner)?.[0] || '';
    return `<figure${attrs}><div class="wj-chart">${chartSvg(spec)}</div>${table ? `<details class="wj-chart-data"><summary>View data</summary>${table}</details>` : ''}${caption}</figure>`;
  });
  return {html, headings, minutes: readingMinutes(clean), text: articleText(clean)};
}

/** Sanitize + finish for v2 content. Legacy content is passed in already cleaned by the caller. */
export function prepareArticle(content: unknown, legacyClean?: (html: string) => string): PreparedArticle {
  const {html, v2} = articleSource(content);
  const clean = v2 || !legacyClean ? sanitizeArticleHtml(html) : legacyClean(html);
  return finishArticle(clean);
}
