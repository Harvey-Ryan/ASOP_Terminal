import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { assertEventCreator } from '../../lib/assertEventCreator.js';
import { assertEventViewer } from '../../lib/assertEventViewer.js';
import { triggerBot } from '../../lib/triggerBot.js';
import { ValidationError, requireStr, optStr, optEnum, optStrArr } from '../../lib/validate.js';
import type { ApiResponse, CreateEventBody, EventDto, EventPoll, EventRole, EventTemplateDto } from '@dem/shared';

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

    // Include events shared with alliances that this guild has accepted.
    const memberships = await prisma.allianceMember.findMany({
      where: { guild: { guildId }, status: 'ACCEPTED' },
      select: { allianceId: true },
    });
    const allianceIds = memberships.map((m) => m.allianceId);

    const guildFilter = allianceIds.length > 0
      ? { OR: [{ guildId }, { allianceId: { in: allianceIds } }] }
      : { guildId };

    const events = await prisma.event.findMany({
      where: completed
        ? { ...guildFilter, status: 'COMPLETED' }
        : { ...guildFilter, status: { not: 'COMPLETED' } },
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

  // Allow viewing own events and alliance-shared events.
  const memberships = await prisma.allianceMember.findMany({
    where: { guild: { guildId }, status: 'ACCEPTED' },
    select: { allianceId: true },
  });
  const allianceIds = memberships.map((m) => m.allianceId);

  const event = await prisma.event.findFirst({
    where: {
      id: eventId,
      OR: [
        { guildId },
        ...(allianceIds.length > 0 ? [{ allianceId: { in: allianceIds } }] : []),
      ],
    },
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

    // Validate alliance if provided
    if (body.allianceId) {
      const alliance = await prisma.alliance.findUnique({ where: { id: body.allianceId } });
      if (!alliance) {
        res.status(400).json({ success: false, error: 'Alliance not found' } satisfies ApiResponse);
        return;
      }
    }

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
        briefingChannel: body.briefingChannel ?? false,
        imageUrl: body.imageUrl ?? null,
        pollData: body.poll ? JSON.stringify(body.poll) : null,
        allianceId: body.allianceId ?? null,
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

    // Track event template usage — template ID is resolved before the form opens via
    // the from-event endpoint, so name changes in the form never affect attribution.
    if (body.repeatFromTemplateId) {
      const tmpl = await prisma.eventTemplate.findFirst({
        where: { id: body.repeatFromTemplateId, guild: { guildId } },
      });
      if (tmpl) {
        // Propagate structural tweaks the user made back to the template so the
        // next repeat picks them up. Name is excluded — template identity is
        // anchored to sourceEventId, not the name.
        await prisma.eventTemplate.update({
          where: { id: tmpl.id },
          data: {
            description: event.description,
            musterPoint: event.musterPoint,
            roles: event.roles,
            vcNames: event.vcNames,
            briefingChannel: event.briefingChannel,
            imageUrl: event.imageUrl,
          },
        });
        await prisma.eventTemplateUse.create({ data: { templateId: tmpl.id } });
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

  if (!(await assertEventCreator(req, guildId))) {
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
  if (body.briefingChannel !== undefined) data['briefingChannel'] = body.briefingChannel;
  let newStartTime: Date | undefined;
  if (body.startTime !== undefined) {
    const startTime = new Date(body.startTime);
    if (isNaN(startTime.getTime())) {
      res.status(400).json({ success: false, error: 'startTime is not a valid date' } satisfies ApiResponse);
      return;
    }
    data['startTime'] = startTime;
    newStartTime = startTime;
  }
  if (body.endTime !== undefined) {
    const endTime = body.endTime ? new Date(body.endTime) : null;
    if (endTime && isNaN(endTime.getTime())) {
      res.status(400).json({ success: false, error: 'endTime is not a valid date' } satisfies ApiResponse);
      return;
    }
    data['endTime'] = endTime;
  }

  // If roles changed, move members whose role no longer exists to Unassigned
  // rather than leaving them stranded on a deleted/renamed role.
  if (body.roles !== undefined) {
    const oldRoleNames = new Set((JSON.parse(event.roles) as EventRole[]).map((r) => r.name));
    const newRoleNames = new Set(body.roles.map((r) => r.name));
    const removedNames = [...oldRoleNames].filter((n) => !newRoleNames.has(n));
    if (removedNames.length > 0) {
      await prisma.eventRsvp.updateMany({
        where: { eventId, role: { in: removedNames } },
        data: { role: null },
      });
    }
  }

  // If startTime changed, reschedule reminders to match the new time.
  if (newStartTime) {
    await prisma.eventReminder.deleteMany({ where: { eventId, sent: false } });
    const now = new Date();
    const reminders = [
      { eventId, sendAt: new Date(newStartTime.getTime() - 60 * 60_000), type: 'FORUM' },
      { eventId, sendAt: new Date(newStartTime.getTime() - 30 * 60_000), type: 'FORUM' },
      { eventId, sendAt: new Date(newStartTime.getTime() - 15 * 60_000), type: 'DM' },
    ].filter((r) => r.sendAt > now);
    if (reminders.length > 0) await prisma.eventReminder.createMany({ data: reminders });
  }

  const updated = await prisma.event.update({ where: { id: eventId }, data, include: { rsvps: true } });
  triggerBot(`/trigger/sync/${eventId}`);
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
  triggerBot(`/trigger/rsvp-reassign/${eventId}/${userId}`);

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

// ── POST /api/guilds/:guildId/events/:eventId/start ──────────────────────────

eventsRouter.post('/:guildId/events/:eventId/start', requireAuth, async (req, res) => {
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
  if (event.status !== 'PENDING') {
    res.status(409).json({ success: false, error: 'Only PENDING events can be force-started' } satisfies ApiResponse);
    return;
  }

  await prisma.event.update({ where: { id: eventId }, data: { status: 'ACTIVE' } });
  triggerBot(`/trigger/start/${eventId}`);

  res.json({ success: true, message: 'Event started' } satisfies ApiResponse);
});

// ── POST /api/guilds/:guildId/events/:eventId/vcs ────────────────────────────

eventsRouter.post('/:guildId/events/:eventId/vcs', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  const event = await prisma.event.findFirst({ where: { id: eventId, guildId } });
  if (!event) { res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse); return; }
  if (event.status === 'COMPLETED' || event.status === 'ENDED') {
    res.status(409).json({ success: false, error: 'Event is already over' } satisfies ApiResponse); return;
  }

  triggerBot(`/trigger/create-vcs/${eventId}`);
  res.json({ success: true, message: 'VC creation queued' } satisfies ApiResponse);
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

// ── POST /api/guilds/:guildId/event-templates/from-event ─────────────────────
// Called when the Repeat button is clicked (before the create form opens).
// Upserts an EventTemplate keyed on sourceEventId (the source event's stable
// cuid) so the template ID never changes even if the event name is edited.

eventsRouter.post('/:guildId/event-templates/from-event', requireAuth, async (req, res) => {
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

  const guild = await prisma.guild.findUniqueOrThrow({ where: { guildId } });
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });

  // Upsert by sourceEventId — always refresh the blueprint with current event data
  // so the next repeat starts from the latest version, not the first one ever created.
  const template = await prisma.eventTemplate.upsert({
    where: { sourceEventId: eventId },
    create: {
      guildId: guild.id,
      name: event.name,
      description: event.description,
      musterPoint: event.musterPoint,
      roles: event.roles,
      vcNames: event.vcNames,
      briefingChannel: event.briefingChannel,
      imageUrl: event.imageUrl,
      sourceEventId: eventId,
      createdById: dbUser.id,
    },
    update: {
      name: event.name,
      description: event.description,
      musterPoint: event.musterPoint,
      roles: event.roles,
      vcNames: event.vcNames,
      briefingChannel: event.briefingChannel,
      imageUrl: event.imageUrl,
    },
    include: { uses: { select: { id: true } } },
  });

  const dto: EventTemplateDto = {
    id: template.id,
    guildId,
    name: template.name,
    description: template.description,
    musterPoint: template.musterPoint,
    roles: JSON.parse(template.roles) as EventRole[],
    vcNames: JSON.parse(template.vcNames) as string[],
    briefingChannel: template.briefingChannel,
    imageUrl: template.imageUrl,
    rosterSlots: JSON.parse(template.rosterSlots),
    reminderMinutes: JSON.parse(template.reminderMinutes),
    defaultDuration: template.defaultDuration,
    isActive: template.isActive,
    createdById: template.createdById,
    useCount: template.uses.length,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };

  res.json({ success: true, data: dto } satisfies ApiResponse<EventTemplateDto>);
});

// ── GET /api/guilds/:guildId/event-templates ──────────────────────────────────
// Returns the top 5 most-used templates (last 6 months) for the Templates panel.

eventsRouter.get('/:guildId/event-templates', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const guild = await prisma.guild.findUniqueOrThrow({ where: { guildId } });
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const templates = await prisma.eventTemplate.findMany({
    where: { guildId: guild.id, isActive: true },
    include: {
      uses: { where: { usedAt: { gte: sixMonthsAgo } }, select: { id: true } },
    },
  });

  const ranked = templates
    .map((t) => ({ ...t, useCount: t.uses.length }))
    .filter((t) => t.useCount > 0)
    .sort((a, b) => b.useCount - a.useCount)
    .slice(0, 5)
    .map((t): EventTemplateDto => ({
      id: t.id,
      guildId,
      name: t.name,
      description: t.description,
      musterPoint: t.musterPoint,
      roles: JSON.parse(t.roles) as EventRole[],
      vcNames: JSON.parse(t.vcNames) as string[],
      briefingChannel: t.briefingChannel,
      imageUrl: t.imageUrl,
      rosterSlots: JSON.parse(t.rosterSlots),
      reminderMinutes: JSON.parse(t.reminderMinutes),
      defaultDuration: t.defaultDuration,
      isActive: t.isActive,
      createdById: t.createdById,
      useCount: t.useCount,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));

  res.json({ success: true, data: ranked } satisfies ApiResponse<EventTemplateDto[]>);
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
    vcIds: JSON.parse(event.vcIds) as string[],
    briefingChannel: event.briefingChannel,
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
    poll: event.pollData ? (JSON.parse(event.pollData) as EventPoll) : null,
    allianceId: event.allianceId ?? null,
  };
}
