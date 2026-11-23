import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {N8nEventsService, N8nEventsController, normaliseN8nEvent, eventRow} from '../src/n8n-events';

const ART = process.env.N8N_WORKFLOW_DIR || '';
/** Runs an n8n Code node body with a fake $() context, like n8n does. */
function runCode(code: string, nodes: Record<string, any>) {
  const $ = (name: string) => { if (!(name in nodes)) return {isExecuted: false, first: () => { throw new Error('not executed: ' + name); }}; return {isExecuted: true, first: () => ({json: nodes[name]})}; };
  return new Function('$', '$execution', '$workflow', code)($, {id: 4242}, {name: 'WF test'})[0].json;
}
const node = (wf: any, name: string) => wf.nodes.find((n: any) => n.name === name);

test('payload validation: required fields, unknown events, bad emails, junk keys dropped', () => {
  assert.throws(() => normaliseN8nEvent({event: 'access.granted'}), /eventId or executionId/);
  assert.throws(() => normaliseN8nEvent({event: 'delete.everything', executionId: '1'}), /Unknown event/);
  assert.throws(() => normaliseN8nEvent({event: 'access.granted', executionId: '1', contact: {email: 'nope'}}), /email/);
  const e = normaliseN8nEvent({event: 'access.granted', executionId: '7', contact: {email: 'A@Example.test', name: 'A'}, kisi: {userId: 5, windows: [{valid_from: '2026-12-01T15:00:00Z', valid_until: '2026-12-01T17:00:00Z', label: 'Dec 1'}], total: 1, failed: 0}, apiKey: 'should-not-be-kept'});
  assert.equal(e.eventId, '7:access.granted'); assert.equal(e.contact.email, 'a@example.test'); assert.equal((e as any).apiKey, undefined);
  assert.equal(e.kisi.windows[0].validUntil, '2026-12-01T17:00:00Z');
});
test('secret is required and compared safely', () => {
  const prev = process.env.N8N_WEBHOOK_SECRET; process.env.N8N_WEBHOOK_SECRET = 'x'.repeat(32);
  try { const s = new N8nEventsService({} as any); assert.throws(() => s.verify(undefined), /Invalid/); assert.throws(() => s.verify('y'.repeat(32)), /Invalid/); assert.doesNotThrow(() => s.verify('x'.repeat(32)));
    process.env.N8N_WEBHOOK_SECRET = 'short'; assert.throws(() => s.verify('short'), /not configured/); }
  finally { if (prev === undefined) delete process.env.N8N_WEBHOOK_SECRET; else process.env.N8N_WEBHOOK_SECRET = prev; }
});
test('events are stored once; retries are reported as duplicates and refresh live data', async () => {
  const stored: any[] = []; let refreshed = 0;
  const db: any = {content: {create: async ({data}: any) => { if (stored.some(s => s.slug === data.slug)) { const e: any = new Error('dup'); e.code = 'P2002'; throw e; } stored.push(data); return data; }}};
  const live: any = {enabled: true, refreshAll: async () => { refreshed++; }};
  const s = new N8nEventsService(db, live);
  const body = {event: 'access.revoked', executionId: '99', contact: {email: 'm@example.test'}, kisi: {revoked: 2}};
  assert.equal((await s.receive(body)).status, 'accepted');
  assert.equal((await s.receive(body)).status, 'duplicate');
  assert.equal(stored.length, 1); assert.equal(s.rows()[0].status, 'Access removed'); assert.match(String(s.rows()[0].detail), /2 removed/);
  await new Promise(r => setTimeout(r, 2200)); assert.equal(refreshed, 1);
});
test('endpoint is public but secret-gated (no admin JWT needed for n8n)', () => {
  assert.equal(Reflect.getMetadata('__guards__', N8nEventsController), undefined);
});
test('the patched n8n workflows build payloads the app accepts, for every outcome', { skip: !ART || !existsSync(ART) }, () => {
  const wf2 = JSON.parse(readFileSync(ART + '/2 - Invoice Paid - Grant Access v3 WSJ sync.json', 'utf8'));
  const wf3 = JSON.parse(readFileSync(ART + '/3 - Member Offboarding - Revoke Access v3 WSJ sync.json', 'utf8'));
  const code2 = node(wf2, 'Build WSJ Event').parameters.jsCode, code3 = node(wf3, 'Build WSJ Event').parameters.jsCode;
  const booking = {contact_id: 'c1', invoice_id: 'inv1', subscription_type: 'PhotoStudio - Hourly Booking', contact: {email: 'tm8@example.test', first_name: 'Test', last_name: 'Member 8'}};
  const plan = {needs_kisi: 'yes', access_system_id: '', kisi_group_id: '1060349', access_level: 'Event Only', windows: [{valid_from: '2026-12-17T11:45:00Z', valid_until: '2026-12-17T13:00:00Z', label: '2026-12-17 06:00 AM-07:00 AM'}]};
  const granted = runCode(code2, {'Build Access Plan': plan, 'Resolve Booking': booking, 'Resolve Kisi User': {kisi_user_id: 107208733}, 'Check Kisi Results': {ok: true, total: 1, failed: 0, errors: []}});
  assert.equal(granted.event, 'access.granted'); assert.equal(granted.kisi.userId, '107208733');
  const failed = runCode(code2, {'Build Access Plan': plan, 'Resolve Booking': booking, 'Resolve Kisi User': {kisi_user_id: 1}, 'Check Kisi Results': {ok: false, total: 1, failed: 1, errors: ['403']}});
  assert.equal(failed.event, 'access.failed');
  assert.equal(runCode(code2, {'Build Access Plan': plan, 'Resolve Booking': booking, 'Kisi: Create User': {}}).event, 'kisi.user_needed');
  assert.equal(runCode(code2, {'Build Access Plan': {...plan, needs_kisi: 'no'}, 'Resolve Booking': booking}).event, 'access.not_required');
  const revoked = runCode(code3, {'Validate Request': {contact_id: 'c2', kisi_user_id: '106542379', email: 'tm1@example.test', first_name: 'test', last_name: 'memberone'}, 'Summarize Revoke': {ok: true, revoked: 3}});
  assert.equal(revoked.event, 'access.revoked'); assert.equal(revoked.kisi.revoked, 3);
  assert.equal(runCode(code3, {'Validate Request': {contact_id: 'c2', kisi_user_id: '1'}, 'Summarize Revoke': {ok: false, reason: 'x'}}).event, 'access.revoke_failed');
  for (const p of [granted, failed, revoked]) { const n = normaliseN8nEvent(p); assert.equal(n.eventId, '4242:' + p.event); assert.ok(eventRow({...n, receivedAt: new Date().toISOString()}).status); }
  // The notify step never blocks the workflow and retries safely.
  for (const wf of [wf2, wf3]) { const n = node(wf, 'WSJ App: Notify'); assert.equal(n.onError, 'continueRegularOutput'); assert.equal(n.retryOnFail, true); }
});
