/**
 * Live monitoring for Workspace operations: READ-ONLY mirrors of the Kisi organization and the
 * Workspace Growth Google Sheet. Nothing here writes to Kisi or Google. The only non-GET call is
 * Kisi's POST /event_sets, which creates a temporary event search (it changes no access).
 * Device tokens, MAC/IP addresses and credential secrets are never copied.
 */
import {Inject, Injectable, OnModuleDestroy, OnModuleInit} from '@nestjs/common';
import {Db} from './core';
import {KisiClient, KisiObject} from './kisi-client';
import type {CloneRecord} from './workspace-clone-core';

const KIND = 'private-workspace-live', SLUG = 'snapshot';
export const SHEET_ID = process.env.WORKSPACE_SHEET_ID || '1MXJT49vRaW3_m1q3qT46TwXwyXmJnzr0JiJWkugJRcA';
const SHEET_TABS: Array<[string, string]> = [['weekly-reports', '0'], ['packages', '802408204'], ['kpis', '961810478'], ['active-members', '1806738112'], ['expiring', '1588689696'], ['failed-payments', '1128793749'], ['marketplace', '2096368621']];
const MARKET_KEYS = ['date', 'paymentIntentId', 'chargeId', 'product', 'category', 'quantity', 'totalAmount', 'platformFee', 'vendorPayout', 'vendorName', 'vendorEmail', 'vendorStripeAccount', 'customerEmail', 'customerName', 'transferId', 'currency', 'status', 'orderReference'];
const ACCESS_ACTIONS = /unlock|locked|lock_down|lockdown|held_open|forced|denied|triggered|opened|closed|tamper|first_to_arrive|access/i;

export type LiveSource = {ok: boolean; fetchedAt: string | null; error: string | null};
export type LiveSnapshot = {kisi: LiveSource; sheets: LiveSource; records: Record<string, CloneRecord[]>; kpis: Record<string, number | string | null> | null};
const empty = (): LiveSnapshot => ({kisi: {ok: false, fetchedAt: null, error: null}, sheets: {ok: false, fetchedAt: null, error: null}, records: {}, kpis: null});
const cell = (v: unknown): string | number | boolean | null => v === undefined || v === null ? null : typeof v === 'number' || typeof v === 'boolean' ? v : String(v);
const row = (section: string, id: string | number, values: Record<string, unknown>): CloneRecord => ({id: 'live-' + section + '-' + id, provenance: 'LIVE' as never, ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, cell(v)]))});
const safeError = (e: unknown) => e instanceof Error && !/KISI-LOGIN/i.test(e.message) ? e.message.slice(0, 200) : 'Live refresh failed.';

/** RFC 4180 CSV parser (quotes, escaped quotes, CRLF, embedded newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let cur: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c; continue; }
    if (c === '"') quoted = true; else if (c === ',') { cur.push(field); field = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; cur.push(field); rows.push(cur); cur = []; field = ''; } else field += c;
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}
const typed = (v: string): string | number | null => { const s = v.trim(); if (s === '') return null; return /^-?\d+(\.\d+)?$/.test(s) && !/^0\d/.test(s) ? Number(s) : s; };

/** Map Sheet tabs onto the clone's section columns. */
export function mapSheet(section: string, csv: string): CloneRecord[] {
  const rows = parseCsv(csv); if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).map((r, i) => {
    const values: Record<string, unknown> = {};
    if (section === 'marketplace') MARKET_KEYS.forEach((k, j) => { values[k] = typed(r[j] ?? ''); });
    else header.forEach((h, j) => { if (h) values[h] = typed(r[j] ?? ''); });
    if ((section === 'active-members' || section === 'expiring' || section === 'failed-payments') && typeof values.phone === 'number') values.phone = '+' + values.phone;
    return row(section, i + 1, values);
  });
}

/** Map Kisi objects onto the clone's sections. Only display-safe fields are kept. */
export function mapKisi(d: {users: KisiObject[]; groups: any[]; groupLocks: Record<string, string[]>; roles: any[]; locks: any[]; readers: any[]; controllers: any[]; floors: any[]; elevators: any[]; terminals: any[]; links: any[]; cards: any[]; guests: any[]; places: any[]; events: any[]}): Record<string, CloneRecord[]> {
  const floorName = new Map(d.floors.map((f: any) => [f.id, f.name]));
  const lockName = new Map(d.locks.map((l: any) => [l.id, l.name]));
  const groupName = new Map(d.groups.map((g: any) => [g.id, g.name]));
  const doorStatus = (l: any) => l.locked_down ? 'Locked down' : l.online === false ? 'Offline' : l.unlocked ? 'Unlocked' : 'Locked';
  const access = d.events.filter(e => ACCESS_ACTIONS.test(String(e.action || e.type)));
  const audit = d.events.filter(e => !ACCESS_ACTIONS.test(String(e.action || e.type)));
  const event = (section: string) => (e: any) => row(section, e.uuid, {object: e.object_name || e.object_type, action: e.success === false ? (e.action || e.type) + ' (failed)' : e.action || e.type, user: e.actor_email || e.actor_name || '', occurredAt: e.created_at, sourceDisplay: e.message || e.type});
  return {
    users: d.users.map((u: any) => row('users', u.id, {name: u.name || u.email, email: u.email, status: u.access_enabled === false ? 'Suspended' : 'Enabled', notes: u.notes, lastAccess: u.last_accessed_at ? new Date(u.last_accessed_at).toLocaleDateString('en-US', {timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric'}) : 'Never'})),
    groups: d.groups.map((g: any) => row('groups', g.id, {name: g.name, description: g.description, scope: g.place_id ? 'Place' : 'Organization', sourceGroupId: String(g.id), doors: (d.groupLocks[String(g.id)] || []).join(', '),
      // Live values come straight from Kisi, so the policy counts as reviewed for simulations.
      policyReviewed: true, appAccess: g.login_enabled !== false, primaryDeviceRestriction: !!g.primary_device_restriction_enabled, geofenceRestriction: !!g.geofence_restriction_enabled, readerProximityRestriction: !!g.reader_restriction_enabled, readerTapRestriction: !!g.tap_to_access_restriction_enabled, timeRestriction: !!g.time_restriction_enabled, timeZone: g.time_restriction_time_zone || 'America/Chicago'})),
    'access-rights': d.roles.filter((r: any) => r.assignee_type === 'User' || r.user_id).map((r: any) => row('access-rights', r.id, {user: r.user?.email || r.assignee?.email || '', group: groupName.get(r.applies_to_id ?? r.group_id) || r.group?.name || String(r.applies_to_id ?? ''), role: r.role_id, validFrom: r.valid_from, validUntil: r.valid_until, status: 'Active'})),
    doors: d.locks.map((l: any) => row('doors', l.id, {name: l.name, floor: floorName.get(l.floor_id) || l.description || '', status: doorStatus(l), schedule: l.on_scheduled_unlock ? 'On scheduled unlock' : l.unlocked_until ? 'Unlocked until ' + l.unlocked_until : ''})),
    hardware: [...d.readers.map((r: any) => row('hardware', 'reader-' + r.id, {name: r.name, type: 'Reader', status: r.online ? 'Online' : 'Offline', door: lockName.get(r.lock_id) || '', notes: [r.model, r.tampered ? 'Tamper alert' : ''].filter(Boolean).join(' · ')})),
      ...d.controllers.map((c: any) => row('hardware', 'controller-' + c.id, {name: c.name, type: 'Controller', status: c.online ? 'Online' : 'Offline', door: '', notes: c.model || ''}))],
    floors: d.floors.map((f: any) => row('floors', f.id, {name: f.name, number: f.number})),
    elevators: d.elevators.map((e: any) => row('elevators', e.id, {name: e.name, floors: '', status: e.online === false ? 'Disabled' : 'Enabled'})),
    'access-points': d.terminals.map((t: any) => row('access-points', t.id, {name: t.name, door: '', useCase: t.description, status: 'Enabled'})),
    'digital-credentials': d.links.map((l: any) => row('digital-credentials', l.id, {name: l.name || l.email, type: l.link_enabled && l.quick_response_code_type ? 'QR code & Link' : l.quick_response_code_type ? 'QR code' : 'Access Link', group: groupName.get(l.group_id) || l.group?.name || '', validUntil: l.valid_until ? new Date(l.valid_until).toISOString() : 'Forever', lastUsed: l.last_used_at ? new Date(l.last_used_at).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}) : 'Never', status: 'Reference only'})),
    credentials: d.cards.map((c: any) => row('credentials', c.id, {name: c.name || 'Card ' + c.id, user: c.user?.email || '', model: 'Card', status: c.enabled === false ? 'Suspended' : 'Active'})),
    visitors: d.guests.map((g: any) => row('visitors', g.id, {name: g.name, email: g.email, group: g.group?.name || '', validFrom: g.valid_from, validUntil: g.valid_until, shareAccess: true, delivery: 'Email', accessType: 'Access link', status: 'Invited'})),
    places: d.places.map((p: any) => row('places', p.id, {name: p.name, address: p.address, timeZone: p.tz_time_zone || p.time_zone || 'America/Chicago', sourcePlaceId: String(p.id)})),
    events: access.map(event('events')),
    'audit-events': audit.map(event('audit-events')),
  };
}

@Injectable()
export class WorkspaceLiveService implements OnModuleInit, OnModuleDestroy {
  private snapshot: LiveSnapshot = empty();
  private kisiTimer?: NodeJS.Timeout; private sheetTimer?: NodeJS.Timeout; private kisiBusy = false; private sheetBusy = false;
  constructor(@Inject(Db) private readonly db: Db, @Inject(KisiClient) private readonly kisi: KisiClient) {}
  get enabled() { return process.env.WORKSPACE_LIVE_MONITOR === 'true'; }
  async onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !this.enabled) return;
    try { const saved = await this.db.content.findUnique({where: {kind_slug: {kind: KIND, slug: SLUG}}}); if (saved?.content) this.snapshot = saved.content as never; } catch { /* fresh start */ }
    const every = Math.max(30, Number(process.env.WORKSPACE_LIVE_INTERVAL_SECONDS) || 60) * 1000;
    const kisiTick = () => void this.refreshKisi().catch(() => undefined), sheetTick = () => void this.refreshSheets().catch(() => undefined);
    setTimeout(kisiTick, 3000).unref(); setTimeout(sheetTick, 5000).unref();
    this.kisiTimer = setInterval(kisiTick, every); this.sheetTimer = setInterval(sheetTick, Math.max(every, 120000));
    this.kisiTimer.unref(); this.sheetTimer.unref();
  }
  onModuleDestroy() { if (this.kisiTimer) clearInterval(this.kisiTimer); if (this.sheetTimer) clearInterval(this.sheetTimer); }
  current(): LiveSnapshot & {enabled: boolean} { return {...this.snapshot, enabled: this.enabled}; }
  private async persist() { const content = JSON.parse(JSON.stringify(this.snapshot)); await this.db.content.upsert({where: {kind_slug: {kind: KIND, slug: SLUG}}, create: {kind: KIND, slug: SLUG, title: 'Workspace live monitor snapshot', status: 'DRAFT', content}, update: {content}}).catch(() => undefined); }
  async refreshAll() { await Promise.allSettled([this.refreshKisi(), this.refreshSheets()]); return this.current(); }

  async refreshKisi() {
    if (this.kisiBusy || !this.kisi.configured) { if (!this.kisi.configured) this.snapshot.kisi = {ok: false, fetchedAt: this.snapshot.kisi.fetchedAt, error: 'KISI_API_KEY is not configured on the server.'}; return; }
    this.kisiBusy = true;
    try {
      const get = <T = any>(p: string) => this.kisi.request<T>(p);
      const list = (p: string) => this.kisi.list(p) as Promise<any[]>;
      const [users, groups, roles, locks, readers, controllers, places, elevators, terminals, links, cards, guests] = await Promise.all([
        list('/users'), list('/groups'), list('/role_assignments?applies_to_type=Group'), list('/locks'), list('/readers'), list('/controllers'), list('/places'),
        list('/elevators'), list('/terminals'), list('/group_links'), list('/cards'), list('/guests')]);
      const floors = (await Promise.all(places.map(p => list('/floors?place_id=' + p.id)))).flat();
      const groupLocks: Record<string, string[]> = {};
      const lockName = new Map(locks.map(l => [l.id, l.name]));
      for (const g of groups.filter(g => Number(g.locks_count) > 0)) groupLocks[String(g.id)] = (await list('/group_locks?group_id=' + g.id)).map((x: any) => lockName.get(x.lock_id) || x.lock?.name).filter(Boolean);
      const events = await this.recentEvents(get);
      Object.assign(this.snapshot.records, mapKisi({users, groups, groupLocks, roles, locks, readers, controllers, floors, elevators, terminals, links, cards, guests, places, events}));
      this.snapshot.kisi = {ok: true, fetchedAt: new Date().toISOString(), error: null};
    } catch (e) { this.snapshot.kisi = {...this.snapshot.kisi, ok: false, error: safeError(e)}; }
    finally { this.kisiBusy = false; await this.persist(); }
  }
  /** Last 7 days, newest first, up to 250 events. Event sets are read-only searches kept by Kisi for ~24h. */
  private async recentEvents(get: <T>(p: string) => Promise<T>) {
    const until = new Date(), from = new Date(until.getTime() - 7 * 86400000);
    let set = await this.kisi.request<any>('/event_sets', 'POST', {event_set: {interval: from.toISOString().replace(/\.\d+Z$/, 'Z') + '/' + until.toISOString().replace(/\.\d+Z$/, 'Z')}});
    for (let i = 0; i < 10 && set.status === 'in_progress'; i++) { await new Promise(r => setTimeout(r, 1000)); set = await get<any>('/event_sets/' + set.id + '?limit=50'); }
    if (set.status !== 'finished') throw new Error('Kisi event search did not finish.');
    const events: any[] = [...(set.events || [])];
    let cursor = set.cursor;
    while (cursor && events.length < 250) { const page = await get<any>('/event_sets/' + set.id + '?limit=50&cursor=' + encodeURIComponent(cursor)); if (!page.events?.length) break; events.push(...page.events); cursor = page.cursor; }
    return events;
  }
  async refreshSheets() {
    if (this.sheetBusy) return; this.sheetBusy = true;
    try {
      for (const [section, gid] of SHEET_TABS) {
        const res = await fetch('https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + gid, {signal: AbortSignal.timeout(20000), redirect: 'follow'});
        if (!res.ok) throw new Error('Google Sheet tab ' + gid + ' returned ' + res.status + '. Check the sheet is still shared with "Anyone with the link".');
        const text = await res.text();
        if (/^\s*<!DOCTYPE html/i.test(text)) throw new Error('Google Sheet is no longer link-shared; live Sheet data paused.');
        this.snapshot.records[section] = mapSheet(section, text);
      }
      const k = this.snapshot.records.kpis?.[0];
      this.snapshot.kpis = k ? {active: k.active_count as number, expiring: k.expiring_count as number, failed: k.failed_count as number, lastUpdated: k.last_updated as string} : null;
      this.snapshot.sheets = {ok: true, fetchedAt: new Date().toISOString(), error: null};
    } catch (e) { this.snapshot.sheets = {...this.snapshot.sheets, ok: false, error: safeError(e)}; }
    finally { this.sheetBusy = false; await this.persist(); }
  }
}
