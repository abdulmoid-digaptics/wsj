import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertReservationNarrowing, type InventoryBatchItem} from '../src/resource-inventory';

const start=new Date('2090-06-01T15:00:00Z'), end=new Date('2090-06-01T16:00:00Z');
const line=(resourceId:string,units=1,extra:object={})=>({resourceId,units,startsAt:start,endsAt:end,...extra});
const hold:InventoryBatchItem={serviceId:'service',locationId:'site',startsAt:start,endsAt:end,resources:[line('pool',5,{exclusive:true})],ruleResources:[line('room')]};
const confirmed:InventoryBatchItem={...hold,resources:[line('pool',2)],ruleResources:[]};
test('accepts removing pending-only resources and downgrading exclusive pooled holds',()=>{
 assert.doesNotThrow(()=>assertReservationNarrowing(hold,confirmed));
 assert.doesNotThrow(()=>assertReservationNarrowing(hold,{...confirmed,resources:[line('pool',2,{startsAt:new Date(+start+60000),endsAt:new Date(+end-60000)})]}));
});
test('rejects added resources, expanded intervals, quantities and exclusivity',()=>{
 const check=(candidate:InventoryBatchItem)=>assert.throws(()=>assertReservationNarrowing(hold,candidate),/exceeds/);
 check({...confirmed,resources:[line('new')]});
 check({...confirmed,resources:[line('pool',2,{startsAt:new Date(+start-1)})]});
 check({...confirmed,resources:[line('pool',2,{endsAt:new Date(+end+1)})]});
 check({...confirmed,resources:[line('pool',6)]});
 const shared={...hold,resources:[line('pool',2)],ruleResources:[]};
 assert.throws(()=>assertReservationNarrowing(shared,{...shared,resources:[line('pool',2,{exclusive:true})]}),/exceeds/);
});
test('rejects changed identity, duplicate lines and invalid timestamps',()=>{
 for(const candidate of [{...confirmed,locationId:'other'},{...confirmed,serviceId:'other'},{...confirmed,endsAt:new Date(+end+1)}]) assert.throws(()=>assertReservationNarrowing(hold,candidate),/identity/);
 assert.throws(()=>assertReservationNarrowing(hold,{...confirmed,resources:[line('pool'),line('pool')]}),/distinct/);
 assert.throws(()=>assertReservationNarrowing(hold,{...confirmed,resources:[line('pool',1,{startsAt:new Date('invalid')})]}),/valid absolute/);
});
