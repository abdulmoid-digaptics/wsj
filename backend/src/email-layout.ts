/**
 * Branded HTML for every Workspace Junction email. Templates stay plain text (the source
 * of truth and the text/plain part); this converts them into an email-safe, table-based
 * layout with inline styles that render in Gmail, Outlook and Apple Mail.
 *
 * Conventions understood in the plain text:
 *  - blank line separates paragraphs;
 *  - a line ending in a URL, or a URL on its own line, becomes a button (the text before
 *    the URL, minus a trailing colon, is the button label);
 *  - "Label: value" lines that sit together become a details table;
 *  - the shared sign-off ("Workspace Junction" + phone/email) is replaced by the footer.
 */
const GREEN = '#0E3421';
const GOLD = '#D7902A';
const INK = '#1F2A24';
const MUTED = '#59665F';
const PAPER = '#F7F4ED';
const BRAND = {name: 'Workspace Junction', tagline: 'Work. Connect. Grow.', address: '1S280 Summit Ave Unit E2 Suite 1, Oakbrook Terrace, IL 60181', phone: '(773) 986-1908', email: 'grow@workspacejunction.com', web: 'https://workspacejunction.com'};

export const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const URL_RE = /(https?:\/\/[^\s<>"']+)/;
const SIGN_OFF_RE = /\n*Workspace Junction\n\(773\) 986-1908[^\n]*\s*$/;

function inline(text: string): string {
  /* Escape first, then linkify plain URLs left in running text. */
  return escapeHtml(text).replace(/(https?:\/\/[^\s<>"']+)/g, url => `<a href="${url}" style="color:${GREEN};text-decoration:underline">${url}</a>`).replace(/\n/g, '<br>');
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px"><tr><td style="border-radius:999px;background:${GOLD}"><a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 26px;font:700 15px/1 Arial,Helvetica,sans-serif;color:${GREEN};text-decoration:none;border-radius:999px">${escapeHtml(label)}</a></td></tr></table>`;
}

function detailsTable(rows: Array<[string, string]>): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 18px;border-collapse:collapse;background:${PAPER};border-radius:12px">${rows.map(([k, v], i) => `<tr><td style="padding:10px 16px;font:13px/1.5 Arial,Helvetica,sans-serif;color:${MUTED};width:38%;vertical-align:top;${i ? 'border-top:1px solid #E6E1D6;' : ''}">${escapeHtml(k)}</td><td style="padding:10px 16px;font:600 14px/1.5 Arial,Helvetica,sans-serif;color:${INK};vertical-align:top;${i ? 'border-top:1px solid #E6E1D6;' : ''}">${inline(v)}</td></tr>`).join('')}</table>`;
}

/** A clear call to action from where the link goes, never a vague "Open link". */
export function labelFor(url: string): string {
  let p = '';
  try { const u = new URL(url); p = (u.pathname + u.search).toLowerCase(); } catch { return 'Open'; }
  if (/newsletter\/confirm/.test(p)) return 'Confirm my subscription';
  if (/mode=login/.test(p)) return 'Sign in';
  if (/mode=email/.test(p)) return 'Confirm your new email';
  if (/reset-password/.test(p)) return 'Reset your password';
  if (/forgot-password/.test(p)) return 'Reset my password';
  if (/activate|setup|set-password/.test(p)) return 'Set up your account';
  if (/email.*(confirm|verify)|confirm-email/.test(p)) return 'Confirm your email';
  if (/claim/.test(p)) return 'Review the purchase';
  if (/login|sign-?in|magic|link/.test(p)) return 'Sign in';
  if (/billing|invoice/.test(p)) return 'Go to billing';
  if (/subscription/.test(p)) return 'View my subscriptions';
  if (/payment-methods|card/.test(p)) return 'Update payment card';
  if (/booking/.test(p)) return 'View my bookings';
  if (/\/admin/.test(p)) return 'Open admin';
  if (/\/account/.test(p)) return 'Open my account';
  return 'Visit Workspace Junction';
}

/** Convert one plain-text template body into branded HTML blocks. */
export function textToBlocks(text: string): string {
  const body = text.replace(/\r\n/g, '\n').replace(SIGN_OFF_RE, '').trim();
  const out: string[] = [];
  for (const para of body.split(/\n{2,}/)) {
    const lines = para.split('\n').map(line => line.trimEnd()).filter(Boolean);
    if (!lines.length) continue;
    /* A paragraph of "Label: value" lines is a details table. */
    const pairs = lines.map(line => /^([A-Z][A-Za-z ()/&-]{1,40}):\s+(.+)$/.exec(line));
    if (lines.length >= 2 && pairs.every(Boolean) && !lines.some(line => URL_RE.test(line))) {
      out.push(detailsTable(pairs.map(m => [m![1], m![2]])));
      continue;
    }
    let buffer: string[] = [];
    const flush = () => {
      if (buffer.length) out.push(`<p style="margin:0 0 16px;font:15px/1.65 Arial,Helvetica,sans-serif;color:${INK}">${inline(buffer.join('\n'))}</p>`);
      buffer = [];
    };
    for (const line of lines) {
      const match = /^(.*?)(https?:\/\/[^\s<>"']+?)[.,)]?\s*$/.exec(line);
      if (match) {
        const lead = match[1].trim().replace(/[:\-–]\s*$/, '').trim();
        const url = match[2];
        /* Short imperative leads ("Add a card here") become the label; sentences stay as text. */
        const short = lead && lead.length <= 42 && !/\b(at|to|here|via|on)$/i.test(lead) && !/[.,;]/.test(lead);
        if (lead && !short) buffer.push(lead.replace(/\s+(at|here)$/i, '') + (/[.!?]$/.test(lead) ? '' : ':'));
        flush();
        out.push(button(short ? lead : labelFor(url), url));
      } else buffer.push(line);
    }
    flush();
  }
  return out.join('\n');
}

export function brandedHtml(subject: string, text: string, opts: {preheader?: string; audience?: 'customer' | 'staff'} = {}): string {
  const staff = opts.audience === 'staff';
  const preheader = escapeHtml(opts.preheader ?? text.replace(/\s+/g, ' ').slice(0, 140));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preheader}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAPER}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:18px;overflow:hidden;border:1px solid #E3DED2">
<tr><td style="background:${GREEN};padding:26px 32px 22px">
<div style="font:800 20px/1.1 Arial,Helvetica,sans-serif;letter-spacing:1.5px;color:#FFFFFF">WORKSPACE <span style="color:${GOLD}">JUNCTION</span></div>
<div style="font:12px/1.4 Arial,Helvetica,sans-serif;color:#C9D6CF;margin-top:6px">${staff ? 'Team notification' : BRAND.tagline}</div>
</td></tr>
<tr><td style="height:4px;background:${GOLD};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:30px 32px 10px">
<h1 style="margin:0 0 18px;font:700 22px/1.3 Georgia,'Times New Roman',serif;color:${GREEN}">${escapeHtml(subject.replace(/^Workspace Junction:\s*/, ''))}</h1>
${textToBlocks(text)}
</td></tr>
<tr><td style="padding:0 32px 28px"><div style="border-top:1px solid #ECE7DC;padding-top:18px;font:13px/1.6 Arial,Helvetica,sans-serif;color:${MUTED}">
<strong style="color:${GREEN}">${BRAND.name}</strong><br>${BRAND.address}<br>
<a href="tel:+17739861908" style="color:${MUTED};text-decoration:none">${BRAND.phone}</a> &middot; <a href="mailto:${BRAND.email}" style="color:${MUTED}">${BRAND.email}</a> &middot; <a href="${BRAND.web}" style="color:${MUTED}">workspacejunction.com</a>
</div></td></tr>
</table>
<div style="font:11px/1.5 Arial,Helvetica,sans-serif;color:#8A938D;margin-top:14px;max-width:560px">${staff ? 'Internal message for the Workspace Junction team.' : 'You are receiving this email because of your Workspace Junction account or request.'}</div>
</td></tr></table>
</body></html>`;
}
