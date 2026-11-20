// Refinery calculator data (v1.58.0): UEX's player-reported refinery yield
// bonuses and raw/refined sell prices, joined by buildRefineryData
// (packages/shared/src/refinery.ts). Five UEX requests, at most every
// 30 minutes (UEX itself caches prices 30 min); the last good copy is served
// while a new one is fetched, and when UEX is busy or failing. UEX_KEY (the
// same key the bot uses) raises UEX's limits; these endpoints also work without it.

import {
  buildRefineryData, UEX_API,
  type RefineryDataDto, type UexRefineryCommodity, type UexRefineryPriceRow, type UexRefineryTerminal, type UexRefineryYield,
} from '@dem/shared';

const TTL_MS = 30 * 60_000;

async function uexGet<T>(path: string): Promise<T[]> {
  const key = process.env['UEX_KEY'];
  const res = await fetch(`${UEX_API}/${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'ASOP-Terminal', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    signal: AbortSignal.timeout(20_000),
  });
  type Body = { status?: string; data?: T[]; message?: string };
  const body = await (res.json() as Promise<Body>).catch((): Body | null => null);
  if (!res.ok || body?.status !== 'ok' || !Array.isArray(body.data)) {
    throw new Error(`UEX ${path}: HTTP ${res.status} ${body?.status ?? 'no body'}${body?.message ? ` (${body.message})` : ''}`);
  }
  return body.data as T[];
}

export async function fetchRefineryData(get: <T>(path: string) => Promise<T[]> = uexGet): Promise<RefineryDataDto> {
  const [commodities, yields, refinedPrices, rawPrices, terminals] = await Promise.all([
    get<UexRefineryCommodity>('commodities'),
    get<UexRefineryYield>('refineries_yields'),
    get<UexRefineryPriceRow>('commodities_prices_all'),
    get<UexRefineryPriceRow>('commodities_raw_prices_all'),
    get<UexRefineryTerminal>('terminals'),
  ]);
  return buildRefineryData({ commodities, yields, refinedPrices, rawPrices, terminals });
}

let cached: { at: number; data: RefineryDataDto } | null = null;
let building: Promise<RefineryDataDto | null> | null = null;

function refresh(): Promise<RefineryDataDto | null> {
  building ??= fetchRefineryData()
    .then((data) => { cached = { at: Date.now(), data }; return data; })
    .catch((err: unknown) => { console.warn('[refinery] UEX data:', err instanceof Error ? err.message : err); return cached?.data ?? null; })
    .finally(() => { building = null; });
  return building;
}

/** The calculator's data: the cached copy (refreshed in the background when old), or null when UEX has never answered. */
export async function refineryData(): Promise<RefineryDataDto | null> {
  if (!cached) return refresh();
  if (Date.now() - cached.at > TTL_MS) void refresh();
  return cached.data;
}

/** For tests. */
export function setRefineryDataForTests(data: RefineryDataDto | null): void {
  cached = data ? { at: Date.now(), data } : null;
}
