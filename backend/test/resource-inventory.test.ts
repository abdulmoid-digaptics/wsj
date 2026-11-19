import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceInventory, InventoryError } from '../src/resource-inventory';

// Invalid calls must fail *before* opening a transaction, including JS callers.
const inv = new ResourceInventory({ $transaction() { throw Error('unexpected database access'); } } as never);
const request = {locationId:'hq',serviceId:'desk',resources:[{resourceId:'a',units:1}],startsAt:new Date('2090-01-01Z'),endsAt:new Date('2090-01-02Z'), ownerRef:'order:1',ttlSeconds:30};
test('reject bad windows, quantities, repeated resources, owner refs and TTLs before database access', async () => {
  for (const patch of [
    {startsAt:new Date(NaN)}, {endsAt:request.startsAt}, {startsAt:'2090-01-01'},
    {resources:[]}, {resources:Array(65).fill(request.resources[0])}, {resources:[...request.resources,...request.resources]},
    ...[0,-1,1.5,Infinity,2147483648].map(units => ({resources:[{resourceId:'a',units}]})),
    {ownerRef:' '},{serviceId:'x\0y'},{locationId:' foo'}, ...[0,86401,1.5].map(ttlSeconds => ({ttlSeconds}))
  ]) await assert.rejects(inv.hold({...request,...patch} as typeof request), (e:unknown) => e instanceof InventoryError && e.code === 'INVALID_INPUT');
  await assert.rejects(inv.close({...request,resourceIds:['a','a']}),{code:'INVALID_INPUT'});
  await assert.rejects(inv.confirm(''),{code:'INVALID_INPUT'});
});
