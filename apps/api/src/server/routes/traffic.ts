import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import type { ApiResponse } from '@dem/shared';

export const trafficRouter = Router();

interface ModuleStat {
  module: string;
  requests: number;
  uniqueUsers: number;
}

interface RouteStat {
  method: string;
  path: string;
  count: number;
}

interface DayStat {
  date: string;
  total: number;
}

interface TrafficSummaryData {
  modules: ModuleStat[];
  topRoutes: RouteStat[];
  timeSeries: DayStat[];
  totalRequests: number;
  periodDays: number;
}

// ── GET /api/guilds/:guildId/traffic ─────────────────────────────────────────

trafficRouter.get('/:guildId/traffic', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };

  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const rawDays = Number(req.query['days'] ?? 30);
  const days = [7, 30, 90].includes(rawDays) ? rawDays : 30;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const [moduleGroups, routeGroups, daySeries, uniqueUserPairs] = await Promise.all([
      // Module breakdown
      prisma.requestLog.groupBy({
        by: ['module'],
        where: { guildId, createdAt: { gte: cutoff } },
        _count: { _all: true },
        orderBy: { _count: { module: 'desc' } },
      }),

      // Top routes
      prisma.requestLog.groupBy({
        by: ['method', 'path'],
        where: { guildId, createdAt: { gte: cutoff } },
        _count: { _all: true },
        orderBy: { _count: { path: 'desc' } },
        take: 20,
      }),

      // Daily time series
      prisma.$queryRaw<Array<{ date: string; total: bigint }>>`
        SELECT TO_CHAR("createdAt"::date, 'YYYY-MM-DD') AS date,
               COUNT(*) AS total
        FROM "RequestLog"
        WHERE "guildId" = ${guildId}
          AND "createdAt" >= ${cutoff}
        GROUP BY "createdAt"::date
        ORDER BY "createdAt"::date ASC
      `,

      // Distinct (module, userId) pairs — count per module in JS (single query, no N+1)
      prisma.requestLog.findMany({
        where: { guildId, createdAt: { gte: cutoff }, userId: { not: null } },
        select: { module: true, userId: true },
        distinct: ['module', 'userId'],
      }),
    ]);

    const uniqueUserMap = new Map<string, number>();
    for (const row of uniqueUserPairs) {
      uniqueUserMap.set(row.module, (uniqueUserMap.get(row.module) ?? 0) + 1);
    }

    const modules: ModuleStat[] = moduleGroups.map((g) => ({
      module:      g.module,
      requests:    g._count._all,
      uniqueUsers: uniqueUserMap.get(g.module) ?? 0,
    }));

    const topRoutes: RouteStat[] = routeGroups.map((g) => ({
      method: g.method,
      path:   g.path,
      count:  g._count._all,
    }));

    const timeSeries: DayStat[] = daySeries.map((r) => ({
      date:  r.date,
      total: Number(r.total),
    }));

    const totalRequests = modules.reduce((sum, m) => sum + m.requests, 0);

    res.json({
      success: true,
      data: { modules, topRoutes, timeSeries, totalRequests, periodDays: days },
    } satisfies ApiResponse<TrafficSummaryData>);
  } catch (err) {
    console.error('[traffic]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});
