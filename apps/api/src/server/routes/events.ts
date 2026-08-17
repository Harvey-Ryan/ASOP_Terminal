import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { assertEventCreator } from '../../lib/assertEventCreator.js';
import { assertEventViewer } from '../../lib/assertEventViewer.js';
import { triggerBot } from '../../lib/triggerBot.js';
import { ValidationError, requireStr, optStr, optEnum, optStrArr } from '../../lib/validate.js';
import type { ApiResponse, CreateEventBody, EventDto, EventGuildShareDto, EventPoll, EventRole, EventTemplateDto } from '@dem/shared';

export const eventsRouter = Router();

type EventWithRsvpsAndShares = Prisma.EventGetPayload<{
  include: {
    rsvps: true;
    guildShares: { include: { guild: { select: { id: true; guildId: true; name: true } } } };
  };
}>;

// kept for routes that don't need shares (e.g. RSVP updates)
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

    const guild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
    if (!guild) {
      res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
      return;
    }

    // Grandfathered: alliance memberships for old-style allianceId-based sharing
    const memberships = await prisma.allianceMember.findMany({
      where: { guild: { guildId }, status: 'ACCEPTED' },
      select: { allianceId: true },
    });
    const allianceIds = memberships.map((m) => m.allianceId);

    const statusFilter = completed ? { status: 'COMPLETED' } : { status: { not: 'COMPLETED' } };

    const events = await prisma.event.findMany({
      where: {
        ...statusFilter,
        OR: [
          { guildId },
          // Grandfathered: old-style allianceId events that predate EventGuildShare.
          // Excluded when a share record exists (any status) — those events use the
          // guildShares clause below and must be explicitly accepted.
          ...(allianceIds.length > 0
            ? [{ allianceId: { in: allianceIds }, guildShares: { none: { guildId: guild.id } } }]
            : []),
          // New invite system: events accepted via EventGuildShare
          { guildShares: { some: { guildId: guild.id, status: 'ACCEPTED' } } },
        ],
      },
      orderBy: { startTime: completed ? 'desc' : 'asc' },
      take: 50,
      include: {
        rsvps: true,
        guildShares: { include: { guild: { select: { id: true, guildId: true, name: true } } } },
      },
    });

    res.json({ success: true, data: events.map(toDto) } satisfies ApiResponse<EventDto[]>);
  } catch (err) {
    console.error('[GET events] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── GET /api/guilds/:guildId/events/pending-shares ───────────────────────────
// Must be registered BEFORE /:eventId so Express doesn't eat "pending-shares"
// as a path parameter.

eventsRouter.get('/:guildId/events/pending-shares', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };

  if (!(await assertEventViewer(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const guild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
  if (!guild) {
    res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
    return;
  }

  const events = await prisma.event.findMany({
    where: {
      status: { not: 'COMPLETED' },
      guildShares: { some: { guildId: guild.id, status: 'PENDING' } },
    },
    orderBy: { startTime: 'asc' },
    include: {
      rsvps: true,
      guildShares: { include: { guild: { select: { id: true, guildId: true, name: true } } } },
    },
  });

  res.json({ success: true, data: events.map(toDto) } satisfies ApiResponse<EventDto[]>);
});

// ── GET /api/guilds/:guildId/events/:eventId ─────────────────────────────────

eventsRouter.get('/:guildId/events/:eventId', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };

  if (!(await assertEventViewer(req, guildId))) {
    // Allow confirmed attendees from allied guilds (e.g. cross-guild snake draft participants)
    const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (dbUser) {
      const ev = await prisma.event.findUnique({
        where: { id: eventId },
        include: {
          rsvps: true,
          guildShares: { include: { guild: { select: { id: true, guildId: true, name: true } } } },
        },
      });
      if (ev?.confirmedAttendees) {
        const confirmedIds: string[] = JSON.parse(ev.confirmedAttendees);
        if (confirmedIds.includes(dbUser.discordId)) {
          res.json({ success: true, data: toDto(ev) } satisfies ApiResponse<EventDto>);
          return;
        }
      }
    }
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const guild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
  if (!guild) {
    res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
    return;
  }

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
        // Grandfathered: old-style allianceId events that predate EventGuildShare.
        // Excluded when a share record exists (any status) — those must be accepted.
        ...(allianceIds.length > 0
          ? [{ allianceId: { in: allianceIds }, guildShares: { none: { guildId: guild.id } } }]
          : []),
        { guildShares: { some: { guildId: guild.id, status: 'ACCEPTED' } } },
      ],
    },
    include: {
      rsvps: true,
      guildShares: { include: { guild: { select: { id: true, guildId: true, name: true } } } },
    },
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
      if (body.recurEndsAt !== undefined && body.recurEndsAt !== null) {
        const recurEndsAt = new Date(body.recurEndsAt);
        if (isNaN(recurEndsAt.getTime())) throw new ValidationError('recurEndsAt is not a valid date');
      }
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

    // Validate alliance if provided — verify it exists AND the host guild is an ACCEPTED member.
    // Without the membership check any guild that discovers an alliance ID can invite all its
    // members to events, bypassing the access model entirely.
    if (body.allianceId) {
      const alliance = await prisma.alliance.findUnique({ where: { id: body.allianceId } });
      if (!alliance) {
        res.status(400).json({ success: false, error: 'Alliance not found' } satisfies ApiResponse);
        return;
      }
      const hostGuildRecord = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
      const hostMembership = hostGuildRecord
        ? await prisma.allianceMember.findUnique({
            where: { allianceId_guildId: { allianceId: body.allianceId, guildId: hostGuildRecord.id } },
          })
        : null;
      if (!hostMembership || hostMembership.status !== 'ACCEPTED') {
        res.status(403).json({ success: false, error: 'Your guild is not a member of this alliance' } satisfies ApiResponse);
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
        recurEndsAt: body.recurEndsAt ? new Date(body.recurEndsAt) : null,
        roles: JSON.stringify(body.roles ?? []),
        vcNames: JSON.stringify(body.vcNames ?? []),
        briefingChannel: body.briefingChannel ?? false,
        imageUrl: body.imageUrl ?? null,
        pollData: body.poll ? JSON.stringify(body.poll) : null,
        allianceId: body.allianceId ?? null,
        createdById: dbUser.discordId,
        status: 'PENDING',
      },
      include: {
        rsvps: true,
        guildShares: { include: { guild: { select: { id: true, guildId: true, name: true } } } },
      },
    });

    // Create PENDING share invites for alliance members (excluding host guild)
    if (body.allianceId) {
      const hostGuild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
      if (hostGuild) {
        const allianceMembers = await prisma.allianceMember.findMany({
          where: { allianceId: body.allianceId, status: 'ACCEPTED', NOT: { guildId: hostGuild.id } },
          select: { guildId: true },
        });
        if (allianceMembers.length > 0) {
          await prisma.eventGuildShare.createMany({
            data: allianceMembers.map((m) => ({
              eventId: event.id,
              guildId: m.guildId,
              sourceType: 'ALLIANCE' as const,
              allianceId: body.allianceId!,
              status: 'PENDING' as const,
            })),
            skipDuplicates: true,
          });
        }
      }
    }

    // Create PENDING share invites for directly specified guilds
    if (Array.isArray(body.directGuildIds) && body.directGuildIds.length > 0) {
      const hostGuild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
      if (hostGuild) {
        const targetGuilds = await prisma.guild.findMany({
          where: { guildId: { in: body.directGuildIds as string[] }, NOT: { guildId } },
          select: { id: true },
        });
        if (targetGuilds.length > 0) {
          await prisma.eventGuildShare.createMany({
            data: targetGuilds.map((g) => ({
              eventId: event.id,
              guildId: g.id,
              sourceType: 'DIRECT' as const,
              status: 'PENDING' as const,
            })),
            skipDuplicates: true,
          });
        }
      }
    }

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

  // Resolve the requesting guild's DB id for shared-event visibility checks
  const guild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
  if (!guild) {
    res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
    return;
  }

  // Build the same visibility OR clause used by GET /events — supports guest-guild RSVPs
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
        ...(allianceIds.length > 0
          ? [{ allianceId: { in: allianceIds }, guildShares: { none: { guildId: guild.id } } }]
          : []),
        { guildShares: { some: { guildId: guild.id, status: 'ACCEPTED' } } },
      ],
    },
  });
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
    if (!roles.some((r) => r.id === role || r.name === role)) {
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

  // Check before upsert so we can tell the bot whether this is a brand-new join.
  const existingRsvp = await prisma.eventRsvp.findUnique({
    where: { eventId_userId: { eventId, userId: dbUser.discordId } },
    select: { id: true },
  });

  await prisma.eventRsvp.upsert({
    where: { eventId_userId: { eventId, userId: dbUser.discordId } },
    create: { eventId, userId: dbUser.discordId, username: displayName, role },
    update: { role, username: displayName },
  });

  // New join → add to thread + post "👋 joined" embed
  if (!existingRsvp) {
    triggerBot(`/trigger/rsvp-join/${eventId}/${dbUser.discordId}`);
  }
  triggerBot(`/trigger/rsvp/${eventId}`);

  // eventId is the unique PK — guildId check is not needed after we've already verified visibility
  const updated = await prisma.event.findFirstOrThrow({ where: { id: eventId }, include: { rsvps: true } });
  res.json({ success: true, data: toDto(updated) } satisfies ApiResponse<EventDto>);
});

// ── DELETE /api/guilds/:guildId/events/:eventId/rsvp ─────────────────────────

eventsRouter.delete('/:guildId/events/:eventId/rsvp', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };

  if (!(await assertEventViewer(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  // Verify the requesting guild can see this event before allowing the un-RSVP
  const guild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
  if (!guild) {
    res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
    return;
  }

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
        ...(allianceIds.length > 0
          ? [{ allianceId: { in: allianceIds }, guildShares: { none: { guildId: guild.id } } }]
          : []),
        { guildShares: { some: { guildId: guild.id, status: 'ACCEPTED' } } },
      ],
    },
  });
  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
    return;
  }

  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });

  await prisma.eventRsvp.deleteMany({ where: { eventId, userId: dbUser.discordId } });

  triggerBot(`/trigger/rsvp/${eventId}`);

  const updated = await prisma.event.findFirstOrThrow({ where: { id: eventId }, include: { rsvps: true } });
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
  if (body.allianceId !== undefined) data['allianceId'] = body.allianceId || null;
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
  if (body.recurEndsAt !== undefined) {
    const recurEndsAt = body.recurEndsAt ? new Date(body.recurEndsAt) : null;
    if (recurEndsAt && isNaN(recurEndsAt.getTime())) {
      res.status(400).json({ success: false, error: 'recurEndsAt is not a valid date' } satisfies ApiResponse);
      return;
    }
    data['recurEndsAt'] = recurEndsAt;
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

  // Validate alliance membership before committing the update.
  // Same check as POST: the host guild must be an ACCEPTED member of the target alliance.
  if (body.allianceId && body.allianceId !== event.allianceId) {
    const allianceForPatch = await prisma.alliance.findUnique({ where: { id: body.allianceId } });
    if (!allianceForPatch) {
      res.status(400).json({ success: false, error: 'Alliance not found' } satisfies ApiResponse);
      return;
    }
    const hostGuildForPatch = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
    const patchMembership = hostGuildForPatch
      ? await prisma.allianceMember.findUnique({
          where: { allianceId_guildId: { allianceId: body.allianceId, guildId: hostGuildForPatch.id } },
        })
      : null;
    if (!patchMembership || patchMembership.status !== 'ACCEPTED') {
      res.status(403).json({ success: false, error: 'Your guild is not a member of this alliance' } satisfies ApiResponse);
      return;
    }
  }

  const updated = await prisma.event.update({
    where: { id: eventId },
    data,
    include: {
      rsvps: true,
      guildShares: { include: { guild: { select: { id: true, guildId: true, name: true } } } },
    },
  });

  // If allianceId changed (including removed to null), delete unanswered invites from the old
  // alliance so guilds don't see stale pending notifications after the event moves alliances.
  //   • PENDING   → deleted   (no response yet — nothing to preserve; deleting lets the guild
  //                            receive a fresh invite if it is also in the new alliance)
  //   • DECLINED  → preserved (guild explicitly opted out — don't reinvite automatically)
  //   • ACCEPTED  → preserved (guild is actively participating — revoke explicitly via DELETE)
  const newAllianceId = body.allianceId !== undefined ? (body.allianceId || null) : undefined;
  if (newAllianceId !== undefined && event.allianceId && newAllianceId !== event.allianceId) {
    const deleted = await prisma.eventGuildShare.deleteMany({
      where: { eventId, status: 'PENDING', sourceType: 'ALLIANCE', allianceId: event.allianceId },
    });
    if (deleted.count > 0) {
      console.log(`[PATCH event] Removed ${deleted.count} unanswered invite(s) for old alliance ${event.allianceId} on event ${eventId}`);
    }
  }

  // If allianceId was set to a new value, create PENDING shares for that alliance's members.
  // skipDuplicates handles guilds that previously DECLINED (unique constraint preserves their row).
  if (body.allianceId && body.allianceId !== event.allianceId) {
    const hostGuild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
    if (hostGuild) {
      const allianceMembers = await prisma.allianceMember.findMany({
        where: { allianceId: body.allianceId, status: 'ACCEPTED', NOT: { guildId: hostGuild.id } },
        select: { guildId: true },
      });
      if (allianceMembers.length > 0) {
        await prisma.eventGuildShare.createMany({
          data: allianceMembers.map((m) => ({
            eventId,
            guildId: m.guildId,
            sourceType: 'ALLIANCE' as const,
            allianceId: body.allianceId!,
            status: 'PENDING' as const,
          })),
          skipDuplicates: true,
        });
      }
    }
  }

  triggerBot(`/trigger/sync/${eventId}`);
  res.json({ success: true, data: toDto(updated) } satisfies ApiResponse<EventDto>);
});

// ── PATCH /api/guilds/:guildId/events/:eventId/rsvp/:userId (event creator reassign) ─

eventsRouter.patch('/:guildId/events/:eventId/rsvp/:userId', requireAuth, async (req, res) => {
  const { guildId, eventId, userId } = req.params as { guildId: string; eventId: string; userId: string };

  if (!(await assertEventCreator(req, guildId))) {
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
    if (!roles.some((r) => r.id === role || r.name === role)) {
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
  const { eventId } = req.params as { guildId: string; eventId: string };

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
    return;
  }

  if (!(await assertGuildManager(req, event.guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
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
  const { eventId } = req.params as { guildId: string; eventId: string };

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
    return;
  }

  if (!(await assertGuildManager(req, event.guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
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
  const { eventId } = req.params as { guildId: string; eventId: string };

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) { res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse); return; }

  if (!(await assertGuildManager(req, event.guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }
  if (event.status === 'COMPLETED' || event.status === 'ENDED') {
    res.status(409).json({ success: false, error: 'Event is already over' } satisfies ApiResponse); return;
  }

  triggerBot(`/trigger/create-vcs/${eventId}`);
  res.json({ success: true, message: 'VC creation queued' } satisfies ApiResponse);
});

// ── POST /api/guilds/:guildId/events/:eventId/complete ────────────────────────

eventsRouter.post('/:guildId/events/:eventId/complete', requireAuth, async (req, res) => {
  const { eventId } = req.params as { guildId: string; eventId: string };

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
    return;
  }

  if (!(await assertGuildManager(req, event.guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
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

  // Expire all PENDING shares — event is over, can no longer accept
  await prisma.eventGuildShare.updateMany({
    where: { eventId, status: 'PENDING' },
    data: { status: 'DECLINED', respondedAt: new Date() },
  });

  triggerBot(`/trigger/complete/${eventId}`);

  res.json({ success: true, message: 'Event completed' } satisfies ApiResponse);
});

// ── POST /api/guilds/:guildId/events/:eventId/reopen ─────────────────────────

eventsRouter.post('/:guildId/events/:eventId/reopen', requireAuth, async (req, res) => {
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
  if (event.status !== 'COMPLETED') {
    res.status(409).json({ success: false, error: 'Only completed events can be re-opened' } satisfies ApiResponse);
    return;
  }

  // Restore event to ENDED so managers can act on it again
  await prisma.event.update({ where: { id: eventId }, data: { status: 'ENDED' } });

  // Re-open loot session if one exists — roster (EventRsvp) records are untouched
  await prisma.lootSession.updateMany({
    where: { eventId, status: 'COMPLETED' },
    data: { status: 'OPEN' },
  });

  triggerBot(`/trigger/sync/${eventId}`);

  res.json({ success: true, message: 'Event re-opened' } satisfies ApiResponse);
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

function toShareDto(
  s: EventWithRsvpsAndShares['guildShares'][number],
): EventGuildShareDto {
  return {
    id: s.id,
    eventId: s.eventId,
    guildId: s.guild.id,
    guildDiscordId: s.guild.guildId,
    guildName: s.guild.name,
    sourceType: s.sourceType as 'ALLIANCE' | 'DIRECT',
    allianceId: s.allianceId,
    status: s.status as 'PENDING' | 'ACCEPTED' | 'DECLINED',
    invitedAt: s.invitedAt.toISOString(),
    respondedAt: s.respondedAt?.toISOString() ?? null,
  };
}

function toDto(event: EventWithRsvpsAndShares | EventWithRsvps): EventDto {
  const withShares = event as EventWithRsvpsAndShares;
  return {
    id: event.id,
    guildId: event.guildId,
    name: event.name,
    description: event.description,
    musterPoint: event.musterPoint,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime?.toISOString() ?? null,
    recurType: event.recurType,
    recurEndsAt: event.recurEndsAt?.toISOString() ?? null,
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
    shares: withShares.guildShares ? withShares.guildShares.map(toShareDto) : [],
  };
}

// ── Share routes ──────────────────────────────────────────────────────────────

// POST /api/guilds/:guildId/events/:eventId/shares/direct
// Host invites a single guild by Discord guild ID.
eventsRouter.post('/:guildId/events/:eventId/shares/direct', requireAuth, async (req, res) => {
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

  const { targetDiscordGuildId } = req.body as { targetDiscordGuildId?: string };
  if (!targetDiscordGuildId) {
    res.status(400).json({ success: false, error: 'targetDiscordGuildId is required' } satisfies ApiResponse);
    return;
  }

  const target = await prisma.guild.findUnique({
    where: { guildId: targetDiscordGuildId },
    select: { id: true, guildId: true, name: true },
  });
  if (!target) {
    res.status(404).json({ success: false, error: 'Target guild not found' } satisfies ApiResponse);
    return;
  }
  if (target.guildId === guildId) {
    res.status(400).json({ success: false, error: 'Cannot invite your own guild' } satisfies ApiResponse);
    return;
  }

  // Upsert: create if not exists; if DECLINED, re-invite (reset to PENDING)
  const existing = await prisma.eventGuildShare.findUnique({
    where: { eventId_guildId: { eventId, guildId: target.id } },
  });

  if (existing && existing.status === 'PENDING') {
    res.status(409).json({ success: false, error: 'Invite already pending for this guild' } satisfies ApiResponse);
    return;
  }
  if (existing && existing.status === 'ACCEPTED') {
    res.status(409).json({ success: false, error: 'Guild has already accepted this event' } satisfies ApiResponse);
    return;
  }

  const share = await prisma.eventGuildShare.upsert({
    where: { eventId_guildId: { eventId, guildId: target.id } },
    create: { eventId, guildId: target.id, sourceType: 'DIRECT', status: 'PENDING' },
    update: { status: 'PENDING', respondedAt: null, invitedAt: new Date() },
    include: { guild: { select: { id: true, guildId: true, name: true } } },
  });

  res.status(201).json({ success: true, data: toShareDto(share) } satisfies ApiResponse<EventGuildShareDto>);
});

// POST /api/guilds/:guildId/events/:eventId/shares/alliance
// Host invites all ACCEPTED members of an alliance. Skips any already-invited guilds.
eventsRouter.post('/:guildId/events/:eventId/shares/alliance', requireAuth, async (req, res) => {
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

  const { allianceId } = req.body as { allianceId?: string };
  if (!allianceId) {
    res.status(400).json({ success: false, error: 'allianceId is required' } satisfies ApiResponse);
    return;
  }

  const hostGuild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
  if (!hostGuild) {
    res.status(404).json({ success: false, error: 'Host guild not found' } satisfies ApiResponse);
    return;
  }

  // Verify the host guild is an ACCEPTED member of the alliance.
  // Without this check any guild could invite all members of any alliance they discovered.
  const hostAllianceMembership = await prisma.allianceMember.findUnique({
    where: { allianceId_guildId: { allianceId, guildId: hostGuild.id } },
  });
  if (!hostAllianceMembership || hostAllianceMembership.status !== 'ACCEPTED') {
    res.status(403).json({ success: false, error: 'Your guild is not a member of this alliance' } satisfies ApiResponse);
    return;
  }

  const allianceMembers = await prisma.allianceMember.findMany({
    where: { allianceId, status: 'ACCEPTED', NOT: { guildId: hostGuild.id } },
    select: { guildId: true },
  });

  if (allianceMembers.length === 0) {
    res.status(200).json({ success: true, data: { created: 0 } } satisfies ApiResponse);
    return;
  }

  // Only create for guilds that don't already have any share (PENDING/ACCEPTED/DECLINED)
  const existingShares = await prisma.eventGuildShare.findMany({
    where: { eventId, guildId: { in: allianceMembers.map((m) => m.guildId) } },
    select: { guildId: true },
  });
  const existingGuildIds = new Set(existingShares.map((s) => s.guildId));
  const toCreate = allianceMembers.filter((m) => !existingGuildIds.has(m.guildId));

  if (toCreate.length > 0) {
    await prisma.eventGuildShare.createMany({
      data: toCreate.map((m) => ({
        eventId,
        guildId: m.guildId,
        sourceType: 'ALLIANCE' as const,
        allianceId,
        status: 'PENDING' as const,
      })),
    });
    // Always update event.allianceId to reflect the most recently used alliance.
    // The old `if (!event.allianceId)` guard caused stale data when an organiser called
    // this route with Alliance A and then again with Alliance B — the allianceId would
    // remain stuck on A even though B's invites were sent.
    await prisma.event.update({ where: { id: eventId }, data: { allianceId } });
  }

  res.json({ success: true, data: { created: toCreate.length } } satisfies ApiResponse);
});

// DELETE /api/guilds/:guildId/events/:eventId/shares/:shareId
// Host cancels / revokes a pending invite.
eventsRouter.delete('/:guildId/events/:eventId/shares/:shareId', requireAuth, async (req, res) => {
  const { guildId, eventId, shareId } = req.params as { guildId: string; eventId: string; shareId: string };

  if (!(await assertEventCreator(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const event = await prisma.event.findFirst({ where: { id: eventId, guildId } });
  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
    return;
  }

  const share = await prisma.eventGuildShare.findFirst({ where: { id: shareId, eventId } });
  if (!share) {
    res.status(404).json({ success: false, error: 'Share not found' } satisfies ApiResponse);
    return;
  }

  if (share.status === 'ACCEPTED') {
    // Soft-revoke: keep the record so the bot trigger can look up the guild for cleanup.
    // The DECLINED status immediately removes the guild's read access (GET queries filter
    // on status: ACCEPTED). The bot will archive their thread and delete their scheduled event.
    await prisma.eventGuildShare.update({
      where: { id: shareId },
      data: { status: 'DECLINED', respondedAt: new Date() },
    });
    triggerBot(`/trigger/share-revoked/${shareId}`);
  } else {
    // PENDING or DECLINED — no Discord artifacts exist yet; hard delete is safe.
    await prisma.eventGuildShare.delete({ where: { id: shareId } });
  }

  res.json({ success: true } satisfies ApiResponse);
});

// PATCH /api/guilds/:guildId/events/:eventId/shares/:shareId/reinvite
// Host re-invites a guild that previously declined.
eventsRouter.patch('/:guildId/events/:eventId/shares/:shareId/reinvite', requireAuth, async (req, res) => {
  const { guildId, eventId, shareId } = req.params as { guildId: string; eventId: string; shareId: string };

  if (!(await assertEventCreator(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const event = await prisma.event.findFirst({ where: { id: eventId, guildId } });
  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
    return;
  }

  const share = await prisma.eventGuildShare.findFirst({ where: { id: shareId, eventId } });
  if (!share) {
    res.status(404).json({ success: false, error: 'Share not found' } satisfies ApiResponse);
    return;
  }
  if (share.status !== 'DECLINED') {
    res.status(409).json({ success: false, error: 'Can only re-invite a declined share' } satisfies ApiResponse);
    return;
  }

  const updated = await prisma.eventGuildShare.update({
    where: { id: shareId },
    data: { status: 'PENDING', respondedAt: null, invitedAt: new Date() },
    include: { guild: { select: { id: true, guildId: true, name: true } } },
  });

  res.json({ success: true, data: toShareDto(updated) } satisfies ApiResponse<EventGuildShareDto>);
});

// PATCH /api/guilds/:guildId/events/:eventId/shares/respond
// Receiving guild accepts or declines an invite.
eventsRouter.patch('/:guildId/events/:eventId/shares/respond', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const { action } = req.body as { action?: 'accept' | 'decline' };
  if (action !== 'accept' && action !== 'decline') {
    res.status(400).json({ success: false, error: 'action must be "accept" or "decline"' } satisfies ApiResponse);
    return;
  }

  const guild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
  if (!guild) {
    res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
    return;
  }

  const share = await prisma.eventGuildShare.findUnique({
    where: { eventId_guildId: { eventId, guildId: guild.id } },
  });
  if (!share) {
    res.status(404).json({ success: false, error: 'Invite not found' } satisfies ApiResponse);
    return;
  }
  if (share.status !== 'PENDING') {
    res.status(409).json({ success: false, error: 'Invite is no longer pending' } satisfies ApiResponse);
    return;
  }

  const newStatus = action === 'accept' ? 'ACCEPTED' : 'DECLINED';
  const updated = await prisma.eventGuildShare.update({
    where: { id: share.id },
    data: { status: newStatus, respondedAt: new Date() },
    include: { guild: { select: { id: true, guildId: true, name: true } } },
  });

  if (action === 'accept') {
    // Notify bot to post the event to this guild's Discord
    triggerBot(`/trigger/share-accepted/${share.id}`);
  }

  res.json({ success: true, data: toShareDto(updated) } satisfies ApiResponse<EventGuildShareDto>);
});
