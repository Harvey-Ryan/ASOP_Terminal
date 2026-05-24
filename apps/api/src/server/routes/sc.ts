import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { runScSync } from '../../lib/scSync.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import type {
  ApiResponse,
  ScBlueprintDto,
  ScBlueprintSummaryDto,
  ScBlueprintTierDto,
  ScSyncStatusDto,
  ScSyncLogDto,
} from '@dem/shared';

export const scRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

type TierWithChildren = {
  tierIndex: number;
  craftTimeSecs: number;
  materials: { kind: string; name: string; itemUuid: string | null; quantityScu: number | null; quantity: number | null; minQuality: number | null; groupKey: string | null }[];
  modifiers: { key: string; name: string; unitFormat: string | null; qualityMin: number; qualityMax: number; modifierAtMin: number; modifierAtMax: number }[];
};

function toTierDto(tier: TierWithChildren): ScBlueprintTierDto {
  return {
    tierIndex:    tier.tierIndex,
    craftTimeSecs: tier.craftTimeSecs,
    materials: tier.materials.map((m) => ({
      kind:        m.kind,
      name:        m.name,
      itemUuid:    m.itemUuid,
      quantityScu: m.quantityScu,
      quantity:    m.quantity,
      minQuality:  m.minQuality,
      groupKey:    m.groupKey,
    })),
    modifiers: tier.modifiers.map((mod) => ({
      key:          mod.key,
      name:         mod.name,
      unitFormat:   mod.unitFormat,
      qualityMin:   mod.qualityMin,
      qualityMax:   mod.qualityMax,
      modifierAtMin: mod.modifierAtMin,
      modifierAtMax: mod.modifierAtMax,
    })),
  };
}

// ── GET /api/sc/blueprints ────────────────────────────────────────────────────
// Query: q (name search), type (outputType filter), limit (default 25, max 100)

scRouter.get('/sc/blueprints', async (req, res) => {
  const q     = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  const type  = typeof req.query.type === 'string' ? req.query.type.trim() : undefined;
  const limit = Math.min(parseInt(String(req.query.limit ?? '25'), 10) || 25, 100);

  const rows = await prisma.scBlueprint.findMany({
    where: {
      ...(q    ? { outputName: { contains: q, mode: 'insensitive' } } : {}),
      ...(type ? { outputType: { equals: type, mode: 'insensitive' } } : {}),
    },
    orderBy: { outputName: 'asc' },
    take: limit,
    include: { _count: { select: { tiers: true } } },
  });

  const data: ScBlueprintSummaryDto[] = rows.map((r) => ({
    uuid:               r.uuid,
    key:                r.key,
    outputName:         r.outputName,
    outputType:         r.outputType,
    outputSubtype:      r.outputSubtype,
    outputGrade:        r.outputGrade,
    tierCount:          r._count.tiers,
    dismantleTimeSecs:  r.dismantleTimeSecs,
    dismantleEfficiency: r.dismantleEfficiency,
  }));

  res.json({ success: true, data } satisfies ApiResponse<ScBlueprintSummaryDto[]>);
});

// ── GET /api/sc/blueprints/by-material ───────────────────────────────────────
// Returns blueprints that require a given material (fuzzy name match).
// Query: name (required), limit (default 25, max 100)

scRouter.get('/sc/blueprints/by-material', async (req, res) => {
  const name  = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  const limit = Math.min(parseInt(String(req.query.limit ?? '25'), 10) || 25, 100);

  if (!name) {
    res.status(400).json({ success: false, error: 'name query param is required' } satisfies ApiResponse);
    return;
  }

  // Find tier IDs that have a material matching the name, then get their blueprints
  const matchedTiers = await prisma.scBlueprintMaterial.findMany({
    where: { name: { contains: name, mode: 'insensitive' } },
    select: { tierId: true },
    distinct: ['tierId'],
    take: 200,
  });

  const tierIds = matchedTiers.map((t) => t.tierId);
  if (tierIds.length === 0) {
    res.json({ success: true, data: [] } satisfies ApiResponse<ScBlueprintSummaryDto[]>);
    return;
  }

  const blueprintUuids = await prisma.scBlueprintTier.findMany({
    where: { id: { in: tierIds } },
    select: { blueprintUuid: true },
    distinct: ['blueprintUuid'],
    take: limit,
  });

  const rows = await prisma.scBlueprint.findMany({
    where: { uuid: { in: blueprintUuids.map((b) => b.blueprintUuid) } },
    orderBy: { outputName: 'asc' },
    include: { _count: { select: { tiers: true } } },
  });

  const data: ScBlueprintSummaryDto[] = rows.map((r) => ({
    uuid:               r.uuid,
    key:                r.key,
    outputName:         r.outputName,
    outputType:         r.outputType,
    outputSubtype:      r.outputSubtype,
    outputGrade:        r.outputGrade,
    tierCount:          r._count.tiers,
    dismantleTimeSecs:  r.dismantleTimeSecs,
    dismantleEfficiency: r.dismantleEfficiency,
  }));

  res.json({ success: true, data } satisfies ApiResponse<ScBlueprintSummaryDto[]>);
});

// ── GET /api/sc/blueprints/:uuid ──────────────────────────────────────────────
// Full recipe with all tiers, materials, and modifiers.

scRouter.get('/sc/blueprints/:uuid', async (req, res) => {
  const { uuid } = req.params as { uuid: string };

  const bp = await prisma.scBlueprint.findUnique({
    where: { uuid },
    include: {
      tiers: {
        orderBy: { tierIndex: 'asc' },
        include: {
          materials: { orderBy: { name: 'asc' } },
          modifiers: { orderBy: { key: 'asc' } },
        },
      },
      _count: { select: { rewardPools: true } },
    },
  });

  if (!bp) {
    res.status(404).json({ success: false, error: 'Blueprint not found' } satisfies ApiResponse);
    return;
  }

  const data: ScBlueprintDto = {
    uuid:               bp.uuid,
    key:                bp.key,
    outputName:         bp.outputName,
    outputClass:        bp.outputClass,
    outputType:         bp.outputType,
    outputSubtype:      bp.outputSubtype,
    outputGrade:        bp.outputGrade,
    dismantleTimeSecs:  bp.dismantleTimeSecs,
    dismantleEfficiency: bp.dismantleEfficiency,
    tiers:              bp.tiers.map(toTierDto),
    rewardPoolCount:    bp._count.rewardPools,
  };

  res.json({ success: true, data } satisfies ApiResponse<ScBlueprintDto>);
});

// ── GET /api/sc/manufacturers ─────────────────────────────────────────────────
// Query: q (name/code search), limit (default 25, max 100)

scRouter.get('/sc/manufacturers', async (req, res) => {
  const q     = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  const limit = Math.min(parseInt(String(req.query.limit ?? '25'), 10) || 25, 100);
  const rows = await prisma.scManufacturer.findMany({
    where: q ? { OR: [
      { name: { contains: q, mode: 'insensitive' } },
      { code: { contains: q, mode: 'insensitive' } },
    ] } : {},
    orderBy: { name: 'asc' },
    take: limit,
  });
  res.json({ success: true, data: rows } satisfies ApiResponse);
});

// ── GET /api/sc/starmap ───────────────────────────────────────────────────────
// Query: q (name search), type, parentUuid, limit (default 50, max 200)

scRouter.get('/sc/starmap', async (req, res) => {
  const q          = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  const type       = typeof req.query.type === 'string' ? req.query.type.trim() : undefined;
  const parentUuid = typeof req.query.parentUuid === 'string' ? req.query.parentUuid.trim() : undefined;
  const limit      = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
  const rows = await prisma.scStarmapEntry.findMany({
    where: {
      ...(q          ? { name: { contains: q, mode: 'insensitive' } } : {}),
      ...(type       ? { type: { equals: type, mode: 'insensitive' } } : {}),
      ...(parentUuid ? { parentUuid } : {}),
    },
    orderBy: { name: 'asc' },
    take: limit,
    select: { uuid: true, name: true, description: true, parentUuid: true, type: true, isScannable: true, size: true },
  });
  res.json({ success: true, data: rows } satisfies ApiResponse);
});

scRouter.get('/sc/starmap/:uuid', async (req, res) => {
  const { uuid } = req.params as { uuid: string };
  const row = await prisma.scStarmapEntry.findUnique({ where: { uuid } });
  if (!row) { res.status(404).json({ success: false, error: 'Not found' } satisfies ApiResponse); return; }
  res.json({ success: true, data: row } satisfies ApiResponse);
});

// ── GET /api/sc/trade-locations ───────────────────────────────────────────────
// Query: q (displayName search), disabled (bool), limit (default 50, max 200)

scRouter.get('/sc/trade-locations', async (req, res) => {
  const q       = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  const disabled = req.query.disabled === 'true' ? true : req.query.disabled === 'false' ? false : undefined;
  const limit   = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
  const rows = await prisma.scTradeLocation.findMany({
    where: {
      ...(q        ? { displayName: { contains: q, mode: 'insensitive' } } : {}),
      ...(disabled !== undefined ? { disabled } : {}),
    },
    orderBy: { displayName: 'asc' },
    take: limit,
    select: { uuid: true, className: true, displayName: true, disabled: true, producesTagsJson: true, consumesTagsJson: true },
  });
  res.json({ success: true, data: rows } satisfies ApiResponse);
});

// ── GET /api/sc/commodities ───────────────────────────────────────────────────
// Query: q (name search), tier, limit (default 50, max 200)

scRouter.get('/sc/commodities', async (req, res) => {
  const q     = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  const tier  = typeof req.query.tier === 'string' ? req.query.tier.trim() : undefined;
  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
  const rows = await prisma.scCommodity.findMany({
    where: {
      ...(q    ? { name: { contains: q, mode: 'insensitive' } } : {}),
      ...(tier ? { tier } : {}),
    },
    orderBy: { name: 'asc' },
    take: limit,
  });
  res.json({ success: true, data: rows } satisfies ApiResponse);
});

// ── GET /api/sc/resources ─────────────────────────────────────────────────────
// Query: q (name search), kind, tier, limit (default 50, max 200)

scRouter.get('/sc/resources', async (req, res) => {
  const q     = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  const kind  = typeof req.query.kind === 'string' ? req.query.kind.trim() : undefined;
  const tier  = typeof req.query.tier === 'string' ? req.query.tier.trim() : undefined;
  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
  const rows = await prisma.scResource.findMany({
    where: {
      ...(q    ? { name: { contains: q, mode: 'insensitive' } } : {}),
      ...(kind ? { kind } : {}),
      ...(tier ? { tier } : {}),
    },
    orderBy: { name: 'asc' },
    take: limit,
  });
  res.json({ success: true, data: rows } satisfies ApiResponse);
});

// ── GET /api/sc/ship-items ────────────────────────────────────────────────────
// Query: q (name search), type, classification, manufacturerCode, limit (default 25, max 100)

scRouter.get('/sc/ship-items', async (req, res) => {
  const q                = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  const type             = typeof req.query.type === 'string' ? req.query.type.trim() : undefined;
  const classification   = typeof req.query.classification === 'string' ? req.query.classification.trim() : undefined;
  const manufacturerCode = typeof req.query.manufacturerCode === 'string' ? req.query.manufacturerCode.trim() : undefined;
  const limit            = Math.min(parseInt(String(req.query.limit ?? '25'), 10) || 25, 100);

  const rows = await prisma.scShipItem.findMany({
    where: {
      ...(q                ? { name: { contains: q, mode: 'insensitive' } } : {}),
      ...(type             ? { type: { equals: type, mode: 'insensitive' } } : {}),
      ...(classification   ? { classification: { contains: classification, mode: 'insensitive' } } : {}),
      ...(manufacturerCode ? { manufacturerCode: { equals: manufacturerCode, mode: 'insensitive' } } : {}),
    },
    orderBy: { name: 'asc' },
    take: limit,
    select: { uuid: true, className: true, type: true, subType: true, size: true, grade: true,
      name: true, classification: true, manufacturerCode: true, manufacturerName: true,
      mass: true, inventoryScu: true },
  });
  res.json({ success: true, data: rows } satisfies ApiResponse);
});

scRouter.get('/sc/ship-items/:uuid', async (req, res) => {
  const { uuid } = req.params as { uuid: string };
  const row = await prisma.scShipItem.findUnique({ where: { uuid } });
  if (!row) { res.status(404).json({ success: false, error: 'Not found' } satisfies ApiResponse); return; }
  const { stdItemJson, ...rest } = row;
  res.json({ success: true, data: { ...rest, stdItem: JSON.parse(stdItemJson) } } satisfies ApiResponse);
});

// ── GET /api/sc/labels ────────────────────────────────────────────────────────
// Query: key (exact), q (value search), limit (default 25, max 100)

scRouter.get('/sc/labels', async (req, res) => {
  const key   = typeof req.query.key === 'string' ? req.query.key.trim() : undefined;
  const q     = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  const limit = Math.min(parseInt(String(req.query.limit ?? '25'), 10) || 25, 100);
  if (!key && !q) {
    res.status(400).json({ success: false, error: 'key or q query param is required' } satisfies ApiResponse);
    return;
  }
  const rows = await prisma.scLabel.findMany({
    where: {
      ...(key ? { key } : {}),
      ...(q   ? { value: { contains: q, mode: 'insensitive' } } : {}),
    },
    take: limit,
    select: { key: true, value: true },
  });
  res.json({ success: true, data: rows } satisfies ApiResponse);
});

// ── GET /api/sc/sync/status ───────────────────────────────────────────────────

scRouter.get('/sc/sync/status', requireAuth, async (_req, res) => {
  const [inFlight, lastSync, blueprints] = await Promise.all([
    prisma.scSyncLog.findFirst({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'desc' } }),
    prisma.scSyncLog.findFirst({ orderBy: { startedAt: 'desc' } }),
    prisma.scBlueprint.count(),
  ]);

  const toDto = (row: typeof lastSync): ScSyncLogDto | null => {
    if (!row) return null;
    return {
      id:               row.id,
      trigger:          row.trigger,
      status:           row.status,
      blueprintsAdded:  row.blueprintsAdded,
      blueprintsUpdated: row.blueprintsUpdated,
      detailsJson:      row.detailsJson,
      error:            row.error,
      startedAt:        row.startedAt.toISOString(),
      completedAt:      row.completedAt?.toISOString() ?? null,
    };
  };

  const data: ScSyncStatusDto = {
    isRunning: !!inFlight,
    lastSync:  toDto(lastSync),
    counts:    { blueprints },
  };

  res.json({ success: true, data } satisfies ApiResponse<ScSyncStatusDto>);
});

// ── POST /api/sc/sync ─────────────────────────────────────────────────────────
// Requires auth + guild manager. Starts background sync, returns 202 + logId.

scRouter.post('/sc/sync', requireAuth, async (req, res) => {
  const managedGuildIds: string[] = req.session.managedGuildIds ?? [];
  if (managedGuildIds.length === 0) {
    const guildId = typeof req.query.guildId === 'string' ? req.query.guildId : undefined;
    if (!guildId || !(await assertGuildManager(req, guildId))) {
      res.status(403).json({ success: false, error: 'Forbidden — guild manager required' } satisfies ApiResponse);
      return;
    }
  }

  try {
    const logId = await runScSync('MANUAL');
    res.status(202).json({ success: true, data: { logId } } satisfies ApiResponse<{ logId: string }>);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message.includes('already in progress') ? 409 : 500;
    res.status(status).json({ success: false, error: message } satisfies ApiResponse);
  }
});
