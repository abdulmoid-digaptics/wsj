/**
 * Article HTML policy. The SAME file lives at lib/article/sanitize.ts in the website; a test keeps the
 * two byte-identical. The backend applies it when a blog post is saved, and the website applies it
 * again when rendering (defence in depth), so the editor preview and the public page share one policy.
 *
 * What survives: semantic structure (headings, lists, tables with merged cells, figures, details),
 * a small set of authored styles (colours, background, alignment, font size, borders, widths) and
 * video embeds from an explicit provider allowlist. Scripts, event handlers, forms, arbitrary iframes,
 * javascript:/data: URLs and unknown CSS are removed.
 */
import sanitizeHtml from 'sanitize-html';

const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(,\s*(0|1|0?\.\d+))?\s*\)$/i, /^hsla?\([\d.\s%,]+\)$/i, /^[a-z]{3,20}$/i, /^var\(--[a-z0-9-]{1,40}\)$/i];
const LENGTH = [/^\d{1,4}(\.\d{1,3})?(px|em|rem|%|pt|vw)?$/i, /^auto$/i];
const BORDER = [/^[\w\s#().,%-]{1,80}$/];

export const ARTICLE_EMBED_HOSTS = ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com'];

export const ARTICLE_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup', 'small', 'code', 'pre', 'kbd', 'abbr', 'cite', 'q',
    'blockquote', 'a', 'span', 'div', 'section', 'ul', 'ol', 'li', 'label', 'input',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'figure', 'figcaption', 'img', 'picture', 'video', 'source', 'iframe', 'details', 'summary',
  ],
  allowedAttributes: {
    '*': ['class', 'id', 'title', 'role', 'aria-label', 'aria-hidden', 'style', 'data-type', 'data-variant', 'data-columns', 'data-align', 'data-width', 'data-checked',
      'data-chart', 'data-code', 'data-provider', 'data-caption', 'data-layout', 'data-background', 'data-label', 'data-open', 'data-id', 'data-icon', 'data-highlight', 'dir', 'lang'],
    a: ['href', 'target', 'rel', 'name'],
    img: ['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding'],
    td: ['colspan', 'rowspan', 'colwidth', 'headers', 'scope'],
    th: ['colspan', 'rowspan', 'colwidth', 'headers', 'scope'],
    col: ['span', 'width'],
    ol: ['start', 'type', 'reversed'],
    li: ['value'],
    input: ['type', 'checked', 'disabled'],
    video: ['src', 'poster', 'controls', 'preload', 'playsinline', 'muted', 'loop', 'width', 'height'],
    source: ['src', 'type', 'srcset', 'media'],
    iframe: ['src', 'width', 'height', 'allow', 'allowfullscreen', 'loading', 'referrerpolicy', 'frameborder'],
    details: ['open'],
  },
  allowedStyles: {
    '*': {
      color: COLOR, 'background-color': COLOR, 'text-align': [/^(left|right|center|justify|start|end)$/],
      'font-size': LENGTH, 'font-weight': [/^(normal|bold|bolder|lighter|[1-9]00)$/], 'font-style': [/^(normal|italic)$/],
      'text-decoration': [/^[a-z\s-]{1,40}$/], 'vertical-align': [/^(top|middle|bottom|baseline)$/], 'line-height': LENGTH,
      border: BORDER, 'border-top': BORDER, 'border-right': BORDER, 'border-bottom': BORDER, 'border-left': BORDER,
      'border-color': COLOR, 'border-width': LENGTH, 'border-style': [/^(none|solid|dashed|dotted|double)$/], 'border-radius': LENGTH,
      width: LENGTH, 'min-width': LENGTH, 'max-width': LENGTH, height: LENGTH, padding: [/^[\d.\s(px|em|rem|%)]{1,40}$/], 'margin-left': LENGTH,
      'list-style-type': [/^[a-z-]{1,30}$/],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {img: ['http', 'https'], video: ['http', 'https'], source: ['http', 'https'], iframe: ['https']},
  allowProtocolRelative: false,
  allowedIframeHostnames: ARTICLE_EMBED_HOSTS,
  allowIframeRelativeUrls: false,
  transformTags: {
    a: (tag, attribs) => {
      const external = /^https?:\/\//i.test(attribs.href || '');
      return {tagName: 'a', attribs: {...attribs, ...(attribs.target === '_blank' || external ? {rel: 'noopener noreferrer'} : {})}};
    },
    input: (tag, attribs) => ({tagName: 'input', attribs: {type: 'checkbox', disabled: 'disabled', ...(attribs.checked !== undefined ? {checked: 'checked'} : {})}}),
    iframe: (tag, attribs) => ({tagName: 'iframe', attribs: {...attribs, loading: 'lazy', referrerpolicy: 'strict-origin-when-cross-origin', allowfullscreen: 'allowfullscreen'}}),
  },
  exclusiveFilter: frame => {
    /* Only provider embed players are allowed, never arbitrary pages on those hosts. */
    if (frame.tag === 'iframe') {
      const src = frame.attribs.src || '';
      return !/^https:\/\/((www\.)?youtube(-nocookie)?\.com\/embed\/[\w-]{6,20}|player\.vimeo\.com\/video\/\d{4,15})([?#][^"'<>\s]*)?$/.test(src);
    }
    if (frame.tag === 'input') return frame.attribs.type !== 'checkbox';
    return false;
  },
};

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(String(html || ''), ARTICLE_SANITIZE_OPTIONS);
}

/** Plain text of article HTML (for excerpts, search and reading time). */
export function articleText(html: string): string {
  return sanitizeHtml(String(html || '').replace(/<\/(p|h[1-6]|li|td|th|div|figcaption|blockquote)>/gi, ' $&'), {allowedTags: [], allowedAttributes: {}})
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

/** About 220 words a minute, plus 10 seconds per image. Never less than one minute. */
export function readingMinutes(html: string): number {
  const words = articleText(html).split(' ').filter(Boolean).length;
  const images = (String(html || '').match(/<img\b/gi) || []).length;
  return Math.max(1, Math.round(words / 220 + images / 6));
}

/** URL-safe slug from a title. */
export function slugify(value: string): string {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90).replace(/-+$/g, '');
}
