import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOreSpots, laserFitsHead, matchSignature, miningHeadTotals, miningLaserFromItem, miningModuleFromItem, oreName, shipMiningHeads } from '../dist/index.js';

// Numbers from scunpacked 4.10.3-LIVE (Wala, a Laranite rock and a Tungsten rock).
const locations = [{ provider_name: 'HPP_Stanton3b', data: {
  Locations: [{ Name: 'Wala', Type: 'Moon', System: 'Stanton' }],
  Groups: [{ GroupName: 'SpaceShip_Mineables', Deposits: [
    { ResourceUUID: 'lar', RelativeProbability: 0.285, Clustering: { MinSize: 3, MaxSize: 5 }, ResourceQualities: [
      { ResourceKey: 'Raw_Laranite', MinPercentage: 28.3, MaxPercentage: 78.3, QualityRange: { Min: 245, Max: 490 } },
      { ResourceKey: 'Raw_Laranite', MinPercentage: 5.7, MaxPercentage: 11.7, QualityRange: { Min: 501, Max: 1000 } },
      { ResourceKey: 'Ore_Tungsten', MinPercentage: 5, MaxPercentage: 10, QualityRange: { Min: 395, Max: 789 } },
    ] },
    { ResourceUUID: 'tun', RelativeProbability: 0.715, ResourceQualities: [
      { ResourceKey: 'Ore_Tungsten', MinPercentage: 24.3, MaxPercentage: 74.3, QualityRange: { Min: 245, Max: 490 } },
      { ResourceKey: 'Raw_Laranite', MinPercentage: 5, MaxPercentage: 10, QualityRange: { Min: 395, Max: 789 } },
    ] },
  ] }],
} }];
const resources = [
  { data: { UUID: 'lar', Signature: 3825, Composition: { DepositName: 'Laranite (Raw)' } } },
  { data: { UUID: 'tun', Signature: 3870, Composition: { DepositName: 'Tungsten (Ore)' } } },
];

test('ore finder: only rocks where the ore is the main ore, both quality bands, best first', () => {
  const { spots, signatures } = buildOreSpots(locations, resources);
  const lar = spots.filter((s) => s.ore === 'laranite');
  assert.equal(lar.length, 1, 'Laranite in the Tungsten rock is a side ore and left out');
  assert.equal(lar[0].place, 'Wala');
  assert.equal(lar[0].rock, 'Laranite (Raw)');
  assert.equal(lar[0].chance, 0.285);
  assert.deepEqual(lar[0].bands, [{ minPct: 5.7, maxPct: 11.7, minQ: 501, maxQ: 1000 }, { minPct: 28.3, maxPct: 78.3, minQ: 245, maxQ: 490 }]);
  assert.deepEqual([lar[0].clusterMin, lar[0].clusterMax, lar[0].signature], [3, 5, 3825]);
  assert.equal(signatures.length, 2);
});

test('scanner: a signature is one rock type times the cluster size', () => {
  const { signatures } = buildOreSpots(locations, resources);
  assert.deepEqual(matchSignature(7650, signatures).map((h) => [h.count, h.rock]), [[2, 'Laranite (Raw)']]);
  assert.deepEqual(matchSignature(3870, signatures).map((h) => [h.count, h.rock]), [[1, 'Tungsten (Ore)']]);
  assert.deepEqual(matchSignature(1234, signatures), []);
  assert.equal(oreName('pressurized ice'), 'Pressurized Ice');
});

test('lasers and modules: test and template copies are left out', () => {
  const laser = (cls, power) => miningLaserFromItem({ uuid: cls, class_name: cls, name: 'Arbor MH1 Mining Laser', size: 1,
    data: { stdItem: { MiningLaser: { PowerTransfer: power, ExtractionThroughput: 1850, ModuleSlots: 1, Modifiers: { Resistance: 25, Instability: -35, InertMaterials: 0 } } } } });
  assert.equal(laser('Mining_Laser_GRIN_Arbor_S1', 2340).power, 2340);
  assert.deepEqual(laser('Mining_Laser_GRIN_Arbor_S1', 2340).modifiers, { Resistance: 25, Instability: -35 });
  assert.equal(laser('Mining_Laser_S1_Template', 1890), null);
  assert.equal(laser('Mining_Laser_GRIN_Arbor_S1_Test_Active_1', 2340), null);
  assert.equal(laser('Mining_Laser_MPUV_Arm', 1850), null);
  const mod = (cls, m) => miningModuleFromItem({ uuid: cls, class_name: cls, name: 'Brandt Module', data: { stdItem: { MiningModule: m } } });
  const brandt = mod('Mining_Modules_Active_Brandt', { Type: 'Active', Charges: 5, Lifetime: 60, Modifiers: { Resistance: 15.5, ShatterDamage: -30, DamageMultiplier: 1.35, DamageMultiplierChange: 0.35 } });
  assert.deepEqual([brandt.kind, brandt.charges, brandt.lifetime, brandt.power, brandt.modifiers], ['Active', 5, 60, 1.35, { Resistance: 15.5, ShatterDamage: -30 }]);
  assert.equal(mod('Mining_Modules', { Type: 'Passive' }), null);
  assert.equal(mod('Mining_Modules_VehicleMod_ROCds', { Type: 'Passive' }), null);
});

// ── Mining heads (v1.50.0), shaped like the 4.10.3 Mole, Prospector and Golem ──

const laserPort = (uuid, size, extra = {}) => ({ HardpointName: 'hardpoint_weapon_mining', Type: 'WeaponMining.Gun', UUID: uuid, MaxSize: size, MinSize: size, Editable: true, CompatibleTypes: [{ Type: 'WeaponMining' }], ...extra });
const mole = { Loadout: ['front', 'right', 'left'].map((w) => ({ HardpointName: `hardpoint_mining_cab_${w}`, Type: 'UtilityTurret.MannedTurret', Editable: false, Loadout: [laserPort('mh2', 2)] })) };
const prospector = { Loadout: [{ HardpointName: 'hardpoint_mining_arm', Type: 'ToolArm', Editable: false, Loadout: [
  { HardpointName: 'hardpoint_mining_laser', Type: 'UtilityTurret.GunTurret', Editable: true, CompatibleTypes: [{ Type: 'WeaponMining' }], Loadout: [laserPort('mh1', 1)] },
] }] };
const golem = { Loadout: [{ HardpointName: 'hardpoint_mining_arm', Type: 'ToolArm', Editable: false, Loadout: [
  { HardpointName: 'hardpoint_mining_laser', Type: 'UtilityTurret.GunTurret', Editable: false, CompatibleTypes: [{ Type: 'WeaponMining' }], Loadout: [laserPort('pitman', 1)] },
] }] };
const roc = { Loadout: [{ HardpointName: 'hardpoint_mining_arm', Type: 'UtilityTurret.BallTurret', Loadout: [laserPort('mhv', 0)] }] };

test('finds every mining head: crew turrets, the pilot arm, fixed lasers', () => {
  const m = shipMiningHeads(mole);
  assert.deepEqual(m.map((h) => [h.label, h.size, h.crewed, h.locked, h.stockLaserUuid]), [
    ['Front turret', 2, true, false, 'mh2'], ['Right turret', 2, true, false, 'mh2'], ['Left turret', 2, true, false, 'mh2'],
  ]);
  const p = shipMiningHeads(prospector);
  assert.deepEqual(p.map((h) => [h.label, h.size, h.crewed, h.locked]), [['Mining arm', 1, false, false]]);
  // The Golem's arm can't change, so its laser is fixed; size 0 (ROC, hand) isn't a ship head.
  assert.equal(shipMiningHeads(golem)[0].locked, true);
  assert.deepEqual(shipMiningHeads(roc), []);
});

const laserRow = (uuid, size, extra = {}, tags = ['miningMount']) => ({ uuid, class_name: `Mining_Laser_${uuid}`, name: uuid, manufacturer_name: 'Maker', size,
  data: { stdItem: { RequiredTags: tags, MiningLaser: { PowerTransfer: 2900, MinPowerTransfer: 145, ExtractionThroughput: 2590, ModuleSlots: 2, Modifiers: { Resistance: 25, Instability: 35 }, ...extra } } } });

test('lasers fit a head of their size, never one made for another ship', () => {
  const [head] = shipMiningHeads(mole);
  const mh2 = miningLaserFromItem(laserRow('mh2', 2));
  const helix = miningLaserFromItem(laserRow('helix', 2));
  const small = miningLaserFromItem(laserRow('small', 1));
  const pitman = miningLaserFromItem(laserRow('pitman', 2, {}, ['DRAK_Golem', 'miningMount']));
  assert.equal(pitman.bespokeFor, 'DRAK_Golem');
  assert.equal(mh2.bespokeFor, null);
  assert.equal(laserFitsHead(helix, head), true);
  assert.equal(laserFitsHead(small, head), false);
  assert.equal(laserFitsHead(pitman, head), false);
  const [fixed] = shipMiningHeads(golem);
  assert.equal(laserFitsHead(miningLaserFromItem(laserRow('pitman', 1)), fixed), true, 'the stock laser always fits');
  assert.equal(laserFitsHead(miningLaserFromItem(laserRow('mh1', 1)), fixed), false);
});

test('a head multiplies its laser by the modules', () => {
  const laser = miningLaserFromItem(laserRow('mh2', 2));
  const mod = (name, mods) => miningModuleFromItem({ uuid: name, class_name: `Mining_Modules_Active_${name}`, name, data: { stdItem: { MiningModule: { Type: 'Active', Charges: 5, Lifetime: 60, Modifiers: mods } } } });
  const surge = mod('Surge', { DamageMultiplier: 1.5, Resistance: -15.5, Instability: 10 });
  const rieger = mod('Rieger', { DamageMultiplier: 1.25 });
  const bare = miningHeadTotals(laser, []);
  assert.equal(bare.power, 2900);
  assert.deepEqual(bare.modifiers, { Resistance: 25, Instability: 35 });
  const t = miningHeadTotals(laser, [surge, null, rieger]);
  assert.equal(t.power, 2900 * 1.5 * 1.25);
  assert.equal(t.minPower, 145 * 1.5 * 1.25);
  assert.equal(t.modules, 2);
  // (1.25 × 0.845 − 1) and (1.35 × 1.10 − 1), to one decimal.
  assert.deepEqual(t.modifiers, { Resistance: 5.6, Instability: 48.5 });
  assert.equal(miningHeadTotals(null, []).power, null);
});
