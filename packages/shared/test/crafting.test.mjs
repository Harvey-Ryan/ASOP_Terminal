import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptBlueprint, adaptContract, buildMissionContracts, baseStatsFor, buildCraftingData, fillMissionTokens } from '../dist/crafting.js';

const BP = {
  UUID: 'bp-1', Key: 'BP_CRAFT_armor_torso',
  Output: { UUID: 'item-1', Name: 'Artimex Core Red Alert', Type: 'Char_Armor_Torso', Subtype: 'UNDEFINED', Grade: '1' },
  Tiers: [{ CraftTimeSeconds: 90, Requirements: { Kind: 'group', Children: [
    { Kind: 'group', Name: 'Frame', Children: [{ Kind: 'resource', Name: 'Aluminum', UUID: 'res-al', QuantityScu: 0.02, MinQuality: 300 }],
      Modifiers: [{ Key: 'armor_physical', Name: 'Physical Resistance', UnitFormat: '%', QualityRange: { Min: 0, Max: 1000 }, ModifierRange: { AtMinQuality: 0.9, AtMaxQuality: 1.1 } }] },
    { Kind: 'group', Name: 'Weave', Children: [{ Kind: 'item', Name: 'Ceramic Plate', UUID: 'it-a', Quantity: 2 }, { Kind: 'item', Name: 'Steel Plate', UUID: 'it-b', Quantity: 3 }] },
  ] } }],
  Dismantle: { TimeSeconds: 15, Efficiency: 0.5, Returns: [{ Kind: 'resource', Name: 'Torite', UUID: 'res-to', QuantityScu: 0.005 }] },
};

test('adaptBlueprint: slots, alternatives, stats and dismantle returns', () => {
  const r = adaptBlueprint(BP);
  assert.equal(r.Name, 'Artimex Core Red Alert');
  assert.equal(r.CraftTimeSeconds, 90);
  assert.deepEqual(r.Components.map((c) => [c.Slot, c.Material.Name, c.Material.Kind]), [['Frame', 'Aluminum', 'resource'], ['Weave', 'Ceramic Plate or Steel Plate', 'item']]);
  assert.equal(r.Components[1].Material.Quantity, 2, 'alternatives use the first one\'s quantity');
  assert.deepEqual(r.Components[0].Stats[0], { Key: 'armor_physical', Label: 'Physical Resistance', QualityMin: 0, QualityMax: 1000, MultiplierAtMin: 0.9, MultiplierAtMax: 1.1, UnitFormat: '%' });
  assert.deepEqual(r.Dismantle, { TimeSeconds: 15, Efficiency: 0.5, Returns: [{ UUID: 'res-to', Name: 'Torite', Kind: 'resource', Quantity: null, QuantityScu: 0.005 }] });
  assert.equal(adaptBlueprint({ UUID: 'x', Key: 'k' }).Dismantle, null);
});

const CONTRACT = (title, pool, locs = ['Lorville']) => ({
  DisplayTitle: title, Description: 'Head to ~mission(Destination|Address).',
  MissionType: { Name: 'Delivery' }, Faction: { Name: 'Covalex' },
  LocationPools: { a: { Purpose: 'Destination', ResolvedLocations: locs.map((Name) => ({ Name })) } },
  Blueprints: [{ Chance: 1, PoolUUID: 'p', PoolContents: pool.map((u) => ({ ItemName: u, ItemUUID: 'i-' + u, BlueprintUUID: u })) }],
  ReputationGained: [{ Faction: 'Covalex', Amount: 100, Scope: 'Rep' }, { Faction: '<= PLACEHOLDER =>', Amount: 5 }],
  Difficulty: { MechanicalSkill: 'Very_Easy_1', MentalLoad: 'Hard_4', RiskOfLoss: 'Medium_3', GameKnowledge: 'Easy_2' },
  TimeToComplete: 30, Illegal: false,
});

test('adaptContract: readable titles only; tokens filled with the location', () => {
  const m = adaptContract(CONTRACT('Deliver Parts', ['bp-1']));
  assert.equal(m.Title, 'Deliver Parts');
  assert.equal(m.Description, 'Head to Lorville.');
  assert.equal(adaptContract({ ...CONTRACT('x', []), DisplayTitle: '~mission(Title)', Title: '<= PLACEHOLDER =>' }), null);
  assert.equal(fillMissionTokens('at ~mission(Nowhere)', {}), 'at the marked location');
});

test('buildMissionContracts: variants grouped by title, pools de-duplicated, locations merged', () => {
  const raw = [CONTRACT('Deliver Parts', ['bp-1', 'bp-2'], ['Lorville']), CONTRACT('Deliver Parts', ['bp-2', 'bp-1'], ['Area18']), CONTRACT('Other', ['bp-3'])].map(adaptContract);
  const out = buildMissionContracts(raw);
  assert.deepEqual(out.map((c) => c.title), ['Deliver Parts', 'Other']);
  const dp = out[0];
  assert.equal(dp.pools.length, 1);
  assert.deepEqual(dp.pools[0].locations, ['Area18', 'Lorville']);
  assert.deepEqual(dp.reputation, [{ faction: 'Covalex', xp: 100, scope: 'Rep' }], 'placeholder factions dropped');
  assert.equal(dp.difficulty.mentalLoad, 4);
  assert.equal(dp.difficulty.mentalLoadLabel, 'Hard');
  assert.equal(dp.faction, 'Covalex');
});

test('baseStatsFor: armor resistances, temperature and radiation', () => {
  const std = { SuitArmor: { DamageResistance: { Physical: { Multiplier: 0.7 }, Energy: { Multiplier: 0.7 }, Distortion: { Multiplier: 0.7 }, Thermal: { Multiplier: 0.7 }, Biochemical: { Multiplier: 0.7 }, Stun: { Multiplier: 0.55 }, Impact: 0.69 } },
    TemperatureResistance: { Minimum: -61, Maximum: 91 }, RadiationResistance: { MaximumRadiationCapacity: 26400, RadiationDissipationRate: 145.8 } };
  assert.deepEqual(baseStatsFor('Char_Armor_Torso', std), {
    kind: 'armor', resistance: { physical: 0.7, energy: 0.7, distortion: 0.7, thermal: 0.7, biochemical: 0.7, stun: 0.55 },
    temperature: { min: -61, max: 91 }, radiation: { maxCapacity: 26400, dissipationRate: 145.8 },
  });
  assert.deepEqual(baseStatsFor('Char_Armor_Helmet', {}).resistance.physical, 1, 'missing resistance → no change (1)');
});

test('baseStatsFor: shield, power plant, quantum drive, weapons, anything else', () => {
  assert.deepEqual(baseStatsFor('Shield', { Shield: { MaxShieldHealth: 720 }, Durability: { Health: 65 } }), { kind: 'shield', maxHealth: 720 });
  const pp = { ResourceNetwork: { Usage: { Power: { Maximum: 9 } }, States: [{ Name: 'Online', Deltas: [{ Type: 'Consumption', Resource: 'Coolant', Rate: 0 }, { Type: 'Generation', Resource: 'Power', Rate: 11 }] }] } };
  assert.deepEqual(baseStatsFor('PowerPlant', pp), { kind: 'powerplant', powerOutput: 11 });
  assert.deepEqual(baseStatsFor('PowerPlant', { ResourceNetwork: { Usage: { Power: { Maximum: 9 } } } }), { kind: 'powerplant', powerOutput: 9 });
  assert.deepEqual(baseStatsFor('QuantumDrive', { QuantumDrive: { FuelRequirement10GM: 0.14, StandardJump: { DriveSpeed: 259054500, SpoolUpTime: 4.2, CooldownTime: 7.6 } } }),
    { kind: 'quantumdrive', speedMs: 259054500, fuelReq10GM: 0.14, spoolTime: 4.2, cooldownTime: 7.6 });
  assert.deepEqual(baseStatsFor('WeaponPersonal', { Weapon: { Modes: [{ Name: 'Rapid', RoundsPerMinute: 810, Alpha: 12, Dps: 162 }, { Name: 'Single', RoundsPerMinute: 810, Alpha: 12, Dps: 162 }] } }),
    { kind: 'weapon', modes: [{ name: 'Rapid', rpm: 810, alpha: 12, dps: 162 }, { name: 'Single', rpm: 810, alpha: 12, dps: 162 }] });
  assert.deepEqual(baseStatsFor('WeaponGun', {}), { kind: 'weapon', modes: [] });
  assert.deepEqual(baseStatsFor('Cooler', { Durability: { Health: 300 } }), { kind: 'generic', hp: 300 });
  assert.deepEqual(baseStatsFor('Cooler', null), { kind: 'generic', hp: null });
});

test('buildCraftingData: pages\' shapes, obtainable blueprints, missions per blueprint, base stats per item', () => {
  const bp2 = { ...BP, UUID: 'bp-2', Key: 'BP_2', Output: { UUID: 'item-2', Name: '<= PLACEHOLDER =>', Type: 'Shield' } };
  const data = buildCraftingData({
    build: '4.3.1', commit: 'abc',
    blueprints: [BP, bp2],
    resources: [{ uuid: 'res-al', name: 'Aluminum' }],
    contracts: [CONTRACT('Deliver Parts', ['bp-1'])],
    items: [
      { uuid: 'item-1', type: 'Char_Armor_Torso', name: 'Artimex Core Red Alert', manufacturer: 'Clark Defense Systems', mass: 5, std: {} },
      { uuid: 'item-2', type: 'Shield', name: 'Castra', manufacturer: '<= PLACEHOLDER =>', mass: null, std: { Shield: { MaxShieldHealth: 720 } } },
    ],
  });
  assert.deepEqual(data.source, { build: '4.3.1', commit: 'abc' });
  assert.deepEqual(data.obtainableUuids, ['bp-1']);
  const [a, b] = data.blueprints;
  assert.equal(a.name, 'Artimex Core Red Alert');
  assert.equal(a.subtype, null, 'UNDEFINED subtype hidden');
  assert.equal(a.manufacturer, 'Clark Defense Systems');
  assert.equal(a.mass, 5);
  assert.deepEqual(a.missions, ['Deliver Parts']);
  assert.deepEqual(a.dismantle, { timeSecs: 15, efficiency: 0.5, returns: [{ name: 'Torite', quantityScu: 0.005, quantity: null }] });
  assert.equal(a.components[0].stats[0].curve, 'linear');
  assert.equal(b.name, 'Castra', 'placeholder blueprint name → item name');
  assert.equal(b.manufacturer, null, 'placeholder maker hidden');
  assert.deepEqual(data.baseStats['item-2'], { kind: 'shield', maxHealth: 720 });
  assert.equal(data.baseStats['item-1'].kind, 'armor');
  assert.equal(data.missions[0].pools[0].blueprints[0].blueprintUuid, 'bp-1');
});
