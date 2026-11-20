import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowanceFor, addDays, DEFAULT_COWORKING_CONFIG as CFG, noticeOk, normaliseConfig, validateSelection} from '../src/coworking-days';

/* 2027-03-10 16:00 UTC = 10:00 AM Chicago (CST, UTC-6; DST starts March 14). */
const NOW = new Date('2027-03-10T16:00:00Z');
const silver = {mode: 'FLEX' as const, days: 5};

test('allowance comes from the plan credits', () => {
  assert.deepEqual(allowanceFor([{kind: 'COWORKING_DAY', amount: 5, resetInterval: 'MONTH'}]), {mode: 'FLEX', days: 5});
  assert.deepEqual(allowanceFor([{kind: 'COWORKING_DAY', amount: 10}]), {mode: 'FLEX', days: 10});
  assert.equal(allowanceFor([{kind: 'COWORKING_DAY', unlimited: true}])?.mode, 'CONSECUTIVE');
  assert.equal(allowanceFor([{kind: 'MEETING_ROOM_HOUR', amount: 2}]), null);
  assert.equal(allowanceFor(undefined), null);
});

test('Silver: exactly 5 different days, any order, inside 30 days of the first', () => {
  const sel = validateSelection(['2027-03-20', '2027-03-12', '2027-04-08', '2027-03-15', '2027-03-30'], silver, CFG, 'coworking-silver', NOW);
  assert.deepEqual(sel.days, ['2027-03-12', '2027-03-15', '2027-03-20', '2027-03-30', '2027-04-08']);
  assert.equal(sel.windowStart, '2027-03-12');
  assert.equal(sel.windowEnd, '2027-04-10');
  assert.throws(() => validateSelection(['2027-03-12', '2027-03-13', '2027-03-14', '2027-03-15'], silver, CFG, 's', NOW), /exactly 5/);
  assert.throws(() => validateSelection(['2027-03-12', '2027-03-12', '2027-03-14', '2027-03-15', '2027-03-16'], silver, CFG, 's', NOW), /only be chosen once/);
  assert.throws(() => validateSelection(['2027-03-12', '2027-03-13', '2027-03-14', '2027-03-15', '2027-04-11'], silver, CFG, 's', NOW), /within 30 days/);
  assert.throws(() => validateSelection(['2027-03-09', '2027-03-13', '2027-03-14', '2027-03-15', '2027-03-16'], silver, CFG, 's', NOW), /passed/);
  assert.throws(() => validateSelection(['2027-02-30', '2027-03-13', '2027-03-14', '2027-03-15', '2027-03-16'], silver, CFG, 's', NOW), /not valid/);
  assert.throws(() => validateSelection(undefined, silver, CFG, 's', NOW), /Choose your 5/);
});

test('Gold uses its configured count (10)', () => {
  const days = Array.from({length: 10}, (_, i) => addDays('2027-03-11', i * 2));
  assert.equal(validateSelection(days, {mode: 'FLEX', days: 10}, CFG, 'g', NOW).days.length, 10);
});

test('Platinum: one start date gives 30 consecutive days', () => {
  const sel = validateSelection(['2027-03-15'], {mode: 'CONSECUTIVE', days: 0}, CFG, 'p', NOW);
  assert.equal(sel.days.length, 30);
  assert.equal(sel.days[0], '2027-03-15');
  assert.equal(sel.days[29], '2027-04-13');
  assert.throws(() => validateSelection(['2027-03-15', '2027-03-16'], {mode: 'CONSECUTIVE', days: 0}, CFG, 'p', NOW), /one start date/);
});

test('60-minute notice applies to the same day only, against last entry time', () => {
  const cfg = {...CFG, lastEntryTime: '11:00'};
  assert.equal(noticeOk('2027-03-10', cfg, NOW), true, '10:00 now, last entry 11:00: exactly 60 min is allowed');
  assert.equal(noticeOk('2027-03-10', {...cfg, lastEntryTime: '10:30'}, NOW), false, '30 minutes is rejected');
  assert.equal(noticeOk('2027-03-11', {...cfg, lastEntryTime: '00:00'}, NOW), true, 'future days are fine');
  assert.equal(noticeOk('2027-03-09', cfg, NOW), false);
});

test('config is sanitised', () => {
  assert.deepEqual(normaliseConfig({minNoticeMinutes: -5, lastEntryTime: '25:00', windowDays: 500, dailyCapacity: 0}), CFG);
  assert.deepEqual(normaliseConfig({minNoticeMinutes: 90, lastEntryTime: '18:30', windowDays: 30, dailyCapacity: 12}), {minNoticeMinutes: 90, lastEntryTime: '18:30', windowDays: 30, dailyCapacity: 12});
});
