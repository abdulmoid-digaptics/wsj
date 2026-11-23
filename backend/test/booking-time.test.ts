import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bookingWallTime} from '../src/booking-time';
test('converts explicit local time zones into UTC instants',()=>{
 assert.equal(bookingWallTime('2026-01-10','09:30','America/Chicago').toISOString(),'2026-01-10T15:30:00.000Z');
 assert.equal(bookingWallTime('2026-07-10','09:30','America/Chicago').toISOString(),'2026-07-10T14:30:00.000Z');
 assert.equal(bookingWallTime('2026-07-10','09:30','Asia/Kathmandu').toISOString(),'2026-07-10T03:45:00.000Z');
});
test('rejects daylight-saving gaps and ambiguous repeated hours',()=>{
 assert.throws(()=>bookingWallTime('2026-03-08','02:30','America/Chicago'),/does not exist/);
 assert.throws(()=>bookingWallTime('2026-11-01','01:30','America/Chicago'),/occurs twice/);
});
test('rejects invalid dates, times and timezones',()=>{
 for(const [d,t,z] of [['2026-02-30','10:00','UTC'],['2026-11-01','24:30','UTC'],['2026-11-01','1:30','UTC'],['2026-11-01','10:00','not/a-zone']])assert.throws(()=>bookingWallTime(d,t,z));
});
