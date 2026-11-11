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

// ── When the status changes on its own (v1.11.1) ─────────────────────────────
import { gameDataRecheckAt, GAME_DATA_CHANGE_SQL, GAME_DATA_NOT_SET_UP } from '../dist/gameData.js';

test('gameDataRecheckAt: when the status turns stale with no new runs', () => {
  const base = { ...GAME_DATA_NOT_SET_UP, commit: 'abc', health: 'ok', lastCheckAt: '2026-11-10T00:00:00.000Z', checkIntervalMin: 60 };
  // hourly checks → stale after 150 min (+1 s so the check lands just past it)
  assert.equal(gameDataRecheckAt(base).toISOString(), '2026-11-10T02:30:01.000Z');
  // unknown interval → daily → 60 h
  assert.equal(gameDataRecheckAt({ ...base, checkIntervalMin: null }).toISOString(), '2026-11-12T12:00:01.000Z');
  // already stale: nothing more happens on its own
  assert.equal(gameDataRecheckAt({ ...base, health: 'stale' }), null);
  // never checked: nothing to wait for
  assert.equal(gameDataRecheckAt({ ...base, lastCheckAt: null }), null);
});

test('gameDataRecheckAt: an "updating" run drops out of the status after an hour', () => {
  const s = { ...GAME_DATA_NOT_SET_UP, commit: 'abc', health: 'syncing', lastCheckAt: '2026-11-10T00:00:00.000Z', checkIntervalMin: 1440,
    running: { startedAt: '2026-11-10T00:00:00.000Z', trigger: 'cron' } };
  assert.equal(gameDataRecheckAt(s).toISOString(), '2026-11-10T01:00:01.000Z'); // sooner than stale (60 h)
});

test('the change check reads only the latest run, the commit and pending requests', () => {
  assert.match(GAME_DATA_CHANGE_SQL, /sync_run ORDER BY id DESC LIMIT 1/);
  assert.match(GAME_DATA_CHANGE_SQL, /scdata_raw\.state/);
  assert.match(GAME_DATA_CHANGE_SQL, /sync_request WHERE handled_at IS NULL/);
  assert.doesNotMatch(GAME_DATA_CHANGE_SQL, /count\(/);
});
