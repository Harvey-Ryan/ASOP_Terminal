// Who fires each gun (v1.63.0): shipGunSlots' `role` read from the game
// data's mount list, checked against control ships cut from scunpacked
// (test/fixtures/ships, refreshed by extract-combat-fixtures.mjs), and the
// weapon audit that guards it on every game build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shipGunSlots, mountRole, slotRole, auditShipWeapons, gunFitsSlot, turretSeats } from '../dist/index.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ships');
const ship = (cls) => JSON.parse(readFileSync(join(dir, `combat-${cls.toLowerCase()}.json`), 'utf8'));
const allFixtures = readdirSync(dir)
  .filter((f) => f.startsWith('combat-') && f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const roleCount = (s) => {
  const out = { pilot: 0, takeover: 0, crew: 0, auto: 0 };
  for (const x of shipGunSlots(s)) out[x.role]++;
  return out;
};
const stocked = (s) => shipGunSlots(s).filter((x) => x.stockGunUuid);

// ── Control ships ───────────────────────────────────────────────────────────
// What each control is known to carry in game, and what our reading must say.

test('F7C-M Super Hornet Mk II: wing guns and nose turret are the pilot\u2019s; the ball turret the pilot can take over', () => {
  // Reported missing from the ship page (v1.62.1): the ball turret's 2× S3
  // and the nose turret. The files: the ball turret is remote and pilot
  // slaveable. The nose is a canard turret, remote, not slaveable, and lists
  // no seat; the pilot fires it (confirmed in game, v1.64.1).
  const slots = shipGunSlots(ship('ANVL_Hornet_F7CM_Mk2'));
  const by = (g) => slots.filter((x) => x.group === g);
  const wings = slots.filter((x) => /wing/.test(x.group));
  assert.equal(wings.length, 2);
  assert.ok(wings.every((x) => x.role === 'pilot' && x.maxSize === 4 && !x.turret));
  const ball = by('hardpoint_weapon_center');
  assert.equal(ball.length, 2);
  assert.ok(ball.every((x) => x.role === 'takeover' && x.maxSize === 3 && x.turret && x.stockGunUuid));
  assert.equal(ball[0].groupName, 'Anvil F7C-M Mk II Ball Turret');
  const nose = by('hardpoint_weapon_nose');
  assert.equal(nose.length, 2);
  assert.ok(nose.every((x) => x.role === 'pilot' && x.maxSize === 3 && x.turret && x.stockGunUuid));
  assert.deepEqual(roleCount(ship('ANVL_Hornet_F7CM_Mk2')), { pilot: 4, takeover: 2, crew: 0, auto: 0 });
  // The nose is inferred from the seats (v1.65.1): no turret seat can be its.
  assert.deepEqual([...new Set(nose.map((x) => x.roleSource))], ['inferred']);
  assert.ok(slots.filter((x) => !nose.includes(x)).every((x) => x.roleSource === 'files'));
});

// ── Seatless remote turrets (v1.65.1) ───────────────────────────────────────
// A remote turret the pilot can't take over, with no seat in the mount list:
// in all 30 such turrets where the files do record who fires it, it's the
// pilot. So it's the pilot's unless the ship's seat list has a turret seat
// for it. Each control below was checked against that evidence by hand.

const groupRoles = (cls, match) => [
  ...new Set(
    shipGunSlots(ship(cls))
      .filter((x) => match.test(x.group))
      .map((x) => `${x.group.split('/').pop()}=${x.role}`),
  ),
];

test('seatless remote turrets with no turret seat for them are the pilot\u2019s', () => {
  // Starfarer side cannons: the Freelancer's mounts of the same name, and the
  // same PC2 mount on the Starlancer, are pilot-fired; no seat is theirs.
  for (const cls of ['MISC_Starfarer', 'MISC_Starfarer_Gemini'])
    assert.deepEqual(groupRoles(cls, /sidecannon/), [
      'hardpoint_sidecannon_right=pilot',
      'hardpoint_sidecannon_left=pilot',
    ]);
  // Starlite: the pilot's is the only seat.
  assert.deepEqual(groupRoles('MISC_Starlite', /turret/), ['hardpoint_turret=pilot']);
  // Asgard / Valkyrie: "turret_pilot", and their turret seats are named for other turrets
  // (the Valkyrie's two console seats go to its wing turrets, which always need a gunner).
  assert.deepEqual(groupRoles('ANVL_Asgard', /turret_pilot/), ['hardpoint_turret_pilot=pilot']);
  assert.deepEqual(groupRoles('ANVL_Valkyrie', /turret_pilot/), ['hardpoint_turret_pilot=pilot']);
  assert.deepEqual(groupRoles('ANVL_Valkyrie', /weapon_wing/), [
    'hardpoint_weapon_wing_left=takeover',
    'hardpoint_weapon_wing_right=takeover',
  ]);
  // Paladin: the middle turret has no seat of its own.
  assert.deepEqual(groupRoles('ANVL_Paladin', /remoteturret_middle/), ['hardpoint_remoteturret_middle=pilot']);
  // Super Hornet Mk I: the co-pilot's turret seat works the ball turret, so the nose is the pilot's.
  assert.deepEqual(groupRoles('ANVL_Hornet_F7CM', /gun_nose|gun_center/).sort(), [
    'hardpoint_gun_center=takeover',
    'hardpoint_gun_nose=pilot',
  ]);
});

test('seatless remote turrets with a turret seat for them are crewed', () => {
  // Hercules bridge turret: hardpoint_bridge_remote_turret_seat.
  for (const cls of ['CRUS_Starlifter_A2', 'CRUS_Starlifter_M2'])
    assert.deepEqual(groupRoles(cls, /bridge_remote_turret/), ['hardpoint_bridge_remote_turret=crew']);
  // Paladin side turrets: hardpoint_seat_remoteturret_left / _right.
  assert.deepEqual(groupRoles('ANVL_Paladin', /remoteturret_(left|right)/), [
    'hardpoint_remoteturret_left=crew',
    'hardpoint_remoteturret_right=crew',
  ]);
  // Lynx: the passenger seat is a turret seat named for no turret: the turret's gunner.
  assert.deepEqual(groupRoles('RSI_Lynx', /turret_mount/), ['hardpoint_turret_mount=crew']);
  // Heartseeker Mk I: no ball turret, so its co-pilot's turret seat is the nose's.
  assert.deepEqual(groupRoles('ANVL_Hornet_F7CM_Heartseeker', /gun_nose/), ['hardpoint_gun_nose=crew']);
});

test('turretSeats: own, spare, none and shared', () => {
  const ev = (cls) => Object.fromEntries([...turretSeats(ship(cls))].map(([, v], i) => [i, v]));
  assert.ok(Object.values(ev('CRUS_Starlifter_A2')).includes('own'));
  assert.deepEqual(Object.values(ev('RSI_Lynx')), ['spare']);
  assert.deepEqual(Object.values(ev('MISC_Starlite')), ['none']);
  // Two seatless unslaveable turrets and one spare seat: unclear which it works.
  const shared = turretSeats({
    Seating: { Seats: [{ Role: 'Turret', HardpointName: 'hardpoint_gunner' }] },
    MountingPositions: [
      {
        PortId: 'loadout.0',
        HardpointName: 'hardpoint_a',
        MountType: 'Turret',
        TurretRole: 'Remote',
        IsPilotSlaveable: false,
      },
      {
        PortId: 'loadout.1',
        HardpointName: 'hardpoint_b',
        MountType: 'Turret',
        TurretRole: 'Remote',
        IsPilotSlaveable: false,
      },
    ],
  });
  assert.deepEqual([...shared.values()], ['shared', 'shared']);
  // No seat list: no evidence, and the turret stays crew as before.
  assert.equal(turretSeats({ MountingPositions: [] }).size, 0);
  const seatless = { MountType: 'Turret', TurretRole: 'Remote', IsPilotSlaveable: false };
  assert.equal(mountRole(seatless), 'crew');
  assert.equal(mountRole(seatless, 'none'), 'pilot');
  assert.equal(mountRole(seatless, 'own'), 'crew');
  assert.equal(mountRole(seatless, 'spare'), 'crew');
  assert.equal(mountRole(seatless, 'shared'), 'crew');
  // A recorded seat wins over the inference.
  assert.equal(mountRole({ ...seatless, OperatingStations: [{ Kind: 'Crew' }] }, 'none'), 'crew');
  // Slaveable turrets aren't affected.
  assert.equal(mountRole({ ...seatless, IsPilotSlaveable: true }, 'none'), 'takeover');
});

test('single-seat fighters: every gun is the pilot’s, turrets included', () => {
  // F7A Mk II (nose and belly turrets), F8C (turret), Gladius, Arrow,
  // Wildfire: one seat, so nothing can be crewed.
  for (const cls of [
    'AEGS_Gladius',
    'ANVL_Arrow',
    'ANVL_Hornet_F7A_Mk2',
    'ANVL_Lightning_F8C',
    'ANVL_Hornet_F7C_Wildfire',
  ]) {
    const slots = stocked(ship(cls));
    assert.ok(slots.length > 0, cls);
    assert.deepEqual(
      slots.filter((x) => x.role !== 'pilot').map((x) => x.id),
      [],
      `${cls} has non-pilot guns`,
    );
  }
  assert.deepEqual(roleCount(ship('AEGS_Gladius')), { pilot: 3, takeover: 0, crew: 0, auto: 0 });
  assert.equal(roleCount(ship('ANVL_Hornet_F7A_Mk2')).pilot, 6);
  // The F7A Mk II's turrets are turrets (turret-only gun copies fit) but the pilot fires them.
  assert.ok(shipGunSlots(ship('ANVL_Hornet_F7A_Mk2')).some((x) => x.turret && x.role === 'pilot'));
});

test('Freelancer: the pilot fires the four side cannons; the rear turret is crewed', () => {
  const slots = shipGunSlots(ship('MISC_Freelancer'));
  const side = slots.filter((x) => /sidecannon/.test(x.group));
  assert.equal(side.length, 4);
  assert.ok(side.every((x) => x.role === 'pilot'));
  assert.ok(slots.filter((x) => /rear_turret/.test(x.group)).every((x) => x.role === 'crew'));
});

test('point defence and door guns are never the pilot’s', () => {
  // Before v1.63.0 these were counted as pilot guns (no "turret" in their
  // names): Perseus 6, 890 Jump 7, Idris-P 11 PDCs; Cutlass Steel's door guns.
  for (const cls of ['RSI_Perseus', 'ORIG_890Jump', 'AEGS_Idris_P']) {
    const pdc = shipGunSlots(ship(cls)).filter((x) => /pdc/i.test(x.id));
    assert.ok(pdc.length >= 6, cls);
    assert.ok(
      pdc.every((x) => x.role === 'auto'),
      cls,
    );
    // No stock pilot guns (the Idris-P's nose railgun port is empty).
    assert.equal(stocked(ship(cls)).filter((x) => x.role === 'pilot').length, 0, `${cls} pilot guns`);
  }
  const steel = shipGunSlots(ship('DRAK_Cutlass_Steel'));
  assert.equal(steel.filter((x) => x.role === 'pilot').length, 4);
  assert.ok(steel.filter((x) => /mountedgun/.test(x.group)).every((x) => x.role === 'auto'));
});

test('crewed ships: the Hammerhead’s pilot has no guns; the Cutlass Black’s turret is crewed', () => {
  assert.deepEqual(roleCount(ship('AEGS_Hammerhead_GS')), { pilot: 0, takeover: 0, crew: 24, auto: 0 });
  assert.deepEqual(roleCount(ship('DRAK_Cutlass_Black')), { pilot: 4, takeover: 0, crew: 2, auto: 0 });
  assert.deepEqual(roleCount(ship('AEGS_Vanguard')), { pilot: 5, takeover: 0, crew: 2, auto: 0 });
  const tac = roleCount(ship('MISC_Starlancer_TAC'));
  assert.equal(tac.pilot, 4); // the wing gun pods, fired from the pilot seat
  assert.equal(tac.takeover, 4);
});

test('ports with no mount record fall back to the name rule and say so', () => {
  // Kruger P-72: its centre gun has no mount record (a pilot gun by its name).
  const p72 = shipGunSlots(ship('KRIG_P72_Archimedes'));
  const guessed = p72.filter((x) => x.roleSource === 'guess');
  assert.equal(guessed.length, 1);
  assert.equal(guessed[0].role, 'pilot');
  assert.equal(p72.filter((x) => x.role === 'pilot').length, 5);
  // The Mustang's rocket pods: no mount record, pilot weapons.
  assert.ok(shipGunSlots(ship('CNOU_Mustang_Beta')).every((x) => x.role === 'pilot'));
});

test('every control slot has a role, a group and a port id', () => {
  for (const s of allFixtures)
    for (const x of shipGunSlots(s)) {
      assert.ok(['pilot', 'takeover', 'crew', 'auto'].includes(x.role), `${s.ClassName} ${x.id}`);
      assert.ok(x.group && x.port, `${s.ClassName} ${x.id}`);
      assert.equal(slotRole(x), x.role);
    }
});

// ── The rule ────────────────────────────────────────────────────────────────

test('mountRole: the order of the rules', () => {
  const pilotSeat = [{ Kind: 'Pilot' }];
  assert.equal(
    mountRole({ MountType: 'Turret', TurretRole: 'Remote', IsPilotSlaveable: false, OperatingStations: pilotSeat }),
    'pilot',
  );
  assert.equal(mountRole({ MountType: 'Turret', TurretRole: 'Pdc', IsPilotSlaveable: false }), 'auto');
  assert.equal(mountRole({ MountType: 'Turret', TurretRole: 'Autonomous', IsPilotSlaveable: false }), 'auto');
  assert.equal(mountRole({ MountType: 'Turret', TurretRole: 'Autonomous', IsPilotSlaveable: true }), 'takeover');
  assert.equal(mountRole({ MountType: 'Turret', TurretRole: 'Remote', IsPilotSlaveable: true }), 'takeover');
  assert.equal(mountRole({ MountType: 'Turret', TurretRole: 'Remote', IsPilotSlaveable: false }), 'crew');
  assert.equal(
    mountRole({ MountType: 'Turret', TurretRole: 'Manned', OperatingStations: [{ Kind: 'InTurret' }] }),
    'crew',
  );
  assert.equal(mountRole({ MountType: 'Gimbal' }), 'pilot');
  assert.equal(mountRole({ MountType: 'Fixed', OperatingStations: pilotSeat }), 'pilot');
  assert.equal(mountRole({ MountType: 'Gimbal', OperatingStations: [{ Kind: 'Crew' }] }), 'crew');
  assert.equal(mountRole({ IsPilotSlaveable: true }), 'takeover');
  assert.equal(mountRole({}), null);
});

test('data from before v1.63.0 (no role) reads as before', () => {
  assert.equal(slotRole({ turret: true }), 'crew');
  assert.equal(slotRole({ turret: false }), 'pilot');
});

test('turret-only gun copies fit every turret mount, pilot-fired ones included', () => {
  const f7a = shipGunSlots(ship('ANVL_Hornet_F7A_Mk2')).find((x) => x.turret);
  const gun = { uuid: 'x', size: f7a.maxSize, className: 'KLWE_LaserRepeater_S3_Turret', tags: [], requiredTags: [] };
  assert.equal(gunFitsSlot(gun, f7a), true);
  const wing = shipGunSlots(ship('AEGS_Gladius'))[0];
  assert.equal(gunFitsSlot({ ...gun, size: wing.maxSize }, wing), false);
});

// ── The audit ───────────────────────────────────────────────────────────────

const problemsOf = (s) => auditShipWeapons(s).issues.filter((i) => i.severity === 'problem');

test('audit: every control ship agrees with the files', () => {
  for (const s of allFixtures) assert.deepEqual(problemsOf(s), [], s.ClassName);
});

test('audit: weak inferences are listed to confirm, not as problems', () => {
  const unsure = (cls) => auditShipWeapons(ship(cls)).issues.map((i) => [i.kind, i.severity, i.where]);
  // Reliant Kore: inferred pilot, but its (empty) right-hand twin is one the pilot can take over.
  assert.deepEqual(unsure('MISC_Reliant'), [['inferred-unsure', 'check', 'Hardpoint_Weapon_Wing_Tip_S3_Left']]);
  // Heartseeker Mk I and Lynx: crewed only because of a spare turret seat.
  assert.deepEqual(unsure('ANVL_Hornet_F7CM_Heartseeker'), [['inferred-unsure', 'check', 'hardpoint_gun_nose']]);
  assert.deepEqual(unsure('RSI_Lynx'), [['inferred-unsure', 'check', 'hardpoint_turret_mount']]);
  // Strong inferences aren't listed.
  for (const cls of ['CRUS_Starlifter_A2', 'MISC_Starfarer', 'ANVL_Paladin', 'ANVL_Hornet_F7CM_Mk2'])
    assert.deepEqual(unsure(cls), [], cls);
});
test('audit: a gun the files list but we can’t find is reported', () => {
  const s = structuredClone(ship('ANVL_Hornet_F7CM_Mk2'));
  // Lose the nose turret from the loadout (keep its place so indices hold).
  const i = s.Loadout.findIndex((p) => p.HardpointName === 'hardpoint_weapon_nose');
  s.Loadout[i] = { HardpointName: 'hardpoint_weapon_nose' };
  const issues = problemsOf(s);
  assert.equal(issues.filter((x) => x.kind === 'missing-weapon').length, 2);
  assert.ok(issues.every((x) => x.where === 'hardpoint_weapon_nose'));
});

test('audit: a turret gun without a mount record is reported as guessed', () => {
  const s = structuredClone(ship('ANVL_Hornet_F7CM_Mk2'));
  s.MountingPositions = s.MountingPositions.filter((m) => m.HardpointName !== 'hardpoint_weapon_center');
  const issues = problemsOf(s);
  assert.equal(issues.filter((x) => x.kind === 'guessed-turret').length, 2);
  // And the guess is the old one: crew, never counted.
  assert.ok(
    shipGunSlots(s)
      .filter((x) => x.group.startsWith('hardpoint_weapon_center'))
      .every((x) => x.role === 'crew'),
  );
});

test('audit: an unexplained disagreement with the files’ pilot rule is reported', () => {
  const s = structuredClone(ship('DRAK_Cutlass_Black'));
  const m = s.MountingPositions.find((x) => x.HardpointName === 'hardpoint_turret');
  // A manned turret the files would count as the pilot's (not marked unslaveable).
  delete m.IsPilotSlaveable;
  const issues = problemsOf(s);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'role-differs');
  assert.match(issues[0].detail, /crew turret/i);
});

test('audit: the deliberate differences aren’t reported', () => {
  // F8C: a pilot seat fires a turret marked not slaveable. Perseus: point defence.
  assert.deepEqual(auditShipWeapons(ship('ANVL_Lightning_F8C')).issues, []);
  assert.deepEqual(problemsOf(ship('RSI_Perseus')), []);
});

// ── Every ship (optional) ───────────────────────────────────────────────────
// SCUNPACKED_SHIPS=/path/to/ships.json runs the audit over the whole game build.

test('audit: every ship in SCUNPACKED_SHIPS', { skip: !process.env.SCUNPACKED_SHIPS }, () => {
  const all = JSON.parse(readFileSync(process.env.SCUNPACKED_SHIPS, 'utf8'));
  const bad = all
    .map(auditShipWeapons)
    .map((a) => ({ ...a, issues: a.issues.filter((i) => i.severity === 'problem') }))
    .filter((a) => a.issues.length)
    .map((a) => `${a.name}: ${a.issues.map((i) => `${i.kind} ${i.where}`).join(', ')}`);
  assert.deepEqual(bad, []);
});
