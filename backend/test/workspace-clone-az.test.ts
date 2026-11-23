import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {WorkspaceCloneService} from '../src/workspace-clone';
import {capturedEventTime} from '../src/workspace-clone-core';
import {applyCloneAction, cloneOverview, cloneSections, deleteCloneRecord, saveCloneRecord, seedClone, validateStoredClone, CloneState} from '../src/workspace-clone-core';

/* A-Z coverage: every section in the clone gets create, edit, invalid input and delete; every action runs. */
const now = new Date('2026-11-23T16:00:00Z');
const refPath = path.resolve(__dirname, '../private/workspace-reference.json');
const from = '2026-11-23T06:00:00Z', until = '2026-11-24T06:00:00Z';

function fresh(): CloneState {
  if (existsSync(refPath)) return seedClone(JSON.parse(readFileSync(refPath, 'utf8')));
  return seedClone({version: 1, capturedAt: now.toISOString(), sourceLinks: {sheets: 'https://docs.google.com/x', kisi: 'https://web.kisi.io/x'}, workbook: {sheets: []}, kisi: {users: ['A a@example.test--'], groups: ['G Workspace Junction 0 0'], doors: [{name: 'Main Entrance/Exit', status: 'Locked'}]}} as any);
}
/** Valid sample per section; values reference existing seeded records where needed. */
function sample(state: CloneState, key: string): Record<string, unknown> {
  const user = String(state.records.users[0].email), group = String(state.records.groups[0].name), door = String(state.records.doors[0].name);
  const team = state.records.teams[0]?.name;
  const map: Record<string, Record<string, unknown>> = {
    packages: {subscription_type: 'AZ Package', amount: 10, interval: 1, pricing_mode: 'monthly', quantity_unit: 'none', kisi_access: 'Yes', kisi_group_id: '123'},
    'active-members': {name: 'AZ Member', email: 'az.member@example.test', status: 'Active', expires: '2026-11-27T00:00:00Z', plan: 'AZ'},
    marketplace: {date: now.toISOString(), product: 'AZ', quantity: 2, totalAmount: 20, platformFee: 2, vendorPayout: 18, currency: 'usd', status: 'succeeded'},
    leads: {name: 'AZ Lead', status: 'WON', createdAt: now.toISOString()},
    'report-schedules': {name: 'AZ Weekly', frequency: 'Weekly', status: 'Draft'},
    users: {name: 'AZ User', email: 'az.user@example.test', status: 'Enabled'},
    teams: {name: 'AZ Team', members: user, groups: group, validFrom: from, validUntil: until},
    groups: {name: 'AZ Group', scope: 'Place', doors: door, policyReviewed: true, appAccess: true, primaryDeviceRestriction: false, geofenceRestriction: false, readerProximityRestriction: false, readerTapRestriction: false, timeRestriction: false},
    'access-rights': {user, group, role: 'group_basic', validFrom: from, validUntil: until, status: 'Active'},
    schedules: {name: 'AZ Hours', group, weekdays: '1,2,3,4,5', startTime: '09:00', endTime: '17:00', timeZone: 'America/Chicago', enabled: true},
    credentials: {name: 'AZ Card', user, model: 'Card', status: 'Active'},
    'digital-credentials': {name: 'AZ QR', type: 'QR code', group, status: 'Draft'},
    'apple-passes': {name: 'AZ Pass', email: 'pass@example.test', status: 'Draft'},
    doors: {name: 'AZ Door', status: 'Locked'},
    hardware: {name: 'AZ Reader', type: 'Reader', status: 'Online'},
    floors: {name: 'AZ Floor', number: 2},
    elevators: {name: 'AZ Lift', status: 'Enabled'},
    'access-points': {name: 'AZ Point', door, status: 'Draft'},
    'intrusion-zones': {name: 'AZ Zone', status: 'Disarmed'},
    visitors: {name: 'AZ Guest', email: 'guest@example.test', group, validFrom: from, validUntil: until, shareAccess: true, delivery: 'Email', accessType: 'Access link', status: 'Invited'},
    'visitor-points': {name: 'AZ Front desk', team: team ?? 'missing', visitReasons: 'Delivery', emailField: 'Required', durationHours: 8},
    'badge-templates': {name: 'AZ Badge', jobTitle: 'Member'},
    integrations: {name: 'AZ Integration', type: 'Badge Printer', scope: 'Organization', status: 'Draft'},
    places: {name: 'AZ Place', timeZone: 'America/Chicago'},
    'organization-settings': {name: 'AZ Org', timeZone: 'America/Chicago', sessionTimeoutDays: 14},
    incidents: {subject: 'AZ Incident', severity: 'High', type: 'Door forced', status: 'Active'},
    'incident-policies': {name: 'AZ Policy', severity: 'Low', type: 'Door held', status: 'Draft'},
    'floor-plans': {name: 'AZ Plan'},
    'custom-roles': {name: 'AZ Role'},
    'event-retention': {name: 'AZ Retention', periodDays: 90, action: 'Anonymize', status: 'Draft'},
  };
  return map[key];
}
/** One invalid payload per section, expected to be rejected with a clear error. */
const invalid: Record<string, Record<string, unknown>> = {
  packages: {amount: -1}, 'active-members': {email: 'not-an-email'}, marketplace: {platformFee: 5}, leads: {status: 'MAYBE'},
  'report-schedules': {frequency: 'Hourly'}, users: {email: 'bad'}, teams: {members: 'ghost@example.test'}, groups: {scope: 'Galaxy'},
  'access-rights': {validUntil: '2026-11-22T00:00:00Z'}, schedules: {startTime: '25:00'}, credentials: {user: 'ghost@example.test'},
  'digital-credentials': {type: 'Laser'}, 'apple-passes': {email: 'nope'}, doors: {status: 'Ajar'}, hardware: {type: 'Toaster'},
  floors: {number: 'two'}, elevators: {status: 'Flying'}, 'access-points': {door: 'Ghost door'}, 'intrusion-zones': {status: 'Panic'},
  visitors: {validUntil: '2026-11-01T00:00:00Z'}, 'visitor-points': {durationHours: 999}, 'badge-templates': {name: ''},
  integrations: {scope: 'Universe'}, places: {timeZone: 'Mars/Base'}, 'organization-settings': {sessionTimeoutDays: 0},
  incidents: {severity: 'Apocalyptic'}, 'incident-policies': {status: 'Maybe'}, 'floor-plans': {name: ''}, 'custom-roles': {name: ''},
  'event-retention': {periodDays: 0},
};

test('A-Z: every section loads with its schema and the reference data counts', () => {
  const state = fresh(), sections = cloneOverview(state, now).sections;
  assert.ok(sections.length >= 37);
  for (const s of sections) { assert.ok(s.label && s.columns.length, s.key + ' has columns'); assert.ok(Array.isArray(s.records)); }
  assert.doesNotThrow(() => validateStoredClone(state));
});

test('A-Z: every editable section supports create, edit, rejects bad input, and delete', () => {
  const state = fresh();
  // A team must exist before a visitor registration point can reference it.
  saveCloneRecord(state, 'teams', sample(state, 'teams'), 'qa', undefined, now);
  const results: string[] = [];
  for (const s of cloneSections(state).filter(x => !x.readOnly)) {
    const data = sample(state, s.key);
    assert.ok(data, 'no sample for ' + s.key);
    const before = state.records[s.key].length;
    if (!(s.key === 'teams' && state.records.teams.some(t => t.name === 'AZ Team'))) saveCloneRecord(state, s.key, data, 'qa', undefined, now);
    assert.equal(state.records[s.key].length, s.key === 'teams' ? Math.max(before, 1) : before + 1, s.key + ' created');
    const row = state.records[s.key].at(-1)!;
    assert.equal(row.provenance, 'LOCAL');
    const structured = /exceptionDates|members|groups|doors|floors|weekdays|visitReasons/;
    const textCol = s.columns.find(c => c.type === 'textarea' && !c.readOnly && !structured.test(c.key)) || s.columns.find(c => c.type === 'text' && !c.readOnly && !/email|name|subject|subscription_type|kisi_group_id|timeZone|startTime|endTime|weekdays|type/i.test(c.key));
    if (textCol) { saveCloneRecord(state, s.key, {[textCol.key]: 'edited'}, 'qa', row.id, now); assert.equal(state.records[s.key].find(r => r.id === row.id)![textCol.key], 'edited', s.key + ' edited'); }
    assert.throws(() => saveCloneRecord(state, s.key, invalid[s.key], 'qa', row.id, now), undefined, s.key + ' rejects invalid input');
    assert.throws(() => saveCloneRecord(state, s.key, {hackerField: 'x'}, 'qa', row.id, now), /Unknown or protected/);
    results.push(s.key);
  }
  // Delete in dependency order: dependents first, then their parents.
  const order = ['visitor-points', 'access-rights', 'schedules', 'credentials', 'digital-credentials', 'access-points', 'visitors'];
  for (const key of [...order, ...results.filter(k => !order.includes(k))]) {
    const row = [...state.records[key]].reverse().find(r => r.provenance === 'LOCAL');
    if (!row) continue;
    try { deleteCloneRecord(state, key, row.id, 'qa', now); } catch (e) {
      // Shared records (e.g. the test team or group) are still referenced by other local rows; that guard is the point.
      assert.match(String((e as Error).message), /Remove dependent/, key + ' delete failed unexpectedly: ' + (e as Error).message);
    }
  }
  assert.ok(results.length >= 30, 'covered ' + results.length + ' editable sections');
  assert.doesNotThrow(() => validateStoredClone(state));
});

test('A-Z: read-only sections refuse create, edit and delete', () => {
  const state = fresh();
  for (const s of cloneSections(state).filter(x => x.readOnly)) {
    assert.throws(() => saveCloneRecord(state, s.key, {}, 'qa'), /not locally editable/, s.key);
    const row = state.records[s.key][0];
    if (row) assert.throws(() => deleteCloneRecord(state, s.key, row.id, 'qa'), /not locally editable/, s.key);
  }
});

test('A-Z: every local action works and records an audit entry', () => {
  const state = fresh();
  const audit = () => state.records['audit-events'].length;
  let n = audit();
  applyCloneAction(state, 'generate-report', 'weekly-reports', undefined, {}, 'qa', now); assert.equal(audit(), ++n);
  const user = state.records.users[0];
  applyCloneAction(state, 'suspend-user', 'users', user.id, {}, 'qa', now); assert.equal(user.status, 'Suspended'); n++;
  applyCloneAction(state, 'resume-user', 'users', user.id, {}, 'qa', now); assert.equal(user.status, 'Enabled'); n++;
  const member = state.records['active-members'][0];
  applyCloneAction(state, 'offboard-member', 'active-members', member.id, {}, 'qa', now); assert.equal(member.status, 'Cancelled'); n++;
  saveCloneRecord(state, 'visitors', {...sample(state, 'visitors')}, 'qa', undefined, now); n++;
  const visitor = state.records.visitors.at(-1)!;
  applyCloneAction(state, 'check-in-visitor', 'visitors', visitor.id, {}, 'qa', now); assert.equal(visitor.status, 'Checked in'); n++;
  applyCloneAction(state, 'check-out-visitor', 'visitors', visitor.id, {}, 'qa', now); assert.equal(visitor.status, 'Checked out'); n++;
  assert.throws(() => applyCloneAction(state, 'check-out-visitor', 'visitors', visitor.id, {}, 'qa', now), /checked-in/);
  const door = state.records.doors[0];
  const msg = applyCloneAction(state, 'simulate-unlock', 'doors', door.id, {userId: user.id}, 'qa', now); assert.match(msg, /No real door/); n++;
  applyCloneAction(state, 'simulate-lockdown', 'doors', door.id, {}, 'qa', now); assert.equal(state.localLockdown, true); n++;
  applyCloneAction(state, 'simulate-lockdown', 'doors', undefined, {}, 'qa', now); assert.equal(state.localLockdown, false); n++;
  assert.equal(audit(), n);
  assert.throws(() => applyCloneAction(state, 'delete-everything', undefined, undefined, {}, 'qa', now), /Unsupported/);
});

test('A-Z: full grant path — group policy, assignment, schedule, unlock allowed, then each revoke path denies', () => {
  const state = fresh();
  const user = state.records.users[0]; user.status = 'Enabled';
  const door = state.records.doors[0];
  saveCloneRecord(state, 'groups', sample(state, 'groups'), 'qa', undefined, now);
  saveCloneRecord(state, 'access-rights', {...sample(state, 'access-rights'), group: 'AZ Group'}, 'qa', undefined, now);
  const unlock = () => applyCloneAction(state, 'simulate-unlock', 'doors', door.id, {userId: user.id}, 'qa', now);
  assert.match(unlock(), /allowed/);
  const right = state.records['access-rights'].at(-1)!;
  right.status = 'Revoked'; assert.match(unlock(), /denied/); right.status = 'Active';
  applyCloneAction(state, 'suspend-user', 'users', user.id, {}, 'qa', now); assert.match(unlock(), /denied/);
  applyCloneAction(state, 'resume-user', 'users', user.id, {}, 'qa', now); assert.match(unlock(), /allowed/);
  applyCloneAction(state, 'simulate-lockdown', 'doors', undefined, {}, 'qa', now); assert.match(unlock(), /denied/);
  const events = state.records.events.filter(e => e.provenance === 'LOCAL');
  assert.ok(events.length >= 5 && events.every(e => /No real door signal sent/.test(String(e.sourceDisplay))));
});

test('A-Z: weekly report math matches the workbook formulas on local data', () => {
  const state = fresh();
  state.records['active-members'] = [];
  for (const [i, status] of ['Active', 'Active', 'Active'].entries()) saveCloneRecord(state, 'active-members', {name: 'M' + i, email: `m${i}@example.test`, status, plan: i < 2 ? 'Desk' : 'Office', expires: '2026-12-30T00:00:00Z'}, 'qa', undefined, now);
  saveCloneRecord(state, 'active-members', {name: 'Gone', email: 'gone@example.test', status: 'Active', plan: 'Desk', expires: '2026-11-23T10:00:00Z'}, 'qa', undefined, now);
  for (const status of ['WON', 'NEW', 'NEW', 'LOST']) saveCloneRecord(state, 'leads', {name: status, status, createdAt: '2026-11-23T12:00:00Z'}, 'qa', undefined, now);
  saveCloneRecord(state, 'marketplace', {...sample(state, 'marketplace'), totalAmount: 30, platformFee: 3, vendorPayout: 27}, 'qa', undefined, now);
  saveCloneRecord(state, 'marketplace', {...sample(state, 'marketplace'), status: 'failed'}, 'qa', undefined, now);
  applyCloneAction(state, 'generate-report', 'weekly-reports', undefined, {}, 'qa', now);
  const r = state.records['weekly-reports'].at(-1)!;
  assert.equal(r.active_members, 3); assert.equal(r.expired_this_week, 1); assert.equal(r.new_leads, 4); assert.equal(r.won_leads, 1);
  assert.equal(r.conversion_rate, '25.0%'); assert.equal(r.churn_rate, '25.0%'); assert.equal(r.total_revenue, '$30.00');
  assert.equal(r.successful_charges, 1); assert.equal(r.failed_charges, 1); assert.equal(r.arpu, '$10.00');
  assert.equal(r.plan_breakdown, 'Desk: 2, Office: 1');
  assert.equal(r.week_ending, '2026-11-29');
});

test('A-Z: expiring and failed dashboards follow member edits immediately', () => {
  const state = fresh();
  saveCloneRecord(state, 'active-members', {name: 'Soon', email: 'soon@example.test', status: 'Active', expires: '2026-11-26T00:00:00Z'}, 'qa', undefined, now);
  saveCloneRecord(state, 'active-members', {name: 'Late', email: 'late@example.test', status: 'Payment failed', expires: '2026-12-26T00:00:00Z'}, 'qa', undefined, now);
  const o = cloneOverview(state, now);
  assert.ok(o.sections.find(s => s.key === 'expiring')!.records.some(r => r.email === 'soon@example.test'));
  assert.ok(o.sections.find(s => s.key === 'failed-payments')!.records.some(r => r.email === 'late@example.test'));
  assert.equal(o.summary.localFailed, 1);
});

test('A-Z: every captured reference row in every editable section can be re-saved without errors', () => {
  const state = fresh(), failures: string[] = [];
  for (const s of cloneSections(state).filter(x => !x.readOnly)) {
    const editable = s.columns.find(c => !c.readOnly);
    for (const row of [...state.records[s.key]].filter(r => r.provenance === 'REFERENCE')) {
      try { saveCloneRecord(state, s.key, editable ? {[editable.key]: row[editable.key] ?? null} : {}, 'qa', row.id, now); }
      catch (e) { failures.push(s.key + ' ' + row.id + ': ' + (e as Error).message); }
    }
  }
  assert.deepEqual(failures, []);
});

test('A-Z: automatic Monday report runs once per Chicago Monday, never on other days', async () => {
  let stored: any = null;
  const content = {findUnique: async () => stored ? structuredClone(stored) : null, upsert: async ({create, update}: any) => { stored = {...(stored || create), ...update}; return stored; }};
  const tx: any = {content, audit: {create: async () => ({})}, $queryRaw: async () => []};
  const db: any = {...tx, $transaction: (fn: any) => fn(tx)};
  const service = new WorkspaceCloneService(db); (service as any).seed = async () => fresh();
  assert.equal(await service.autoWeeklyReport(new Date('2026-11-30T07:00:00Z')), false, 'no clone saved yet');
  await service.update('users', 'reference-users-1', {revision: 0, data: {notes: 'opened'}}, 'qa');
  assert.equal(await service.autoWeeklyReport(new Date('2026-12-01T07:00:00Z')), false, 'Tuesday');
  assert.equal(await service.autoWeeklyReport(new Date('2026-11-30T05:30:00Z')), false, 'still Sunday in Chicago');
  assert.equal(await service.autoWeeklyReport(new Date('2026-11-30T06:15:00Z')), true, 'Monday 00:15 CST');
  assert.equal(await service.autoWeeklyReport(new Date('2026-11-30T18:00:00Z')), false, 'already ran today');
  const rows = stored.content.records['weekly-reports'].filter((r: any) => r.provenance === 'LOCAL');
  assert.equal(rows.length, 1); assert.equal(rows[0].report_date, '2026-11-30'); assert.equal(rows[0].week_ending, '2026-12-06');
});

test('A-Z: captured Kisi event times convert from Central, including DST and year rollover', () => {
  assert.equal(capturedEventTime('Main Entrance Unlocked-Nov 22, 2:32 AM', '2026-11-23T13:41:00Z'), '2026-11-22T08:32:00.000Z');
  assert.equal(capturedEventTime('Created tajammul 7:31 AM', '2026-11-23T13:41:00Z'), '2026-11-23T13:31:00.000Z');
  assert.equal(capturedEventTime('Unlocked-Jul 4, 12:05 PM', '2026-11-23T13:41:00Z'), '2026-07-04T17:05:00.000Z');
  assert.equal(capturedEventTime('Unlocked-Dec 31, 11:00 PM', '2027-01-02T12:00:00Z'), '2027-01-01T05:00:00.000Z');
  assert.equal(capturedEventTime('no time here', '2026-11-23T13:41:00Z'), null);
});
