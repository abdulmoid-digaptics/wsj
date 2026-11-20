import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildInvoicePdf, formatMoney} from '../src/invoice-pdf';
import {AccountService} from '../src/account';

const base = {number: 'OUXGDBLS-0002', status: 'paid', issuedAt: new Date('2026-11-19T12:00:00Z'), currency: 'usd', customerName: 'Dana (Buyer)', customerEmail: 'dana@example.invalid', lines: [{description: '1 × Business Address (at $25.00 / month)', quantity: 1, amount: 2500}], subtotal: 2500, discount: 0, tax: 0, total: 2500, amountPaid: 2500, amountDue: 0};

test('builds a valid, branded single-page PDF with escaped text', () => {
  const pdf = buildInvoicePdf(base).toString('latin1');
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /%%EOF\n$/);
  assert.match(pdf, /\/Logo Do Q/);
  assert.match(pdf, /\/Subtype \/Image \/Width 578 \/Height 170 [^>]*\/SMask 9 0 R/);
  assert.match(pdf, /\(INVOICE\) Tj/);
  assert.match(pdf, /\(OUXGDBLS-0002\) Tj/);
  assert.match(pdf, /\(PAID\) Tj/);
  assert.match(pdf, /Dana \\\(Buyer\\\)/, 'parentheses are escaped');
  assert.match(pdf, /\\327 Business Address/, 'multiplication sign uses WinAnsi');
  const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
  assert.equal(pdf.slice(xref, xref + 4), 'xref', 'cross-reference offset is exact');
  for (const [, n, offset] of [...pdf.matchAll(/(\d{10}) 00000 n /g)].map((m, i) => [m, i + 1, Number(m[1])] as const)) assert.equal(pdf.slice(offset, offset + String(n).length + 6), n + ' 0 obj');
});

test('amounts and due state are formatted', () => {
  assert.equal(formatMoney(218900, 'usd'), '$2,189.00');
  const due = buildInvoicePdf({...base, status: 'open', amountPaid: 0, amountDue: 2500, dueDate: new Date('2026-12-01T12:00:00Z')}).toString('latin1');
  assert.match(due, /\(PAYMENT DUE\) Tj/);
  assert.match(due, /\(Amount due\) Tj/);
});

test('only the owner can download, and lines fall back to the order items', async () => {
  const invoice = {id: '47959a8d-aaaa-bbbb-cccc-000000000000', customerId: 'cust-1', number: null, status: 'paid', currency: 'usd', lines: [], subtotal: 0, total: 27500, amountPaid: 27500, amountDue: 27500, amountRemaining: 0, taxAmount: 0, discountAmount: 0, createdAt: new Date(), orderId: 'order-1', periodStart: null, periodEnd: null, dueDate: null};
  const db: any = {
    invoice: {findUnique: async () => invoice},
    customer: {findUnique: async () => ({name: 'Dana Buyer', email: 'dana@example.invalid', billingAddress: null, company: null})},
    order: {findUnique: async () => ({paidAt: new Date(), items: [{description: 'Solo Creator Studio', quantity: 1, amount: 7500}, {description: 'Podcast Editing', quantity: 2, amount: 20000}]})},
  };
  const owner: any = new AccountService(db, {} as any, {} as any, {} as any, {} as any);
  owner.ids = async () => ['cust-1'];
  const {pdf, filename} = await owner.invoicePdf('cust-1', invoice.id);
  assert.equal(filename, 'Workspace-Junction-Invoice-WSJ-47959A8D.pdf');
  assert.match(pdf.toString('latin1'), /\(Podcast Editing\) Tj/);
  const stranger: any = new AccountService(db, {} as any, {} as any, {} as any, {} as any);
  stranger.ids = async () => ['someone-else'];
  await assert.rejects(stranger.invoicePdf('someone-else', invoice.id), /Not Found/);
});
