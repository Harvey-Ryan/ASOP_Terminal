// v1.58.0: the refinery calculator's data (UEX yields and prices, joined in @dem/shared).
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createServer } from '../server/app.js';
import { fetchRefineryData, setRefineryDataForTests } from '../lib/refineryData.js';

const app = createServer();
const now = Math.floor(Date.now() / 1000);

const uex: Record<string, unknown[]> = {
  commodities: [
    { id: 47, id_parent: 48, name: 'Laranite', is_raw: 0, is_refined: 1, is_available_live: 1 },
    { id: 48, id_parent: 47, name: 'Laranite (Raw)', is_raw: 1, is_refined: 0, is_refinable: 1, is_available_live: 1 },
  ],
  refineries_yields: [
    {
      id_commodity: 48,
      id_terminal: 1,
      value: 4,
      value_week: 3,
      value_month: 2,
      date_modified: now,
      commodity_name: 'Laranite (Raw)',
      terminal_name: 'Refinement Processing - MIC-L1',
      star_system_name: 'Stanton',
    },
  ],
  commodities_prices_all: [{ id_commodity: 47, id_terminal: 10, price_sell: 3000, date_modified: now }],
  commodities_raw_prices_all: [{ id_commodity: 48, id_terminal: 10, price_sell: 1400, date_modified: now }],
  terminals: [{ id: 10, name: 'TDD', star_system_name: 'Stanton', city_name: 'Area18' }],
};

afterEach(() => setRefineryDataForTests(null));

describe('refinery data', () => {
  it('joins the five UEX lists', async () => {
    const asked: string[] = [];
    const data = await fetchRefineryData(async <T>(path: string) => {
      asked.push(path);
      return (uex[path] ?? []) as T[];
    });
    expect(asked.sort()).toEqual([
      'commodities',
      'commodities_prices_all',
      'commodities_raw_prices_all',
      'refineries_yields',
      'terminals',
    ]);
    expect(data.ores).toEqual([{ id: 48, name: 'Laranite (Raw)', refinedId: 47, refinedName: 'Laranite' }]);
    expect(data.refineries[0]).toMatchObject({
      id: 1,
      name: 'MIC-L1',
      system: 'Stanton',
      bonus: { 48: { now: 4, week: 3, month: 2 } },
    });
    expect(data.prices[47]![0]!.sell).toBe(3000);
    expect(data.prices[48]![0]!.sell).toBe(1400);
  });

  it('is served publicly from the cache', async () => {
    const data = await fetchRefineryData(async <T>(path: string) => (uex[path] ?? []) as T[]);
    setRefineryDataForTests(data);
    const res = await request(app).get('/api/game-tools/refinery').expect(200);
    expect(res.body.data.refineries[0].name).toBe('MIC-L1');
  });
});
