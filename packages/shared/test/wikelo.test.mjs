// v1.34.0: Wikelo's missions from sc-data contracts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWikeloMission, buildWikeloMissions, searchWikelo, wikeloRewardTitle, wikeloBaseShipName, wikeloDiscordText,
  parseTicked, tickedCount, turnInQty,
} from '../dist/index.js';

const stations = {
  DropoffLocationBP: { Purpose: 'Destination', ResolvedLocations: [
    { UUID: 'x' },
    { Name: 'Wikelo Emporium Kinga Station' }, { Name: 'Wikelo Emporium Dasi Station' }, { Name: 'Wikelo Emporium Selo Station' },
  ] },
};
const f7 = {
  Title: 'Wikelo Navy F7',
  Description: 'Know how much you Humans like Navy. Bring to <EM4>~mission(destination|ListAll)</EM4>. Bye.',
  MissionType: { Name: 'Wikelo - Vehicles' },
  OnceOnly: false, Shareable: false,
  RewardItems: [{ Items: [{ Name: 'Anvil F7 Hornet Mk Wikelo', Amount: 1 }] }],
  HaulingOrders: [
    { Kind: 'Entity', Name: 'Wikelo Favor', UUID: 'favor', MinAmount: 16, MinScu: 0 },
    { Kind: 'Entity', Name: 'Ace Interceptor Helmet', UUID: 'helmet', MinAmount: 5, MinScu: 0 },
    { Kind: 'Resource', Name: 'Quantainium', UUID: 'quant', MinAmount: 0, MinScu: 36 },
  ],
  LocationPools: stations,
};

test('a mission: reward, turn-in (items and SCU), stations, favors, cleaned text', () => {
  const m = buildWikeloMission('id-f7', f7);
  assert.equal(m.category, 'ships');
  assert.deepEqual(m.turnIn, [
    { key: 'favor', name: 'Wikelo Favor', amount: 16, scu: null },
    { key: 'helmet', name: 'Ace Interceptor Helmet', amount: 5, scu: null },
    { key: 'quant', name: 'Quantainium', amount: null, scu: 36 },
  ]);
  assert.equal(m.favors, 16);
  assert.deepEqual(m.stations, ['Dasi Station', 'Kinga Station', 'Selo Station']);
  assert.equal(m.description, 'Know how much you Humans like Navy. Bring to Wikelo Emporium (Dasi Station, Kinga Station or Selo Station). Bye.');
  assert.equal(turnInQty(m.turnIn[2]), '36 SCU');
  assert.equal(wikeloRewardTitle(m), 'Anvil F7 Hornet Mk Wikelo');
  assert.equal(wikeloBaseShipName('Aegis Sabre Firebird Wikelo War Special'), 'Aegis Sabre Firebird');
});

test('categories: gear, favor trades, other; the same item listed twice adds up', () => {
  const gear = buildWikeloMission('g', { ...f7, MissionType: { Name: 'Wikelo - Other Items' },
    RewardItems: [{ Items: [{ Name: 'Tripledown "Heatwave" Pistol', Amount: 1 }, { Name: 'Tripledown Pistol Magazine (12 Cap)', Amount: 20 }] }],
    HaulingOrders: [{ Name: 'Carinite', UUID: 'c', MinAmount: 10 }, { Name: 'Carinite', UUID: 'c', MinAmount: 10 }] });
  assert.equal(gear.category, 'gear');
  assert.deepEqual(gear.turnIn, [{ key: 'c', name: 'Carinite', amount: 20, scu: null }]);
  assert.equal(wikeloRewardTitle(gear), 'Tripledown "Heatwave" Pistol'); // not "+ 1 more" for the spare magazines
  const favor = buildWikeloMission('f', { ...f7, MissionType: { Name: 'Wikelo - Other Items' }, RewardItems: [{ Items: [{ Name: 'Wikelo Favor', Amount: 1 }] }] });
  assert.equal(favor.category, 'favors');
  const pool = buildWikeloMission('p', { ...f7, MissionType: { Name: 'Collection' }, RewardItems: [{ Items: [{ Name: 'Hat', Amount: 1 }] }, { Items: [{ Name: 'Shirt', Amount: 1 }] }] });
  assert.equal(pool.category, 'other');
  assert.equal(wikeloRewardTitle(pool), '2 possible rewards');
  const set = buildWikeloMission('s', { ...f7, MissionType: { Name: 'Wikelo - Other Items' }, RewardItems: [{ Items: ['Arms', 'Core', 'Legs'].map((p) => ({ Name: `Ana ${p} Endro`, Amount: 1 })) }] });
  assert.equal(wikeloRewardTitle(set), 'Ana Arms Endro + 2 more');
});

test('missions with no title or nothing to turn in are left out; copies kept once; ships first', () => {
  const ms = buildWikeloMissions([
    { uuid: 'b', data: { ...f7, MissionType: { Name: 'Wikelo - Other Items' }, Title: 'Gun' } },
    { uuid: 'a', data: f7 },
    { uuid: 'c', data: f7 }, // same mission again
    { uuid: 'd', data: { ...f7, Title: '<= PLACEHOLDER =>' } },
    { uuid: 'e', data: { ...f7, Title: 'Empty', HaulingOrders: [] } },
  ]);
  assert.deepEqual(ms.map((m) => m.title), ['Wikelo Navy F7', 'Gun']);
});

test('search: every word, any order, across title, rewards and turn-in items', () => {
  const ms = [buildWikeloMission('a', f7)];
  assert.equal(searchWikelo(ms, 'hornet').length, 1);
  assert.equal(searchWikelo(ms, 'helmet ace').length, 1);
  assert.equal(searchWikelo(ms, 'helmet pearl').length, 0);
  assert.equal(searchWikelo(ms, '  ').length, 1);
});

test('Discord text and checklist helpers', () => {
  const m = buildWikeloMission('a', f7);
  assert.equal(wikeloDiscordText(m), [
    '**Wikelo Navy F7** (Wikelo)', 'Reward: Anvil F7 Hornet Mk Wikelo', 'Turn in:',
    '• 16× Wikelo Favor', '• 5× Ace Interceptor Helmet', '• 36 SCU Quantainium', 'At: Dasi Station, Kinga Station, Selo Station',
  ].join('\n'));
  assert.deepEqual(parseTicked('["a","a",3,"b"]'), ['a', 'b']);
  assert.deepEqual(parseTicked('nope'), []);
  assert.equal(tickedCount(m, ['favor', 'gone']), 1);
});
