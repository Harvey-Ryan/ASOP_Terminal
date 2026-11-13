import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { assertEventCreator } from '../../lib/assertEventCreator.js';
import { assertEventViewer } from '../../lib/assertEventViewer.js';
import { triggerBot } from '../../lib/triggerBot.js';
import { WAITLIST_ORDER, announceWaitlistMoves, carryRoleChanges, fillFromWaitlist, lockEvent } from '../../lib/waitlist.js';
import { hasAnyRole } from '../../lib/memberRoles.js';
import { getGuildMember } from '../../lib/discordRest.js';
import { createPlannedShares, notAllyError, notifyShare, planEventShares } from '../../lib/allyShares.js';
import { ValidationError, requireStr, optStr, optEnum, optStrArr } from '../../lib/validate.js';
import type { AfterActionOutcome, ApiResponse, CreateEventBody, EventDto, EventGuildShareDto, EventPoll, EventRole, EventTemplateDto } from '@dem/shared';
import { RECUR_TYPES, isValidTimeZone, describeRecurrence, roleSignupProblem, ROLE_SIGNUP_MESSAGES, WAITLIST_MESSAGES, canComment, findRole, roleKeyOf, serverLabel, waitlistProblem } from '@dem/shared';


/** Discord id of the signed-in user (who answered, for the Discord notices). */
async function sessionDiscordId(req: Express.Request): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: req.session.userId! }, select: { discordId: true } });
  return u?.discordId ?? null;
}

export const eventsRouter = Router();

type EventWithRsvpsAndShares = Prisma.EventGetPayload<{
  include: {
    rsvps: true;
    waitlist: true;
    comments: true;
    guildShares: { include: { guild: { select: { id: true; guildId: true; name: true } } } };
  };
}>;

// kept for routes that don't need shares (e.g. RSVP updates)
type EventWithRsvps = Prisma.EventGetPayload<{ include: { rsvps: true; waitlist: true; comments: true } }>;

/** Comments under after-action notes, oldest first (v1.19.0). */
const COMMENT_ORDER = { orderBy: { id: 'asc' } } as const;

// Repeat types and their scheduling rules live in packages/shared/src/recurrence.ts.
// An event is finished (no RSVPs, edits, starts) once it's ended, completed or cancelled.
const CLOSED_STATUSES = ['COMPLETED', 'CANCELLED'] as const;

/** The guild's configured time zone (Settings), used when the organiser's isn't known. */
async function guildTimezone(discordGuildId: string): Promise<string> {
  const g = await prisma.guild.findUnique({
    where: { guildId: discordGuildId },
    select: { settings: { select: { timezone: true } } },
  });
  const tz = g?.settings?.timezone;
  return tz && isValidTimeZone(tz) ? tz : 'UTC';
}

// ── GET /api/guilds/:guildId/events ───────────────────────────────────────────

/** Events per page. A full page means there may be more (?after=). */
export const EVENTS_PAGE = 50;

eventsRouter.get('/:guildId/events', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const completed = req.query['completed'] === 'true';
  const after = typeof req.query['after'] === 'string' ? req.query['after'] : null;

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

    const statusFilter = completed
      ? { status: { in: [...CLOSED_STATUSES] } }
      : { status: { notIn: [...CLOSED_STATUSES] } };

    const events = await prisma.event.findMany({
      where: {
        ...statusFilter,
        OR: [
          { guildId },
          // Shared with this server and accepted (EventGuildShare)
          { guildShares: { some: { guildId: guild.id, status: 'ACCEPTED' } } },
        ],
      },
      // id breaks ties, so paging past events with the same start never skips one.
      orderBy: [{ startTime: completed ? 'desc' : 'asc' }, { id: 'asc' }],
      take: EVENTS_PAGE,
      // ?after=<id of the last event shown>: the next page (Completed's Show more, v1.12.0).
      ...(completed && after ? { cursor: { id: after }, skip: 1 } : {}),
      include: {
        rsvps: true,
        waitlist: WAITLIST_ORDER,
        comments: COMMENT_ORDER,
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
      status: { notIn: [...CLOSED_STATUSES] },
      guildShares: { some: { guildId: guild.id, status: 'PENDING' } },
    },
    orderBy: { startTime: 'asc' },
    include: {
      rsvps: true,
      waitlist: WAITLIST_ORDER,
      comments: COMMENT_ORDER,
      guildShares: { include: { guild: { select: { id: true, guildId: true, name: true } } } },
    },
  });

  const hosts = await prisma.guild.findMany({
    where: { guildId: { in: [...new Set(events.map((e) => e.guildId))] } },
    select: { guildId: true, name: true },
  });
  const hostName = new Map(hosts.map((h) => [h.guildId, h.name]));
  res.json({
    success: true,
    data: events.map((e) => ({ ...toDto(e), hostGuildName: hostName.get(e.guildId) ?? null })),
  } satisfies ApiResponse<EventDto[]>);
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
          waitlist: WAITLIST_ORDER,
          comments: COMMENT_ORDER,
          guildShares: { include: { guild: { select: { id: true, guildId: true, name: true } } } },
        },
      });
      if (ev?.confirmedAttendees) {
        const confirmedIds: string[] = JSON.parse(ev.confirmedAttendees);
        if (confirmedIds.includes(dbUser.discordId)) {
          res.json({ success: true, data: await withServerTags(toDto(ev)) } satisfies ApiResponse<EventDto>);
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

  const event = await prisma.event.findFirst({
    where: {
      id: eventId,
      OR: [
        { guildId },
        { guildShares: { some: { guildId: guild.id, status: 'ACCEPTED' } } },
      ],
    },
    include: {
      rsvps: true,
      waitlist: WAITLIST_ORDER,
      comments: COMMENT_ORDER,
      guildShares: { include: { guild: { select: { id: true, guildId: true, name: true } } } },
    },
  });

  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
    return;
  }

  res.json({ success: true, data: await withServerTags(toDto(event)) } satisfies ApiResponse<EventDto>);
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

      // Cached, rate-limit-aware lookup (lib/discordRest.ts).
      const hasPermission = await hasAnyRole(req, guildId, allowedRoles);

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
      if (body.recurTimezone !== undefined && !isValidTimeZone(body.recurTimezone))
        throw new ValidationError('recurTimezone is not a valid time zone');
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

    // Only allies can receive the event; check before anything is created.
    const shareTargets = Array.isArray(body.directGuildIds) ? (body.directGuildIds as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const hostRecord = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
    const sharePlan = shareTargets.length > 0 && hostRecord ? await planEventShares(hostRecord.id, shareTargets) : null;
    if (shareTargets.length > 0 && (!sharePlan || sharePlan.notAllies.length > 0)) {
      res.status(403).json({
        success: false,
        error: sharePlan ? notAllyError(sharePlan) : 'Set up this server on ASOP before sharing events.',
      } satisfies ApiResponse);
      return;
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
        // The series is anchored to its first occurrence, in the organiser's time zone.
        recurAnchor: body.recurType ? startTime : null,
        recurTimezone: body.recurType ? (body.recurTimezone ?? (await guildTimezone(guildId))) : null,
        roles: JSON.stringify(body.roles ?? []),
        vcNames: JSON.stringify(body.vcNames ?? []),
        briefingChannel: body.briefingChannel ?? false,
        imageUrl: body.imageUrl ?? null,
        pollData: body.poll ? JSON.stringify(body.poll) : null,
        createdById: dbUser.discordId,
        status: 'PENDING',
      },
      include: {
        rsvps: true,
        waitlist: WAITLIST_ORDER,
        comments: COMMENT_ORDER,
        guildShares: { include: { guild: { select: { id: true, guildId: true, name: true } } } },
      },
    });

    // Share with allies: posted straight away for allies that post automatically,
    // an invitation for the rest. Rules: planShares in packages/shared/src/allies.ts.
    if (sharePlan && hostRecord) await createPlannedShares(event.id, hostRecord.id, sharePlan);

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

/**
 * The open event someone is signing up to from this server (theirs or shared
 * with it), with who they are and their name there. Answers the error itself
 * and returns null when they can't.
 */
async function signupContext(req: Request, res: Response) {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };

  if (!(await assertEventViewer(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return null;
  }

  // Resolve the requesting guild's DB id for shared-event visibility checks
  const guild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
  if (!guild) {
    res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
    return null;
  }

  const event = await prisma.event.findFirst({
    where: {
      id: eventId,
      OR: [
        { guildId },
        { guildShares: { some: { guildId: guild.id, status: 'ACCEPTED' } } },
      ],
    },
  });
  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
    return null;
  }
  if (event.status === 'COMPLETED' || event.status === 'ENDED' || event.status === 'CANCELLED') {
    res.status(409).json({ success: false, error: 'Cannot RSVP to a completed, ended or cancelled event' } satisfies ApiResponse);
    return null;
  }

  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });

  // Server nickname when Discord can give it without waiting (cached, lib/discordRest.ts).
  let displayName = dbUser.globalName ?? dbUser.username;
  if (process.env['DISCORD_TOKEN']) {
    const m = await getGuildMember(guildId, dbUser.discordId, { maxWaitMs: 0 });
    if (m.status === 'member') displayName = m.member.nick ?? m.member.user.global_name ?? displayName;
  }
  return { guildId, eventId, event, dbUser, displayName };
}

const eventDto = async (eventId: string) =>
  withServerTags(toDto(await prisma.event.findFirstOrThrow({ where: { id: eventId }, include: { rsvps: true, waitlist: WAITLIST_ORDER, comments: COMMENT_ORDER } })));

/**
 * Joint ops (v1.20.0): on an event shared with allies, each taking-part
 * server's tag (ally tag, else name), so the roster shows who's from where.
 */
async function withServerTags(dto: EventDto): Promise<EventDto> {
  const shares = await prisma.eventGuildShare.findMany({ where: { eventId: dto.id, status: 'ACCEPTED' }, select: { guild: { select: { guildId: true } } } });
  if (shares.length === 0) return dto;
  const ids = [dto.guildId, ...shares.map((s) => s.guild.guildId)];
  const guilds = await prisma.guild.findMany({ where: { guildId: { in: ids } }, select: { guildId: true, name: true, settings: { select: { allianceTag: true } } } });
  const serverTags = Object.fromEntries(ids.map((id) => {
    const g = guilds.find((x) => x.guildId === id);
    return [id, serverLabel(g?.settings?.allianceTag, g?.name)];
  }));
  return { ...dto, serverTags };
}

eventsRouter.put('/:guildId/events/:eventId/rsvp', requireAuth, async (req, res) => {
  const ctx = await signupContext(req, res);
  if (!ctx) return;
  const { guildId, eventId, dbUser, displayName } = ctx;
  const body = req.body as { role?: string | null; tentative?: unknown };
  const role = body.role ?? null;
  // "Maybe" (v1.17.0): on the roster without a role, so it never takes a slot.
  const tentative = role === null && body.tentative === true;

  // Check before upsert so we can tell the bot whether this is a brand-new join.
  const existingRsvp = await prisma.eventRsvp.findUnique({
    where: { eventId_userId: { eventId, userId: dbUser.discordId } },
    select: { id: true },
  });

  // Role limits are checked while holding the event row, so two people (here or
  // on the Discord buttons, which do the same) can't both take the last slot (v1.12.0).
  // Leaving a role lets the first person waiting for it in (v1.14.0).
  const { problem, moves } = await prisma.$transaction(async (tx) => {
    const locked = (await lockEvent(tx, eventId))!;
    if (role !== null) {
      const rsvps = await tx.eventRsvp.findMany({ where: { eventId }, select: { userId: true, role: true } });
      const why = roleSignupProblem(JSON.parse(locked.roles) as EventRole[], rsvps, role, dbUser.discordId, guildId);
      if (why) return { problem: why, moves: [] };
    }
    await tx.eventRsvp.upsert({
      where: { eventId_userId: { eventId, userId: dbUser.discordId } },
      create: { eventId, userId: dbUser.discordId, username: displayName, role, tentative, guildId },
      update: { role, username: displayName, tentative, guildId },
    });
    // A maybe isn't waiting for a role (joining a line means you're coming).
    if (tentative) await tx.eventWaitlist.deleteMany({ where: { eventId, userId: dbUser.discordId } });
    return { problem: null, moves: await fillFromWaitlist(tx, eventId, locked) };
  });
  if (problem) {
    res.status(problem === 'full' ? 409 : 400).json({ success: false, error: ROLE_SIGNUP_MESSAGES[problem] } satisfies ApiResponse);
    return;
  }
  announceWaitlistMoves(eventId, moves);

  // New join → add to thread + post "👋 joined" embed
  if (!existingRsvp) {
    triggerBot(`/trigger/rsvp-join/${eventId}/${dbUser.discordId}`);
  }
  triggerBot(`/trigger/rsvp/${eventId}`);

  res.json({ success: true, data: await eventDto(eventId) } satisfies ApiResponse<EventDto>);
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

  const event = await prisma.event.findFirst({
    where: {
      id: eventId,
      OR: [
        { guildId },
        { guildShares: { some: { guildId: guild.id, status: 'ACCEPTED' } } },
      ],
    },
  });
  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
    return;
  }

  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });

  const moves = await prisma.$transaction(async (tx) => {
    const locked = await lockEvent(tx, eventId);
    await tx.eventRsvp.deleteMany({ where: { eventId, userId: dbUser.discordId } });
    return locked ? fillFromWaitlist(tx, eventId, locked) : [];
  });
  announceWaitlistMoves(eventId, moves);

  triggerBot(`/trigger/rsvp/${eventId}`);

  const updated = await prisma.event.findFirstOrThrow({ where: { id: eventId }, include: { rsvps: true, waitlist: WAITLIST_ORDER, comments: COMMENT_ORDER } });
  res.json({ success: true, data: toDto(updated) } satisfies ApiResponse<EventDto>);
});

// ── PUT / DELETE /api/guilds/:guildId/events/:eventId/waitlist (v1.14.0) ─────
// Wait for a slot in a full role, keeping your current one. Joining puts you on
// the roster (Unassigned) if you weren't; one line at a time per event, so
// waiting for another role moves you to the back of that one.

eventsRouter.put('/:guildId/events/:eventId/waitlist', requireAuth, async (req, res) => {
  const ctx = await signupContext(req, res);
  if (!ctx) return;
  const { guildId, eventId, dbUser, displayName } = ctx;
  const role = (req.body as { role?: unknown }).role;
  if (typeof role !== 'string' || !role) {
    res.status(400).json({ success: false, error: 'role is required' } satisfies ApiResponse);
    return;
  }
  const userId = dbUser.discordId;

  const result = await prisma.$transaction(async (tx) => {
    const locked = (await lockEvent(tx, eventId))!;
    const roles = JSON.parse(locked.roles) as EventRole[];
    const rsvps = await tx.eventRsvp.findMany({ where: { eventId }, select: { userId: true, role: true } });
    const why = waitlistProblem(roles, rsvps, role, userId, guildId);
    if (why) return { why };
    const key = roleKeyOf(findRole(roles, role)!);
    const joined = !rsvps.some((r) => r.userId === userId);
    if (joined) await tx.eventRsvp.create({ data: { eventId, userId, username: displayName, role: null, guildId } });
    else await tx.eventRsvp.updateMany({ where: { eventId, userId, tentative: true }, data: { tentative: false } }); // joining a line means you're coming
    const current = await tx.eventWaitlist.findUnique({ where: { eventId_userId: { eventId, userId } } });
    if (current?.role !== key) {
      if (current) await tx.eventWaitlist.delete({ where: { id: current.id } });
      await tx.eventWaitlist.create({ data: { eventId, userId, role: key, guildId } });
    }
    return { joined };
  });
  if ('why' in result) {
    res.status(result.why === 'unknown' || result.why === 'other-server' ? 400 : 409)
      .json({ success: false, error: WAITLIST_MESSAGES[result.why!] } satisfies ApiResponse);
    return;
  }

  if (result.joined) triggerBot(`/trigger/rsvp-join/${eventId}/${userId}`);
  triggerBot(`/trigger/rsvp/${eventId}`);
  res.json({ success: true, data: await eventDto(eventId) } satisfies ApiResponse<EventDto>);
});

eventsRouter.delete('/:guildId/events/:eventId/waitlist', requireAuth, async (req, res) => {
  const ctx = await signupContext(req, res);
  if (!ctx) return;
  await prisma.eventWaitlist.deleteMany({ where: { eventId: ctx.eventId, userId: ctx.dbUser.discordId } });
  triggerBot(`/trigger/rsvp/${ctx.eventId}`);
  res.json({ success: true, data: await eventDto(ctx.eventId) } satisfies ApiResponse<EventDto>);
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
  if (event.status === 'COMPLETED' || event.status === 'CANCELLED') {
    res.status(409).json({ success: false, error: `${event.status === 'CANCELLED' ? 'Cancelled' : 'Completed'} events cannot be edited` } satisfies ApiResponse);
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
  if (body.recurEndsAt !== undefined) {
    const recurEndsAt = body.recurEndsAt ? new Date(body.recurEndsAt) : null;
    if (recurEndsAt && isNaN(recurEndsAt.getTime())) {
      res.status(400).json({ success: false, error: 'recurEndsAt is not a valid date' } satisfies ApiResponse);
      return;
    }
    data['recurEndsAt'] = recurEndsAt;
  }
  if (body.recurTimezone !== undefined && !isValidTimeZone(body.recurTimezone)) {
    res.status(400).json({ success: false, error: 'recurTimezone is not a valid time zone' } satisfies ApiResponse);
    return;
  }
  // Moving a repeating event re-anchors the series to the new date and time, in
  // the time zone of whoever moved it (that's also how an organiser fixes a series
  // that drifted). Edits that keep the same start leave the series alone.
  const moved = data['startTime'] instanceof Date && data['startTime'].getTime() !== event.startTime.getTime();
  if (event.recurType && moved) {
    data['recurAnchor'] = data['startTime'];
    if (body.recurTimezone !== undefined) data['recurTimezone'] = body.recurTimezone;
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

  // Role changes happen with the event row held: people in a removed role go to
  // Unassigned, and new slots let people in off the waitlist (v1.14.0).
  const { updated, moves } = await prisma.$transaction(async (tx) => {
    const locked = await lockEvent(tx, eventId);
    if (body.roles !== undefined && locked) await carryRoleChanges(tx, eventId, JSON.parse(locked.roles) as EventRole[], body.roles);
    await tx.event.update({ where: { id: eventId }, data });
    const moves = body.roles !== undefined && locked
      ? await fillFromWaitlist(tx, eventId, { roles: data['roles'] as string, status: locked.status })
      : [];
    const updated = await tx.event.findUniqueOrThrow({
      where: { id: eventId },
      include: {
        rsvps: true,
        waitlist: WAITLIST_ORDER,
        comments: COMMENT_ORDER,
        guildShares: { include: { guild: { select: { id: true, guildId: true, name: true } } } },
      },
    });
    return { updated, moves };
  });
  announceWaitlistMoves(eventId, moves);

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

  const body = req.body as { role?: string | null; tentative?: unknown };
  const role = body.role ?? null;
  const tentative = role === null && body.tentative === true; // officers can move people to Maybe too

  // Only the host server's events (unassigning used to skip this check).
  const event = await prisma.event.findFirst({ where: { id: eventId, guildId } });
  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
    return;
  }
  if (role !== null && !(JSON.parse(event.roles) as EventRole[]).some((r) => r.id === role || r.name === role)) {
    res.status(400).json({ success: false, error: 'Invalid role' } satisfies ApiResponse);
    return;
  }

  // Officers can place people beyond a role's limit; moving someone out lets the next in line in.
  const moves = await prisma.$transaction(async (tx) => {
    const locked = await lockEvent(tx, eventId);
    await tx.eventRsvp.updateMany({ where: { eventId, userId }, data: { role, tentative } });
    if (tentative) await tx.eventWaitlist.deleteMany({ where: { eventId, userId } });
    return locked ? fillFromWaitlist(tx, eventId, locked) : [];
  });
  announceWaitlistMoves(eventId, moves);
  triggerBot(`/trigger/rsvp/${eventId}`);

  const updated = await prisma.event.findFirstOrThrow({ where: { id: eventId, guildId }, include: { rsvps: true, waitlist: WAITLIST_ORDER, comments: COMMENT_ORDER } });
  res.json({ success: true, data: toDto(updated) } satisfies ApiResponse<EventDto>);
});

// ── POST /api/guilds/:guildId/events/:eventId/stop-recurrence ─────────────────
// Stops a repeating event. The series is carried by its upcoming occurrence
// (the bot creates the next one when the current one ends), so:
//   - upcoming (PENDING): cancelled too, and its Discord thread / scheduled
//     event / reminders / alliance copies are cleaned up by the bot
//   - running or ended: it finishes normally; no further occurrence is created

eventsRouter.post('/:guildId/events/:eventId/stop-recurrence', requireAuth, async (req, res) => {
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
  if (!event.recurType) {
    res.status(409).json({ success: false, error: 'This event is not repeating' } satisfies ApiResponse);
    return;
  }

  const cancel = event.status === 'PENDING';
  await prisma.$transaction(async (tx) => {
    await tx.event.update({
      where: { id: eventId },
      data: { recurType: null, ...(cancel ? { status: 'CANCELLED' } : {}) },
    });
    if (cancel) {
      await tx.eventReminder.deleteMany({ where: { eventId, sent: false } });
      await tx.eventGuildShare.updateMany({
        where: { eventId, status: 'PENDING' },
        data: { status: 'DECLINED', respondedAt: new Date() },
      });
    }
  });
  if (cancel) triggerBot(`/trigger/cancel/${eventId}`);

  const updated = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    include: { rsvps: true, waitlist: WAITLIST_ORDER, comments: COMMENT_ORDER, guildShares: { include: { guild: { select: { id: true, guildId: true, name: true } } } } },
  });
  res.json({ success: true, data: { ...toDto(updated), cancelled: cancel } } satisfies ApiResponse<EventDto & { cancelled: boolean }>);
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
  if (event.status === 'COMPLETED' || event.status === 'ENDED' || event.status === 'CANCELLED') {
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
  const body = req.body as { hadLoot?: unknown; lootNotes?: unknown; confirmedAttendees?: unknown; afterAction?: unknown };
  let afterAction: { aarOutcome: string | null; aarNotes: string | null } | null = null;
  try {
    if (body.afterAction !== undefined) afterAction = parseAfterAction(body.afterAction);
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
      ...(afterAction && (afterAction.aarOutcome || afterAction.aarNotes) ? { ...afterAction, ...(await afterActionBy(req)) } : {}),
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

// ── After-action notes and comments (v1.19.0) ───────────────────────────────

const AFTER_ACTION_OUTCOME_KEYS = ['SUCCESS', 'PARTIAL', 'FAILED'];

/** { outcome, notes } from a request; both empty clears the notes. Throws ValidationError. */
function parseAfterAction(raw: unknown): { aarOutcome: string | null; aarNotes: string | null } {
  const b = (raw ?? {}) as { outcome?: unknown; notes?: unknown };
  if (b.outcome != null && !AFTER_ACTION_OUTCOME_KEYS.includes(String(b.outcome))) throw new ValidationError('outcome must be SUCCESS, PARTIAL or FAILED');
  if (b.notes != null && typeof b.notes !== 'string') throw new ValidationError('notes must be text');
  const notes = typeof b.notes === 'string' ? b.notes.trim() : '';
  if (notes.length > 2000) throw new ValidationError('notes must be at most 2000 characters');
  return { aarOutcome: b.outcome ? String(b.outcome) : null, aarNotes: notes || null };
}

async function afterActionBy(req: Request) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId! }, select: { discordId: true, globalName: true, username: true } });
  return { aarById: u.discordId, aarByName: u.globalName ?? u.username, aarAt: new Date() };
}

const FINISHED_STATUSES = ['ENDED', 'COMPLETED'];

// PUT /api/guilds/:guildId/events/:eventId/after-action  { outcome, notes }
// Officers of the server that ran it, once it's over; also editable later.
eventsRouter.put('/:guildId/events/:eventId/after-action', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };
  if (!(await assertEventCreator(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }
  const event = await prisma.event.findFirst({ where: { id: eventId, guildId }, select: { status: true } });
  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
    return;
  }
  if (!FINISHED_STATUSES.includes(event.status)) {
    res.status(409).json({ success: false, error: 'After-action notes can be written once the event has ended.' } satisfies ApiResponse);
    return;
  }
  let notes: ReturnType<typeof parseAfterAction>;
  try {
    notes = parseAfterAction(req.body);
  } catch (err) {
    if (err instanceof ValidationError) { res.status(400).json({ success: false, error: err.message } satisfies ApiResponse); return; }
    throw err;
  }
  const cleared = !notes.aarOutcome && !notes.aarNotes;
  await prisma.event.update({
    where: { id: eventId },
    data: cleared ? { aarOutcome: null, aarNotes: null, aarById: null, aarByName: null, aarAt: null } : { ...notes, ...(await afterActionBy(req)) },
  });
  if (event.status === 'COMPLETED') triggerBot(`/trigger/after-action/${eventId}`); // the final summary in Discord
  res.json({ success: true, data: await eventDto(eventId) } satisfies ApiResponse<EventDto>);
});

/** A finished event this server can see (its own, or shared with it), with what deciding who may comment needs. */
async function finishedEventFor(guildId: string, eventId: string) {
  const guild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
  if (!guild) return null;
  return prisma.event.findFirst({
    where: { id: eventId, status: { in: FINISHED_STATUSES }, OR: [{ guildId }, { guildShares: { some: { guildId: guild.id, status: 'ACCEPTED' } } }] },
    select: { status: true, confirmedAttendees: true, vcAttendees: true, rsvps: { select: { userId: true, tentative: true } } },
  });
}

// PUT /api/guilds/:guildId/events/:eventId/comment  { body }  (empty removes yours)
// People who attended (or signed up, where attendance wasn't recorded) can leave one comment.
eventsRouter.put('/:guildId/events/:eventId/comment', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };
  if (!(await assertEventViewer(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }
  const event = await finishedEventFor(guildId, eventId);
  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse);
    return;
  }
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId! }, select: { discordId: true, globalName: true, username: true } });
  if (!canComment(event, u.discordId)) {
    res.status(403).json({ success: false, error: 'Only people who were at this event can comment on it.' } satisfies ApiResponse);
    return;
  }
  const raw = (req.body as { body?: unknown }).body;
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text.length > 500) {
    res.status(400).json({ success: false, error: 'Comments can be at most 500 characters.' } satisfies ApiResponse);
    return;
  }
  if (!text) await prisma.eventComment.deleteMany({ where: { eventId, userId: u.discordId } });
  else {
    const username = u.globalName ?? u.username;
    await prisma.eventComment.upsert({
      where: { eventId_userId: { eventId, userId: u.discordId } },
      create: { eventId, userId: u.discordId, username, body: text },
      update: { body: text, username },
    });
  }
  res.json({ success: true, data: await eventDto(eventId) } satisfies ApiResponse<EventDto>);
});

// DELETE /api/guilds/:guildId/events/:eventId/comments/:userId — officers of the server that ran it
eventsRouter.delete('/:guildId/events/:eventId/comments/:userId', requireAuth, async (req, res) => {
  const { guildId, eventId, userId } = req.params as { guildId: string; eventId: string; userId: string };
  if (!(await assertEventCreator(req, guildId)) || !(await prisma.event.findFirst({ where: { id: eventId, guildId }, select: { id: true } }))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }
  await prisma.eventComment.deleteMany({ where: { eventId, userId } });
  res.json({ success: true, data: await eventDto(eventId) } satisfies ApiResponse<EventDto>);
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
    status: s.status as 'PENDING' | 'ACCEPTED' | 'DECLINED',
    invitedAt: s.invitedAt.toISOString(),
    respondedAt: s.respondedAt?.toISOString() ?? null,
    autoAccepted: s.autoAccepted,
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
    recurTimezone: event.recurTimezone,
    recurAnchor: event.recurAnchor?.toISOString() ?? null,
    recurLabel: event.recurType
      ? describeRecurrence(event.recurType, event.recurAnchor ?? event.startTime, event.recurTimezone)
      : null,
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
    briefingPublished: !!event.briefingPublishedAt,
    rsvps: event.rsvps.map((r) => ({ userId: r.userId, username: r.username, role: r.role, tentative: r.tentative, guildId: r.guildId })),
    afterAction: event.aarOutcome || event.aarNotes
      ? { outcome: event.aarOutcome as AfterActionOutcome | null, notes: event.aarNotes ?? '', byName: event.aarByName, at: (event.aarAt ?? event.updatedAt).toISOString() }
      : null,
    comments: event.comments.map((c) => ({ userId: c.userId, username: c.username, body: c.body, at: c.updatedAt.toISOString() })),
    waitlist: event.waitlist.map((w) => ({ userId: w.userId, username: event.rsvps.find((r) => r.userId === w.userId)?.username ?? w.userId, role: w.role })),
    hadLoot: event.hadLoot ?? null,
    lootNotes: event.lootNotes ?? null,
    vcAttendees: JSON.parse(event.vcAttendees) as string[],
    confirmedAttendees: event.confirmedAttendees ? (JSON.parse(event.confirmedAttendees) as string[]) : null,
    botCleanedUp: event.botCleanedUp,
    poll: event.pollData ? (JSON.parse(event.pollData) as EventPoll) : null,
    shares: withShares.guildShares ? withShares.guildShares.map(toShareDto) : [],
  };
}

// ── Share routes ──────────────────────────────────────────────────────────────
// Events are shared with allies only (v1.11.0). Rules: planShares in
// packages/shared/src/allies.ts; database side: apps/api/src/lib/allyShares.ts.

/** Express 4 doesn't catch async errors: log and answer 500 here. */
const shareRoute = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler => (req, res) => {
  fn(req, res).catch((err) => {
    console.error(`[shares] ${req.method} ${req.path}:`, err);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Something went wrong. Try again.' } satisfies ApiResponse);
  });
};

const shareInclude = { guild: { select: { id: true, guildId: true, name: true } } } as const;

// POST /api/guilds/:guildId/events/:eventId/shares/direct  { targetDiscordGuildId }
// Host shares the event with one more ally.
eventsRouter.post('/:guildId/events/:eventId/shares/direct', requireAuth, shareRoute(async (req, res) => {
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
  if (!targetDiscordGuildId || typeof targetDiscordGuildId !== 'string') {
    res.status(400).json({ success: false, error: 'targetDiscordGuildId is required' } satisfies ApiResponse);
    return;
  }
  if (targetDiscordGuildId === guildId) {
    res.status(400).json({ success: false, error: 'Cannot invite your own guild' } satisfies ApiResponse);
    return;
  }

  const host = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
  if (!host) {
    res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
    return;
  }
  const plan = await planEventShares(host.id, [targetDiscordGuildId]);
  if (plan.notAllies.length > 0) {
    res.status(403).json({ success: false, error: notAllyError(plan) } satisfies ApiResponse);
    return;
  }
  const targetId = plan.accepted[0] ?? plan.pending[0]!;

  const existing = await prisma.eventGuildShare.findUnique({
    where: { eventId_guildId: { eventId, guildId: targetId } },
  });
  if (existing && existing.status === 'PENDING') {
    res.status(409).json({ success: false, error: 'Invite already pending for this guild' } satisfies ApiResponse);
    return;
  }
  if (existing && existing.status === 'ACCEPTED') {
    res.status(409).json({ success: false, error: 'Guild has already accepted this event' } satisfies ApiResponse);
    return;
  }

  if (existing) {
    // They declined this event before: ask again, even if they post automatically.
    const again = await prisma.eventGuildShare.update({
      where: { id: existing.id },
      data: { status: 'PENDING', respondedAt: null, respondedBy: null, autoAccepted: false, invitedAt: new Date(), noticeChannelId: null, noticeMessageId: null, setupAttempts: 0, nextSetupAt: null },
      include: shareInclude,
    });
    notifyShare('pending', again, host.id, null);
    res.status(201).json({ success: true, data: toShareDto(again) } satisfies ApiResponse<EventGuildShareDto>);
    return;
  }

  await createPlannedShares(eventId, host.id, plan);
  const share = await prisma.eventGuildShare.findUniqueOrThrow({
    where: { eventId_guildId: { eventId, guildId: targetId } },
    include: shareInclude,
  });
  res.status(201).json({ success: true, data: toShareDto(share) } satisfies ApiResponse<EventGuildShareDto>);
}));

// DELETE /api/guilds/:guildId/events/:eventId/shares/:shareId
// Host cancels a pending invitation, or stops sharing with a server that accepted.
eventsRouter.delete('/:guildId/events/:eventId/shares/:shareId', requireAuth, shareRoute(async (req, res) => {
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
    const gone = await prisma.eventGuildShare.deleteMany({ where: { id: shareId, status: share.status } });
    if (gone.count === 0) {
      res.status(409).json({ success: false, error: 'That invite was just answered. Refresh and try again.' } satisfies ApiResponse);
      return;
    }
    if (share.status === 'PENDING') {
      const host = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
      if (host) notifyShare('withdrawn', share, host.id, await sessionDiscordId(req));
    }
  }

  res.json({ success: true } satisfies ApiResponse);
}));

// PATCH /api/guilds/:guildId/events/:eventId/shares/:shareId/reinvite
// Host invites an ally that declined this event again.
eventsRouter.patch('/:guildId/events/:eventId/shares/:shareId/reinvite', requireAuth, shareRoute(async (req, res) => {
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

  const share = await prisma.eventGuildShare.findFirst({ where: { id: shareId, eventId }, include: shareInclude });
  if (!share) {
    res.status(404).json({ success: false, error: 'Share not found' } satisfies ApiResponse);
    return;
  }
  if (share.status !== 'DECLINED') {
    res.status(409).json({ success: false, error: 'Can only re-invite a declined share' } satisfies ApiResponse);
    return;
  }

  const host = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
  const plan = host ? await planEventShares(host.id, [share.guild.guildId]) : null;
  if (!host || !plan || plan.notAllies.length > 0) {
    res.status(403).json({ success: false, error: plan ? notAllyError(plan) : 'Guild not found' } satisfies ApiResponse);
    return;
  }

  const updated = await prisma.eventGuildShare.update({
    where: { id: shareId },
    data: { status: 'PENDING', respondedAt: null, respondedBy: null, autoAccepted: false, invitedAt: new Date(), noticeChannelId: null, noticeMessageId: null, setupAttempts: 0, nextSetupAt: null },
    include: shareInclude,
  });
  notifyShare('pending', updated, host.id, null);

  res.json({ success: true, data: toShareDto(updated) } satisfies ApiResponse<EventGuildShareDto>);
}));

// PATCH /api/guilds/:guildId/events/:eventId/shares/respond  { action }
// Receiving guild accepts or declines an invite (the bot's Discord buttons do the same).
eventsRouter.patch('/:guildId/events/:eventId/shares/respond', requireAuth, shareRoute(async (req, res) => {
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

  // Guarded on PENDING: an officer may be pressing the Discord button at the same moment.
  const actorUserId = await sessionDiscordId(req);
  const changed = await prisma.eventGuildShare.updateMany({
    where: { id: share.id, status: 'PENDING' },
    data: { status: action === 'accept' ? 'ACCEPTED' : 'DECLINED', respondedAt: new Date(), respondedBy: actorUserId, setupAttempts: 0, nextSetupAt: null },
  });
  if (changed.count === 0) {
    res.status(409).json({ success: false, error: 'Invite is no longer pending' } satisfies ApiResponse);
    return;
  }
  const updated = await prisma.eventGuildShare.findUniqueOrThrow({ where: { id: share.id }, include: shareInclude });

  if (action === 'accept') {
    // Notify bot to post the event to this guild's Discord
    triggerBot(`/trigger/share-accepted/${share.id}`);
  }
  const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { guildId: true } });
  const host = ev ? await prisma.guild.findUnique({ where: { guildId: ev.guildId }, select: { id: true } }) : null;
  if (host) notifyShare(action === 'accept' ? 'accepted' : 'declined', share, host.id, actorUserId);

  res.json({ success: true, data: toShareDto(updated) } satisfies ApiResponse<EventGuildShareDto>);
}));
