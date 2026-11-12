// Crafting data for the Blueprints and Crafting Calculator pages.
//
// v1.11.2: this used to be a frozen JSON snapshot bundled into the site. It now
// comes from the API (GET /api/game-data/crafting), built from the same sc-data
// the bot and the SC Database page use (packages/shared/src/crafting.ts).
// <CraftingDataGate> (components/CraftingDataGate.tsx) loads it before those
// pages render; the functions below read what it loaded.

import type {
  CraftingBlueprint,
  CraftingDataDto,
  CraftingStat,
  ItemBaseStats,
  MaterialSources,
  MissionContract,
} from '@dem/shared';

export type {
  CraftingStatSegment as LocalStatSegment,
  CraftingStat as LocalStat,
  CraftingMaterial as LocalMaterial,
  CraftingComponent as LocalComponent,
  CraftingDismantleReturn as LocalDismantleReturn,
  CraftingDismantle as LocalDismantle,
  CraftingBlueprint as LocalBlueprint,
  ArmorBaseStats,
  ShieldBaseStats,
  WeaponBaseStats,
  PowerPlantBaseStats,
  QuantumDriveBaseStats,
  GenericBaseStats,
  ItemBaseStats,
  MissionBlueprintEntry,
  MissionPool,
  MissionReputation,
  MissionDifficulty,
  MissionStanding,
  MissionContract,
} from '@dem/shared';
import { statAt } from '@dem/shared';

// ── What CraftingDataGate loaded ─────────────────────────────────────────────

interface Loaded {
  data: CraftingDataDto;
  byUuid: Map<string, CraftingBlueprint>;
  obtainable: CraftingBlueprint[];
  obtainableSet: Set<string>;
  types: string[];
}

let loaded: Loaded | null = null;

/** Called by CraftingDataGate when the data arrives (or a new game build does). */
export function setCraftingData(data: CraftingDataDto): void {
  if (loaded?.data === data) return;
  const obtainableSet = new Set(data.obtainableUuids);
  const obtainable = data.blueprints.filter((b) => obtainableSet.has(b.uuid));
  loaded = {
    data,
    byUuid: new Map(data.blueprints.map((b) => [b.uuid, b])),
    obtainable,
    obtainableSet,
    types: [...new Set(obtainable.map((b) => b.type))].sort(),
  };
}

function current(): Loaded {
  if (!loaded) throw new Error('Crafting data not loaded: wrap the page in <CraftingDataGate>');
  return loaded;
}

/** Where each material is mined, by lower-case name (v1.26.0). */
export const materialSources = (): MaterialSources => current().data.materialSources ?? {};

/** Which game build the pages are showing. */
export const craftingSource = () => current().data.source;

// ── Lookups ──────────────────────────────────────────────────────────────────

export function getBlueprintByUuid(uuid: string): CraftingBlueprint | undefined {
  return current().byUuid.get(uuid);
}

/** Blueprints a mission can reward. */
export const obtainableBlueprints = (): CraftingBlueprint[] => current().obtainable;

/** Item types among those blueprints, for the type filter. */
export const blueprintTypes = (): string[] => current().types;

/** Mission contracts that reward blueprints. */
export const missionContracts = (): MissionContract[] => current().data.missions;

const plain = (s: string) => s.toLowerCase().replace(/["'“”‘’]/g, '').replace(/[^a-z0-9.]+/g, ' ');
const haystacks = new WeakMap<CraftingBlueprint, string>();
function haystack(b: CraftingBlueprint): string {
  let h = haystacks.get(b);
  if (h == null) {
    h = ` ${plain([b.name, b.type, b.type.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'), b.subtype ?? '', b.manufacturer ?? ''].join(' '))} `;
    haystacks.set(b, h);
  }
  return h;
}

/** Blueprints whose name, type or maker contain every word searched, in any order ("karna rager" finds Karna "Rager" Rifle). */
export function searchBlueprints(q: string, type?: string): CraftingBlueprint[] {
  const words = plain(q).split(' ').filter(Boolean);
  return current().obtainable.filter((b) => (!type || b.type === type) && words.every((w) => haystack(b).includes(w)));
}

/** Base stats of the crafted item (null when the game data has none for it). */
export function getBaseStats(itemUuid: string, _type: string): ItemBaseStats | null {
  return current().data.baseStats[itemUuid] ?? null;
}

// ── Stat interpolation ───────────────────────────────────────────────────────

/** A stat at a quality: a multiplier, or for an additive stat the whole number added (statAt in shared, v1.28.1). */
export function interpolateStat(stat: CraftingStat, ql: number): number {
  return statAt(stat, ql);
}

/** Adds a whole number per quality band (Power Pips…) instead of multiplying. */
export const isAdditive = (stat: CraftingStat) => stat.curve === 'additive';

/** The total added to a stat key by the parts' additive curves at their chosen quality. */
export function combinedAdditive(bp: CraftingBlueprint, statKey: string, qls: number[]): number {
  let sum = 0;
  bp.components.forEach((comp, i) => {
    for (const s of comp.stats) if (s.key === statKey && isAdditive(s)) sum += interpolateStat(s, qls[i] ?? 500);
  });
  return Math.round(sum);
}

/** The combined multiplier for a stat key given the quality chosen for each component slot. */
export function combinedMultiplier(bp: CraftingBlueprint, statKey: string, qls: number[]): number {
  let mult = 1;
  bp.components.forEach((comp, i) => {
    const ql = qls[i] ?? 500;
    for (const s of comp.stats) {
      if (s.key === statKey && !isAdditive(s)) mult *= interpolateStat(s, ql);
    }
  });
  return mult;
}
