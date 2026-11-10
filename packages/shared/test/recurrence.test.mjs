// Tests for src/recurrence.ts. Run after building: `npm test -w @dem/shared`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextOccurrence, upcomingOccurrences, describeRecurrence, recurrenceOptions,
  zonedTimeToUtc, localParts,
} from '../dist/recurrence.js';

const CHI = 'America/Chicago';
const at = (y, mo, d, h, mi, tz) => zonedTimeToUtc(y, mo, d, h, mi, tz);
const local = (date, tz) => {
  const p = localParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
};
const series = (type, anchor, tz, n) => upcomingOccurrences(anchor, { type, anchor, timeZone: tz }, n).map((d) => local(d, tz));

// ── Daylight saving ──────────────────────────────────────────────────────────

test('weekly 8 PM stays 8 PM local across the November 1 change (old code gave 7 PM)', () => {
  const anchor = at(2026, 10, 27, 20, 0, CHI); // Tue Oct 27, 8 PM CDT
  assert.deepEqual(series('WEEKLY', anchor, CHI, 3), ['2026-11-03 20:00', '2026-11-10 20:00', '2026-11-17 20:00']);
  assert.equal(nextOccurrence(anchor, { type: 'WEEKLY', anchor, timeZone: CHI }).toISOString(), '2026-11-04T02:00:00.000Z');
});

test('weekly keeps local time across the March change', () => {
  const anchor = at(2027, 3, 9, 20, 0, CHI); // Tue Mar 9 2027, 8 PM CST (DST starts Mar 14)
  assert.deepEqual(series('WEEKLY', anchor, CHI, 2), ['2027-03-16 20:00', '2027-03-23 20:00']);
});

test('an occurrence that already drifted an hour snaps back to the anchor time', () => {
  const anchor = at(2026, 10, 20, 20, 0, CHI);
  const drifted = at(2026, 11, 3, 19, 0, CHI); // the old code produced 7 PM
  assert.equal(local(nextOccurrence(drifted, { type: 'WEEKLY', anchor, timeZone: CHI }), CHI), '2026-11-10 20:00');
});

test('daily at 2:30 AM through spring-forward lands just after the gap and continues at 2:30', () => {
  const anchor = at(2027, 3, 12, 2, 30, CHI);
  const s = series('DAILY', anchor, CHI, 3);
  assert.equal(s[0], '2027-03-13 02:30');
  assert.equal(s[1], '2027-03-14 03:30'); // 2:30 doesn't exist on Mar 14
  assert.equal(s[2], '2027-03-15 02:30');
});

test('daily at 1:30 AM through fall-back picks the first 1:30 and never repeats a day', () => {
  const anchor = at(2026, 10, 31, 1, 30, CHI);
  const d = upcomingOccurrences(anchor, { type: 'DAILY', anchor, timeZone: CHI }, 3);
  assert.deepEqual(d.map((x) => local(x, CHI)), ['2026-11-01 01:30', '2026-11-02 01:30', '2026-11-03 01:30']);
  assert.equal(d[0].toISOString(), '2026-11-01T06:30:00.000Z'); // first (CDT) 1:30
});

// ── Monthly by date ──────────────────────────────────────────────────────────

test('monthly on the 31st: last day in shorter months, back to the 31st after (no drift)', () => {
  const anchor = at(2027, 1, 31, 20, 0, CHI);
  assert.deepEqual(series('MONTHLY', anchor, CHI, 5), [
    '2027-02-28 20:00', '2027-03-31 20:00', '2027-04-30 20:00', '2027-05-31 20:00', '2027-06-30 20:00',
  ]);
});

test('monthly on the 29th/30th in February, leap and non-leap years', () => {
  assert.deepEqual(series('MONTHLY', at(2027, 1, 30, 19, 0, CHI), CHI, 2), ['2027-02-28 19:00', '2027-03-30 19:00']);
  assert.deepEqual(series('MONTHLY', at(2028, 1, 29, 19, 0, CHI), CHI, 2), ['2028-02-29 19:00', '2028-03-29 19:00']);
  assert.deepEqual(series('MONTHLY', at(2028, 1, 31, 19, 0, CHI), CHI, 2), ['2028-02-29 19:00', '2028-03-31 19:00']);
});

test('monthly crosses the year end', () => {
  assert.deepEqual(series('MONTHLY', at(2026, 11, 30, 21, 0, CHI), CHI, 3), ['2026-12-30 21:00', '2027-01-30 21:00', '2027-02-28 21:00']);
});

// ── Monthly by weekday ───────────────────────────────────────────────────────

test('2nd Tuesday of the month', () => {
  const anchor = at(2026, 11, 10, 20, 0, CHI); // today: the 2nd Tuesday of November
  assert.deepEqual(series('MONTHLY_WEEKDAY', anchor, CHI, 4), [
    '2026-12-08 20:00', '2027-01-12 20:00', '2027-02-09 20:00', '2027-03-09 20:00',
  ]);
});

test('1st Saturday, including months that start on a Saturday', () => {
  const anchor = at(2026, 8, 1, 19, 0, CHI); // Sat Aug 1 2026
  assert.deepEqual(series('MONTHLY_WEEKDAY', anchor, CHI, 3), ['2026-09-05 19:00', '2026-10-03 19:00', '2026-11-07 19:00']);
});

test('a "5th" weekday falls back to the last one in months without five', () => {
  const anchor = at(2026, 10, 30, 20, 0, CHI); // Fri Oct 30 = 5th Friday
  assert.deepEqual(series('MONTHLY_WEEKDAY', anchor, CHI, 3), ['2026-11-27 20:00', '2026-12-25 20:00', '2027-01-29 20:00']);
});

test('last Friday of the month', () => {
  const anchor = at(2026, 11, 27, 20, 0, CHI);
  assert.deepEqual(series('MONTHLY_LAST_WEEKDAY', anchor, CHI, 4), [
    '2026-12-25 20:00', '2027-01-29 20:00', '2027-02-26 20:00', '2027-03-26 20:00',
  ]);
});

test('weekday is the organiser\'s local weekday, not UTC\'s (8 PM Tue Chicago = Wed UTC)', () => {
  const anchor = at(2026, 11, 10, 20, 0, CHI);
  const n = nextOccurrence(anchor, { type: 'MONTHLY_WEEKDAY', anchor, timeZone: CHI });
  assert.equal(n.getUTCDay(), 3);                     // Wednesday in UTC
  assert.equal(localParts(n, CHI).weekday, 2);        // Tuesday locally
});

// ── Other zones ──────────────────────────────────────────────────────────────

test('works in other zones (UTC, Sydney, Auckland, Kolkata)', () => {
  assert.deepEqual(series('MONTHLY', at(2027, 1, 31, 9, 0, 'UTC'), 'UTC', 2), ['2027-02-28 09:00', '2027-03-31 09:00']);
  assert.deepEqual(series('WEEKLY', at(2027, 3, 30, 19, 0, 'Australia/Sydney'), 'Australia/Sydney', 2), ['2027-04-06 19:00', '2027-04-13 19:00']);
  assert.deepEqual(series('MONTHLY_LAST_WEEKDAY', at(2026, 12, 31, 18, 30, 'Pacific/Auckland'), 'Pacific/Auckland', 2), ['2027-01-28 18:30', '2027-02-25 18:30']);
  assert.deepEqual(series('BIWEEKLY', at(2026, 11, 10, 21, 30, 'Asia/Kolkata'), 'Asia/Kolkata', 2), ['2026-11-24 21:30', '2026-12-08 21:30']);
});

// ── Properties over many random series ───────────────────────────────────────

test('random series in many zones: increasing, right weekday/day, local time kept', () => {
  const zones = ['America/Chicago', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin',
    'Australia/Sydney', 'Pacific/Auckland', 'Asia/Tokyo', 'Asia/Kolkata', 'America/Sao_Paulo', 'UTC'];
  const types = ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'MONTHLY_WEEKDAY', 'MONTHLY_LAST_WEEKDAY'];
  let seed = 42;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
  let checked = 0;
  for (let i = 0; i < 600; i++) {
    const tz = zones[rnd(zones.length)];
    const type = types[rnd(types.length)];
    const hour = rnd(24), minute = [0, 15, 30, 45][rnd(4)];
    const anchor = at(2026 + rnd(2), 1 + rnd(12), 1 + rnd(28) + (rnd(3) === 0 ? 3 : 0), hour, minute, tz);
    const a = localParts(anchor, tz);
    let prev = anchor;
    for (const d of upcomingOccurrences(anchor, { type, anchor, timeZone: tz }, 30)) {
      assert.ok(d > prev, `${type} ${tz}: not increasing after ${prev.toISOString()}`);
      const p = localParts(d, tz);
      const gap = p.hour !== a.hour || p.minute !== a.minute;
      if (gap) {
        // Only allowed when the anchor time didn't exist that day (spring-forward).
        const back = zonedTimeToUtc(p.year, p.month, p.day, a.hour, a.minute, tz);
        assert.ok(Math.abs(back - d) < 2 * 3600e3, `${type} ${tz}: time ${p.hour}:${p.minute} vs ${a.hour}:${a.minute}`);
      }
      if (type === 'WEEKLY' || type === 'BIWEEKLY' || type.startsWith('MONTHLY_')) {
        if (!gap) assert.equal(p.weekday, a.weekday, `${type} ${tz}: weekday changed`);
      }
      if (type === 'MONTHLY' && !gap) {
        const dim = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
        assert.equal(p.day, Math.min(a.day, dim), `${type} ${tz}: day ${p.day} vs anchor ${a.day}`);
      }
      if (type === 'MONTHLY_LAST_WEEKDAY' && !gap) {
        const dim = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
        assert.ok(p.day > dim - 7, `${type} ${tz}: day ${p.day} is not in the last week`);
      }
      prev = d;
      checked++;
    }
  }
  assert.ok(checked > 15000);
});

// ── Labels and options ───────────────────────────────────────────────────────

test('labels', () => {
  assert.equal(describeRecurrence('MONTHLY_WEEKDAY', at(2026, 11, 10, 20, 0, CHI), CHI), 'Monthly on the 2nd Tuesday');
  assert.equal(describeRecurrence('MONTHLY', at(2027, 1, 31, 20, 0, CHI), CHI), 'Monthly on the 31st (last day in shorter months)');
  assert.equal(describeRecurrence('MONTHLY', at(2027, 1, 22, 20, 0, CHI), CHI), 'Monthly on the 22nd');
  assert.equal(describeRecurrence('MONTHLY', at(2027, 1, 11, 20, 0, CHI), CHI), 'Monthly on the 11th');
  assert.equal(describeRecurrence('WEEKLY', at(2026, 11, 10, 20, 0, CHI), CHI), 'Weekly on Tuesday');
  assert.equal(describeRecurrence('WEEKLY'), 'Weekly');
});

test('options offered for a start date', () => {
  const types = (y, m, d) => recurrenceOptions(at(y, m, d, 20, 0, CHI), CHI).map((o) => o.type).join(',');
  assert.equal(types(2026, 11, 10), 'DAILY,WEEKLY,BIWEEKLY,MONTHLY,MONTHLY_WEEKDAY');                       // 2nd Tue
  assert.equal(types(2026, 11, 27), 'DAILY,WEEKLY,BIWEEKLY,MONTHLY,MONTHLY_WEEKDAY,MONTHLY_LAST_WEEKDAY');  // 4th and last Fri
  assert.equal(types(2026, 10, 30), 'DAILY,WEEKLY,BIWEEKLY,MONTHLY,MONTHLY_LAST_WEEKDAY');                  // 5th Fri → last only
});

test('regression: midnight on a spring-forward day (Sydney, Oct 4 2026) stays midnight', () => {
  const tz = 'Australia/Sydney';
  assert.equal(local(zonedTimeToUtc(2026, 10, 4, 0, 0, tz), tz), '2026-10-04 00:00');
  assert.deepEqual(series('DAILY', at(2026, 10, 2, 0, 0, tz), tz, 3), ['2026-10-03 00:00', '2026-10-04 00:00', '2026-10-05 00:00']);
});
