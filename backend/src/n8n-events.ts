/**
 * Inbound n8n events. The n8n workflows stay the single sender: they write to Kisi, then notify this
 * app with the same facts. The app records the event (idempotent by eventId) and refreshes its live
 * Kisi/Sheet mirror so Workspace operations reflects the change within seconds.
 * Auth: header `x-wsj-webhook-secret` must equal N8N_WEBHOOK_SECRET (constant-time compare).
 */
import {BadRequestException, Body, Controller, Headers, HttpCode, Inject, Injectable, OnModuleInit, Optional, Post, UnauthorizedException, ServiceUnavailableException} from '@nestjs/common';
import {Throttle} from '@nestjs/throttler';
import {createHash, timingSafeEqual} from 'node:crypto';
import {Db} from './core';
import {WorkspaceLiveService} from './workspace-live';
import type {CloneRecord} from './workspace-clone-core';

const KIND = 'private-n8n-event';
export const N8N_EVENTS = ['access.granted', 'access.not_required', 'access.failed', 'kisi.user_needed', 'access.revoked', 'access.revoke_failed'] as const;
const clip = (v: unknown, n = 300) => v == null ? '' : String(v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

/** Validates and normalises the payload. Unknown keys are dropped; nothing secret is stored. */
export function normaliseN8nEvent(body: any) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('JSON object required.');
  const event = clip(body.event, 40);
  if (!(N8N_EVENTS as readonly string[]).includes(event)) throw new BadRequestException('Unknown event. Expected one of: ' + N8N_EVENTS.join(', '));
  const contact = body.contact && typeof body.contact === 'object' ? body.contact : {};
  const kisi = body.kisi && typeof body.kisi === 'object' ? body.kisi : {};
  const email = clip(contact.email, 200).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('contact.email is invalid.');
  const windows = Array.isArray(kisi.windows) ? kisi.windows.slice(0, 100).map((w: any) => ({validFrom: clip(w?.valid_from ?? w?.validFrom, 40), validUntil: clip(w?.valid_until ?? w?.validUntil, 40), label: clip(w?.label, 120)})) : [];
  const executionId = clip(body.executionId, 80);
  const eventId = clip(body.eventId, 120) || (executionId ? executionId + ':' + event : '');
  if (!eventId) throw new BadRequestException('eventId or executionId is required so retries are not recorded twice.');
  const occurredAt = Number.isFinite(Date.parse(String(body.occurredAt))) ? new Date(String(body.occurredAt)).toISOString() : new Date().toISOString();
  return {
    eventId, event, occurredAt, workflow: clip(body.workflow, 120), executionId,
    contact: {id: clip(contact.id, 80), email, name: clip(contact.name, 160)},
    package: {subscriptionType: clip(body.package?.subscriptionType, 200), accessLevel: clip(body.package?.accessLevel, 80)},
    kisi: {userId: clip(kisi.userId, 40), groupId: clip(kisi.groupId, 40), windows, total: Number.isFinite(Number(kisi.total)) ? Number(kisi.total) : null, failed: Number.isFinite(Number(kisi.failed)) ? Number(kisi.failed) : null, revoked: Number.isFinite(Number(kisi.revoked)) ? Number(kisi.revoked) : null},
    invoiceId: clip(body.invoiceId, 80), reason: clip(body.reason, 500), note: clip(body.note, 500),
  };
}
export type N8nEvent = ReturnType<typeof normaliseN8nEvent> & {receivedAt: string};

const RESULT: Record<string, string> = {'access.granted': 'Access granted', 'access.not_required': 'No door access for package', 'access.failed': 'Kisi grant failed', 'kisi.user_needed': 'Kisi user needed', 'access.revoked': 'Access removed', 'access.revoke_failed': 'Kisi revoke failed'};
export function eventRow(e: N8nEvent): CloneRecord {
  const windows = e.kisi.windows.map((w: {validFrom: string; validUntil: string; label: string}) => w.label || (w.validFrom + ' to ' + w.validUntil)).join('; ');
  const counts = e.event.startsWith('access.revoke') ? (e.kisi.revoked != null ? e.kisi.revoked + ' removed' : '') : e.kisi.total != null ? e.kisi.total + ' window(s)' + (e.kisi.failed ? ', ' + e.kisi.failed + ' failed' : '') : '';
  return {id: 'n8n-' + createHash('sha256').update(e.eventId).digest('hex').slice(0, 24), provenance: 'LIVE' as never, receivedAt: e.receivedAt, occurredAt: e.occurredAt, status: RESULT[e.event] || e.event, member: e.contact.name || e.contact.email, email: e.contact.email, package: e.package.subscriptionType, kisiUser: e.kisi.userId, kisiGroup: e.kisi.groupId, detail: [counts, windows, e.reason].filter(Boolean).join(' · '), workflow: e.workflow, execution: e.executionId};
}

@Injectable()
export class N8nEventsService implements OnModuleInit {
  private recent: N8nEvent[] = [];
  private refreshTimer?: NodeJS.Timeout;
  constructor(@Inject(Db) private readonly db: Db, @Optional() @Inject(WorkspaceLiveService) private readonly live?: WorkspaceLiveService) {}
  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    try { const rows = await this.db.content.findMany({where: {kind: KIND}, orderBy: {createdAt: 'desc'}, take: 200}); this.recent = rows.map(r => r.content as unknown as N8nEvent); } catch { /* table empty or unavailable */ }
  }
  rows(): CloneRecord[] { return this.recent.map(eventRow); }
  verify(secretHeader: string | undefined) {
    const expected = process.env.N8N_WEBHOOK_SECRET?.trim();
    if (!expected || expected.length < 24) throw new ServiceUnavailableException('N8N_WEBHOOK_SECRET is not configured on the API server.');
    const a = createHash('sha256').update(String(secretHeader || '')).digest(), b = createHash('sha256').update(expected).digest();
    if (!timingSafeEqual(a, b)) throw new UnauthorizedException('Invalid webhook secret.');
  }
  async receive(body: unknown) {
    const event: N8nEvent = {...normaliseN8nEvent(body), receivedAt: new Date().toISOString()};
    try {
      await this.db.content.create({data: {kind: KIND, slug: event.eventId.replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 180), title: event.event, status: 'DRAFT', content: event as object}});
    } catch (e: any) {
      if (e?.code === 'P2002') return {status: 'duplicate', eventId: event.eventId};
      throw e;
    }
    this.recent = [event, ...this.recent].slice(0, 200);
    // Debounced refresh: a burst of events from one workflow run triggers one Kisi + Sheet pull.
    if (this.live?.enabled) { if (this.refreshTimer) clearTimeout(this.refreshTimer); this.refreshTimer = setTimeout(() => void this.live!.refreshAll().catch(() => undefined), 2000); this.refreshTimer.unref(); }
    return {status: 'accepted', eventId: event.eventId};
  }
}

@Controller('integrations/n8n')
export class N8nEventsController {
  constructor(@Inject(N8nEventsService) private readonly events: N8nEventsService) {}
  @Post('events') @HttpCode(202) @Throttle({default: {limit: 120, ttl: 60000}})
  async receive(@Headers('x-wsj-webhook-secret') secret: string | undefined, @Body() body: unknown) {
    this.events.verify(secret);
    return this.events.receive(body);
  }
}
