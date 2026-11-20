/**
 * Turns editor HTML into email-client-safe HTML (inline styles, no classes, no scripts) and wraps it
 * in the branded marketing layout with tracking and a compliant footer.
 */
import {createHmac, timingSafeEqual} from 'node:crypto';
import {sanitizeArticleHtml} from './article-sanitize';
import {parseChart} from './article-chart';

const GREEN = '#0E3421', GOLD = '#D7902A', INK = '#1F2A24', MUTED = '#59665F', PAPER = '#F7F4ED';
export const BUSINESS = {name: 'Workspace Junction', address: '1S280 Summit Ave Unit E2 Suite 1, Oakbrook Terrace, IL 60181'};
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function secret(purpose: string) { return (process.env.JWT_SECRET || '') + ':marketing:' + purpose; }
/** Unsubscribe/confirm tokens: subscriber id + HMAC. Unsubscribe links never expire, as the law requires them to keep working. */
export function subscriberToken(id: string, purpose: 'unsubscribe' | 'confirm', expiresAt?: number) {
  const body = id + (expiresAt ? '.' + expiresAt : '');
  return Buffer.from(body).toString('base64url') + '.' + createHmac('sha256', secret(purpose)).update(body).digest('base64url');
}
export function readSubscriberToken(token: string, purpose: 'unsubscribe' | 'confirm', now = Date.now()): string | null {
  const [b64, sig] = String(token || '').split('.');
  if (!b64 || !sig) return null;
  let body = '';
  try { body = Buffer.from(b64, 'base64url').toString('utf8'); } catch { return null; }
  const want = createHmac('sha256', secret(purpose)).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [id, exp] = body.split('.');
  if (exp && Number(exp) < now) return null;
  return /^[\w-]{8,64}$/.test(id) ? id : null;
}
/** Click links are signed so the tracker can never be used as an open redirect. */
export function linkSignature(recipientId: string, url: string) {
  return createHmac('sha256', secret('link')).update(recipientId + '\n' + url).digest('base64url').slice(0, 22);
}
export function linkSignatureValid(recipientId: string, url: string, sig: string) {
  const want = linkSignature(recipientId, url);
  return typeof sig === 'string' && sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

/** Inline-styled HTML for email clients from the article HTML the editor produces. */
export function emailBody(html: string, siteUrl = ''): string {
  let h = sanitizeArticleHtml(html);
  /* Email apps have no page to resolve relative links against: make site paths absolute. */
  if (siteUrl) h = h.replace(/\s(href|src|poster)="(\/(?!\/)[^"]*)"/gi, (_m, attr: string, p: string) => ' ' + attr + '="' + siteUrl.replace(/\/$/, '') + p + '"');
  /* Blocks email clients cannot run become simple equivalents. */
  h = h.replace(/<figure[^>]*data-type="chart"[^>]*data-chart="([^"]*)"[^>]*>[\s\S]*?<\/figure>/gi, (_m, raw: string) => {
    const spec = parseChart(decode(raw));
    if (!spec) return '';
    return '<p><strong>' + esc(spec.title || 'Chart') + '</strong></p><table>' + '<tr><th></th>' + spec.datasets.map(d => '<th>' + esc(d.label) + '</th>').join('') + '</tr>' + spec.labels.map((l, i) => '<tr><td>' + esc(l) + '</td>' + spec.datasets.map(d => '<td>' + esc(d.data[i]) + (spec.unit ? esc(spec.unit) : '') + '</td>').join('') + '</tr>').join('') + '</table>';
  });
  h = h.replace(/<div[^>]*data-type="mermaid"[^>]*>[\s\S]*?<\/div>/gi, '');
  h = h.replace(/<figure[^>]*data-type="embed"[^>]*>[\s\S]*?<iframe[^>]*src="([^"]+)"[\s\S]*?<\/figure>/gi, (_m, src: string) => {
    const yt = /youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,20})/.exec(src)?.[1];
    const url = yt ? 'https://www.youtube.com/watch?v=' + yt : src.replace('player.vimeo.com/video/', 'vimeo.com/');
    return yt ? `<p><a href="${esc(url)}"><img src="https://img.youtube.com/vi/${yt}/hqdefault.jpg" alt="Watch the video" width="536"></a></p>` : `<p><a href="${esc(url)}">▶ Watch the video</a></p>`;
  });
  h = h.replace(/<figure[^>]*data-type="video"[^>]*>[\s\S]*?<video[^>]*src="([^"]+)"[\s\S]*?<\/figure>/gi, (_m, src: string) => `<p><a href="${esc(src)}">▶ Watch the video</a></p>`);
  h = h.replace(/<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi, '<p><strong>$1</strong></p>$2');
  h = h.replace(/<\/?(section|div)([^>]*)>/gi, (m, tag: string, attrs: string) => (m.startsWith('</') ? '</div>' : `<div${/style="[^"]*"/.exec(attrs)?.[0] ? ' ' + /style="[^"]*"/.exec(attrs)![0] : ''}>`));
  const style = (tag: string, css: string) => { h = h.replace(new RegExp('<' + tag + '(\\s[^>]*)?>', 'gi'), (m, attrs = '') => { const own = /style="([^"]*)"/.exec(attrs)?.[1]; const rest = attrs.replace(/\s(style|class|data-[\w-]+)="[^"]*"/g, ''); return '<' + tag + rest + ' style="' + css + (own ? ';' + own : '') + '">'; }); };
  style('p', `margin:0 0 16px;font:16px/1.65 Arial,Helvetica,sans-serif;color:${INK}`);
  style('h1', `margin:24px 0 12px;font:700 28px/1.25 Georgia,serif;color:${GREEN}`);
  style('h2', `margin:24px 0 12px;font:700 24px/1.3 Georgia,serif;color:${GREEN}`);
  style('h3', `margin:20px 0 10px;font:700 19px/1.35 Georgia,serif;color:${GREEN}`);
  style('h4', `margin:18px 0 8px;font:700 16px/1.4 Arial,sans-serif;color:${GREEN}`);
  style('ul', 'margin:0 0 16px;padding-left:22px'); style('ol', 'margin:0 0 16px;padding-left:22px');
  style('li', `margin:0 0 6px;font:16px/1.6 Arial,Helvetica,sans-serif;color:${INK}`);
  style('blockquote', `margin:0 0 16px;padding:4px 0 4px 18px;border-left:3px solid ${GOLD};font:italic 18px/1.5 Georgia,serif;color:${GREEN}`);
  style('a', `color:${GREEN};text-decoration:underline`);
  style('img', 'max-width:100%;height:auto;border:0;border-radius:10px;display:block');
  style('table', 'width:100%;border-collapse:collapse;margin:0 0 16px');
  style('th', `border:1px solid #E6E1D6;padding:8px 10px;background:${PAPER};font:700 14px Arial,sans-serif;color:${GREEN};text-align:left`);
  style('td', `border:1px solid #E6E1D6;padding:8px 10px;font:14px/1.5 Arial,sans-serif;color:${INK}`);
  style('hr', 'border:0;border-top:1px solid #E6E1D6;margin:24px 0');
  style('figcaption', `font:13px Arial,sans-serif;color:${MUTED};text-align:center;margin-top:6px`);
  style('figure', 'margin:0 0 18px');
  h = h.replace(/\s(class|data-[\w-]+)="[^"]*"/g, '').replace(/<\/?(label|input|colgroup|col)[^>]*>/gi, '');
  return h;
}

export function personalize(text: string, v: {name: string; email: string; coupon?: string | null}, html = true) {
  const first = (v.name || '').trim().split(/\s+/)[0] || 'there';
  const map: Record<string, string> = {first_name: first, name: v.name || first, email: v.email, coupon: v.coupon || ''};
  return text.replace(/\{\{\s*(first_name|name|email|coupon)\s*\}\}/gi, (_m, k: string) => (html ? esc(map[k.toLowerCase()]) : map[k.toLowerCase()]));
}

export function trackLinks(html: string, recipientId: string, apiBase: string) {
  return html.replace(/href="(https?:\/\/[^"]+)"/gi, (_m, raw: string) => {
    const url = decode(raw);
    return 'href="' + esc(apiBase + '/public/m/c/' + recipientId + '?u=' + encodeURIComponent(url) + '&s=' + linkSignature(recipientId, url)) + '"';
  });
}

export function marketingHtml(o: {subject: string; preheader: string; body: string; coupon?: string | null; kind: string; unsubscribeUrl?: string; pixelUrl?: string; siteUrl: string}) {
  const coupon = o.coupon ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="border:2px dashed ${GOLD};border-radius:14px;padding:18px;text-align:center;background:#FFFBF2"><div style="font:700 12px Arial,sans-serif;letter-spacing:2px;color:#A86B14">YOUR CODE</div><div style="font:700 26px/1.3 'Courier New',monospace;color:${GREEN};letter-spacing:3px;margin-top:4px">${esc(o.coupon)}</div><div style="font:13px Arial,sans-serif;color:${MUTED};margin-top:6px">Enter it at checkout.</div></td></tr></table>` : '';
  const footer = o.kind === 'ANNOUNCEMENT'
    ? `You are receiving this service announcement because you have an account or a booking with ${BUSINESS.name}.`
    : `You are receiving this because you subscribed to ${BUSINESS.name} updates.${o.unsubscribeUrl ? ` <a href="${esc(o.unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline">Unsubscribe</a> at any time.` : ''}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER}"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #E3DED2">
<tr><td style="background:${GREEN};padding:24px 32px"><a href="${esc(o.siteUrl)}" style="text-decoration:none;font:800 20px Arial,sans-serif;letter-spacing:1.5px;color:#fff">WORKSPACE <span style="color:${GOLD}">JUNCTION</span></a></td></tr>
<tr><td style="height:4px;background:${GOLD};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:30px 32px 8px">${coupon}${o.body}</td></tr>
<tr><td style="padding:0 32px 28px"><div style="border-top:1px solid #ECE7DC;padding-top:18px;font:12px/1.6 Arial,sans-serif;color:${MUTED}"><strong style="color:${GREEN}">${BUSINESS.name}</strong><br>${BUSINESS.address}<br>${footer}</div></td></tr>
</table></td></tr></table>${o.pixelUrl ? `<img src="${esc(o.pixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">` : ''}</body></html>`;
}

/** Plain-text alternative. */
export function marketingText(html: string, unsubscribeUrl?: string) {
  const text = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h[1-6]|li|tr|blockquote|div)>/gi, '\n\n').replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)').replace(/<[^>]+>/g, '');
  return decode(text).replace(/\n{3,}/g, '\n\n').trim() + '\n\n' + BUSINESS.name + ', ' + BUSINESS.address + (unsubscribeUrl ? '\nUnsubscribe: ' + unsubscribeUrl : '');
}
