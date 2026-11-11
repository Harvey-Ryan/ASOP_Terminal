import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleSignupProblem, waitlistProblem, planWaitlistMoves, findRole } from '../dist/index.js';

const roles = [
  { id: 'pilot', name: 'Pilot', count: 1 },
  { id: 'miner', name: 'Miner', count: 2 },
  { id: 'medic', name: 'Medic', count: 1, guildId: 'G2' },
];

test('signup checks are unchanged', () => {
  const rsvps = [{ userId: 'a', role: 'pilot' }];
  assert.equal(roleSignupProblem(roles, rsvps, 'pilot', 'b', 'G1'), 'full');
  assert.equal(roleSignupProblem(roles, rsvps, 'pilot', 'a', 'G1'), null);
  assert.equal(roleSignupProblem(roles, rsvps, 'medic', 'b', 'G1'), 'other-server');
  assert.equal(roleSignupProblem(roles, rsvps, 'nope', 'b', 'G1'), 'unknown');
  assert.equal(roleSignupProblem([{ name: 'Old', count: 1 }], [], 'Old', 'b', 'G1'), null);
});

test('findRole prefers ids over names', () => {
  const r = [{ id: 'Miner', name: 'Pilot', count: 1 }, { id: 'x', name: 'Miner', count: 1 }];
  assert.equal(findRole(r, 'Miner').name, 'Pilot');
});

test('waitlistProblem', () => {
  const rsvps = [{ userId: 'a', role: 'pilot' }];
  assert.equal(waitlistProblem(roles, rsvps, 'pilot', 'b', 'G1'), null);
  assert.equal(waitlistProblem(roles, rsvps, 'pilot', 'a', 'G1'), 'has-role');
  assert.equal(waitlistProblem(roles, rsvps, 'miner', 'b', 'G1'), 'open');
  assert.equal(waitlistProblem(roles, rsvps, 'medic', 'b', 'G1'), 'other-server');
  assert.equal(waitlistProblem(roles, rsvps, 'gone', 'b', 'G1'), 'unknown');
});

test('first in line moves into an open slot', () => {
  const rsvps = [{ userId: 'a', role: 'pilot' }, { userId: 'b', role: null }, { userId: 'c', role: 'miner' }];
  const waitlist = [{ userId: 'c', role: 'pilot', guildId: 'G1' }, { userId: 'b', role: 'pilot', guildId: 'G1' }];
  assert.deepEqual(planWaitlistMoves(roles, rsvps, waitlist), []);
  const after = rsvps.filter((r) => r.userId !== 'a');
  assert.deepEqual(planWaitlistMoves(roles, after, waitlist), [{ userId: 'c', role: 'pilot', from: 'miner', guildId: 'G1' }]);
});

test('a move frees the old role for the next line (chain)', () => {
  const rsvps = [
    { userId: 'm1', role: 'miner' }, { userId: 'm2', role: 'miner' },
    { userId: 'x', role: null },
  ];
  const waitlist = [{ userId: 'm1', role: 'pilot', guildId: 'G1' }, { userId: 'x', role: 'miner', guildId: 'G1' }];
  assert.deepEqual(planWaitlistMoves(roles, rsvps, waitlist), [
    { userId: 'm1', role: 'pilot', from: 'miner', guildId: 'G1' },
    { userId: 'x', role: 'miner', from: null, guildId: 'G1' },
  ]);
});

test('server-limited roles skip other servers; people off the roster never move', () => {
  const rsvps = [{ userId: 'a', role: null }, { userId: 'b', role: null }];
  const waitlist = [
    { userId: 'gone', role: 'medic', guildId: 'G2' },
    { userId: 'a', role: 'medic', guildId: 'G1' },
    { userId: 'b', role: 'medic', guildId: 'G2' },
  ];
  assert.deepEqual(planWaitlistMoves(roles, rsvps, waitlist), [{ userId: 'b', role: 'medic', from: null, guildId: 'G2' }]);
});

test('several slots fill in line order; nobody moves twice', () => {
  const rsvps = [{ userId: 'a', role: null }, { userId: 'b', role: null }, { userId: 'c', role: null }];
  const waitlist = ['a', 'b', 'c'].map((userId) => ({ userId, role: 'miner', guildId: 'G1' }));
  assert.deepEqual(planWaitlistMoves(roles, rsvps, waitlist).map((m) => m.userId), ['a', 'b']);
});
