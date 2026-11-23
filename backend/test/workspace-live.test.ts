import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapKisi, mapSheet, parseCsv} from '../src/workspace-live';
import {overlayLive, saveCloneRecord, seedClone, stripLive, applyCloneAction, cloneOverview, validateStoredClone} from '../src/workspace-clone-core';
import {KisiClient} from '../src/kisi-client';

const base = () => seedClone({version: 1, capturedAt: '2026-11-23T13:41:00Z', sourceLinks: {sheets: 'https://docs.google.com/x', kisi: 'https://web.kisi.io/x'}, workbook: {sheets: []}, kisi: {users: ['Old old@example.test--'], groups: ['Desk Workspace Junction 0 0'], doors: [{name: 'Main Entrance/Exit', status: 'Locked'}]}} as any);
const kisiData = (over: any = {}) => ({users: [{id: 7, name: 'Live User', email: 'live@example.test', access_enabled: true, last_accessed_at: '2026-11-21T19:52:00Z'}], groups: [{id: 11, name: 'Desk', place_id: 1, login_enabled: true, locks_count: 1, primary_device_restriction_enabled: false, geofence_restriction_enabled: false, reader_restriction_enabled: false, tap_to_access_restriction_enabled: false, time_restriction_enabled: false}], groupLocks: {'11': ['Main Entrance/Exit']}, roles: [{id: 5, assignee_type: 'User', user: {email: 'live@example.test'}, applies_to_id: 11, role_id: 'group_basic', valid_from: '2026-11-01T00:00:00Z', valid_until: '2026-12-31T00:00:00Z'}], locks: [{id: 3, name: 'Main Entrance/Exit', floor_id: 9, online: true, unlocked: false, locked_down: false}], readers: [{id: 1, name: 'Entrance', online: true, model: 'Pro', token: 'SECRET-TOKEN', ethernet_mac: 'aa:bb', ip_address: '10.0.0.5', lock_id: 3}], controllers: [], floors: [{id: 9, name: 'Main Floor/Entrance', number: 1}], elevators: [], terminals: [], links: [], cards: [], guests: [], places: [{id: 1, name: 'Workspace Junction', address: '1S280 Summit Ave', tz_time_zone: 'America/Chicago'}], events: [{uuid: 'u1', object_name: 'Main Entrance/Exit', action: 'unlock', actor_email: 'live@example.test', created_at: '2026-11-22T01:52:03Z', success: true}, {uuid: 'u2', object_name: 'tajammul', action: 'update', created_at: '2026-11-20T21:07:00Z', success: true}], ...over});

test('CSV parser handles quotes, commas, newlines and blank rows', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","he said ""hi"""\n"multi\nline",2\n\n'), [['a', 'b'], ['x, y', 'he said "hi"'], ['multi\nline', '2']]);
});
test('Sheet tabs map to clone columns, keep phone plus and leading zeros', () => {
  const rows = mapSheet('active-members', 'name,email,phone,plan,status,expires\nJohn,j@example.test,923871234567,Office,Active,2026-08-28T00:00:00.000Z\n');
  assert.equal(rows[0].phone, '+923871234567'); assert.equal(rows[0].provenance, 'LIVE'); assert.equal(rows[0].id, 'live-active-members-1');
  assert.equal(mapSheet('packages', 'subscription_type,kisi_group_id\nX,0123\n')[0].kisi_group_id, '0123');
  const m = mapSheet('marketplace', 'Date,Payment Intent ID,Charge ID,Product,Category,Quantity,Total Amount ($),Platform Fee ($),Vendor Payout ($)\n2026-07-29,pi,ch,P,G,1,10.00,1.00,9.00\n');
  assert.equal(m[0].totalAmount, 10); assert.equal(m[0].vendorPayout, 9);
});
test('Kisi mapping shows live door status, never copies device secrets, splits access vs audit', () => {
  const r = mapKisi(kisiData());
  assert.equal(r.doors[0].status, 'Locked'); assert.equal(r.doors[0].floor, 'Main Floor/Entrance');
  assert.equal(mapKisi(kisiData({locks: [{id: 3, name: 'D', online: false}]})).doors[0].status, 'Offline');
  assert.equal(mapKisi(kisiData({locks: [{id: 3, name: 'D', online: true, locked_down: true}]})).doors[0].status, 'Locked down');
  assert.equal(mapKisi(kisiData({locks: [{id: 3, name: 'D', online: true, unlocked: true}]})).doors[0].status, 'Unlocked');
  const json = JSON.stringify(r);
  for (const secret of ['SECRET-TOKEN', 'aa:bb', '10.0.0.5']) assert.ok(!json.includes(secret), 'leaked ' + secret);
  assert.equal(r.hardware[0].status, 'Online'); assert.equal(r.hardware[0].door, 'Main Entrance/Exit');
  assert.equal(r.events.length, 1); assert.equal(r['audit-events'].length, 1);
  assert.equal(r.groups[0].doors, 'Main Entrance/Exit'); assert.equal(r['access-rights'][0].group, 'Desk');
});
test('overlay replaces reference rows with live rows, keeps local rows, and never persists live rows', () => {
  const state = base();
  saveCloneRecord(state, 'users', {name: 'Local Only', email: 'local@example.test', status: 'Enabled'}, 'qa');
  const merged = overlayLive(state, {records: mapKisi(kisiData())});
  assert.deepEqual(merged.records.users.map(u => u.email), ['live@example.test', 'local@example.test']);
  const stored = stripLive(merged, state);
  assert.ok(stored.records.users.some(u => u.email === 'old@example.test'), 'reference kept for fallback');
  assert.ok(!stored.records.users.some(u => u.provenance === 'LIVE'));
  assert.doesNotThrow(() => validateStoredClone(stored));
});
test('live rows are read-only while live sync is off, but simulate against real Kisi data', () => {
  const merged = overlayLive(base(), {records: mapKisi(kisiData())});
  const liveUser = merged.records.users[0];
  assert.throws(() => saveCloneRecord(merged, 'users', {notes: 'x'}, 'qa', liveUser.id), /live from Kisi/);
  assert.throws(() => applyCloneAction(merged, 'suspend-user', 'users', liveUser.id, {}, 'qa'), /live from Kisi/);
  const msg = applyCloneAction(merged, 'simulate-unlock', 'doors', merged.records.doors[0].id, {userId: liveUser.id}, 'qa', new Date('2026-11-23T16:00:00Z'));
  assert.match(msg, /allowed/);
  applyCloneAction(merged, 'simulate-lockdown', 'doors', merged.records.doors[0].id, {}, 'qa');
  assert.equal(merged.localLockdown, true);
});
test('overview summary reads live Sheet KPIs', () => {
  const merged = overlayLive(base(), {records: {kpis: mapSheet('kpis', 'active_count,expiring_count,failed_count,last_updated\n5,1,2,2026-11-23T13:25:50Z\n')}});
  const o = cloneOverview(merged, new Date('2026-11-23T16:00:00Z'));
  assert.equal(o.summary.referenceActive, 5); assert.equal(o.summary.referenceExpiring, 1); assert.equal(o.summary.referenceFailed, 2);
});
test('event search may POST while every access write stays locked', async () => {
  const key = process.env.KISI_API_KEY, flag = process.env.KISI_LIVE_WRITES, original = globalThis.fetch;
  process.env.KISI_API_KEY = 'test-key'; process.env.KISI_LIVE_WRITES = 'false';
  const calls: string[] = [];
  globalThis.fetch = (async (url: string, init: any) => { calls.push(init.method + ' ' + url); return new Response('{"id":1,"status":"finished","events":[]}', {status: 200}); }) as any;
  try {
    const c = new KisiClient();
    await c.request('/event_sets', 'POST', {event_set: {}});
    for (const [p, m] of [['/role_assignments', 'POST'], ['/users', 'POST'], ['/locks/3/unlock', 'POST'], ['/places/1/lock_down', 'POST']] as const) await assert.rejects(c.request(p, m));
    assert.deepEqual(calls, ['POST https://api.kisi.io/event_sets']);
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.KISI_API_KEY; else process.env.KISI_API_KEY = key; if (flag === undefined) delete process.env.KISI_LIVE_WRITES; else process.env.KISI_LIVE_WRITES = flag; }
});
