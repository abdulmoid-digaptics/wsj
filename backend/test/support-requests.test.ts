import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AccountService, AccountAdminController} from '../src/account';
import {BillingService} from '../src/billing';
import {renderMail} from '../src/mail';

test('a customer help request is saved and emailed to the team inbox once', async () => {
  const prev = process.env.INQUIRY_TO;
  process.env.INQUIRY_TO = 'team@example.invalid';
  try {
    const queued: any[] = [];
    const db: any = {
      supportRequest: {create: async ({data}: any) => ({id: 'req-1', status: 'OPEN', createdAt: new Date(), ...data})},
      billingEvent: {create: async () => ({})},
      customer: {findUnique: async () => ({name: 'Dana Buyer', email: 'dana@example.invalid'})},
      subscription: {findFirst: async () => ({id: 'sub-1'})}, order: {findFirst: async () => null}, booking: {findFirst: async () => null},
    };
    const billing = new BillingService(db, {} as any, {enqueue: async (entry: any) => {queued.push(entry); return {id: 'out-1', created: true};}} as any);
    const service = new AccountService(db, {} as any, billing, {} as any, {} as any);
    (service as any).safeReference = async () => 'sub-1';
    const result = await service.support({id: 'cust-1', email: 'dana@example.invalid', name: 'Dana'} as any, {type: 'SUPPORT', subject: 'Question about Business Address', message: 'Can I change my mailing name?\nThanks', reference: 'sub-1'} as any);
    assert.equal(result.id, 'req-1');
    assert.equal(queued.length, 1);
    assert.equal(queued[0].to, 'team@example.invalid');
    assert.equal(queued[0].template, 'support_request');
    assert.equal(queued[0].dedupeKey, 'support-request:req-1');
    const mail = await renderMail({} as any, {customerId: null, template: 'support_request', payload: queued[0].payload});
    assert.match(mail.subject, /Help request - Question about Business Address/);
    assert.match(mail.text, /Dana Buyer <dana@example\.invalid>/);
    assert.match(mail.text, /Can I change my mailing name\?\nThanks/);
  } finally {
    if (prev === undefined) delete process.env.INQUIRY_TO; else process.env.INQUIRY_TO = prev;
  }
});

test('admins see customer details and status changes are audited', async () => {
  const audits: any[] = [];
  let row: any = {id: 'req-1', customerId: 'cust-1', type: 'SUPPORT', subject: 'Help', message: 'Hi', status: 'OPEN', createdAt: new Date()};
  const db: any = {
    supportRequest: {findMany: async () => [row], count: async () => 1, findUnique: async ({where}: any) => (where.id === row.id ? row : null), update: async ({data}: any) => (row = {...row, ...data})},
    customer: {findMany: async () => [{id: 'cust-1', name: 'Dana Buyer', email: 'dana@example.invalid'}]},
    audit: {create: async ({data}: any) => {audits.push(data); return data;}},
  };
  const admin = new AccountAdminController(db, {} as any);
  const list = await admin.supportRequests();
  assert.equal(list.open, 1);
  assert.equal(list.items[0].customerEmail, 'dana@example.invalid');
  const updated = await admin.updateSupport('req-1', {status: 'RESOLVED'} as any, {user: {id: 'admin-1'}});
  assert.equal(updated.status, 'RESOLVED');
  assert.deepEqual(audits[0], {actorId: 'admin-1', action: 'UPDATE', resource: 'support-request', resourceId: 'req-1'});
  await assert.rejects(admin.updateSupport('missing', {status: 'RESOLVED'} as any, {user: {id: 'admin-1'}}), /not found/);
});
