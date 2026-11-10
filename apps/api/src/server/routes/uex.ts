import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { runUexSync } from '../../lib/uexSync.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import type {
  ApiResponse,
  UexCommodityDto,
  UexSyncStatusDto,
  UexSyncLogDto,
} from '@dem/shared';

export const uexRouter = Router();

// UEX Corp is only used for average commodity prices. Item names and details
// come from the game item catalog (routes/catalog.ts).

// ── GET /api/uex/commodities ──────────────────────────────────────────────────
// Query params: q (name search), limit (default 50, max 200)

uexRouter.get('/uex/commodities', async (req, res) => {
  const q     = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);

  const rows = await prisma.uexCommodity.findMany({
    where: {
      isActive: true,
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    },
    orderBy: { name: 'asc' },
    take: limit,
  });

  const data: UexCommodityDto[] = rows.map((c) => ({
    id:           c.id,
    name:         c.name,
    code:         c.code,
    slug:         c.slug,
    weightScu:    c.weightScu,
    priceAvgBuy:  c.priceAvgBuy,
    priceAvgSell: c.priceAvgSell,
    isMineral:    c.isMineral,
    isRaw:        c.isRaw,
    isRefined:    c.isRefined,
    isHarvestable: c.isHarvestable,
    isFuel:       c.isFuel,
    isIllegal:    c.isIllegal,
  }));

  res.json({ success: true, data } satisfies ApiResponse<UexCommodityDto[]>);
});

// ── GET /api/uex/sync/status ──────────────────────────────────────────────────

uexRouter.get('/uex/sync/status', requireAuth, async (_req, res) => {
  const [isRunning, lastSync, commodities] = await Promise.all([
    prisma.uexSyncLog.findFirst({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'desc' } }),
    prisma.uexSyncLog.findFirst({ orderBy: { startedAt: 'desc' } }),
    prisma.uexCommodity.count({ where: { isActive: true } }),
  ]);

  const toDto = (row: typeof lastSync): UexSyncLogDto | null => {
    if (!row) return null;
    return {
      id:                 row.id,
      trigger:            row.trigger,
      status:             row.status,
      categoriesAdded:    row.categoriesAdded,
      categoriesUpdated:  row.categoriesUpdated,
      itemsAdded:         row.itemsAdded,
      itemsUpdated:       row.itemsUpdated,
      commoditiesAdded:   row.commoditiesAdded,
      commoditiesUpdated: row.commoditiesUpdated,
      error:              row.error,
      startedAt:          row.startedAt.toISOString(),
      completedAt:        row.completedAt?.toISOString() ?? null,
    };
  };

  const data: UexSyncStatusDto = {
    isRunning: !!isRunning,
    lastSync:  toDto(lastSync),
    counts:    { commodities },
  };

  res.json({ success: true, data } satisfies ApiResponse<UexSyncStatusDto>);
});

// ── POST /api/uex/sync ────────────────────────────────────────────────────────
// Requires guild manager auth. Starts a background sync and returns 202 + logId.

uexRouter.post('/uex/sync', requireAuth, async (req, res) => {
  // Any authenticated manager of any guild may trigger a sync
  const managedGuildIds: string[] = req.session.managedGuildIds ?? [];
  if (managedGuildIds.length === 0) {
    // Fall back to explicit guild check if no cached list
    const guildId = typeof req.query.guildId === 'string' ? req.query.guildId : undefined;
    if (!guildId || !(await assertGuildManager(req, guildId))) {
      res.status(403).json({ success: false, error: 'Forbidden — guild manager required' } satisfies ApiResponse);
      return;
    }
  }

  const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
  if (!dbUser) {
    res.status(401).json({ success: false, error: 'Unauthorized' } satisfies ApiResponse);
    return;
  }

  if (!process.env.UEX_KEY) {
    res.status(503).json({ success: false, error: 'UEX_KEY is not configured on this server' } satisfies ApiResponse);
    return;
  }

  try {
    const logId = await runUexSync('MANUAL', dbUser.discordId);
    res.status(202).json({ success: true, data: { logId } } satisfies ApiResponse<{ logId: string }>);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message.includes('already in progress') ? 409 : 500;
    res.status(status).json({ success: false, error: message } satisfies ApiResponse);
  }
});
