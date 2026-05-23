import { prisma } from './prisma.js';

const UEX_BASE = 'https://api.uexcorp.uk/2.0';

// ── Raw API shapes ────────────────────────────────────────────────────────────

interface UexRawCategory {
  id: number;
  type: string;
  section: string;
  name: string;
  date_modified: number | string;
}

interface UexRawItem {
  id: number;
  name: string;
  slug?: string | null;
  uuid?: string | null;
  section?: string | null;
  id_category: number;
  category?: string | null;
  size?: string | null;
  is_commodity: number;
  is_harvestable: number;
  game_version?: string | null;
  date_modified: number | string;
}

interface UexRawAttribute {
  id_item: number;
  attribute: string;
  value: string;
  unit: string;
}

interface UexRawCommodity {
  id: number;
  name: string;
  code: string;
  slug?: string | null;
  weight_scu?: number | null;
  price_buy_avg?: number | null;
  price_sell_avg?: number | null;
  is_mineral: number;
  is_raw: number;
  is_refined: number;
  is_harvestable: number;
  is_fuel: number;
  is_illegal: number;
  date_modified: number | string;
}

type SyncCounts = {
  categoriesAdded: number;
  categoriesUpdated: number;
  itemsAdded: number;
  itemsUpdated: number;
  commoditiesAdded: number;
  commoditiesUpdated: number;
};

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function uexFetch<T>(endpoint: string): Promise<T[]> {
  const key = process.env.UEX_KEY;
  if (!key) throw new Error('UEX_KEY environment variable is not set');

  const res = await fetch(`${UEX_BASE}${endpoint}`, {
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
  });

  if (res.status === 429) throw new Error('UEX rate limit reached — try again later');
  if (!res.ok) throw new Error(`UEX API ${endpoint} returned HTTP ${res.status}`);

  const json = await res.json() as {
    status: string;
    data?: T | T[];
    message?: string;
  };

  if (json.status === 'requests_limit_reached') throw new Error('UEX daily request limit reached');
  if (json.status !== 'ok') throw new Error(`UEX API error on ${endpoint}: ${json.message ?? json.status}`);

  if (!json.data) return [];
  return Array.isArray(json.data) ? json.data : [json.data];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// UEX returns date_modified as a Unix timestamp integer in some endpoints.
function normDate(v: number | string): string {
  return String(v);
}

// ── Phase 1: Categories ───────────────────────────────────────────────────────

async function syncCategories(raw: UexRawCategory[]): Promise<Pick<SyncCounts, 'categoriesAdded' | 'categoriesUpdated'>> {
  const existing = await prisma.uexCategory.findMany({ select: { id: true, dateModified: true } });
  const existingMap = new Map(existing.map((c) => [c.id, c.dateModified]));

  let added = 0;
  let updated = 0;

  for (const cat of raw) {
    const prev = existingMap.get(cat.id);

    if (prev === undefined) {
      await prisma.uexCategory.create({
        data: { id: cat.id, type: cat.type, section: cat.section, name: cat.name, dateModified: normDate(cat.date_modified) },
      });
      added++;
    } else if (prev !== normDate(cat.date_modified)) {
      await prisma.uexCategory.update({
        where: { id: cat.id },
        data: { type: cat.type, section: cat.section, name: cat.name, dateModified: normDate(cat.date_modified) },
      });
      updated++;
    }
  }

  return { categoriesAdded: added, categoriesUpdated: updated };
}

// ── Phase 2+3: Items + Attributes ─────────────────────────────────────────────

async function syncItems(
  raw: UexRawItem[],
  attrMap: Map<number, { name: string; value: string; unit: string }[]>,
): Promise<Pick<SyncCounts, 'itemsAdded' | 'itemsUpdated'>> {
  const existing = await prisma.uexItem.findMany({ select: { id: true, dateModified: true } });
  const existingMap = new Map(existing.map((i) => [i.id, i.dateModified]));
  const freshIds = new Set(raw.map((i) => i.id));

  let added = 0;
  let updated = 0;

  for (const item of raw) {
    const prev = existingMap.get(item.id);
    const attributes = JSON.stringify(attrMap.get(item.id) ?? []);
    const data = {
      name:          item.name,
      slug:          item.slug ?? '',
      uuid:          item.uuid ?? null,
      section:       item.section ?? null,
      categoryId:    item.id_category,
      categoryName:  item.category ?? '',
      size:          item.size ?? null,
      isCommodity:   item.is_commodity === 1,
      isHarvestable: item.is_harvestable === 1,
      gameVersion:   item.game_version ?? null,
      attributes,
      dateModified:  normDate(item.date_modified),
      isActive:      true,
    };

    if (prev === undefined) {
      await prisma.uexItem.create({ data: { id: item.id, ...data } });
      added++;
    } else if (prev !== normDate(item.date_modified)) {
      await prisma.uexItem.update({ where: { id: item.id }, data });
      updated++;
    }
  }

  // Soft-deactivate items that have disappeared from the API
  await prisma.uexItem.updateMany({
    where: { isActive: true, id: { notIn: [...freshIds] } },
    data: { isActive: false },
  });

  return { itemsAdded: added, itemsUpdated: updated };
}

// ── Phase 4: Commodities ──────────────────────────────────────────────────────

async function syncCommodities(raw: UexRawCommodity[]): Promise<Pick<SyncCounts, 'commoditiesAdded' | 'commoditiesUpdated'>> {
  const existing = await prisma.uexCommodity.findMany({ select: { id: true, dateModified: true } });
  const existingMap = new Map(existing.map((c) => [c.id, c.dateModified]));
  const freshIds = new Set(raw.map((c) => c.id));

  let added = 0;
  let updated = 0;

  for (const com of raw) {
    const prev = existingMap.get(com.id);
    const data = {
      name:          com.name,
      code:          com.code ?? '',
      slug:          com.slug ?? '',
      weightScu:     com.weight_scu ?? null,
      priceAvgBuy:   com.price_buy_avg ?? null,
      priceAvgSell:  com.price_sell_avg ?? null,
      isMineral:     com.is_mineral === 1,
      isRaw:         com.is_raw === 1,
      isRefined:     com.is_refined === 1,
      isHarvestable: com.is_harvestable === 1,
      isFuel:        com.is_fuel === 1,
      isIllegal:     com.is_illegal === 1,
      dateModified:  normDate(com.date_modified),
      isActive:      true,
    };

    if (prev === undefined) {
      await prisma.uexCommodity.create({ data: { id: com.id, ...data } });
      added++;
    } else if (prev !== normDate(com.date_modified)) {
      await prisma.uexCommodity.update({ where: { id: com.id }, data });
      updated++;
    }
  }

  await prisma.uexCommodity.updateMany({
    where: { isActive: true, id: { notIn: [...freshIds] } },
    data: { isActive: false },
  });

  return { commoditiesAdded: added, commoditiesUpdated: updated };
}

// ── Core sync pipeline ────────────────────────────────────────────────────────

async function doSync(): Promise<SyncCounts> {
  // 1. Categories
  console.log('[uex] Fetching categories…');
  const rawCats = await uexFetch<UexRawCategory>('/categories?type=item');
  const catCounts = await syncCategories(rawCats);
  console.log(`[uex] Categories: +${catCounts.categoriesAdded} new, ~${catCounts.categoriesUpdated} updated`);

  // 2+3. Items and attributes — /items requires id_category, so we fetch both
  //      per category in one throttled loop (2 requests per category, 400ms apart,
  //      keeping us well under the 120 req/min limit).
  const rawItems: UexRawItem[] = [];
  const attrMap = new Map<number, { name: string; value: string; unit: string }[]>();
  const catIds = rawCats.map((c) => c.id);

  console.log(`[uex] Fetching items + attributes for ${catIds.length} categories…`);
  for (const catId of catIds) {
    // Items
    try {
      const items = await uexFetch<UexRawItem>(`/items?id_category=${catId}`);
      rawItems.push(...items);
    } catch (err) {
      console.warn(`[uex] Skipping items for category ${catId}: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(400);

    // Attributes
    try {
      const rawAttrs = await uexFetch<UexRawAttribute>(`/items_attributes?id_category=${catId}`);
      for (const attr of rawAttrs) {
        const list = attrMap.get(attr.id_item) ?? [];
        list.push({ name: attr.attribute, value: attr.value, unit: attr.unit });
        attrMap.set(attr.id_item, list);
      }
    } catch (err) {
      console.warn(`[uex] Skipping attributes for category ${catId}: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(400);
  }
  console.log(`[uex] Fetched ${rawItems.length} items across ${catIds.length} categories`);

  // 4. Upsert items with merged attributes
  const itemCounts = await syncItems(rawItems, attrMap);
  console.log(`[uex] Items: +${itemCounts.itemsAdded} new, ~${itemCounts.itemsUpdated} updated`);

  // 5. Commodities
  console.log('[uex] Fetching commodities…');
  const rawComs = await uexFetch<UexRawCommodity>('/commodities');
  const comCounts = await syncCommodities(rawComs);
  console.log(`[uex] Commodities: +${comCounts.commoditiesAdded} new, ~${comCounts.commoditiesUpdated} updated`);

  return { ...catCounts, ...itemCounts, ...comCounts };
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Kicks off a UEX sync in the background and returns the log ID immediately.
 * The caller can poll GET /api/uex/sync/status to track progress.
 *
 * Throws synchronously if a sync is already running.
 */
export async function runUexSync(
  trigger: 'SCHEDULED' | 'MANUAL',
  triggeredById?: string,
): Promise<string> {
  // Reject if a sync started in the last hour is still marked RUNNING
  const inFlight = await prisma.uexSyncLog.findFirst({
    where: {
      status: 'RUNNING',
      startedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
  });
  if (inFlight) throw new Error('A sync is already in progress');

  const log = await prisma.uexSyncLog.create({
    data: { trigger, triggeredById: triggeredById ?? null, status: 'RUNNING' },
  });

  // Fire-and-forget — caller gets the logId immediately for polling
  void (async () => {
    try {
      const counts = await doSync();
      await prisma.uexSyncLog.update({
        where: { id: log.id },
        data: { status: 'SUCCESS', completedAt: new Date(), ...counts },
      });
      console.log(`[uex] Sync ${log.id} complete`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await prisma.uexSyncLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', completedAt: new Date(), error },
      });
      console.error(`[uex] Sync ${log.id} failed: ${error}`);
    }
  })();

  return log.id;
}
