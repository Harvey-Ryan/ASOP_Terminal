import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { gunzipSync } from 'node:zlib';
import { createServer } from '../server/app.js';
import { createUser } from './factories.js';
import type { CraftingDataDto } from '@dem/shared';

// GET /api/game-data/crafting (v1.11.2): the Blueprints and Crafting Calculator
// pages' data, built from sc-data. Needs a database with scdata filled in.

const app = createServer();
const hasScData = process.env['DATABASE_URL']?.includes('asop_sc');

async function signedIn() {
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [] });
  return agent;
}

describe.skipIf(!hasScData)('crafting data from sc-data', () => {
  it('needs a signed-in user', async () => {
    await request(app).get('/api/game-data/crafting').expect(401);
  });

  it('answers the pages\' data, compressed, with an ETag; unchanged → 304', async () => {
    const a = await signedIn();
    const res = await a.get('/api/game-data/crafting').set('Accept-Encoding', 'gzip').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    const etag = String(res.headers['etag']);
    expect(etag).toMatch(/^"crafting-/);
    // The test client undoes the gzip itself; what matters is that it was sent gzipped.
    const raw = res.body as Buffer;
    const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString() : raw.toString();
    const body = JSON.parse(text) as { success: boolean; data: CraftingDataDto };
    expect(body.success).toBe(true);
    const d = body.data;
    expect(d.blueprints.length).toBeGreaterThan(1000);
    expect(d.obtainableUuids.length).toBeGreaterThan(100);
    expect(d.obtainableUuids.length).toBeLessThan(d.blueprints.length);
    expect(d.missions.length).toBeGreaterThan(10);
    await a.get('/api/game-data/crafting').set('If-None-Match', etag).expect(304);
  });

  it('plain JSON for clients that don\'t accept gzip', async () => {
    const a = await signedIn();
    const res = await a.get('/api/game-data/crafting').set('Accept-Encoding', 'identity').expect(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body.data.blueprints.length).toBeGreaterThan(1000);
  });

  it('a known blueprint: components, stats, dismantle, maker, base stats, missions', async () => {
    const a = await signedIn();
    const d = (await a.get('/api/game-data/crafting').set('Accept-Encoding', 'identity').expect(200)).body.data as CraftingDataDto;
    const armor = d.blueprints.filter((b) => b.type.startsWith('Char_Armor') && d.obtainableUuids.includes(b.uuid));
    expect(armor.length).toBeGreaterThan(50);
    const bp = armor.find((b) => b.components.some((c) => c.stats.length > 0))!;
    expect(bp.components[0]!.material.name).not.toMatch(/^[0-9a-f-]{36}$/); // a name, not a UUID
    expect(bp.dismantle?.returns.length).toBeGreaterThan(0);
    expect(bp.missions.length).toBeGreaterThan(0);
    const base = d.baseStats[bp.itemUuid];
    expect(base?.kind).toBe('armor');
    if (base?.kind === 'armor') expect(base.resistance.physical).toBeGreaterThan(0);

    const kinds = new Set(Object.values(d.baseStats).map((s) => s.kind));
    for (const k of ['armor', 'shield', 'weapon', 'powerplant', 'quantumdrive']) expect(kinds.has(k as never), k).toBe(true);
    const qd = Object.values(d.baseStats).find((s) => s.kind === 'quantumdrive');
    if (qd?.kind === 'quantumdrive') { expect(qd.speedMs).toBeGreaterThan(1e7); expect(qd.fuelReq10GM).toBeGreaterThan(0); }
    const pp = Object.values(d.baseStats).find((s) => s.kind === 'powerplant');
    if (pp?.kind === 'powerplant') expect(pp.powerOutput).toBeGreaterThan(0);
    const gun = Object.values(d.baseStats).find((s) => s.kind === 'weapon' && s.modes.length > 0);
    if (gun?.kind === 'weapon') expect(gun.modes[0]!.dps).toBeGreaterThan(0);
  });

  it('where materials are mined: every resource a blueprint uses has a source, with real place names (v1.26.0)', async () => {
    const a = await signedIn();
    const d = (await a.get('/api/game-data/crafting').set('Accept-Encoding', 'identity').expect(200)).body.data as CraftingDataDto;
    const iron = d.materialSources['iron']!;
    expect(iron.length).toBeGreaterThan(5);
    expect(iron.find((x) => x.place === 'Adir')).toMatchObject({ system: 'Pyro', method: 'ship' });
    const used = new Set(d.blueprints.flatMap((b) => b.components.filter((c) => c.material.kind === 'resource').map((c) => c.material.name.toLowerCase())));
    const without = [...used].filter((m) => !d.materialSources[m]?.length);
    expect(without).toEqual([]);
    const places = Object.values(d.materialSources).flat().map((x) => x.place);
    expect(places.some((p) => p.startsWith('<=') || /^HPP_|^Loot_/.test(p))).toBe(false);
  });

  it('every mission blueprint in the contracts exists, and every obtainable one is in a contract', async () => {
    const a = await signedIn();
    const d = (await a.get('/api/game-data/crafting').set('Accept-Encoding', 'identity').expect(200)).body.data as CraftingDataDto;
    const inContracts = new Set(d.missions.flatMap((m) => m.pools.flatMap((p) => p.blueprints.map((b) => b.blueprintUuid))));
    for (const u of d.obtainableUuids) expect(inContracts.has(u)).toBe(true);
    const placeholders = d.blueprints.filter((b) => b.name.includes('PLACEHOLDER'));
    expect(placeholders).toHaveLength(0);
  });
});
