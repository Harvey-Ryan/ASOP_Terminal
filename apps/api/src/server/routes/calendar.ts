// Personal calendar feed (v1.16.0): the events you signed up for, as an
// iCalendar link that Google / Apple / Outlook calendars subscribe to. Calendar
// apps fetch it without signing in, so the link carries a secret token; it can
// be reset from Notification Settings, which stops the old link working.

import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { buildIcs, findRole, type ApiResponse, type EventRole, type IcsEvent } from '@dem/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';

export const calendarRouter = Router();

const newToken = () => randomBytes(24).toString('base64url'); // 32 characters
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
/** Events from this long ago stay in the calendar, so last week's op is still there. */
const HISTORY_MS = 30 * 86_400_000;
const DEFAULT_LENGTH_MS = 2 * 3600_000; // as for Discord's scheduled events

// ── The link (signed in) ─────────────────────────────────────────────────────

calendarRouter.get('/me/calendar', requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { calendarToken: true } });
  const token = user.calendarToken ?? (await prisma.user.update({ where: { id: userId }, data: { calendarToken: newToken() } })).calendarToken!;
  res.json({ success: true, data: { token } } satisfies ApiResponse<{ token: string }>);
});

calendarRouter.post('/me/calendar/reset', requireAuth, async (req, res) => {
  const user = await prisma.user.update({ where: { id: req.session.userId! }, data: { calendarToken: newToken() } });
  res.json({ success: true, data: { token: user.calendarToken! } } satisfies ApiResponse<{ token: string }>);
});

// ── The feed (no sign-in; the token is the key) ──────────────────────────────

calendarRouter.get('/calendar/:file', async (req, res) => {
  const token = String(req.params['file']).replace(/\.ics$/, '');
  const user = TOKEN_RE.test(token)
    ? await prisma.user.findUnique({ where: { calendarToken: token }, select: { discordId: true } })
    : null;
  if (!user) {
    res.status(404).type('text/plain').send('This calendar link was reset or doesn\'t exist. Copy the new one from ASOP\'s Notification Settings.');
    return;
  }

  const rsvps = await prisma.eventRsvp.findMany({
    where: {
      userId: user.discordId,
      event: { status: { not: 'CANCELLED' }, startTime: { gte: new Date(Date.now() - HISTORY_MS) } },
    },
    include: { event: { include: { allianceGuilds: { select: { id: true } }, waitlist: { orderBy: { id: 'asc' }, select: { userId: true, role: true } } } } },
    orderBy: { event: { startTime: 'asc' } },
    take: 300,
  });
  const hostNames = new Map((await prisma.guild.findMany({
    where: { guildId: { in: [...new Set(rsvps.map((r) => r.event.guildId))] } },
    select: { guildId: true, name: true },
  })).map((g) => [g.guildId, g.name]));

  const events: IcsEvent[] = rsvps.map(({ event: e, role, tentative }) => {
    const roles = JSON.parse(e.roles) as EventRole[];
    const roleName = (key: string | null) => (key ? findRole(roles, key)?.name ?? key : null);
    const waiting = e.waitlist.find((w) => w.userId === user.discordId);
    const place = waiting ? e.waitlist.filter((w) => w.role === waiting.role).findIndex((w) => w.userId === user.discordId) + 1 : 0;
    // The host's thread, when everyone can open it (shared events have a thread per server).
    const url = e.threadId && e.allianceGuilds.length === 0 ? `https://discord.com/channels/${e.guildId}/${e.threadId}` : null;
    const description = [
      tentative ? 'You said maybe' : `Your role: ${roleName(role) ?? 'Unassigned'}`,
      waiting ? `Waiting for ${roleName(waiting.role)} (#${place} in line)` : null,
      `Server: ${hostNames.get(e.guildId) ?? 'ASOP'}`,
      e.description ? `\n${e.description}` : null,
      url ? `\nEvent thread: ${url}` : null,
    ].filter(Boolean).join('\n');
    return {
      uid: `${e.id}@asop-terminal`,
      start: e.startTime,
      end: e.endTime ?? new Date(e.startTime.getTime() + DEFAULT_LENGTH_MS),
      summary: e.name,
      description,
      location: e.musterPoint,
      url,
      updated: e.updatedAt,
      tentative,
    };
  });

  res.set('Cache-Control', 'private, max-age=300');
  res.type('text/calendar; charset=utf-8').send(buildIcs('ASOP events', events));
});
