// v1.53.0: community corrections — the rules shared by the API and the website.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  shipGunSlots,
  gunMountKey,
  gunMounts,
  gunMountRecord,
  applyGunMountCorrections,
  formatCorrectionValue,
  GUN_ROLE_CODES,
  gunRoleFromCode,
  applyCorrections,
  checkCorrectionValue,
  correctionActions,
  correctionIndex,
  gameNumber,
  getPath,
  isBigChange,
  recheckOnNewBuild,
  shortBuild,
  withPath,
} from '../dist/index.js';

test('only listed stats, sensible values; big changes are flagged', () => {
  assert.deepEqual(checkCorrectionValue('mining-laser', 'power', 2340, '2,400'), {
    ok: true,
    value: 2400,
    bigChange: false,
  });
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

test("game values: a percent change the files don't list is 0", () => {
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
  assert.deepEqual(
    correctionActions({ ...review, submittedBy: 'r2' }, reviewer('r2')),
    ['withdraw'],
    'nor the submitter',
  );
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
  const lasers = [
    { uuid: 'a', power: 1, modifiers: {} },
    { uuid: 'b', power: 2, modifiers: {} },
  ];
  const index = correctionIndex([
    {
      id: '1',
      kind: 'mining-laser',
      recordKey: 'a',
      field: 'power',
      gameValue: 1,
      value: 5,
      credit: null,
      confirmations: 2,
      disputed: false,
      build: null,
      approvedAt: null,
    },
    {
      id: '2',
      kind: 'mining-laser',
      recordKey: 'a',
      field: 'modifiers.Resistance',
      gameValue: 0,
      value: -10,
      credit: null,
      confirmations: 2,
      disputed: false,
      build: null,
      approvedAt: null,
    },
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

// ── Gun mounts (v1.64.0) ────────────────────────────────────────────────────

const hornetFixture = JSON.parse(
  readFileSync(new URL('./fixtures/ships/combat-anvl_hornet_f7cm_mk2.json', import.meta.url), 'utf8'),
);
const hornet = { className: hornetFixture.ClassName, name: hornetFixture.Name, gunSlots: shipGunSlots(hornetFixture) };
const NOSE_KEY = gunMountKey(hornet.className, 'hardpoint_weapon_nose');
const live = (value, extra = {}) => ({
  id: 'c1',
  kind: 'gun-mount',
  recordKey: NOSE_KEY,
  field: 'role',
  gameValue: GUN_ROLE_CODES.pilot,
  value,
  credit: 'Ryan',
  confirmations: 2,
  disputed: false,
  build: '4.10',
  approvedAt: null,
  ...extra,
});

test('gun mounts: role codes are fixed and round-trip', () => {
  assert.deepEqual(GUN_ROLE_CODES, { pilot: 0, takeover: 1, crew: 2, auto: 3 });
  for (const [role, code] of Object.entries(GUN_ROLE_CODES)) assert.equal(gunRoleFromCode(code), role);
  assert.equal(gunRoleFromCode(9), null);
});

test('gun mounts: a role is a choice, never a big change', () => {
  assert.deepEqual(checkCorrectionValue('gun-mount', 'role', 2, 1), { ok: true, value: 1, bigChange: false });
  assert.deepEqual(checkCorrectionValue('gun-mount', 'role', 2, '0'), { ok: true, value: 0, bigChange: false });
  assert.match(checkCorrectionValue('gun-mount', 'role', 2, 2).error, /already say/);
  assert.match(checkCorrectionValue('gun-mount', 'role', 2, 7).error, /choices/);
  assert.match(checkCorrectionValue('gun-mount', 'role', 2, 1.5).error, /choices/);
  assert.match(checkCorrectionValue('gun-mount', 'role', 2, 'crew').error, /choices/);
});

test('gun mounts: values read as words; numbers keep their units', () => {
  assert.equal(formatCorrectionValue('gun-mount', 'role', 1), 'Crew turret the pilot can take over');
  assert.equal(formatCorrectionValue('gun-mount', 'role', null), '—');
  assert.equal(formatCorrectionValue('mining-laser', 'optimalRange', 60), '60m');
  assert.equal(formatCorrectionValue('mining-laser', 'power', 2340), '2,340');
});

test('gun mounts: one per mount position, named after the turret, with the files’ role', () => {
  const mounts = gunMounts(hornet);
  assert.deepEqual(
    mounts.map((m) => [m.group, m.role]),
    [
      ['hardpoint_weapon_right_wing', 'pilot'],
      ['hardpoint_weapon_center', 'takeover'],
      ['hardpoint_weapon_nose', 'pilot'],
      ['hardpoint_weapon_left_wing', 'pilot'],
    ],
  );
  assert.deepEqual(gunMountRecord([hornet], NOSE_KEY), {
    name: 'Anvil F7C-M Super Hornet Mk II · Anvil Hornet Mk II S3 Nose Turret',
    record: { role: GUN_ROLE_CODES.pilot },
  });
  assert.equal(gunMountRecord([hornet], `${hornet.className.toLowerCase()}|nope`), null);
  assert.equal(gunMountRecord([hornet], 'no-bar'), null);
});

test('gun mounts: a live correction changes every gun of that mount, and only those', () => {
  const fixed = applyGunMountCorrections(hornet, correctionIndex([live(GUN_ROLE_CODES.takeover)]));
  const nose = fixed.gunSlots.filter((s) => s.group === 'hardpoint_weapon_nose');
  assert.equal(nose.length, 2);
  assert.ok(nose.every((s) => s.role === 'takeover' && s.roleCorrected === true));
  assert.ok(fixed.gunSlots.filter((s) => s.group !== 'hardpoint_weapon_nose').every((s) => !s.roleCorrected));
  // The original is untouched; nothing to apply gives the same object back.
  assert.ok(hornet.gunSlots.every((s) => !s.roleCorrected));
  assert.equal(applyGunMountCorrections(hornet, new Map()), hornet);
  assert.equal(
    applyGunMountCorrections(hornet, correctionIndex([live(GUN_ROLE_CODES.takeover, { recordKey: 'x|y' })])),
    hornet,
  );
  // A value that isn't a role is ignored.
  assert.equal(applyGunMountCorrections(hornet, correctionIndex([live(9)])), hornet);
});
