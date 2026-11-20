import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  combatGunFromItem,
  combatShipFromRow,
  shipGunSlots,
  dedupeGuns,
  killTime,
  killVerdict,
  formatKillTime,
  bestGunFits,
  describeGuns,
  humanHardpoint,
  gunFitsSlot,
  isUnavailableGun,
} from '../dist/index.js';

// Numbers from scunpacked 4.10.3-LIVE.
const gun = (name, type, burst, sustained, alpha, pellets = 1, size = 3, uuid = name) =>
  combatGunFromItem({
    uuid,
    class_name: name.replace(/\W/g, '_'),
    name,
    manufacturer_name: 'Maker',
    size,
    grade: 1,
    data: {
      stdItem: {
        Weapon: {
          RateOfFire: 100,
          Modes: [{ PelletsPerShot: pellets }],
          Damage: {
            Burst: burst,
            Sustained: sustained,
            AlphaTotal: alpha,
            Alpha: { Physical: type === 'P' ? alpha : 0, Energy: type === 'E' ? alpha : 0, Distortion: 0 },
          },
        },
      },
    },
  });
const panther = gun('CF-337 Panther Repeater', 'E', 545.6, 278.9, 43.65);
const mantis = gun('Mantis GT-220 Gatling', 'P', 853.3, 629.1, 32);
const predator = gun('Predator Scattergun', 'P', 840, 840, 840, 8);
const sledge = gun('Sledge III Mass Driver', 'P', 450, 450, 1125);
const revenant = gun('Revenant Gatling', 'P', 1266, 874.9, 63.3);
const m5a = gun('M5A Cannon', 'E', 683.6, 415.8, 410.2);

const ship = (name, shield, mult, defl, hull) =>
  combatShipFromRow({
    uuid: name,
    name,
    data: {
      ShieldsTotal: {
        Hp: shield,
        Regen: 100,
        Absorption: { Physical: { Maximum: 0.45 }, Energy: { Maximum: 1 } },
        Resistance: { Physical: { Maximum: 0.25 }, Energy: { Maximum: 0 } },
      },
      Armor: {
        DamageMultipliers: { Physical: mult[0], Energy: mult[1] },
        Deflection: { Physical: defl[0], Energy: defl[1] },
      },
      DamageBeforeDestruction: [
        { Name: 'tail', HP: 100 },
        { Name: 'Body', HP: hull },
      ],
      Health: hull * 3,
    },
  });
const cutlass = ship('Cutlass Black', 7200, [0.75, 0.6], [32, 29], 6500);
const warden = ship('Vanguard Warden', 21120, [0.75, 0.6], [50, 40], 10000);
const carrack = ship('Carrack', 144000, [0.75, 0.6], [420, 240], 70000);
const arrow = ship('Arrow', 3168, [0.75, 0.6], [12, 6], 2050);

test('guns read from scdata items', () => {
  assert.equal(predator.kind, 'Ballistic');
  assert.equal(predator.pellets, 8);
  assert.equal(panther.kind, 'Energy');
  assert.equal(combatGunFromItem({ uuid: 'x', name: '<= PLACEHOLDER =>', data: {} }), null);
});

test('the main body is the hull that counts', () => {
  assert.equal(cutlass.hullHp, 6500);
  assert.equal(cutlass.deflection.physical, 32);
});

test('stock Gladius vs a Cutlass: the Mantis is stopped by its armour', () => {
  const r = killTime([mantis, panther, panther], cutlass, 'burst');
  assert.equal(r.seconds.toFixed(1), '15.1');
  assert.deepEqual(r.stopped, ['Mantis GT-220 Gatling']);
  assert.equal(killVerdict(r), 'workable');
});

test('ballistic pellets kill through shields before they drop', () => {
  const r = killTime([predator, predator, predator], warden, 'burst');
  assert.equal(r.seconds.toFixed(1), '9.6');
  assert.ok(r.shieldSeconds > r.seconds);
});

test('guns too weak for the armour never kill it', () => {
  const r = killTime([mantis, panther, panther], carrack, 'burst');
  assert.equal(r.seconds, Infinity);
  assert.ok(isFinite(r.shieldSeconds));
  assert.equal(killVerdict(r), 'no-hull');
  assert.equal(formatKillTime(r.seconds), 'never');
});

test('best fit against a target', () => {
  const cands = [panther, mantis, predator, sledge, revenant, m5a];
  const slots = [0, 1, 2].map((i) => ({ id: String(i), candidates: cands }));
  const [best, second] = bestGunFits(slots, 'target', warden);
  assert.equal(describeGuns(best.guns), '3× Predator Scattergun');
  assert.ok(best.vsTarget.burst.seconds <= second.vsTarget.burst.seconds);
  const [vsArrow] = bestGunFits(slots, 'target', arrow);
  assert.equal(describeGuns(vsArrow.guns), '3× Revenant Gatling');
  const [vsCarrack] = bestGunFits(slots, 'target', carrack);
  assert.equal(describeGuns(vsCarrack.guns), '3× Sledge III Mass Driver');
});

test('locked slots stay, additive goals pick the top gun', () => {
  const cands = [panther, mantis, sledge];
  const slots = [
    { id: 'nose', candidates: cands, locked: mantis },
    { id: 'l', candidates: cands },
    { id: 'r', candidates: cands },
  ];
  const [best] = bestGunFits(slots, 'alpha', null);
  assert.equal(best.guns[0].name, 'Mantis GT-220 Gatling');
  assert.equal(describeGuns(best.guns.slice(1)), '2× Sledge III Mass Driver');
});

test('skins with the same numbers are grouped', () => {
  const a = gun('Panther', 'E', 545.6, 278.9, 43.65, 1, 3, 'a');
  const b = gun('Panther Hazard-Zone', 'E', 545.6, 278.9, 43.65, 1, 3, 'b');
  const out = dedupeGuns([b, a, mantis]);
  assert.equal(out.length, 2);
  assert.equal(out.find((g) => g.name.startsWith('Panther')).variants, 1);
});

test('gun slots: gimbals are pilot guns, manned turrets are not', () => {
  const slots = shipGunSlots({
    Loadout: [
      {
        HardpointName: 'hardpoint_turret',
        Type: 'TurretBase.MannedTurret',
        Name: 'Manned Turret',
        CompatibleTypes: [{ Type: 'TurretBase' }],
        Loadout: [
          {
            HardpointName: 'hardpoint_weapon_left',
            Type: 'Turret.GunTurret',
            Name: 'VariPuck S3 Gimbal Mount',
            CompatibleTypes: [{ Type: 'WeaponGun' }, { Type: 'Turret' }],
            Loadout: [
              {
                HardpointName: 'hardpoint_class_2',
                Type: 'WeaponGun.Gun',
                UUID: 'p',
                MaxSize: 3,
                MinSize: 3,
                CompatibleTypes: [{ Type: 'WeaponGun' }],
              },
            ],
          },
        ],
      },
      {
        HardpointName: 'hardpoint_Left_Wing_Weapon',
        Type: 'Turret.GunTurret',
        Name: 'VariPuck S3 Gimbal Mount',
        CompatibleTypes: [{ Type: 'Turret' }, { Type: 'WeaponGun' }],
        MaxSize: 3,
        Loadout: [
          {
            HardpointName: 'hardpoint_class_2',
            Type: 'WeaponGun.Gun',
            UUID: 'm',
            MaxSize: 3,
            MinSize: 3,
            CompatibleTypes: [{ Type: 'WeaponGun' }],
          },
        ],
      },
    ],
  });
  assert.equal(slots.length, 2);
  assert.equal(slots[0].turret, true);
  assert.equal(slots[1].turret, false);
  assert.equal(slots[1].label, 'Left wing');
  assert.equal(slots[1].stockGunUuid, 'm');
  assert.equal(slots[1].mount, 'VariPuck S3 Gimbal Mount');
});

test('hardpoint names read as places on the ship', () => {
  assert.equal(humanHardpoint('hardpoint_weapon_gun_class1_left_wing'), 'Left wing');
  assert.equal(humanHardpoint('hardpoint_gun_nose'), 'Nose');
  assert.equal(humanHardpoint('hardpoint_class_2'), 'Gun');
});

test('bespoke guns fit only their own ships, and locked ports take only them', () => {
  const bespoke = combatGunFromItem({
    uuid: 'l22',
    name: 'Axiom L-22 Repeater',
    size: 4,
    data: {
      tags: 'LaserRepeater flightReady Wolf_Gun',
      stdItem: {
        RequiredTags: ['Wolf_Gun'],
        Weapon: { Damage: { Burst: 1000, Sustained: 700, AlphaTotal: 100, Alpha: { Energy: 100 } } },
      },
    },
  });
  const generic = combatGunFromItem({
    uuid: 'g4',
    name: 'Generic S4',
    size: 4,
    data: {
      tags: 'LaserRepeater flightReady',
      stdItem: { Weapon: { Damage: { Burst: 900, Sustained: 600, AlphaTotal: 90, Alpha: { Energy: 90 } } } },
    },
  });
  const [wolf] = shipGunSlots({
    PortTags: ['KRIG_Wolf'],
    Loadout: [
      {
        HardpointName: 'hardpoint_weapon_left',
        Type: 'Turret.GunTurret',
        Name: 'VariPuck S4 Gimbal Mount',
        PortTags: ['Wolf_Gun'],
        RequiredTags: ['Wolf_Gun'],
        CompatibleTypes: [{ Type: 'Turret' }, { Type: 'WeaponGun' }],
        Loadout: [
          {
            HardpointName: 'hardpoint_class_2',
            Type: 'WeaponGun.Gun',
            UUID: 'l21',
            MaxSize: 4,
            MinSize: 4,
            RequiredTags: ['Wolf_Gun'],
            CompatibleTypes: [{ Type: 'WeaponGun' }],
          },
        ],
      },
    ],
  });
  const [other] = shipGunSlots({
    Loadout: [
      {
        HardpointName: 'hardpoint_gun_nose',
        Type: 'WeaponGun.Gun',
        UUID: 'x',
        MaxSize: 4,
        MinSize: 4,
        CompatibleTypes: [{ Type: 'WeaponGun' }],
      },
    ],
  });
  assert.equal(gunFitsSlot(bespoke, wolf), true);
  assert.equal(gunFitsSlot(generic, wolf), false);
  assert.equal(gunFitsSlot(bespoke, other), false);
  assert.equal(gunFitsSlot(generic, other), true);
});

test('M80 cross-check: labels, distortion guns and the untagged Slayer', () => {
  assert.equal(humanHardpoint('hardpoint_weapon_frontright'), 'Front right');
  assert.equal(humanHardpoint('hardpoint_weapon_rearleft'), 'Rear left');
  const absolution = combatGunFromItem({
    uuid: 'a',
    name: 'Absolution Distortion Scattergun',
    size: 5,
    data: {
      stdItem: {
        Weapon: {
          Damage: {
            Burst: 600,
            Sustained: 500,
            AlphaTotal: 720,
            Alpha: { Distortion: 720, Energy: 0.001 },
          },
        },
      },
    },
  });
  assert.equal(absolution.kind, 'Distortion');
  const slayerCopy = combatGunFromItem({
    uuid: 's1',
    name: 'Slayer Cannon',
    size: 5,
    data: {
      tags: 'flightReady weaponMountUsable',
      stdItem: { Weapon: { Damage: { Burst: 6400, Sustained: 5, AlphaTotal: 32000, Alpha: { Physical: 32000 } } } },
    },
  });
  const slayerNova = combatGunFromItem({
    uuid: 's2',
    name: 'Slayer Cannon',
    size: 5,
    data: {
      tags: 'HRST $TMBL_Nova',
      stdItem: {
        RequiredTags: ['TMBL_Nova'],
        Weapon: { Damage: { Burst: 6400, Sustained: 5, AlphaTotal: 32000, Alpha: { Physical: 32000 } } },
      },
    },
  });
  assert.equal(isUnavailableGun(slayerCopy), true);
  assert.equal(isUnavailableGun(slayerNova), false);
});
