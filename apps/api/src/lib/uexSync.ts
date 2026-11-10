import { prisma } from './prisma.js';

const UEX_BASE = 'https://api.uexcorp.uk/2.0';

// ── Raw API shapes ────────────────────────────────────────────────────────────

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

// UEX returns date_modified as a Unix timestamp integer in some endpoints.
function normDate(v: number | string): string {
  return String(v);
}

// ── Commodities ───────────────────────────────────────────────────────────────

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
  // Only commodities: item names and details come from the game files (sc-data,
  // see packages/shared/src/catalog.ts). UEX is kept for average commodity
  // prices, which aren't in the game files.
  console.log('[uex] Fetching commodities…');
  const rawComs = await uexFetch<UexRawCommodity>('/commodities');
  const comCounts = await syncCommodities(rawComs);
  console.log(`[uex] Commodities: +${comCounts.commoditiesAdded} new, ~${comCounts.commoditiesUpdated} updated`);
  return { categoriesAdded: 0, categoriesUpdated: 0, itemsAdded: 0, itemsUpdated: 0, ...comCounts };
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
