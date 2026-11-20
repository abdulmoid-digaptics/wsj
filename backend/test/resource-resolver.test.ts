import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveReservationPlan,resolveReservationTransitionPlan,type ReservationResource,type ReservationPolicy} from '../src/resource-resolver';
import type {BookingRule} from '../src/booking-rules';
import {assertReservationNarrowing} from '../src/resource-inventory';
const res=(id:string,capacity=1):ReservationResource=>({id,locationId:'site',capacity,active:true});
const policy:ReservationPolicy={serviceId:'events-id',serviceKey:'events',locationId:'site',durationMinutes:60,requirements:[{resource:res('event-space'),units:1}]};
const rule:BookingRule={id:'event-rule',enabled:true,priority:1,condition:{all:[{field:'serviceKey',op:'eq',value:'events'},{field:'status',op:'eq',value:'CONFIRMED'}]},targetResourceIds:['room-1','room-2','room-3'],beforeMinutes:30,afterMinutes:0};
const input={policy,startAt:'2090-06-01T10:00:00-05:00',rules:[rule],ruleTargets:['room-1','room-2','room-3','room-4'].map(id=>res(id)),now:new Date('2090-01-01T00:00:00Z')};
test('server policy resolves three exclusive rule resources, not a fourth',()=>{
 const result=resolveReservationPlan(input);
 assert.equal(result.item.resources[0].resourceId,'event-space');assert.equal(result.item.startsAt.toISOString(),'2090-06-01T15:00:00.000Z');
 assert.deepEqual(result.item.ruleResources?.map(x=>x.resourceId),['room-1','room-2','room-3']);
 assert.equal(result.item.ruleResources?.[0].startsAt?.toISOString(),'2090-06-01T14:30:00.000Z');
 assert.deepEqual(result.triggeredRuleIds,['event-rule']);
});
test('an existing pooled requirement becomes exclusive if a rule targets it',()=>{
 const pool=res('pool',5);const result=resolveReservationPlan({...input,policy:{...policy,requirements:[{resource:pool,units:1}]},rules:[{...rule,targetResourceIds:['pool']}],ruleTargets:[pool]});
 assert.equal(result.item.resources[0].units,5);assert.equal(result.item.ruleResources,undefined);
 assert.equal(result.item.resources[0].startsAt?.toISOString(),'2090-06-01T14:30:00.000Z');
});
test('rejects incomplete policy, stale targets, invalid instants and past bookings',()=>{
 assert.throws(()=>resolveReservationPlan({...input,policy:{...policy,requirements:[]}}),/incomplete/);
 assert.throws(()=>resolveReservationPlan({...input,policy:{...policy,durationMinutes:0}}),/incomplete/);
 assert.throws(()=>resolveReservationPlan({...input,ruleTargets:[]}),/target/);
 assert.throws(()=>resolveReservationPlan({...input,startAt:'2090-06-01T10:00:00'}),/timezone/);
 assert.throws(()=>resolveReservationPlan({...input,startAt:'2090-02-30T10:00:00Z'}),/Invalid/);
 assert.throws(()=>resolveReservationPlan({...input,startAt:'2090-06-01T24:00:00Z'}),/Invalid/);
 assert.throws(()=>resolveReservationPlan({...input,startAt:'2090-06-01T24:00:00-05:00'}),/Invalid/);
 assert.throws(()=>resolveReservationPlan({...input,startAt:'2080-06-01T10:00:00Z'}),/future/);
});

test('checkout protects pending and eventual confirmed conditions in one plan',()=>{
 const pending:BookingRule={...rule,id:'pending-rule',condition:{field:'status',op:'eq',value:'PENDING'},targetResourceIds:['room-4']};
 const result=resolveReservationPlan({...input,rules:[rule,pending]});
 assert.deepEqual(result.item.ruleResources?.map(x=>x.resourceId),['room-4','room-1','room-2','room-3']);
 assert.deepEqual(result.triggeredRuleIds,['pending-rule','event-rule']);
});

 test('transition plan retains confirmed rules but removes pending-only resource and buffer',()=>{
 const pending:BookingRule={...rule,id:'pending',condition:{field:'status',op:'eq',value:'PENDING'},targetResourceIds:['room-1','room-4'],beforeMinutes:90};
 const result=resolveReservationTransitionPlan({...input,rules:[pending,rule]});
 assert.deepEqual(result.hold.item.ruleResources?.map(x=>x.resourceId),['room-1','room-4','room-2','room-3']);
 assert.deepEqual(result.confirmed.item.ruleResources?.map(x=>x.resourceId),['room-1','room-2','room-3']);
 assert.equal(result.hold.item.ruleResources?.find(x=>x.resourceId==='room-1')?.startsAt?.toISOString(),'2090-06-01T13:30:00.000Z');
 assert.equal(result.confirmed.item.ruleResources?.find(x=>x.resourceId==='room-1')?.startsAt?.toISOString(),'2090-06-01T14:30:00.000Z');
 assert.deepEqual(result.confirmed.triggeredRuleIds,['event-rule']);
 assert.doesNotThrow(()=>assertReservationNarrowing(result.hold.item,result.confirmed.item));
 });
 test('confirmed plan retains required pooled units when pending rule exclusivity ends',()=>{
 const pool=res('pool',5);
 const pending:BookingRule={...rule,id:'pending',condition:{field:'status',op:'eq',value:'PENDING'},targetResourceIds:['pool']};
 const result=resolveReservationTransitionPlan({...input,policy:{...policy,requirements:[{resource:pool,units:2}]},rules:[pending],ruleTargets:[pool]});
 assert.equal(result.hold.item.resources[0].exclusive,true);
 assert.equal(result.hold.item.resources[0].units,5);
 assert.doesNotThrow(()=>assertReservationNarrowing(result.hold.item,result.confirmed.item));
 assert.equal(result.confirmed.item.resources[0].units,2);
 assert.equal(result.confirmed.item.resources[0].exclusive,undefined);
 assert.equal(result.confirmed.item.resources[0].startsAt?.toISOString(),'2090-06-01T15:00:00.000Z');
 });
