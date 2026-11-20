import {test} from 'node:test';
import assert from 'node:assert/strict';
import {brandedHtml, labelFor, textToBlocks} from '../src/email-layout';
import {renderMail} from '../src/mail';

test('every template renders to branded HTML with clear, safe buttons', async () => {
  const db: any = {customerToken: {updateMany: async () => ({}), create: async () => ({})}};
  const payload = {name: 'Dana <Buyer>', planName: 'Desk', lastAccess: 'Dec 19', summary: 'Changed.', orderId: 'o1', amount: 2500, currency: 'usd', event: 'order_paid', status: 'paid', subject: 'Help', message: 'Hi <b>team</b>', customerName: 'Dana', customerEmail: 'dana@example.invalid', type: 'SUPPORT', requestId: 'r1', authorName: 'Sam'};
  for (const template of ['account_setup', 'login_link', 'password_reset', 'email_change_verify', 'purchase_receipt', 'payment_failed', 'cancellation_scheduled', 'finance_notification', 'support_request', 'support_reply', 'card_missing']) {
    const mail = await renderMail(db, {customerId: 'c1', template, payload});
    const html = brandedHtml(mail.subject, mail.text, {audience: mail.audience});
    assert.match(html, /<img src="cid:wsj-logo@workspacejunction"[^>]*alt="WORKSPACE JUNCTION"/, template);
    assert.doesNotMatch(html, /<b>team<\/b>|Dana <Buyer>/, template + ' escapes user text');
    assert.doesNotMatch(html, />Open link</, template + ' has a descriptive button');
  }
  const support = await renderMail(db, {customerId: null, template: 'support_request', payload});
  assert.equal(support.replyTo, 'dana@example.invalid');
  assert.equal(support.audience, 'staff');
});

test('link labels follow the destination', () => {
  assert.equal(labelFor('http://x/activate/?mode=login#t'), 'Sign in');
  assert.equal(labelFor('http://x/activate/#t'), 'Set up your account');
  assert.equal(labelFor('http://x/reset-password/#t'), 'Reset your password');
  assert.equal(labelFor('http://x/account/billing/'), 'Go to billing');
  assert.equal(labelFor('http://x/admin'), 'Open admin');
});

test('label lines become a details table and a trailing full stop is not part of a link', () => {
  const html = textToBlocks('Name: Dana\nEmail: dana@example.invalid\n\nSign in at http://x/login/.');
  assert.match(html, /<table[^>]*>.*Name.*Dana/s);
  assert.match(html, /href="http:\/\/x\/login\/"/);
});
