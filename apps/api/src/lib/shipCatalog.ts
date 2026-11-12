// The ship list (v1.32.0): RSI's Ship Matrix, refreshed at start-up and daily.
// If RSI can't be reached and there's no list yet, the game files
// (scdata.ships) stand in, without images; the next good RSI refresh moves
// anyone's ships over to RSI's entries. See packages/shared/src/ships.ts.

import { parseShipMatrix, shipsFromGameFiles, shipIndex, matchShip, type ShipCatalogEntry } from '@dem/shared';
import { prisma } from './prisma.js';

export const SHIP_MATRIX_URL = 'https://robertsspaceindustries.com/ship-matrix/index';
/** Fewer than this from RSI means the answer is wrong, not that ships were removed. */
const MIN_SHIPS = 50;

let cache: { at: number; ships: ShipCatalogEntry[] } | null = null;
const CACHE_MS = 10 * 60_000;

const toEntry = (r: Awaited<ReturnType<typeof prisma.ship.findMany>>[number]): ShipCatalogEntry => ({
  id: r.id, name: r.name, manufacturer: r.manufacturer, manufacturerCode: r.manufacturerCode, type: r.type, focus: r.focus,
  size: r.size, minCrew: r.minCrew, maxCrew: r.maxCrew, cargo: r.cargo, status: r.status, imageUrl: r.imageUrl, thumbUrl: r.thumbUrl, storeUrl: r.storeUrl,
});

/** Every current ship (not retired), A–Z. Cached for a few minutes. */
export async function listShips(): Promise<ShipCatalogEntry[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.ships;
  const rows = await prisma.ship.findMany({ where: { retired: false }, orderBy: { name: 'asc' } });
  cache = { at: Date.now(), ships: rows.map(toEntry) };
  return cache.ships;
}
export function forgetShipList(): void { cache = null; }

async function fetchShipMatrix(): Promise<ShipCatalogEntry[]> {
  const res = await fetch(SHIP_MATRIX_URL, { headers: { Accept: 'application/json', 'User-Agent': 'ASOP-Terminal (Star Citizen org tools)' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`RSI ship matrix answered ${res.status}`);
  return parseShipMatrix(await res.json());
}

async function gameFileShips(): Promise<ShipCatalogEntry[]> {
  try {
    const rows = await prisma.$queryRaw<Parameters<typeof shipsFromGameFiles>[0]>`
      SELECT uuid, name, manufacturer_name, manufacturer_code, role, career, crew, is_vehicle FROM scdata.ships`;
    return shipsFromGameFiles(rows);
  } catch {
    return []; // no game data here (tests, a fresh database)
  }
}

async function save(ships: ShipCatalogEntry[], source: 'RSI' | 'GAME'): Promise<void> {
  const ids = ships.map((s) => s.id);
  await prisma.$transaction(async (tx) => {
    for (const s of ships) {
      const { id, ...data } = s;
      await tx.ship.upsert({ where: { id }, create: { id, ...data, source }, update: { ...data, source, retired: false } });
    }
    // Gone from the source: kept for whoever owns one, but not offered any more.
    await tx.ship.updateMany({ where: { source, id: { notIn: ids } }, data: { retired: true } });
  }, { timeout: 60_000 });
  forgetShipList();
}

/**
 * Re-matches owned ships that point at no ship (an import nobody could
 * place) or at a game-file stand-in, now that the list may know them.
 * Returns how many moved.
 */
export async function rematchFleetShips(): Promise<number> {
  const ships = await listShips();
  const rsi = ships.filter((s) => s.id.startsWith('rsi-'));
  if (!ships.length) return 0;
  const index = shipIndex(rsi.length ? rsi : ships);
  const loose = await prisma.fleetShip.findMany({
    where: rsi.length ? { OR: [{ shipId: null }, { shipId: { startsWith: 'game-' } }] } : { shipId: null },
    include: { ship: { select: { name: true, manufacturer: true } } },
  });
  let moved = 0;
  for (const f of loose) {
    const name = f.ship?.name ?? f.customName;
    if (!name) continue;
    const m = matchShip(name, index, f.ship?.manufacturer);
    if (m.status !== 'matched' || m.ship.id === f.shipId) continue;
    await prisma.fleetShip.update({ where: { id: f.id }, data: { shipId: m.ship.id, customName: null } });
    moved++;
  }
  return moved;
}

/**
 * Refreshes the list from RSI; with RSI unreachable and no list at all,
 * fills it from the game files. Never throws.
 */
export async function refreshShipCatalog(fetchMatrix: () => Promise<ShipCatalogEntry[]> = fetchShipMatrix): Promise<{ source: 'RSI' | 'GAME' | 'none'; count: number }> {
  try {
    const ships = await fetchMatrix();
    if (ships.length < MIN_SHIPS) throw new Error(`RSI ship matrix had only ${ships.length} ships`);
    await save(ships, 'RSI');
    // Game-file stand-ins aren't needed once RSI's list is in.
    await prisma.ship.updateMany({ where: { source: 'GAME' }, data: { retired: true } });
    forgetShipList();
    await rematchFleetShips();
    return { source: 'RSI', count: ships.length };
  } catch (err) {
    console.warn('[ships] RSI ship list refresh failed:', err instanceof Error ? err.message : err);
  }
  try {
    if (await prisma.ship.count({ where: { retired: false } })) return { source: 'none', count: 0 };
    const ships = await gameFileShips();
    if (!ships.length) return { source: 'none', count: 0 };
    await save(ships, 'GAME');
    await rematchFleetShips();
    return { source: 'GAME', count: ships.length };
  } catch (err) {
    console.error('[ships] ship list fallback failed:', err);
    return { source: 'none', count: 0 };
  }
}
