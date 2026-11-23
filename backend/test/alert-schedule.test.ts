import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decideCapacityAlert} from '../src/alert-schedule';
const schedule={repeatMinutes:30,timeZone:'America/Chicago',quietHours:{start:'22:00',end:'07:00'}};
const none={active:true,lastSentAt:null,acknowledgedUntil:null};
test('capacity notices repeat only while still active and due',()=>{
 const now=new Date('2026-07-01T17:00:00Z');
 assert.equal(decideCapacityAlert(schedule,none,now),'send');
 assert.equal(decideCapacityAlert(schedule,{...none,lastSentAt:new Date('2026-07-01T16:45:00Z')},now),'not_due');
 assert.equal(decideCapacityAlert(schedule,{...none,lastSentAt:new Date('2026-07-01T16:30:00Z')},now),'send');
 assert.equal(decideCapacityAlert(schedule,{...none,active:false,lastSentAt:new Date('2026-07-01T16:30:00Z')},now),'resolved');
});
test('quiet hours and acknowledgement suppress alerts, with local DST observed',()=>{
 assert.equal(decideCapacityAlert(schedule,none,new Date('2026-07-02T04:00:00Z')),'quiet_hours');
 assert.equal(decideCapacityAlert(schedule,none,new Date('2026-07-02T12:00:00Z')),'send');
 assert.equal(decideCapacityAlert(schedule,none,new Date('2026-01-02T12:00:00Z')),'quiet_hours');
 assert.equal(decideCapacityAlert(schedule,{...none,acknowledgedUntil:new Date('2026-07-01T18:00:00Z')},new Date('2026-07-01T17:00:00Z')),'acknowledged');
});
test('rejects invalid frequency, timezone and all-day quiet hours',()=>{
 const now=new Date();assert.throws(()=>decideCapacityAlert({...schedule,repeatMinutes:0},none,now));
 assert.throws(()=>decideCapacityAlert({...schedule,timeZone:'Bad/Zone'},none,now));
 assert.throws(()=>decideCapacityAlert({...schedule,quietHours:{start:'09:00',end:'09:00'}},none,now));
});
