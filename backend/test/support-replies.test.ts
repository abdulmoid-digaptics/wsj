import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AccountAdminController} from '../src/account';
import {renderMail} from '../src/mail';

function fixture(user: {role: string; canReplySupport: boolean; active?: boolean}) {
  const queued: any[] = [], replies: any[] = [], audits: any[] = [];
  let request: any = {id: 'req-1', customerId: 'cust-1', subject: 'Question about Compliance Monitoring', status: 'OPEN'};
  const db: any = {
    user: {findUnique: async () => ({active: true, ...user})},
    supportRequest: {findUnique: async ({where}: any) => (where.id === request.id ? request : null), update: async ({data}: any) => (request = {...request, ...data})},
    customer: {findUnique: async () => ({id: 'cust-1', name: 'Dana Buyer', email: 'dana@example.invalid'})},
    supportReply: {create: async ({data}: any) => {const row = {id: 'reply-' + (replies.length + 1), createdAt: new Date(), emailOutboxId: null, ...data}; replies.push(row); return row;}, update: async ({where, data}: any) => Object.assign(replies.find(r => r.id === where.id), data), findMany: async () => replies},
    emailOutbox: {findMany: async () => [{id: 'out-1', status: 'SENT'}]},
    audit: {create: async ({data}: any) => {audits.push(data); return data;}},
  };
  const outbox: any = {enqueue: async (entry: any) => {queued.push(entry); return {id: 'out-1', created: true};}};
  return {controller: new AccountAdminController(db, {} as any, outbox), queued, replies, audits, get request() {return request;}};
}
const staff = {user: {id: 'staff-1', name: 'Sam Staff', email: 'sam@example.invalid'}};

test('an admin reply is emailed to the customer, recorded, audited and moves the request to in progress', async () => {
  const f = fixture({role: 'ADMIN', canReplySupport: false});
  const sent = await f.controller.replySupport('req-1', {message: 'Hi Dana,\nYes, we can update it.'} as any, staff);
  assert.equal(sent.status, 'IN_PROGRESS');
  assert.equal(f.request.status, 'IN_PROGRESS');
  assert.equal(f.queued.length, 1);
  assert.equal(f.queued[0].to, 'dana@example.invalid');
  assert.equal(f.queued[0].template, 'support_reply');
  assert.equal(f.queued[0].dedupeKey, 'support-reply:reply-1');
  assert.equal(f.replies[0].emailOutboxId, 'out-1');
  assert.deepEqual(f.audits[0], {actorId: 'staff-1', action: 'REPLY', resource: 'support-request', resourceId: 'req-1'});
  const mail = await renderMail({} as any, {customerId: null, template: 'support_reply', payload: f.queued[0].payload});
  assert.equal(mail.subject, 'Re: Question about Compliance Monitoring');
  assert.match(mail.text, /Hello Dana Buyer,\n\nHi Dana,\nYes, we can update it\.\n\nSam Staff/);
  const history = await f.controller.supportReplies('req-1');
  assert.equal(history.items[0].emailStatus, 'SENT');
});

test('only admins and staff an admin has allowed can reply', async () => {
  for (const role of ['EDITOR', 'VIEWER']) {
    const blocked = fixture({role, canReplySupport: false});
    await assert.rejects(blocked.controller.replySupport('req-1', {message: 'Hello there'} as any, staff), /administrator must allow you/);
    assert.equal(blocked.queued.length, 0);
    const allowed = fixture({role, canReplySupport: true});
    await allowed.controller.replySupport('req-1', {message: 'Hello there'} as any, staff);
    assert.equal(allowed.queued.length, 1);
  }
  const disabled = fixture({role: 'ADMIN', canReplySupport: true, active: false});
  await assert.rejects(disabled.controller.replySupport('req-1', {message: 'Hello there'} as any, staff), /administrator must allow you/);
  await assert.rejects(fixture({role: 'ADMIN', canReplySupport: false}).controller.replySupport('missing', {message: 'Hello there'} as any, staff), /not found/);
});
