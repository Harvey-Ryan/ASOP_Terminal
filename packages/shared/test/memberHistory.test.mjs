import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeFor, statsFor, summarizeMembers, rolesPlayed } from '../dist/index.js';

const roles = [{ id: 'p', name: 'Pilot', count: 2 }];
const ev = (id, day, status, rsvps, attendees) => ({ id, name: `Op ${id}`, startTime: new Date(`2026-10-${String(day).padStart(2, '0')}T20:00:00Z`), status, roles, rsvps, attendees });
const r = (userId, role = null, tentative = false) => ({ userId, username: userId.toUpperCase(), role, tentative });

const events = [
  ev('1', 1, 'COMPLETED', [r('a', 'p'), r('b'), r('c', null, true)], ['a', 'c', 'w']),
  ev('2', 8, 'ENDED', [r('a', 'p'), r('b', 'p')], ['b']),
  ev('3', 15, 'ENDED', [r('a'), r('b')], null), // no voice, no check: not recorded
  ev('4', 29, 'PENDING', [r('a', 'p'), r('b', null, true)], null),
];

test('outcomes: attended, no-show, maybe, walk-in, not recorded, upcoming', () => {
  assert.deepEqual(['a', 'b', 'c', 'w'].map((u) => outcomeFor(events[0], u).outcome), ['attended', 'no-show', 'attended', 'attended']);
  assert.equal(outcomeFor(events[0], 'a').role, 'Pilot');
  assert.equal(outcomeFor(events[0], 'b').role, 'Unassigned');
  assert.equal(outcomeFor(events[0], 'c').walkIn, true); // a maybe who came
  assert.equal(outcomeFor(events[0], 'w').role, null);
  assert.equal(outcomeFor(events[0], 'nobody'), null);
  assert.equal(outcomeFor(events[2], 'a').outcome, 'not-recorded');
  assert.equal(outcomeFor(events[3], 'a').outcome, 'upcoming');
  assert.equal(outcomeFor(events[3], 'b').outcome, 'maybe');
  assert.equal(outcomeFor(ev('5', 2, 'COMPLETED', [r('m', null, true)], ['x']), 'm').outcome, 'maybe'); // maybes are never no-shows
});

test('stats and the members list', () => {
  const list = Object.fromEntries(summarizeMembers(events).map((m) => [m.userId, m]));
  assert.deepEqual(
    { attended: list.a.attended, signedUp: list.a.signedUp, noShows: list.a.noShows, showRate: list.a.showRate },
    { attended: 1, signedUp: 2, noShows: 1, showRate: 50 },
  );
  assert.equal(list.b.showRate, 50);
  assert.equal(list.w.signedUp, 0);
  assert.equal(list.w.showRate, null);
  assert.equal(list.w.attended, 1);
  assert.equal(list.a.lastSeen, '2026-10-01T20:00:00.000Z');
  assert.equal(list.a.name, 'A');
  assert.equal(list.w.name, 'w');
  assert.equal(summarizeMembers(events, new Map([['w', 'Walker']])).find((m) => m.userId === 'w').name, 'Walker');
  assert.deepEqual(statsFor([]), { attended: 0, signedUp: 0, noShows: 0, showRate: null, firstSeen: null, lastSeen: null });
});

test('roles played counts attended events only', () => {
  const mine = events.map((e) => outcomeFor(e, 'a')).filter(Boolean);
  assert.deepEqual(rolesPlayed(mine), [{ role: 'Pilot', count: 1 }]);
});

test('tournament results in words', async () => {
  const { tournamentResult: t } = await import('../dist/index.js');
  assert.deepEqual(
    [t('WINNER', 1, 'COMPLETED'), t('RUNNER_UP', 2, 'COMPLETED'), t('ELIMINATED', 4, 'COMPLETED'), t('ELIMINATED', 11, 'COMPLETED'), t('ELIMINATED', 22, 'COMPLETED'),
     t('ELIMINATED', null, 'IN_PROGRESS'), t('ACTIVE', null, 'IN_PROGRESS'), t('ACTIVE', null, 'REGISTRATION'), t('ACTIVE', null, 'CANCELLED')],
    ['Winner', 'Runner-up', '4th place', '11th place', '22nd place', 'Eliminated', 'Playing', 'Signed up', 'Cancelled'],
  );
});

test('who can comment on after-action notes', async () => {
  const { canComment, recordedAttendees } = await import('../dist/index.js');
  const base = { status: 'COMPLETED', confirmedAttendees: JSON.stringify(['a']), vcAttendees: '[]', rsvps: [{ userId: 'b', tentative: false }] };
  assert.equal(canComment(base, 'a'), true);
  assert.equal(canComment(base, 'b'), false); // attendance recorded and b wasn't there
  const unrecorded = { ...base, status: 'ENDED', confirmedAttendees: null, rsvps: [{ userId: 'b', tentative: false }, { userId: 'm', tentative: true }] };
  assert.equal(canComment(unrecorded, 'b'), true);
  assert.equal(canComment(unrecorded, 'm'), false);
  assert.equal(canComment({ ...base, status: 'PENDING' }, 'a'), false);
  assert.deepEqual(recordedAttendees({ status: 'ENDED', confirmedAttendees: null, vcAttendees: '["x"]' }), ['x']);
});

test('date range: parsed from the query, checked, and turned into a filter', async () => {
  const { parseHistoryRange, rangeWhere } = await import('../dist/index.js');
  const from = '2026-01-01T06:00:00.000Z', to = '2026-02-01T05:59:59.999Z';
  const ok = parseHistoryRange(from, to);
  assert.deepEqual(ok, { range: { from: new Date(from), to: new Date(to) } });
  assert.deepEqual(rangeWhere(ok.range), { gte: new Date(from), lte: new Date(to) });
  assert.deepEqual(parseHistoryRange(undefined, ''), { range: {} });
  assert.equal(rangeWhere({}), undefined);
  assert.deepEqual(rangeWhere(parseHistoryRange(from, undefined).range), { gte: new Date(from) });
  assert.match(parseHistoryRange('soon', undefined).error, /from must be a date/);
  assert.match(parseHistoryRange(['x'], undefined).error, /from must be a date/);
  assert.match(parseHistoryRange(to, from).error, /after its end/);
});
