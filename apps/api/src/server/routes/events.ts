import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { assertEventViewer } from '../../lib/assertEventViewer.js';
import { triggerBot } from '../../lib/triggerBot.js';
import { ValidationError, requireStr, optStr, optEnum, optStrArr } from '../../lib/validate.js';
import type { ApiResponse, CreateEventBody, EventDto, EventRole, RepeatTemplateDto } from '@dem/shared';

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

    // Track repeat template usage — template ID is resolved before the form opens,
    // so name changes in the form don't create a new template or reset the counter.
    if (body.repeatFromTemplateId) {
      const tmpl = await prisma.repeatTemplate.findFirst({ where: { id: body.repeatFromTemplateId, guildId } });
      if (tmpl) {
        // Propagate any structural tweaks the user made (roles, VCs, etc.) back to the
        // template so the next repeat picks them up — name is intentionally excluded so
        // the template identity (and the @@unique key) never changes.
        await prisma.repeatTemplate.update({
          where: { id: tmpl.id },
          data: {
            description: event.description,
            musterPoint: event.musterPoint,
            roles: event.roles,
            vcNames: event.vcNames,
            imageUrl: event.imageUrl,
          },
        });
        await prisma.repeatTemplateUse.create({ data: { templateId: tmpl.id } });
      }
    }

    triggerBot(`/trigger/event/${event.id}`);

    res.status(201).json({ success: true, data: toDto(event) } satisfies ApiResponse<EventDto>);
  } catch (err) {
    console.error('[POST events] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── PUT /api/guilds/:guildId/events/:eventId/rsvp ────────────────────────────

eventsRouter.put('/:guildId/events/:eventId/rsvp', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };

  if (!(await assertEventViewer(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const event = await prisma.event.findFirst({ where: { id: eventId, guildId } });
  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
    return;
  }
  if (event.status === 'COMPLETED' || event.status === 'ENDED') {
    res.status(409).json({ success: false, error: 'Cannot RSVP to a completed or ended event' } satisfies ApiResponse);
    return;
  }

  const body = req.body as { role?: string | null };
  const role = body.role ?? null;

  if (role !== null) {
    const roles = JSON.parse(event.roles) as EventRole[];
    if (!roles.some((r) => r.name === role)) {
      res.status(400).json({ success: false, error: 'Invalid role' } satisfies ApiResponse);
      return;
    }
  }

  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });

  let displayName = dbUser.globalName ?? dbUser.username;
  const botToken = process.env['DISCORD_TOKEN'];
  if (botToken) {
    try {
      const r = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}/members/${dbUser.discordId}`,
        { headers: { Authorization: `Bot ${botToken}` } },
      );
      if (r.ok) {
        const member = (await r.json()) as { nick?: string | null; user?: { global_name?: string | null } };
        displayName = member.nick ?? member.user?.global_name ?? dbUser.globalName ?? dbUser.username;
      }
    } catch {}
  }

  await prisma.eventRsvp.upsert({
    where: { eventId_userId: { eventId, userId: dbUser.discordId } },
    create: { eventId, userId: dbUser.discordId, username: displayName, role },
    update: { role, username: displayName },
  });

  triggerBot(`/trigger/rsvp/${eventId}`);

  const updated = await prisma.event.findFirstOrThrow({ where: { id: eventId, guildId }, include: { rsvps: true } });
  res.json({ success: true, data: toDto(updated) } satisfies ApiResponse<EventDto>);
});

// ── DELETE /api/guilds/:guildId/events/:eventId/rsvp ─────────────────────────

eventsRouter.delete('/:guildId/events/:eventId/rsvp', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };

  if (!(await assertEventViewer(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });

  await prisma.eventRsvp.deleteMany({ where: { eventId, userId: dbUser.discordId } });

  triggerBot(`/trigger/rsvp/${eventId}`);

  const updated = await prisma.event.findFirstOrThrow({ where: { id: eventId, guildId }, include: { rsvps: true } });
  res.json({ success: true, data: toDto(updated) } satisfies ApiResponse<EventDto>);
});

// ── PATCH /api/guilds/:guildId/events/:eventId ───────────────────────────────

eventsRouter.patch('/:guildId/events/:eventId', requireAuth, async (req, res) => {
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
    res.status(409).json({ success: false, error: 'Completed events cannot be edited' } satisfies ApiResponse);
    return;
  }

  const body = req.body as Partial<CreateEventBody>;
  try {
    if (body.name !== undefined) requireStr(body.name, 'name', 200);
    if (body.description !== undefined) optStr(body.description, 'description', 2000);
    if (body.musterPoint !== undefined) optStr(body.musterPoint, 'musterPoint', 300);
    if (body.imageUrl !== undefined) optStr(body.imageUrl, 'imageUrl', 1000);
    if (body.roles !== undefined && !Array.isArray(body.roles))
      throw new ValidationError('roles must be an array');
    if (body.vcNames !== undefined) optStrArr(body.vcNames, 'vcNames', 10, 100);
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ success: false, error: err.message } satisfies ApiResponse);
      return;
    }
    throw err;
  }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data['name'] = body.name.trim();
  if (body.description !== undefined) data['description'] = body.description?.trim() || null;
  if (body.musterPoint !== undefined) data['musterPoint'] = body.musterPoint?.trim() || null;
  if (body.imageUrl !== undefined) data['imageUrl'] = body.imageUrl || null;
  if (body.roles !== undefined) data['roles'] = JSON.stringify(body.roles);
  if (body.vcNames !== undefined) data['vcNames'] = JSON.stringify(body.vcNames);
  if (body.startTime !== undefined) {
    const startTime = new Date(body.startTime);
    if (isNaN(startTime.getTime())) {
      res.status(400).json({ success: false, error: 'startTime is not a valid date' } satisfies ApiResponse);
      return;
    }
    data['startTime'] = startTime;
  }
  if (body.endTime !== undefined) {
    const endTime = body.endTime ? new Date(body.endTime) : null;
    if (endTime && isNaN(endTime.getTime())) {
      res.status(400).json({ success: false, error: 'endTime is not a valid date' } satisfies ApiResponse);
      return;
    }
    data['endTime'] = endTime;
  }

  const updated = await prisma.event.update({ where: { id: eventId }, data, include: { rsvps: true } });
  triggerBot(`/trigger/rsvp/${eventId}`);
  res.json({ success: true, data: toDto(updated) } satisfies ApiResponse<EventDto>);
});

// ── PATCH /api/guilds/:guildId/events/:eventId/rsvp/:userId (manager reassign) ─

eventsRouter.patch('/:guildId/events/:eventId/rsvp/:userId', requireAuth, async (req, res) => {
  const { guildId, eventId, userId } = req.params as { guildId: string; eventId: string; userId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const body = req.body as { role?: string | null };
  const role = body.role ?? null;

  if (role !== null) {
    const event = await prisma.event.findFirst({ where: { id: eventId, guildId } });
    if (!event) {
      res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
      return;
    }
    const roles = JSON.parse(event.roles) as EventRole[];
    if (!roles.some((r) => r.name === role)) {
      res.status(400).json({ success: false, error: 'Invalid role' } satisfies ApiResponse);
      return;
    }
  }

  await prisma.eventRsvp.updateMany({ where: { eventId, userId }, data: { role } });
  triggerBot(`/trigger/rsvp/${eventId}`);

  const updated = await prisma.event.findFirstOrThrow({ where: { id: eventId, guildId }, include: { rsvps: true } });
  res.json({ success: true, data: toDto(updated) } satisfies ApiResponse<EventDto>);
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
  await prisma.eventReminder.deleteMany({ where: { eventId, sent: false } });

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

  triggerBot(`/trigger/complete/${eventId}`);

  res.json({ success: true, message: 'Event completed' } satisfies ApiResponse);
});

// ── POST /api/guilds/:guildId/repeat-templates/from-event ────────────────────
// Called when the Repeat button is clicked (before the create form opens).
// Finds the existing template for this event name or creates one, returning
// the stable ID so the form can carry it through to submit unchanged.

eventsRouter.post('/:guildId/repeat-templates/from-event', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const { eventId } = req.body as { eventId?: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  if (!eventId) {
    res.status(400).json({ success: false, error: 'eventId is required' } satisfies ApiResponse);
    return;
  }

  const event = await prisma.event.findFirst({ where: { id: eventId, guildId } });
  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
    return;
  }

  // Find-or-create: upsert with empty update so the ID is stable on subsequent calls.
  const template = await prisma.repeatTemplate.upsert({
    where: { guildId_name: { guildId, name: event.name } },
    create: {
      guildId,
      name: event.name,
      description: event.description,
      musterPoint: event.musterPoint,
      roles: event.roles,
      vcNames: event.vcNames,
      imageUrl: event.imageUrl,
    },
    update: {},
  });

  const dto: RepeatTemplateDto = {
    id: template.id,
    guildId: template.guildId,
    name: template.name,
    description: template.description,
    musterPoint: template.musterPoint,
    roles: JSON.parse(template.roles) as EventRole[],
    vcNames: JSON.parse(template.vcNames) as string[],
    imageUrl: template.imageUrl,
    useCount: 0,
  };

  res.json({ success: true, data: dto } satisfies ApiResponse<RepeatTemplateDto>);
});

// ── GET /api/guilds/:guildId/repeat-templates ─────────────────────────────────

eventsRouter.get('/:guildId/repeat-templates', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const templates = await prisma.repeatTemplate.findMany({
    where: { guildId },
    include: {
      uses: { where: { usedAt: { gte: sixMonthsAgo } }, select: { id: true } },
    },
  });

  const ranked = templates
    .map((t) => ({ ...t, useCount: t.uses.length }))
    .filter((t) => t.useCount > 0)
    .sort((a, b) => b.useCount - a.useCount)
    .slice(0, 5)
    .map((t): RepeatTemplateDto => ({
      id: t.id,
      guildId: t.guildId,
      name: t.name,
      description: t.description,
      musterPoint: t.musterPoint,
      roles: JSON.parse(t.roles) as EventRole[],
      vcNames: JSON.parse(t.vcNames) as string[],
      imageUrl: t.imageUrl,
      useCount: t.useCount,
    }));

  res.json({ success: true, data: ranked } satisfies ApiResponse<RepeatTemplateDto[]>);
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
