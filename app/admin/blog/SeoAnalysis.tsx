'use client';
/**
 * Live SEO and readability analysis for a Journal post (runs in the browser on every edit).
 * Scores 0-100 from weighted checks; each check says what to do in plain words.
 */
import {useMemo} from 'react';

export type SeoInput = {title: string; seoTitle: string; seoDesc: string; slug: string; html: string; keyword: string; featuredImage: string; featuredAlt: string; siteHost: string};
type Check = {id: string; label: string; status: 'good' | 'warn' | 'bad'; weight: number};

const words = (s: string) => s.toLowerCase().match(/[a-z0-9'’-]+/g) || [];
const strip = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const syllables = (w: string) => { const s = w.toLowerCase().replace(/[^a-z]/g, ''); if (s.length <= 3) return 1; const m = s.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g); return Math.max(1, m ? m.length : 1); };
/* Keyword matching ignores small filler words, so “podcast studio chicago” matches “Podcast Studio in Chicago”. */
const STOP = new Set(['a', 'an', 'and', 'the', 'in', 'of', 'for', 'to', 'on', 'at', 'with', 'by', 'or', 'your', 'our', 'is']);
const core = (s: string) => words(s).filter(w => !STOP.has(w));
const has = (hay: string, kw: string) => { const k = core(kw); if (!k.length) return false; const h = new Set(core(hay)); return k.every(w => h.has(w) || h.has(w.replace(/s$/, '')) || h.has(w + 's')); };

export function analyseSeo(i: SeoInput) {
  const kw = i.keyword.trim();
  const text = strip(i.html);
  const all = words(text);
  const wc = all.length;
  const firstPara = strip((i.html.match(/<p[\s>][\s\S]*?<\/p>/i) || [''])[0]);
  const subheads = [...i.html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)].map(m => strip(m[1]));
  const links = [...i.html.matchAll(/<a\s[^>]*href="([^"]+)"/gi)].map(m => m[1]);
  const internal = links.filter(h => h.startsWith('/') || h.includes(i.siteHost));
  const external = links.filter(h => /^https?:\/\//.test(h) && !h.includes(i.siteHost));
  const imgs = [...i.html.matchAll(/<img\s[^>]*>/gi)].map(m => m[0]);
  const noAlt = imgs.filter(t => !/\salt="[^"]+"/i.test(t)).length;
  const kwWords = core(kw);
  /* Occurrences: the keyword's words appearing together within a short window (filler words allowed between). */
  const content = all.filter(w => !STOP.has(w));
  let hits = 0;
  if (kwWords.length) for (let x = 0; x < content.length; x++) { const win = content.slice(x, x + kwWords.length + 1); if (kwWords.every(w => win.includes(w)) && content[x] === kwWords[0]) hits++; }
  const density = wc ? (hits * Math.max(1, kwWords.length) / wc) * 100 : 0;
  /* Each paragraph, heading, list item and cell ends a sentence even without a full stop. */
  const blockText = strip(i.html.replace(/<\/(p|h[1-6]|li|td|th|blockquote|figcaption|summary)>/gi, '. '));
  const sentences = blockText.split(/[.!?]+\s/).filter(s => words(s).length > 0);
  const avgSentence = sentences.length ? wc / sentences.length : 0;
  const syl = all.reduce((n, w) => n + syllables(w), 0);
  const flesch = wc && sentences.length ? Math.round(206.835 - 1.015 * (wc / sentences.length) - 84.6 * (syl / wc)) : 0;
  const longParas = [...i.html.matchAll(/<p[\s>][\s\S]*?<\/p>/gi)].filter(m => words(strip(m[0])).length > 150).length;
  const tl = i.seoTitle.length, dl = i.seoDesc.length;

  const checks: Check[] = [
    {id: 'kw', label: kw ? `Focus keyword: “${kw}”` : 'Add a focus keyword: the phrase people would search to find this article', status: kw ? 'good' : 'bad', weight: 2},
    ...(kw ? [
      {id: 'kw-title', label: has(i.seoTitle, kw) ? 'Keyword appears in the SEO title' : 'Put the focus keyword in the SEO title', status: has(i.seoTitle, kw) ? 'good' : 'bad', weight: 3},
      {id: 'kw-desc', label: has(i.seoDesc, kw) ? 'Keyword appears in the meta description' : 'Use the focus keyword in the meta description', status: has(i.seoDesc, kw) ? 'good' : 'warn', weight: 2},
      {id: 'kw-slug', label: has(i.slug.replace(/-/g, ' '), kw) ? 'Keyword appears in the URL' : 'Include the keyword in the URL slug', status: has(i.slug.replace(/-/g, ' '), kw) ? 'good' : 'warn', weight: 1},
      {id: 'kw-intro', label: has(firstPara, kw) ? 'Keyword appears in the first paragraph' : 'Mention the keyword in the first paragraph', status: has(firstPara, kw) ? 'good' : 'warn', weight: 2},
      {id: 'kw-sub', label: subheads.some(h => has(h, kw)) ? 'Keyword appears in a subheading' : 'Use the keyword in at least one H2 or H3 subheading', status: subheads.some(h => has(h, kw)) ? 'good' : 'warn', weight: 1},
      {id: 'kw-density', label: `Keyword density ${density.toFixed(1)}% (${hits}×)` + (density < 0.5 ? ': use it a few more times' : density > 2.5 ? ': too often, it reads as stuffing' : ''), status: density >= 0.5 && density <= 2.5 ? 'good' : hits ? 'warn' : 'bad', weight: 2},
    ] as Check[] : []),
    {id: 'title-len', label: `SEO title ${tl} characters` + (tl < 30 ? ': too short (aim for 30-65)' : tl > 65 ? ': will be cut off in Google (keep under 65)' : ''), status: tl >= 30 && tl <= 65 ? 'good' : 'warn', weight: 2},
    {id: 'desc-len', label: `Meta description ${dl} characters` + (dl < 70 ? ': too short (aim for 70-160)' : dl > 160 ? ': will be cut off (keep under 160)' : ''), status: dl >= 70 && dl <= 160 ? 'good' : dl ? 'warn' : 'bad', weight: 2},
    {id: 'length', label: `${wc} words` + (wc < 300 ? ': very short, aim for 600+' : wc < 600 ? ': fine, 600+ ranks better for guides' : ''), status: wc >= 600 ? 'good' : wc >= 300 ? 'warn' : 'bad', weight: 2},
    {id: 'h2', label: subheads.length ? `${subheads.length} subheadings` : 'Add H2 subheadings to break up the article', status: subheads.length >= 2 ? 'good' : subheads.length ? 'warn' : 'bad', weight: 1},
    {id: 'internal', label: internal.length ? `${internal.length} internal link${internal.length === 1 ? '' : 's'}` : 'Link to at least one other page on the site', status: internal.length ? 'good' : 'warn', weight: 1},
    {id: 'external', label: external.length ? `${external.length} outbound link${external.length === 1 ? '' : 's'}` : 'Consider linking to one trustworthy outside source', status: external.length ? 'good' : 'warn', weight: 1},
    {id: 'alt', label: imgs.length ? (noAlt ? `${noAlt} of ${imgs.length} images have no alt text` : 'All article images have alt text') : 'No images in the article body', status: imgs.length ? (noAlt ? 'bad' : 'good') : 'warn', weight: 1},
    {id: 'featured', label: i.featuredImage ? (i.featuredAlt ? 'Featured image has alt text' : 'Add alt text to the featured image') : 'Add a featured image (used on cards and social shares)', status: i.featuredImage && i.featuredAlt ? 'good' : i.featuredImage ? 'warn' : 'bad', weight: 1},
    {id: 'flesch', label: `Readability ${flesch}/100` + (flesch >= 50 ? ': easy to read' : flesch >= 30 ? ': fairly readable for business writing' : ': hard to read, use shorter sentences and simpler words'), status: flesch >= 50 ? 'good' : flesch >= 30 ? 'warn' : 'bad', weight: 1},
    {id: 'sentences', label: `Average sentence ${avgSentence.toFixed(0)} words` + (avgSentence > 20 ? ': try to stay under 20' : ''), status: avgSentence && avgSentence <= 20 ? 'good' : 'warn', weight: 1},
    {id: 'paras', label: longParas ? `${longParas} paragraph${longParas === 1 ? ' is' : 's are'} over 150 words: split them` : 'Paragraph lengths are comfortable', status: longParas ? 'warn' : 'good', weight: 1},
  ];
  const total = checks.reduce((n, c) => n + c.weight, 0);
  const got = checks.reduce((n, c) => n + (c.status === 'good' ? c.weight : c.status === 'warn' ? c.weight / 2 : 0), 0);
  return {score: Math.round((got / total) * 100), checks, words: wc, flesch};
}

export function SeoAnalysis({input, onKeyword}: {input: SeoInput; onKeyword: (value: string) => void}) {
  const result = useMemo(() => analyseSeo(input), [input]);
  const tone = result.score >= 80 ? 'good' : result.score >= 50 ? 'warn' : 'bad';
  const order = {bad: 0, warn: 1, good: 2} as const;
  return (
    <section className="bs-card bs-seo-analysis">
      <h4>SEO analysis</h4>
      <label className="bs-field"><span>Focus keyword</span><input value={input.keyword} maxLength={80} onChange={e => onKeyword(e.target.value)} placeholder="e.g. podcast studio chicago" /></label>
      <div className={'bs-seo-score is-' + tone} role="status" aria-label={'SEO score ' + result.score + ' out of 100'}>
        <span className="bs-seo-num">{result.score}</span><span className="bs-seo-of">/100</span>
        <span className="bs-seo-word">{tone === 'good' ? 'Good' : tone === 'warn' ? 'Needs work' : 'Poor'}</span>
      </div>
      <ul className="bs-seo-checks">
        {[...result.checks].sort((a, b) => order[a.status] - order[b.status]).map(c => <li key={c.id} className={'is-' + c.status}><span className="bs-seo-dot" aria-hidden="true" />{c.label}</li>)}
      </ul>
    </section>
  );
}
