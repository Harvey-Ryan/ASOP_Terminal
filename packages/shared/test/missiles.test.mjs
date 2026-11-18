import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  missileFromItem, shipMissileRacks, missileFitsRack, dedupeMissiles, combatGunFromItem, combatShipFromRow, gunFitsSlot, gunFamily,
} from '../dist/index.js';

// Numbers from scunpacked 4.10.3-LIVE (the M80, checked against Erkul).
const missile = (uuid, name, size, damage, signal = 'Electromagnetic', extra = {}) => missileFromItem({
  uuid, class_name: name, name: `${name} Missile`, manufacturer_name: 'FireStorm Kinetics', size,
  data: { stdItem: { Missile: { DamageTotal: damage, Damage: { Physical: damage }, ArmTime: 1.5, GCS: { LinearSpeed: 857.5 },
    Targeting: { LockTime: 1, LockingAngle: 60, LockRangeMin: 1900, LockRangeMax: 25000, TrackingSignalType: signal }, ...extra } } },
});

test('reads a missile: damage, seeker, lock and speed', () => {
  const m = missile('tb3', 'Thunderbolt III', 3, 2900);
  assert.equal(m.name, 'Thunderbolt III');
  assert.equal(m.seeker, 'EM');
  assert.equal(m.damageType, 'Physical');
  assert.equal(m.lockTime, 1);
  assert.equal(m.lockRangeMax, 25000);
  assert.equal(missile('v3', 'Viper III', 3, 2650, 'Infrared').seeker, 'IR');
  assert.equal(missile('x', 'PLACEHOLDER', 3, 100), null);
  assert.equal(missile('y', 'Dud', 3, 0), null);
});

test('racks come from the loadout; missiles fit by the rack\'s missile size', () => {
  const ship = { Loadout: [
    { HardpointName: 'hardpoint_missile_rack_right', Type: 'MissileLauncher.MissileRack', Name: 'MSD-423 Missile Rack', MaxSize: 4, Loadout: [
      { HardpointName: 'missile_01_attach', Type: 'Missile.Missile', UUID: 'tb3', MaxSize: 3 },
      { HardpointName: 'missile_02_attach', Type: 'Missile.Missile', UUID: 'tb3', MaxSize: 3 },
    ] },
    { HardpointName: 'hardpoint_missile_rack_small_right', Type: 'MissileLauncher.MissileRack', Name: 'MSD-481 Missile Rack', MaxSize: 4,
      Loadout: Array.from({ length: 8 }, (_, i) => ({ HardpointName: `missile_0${i + 1}_attach`, Type: 'Missile.Missile', UUID: 'p1', MaxSize: 1 })) },
  ] };
  const racks = shipMissileRacks(ship);
  assert.deepEqual(racks.map((r) => [r.name, r.missileSize, r.count, r.stockMissileUuid]), [['MSD-423 Missile Rack', 3, 2, 'tb3'], ['MSD-481 Missile Rack', 1, 8, 'p1']]);
  assert.equal(missileFitsRack(missile('v3', 'Viper III', 3, 2650), racks[0]), true);
  assert.equal(missileFitsRack(missile('p1x', 'Pioneer I', 1, 750), racks[0]), false);
  // 4 × 2,900 + 16 × 750 = Erkul's 23,600 for the M80 (two of each rack).
  assert.equal(2 * 2 * 2900 + 2 * 8 * 750, 23600);
});

test('identical missile copies are one choice', () => {
  const list = dedupeMissiles([missile('a', 'Thunderbolt III', 3, 2900), missile('b', 'Thunderbolt III', 3, 2900), missile('c', 'Viper III', 3, 2650, 'Infrared')]);
  assert.equal(list.length, 2);
  assert.equal(list[0].variants, 1);
});

test('gun extras: family, penetration, spread, power, EM, ammo, HP', () => {
  const g = combatGunFromItem({ uuid: 'ad4b', class_name: 'BEHR_BallisticGatling_S4', name: 'AD4B Ballistic Gatling', size: 4, data: { stdItem: {
    DescriptionData: { 'Item Type': 'Ballistic Gatling' },
    Weapon: { Damage: { Burst: 1266, Sustained: 1082, AlphaTotal: 84, Alpha: { Physical: 84 } }, Modes: [{ Spread: { Maximum: 0.756 } }] },
    Ammunition: { Speed: 1296, Capacity: 5220, Penetration: { BasePenetrationDistance: 0.96 } },
    ResourceNetwork: { Usage: { Power: { Maximum: 0.1 } } }, Emission: { Em: { Maximum: 36 } }, Durability: { Health: 1650 },
  } } });
  assert.deepEqual([g.family, g.pen, g.spread, g.powerDraw, g.em, g.ammo, g.hp], ['Gatling', 0.96, 0.756, 0.1, 36, 5220, 1650]);
  assert.equal(gunFamily('Distortion Scattergun'), 'Scattergun');
  assert.equal(gunFamily('Laser Repeater'), 'Repeater');
});

test('turret-only copies are not pilot guns (the second Attrition-4)', () => {
  const gun = (cls) => combatGunFromItem({ uuid: cls, class_name: cls, name: 'Attrition-4 Repeater', size: 4, data: { stdItem: { Weapon: { Damage: { Burst: 875, Sustained: 604, AlphaTotal: 150, Alpha: { Energy: 150 } } } } } });
  const slot = { id: 'x', label: 'Rear right', minSize: 4, maxSize: 4, turret: false, mount: null, stockGunUuid: null, requiredTags: [], offeredTags: [] };
  assert.equal(gunFitsSlot(gun('HRST_LaserRepeater_S4_Turret'), slot), false);
  assert.equal(gunFitsSlot(gun('HRST_LaserRepeater_S4_Turret'), { ...slot, turret: true }), true);
  assert.equal(gunFitsSlot(gun('HRST_LaserRepeater_S4'), slot), true);
});

test('ship panels: flight, hull parts, armour, distortion', () => {
  const s = combatShipFromRow({ uuid: 'm80', class_name: 'ORIG_m80', name: 'Origin M80', data: {
    ShieldsTotal: { Hp: 20000, Resistance: { Distortion: { Maximum: 0.95 } }, Absorption: { Distortion: { Maximum: 1 } } },
    Armor: { Health: 7200, DamageMultipliers: { Physical: 0.75, Energy: 0.6 }, Deflection: { Physical: 41, Energy: 32 } },
    DamageBeforeDestruction: [{ Name: 'body', HP: 5000 }],
    Parts: { Name: 'orig_m80', DamageMax: 0, Children: [{ Name: 'body', DamageMax: 5000, Children: [{ Name: 'nose', DamageMax: 1000 }, { Name: 'wings_top_left', DamageMax: 11000 }] }] },
    FlightCharacteristics: { IFCS: { Pitch: 38, Yaw: 30, Roll: 150 }, Speeds: { Scm: 225, Max: 1400, BoostForward: 560, BoostBackward: 250 }, Timing: { ZeroToScm: 1.46, ZeroToMax: 9.06 } },
    Propulsion: { FuelCapacity: 7200 },
  } });
  assert.deepEqual(s.hull, { parts: 3, total: 17000 });
  assert.equal(s.armourHp, 7200);
  assert.deepEqual(s.distortion, { resistance: 0.95, absorption: 1 });
  assert.equal(s.flight.boostForward, 560);
  assert.equal(s.flight.hydrogen, 7.2);
  assert.equal(s.flight.pitch, 38);
});
