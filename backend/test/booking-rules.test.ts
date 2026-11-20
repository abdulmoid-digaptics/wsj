import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateBookingRules, validateBookingRule, type BookingRule, type RuleBooking} from '../src/booking-rules';

const base: BookingRule = {id:'event-lock',enabled:true,priority:1,condition:{all:[{field:'serviceKey',op:'eq',value:'event'},{field:'status',op:'eq',value:'CONFIRMED'}]},targetResourceIds:['room-1','room-2','room-3'],beforeMinutes:30,afterMinutes:15};
const booking: RuleBooking = {serviceKey:'event',status:'CONFIRMED',locationId:'main',start:'2026-11-19T14:00:00-06:00',end:'2026-11-19T15:00:00-06:00'};
test('confirmed event locks exactly selected rooms with absolute buffers',()=>{
 const locks=evaluateBookingRules([base],booking);
 assert.deepEqual(locks.map(x=>x.resourceId),['room-1','room-2','room-3']);
 assert.equal(locks[0].start.toISOString(),'2026-11-19T19:30:00.000Z');
 assert.equal(locks[0].end.toISOString(),'2026-11-19T21:15:00.000Z');
 assert.equal(locks.some(x=>x.resourceId==='room-4'),false);
});
test('nonmatching or cancelled bookings do not create event locks',()=>{
 assert.deepEqual(evaluateBookingRules([base],{...booking,status:'CANCELLED'}),[]);
 assert.deepEqual(evaluateBookingRules([{...base,enabled:false}],booking),[]);
});
test('nested AND/OR conditions and priority are deterministic and merge exact duplicate windows',()=>{
 const first:BookingRule={...base,id:'high',priority:10,targetResourceIds:['room-1'],condition:{any:[{field:'locationId',op:'eq',value:'other'},{all:[{field:'status',op:'in',value:['CONFIRMED','PENDING']},{field:'serviceKey',op:'eq',value:'event'}]}]}};
 const locks=evaluateBookingRules([base,first],booking);
 assert.deepEqual(locks[0].ruleIds,['high','event-lock']);
});
test('date range and explicit UTC exceptions use half-open range',()=>{
 assert.equal(evaluateBookingRules([{...base,activeFrom:'2026-11-19T20:00:00Z',activeUntil:'2026-11-19T21:00:00Z'}],booking).length,3);
 assert.equal(evaluateBookingRules([{...base,activeUntil:'2026-11-19T20:00:00Z'}],booking).length,0);
 assert.equal(evaluateBookingRules([{...base,excludedDates:['2026-11-19']}],booking).length,0);
});
test('rejects ambiguous timezone, invalid config, and reversed intervals',()=>{
 assert.throws(()=>evaluateBookingRules([base],{...booking,start:'2026-11-19T14:00'}),/timezone/);
 assert.throws(()=>evaluateBookingRules([base],{...booking,end:booking.start}),/follow/);
 assert.throws(()=>evaluateBookingRules([base],{...booking,start:'2026-11-19T24:00:00Z'}),/Invalid/);
 assert.throws(()=>validateBookingRule({...base,activeFrom:'2026-11-19T24:00:00-06:00'}),/Invalid/);
 assert.throws(()=>validateBookingRule({...base,beforeMinutes:-1}),/buffer/);
 assert.throws(()=>validateBookingRule({...base,targetResourceIds:['a','a']}),/target/);
 assert.throws(()=>validateBookingRule({...base,excludedDates:['2026-02-30']}),/date/);
 assert.throws(()=>validateBookingRule({...base,condition:{all:[]}}),/conditions/);
});

test('rules locking the same resource combine overlapping buffer windows',()=>{
 const locks=evaluateBookingRules([base,{...base,id:'extra',targetResourceIds:['room-1'],beforeMinutes:60,afterMinutes:5}],booking);
 assert.equal(locks.filter(x=>x.resourceId==='room-1').length,1);
 const room=locks.find(x=>x.resourceId==='room-1')!;
 assert.equal(room.start.toISOString(),'2026-11-19T19:00:00.000Z');assert.equal(room.end.toISOString(),'2026-11-19T21:15:00.000Z');
 assert.deepEqual(room.ruleIds,['event-lock','extra']);
});


test('rejects ambiguous condition trees instead of silently ignoring branches or fields',()=>{
 const valid={field:'status',op:'eq',value:'CONFIRMED'};
 for(const condition of [
  {all:[valid],any:[valid]},
  {all:[valid],field:'serviceKey',op:'eq',value:'event'},
  {...valid,ignored:'unexpected'},
  {all:[{...valid,any:[valid]}]},
  [],
 ]) assert.throws(()=>validateBookingRule({...base,condition:condition as BookingRule['condition']}),/condition/);
});
