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

export function searchBlueprints(q: string, type?: string): CraftingBlueprint[] {
  const query = q.trim().toLowerCase();
  return current().obtainable.filter((b) => {
    const matchesType = !type || b.type === type;
    const matchesQ = !query || b.name.toLowerCase().includes(query) || b.type.toLowerCase().includes(query);
    return matchesType && matchesQ;
  });
}

/** Base stats of the crafted item (null when the game data has none for it). */
export function getBaseStats(itemUuid: string, _type: string): ItemBaseStats | null {
  return current().data.baseStats[itemUuid] ?? null;
}

// ── Stat interpolation ───────────────────────────────────────────────────────

export function interpolateStat(stat: CraftingStat, ql: number): number {
  if (stat.segments && stat.segments.length > 0) {
    const seg = stat.segments.find((s) => ql >= s.qMin && ql <= s.qMax) ?? stat.segments[stat.segments.length - 1]!;
    const range = seg.qMax - seg.qMin;
    if (range <= 0) return seg.mStart;
    const t = Math.max(0, Math.min(1, (ql - seg.qMin) / range));
    return seg.mStart + t * (seg.mEnd - seg.mStart);
  }
  const range = stat.qualityMax - stat.qualityMin;
  if (range <= 0) return stat.multiplierAtMin;
  const t = Math.max(0, Math.min(1, (ql - stat.qualityMin) / range));
  return stat.multiplierAtMin + t * (stat.multiplierAtMax - stat.multiplierAtMin);
}

/** The combined multiplier for a stat key given the quality chosen for each component slot. */
export function combinedMultiplier(bp: CraftingBlueprint, statKey: string, qls: number[]): number {
  let mult = 1;
  bp.components.forEach((comp, i) => {
    const ql = qls[i] ?? 500;
    for (const s of comp.stats) {
      if (s.key === statKey) mult *= interpolateStat(s, ql);
    }
  });
  return mult;
}
