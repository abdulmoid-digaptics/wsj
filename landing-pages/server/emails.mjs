/** Branded email templates for the landing pages (team notifications + customer confirmations). */
import { escapeHtml as e } from './mailer.mjs';

const ADDRESS = '1S280 Summit Ave Unit E2, Suite 1, Oakbrook Terrace, IL 60181';
const PHONE = '(773) 986-1908';
const money = (c, cur = 'usd') => (typeof c === 'number' ? (c / 100).toLocaleString('en-US', { style: 'currency', currency: cur.toUpperCase(), minimumFractionDigits: c % 100 ? 2 : 0 }) : '-');

function layout({ preheader, title, intro, rows = [], body = '', cta, footerNote }) {
  const rowHtml = rows.filter(r => r && r[1] !== undefined && r[1] !== null && r[1] !== '').map(([k, v]) =>
    `<tr><td style="padding:8px 0;color:#4A5C52;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;width:38%;vertical-align:top">${e(k)}</td><td style="padding:8px 0;color:#10271C;font-size:15px;font-weight:600;vertical-align:top">${e(v)}</td></tr>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#F7F4ED;font-family:Manrope,Segoe UI,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">${e(preheader || title)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F4ED;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFDF8;border-radius:20px;overflow:hidden">
<tr><td style="background:#0E3421;padding:22px 28px;color:#fff;font-size:20px;font-weight:800;letter-spacing:.02em">WORKSPACE JUNCTION<div style="color:#D7902A;font-size:13px;font-weight:600;font-style:italic;letter-spacing:0;margin-top:2px">Create · Collaborate · Grow</div></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 10px;color:#0E3421;font-size:24px;line-height:1.25">${e(title)}</h1>
${intro ? `<p style="margin:0 0 18px;color:#4A5C52;font-size:15px;line-height:1.6">${intro}</p>` : ''}
${rowHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e6e2d8;border-bottom:1px solid #e6e2d8;margin:6px 0 18px">${rowHtml}</table>` : ''}
${body}
${cta ? `<p style="margin:22px 0 0"><a href="${e(cta.href)}" style="display:inline-block;background:#D7902A;color:#06140D;text-decoration:none;font-weight:800;padding:13px 24px;border-radius:999px">${e(cta.label)}</a></p>` : ''}
</td></tr>
<tr><td style="background:#092317;padding:18px 28px;color:rgba(255,255,255,.75);font-size:13px;line-height:1.6">${e(ADDRESS)}<br>${e(PHONE)} · grow@workspacejunction.com${footerNote ? `<br><span style="color:#D7902A">${e(footerNote)}</span>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
}
const textOf = (title, rows, extra = '') =>
  [title, '', ...rows.filter(r => r && r[1] !== undefined && r[1] !== null && r[1] !== '').map(([k, v]) => `${k}: ${v}`), extra ? '\n' + extra : '', '', `Workspace Junction · ${ADDRESS} · ${PHONE}`].join('\n');

function orderRows(o, plan) {
  return [
    ['Offer', plan ? plan.offerName : o.offer],
    ['Package', plan ? plan.name : o.planId],
    ['Quantity', o.quantity ? `${o.quantity} ${plan && plan.unitLabel === 'hour' ? 'hours' : plan && plan.mode === 'subscription' ? 'membership' : 'package(s)'}` : null],
    ['Amount', o.amountTotal != null ? money(o.amountTotal, o.currency) + (o.mode === 'subscription' ? ' today, then monthly' : '') : o.amountExpected != null ? money(o.amountExpected, o.currency) : null],
    ['Billing', plan && plan.mode === 'subscription' ? `${money(plan.unitAmount)}/${plan.interval}, ${plan.commitmentMonths}-month commitment` : 'One-time payment'],
    ['Customer', o.customer && o.customer.name],
    ['Email', (o.customer && o.customer.email) || o.customerEmail],
    ['Phone', o.customer && o.customer.phone],
    ['Preferred date', o.preferredDate],
    ['Notes', o.notes],
    ['Order ref', o.orderId],
    ['Stripe session', o.sessionId]
  ];
}

export function teamCheckoutStarted(o, plan) {
  const title = `Checkout started: ${plan ? plan.name : o.planId}`;
  const rows = orderRows(o, plan);
  return { kind: 'team_checkout_started', subject: `[Landing] ${title} - ${o.customer?.name || ''}`, text: textOf(title, rows, 'Not paid yet. If no "paid" email follows, this is an abandoned checkout worth a follow-up call.'),
    html: layout({ title, intro: 'Someone opened the secure payment form. <strong>Not paid yet.</strong> If no "paid" email follows, it is an abandoned checkout worth a follow-up.', rows }) };
}

export function teamOrderPaid(o, plan, source) {
  const title = `New paid order: ${plan ? plan.name : o.planId}`;
  const rows = [...orderRows(o, plan), ['Confirmed by', source === 'webhook' ? 'Stripe webhook' : 'Return page check'], ['Payment / subscription', o.paymentIntent || o.subscription || null]];
  return { kind: 'team_order_paid', subject: `[Landing] PAID ${money(o.amountTotal, o.currency)} - ${plan ? plan.name : o.planId} - ${o.customer?.name || ''}`, text: textOf(title, rows, 'Next: contact the customer within one business day to confirm dates / start date.'),
    html: layout({ title, intro: 'Payment received through the landing pages. <strong>Next:</strong> contact the customer within one business day to confirm dates or start date.', rows,
      cta: { label: 'Open Stripe payments', href: 'https://dashboard.stripe.com/payments' } }) };
}

export function customerOrderPaid(o, plan) {
  const first = (o.customer?.name || '').split(' ')[0] || 'there';
  const title = 'Your booking is confirmed';
  const rows = orderRows({ ...o, notes: null, sessionId: null, customer: { name: o.customer?.name } }, plan);
  const next = plan && plan.mode === 'subscription'
    ? 'Our team will contact you within one business day to finish setup and agree your start date.'
    : 'Our team will contact you within one business day to schedule your time, subject to availability.';
  return { kind: 'customer_order_paid', subject: `Confirmed: ${plan ? plan.name : 'your Workspace Junction order'}`, text: textOf(`Hi ${first}, ${title.toLowerCase()}.`, rows, `${next}\nStripe sends your payment receipt separately.`),
    html: layout({ title, intro: `Hi ${e(first)}, thank you! ${e(next)} Stripe sends your payment receipt separately.`, rows,
      body: `<p style="margin:0;color:#4A5C52;font-size:14px;line-height:1.6">Find us at <strong>${e(ADDRESS)}</strong>. Free on-site parking.</p>` }) };
}

export function teamOrderClosed(o, plan, status) {
  const label = status === 'failed' ? 'Payment failed' : 'Checkout expired (not paid)';
  const title = `${label}: ${plan ? plan.name : o.planId}`;
  const rows = orderRows(o, plan);
  return { kind: 'team_order_' + status, subject: `[Landing] ${label} - ${o.customer?.name || ''}`, text: textOf(title, rows, 'No money was taken. Consider a follow-up.'),
    html: layout({ title, intro: 'No money was taken. This customer showed intent, so a quick follow-up may win the booking.', rows }) };
}

export function teamEnquiry(q) {
  const title = q.type === 'tour' ? 'New tour request' : 'New enquiry';
  const rows = [['Page', q.offer], ['Request', q.request], ['Name', q.name], ['Email', q.email], ['Phone', q.phone], ['Preferred date', q.preferredDate], ['Message', q.notes], ['Ref', q.id]];
  return { kind: 'team_enquiry', subject: `[Landing] ${title}: ${q.request} - ${q.name}`, text: textOf(title, rows), html: layout({ title, intro: 'Submitted from the landing pages. Reply to this email to answer the customer directly.', rows }) };
}

export function customerEnquiryAck(q) {
  const first = (q.name || '').split(' ')[0] || 'there';
  const title = q.type === 'tour' ? 'We got your tour request' : 'We got your message';
  const rows = [['Request', q.request], ['Preferred date', q.preferredDate]];
  return { kind: 'customer_enquiry_ack', subject: `${title} - Workspace Junction`, text: textOf(`Hi ${first}, ${title.toLowerCase()}.`, rows, 'Our team will get back to you within one business day.'),
    html: layout({ title, intro: `Hi ${e(first)}, thanks for reaching out. Our team will get back to you within one business day. Need us sooner? Call ${e(PHONE)}.`, rows }) };
}
