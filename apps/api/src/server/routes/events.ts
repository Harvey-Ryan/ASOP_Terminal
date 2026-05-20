import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { assertEventViewer } from '../../lib/assertEventViewer.js';
import { triggerBot } from '../../lib/triggerBot.js';
import { ValidationError, requireStr, optStr, optEnum, optStrArr } from '../../lib/validate.js';
import type { ApiResponse, CreateEventBody, EventDto, EventRole } from '@dem/shared';

export const eventsRouter = Router();

type EventWithRsvps = Prisma.EventGetPayload<{ include: { rsvps: true } }>;

const RECUR_TYPES = ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;

// ── GET /api/guilds/:guildId/events ───────────────────────────────────────────

eventsRouter.get('/:guildId/events', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const completed = req.query['completed'] === 'true';

  try {
    if (!(await assertEventViewer(req, guildId))) {
      res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
      return;
    }

    const events = await prisma.event.findMany({
      where: completed ? { guildId, status: 'COMPLETED' } : { guildId, status: { not: 'COMPLETED' } },
      orderBy: { startTime: completed ? 'desc' : 'asc' },
      take: 50,
      include: { rsvps: true },
    });

    res.json({ success: true, data: events.map(toDto) } satisfies ApiResponse<EventDto[]>);
  } catch (err) {
    console.error('[GET events] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── GET /api/guilds/:guildId/events/:eventId ─────────────────────────────────

eventsRouter.get('/:guildId/events/:eventId', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };

  if (!(await assertEventViewer(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const event = await prisma.event.findFirst({
    where: { id: eventId, guildId },
    include: { rsvps: true },
  });

  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
    return;
  }

  res.json({ success: true, data: toDto(event) } satisfies ApiResponse<EventDto>);
});

// ── POST /api/guilds/:guildId/events ──────────────────────────────────────────

eventsRouter.post('/:guildId/events', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const body = req.body as Partial<CreateEventBody>;

  try {
    const isManager = await assertGuildManager(req, guildId);

    if (!isManager) {
      // Non-managers can create events if they hold a configured creator role
      const guildRecord = await prisma.guild.findUnique({ where: { guildId }, include: { settings: true } });
      const settingsId = guildRecord?.settings?.id;
      let allowedRoles: string[] = [];
      if (settingsId) {
        const settings = await prisma.guildSettings.findUnique({
          where: { id: settingsId },
          select: { eventCreatorRoles: true },
        });
        allowedRoles = JSON.parse(settings?.eventCreatorRoles ?? '[]') as string[];
      }

      let hasPermission = false;
      if (allowedRoles.length > 0) {
        const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
        const botToken = process.env['DISCORD_TOKEN'];
        if (dbUser && botToken) {
          try {
            const r = await fetch(
              `https://discord.com/api/v10/guilds/${guildId}/members/${dbUser.discordId}`,
              { headers: { Authorization: `Bot ${botToken}` } },
            );
            if (r.ok) {
              const member = (await r.json()) as { roles: string[] };
              hasPermission = member.roles.some((id) => allowedRoles.includes(id));
            }
          } catch {
            // leave hasPermission = false
          }
        }
      }

      if (!hasPermission) {
        res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
        return;
      }
    }

    // Validate input
    let name: string;
    let startTime: Date;
    let endTime: Date | undefined;
    try {
      name = requireStr(body.name, 'name', 200);
      optStr(body.description, 'description', 2000);
      optStr(body.musterPoint, 'musterPoint', 300);
      optStr(body.imageUrl, 'imageUrl', 1000);
      if (!body.startTime) throw new ValidationError('startTime is required');
      startTime = new Date(body.startTime);
      if (isNaN(startTime.getTime())) throw new ValidationError('startTime is not a valid date');
      endTime = body.endTime ? new Date(body.endTime) : undefined;
      if (endTime && isNaN(endTime.getTime())) throw new ValidationError('endTime is not a valid date');
      optEnum(body.recurType, 'recurType', RECUR_TYPES);
      if (body.vcNames !== undefined) optStrArr(body.vcNames, 'vcNames', 10, 100);
      if (body.roles !== undefined && !Array.isArray(body.roles))
        throw new ValidationError('roles must be an array');
      if (Array.isArray(body.roles) && body.roles.length > 50)
        throw new ValidationError('roles must have at most 50 items');
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ success: false, error: err.message } satisfies ApiResponse);
        return;
      }
      throw err;
    }

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });

    const event = await prisma.event.create({
      data: {
        guildId,
        name: body.name!.trim(),
        description: body.description?.trim() || null,
        musterPoint: body.musterPoint?.trim() || null,
        startTime,
        endTime,
        recurType: body.recurType ?? null,
        roles: JSON.stringify(body.roles ?? []),
        vcNames: JSON.stringify(body.vcNames ?? []),
        imageUrl: body.imageUrl ?? null,
        createdById: dbUser.discordId,
        status: 'PENDING',
      },
      include: { rsvps: true },
    });

    const now = new Date();
    const reminders = [
      { eventId: event.id, sendAt: new Date(startTime.getTime() - 60 * 60_000), type: 'FORUM' },
      { eventId: event.id, sendAt: new Date(startTime.getTime() - 30 * 60_000), type: 'FORUM' },
      { eventId: event.id, sendAt: new Date(startTime.getTime() - 15 * 60_000), type: 'DM' },
    ].filter((r) => r.sendAt > now);
    if (reminders.length > 0) await prisma.eventReminder.createMany({ data: reminders });

    triggerBot(`/trigger/event/${event.id}`);

    res.status(201).json({ success: true, data: toDto(event) } satisfies ApiResponse<EventDto>);
  } catch (err) {
    console.error('[POST events] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── POST /api/guilds/:guildId/events/:eventId/end ─────────────────────────────

eventsRouter.post('/:guildId/events/:eventId/end', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const event = await prisma.event.findFirst({ where: { id: eventId, guildId } });
  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
    return;
  }
  if (event.status === 'COMPLETED') {
    res.status(409).json({ success: false, error: 'Event already completed' } satisfies ApiResponse);
    return;
  }

  await prisma.event.update({ where: { id: eventId }, data: { status: 'ENDED' } });

  triggerBot(`/trigger/end/${eventId}`);

  res.json({ success: true, message: 'Event ending — bot will clean up shortly' } satisfies ApiResponse);
});

// ── POST /api/guilds/:guildId/events/:eventId/complete ────────────────────────

eventsRouter.post('/:guildId/events/:eventId/complete', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const event = await prisma.event.findFirst({ where: { id: eventId, guildId } });
  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
    return;
  }
  if (event.status !== 'ENDED') {
    res.status(409).json({ success: false, error: 'Event must be in ENDED status to complete' } satisfies ApiResponse);
    return;
  }

  // Validate complete body
  const body = req.body as { hadLoot?: unknown; lootNotes?: unknown; confirmedAttendees?: unknown };
  try {
    if (body.lootNotes !== undefined) optStr(body.lootNotes, 'lootNotes', 2000);
    if (body.confirmedAttendees !== undefined) optStrArr(body.confirmedAttendees, 'confirmedAttendees', 500, 30);
    if (body.hadLoot !== undefined && typeof body.hadLoot !== 'boolean')
      throw new ValidationError('hadLoot must be a boolean');
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ success: false, error: err.message } satisfies ApiResponse);
      return;
    }
    throw err;
  }

  const { hadLoot, lootNotes, confirmedAttendees } = body as {
    hadLoot?: boolean;
    lootNotes?: string;
    confirmedAttendees?: string[];
  };

  await prisma.event.update({
    where: { id: eventId },
    data: {
      status: 'COMPLETED',
      ...(hadLoot !== undefined ? { hadLoot } : {}),
      ...(lootNotes ? { lootNotes } : {}),
      ...(confirmedAttendees ? { confirmedAttendees: JSON.stringify(confirmedAttendees) } : {}),
    },
  });

  res.json({ success: true, message: 'Event completed' } satisfies ApiResponse);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDto(event: EventWithRsvps): EventDto {
  return {
    id: event.id,
    guildId: event.guildId,
    name: event.name,
    description: event.description,
    musterPoint: event.musterPoint,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime?.toISOString() ?? null,
    recurType: event.recurType,
    roles: JSON.parse(event.roles) as EventRole[],
    vcNames: JSON.parse(event.vcNames) as string[],
    imageUrl: event.imageUrl,
    discordEventId: event.discordEventId,
    threadId: event.threadId,
    status: event.status,
    createdById: event.createdById,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    rsvpCounts: { total: event.rsvps.length },
    rsvps: event.rsvps.map((r) => ({ userId: r.userId, username: r.username, role: r.role })),
    hadLoot: event.hadLoot ?? null,
    lootNotes: event.lootNotes ?? null,
    vcAttendees: JSON.parse(event.vcAttendees) as string[],
    confirmedAttendees: event.confirmedAttendees ? (JSON.parse(event.confirmedAttendees) as string[]) : null,
    botCleanedUp: event.botCleanedUp,
  };
}
