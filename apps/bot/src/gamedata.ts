import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// ── Path resolution ───────────────────────────────────────────────────────────
// Works from both src/ (tsx dev) and dist/ (node build) since both are 3 levels
// below the monorepo root.

const DATA_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/shared/src/Filtered Data',
);

// ── Raw JSON shapes ───────────────────────────────────────────────────────────

interface RawBpItem {
  Name: string;
  ItemUUID: string;
  BlueprintUUID: string;
}

interface RawBpPool {
  Chance: number;
  PoolUUID: string;
  Items: RawBpItem | RawBpItem[];
}

interface RawDifficulty {
  MechanicalSkill?: string;
  MentalLoad?: string;
  RiskOfLoss?: string;
  GameKnowledge?: string;
  Profile?: string;
}

interface RawStanding {
  Name?: string;
  MinReputation?: number;
}

interface RawReputation {
  Faction?: string;
  XP?: number;
}

interface RawMission {
  Title?: string;
  Description?: string;
  MissionType?: string;
  MissionGiver?: string;
  Faction?: string;
  Locations?: string[];
  BlueprintPool?: RawBpPool[];
  Reputation?: RawReputation[];
  Difficulty?: RawDifficulty;
  TimeToCompleteMinutes?: number;
  MinStanding?: RawStanding;
  Illegal?: boolean;
}

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
export interface ContractReputation { faction: string; xp: number }

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

function buildContracts(): MissionContract[] {
  console.log('[gamedata] Loading Missions.json…');
  const raw = JSON.parse(
    readFileSync(resolve(DATA_DIR, 'Missions.json'), 'utf8'),
  ) as RawMission[];

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
      .map((r) => ({ faction: r.Faction!, xp: r.XP! }));

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
  console.log(`[gamedata] ${result.length} mission contracts loaded`);
  return result;
}

// ── Exported data ─────────────────────────────────────────────────────────────

export const MISSION_CONTRACTS: MissionContract[] = buildContracts();

// Blueprint UUID → Set<MissionContract> (Set gives O(1) dedup by reference)
const _byBlueprint = new Map<string, Set<MissionContract>>();
for (const contract of MISSION_CONTRACTS) {
  for (const pool of contract.pools) {
    for (const bp of pool.blueprints) {
      const set = _byBlueprint.get(bp.blueprintUuid) ?? new Set<MissionContract>();
      set.add(contract);
      _byBlueprint.set(bp.blueprintUuid, set);
    }
  }
}

/** Returns all mission contracts that can reward the given blueprint UUID. */
export function getContractsForBlueprint(blueprintUuid: string): MissionContract[] {
  const set = _byBlueprint.get(blueprintUuid);
  return set ? [...set] : [];
}

/** Set of blueprint UUIDs that appear in at least one known mission contract. */
export const BLUEPRINT_UUIDS_WITH_CONTRACTS: ReadonlySet<string> = new Set(
  _byBlueprint.keys(),
);
