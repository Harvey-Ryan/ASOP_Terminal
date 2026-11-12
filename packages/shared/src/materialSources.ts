// Where crafting materials are mined (v1.26.0), from sc-data's
// resource_locations: each mining "provider" (a moon, a planet, a belt, a set
// of Lagrange points) lists its rock types per mining method, how often each
// appears, and what share of the rock is each ore. The Crafting Calculator's
// build list uses this to say where to get everything, in as few stops as it
// can within the system you're in.

/** How a material is gathered at a place. */
export type MiningMethod = 'ship' | 'roc' | 'hand';

/** As read in a sentence: "Iron (ship, common)". */
export const MINING_METHOD_LABELS: Record<MiningMethod, string> = { ship: 'ship', roc: 'ROC', hand: 'by hand' };

export interface MaterialSource {
  /** "Adir", "Aaron Halo", "HUR L1, HUR L4" */
  place: string;
  /** moon | planet | belt | cluster | lagrange */
  kind: string;
  system: string;
  method: MiningMethod;
  /** Share of this method's rocks here that are mainly this material, 0–1 */
  chance: number;
  /** Most of a rock that is the material, percent (the main ore of the rocks counted) */
  maxPercent: number;
}

/** Sources by material, keyed by lower-case material name ("iron", "pressurized ice"). */
export type MaterialSources = Record<string, MaterialSource[]>;

/** One row of scdata.resource_locations. */
export interface ResourceLocationRow {
  provider_name: string | null;
  data: {
    Locations?: { Name?: string | null; Type?: string | null; System?: string | null }[] | null;
    Groups?: {
      GroupName?: string | null;
      Deposits?: { RelativeProbability?: number | null; ResourceQualities?: { ResourceKey?: string | null; MaxPercentage?: number | null }[] | null }[] | null;
    }[] | null;
  };
}

const METHOD_BY_GROUP: Record<string, MiningMethod> = {
  spaceship_mineables: 'ship',
  groundvehicle_mineables: 'roc',
  fps_mineables: 'hand',
  'fps mineables': 'hand',
};

/** Providers that aren't a place you'd go to mine: events, loot, wrecks, vague clusters. */
const SKIP = /^(Loot_|HPP_ResourceRush|HPP_ShipGraveyard|HPP_SpaceDerelict|AsteroidCluster_|HPP_Lagrange_(G|Occupied)$)/;

/** Places the game data names badly or too broadly. */
const PLACE_OVERRIDES: Record<string, { place: string; kind: string; system: string }> = {
  HPP_AaronHalo: { place: 'Aaron Halo', kind: 'belt', system: 'Stanton' },
  HPP_Stanton2c_Belt: { place: 'Yela asteroid belt', kind: 'belt', system: 'Stanton' }, // named "Terminus" upstream
  HPP_Pyro_DeepSpaceAsteroids: { place: 'Pyro deep-space asteroids', kind: 'cluster', system: 'Pyro' },
};

/** "Ore_Iron" → "iron", "Raw_Ice" → "pressurized ice", "Glacosite" → "glacosite". */
export function materialKey(resourceKeyOrName: string): string {
  const k = resourceKeyOrName.replace(/^(Ore_|Raw_|Raw)/, '').trim().toLowerCase();
  return k === 'ice' ? 'pressurized ice' : k;
}

function placeOf(row: ResourceLocationRow): { place: string; kind: string; system: string } | null {
  const provider = row.provider_name ?? '';
  if (!provider || SKIP.test(provider)) return null;
  if (PLACE_OVERRIDES[provider]) return PLACE_OVERRIDES[provider]!;
  const locs = (row.data.Locations ?? []).filter((l) => l.Name && !l.Name.startsWith('<='));
  if (!locs.length) return null;
  const system = locs[0]!.System ?? '';
  const kind = (locs[0]!.Type ?? '').toLowerCase();
  if (!system) return null;
  if (locs.length === 1) return { place: locs[0]!.Name!, kind, system };
  const names = [...new Set(locs.map((l) => l.Name!))].sort();
  return { place: names.length <= 4 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3}`, kind, system };
}

/** Every material's mining sources, best first. */
export function buildMaterialSources(rows: readonly ResourceLocationRow[]): MaterialSources {
  const out: MaterialSources = {};
  for (const row of rows) {
    const where = placeOf(row);
    if (!where) continue;
    for (const g of row.data.Groups ?? []) {
      const method = METHOD_BY_GROUP[(g.GroupName ?? '').toLowerCase()];
      if (!method) continue;
      const deposits = g.Deposits ?? [];
      const total = deposits.reduce((a, d) => a + (d.RelativeProbability ?? 0), 0) || 1;
      const found = new Map<string, { chance: number; maxPercent: number }>();
      for (const d of deposits) {
        const keys = new Map<string, number>();
        for (const q of d.ResourceQualities ?? []) {
          if (!q.ResourceKey) continue;
          const k = materialKey(q.ResourceKey);
          keys.set(k, Math.max(keys.get(k) ?? 0, q.MaxPercentage ?? 0));
        }
        // Only the rock's main ore counts (what the game lists as a place's
        // mineables); traces of others in it would overstate where they're found.
        const main = [...keys].sort((x, y) => y[1] - x[1])[0];
        for (const [k, pct] of main ? [main] : []) {
          const f = found.get(k) ?? { chance: 0, maxPercent: 0 };
          f.chance += (d.RelativeProbability ?? 0) / total;
          f.maxPercent = Math.max(f.maxPercent, pct);
          found.set(k, f);
        }
      }
      for (const [k, f] of found) {
        (out[k] ??= []).push({ ...where, method, chance: Math.min(1, Math.round(f.chance * 1000) / 1000), maxPercent: f.maxPercent });
      }
    }
  }
  const methodOrder: Record<MiningMethod, number> = { ship: 0, roc: 1, hand: 2 };
  for (const list of Object.values(out)) {
    list.sort((a, b) => b.chance - a.chance || methodOrder[a.method] - methodOrder[b.method] || a.place.localeCompare(b.place));
  }
  return out;
}

/** "Common" / "Uncommon" / "Rare" for a source's chance. */
export function chanceLabel(chance: number): string {
  return chance >= 0.25 ? 'Common' : chance >= 0.1 ? 'Uncommon' : 'Rare';
}

// ── Planning the stops ───────────────────────────────────────────────────────

export interface RouteStop {
  place: string;
  kind: string;
  /** Materials to get there, with how */
  materials: { name: string; method: MiningMethod; chance: number }[];
}

export interface MaterialRoute {
  system: string;
  stops: RouteStop[];
  /** Materials not mined anywhere in this system (buy them, or go elsewhere) */
  missing: string[];
}

/** Systems where at least one of the materials is mined, most coverage first. */
export function routeSystems(materials: readonly string[], sources: MaterialSources): string[] {
  const count = new Map<string, number>();
  for (const m of materials) {
    for (const s of new Set((sources[materialKey(m)] ?? []).map((x) => x.system))) count.set(s, (count.get(s) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
}

/**
 * The fewest places in `system` that cover the materials: each step picks the
 * place that covers the most of what's left (ties: the better chances). A
 * material counts at a place only where it's reasonably common there (5%+),
 * unless that's the only kind of place it's found.
 */
export function planRoute(materials: readonly string[], sources: MaterialSources, system: string): MaterialRoute {
  const options = new Map<string, MaterialSource[]>();
  const missing: string[] = [];
  for (const m of materials) {
    const here = (sources[materialKey(m)] ?? []).filter((s) => s.system === system);
    const decent = here.filter((s) => s.chance >= 0.05);
    const use = decent.length ? decent : here;
    if (use.length) options.set(m, use); else missing.push(m);
  }
  const stops: RouteStop[] = [];
  const left = new Set(options.keys());
  while (left.size) {
    const byPlace = new Map<string, { kind: string; got: { name: string; method: MiningMethod; chance: number }[] }>();
    for (const m of left) {
      // best way to get m at each place
      const best = new Map<string, MaterialSource>();
      for (const s of options.get(m)!) if (!best.has(s.place) || best.get(s.place)!.chance < s.chance) best.set(s.place, s);
      for (const [place, s] of best) {
        const p = byPlace.get(place) ?? { kind: s.kind, got: [] };
        p.got.push({ name: m, method: s.method, chance: s.chance });
        byPlace.set(place, p);
      }
    }
    const [place, pick] = [...byPlace].sort((a, b) =>
      b[1].got.length - a[1].got.length
      || b[1].got.reduce((x, g) => x + g.chance, 0) - a[1].got.reduce((x, g) => x + g.chance, 0)
      || a[0].localeCompare(b[0]))[0]!;
    stops.push({ place, kind: pick.kind, materials: pick.got });
    for (const g of pick.got) left.delete(g.name);
  }
  return { system, stops, missing };
}

// ── Build list totals ────────────────────────────────────────────────────────

/** "64 cSCU", "1.43 SCU", "170 units" (how the game shows amounts). */
export function formatMaterialAmount(scu: number | null, units: number | null): string {
  const parts: string[] = [];
  if (scu != null && scu > 0) {
    parts.push(scu < 1 ? `${+(scu * 100).toFixed(2)} cSCU` : `${+scu.toFixed(2)} SCU`);
  }
  if (units != null && units > 0) parts.push(`${+units.toFixed(2)} ${units === 1 ? 'unit' : 'units'}`);
  return parts.join(' + ') || '—';
}

export interface BuildListEntry {
  bp: { craftTimeSecs: number; components: readonly { material: { name: string; quantityScu: number | null; quantity: number | null } }[] };
  qty: number;
}

export interface BuildListTotals {
  craftTimeSecs: number;
  /** Combined materials, largest first */
  materials: { name: string; scu: number | null; units: number | null }[];
}

/** What a build list needs in all: craft time and materials, times each quantity. */
export function buildListTotals(entries: readonly BuildListEntry[]): BuildListTotals {
  const mats = new Map<string, { name: string; scu: number | null; units: number | null }>();
  let craftTimeSecs = 0;
  for (const { bp, qty } of entries) {
    if (!(qty > 0)) continue;
    craftTimeSecs += bp.craftTimeSecs * qty;
    for (const c of bp.components) {
      const m = mats.get(c.material.name) ?? { name: c.material.name, scu: null, units: null };
      if (c.material.quantityScu != null) m.scu = Math.round(((m.scu ?? 0) + c.material.quantityScu * qty) * 1e6) / 1e6;
      if (c.material.quantity != null) m.units = (m.units ?? 0) + c.material.quantity * qty;
      mats.set(c.material.name, m);
    }
  }
  const materials = [...mats.values()].sort((a, b) => (b.scu ?? 0) - (a.scu ?? 0) || (b.units ?? 0) - (a.units ?? 0) || a.name.localeCompare(b.name));
  return { craftTimeSecs, materials };
}
