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
    QuantumTravel: { FuelCapacity: 600 },
    Loadout: [
      { HardpointName: 'hardpoint_gun_nose', Type: 'WeaponGun.Gun', UUID: 'skin', MaxSize: 3, MinSize: 3, CompatibleTypes: [{ Type: 'WeaponGun' }] },
      { HardpointName: 'hardpoint_shield_left', Type: 'Shield.UNDEFINED', UUID: 'shield-copy', MaxSize: 1, MinSize: 1, Editable: true, CompatibleTypes: [{ Type: 'Shield' }] },
      { HardpointName: 'hardpoint_power_plant', Type: 'PowerPlant.Power', UUID: 'bespoke-power', MaxSize: 1, MinSize: 1, Editable: false, CompatibleTypes: [{ Type: 'PowerPlant' }] },
      // v1.47.0: a rack of two size 3 missiles (a skin copy), and a decoy launcher.
      { HardpointName: 'hardpoint_missile_rack', Type: 'MissileLauncher.MissileRack', Name: 'MSD-423 Missile Rack', MaxSize: 4, Loadout: [
        { HardpointName: 'missile_01_attach', Type: 'Missile.Missile', UUID: 'tb-copy', MaxSize: 3 },
        { HardpointName: 'missile_02_attach', Type: 'Missile.Missile', UUID: 'tb-copy', MaxSize: 3 },
      ] },
      { HardpointName: 'hardpoint_cm', Type: 'WeaponDefensive.CountermeasureLauncher', UUID: 'decoys' },
    ],
  },
};
// v1.46.0: two copies of one shield, a power plant only this ship has, and one nobody has.
const componentRow = (uuid: string, name: string, type: string, extra: Record<string, unknown>, graded = true) => ({
  uuid, class_name: name, name, manufacturer_name: 'Maker', size: 1,
  data: { stdItem: { Type: type, Size: 1, DescriptionData: graded ? { Class: 'Military', Grade: 'A' } : {}, ...extra } },
});
const componentRows = [
  componentRow('shield', 'Wall', 'Shield.UNDEFINED', { Shield: { MaxShieldHealth: 3000, MaxShieldRegen: 500 } }),
  componentRow('shield-copy', 'Wall', 'Shield.UNDEFINED', { Shield: { MaxShieldHealth: 3000, MaxShieldRegen: 500 } }),
  componentRow('bespoke-power', 'Main Powerplant', 'PowerPlant.Power', { ResourceNetwork: { Generation: { Power: 20 } } }, false),
  componentRow('unused-power', 'Prototype', 'PowerPlant.Power', { ResourceNetwork: { Generation: { Power: 30 } } }, false),
];

function fakeQuery(sql: string): Promise<unknown> {
  if (sql.includes('scdata.source')) return Promise.resolve([{ commit: 'abc', build: '4.x-TEST' }]);
  if (sql.includes('scdata.ships')) return Promise.resolve([shipRow]);
  if (sql.includes("'Shield'")) return Promise.resolve(componentRows);
  if (sql.includes("'Missile'")) return Promise.resolve(['tb', 'tb-copy'].map((uuid) => ({ uuid, class_name: uuid, name: 'Thunderbolt III Missile', manufacturer_name: 'FireStorm Kinetics', size: 3,
    data: { stdItem: { Missile: { DamageTotal: 2900, Damage: { Physical: 2900 }, Targeting: { LockTime: 1, TrackingSignalType: 'Electromagnetic' } } } } })));
  if (sql.includes("'WeaponDefensive'")) return Promise.resolve([{ uuid: 'decoys', class_name: 'cml', name: 'Decoy Launcher', manufacturer_name: null, size: 1, data: { stdItem: { WeaponDefensive: { Type: 'Flare', Capacity: 48 } } } }]);
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
    // Components: copies grouped, stock pointed at the shown one, parts nobody can get only where they're stock.
    expect(data.components.map((c) => c.name).sort()).toEqual(['Main Powerplant', 'Wall']);
    expect(ship.componentSlots.map((s) => [s.kind, s.stockUuid, s.locked])).toEqual([['shield', 'shield', false], ['power', 'bespoke-power', true]]);
    expect(ship.qtFuelCapacity).toBe(600);
    // Missiles: copies grouped, the rack pointed at the shown one; countermeasures counted.
    expect(data.missiles!.map((m) => m.name)).toEqual(['Thunderbolt III']);
    expect(ship.missileRacks!.map((r) => [r.name, r.missileSize, r.count, r.stockMissileUuid])).toEqual([['MSD-423 Missile Rack', 3, 2, 'tb']]);
    expect(ship.countermeasures).toEqual({ decoy: 48, noise: 0 });
    // Sent gzipped as the same JSON.
    const body = JSON.parse(gunzipSync(built!.gz).toString());
    expect(body.data.ships[0].name).toBe('Test Fighter');
    expect(built!.etag).toMatch(/^"gt-/);
  });

  it('says which tools are hidden for every server, without sign-in (v1.46.0)', async () => {
    const res = await request(app).get('/api/game-tools/hidden');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.hidden)).toBe(true);
  });

  it('no game data yet: nothing to build', async () => {
    const built = await buildGameToolsData((async (sql: string) => (sql.includes('source') ? [] : [])) as never, async () => []);
    expect(built).toBeNull();
  });
});
