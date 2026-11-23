import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findDayConflicts, ruleActiveOn, servicesThatBlock, venueDays, type DayRule} from '../src/day-blocks';
import {parseRule} from '../src/day-block-admin';
import {hourBounds} from '../src/catalog';

const rule = (over: Partial<DayRule> = {}): DayRule => ({id: 'r1', name: 'r', enabled: true, triggerServices: ['events', 'workshops'], blockedServices: ['meeting-rooms', 'photo-studio', 'podcast-studio'], reverse: false, countUnpaid: true, weekdays: [], activeFrom: null, activeUntil: null, ...over});
const reverseRule = rule({id: 'r2', triggerServices: ['meeting-rooms', 'photo-studio', 'podcast-studio'], blockedServices: ['events', 'webinars']});

test('venue days follow Chicago time, including midnight and DST', () => {
  assert.deepEqual(venueDays(new Date('2027-03-10T15:00:00Z'), 120), ['2027-03-10']);
  /* 22:00 Chicago (CDT, UTC-5) + 4h crosses midnight. */
  assert.deepEqual(venueDays(new Date('2027-06-11T03:00:00Z'), 240), ['2027-06-10', '2027-06-11']);
  /* Ending exactly at midnight stays on one day. */
  assert.deepEqual(venueDays(new Date('2027-06-11T03:00:00Z'), 120), ['2027-06-10']);
  /* 23:00 UTC is still the previous evening... no: 18:00 Chicago the same date. */
  assert.deepEqual(venueDays(new Date('2027-01-05T23:00:00Z'), 60), ['2027-01-05']);
  /* Spring-forward night (2027-03-14). */
  assert.deepEqual(venueDays(new Date('2027-03-14T06:00:00Z'), 180), ['2027-03-14']);
  assert.throws(() => venueDays(new Date('x'), 60));
});

test('event or workshop booked closes rooms and studios that day only', () => {
  const booked = [{date: '2027-05-01', service: 'events', paid: true}];
  for (const service of ['meeting-rooms', 'photo-studio', 'podcast-studio']) {
    const c = findDayConflicts({service, dates: ['2027-05-01'], rules: [rule()], closures: [], booked, names: {events: 'Event Space'}});
    assert.equal(c.length, 1, service);
    assert.match(c[0].reason, /Event Space is booked that day/);
  }
  assert.equal(findDayConflicts({service: 'meeting-rooms', dates: ['2027-05-02'], rules: [rule()], closures: [], booked}).length, 0, 'next day is free');
  assert.equal(findDayConflicts({service: 'webinars', dates: ['2027-05-01'], rules: [rule()], closures: [], booked}).length, 0, 'unrelated service is free');
  assert.equal(findDayConflicts({service: 'events', dates: ['2027-05-01'], rules: [rule()], closures: [], booked}).length, 0, 'a rule never blocks its own service');
});

test('room or studio booked closes event space and webinars, and reverse works both ways', () => {
  const booked = [{date: '2027-05-01', service: 'podcast-studio', paid: true}];
  assert.equal(findDayConflicts({service: 'events', dates: ['2027-05-01'], rules: [rule(), reverseRule], closures: [], booked}).length, 1);
  assert.equal(findDayConflicts({service: 'webinars', dates: ['2027-05-01'], rules: [rule(), reverseRule], closures: [], booked}).length, 1);
  /* Workshops are not listed in the second rule, so stay bookable unless reverse is turned on. */
  assert.equal(findDayConflicts({service: 'workshops', dates: ['2027-05-01'], rules: [rule(), reverseRule], closures: [], booked}).length, 0);
  assert.equal(findDayConflicts({service: 'workshops', dates: ['2027-05-01'], rules: [rule({reverse: true})], closures: [], booked}).length, 1);
});

test('disabled, out-of-range, wrong-weekday and unpaid-ignored rules do not block', () => {
  const booked = [{date: '2027-05-01', service: 'events', paid: false}];
  const at = (r: DayRule) => findDayConflicts({service: 'meeting-rooms', dates: ['2027-05-01'], rules: [r], closures: [], booked}).length;
  assert.equal(at(rule()), 1, 'unpaid live checkout holds the day by default');
  assert.equal(at(rule({countUnpaid: false})), 0);
  assert.equal(at(rule({enabled: false})), 0);
  assert.equal(at(rule({activeFrom: '2027-05-02'})), 0);
  assert.equal(at(rule({activeUntil: '2027-04-30'})), 0);
  assert.equal(at(rule({weekdays: [0]})), 0, '2027-05-01 is a Saturday');
  assert.equal(at(rule({weekdays: [6]})), 1);
  assert.equal(ruleActiveOn(rule({activeFrom: '2027-05-01', activeUntil: '2027-05-01'}), '2027-05-01'), true);
  assert.deepEqual(servicesThatBlock([rule()], 'meeting-rooms', '2027-05-01')[0].services, ['events', 'workshops']);
});

test('closed days block chosen services or every service', () => {
  const closures = [{date: '2027-05-01', services: ['photo-studio'], reason: 'Maintenance'}, {date: '2027-05-02', services: [], reason: null}];
  assert.match(findDayConflicts({service: 'photo-studio', dates: ['2027-05-01'], rules: [], closures, booked: []})[0].reason, /closed.*Maintenance/);
  assert.equal(findDayConflicts({service: 'meeting-rooms', dates: ['2027-05-01'], rules: [], closures, booked: []}).length, 0);
  assert.equal(findDayConflicts({service: 'meeting-rooms', dates: ['2027-05-02'], rules: [], closures, booked: []}).length, 1);
});

test('service minimum hours raise hourly minimums only', () => {
  assert.deepEqual(hourBounds({billingUnit: 'PER_HOUR', minQuantity: 1, maxQuantity: 12}, 2), {minQuantity: 2, maxQuantity: 12});
  assert.deepEqual(hourBounds({billingUnit: 'PER_HOUR', minQuantity: 1, maxQuantity: 3}, 4), {minQuantity: 4, maxQuantity: 4}, 'max never below min');
  assert.deepEqual(hourBounds({billingUnit: 'PER_HOUR', minQuantity: 3, maxQuantity: 12}, 2), {minQuantity: 3, maxQuantity: 12}, 'a stricter package minimum wins');
  assert.deepEqual(hourBounds({billingUnit: 'PER_MONTH', minQuantity: 1, maxQuantity: 1}, 2), {minQuantity: 1, maxQuantity: 1});
  assert.deepEqual(hourBounds({billingUnit: 'PER_HOUR', minQuantity: 1, maxQuantity: 24}, null), {minQuantity: 1, maxQuantity: 24});
});

test('admin rule input is strict', () => {
  const known = new Set(['events', 'workshops', 'meeting-rooms', 'webinars']);
  const ok = parseRule({name: ' Lock rooms ', enabled: true, triggerServices: ['Events'], blockedServices: ['meeting-rooms'], weekdays: [6, 0, 6]}, known);
  assert.equal(ok.name, 'Lock rooms');
  assert.deepEqual(ok.triggerServices, ['events']);
  assert.deepEqual(ok.weekdays, [0, 6]);
  assert.equal(ok.countUnpaid, true);
  assert.throws(() => parseRule({name: 'x', triggerServices: ['events'], blockedServices: ['events']}, known), /both trigger and be blocked/);
  assert.throws(() => parseRule({name: 'x', triggerServices: ['nope'], blockedServices: ['events']}, known), /Unknown service/);
  assert.throws(() => parseRule({name: 'x', triggerServices: [], blockedServices: ['events']}, known), /1 to 50/);
  assert.throws(() => parseRule({name: 'x', triggerServices: ['events'], blockedServices: ['webinars'], weekdays: [7]}, known), /Weekdays/);
  assert.throws(() => parseRule({name: 'x', triggerServices: ['events'], blockedServices: ['webinars'], activeFrom: '2027-05-02', activeUntil: '2027-05-01'}, known), /start date/);
  assert.throws(() => parseRule({name: 'x', triggerServices: ['events'], blockedServices: ['webinars'], activeFrom: '2027-02-30'}, known), /YYYY-MM-DD/);
  assert.throws(() => parseRule({name: 'x', triggerServices: ['events'], blockedServices: ['webinars'], enable: true}, known), /Unexpected field/);
});
