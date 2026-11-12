import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMaterialSources, planRoute, routeSystems, materialKey, chanceLabel } from '../dist/index.js';

const rock = (p, ...ores) => ({ RelativeProbability: p, ResourceQualities: ores.map(([k, pct]) => ({ ResourceKey: k, MaxPercentage: pct })) });
const place = (provider, name, type, system, groups) => ({ provider_name: provider, data: { Locations: [{ Name: name, Type: type, System: system }], Groups: groups } });

const rows = [
  place('HPP_Pyro5c', 'Adir', 'moon', 'Pyro', [
    { GroupName: 'SpaceShip_Mineables', Deposits: [rock(0.4, ['Ore_Iron', 84], ['Ore_Iron', 15]), rock(0.1, ['Ore_Riccite', 80], ['Ore_Iron', 10]), rock(0.5, ['Ore_Borase', 90])] },
    { GroupName: 'GroundVehicle_Mineables', Deposits: [rock(1, ['Glacosite', 100])] },
  ]),
  place('HPP_Pyro5e', 'Fuego', 'moon', 'Pyro', [{ GroupName: 'SpaceShip_Mineables', Deposits: [rock(0.3, ['Ore_Titanium', 80]), rock(0.7, ['Ore_Iron', 70])] }]),
  place('HPP_Stanton1c', 'Magda', 'moon', 'Stanton', [{ GroupName: 'FPS mineables', Deposits: [rock(1, ['Raw_Ice', 90])] }]),
  { provider_name: 'HPP_Stanton2c_Belt', data: { Locations: [{ Name: 'Terminus', Type: 'planet', System: 'Stanton' }], Groups: [{ GroupName: 'SpaceShip_Mineables', Deposits: [rock(1, ['Ore_Titanium', 80])] }] } },
  { provider_name: 'HPP_Lagrange_B', data: { Locations: [{ Name: 'MIC L3', Type: 'lagrange', System: 'Stanton' }, { Name: 'ARC L5', Type: 'lagrange', System: 'Stanton' }], Groups: [{ GroupName: 'SpaceShip_Mineables', Deposits: [rock(1, ['Ore_Iron', 80])] }] } },
  place('Loot_Caves_Unoccupied_Rock', 'Stag\'s Rut', 'cave', 'Pyro', [{ GroupName: 'FPS_Mineables', Deposits: [rock(1, ['Ore_Iron', 80])] }]),
  place('HPP_Pyro5a', 'Ignis', 'moon', 'Pyro', [{ GroupName: 'Salvage_FreshDerelicts', Deposits: [rock(1, ['Ore_Iron', 80])] }]),
];

test('material names match blueprint names', () => {
  assert.equal(materialKey('Ore_Iron'), 'iron');
  assert.equal(materialKey('Raw_Hephaestanite'), 'hephaestanite');
  assert.equal(materialKey('RawOuratite'), 'ouratite');
  assert.equal(materialKey('Raw_Ice'), 'pressurized ice');
  assert.equal(materialKey('Glacosite'), 'glacosite');
  assert.equal(materialKey('Iron'), 'iron');
});

test('sources: main ore only, per method, best first; skips loot, salvage; fixes names', () => {
  const s = buildMaterialSources(rows);
  assert.deepEqual(s.iron.map((x) => `${x.place}|${x.method}|${x.chance}`), ['ARC L5, MIC L3|ship|1', 'Fuego|ship|0.7', 'Adir|ship|0.4']);
  assert.equal(s.riccite[0].chance, 0.1); // the riccite rock's trace of iron doesn't count for iron
  assert.deepEqual(s.glacosite[0], { place: 'Adir', kind: 'moon', system: 'Pyro', method: 'roc', chance: 1, maxPercent: 100 });
  assert.equal(s['pressurized ice'][0].method, 'hand');
  assert.ok(s.titanium.some((x) => x.place === 'Yela asteroid belt'));
  assert.ok(!JSON.stringify(s).includes('Stag'));
  assert.equal(chanceLabel(0.4), 'Common');
  assert.equal(chanceLabel(0.1), 'Uncommon');
  assert.equal(chanceLabel(0.02), 'Rare');
});

test('route: fewest stops in the chosen system; what it lacks is listed', () => {
  const s = buildMaterialSources(rows);
  const mats = ['Iron', 'Riccite', 'Glacosite', 'Titanium', 'Pressurized Ice'];
  assert.deepEqual(routeSystems(mats, s), ['Pyro', 'Stanton']);
  const pyro = planRoute(mats, s, 'Pyro');
  assert.deepEqual(pyro.stops.map((x) => [x.place, x.materials.map((m) => m.name)]), [['Adir', ['Iron', 'Riccite', 'Glacosite']], ['Fuego', ['Titanium']]]);
  assert.deepEqual(pyro.missing, ['Pressurized Ice']);
  const stanton = planRoute(mats, s, 'Stanton');
  assert.deepEqual(stanton.missing, ['Riccite', 'Glacosite']);
  assert.equal(stanton.stops.length, 3);
  assert.deepEqual(planRoute([], s, 'Pyro'), { system: 'Pyro', stops: [], missing: [] });
});

test('build list: amounts as the game shows them, totals times quantity', async () => {
  const { formatMaterialAmount, buildListTotals } = await import('../dist/index.js');
  assert.equal(formatMaterialAmount(0.64, null), '64 cSCU');
  assert.equal(formatMaterialAmount(1.43, null), '1.43 SCU');
  assert.equal(formatMaterialAmount(0.005, null), '0.5 cSCU');
  assert.equal(formatMaterialAmount(null, 170), '170 units');
  assert.equal(formatMaterialAmount(null, 1), '1 unit');
  assert.equal(formatMaterialAmount(null, null), '—');
  const m = (name, scu, units = null) => ({ material: { name, quantityScu: scu, quantity: units } });
  const greatsword = { craftTimeSecs: 960, components: [m('Iron', 0.64), m('Riccite', 0.09), m('Titanium', 0.32)] };
  const rhada = { craftTimeSecs: 480, components: [m('Iron', 0.15), m('Corundum', 0.24), m('Glacosite', null, 20)] };
  const t = buildListTotals([{ bp: greatsword, qty: 2 }, { bp: rhada, qty: 1 }, { bp: rhada, qty: 0 }]);
  assert.equal(t.craftTimeSecs, 2400);
  assert.deepEqual(t.materials.map((x) => [x.name, x.scu, x.units]), [
    ['Iron', 1.43, null], ['Titanium', 0.64, null], ['Corundum', 0.24, null], ['Riccite', 0.18, null], ['Glacosite', null, 20],
  ]);
});
