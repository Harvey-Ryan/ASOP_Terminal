// Game Tools (v1.44.0): every flying ship's guns and defences, and every
// ship gun, for the public Loadout, Optimizer and Ships pages. No sign-in:
// it's all game-file data. Components (shields, power, coolers, quantum,
// radar) since v1.46.0. Built once per sc-data commit and sent gzipped;
// the website does the maths (packages/shared/src/combat.ts).

import { Router } from 'express';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  combatGunFromItem, combatShipFromRow, dedupeGuns, gunGroupKey, isUnavailableGun, isGameDataMissingError, shipIndex, matchShip,
  shipComponentFromItem, dedupeComponents, componentGroupKey,
  missileFromItem, dedupeMissiles, missileGroupKey,
  salvageModuleFromItem, fuelPodFromItem, SALVAGE_MODULES_SQL, FUEL_PODS_SQL, type FuelPod, type SalvageModule,
  buildOreSpots, miningLaserFromItem, miningModuleFromItem, dedupeMining, oreName, MINING_LASERS_SQL, MINING_MODULES_SQL,
  type MiningDataDto, type MiningLaser, type MiningModule, type ResourceLocationRow, type ResourceRow,
  GAME_TOOLS_GUNS_SQL, GAME_TOOLS_SHIPS_SQL, GAME_TOOLS_COMPONENTS_SQL, GAME_TOOLS_MISSILES_SQL,
  type ApiResponse, type CombatGun, type GameToolsDataDto, type GameToolsShip, type MissileItem, type ShipComponent,
} from '@dem/shared';
import { prisma } from '../../lib/prisma.js';
import { listShips } from '../../lib/shipCatalog.js';
import { hiddenModules } from '../../lib/hiddenModules.js';

export const gameToolsRouter = Router();

type Built = { commit: string; at: number; data: GameToolsDataDto; gz: Buffer; etag: string };
let cached: Built | null = null;
let building: Promise<Built | null> | null = null;
/** Ship pictures can arrive after start-up (the ship list refreshes then): rebuild now and then. */
const REBUILD_MS = 60 * 60_000;

/** For tests: forget the cached copy. */
export function resetGameToolsCache(): void { cached = null; building = null; }

type Row = { uuid: string; class_name: string | null; name: string | null; manufacturer_name: string | null; size: number | null; grade?: number | null; career?: string | null; role?: string | null; crew?: number | null; data: Record<string, unknown> };

type Query = <T>(sql: string) => Promise<T>;
const prismaQuery: Query = (sql) => prisma.$queryRawUnsafe(sql);

/** `query` and `catalog` can be swapped for tests and local tools. */
export async function buildGameToolsData(query: Query = prismaQuery, catalogFn: typeof listShips = listShips): Promise<Built | null> {
  let source: { commit: string | null; build: string | null } | undefined;
  try {
    source = (await query<{ commit: string | null; build: string | null }[]>('SELECT commit, build FROM scdata.source LIMIT 1'))[0];
  } catch (err) {
    if (isGameDataMissingError(err)) return null;
    throw err;
  }
  if (!source?.commit) return null;

  const [shipRows, gunRows, componentRows, missileRows, launcherRows, laserRows, moduleRows, salvageRows, podRows] = await Promise.all([
    query<Row[]>(GAME_TOOLS_SHIPS_SQL),
    query<Row[]>(GAME_TOOLS_GUNS_SQL),
    query<Row[]>(GAME_TOOLS_COMPONENTS_SQL),
    query<Row[]>(GAME_TOOLS_MISSILES_SQL),
    query<Row[]>(COUNTERMEASURE_SQL),
    query<Row[]>(MINING_LASERS_SQL),
    query<Row[]>(MINING_MODULES_SQL),
    query<Row[]>(SALVAGE_MODULES_SQL),
    query<Row[]>(FUEL_PODS_SQL),
  ]);
  const allGuns = gunRows.map(combatGunFromItem).filter((g): g is CombatGun => !!g && !isUnavailableGun(g));
  const guns = dedupeGuns(allGuns);
  // Point every gun at the one its group is shown as.
  const key = gunGroupKey;
  const repByKey = new Map(guns.map((g) => [key(g), g.uuid]));
  const rep = new Map(allGuns.map((g) => [g.uuid, repByKey.get(key(g)) ?? g.uuid]));

  // Components (v1.46.0): identical copies grouped like the guns.
  const allComponents = componentRows.map(shipComponentFromItem).filter((c): c is ShipComponent => !!c);
  const componentGroups = dedupeComponents(allComponents);
  const compRepByKey = new Map(componentGroups.map((c) => [componentGroupKey(c), c.uuid]));
  const compRep = new Map(allComponents.map((c) => [c.uuid, compRepByKey.get(componentGroupKey(c)) ?? c.uuid]));
  const stockComponents = new Set<string>();

  // Missiles (v1.47.0), grouped the same way; countermeasure launchers by what they fire.
  const allMissiles = missileRows.map(missileFromItem).filter((m): m is MissileItem => !!m);
  const missiles = dedupeMissiles(allMissiles);
  const misRepByKey = new Map(missiles.map((m) => [missileGroupKey(m), m.uuid]));
  const misRep = new Map(allMissiles.map((m) => [m.uuid, misRepByKey.get(missileGroupKey(m)) ?? m.uuid]));
  const launchers = new Map(launcherRows.map((r) => {
    const wd = (r.data as { stdItem?: { WeaponDefensive?: { Type?: string; Capacity?: number } } }).stdItem?.WeaponDefensive;
    return [r.uuid, { type: wd?.Type ?? '', capacity: wd?.Capacity ?? 0 }];
  }));

  // Mining lasers and modules (v1.50.0), grouped like the Mining page's.
  const allLasers = laserRows.map(miningLaserFromItem).filter((l): l is MiningLaser => !!l);
  const laserKey = (l: MiningLaser) => JSON.stringify([l.name, l.power, l.extraction, l.modifiers]);
  const laserGroups = dedupeMining(allLasers, (l) => [laserKey(l)]);
  const laserRepByKey = new Map(laserGroups.map((l) => [laserKey(l), l.uuid]));
  const laserRep = new Map(allLasers.map((l) => [l.uuid, laserRepByKey.get(laserKey(l)) ?? l.uuid]));
  const stockLasers = new Set<string>();
  const miningModules = dedupeMining(moduleRows.map(miningModuleFromItem).filter((m): m is MiningModule => !!m), (m) => [m.name, m.power, m.modifiers])
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  // Salvage modules and fuel pods (v1.51.0). A ship's pod may be a filled copy: point it at the plain pod of that name.
  const salvageModules = salvageRows.map(salvageModuleFromItem).filter((m): m is SalvageModule => !!m).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const fuelPods = podRows.map(fuelPodFromItem).filter((p): p is FuelPod => !!p).sort((a, b) => a.name.localeCompare(b.name));
  const podByName = new Map(fuelPods.map((p) => [p.name, p.uuid]));
  const podRep = new Map(podRows.map((r) => [r.uuid, podByName.get(r.name ?? '') ?? null]));

  const catalog = await catalogFn().catch((err: unknown) => { console.warn('[game-tools] No ship pictures:', err); return []; });
  const index = catalog.length ? shipIndex(catalog) : null;

  const ships: GameToolsShip[] = [];
  for (const row of shipRows) {
    const s = combatShipFromRow(row);
    if (!s) continue;
    for (const slot of s.gunSlots) if (slot.stockGunUuid) slot.stockGunUuid = rep.get(slot.stockGunUuid) ?? null;
    for (const rack of s.missileRacks ?? []) if (rack.stockMissileUuid) rack.stockMissileUuid = misRep.get(rack.stockMissileUuid) ?? null;
    s.countermeasures = countermeasures((row.data as { Loadout?: unknown[] }).Loadout, launchers);
    for (const head of s.miningHeads ?? []) {
      if (!head.stockLaserUuid) continue;
      head.stockLaserUuid = laserRep.get(head.stockLaserUuid) ?? null;
      if (head.stockLaserUuid) stockLasers.add(head.stockLaserUuid);
    }
    for (const slot of s.fuelPodSlots ?? []) if (slot.stockUuid) slot.stockUuid = podRep.get(slot.stockUuid) ?? null;
    for (const slot of s.componentSlots) {
      if (!slot.stockUuid) continue;
      slot.stockUuid = compRep.get(slot.stockUuid) ?? null;
      if (slot.stockUuid) stockComponents.add(slot.stockUuid);
    }
    const shortName = s.maker && s.name.startsWith(s.maker) ? s.name.slice(s.maker.length).trim() : s.name;
    const m = index ? matchShip(shortName, index, s.maker) : null;
    const pic = m?.status === 'matched' ? m.ship : null;
    ships.push({ ...s, imageUrl: pic?.imageUrl ?? null, thumbUrl: pic?.thumbUrl ?? null });
  }
  ships.sort((a, b) => a.name.localeCompare(b.name));

  // Parts players can't get (no class or grade: bespoke and placeholder records) only where a ship comes with them.
  const components = componentGroups.filter((c) => c.available || stockComponents.has(c.uuid));
  // Lasers made for one ship only where that ship comes with them.
  const miningLasers = laserGroups.filter((l) => !l.bespokeFor || stockLasers.has(l.uuid)).sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));
  const data: GameToolsDataDto = { build: source.build, commit: source.commit, ships, guns, components, missiles, miningLasers, miningModules, salvageModules, fuelPods };
  const body = Buffer.from(JSON.stringify({ success: true, data } satisfies ApiResponse<GameToolsDataDto>));
  return {
    commit: source.commit, at: Date.now(), data,
    gz: gzipSync(body, { level: 9 }),
    etag: `"gt-${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`,
  };
}

const COUNTERMEASURE_SQL = `
  SELECT uuid, class_name, name, manufacturer_name, size, data
  FROM scdata.items WHERE type = 'WeaponDefensive' AND NOT is_placeholder
`;

/** Decoys (flares) and noise (chaff) a ship carries, from its launchers. */
function countermeasures(loadout: unknown[] | undefined, launchers: Map<string, { type: string; capacity: number }>): { decoy: number; noise: number } | null {
  let decoy = 0;
  let noise = 0;
  const walk = (ports: unknown[] | undefined) => {
    for (const p of (ports ?? []) as { UUID?: string; Type?: string; Loadout?: unknown[] }[]) {
      const l = p.UUID && String(p.Type ?? '').startsWith('WeaponDefensive') ? launchers.get(p.UUID) : undefined;
      if (l?.type === 'Flare') decoy += l.capacity;
      else if (l?.type === 'Chaff') noise += l.capacity;
      walk(p.Loadout);
    }
  };
  walk(loadout);
  return decoy || noise ? { decoy, noise } : null;
}

async function getBuilt(): Promise<Built | null> {
  if (cached && Date.now() - cached.at < REBUILD_MS) {
    // Cheap check that the game data hasn't moved on.
    const head = await prisma.$queryRawUnsafe<{ commit: string | null }[]>('SELECT commit FROM scdata.source LIMIT 1').catch(() => []);
    if (head[0]?.commit === cached.commit) return cached;
  }
  building ??= buildGameToolsData().finally(() => { building = null; });
  const b = await building;
  if (b) cached = b;
  return b;
}

/** For the bot and other server code: the same data, uncompressed. */
export async function getGameToolsData(): Promise<GameToolsDataDto | null> {
  return (await getBuilt())?.data ?? null;
}

gameToolsRouter.get('/game-tools/data', async (req, res) => {
  const b = await getBuilt();
  if (!b) {
    res.status(503).json({ success: false, error: 'Game data isn’t loaded yet. Try again in a few minutes.' } satisfies ApiResponse);
    return;
  }
  res.setHeader('ETag', b.etag);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Vary', 'Accept-Encoding');
  if (req.headers['if-none-match'] === b.etag) { res.status(304).end(); return; }
  res.type('application/json');
  if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    res.setHeader('Content-Encoding', 'gzip');
    res.send(b.gz);
  } else {
    res.json({ success: true, data: b.data } satisfies ApiResponse<GameToolsDataDto>);
  }
});

// v1.46.0: which of the tools the public site links to a platform admin hid for
// every server (Admin → Modules), so its tabs match the sidebar. Public.
const TOOL_MODULES = ['craftingEnabled', 'blueprintsEnabled', 'wikeloEnabled'] as const;
gameToolsRouter.get('/game-tools/hidden', async (_req, res) => {
  const hidden = await hiddenModules();
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ success: true, data: { hidden: TOOL_MODULES.filter((m) => hidden.has(m)) } } satisfies ApiResponse<{ hidden: string[] }>);
});

// ── Mining (v1.49.0) ─────────────────────────────────────────────────────────
// GET /api/game-tools/mining: the ore finder's places, rock signatures, mining
// lasers and modules. Public; built once per game build, sent gzipped.

type MiningBuilt = { commit: string; at: number; gz: Buffer; etag: string; data: MiningDataDto };
let miningCached: MiningBuilt | null = null;
let miningBuilding: Promise<MiningBuilt | null> | null = null;

export function resetMiningCache(): void { miningCached = null; miningBuilding = null; }

export async function buildMiningData(query: Query = prismaQuery): Promise<MiningBuilt | null> {
  let source: { commit: string | null; build: string | null } | undefined;
  try {
    source = (await query<{ commit: string | null; build: string | null }[]>('SELECT commit, build FROM scdata.source LIMIT 1'))[0];
  } catch (err) {
    if (isGameDataMissingError(err)) return null;
    throw err;
  }
  if (!source?.commit) return null;
  const [locations, resources, laserRows, moduleRows] = await Promise.all([
    query<ResourceLocationRow[]>('SELECT provider_name, data FROM scdata.resource_locations'),
    query<ResourceRow[]>('SELECT data FROM scdata.resources'),
    query<Row[]>(MINING_LASERS_SQL),
    query<Row[]>(MINING_MODULES_SQL),
  ]);
  const { spots, signatures } = buildOreSpots(locations, resources);
  const lasers = dedupeMining(laserRows.map(miningLaserFromItem).filter((l): l is MiningLaser => !!l), (l) => [l.name, l.power, l.extraction, l.modifiers])
    .sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));
  const modules = dedupeMining(moduleRows.map(miningModuleFromItem).filter((m): m is MiningModule => !!m), (m) => [m.name, m.power, m.modifiers])
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const ores = [...new Set(spots.map((s) => s.ore))].sort().map((key) => ({ key, name: oreName(key) }));
  const data: MiningDataDto = { build: source.build, ores, spots, signatures, lasers, modules };
  const body = Buffer.from(JSON.stringify({ success: true, data } satisfies ApiResponse<MiningDataDto>));
  return {
    commit: source.commit, at: Date.now(), data,
    gz: gzipSync(body, { level: 9 }),
    etag: `"gm-${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`,
  };
}

gameToolsRouter.get('/game-tools/mining', async (req, res) => {
  if (!miningCached || Date.now() - miningCached.at > REBUILD_MS) {
    miningBuilding ??= buildMiningData().finally(() => { miningBuilding = null; });
    const b = await miningBuilding.catch((err: unknown) => { console.error('[game-tools] mining data:', err); return null; });
    if (b) miningCached = b;
  }
  const b = miningCached;
  if (!b) {
    res.status(503).json({ success: false, error: 'Game data isn’t loaded yet. Try again in a few minutes.' } satisfies ApiResponse);
    return;
  }
  res.setHeader('ETag', b.etag);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Vary', 'Accept-Encoding');
  if (req.headers['if-none-match'] === b.etag) { res.status(304).end(); return; }
  res.type('application/json');
  if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    res.setHeader('Content-Encoding', 'gzip');
    res.send(b.gz);
  } else {
    res.json({ success: true, data: b.data } satisfies ApiResponse<MiningDataDto>);
  }
});
