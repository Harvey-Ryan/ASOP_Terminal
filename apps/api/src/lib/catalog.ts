// Game item catalog for the API: names and details from the sc-data tables,
// commodity prices from UEX. Shared logic and SQL: packages/shared/src/catalog.ts.

import {
  createCatalogStore,
  CATALOG_VERSION_SQL,
  INVENTORY_LINK_SQL,
  INVENTORY_LINK_STATUS_SQL,
  type CatalogDetail,
  type CatalogIndex,
  type InventoryLinkStatus,
} from '@dem/shared';
import { prisma } from './prisma.js';

const store = createCatalogStore(prisma, {
  onLoad: (index, version, previous) => {
    console.log(`[catalog] Loaded ${index.entries.length} items and commodities from game data ${version.slice(0, 12)}`);
    // New game data can make older inventory entries linkable.
    if (previous) void linkInventory().catch((err) => console.error('[catalog] Linking inventory failed:', err));
  },
});

async function currentVersion(): Promise<string | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ commit: string }[]>(CATALOG_VERSION_SQL);
    return rows[0]?.commit ?? null;
  } catch {
    return null; // sc-data not set up yet
  }
}

/** The catalog index, reloaded when sc-data has synced a new commit (checked every 5 minutes). */
export const getCatalog = (): Promise<CatalogIndex> => store.get();
export const getCatalogDetail = (ref: string): Promise<CatalogDetail | null> => store.detail(ref);

// ── Inventory linking ────────────────────────────────────────────────────────

/** Links unlinked inventory entries (or just `entryId`) to their game item. Returns rows linked. */
export async function linkInventory(entryId: string | null = null): Promise<number> {
  if (!(await currentVersion())) return 0;
  let linked = 0;
  for (const sql of INVENTORY_LINK_SQL) linked += await prisma.$executeRawUnsafe(sql, entryId);
  return linked;
}

export async function inventoryLinkStatus(): Promise<InventoryLinkStatus> {
  const rows = await prisma.$queryRawUnsafe<{ total: number; linked: number; unlinked_names: string[] }[]>(INVENTORY_LINK_STATUS_SQL);
  const r = rows[0] ?? { total: 0, linked: 0, unlinked_names: [] };
  return { total: r.total, linked: r.linked, unlinkedNames: r.unlinked_names };
}

/** Run once at start-up: link what can be linked and say what couldn't. */
export async function linkInventoryOnStartup(): Promise<void> {
  try {
    await getCatalog();
    const linked = await linkInventory();
    const s = await inventoryLinkStatus();
    const missing = s.total - s.linked;
    console.log(`[catalog] Inventory linked to game items: ${s.linked}/${s.total}${linked ? ` (${linked} just now)` : ''}` +
      (missing ? `; not linked: ${s.unlinkedNames.slice(0, 20).join(', ')}${s.unlinkedNames.length > 20 ? ` +${s.unlinkedNames.length - 20} more` : ''}` : ''));
  } catch (err) {
    console.error('[catalog] Start-up inventory linking failed:', err instanceof Error ? err.message : err);
  }
}

// ── Identifying an inventory item ────────────────────────────────────────────

/**
 * Game UUID for an item picked from the older UEX pickers: the game UUID UEX
 * stores for items, else an exact name match. Null when neither is in the catalog.
 */
export async function resolveUexItem(
  itemType: 'ITEM' | 'COMMODITY',
  externalItemId: number | null,
  itemName: string | null,
): Promise<string | null> {
  const catalog = await getCatalog();
  if (itemType === 'ITEM' && externalItemId) {
    const uex = await prisma.uexItem.findUnique({ where: { id: externalItemId }, select: { uuid: true, name: true } });
    const byUuid = uex?.uuid ? catalog.get(`ITEM:${uex.uuid}`) : undefined;
    if (byUuid) return byUuid.uuid;
    itemName ??= uex?.name ?? null;
  }
  if (itemType === 'COMMODITY' && externalItemId && !itemName) {
    itemName = (await prisma.uexCommodity.findUnique({ where: { id: externalItemId }, select: { name: true } }))?.name ?? null;
  }
  return itemName ? catalog.findByName(itemName, itemType)?.uuid ?? null : null;
}

/**
 * Prisma filter for "entries of this item": linked entries by game UUID, plus
 * older entries by UEX id, plus unlinked entries with exactly the same name.
 */
export function sameItemWhere(
  itemType: 'ITEM' | 'COMMODITY',
  itemUuid: string | null,
  externalItemId: number | null,
  itemName: string | null,
) {
  const or: object[] = [];
  if (itemUuid) or.push({ itemUuid });
  if (externalItemId) or.push({ externalItemId });
  if (itemName) or.push({ itemUuid: null, itemName: { equals: itemName, mode: 'insensitive' as const } });
  return { itemType, OR: or.length ? or : [{ id: '__none__' }] };
}
