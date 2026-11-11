import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from '../server/app.js';
import { createUser } from './factories.js';

// SC Database search over the sc-data copy (v1.11.1). Needs a database with the
// scdata schema filled in; without one every search answers [] (covered last).

const app = createServer();

async function signedIn() {
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [] });
  return agent;
}
const search = async (agent: Awaited<ReturnType<typeof signedIn>>, path: string, q: string) =>
  (await agent.get(`/api/sc/${path}`).query({ q }).expect(200)).body.data as Record<string, unknown>[];

const hasScData = process.env['DATABASE_URL']?.includes('asop_sc');

describe.skipIf(!hasScData)('SC Database search (sc-data)', () => {
  it('needs a signed-in user', async () => {
    await request(app).get('/api/sc/blueprints').query({ q: 'magazine' }).expect(401);
  });

  it('blueprints: by the crafted item\'s name, with type, tiers and dismantle info', async () => {
    const a = await signedIn();
    const rows = await search(a, 'blueprints', 'S-38 Magazine');
    expect(rows.length).toBeGreaterThan(0);
    const r = rows[0]!;
    expect(r['outputName']).toMatch(/^S-38 Magazine/);
    expect(r).toMatchObject({ outputType: 'WeaponAttachment', kind: 'creation' });
    expect(typeof r['tierCount']).toBe('number');
    expect(typeof r['dismantleTimeSecs']).toBe('number');
  });

  it('closest matches come first, at most 50', async () => {
    const a = await signedIn();
    const rows = await search(a, 'ship-items', 'shield');
    expect(rows.length).toBeLessThanOrEqual(50);
    const names = rows.map((r) => String(r['name'] ?? '').toLowerCase());
    const firstNonPrefix = names.findIndex((n) => !n.startsWith('shield'));
    if (firstNonPrefix >= 0) expect(names.slice(firstNonPrefix).every((n) => !n.startsWith('shield'))).toBe(true);
  });

  it('ship items: found by type too ("shield" lists shield generators named like 5CA \'Akura\')', async () => {
    const a = await signedIn();
    const rows = await search(a, 'ship-items', 'shield');
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.some((r) => r['type'] === 'Shield' && !String(r['name']).toLowerCase().includes('shield'))).toBe(true);
  });

  it('ship items: real items only (no placeholders), with size, grade and maker', async () => {
    const a = await signedIn();
    const rows = await search(a, 'ship-items', 'shield');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r['name'] !== '<= PLACEHOLDER =>')).toBe(true);
    expect(Object.keys(rows[0]!)).toEqual(expect.arrayContaining(['uuid', 'name', 'className', 'type', 'subType', 'size', 'grade', 'manufacturer']));
  });

  it('every tab answers for a common word', async () => {
    const a = await signedIn();
    const cases: [string, string, string][] = [
      ['commodities', 'agri', 'name'], ['resources', 'quant', 'name'], ['starmap', 'microtech', 'name'],
      ['trade-locations', 'lorville', 'displayName'], ['manufacturers', 'aegis', 'name'], ['labels', 'ballistic', 'value'],
    ];
    for (const [path, q, field] of cases) {
      const rows = await search(a, path, q);
      expect(rows.length, `${path} "${q}"`).toBeGreaterThan(0);
      expect(String(rows[0]![field]).toLowerCase(), `${path} "${q}"`).toContain(q);
    }
  });

  it('starmap shows what each place is in', async () => {
    const a = await signedIn();
    const rows = await search(a, 'starmap', 'microtech');
    expect(rows.some((r) => r['parent'])).toBe(true);
  });

  it('short or empty searches answer nothing; LIKE wildcards are literal', async () => {
    const a = await signedIn();
    expect(await search(a, 'labels', 'a')).toEqual([]);
    expect(await search(a, 'labels', '')).toEqual([]);
    // Some labels really contain "__" or "%%": only those match, not everything.
    for (const q of ['__', '%%']) {
      const rows = await search(a, 'labels', q);
      expect(rows.length, q).toBeGreaterThan(0);
      expect(rows.every((r) => `${r['key']} ${r['value']}`.includes(q)), q).toBe(true);
    }
  });

  it('the old routes say they moved', async () => {
    const a = await signedIn();
    for (const [m, p] of [['get', '/api/sc/sync/status'], ['post', '/api/sc/sync'], ['get', '/api/sc/missions'], ['get', '/api/sc/blueprints/abc']] as const) {
      const res = await a[m](p).expect(410);
      expect(res.body.error).toMatch(/game-data/);
    }
  });
});

describe.skipIf(hasScData)('SC Database search without sc-data', () => {
  it('answers [] when the game data hasn\'t been set up yet', async () => {
    const a = await signedIn();
    expect(await search(a, 'blueprints', 'magazine')).toEqual([]);
  });
});
