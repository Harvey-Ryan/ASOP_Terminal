// Error recording (v1.13.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorRecorder, errorFingerprint, redactSecrets, normaliseMessage, firstAppFrame, fromLogArgs, newRef, captureConsole } from '../dist/index.js';

test('the same kind of error gets the same fingerprint, whatever ids or numbers are in it', () => {
  const a = errorFingerprint('api', 'Event clx1abc2def3ghi4jkl5mno6 not found for guild 1135606224155586571 after 3 tries');
  const b = errorFingerprint('api', 'Event clz9zzz8yyy7xxx6www5vvv4 not found for guild 9935606224155586571 after 12 tries');
  assert.equal(a, b);
  assert.notEqual(a, errorFingerprint('bot', 'Event clx1abc2def3ghi4jkl5mno6 not found for guild 1135606224155586571 after 3 tries'));
  assert.notEqual(a, errorFingerprint('api', 'Loot session not found'));
  assert.equal(normaliseMessage('Unknown role "Pilot" (code 10011)'), 'Unknown role <str> (code <n>)');
});

test('the first frame in our code is used, without line numbers or build hashes', () => {
  const node = 'Error: x\n    at Object.<anonymous> (/app/node_modules/express/lib/router.js:1:1)\n    at fetchSession (/app/apps/api/dist/server/routes/loot.js:120:9)\n    at next (node:internal/x:1:1)';
  assert.equal(firstAppFrame(node), 'fetchSession@loot');
  const browser = 'TypeError: x\n    at LootPage (https://asop.example/assets/LootPage-CmQBH7Bq.js:1:2345)';
  assert.equal(firstAppFrame(browser), 'LootPage@LootPage');
  assert.equal(errorFingerprint('web', 'x', browser), errorFingerprint('web', 'x', browser.replace('CmQBH7Bq', 'Zz12Yy34').replace(':1:2345', ':1:999')));
});

test('secrets are removed before anything is stored', () => {
  // A made-up token in Discord's shape, built here so no token-like string sits in the repo.
  const fakeToken = ['A'.repeat(24), 'B'.repeat(6), 'C'.repeat(27)].join('.');
  const t = redactSecrets(`connect postgresql://postgres:hunter2@db:5432/x token=abc123def Bearer abcdefghijklmnopqrstuvwxyz0123 ${fakeToken}`);
  for (const secret of ['hunter2', 'abc123def', 'abcdefghijklmnopqrstuvwxyz0123', fakeToken]) assert.ok(!t.includes(secret), secret);
});

test('console arguments become one message, with the error\'s stack', () => {
  const err = new TypeError('bad');
  const { message, stack } = fromLogArgs(['[loot] roll failed:', err, { id: 3 }]);
  assert.equal(message, '[loot] roll failed: TypeError: bad {"id":3}');
  assert.equal(stack, err.stack);
  assert.match(newRef(), /^[2-9A-HJ-NP-Z]{6}$/);
});

test('rows are written in batches, at most N of one kind a minute, and the rest are counted', async () => {
  const written = [];
  const rec = new ErrorRecorder({ source: 'api', release: '1.13.0', write: async (rows) => { written.push(...rows); }, perKindPerMinute: 3, flushMs: 10_000,
    currentContext: () => ({ ref: 'ABC234', guildId: 'g1', context: { route: '/x' } }) });
  for (let i = 0; i < 10; i++) rec.record({ message: `Boom ${i}` });
  rec.record({ message: 'Other', level: 'warn', context: { extra: true } });
  await rec.flush();
  assert.equal(written.length, 4);
  assert.deepEqual(written.map((r) => r.message), ['Boom 0', 'Boom 1', 'Boom 2', 'Other']);
  assert.equal(written[0].ref, 'ABC234');
  assert.equal(written[0].guildId, 'g1');
  assert.deepEqual(JSON.parse(written[3].context), { route: '/x', extra: true });
  assert.equal(written[3].level, 'warn');
  assert.equal(written[0].release, '1.13.0');
});

test('a failing write is swallowed and reported, never thrown or recorded again', async () => {
  const reported = [];
  const rec = new ErrorRecorder({ source: 'bot', release: '', write: async () => { throw new Error('db down'); }, fallbackLog: (...a) => reported.push(a.join(' ')) });
  rec.record({ message: 'x' });
  await rec.flush();
  assert.equal(reported.length, 1);
  assert.match(reported[0], /dropped 1 error/);
});

test('captureConsole records console.error and console.warn, and still prints them', async () => {
  const written = []; const printed = [];
  const origError = console.error, origWarn = console.warn;
  console.error = (...a) => printed.push(['error', ...a]); console.warn = (...a) => printed.push(['warn', ...a]);
  try {
    const rec = new ErrorRecorder({ source: 'bot', release: '', write: async (rows) => { written.push(...rows); } });
    captureConsole(rec);
    console.error('[x] failed:', new Error('nope'));
    console.warn('[x] slow');
    await rec.flush();
    assert.equal(printed.length, 2);
    assert.deepEqual(written.map((r) => [r.level, r.message]), [['error', '[x] failed: Error: nope'], ['warn', '[x] slow']]);
  } finally {
    console.error = origError; console.warn = origWarn;
  }
});
