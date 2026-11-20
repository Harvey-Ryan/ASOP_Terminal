// Refinery calculator (v1.58.0): what a refinery work order gives back, what
// it's worth refined (or sold raw instead), and which refinery suits the load.
//
// The yield formula is the one Regolith used (RegolithCo-Common, MIT licence,
// from CIG's refinery data), checked against work orders players reported to
// UEX (refineries_audits: e.g. 2872 Laranite at −1 % with Dinyx → 2417):
//
//   refined cSCU = ore cSCU × 0.85 × (1 + refinery bonus %) × method yield
//
// Refinery bonuses (per refinery, per ore) and prices are player-reported on
// UEX and change with patches, so the page always says how old they are.
// Fees and timers have no formula that matches reported work orders (they
// changed in 4.0–4.2), so the calculator takes the terminal's quote instead and
// only shows each method's relative cost and speed.

/** Share of the ore a refinery keeps before its bonus and the method (all ores, current patch). */
export const REFINE_BASE_YIELD = 0.85;

export interface RefineryMethod {
  /** UEX's code (refineries_methods) */
  code: string;
  name: string;
  /** Multiplies the yield: 1, 0.85 or 0.7 */
  yield: number;
  /** Relative job time and cost (Electrostarolysis = 1), from CIG's data via Regolith */
  time: number;
  cost: number;
}

/** The nine methods, best yield first, then fastest. */
export const REFINERY_METHODS: readonly RefineryMethod[] = [
  { code: 'PYR', name: 'Pyrometric Chromalysis', yield: 1, time: 2, cost: 6 / 2 },
  { code: 'FRX', name: 'Ferron Exchange', yield: 1, time: 4, cost: 2 / 2 },
  { code: 'DIN', name: 'Dinyx Solventation', yield: 1, time: 12, cost: 1 / 2 },
  { code: 'GAS', name: 'Gaskin Process', yield: 0.85, time: 0.5, cost: 6 / 2 },
  { code: 'EST', name: 'Electrostarolysis', yield: 0.85, time: 1, cost: 2 / 2 },
  { code: 'TND', name: 'Thermonatic Deposition', yield: 0.85, time: 3, cost: 1 / 2 },
  { code: 'XCR', name: 'XCR Reaction', yield: 0.7, time: 0.125, cost: 6 / 2 },
  { code: 'COR', name: 'Cormack', yield: 0.7, time: 0.25, cost: 2 / 2 },
  { code: 'KZW', name: 'Kazen Winnowing', yield: 0.7, time: 0.75, cost: 1 / 2 },
];

export const methodByCode = (code: string | null | undefined): RefineryMethod =>
  REFINERY_METHODS.find((m) => m.code === code) ?? REFINERY_METHODS.find((m) => m.code === 'DIN')!;

/** "Slow" / "Fast" … for a relative time (Electrostarolysis = 1). */
export function methodSpeedWord(time: number): string {
  if (time >= 8) return 'Very slow';
  if (time >= 2) return 'Slow';
  if (time >= 0.75) return 'Medium';
  if (time >= 0.25) return 'Fast';
  return 'Very fast';
}
export const methodCostWord = (cost: number): string => (cost >= 3 ? 'High' : cost >= 1 ? 'Medium' : 'Low');

/** cSCU (what the refinery terminal shows) of refined material from one ore. Rounded as the game rounds. */
export function refinedCscu(oreCscu: number, bonusPct: number, method: RefineryMethod): number {
  if (!(oreCscu > 0)) return 0;
  return Math.round(oreCscu * REFINE_BASE_YIELD * (1 + bonusPct / 100) * method.yield);
}

// ── The data the page gets (API GET /api/game-tools/refinery) ────────────────

/** A sell price at one terminal (aUEC per SCU), with when it was reported (unix seconds). */
export interface RefineryPrice { terminalId: number; sell: number; at: number }

export interface RefineryOre {
  /** UEX id of the raw ore ("Laranite (Raw)") */
  id: number;
  name: string;
  /** UEX id and name of what it refines into ("Laranite") */
  refinedId: number;
  refinedName: string;
}

export interface RefinerySite {
  /** UEX terminal id */
  id: number;
  name: string;
  system: string | null;
  /** "MIC-L1, Stanton" */
  place: string;
  /** Yield bonus % by raw ore id: now, last 7 days, last 30 days */
  bonus: Record<number, { now: number; week: number | null; month: number | null }>;
  /** Newest report for this refinery (unix seconds) */
  updatedAt: number | null;
}

export interface RefineryDataDto {
  /** When ASOP last fetched UEX (ISO) */
  fetchedAt: string;
  ores: RefineryOre[];
  refineries: RefinerySite[];
  /** Sell prices by commodity id (refined ids and raw ids), best first, fresh reports only */
  prices: Record<number, RefineryPrice[]>;
  terminals: Record<number, { name: string; system: string | null; place: string }>;
}

// ── Building it from UEX (pure, so it can be tested) ─────────────────────────

export interface UexRefineryCommodity { id: number; id_parent: number | null; name: string; is_raw: number; is_refined: number; is_refinable?: number; is_available_live: number; is_visible?: number }
export interface UexRefineryYield {
  id_commodity: number; id_terminal: number; value: number; value_week?: number | null; value_month?: number | null;
  date_modified: number; commodity_name: string; terminal_name: string;
  star_system_name: string | null; planet_name?: string | null; orbit_name?: string | null; moon_name?: string | null; space_station_name?: string | null; city_name?: string | null; outpost_name?: string | null;
}
export interface UexRefineryPriceRow { id_commodity: number; id_terminal: number; price_sell: number; date_modified: number }
export interface UexRefineryTerminal {
  id: number; name: string; star_system_name: string | null; planet_name?: string | null; orbit_name?: string | null; moon_name?: string | null;
  space_station_name?: string | null; city_name?: string | null; outpost_name?: string | null; is_available_live?: number;
}

/** Price and bonus reports older than this are left out (they change every patch). */
export const REFINERY_MAX_AGE_DAYS = 45;

/** "Refinement Processing - MIC-L1" → "MIC-L1"; "Refinement Center - Ruin Station" → "Ruin Station". */
export const refineryShortName = (terminalName: string): string =>
  terminalName.replace(/^Refine(?:ment|ry)\s+(?:Processing|Center|Centre)\s*[-–]\s*/i, '').trim() || terminalName;

function placeOf(t: { name: string; star_system_name: string | null; planet_name?: string | null; orbit_name?: string | null; moon_name?: string | null; space_station_name?: string | null; city_name?: string | null }, short: string): string {
  const body = t.city_name ?? t.space_station_name ?? t.moon_name ?? t.planet_name ?? t.orbit_name ?? null;
  const parts = [body && !short.includes(body) ? body : null, t.star_system_name].filter((x): x is string => !!x);
  return parts.length ? `${short} · ${parts.join(', ')}` : short;
}

export function buildRefineryData(input: {
  commodities: readonly UexRefineryCommodity[];
  yields: readonly UexRefineryYield[];
  refinedPrices: readonly UexRefineryPriceRow[];
  rawPrices: readonly UexRefineryPriceRow[];
  terminals: readonly UexRefineryTerminal[];
  now?: number;
}): RefineryDataDto {
  const now = input.now ?? Date.now();
  const fresh = (at: number) => at * 1000 >= now - REFINERY_MAX_AGE_DAYS * 86_400_000;
  const byId = new Map(input.commodities.map((c) => [c.id, c]));

  // Raw ores that refine into something (UEX links the two with id_parent, both ways).
  const ores: RefineryOre[] = [];
  for (const c of input.commodities) {
    if (c.is_raw !== 1 || c.is_available_live !== 1 || c.is_refinable === 0) continue;
    const refined = c.id_parent ? byId.get(c.id_parent) : undefined;
    if (!refined || refined.is_refined !== 1) continue;
    ores.push({ id: c.id, name: c.name, refinedId: refined.id, refinedName: refined.name });
  }
  // Ores only known from the bonus list (UEX's refinable flag can lag): match by name.
  for (const y of input.yields) {
    if (ores.some((o) => o.id === y.id_commodity)) continue;
    const raw = byId.get(y.id_commodity);
    const refined = raw?.id_parent ? byId.get(raw.id_parent) : undefined;
    if (raw && refined) ores.push({ id: raw.id, name: raw.name, refinedId: refined.id, refinedName: refined.name });
  }
  ores.sort((a, b) => a.refinedName.localeCompare(b.refinedName));
  const oreIds = new Set(ores.map((o) => o.id));

  const sites = new Map<number, RefinerySite>();
  for (const y of input.yields) {
    if (!oreIds.has(y.id_commodity) || !fresh(y.date_modified)) continue;
    let s = sites.get(y.id_terminal);
    if (!s) {
      const short = refineryShortName(y.terminal_name);
      s = { id: y.id_terminal, name: short, system: y.star_system_name, place: placeOf({ ...y, name: y.terminal_name }, short), bonus: {}, updatedAt: null };
      sites.set(y.id_terminal, s);
    }
    s.bonus[y.id_commodity] = { now: y.value, week: y.value_week ?? null, month: y.value_month ?? null };
    s.updatedAt = Math.max(s.updatedAt ?? 0, y.date_modified);
  }
  const refineries = [...sites.values()].sort((a, b) => (a.system ?? '').localeCompare(b.system ?? '') || a.name.localeCompare(b.name));

  const wanted = new Set([...ores.map((o) => o.refinedId), ...ores.map((o) => o.id)]);
  const prices: Record<number, RefineryPrice[]> = {};
  for (const r of [...input.refinedPrices, ...input.rawPrices]) {
    if (!wanted.has(r.id_commodity) || !(r.price_sell > 0) || !fresh(r.date_modified)) continue;
    const list = (prices[r.id_commodity] ??= []);
    const same = list.find((p) => p.terminalId === r.id_terminal);
    if (same) { if (r.date_modified > same.at) { same.sell = r.price_sell; same.at = r.date_modified; } continue; }
    list.push({ terminalId: r.id_terminal, sell: r.price_sell, at: r.date_modified });
  }
  for (const list of Object.values(prices)) list.sort((a, b) => b.sell - a.sell);

  const used = new Set(Object.values(prices).flat().map((p) => p.terminalId));
  const terminals: RefineryDataDto['terminals'] = {};
  for (const t of input.terminals) {
    if (!used.has(t.id)) continue;
    terminals[t.id] = { name: t.name, system: t.star_system_name, place: placeOf(t, t.name) };
  }
  return { fetchedAt: new Date(now).toISOString(), ores, refineries, prices, terminals };
}

// ── A work order ─────────────────────────────────────────────────────────────

export interface WorkOrderLine { oreId: number; scu: number }

export interface WorkOrderLineResult {
  ore: RefineryOre;
  /** Ore going in and refined coming out, in SCU */
  inScu: number;
  outScu: number;
  bonusPct: number;
  /** Best sell price for the refined material where you're selling (null = nobody reported one) */
  refinedPrice: RefineryPrice | null;
  refinedValue: number | null;
  /** Best price for selling the ore raw instead */
  rawPrice: RefineryPrice | null;
  rawValue: number | null;
}

export interface WorkOrderResult {
  lines: WorkOrderLineResult[];
  inScu: number;
  outScu: number;
  /** Sum of the lines that have a price */
  refinedValue: number;
  rawValue: number;
  /** Refined value minus the quoted fee (null without a fee) */
  profit: number | null;
  /** Lines without a refined price (left out of the value) */
  unpriced: number;
}

/**
 * One work order at one refinery with one method. Prices: the best sell price
 * in `sellSystem` (any system when null). The fee is the terminal's quote.
 */
export function workOrder(data: RefineryDataDto, lines: readonly WorkOrderLine[], refineryId: number | null, method: RefineryMethod, opts: { sellSystem?: string | null; fee?: number | null } = {}): WorkOrderResult {
  const site = refineryId === null ? null : data.refineries.find((r) => r.id === refineryId) ?? null;
  const best = (commodityId: number): RefineryPrice | null => {
    const list = data.prices[commodityId] ?? [];
    const sys = opts.sellSystem ?? null;
    return list.find((p) => !sys || data.terminals[p.terminalId]?.system === sys) ?? null;
  };
  const out: WorkOrderLineResult[] = [];
  for (const line of lines) {
    const ore = data.ores.find((o) => o.id === line.oreId);
    if (!ore || !(line.scu > 0)) continue;
    const bonusPct = site?.bonus[ore.id]?.now ?? 0;
    const outScu = refinedCscu(Math.round(line.scu * 100), bonusPct, method) / 100;
    const refinedPrice = best(ore.refinedId);
    const rawPrice = best(ore.id);
    out.push({
      ore, inScu: line.scu, outScu, bonusPct, refinedPrice, rawPrice,
      refinedValue: refinedPrice ? outScu * refinedPrice.sell : null,
      rawValue: rawPrice ? line.scu * rawPrice.sell : null,
    });
  }
  const refinedValue = out.reduce((n, l) => n + (l.refinedValue ?? 0), 0);
  const fee = opts.fee != null && opts.fee >= 0 ? opts.fee : null;
  return {
    lines: out,
    inScu: out.reduce((n, l) => n + l.inScu, 0),
    outScu: out.reduce((n, l) => n + l.outScu, 0),
    refinedValue,
    rawValue: out.reduce((n, l) => n + (l.rawValue ?? 0), 0),
    profit: fee === null ? null : refinedValue - fee,
    unpriced: out.filter((l) => l.refinedValue === null).length,
  };
}

/**
 * Every refinery for this load, most refined SCU first (then value): the same
 * method everywhere, prices in each refinery's own system. Refineries with no
 * reported bonus for an ore count it at 0 %.
 */
export function rankRefineries(data: RefineryDataDto, lines: readonly WorkOrderLine[], method: RefineryMethod, opts: { system?: string | null } = {}): { site: RefinerySite; result: WorkOrderResult; known: number }[] {
  return data.refineries
    .filter((s) => !opts.system || s.system === opts.system)
    .map((site) => ({
      site,
      result: workOrder(data, lines, site.id, method, { sellSystem: site.system }),
      known: lines.filter((l) => site.bonus[l.oreId] !== undefined).length,
    }))
    .sort((a, b) => b.result.outScu - a.result.outScu || b.result.refinedValue - a.result.refinedValue || a.site.name.localeCompare(b.site.name));
}

/** "48:32,59:12.5" ⇄ lines, for the page's address (ore ids, SCU; 0 = still being typed). */
export function parseWorkOrder(value: string | null | undefined): WorkOrderLine[] {
  if (!value) return [];
  return value.split(',').map((part) => {
    const [id, scu] = part.split(':');
    return { oreId: Number(id), scu: Number(scu) };
  }).filter((l) => Number.isInteger(l.oreId) && l.oreId > 0 && Number.isFinite(l.scu) && l.scu >= 0 && l.scu <= 100_000).slice(0, 20);
}
export const workOrderParam = (lines: readonly WorkOrderLine[]): string =>
  lines.map((l) => `${l.oreId}:${Math.round(l.scu * 100) / 100}`).join(',');
