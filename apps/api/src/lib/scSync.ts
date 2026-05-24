import { randomUUID } from 'node:crypto';
import { prisma } from './prisma.js';

// ── Raw JSON shapes from blueprints.json ──────────────────────────────────────

interface RawOutput {
  UUID: string;
  Class: string;
  Type: string;
  Subtype?: string | null;
  Grade?: string | null;
  Name: string;
}

interface RawRewardPool {
  UUID: string;
  Key: string;
}

interface RawAvailability {
  Default?: boolean;
  RewardPools?: RawRewardPool[];
}

interface RawModifier {
  Key: string;
  Name?: string | null;
  UnitFormat?: string | null;
  QualityRange?: { Min: number; Max: number } | null;
  ModifierRange?: { AtMinQuality: number; AtMaxQuality: number } | null;
}

interface RawNode {
  Kind: string;
  Key?: string | null;
  Name?: string | null;
  UUID?: string | null;
  Modifiers?: RawModifier[];
  Children?: RawNode[];
  QuantityScu?: number | null;
  Quantity?: number | null;
  MinQuality?: number | null;
}

interface RawTier {
  TierIndex: number;
  CraftTimeSeconds: number;
  Requirements?: RawNode | null;
}

interface RawDismantle {
  TimeSeconds?: number | null;
  Efficiency?: number | null;
}

interface RawBlueprint {
  UUID: string;
  Key?: string | null;
  Kind?: string | null;
  CategoryUUID?: string | null;
  Output: RawOutput;
  Availability?: RawAvailability | null;
  Tiers?: RawTier[] | null;
  Dismantle?: RawDismantle | null;
}

// ── Flat types for batch inserts ──────────────────────────────────────────────

type BpRecord = {
  uuid: string; key: string; kind: string; outputUuid: string; outputName: string;
  outputClass: string; outputType: string; outputSubtype: string | null; outputGrade: string | null;
  categoryUuid: string | null; dismantleTimeSecs: number | null; dismantleEfficiency: number | null;
};
type TierRecord   = { id: string; blueprintUuid: string; tierIndex: number; craftTimeSecs: number };
type MatRecord    = { id: string; tierId: string; kind: string; name: string; itemUuid: string | null; quantityScu: number | null; quantity: number | null; minQuality: number | null; groupKey: string | null };
type ModRecord    = { id: string; tierId: string; key: string; name: string; unitFormat: string | null; qualityMin: number; qualityMax: number; modifierAtMin: number; modifierAtMax: number };
type PoolRecord   = { id: string; blueprintUuid: string; poolUuid: string; poolKey: string };

// ── Tree-walking helpers ──────────────────────────────────────────────────────

function flattenMaterials(node: RawNode, groupKey?: string | null): MatRecord[] {
  const empty: MatRecord[] = [];
  if (!node) return empty;

  if (node.Kind === 'resource' || node.Kind === 'item') {
    return [{
      id: randomUUID(),
      tierId: '',          // filled in by caller
      kind: node.Kind,
      name: node.Name ?? '',
      itemUuid: node.UUID ?? null,
      quantityScu: node.QuantityScu ?? null,
      quantity: node.Quantity ?? null,
      minQuality: node.MinQuality ?? null,
      groupKey: groupKey ?? null,
    }];
  }

  const results: MatRecord[] = [];
  const childGroupKey = node.Kind === 'group' ? (node.Key ?? groupKey) : groupKey;
  for (const child of node.Children ?? []) {
    results.push(...flattenMaterials(child, childGroupKey));
  }
  return results;
}

function flattenModifiers(node: RawNode): ModRecord[] {
  const results: ModRecord[] = [];
  for (const mod of node.Modifiers ?? []) {
    results.push({
      id: randomUUID(),
      tierId: '',          // filled in by caller
      key: mod.Key,
      name: mod.Name ?? '',
      unitFormat: mod.UnitFormat ?? null,
      qualityMin: mod.QualityRange?.Min ?? 0,
      qualityMax: mod.QualityRange?.Max ?? 100,
      modifierAtMin: mod.ModifierRange?.AtMinQuality ?? 1.0,
      modifierAtMax: mod.ModifierRange?.AtMaxQuality ?? 1.0,
    });
  }
  for (const child of node.Children ?? []) {
    results.push(...flattenModifiers(child));
  }
  return results;
}

// ── GitHub fetch ──────────────────────────────────────────────────────────────

const BLUEPRINTS_URL =
  'https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/master/blueprints.json';

async function fetchBlueprints(): Promise<RawBlueprint[]> {
  const res = await fetch(BLUEPRINTS_URL, {
    headers: { Accept: 'application/json', 'User-Agent': 'DEM-Bot/1.0' },
  });
  if (!res.ok) throw new Error(`Failed to fetch blueprints.json: HTTP ${res.status}`);

  const json: unknown = await res.json();
  if (Array.isArray(json)) return json as RawBlueprint[];
  const obj = json as { data?: unknown };
  if (obj.data && Array.isArray(obj.data)) return obj.data as RawBlueprint[];
  throw new Error('blueprints.json has unexpected shape — expected a top-level array');
}

// ── Core sync logic ───────────────────────────────────────────────────────────

const CHUNK = 500;

async function doSync(): Promise<{ blueprintsAdded: number; blueprintsUpdated: number }> {
  console.log('[sc] Fetching blueprints.json from GitHub…');
  const raw = await fetchBlueprints();
  console.log(`[sc] Received ${raw.length} blueprints`);

  const existing = await prisma.scBlueprint.findMany({ select: { uuid: true } });
  const existingSet = new Set(existing.map((b) => b.uuid));

  const bpNew: BpRecord[]    = [];
  const bpUpdate: BpRecord[] = [];
  const allUuids: string[]   = [];
  const tiers: TierRecord[]  = [];
  const materials: MatRecord[] = [];
  const modifiers: ModRecord[] = [];
  const rewardPools: PoolRecord[] = [];

  for (const bp of raw) {
    if (!bp.UUID || !bp.Output?.Name) continue;

    const rec: BpRecord = {
      uuid:                bp.UUID,
      key:                 bp.Key ?? '',
      kind:                bp.Kind ?? 'creation',
      outputUuid:          bp.Output.UUID,
      outputName:          bp.Output.Name,
      outputClass:         bp.Output.Class ?? '',
      outputType:          bp.Output.Type ?? '',
      outputSubtype:       bp.Output.Subtype ?? null,
      outputGrade:         bp.Output.Grade ?? null,
      categoryUuid:        bp.CategoryUUID ?? null,
      dismantleTimeSecs:   bp.Dismantle?.TimeSeconds ?? null,
      dismantleEfficiency: bp.Dismantle?.Efficiency ?? null,
    };

    if (existingSet.has(bp.UUID)) bpUpdate.push(rec);
    else bpNew.push(rec);
    allUuids.push(bp.UUID);

    for (const tier of bp.Tiers ?? []) {
      const tierId = randomUUID();
      tiers.push({ id: tierId, blueprintUuid: bp.UUID, tierIndex: tier.TierIndex, craftTimeSecs: tier.CraftTimeSeconds });

      if (tier.Requirements) {
        const mats = flattenMaterials(tier.Requirements);
        materials.push(...mats.map((m) => ({ ...m, id: randomUUID(), tierId })));

        const mods = flattenModifiers(tier.Requirements);
        modifiers.push(...mods.map((m) => ({ ...m, id: randomUUID(), tierId })));
      }
    }

    for (const pool of bp.Availability?.RewardPools ?? []) {
      rewardPools.push({ id: randomUUID(), blueprintUuid: bp.UUID, poolUuid: pool.UUID, poolKey: pool.Key });
    }
  }

  console.log(`[sc] ${bpNew.length} new, ${bpUpdate.length} updated | ${tiers.length} tiers | ${materials.length} materials | ${modifiers.length} modifiers | ${rewardPools.length} reward pools`);

  // ── 1. Upsert blueprint records ───────────────────────────────────────────

  for (let i = 0; i < bpNew.length; i += CHUNK) {
    await prisma.scBlueprint.createMany({ data: bpNew.slice(i, i + CHUNK), skipDuplicates: true });
  }

  for (let i = 0; i < bpUpdate.length; i += 50) {
    await Promise.all(
      bpUpdate.slice(i, i + 50).map((rec) =>
        prisma.scBlueprint.update({ where: { uuid: rec.uuid }, data: rec }),
      ),
    );
  }

  // ── 2. Delete stale child records (cascade handles materials + modifiers) ──

  for (let i = 0; i < allUuids.length; i += CHUNK) {
    const chunk = allUuids.slice(i, i + CHUNK);
    await prisma.scBlueprintTier.deleteMany({ where: { blueprintUuid: { in: chunk } } });
    await prisma.scBlueprintRewardPool.deleteMany({ where: { blueprintUuid: { in: chunk } } });
  }

  // ── 3. Batch-insert fresh child records ───────────────────────────────────

  for (let i = 0; i < tiers.length; i += CHUNK) {
    await prisma.scBlueprintTier.createMany({ data: tiers.slice(i, i + CHUNK) });
  }
  for (let i = 0; i < materials.length; i += CHUNK) {
    await prisma.scBlueprintMaterial.createMany({ data: materials.slice(i, i + CHUNK) });
  }
  for (let i = 0; i < modifiers.length; i += CHUNK) {
    await prisma.scBlueprintModifier.createMany({ data: modifiers.slice(i, i + CHUNK) });
  }
  for (let i = 0; i < rewardPools.length; i += CHUNK) {
    await prisma.scBlueprintRewardPool.createMany({ data: rewardPools.slice(i, i + CHUNK) });
  }

  return { blueprintsAdded: bpNew.length, blueprintsUpdated: bpUpdate.length };
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Kicks off a scunpacked sync in the background and returns the log ID immediately.
 * Poll GET /api/sc/sync/status to track progress.
 * Throws synchronously if a sync is already running.
 */
export async function runScSync(
  trigger: 'SCHEDULED' | 'MANUAL',
): Promise<string> {
  const inFlight = await prisma.scSyncLog.findFirst({
    where: { status: 'RUNNING', startedAt: { gte: new Date(Date.now() - 60 * 60_000) } },
  });
  if (inFlight) throw new Error('A sync is already in progress');

  const log = await prisma.scSyncLog.create({ data: { trigger, status: 'RUNNING' } });

  void (async () => {
    try {
      const counts = await doSync();
      await prisma.scSyncLog.update({
        where: { id: log.id },
        data: { status: 'SUCCESS', completedAt: new Date(), ...counts },
      });
      console.log(`[sc] Sync ${log.id} complete`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await prisma.scSyncLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', completedAt: new Date(), error },
      });
      console.error(`[sc] Sync ${log.id} failed: ${error}`);
    }
  })();

  return log.id;
}
