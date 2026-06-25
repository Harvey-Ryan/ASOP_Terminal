import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import type { ApiResponse } from '@dem/shared';

export const heatmapRouter = Router();

// GET /api/guilds/:guildId/heatmap/events?days=180&timezone=UTC
heatmapRouter.get('/:guildId/heatmap/events', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const days = Math.min(365, Math.max(1, Number(req.query.days ?? 180)));
  const timezone = (req.query.timezone as string | undefined) ?? 'UTC';

  try {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const events = await prisma.event.findMany({
      where: {
        guildId,
        startTime: { gte: cutoff, lte: new Date() },
        status: { in: ['ENDED', 'COMPLETED'] },
      },
      select: {
        id: true,
        startTime: true,
        vcAttendees: true,
        confirmedAttendees: true,
        rsvps: { select: { id: true } },
      },
    });

    // Build 7×24 grids: one for attendance count, one for total rsvps (to compute ratio)
    const attendanceGrid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const rsvpGrid       = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const eventCountGrid = Array.from({ length: 7 }, () => new Array(24).fill(0));

    for (const event of events) {
      // Apply timezone offset to get local day/hour
      const localDate = new Date(event.startTime.toLocaleString('en-US', { timeZone: timezone }));
      const dow  = localDate.getDay();   // 0=Sun
      const hour = localDate.getHours(); // 0-23

      // Attendance: prefer confirmedAttendees, fall back to vcAttendees
      const rawAttendees = event.confirmedAttendees ?? event.vcAttendees;
      let attendeeCount = 0;
      try {
        const arr = JSON.parse(rawAttendees ?? '[]') as unknown;
        attendeeCount = Array.isArray(arr) ? arr.length : 0;
      } catch { attendeeCount = 0; }

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      attendanceGrid[dow]![hour]! += attendeeCount;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      rsvpGrid[dow]![hour]!       += event.rsvps.length;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      eventCountGrid[dow]![hour]! += 1;
    }

    // RSVP-to-showed ratio grid (0–1, or null if no RSVPs)
    const ratioGrid = attendanceGrid.map((row, d) =>
      row.map((att, h) => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const rsvp = rsvpGrid[d]![h]!;
        return rsvp > 0 ? Math.min(1, att / rsvp) : null;
      })
    );

    const maxAttendance = Math.max(1, ...attendanceGrid.flat());

    res.json({
      success: true,
      data: {
        attendanceGrid,
        ratioGrid,
        eventCountGrid,
        maxAttendance,
        days,
        timezone,
        eventCount: events.length,
      },
    } satisfies ApiResponse);
  } catch (err) {
    console.error('[heatmap/events]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});
