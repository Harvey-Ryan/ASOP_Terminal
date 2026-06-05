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

function loadJson<T>(file: string): T {
  const raw = readFileSync(resolve(DATA_DIR, file), 'utf8').replace(/^﻿/, '');
  return JSON.parse(raw) as T;
}

// ── Mission contract raw JSON shapes ─────────────────────────────────────────

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
  Scope?: string;
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

function buildContracts(): MissionContract[] {
  console.log('[gamedata] Loading Missions.json…');
  const raw = loadJson<RawMission[]>('Missions.json');

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

// ═══════════════════════════════════════════════════════════════════════════════
// Blueprint + Resource data (Blueprints.json / Resources.json)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Raw JSON shapes ───────────────────────────────────────────────────────────

interface RawResource { UUID: string; Name: string }

interface RawStat {
  Key:             string;
  Label:           string;
  QualityMin:      number;
  QualityMax:      number;
  MultiplierAtMin: number;
  MultiplierAtMax: number;
  UnitFormat:      string | null;
}

interface RawMaterial {
  UUID:        string | null;
  Name:        string | null;
  Kind:        string;
  Quantity:    number | null;
  QuantityScu: number | null;
  MinQuality:  number | null;
}

interface RawComponent {
  Slot:     string;
  Material: RawMaterial;
  Stats:    RawStat[];
}

interface RawDismantle {
  TimeSeconds: number | null;
  Efficiency:  number | null;
}

interface RawLocalBlueprint {
  UUID:             string;
  Key:              string;
  Name:             string;
  ItemUUID:         string;
  Type:             string;
  Subtype:          string | null;
  Grade:            string | null;
  CraftTimeSeconds: number;
  Components:       RawComponent[];
  Dismantle:        RawDismantle | null;
}

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

function buildBlueprints(): LocalBlueprint[] {
  console.log('[gamedata] Loading Resources.json…');
  const resources = loadJson<RawResource[]>('Resources.json');
  const resMap = new Map<string, string>(resources.map((r) => [r.UUID, r.Name]));

  console.log('[gamedata] Loading Blueprints.json…');
  const raw = loadJson<RawLocalBlueprint[]>('Blueprints.json');

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
  console.log(`[gamedata] ${result.length} blueprints loaded`);
  return result;
}

// ── Exported blueprint data ───────────────────────────────────────────────────

export const BLUEPRINTS: LocalBlueprint[] = buildBlueprints();

export const BLUEPRINT_BY_UUID: ReadonlyMap<string, LocalBlueprint> = new Map(
  BLUEPRINTS.map((b) => [b.uuid, b]),
);

/** material name (lower-cased) → blueprints that use it */
const _byMaterial = new Map<string, Set<LocalBlueprint>>();
for (const bp of BLUEPRINTS) {
  for (const m of bp.materials) {
    const key = m.name.toLowerCase();
    const set = _byMaterial.get(key) ?? new Set<LocalBlueprint>();
    set.add(bp);
    _byMaterial.set(key, set);
  }
}

/** Distinct material names sorted alphabetically (for autocomplete). */
export const MATERIAL_NAMES: readonly string[] = [..._byMaterial.keys()]
  .sort((a, b) => a.localeCompare(b));

/** Returns blueprints that use the given material (case-insensitive exact match). */
export function getBlueprintsForMaterial(materialName: string): LocalBlueprint[] {
  const set = _byMaterial.get(materialName.toLowerCase());
  return set ? [...set].sort((a, b) => a.outputName.localeCompare(b.outputName)) : [];
}
