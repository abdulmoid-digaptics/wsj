'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
require('./ts-register.cjs');
const {businessDateKey, businessStartAt} = require('../../lib/business-time.ts');
test('winter bookings use Chicago standard time, not the browser timezone', () => {
 assert.equal(businessStartAt('2026-11-20', '09:30'), '2026-11-20T15:30:00.000Z');
});
test('summer bookings use Chicago daylight saving time', () => {
 assert.equal(businessStartAt('2026-07-20', '09:30'), '2026-07-20T14:30:00.000Z');
});
test('daytime bookings on DST transition dates use the correct offset', () => {
 assert.equal(businessStartAt('2026-03-08', '09:00'), '2026-03-08T14:00:00.000Z');
 assert.equal(businessStartAt('2026-11-01', '09:00'), '2026-11-01T15:00:00.000Z');
});
test('nonexistent spring-forward clock times cannot silently become another appointment', () => {
 assert.throws(() => businessStartAt('2026-03-08', '02:30'), /does not exist/);
});
test('invalid calendar dates and clock values are rejected', () => {
 for (const [date, time] of [['2026-02-30', '09:00'], ['2026-12-01', '25:00'], ['bad', '09:00']]) assert.throws(() => businessStartAt(date, time), /valid reservation/);
});
test('the venue day stays November 18 when it is already November 19 in Karachi', () => {
 assert.equal(businessDateKey(new Date('2026-11-19T02:30:00Z')), '2026-11-18');
});
test('device timezone never changes the booked instant or venue calendar day', () => {
 const previous = process.env.TZ;
 try {
  for (const zone of ['Asia/Karachi', 'UTC', 'America/Los_Angeles']) {
   process.env.TZ = zone;
   assert.equal(businessStartAt('2026-11-20', '09:30'), '2026-11-20T15:30:00.000Z');
   assert.equal(businessDateKey(new Date('2026-11-19T02:30:00Z')), '2026-11-18');
  }
 } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
