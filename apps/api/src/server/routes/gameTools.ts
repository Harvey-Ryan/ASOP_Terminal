// Game Tools (v1.44.0): every flying ship's guns and defences, and every
// ship gun, for the public Loadout, Optimizer and Ships pages. No sign-in:
// it's all game-file data. Components (shields, power, coolers, quantum,
// radar) since v1.46.0. Built once per sc-data commit and sent gzipped;
// the website does the maths (packages/shared/src/combat.ts).

import { Router } from 'express';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  isDownloadItem,
  isDownloadSource,
  utcDay,
  combatGunFromItem,
  combatShipFromRow,
  auditShipWeapons,
  type ShipWeaponAudit,
  type AdminWeaponAuditDto,
  dedupeGuns,
  gunGroupKey,
  isUnavailableGun,
  isGameDataMissingError,
  shipIndex,
  matchShip,
  shipComponentFromItem,
  dedupeComponents,
  componentGroupKey,
  missileFromItem,
  dedupeMissiles,
  missileGroupKey,
  salvageModuleFromItem,
  fuelPodFromItem,
  SALVAGE_MODULES_SQL,
  FUEL_PODS_SQL,
  type FuelPod,
  type SalvageModule,
  buildOreSpots,
  miningLaserFromItem,
  miningModuleFromItem,
  miningGadgetFromItem,
  dedupeMining,
  oreName,
  MINING_LASERS_SQL,
  MINING_MODULES_SQL,
  MINING_GADGETS_SQL,
  type MiningDataDto,
  type MiningGadget,
  type MiningLaser,
  type MiningModule,
  type ResourceLocationRow,
  type ResourceRow,
  GAME_TOOLS_GUNS_SQL,
  GAME_TOOLS_SHIPS_SQL,
  GAME_TOOLS_COMPONENTS_SQL,
  GAME_TOOLS_MISSILES_SQL,
  type ApiResponse,
  type CombatGun,
  type GameBuildDto,
  type GameToolsDataDto,
  type GameToolsShip,
  type MissileItem,
  type RefineryDataDto,
  type ShipComponent,
} from '@dem/shared';
import { prisma } from '../../lib/prisma.js';
import { listShips } from '../../lib/shipCatalog.js';
import { hiddenModules } from '../../lib/hiddenModules.js';
import { checkUpstreamNow } from '../../lib/gameDataCheck.js';
import { refineryData } from '../../lib/refineryData.js';
import { reportWeaponAudit } from '../../lib/gameToolsAudit.js';

export const gameToolsRouter = Router();

type Built = {
  commit: string;
  at: number;
  data: GameToolsDataDto;
  gz: Buffer;
  etag: string;
  /** The ship weapons check (v1.63.0): our reading of every ship's guns against the files' mount list. */
  weaponAudit: { ships: number; problems: ShipWeaponAudit[] };
};
let cached: Built | null = null;
let building: Promise<Built | null> | null = null;
/**
 * Building takes several seconds, so nobody waits on it (v1.51.1): it's built
 * at start-up (`warmGameTools`), rebuilt in the background when the game data
 * moves on or the ship list refreshes (new pictures), and the old copy is
 * served meanwhile. Only a request before the very first build waits.
 */
const REBUILD_MS = 24 * 60 * 60_000;
/** How often a request checks whether the game data moved on. */
const CHECK_MS = 60_000;
let checkedAt = 0;

/** For tests: forget the cached copy. */
export function resetGameToolsCache(): void {
  cached = null;
  building = null;
  checkedAt = 0;
}

type Row = {
  uuid: string;
  class_name: string | null;
  name: string | null;
  manufacturer_name: string | null;
  size: number | null;
  grade?: number | null;
  career?: string | null;
  role?: string | null;
  crew?: number | null;
  data: Record<string, unknown>;
};

type Query = <T>(sql: string) => Promise<T>;
const prismaQuery: Query = (sql) => prisma.$queryRawUnsafe(sql);

/** `query` and `catalog` can be swapped for tests and local tools. */
export async function buildGameToolsData(
  query: Query = prismaQuery,
  catalogFn: typeof listShips = listShips,
): Promise<Built | null> {
  let source: { commit: string | null; build: string | null } | undefined;
  try {
    source = (
      await query<{ commit: string | null; build: string | null }[]>('SELECT commit, build FROM scdata.source LIMIT 1')
    )[0];
  } catch (err) {
    if (isGameDataMissingError(err)) return null;
    throw err;
  }
  if (!source?.commit) return null;

  const [shipRows, gunRows, componentRows, missileRows, launcherRows, laserRows, moduleRows, salvageRows, podRows] =
    await Promise.all([
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
  const launchers = new Map(
    launcherRows.map((r) => {
      const wd = (r.data as { stdItem?: { WeaponDefensive?: { Type?: string; Capacity?: number } } }).stdItem
        ?.WeaponDefensive;
      return [r.uuid, { type: wd?.Type ?? '', capacity: wd?.Capacity ?? 0 }];
    }),
  );

  // Mining lasers and modules (v1.50.0), grouped like the Mining page's.
  const allLasers = laserRows.map(miningLaserFromItem).filter((l): l is MiningLaser => !!l);
  const laserKey = (l: MiningLaser) => JSON.stringify([l.name, l.power, l.extraction, l.modifiers]);
  const laserGroups = dedupeMining(allLasers, (l) => [laserKey(l)]);
  const laserRepByKey = new Map(laserGroups.map((l) => [laserKey(l), l.uuid]));
  const laserRep = new Map(allLasers.map((l) => [l.uuid, laserRepByKey.get(laserKey(l)) ?? l.uuid]));
  const stockLasers = new Set<string>();
  const miningModules = dedupeMining(
    moduleRows.map(miningModuleFromItem).filter((m): m is MiningModule => !!m),
    (m) => [m.name, m.power, m.modifiers],
  ).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  // Salvage modules and fuel pods (v1.51.0). A ship's pod may be a filled copy: point it at the plain pod of that name.
  const salvageModules = salvageRows
    .map(salvageModuleFromItem)
    .filter((m): m is SalvageModule => !!m)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const fuelPods = podRows
    .map(fuelPodFromItem)
    .filter((p): p is FuelPod => !!p)
    .sort((a, b) => a.name.localeCompare(b.name));
  const podByName = new Map(fuelPods.map((p) => [p.name, p.uuid]));
  const podRep = new Map(podRows.map((r) => [r.uuid, podByName.get(r.name ?? '') ?? null]));

  const catalog = await catalogFn().catch((err: unknown) => {
    console.warn('[game-tools] No ship pictures:', err);
    return [];
  });
  const index = catalog.length ? shipIndex(catalog) : null;

  const ships: GameToolsShip[] = [];
  const audited: ShipWeaponAudit[] = [];
  for (const row of shipRows) {
    const s = combatShipFromRow(row);
    if (!s) continue;
    audited.push(auditShipWeapons({ ...row.data, ClassName: s.className, Name: s.name }));
    for (const slot of s.gunSlots) if (slot.stockGunUuid) slot.stockGunUuid = rep.get(slot.stockGunUuid) ?? null;
    for (const rack of s.missileRacks ?? [])
      if (rack.stockMissileUuid) rack.stockMissileUuid = misRep.get(rack.stockMissileUuid) ?? null;
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
  const miningLasers = laserGroups
    .filter((l) => l.size >= 1 && (!l.bespokeFor || stockLasers.has(l.uuid)))
    .sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));
  const data: GameToolsDataDto = {
    build: source.build,
    commit: source.commit,
    ships,
    guns,
    components,
    missiles,
    miningLasers,
    miningModules,
    salvageModules,
    fuelPods,
  };
  const body = Buffer.from(JSON.stringify({ success: true, data } satisfies ApiResponse<GameToolsDataDto>));
  return {
    commit: source.commit,
    at: Date.now(),
    data,
    gz: gzipSync(body, { level: 9 }),
    etag: `"gt-${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`,
    weaponAudit: { ships: audited.length, problems: audited.filter((a) => a.issues.length) },
  };
}

/** The last ship weapons check, for the admin panel (null before the first build). */
export function currentWeaponAudit(): AdminWeaponAuditDto | null {
  if (!cached) return null;
  return {
    build: cached.data.build,
    commit: cached.commit,
    checkedAt: new Date(cached.at).toISOString(),
    ...cached.weaponAudit,
  };
}

const COUNTERMEASURE_SQL = `
  SELECT uuid, class_name, name, manufacturer_name, size, data
  FROM scdata.items WHERE type = 'WeaponDefensive' AND NOT is_placeholder
`;

/** Decoys (flares) and noise (chaff) a ship carries, from its launchers. */
function countermeasures(
  loadout: unknown[] | undefined,
  launchers: Map<string, { type: string; capacity: number }>,
): { decoy: number; noise: number } | null {
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

function rebuild(): Promise<Built | null> {
  building ??= buildGameToolsData()
    .then((b) => {
      if (b) {
        cached = b;
        void reportWeaponAudit(currentWeaponAudit()!).catch((err: unknown) =>
          console.warn('[game-tools] Reporting the weapons check failed:', err),
        );
      }
      return b;
    })
    .catch((err: unknown) => {
      console.error('[game-tools] Building the ship data failed:', err);
      return null;
    })
    .finally(() => {
      building = null;
    });
  return building;
}

async function getBuilt(): Promise<Built | null> {
  if (!cached) return (await rebuild()) ?? cached;
  if (Date.now() - checkedAt > CHECK_MS) {
    checkedAt = Date.now();
    // Cheap check that the game data hasn't moved on; rebuild behind the scenes if it has.
    const head = await prisma
      .$queryRawUnsafe<{ commit: string | null }[]>('SELECT commit FROM scdata.source LIMIT 1')
      .catch(() => []);
    if ((head[0]?.commit && head[0].commit !== cached.commit) || Date.now() - cached.at > REBUILD_MS) void rebuild();
  }
  return cached;
}

/** Build the ship and mining data now (start-up, and after the ship list refreshes) so no visitor waits for it. */
export function warmGameTools(): Promise<unknown> {
  return Promise.all([rebuild(), rebuildMining()]);
}

/** For the bot and other server code: the same data, uncompressed. */
export async function getGameToolsData(): Promise<GameToolsDataDto | null> {
  return (await getBuilt())?.data ?? null;
}

gameToolsRouter.get('/game-tools/data', async (req, res) => {
  const b = await getBuilt();
  if (!b) {
    res
      .status(503)
      .json({ success: false, error: 'Game data isn’t loaded yet. Try again in a few minutes.' } satisfies ApiResponse);
    return;
  }
  res.setHeader('ETag', b.etag);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Vary', 'Accept-Encoding');
  if (req.headers['if-none-match'] === b.etag) {
    res.status(304).end();
    return;
  }
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
  res.json({ success: true, data: { hidden: TOOL_MODULES.filter((m) => hidden.has(m)) } } satisfies ApiResponse<{
    hidden: string[];
  }>);
});

// ── Mining (v1.49.0) ─────────────────────────────────────────────────────────
// GET /api/game-tools/mining: the ore finder's places, rock signatures, mining
// lasers, modules and gadgets (v1.52.0). Public; built once per game build, sent gzipped.

type MiningBuilt = { commit: string; at: number; gz: Buffer; etag: string; data: MiningDataDto };
let miningCached: MiningBuilt | null = null;
let miningBuilding: Promise<MiningBuilt | null> | null = null;

export function resetMiningCache(): void {
  miningCached = null;
  miningBuilding = null;
}

/** For tests: mining data to use instead of scdata (null = back to scdata). */
let testMining: MiningDataDto | null = null;
export function useMiningDataForTests(data: MiningDataDto | null): void {
  testMining = data;
}

/** The mining data, built if need be (corrections read game values from it, v1.53.0). */
export async function getMiningData(): Promise<MiningDataDto | null> {
  if (testMining) return testMining;
  if (!miningCached) await rebuildMining();
  return miningCached?.data ?? null;
}

export async function buildMiningData(query: Query = prismaQuery): Promise<MiningBuilt | null> {
  let source: { commit: string | null; build: string | null } | undefined;
  try {
    source = (
      await query<{ commit: string | null; build: string | null }[]>('SELECT commit, build FROM scdata.source LIMIT 1')
    )[0];
  } catch (err) {
    if (isGameDataMissingError(err)) return null;
    throw err;
  }
  if (!source?.commit) return null;
  const [locations, resources, laserRows, moduleRows, gadgetRows] = await Promise.all([
    query<ResourceLocationRow[]>('SELECT provider_name, data FROM scdata.resource_locations'),
    query<ResourceRow[]>('SELECT data FROM scdata.resources'),
    query<Row[]>(MINING_LASERS_SQL),
    query<Row[]>(MINING_MODULES_SQL),
    query<Row[]>(MINING_GADGETS_SQL),
  ]);
  const { spots, signatures } = buildOreSpots(locations, resources);
  const lasers = dedupeMining(
    laserRows.map(miningLaserFromItem).filter((l): l is MiningLaser => !!l),
    (l) => [l.name, l.power, l.extraction, l.modifiers],
  ).sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));
  const modules = dedupeMining(
    moduleRows.map(miningModuleFromItem).filter((m): m is MiningModule => !!m),
    (m) => [m.name, m.power, m.modifiers],
  ).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const gadgets = dedupeMining(
    gadgetRows.map(miningGadgetFromItem).filter((g): g is MiningGadget => !!g),
    (g) => [g.name, g.modifiers],
  ).sort((a, b) => a.name.localeCompare(b.name));
  const ores = [...new Set(spots.map((s) => s.ore))].sort().map((key) => ({ key, name: oreName(key) }));
  const data: MiningDataDto = { build: source.build, ores, spots, signatures, lasers, modules, gadgets };
  const body = Buffer.from(JSON.stringify({ success: true, data } satisfies ApiResponse<MiningDataDto>));
  return {
    commit: source.commit,
    at: Date.now(),
    data,
    gz: gzipSync(body, { level: 9 }),
    etag: `"gm-${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`,
  };
}

function rebuildMining(): Promise<MiningBuilt | null> {
  miningBuilding ??= buildMiningData()
    .then((b) => {
      if (b) miningCached = b;
      return b;
    })
    .catch((err: unknown) => {
      console.error('[game-tools] mining data:', err);
      return null;
    })
    .finally(() => {
      miningBuilding = null;
    });
  return miningBuilding;
}

gameToolsRouter.get('/game-tools/mining', async (req, res) => {
  if (!miningCached) await rebuildMining();
  else if (Date.now() - miningCached.at > REBUILD_MS || (cached && cached.commit !== miningCached.commit))
    void rebuildMining();
  const b = miningCached;
  if (!b) {
    res
      .status(503)
      .json({ success: false, error: 'Game data isn’t loaded yet. Try again in a few minutes.' } satisfies ApiResponse);
    return;
  }
  res.setHeader('ETag', b.etag);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Vary', 'Accept-Encoding');
  if (req.headers['if-none-match'] === b.etag) {
    res.status(304).end();
    return;
  }
  res.type('application/json');
  if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    res.setHeader('Content-Encoding', 'gzip');
    res.send(b.gz);
  } else {
    res.json({ success: true, data: b.data } satisfies ApiResponse<MiningDataDto>);
  }
});

// ── Refinery calculator (v1.58.0) ───────────────────────────────────────────
// GET /api/game-tools/refinery: UEX's player-reported refinery yield bonuses
// and raw/refined sell prices (lib/refineryData.ts, refreshed every 30 min).
// Public, like the rest of Mining.

gameToolsRouter.get('/game-tools/refinery', async (_req, res) => {
  const data = await refineryData();
  if (!data) {
    res.status(503).json({
      success: false,
      error: "UEX's refinery data can't be reached right now. Try again in a few minutes.",
    } satisfies ApiResponse);
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ success: true, data } satisfies ApiResponse<RefineryDataDto>);
});

// ── Build badge (v1.53.0) ────────────────────────────────────────────────────
// GET /api/game-tools/build: which game build the tools show, when we last
// synced, and whether newer data is waiting upstream (asked at most every
// 30 minutes; null when GitHub can't be reached). Public.

let buildCache: { at: number; data: GameBuildDto } | null = null;
const BUILD_CACHE_MS = 30 * 60_000;
export function resetBuildCache(): void {
  buildCache = null;
}

gameToolsRouter.get('/game-tools/build', async (_req, res) => {
  if (!buildCache || Date.now() - buildCache.at > BUILD_CACHE_MS) {
    let state: { build: string | null; synced_at: Date | null; commit: string | null } | undefined;
    try {
      state = (
        await prismaQuery<{ build: string | null; synced_at: Date | null; commit: string | null }[]>(
          'SELECT build, synced_at, commit FROM scdata_raw.state',
        )
      )[0];
    } catch (err) {
      if (!isGameDataMissingError(err)) console.warn('[game-tools/build]', (err as Error).message);
    }
    let newerAvailable: boolean | null = null;
    if (state?.commit) {
      try {
        newerAvailable = !(await checkUpstreamNow()).upToDate;
      } catch (err) {
        console.warn('[game-tools/build] upstream check:', (err as Error).message);
      }
    }
    buildCache = {
      at: Date.now(),
      data: {
        build: state?.build ?? null,
        syncedAt: state?.synced_at ? new Date(state.synced_at).toISOString() : null,
        newerAvailable,
      },
    };
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ success: true, data: buildCache.data } satisfies ApiResponse<GameBuildDto>);
});

// ── Download clicks (v1.59.0) ────────────────────────────────────────────────
// POST /api/game-tools/downloads/:item { source: 'tools' | 'dashboard' }: the
// website's download buttons (RockCrawler on the Mining page) send this as they
// start the download. It adds one to that item's count for the UTC day and page
// (DownloadClick); Admin → Overview shows the counts. Public, and nothing about
// the person is stored. The same visitor clicking the same item again within
// REPEAT_WINDOW_MS isn't counted again (double clicks, retries); that memory is
// a hashed address held in this process only, never written anywhere.

const REPEAT_WINDOW_MS = 10 * 60_000;
const REPEAT_MAX_ENTRIES = 20_000;
const recentClicks = new Map<string, number>();

/** For tests: forget who clicked recently. */
export function forgetDownloadClicks(): void {
  recentClicks.clear();
}

function isRepeatClick(ip: string, item: string, now: number): boolean {
  const key = createHash('sha256').update(`${ip}|${item}`).digest('base64url').slice(0, 22);
  const last = recentClicks.get(key);
  if (last !== undefined && now - last < REPEAT_WINDOW_MS) return true;
  if (recentClicks.size >= REPEAT_MAX_ENTRIES) {
    for (const [k, at] of recentClicks) if (now - at >= REPEAT_WINDOW_MS) recentClicks.delete(k);
    if (recentClicks.size >= REPEAT_MAX_ENTRIES) recentClicks.clear();
  }
  recentClicks.set(key, now);
  return false;
}

gameToolsRouter.post('/game-tools/downloads/:item', async (req, res) => {
  const item = req.params.item;
  const source = (req.body as { source?: unknown } | undefined)?.source;
  if (!isDownloadItem(item) || !isDownloadSource(source)) {
    res.status(400).json({ success: false, error: 'Unknown download' } satisfies ApiResponse);
    return;
  }
  const now = Date.now();
  if (!isRepeatClick(req.ip ?? '', item, now)) {
    const day = utcDay(new Date(now));
    try {
      await prisma.downloadClick.upsert({
        where: { item_day_source: { item, day, source } },
        create: { item, day, source, count: 1 },
        update: { count: { increment: 1 } },
      });
    } catch (err) {
      // A missed count must never get in the way of the download itself.
      console.warn('[downloads] could not count a click:', (err as Error).message);
    }
  }
  res.status(204).end();
});
