// Crafting data: blueprints, mission contracts that reward them, and the base
// stats of what they make, built from our sc-data copy (Postgres schema
// `scdata`, see apps/sc-data/README.md).
//
// v1.11.2: the website's Blueprints and Crafting Calculator pages used a frozen
// JSON snapshot bundled into the site (packages/shared/src/Filtered Data). They
// now get this from the API (GET /api/game-data/crafting), built here, so the
// pages, the bot's /blueprint and /material commands and the SC Database page
// all read the same, current data.
//
// Two steps:
//   1. adaptBlueprint / adaptContract turn sc-data's JSON into the "raw" shapes
//      the old snapshot used (the bot's pipeline also starts from these).
//   2. buildCraftingData turns those into what the pages show.

import { buildMaterialSources, type MaterialSources, type ResourceLocationRow } from './materialSources.js';

// ═══ Raw shapes (the old snapshot's format) ════════════════════════════════

export interface RawBpItem { Name: string; ItemUUID: string; BlueprintUUID: string }
export interface RawBpPool { Chance: number; PoolUUID: string; Items: RawBpItem | RawBpItem[] }
export interface RawDifficulty { MechanicalSkill?: string; MentalLoad?: string; RiskOfLoss?: string; GameKnowledge?: string; Profile?: string }
export interface RawStanding { Name?: string; MinReputation?: number }
export interface RawReputation { Faction?: string; XP?: number; Scope?: string }

export interface RawMission {
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

export interface RawResource { UUID: string; Name: string }

export interface RawStat {
  Key: string;
  Label: string;
  QualityMin: number;
  QualityMax: number;
  MultiplierAtMin: number;
  MultiplierAtMax: number;
  UnitFormat: string | null;
}

export interface RawMaterial {
  UUID: string | null;
  Name: string | null;
  Kind: string;
  Quantity: number | null;
  QuantityScu: number | null;
  MinQuality: number | null;
}

export interface RawComponent { Slot: string; Material: RawMaterial; Stats: RawStat[] }

export interface RawDismantleReturn { UUID: string | null; Name: string | null; Kind: string; Quantity: number | null; QuantityScu: number | null }

export interface RawDismantle {
  TimeSeconds: number | null;
  Efficiency: number | null;
  Returns?: RawDismantleReturn[];
}

export interface RawLocalBlueprint {
  UUID: string;
  Key: string;
  Name: string;
  ItemUUID: string;
  Type: string;
  Subtype: string | null;
  Grade: string | null;
  CraftTimeSeconds: number;
  Components: RawComponent[];
  Dismantle: RawDismantle | null;
}

// ═══ sc-data JSON (the parts we use) ═══════════════════════════════════════

export interface ScRequirementNode {
  Kind: string;
  Name?: string | null;
  UUID?: string | null;
  Quantity?: number | null;
  QuantityScu?: number | null;
  MinQuality?: number | null;
  Children?: ScRequirementNode[];
  Modifiers?: {
    Key: string;
    Name: string;
    UnitFormat?: string | null;
    QualityRange?: { Min: number; Max: number };
    ModifierRange?: { AtMinQuality: number; AtMaxQuality: number };
  }[];
}

export interface ScBlueprintJson {
  UUID: string;
  Key: string;
  Output?: { UUID?: string; Name?: string; Type?: string; Subtype?: string | null; Grade?: string | null };
  Tiers?: { CraftTimeSeconds?: number; Requirements?: ScRequirementNode }[];
  Dismantle?: {
    TimeSeconds?: number | null;
    Efficiency?: number | null;
    Returns?: { Kind?: string; Name?: string | null; UUID?: string | null; Quantity?: number | null; QuantityScu?: number | null }[] | null;
  } | null;
}

export interface ScContractJson {
  Title?: string | null;
  DisplayTitle?: string | null;
  DebugName?: string | null;
  Description?: string | null;
  DisplayDescription?: string | null;
  MissionType?: { Name?: string } | null;
  MissionGiver?: string | null;
  Faction?: { Name?: string } | null;
  Blueprints?: { Chance?: number; PoolUUID: string; PoolContents?: { ItemName?: string; ItemUUID?: string; BlueprintUUID?: string }[] }[];
  ReputationGained?: { Faction?: string; Amount?: number; Scope?: string }[];
  Difficulty?: { MechanicalSkill?: string; MentalLoad?: string; RiskOfLoss?: string; GameKnowledge?: string; DifficultyProfile?: string } | null;
  TimeToComplete?: number | null;
  MinStanding?: { Name?: string; MinReputation?: number } | null;
  Illegal?: boolean;
  LocationPools?: Record<string, { Purpose?: string; ResolvedLocations?: { Name?: string }[] }>;
}

/** Contracts worth loading: they can reward blueprints and are in the game. */
export const CRAFTING_CONTRACTS_SQL = `
  SELECT data FROM scdata.contracts
  WHERE data ? 'Blueprints' AND coalesce(not_for_release, false) = false AND coalesce(work_in_progress, false) = false`;

// ═══ Step 1: sc-data → raw ═════════════════════════════════════════════════

const isToken = (s: string | null | undefined) => !s || /^\s*(~mission\(|<=)/.test(s);
/** A location name the game completes at runtime ("Remote Outpost near ~mission(…)"). */
const hasToken = (s: string) => /~mission\(|<=/.test(s);

export function adaptBlueprint(b: ScBlueprintJson): RawLocalBlueprint {
  const tier = b.Tiers?.[0];
  const groups = tier?.Requirements?.Children ?? [];
  return {
    UUID: b.UUID,
    Key: b.Key,
    Name: b.Output?.Name ?? '',
    ItemUUID: b.Output?.UUID ?? '',
    Type: b.Output?.Type ?? '',
    Subtype: b.Output?.Subtype ?? null,
    Grade: b.Output?.Grade ?? null,
    CraftTimeSeconds: tier?.CraftTimeSeconds ?? 0,
    Components: groups.map((g) => {
      // A slot normally takes one material; the few that accept alternatives
      // are shown as "A or B" with the first one's quantities.
      const options = g.Children && g.Children.length > 0 ? g.Children : [g];
      const first = options[0]!;
      return {
        Slot: g.Name ?? 'Component',
        Material: {
          UUID: first.UUID ?? null,
          Name: options.length > 1 ? options.map((o) => o.Name).filter(Boolean).join(' or ') : (first.Name ?? null),
          Kind: first.Kind,
          Quantity: first.Quantity ?? null,
          QuantityScu: first.QuantityScu ?? null,
          MinQuality: first.MinQuality ?? null,
        },
        Stats: (g.Modifiers ?? []).map((m) => ({
          Key: m.Key,
          Label: m.Name,
          QualityMin: m.QualityRange?.Min ?? 0,
          QualityMax: m.QualityRange?.Max ?? 1000,
          MultiplierAtMin: m.ModifierRange?.AtMinQuality ?? 1,
          MultiplierAtMax: m.ModifierRange?.AtMaxQuality ?? 1,
          UnitFormat: m.UnitFormat ?? null,
        })),
      };
    }),
    Dismantle: b.Dismantle
      ? {
          TimeSeconds: b.Dismantle.TimeSeconds ?? null,
          Efficiency: b.Dismantle.Efficiency ?? null,
          Returns: (b.Dismantle.Returns ?? []).map((r) => ({
            UUID: r.UUID ?? null, Name: r.Name ?? null, Kind: r.Kind ?? 'resource',
            Quantity: r.Quantity ?? null, QuantityScu: r.QuantityScu ?? null,
          })),
        }
      : null,
  };
}

/** Replaces "~mission(Destination|Address)"-style tokens with the location they refer to. */
export function fillMissionTokens(text: string, c: ScContractJson): string {
  const byPurpose = new Map<string, string>();
  for (const pool of Object.values(c.LocationPools ?? {})) {
    const name = pool.ResolvedLocations?.find((l) => l.Name && !hasToken(l.Name))?.Name;
    if (pool.Purpose && name && !byPurpose.has(pool.Purpose.toLowerCase())) byPurpose.set(pool.Purpose.toLowerCase(), name);
  }
  return text.replace(/~mission\(([^|)]*)(?:\|[^)]*)?\)/g, (_m, key: string) => byPurpose.get(key.toLowerCase()) ?? 'the marked location');
}

/** Rooms and areas inside a place; on their own they don't say where to go. */
const ROOM = /^(Lobby|Sector \d+|Security (Checkpoint|Compound)|Inventory Center|Exterior Zone \d+|Central Core & Power|(Engineering|Research) Wing|Abandoned Section|Maintenance Area-\d+|On-Call Area|Operations Office|Shipping Area|Storehouse|Storage Depot|Supply Room|Service Entrance|Staging Point|Hangar \d+|Trading Post|Site-B Lab|Outpost (Depot|Landing Area|Main Building|Storage Shed|Warehouse))$/;
/** "Starlight Service Station Clinic" → "Starlight Service Station". */
const PART_SUFFIX = / (Clinic|Entrance|Habs|Hangar|Exterior|Gas Cloud)$/;

/**
 * A mission's places as a player would look for them (v1.26.1): rooms and
 * sentences dropped, "the clinic inside X" → X, and one name per place
 * (the fuller "Checkmate at the L4 Lagrange of Pyro II" over "Checkmate",
 * "Cutlass wreck site" over "Cutlass"). Every place is kept; the website
 * shows the first few.
 */
export function cleanMissionLocations(names: readonly string[]): string[] {
  const out = new Set<string>();
  for (let n of names) {
    n = n.trim();
    if (!n || n.endsWith('.') || hasToken(n)) continue;
    n = n.replace(/^.+? inside (.+)$/, '$1');
    if (ROOM.test(n.replace(/ inside .+$/, ''))) continue;
    out.add(n.charAt(0).toUpperCase() + n.slice(1));
  }
  const all = [...out];
  for (const n of all) {
    const base = n.replace(PART_SUFFIX, '');
    if (base !== n && out.has(base)) out.delete(n);
  }
  for (const n of [...out]) {
    if (all.some((m) => m !== n && (m.startsWith(`${n} at the `) || m.startsWith(`${n} above `) || m === `${n} wreck site`))) out.delete(n);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

export function adaptContract(c: ScContractJson): RawMission | null {
  const title = !isToken(c.DisplayTitle) ? c.DisplayTitle! : !isToken(c.Title) ? c.Title! : null;
  if (!title) return null; // no readable name (template/test missions)
  const description = !isToken(c.DisplayDescription) ? c.DisplayDescription! : c.Description ?? '';
  const locations = cleanMissionLocations(
    Object.values(c.LocationPools ?? {})
      .flatMap((p) => p.ResolvedLocations ?? [])
      .map((l) => l.Name)
      .filter((n): n is string => !!n && !hasToken(n)),
  );
  return {
    Title: title,
    Description: fillMissionTokens(description, c),
    MissionType: c.MissionType?.Name,
    MissionGiver: c.MissionGiver ?? undefined,
    Faction: c.Faction?.Name,
    Locations: locations,
    BlueprintPool: (c.Blueprints ?? []).map((p) => ({
      Chance: p.Chance ?? 1,
      PoolUUID: p.PoolUUID,
      Items: (p.PoolContents ?? [])
        .filter((i) => i.BlueprintUUID)
        .map((i) => ({ Name: i.ItemName ?? '', ItemUUID: i.ItemUUID ?? '', BlueprintUUID: i.BlueprintUUID! })),
    })),
    Reputation: (c.ReputationGained ?? []).map((r) => ({ Faction: r.Faction, XP: r.Amount, Scope: r.Scope })),
    Difficulty: c.Difficulty
      ? { MechanicalSkill: c.Difficulty.MechanicalSkill, MentalLoad: c.Difficulty.MentalLoad, RiskOfLoss: c.Difficulty.RiskOfLoss,
          GameKnowledge: c.Difficulty.GameKnowledge, Profile: c.Difficulty.DifficultyProfile }
      : undefined,
    TimeToCompleteMinutes: c.TimeToComplete ?? undefined,
    MinStanding: c.MinStanding ?? undefined,
    Illegal: c.Illegal ?? false,
  };
}

// ═══ What the pages show ═══════════════════════════════════════════════════

export interface CraftingStatSegment { qMin: number; qMax: number; mStart: number; mEnd: number }

export interface CraftingStat {
  key: string;
  label: string;
  qualityMin: number;
  qualityMax: number;
  multiplierAtMin: number;
  multiplierAtMax: number;
  curve: string;
  segments: CraftingStatSegment[] | null;
  unitFormat: string | null;
}

export interface CraftingMaterial {
  uuid: string;
  name: string;
  kind: 'resource' | 'item' | 'group';
  quantityScu: number | null;
  quantity: number | null;
  minQuality: number;
}

export interface CraftingComponent { slot: string; material: CraftingMaterial; stats: CraftingStat[] }

export interface CraftingDismantleReturn { name: string; quantityScu: number | null; quantity: number | null }
export interface CraftingDismantle { timeSecs: number; efficiency: number; returns: CraftingDismantleReturn[] }

export interface CraftingBlueprint {
  uuid: string;
  key: string;
  name: string;
  itemUuid: string;
  type: string;
  subtype: string | null;
  grade: string | null;
  craftTimeSecs: number;
  components: CraftingComponent[];
  dismantle: CraftingDismantle | null;
  missions: string[];
  manufacturer: string | null;
  /** Mass of the crafted item in kg, when known. */
  mass: number | null;
}

export interface ArmorBaseStats {
  kind: 'armor';
  resistance: { physical: number; energy: number; distortion: number; thermal: number; biochemical: number; stun: number };
  temperature: { min: number; max: number } | null;
  radiation: { maxCapacity: number; dissipationRate: number } | null;
}
export interface ShieldBaseStats { kind: 'shield'; maxHealth: number }
export interface WeaponBaseStats { kind: 'weapon'; modes: Array<{ name: string; rpm: number; alpha: number; dps: number }> }
export interface PowerPlantBaseStats { kind: 'powerplant'; powerOutput: number }
export interface QuantumDriveBaseStats { kind: 'quantumdrive'; speedMs: number; fuelReq10GM: number; spoolTime: number; cooldownTime: number }
export interface GenericBaseStats { kind: 'generic'; hp: number | null }

export type ItemBaseStats =
  | ArmorBaseStats
  | ShieldBaseStats
  | WeaponBaseStats
  | PowerPlantBaseStats
  | QuantumDriveBaseStats
  | GenericBaseStats;

export interface MissionBlueprintEntry { name: string; blueprintUuid: string }
export interface MissionPool { locations: string[]; blueprints: MissionBlueprintEntry[] }
export interface MissionReputation { faction: string; xp: number; scope: string }
export interface MissionDifficulty {
  mechanicalSkill: number;
  mechanicalSkillLabel: string;
  mentalLoad: number;
  mentalLoadLabel: string;
  riskOfLoss: number;
  riskOfLossLabel: string;
  gameKnowledge: number;
  gameKnowledgeLabel: string;
  profile: string | null;
}
export interface MissionStanding { name: string; minReputation: number }
export interface MissionContract {
  title: string;
  description: string;
  missionType: string | null;
  missionGiver: string | null;
  faction: string | null;
  locations: string[];
  pools: MissionPool[];
  reputation: MissionReputation[];
  difficulty: MissionDifficulty | null;
  timeToCompleteMinutes: number | null;
  minStanding: MissionStanding | null;
  illegal: boolean;
}

/** Everything the Blueprints and Crafting Calculator pages need, for one game build. */
export interface CraftingDataDto {
  source: { build: string | null; commit: string | null };
  /** Every blueprint (the calculator opens any of them by link). */
  blueprints: CraftingBlueprint[];
  /** Blueprints a mission can reward: the ones the pages list and search. */
  obtainableUuids: string[];
  missions: MissionContract[];
  /** Base stats of crafted items, by item UUID. */
  baseStats: Record<string, ItemBaseStats>;
  /** Where each material is mined, by lower-case material name (v1.26.0; materialSources.ts). */
  materialSources: MaterialSources;
}

// ═══ Step 2: raw → pages ═══════════════════════════════════════════════════

const PLACEHOLDER = '<= PLACEHOLDER =>';
const UNINITIALIZED = '<= UNINITIALIZED =>';
const clean = (s: string | null | undefined): string | null => (!s || s === PLACEHOLDER || s === UNINITIALIZED ? null : s);

/** What we know about a crafted item (from scdata.items). */
export interface CraftedItemRow {
  uuid: string;
  type: string | null;
  name: string | null;
  manufacturer: string | null;
  mass: number | null;
  /** scunpacked's `stdItem` for the item. */
  std: unknown;
}

function toBlueprint(b: RawLocalBlueprint, item: CraftedItemRow | undefined, resources: Map<string, string>): CraftingBlueprint {
  const materialName = (uuid: string | null, kind: string) => {
    if (!uuid) return 'Unknown';
    return kind === 'resource' ? resources.get(uuid) ?? uuid : uuid;
  };
  return {
    uuid: b.UUID,
    key: b.Key,
    name: clean(b.Name) ?? clean(item?.name) ?? b.Type,
    itemUuid: b.ItemUUID,
    type: b.Type,
    subtype: b.Subtype && b.Subtype !== 'UNDEFINED' ? b.Subtype : null,
    grade: b.Grade ?? null,
    craftTimeSecs: b.CraftTimeSeconds,
    components: b.Components.map((c) => ({
      slot: c.Slot,
      material: {
        uuid: c.Material.UUID ?? '',
        name: c.Material.Name ?? materialName(c.Material.UUID, c.Material.Kind),
        kind: c.Material.Kind as CraftingMaterial['kind'],
        quantityScu: c.Material.QuantityScu ?? null,
        quantity: c.Material.Quantity ?? null,
        minQuality: c.Material.MinQuality ?? 0,
      },
      stats: c.Stats
        .filter((s) => s.Key != null && s.MultiplierAtMin != null && s.MultiplierAtMax != null)
        .map((s) => ({
          key: s.Key,
          label: s.Label ?? s.Key,
          qualityMin: s.QualityMin ?? 0,
          qualityMax: s.QualityMax ?? 1000,
          multiplierAtMin: s.MultiplierAtMin,
          multiplierAtMax: s.MultiplierAtMax,
          curve: 'linear',
          segments: null,
          unitFormat: s.UnitFormat ?? null,
        })),
    })),
    dismantle: b.Dismantle && typeof b.Dismantle.TimeSeconds === 'number'
      ? {
          timeSecs: b.Dismantle.TimeSeconds,
          efficiency: b.Dismantle.Efficiency ?? 0.5,
          returns: (b.Dismantle.Returns ?? []).map((r) => ({
            name: r.Name ?? materialName(r.UUID, r.Kind),
            quantityScu: r.QuantityScu ?? null,
            quantity: r.Quantity ?? null,
          })),
        }
      : null,
    missions: [],
    manufacturer: clean(item?.manufacturer),
    mass: typeof item?.mass === 'number' ? item.mass : null,
  };
}

const items = (x: RawBpItem | RawBpItem[] | null | undefined): RawBpItem[] => (!x ? [] : Array.isArray(x) ? x : [x]);
const diffScore = (raw: string | null | undefined) => { const m = raw?.match(/_(\d+)$/); return m ? parseInt(m[1]!, 10) : 0; };
const diffLabel = (raw: string | null | undefined) => raw?.replace(/_\d+$/, '').replace(/_/g, ' ') ?? '';

/** Missions grouped by title (variants of one contract), pools de-duplicated with their locations merged. */
export function buildMissionContracts(raw: readonly RawMission[]): MissionContract[] {
  const byTitle = new Map<string, RawMission[]>();
  for (const m of raw) {
    if (!Array.isArray(m.BlueprintPool) || !m.BlueprintPool.some((p) => items(p.Items).length > 0)) continue;
    const t = m.Title ?? 'Unknown';
    byTitle.set(t, [...(byTitle.get(t) ?? []), m]);
  }

  const result: MissionContract[] = [];
  for (const [title, group] of byTitle) {
    const pools = new Map<string, { locations: Set<string>; blueprints: MissionBlueprintEntry[] }>();
    for (const m of group) {
      for (const pool of m.BlueprintPool ?? []) {
        const contents = items(pool.Items);
        if (contents.length === 0) continue;
        const fp = contents.map((c) => c.BlueprintUUID).sort().join('|');
        const entry = pools.get(fp);
        if (entry) for (const loc of m.Locations ?? []) entry.locations.add(loc);
        else pools.set(fp, { locations: new Set(m.Locations ?? []), blueprints: contents.map((c) => ({ name: c.Name, blueprintUuid: c.BlueprintUUID })) });
      }
    }
    const poolList: MissionPool[] = [...pools.values()].map((p) => ({ locations: cleanMissionLocations([...p.locations]), blueprints: p.blueprints }));
    const first = group[0]!;
    const rd = first.Difficulty;
    const rs = first.MinStanding;
    result.push({
      title,
      description: first.Description ?? '',
      missionType: clean(first.MissionType),
      missionGiver: clean(first.MissionGiver),
      faction: clean(first.Faction),
      locations: cleanMissionLocations(poolList.flatMap((p) => p.locations)),
      pools: poolList,
      reputation: (first.Reputation ?? [])
        .filter((r) => !!clean(r.Faction) && r.XP != null)
        .map((r) => ({ faction: r.Faction!, xp: r.XP!, scope: r.Scope ?? 'FactionReputation' })),
      difficulty: rd
        ? {
            mechanicalSkill: diffScore(rd.MechanicalSkill), mechanicalSkillLabel: diffLabel(rd.MechanicalSkill),
            mentalLoad: diffScore(rd.MentalLoad), mentalLoadLabel: diffLabel(rd.MentalLoad),
            riskOfLoss: diffScore(rd.RiskOfLoss), riskOfLossLabel: diffLabel(rd.RiskOfLoss),
            gameKnowledge: diffScore(rd.GameKnowledge), gameKnowledgeLabel: diffLabel(rd.GameKnowledge),
            profile: rd.Profile ?? null,
          }
        : null,
      timeToCompleteMinutes: first.TimeToCompleteMinutes ?? null,
      minStanding: rs?.Name && rs.MinReputation != null ? { name: rs.Name, minReputation: rs.MinReputation } : null,
      illegal: first.Illegal ?? false,
    });
  }
  return result.sort((a, b) => a.title.localeCompare(b.title));
}

// ── Base stats from scunpacked's stdItem ─────────────────────────────────────

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : null);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const path = (x: unknown, ...keys: string[]): unknown => keys.reduce<unknown>((o, k) => obj(o)?.[k], x);
const health = (std: unknown) => num(path(std, 'Durability', 'Health'));

function weaponModes(std: unknown): WeaponBaseStats['modes'] {
  const modes = path(std, 'Weapon', 'Modes');
  return (Array.isArray(modes) ? modes : []).map((m) => ({
    name: typeof obj(m)?.['Name'] === 'string' ? (obj(m)!['Name'] as string) : 'Default',
    rpm: num(obj(m)?.['RoundsPerMinute']) ?? 0,
    alpha: num(obj(m)?.['Alpha']) ?? 0,
    dps: num(obj(m)?.['Dps']) ?? num(obj(m)?.['DamagePerSecond']) ?? 0,
  }));
}

/** Power a power plant generates when online (falls back to its listed usage range). */
function powerOutput(std: unknown): number {
  const states = path(std, 'ResourceNetwork', 'States');
  for (const s of Array.isArray(states) ? states : []) {
    if (obj(s)?.['Name'] !== 'Online') continue;
    const deltas = obj(s)?.['Deltas'];
    const gen = (Array.isArray(deltas) ? deltas : []).find((d) => obj(d)?.['Type'] === 'Generation' && obj(d)?.['Resource'] === 'Power');
    const rate = num(obj(gen)?.['Rate']);
    if (rate != null) return rate;
  }
  return num(path(std, 'ResourceNetwork', 'Usage', 'Power', 'Maximum')) ?? 0;
}

/** The base stats the calculator scales, for one crafted item; same rules as the old snapshot. */
export function baseStatsFor(type: string, std: unknown): ItemBaseStats {
  if (type.startsWith('Char_Armor')) {
    const res = path(std, 'SuitArmor', 'DamageResistance');
    const mult = (k: string) => num(path(res, k, 'Multiplier')) ?? 1;
    const t = obj(path(std, 'TemperatureResistance'));
    const r = obj(path(std, 'RadiationResistance'));
    return {
      kind: 'armor',
      resistance: {
        physical: mult('Physical'), energy: mult('Energy'), distortion: mult('Distortion'),
        thermal: mult('Thermal'), biochemical: mult('Biochemical'), stun: mult('Stun'),
      },
      temperature: t ? { min: num(t['Minimum']) ?? 0, max: num(t['Maximum']) ?? 0 } : null,
      radiation: r ? { maxCapacity: num(r['MaximumRadiationCapacity']) ?? 0, dissipationRate: num(r['RadiationDissipationRate']) ?? 0 } : null,
    };
  }
  if (type === 'Shield') return { kind: 'shield', maxHealth: num(path(std, 'Shield', 'MaxShieldHealth')) ?? health(std) ?? 0 };
  if (type === 'PowerPlant') return { kind: 'powerplant', powerOutput: powerOutput(std) };
  if (type === 'QuantumDrive') {
    const qd = path(std, 'QuantumDrive');
    return {
      kind: 'quantumdrive',
      speedMs: num(path(qd, 'StandardJump', 'DriveSpeed')) ?? 0,
      fuelReq10GM: num(path(qd, 'FuelRequirement10GM')) ?? 0,
      spoolTime: num(path(qd, 'StandardJump', 'SpoolUpTime')) ?? 0,
      cooldownTime: num(path(qd, 'StandardJump', 'CooldownTime')) ?? 0,
    };
  }
  if (type === 'WeaponPersonal' || type === 'WeaponGun') return { kind: 'weapon', modes: weaponModes(std) };
  return { kind: 'generic', hp: health(std) };
}

export interface CraftingSourceRows {
  build: string | null;
  commit: string | null;
  blueprints: readonly ScBlueprintJson[];
  resources: readonly { uuid: string; name: string }[];
  contracts: readonly ScContractJson[];
  /** The items blueprints make (scdata.items for each blueprint's output). */
  items: readonly CraftedItemRow[];
  /** scdata.resource_locations (empty when sc-data doesn't have it yet) */
  resourceLocations?: readonly ResourceLocationRow[];
}

/** Builds the pages' data for one game build. */
export function buildCraftingData(src: CraftingSourceRows): CraftingDataDto {
  const resources = new Map(src.resources.map((r) => [r.uuid, r.name]));
  const itemByUuid = new Map(src.items.map((i) => [i.uuid, i]));
  const blueprints = src.blueprints.map((b) => {
    const raw = adaptBlueprint(b);
    return toBlueprint(raw, itemByUuid.get(raw.ItemUUID), resources);
  });

  const missions = buildMissionContracts(src.contracts.map(adaptContract).filter((m): m is RawMission => m !== null));

  // A blueprint is obtainable when a mission can reward it; remember which missions.
  const missionsByBlueprint = new Map<string, Set<string>>();
  for (const m of missions) {
    for (const p of m.pools) {
      for (const e of p.blueprints) {
        const set = missionsByBlueprint.get(e.blueprintUuid) ?? new Set<string>();
        set.add(m.title);
        missionsByBlueprint.set(e.blueprintUuid, set);
      }
    }
  }
  for (const b of blueprints) b.missions = [...(missionsByBlueprint.get(b.uuid) ?? [])].sort();

  const baseStats: Record<string, ItemBaseStats> = {};
  for (const b of blueprints) {
    const item = itemByUuid.get(b.itemUuid);
    if (item && !(b.itemUuid in baseStats)) baseStats[b.itemUuid] = baseStatsFor(item.type ?? b.type, item.std);
  }

  return {
    source: { build: src.build, commit: src.commit },
    blueprints,
    obtainableUuids: blueprints.filter((b) => missionsByBlueprint.has(b.uuid)).map((b) => b.uuid),
    missions,
    baseStats,
    materialSources: buildMaterialSources(src.resourceLocations ?? []),
  };
}
