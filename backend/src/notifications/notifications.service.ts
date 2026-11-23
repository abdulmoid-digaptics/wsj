import {BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException} from '@nestjs/common';
import {ArrayMaxSize, ArrayUnique, IsDefined, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested} from 'class-validator';
import {Type} from 'class-transformer';
import {ECDH, createECDH} from 'node:crypto';
import type {NotificationTopic, NotificationType} from '@prisma/client';
import {Db} from '../core';

const TOPICS = ['bookings', 'billing', 'system'] as const;
const PUSH_PROVIDERS: Record<string, string> = {
  'fcm.googleapis.com': '/fcm/send/',
  'updates.push.services.mozilla.com': '/wpush/v2/',
  'web.push.apple.com': '/Q',
};

// Never accept arbitrary domains, ports, credentials, redirects or user-controlled origins.
// Windows uses regional WNS hosts in Microsoft's exclusive notify.windows.com namespace.
export function safePushEndpoint(value: string): string | null {
  if (value.length > 2048 || !/^https:\/\/[a-z0-9.-]+\/[A-Za-z0-9._~%+=:/?&@-]+$/.test(value)) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const prefix = Object.hasOwn(PUSH_PROVIDERS, url.hostname) ? PUSH_PROVIDERS[url.hostname]
    : /^wns[0-9]+-[a-z0-9]+\.notify\.windows\.com$/.test(url.hostname) ? '/w/' : null;
  if (!prefix || !url.pathname.startsWith(prefix) || url.pathname.length <= prefix.length || url.pathname.includes('..') || url.href !== value) return null;
  return value;
}

export class EndpointDto {
  @IsString() @MaxLength(2048) endpoint!: string;
}
class SubscriptionKeysDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{87}$/) p256dh!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{22}$/) auth!: string;
}
export class SubscribeDto extends EndpointDto {
  @IsDefined() @ValidateNested() @Type(() => SubscriptionKeysDto) keys!: SubscriptionKeysDto;
  @IsOptional() @IsInt() @Min(0) @Max(8640000000000000) expirationTime?: number | null;
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(3) @IsIn(TOPICS, {each: true}) topics?: NotificationTopic[];
  @IsOptional() @IsString() @MaxLength(2048) previousEndpoint?: string;
}

export type Owner = {customerId: string; userId?: never} | {userId: string; customerId?: never};
type NotificationMessage = {type: NotificationType; title: string; body: string; url: string};
type PushClient = {sendNotification(subscription: {endpoint: string; keys: {p256dh: string; auth: string}}, payload: string, options: {vapidDetails: VapidDetails; TTL: number; timeout: number}): Promise<unknown>};
type VapidDetails = {subject: string; publicKey: string; privateKey: string};
const VIEW = {id: true, type: true, title: true, body: true, url: true, readAt: true, createdAt: true} as const;
const topicOf: Record<NotificationType, NotificationTopic> = {BOOKING_CONFIRMED: 'bookings', BOOKING_REMINDER: 'bookings', NEW_LEAD: 'system', PAYMENT_FAILED: 'billing'};
const prismaCode = (error: unknown) => (error as {code?: unknown} | undefined)?.code;

function publicPoint(value: string) {
  try {
    const key = Buffer.from(value, 'base64url');
    return key.length === 65 && key[0] === 4 && key.toString('base64url') === value && !!ECDH.convertKey(key, 'prime256v1');
  } catch { return false; }
}

function vapidConfig(): VapidDetails | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject || !publicPoint(publicKey)) return null;
  try {
    const url = new URL(subject);
    if (url.username || url.password || (url.protocol !== 'https:' && url.protocol !== 'mailto:') || (url.protocol === 'mailto:' && !/^[^@\s]+@[^@\s]+$/.test(url.pathname))) return null;
    const key = Buffer.from(privateKey, 'base64url');
    if (key.length !== 32 || key.toString('base64url') !== privateKey) return null;
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(key);
    if (ecdh.getPublicKey().toString('base64url') !== publicKey) return null;
    return {publicKey, privateKey, subject};
  } catch { return null; }
}

@Injectable()
export class NotificationService {
  constructor(@Inject(Db) private readonly db: Db) {}

  publicKey() { return vapidConfig()?.publicKey ?? null; }

  async subscribe(owner: Owner, dto: SubscribeDto, userAgent?: string) {
    const endpoint = safePushEndpoint(dto.endpoint);
    const previous = dto.previousEndpoint == null ? undefined : safePushEndpoint(dto.previousEndpoint);
    const auth = dto.keys && Buffer.from(dto.keys.auth ?? '', 'base64url');
    if (!endpoint || previous === null || !dto.keys || !publicPoint(dto.keys.p256dh ?? '') || !auth || auth.length !== 16 || auth.toString('base64url') !== dto.keys.auth) throw new BadRequestException('Invalid push subscription');
    if (!this.publicKey()) throw new ServiceUnavailableException('Browser push is not configured');
    const expiresAt = dto.expirationTime == null ? null : new Date(dto.expirationTime);
    if (expiresAt && expiresAt.getTime() <= Date.now()) throw new BadRequestException('Push subscription has expired');
    try {
      await this.db.$transaction(async tx => {
        const existing = await tx.pushSubscription.findFirst({where: {...owner, endpoint}, select: {id: true, topics: true}});
        const old = previous && previous !== endpoint ? await tx.pushSubscription.findFirst({where: {...owner, endpoint: previous}, select: {id: true, topics: true}}) : null;
        if (previous && !(previous === endpoint ? existing : old)) throw new ConflictException('Previous push endpoint is not registered to this account');
        if (old && !(await tx.pushSubscription.deleteMany({where: {...owner, id: old.id}})).count) throw new ConflictException('Previous push endpoint is no longer registered');
        const topics = dto.topics ?? existing?.topics ?? old?.topics;
        const agent = typeof userAgent === 'string' ? userAgent.slice(0, 256) : undefined;
        const deviceType = agent ? (/android|iphone|ipad|mobile/i.test(agent) ? 'mobile' : 'desktop') : undefined;
        const data = {...dto.keys, expiresAt, active: true, ...(agent ? {userAgent: agent, deviceType} : {}), ...(topics !== undefined ? {topics} : {})};
        if (existing) await tx.pushSubscription.update({where: {id: existing.id}, data});
        else await tx.pushSubscription.create({data: {...data, ...owner, endpoint}});
      });
    } catch (e) {
      if (prismaCode(e) === 'P2002') throw new ConflictException('Push endpoint is already registered');
      if (e instanceof HttpException) throw e;
      // Prisma errors may embed query arguments, including subscription secrets.
      throw new ServiceUnavailableException('Unable to save push subscription');
    }
    return {ok: true};
  }

  async unsubscribe(owner: Owner, endpoint: string) {
    try { await this.db.pushSubscription.deleteMany({where: {...owner, endpoint}}); }
    catch { throw new ServiceUnavailableException('Unable to remove push subscription'); }
    return {ok: true};
  }

  async status(owner: Owner, endpoint: string) {
    try {
      const row = await this.db.pushSubscription.findFirst({where: {...owner, endpoint, active: true, OR: [{expiresAt: null}, {expiresAt: {gt: new Date()}}]}, select: {topics: true}});
      return {active: !!row, topics: row?.topics ?? []};
    } catch { throw new ServiceUnavailableException('Unable to read push subscription'); }
  }

  async list(owner: Owner, query: {page?: string; limit?: string}) {
    const page = Math.min(10000, Math.max(1, parseInt(query.page ?? '1', 10) || 1));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10) || 20));
    const [items, total, unreadCount] = await this.db.$transaction([
      this.db.notificationRecord.findMany({where: owner, orderBy: [{createdAt: 'desc'}, {id: 'desc'}], select: VIEW, skip: (page - 1) * limit, take: limit}),
      this.db.notificationRecord.count({where: owner}),
      this.db.notificationRecord.count({where: {...owner, readAt: null}}),
    ]);
    return {items, unreadCount, total, page, limit};
  }

  async read(owner: Owner, id: string) {
    const updated = await this.db.notificationRecord.updateMany({where: {...owner, id, readAt: null}, data: {readAt: new Date()}});
    if (!updated.count && !await this.db.notificationRecord.findFirst({where: {...owner, id}, select: {id: true}})) throw new NotFoundException();
    return {ok: true};
  }

  async readAll(owner: Owner) {
    await this.db.notificationRecord.updateMany({where: {...owner, readAt: null}, data: {readAt: new Date()}});
    return {ok: true};
  }

  private async publish(owner: Owner, key: string, message: NotificationMessage, sendPush = true) {
    const idPrefix = owner.customerId ? 'customer:' + owner.customerId : 'staff:' + owner.userId;
    try {
      const row = await this.db.notificationRecord.create({data: {...owner, ...message, dedupeKey: `${idPrefix}:${key}`}, select: {id: true}});
      // Drop the remote network path from the originating request. The in-app row is already durable.
      if (sendPush) void this.deliver(owner, {...message, id: row.id}).catch(() => console.warn('[notifications] push delivery failed'));
      return true;
    } catch (error) {
      if (prismaCode(error) === 'P2002') return false;
      throw error;
    }
  }

  private pushTransport(): {client: PushClient; vapidDetails: VapidDetails} | null {
    if (process.env.NODE_ENV === 'test' || process.env.WEB_PUSH_DELIVERY === 'off') return null;
    const vapidDetails = vapidConfig();
    return vapidDetails ? {client: require('web-push') as PushClient, vapidDetails} : null;
  }

  private async deliver(owner: Owner, message: NotificationMessage & {id: string}, transport = this.pushTransport()) {
    if (!transport) return;
    const {client, vapidDetails} = transport;
    const take = 20;
    // Count only unread notifications belonging to the authenticated subscription owner.
    let count: number | undefined;
    try { count = await this.db.notificationRecord.count({where: {...owner, readAt: null}}); }
    catch { /* Badge data is optional and must not interrupt delivery. */ }
    const payload = JSON.stringify({...message, tag: message.id, count});
    const expiresAfter = new Date();
    let cursor: string | undefined;
    for (;;) {
      const subscriptions: {id: string; endpoint: string; p256dh: string; auth: string; updatedAt: Date}[] = await this.db.pushSubscription.findMany({
        where: {...owner, active: true, topics: {has: topicOf[message.type]}, OR: [{expiresAt: null}, {expiresAt: {gt: expiresAfter}}],
          ...(owner.userId ? {user: {active: true}} : {customer: {mergedIntoId: null, accountStatus: 'ACTIVE'}}), ...(cursor ? {id: {gt: cursor}} : {})},
        select: {id: true, endpoint: true, auth: true, p256dh: true, updatedAt: true}, orderBy: {id: 'asc'}, take,
      });
      const results = await Promise.allSettled(subscriptions.map(async s => {
        if (!safePushEndpoint(s.endpoint)) return;
        try {
          await client.sendNotification({endpoint: s.endpoint, keys: {auth: s.auth, p256dh: s.p256dh}}, payload, {vapidDetails, TTL: message.type === 'BOOKING_REMINDER' ? 300 : 3600, timeout: 5000});
        } catch (error) {
          const status = (error as {statusCode?: number} | undefined)?.statusCode;
          if (status === 404 || status === 410) await this.db.pushSubscription.deleteMany({where: {id: s.id, updatedAt: s.updatedAt}});
          else throw error;
        }
      }));
      if (results.some(result => result.status === 'rejected')) console.warn('[notifications] push delivery failed');
      if (subscriptions.length < take) return;
      // A stale endpoint may have been deleted above. A value boundary doesn't require the row to survive.
      cursor = subscriptions[take - 1].id;
    }
  }

  private async forCustomer(customerId: string, key: string, message: NotificationMessage) {
    // A Stripe order can point at a previously verified-and-claimed shadow profile.
    const profile = await this.db.customer.findUnique({where: {id: customerId}, select: {id: true, mergedIntoId: true}});
    if (!profile) return false;
    const owner = await this.db.customer.findUnique({where: {id: profile.mergedIntoId ?? profile.id}, select: {id: true, mergedIntoId: true, notificationPrefs: true}});
    if (!owner || owner.mergedIntoId) return false;
    if (message.type === 'BOOKING_REMINDER' && (owner.notificationPrefs as Record<string, unknown> | null)?.bookingReminders === false) return false;
    return this.publish({customerId: owner.id}, key, message);
  }

  private async forStaff(key: string, message: NotificationMessage, roles: ('ADMIN' | 'EDITOR')[]) {
    const users = await this.db.user.findMany({where: {active: true, role: {in: roles}}, select: {id: true}});
    const deliveries = await Promise.allSettled(users.map(user => this.publish({userId: user.id}, key, message)));
    if (deliveries.some(result => result.status === 'rejected')) console.warn('[notifications] could not persist some staff notifications');
  }

  async bookingConfirmed(booking: {id: string; customerId?: string | null}) {
    if (!booking.customerId) return false; // Never associate a booking solely by email.
    return this.forCustomer(booking.customerId, 'booking-confirmed:' + booking.id, {type: 'BOOKING_CONFIRMED', title: 'Booking confirmed', body: 'Your Workspace Junction booking is confirmed.', url: '/account/bookings'});
  }

  async paidBookingConfirmed(order: {id: string; customerId: string; metadata: unknown}, state: 'none' | 'confirmed' | 'lost') {
    if (state === 'lost') return false;
    const metadata = order.metadata as {schedule?: {startAt?: string | null}[]; coworkingDays?: unknown} | null;
    if (state !== 'confirmed' && !metadata?.coworkingDays && !(Array.isArray(metadata?.schedule) && metadata.schedule.some(item => !!item?.startAt))) return false;
    return this.forCustomer(order.customerId, 'order-booking-confirmed:' + order.id, {type: 'BOOKING_CONFIRMED', title: 'Booking confirmed', body: 'Your Workspace Junction booking is confirmed.', url: '/account/bookings'});
  }

  async bookingReminder(booking: {id: string; customerId: string}, start: Date) {
    return this.forCustomer(booking.customerId, `booking-reminder:${booking.id}:${start.toISOString()}`, {type: 'BOOKING_REMINDER', title: 'Your booking starts soon', body: 'Your Workspace Junction booking starts in about one hour.', url: '/account/bookings'});
  }

  async lead(id: string) {
    return this.forStaff('lead:' + id, {type: 'NEW_LEAD', title: 'New website inquiry', body: 'A new inquiry is ready to review.', url: '/admin/?view=inquiries&status=NEW#inquiries'}, ['ADMIN', 'EDITOR']);
  }

  async paymentFailed(customerId: string | null, key: string) {
    const jobs = [this.forStaff(key, {type: 'PAYMENT_FAILED', title: 'Payment failed', body: 'Review the failed payment in billing.', url: '/admin?view=billing/orders'}, ['ADMIN']) as Promise<unknown>];
    if (customerId) jobs.push(this.forCustomer(customerId, key, {type: 'PAYMENT_FAILED', title: 'Payment failed', body: 'A Workspace Junction payment could not be completed. Review your billing details.', url: '/account/billing'}));
    const results = await Promise.allSettled(jobs);
    if (results.some(result => result.status === 'rejected')) console.warn('[notifications] could not persist some payment notifications');
  }
}

export function bestEffortNotification(task: Promise<unknown> | undefined) {
  return task?.catch(() => console.warn('[notifications] could not persist notification'));
}
