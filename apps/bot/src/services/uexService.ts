// UEX Corp API client for /price and /route (v1.42.0).
//
// - Token: UEX_KEY (an app token from uexcorp.space → My Apps), sent as a
//   Bearer token. Most read endpoints work without one, so a missing token is
//   only a warning.
// - Cache: each answer is kept for as long as UEX itself caches it (prices
//   and routes 30 min, commodities 1 h, terminals 12 h, star systems 1 day);
//   the same request in flight is shared.
// - Limit: UEX allows 120 requests a minute per token; we stay under 100 and,
//   when busy or when UEX fails, answer from the last copy we had.

import {
  UEX_API,
  uexLiveCommodities,
  uexTradeTerminals,
  type UexCommodity,
  type UexPriceAllRow,
  type UexPriceRow,
  type UexResponse,
  type UexRoute,
  type UexStarSystem,
  type UexTerminal,
} from '@dem/shared';

const MIN = 60_000;
const TTL = {
  prices: 30 * MIN,
  routes: 30 * MIN,
  commodities: 60 * MIN,
  terminals: 12 * 60 * MIN,
  systems: 24 * 60 * MIN,
} as const;
const PER_MINUTE = 100;

export class UexUnavailable extends Error {}

const cache = new Map<string, { at: number; ttl: number; data: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();
const sent: number[] = [];
let warnedNoToken = false;

function token(): string | null {
  const t = process.env['UEX_KEY']?.trim();
  if (!t && !warnedNoToken) {
    warnedNoToken = true;
    console.warn('[uex] UEX_KEY is not set on the bot service; calling UEX without a token');
  }
  return t || null;
}

function underLimit(): boolean {
  const now = Date.now();
  while (sent.length && sent[0]! < now - MIN) sent.shift();
  return sent.length < PER_MINUTE;
}

async function fetchUex<T>(path: string): Promise<T> {
  sent.push(Date.now());
  const t = token();
  const res = await fetch(`${UEX_API}/${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ASOP-Terminal',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  let body: UexResponse<T> | null = null;
  try {
    body = (await res.json()) as UexResponse<T>;
  } catch {
    /* not JSON */
  }
  if (!body || body.status !== 'ok' || body.data === undefined) {
    throw new UexUnavailable(
      `UEX ${path}: HTTP ${res.status} ${body?.status ?? 'no body'}${body?.message ? ` (${body.message})` : ''}`,
    );
  }
  return body.data;
}

/** A UEX GET, cached for `ttl`; the last copy is used when UEX is busy or failing. */
async function get<T>(path: string, ttl: number): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data as T;
  if (!underLimit()) {
    if (hit) return hit.data as T;
    throw new UexUnavailable('Too many UEX requests this minute');
  }
  const running = inFlight.get(path);
  if (running) return running as Promise<T>;
  const p = fetchUex<T>(path)
    .then((data) => {
      cache.set(path, { at: Date.now(), ttl, data });
      return data;
    })
    .catch((err: unknown) => {
      console.warn(`[uex] ${(err as Error).message}`);
      if (hit) return hit.data as T;
      throw err instanceof UexUnavailable ? err : new UexUnavailable((err as Error).message);
    })
    .finally(() => inFlight.delete(path));
  inFlight.set(path, p);
  return p;
}

/** Cached answer only (for autocomplete, which must answer within 3 s). */
function peek<T>(path: string): T | null {
  return (cache.get(path)?.data as T | undefined) ?? null;
}

export const uexCommodities = async () => uexLiveCommodities(await get<UexCommodity[]>('commodities', TTL.commodities));
export const uexTerminals = async () => uexTradeTerminals(await get<UexTerminal[]>('terminals', TTL.terminals));
export const uexStarSystems = async () =>
  (await get<UexStarSystem[]>('star_systems', TTL.systems)).filter(
    (s) => s.is_available_live === 1 && s.is_visible === 1,
  );

export const peekCommodities = () => {
  const c = peek<UexCommodity[]>('commodities');
  return c ? uexLiveCommodities(c) : null;
};
export const peekTerminals = () => {
  const t = peek<UexTerminal[]>('terminals');
  return t ? uexTradeTerminals(t) : null;
};
export const peekStarSystems = () =>
  peek<UexStarSystem[]>('star_systems')?.filter((s) => s.is_available_live === 1 && s.is_visible === 1) ?? null;

/** Prices of one commodity at every terminal: raw ores come from UEX's raw prices. */
export async function uexCommodityPrices(c: UexCommodity): Promise<UexPriceRow[]> {
  return get<UexPriceRow[]>(
    `${c.is_raw === 1 ? 'commodities_raw_prices' : 'commodities_prices'}?id_commodity=${c.id}`,
    TTL.prices,
  );
}

export async function uexRoutes(q: {
  commodityId?: number;
  originTerminalId?: number;
  investment?: number;
}): Promise<UexRoute[]> {
  const params = new URLSearchParams();
  if (q.commodityId) params.set('id_commodity', String(q.commodityId));
  if (q.originTerminalId) params.set('id_terminal_origin', String(q.originTerminalId));
  if (q.investment) params.set('investment', String(Math.round(q.investment)));
  return get<UexRoute[]>(`commodities_routes?${params.toString()}`, TTL.routes);
}

/** Every commodity's price at every terminal, one request (v1.43.0, /route best). */
export const uexPricesAll = () => get<UexPriceAllRow[]>('commodities_prices_all', TTL.prices);

/** Loads the lists autocomplete needs, so the first suggestions aren't empty. */
export function warmUexLists(): void {
  void Promise.allSettled([uexCommodities(), uexTerminals(), uexStarSystems()]);
}
