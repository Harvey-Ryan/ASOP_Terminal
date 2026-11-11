// Game data for the /blueprint and /material commands.
//
// From our own copy of the Star Citizen Wiki data in Postgres, kept current by
// the sc-data worker (apps/sc-data). gamedataScdata.ts reads it and adapts it
// to the raw shapes in packages/shared/src/crafting.ts; everything after that
// is here. loadGameData() runs at startup and every 10 minutes, and reloads
// when a new game build lands. Commands read through the getters at the bottom.
//
// v1.11.2: the fallback to the frozen JSON snapshot (packages/shared/src/
// Filtered Data) is gone, with the snapshot. Until sc-data answers, the store
// is empty and the next reload tries again.

// ── Raw shapes (shared with the API: packages/shared/src/crafting.ts) ────────

import type {
  RawBpItem, RawMission, RawResource, RawLocalBlueprint,
} from '@dem/shared';
export type {
  RawBpItem, RawBpPool, RawDifficulty, RawStanding, RawReputation, RawMission,
  RawResource, RawStat, RawMaterial, RawComponent, RawDismantle, RawLocalBlueprint,
} from '@dem/shared';

// ── Exported types ────────────────────────────────────────────────────────────

export interface ContractDifficulty {
  mechanicalSkill:      number;
  mechanicalSkillLabel: string;
  mentalLoad:           number;
  mentalLoadLabel:      string;
  riskOfLoss:           number;
  riskOfLossLabel:      string;
  gameKnowledge:        number;
  gameKnowledgeLabel:   string;
  profile: string | null;
}

export interface ContractStanding   { name: string; minReputation: number }
export interface ContractBlueprint  { name: string; blueprintUuid: string }
export interface ContractPool       { locations: string[]; blueprints: ContractBlueprint[] }
export interface ContractReputation { faction: string; xp: number; scope: string }

export interface MissionContract {
  title:                 string;
  description:           string;
  missionType:           string | null;
  missionGiver:          string | null;
  faction:               string | null;
  locations:             string[];
  pools:                 ContractPool[];
  reputation:            ContractReputation[];
  difficulty:            ContractDifficulty | null;
  timeToCompleteMinutes: number | null;
  minStanding:           ContractStanding | null;
  illegal:               boolean;
}

// ── Build helpers ─────────────────────────────────────────────────────────────

const PLACEHOLDER   = '<= PLACEHOLDER =>';
const UNINITIALIZED = '<= UNINITIALIZED =>';

function normalise(items: RawBpItem | RawBpItem[] | undefined | null): RawBpItem[] {
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

function diffScore(raw: string | undefined): number {
  const m = raw?.match(/_(\d+)$/);
  const v = m?.[1];
  return v ? parseInt(v, 10) : 0;
}

function diffLabel(raw: string | undefined): string {
  return raw?.replace(/_\d+$/, '').replace(/_/g, ' ') ?? '';
}

function cleanStr(s: string | undefined | null): string | null {
  if (!s || s === PLACEHOLDER || s === UNINITIALIZED) return null;
  return s;
}

// ── Main build function ───────────────────────────────────────────────────────

function buildContracts(raw: RawMission[]): MissionContract[] {

  // Keep only missions that have at least one blueprint pool with items
  const relevant = raw.filter(
    (m) =>
      Array.isArray(m.BlueprintPool) &&
      m.BlueprintPool.some((p) => normalise(p.Items).length > 0),
  );

  // Group by title — multiple missions sharing a title are variants of the same contract
  const byTitle = new Map<string, RawMission[]>();
  for (const m of relevant) {
    const t = m.Title ?? 'Unknown';
    const arr = byTitle.get(t) ?? [];
    arr.push(m);
    byTitle.set(t, arr);
  }

  const result: MissionContract[] = [];

  for (const [title, group] of byTitle) {
    // Deduplicate pools by sorted blueprint-UUID fingerprint, merging locations
    const poolsByFp = new Map<string, {
      locations:  Set<string>;
      blueprints: ContractBlueprint[];
    }>();

    for (const m of group) {
      const rawPools = m.BlueprintPool ?? [];
      const mLocs    = m.Locations    ?? [];

      for (const pool of rawPools) {
        const contents = normalise(pool.Items);
        if (!contents.length) continue;

        const fp = contents.map((c) => c.BlueprintUUID).sort().join('|');
        const existing = poolsByFp.get(fp);
        if (!existing) {
          poolsByFp.set(fp, {
            locations:  new Set(mLocs),
            blueprints: contents.map((c) => ({
              name:          c.Name,
              blueprintUuid: c.BlueprintUUID,
            })),
          });
        } else {
          for (const loc of mLocs) existing.locations.add(loc);
        }
      }
    }

    const pools: ContractPool[] = [...poolsByFp.values()].map((p) => ({
      locations:  [...p.locations].sort(),
      blueprints: p.blueprints,
    }));

    const first = group[0];
    if (!first) continue;

    // Reputation — skip placeholder/uninitialised entries
    const reputation: ContractReputation[] = (
      Array.isArray(first.Reputation) ? first.Reputation : []
    )
      .filter((r) => !!cleanStr(r.Faction) && r.XP != null)
      .map((r) => ({ faction: r.Faction!, xp: r.XP!, scope: r.Scope ?? 'FactionReputation' }));

    // 4-dimension difficulty with numeric scores and human labels
    const rd = first.Difficulty;
    const difficulty: ContractDifficulty | null = rd
      ? {
          mechanicalSkill:      diffScore(rd.MechanicalSkill),
          mechanicalSkillLabel: diffLabel(rd.MechanicalSkill),
          mentalLoad:           diffScore(rd.MentalLoad),
          mentalLoadLabel:      diffLabel(rd.MentalLoad),
          riskOfLoss:           diffScore(rd.RiskOfLoss),
          riskOfLossLabel:      diffLabel(rd.RiskOfLoss),
          gameKnowledge:        diffScore(rd.GameKnowledge),
          gameKnowledgeLabel:   diffLabel(rd.GameKnowledge),
          profile:              rd.Profile ?? null,
        }
      : null;

    // Minimum standing requirement
    const rs = first.MinStanding;
    const minStanding: ContractStanding | null =
      rs?.Name && rs.MinReputation != null
        ? { name: rs.Name, minReputation: rs.MinReputation }
        : null;

    result.push({
      title,
      description:           first.Description        ?? '',
      missionType:           cleanStr(first.MissionType),
      missionGiver:          cleanStr(first.MissionGiver),
      faction:               cleanStr(first.Faction),
      locations:             [...new Set(pools.flatMap((p) => p.locations))].sort(),
      pools,
      reputation,
      difficulty,
      timeToCompleteMinutes: first.TimeToCompleteMinutes ?? null,
      minStanding,
      illegal:               first.Illegal ?? false,
    });
  }

  result.sort((a, b) => a.title.localeCompare(b.title));
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Blueprint + Resource data (Blueprints.json / Resources.json)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Exported types ────────────────────────────────────────────────────────────

export interface LocalMaterial {
  name:        string;
  uuid:        string | null;
  kind:        string;
  slot:        string;
  quantity:    number | null;
  quantityScu: number | null;
  minQuality:  number | null;
}

export interface LocalModifier {
  key:          string;
  name:         string;
  qualityMin:   number;
  qualityMax:   number;
  modifierAtMin: number;
  modifierAtMax: number;
  unitFormat:   string | null;
}

export interface LocalBlueprint {
  uuid:               string;
  key:                string;
  outputName:         string;
  outputType:         string;
  outputSubtype:      string | null;
  outputGrade:        string | null;
  craftTimeSecs:      number;
  materials:          LocalMaterial[];
  modifiers:          LocalModifier[];
  dismantleTimeSecs:  number | null;
  dismantleEfficiency: number | null;
}

// ── Build helpers ─────────────────────────────────────────────────────────────

/**
 * Converts a C-style printf format string (e.g. "%+.2f %%", "%.2f RPM")
 * into a plain unit suffix for display.
 * - Strip leading "%[+]?[.N]f" specifier
 * - Decode "%%" → "%"
 * - Fallback to "%" for null / no-match
 */
function parseUnitFormat(fmt: string | null): string {
  if (!fmt) return '%';
  const suffix = fmt.replace(/^%[+]?\.?\d*f\s*/, '').trim();
  if (suffix === '%%' || suffix === '') return '%';
  return suffix;
}

// ── Build function ────────────────────────────────────────────────────────────

function buildBlueprints(raw: RawLocalBlueprint[], resources: RawResource[]): LocalBlueprint[] {
  const resMap = new Map<string, string>(resources.map((r) => [r.UUID, r.Name]));

  const result: LocalBlueprint[] = [];

  for (const bp of raw) {
    if (!bp.UUID || !bp.Name || bp.Name === PLACEHOLDER || bp.Name === UNINITIALIZED) continue;

    const materials: LocalMaterial[] = [];
    const modifiers: LocalModifier[] = [];

    for (const comp of bp.Components ?? []) {
      const m = comp.Material;
      const resolvedName =
        m.Name ??
        (m.UUID ? (resMap.get(m.UUID) ?? comp.Slot) : comp.Slot);

      materials.push({
        name:        resolvedName,
        uuid:        m.UUID,
        kind:        m.Kind,
        slot:        comp.Slot,
        quantity:    m.Quantity,
        quantityScu: m.QuantityScu,
        minQuality:  m.MinQuality,
      });

      for (const stat of comp.Stats ?? []) {
        modifiers.push({
          key:          stat.Key,
          name:         stat.Label,
          qualityMin:   stat.QualityMin,
          qualityMax:   stat.QualityMax,
          modifierAtMin: stat.MultiplierAtMin,
          modifierAtMax: stat.MultiplierAtMax,
          unitFormat:   parseUnitFormat(stat.UnitFormat),
        });
      }
    }

    result.push({
      uuid:               bp.UUID,
      key:                bp.Key,
      outputName:         bp.Name,
      outputType:         bp.Type,
      outputSubtype:      (!bp.Subtype || bp.Subtype === 'UNDEFINED') ? null : bp.Subtype,
      outputGrade:        bp.Grade ?? null,
      craftTimeSecs:      bp.CraftTimeSeconds,
      materials,
      modifiers,
      dismantleTimeSecs:  bp.Dismantle?.TimeSeconds ?? null,
      dismantleEfficiency: bp.Dismantle?.Efficiency ?? null,
    });
  }

  result.sort((a, b) => a.outputName.localeCompare(b.outputName));
  return result;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export interface GameDataSource {
  /** 'none' until sc-data has answered. */
  kind: 'scdata' | 'none';
  /** Game build, e.g. "4.10.2-LIVE.12881860" (scdata only) */
  build: string | null;
  /** Upstream commit the data came from (scdata only) */
  commit: string | null;
  loadedAt: Date;
}

interface Store {
  source: GameDataSource;
  blueprints: LocalBlueprint[];
  byUuid: Map<string, LocalBlueprint>;
  contractsByBlueprint: Map<string, MissionContract[]>;
  byMaterial: Map<string, LocalBlueprint[]>;
  materialNames: string[];
}

export interface RawGameData {
  blueprints: RawLocalBlueprint[];
  resources: RawResource[];
  missions: RawMission[];
}

/** Builds the indexed store from raw data (either source). Exported for tests. */
export function buildStore(raw: RawGameData, source: GameDataSource): Store {
  const blueprints = buildBlueprints(raw.blueprints, raw.resources);
  const contracts = buildContracts(raw.missions);

  const contractsByBlueprint = new Map<string, MissionContract[]>();
  for (const contract of contracts) {
    for (const pool of contract.pools) {
      for (const bp of pool.blueprints) {
        const list = contractsByBlueprint.get(bp.blueprintUuid) ?? [];
        if (!list.includes(contract)) list.push(contract);
        contractsByBlueprint.set(bp.blueprintUuid, list);
      }
    }
  }

  const byMaterial = new Map<string, LocalBlueprint[]>();
  for (const bp of blueprints) {
    for (const m of bp.materials) {
      // A slot that takes any of several materials is shown as "A or B"; list
      // the blueprint under each of them.
      for (const name of m.name.split(' or ')) {
        const key = name.trim().toLowerCase();
        if (!key) continue;
        const list = byMaterial.get(key) ?? [];
        if (!list.includes(bp)) list.push(bp);
        byMaterial.set(key, list);
      }
    }
  }

  return {
    source,
    blueprints,
    byUuid: new Map(blueprints.map((b) => [b.uuid, b])),
    contractsByBlueprint,
    byMaterial,
    materialNames: [...byMaterial.keys()].sort((a, b) => a.localeCompare(b)),
  };
}

const EMPTY: RawGameData = { blueprints: [], resources: [], missions: [] };

let store: Store | null = null;

function current(): Store {
  // Commands only run after loadGameData() at startup; this is a safety net.
  if (!store) store = buildStore(EMPTY, { kind: 'none', build: null, commit: null, loadedAt: new Date() });
  return store;
}

/**
 * Loads game data from sc-data. Safe to call repeatedly: it only reloads when
 * the game build changed. If sc-data can't be read, whatever is loaded stays
 * (or nothing, at startup) and the next call tries again.
 */
export async function loadGameData(): Promise<GameDataSource> {
  try {
    const { scdataCommit, loadScdataRaw } = await import('./gamedataScdata.js');
    const commit = await scdataCommit();
    if (commit && store?.source.kind === 'scdata' && store.source.commit === commit) return store.source;
    if (commit) {
      const { raw, build } = await loadScdataRaw();
      const next = buildStore(raw, { kind: 'scdata', build, commit, loadedAt: new Date() });
      if (next.blueprints.length > 0) {
        store = next;
        console.log(`[gamedata] Loaded game build ${build ?? commit.slice(0, 12)} from scdata: ${next.blueprints.length} blueprints, ${new Set([...next.contractsByBlueprint.values()].flat()).size} mission contracts`);
        return store.source;
      }
      console.warn('[gamedata] scdata has no blueprints yet; trying again on the next reload');
    } else {
      console.warn('[gamedata] scdata not set up yet; trying again on the next reload');
    }
  } catch (err) {
    console.error('[gamedata] Could not load scdata (trying again on the next reload):', err instanceof Error ? err.message : err);
  }
  return current().source;
}

// ── Getters used by commands ─────────────────────────────────────────────────

export const getGameDataSource = (): GameDataSource => current().source;
export const getBlueprints = (): readonly LocalBlueprint[] => current().blueprints;
export const getBlueprintByUuid = (uuid: string): LocalBlueprint | undefined => current().byUuid.get(uuid);
/** All mission contracts that can reward the given blueprint UUID. */
export const getContractsForBlueprint = (uuid: string): MissionContract[] => current().contractsByBlueprint.get(uuid) ?? [];
export const blueprintHasContracts = (uuid: string): boolean => current().contractsByBlueprint.has(uuid);
/** Distinct material names sorted alphabetically (for autocomplete). */
export const getMaterialNames = (): readonly string[] => current().materialNames;
/** Blueprints that use the given material (case-insensitive exact match). */
export function getBlueprintsForMaterial(materialName: string): LocalBlueprint[] {
  const list = current().byMaterial.get(materialName.toLowerCase());
  return list ? [...list].sort((a, b) => a.outputName.localeCompare(b.outputName)) : [];
}

/** Footer text naming the data the answer came from. */
export function gameDataFooter(): string {
  const s = current().source;
  return s.kind === 'scdata'
    ? `Game data: ${s.build ?? s.commit?.slice(0, 12) ?? 'current'} (Star Citizen Wiki)`
    : 'Game data is still loading. Try again in a few minutes.';
}
