import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REFINERY_METHODS,
  methodByCode,
  refinedCscu,
  buildRefineryData,
  workOrder,
  rankRefineries,
  parseWorkOrder,
  workOrderParam,
  refineryShortName,
  methodSpeedWord,
} from '../dist/index.js';

const DIN = methodByCode('DIN');

test('yield formula matches work orders players reported to UEX', () => {
  // refineries_audits: quantity → quantity_yield, Dinyx, the refinery's bonus at the time.
  assert.equal(refinedCscu(2872, -1, DIN), 2417); // Laranite, MIC-L2, 4.1.1
  assert.equal(refinedCscu(588, -2, DIN), 490); // Bexalite, Ruin Station, 4.0.1
  assert.equal(refinedCscu(281, 2, DIN), 244); // Laranite, Ruin Station, 4.0.1
  // Lower-yield methods keep 85 % or 70 % of that.
  assert.equal(refinedCscu(1000, 0, methodByCode('EST')), 723);
  assert.equal(refinedCscu(1000, 0, methodByCode('COR')), 595);
  assert.equal(refinedCscu(0, 5, DIN), 0);
});

test('methods: nine, known codes, unknown falls back to Dinyx', () => {
  assert.equal(REFINERY_METHODS.length, 9);
  assert.equal(new Set(REFINERY_METHODS.map((m) => m.code)).size, 9);
  assert.equal(methodByCode('nope').code, 'DIN');
  assert.equal(methodSpeedWord(methodByCode('DIN').time), 'Very slow');
  assert.equal(methodSpeedWord(methodByCode('XCR').time), 'Very fast');
  assert.equal(refineryShortName('Refinement Processing - MIC-L1'), 'MIC-L1');
  assert.equal(refineryShortName('Refinement Center - Ruin Station'), 'Ruin Station');
});

const NOW = Date.parse('2026-11-19T12:00:00Z');
const t = (daysAgo) => Math.floor((NOW - daysAgo * 86_400_000) / 1000);
const data = buildRefineryData({
  now: NOW,
  commodities: [
    { id: 47, id_parent: 48, name: 'Laranite', is_raw: 0, is_refined: 1, is_available_live: 1 },
    { id: 48, id_parent: 47, name: 'Laranite (Raw)', is_raw: 1, is_refined: 0, is_refinable: 1, is_available_live: 1 },
    { id: 58, id_parent: 59, name: 'Quantainium', is_raw: 0, is_refined: 1, is_available_live: 1 },
    {
      id: 59,
      id_parent: 58,
      name: 'Quantainium (Raw)',
      is_raw: 1,
      is_refined: 0,
      is_refinable: 1,
      is_available_live: 1,
    },
    { id: 42, id_parent: 0, name: 'Inert Materials', is_raw: 1, is_refined: 0, is_refinable: 0, is_available_live: 1 },
  ],
  yields: [
    {
      id_commodity: 48,
      id_terminal: 1,
      value: 4,
      value_week: 4,
      value_month: 3,
      date_modified: t(2),
      commodity_name: 'Laranite (Raw)',
      terminal_name: 'Refinement Processing - MIC-L1',
      star_system_name: 'Stanton',
      orbit_name: 'MIC-L1',
    },
    {
      id_commodity: 59,
      id_terminal: 1,
      value: -6,
      date_modified: t(2),
      commodity_name: 'Quantainium (Raw)',
      terminal_name: 'Refinement Processing - MIC-L1',
      star_system_name: 'Stanton',
    },
    {
      id_commodity: 48,
      id_terminal: 2,
      value: -1,
      date_modified: t(1),
      commodity_name: 'Laranite (Raw)',
      terminal_name: 'Refinement Center - Ruin Station',
      star_system_name: 'Pyro',
      space_station_name: 'Ruin Station',
    },
    {
      id_commodity: 59,
      id_terminal: 2,
      value: 3,
      date_modified: t(1),
      commodity_name: 'Quantainium (Raw)',
      terminal_name: 'Refinement Center - Ruin Station',
      star_system_name: 'Pyro',
    },
    {
      id_commodity: 48,
      id_terminal: 3,
      value: 50,
      date_modified: t(400),
      commodity_name: 'Laranite (Raw)',
      terminal_name: 'Refinement Processing - Old',
      star_system_name: 'Stanton',
    },
  ],
  refinedPrices: [
    { id_commodity: 47, id_terminal: 10, price_sell: 3000, date_modified: t(1) },
    { id_commodity: 47, id_terminal: 11, price_sell: 3300, date_modified: t(3) },
    { id_commodity: 47, id_terminal: 12, price_sell: 9999, date_modified: t(200) }, // stale
    { id_commodity: 58, id_terminal: 10, price_sell: 20000, date_modified: t(1) },
  ],
  rawPrices: [{ id_commodity: 48, id_terminal: 10, price_sell: 1500, date_modified: t(1) }],
  terminals: [
    { id: 10, name: 'TDD', star_system_name: 'Stanton', city_name: 'Area18' },
    { id: 11, name: 'Ruin Station Admin', star_system_name: 'Pyro', space_station_name: 'Ruin Station' },
  ],
});

test('data: raw ores linked to what they refine into; stale reports left out', () => {
  assert.deepEqual(
    data.ores.map((o) => [o.id, o.refinedName]),
    [
      [48, 'Laranite'],
      [59, 'Quantainium'],
    ],
  );
  assert.deepEqual(
    data.refineries.map((r) => r.name),
    ['Ruin Station', 'MIC-L1'],
  ); // Pyro before Stanton; the stale one is gone
  assert.deepEqual(data.refineries[1].bonus[48], { now: 4, week: 4, month: 3 });
  assert.deepEqual(
    data.prices[47].map((p) => p.sell),
    [3300, 3000],
  );
  assert.equal(data.terminals[10].place, 'TDD · Area18, Stanton');
});

test('a work order: refined SCU, value where you sell, raw comparison, fee', () => {
  const lines = [
    { oreId: 48, scu: 32 },
    { oreId: 59, scu: 10 },
  ];
  const r = workOrder(data, lines, 1, DIN, { sellSystem: 'Stanton', fee: 5000 });
  // 3200 cSCU × 0.85 × 1.04 = 2828.8 → 2829; 1000 × 0.85 × 0.94 = 799
  assert.deepEqual(
    r.lines.map((l) => [l.outScu, l.bonusPct]),
    [
      [28.29, 4],
      [7.99, -6],
    ],
  );
  assert.equal(r.outScu, 28.29 + 7.99);
  assert.equal(r.lines[0].refinedPrice.sell, 3000); // best in Stanton, not Pyro's 3300
  assert.equal(Math.round(r.refinedValue), Math.round(28.29 * 3000 + 7.99 * 20000));
  assert.equal(r.rawValue, 32 * 1500);
  assert.equal(Math.round(r.profit), Math.round(r.refinedValue - 5000));
  assert.equal(workOrder(data, lines, 1, DIN).profit, null);
  // Anywhere: the best price in any system.
  assert.equal(workOrder(data, lines, 1, DIN).lines[0].refinedPrice.sell, 3300);
});

test('ranking refineries for a load, and the order in the address', () => {
  const ranked = rankRefineries(data, [{ oreId: 59, scu: 10 }], DIN);
  assert.deepEqual(
    ranked.map((x) => [x.site.name, x.result.outScu]),
    [
      ['Ruin Station', 8.76],
      ['MIC-L1', 7.99],
    ],
  );
  assert.deepEqual(
    rankRefineries(data, [{ oreId: 59, scu: 10 }], DIN, { system: 'Stanton' }).map((x) => x.site.name),
    ['MIC-L1'],
  );
  const lines = parseWorkOrder('48:32,59:12.5,bad,0:3,48:-1,60:0');
  assert.deepEqual(lines, [
    { oreId: 48, scu: 32 },
    { oreId: 59, scu: 12.5 },
    { oreId: 60, scu: 0 },
  ]);
  assert.equal(workOrderParam(lines), '48:32,59:12.5,60:0');
});
