// Mining for Game Tools (v1.49.0): where each ore is found (ore finder),
// rock signatures for the scanner, and mining lasers and modules, all from
// the game files (scdata.resource_locations, scdata.resources, scdata.items).
// Numbers are kept exactly as the files give them; miners check them.

import { materialKey, resourcePlace, type MiningMethod, type ResourceLocationRow } from './materialSources.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() && !v.startsWith('<=') ? v.trim() : null);

/** One quality band of an ore in a rock: its share of the rock (%) at that quality. */
export interface OreBand {
  minPct: number;
  maxPct: number;
  minQ: number;
  maxQ: number;
}

/** A place where a rock whose main ore is `ore` spawns. */
export interface OreSpot {
  /** Lower-case ore key ("laranite", "pressurized ice"). */
  ore: string;
  place: string;
  kind: string;
  system: string;
  method: MiningMethod;
  /** "Laranite (Raw)" */
  rock: string;
  /** Share of this method's rocks at the place that are this rock (0–1). */
  chance: number;
  /** How likely the place spawns this method's rocks at all, as the files give it (0–1; null if not given). */
  groupChance: number | null;
  /** The ore's quality bands in the rock, best quality first. */
  bands: OreBand[];
  signature: number | null;
  clusterMin: number | null;
  clusterMax: number | null;
}

/** What a scanner can see: rocks by mining method, plus salvage (wrecks and debris). */
export type ScanMethod = MiningMethod | 'salvage';

export const SCAN_METHOD_LABELS: Record<ScanMethod, string> = {
  ship: 'Ship',
  roc: 'ROC',
  hand: 'By hand',
  salvage: 'Salvage',
};

export interface RockSignature {
  rock: string;
  /** Ore key; 'salvage' for wrecks and debris. */
  ore: string;
  method: ScanMethod;
  /** One rock's (or panel's) signature. */
  signature: number;
  /**
   * Most rocks of this type in one cluster anywhere (the files' cluster sizes).
   * A scan never adds up more than this, so bigger multiples aren't matches (v1.52.0).
   */
  maxCluster: number;
  /** Places this rock spawns (empty for salvage, which turns up at wrecks anywhere). */
  places: string[];
}

/** One scanner reading explained: `count` rocks of `each`, of any of `rocks` (they share that signature). */
export interface ScanHit {
  count: number;
  each: number;
  method: ScanMethod;
  /** Rock types with this signature, most likely first when a place is given. `chance` = its spawn chance there. */
  rocks: { rock: string; ore: string; chance: number | null }[];
}

export interface MiningLaser {
  uuid: string;
  name: string;
  maker: string | null;
  size: number;
  power: number | null;
  minPower: number | null;
  extraction: number | null;
  optimalRange: number | null;
  maxRange: number | null;
  moduleSlots: number;
  /** A ship this laser is made for (it needs that ship's tag), e.g. the Golem's Pitman; null for lasers sold for any ship. */
  bespokeFor?: string | null;
  /** Percent changes: Resistance, Instability, OptimalChargeWindow, OptimalChargeRate, AllChargeRates, InertMaterials… */
  modifiers: Record<string, number>;
}

export interface MiningModule {
  uuid: string;
  name: string;
  maker: string | null;
  kind: 'Active' | 'Passive';
  /** Active modules: uses, and seconds each use lasts. */
  charges: number | null;
  lifetime: number | null;
  /** Laser power multiplier (1.25 = +25%). */
  power: number | null;
  /** Percent changes, as for lasers, plus OverchargeRate and ShatterDamage. */
  modifiers: Record<string, number>;
  rarity: string | null;
}

export interface MiningDataDto {
  build: string | null;
  /** Ore keys with a display name, A–Z. */
  ores: { key: string; name: string }[];
  spots: OreSpot[];
  signatures: RockSignature[];
  lasers: MiningLaser[];
  modules: MiningModule[];
  /** Mining gadgets (OptiMax, BoreMax…): placed on a rock, one per rock (v1.52.0). */
  gadgets: MiningGadget[];
}

export interface MiningGadget {
  uuid: string;
  name: string;
  maker: string | null;
  /** Percent changes to the rock, as for modules, plus ClusterFactor. */
  modifiers: Record<string, number>;
  rarity: string | null;
}

const METHOD_BY_GROUP: Record<string, MiningMethod> = {
  spaceship_mineables: 'ship',
  groundvehicle_mineables: 'roc',
  fps_mineables: 'hand',
  'fps mineables': 'hand',
};

/** "pressurized ice" → "Pressurized Ice" */
export const oreName = (key: string) => key.replace(/\b\w/g, (c) => c.toUpperCase());

/** One scdata.resources row (a rock type), by uuid. */
export interface ResourceRow {
  data: Json;
}

/**
 * Where every ore is the main ore of a rock, by place and mining method. A rock's
 * main ore is the one with the largest share; rocks only carrying an ore on the
 * side are left out (the finder shows what you'd go to mine).
 */
export function buildOreSpots(
  locations: readonly ResourceLocationRow[],
  resources: readonly ResourceRow[],
): { spots: OreSpot[]; signatures: RockSignature[] } {
  const rocks = new Map<string, Json>();
  for (const r of resources) if (r.data?.UUID) rocks.set(String(r.data.UUID), r.data);
  const spots: OreSpot[] = [];
  const sigs = new Map<string, RockSignature>();
  const addSig = (
    rock: string,
    ore: string,
    method: ScanMethod,
    signature: number,
    cluster: number | null,
    place: string | null,
  ) => {
    const k = `${rock}|${method}`;
    const s = sigs.get(k) ?? { rock, ore, method, signature, maxCluster: 1, places: [] };
    s.maxCluster = Math.max(s.maxCluster, cluster ?? 1);
    if (place && !s.places.includes(place)) s.places.push(place);
    sigs.set(k, s);
  };
  for (const row of locations) {
    // Salvage (wrecks, debris) can be scanned too: its signatures come from every
    // provider, the ones the ore finder skips (graveyards, derelicts) included.
    for (const g of (row.data.Groups ?? []) as Json[]) {
      if (!/^salvage_/i.test(String(g.GroupName ?? ''))) continue;
      for (const d of (g.Deposits ?? []) as Json[]) {
        const r = rocks.get(String(d.ResourceUUID ?? ''));
        const sig = num(r?.Signature);
        const name = str(r?.Name);
        if (r?.Kind !== 'salvageable' || !sig || !name) continue;
        addSig(name, 'salvage', 'salvage', sig, num(d.Clustering?.MaxSize), null);
      }
    }
    const where = resourcePlace(row);
    if (!where) continue;
    for (const g of (row.data.Groups ?? []) as Json[]) {
      const method = METHOD_BY_GROUP[String(g.GroupName ?? '').toLowerCase()];
      if (!method) continue;
      const groupChance = num(g.GroupProbability);
      const deposits: Json[] = g.Deposits ?? [];
      const total = deposits.reduce((t, d) => t + (num(d.RelativeProbability) ?? 0), 0) || 1;
      for (const d of deposits) {
        const quals: Json[] = d.ResourceQualities ?? [];
        const byOre = new Map<string, Json[]>();
        for (const q of quals) {
          if (!q.ResourceKey) continue;
          const k = materialKey(String(q.ResourceKey));
          byOre.set(k, [...(byOre.get(k) ?? []), q]);
        }
        const main = [...byOre].sort(
          (a, b) =>
            Math.max(...b[1].map((q) => num(q.MaxPercentage) ?? 0)) -
            Math.max(...a[1].map((q) => num(q.MaxPercentage) ?? 0)),
        )[0];
        if (!main) continue;
        const rock = rocks.get(String(d.ResourceUUID ?? ''));
        const rockName = str(rock?.Composition?.DepositName) ?? oreName(main[0]);
        const signature = num(rock?.Signature) || null;
        const bands = main[1]
          .map((q) => ({
            minPct: num(q.MinPercentage) ?? 0,
            maxPct: num(q.MaxPercentage) ?? 0,
            minQ: num(q.QualityRange?.Min) ?? 0,
            maxQ: num(q.QualityRange?.Max) ?? 0,
          }))
          .sort((a, b) => b.maxQ - a.maxQ);
        spots.push({
          ore: main[0],
          ...where,
          method,
          rock: rockName,
          chance: Math.round(((num(d.RelativeProbability) ?? 0) / total) * 1000) / 1000,
          groupChance,
          bands,
          signature,
          clusterMin: num(d.Clustering?.MinSize),
          clusterMax: num(d.Clustering?.MaxSize),
        });
        if (signature) addSig(rockName, main[0], method, signature, num(d.Clustering?.MaxSize), where.place);
      }
    }
  }
  // One row per place, rock and method (several providers can name the same place).
  const seen = new Set<string>();
  const unique = spots.filter((s) => {
    const k = `${s.ore}|${s.place}|${s.system}|${s.method}|${s.rock}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  unique.sort((a, b) => b.chance - a.chance || a.place.localeCompare(b.place));
  const signatures = [...sigs.values()].sort((a, b) => a.signature - b.signature || a.rock.localeCompare(b.rock));
  for (const s of signatures) s.places.sort();
  return { spots: unique, signatures };
}

/** Copies players can't fit: templates, tests and ship-built-in arms. */
const NOT_A_LASER = /template|test|_mpuv_arm/i;

export function miningLaserFromItem(row: {
  uuid: string;
  class_name?: string | null;
  name?: string | null;
  manufacturer_name?: string | null;
  size?: number | null;
  data: Json;
}): MiningLaser | null {
  const s: Json = row.data?.stdItem ?? row.data ?? {};
  const l: Json = s.MiningLaser ?? {};
  const name = str(row.name) ?? str(s.Name);
  const size = num(row.size) ?? num(s.Size) ?? 0;
  if (!name || NOT_A_LASER.test(row.class_name ?? '')) return null;
  const modifiers = filterFix((l.Modifiers ?? {}) as Json);
  const needs = ((s.RequiredTags ?? []) as unknown[]).map(String).filter((t) => t !== 'miningMount');
  return {
    uuid: row.uuid,
    name,
    maker: str(row.manufacturer_name) ?? str(s.Manufacturer?.Name),
    size,
    power: num(l.PowerTransfer),
    minPower: num(l.MinPowerTransfer),
    extraction: num(l.ExtractionThroughput),
    optimalRange: num(l.OptimalRange),
    maxRange: num(l.MaximumRange),
    moduleSlots: num(l.ModuleSlots) ?? 0,
    bespokeFor: needs[0] ?? null,
    modifiers,
  };
}

export function miningModuleFromItem(row: {
  uuid: string;
  class_name?: string | null;
  name?: string | null;
  manufacturer_name?: string | null;
  data: Json;
}): MiningModule | null {
  const s: Json = row.data?.stdItem ?? row.data ?? {};
  const m: Json = s.MiningModule ?? {};
  const type = str(s.DescriptionData?.['Item Type']) ?? '';
  const name = str(row.name) ?? str(s.Name);
  // Player modules are "Mining_Modules_Active_…" / "…_Passive_…" (the ROC's built-in one and the bare template are left out).
  if (!name || !/^Mining_Modules_(Active|Passive)_/i.test(row.class_name ?? '')) return null;
  const mods: Json = m.Modifiers ?? {};
  const modifiers = filterFix(mods);
  const active = /active/i.test(String(m.Type ?? type));
  return {
    uuid: row.uuid,
    name,
    maker: str(row.manufacturer_name) ?? str(s.Manufacturer?.Name),
    kind: active ? 'Active' : 'Passive',
    charges: active ? num(m.Charges) : null,
    lifetime: active ? num(m.Lifetime) : null,
    power: num(mods.DamageMultiplier),
    modifiers,
    rarity: str(s.Rarity),
  };
}

/**
 * Percent changes, without the damage multiplier (that's `power`). The game
 * has one inert-material filter value (`filterModifier`: Arbor MH1 30, FLTR 20),
 * which scunpacked writes twice: as "AllChargeRates" and as "InertMaterials"
 * (negative for lasers, positive for modules). There is no all-charge-rates
 * stat in the game files, so the pair becomes one InertMaterials change,
 * negative = less inert material collected (good for the miner). v1.52.0.
 */
export function filterFix(mods: Json): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(mods))
    if (k !== 'DamageMultiplier' && k !== 'DamageMultiplierChange' && num(v)) out[k] = v as number;
  const all = out.AllChargeRates,
    inert = out.InertMaterials;
  if (all != null && (inert == null || Math.abs(inert) === Math.abs(all))) {
    out.InertMaterials = -Math.abs(all);
    delete out.AllChargeRates;
  }
  return out;
}

/** Mining gadgets: "Mining_Gadget_<maker>_<name>", placed on a rock. Their numbers live in MiningModule. */
export function miningGadgetFromItem(row: {
  uuid: string;
  class_name?: string | null;
  name?: string | null;
  manufacturer_name?: string | null;
  data: Json;
}): MiningGadget | null {
  const s: Json = row.data?.stdItem ?? row.data ?? {};
  const name = str(row.name) ?? str(s.Name);
  if (!name || !/^Mining_Gadget_/i.test(row.class_name ?? '')) return null;
  return {
    uuid: row.uuid,
    name,
    maker: str(row.manufacturer_name) ?? str(s.Manufacturer?.Name),
    modifiers: filterFix(s.MiningModule?.Modifiers ?? {}),
    rarity: str(s.Rarity),
  };
}

/** Lasers and modules with identical numbers are one choice. */
export function dedupeMining<T extends { name: string }>(list: T[], key: (x: T) => unknown[]): T[] {
  const seen = new Set<string>();
  return list.filter((x) => {
    const k = JSON.stringify(key(x));
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * What a scanner reading can be: one rock's signature times the number of
 * rocks, never more rocks than that type ever clusters in (`maxCluster`, from
 * the files: legendary ores 2, epic 3, rare 4, uncommon 5, common 6; ROC and
 * hand gems up to about 25). Rock types sharing a signature (the ROC gems,
 * the hand gems) are one hit. With a place, rocks that don't spawn there are
 * dropped and the rest are ordered by their spawn chance there. v1.52.0.
 */
export function matchSignature(
  value: number,
  signatures: readonly RockSignature[],
  opts: { place?: string | null; spots?: readonly OreSpot[]; maxCount?: number } = {},
): ScanHit[] {
  if (!(value > 0)) return [];
  const place = opts.place || null;
  const chanceAt = (s: RockSignature): number | null => {
    if (!place || !opts.spots) return null;
    const hit = opts.spots.find((p) => p.place === place && p.rock === s.rock && p.method === s.method);
    return hit ? hit.chance : null;
  };
  const hits = new Map<string, ScanHit>();
  for (const s of signatures) {
    if (!(s.signature > 0) || value % s.signature !== 0) continue;
    const count = value / s.signature;
    if (count < 1 || count > (s.maxCluster || opts.maxCount || 8)) continue;
    if (place && s.method !== 'salvage' && !s.places.includes(place)) continue;
    const k = `${s.method}|${s.signature}|${count}`;
    const h = hits.get(k) ?? { count, each: s.signature, method: s.method, rocks: [] };
    h.rocks.push({ rock: s.rock, ore: s.ore, chance: chanceAt(s) });
    hits.set(k, h);
  }
  const best = (h: ScanHit) => Math.max(...h.rocks.map((r) => r.chance ?? 0));
  for (const h of hits.values())
    h.rocks.sort((a, b) => (b.chance ?? 0) - (a.chance ?? 0) || a.rock.localeCompare(b.rock));
  return [...hits.values()].sort((a, b) => best(b) - best(a) || a.count - b.count);
}

/** Words for a hit: "2 × Laranite (Raw)", "4 × ROC gem (Beradom, Feynmaline, Glacosite)". */
export function scanHitLabel(h: ScanHit): string {
  if (h.rocks.length === 1) return `${h.count} × ${h.rocks[0]!.rock}`;
  const kind =
    h.method === 'roc'
      ? 'ROC gem'
      : h.method === 'hand'
        ? 'hand-mining gem'
        : h.method === 'salvage'
          ? 'salvage'
          : 'rock';
  return `${h.count} × ${kind} (${h.rocks.map((r) => r.rock).join(', ')})`;
}

export const MINING_LASERS_SQL = `
  SELECT uuid, class_name, name, manufacturer_name, size, data FROM scdata.items
  WHERE type = 'WeaponMining' AND NOT is_placeholder
`;
export const MINING_GADGETS_SQL = `
  SELECT uuid, class_name, name, manufacturer_name, size, data FROM scdata.items
  WHERE class_name ILIKE 'Mining\\_Gadget\\_%' AND NOT is_placeholder
`;
export const MINING_MODULES_SQL = `
  SELECT uuid, class_name, name, manufacturer_name, size, data FROM scdata.items
  WHERE type = 'MiningModifier' AND NOT is_placeholder
`;

// ── Mining heads on ships (v1.50.0) ──────────────────────────────────────────

/** One mining laser mount on a ship: a crew turret (Mole) or the pilot's arm (Prospector, Golem). */
export interface MiningHead {
  /** Hardpoint path, unique on the ship. */
  id: string;
  /** "Front turret", "Mining arm"… */
  label: string;
  size: number;
  stockLaserUuid: string | null;
  /** A crew member runs it (manned turret), not the pilot. */
  crewed: boolean;
  /** The ship's own mount can't take another laser (the Golem). Modules still swap. */
  locked: boolean;
}

const PLACE_WORDS: [RegExp, string][] = [
  [/front/i, 'Front'],
  [/left/i, 'Left'],
  [/right/i, 'Right'],
  [/rear|back/i, 'Rear'],
  [/top/i, 'Top'],
];

/**
 * Every mining laser mount on a ship (size 1 and up: the ROC's and hand
 * lasers are size 0). A mount is a port holding a WeaponMining item, or an
 * empty port that takes one. It's locked when a port between the ship's
 * own hardpoint and the laser can't be changed (the Golem's arm); the
 * hardpoint itself is never changeable (the Mole's cabs) and doesn't count.
 */
export function shipMiningHeads(ship: Json): MiningHead[] {
  const out: (MiningHead & { root: string })[] = [];
  const isLaser = (p: Json) => String(p.Type ?? '').startsWith('WeaponMining');
  const takesLaser = (p: Json) => ((p.CompatibleTypes ?? []) as Json[]).some((t) => t.Type === 'WeaponMining');
  const laserBelow = (p: Json): boolean => ((p.Loadout ?? []) as Json[]).some((q) => isLaser(q) || laserBelow(q));
  const walk = (ports: Json[] | undefined, path: Json[]) => {
    for (const p of ports ?? []) {
      const here = [...path, p];
      if (isLaser(p) || (takesLaser(p) && !laserBelow(p))) {
        const size = num(p.MaxSize) ?? 0;
        if (size < 1) continue;
        const root = here[0]!;
        out.push({
          id: here.map((x) => String(x.HardpointName ?? '')).join('/'),
          label: '',
          root: String(root.HardpointName ?? ''),
          size,
          stockLaserUuid: isLaser(p) ? str(p.UUID) : null,
          crewed: /MannedTurret/i.test(String(root.Type ?? '')),
          locked: here.slice(1).some((x) => x.Editable === false),
        });
        continue;
      }
      walk(p.Loadout, here);
    }
  };
  walk(ship.Loadout, []);
  return out.map(({ root, ...h }, i) => {
    const place = PLACE_WORDS.find(([re]) => re.test(root))?.[1];
    const what = h.crewed ? 'turret' : 'mining arm';
    const label = place
      ? `${place} ${what}`
      : out.length > 1
        ? `Mining head ${i + 1}`
        : what[0]!.toUpperCase() + what.slice(1);
    return { ...h, label };
  });
}

/** Whether a laser can go on a head: same size, sold for any ship (the stock laser always fits). */
export function laserFitsHead(l: MiningLaser, head: MiningHead): boolean {
  if (l.uuid === head.stockLaserUuid) return true;
  if (head.locked || l.bespokeFor) return false;
  return l.size === head.size;
}

export interface MiningHeadTotals {
  power: number | null;
  minPower: number | null;
  extraction: number | null;
  /** Percent changes from the laser and its modules together. */
  modifiers: Record<string, number>;
  modules: number;
}

/**
 * One head's numbers with its modules (active modules counted as switched
 * on). Laser power is multiplied by each module's power multiplier; percent
 * changes are combined by multiplying (1 + a)(1 + b) − 1. How the game
 * combines them still has to be checked against Regolith.
 */
export function miningHeadTotals(
  laser: MiningLaser | null,
  modules: readonly (MiningModule | null)[],
): MiningHeadTotals {
  const fitted = modules.filter((m): m is MiningModule => !!m);
  const mult = fitted.reduce((t, m) => t * (m.power ?? 1), 1);
  const pct: Record<string, number> = { ...(laser?.modifiers ?? {}) };
  for (const m of fitted) {
    for (const [k, v] of Object.entries(m.modifiers)) pct[k] = ((1 + (pct[k] ?? 0) / 100) * (1 + v / 100) - 1) * 100;
  }
  for (const k of Object.keys(pct)) {
    pct[k] = Math.round(pct[k]! * 10) / 10;
    if (!pct[k]) delete pct[k];
  }
  return {
    power: laser?.power != null ? laser.power * mult : null,
    minPower: laser?.minPower != null ? laser.minPower * mult : null,
    extraction: laser?.extraction ?? null,
    modifiers: pct,
    modules: fitted.length,
  };
}
