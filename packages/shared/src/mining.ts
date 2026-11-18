// Mining for Game Tools (v1.49.0): where each ore is found (ore finder),
// rock signatures for the scanner, and mining lasers and modules, all from
// the game files (scdata.resource_locations, scdata.resources, scdata.items).
// Numbers are kept exactly as the files give them; miners check them.

import { materialKey, resourcePlace, type MiningMethod, type ResourceLocationRow } from './materialSources.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() && !v.startsWith('<=') ? v.trim() : null);

/** One quality band of an ore in a rock: its share of the rock (%) at that quality. */
export interface OreBand { minPct: number; maxPct: number; minQ: number; maxQ: number }

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
  /** The ore's quality bands in the rock, best quality first. */
  bands: OreBand[];
  signature: number | null;
  clusterMin: number | null;
  clusterMax: number | null;
}

export interface RockSignature { rock: string; ore: string; method: MiningMethod; signature: number }

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
}

const METHOD_BY_GROUP: Record<string, MiningMethod> = { spaceship_mineables: 'ship', groundvehicle_mineables: 'roc', fps_mineables: 'hand', 'fps mineables': 'hand' };

/** "pressurized ice" → "Pressurized Ice" */
export const oreName = (key: string) => key.replace(/\b\w/g, (c) => c.toUpperCase());

/** One scdata.resources row (a rock type), by uuid. */
export interface ResourceRow { data: Json }

/**
 * Where every ore is the main ore of a rock, by place and mining method. A rock's
 * main ore is the one with the largest share; rocks only carrying an ore on the
 * side are left out (the finder shows what you'd go to mine).
 */
export function buildOreSpots(locations: readonly ResourceLocationRow[], resources: readonly ResourceRow[]): { spots: OreSpot[]; signatures: RockSignature[] } {
  const rocks = new Map<string, Json>();
  for (const r of resources) if (r.data?.UUID) rocks.set(String(r.data.UUID), r.data);
  const spots: OreSpot[] = [];
  const sigs = new Map<string, RockSignature>();
  for (const row of locations) {
    const where = resourcePlace(row);
    if (!where) continue;
    for (const g of (row.data.Groups ?? []) as Json[]) {
      const method = METHOD_BY_GROUP[String(g.GroupName ?? '').toLowerCase()];
      if (!method) continue;
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
        const main = [...byOre].sort((a, b) => Math.max(...b[1].map((q) => num(q.MaxPercentage) ?? 0)) - Math.max(...a[1].map((q) => num(q.MaxPercentage) ?? 0)))[0];
        if (!main) continue;
        const rock = rocks.get(String(d.ResourceUUID ?? ''));
        const rockName = str(rock?.Composition?.DepositName) ?? oreName(main[0]);
        const signature = num(rock?.Signature) || null;
        const bands = main[1].map((q) => ({
          minPct: num(q.MinPercentage) ?? 0, maxPct: num(q.MaxPercentage) ?? 0,
          minQ: num(q.QualityRange?.Min) ?? 0, maxQ: num(q.QualityRange?.Max) ?? 0,
        })).sort((a, b) => b.maxQ - a.maxQ);
        spots.push({
          ore: main[0], ...where, method, rock: rockName,
          chance: Math.round(((num(d.RelativeProbability) ?? 0) / total) * 1000) / 1000,
          bands, signature,
          clusterMin: num(d.Clustering?.MinSize), clusterMax: num(d.Clustering?.MaxSize),
        });
        if (signature) sigs.set(`${rockName}|${method}`, { rock: rockName, ore: main[0], method, signature });
      }
    }
  }
  // One row per place, rock and method (several providers can name the same place).
  const seen = new Set<string>();
  const unique = spots.filter((s) => { const k = `${s.ore}|${s.place}|${s.system}|${s.method}|${s.rock}`; if (seen.has(k)) return false; seen.add(k); return true; });
  unique.sort((a, b) => b.chance - a.chance || a.place.localeCompare(b.place));
  return { spots: unique, signatures: [...sigs.values()].sort((a, b) => a.signature - b.signature) };
}

/** Copies players can't fit: templates, tests and ship-built-in arms. */
const NOT_A_LASER = /template|test|_mpuv_arm/i;

export function miningLaserFromItem(row: { uuid: string; class_name?: string | null; name?: string | null; manufacturer_name?: string | null; size?: number | null; data: Json }): MiningLaser | null {
  const s: Json = row.data?.stdItem ?? row.data ?? {};
  const l: Json = s.MiningLaser ?? {};
  const name = str(row.name) ?? str(s.Name);
  const size = num(row.size) ?? num(s.Size) ?? 0;
  if (!name || size < 1 || NOT_A_LASER.test(row.class_name ?? '')) return null;
  const modifiers: Record<string, number> = {};
  for (const [k, v] of Object.entries((l.Modifiers ?? {}) as Json)) if (num(v)) modifiers[k] = v as number;
  return {
    uuid: row.uuid, name, maker: str(row.manufacturer_name) ?? str(s.Manufacturer?.Name), size,
    power: num(l.PowerTransfer), minPower: num(l.MinPowerTransfer), extraction: num(l.ExtractionThroughput),
    optimalRange: num(l.OptimalRange), maxRange: num(l.MaximumRange), moduleSlots: num(l.ModuleSlots) ?? 0, modifiers,
  };
}

export function miningModuleFromItem(row: { uuid: string; class_name?: string | null; name?: string | null; manufacturer_name?: string | null; data: Json }): MiningModule | null {
  const s: Json = row.data?.stdItem ?? row.data ?? {};
  const m: Json = s.MiningModule ?? {};
  const type = str(s.DescriptionData?.['Item Type']) ?? '';
  const name = str(row.name) ?? str(s.Name);
  // Player modules are "Mining_Modules_Active_…" / "…_Passive_…" (the ROC's built-in one and the bare template are left out).
  if (!name || !/^Mining_Modules_(Active|Passive)_/i.test(row.class_name ?? '')) return null;
  const mods: Json = m.Modifiers ?? {};
  const modifiers: Record<string, number> = {};
  for (const [k, v] of Object.entries(mods)) if (k !== 'DamageMultiplier' && k !== 'DamageMultiplierChange' && num(v)) modifiers[k] = v as number;
  const active = /active/i.test(String(m.Type ?? type));
  return {
    uuid: row.uuid, name, maker: str(row.manufacturer_name) ?? str(s.Manufacturer?.Name),
    kind: active ? 'Active' : 'Passive',
    charges: active ? num(m.Charges) : null, lifetime: active ? num(m.Lifetime) : null,
    power: num(mods.DamageMultiplier), modifiers, rarity: str(s.Rarity),
  };
}

/** Lasers and modules with identical numbers are one choice. */
export function dedupeMining<T extends { name: string }>(list: T[], key: (x: T) => unknown[]): T[] {
  const seen = new Set<string>();
  return list.filter((x) => { const k = JSON.stringify(key(x)); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Rock types whose signature, times a cluster size, matches what the scanner shows. */
export function matchSignature(value: number, signatures: readonly RockSignature[], maxCount = 8): { count: number; rock: string; ore: string; method: MiningMethod; each: number }[] {
  if (!(value > 0)) return [];
  const out: { count: number; rock: string; ore: string; method: MiningMethod; each: number }[] = [];
  for (const s of signatures) {
    for (let n = 1; n <= maxCount; n++) if (s.signature * n === value) out.push({ count: n, rock: s.rock, ore: s.ore, method: s.method, each: s.signature });
  }
  return out.sort((a, b) => a.count - b.count);
}

export const MINING_LASERS_SQL = `
  SELECT uuid, class_name, name, manufacturer_name, size, data FROM scdata.items
  WHERE type = 'WeaponMining' AND NOT is_placeholder
`;
export const MINING_MODULES_SQL = `
  SELECT uuid, class_name, name, manufacturer_name, size, data FROM scdata.items
  WHERE type = 'MiningModifier' AND NOT is_placeholder
`;
