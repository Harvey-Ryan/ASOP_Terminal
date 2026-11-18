// v1.44.0: Game Tools data is public and built once per game build.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { gunzipSync } from 'node:zlib';
import { createServer } from '../server/app.js';
import { buildGameToolsData, resetGameToolsCache } from '../server/routes/gameTools.js';

const app = createServer();

const gunRow = (uuid: string, name: string, alpha: number) => ({
  uuid, class_name: name, name, manufacturer_name: 'Maker', size: 3, grade: 1,
  data: { stdItem: { Weapon: { Damage: { Burst: 500, Sustained: 300, AlphaTotal: alpha, Alpha: { Energy: alpha } } } } },
});
const shipRow = {
  uuid: 'ship-1', class_name: 'TEST_Fighter', name: 'Test Fighter', manufacturer_name: 'Test', career: 'Combat', role: 'Light Fighter', size: 2, crew: 1,
  data: {
    ShieldsTotal: { Hp: 3000, Regen: 500 },
    Armor: { DamageMultipliers: { Physical: 0.75, Energy: 0.6 }, Deflection: { Physical: 10, Energy: 8 } },
    DamageBeforeDestruction: [{ Name: 'Body', HP: 2000 }],
    Loadout: [{ HardpointName: 'hardpoint_gun_nose', Type: 'WeaponGun.Gun', UUID: 'skin', MaxSize: 3, MinSize: 3, CompatibleTypes: [{ Type: 'WeaponGun' }] }],
  },
};

function fakeQuery(sql: string): Promise<unknown> {
  if (sql.includes('scdata.source')) return Promise.resolve([{ commit: 'abc', build: '4.x-TEST' }]);
  if (sql.includes('scdata.ships')) return Promise.resolve([shipRow]);
  // A gun and its skin with the same numbers, plus one that's different.
  return Promise.resolve([gunRow('plain', 'Laser', 40), gunRow('skin', 'Laser Hazard-Zone', 40), gunRow('other', 'Cannon', 400)]);
}

describe('Game Tools data', () => {
  beforeEach(() => resetGameToolsCache());

  it('is public: no sign-in needed', async () => {
    const res = await request(app).get('/api/game-tools/data');
    expect(res.status).not.toBe(401);
    expect([200, 503]).toContain(res.status);
  });

  it('groups skins and points stock guns at the gun that is shown', async () => {
    const built = await buildGameToolsData(fakeQuery as never, async () => []);
    expect(built).not.toBeNull();
    const data = built!.data;
    expect(data.build).toBe('4.x-TEST');
    expect(data.guns.map((g) => g.name).sort()).toEqual(['Cannon', 'Laser']);
    expect(data.guns.find((g) => g.name === 'Laser')!.variants).toBe(1);
    const ship = data.ships[0]!;
    expect(ship.gunSlots).toHaveLength(1);
    expect(ship.gunSlots[0]!.stockGunUuid).toBe('plain');
    expect(ship.hullHp).toBe(2000);
    // Sent gzipped as the same JSON.
    const body = JSON.parse(gunzipSync(built!.gz).toString());
    expect(body.data.ships[0].name).toBe('Test Fighter');
    expect(built!.etag).toMatch(/^"gt-/);
  });

  it('no game data yet: nothing to build', async () => {
    const built = await buildGameToolsData((async (sql: string) => (sql.includes('source') ? [] : [])) as never, async () => []);
    expect(built).toBeNull();
  });
});
