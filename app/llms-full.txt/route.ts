/**
 * /llms-full.txt: the complete, citation-ready reference for AI assistants (llmstxt.org convention, optional).
 * Generated from the same sources the pages render from: the /llms.txt summary (live catalog prices and FAQs),
 * the published page sections (headings, explanations, FAQs) and the journal index. Nothing here is hidden
 * from visitors, and nothing private (admin, accounts, unpublished content) is included.
 */
import {GET as summary} from '../llms.txt/route';
import {FIGMA_PAGES} from '@/lib/figma-pages';
import {PAGE_SEO, SITE_URL, indexable} from '@/lib/seo';
import {seoRuntime} from '@/lib/seo-runtime';
import {loadSite, text} from '@/lib/site';

export const revalidate = 3600;
const clean = (v: unknown) => text(String(v ?? '')).replace(/\s+/g, ' ').trim();

type Any = Record<string, unknown>;
function sectionLines(sec: Any): string[] {
  const out: string[] = [];
  const title = clean(sec.title);
  if (['hero', 'closing', 'banner', 'inquiry', 'gallery', 'series'].includes(String(sec.kind)) && !sec.lead) return out;
  if (title) out.push('', '### ' + title);
  if (sec.lead) out.push(clean(sec.lead));
  if (Array.isArray(sec.body)) for (const p of sec.body) out.push(clean(p));
  if (sec.heading || sec.text) out.push([clean(sec.heading), clean(sec.text)].filter(Boolean).join(': '));
  if (Array.isArray(sec.checks)) for (const c of sec.checks) out.push('- ' + clean(c));
  for (const key of ['items', 'highlights']) {
    const items = sec[key];
    if (!Array.isArray(items) || sec.kind === 'faq') continue;
    for (const it of items as Any[]) { const t = clean(it.title), d = clean(it.text); if (t || d) out.push('- ' + [t, d].filter(Boolean).join(': ')); }
  }
  if (sec.kind === 'faq' && Array.isArray(sec.items)) for (const q of sec.items as Any[]) if (q.q && q.a) out.push('', '**' + clean(q.q) + '**', clean(q.a));
  if (sec.kind === 'areas' && Array.isArray(sec.areas)) for (const a of sec.areas as Any[]) out.push('- ' + clean(a.name) + ': ' + clean(a.note));
  return out.filter(l => l !== '- ');
}

export async function GET() {
  const rt = await seoRuntime();
  if (!rt.crawlers.llmsTxt) return new Response('Not found', {status: 404});
  const head = await (await summary()).text();
  const lines: string[] = [head.trim(), '', '---', '', '# Page reference', 'Each section below mirrors a published page. Cite the page URL.'];
  const paths = Object.keys(FIGMA_PAGES).filter(p => indexable(p, rt)).sort();
  for (const path of paths) {
    const page = FIGMA_PAGES[path] as unknown as {title: string; description: string; sections: Any[]};
    const seo = PAGE_SEO[path];
    lines.push('', '## ' + clean(seo?.title?.replace(/\s*\|\s*Workspace Junction.*$/, '') || page.title), 'URL: ' + SITE_URL + path, clean(seo?.description?.replace('{from}', '') || page.description));
    for (const sec of page.sections) lines.push(...sectionLines(sec));
  }
  const site = await loadSite();
  const posts = site.posts.filter(p => indexable(p.path, rt)).sort((a, b) => Date.parse(b.date || '') - Date.parse(a.date || ''));
  lines.push('', '---', '', '# Journal articles', 'Guides published by Workspace Junction, newest first.');
  for (const p of posts) lines.push('- [' + clean(p.title).replace(/\s*[–-]\s*WorkSpace Junction$/i, '') + '](' + SITE_URL + p.path + ')' + (p.date ? ' (' + p.date.slice(0, 10) + ')' : '') + ': ' + clean(p.seo?.description || p.excerpt || '').slice(0, 220));
  lines.push('');
  return new Response(lines.join('\n').replace(/\n{3,}/g, '\n\n'), {headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Robots-Tag': 'noindex'}});
}