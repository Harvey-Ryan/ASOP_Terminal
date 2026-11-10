// Tests for the game data status helpers. Run: `npm test -w @dem/shared`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferCheckIntervalMin, parseGameDataStatus, gameDataStaleAfterMin, describeCheckInterval } from '../dist/gameData.js';

const DAY = 86400, MIN = 60;

test('a regular 5-minute schedule is recognised', () => {
  assert.equal(inferCheckIntervalMin([300, 301, 299, 300, 302, 300, 298, 300, 300]), 5);
});

test('a regular daily schedule is recognised, even with one missed day', () => {
  assert.equal(inferCheckIntervalMin([DAY, DAY + 40, DAY - 30, 2 * DAY, DAY, DAY + 5, DAY, DAY, DAY]), 1440);
});

test("today's production history (setup and deploy runs minutes apart) is not a schedule", () => {
  // e.g. 11:18, 11:20, 11:43, 12:05, 12:22
  assert.equal(inferCheckIntervalMin([17 * MIN, 22 * MIN, 23 * MIN, 2 * MIN]), null);
  assert.equal(describeCheckInterval(null), 'daily');
  assert.equal(gameDataStaleAfterMin(null), 3600); // 2½ days
});

test('a daily schedule right after a busy deploy day: default (daily) until it is clear', () => {
  // newest first: 2 daily gaps, then the long gap from the last deploy run, then deploy-day noise
  assert.equal(inferCheckIntervalMin([DAY, DAY, 21 * 3600, 17 * MIN, 22 * MIN, 23 * MIN, 2 * MIN]), null);
});

test('too few runs → default', () => {
  assert.equal(inferCheckIntervalMin([]), null);
  assert.equal(inferCheckIntervalMin([300, 300]), null);
  assert.equal(inferCheckIntervalMin(null), null);
});

test('no false "checks have stopped" 45 minutes after a deploy-day run', () => {
  const now = new Date('2026-11-10T18:28:00Z');
  const s = parseGameDataStatus({
    state: { commit: 'abc', build: '4.10.2-LIVE.12881860', committed_at: '2026-10-28T20:20:55Z', synced_at: '2026-11-10T17:20:00Z' },
    last_check: '2026-11-10T17:43:00Z',
    check_gaps_sec: [23 * MIN, 2 * MIN, 17 * MIN],
    running: null,
    last_run: { status: 'success', trigger: 'cron', started_at: '2026-11-10T17:18:00Z', finished_at: '2026-11-10T17:20:00Z', error: null },
    last_success: null, pending: null, counts: null,
  }, now);
  assert.equal(s.checkIntervalMin, null);
  assert.equal(s.health, 'ok');
});

test('a real stop is still caught: regular 5-minute runs, then nothing for an hour', () => {
  const s = parseGameDataStatus({
    state: { commit: 'abc', build: null, committed_at: null, synced_at: null },
    last_check: '2026-11-10T17:00:00Z',
    check_gaps_sec: [300, 300, 300, 300, 300],
    running: null, last_run: null, last_success: null, pending: null, counts: null,
  }, new Date('2026-11-10T18:00:00Z'));
  assert.equal(s.health, 'stale');
});
