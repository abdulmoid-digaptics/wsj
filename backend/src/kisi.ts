import {BadRequestException, ConflictException, Controller, Get, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, Param, Patch, Post, Query, Req, ServiceUnavailableException, UseGuards} from '@nestjs/common';
import {ApiBearerAuth} from '@nestjs/swagger';
import {IsBoolean, IsOptional, IsString, Matches} from 'class-validator';
import {randomUUID} from 'node:crypto';
import {AuthGuard, Db, Roles} from './core';
import {ValidatedBody} from './validation';
import {KisiApiError, KisiClient, KisiObject} from './kisi-client';
import {AccessWindow, accessPlanId, accessWindow, coworkingAccessWindow, hasPaidSubscriptionPeriod, jsonObject, matchingAssignment} from './kisi-plan';

class KisiMappingDto {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,14}$/) groupId?: string;
}
const safeError = (error: unknown) => error instanceof KisiApiError ? error.message : error instanceof Error && !/https?:|KISI-LOGIN/i.test(error.message) ? error.message.slice(0, 240) : 'Kisi sync failed. Retry or check server configuration.';

/** Reconciles persisted paid state, outside Stripe's transactions. All mutations share a database lease. */
@Injectable()
export class KisiService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private starting?: NodeJS.Timeout;
  private busy = false;
  constructor(@Inject(Db) private readonly db: Db, @Inject(KisiClient) private readonly kisi: KisiClient) {}
  get enabled() { return process.env.KISI_ENABLED === 'true'; }
  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !this.enabled || !this.kisi.configured) return;
    const tick = () => void this.sync().catch(() => console.warn('[kisi] Access reconciliation failed; admin Door access shows member-level errors.'));
    this.starting = setTimeout(tick, 15000);
    this.timer = setInterval(tick, 60000);
    this.starting.unref(); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); if (this.starting) clearTimeout(this.starting); }
  private requireEnabled() {
    if (!this.kisi.configured || !this.enabled) throw new ServiceUnavailableException('Set KISI_API_KEY and KISI_ENABLED=true on the server before syncing.');
  }
  private async locked<T>(work: (assertLease: () => Promise<void>) => Promise<T>) {
    if (this.busy) throw new ConflictException('Another Kisi sync is running. Retry shortly.');
    this.busy = true;
    const token = randomUUID();
    let heartbeat: NodeJS.Timeout | undefined;
    try {
      await this.db.kisiSyncLock.upsert({where: {id: 'sync'}, create: {id: 'sync', token: '', until: new Date(0)}, update: {}});
      const acquired = await this.db.kisiSyncLock.updateMany({where: {id: 'sync', until: {lt: new Date()}}, data: {token, until: new Date(Date.now() + 120000)}});
      if (!acquired.count) throw new ConflictException('Another Kisi sync is running. Retry shortly.');
      let lost = false;
      heartbeat = setInterval(() => { void this.db.kisiSyncLock.updateMany({where: {id: 'sync', token, until: {gt: new Date()}}, data: {until: new Date(Date.now() + 120000)}}).then(r => { if (!r.count) lost = true; }).catch(() => { lost = true; }); }, 20000);
      const assertLease = async () => {
        if (lost || !await this.db.kisiSyncLock.findFirst({where: {id: 'sync', token, until: {gt: new Date(Date.now() + 30000)}}})) throw new ConflictException('Kisi sync lease expired. Retry shortly.');
      };
      return await work(assertLease);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await this.db.kisiSyncLock.updateMany({where: {id: 'sync', token}, data: {until: new Date(0)}}).catch(() => undefined);
      this.busy = false;
    }
  }
  async overview(search?: string) {
    let groups: KisiObject[] = [], error: string | undefined;
    if (this.kisi.configured) try { groups = await this.kisi.list('/groups'); } catch (caught) { error = safeError(caught); }
    const [catalog, legacy, mappings, members] = await Promise.all([
      this.db.catalogPlan.findMany({where: {archivedAt: null}, select: {id: true, name: true}, orderBy: {name: 'asc'}}),
      this.db.plan.findMany({where: {archivedAt: null}, select: {id: true, name: true}, orderBy: {name: 'asc'}}),
      this.db.kisiPlanMapping.findMany(), this.db.kisiMember.findMany({include: {grants: {orderBy: {updatedAt: 'desc'}}}, orderBy: {updatedAt: 'desc'}}),
    ]);
    const customers = await this.db.customer.findMany({where: {id: {in: members.map(m => m.customerId)}}, select: {id: true, name: true, email: true}});
    const byCustomer = new Map(customers.map(c => [c.id, c]));
    const q = String(search || '').trim().toLowerCase().slice(0, 200);
    return {configured: this.kisi.configured, enabled: this.enabled, liveWritesAllowed: process.env.KISI_LIVE_WRITES === 'true', ...(error ? {error} : {}), groups: groups.map(g => ({id: g.id, name: g.name || String(g.id)})),
      plans: [...catalog, ...legacy.map(p => ({...p, name: p.name + ' (legacy)'}))].map(p => { const m = mappings.find(m => m.planId === p.id); return {...p, enabled: m?.enabled || false, groupId: m?.groupId || null}; }),
      members: members.map(m => ({...m, name: byCustomer.get(m.customerId)?.name || '', email: byCustomer.get(m.customerId)?.email || ''})).filter(m => !q || (m.name + ' ' + m.email).toLowerCase().includes(q)),
    };
  }
  async mapping(planId: string, dto: KisiMappingDto, actorId: string) {
    return this.locked(async () => {
      const exists = await this.db.catalogPlan.findUnique({where: {id: planId}}) || await this.db.plan.findUnique({where: {id: planId}});
      if (!exists) throw new NotFoundException('Package not found');
      if (dto.enabled) {
        if (!dto.groupId || !Number.isSafeInteger(Number(dto.groupId))) throw new BadRequestException('Choose a valid Kisi group before enabling access.');
        const groups = await this.kisi.list('/groups');
        if (!groups.some(g => String(g.id) === dto.groupId)) throw new BadRequestException('This Kisi group is not available to the configured account.');
      }
      await this.db.kisiPlanMapping.upsert({where: {planId}, create: {planId, enabled: dto.enabled, groupId: dto.groupId || null}, update: {enabled: dto.enabled, groupId: dto.groupId || null}});
      await this.db.audit.create({data: {actorId, action: 'KISI_MAPPING_UPDATED', resource: 'kisi', resourceId: planId, details: {enabled: dto.enabled, groupId: dto.groupId || null}}});
      return {ok: true};
    });
  }
  private async desired(customerId: string, now: Date): Promise<{windows: AccessWindow[]; errors: string[]}> {
    const [mappings, subscriptions, orders] = await Promise.all([
      this.db.kisiPlanMapping.findMany({where: {enabled: true, groupId: {not: null}}}),
      this.db.subscription.findMany({where: {customerId}, include: {invoices: {where: {status: 'paid'}}}}),
      this.db.order.findMany({where: {customerId, status: 'PAID'}, include: {items: true, coworkingDays: {where: {status: 'ACTIVE'}}}}),
    ]);
    const groups = new Map(mappings.map(m => [m.planId, m.groupId!]));
    const windows: AccessWindow[] = [], errors: string[] = [];
    for (const sub of subscriptions) {
      const group = groups.get(accessPlanId(sub) || '');
      if (!group) continue;
      if (!hasPaidSubscriptionPeriod(sub, sub.invoices, now)) {
        if (sub.accessStatus === 'ACTIVE' && sub.stripeStatus === 'active' && sub.currentPeriodEnd && sub.currentPeriodEnd > now) errors.push('No verified paid invoice service period for this subscription. Historical invoice events may need replay before access can be granted.');
        continue;
      }
      const window = accessWindow('subscription:' + sub.id, group, sub.currentPeriodStart!, sub.currentPeriodEnd!, now);
      if (window) windows.push(window);
    }
    for (const order of orders) {
      const claims = await this.db.inventoryClaim.findMany({where: {ownerRef: 'order:' + order.id, state: 'CONFIRMED', kind: 'ALLOCATION'}});
      for (const item of order.items) {
        if (item.billingType !== 'ONE_TIME') continue;
        const group = groups.get(accessPlanId(item) || '');
        if (!group) continue;
        const meta = jsonObject(item.metadata), snapshot = jsonObject(meta.catalogPlan);
        const legacy = item.planId ? await this.db.plan.findUnique({where: {id: item.planId}, select: {slug: true, reservationService: {select: {serviceId: true}}}}) : null;
        const catalog = !item.planId && typeof snapshot.id === 'string' ? await this.db.catalogPlan.findUnique({where: {id: snapshot.id}, select: {serviceId: true, durationMinutes: true, billingUnit: true}}) : null;
        const serviceId = catalog?.serviceId || legacy?.reservationService?.serviceId;
        const slug = String(snapshot.slug || meta.slug || legacy?.slug || '');
        const days = order.coworkingDays.filter(d => d.planSlug === slug);
        if (days.length) {
          for (const day of days) { const window = coworkingAccessWindow('day:' + item.id + ':' + day.id, group, day.day, now); if (window) windows.push(window); }
          continue;
        }
        const schedule = jsonObject(order.metadata).schedule;
        const starts = Array.isArray(schedule) ? schedule.filter(s => s?.planSlug === slug && typeof s.startAt === 'string').map(s => Date.parse(s.startAt)) : [];
        const booked = claims.filter(c => serviceId && c.serviceId === serviceId && starts.includes(c.startsAt.getTime()));
        if (!booked.length && !claims.length && starts.length) {
          // No inventory system holds this order (no claims at all): derive the window from the paid
          // booking itself. Unknown durations fail closed instead of guessing.
          const unit = String(meta.billingUnit || catalog?.billingUnit || '');
          const units = Math.max(1, Number(meta.units) || item.quantity || 1);
          const minutes = unit === 'PER_HOUR' ? units * 60 : unit === 'PER_DAY' ? units * 1440 : Number(catalog?.durationMinutes) > 0 ? Number(catalog!.durationMinutes) : 0;
          if (!minutes) { errors.push('Package "' + item.description.slice(0, 80) + '" has no booking duration configured. Set a duration on the package to grant door access.'); continue; }
          for (const start of starts.filter(Number.isFinite)) {
            const window = accessWindow('booking:' + item.id + ':' + new Date(start).toISOString(), group, new Date(start - 15 * 60000), new Date(start + minutes * 60000), now);
            if (window) windows.push(window);
          }
          continue;
        }
        if (!booked.length) { errors.push('Package "' + item.description.slice(0, 80) + '" has no confirmed booked access window. Unscheduled one-time packages do not grant door access.'); continue; }
        for (const claim of booked) {
          const window = accessWindow('booking:' + item.id + ':' + claim.id, group, new Date(claim.startsAt.getTime() - 15 * 60000), claim.endsAt, now);
          if (window) windows.push(window);
        }
      }
    }
    return {windows, errors};
  }
  private async findUser(email: string) {
    const users = await this.kisi.list('/users?email=' + encodeURIComponent(email));
    const exact = users.filter(u => u.email?.trim().toLowerCase() === email.trim().toLowerCase());
    if (exact.length > 1) throw new Error('Multiple Kisi users share this email. Resolve the duplicate before syncing.');
    return exact[0];
  }
  private async resolveUser(memberId: string, customer: {email: string; name: string}, create: boolean, assertLease: () => Promise<void>): Promise<string | null> {
    const member = await this.db.kisiMember.findUniqueOrThrow({where: {id: memberId}});
    if (member.kisiUserId) return member.kisiUserId;
    let user = await this.findUser(customer.email);
    if (!user && create) {
      await assertLease();
      try { user = await this.kisi.request<KisiObject>('/users', 'POST', {user: {name: customer.name, email: customer.email}}); }
      catch (error) { if (!(error instanceof KisiApiError && error.status === 422)) throw error; user = await this.findUser(customer.email); if (!user) throw error; }
    }
    if (!user) return null;
    if (!Number.isSafeInteger(user.id)) throw new Error('Kisi returned an invalid user ID.');
    const linked = await this.db.kisiMember.findUnique({where: {kisiUserId: String(user.id)}});
    if (linked && linked.id !== memberId) throw new Error('This Kisi user is linked to another customer. Resolve duplicate customer identities first.');
    await this.db.kisiMember.update({where: {id: memberId}, data: {kisiUserId: String(user.id)}});
    return String(user.id);
  }
  /** Explicit offboarding removes all basic member assignments, including imported n8n assignments. */
  private async revokeMember(memberId: string, assertLease: () => Promise<void>) {
    const member = await this.db.kisiMember.findUniqueOrThrow({where: {id: memberId}});
    const customer = await this.db.customer.findUniqueOrThrow({where: {id: member.customerId}});
    const userId = await this.resolveUser(member.id, customer, false, assertLease);
    if (userId) {
      const roles = await this.kisi.list('/role_assignments?assignee_type=User&assignee_id=' + userId);
      if (roles.some(r => r.assignee_type !== 'User' || String(r.assignee_id) !== userId)) throw new Error('Kisi returned assignments for an unexpected user. Nothing was revoked.');
      if (roles.some(r => r.role_id !== 'group_basic')) throw new Error('This Kisi user has privileged roles. Review and remove those roles in Kisi before offboarding.');
      for (const role of roles) { await assertLease(); await this.kisi.remove(String(role.id)); }
    }
    await this.db.kisiGrant.updateMany({where: {memberId}, data: {status: 'REVOKED', assignmentId: null, error: null}});
    await this.db.kisiMember.update({where: {id: memberId}, data: {status: 'OFFBOARDED', error: null}});
  }
  async offboard(customerId: string, actorId: string) {
    this.requireEnabled();
    return this.locked(async assertLease => {
      if (!await this.db.customer.findUnique({where: {id: customerId}})) throw new NotFoundException('Customer not found');
      const member = await this.db.kisiMember.upsert({where: {customerId}, create: {customerId, blocked: true, status: 'REVOKING'}, update: {blocked: true, status: 'REVOKING', error: null}});
      await this.db.audit.create({data: {actorId, action: 'KISI_OFFBOARD_REQUESTED', resource: 'kisi', resourceId: customerId}});
      try { await this.revokeMember(member.id, assertLease); }
      catch (error) { await this.db.kisiMember.update({where: {id: member.id}, data: {status: 'REVOKE_FAILED', error: safeError(error)}}); throw new ServiceUnavailableException(safeError(error)); }
      await this.db.audit.create({data: {actorId, action: 'KISI_OFFBOARDED', resource: 'kisi', resourceId: customerId}});
      return {ok: true};
    });
  }
  async resume(customerId: string, actorId: string) {
    this.requireEnabled();
    await this.locked(async () => {
      const member = await this.db.kisiMember.findUnique({where: {customerId}});
      if (!member) throw new NotFoundException('Access member not found');
      await this.db.kisiMember.update({where: {id: member.id}, data: {blocked: false, status: 'PENDING', error: null}});
      await this.db.audit.create({data: {actorId, action: 'KISI_RESUMED', resource: 'kisi', resourceId: customerId}});
    });
    return this.sync(undefined, customerId);
  }
  async sync(actorId?: string, onlyCustomerId?: string) {
    this.requireEnabled();
    return this.locked(async assertLease => {
      const [orders, subscriptions, saved] = await Promise.all([
        this.db.order.findMany({where: {status: 'PAID'}, distinct: ['customerId'], select: {customerId: true}}),
        this.db.subscription.findMany({where: {accessStatus: {in: ['ACTIVE', 'PAST_DUE']}}, distinct: ['customerId'], select: {customerId: true}}),
        this.db.kisiMember.findMany({select: {customerId: true}}),
      ]);
      const ids = [...new Set([...orders, ...subscriptions, ...saved].map(x => x.customerId))];
      for (const customerId of ids.filter(id => !onlyCustomerId || id === onlyCustomerId)) {
        await assertLease();
        const customer = await this.db.customer.findUnique({where: {id: customerId}});
        if (!customer) continue;
        const desired = await this.desired(customerId, new Date());
        let member = await this.db.kisiMember.findUnique({where: {customerId}});
        if (!member && !desired.windows.length && !desired.errors.length) continue;
        member = member || await this.db.kisiMember.create({data: {customerId}});
        try {
          if (member.blocked) { if (member.status !== 'OFFBOARDED') await this.revokeMember(member.id, assertLease); continue; }
          const userId = await this.resolveUser(member.id, customer, desired.windows.length > 0, assertLease);
          const remote = userId ? await this.kisi.list('/role_assignments?assignee_type=User&assignee_id=' + userId) : [];
          const existing = await this.db.kisiGrant.findMany({where: {memberId: member.id}});
          // Revoke obsolete owned windows first. Do not delete unrelated memberships on automatic suspension.
          for (const grant of existing.filter(g => !desired.windows.some(w => w.sourceKey === g.sourceKey))) {
            // Crash recovery: POST may have succeeded before assignmentId could be persisted.
            const orphan = !grant.assignmentId && grant.status !== 'REVOKED' ? remote.find(r => userId && matchingAssignment(r, userId, grant)) : null;
            const assignmentId = grant.assignmentId || (orphan ? String(orphan.id) : null);
            if (assignmentId) {
              const row = remote.find(r => String(r.id) === assignmentId);
              if (row && (!userId || !matchingAssignment(row, userId, grant))) throw new Error('An owned Kisi assignment was changed externally. Review it before retrying.');
              await assertLease(); await this.kisi.remove(assignmentId);
            }
            if (grant.status !== 'REVOKED') await this.db.kisiGrant.update({where: {id: grant.id}, data: {status: 'REVOKED', assignmentId: null, error: null}});
          }
          for (const window of desired.windows) {
            await assertLease();
            const grant = await this.db.kisiGrant.upsert({where: {sourceKey: window.sourceKey}, create: {...window, memberId: member.id}, update: {}});
            try {
              if (!userId) throw new Error('No Kisi user could be resolved.');
              const recorded = grant.assignmentId ? remote.find(r => String(r.id) === grant.assignmentId) : null;
              if (recorded && !matchingAssignment(recorded, userId, window)) throw new Error('An owned Kisi assignment was changed externally. Review it before retrying.');
              let assignment = remote.find(r => matchingAssignment(r, userId, window));
              if (!assignment) {
                await assertLease();
                assignment = await this.kisi.request<KisiObject>('/role_assignments', 'POST', {role_assignment: {assignee_type: 'User', assignee_id: Number(userId), applies_to_type: 'Group', applies_to_id: Number(window.groupId), role_id: 'group_basic', valid_from: window.validFrom.toISOString(), valid_until: window.validUntil.toISOString(), notify: existing.length === 0 && desired.windows[0].sourceKey === window.sourceKey}});
                if (!Number.isSafeInteger(assignment.id)) throw new Error('Kisi returned an invalid role assignment.');
                remote.push(assignment);
              }
              await this.db.kisiGrant.update({where: {id: grant.id}, data: {assignmentId: String(assignment.id), status: 'ACTIVE', error: null}});
            } catch (error) { await this.db.kisiGrant.update({where: {id: grant.id}, data: {status: 'FAILED', error: safeError(error)}}); throw error; }
          }
          await this.db.kisiMember.update({where: {id: member.id}, data: {status: desired.errors.length ? 'FAILED' : desired.windows.length ? 'SYNCED' : 'NO_ACCESS', error: desired.errors.length ? desired.errors.slice(0, 3).join(' ') : null}});
        } catch (error) { await this.db.kisiMember.update({where: {id: member.id}, data: {status: member.blocked ? 'REVOKE_FAILED' : 'FAILED', error: safeError(error)}}); }
      }
      if (actorId) await this.db.audit.create({data: {actorId, action: 'KISI_SYNC', resource: 'kisi'}});
      return {ok: true};
    });
  }
}

@ApiBearerAuth() @UseGuards(AuthGuard) @Roles('ADMIN') @Controller('admin/kisi')
export class KisiAdminController {
  constructor(@Inject(KisiService) private readonly service: KisiService) {}
  @Get() overview(@Query('search') search?: string) { return this.service.overview(typeof search === 'string' ? search : undefined); }
  @Patch('plans/:id') mapping(@Param('id') id: string, @ValidatedBody(KisiMappingDto) dto: KisiMappingDto, @Req() req: any) { return this.service.mapping(id, dto, req.user.id); }
  @Post('sync') sync(@Req() req: any) { return this.service.sync(req.user.id); }
  @Post('members/:id/offboard') offboard(@Param('id') id: string, @Req() req: any) { return this.service.offboard(id, req.user.id); }
  @Post('members/:id/resume') resume(@Param('id') id: string, @Req() req: any) { return this.service.resume(id, req.user.id); }
}
