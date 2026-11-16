// v1.42.0: UEX prices and routes for /price and /route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  uexBestPrices, uexBestRoutes, uexSearch, uexStockWord, uexMoney, uexShort, uexPlace, uexRoutePlace, uexRouteUrl,
  uexLiveCommodities, uexTradeTerminals, UEX_MAX_AGE_DAYS,
} from '../dist/index.js';

const NOW = Date.UTC(2026, 10, 16);
const sec = (daysAgo) => Math.floor((NOW - daysAgo * 86_400_000) / 1000);
const row = (o) => ({
  id_commodity: 1, id_terminal: 1, price_buy: 0, price_sell: 0, status_buy: 4, date_modified: sec(1), commodity_name: 'Laranite',
  star_system_name: 'Stanton', planet_name: 'ArcCorp', orbit_name: null, moon_name: null, space_station_name: null, outpost_name: null, city_name: 'Area18',
  terminal_name: 'TDD', ...o,
});

test('best places to sell and buy: right order, each place once, old reports and empty stock left out', () => {
  const rows = [
    row({ id_terminal: 1, price_sell: 3000 }),
    row({ id_terminal: 2, price_sell: 3200, star_system_name: 'Pyro' }),
    row({ id_terminal: 3, price_sell: 9999, date_modified: sec(UEX_MAX_AGE_DAYS + 1) }), // too old
    row({ id_terminal: 4, price_buy: 2500 }),
    row({ id_terminal: 5, price_buy: 2000, status_buy: 1 }), // out of stock
    row({ id_terminal: 6, price_buy: 2600, date_modified: sec(0.1) }),
    row({ id_terminal: 1, price_sell: 2900 }), // same place again
  ];
  const all = uexBestPrices(rows, { now: NOW });
  assert.deepEqual(all.sell.map((r) => r.id_terminal), [2, 1]);
  assert.deepEqual(all.buy.map((r) => r.id_terminal), [4, 6]);
  assert.equal(all.newest, sec(0.1));
  const stanton = uexBestPrices(rows, { now: NOW, system: 'stanton ' });
  assert.deepEqual(stanton.sell.map((r) => r.id_terminal), [1]);
  assert.deepEqual(uexBestPrices([], { now: NOW }), { sell: [], buy: [], newest: null });
  assert.equal(uexBestPrices(rows, { now: NOW, limit: 1 }).sell.length, 1);
});

test('routes: best score first, losing or duplicate routes dropped', () => {
  const r = (o) => ({ id: 1, code: 'x', id_commodity: 1, id_terminal_origin: 1, id_terminal_destination: 2, price_origin: 10, price_destination: 20, price_margin: 10, score: 50, profit: 1000, ...o });
  const out = uexBestRoutes([
    r({ id: 1, score: 40 }),
    r({ id: 2, score: 90, id_terminal_destination: 3 }),
    r({ id: 3, score: 99, price_margin: -5, id_terminal_destination: 4 }),
    r({ id: 4, score: 40, profit: 5000 }), // same trip as id 1, more profit: kept instead
    r({ id: 5, score: 70, price_origin: 0, id_terminal_destination: 5 }),
  ]);
  assert.deepEqual(out.map((x) => x.id), [2, 4]);
});

test('search: every word, any order, exact and prefix first', () => {
  const list = [{ name: 'Quantanium (Raw)', code: 'QUAN' }, { name: 'Quantanium', code: 'QUAN2' }, { name: 'Laranite', code: 'LARA' }, { name: 'Raw Ice', code: 'ICE' }];
  assert.deepEqual(uexSearch(list, 'quantanium').map((x) => x.name), ['Quantanium', 'Quantanium (Raw)']);
  assert.deepEqual(uexSearch(list, 'raw quan').map((x) => x.name), ['Quantanium (Raw)']);
  assert.deepEqual(uexSearch(list, 'lara').map((x) => x.name), ['Laranite']);
  assert.deepEqual(uexSearch(list, 'ice').map((x) => x.name), ['Raw Ice']);
  assert.equal(uexSearch(list, '').length, 4);
});

test('words, money and places', () => {
  assert.equal(uexStockWord(1), 'Out of stock');
  assert.equal(uexStockWord(7), 'Max stock');
  assert.equal(uexStockWord(null), null);
  assert.equal(uexMoney(24180.4), '24,180');
  assert.equal(uexMoney(12.345), '12.35');
  assert.equal(uexShort(1_250_000), '1.3M');
  assert.equal(uexShort(34_000), '34k');
  assert.equal(uexShort(950), '950');
  assert.equal(uexPlace(row({ terminal_name: 'TDD Area18' })), 'TDD Area18 · ArcCorp, Stanton');
  assert.equal(uexPlace(row({ moon_name: 'Lyria', planet_name: 'ArcCorp' })), 'TDD · Lyria, Stanton');
  assert.equal(uexPlace(row({ star_system_name: null, planet_name: null })), 'TDD');
  assert.equal(uexRoutePlace({ origin_terminal_name: 'CRU-L1', origin_planet_name: null, origin_orbit_name: 'Crusader', origin_star_system_name: 'Stanton' }, 'origin'), 'CRU-L1 · Crusader, Stanton');
  assert.equal(uexRoutePlace({ destination_terminal_name: 'TDD', destination_planet_name: 'ArcCorp', destination_orbit_name: null, destination_star_system_name: 'Stanton' }, 'destination', false), 'ArcCorp, Stanton');
  assert.equal(uexRouteUrl('a b'), 'https://uexcorp.space/trade/route?code=a%20b');
});

test('only live, public commodities and trade terminals are offered', () => {
  assert.deepEqual(uexLiveCommodities([{ name: 'A', is_available_live: 1, is_visible: 1 }, { name: 'B', is_available_live: 0, is_visible: 1 }, { name: 'C', is_available_live: 1, is_visible: 0 }]).map((c) => c.name), ['A']);
  assert.deepEqual(uexTradeTerminals([
    { name: 'T1', type: 'commodity', is_available_live: 1, is_visible: 1 },
    { name: 'T2', type: 'item', is_available_live: 1, is_visible: 1 },
    { name: 'T3', type: 'commodity_raw', is_available_live: 1, is_visible: 1 },
    { name: 'T4', type: 'commodity', is_available_live: 0, is_visible: 1 },
  ]).map((t) => t.name), ['T1', 'T3']);
});

test('best runs: profit for your load, one per commodity, jumps and stale or empty places left out', async () => {
  const { uexBestRuns, uexTerminalPlace } = await import('../dist/index.js');
  const T = (id, sys, name = `T${id}`) => ({ id, name, star_system_name: sys, planet_name: sys === 'Stanton' ? 'ArcCorp' : null, moon_name: null, space_station_name: null, city_name: null });
  const terminals = [T(1, 'Stanton'), T(2, 'Stanton'), T(3, 'Pyro'), T(4, 'Stanton'), T(5, 'Stanton')];
  const p = (o) => ({ price_buy: 0, price_sell: 0, scu_buy: null, scu_sell: null, status_buy: 4, status_sell: 3, date_modified: sec(1), commodity_name: `C${o.id_commodity}`, terminal_name: `T${o.id_terminal}`, ...o });
  const rows = [
    // Gold: big margin, but only 10 SCU in stock
    p({ id_commodity: 1, id_terminal: 1, price_buy: 5000, scu_buy: 10 }),
    p({ id_commodity: 1, id_terminal: 2, price_sell: 9000, scu_sell: 5000 }),
    // Agricium: small margin, lots of stock and demand
    p({ id_commodity: 2, id_terminal: 1, price_buy: 2000, scu_buy: 5000 }),
    p({ id_commodity: 2, id_terminal: 4, price_sell: 2600, scu_sell: 3000 }),
    p({ id_commodity: 2, id_terminal: 5, price_sell: 2500, scu_sell: 9000 }),
    // Laranite: best sale is in Pyro (a jump); in Stanton only a small margin
    p({ id_commodity: 3, id_terminal: 1, price_buy: 2500, scu_buy: 2000 }),
    p({ id_commodity: 3, id_terminal: 3, price_sell: 4000, scu_sell: 2000 }),
    p({ id_commodity: 3, id_terminal: 2, price_sell: 2700, scu_sell: 2000 }),
    // Waste: buy is out of stock, so nothing
    p({ id_commodity: 4, id_terminal: 1, price_buy: 10, status_buy: 1 }),
    p({ id_commodity: 4, id_terminal: 2, price_sell: 500 }),
    // Old report: ignored
    p({ id_commodity: 5, id_terminal: 1, price_buy: 1, date_modified: sec(60) }),
    p({ id_commodity: 5, id_terminal: 2, price_sell: 99999 }),
    // Selling terminal full (status 7): ignored
    p({ id_commodity: 6, id_terminal: 1, price_buy: 100 }),
    p({ id_commodity: 6, id_terminal: 2, price_sell: 9000, status_sell: 7 }),
  ];
  const commodities = [{ id: 1, is_illegal: 0 }, { id: 2, is_illegal: 1 }, { id: 3, is_illegal: 0 }];

  // No hold size: by margin per SCU, one run per commodity, no jumps
  const byMargin = uexBestRuns(rows, terminals, commodities, { now: NOW });
  assert.deepEqual(byMargin.map((r) => [r.commodityName, r.margin, r.units]), [['C1', 4000, null], ['C2', 600, null], ['C3', 200, null]]);

  // A 696 SCU hold: Gold only fills 10 SCU, Agricium fills the hold
  const hold = uexBestRuns(rows, terminals, commodities, { now: NOW, scu: 696 });
  assert.deepEqual(hold.map((r) => [r.commodityName, r.units, r.limitedBy, r.profit]), [['C2', 696, 'hold', 417600], ['C3', 696, 'hold', 139200], ['C1', 10, 'stock', 40000]]);
  assert.equal(hold[0].illegal, true);
  assert.equal(hold[0].investment, 696 * 2000);

  // A budget can be the limit
  const poor = uexBestRuns(rows, terminals, commodities, { now: NOW, scu: 696, budget: 100_000 });
  assert.deepEqual(poor.find((r) => r.commodityName === 'C2').units, 50);
  assert.equal(poor.find((r) => r.commodityName === 'C2').limitedBy, 'budget');

  // Allowing jumps finds the Pyro sale
  const jumps = uexBestRuns(rows, terminals, commodities, { now: NOW, scu: 696, crossSystem: true });
  const lara = jumps.find((r) => r.commodityName === 'C3');
  assert.equal(lara.sell.id_terminal, 3);
  assert.equal(lara.crossSystem, true);

  // Only one system
  assert.deepEqual(uexBestRuns(rows, terminals, commodities, { now: NOW, system: 'Pyro' }), []);
  assert.equal(uexTerminalPlace(terminals[0], 'x'), 'T1 · ArcCorp, Stanton');
  assert.equal(uexTerminalPlace(null, 'Fallback'), 'Fallback');
});
