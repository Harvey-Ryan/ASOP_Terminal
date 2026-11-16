// UEX Corp (uexcorp.space, API 2.0): community-reported Star Citizen prices
// and trade routes (v1.42.0). Only the fields ASOP reads are typed here; the
// bot's client is apps/bot/src/services/uexService.ts. Data is player-reported
// and comes with no guarantee: always say where it's from and how old it is.

export const UEX_API = 'https://api.uexcorp.uk/2.0';
export const UEX_SITE = 'https://uexcorp.space';

/** Every UEX response: `status` is "ok" or a reason ("requests_limit_reached", "missing_…"). */
export interface UexResponse<T> {
  status: string;
  data?: T;
  message?: string;
}

export interface UexCommodity {
  id: number;
  name: string;
  code: string;
  slug: string;
  kind: string | null;
  uuid: string | null;
  price_buy: number;
  price_sell: number;
  is_available_live: number;
  is_visible: number;
  is_raw: number;
  is_refined: number;
  is_mineral: number;
  is_illegal: number;
  is_buyable: number;
  is_sellable: number;
}

/** A row of commodities_prices or commodities_raw_prices: one commodity at one terminal. */
export interface UexPriceRow {
  id_commodity: number;
  id_terminal: number;
  price_buy: number;
  price_buy_avg?: number;
  price_sell: number;
  price_sell_avg?: number;
  scu_buy?: number;
  scu_sell_stock?: number;
  status_buy?: number | null;
  status_sell?: number | null;
  date_modified: number;
  commodity_name: string;
  star_system_name: string | null;
  planet_name: string | null;
  orbit_name: string | null;
  moon_name: string | null;
  space_station_name: string | null;
  outpost_name: string | null;
  city_name: string | null;
  terminal_name: string;
  terminal_is_player_owned?: number;
}

export interface UexRoute {
  id: number;
  code: string;
  id_commodity: number;
  id_terminal_origin: number;
  id_terminal_destination: number;
  commodity_name: string;
  price_origin: number;
  price_destination: number;
  price_margin: number;
  price_roi: number;
  scu_origin: number;
  scu_destination: number;
  status_origin: number;
  status_destination: number;
  investment: number;
  profit: number;
  distance: number | null;
  score: number;
  origin_star_system_name: string | null;
  origin_planet_name: string | null;
  origin_orbit_name: string | null;
  origin_terminal_name: string | null;
  destination_star_system_name: string | null;
  destination_planet_name: string | null;
  destination_orbit_name: string | null;
  destination_terminal_name: string | null;
  date_added: number;
}

export interface UexTerminal {
  id: number;
  name: string;
  nickname: string | null;
  displayname: string | null;
  type: string;
  star_system_name: string | null;
  planet_name: string | null;
  moon_name: string | null;
  space_station_name: string | null;
  city_name: string | null;
  outpost_name: string | null;
  is_available_live: number;
  is_visible: number;
}

export interface UexStarSystem {
  id: number;
  name: string;
  is_available_live: number;
  is_visible: number;
}

/** UEX's 1–7 stock scale (commodities_status). */
export function uexStockWord(status: number | null | undefined): string | null {
  switch (status) {
    case 1: return 'Out of stock';
    case 2: return 'Very low stock';
    case 3: return 'Low stock';
    case 4: return 'Medium stock';
    case 5: return 'High stock';
    case 6: return 'Very high stock';
    case 7: return 'Max stock';
    default: return null;
  }
}

/** "24,180" (whole aUEC) or "12.5" below 100. */
export function uexMoney(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  return abs >= 100 ? Math.round(n).toLocaleString('en-US') : (Math.round(n * 100) / 100).toLocaleString('en-US');
}

/** "1.2M" / "340k" for big totals. */
export function uexShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e4) return `${Math.round(n / 1e3)}k`;
  return Math.round(n).toLocaleString('en-US');
}

/** "Area18 TDD · ArcCorp, Stanton": the terminal, then the biggest places it's in. */
export function uexPlace(r: Pick<UexPriceRow, 'terminal_name' | 'star_system_name' | 'planet_name' | 'moon_name' | 'orbit_name' | 'city_name' | 'space_station_name' | 'outpost_name'>): string {
  const body = r.moon_name ?? r.planet_name ?? r.orbit_name;
  const where = [body, r.star_system_name].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  return where.length ? `${r.terminal_name} · ${where.join(', ')}` : r.terminal_name;
}

/** Where one end of a route is: "ArcCorp, Stanton" (with the terminal first if asked). */
export function uexRoutePlace(r: UexRoute, side: 'origin' | 'destination', withTerminal = true): string {
  const terminal = r[`${side}_terminal_name`] ?? 'Unknown terminal';
  const body = r[`${side}_planet_name`] ?? r[`${side}_orbit_name`];
  const where = [body, r[`${side}_star_system_name`]].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  if (!withTerminal) return where.join(', ') || 'Unknown location';
  return where.length ? `${terminal} · ${where.join(', ')}` : terminal;
}

export const uexRouteUrl = (code: string) => `${UEX_SITE}/trade/route?code=${encodeURIComponent(code)}`;

/** Rows reported within this many days count; older ones are left out (prices drift every patch). */
export const UEX_MAX_AGE_DAYS = 30;

const fresh = (r: { date_modified: number }, now: number) => r.date_modified * 1000 >= now - UEX_MAX_AGE_DAYS * 86_400_000;

/**
 * Where to sell and where to buy a commodity: highest sell prices first, lowest
 * buy prices first, each place once, reports older than UEX_MAX_AGE_DAYS and
 * terminals out of stock (buying) left out.
 */
export function uexBestPrices(rows: readonly UexPriceRow[], opts: { limit?: number; system?: string | null; now?: number } = {}): {
  sell: UexPriceRow[];
  buy: UexPriceRow[];
  newest: number | null;
} {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 5;
  const sys = opts.system?.trim().toLowerCase() || null;
  const usable = rows.filter((r) => fresh(r, now) && (!sys || (r.star_system_name ?? '').toLowerCase() === sys));
  const once = (list: UexPriceRow[]) => list.filter((r, i, a) => a.findIndex((x) => x.id_terminal === r.id_terminal) === i);
  const sell = once(usable.filter((r) => r.price_sell > 0).sort((a, b) => b.price_sell - a.price_sell)).slice(0, limit);
  const buy = once(usable.filter((r) => r.price_buy > 0 && r.status_buy !== 1).sort((a, b) => a.price_buy - b.price_buy)).slice(0, limit);
  const shown = [...sell, ...buy];
  return { sell, buy, newest: shown.length ? Math.max(...shown.map((r) => r.date_modified)) : null };
}

/** UEX's routes, best first (its own score, then profit), with a positive margin, each pair once. */
export function uexBestRoutes(routes: readonly UexRoute[], limit = 5): UexRoute[] {
  return routes
    .filter((r) => r.price_margin > 0 && r.price_origin > 0 && r.price_destination > 0)
    .sort((a, b) => b.score - a.score || b.profit - a.profit)
    .filter((r, i, a) => a.findIndex((x) => x.id_commodity === r.id_commodity && x.id_terminal_origin === r.id_terminal_origin && x.id_terminal_destination === r.id_terminal_destination) === i)
    .slice(0, limit);
}

/** Every typed word somewhere in the name (or code), any order; exact and prefix matches first. */
export function uexSearch<T extends { name: string; code?: string | null }>(list: readonly T[], query: string, limit = 25): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return list.slice(0, limit);
  const words = q.split(/\s+/);
  const hits = list.filter((x) => {
    const hay = `${x.name} ${x.code ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const rank = (x: T) => {
    const n = x.name.toLowerCase();
    return n === q || (x.code ?? '').toLowerCase() === q ? 0 : n.startsWith(q) ? 1 : 2;
  };
  return hits.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, limit);
}

/** Commodities worth offering: in the live game and public on UEX. */
export const uexLiveCommodities = (list: readonly UexCommodity[]) =>
  list.filter((c) => c.is_available_live === 1 && c.is_visible === 1);

/** Terminals that trade commodities, in the live game. */
export const uexTradeTerminals = (list: readonly UexTerminal[]) =>
  list.filter((t) => t.is_available_live === 1 && t.is_visible === 1 && (t.type === 'commodity' || t.type === 'commodity_raw'));

// ── Best runs across everything (v1.43.0, /route best) ───────────────────────

/** A row of commodities_prices_all: every commodity at every terminal in one request. */
export interface UexPriceAllRow {
  id_commodity: number;
  id_terminal: number;
  price_buy: number;
  price_sell: number;
  /** SCU for sale at the terminal (last report) */
  scu_buy?: number | null;
  /** SCU the terminal will take (forecast demand) */
  scu_sell?: number | null;
  status_buy?: number | null;
  status_sell?: number | null;
  date_modified: number;
  commodity_name: string;
  terminal_name: string;
}

export type UexRunLimit = 'hold' | 'stock' | 'demand' | 'budget';

export interface UexRun {
  commodityId: number;
  commodityName: string;
  illegal: boolean;
  buy: UexPriceAllRow;
  sell: UexPriceAllRow;
  buyTerminal: UexTerminal | null;
  sellTerminal: UexTerminal | null;
  /** aUEC per SCU */
  margin: number;
  /** SCU you can actually fill, and what limits it (null without a hold size or budget) */
  units: number | null;
  limitedBy: UexRunLimit | null;
  profit: number | null;
  investment: number | null;
  crossSystem: boolean;
  /** The older of the two reports (unix seconds) */
  reportedAt: number;
}

/**
 * The most profitable buy-here-sell-there runs right now, one per commodity.
 * With a hold size (scu) or budget, ranked by profit for that load: margin ×
 * the least of the hold, the stock for sale, the selling terminal's demand
 * and what the budget buys. Without either, ranked by margin per SCU.
 * Leaves out old reports, empty stock, full terminals, and (unless
 * crossSystem) runs that need a jump between systems.
 */
export function uexBestRuns(
  rows: readonly UexPriceAllRow[],
  terminals: readonly UexTerminal[],
  commodities: readonly Pick<UexCommodity, 'id' | 'is_illegal'>[],
  opts: { scu?: number | null; budget?: number | null; system?: string | null; crossSystem?: boolean; limit?: number; now?: number } = {},
): UexRun[] {
  const now = opts.now ?? Date.now();
  const byId = new Map(terminals.map((t) => [t.id, t]));
  const illegal = new Set(commodities.filter((c) => c.is_illegal === 1).map((c) => c.id));
  const sys = opts.system?.trim().toLowerCase() || null;
  const systemOf = (r: UexPriceAllRow) => (byId.get(r.id_terminal)?.star_system_name ?? '').toLowerCase();
  const usable = rows.filter((r) => fresh(r, now) && (!sys || systemOf(r) === sys));
  const scu = opts.scu && opts.scu > 0 ? opts.scu : null;
  const budget = opts.budget && opts.budget > 0 ? opts.budget : null;

  const groups = new Map<number, UexPriceAllRow[]>();
  for (const r of usable) groups.set(r.id_commodity, [...(groups.get(r.id_commodity) ?? []), r]);

  const best: UexRun[] = [];
  for (const [commodityId, list] of groups) {
    const buys = list.filter((r) => r.price_buy > 0 && r.status_buy !== 1 && (r.scu_buy == null || r.scu_buy > 0));
    const sells = list.filter((r) => r.price_sell > 0 && r.status_sell !== 7);
    let top: UexRun | null = null;
    for (const b of buys) {
      for (const s of sells) {
        if (s.id_terminal === b.id_terminal) continue;
        const margin = s.price_sell - b.price_buy;
        if (margin <= 0) continue;
        const cross = systemOf(b) !== systemOf(s);
        if (cross && !opts.crossSystem) continue;
        const caps: [UexRunLimit, number][] = [];
        if (scu) caps.push(['hold', scu]);
        if (b.scu_buy && b.scu_buy > 0) caps.push(['stock', Math.floor(b.scu_buy)]);
        if (s.scu_sell && s.scu_sell > 0) caps.push(['demand', Math.floor(s.scu_sell)]);
        if (budget) caps.push(['budget', Math.floor(budget / b.price_buy)]);
        const sized = !!(scu || budget);
        const cap = sized ? caps.reduce((m, c) => (c[1] < m[1] ? c : m)) : null;
        const units = cap ? Math.max(0, cap[1]) : null;
        if (units === 0) continue;
        const run: UexRun = {
          commodityId,
          commodityName: b.commodity_name,
          illegal: illegal.has(commodityId),
          buy: b,
          sell: s,
          buyTerminal: byId.get(b.id_terminal) ?? null,
          sellTerminal: byId.get(s.id_terminal) ?? null,
          margin,
          units,
          limitedBy: cap ? cap[0] : null,
          profit: units !== null ? margin * units : null,
          investment: units !== null ? b.price_buy * units : null,
          crossSystem: cross,
          reportedAt: Math.min(b.date_modified, s.date_modified),
        };
        const better = (a: UexRun, z: UexRun) => (sized ? (a.profit ?? 0) - (z.profit ?? 0) : a.margin - z.margin) || a.margin - z.margin;
        if (!top || better(run, top) > 0) top = run;
      }
    }
    if (top) best.push(top);
  }
  const sized = !!(scu || budget);
  return best
    .sort((a, b) => (sized ? (b.profit ?? 0) - (a.profit ?? 0) : b.margin - a.margin) || b.margin - a.margin || a.commodityName.localeCompare(b.commodityName))
    .slice(0, opts.limit ?? 5);
}

/** "TDD · ArcCorp, Stanton" from a terminal in the cached list. */
export function uexTerminalPlace(t: UexTerminal | null, fallback: string): string {
  if (!t) return fallback;
  const body = t.moon_name ?? t.planet_name ?? t.space_station_name ?? t.city_name;
  const where = [body, t.star_system_name].filter((x, i, a): x is string => !!x && a.indexOf(x) === i && !t.name.includes(x));
  return where.length ? `${t.name} · ${where.join(', ')}` : t.name;
}
