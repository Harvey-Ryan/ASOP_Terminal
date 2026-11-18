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
  GAME_TOOLS_GUNS_SQL, GAME_TOOLS_SHIPS_SQL, GAME_TOOLS_COMPONENTS_SQL,
  type ApiResponse, type CombatGun, type GameToolsDataDto, type GameToolsShip, type ShipComponent,
} from '@dem/shared';
import { prisma } from '../../lib/prisma.js';
import { listShips } from '../../lib/shipCatalog.js';

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

  const [shipRows, gunRows, componentRows] = await Promise.all([
    query<Row[]>(GAME_TOOLS_SHIPS_SQL),
    query<Row[]>(GAME_TOOLS_GUNS_SQL),
    query<Row[]>(GAME_TOOLS_COMPONENTS_SQL),
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

  const catalog = await catalogFn().catch((err: unknown) => { console.warn('[game-tools] No ship pictures:', err); return []; });
  const index = catalog.length ? shipIndex(catalog) : null;

  const ships: GameToolsShip[] = [];
  for (const row of shipRows) {
    const s = combatShipFromRow(row);
    if (!s) continue;
    for (const slot of s.gunSlots) if (slot.stockGunUuid) slot.stockGunUuid = rep.get(slot.stockGunUuid) ?? null;
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
  const data: GameToolsDataDto = { build: source.build, commit: source.commit, ships, guns, components };
  const body = Buffer.from(JSON.stringify({ success: true, data } satisfies ApiResponse<GameToolsDataDto>));
  return {
    commit: source.commit, at: Date.now(), data,
    gz: gzipSync(body, { level: 9 }),
    etag: `"gt-${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`,
  };
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
