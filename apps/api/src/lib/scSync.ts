import { randomUUID } from 'node:crypto';
import { prisma } from './prisma.js';

const BASE_URL = 'https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/master';
const CHUNK = 500;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'DEM-Bot/1.0' },
  });
  if (!res.ok) throw new Error(`Failed to fetch ${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function chunkCreate<T extends object>(
  createFn: (data: T[]) => Promise<unknown>,
  rows: T[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await createFn(rows.slice(i, i + CHUNK));
  }
}

// ── Raw JSON shapes ───────────────────────────────────────────────────────────

interface RawOutput {
  UUID: string; Class: string; Type: string;
  Subtype?: string | null; Grade?: string | null; Name: string;
}
interface RawRewardPool { UUID: string; Key: string }
interface RawAvailability { Default?: boolean; RewardPools?: RawRewardPool[] }
interface RawModifier {
  Key: string; Name?: string | null; UnitFormat?: string | null;
  QualityRange?: { Min: number; Max: number } | null;
  ModifierRange?: { AtMinQuality: number; AtMaxQuality: number } | null;
}
interface RawNode {
  Kind: string; Key?: string | null; Name?: string | null; UUID?: string | null;
  Modifiers?: RawModifier[]; Children?: RawNode[];
  QuantityScu?: number | null; Quantity?: number | null; MinQuality?: number | null;
}
interface RawTier { TierIndex: number; CraftTimeSeconds: number; Requirements?: RawNode | null }
interface RawBlueprint {
  UUID: string; Key?: string | null; Kind?: string | null; CategoryUUID?: string | null;
  Output: RawOutput; Availability?: RawAvailability | null;
  Tiers?: RawTier[] | null; Dismantle?: { TimeSeconds?: number | null; Efficiency?: number | null } | null;
}

interface RawManufacturer { UUID: string; Code?: string | number | null; Name: string; Description?: string }

interface RawStarmapEntry {
  UUID: string; Name: string; Description?: string | null; ParentUUID?: string | null;
  NavIcon?: string; IsScannable?: boolean; HideInStarmap?: boolean; Size?: number;
  Type?: { Name?: string } | null;
  Amenities?: unknown[];
}

interface RawTradeLocation {
  UUID: string; ClassName: string; DisplayName?: string | null; Disabled?: boolean;
  ProducesTags?: unknown; ConsumesTags?: unknown;
}

interface RawCommodity {
  UUID: string; Key: string; Name: string; Description?: string;
  RefinedVersionUUID?: string | null; RefinedVersionName?: string | null;
  Tier?: string | null; DensityGPerCc?: number; Instability?: number | null; Resistance?: number | null;
}

interface RawResourceLocationProvider {
  Provider: { UUID: string; Name: string; PresetFile: string };
  Locations?: unknown[]; Areas?: unknown[]; Groups?: unknown[];
}

interface RawResource {
  UUID: string; Key: string; Name: string; Kind: string;
  HarvestableUUID?: string; HarvestableKey?: string; Tier?: string;
}

interface RawShipItem {
  reference: string; className: string; itemName: string;
  type: string; subType?: string; size?: number; grade?: number;
  name?: string; classification?: string; tags?: string;
  stdItem?: {
    Manufacturer?: { Code?: string; Name?: string; UUID?: string };
    Description?: string; DescriptionText?: string; Mass?: number;
    InventoryOccupancy?: { Volume?: { SCU?: number } };
    [key: string]: unknown;
  };
}

// ── Blueprint helpers ─────────────────────────────────────────────────────────

type BpRecord = {
  uuid: string; key: string; kind: string; outputUuid: string; outputName: string;
  outputClass: string; outputType: string; outputSubtype: string | null; outputGrade: string | null;
  categoryUuid: string | null; dismantleTimeSecs: number | null; dismantleEfficiency: number | null;
};
type TierRecord = { id: string; blueprintUuid: string; tierIndex: number; craftTimeSecs: number };
type MatRecord  = { id: string; tierId: string; kind: string; name: string; itemUuid: string | null; quantityScu: number | null; quantity: number | null; minQuality: number | null; groupKey: string | null };
type ModRecord  = { id: string; tierId: string; key: string; name: string; unitFormat: string | null; qualityMin: number; qualityMax: number; modifierAtMin: number; modifierAtMax: number };
type PoolRecord = { id: string; blueprintUuid: string; poolUuid: string; poolKey: string };

function flattenMaterials(node: RawNode, groupKey?: string | null): MatRecord[] {
  if (!node) return [];
  if (node.Kind === 'resource' || node.Kind === 'item') {
    return [{ id: randomUUID(), tierId: '', kind: node.Kind, name: node.Name ?? '',
      itemUuid: node.UUID ?? null, quantityScu: node.QuantityScu ?? null,
      quantity: node.Quantity ?? null, minQuality: node.MinQuality ?? null, groupKey: groupKey ?? null }];
  }
  const childGroupKey = node.Kind === 'group' ? (node.Key ?? groupKey) : groupKey;
  return (node.Children ?? []).flatMap((c) => flattenMaterials(c, childGroupKey));
}

function flattenModifiers(node: RawNode): ModRecord[] {
  const results: ModRecord[] = (node.Modifiers ?? []).map((mod) => ({
    id: randomUUID(), tierId: '', key: mod.Key, name: mod.Name ?? '',
    unitFormat: mod.UnitFormat ?? null, qualityMin: mod.QualityRange?.Min ?? 0,
    qualityMax: mod.QualityRange?.Max ?? 100, modifierAtMin: mod.ModifierRange?.AtMinQuality ?? 1.0,
    modifierAtMax: mod.ModifierRange?.AtMaxQuality ?? 1.0,
  }));
  for (const child of node.Children ?? []) results.push(...flattenModifiers(child));
  return results;
}

// ── Individual sync functions ─────────────────────────────────────────────────

async function syncBlueprints(): Promise<{ blueprintsAdded: number; blueprintsUpdated: number }> {
  console.log('[sc] Fetching blueprints.json…');
  const raw = await fetchJson<RawBlueprint[]>('/blueprints.json');
  console.log(`[sc] ${raw.length} blueprints received`);

  const existing = await prisma.scBlueprint.findMany({ select: { uuid: true } });
  const existingSet = new Set(existing.map((b) => b.uuid));

  const bpNew: BpRecord[] = [], bpUpdate: BpRecord[] = [], allUuids: string[] = [];
  const tiers: TierRecord[] = [], materials: MatRecord[] = [], modifiers: ModRecord[] = [], rewardPools: PoolRecord[] = [];

  for (const bp of raw) {
    if (!bp.UUID || !bp.Output?.Name) continue;
    const rec: BpRecord = {
      uuid: bp.UUID, key: bp.Key ?? '', kind: bp.Kind ?? 'creation',
      outputUuid: bp.Output.UUID, outputName: bp.Output.Name,
      outputClass: bp.Output.Class ?? '', outputType: bp.Output.Type ?? '',
      outputSubtype: bp.Output.Subtype ?? null, outputGrade: bp.Output.Grade ?? null,
      categoryUuid: bp.CategoryUUID ?? null, dismantleTimeSecs: bp.Dismantle?.TimeSeconds ?? null,
      dismantleEfficiency: bp.Dismantle?.Efficiency ?? null,
    };
    if (existingSet.has(bp.UUID)) bpUpdate.push(rec); else bpNew.push(rec);
    allUuids.push(bp.UUID);
    for (const tier of bp.Tiers ?? []) {
      const tierId = randomUUID();
      tiers.push({ id: tierId, blueprintUuid: bp.UUID, tierIndex: tier.TierIndex, craftTimeSecs: tier.CraftTimeSeconds });
      if (tier.Requirements) {
        materials.push(...flattenMaterials(tier.Requirements).map((m) => ({ ...m, id: randomUUID(), tierId })));
        modifiers.push(...flattenModifiers(tier.Requirements).map((m) => ({ ...m, id: randomUUID(), tierId })));
      }
    }
    for (const pool of bp.Availability?.RewardPools ?? []) {
      rewardPools.push({ id: randomUUID(), blueprintUuid: bp.UUID, poolUuid: pool.UUID, poolKey: pool.Key });
    }
  }

  await chunkCreate((d) => prisma.scBlueprint.createMany({ data: d, skipDuplicates: true }), bpNew);
  for (let i = 0; i < bpUpdate.length; i += 50) {
    await Promise.all(bpUpdate.slice(i, i + 50).map((r) => prisma.scBlueprint.update({ where: { uuid: r.uuid }, data: r })));
  }
  for (let i = 0; i < allUuids.length; i += CHUNK) {
    const chunk = allUuids.slice(i, i + CHUNK);
    await prisma.scBlueprintTier.deleteMany({ where: { blueprintUuid: { in: chunk } } });
    await prisma.scBlueprintRewardPool.deleteMany({ where: { blueprintUuid: { in: chunk } } });
  }
  await chunkCreate((d) => prisma.scBlueprintTier.createMany({ data: d }), tiers);
  await chunkCreate((d) => prisma.scBlueprintMaterial.createMany({ data: d }), materials);
  await chunkCreate((d) => prisma.scBlueprintModifier.createMany({ data: d }), modifiers);
  await chunkCreate((d) => prisma.scBlueprintRewardPool.createMany({ data: d }), rewardPools);

  return { blueprintsAdded: bpNew.length, blueprintsUpdated: bpUpdate.length };
}

async function syncManufacturers(): Promise<number> {
  console.log('[sc] Fetching manufacturers.json…');
  const raw = await fetchJson<RawManufacturer[]>('/manufacturers.json');
  await prisma.scManufacturer.deleteMany();
  const now = new Date();
  const rows = raw
    .filter((m) => m.UUID && m.Name)
    .map((m) => ({
      uuid: m.UUID,
      code: m.Code != null ? String(m.Code) : null,
      name: m.Name,
      description: m.Description ?? null,
      syncedAt: now,
    }));
  await chunkCreate((d) => prisma.scManufacturer.createMany({ data: d }), rows);
  console.log(`[sc] ${rows.length} manufacturers stored`);
  return rows.length;
}

async function syncStarmap(): Promise<number> {
  console.log('[sc] Fetching starmap.json…');
  const raw = await fetchJson<RawStarmapEntry[]>('/starmap.json');
  await prisma.scStarmapEntry.deleteMany();
  const now = new Date();
  const rows = raw
    .filter((e) => e.UUID && e.Name)
    .map((e) => ({
      uuid: e.UUID,
      name: e.Name,
      description: e.Description ?? null,
      parentUuid: e.ParentUUID ?? null,
      navIcon: e.NavIcon ?? null,
      type: e.Type?.Name ?? 'Unknown',
      isScannable: e.IsScannable ?? false,
      hideInStarmap: e.HideInStarmap ?? false,
      size: e.Size ?? null,
      amenitiesJson: e.Amenities?.length ? JSON.stringify(e.Amenities) : null,
      syncedAt: now,
    }));
  await chunkCreate((d) => prisma.scStarmapEntry.createMany({ data: d }), rows);
  console.log(`[sc] ${rows.length} starmap entries stored`);
  return rows.length;
}

async function syncTradeLocations(): Promise<number> {
  console.log('[sc] Fetching trade_locations.json…');
  const raw = await fetchJson<RawTradeLocation[]>('/trade_locations.json');
  await prisma.scTradeLocation.deleteMany();
  const now = new Date();
  const rows = raw
    .filter((t) => t.UUID && t.ClassName)
    .map((t) => ({
      uuid: t.UUID,
      className: t.ClassName,
      displayName: t.DisplayName ?? null,
      disabled: t.Disabled ?? false,
      producesTagsJson: t.ProducesTags ? JSON.stringify(t.ProducesTags) : null,
      consumesTagsJson: t.ConsumesTags ? JSON.stringify(t.ConsumesTags) : null,
      syncedAt: now,
    }));
  await chunkCreate((d) => prisma.scTradeLocation.createMany({ data: d }), rows);
  console.log(`[sc] ${rows.length} trade locations stored`);
  return rows.length;
}

async function syncTags(): Promise<number> {
  console.log('[sc] Fetching tags.json…');
  const raw = await fetchJson<Record<string, string>>('/tags.json');
  await prisma.scTag.deleteMany();
  const rows = Object.entries(raw)
    .filter(([uuid, name]) => uuid && name)
    .map(([uuid, name]) => ({ uuid, name }));
  await chunkCreate((d) => prisma.scTag.createMany({ data: d }), rows);
  console.log(`[sc] ${rows.length} tags stored`);
  return rows.length;
}

async function syncCommodities(): Promise<number> {
  console.log('[sc] Fetching resources/commodities.json…');
  const raw = await fetchJson<RawCommodity[]>('/resources/commodities.json');
  await prisma.scCommodity.deleteMany();
  const now = new Date();
  const rows = raw
    .filter((c) => c.UUID && c.Key && c.Name)
    .map((c) => ({
      uuid: c.UUID,
      key: c.Key,
      name: c.Name,
      description: c.Description ?? null,
      refinedVersionUuid: c.RefinedVersionUUID ?? null,
      refinedVersionName: c.RefinedVersionName ?? null,
      tier: c.Tier ?? null,
      densityGPerCc: c.DensityGPerCc ?? null,
      instability: c.Instability ?? null,
      resistance: c.Resistance ?? null,
      syncedAt: now,
    }));
  await chunkCreate((d) => prisma.scCommodity.createMany({ data: d }), rows);
  console.log(`[sc] ${rows.length} commodities stored`);
  return rows.length;
}

async function syncResourceLocations(): Promise<number> {
  console.log('[sc] Fetching resources/locations.json…');
  const raw = await fetchJson<RawResourceLocationProvider[]>('/resources/locations.json');
  await prisma.scResourceLocation.deleteMany();
  const now = new Date();
  const rows = raw
    .filter((p) => p.Provider?.UUID && p.Provider?.Name)
    .map((p) => ({
      uuid: p.Provider.UUID,
      providerName: p.Provider.Name,
      presetFile: p.Provider.PresetFile ?? p.Provider.Name,
      locationsJson: JSON.stringify(p.Locations ?? []),
      areasJson: p.Areas?.length ? JSON.stringify(p.Areas) : null,
      groupsJson: p.Groups?.length ? JSON.stringify(p.Groups) : null,
      syncedAt: now,
    }));
  await chunkCreate((d) => prisma.scResourceLocation.createMany({ data: d }), rows);
  console.log(`[sc] ${rows.length} resource locations stored`);
  return rows.length;
}

async function syncResources(): Promise<number> {
  console.log('[sc] Fetching resources/resources.json…');
  const raw = await fetchJson<RawResource[]>('/resources/resources.json');
  await prisma.scResource.deleteMany();
  const now = new Date();
  const rows = raw
    .filter((r) => r.UUID && r.Key && r.Name)
    .map((r) => ({
      uuid: r.UUID,
      key: r.Key,
      name: r.Name,
      kind: r.Kind,
      harvestableUuid: r.HarvestableUUID ?? null,
      harvestableKey: r.HarvestableKey ?? null,
      tier: r.Tier ?? null,
      syncedAt: now,
    }));
  await chunkCreate((d) => prisma.scResource.createMany({ data: d }), rows);
  console.log(`[sc] ${rows.length} resources stored`);
  return rows.length;
}

async function syncLabels(): Promise<number> {
  console.log('[sc] Fetching labels.json…');
  const raw = await fetchJson<Record<string, string>>('/labels.json');
  await prisma.scLabel.deleteMany();
  const now = new Date();
  const rows = Object.entries(raw)
    .filter(([key, value]) => key && typeof value === 'string')
    .map(([key, value]) => ({ key, value, syncedAt: now }));
  await chunkCreate((d) => prisma.scLabel.createMany({ data: d }), rows);
  console.log(`[sc] ${rows.length} labels stored`);
  return rows.length;
}

async function syncShipItems(): Promise<{ added: number; updated: number }> {
  console.log('[sc] Fetching ship-items.json…');
  const raw = await fetchJson<RawShipItem[]>('/ship-items.json');
  console.log(`[sc] ${raw.length} ship items received`);

  const existing = await prisma.scShipItem.findMany({ select: { uuid: true } });
  const existingSet = new Set(existing.map((s) => s.uuid));
  const now = new Date();

  type Row = {
    uuid: string; className: string; itemName: string; type: string; subType: string | null;
    size: number | null; grade: number | null; name: string | null; classification: string | null;
    tags: string | null; manufacturerCode: string | null; manufacturerName: string | null;
    manufacturerUuid: string | null; description: string | null; mass: number | null;
    inventoryScu: number | null; stdItemJson: string; syncedAt: Date;
  };

  const newRows: Row[] = [], updateRows: Row[] = [];

  for (const item of raw) {
    if (!item.reference || !item.className) continue;
    const mfr = item.stdItem?.Manufacturer;
    const row: Row = {
      uuid: item.reference,
      className: item.className,
      itemName: item.itemName ?? item.className.toLowerCase(),
      type: item.type ?? '',
      subType: item.subType ?? null,
      size: item.size ?? null,
      grade: item.grade ?? null,
      name: item.name && item.name !== '<= PLACEHOLDER =>' ? item.name : null,
      classification: item.classification ?? null,
      tags: item.tags ?? null,
      manufacturerCode: mfr?.Code ?? null,
      manufacturerName: mfr?.Name && mfr.Name !== 'Unknown Manufacturer' ? mfr.Name : null,
      manufacturerUuid: mfr?.UUID ?? null,
      description: item.stdItem?.DescriptionText || item.stdItem?.Description || null,
      mass: item.stdItem?.Mass ?? null,
      inventoryScu: item.stdItem?.InventoryOccupancy?.Volume?.SCU ?? null,
      stdItemJson: JSON.stringify(item.stdItem ?? {}),
      syncedAt: now,
    };
    if (existingSet.has(item.reference)) updateRows.push(row); else newRows.push(row);
  }

  await chunkCreate((d) => prisma.scShipItem.createMany({ data: d, skipDuplicates: true }), newRows);
  for (let i = 0; i < updateRows.length; i += 50) {
    await Promise.all(updateRows.slice(i, i + 50).map((r) => prisma.scShipItem.update({ where: { uuid: r.uuid }, data: r })));
  }

  console.log(`[sc] Ship items: ${newRows.length} new, ${updateRows.length} updated`);
  return { added: newRows.length, updated: updateRows.length };
}

// ── Master sync ───────────────────────────────────────────────────────────────

async function doSync() {
  const [bpCounts, mfrCount, starmapCount, tradeCount, tagCount, commodityCount,
    resourceLocationCount, resourceCount, labelCount, shipCounts] = await Promise.allSettled([
    syncBlueprints(),
    syncManufacturers(),
    syncStarmap(),
    syncTradeLocations(),
    syncTags(),
    syncCommodities(),
    syncResourceLocations(),
    syncResources(),
    syncLabels(),
    syncShipItems(),
  ]).then((results) => results.map((r) => (r.status === 'fulfilled' ? r.value : r.reason)));

  return {
    blueprintsAdded:        (bpCounts as { blueprintsAdded: number })?.blueprintsAdded ?? 0,
    blueprintsUpdated:      (bpCounts as { blueprintsUpdated: number })?.blueprintsUpdated ?? 0,
    detailsJson: JSON.stringify({
      manufacturers:     mfrCount,
      starmapEntries:    starmapCount,
      tradeLocations:    tradeCount,
      tags:              tagCount,
      commodities:       commodityCount,
      resourceLocations: resourceLocationCount,
      resources:         resourceCount,
      labels:            labelCount,
      shipItemsAdded:    (shipCounts as { added: number })?.added ?? 0,
      shipItemsUpdated:  (shipCounts as { updated: number })?.updated ?? 0,
    }),
  };
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Kicks off a full scunpacked sync in the background and returns the log ID.
 * Throws synchronously if a sync is already running.
 */
export async function runScSync(trigger: 'SCHEDULED' | 'MANUAL'): Promise<string> {
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
