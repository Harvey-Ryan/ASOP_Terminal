import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertEventCreator } from '../../lib/assertEventCreator.js';
import { assertEventViewer } from '../../lib/assertEventViewer.js';
import { buildEventHeatmap, isValidTimeZone, type ApiResponse, type EventHeatmapDto } from '@dem/shared';

export const heatmapRouter = Router();

// GET /api/guilds/:guildId/heatmap/events?days=180&timezone=America/Chicago
heatmapRouter.get('/:guildId/heatmap/events', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  // Officers, or members when the server lets them see heat maps (v1.21.1: there was no check).
  const officer = await assertEventCreator(req, guildId);
  if (!officer) {
    const g = await prisma.guild.findUnique({ where: { guildId }, select: { settings: { select: { activityHeatmapPublic: true } } } });
    if (!(await assertEventViewer(req, guildId)) || g?.settings?.activityHeatmapPublic === false) {
      res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
      return;
    }
  }
  const days = Math.min(365, Math.max(1, Number(req.query.days ?? 180) || 180));
  const timezone = (req.query.timezone as string | undefined) ?? 'UTC';
  if (!isValidTimeZone(timezone)) {
    res.status(400).json({ success: false, error: 'Unknown time zone.' } satisfies ApiResponse);
    return;
  }

  try {
    const events = await prisma.event.findMany({
      where: {
        guildId,
        startTime: { gte: new Date(Date.now() - days * 86_400_000), lte: new Date() },
        status: { in: ['ENDED', 'COMPLETED'] },
      },
      select: {
        startTime: true, status: true, vcAttendees: true, confirmedAttendees: true,
        rsvps: { select: { userId: true, tentative: true } },
      },
    });
    // Rules (v1.24.0): packages/shared/src/heatmap.ts — recorded attendance only,
    // average turnout per event, show-up rate over the people who signed up.
    res.json({ success: true, data: buildEventHeatmap(events, timezone, days) } satisfies ApiResponse<EventHeatmapDto>);
  } catch (err) {
    console.error('[heatmap/events]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});
