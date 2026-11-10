// Reads the sc-data worker's tables (Postgres schema `scdata`, see
// apps/sc-data/README.md) and adapts them to the raw shapes gamedata.ts already
// understands (the old Filtered Data JSON), so both sources share one pipeline.

import { prisma } from './db.js';
import type { RawGameData, RawLocalBlueprint, RawMission, RawResource } from './gamedata.js';

/** Commit of the data currently in scdata, or null if the worker hasn't run. */
export async function scdataCommit(): Promise<string | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ commit: string }[]>('SELECT commit FROM scdata.source LIMIT 1');
    return rows[0]?.commit ?? null;
  } catch {
    return null; // schema not there yet
  }
}

// ── scdata JSON shapes (the parts we use) ────────────────────────────────────

interface ScRequirementNode {
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

interface ScBlueprint {
  UUID: string;
  Key: string;
  Output?: { UUID?: string; Name?: string; Type?: string; Subtype?: string | null; Grade?: string | null };
  Tiers?: { CraftTimeSeconds?: number; Requirements?: ScRequirementNode }[];
  Dismantle?: { TimeSeconds?: number | null; Efficiency?: number | null } | null;
}

interface ScContract {
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

// ── Adapters ─────────────────────────────────────────────────────────────────

const isToken = (s: string | null | undefined) => !s || /^\s*(~mission\(|<=)/.test(s);
/** A location name the game completes at runtime ("Remote Outpost near ~mission(…)"). */
const hasToken = (s: string) => /~mission\(|<=/.test(s);

export function adaptBlueprint(b: ScBlueprint): RawLocalBlueprint {
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
    Dismantle: b.Dismantle ? { TimeSeconds: b.Dismantle.TimeSeconds ?? null, Efficiency: b.Dismantle.Efficiency ?? null } : null,
  };
}

/** Replaces "~mission(Destination|Address)"-style tokens with the location they refer to. */
export function fillMissionTokens(text: string, c: ScContract): string {
  const byPurpose = new Map<string, string>();
  for (const pool of Object.values(c.LocationPools ?? {})) {
    const name = pool.ResolvedLocations?.find((l) => l.Name && !hasToken(l.Name))?.Name;
    if (pool.Purpose && name && !byPurpose.has(pool.Purpose.toLowerCase())) byPurpose.set(pool.Purpose.toLowerCase(), name);
  }
  return text.replace(/~mission\(([^|)]*)(?:\|[^)]*)?\)/g, (_m, key: string) => byPurpose.get(key.toLowerCase()) ?? 'the marked location');
}

export function adaptContract(c: ScContract): RawMission | null {
  const title = !isToken(c.DisplayTitle) ? c.DisplayTitle! : !isToken(c.Title) ? c.Title! : null;
  if (!title) return null; // no readable name (template/test missions)
  const description = !isToken(c.DisplayDescription) ? c.DisplayDescription! : c.Description ?? '';
  const locations = [...new Set(
    Object.values(c.LocationPools ?? {})
      .flatMap((p) => p.ResolvedLocations ?? [])
      .map((l) => l.Name)
      .filter((n): n is string => !!n && !hasToken(n)),
  )].slice(0, 25);
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

export async function loadScdataRaw(): Promise<{ raw: RawGameData; build: string | null }> {
  const [bps, res, contracts, src] = await Promise.all([
    prisma.$queryRawUnsafe<{ data: ScBlueprint }[]>('SELECT data FROM scdata.blueprints'),
    prisma.$queryRawUnsafe<{ uuid: string; name: string }[]>('SELECT uuid, name FROM scdata.resources'),
    // Only missions that can reward blueprints, and that are actually in the game.
    prisma.$queryRawUnsafe<{ data: ScContract }[]>(
      `SELECT data FROM scdata.contracts
       WHERE data ? 'Blueprints' AND coalesce(not_for_release, false) = false AND coalesce(work_in_progress, false) = false`,
    ),
    prisma.$queryRawUnsafe<{ build: string | null }[]>('SELECT build FROM scdata.source LIMIT 1'),
  ]);
  const resources: RawResource[] = res.map((r) => ({ UUID: r.uuid, Name: r.name }));
  return {
    raw: {
      blueprints: bps.map((r) => adaptBlueprint(r.data)),
      resources,
      missions: contracts.map((r) => adaptContract(r.data)).filter((m): m is RawMission => m !== null),
    },
    build: src[0]?.build ?? null,
  };
}
