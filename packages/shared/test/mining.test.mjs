import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOreSpots, matchSignature, miningLaserFromItem, miningModuleFromItem, oreName } from '../dist/index.js';

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
