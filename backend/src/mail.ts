import {inlineLogoForBrowser, logoAttachment} from './brand-logo';
/**
 * Transactional email: one delivery adapter and a database outbox.
 *
 * - Nothing is "sent" until the adapter accepted it; a failed or unconfigured
 *   delivery leaves the row retryable and is never reported as delivered.
 * - The outbox stores a template name and non-secret payload only. Links that
 *   carry a single-use token are minted at delivery time, so a secret is never
 *   persisted in plain text and a retry simply issues a fresh token.
 * - Bodies and tokens are never logged.
 */
import {Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional} from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Db} from './core';
import {frontendOrigins} from './origins';
import {TOKEN_TTL_MS, newToken, type TokenPurpose} from './account-core';
import {brandedHtml} from './email-layout';
import {logEvent} from './redact';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  /** Defaults to the branded layout built from `text`. */
  html?: string;
  /** Where a recipient's reply goes, e.g. the customer on a team copy. */
  replyTo?: string;
  audience?: 'customer' | 'staff';
  /** Extra headers (e.g. List-Unsubscribe). Values are validated in safeMail. */
  headers?: Record<string, string>;
}

const SMTP_BREAKER_THRESHOLD = 5;
const SMTP_BREAKER_COOLDOWN_MS = 60000;
export const smtpBreaker = {failures: 0, openUntil: 0};

/** One plain address: no display-name tricks, no lists, no header line breaks. */
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export class InvalidRecipientError extends Error {
  constructor() {
    super('INVALID_RECIPIENT');
  }
}

/** Header-injection guard. Every outgoing message passes through here. */
export function safeMail(mail: OutgoingMail): OutgoingMail {
  const to = String(mail.to ?? '').trim();
  if (to.length > 254 || !ADDRESS.test(to)) throw new InvalidRecipientError();
  const replyTo = mail.replyTo === undefined ? undefined : String(mail.replyTo).trim();
  const subject = String(mail.subject ?? '').replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 200) || 'Workspace Junction';
  const headers = mail.headers ? Object.fromEntries(Object.entries(mail.headers).filter(([k, v]) => /^(List-Unsubscribe|List-Unsubscribe-Post|List-Id|X-Campaign-Id)$/.test(k) && typeof v === 'string' && !/[\r\n]/.test(v) && v.length < 1000)) : undefined;
  return {...mail, to, subject, headers, replyTo: replyTo && replyTo.length <= 254 && ADDRESS.test(replyTo) ? replyTo : undefined};
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super('MAIL_NOT_CONFIGURED');
  }
}

@Injectable()
export class MailService {
  /** smtp when configured; capture only outside production; otherwise none. */
  mode(): 'smtp' | 'capture' | 'none' {
    if (process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim()) return 'smtp';
    if (process.env.NODE_ENV !== 'production' && process.env.MAIL_CAPTURE_DIR?.trim()) return 'capture';
    return 'none';
  }

  async deliver(input: OutgoingMail): Promise<void> {
    const mode = this.mode();
    if (mode === 'none') throw new MailNotConfiguredError();
    const mail = safeMail(input);
    if (mode === 'capture') {
      /* Local test adapter: writes the message to disk instead of the network. */
      const dir = path.resolve(process.env.MAIL_CAPTURE_DIR!);
      fs.mkdirSync(dir, {recursive: true});
      fs.writeFileSync(path.join(dir, Date.now() + '-' + randomUUID() + '.json'), JSON.stringify({...mail, html: inlineLogoForBrowser(mail.html ?? brandedHtml(mail.subject, mail.text, {audience: mail.audience})), capturedAt: new Date().toISOString()}, null, 1), {mode: 0o600});
      return;
    }
    if (Date.now() < smtpBreaker.openUntil) throw new Error('SMTP_CIRCUIT_OPEN');
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_PORT === '465',
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      ...(process.env.SMTP_USER ? {auth: {user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD}} : {}),
    });
    try {
      /* Exactly one recipient per message: never CC/BCC, so addresses are never exposed to each other. */
      const html = mail.html ?? brandedHtml(mail.subject, mail.text, {audience: mail.audience});
      await transport.sendMail({from: process.env.SMTP_FROM, to: mail.to, subject: mail.subject, text: mail.text, html, attachments: logoAttachment(html), ...(mail.replyTo ? {replyTo: mail.replyTo} : {}), ...(mail.headers ? {headers: mail.headers} : {})});
      smtpBreaker.failures = 0;
    } catch (error) {
      /* Circuit breaker: after repeated provider failures, fail fast for a minute instead of
         tying up requests on a dead SMTP server. The outbox keeps the message and retries. */
      if (++smtpBreaker.failures >= SMTP_BREAKER_THRESHOLD) smtpBreaker.openUntil = Date.now() + SMTP_BREAKER_COOLDOWN_MS;
      throw error;
    }
  }
}

/* ───────────────────────────── Tokens ───────────────────────────── */

type TokenDb = Pick<Db, 'customerToken'>;

/**
 * Mint a single-use token. Any earlier unused token of the same purpose for
 * the same customer is retired first, so only the newest link works.
 */
export async function issueToken(db: TokenDb, customerId: string, purpose: TokenPurpose, data: Record<string, unknown> = {}, now = new Date()): Promise<string> {
  await db.customerToken.updateMany({where: {customerId, purpose, usedAt: null}, data: {usedAt: now}});
  const {token, hash} = newToken();
  await db.customerToken.create({data: {customerId, purpose, tokenHash: hash, data: data as object, expiresAt: new Date(now.getTime() + TOKEN_TTL_MS[purpose])}});
  return token;
}

/**
 * The token rides in the URL fragment: it is never sent to a server by the
 * navigation itself, so it cannot land in access logs or a Referer header.
 */
export function tokenLink(mode: 'setup' | 'login' | 'email' | 'reset', token: string, origin = frontendOrigins()[0]): string {
  const page = mode === 'reset' ? '/reset-password/' : '/activate/' + (mode === 'setup' ? '' : '?mode=' + mode);
  return origin + page + '#token=' + token;
}

/* ───────────────────────────── Templates ───────────────────────────── */

export type MailTemplate =
  | 'account_setup'
  | 'login_link'
  | 'password_reset'
  | 'password_changed'
  | 'email_change_verify'
  | 'email_change_notice'
  | 'email_changed'
  | 'purchase_receipt'
  | 'claim_available'
  | 'payment_failed'
  | 'cancellation_scheduled'
  | 'cancellation_withdrawn'
  | 'plan_change'
  | 'card_missing'
  | 'finance_notification'
  | 'support_request'
  | 'support_reply'
  | 'newsletter_confirm'
  | 'booking_reminder'
  | 'renewal_reminder';

const SIGN_OFF = '\n\nWorkspace Junction\n(773) 986-1908 · grow@workspacejunction.com';
const str = (value: unknown, max = 200) => String(value ?? '').replace(/[\r\n]+/g, ' ').slice(0, max);
const money = (minor: unknown, currency: unknown) => new Intl.NumberFormat('en-US', {style: 'currency', currency: String(currency || 'usd').toUpperCase()}).format(Number(minor || 0) / 100);

/** Render at delivery time. Token templates mint their link here, never earlier. */
export async function renderMail(db: TokenDb, row: {customerId: string | null; template: string; payload: unknown}): Promise<{subject: string; text: string; replyTo?: string; audience?: 'customer' | 'staff'}> {
  const rendered = await renderMailBody(db, row);
  const p = (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<string, unknown>;
  const email = typeof p.customerEmail === 'string' && /^[^\s@<>]+@[^\s@<>]+$/.test(p.customerEmail) ? p.customerEmail : undefined;
  /* Team copies: replies go straight to the customer who wrote in. */
  if (row.template === 'support_request') return {...rendered, audience: 'staff', ...(email ? {replyTo: email} : {})};
  if (row.template === 'finance_notification') return {...rendered, audience: 'staff'};
  return {...rendered, audience: 'customer', ...(process.env.REPLY_TO_EMAIL?.trim() ? {replyTo: process.env.REPLY_TO_EMAIL.trim()} : {})};
}

async function renderMailBody(db: TokenDb, row: {customerId: string | null; template: string; payload: unknown}): Promise<{subject: string; text: string}> {
  const p = (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<string, unknown>;
  const origin = frontendOrigins()[0];
  const hello = 'Hello' + (p.name ? ' ' + str(p.name, 80) : '') + ',\n\n';
  const needCustomer = () => {
    if (!row.customerId) throw new Error('template requires a customer');
    return row.customerId;
  };
  switch (row.template as MailTemplate) {
    case 'account_setup': {
      const link = tokenLink('setup', await issueToken(db, needCustomer(), 'ACCOUNT_SETUP'));
      return {
        subject: 'Set up your Workspace Junction account',
        text: hello + 'Thank you for your purchase. Your Workspace Junction account is ready to be set up.\n\nChoose a password to verify your email and manage your bookings, subscriptions, invoices and saved card:\n\n' + link + '\n\nThis link works once and expires in 24 hours. If it has expired, request a new one at ' + origin + '/login/.\n\nIf you did not make a purchase, you can ignore this email; no account is active until a password is set.' + SIGN_OFF,
      };
    }
    case 'login_link': {
      const link = tokenLink('login', await issueToken(db, needCustomer(), 'LOGIN_LINK'));
      return {subject: 'Your Workspace Junction sign-in link', text: hello + 'Use this link to sign in to your account:\n\n' + link + '\n\nIt works once and expires in 15 minutes. If you did not ask for it, you can ignore this email.' + SIGN_OFF};
    }
    case 'password_reset': {
      const link = tokenLink('reset', await issueToken(db, needCustomer(), 'PASSWORD_RESET'));
      return {subject: 'Reset your Workspace Junction password', text: hello + 'We received a request to reset your password. Choose a new one here:\n\n' + link + '\n\nThis link works once and expires in 30 minutes. If you did not ask for it, your password has not changed and you can ignore this email.' + SIGN_OFF};
    }
    case 'email_change_verify': {
      const link = tokenLink('email', await issueToken(db, needCustomer(), 'EMAIL_CHANGE', {newEmail: str(p.newEmail, 254)}));
      return {subject: 'Confirm your new email address', text: hello + 'Confirm this address as the new sign-in email for your Workspace Junction account:\n\n' + link + '\n\nThe link works once and expires in 60 minutes. Until you confirm, your current email stays in place.' + SIGN_OFF};
    }
    case 'email_change_notice':
      return {subject: 'A change to your account email was requested', text: hello + 'Someone signed in to your Workspace Junction account and asked to change its email address to ' + str(p.newEmailMasked, 120) + '. Nothing changes until that new address is confirmed.\n\nIf this was not you, sign in and change your password now: ' + origin + '/login/' + SIGN_OFF};
    case 'email_changed':
      return {subject: 'Your account email was changed', text: hello + 'The sign-in email for your Workspace Junction account was changed to ' + str(p.newEmailMasked, 120) + '. Other devices were signed out.\n\nIf this was not you, contact us immediately.' + SIGN_OFF};
    case 'password_changed':
      return {subject: 'Your Workspace Junction password was changed', text: hello + 'Your account password was just changed and other devices were signed out.\n\nIf this was not you, reset your password now: ' + origin + '/forgot-password/' + SIGN_OFF};
    case 'purchase_receipt': {
      const items = Array.isArray(p.items) ? (p.items as Array<Record<string, unknown>>).slice(0, 20).map(item => '  ' + str(item.description, 120) + (Number(item.quantity) > 1 ? ' x ' + Number(item.quantity) : '') + '  ' + money(item.amount, p.currency)).join('\n') : '';
      return {
        subject: 'Your Workspace Junction purchase',
        text: hello + 'We received your payment. Here is a summary:\n\n' + items + '\n\n  Paid today: ' + money(p.dueNowAmount, p.currency) + (Number(p.recurringAmount) > 0 ? '\n  Then: ' + money(p.recurringAmount, p.currency) + ' ' + str(p.recurringDescription, 40) + ' until you cancel' : '') + '\n\nReference: ' + str(p.orderId, 60) + '\n\nYour invoices and receipts are in your account: ' + origin + '/account/billing/' + SIGN_OFF,
      };
    }
    case 'claim_available':
      return {subject: 'A purchase is waiting for your account', text: hello + 'A purchase was made using this email address while not signed in. To add it to your Workspace Junction account, sign in and confirm it on your dashboard:\n\n' + origin + '/login/\n\nIf you do not recognise it, you can decline it there and our team will review.' + SIGN_OFF};
    case 'payment_failed':
      return {subject: 'We could not process your payment', text: hello + 'The latest payment for ' + str(p.planName, 120) + ' did not go through. Your access continues for now.\n\nSign in to update your card or pay the outstanding invoice: ' + origin + '/account/billing/' + SIGN_OFF};
    case 'cancellation_scheduled':
      return {subject: 'Your subscription will not renew', text: hello + 'Automatic renewal for ' + str(p.planName, 120) + ' has been stopped. You keep access until ' + str(p.lastAccess, 60) + '. No refund is issued for the current period.\n\nChanged your mind? You can undo this before that date: ' + origin + '/account/subscriptions/' + SIGN_OFF};
    case 'cancellation_withdrawn':
      return {subject: 'Your subscription will renew as normal', text: hello + 'The scheduled cancellation for ' + str(p.planName, 120) + ' was withdrawn. It renews as normal.' + SIGN_OFF};
    case 'plan_change':
      return {subject: 'Your plan change', text: hello + str(p.summary, 400) + '\n\nSee the details in your account: ' + origin + '/account/subscriptions/' + SIGN_OFF};
    case 'finance_notification': {
      const labels: Record<string, string> = {order_created: 'New order created', booking_created: 'New booking created', order_paid: 'Order payment confirmed', order_payment_failed: 'Order payment failed', invoice_paid: 'Invoice payment confirmed', invoice_payment_failed: 'Invoice payment failed', order_refunded: 'Order refund confirmed', booking_paid: 'Booking payment confirmed', booking_refunded: 'Booking refund confirmed', subscription_cancellation: 'Subscription cancellation', reservation_lost: 'Paid order lost its reservation: rebook or refund', reservation_release_failed: 'Refunded order still holds inventory: release it', refund_uncertain: 'Refund outcome needs review', refund_request: 'Refund review requested'};
      const event = str(p.event, 80);
      const title = labels[event] || 'Finance activity';
      const fields: Array<[string, string]> = [['Event', 'event'], ['Order ID', 'orderId'], ['Booking ID', 'bookingId'], ['Invoice ID', 'invoiceId'], ['Subscription ID', 'subscriptionId'], ['Stripe reference', 'stripeRef'], ['Status', 'status']];
      let amount = '';
      if (typeof p.amount === 'number' && typeof p.currency === 'string' && /^[a-z]{3}$/i.test(p.currency)) {
        try { amount = '\nAmount: ' + money(p.amount, p.currency); } catch { amount = '\nAmount (minor units): ' + p.amount + ' ' + p.currency.toUpperCase(); }
      }
      return {subject: 'Workspace Junction: ' + title, text: title + '\n\n' + fields.filter(([, key]) => p[key] !== undefined).map(([label, key]) => label + ': ' + str(p[key], 120)).join('\n') + amount + '\n\nThis is an internal notification. Check the order and Stripe before taking action.' + SIGN_OFF};
    }
    case 'support_request': {
      const kinds: Record<string, string> = {SUPPORT: 'Help request', REFUND: 'Refund request', RESCHEDULE: 'Reschedule request', BOOKING_CANCELLATION: 'Booking cancellation request', OTHER: 'Customer message', CLOSURE: 'Account closure request', CLAIM_DISPUTE: 'Purchase not recognised'};
      const kind = kinds[str(p.type, 40)] || 'Customer message';
      const message = String(p.message ?? '').slice(0, 4000);
      return {subject: 'Workspace Junction: ' + kind + ' - ' + str(p.subject, 120), text: kind + ' from a signed-in customer.\n\nCustomer: ' + str(p.customerName, 120) + ' <' + str(p.customerEmail, 254) + '>\nSubject: ' + str(p.subject, 200) + (p.reference ? '\nReference: ' + str(p.reference, 80) : '') + '\nRequest ID: ' + str(p.requestId, 60) + '\n\nMessage:\n' + message + '\n\nReply to the customer by email, then update the request in Admin > Customer support: ' + origin + '/admin' + SIGN_OFF};
    }
    case 'support_reply': {
      const message = String(p.message ?? '').slice(0, 8000);
      return {subject: 'Re: ' + str(p.subject, 160), text: hello + message + '\n\n' + str(p.authorName, 120) + '\nWorkspace Junction team\n\nNeed more help? Reply to this email or sign in to your account: ' + origin + '/account/' + SIGN_OFF};
    }
    case 'newsletter_confirm': {
      /* Only links to this site are ever sent from a queued payload. */
      const url = String(p.confirmUrl ?? '');
      if (!url.startsWith(origin + '/newsletter/confirm/')) throw new Error('invalid confirmation link');
      return {subject: 'Please confirm your subscription', text: hello + 'Thanks for signing up for news and offers from Workspace Junction. Please confirm that this is your email address.\n\nConfirm my subscription: ' + url + '\n\nIf you did not sign up, ignore this email and you will not hear from us. The link expires in 7 days.' + SIGN_OFF};
    }
    case 'booking_reminder':
      return {subject: 'Reminder: ' + str(p.serviceName, 120) + ' is coming up', text: hello + 'This is a friendly reminder of your booking at Workspace Junction.\n\nWhat: ' + str(p.serviceName, 160) + '\nWhen: ' + str(p.when, 120) + (p.duration ? '\nDuration: ' + str(p.duration, 40) : '') + '\nWhere: 1S280 Summit Ave Unit E2 Suite 1, Oakbrook Terrace, IL 60181\n\nPlease arrive a few minutes early. Need to change or cancel? Reply to this email or call (773) 986-1908.\n\nView my bookings: ' + origin + '/account/bookings/\n\nYou can turn booking reminders off under Profile in your account.' + SIGN_OFF};
    case 'renewal_reminder':
      return {subject: 'Your ' + str(p.planName, 120) + ' renews on ' + str(p.date, 60), text: hello + 'A quick heads-up: your Workspace Junction plan renews automatically.\n\nPlan: ' + str(p.planName, 160) + '\nRenews on: ' + str(p.date, 60) + '\nAmount: ' + str(p.amount, 40) + ' per ' + (p.interval === 'year' ? 'year' : 'month') + '\n\nNo action is needed if you want to keep it. To change or stop it, visit your subscriptions before the renewal date.\n\nView my subscriptions: ' + origin + '/account/subscriptions/\n\nYou can turn renewal reminders off under Profile in your account.' + SIGN_OFF};
    case 'card_missing':
      return {subject: 'Add a payment card to your account', text: hello + 'Your Workspace Junction account no longer has a saved payment card. Anything you have already paid for is unaffected, but renewals cannot be collected.\n\nAdd a card here: ' + origin + '/account/payment-methods/' + SIGN_OFF};
    default:
      throw new Error('unknown mail template');
  }
}

/* ───────────────────────────── Outbox ───────────────────────────── */

const MAX_ATTEMPTS = 8;
/** Exponential backoff with +/-20% jitter so retries from many rows never arrive together. */
export const backoffMs = (attempts: number, random = Math.random) => Math.round(Math.min(6 * 60 * 60 * 1000, 60000 * 2 ** Math.max(0, attempts - 1)) * (0.8 + 0.4 * random()));

@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<number> | null = null;
  private drainAgain = false;

  constructor(@Inject(Db) private db: Db, @Optional() @Inject(MailService) private mail: MailService = new MailService()) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.OUTBOX_WORKER === 'off') return;
    this.timer = setInterval(() => void this.drain().catch(() => undefined), 60000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Record the intent to send. With a dedupeKey the same message can be
   * enqueued any number of times (webhook replay, retry, refresh) and exists once.
   */
  async enqueue(entry: {customerId?: string | null; to: string; template: MailTemplate; payload?: Record<string, unknown>; dedupeKey?: string | null}): Promise<{id: string; created: boolean}> {
    if (entry.dedupeKey) {
      const existing = await this.db.emailOutbox.findUnique({where: {dedupeKey: entry.dedupeKey}});
      if (existing) return {id: existing.id, created: false};
    }
    try {
      const row = await this.db.emailOutbox.create({data: {customerId: entry.customerId ?? null, toEmail: entry.to, template: entry.template, payload: (entry.payload ?? {}) as object, dedupeKey: entry.dedupeKey ?? null}});
      if (process.env.OUTBOX_WORKER !== 'off') void this.drain().catch(() => undefined);
      return {id: row.id, created: true};
    } catch (error) {
      /* A concurrent enqueue won the unique dedupe key: that is success. */
      const existing = entry.dedupeKey ? await this.db.emailOutbox.findUnique({where: {dedupeKey: entry.dedupeKey}}) : null;
      if (existing) return {id: existing.id, created: false};
      throw error;
    }
  }

  /** Deliver what is due. Safe to run concurrently on several instances. */
  async drain(limit = 25, now = new Date()): Promise<number> {
    if (this.draining) {
      // An enqueue may have arrived after the active worker read its batch.
      // Schedule one follow-up pass rather than waiting for the periodic timer.
      this.drainAgain = true;
      return this.draining;
    }
    this.draining = this.drainOnce(limit, now).finally(() => {
      const again = this.drainAgain;
      this.drainAgain = false;
      this.draining = null;
      if (again && process.env.OUTBOX_WORKER !== 'off') void this.drain().catch(() => undefined);
    });
    return this.draining;
  }

  private async drainOnce(limit: number, now: Date): Promise<number> {
    /* Without an adapter nothing is claimed: rows stay PENDING and visible in diagnostics. */
    if (this.mail.mode() === 'none') return 0;
    const due = await this.db.emailOutbox.findMany({
      where: {OR: [{status: {in: ['PENDING', 'FAILED']}, nextAttemptAt: {lte: now}}, {status: 'SENDING', lockedUntil: {lte: now}}]},
      orderBy: {createdAt: 'asc'},
      take: limit,
    });
    let sent = 0;
    for (const row of due) {
      /* Compare-and-set claim: only one worker moves a row into SENDING. */
      const claim = await this.db.emailOutbox.updateMany({
        where: {id: row.id, status: row.status, attempts: row.attempts},
        data: {status: 'SENDING', attempts: {increment: 1}, lockedUntil: new Date(now.getTime() + 2 * 60000)},
      });
      if (claim.count !== 1) continue;
      const attempts = row.attempts + 1;
      try {
        const rendered = await renderMail(this.db, row);
        await this.mail.deliver({to: row.toEmail, ...rendered});
        await this.db.emailOutbox.update({where: {id: row.id}, data: {status: 'SENT', sentAt: new Date(), lockedUntil: null, lastError: null}});
        sent += 1;
      } catch (error) {
        /* Permanent failures (bad address, mailbox rejected) stop at once; others back off and retry. */
        const smtpCode = Number((error as {responseCode?: unknown})?.responseCode);
        const permanent = error instanceof InvalidRecipientError || (smtpCode >= 550 && smtpCode <= 554);
        const dead = attempts >= MAX_ATTEMPTS || permanent;
        /* Only an error class/code is kept: never a body, address list or token. */
        const reason = error instanceof InvalidRecipientError ? 'INVALID_RECIPIENT' : error instanceof Error ? (error as Error & {code?: string}).code || (error.message === 'SMTP_CIRCUIT_OPEN' ? 'SMTP_CIRCUIT_OPEN' : error.name) || 'Error' : 'Error';
        if (dead) logEvent('error', 'email.dead_letter', {outboxId: row.id, template: row.template, attempts, reason});
        await this.db.emailOutbox
          .update({where: {id: row.id}, data: {status: dead ? 'DEAD' : 'FAILED', lockedUntil: null, lastError: String(reason).slice(0, 80), nextAttemptAt: new Date(now.getTime() + backoffMs(attempts))}})
          .catch(() => undefined);
      }
    }
    return sent;
  }
}

/** Only operational identifiers and amounts belong in finance notifications.
 * Amount is in the currency's minor units. Never pass tokens or raw Stripe objects.
 */
export interface FinanceNotificationMetadata {
  event: string;
  orderId?: string;
  bookingId?: string;
  invoiceId?: string;
  subscriptionId?: string;
  amount?: number;
  currency?: string;
  stripeRef?: string;
  status?: string;
}

/** Returns null when finance notifications are not configured. This only enqueues;
 * the normal outbox worker controls delivery. The caller owns dedupeKey stability. */
export async function enqueueFinanceNotification(
  outbox: Pick<OutboxService, 'enqueue'>,
  metadata: FinanceNotificationMetadata,
  dedupeKey: string,
): Promise<{id: string; created: boolean} | null> {
  const to = process.env.FINANCE_NOTIFICATION_EMAIL?.trim();
  if (!to) return null;
  if (typeof dedupeKey !== 'string' || !dedupeKey.trim()) throw new Error('finance notification requires a dedupe key');
  const payload: Record<string, string | number> = {};
  const fields = ['event', 'orderId', 'bookingId', 'invoiceId', 'subscriptionId', 'currency', 'stripeRef', 'status'] as const;
  for (const field of fields) {
    const value = metadata[field];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value || value.length > 120 || !/^[a-zA-Z0-9_.:-]+$/.test(value) || /(?:^|_)(?:sk|rk|pk|whsec|secret|token|password)(?:_|$)/i.test(value)) {
      throw new Error('invalid finance notification metadata: ' + field);
    }
    payload[field] = value;
  }
  if (!payload.event) throw new Error('finance notification requires an event');
  if (metadata.amount !== undefined) {
    if (!Number.isSafeInteger(metadata.amount)) throw new Error('invalid finance notification metadata: amount');
    payload.amount = metadata.amount;
  }
  return outbox.enqueue({to, template: 'finance_notification', payload, dedupeKey});
}
