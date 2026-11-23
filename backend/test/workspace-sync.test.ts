import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceSyncService} from '../src/workspace-sync';

const live = (section: string, id: number, v: Record<string, unknown>) => ({id: 'live-' + section + '-' + id, provenance: 'LIVE', ...v}) as any;
const users = [live('users', 7, {name: 'Live User', email: 'live@example.test', status: 'Enabled'})];
const groups = [live('groups', 11, {name: 'Desk', sourceGroupId: '11'})];
function fixture(roles: any[] = []) {
  const calls: Array<[string, string, any]> = []; const audits: any[] = [];
  const kisi: any = {configured: true, request: async (p: string, m = 'GET', b?: any) => { calls.push([m, p, b]); return {id: 99}; }, list: async (p: string) => { calls.push(['GET', p, undefined]); return p.startsWith('/role_assignments') ? roles : []; }, remove: async (id: string) => { calls.push(['DELETE', '/role_assignments/' + id, undefined]); }};
  const db: any = {audit: {create: async ({data}: any) => { audits.push(data); return data; }}};
  return {sync: new WorkspaceSyncService(db, kisi), calls, audits, kisi};
}
const withWrites = async (fn: () => Promise<void>) => { const prev = process.env.KISI_LIVE_WRITES; process.env.KISI_LIVE_WRITES = 'true'; try { await fn(); } finally { if (prev === undefined) delete process.env.KISI_LIVE_WRITES; else process.env.KISI_LIVE_WRITES = prev; } };

test('everything refuses while live sync is off', async () => {
  const prev = process.env.KISI_LIVE_WRITES; process.env.KISI_LIVE_WRITES = 'false';
  try { const {sync, calls} = fixture(); await assert.rejects(sync.setUserAccess(users[0], false, 'qa'), /off/); assert.equal(calls.length, 0); }
  finally { if (prev === undefined) delete process.env.KISI_LIVE_WRITES; else process.env.KISI_LIVE_WRITES = prev; }
});
test('grant sends a basic group assignment with the exact window and audits it', () => withWrites(async () => {
  const {sync, calls, audits} = fixture();
  await sync.createAccess({user: 'live@example.test', group: 'Desk', role: 'group_basic', validFrom: '2026-12-01T15:00:00Z', validUntil: '2026-12-01T23:00:00Z'}, users, groups, 'qa');
  assert.deepEqual(calls[0], ['POST', '/role_assignments', {role_assignment: {assignee_type: 'User', assignee_id: 7, applies_to_type: 'Group', applies_to_id: 11, role_id: 'group_basic', valid_from: '2026-12-01T15:00:00Z', valid_until: '2026-12-01T23:00:00Z'}}]);
  assert.equal(audits[0].action, 'KISI_ACCESS_GRANTED');
}));
test('grant refuses unknown users/groups, manager roles, past or reversed windows', () => withWrites(async () => {
  const {sync, calls} = fixture();
  for (const bad of [{user: 'ghost@example.test', group: 'Desk'}, {user: 'live@example.test', group: 'Nope'}, {user: 'live@example.test', group: 'Desk', role: 'group_manager'}, {user: 'live@example.test', group: 'Desk', validUntil: '2020-01-01T00:00:00Z'}, {user: 'live@example.test', group: 'Desk', validFrom: '2026-12-02T00:00:00Z', validUntil: '2026-12-01T00:00:00Z'}])
    await assert.rejects(sync.createAccess(bad, users, groups, 'qa'));
  assert.equal(calls.length, 0);
}));
test('changing a window creates the replacement before removing the old one', () => withWrites(async () => {
  const {sync, calls} = fixture();
  const row = live('access-rights', 5, {user: 'live@example.test', group: 'Desk', role: 'group_basic', validFrom: '2026-12-01T15:00:00Z', validUntil: '2026-12-01T23:00:00Z'});
  await sync.updateAccess(row, {validUntil: '2026-12-02T23:00:00Z'}, users, groups, 'qa');
  assert.equal(calls[0][0] + ' ' + calls[0][1], 'POST /role_assignments'); assert.equal(calls[0][2].role_assignment.notify, false);
  assert.equal(calls[1][0] + ' ' + calls[1][1], 'DELETE /role_assignments/5');
}));
test('failed removal after replacement is reported, never silent', () => withWrites(async () => {
  const f = fixture(); f.kisi.remove = async () => { throw new Error('boom'); };
  const row = live('access-rights', 5, {user: 'live@example.test', group: 'Desk', role: 'group_basic', validUntil: '2026-12-01T23:00:00Z'});
  await assert.rejects(f.sync.updateAccess(row, {validUntil: '2026-12-02T23:00:00Z'}, users, groups, 'qa'), /could not be removed/);
  assert.equal(f.audits[0].action, 'KISI_ACCESS_REPLACE_PARTIAL');
}));
test('suspend/resume and user edits send only changed fields; email changes are refused', () => withWrites(async () => {
  const {sync, calls} = fixture();
  await sync.setUserAccess(users[0], false, 'qa');
  assert.deepEqual(calls[0], ['PATCH', '/users/7', {user: {access_enabled: false}}]);
  await sync.updateUser(users[0], {name: 'Renamed', email: 'live@example.test', status: 'Enabled', notes: ''}, 'qa');
  assert.deepEqual(calls[1], ['PATCH', '/users/7', {user: {name: 'Renamed'}}]);
  await assert.rejects(sync.updateUser(users[0], {email: 'other@example.test'}, 'qa'), /cannot be changed/);
}));
test('offboarding removes only basic access and stops on privileged roles', () => withWrites(async () => {
  const ok = fixture([{id: 1, assignee_id: 7, role_id: 'group_basic'}, {id: 2, assignee_id: 7, role_id: 'group_basic'}]);
  assert.match(await ok.sync.offboard('live@example.test', users, 'qa'), /Removed 2/);
  assert.deepEqual(ok.calls.filter(c => c[0] === 'DELETE').map(c => c[1]), ['/role_assignments/1', '/role_assignments/2']);
  const admin = fixture([{id: 3, assignee_id: 7, role_id: 'organization_admin'}]);
  await assert.rejects(admin.sync.offboard('live@example.test', users, 'qa'), /admin or manager/);
  assert.equal(admin.calls.filter(c => c[0] === 'DELETE').length, 0);
  assert.match(await ok.sync.offboard('nobody@example.test', users, 'qa'), /No Kisi user/);
}));
test('removing a manager role is refused', () => withWrites(async () => {
  const {sync, calls} = fixture();
  await assert.rejects(sync.removeAccess(live('access-rights', 6, {role: 'group_manager'}), 'qa'), /Only basic/);
  assert.equal(calls.length, 0);
}));
