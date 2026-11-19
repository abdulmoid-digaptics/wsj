/**
 * Dependency-free, branded Workspace Junction invoice PDF (PDF 1.4, standard Helvetica fonts).
 * Text is restricted to WinAnsi-safe characters; everything is drawn with absolute
 * positions so the layout is deterministic and testable.
 */
export type InvoicePdfLine = {description: string; quantity?: number; amount: number};
export type InvoicePdfData = {
  number: string;
  status: string;
  issuedAt: Date;
  dueDate?: Date | null;
  paidAt?: Date | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  currency: string;
  customerName: string;
  customerEmail: string;
  customerAddress?: string[];
  lines: InvoicePdfLine[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  reference?: string | null;
};

const BRAND = {name: 'Workspace Junction', address: ['1S280 Summit Ave Unit E2 Suite 1', 'Oakbrook Terrace, IL 60181'], phone: '(773) 986-1908', email: 'grow@workspacejunction.com', web: 'workspacejunction.com'};
const GREEN: [number, number, number] = [0.055, 0.204, 0.129];
const GOLD: [number, number, number] = [0.843, 0.565, 0.165];
const INK: [number, number, number] = [0.13, 0.17, 0.15];
const MUTED: [number, number, number] = [0.42, 0.46, 0.44];
const RULE: [number, number, number] = [0.86, 0.85, 0.81];

/* Helvetica advance widths (1/1000 em) for accurate right alignment. */
const W: Record<string, number> = {' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015, '[': 278, ']': 278, '_': 556, '|': 260, '\u2013': 556, '\u00b7': 278, '\u2022': 350, '\u00d7': 584};
for (const c of '0123456789') W[c] = 556;
const UPPER: Record<string, number> = {A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611};
const LOWER: Record<string, number> = {a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500};
Object.assign(W, UPPER, LOWER);
/* Helvetica-Bold keeps digit and most punctuation widths; letters run about 6% wider. */
const width = (text: string, size: number, bold = false) => [...text].reduce((sum, c) => sum + (W[c] ?? 556) * (bold && /[A-Za-z]/.test(c) ? 1.06 : 1), 0) * size / 1000;

/** Keep WinAnsi-encodable characters; map common typography to WinAnsi bytes. */
function pdfText(value: string): string {
  const map: Record<string, string> = {'\u2013': '\\226', '\u2014': '\\227', '\u2018': '\\221', '\u2019': '\\222', '\u201c': '\\223', '\u201d': '\\224', '\u2022': '\\225', '\u00b7': '\\267', '\u00d7': '\\327', '\u00e9': '\\351', '\u00a9': '\\251'};
  let out = '';
  for (const c of String(value ?? '')) {
    if (map[c]) out += map[c];
    else if (c === '(' || c === ')' || c === '\\') out += '\\' + c;
    else if (c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127) out += c;
    else if (c.charCodeAt(0) >= 160 && c.charCodeAt(0) <= 255) out += '\\' + c.charCodeAt(0).toString(8).padStart(3, '0');
    else out += '?';
  }
  return out;
}

export function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {style: 'currency', currency: currency.toUpperCase()}).format(minor / 100);
  } catch {
    return (minor / 100).toFixed(2) + ' ' + currency.toUpperCase();
  }
}
const day = (value?: Date | null) => (value ? new Intl.DateTimeFormat('en-US', {dateStyle: 'medium', timeZone: 'America/Chicago'}).format(value) : '');

/** Wrap text to a maximum width in points. */
function wrap(text: string, size: number, max: number): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? current + ' ' + word : word;
    if (width(next, size) <= max || !current) current = next;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

export function buildInvoicePdf(data: InvoicePdfData): Buffer {
  const ops: string[] = [];
  const pageW = 612, pageH = 792, left = 54, right = pageW - 54;
  const fill = (c: [number, number, number]) => ops.push(c.map(v => v.toFixed(3)).join(' ') + ' rg');
  const stroke = (c: [number, number, number]) => ops.push(c.map(v => v.toFixed(3)).join(' ') + ' RG');
  const rect = (x: number, y: number, w: number, h: number, c: [number, number, number]) => { fill(c); ops.push(`${x} ${y} ${w} ${h} re f`); };
  const line = (x1: number, y1: number, x2: number, y2: number, c = RULE, w = 0.75) => { stroke(c); ops.push(`${w} w ${x1} ${y1} m ${x2} ${y2} l S`); };
  const text = (value: string, x: number, y: number, size: number, opts: {bold?: boolean; color?: [number, number, number]; align?: 'left' | 'right'} = {}) => {
    fill(opts.color ?? INK);
    const tx = opts.align === 'right' ? x - width(value, size, opts.bold) : x;
    ops.push(`BT /${opts.bold ? 'F2' : 'F1'} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td (${pdfText(value)}) Tj ET`);
  };

  /* Header band with wordmark and document title. */
  rect(0, pageH - 118, pageW, 118, GREEN);
  rect(0, pageH - 122, pageW, 4, GOLD);
  text('WORKSPACE', left, pageH - 58, 22, {bold: true, color: [1, 1, 1]});
  text('JUNCTION', left, pageH - 82, 22, {bold: true, color: GOLD});
  text('Work. Connect. Grow.', left, pageH - 100, 9, {color: [0.82, 0.88, 0.84]});
  text('INVOICE', right, pageH - 62, 26, {bold: true, color: [1, 1, 1], align: 'right'});
  text(data.number, right, pageH - 82, 11, {color: [0.82, 0.88, 0.84], align: 'right'});

  /* Status pill. */
  const paid = data.status === 'paid';
  const label = paid ? 'PAID' : data.status === 'open' ? 'PAYMENT DUE' : data.status.toUpperCase();
  const pillW = width(label, 9, true) + 22;
  rect(right - pillW, pageH - 108, pillW, 16, paid ? [0.82, 0.92, 0.85] : [0.99, 0.93, 0.80]);
  text(label, right - pillW / 2 + width(label, 9, true) / 2, pageH - 103, 9, {bold: true, color: paid ? GREEN : [0.55, 0.36, 0.05], align: 'right'});

  /* From / bill to / details columns. */
  let y = pageH - 160;
  text('FROM', left, y, 8, {bold: true, color: MUTED});
  text('BILL TO', left + 190, y, 8, {bold: true, color: MUTED});
  text('DETAILS', left + 370, y, 8, {bold: true, color: MUTED});
  y -= 16;
  const from = [BRAND.name, ...BRAND.address, BRAND.phone, BRAND.email];
  const to = [data.customerName || data.customerEmail, ...(data.customerName ? [data.customerEmail] : []), ...(data.customerAddress ?? [])].slice(0, 6);
  const details: Array<[string, string]> = [['Issued', day(data.issuedAt)], ...(data.dueDate ? [['Due', day(data.dueDate)] as [string, string]] : []), ...(data.paidAt ? [['Paid', day(data.paidAt)] as [string, string]] : []), ...(data.periodStart && data.periodEnd ? [['Service from', day(data.periodStart)] as [string, string], ['Service to', day(data.periodEnd)] as [string, string]] : []), ['Currency', data.currency.toUpperCase()]];
  from.forEach((v, i) => text(v, left, y - i * 14, 10, {bold: i === 0}));
  to.forEach((v, i) => text(v, left + 190, y - i * 14, 10, {bold: i === 0}));
  details.forEach(([k, v], i) => { text(k, left + 370, y - i * 14, 9, {color: MUTED}); text(v, right, y - i * 14, 9, {align: 'right'}); });
  y -= Math.max(from.length, to.length, details.length) * 14 + 22;

  /* Line items table. */
  rect(left, y - 6, right - left, 22, [0.95, 0.94, 0.90]);
  text('DESCRIPTION', left + 10, y + 1, 8, {bold: true, color: MUTED});
  text('QTY', right - 130, y + 1, 8, {bold: true, color: MUTED, align: 'right'});
  text('AMOUNT', right - 10, y + 1, 8, {bold: true, color: MUTED, align: 'right'});
  y -= 26;
  const items = data.lines.length ? data.lines : [{description: 'Workspace Junction services', amount: data.total}];
  for (const item of items) {
    const rows = wrap(item.description || 'Item', 10, right - left - 170);
    rows.forEach((row, i) => text(row, left + 10, y - i * 13, 10));
    text(String(item.quantity ?? 1), right - 130, y, 10, {align: 'right'});
    text(formatMoney(item.amount, data.currency), right - 10, y, 10, {align: 'right'});
    y -= rows.length * 13 + 8;
    line(left, y + 4, right, y + 4);
    y -= 8;
    if (y < 220) break; // keep the totals on the page; long invoices list the first lines
  }

  /* Totals. */
  y -= 6;
  const totals: Array<[string, string, boolean?]> = [['Subtotal', formatMoney(data.subtotal || data.total, data.currency)]];
  if (data.discount > 0) totals.push(['Discount', '-' + formatMoney(data.discount, data.currency)]);
  if (data.tax > 0) totals.push(['Tax', formatMoney(data.tax, data.currency)]);
  totals.push(['Total', formatMoney(data.total, data.currency), true]);
  totals.push(['Amount paid', formatMoney(data.amountPaid, data.currency)]);
  totals.push([paid ? 'Balance' : 'Amount due', formatMoney(data.amountDue, data.currency), true]);
  for (const [k, v, strong] of totals) {
    if (strong) { y -= 6; line(right - 220, y + 16, right, y + 16, RULE); }
    text(k, right - 220, y, strong ? 11 : 10, {bold: strong, color: strong ? INK : MUTED});
    text(v, right - 10, y, strong ? 11 : 10, {bold: strong, align: 'right'});
    y -= strong ? 22 : 17;
  }
  if (data.reference) text('Reference: ' + data.reference, left, y + 22, 8, {color: MUTED});

  /* Footer. */
  line(left, 96, right, 96, GOLD, 1.5);
  text('Thank you for working with Workspace Junction.', left, 78, 10, {bold: true, color: GREEN});
  text('Questions about this invoice? ' + BRAND.email + ' \u00b7 ' + BRAND.phone, left, 63, 9, {color: MUTED});
  text(BRAND.web + ' \u00b7 ' + BRAND.address.join(', '), left, 50, 8, {color: MUTED});

  const content = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    `<< /Title (${pdfText('Invoice ' + data.number)}) /Author (Workspace Junction) /Producer (Workspace Junction) >>`,
  ];
  let pdf = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
