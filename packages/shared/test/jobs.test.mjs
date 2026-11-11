import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobVisibleTo, jobTakeProblem, parseJobInput } from '../dist/index.js';

test('who sees a job', () => {
  const allies = new Set(['ally']);
  assert.equal(jobVisibleTo({ guildId: 'home', visibility: 'SERVER' }, 'home', allies), true);
  assert.equal(jobVisibleTo({ guildId: 'home', visibility: 'SERVER' }, 'ally', allies), false);
  assert.equal(jobVisibleTo({ guildId: 'home', visibility: 'ALLIES' }, 'ally', allies), true);
  assert.equal(jobVisibleTo({ guildId: 'home', visibility: 'ALLIES' }, 'stranger', allies), false);
  assert.equal(jobVisibleTo({ guildId: 'home', visibility: 'GLOBAL' }, 'stranger', allies), true);
});

test('who can take a job', () => {
  const job = { status: 'OPEN', slots: 2, posterId: 'p' };
  assert.equal(jobTakeProblem(job, [], 'a'), null);
  assert.equal(jobTakeProblem(job, [], 'p'), 'own');
  assert.equal(jobTakeProblem(job, [{ userId: 'a' }], 'a'), 'taken');
  assert.equal(jobTakeProblem(job, [{ userId: 'a' }, { userId: 'b' }], 'c'), 'full');
  assert.equal(jobTakeProblem({ ...job, status: 'DONE' }, [], 'a'), 'closed');
});

test('job form', () => {
  assert.deepEqual(parseJobInput({ kind: 'HAULING', title: '  Need a hauler ', reward: '60k aUEC', details: '' }), {
    job: { kind: 'HAULING', title: 'Need a hauler', slots: 1, visibility: 'SERVER', details: null, reward: '60k aUEC', location: null, whenText: null },
  });
  assert.match(parseJobInput({ kind: 'NOPE', title: 'x' }).error, /kind/);
  assert.match(parseJobInput({ kind: 'OTHER' }).error, /title/);
  assert.match(parseJobInput({ kind: 'OTHER', title: 'x', slots: 0 }).error, /Crew/);
  assert.match(parseJobInput({ kind: 'OTHER', title: 'x', visibility: 'MARS' }).error, /who can see/);
  assert.match(parseJobInput({ kind: 'OTHER', title: 'x'.repeat(101) }).error, /at most 100/);
  assert.equal(parseJobInput({ kind: 'OTHER', title: 'x', slots: '3', visibility: 'GLOBAL' }).job.slots, 3);
});
