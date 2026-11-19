// v1.53.0: community corrections — the rules shared by the API and the website.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCorrections, checkCorrectionValue, correctionActions, correctionIndex, gameNumber, getPath, isBigChange,
  recheckOnNewBuild, shortBuild, withPath,
} from '../dist/index.js';

test('only listed stats, sensible values; big changes are flagged', () => {
  assert.deepEqual(checkCorrectionValue('mining-laser', 'power', 2340, '2,400'), { ok: true, value: 2400, bigChange: false });
  assert.equal(checkCorrectionValue('mining-laser', 'name', null, 1).ok, false);
  assert.equal(checkCorrectionValue('nope', 'power', null, 1).ok, false);
  assert.match(checkCorrectionValue('mining-laser', 'moduleSlots', 1, 1.5).error, /whole number/);
  assert.match(checkCorrectionValue('mining-laser', 'power', 2340, 2340).error, /already say/);
  assert.match(checkCorrectionValue('mining-laser', 'power', 2340, -1).error, /below 0/);
  assert.match(checkCorrectionValue('mining-laser', 'power', 2340, 'abc').error, /number/);
  assert.equal(checkCorrectionValue('mining-laser', 'power', 2340, 9000).bigChange, true);
  assert.equal(isBigChange(0, 30), true);
  assert.equal(isBigChange(0, 5), false);
  assert.equal(isBigChange(25, -25), true);
  assert.equal(isBigChange(null, 1), true);
});

test('game values: a percent change the files don\'t list is 0', () => {
  const laser = { power: 2340, modifiers: { Resistance: 25 } };
  assert.equal(gameNumber(laser, 'power'), 2340);
  assert.equal(gameNumber(laser, 'modifiers.Resistance'), 25);
  assert.equal(gameNumber(laser, 'modifiers.Instability'), 0);
  assert.equal(gameNumber(laser, 'extraction'), null);
  assert.equal(getPath(laser, 'modifiers.Resistance'), 25);
  const changed = withPath(laser, 'modifiers.Resistance', 30);
  assert.equal(changed.modifiers.Resistance, 30);
  assert.equal(laser.modifiers.Resistance, 25, 'the original is untouched');
});

test('separation of duties', () => {
  const c = { status: 'PENDING', submittedBy: 'sub', confirmedBy: ['a'] };
  const member = (id) => ({ discordId: id, member: true, reviewer: false });
  const reviewer = (id) => ({ discordId: id, member: true, reviewer: true });
  assert.deepEqual(correctionActions(c, member('sub')), ['withdraw']);
  assert.deepEqual(correctionActions(c, member('a')), [], 'already confirmed');
  assert.deepEqual(correctionActions(c, member('b')), ['confirm']);
  assert.deepEqual(correctionActions(c, { ...member('x'), member: false }), []);
  assert.deepEqual(correctionActions(c, null), []);
  const review = { ...c, status: 'REVIEW', confirmedBy: ['a', 'r1'] };
  assert.deepEqual(correctionActions(review, reviewer('r1')), ['reject'], 'a confirmer can’t approve');
  assert.deepEqual(correctionActions(review, reviewer('r2')), ['approve', 'reject']);
  assert.deepEqual(correctionActions({ ...review, submittedBy: 'r2' }, reviewer('r2')), ['withdraw'], 'nor the submitter');
  const live = { ...c, status: 'LIVE', confirmedBy: ['a', 'b'], disputedBy: ['d'] };
  assert.deepEqual(correctionActions(live, member('c')), ['dispute']);
  assert.deepEqual(correctionActions(live, member('d')), [], 'one dispute each');
  assert.deepEqual(correctionActions(live, reviewer('r')), ['dispute', 'revert']);
  assert.deepEqual(correctionActions({ ...live, status: 'DISPUTED' }, reviewer('r')), ['uphold', 'revert']);
  assert.deepEqual(correctionActions({ ...live, status: 'RECHECK' }, reviewer('r')), ['approve', 'revert']);
});

test('a new build: fixed in the files → retire, moved → re-check, same → keep', () => {
  assert.equal(recheckOnNewBuild({ gameValue: 2340, value: 2400 }, 2400), 'retire');
  assert.equal(recheckOnNewBuild({ gameValue: 2340, value: 2400 }, 2340), 'keep');
  assert.equal(recheckOnNewBuild({ gameValue: 2340, value: 2400 }, 2500), 'recheck');
  assert.equal(recheckOnNewBuild({ gameValue: 2340, value: 2400 }, null), 'recheck');
});

test('applying corrections to records', () => {
  const lasers = [{ uuid: 'a', power: 1, modifiers: {} }, { uuid: 'b', power: 2, modifiers: {} }];
  const index = correctionIndex([
    { id: '1', kind: 'mining-laser', recordKey: 'a', field: 'power', gameValue: 1, value: 5, credit: null, confirmations: 2, disputed: false, build: null, approvedAt: null },
    { id: '2', kind: 'mining-laser', recordKey: 'a', field: 'modifiers.Resistance', gameValue: 0, value: -10, credit: null, confirmations: 2, disputed: false, build: null, approvedAt: null },
  ]);
  const out = applyCorrections(lasers, 'mining-laser', (l) => l.uuid, index);
  assert.deepEqual(out[0], { uuid: 'a', power: 5, modifiers: { Resistance: -10 } });
  assert.equal(out[1], lasers[1], 'untouched records are the same objects');
  assert.equal(lasers[0].power, 1);
});

test('build badge words', () => {
  assert.equal(shortBuild('4.10.3-LIVE.13165946'), '4.10.3 LIVE');
  assert.equal(shortBuild('5.0.0-ptu.13228337'), '5.0.0 PTU');
  assert.equal(shortBuild(null), null);
});
