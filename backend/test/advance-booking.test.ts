import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertAdvanceBooking, earliestBookingDate, tooSoonDays} from '../src/advance-booking';

/* Monday 2027-01-11. Chicago is UTC-6 in January. */
const mon1am = new Date('2027-01-11T07:00:00Z');   // 1:00 AM Monday Chicago
const mon11pm = new Date('2027-01-12T05:00:00Z');  // 11:00 PM Monday Chicago

test('earliest date is the day after tomorrow, whatever the hour', () => {
  assert.equal(earliestBookingDate(mon1am), '2027-01-13');
  assert.equal(earliestBookingDate(mon11pm), '2027-01-13');
});

test('today and tomorrow are rejected; Wednesday is allowed, for every covered service', () => {
  for (const service of ['podcast-studio', 'photo-studio', 'events', 'workshops', 'webinars']) {
    assert.throws(() => assertAdvanceBooking(service, '2027-01-11T20:00:00Z', mon1am), /at least one full day/);
    assert.throws(() => assertAdvanceBooking(service, '2027-01-12T22:00:00Z', mon11pm), /day after tomorrow/);
    assert.doesNotThrow(() => assertAdvanceBooking(service, '2027-01-13T14:00:00Z', mon11pm)); // 8:00 AM Wednesday
  }
});

test('other services are not affected', () => {
  assert.doesNotThrow(() => assertAdvanceBooking('meeting-rooms', '2027-01-11T20:00:00Z', mon1am));
  assert.doesNotThrow(() => assertAdvanceBooking('coworking', '2027-01-11T20:00:00Z', mon1am));
  assert.deepEqual(tooSoonDays('meeting-rooms', '2027-01-11', '2027-01-20', mon1am), []);
});

test('calendar greys out today and tomorrow only', () => {
  assert.deepEqual(tooSoonDays('workshops', '2027-01-10', '2027-01-20', mon11pm).map(d => d.date), ['2027-01-10', '2027-01-11', '2027-01-12']);
});
