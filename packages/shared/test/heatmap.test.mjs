import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEventHeatmap, bestTimes, slotRange, hourName, localSlot, emptyGrid } from '../dist/index.js';

// Saturday 8 PM in Chicago = Sunday 02:00 UTC (CST)
const sat8pm = new Date('2026-11-15T02:00:00Z');
const ev = (o) => ({ startTime: sat8pm, status: 'COMPLETED', confirmedAttendees: null, vcAttendees: '[]', rsvps: [], ...o });

test('slots are in the chosen time zone', () => {
  assert.deepEqual(localSlot(sat8pm, 'America/Chicago'), { day: 6, hour: 20 });
  assert.deepEqual(localSlot(sat8pm, 'UTC'), { day: 0, hour: 2 });
  assert.deepEqual(localSlot(new Date('2026-07-12T01:00:00Z'), 'America/Chicago'), { day: 6, hour: 20 }); // CDT
});

test('event map: averages per event, only recorded attendance, show-up rate over sign-ups', () => {
  const m = buildEventHeatmap([
    // 4 signed up, 3 of them came, plus a walk-in
    ev({ confirmedAttendees: JSON.stringify(['a', 'b', 'c', 'walk']), rsvps: ['a', 'b', 'c', 'd'].map((userId) => ({ userId, tentative: false })) }),
    // voice only: 2 people, 2 signed up, 1 came; a maybe who didn't come isn't counted
    ev({ vcAttendees: JSON.stringify(['a', 'x']), rsvps: [{ userId: 'a', tentative: false }, { userId: 'z', tentative: false }, { userId: 'm', tentative: true }] }),
    // nothing recorded: left out entirely
    ev({ rsvps: [{ userId: 'q', tentative: false }] }),
    // not over yet: left out
    ev({ status: 'PENDING', confirmedAttendees: '["a"]' }),
  ], 'America/Chicago', 180);
  assert.equal(m.attendanceGrid[6][20], 3); // (4 + 2) / 2 events
  assert.equal(m.eventCountGrid[6][20], 2);
  assert.equal(m.ratioGrid[6][20], 4 / 6); // 3 of 4 + 1 of 2
  assert.equal(m.eventCount, 2);
  assert.equal(m.notRecorded, 2);
  assert.equal(m.maxAttendance, 3);
  assert.equal(m.ratioGrid[0][0], null);
});

test('an attendance check where nobody came is a real 0%, not missing', () => {
  const m = buildEventHeatmap([ev({ confirmedAttendees: '[]', rsvps: [{ userId: 'a', tentative: false }] })], 'America/Chicago', 30);
  assert.equal(m.ratioGrid[6][20], 0);
  assert.equal(m.attendanceGrid[6][20], 0);
  assert.equal(m.eventCountGrid[6][20], 1);
});

test('reading times', () => {
  assert.equal(hourName(0), '12 AM');
  assert.equal(hourName(12), '12 PM');
  assert.equal(hourName(20), '8 PM');
  assert.equal(slotRange(6, 20, 23), 'Sat 8–11 PM');
  assert.equal(slotRange(1, 11, 13), 'Mon 11 AM–1 PM');
  assert.equal(slotRange(5, 21, 24), 'Fri 9 PM–12 AM');
});

test('best times: busy runs, busiest first', () => {
  const g = emptyGrid(1);
  g[6][20] = 10; g[6][21] = 9; g[6][22] = 8; g[0][20] = 9; g[3][9] = 2;
  assert.deepEqual(bestTimes(g).map((b) => b.label), ['Sat 8–11 PM', 'Sun 8–9 PM']);
  assert.deepEqual(bestTimes(emptyGrid(0)), []);
  // Cells that can't count (no events) are skipped
  const r = emptyGrid(null); r[1][19] = 1; r[2][19] = 0.5;
  assert.deepEqual(bestTimes(r, 3, (d) => d !== 1).map((b) => b.label), ['Tue 7–8 PM']);
});
