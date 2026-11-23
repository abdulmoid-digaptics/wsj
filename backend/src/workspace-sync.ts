/**
 * Two-way sync for Workspace operations. When KISI_LIVE_WRITES=true, admin edits to LIVE Kisi rows are
 * applied to the real Kisi organization:
 *  - users: create, rename, notes, suspend/resume (access_enabled)
 *  - access rights: create, change (create new first, then remove old: no access gap), remove
 *  - member offboarding: removes the person's basic group access in Kisi
 * Groups, doors, devices, unlocks and lockdown are never changed here. Every write is audited.
 */
import {BadRequestException, Inject, Injectable, ServiceUnavailableException} from '@nestjs/common';
import {Db} from './core';
import {KisiClient, KisiObject} from './kisi-client';
import type {CloneRecord} from './workspace-clone-core';
import {validCloneDate} from './workspace-clone-core';

const kisiId = (row: CloneRecord, section: string) => { const m = new RegExp('^live-' + section + '-(\\d+)$').exec(row.id); if (!m) throw new BadRequestException('This row is not a Kisi record.'); return m[1]; };
const text = (v: unknown) => v == null ? '' : String(v).trim();

@Injectable()
export class WorkspaceSyncService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(KisiClient) private readonly kisi: KisiClient) {}
  get enabled() { return process.env.KISI_LIVE_WRITES === 'true' && this.kisi.configured; }
  private require() { if (!this.enabled) throw new ServiceUnavailableException('Live sync to Kisi is off. Set KISI_LIVE_WRITES=true on the API server.'); }
  private audit(actorId: string, action: string, resourceId: string, details: Record<string, unknown>) { return this.db.audit.create({data: {actorId, action, resource: 'kisi-live', resourceId, details: details as object}}).catch(() => undefined); }

  /** Sections where creating a record writes to Kisi while live sync is on. */
  static readonly CREATE_SECTIONS = ['users', 'access-rights'];
  static readonly EDIT_SECTIONS = ['users', 'access-rights'];

  async createUser(data: Record<string, unknown>, actorId: string) {
    this.require();
    const name = text(data.name), email = text(data.email).toLowerCase();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Name and a valid email are required.');
    const existing = (await this.kisi.list('/users?email=' + encodeURIComponent(email))).find(u => u.email?.toLowerCase() === email);
    if (existing) throw new BadRequestException('A Kisi user with this email already exists.');
    const created = await this.kisi.request<KisiObject>('/users', 'POST', {user: {name, email, ...(text(data.notes) ? {notes: text(data.notes)} : {}), access_enabled: data.status !== 'Suspended'}});
    await this.audit(actorId, 'KISI_USER_CREATED', String(created.id), {email});
    return 'Created ' + email + ' in Kisi.';
  }
  async updateUser(row: CloneRecord, data: Record<string, unknown>, actorId: string) {
    this.require();
    const id = kisiId(row, 'users');
    if ('email' in data && text(data.email).toLowerCase() !== text(row.email).toLowerCase()) throw new BadRequestException('Kisi user emails cannot be changed here. Change it in Kisi.');
    const user: Record<string, unknown> = {};
    if ('name' in data && text(data.name) && text(data.name) !== text(row.name)) user.name = text(data.name);
    if ('notes' in data && text(data.notes) !== text(row.notes)) user.notes = text(data.notes) || null;
    if ('status' in data && data.status !== row.status) { if (!['Enabled', 'Suspended'].includes(String(data.status))) throw new BadRequestException('Choose Enabled or Suspended.'); user.access_enabled = data.status === 'Enabled'; }
    if (!Object.keys(user).length) return 'No changes to send to Kisi.';
    await this.kisi.request('/users/' + id, 'PATCH', {user});
    await this.audit(actorId, 'KISI_USER_UPDATED', id, {fields: Object.keys(user)});
    return 'Updated ' + text(row.email) + ' in Kisi.';
  }
  async setUserAccess(row: CloneRecord, enabled: boolean, actorId: string) {
    this.require();
    const id = kisiId(row, 'users');
    await this.kisi.request('/users/' + id, 'PATCH', {user: {access_enabled: enabled}});
    await this.audit(actorId, enabled ? 'KISI_USER_RESUMED' : 'KISI_USER_SUSPENDED', id, {email: text(row.email)});
    return (enabled ? 'Resumed ' : 'Suspended ') + text(row.email) + ' in Kisi. Group memberships are kept.';
  }
  /** Resolve a live user email and live group name to Kisi ids, and validate the window. */
  private assignment(data: Record<string, unknown>, users: CloneRecord[], groups: CloneRecord[]) {
    const user = users.find(u => u.provenance === 'LIVE' && text(u.email).toLowerCase() === text(data.user).toLowerCase());
    const group = groups.find(g => g.provenance === 'LIVE' && text(g.name) === text(data.group));
    if (!user) throw new BadRequestException('Choose a user that exists in Kisi.');
    if (!group || !/^\d+$/.test(text(group.sourceGroupId))) throw new BadRequestException('Choose a group that exists in Kisi.');
    if ((data.role ?? 'group_basic') !== 'group_basic') throw new BadRequestException('Only basic door access (group_basic) can be granted from here. Manager roles are assigned in Kisi.');
    const from = text(data.validFrom), until = text(data.validUntil);
    if ((from && !validCloneDate(from, true)) || (until && !validCloneDate(until, true))) throw new BadRequestException('Valid from and until must be dates with a timezone.');
    if (from && until && Date.parse(from) >= Date.parse(until)) throw new BadRequestException('Valid until must be after valid from.');
    if (until && Date.parse(until) <= Date.now()) throw new BadRequestException('Valid until must be in the future.');
    return {userId: Number(kisiId(user, 'users')), groupId: Number(group.sourceGroupId), from: from || null, until: until || null, email: text(user.email), groupName: text(group.name)};
  }
  async createAccess(data: Record<string, unknown>, users: CloneRecord[], groups: CloneRecord[], actorId: string) {
    this.require();
    const a = this.assignment(data, users, groups);
    const created = await this.kisi.request<KisiObject>('/role_assignments', 'POST', {role_assignment: {assignee_type: 'User', assignee_id: a.userId, applies_to_type: 'Group', applies_to_id: a.groupId, role_id: 'group_basic', valid_from: a.from, valid_until: a.until}});
    await this.audit(actorId, 'KISI_ACCESS_GRANTED', String(created.id), {email: a.email, group: a.groupName, from: a.from, until: a.until});
    return 'Granted ' + a.groupName + ' to ' + a.email + ' in Kisi.';
  }
  /** Kisi cannot edit a window in place: create the replacement first, then remove the old one. */
  async updateAccess(row: CloneRecord, data: Record<string, unknown>, users: CloneRecord[], groups: CloneRecord[], actorId: string) {
    this.require();
    const oldId = kisiId(row, 'access-rights');
    if (data.status === 'Revoked') return this.removeAccess(row, actorId);
    const merged = {user: row.user, group: row.group, role: row.role, validFrom: row.validFrom, validUntil: row.validUntil, ...data};
    const a = this.assignment(merged, users, groups);
    const created = await this.kisi.request<KisiObject>('/role_assignments', 'POST', {role_assignment: {assignee_type: 'User', assignee_id: a.userId, applies_to_type: 'Group', applies_to_id: a.groupId, role_id: 'group_basic', valid_from: a.from, valid_until: a.until, notify: false}});
    try { await this.kisi.remove(oldId); }
    catch (e) { await this.audit(actorId, 'KISI_ACCESS_REPLACE_PARTIAL', oldId, {newId: created.id}); throw new ServiceUnavailableException('The new access window was created in Kisi, but the old one could not be removed. Remove assignment ' + oldId + ' in Kisi or retry.'); }
    await this.audit(actorId, 'KISI_ACCESS_CHANGED', String(created.id), {replaced: oldId, email: a.email, group: a.groupName, from: a.from, until: a.until});
    return 'Updated ' + a.email + "'s " + a.groupName + ' access in Kisi.';
  }
  async removeAccess(row: CloneRecord, actorId: string) {
    this.require();
    const id = kisiId(row, 'access-rights');
    if (text(row.role) && text(row.role) !== 'group_basic') throw new BadRequestException('Only basic door access can be removed from here. Manager roles are changed in Kisi.');
    await this.kisi.remove(id);
    await this.audit(actorId, 'KISI_ACCESS_REMOVED', id, {email: text(row.user), group: text(row.group)});
    return 'Removed ' + text(row.group) + ' access for ' + text(row.user) + ' in Kisi.';
  }
  /** Offboarding a member removes every basic group assignment of their Kisi user. Privileged roles stop it. */
  async offboard(email: string, users: CloneRecord[], actorId: string) {
    this.require();
    const user = users.find(u => u.provenance === 'LIVE' && text(u.email).toLowerCase() === email.toLowerCase());
    if (!user) return 'No Kisi user has the email ' + email + ', so there was no door access to remove.';
    const id = kisiId(user, 'users');
    const roles = await this.kisi.list('/role_assignments?assignee_type=User&assignee_id=' + id);
    if (roles.some(r => String(r.assignee_id) !== id)) throw new ServiceUnavailableException('Kisi returned assignments for another user. Nothing was removed.');
    if (roles.some(r => r.role_id !== 'group_basic')) throw new BadRequestException(email + ' has admin or manager roles in Kisi. Review those in Kisi before offboarding.');
    for (const r of roles) await this.kisi.remove(String(r.id));
    await this.audit(actorId, 'KISI_MEMBER_OFFBOARDED', id, {email, removed: roles.length});
    return 'Removed ' + roles.length + ' door access assignment' + (roles.length === 1 ? '' : 's') + ' for ' + email + ' in Kisi.';
  }
}
