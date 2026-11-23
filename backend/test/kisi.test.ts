import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {KisiClient, KisiApiError} from '../src/kisi-client';
import {accessPlanId, accessWindow, coworkingAccessWindow, hasPaidSubscriptionPeriod, matchingAssignment} from '../src/kisi-plan';
import {KisiService, KisiAdminController} from '../src/kisi';
import {BillingService} from '../src/billing';

const now = new Date('2026-11-23T12:00:00Z');
const start = new Date('2026-11-01T05:00:00Z'), end = new Date('2026-12-01T06:00:00Z');
const sub = {accessStatus: 'ACTIVE', stripeStatus: 'active', currentPeriodStart: start, currentPeriodEnd: end, stripeItemId: 'si_qa'};
const paidLine = {subscriptionItemId: 'si_qa', periodStart: start.toISOString(), periodEnd: end.toISOString()};
const paid = {status: 'paid', lines: [paidLine]};

test('only an invoice covering the paid subscription period authorizes access', () => {
  assert.equal(hasPaidSubscriptionPeriod(sub, [paid], now), true);
  for (const invoices of [[], [{...paid, status: 'open'}], [{...paid, lines: [{...paidLine, periodEnd: start.toISOString()}]}], [{...paid, lines: [{...paidLine, periodEnd: null}]}], [{...paid, lines: [{...paidLine, subscriptionItemId: 'si_unpaid'}]}]]) assert.equal(hasPaidSubscriptionPeriod(sub, invoices, now), false);
  for (const state of ['PENDING', 'SUSPENDED', 'ENDED']) assert.equal(hasPaidSubscriptionPeriod({...sub, accessStatus: state}, [paid], now), false);
  assert.equal(hasPaidSubscriptionPeriod({...sub, stripeStatus: 'trialing'}, [paid], now), false);
});
test('past due cannot create new unpaid periods or keep expired grace', () => {
  assert.equal(hasPaidSubscriptionPeriod({...sub, accessStatus: 'PAST_DUE', stripeStatus: 'past_due', graceEndsAt: new Date('2026-11-24')}, [paid], now), true);
  assert.equal(hasPaidSubscriptionPeriod({...sub, accessStatus: 'PAST_DUE', stripeStatus: 'past_due', graceEndsAt: new Date('2026-11-22')}, [paid], now), false);
});
test('yearly renewal uses exact provider period, not an invented month', () => {
  const yearly = {...sub, currentPeriodEnd: new Date('2027-11-01T05:00:00Z')};
  assert.equal(hasPaidSubscriptionPeriod(yearly, [paid], now), false);
  assert.equal(hasPaidSubscriptionPeriod(yearly, [{...paid, lines: [{...paidLine, periodEnd: yearly.currentPeriodEnd.toISOString()}]}], now), true);
});
test('day windows respect Chicago daylight-saving boundaries', () => {
  const w = coworkingAccessWindow('day:1', '22', new Date('2027-03-14T00:00:00Z'), now)!;
  assert.equal(w.validFrom.toISOString(), '2027-03-14T06:00:00.000Z');
  assert.equal(w.validUntil.toISOString(), '2027-03-15T05:00:00.000Z');
  assert.equal(w.validUntil.getTime() - w.validFrom.getTime(), 23 * 3600000);
});
test('expired windows are skipped; original from is stable on retries', () => {
  assert.equal(accessWindow('x', '1', start, new Date('2026-11-02'), now), null);
  const w = accessWindow('x', '1', start, end, now)!;
  assert.equal(w.validFrom, start);
  assert.equal(w.sourceKey, accessWindow('x', '1', start, end, new Date(now.getTime() + 10000))!.sourceKey);
  assert.throws(() => accessWindow('x', '1', end, start, now));
});
test('catalog snapshots and legacy ids remain distinct and server-derived', () => {
  assert.equal(accessPlanId({planId: null, metadata: {catalogPlan: {id: 'catalog-id'}}}), 'catalog-id');
  assert.equal(accessPlanId({planId: 'legacy-id', metadata: {catalogPlan: {id: 'catalog-id'}}}), 'legacy-id');
  assert.equal(accessPlanId({planId: null, metadata: {kisi_group_id: '123'}}), null);
});
test('retry adopts only exact user, group, basic role and time window', () => {
  const w = accessWindow('s', '22', start, end, now)!;
  const role = {assignee_type: 'User', assignee_id: 4, applies_to_type: 'Group', applies_to_id: 22, role_id: 'group_basic', valid_from: start.toISOString(), valid_until: end.toISOString()};
  assert.equal(matchingAssignment(role, '4', w), true);
  for (const change of [{assignee_id: 5}, {applies_to_id: 23}, {role_id: 'group_manager'}, {valid_until: null}]) assert.equal(matchingAssignment({...role, ...change}, '4', w), false);
});
test('client paginates beyond 100 assignments', async () => {
  const client = new KisiClient();
  const calls: string[] = [];
  client.request = (async (endpoint: string) => { calls.push(endpoint); return calls.length === 1 ? Array.from({length: 100}, (_, id) => ({id: id + 1})) : [{id: 101}]; }) as typeof client.request;
  assert.equal((await client.list('/role_assignments?assignee_id=4')).length, 101);
  assert.match(calls[1], /offset=100/);
});
test('client rejects malformed collections instead of reporting no assignments', async () => {
  const client = new KisiClient(); client.request = (async () => ({error: 'bad'})) as typeof client.request;
  await assert.rejects(client.list('/groups'));
});
test('DELETE 404 is idempotent, permission failures are not success', async () => {
  const client = new KisiClient(); client.request = async () => { throw new KisiApiError(404); };
  await client.remove('123');
  client.request = async () => { throw new KisiApiError(403); };
  await assert.rejects(client.remove('123'), /permissions/);
  await assert.rejects(client.remove('../groups/1'));
});
test('key never appears in HTTP failure messages', async () => {
  const key = process.env.KISI_API_KEY, fetchOriginal = globalThis.fetch;
  process.env.KISI_API_KEY = 'test-secret-do-not-print';
  let authorization = '';
  globalThis.fetch = async (_input, init) => { authorization = String((init?.headers as Record<string, string>).Authorization); return new Response('private provider response', {status: 401}); };
  try {
    await assert.rejects(new KisiClient().request('/groups'), error => error instanceof Error && !error.message.includes('test-secret') && !error.message.includes('private provider'));
    assert.equal(authorization, 'KISI-LOGIN test-secret-do-not-print');
  } finally { globalThis.fetch = fetchOriginal; if (key === undefined) delete process.env.KISI_API_KEY; else process.env.KISI_API_KEY = key; }
});

test('failed offboarding persists blocked state and never claims OFFBOARDED', async () => {
  const previous = process.env.KISI_ENABLED; process.env.KISI_ENABLED = 'true';
  const state: any = {id: 'member1', customerId: 'customer1', kisiUserId: '77', blocked: false, status: 'SYNCED'};
  let revokeCalls = 0;
  const db: any = {
    kisiSyncLock: {upsert: async () => ({}), updateMany: async () => ({count: 1}), findFirst: async () => ({id: 'sync'})},
    customer: {findUnique: async () => ({id: 'customer1'}), findUniqueOrThrow: async () => ({id: 'customer1', email: 'member@example.test'})},
    kisiMember: {upsert: async ({update}: any) => Object.assign(state, update), findUniqueOrThrow: async () => state, update: async ({data}: any) => Object.assign(state, data)},
    kisiGrant: {updateMany: async () => { assert.fail('must not mark grants revoked after a failed revoke'); }},
    audit: {create: async () => ({})},
  };
  const client: any = {configured: true, list: async () => [{id: 9, assignee_type: 'User', assignee_id: 77, role_id: 'group_basic'}], remove: async () => { revokeCalls++; throw new KisiApiError(403); }};
  try { await assert.rejects(new KisiService(db, client).offboard('customer1', 'admin1')); assert.equal(revokeCalls, 1); assert.equal(state.blocked, true); assert.equal(state.status, 'REVOKE_FAILED'); }
  finally { if (previous === undefined) delete process.env.KISI_ENABLED; else process.env.KISI_ENABLED = previous; }
});
test('integration is opt-in and cannot mutate when disabled', async () => {
  const previous = process.env.KISI_ENABLED; process.env.KISI_ENABLED = 'false';
  try { await assert.rejects(new KisiService({} as any, {configured: true} as any).sync(), /KISI_ENABLED/); }
  finally { if (previous === undefined) delete process.env.KISI_ENABLED; else process.env.KISI_ENABLED = previous; }
});

function syncFixture() {
  const state: any = {id: 'member', customerId: 'customer', kisiUserId: '77', blocked: false, status: 'PENDING'};
  const grants: any[] = [], remote: any[] = [];
  let posts = 0, deletes = 0;
  const db: any = {
    kisiSyncLock: {upsert: async () => ({}), updateMany: async () => ({count: 1}), findFirst: async () => ({id: 'sync'})},
    order: {findMany: async () => [{customerId: 'customer'}]}, subscription: {findMany: async () => []},
    customer: {findUnique: async () => ({id: 'customer', name: 'Member', email: 'member@example.test'})},
    kisiMember: {findMany: async () => [state], findUnique: async () => state, findUniqueOrThrow: async () => state, update: async ({data}: any) => Object.assign(state, data)},
    kisiGrant: {
      findMany: async () => grants,
      upsert: async ({where, create}: any) => {let g = grants.find(g => g.sourceKey === where.sourceKey); if (!g) {g = {id: String(grants.length + 1), status: 'PENDING', assignmentId: null, ...create}; grants.push(g);} return g;},
      update: async ({where, data}: any) => Object.assign(grants.find(g => g.id === where.id), data),
    },
    audit: {create: async () => ({})},
  };
  const client: any = {configured: true, list: async () => [...remote], request: async (_: any, method: string, data: any) => { assert.equal(method, 'POST'); posts++; const role = {id: posts, ...data.role_assignment}; remote.push(role); return role; }, remove: async (id: string) => {deletes++; const ix = remote.findIndex(r => String(r.id) === id); if (ix >= 0) remote.splice(ix, 1);}};
  const service = new KisiService(db, client) as any;
  let windows = [accessWindow('sub:qa', '22', start, end, now)!];
  service.desired = async () => ({windows, errors: []});
  return {service, client, state, grants, remote, clear: () => {windows = [];}, counts: () => ({posts, deletes})};
}
test('two syncs grant once; cancellation removes only owned assignments', async () => {
  const previous = process.env.KISI_ENABLED; process.env.KISI_ENABLED = 'true';
  try {
    const f = syncFixture();
    f.remote.push({id: 999, assignee_type: 'User', assignee_id: 77, applies_to_type: 'Group', applies_to_id: 33, role_id: 'group_basic', valid_from: start.toISOString(), valid_until: end.toISOString()});
    await f.service.sync(); await f.service.sync();
    assert.equal(f.counts().posts, 1); assert.equal(f.grants[0].status, 'ACTIVE');
    f.clear(); await f.service.sync();
    assert.equal(f.counts().deletes, 1); assert.equal(f.grants[0].status, 'REVOKED'); assert.equal(f.remote[0].id, 999);
  } finally { if (previous === undefined) delete process.env.KISI_ENABLED; else process.env.KISI_ENABLED = previous; }
});
test('uncertain POST result is adopted on retry without duplicate notifications', async () => {
  const previous = process.env.KISI_ENABLED; process.env.KISI_ENABLED = 'true';
  try {
    const f = syncFixture(), request = f.client.request;
    f.client.request = async (...args: any[]) => { await request(...args); throw new KisiApiError(0); };
    await f.service.sync(); assert.equal(f.state.status, 'FAILED');
    f.client.request = request; await f.service.sync();
    assert.equal(f.state.status, 'SYNCED'); assert.equal(f.counts().posts, 1);
  } finally { if (previous === undefined) delete process.env.KISI_ENABLED; else process.env.KISI_ENABLED = previous; }
});
test('failed automatic revoke keeps recorded assignment and retries next scan', async () => {
  const previous = process.env.KISI_ENABLED; process.env.KISI_ENABLED = 'true';
  try {
    const f = syncFixture(); await f.service.sync(); f.clear();
    const remove = f.client.remove; f.client.remove = async () => {throw new KisiApiError(403);};
    await f.service.sync(); assert.equal(f.state.status, 'FAILED'); assert.equal(f.grants[0].status, 'ACTIVE'); assert.ok(f.grants[0].assignmentId);
    f.client.remove = remove; await f.service.sync(); assert.equal(f.grants[0].status, 'REVOKED'); assert.equal(f.state.status, 'NO_ACCESS');
  } finally { if (previous === undefined) delete process.env.KISI_ENABLED; else process.env.KISI_ENABLED = previous; }
});
test('provider invoice accrual dates alone never authorize service access', () => {
  assert.equal(hasPaidSubscriptionPeriod(sub, [{status: 'paid', lines: []}], now), false);
  assert.equal(hasPaidSubscriptionPeriod(sub, [{...paid, lines: [{...paidLine, periodEnd: start.toISOString()}]}], now), false);
});

test('invoice mirroring stores item service periods and repairs early-event subscription links', async () => {
  let payload: any;
  const db: any = {
    subscription: {findUnique: async () => ({id: 'local-sub', customerId: 'local-customer'})},
    customer: {findUnique: async () => null},
    invoice: {upsert: async (args: any) => {payload = args; return args.update;}},
  };
  const billing = new BillingService(db, {} as any, {} as any, {} as any);
  const seconds = (d: Date) => Math.floor(d.getTime() / 1000);
  await billing.upsertInvoice({id: 'in_test', subscription: 'sub_test', status: 'paid', period_start: seconds(start), period_end: seconds(start), lines: {data: [{description: 'Subscription', amount: 1000, quantity: 1, parent: {subscription_item_details: {subscription_item: 'si_qa'}}, period: {start: seconds(start), end: seconds(end)}}]}} as any);
  assert.equal(payload.update.subscriptionId, 'local-sub');
  assert.equal(payload.update.customerId, 'local-customer');
  assert.equal(payload.update.lines[0].periodEnd, end.toISOString());
  assert.equal(hasPaidSubscriptionPeriod(sub, [payload.update], now), true);
});
test('every Kisi admin route inherits ADMIN authorization', () => {
  assert.deepEqual(Reflect.getMetadata('roles', KisiAdminController), ['ADMIN']);
  assert.ok(Reflect.getMetadata('__guards__', KisiAdminController)?.length);
});
