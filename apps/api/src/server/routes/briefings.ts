// Mission briefings (v1.36.0): one per event, by the host's event creators.
// Read by anyone who can see the event in the host or a server it's shared
// with, and by anyone on its roster; drafts only by the editors.
//
//   GET    /api/guilds/:guildId/events/:eventId/briefing           the page's data
//   PUT    /api/guilds/:guildId/events/:eventId/briefing           save { content }
//   POST   /api/guilds/:guildId/events/:eventId/briefing/publish   { published: boolean }
//   DELETE /api/guilds/:guildId/events/:eventId/briefing
//   GET    /api/guilds/:guildId/briefings                          the server's briefings, to start a new one from

import { Router, type Request, type Response } from 'express';
import {
  briefingRoles, briefingSummary, parseBriefing, sanitizeBriefing, serverLabel,
  type ApiResponse, type BriefingDto, type BriefingLogo, type BriefingViewDto,
} from '@dem/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { eventRelation } from '../../lib/lootAccess.js';
import { assertEventViewer } from '../../lib/assertEventViewer.js';
import { assertEventCreator } from '../../lib/assertEventCreator.js';
import { triggerBot } from '../../lib/triggerBot.js';

export const briefingsRouter = Router();

const fail = (res: Response, status: number, error: string) => {
  res.status(status).json({ success: false, error } satisfies ApiResponse);
};

const params = (req: Request) => req.params as { guildId: string; eventId: string };

async function discordIdOf(req: Request): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: req.session.userId! }, select: { discordId: true } });
  return u?.discordId ?? null;
}

/** An event creator of the server hosting the event. */
async function canEdit(req: Request, guildId: string, eventId: string): Promise<boolean> {
  return (await eventRelation(eventId, guildId)) === 'host' && assertEventCreator(req, guildId);
}

/** Can see the event here (host, or a server it's shared with), or is on its roster. */
async function canView(req: Request, guildId: string, eventId: string): Promise<boolean> {
  const relation = await eventRelation(eventId, guildId);
  if (!relation) return false;
  if (await assertEventViewer(req, guildId)) return true;
  const me = await discordIdOf(req);
  return !!me && !!(await prisma.eventRsvp.findFirst({ where: { eventId, userId: me }, select: { id: true } }));
}

const toDto = (b: { eventId: string; content: string; publishedAt: Date | null; updatedAt: Date }): BriefingDto => ({
  eventId: b.eventId,
  content: parseBriefing(b.content),
  publishedAt: b.publishedAt?.toISOString() ?? null,
  updatedAt: b.updatedAt.toISOString(),
});

async function logosFor(eventId: string, hostGuildId: string): Promise<BriefingLogo[]> {
  const [host, shares] = await Promise.all([
    prisma.guild.findUnique({ where: { guildId: hostGuildId }, select: { guildId: true, name: true, settings: { select: { logoUrl: true, allianceTag: true } } } }),
    prisma.eventGuildShare.findMany({
      where: { eventId, status: 'ACCEPTED' },
      select: { guild: { select: { guildId: true, name: true, settings: { select: { logoUrl: true, allianceTag: true } } } } },
    }),
  ]);
  const out: BriefingLogo[] = [];
  for (const g of [host, ...shares.map((s) => s.guild)]) {
    if (!g || out.some((o) => o.guildId === g.guildId)) continue;
    out.push({ guildId: g.guildId, name: g.name, tag: g.settings?.allianceTag ? serverLabel(g.settings.allianceTag, g.name) : null, logoUrl: g.settings?.logoUrl ?? null });
  }
  return out;
}

briefingsRouter.get('/:guildId/events/:eventId/briefing', requireAuth, async (req, res) => {
  const { guildId, eventId } = params(req);
  try {
    if (!(await canView(req, guildId, eventId))) { fail(res, 403, 'Forbidden'); return; }
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true, name: true, startTime: true, endTime: true, musterPoint: true, guildId: true,
        roles: true, rsvps: { select: { tentative: true, role: true, username: true }, orderBy: { id: 'asc' } }, briefing: true,
      },
    });
    if (!event) { fail(res, 404, 'Event not found'); return; }
    const editor = await canEdit(req, guildId, eventId);
    const b = event.briefing && (editor || event.briefing.publishedAt) ? toDto(event.briefing) : null;
    const data: BriefingViewDto = {
      event: {
        id: event.id, name: event.name, startTime: event.startTime.toISOString(), endTime: event.endTime?.toISOString() ?? null,
        musterPoint: event.musterPoint, hostGuildId: event.guildId,
        signedUp: event.rsvps.filter((r) => !r.tentative).length, maybe: event.rsvps.filter((r) => r.tentative).length,
        roles: briefingRoles(event.roles, event.rsvps),
      },
      briefing: b,
      logos: await logosFor(event.id, event.guildId),
      canEdit: editor,
    };
    res.json({ success: true, data } satisfies ApiResponse<BriefingViewDto>);
  } catch (err) {
    console.error('[briefings] GET:', err);
    fail(res, 500, 'Could not load the briefing');
  }
});

briefingsRouter.put('/:guildId/events/:eventId/briefing', requireAuth, async (req, res) => {
  const { guildId, eventId } = params(req);
  try {
    if (!(await canEdit(req, guildId, eventId))) { fail(res, 403, 'Only the host server\'s event creators can edit the briefing'); return; }
    const body = req.body as { content?: unknown };
    if (!body.content || typeof body.content !== 'object') { fail(res, 400, 'Send the briefing as content'); return; }
    const content = sanitizeBriefing(body.content);
    const updatedBy = await discordIdOf(req);
    const saved = await prisma.eventBriefing.upsert({
      where: { eventId },
      create: { eventId, content: JSON.stringify(content), updatedBy },
      update: { content: JSON.stringify(content), updatedBy },
    });
    // A published briefing's summary on the roster follows the objective.
    if (saved.publishedAt) {
      const summary = briefingSummary(content) || null;
      const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { briefingSummary: true } });
      if (ev?.briefingSummary !== summary) {
        await prisma.event.update({ where: { id: eventId }, data: { briefingSummary: summary } });
        triggerBot(`/trigger/rsvp/${eventId}`);
      }
    }
    res.json({ success: true, data: toDto(saved) } satisfies ApiResponse<BriefingDto>);
  } catch (err) {
    console.error('[briefings] PUT:', err);
    fail(res, 500, 'Could not save the briefing');
  }
});

briefingsRouter.post('/:guildId/events/:eventId/briefing/publish', requireAuth, async (req, res) => {
  const { guildId, eventId } = params(req);
  const published = (req.body as { published?: unknown }).published;
  if (typeof published !== 'boolean') { fail(res, 400, 'Send published: true or false'); return; }
  try {
    if (!(await canEdit(req, guildId, eventId))) { fail(res, 403, 'Only the host server\'s event creators can publish the briefing'); return; }
    const b = await prisma.eventBriefing.findUnique({ where: { eventId } });
    if (!b) { fail(res, 404, 'Save the briefing first'); return; }
    const publishedAt = published ? b.publishedAt ?? new Date() : null;
    const [saved] = await prisma.$transaction([
      prisma.eventBriefing.update({ where: { eventId }, data: { publishedAt } }),
      prisma.event.update({
        where: { id: eventId },
        data: { briefingPublishedAt: publishedAt, briefingSummary: published ? briefingSummary(parseBriefing(b.content)) || null : null },
      }),
    ]);
    // Newly published: the roster gets its Briefing button and the thread a notice; otherwise just the roster.
    triggerBot(published && !b.publishedAt ? `/trigger/briefing/${eventId}` : `/trigger/rsvp/${eventId}`);
    res.json({ success: true, data: toDto(saved) } satisfies ApiResponse<BriefingDto>);
  } catch (err) {
    console.error('[briefings] publish:', err);
    fail(res, 500, 'Could not publish the briefing');
  }
});

briefingsRouter.delete('/:guildId/events/:eventId/briefing', requireAuth, async (req, res) => {
  const { guildId, eventId } = params(req);
  try {
    if (!(await canEdit(req, guildId, eventId))) { fail(res, 403, 'Forbidden'); return; }
    const gone = await prisma.eventBriefing.deleteMany({ where: { eventId } });
    await prisma.event.update({ where: { id: eventId }, data: { briefingPublishedAt: null, briefingSummary: null } });
    if (gone.count) triggerBot(`/trigger/rsvp/${eventId}`);
    res.json({ success: true } satisfies ApiResponse);
  } catch (err) {
    console.error('[briefings] DELETE:', err);
    fail(res, 500, 'Could not delete the briefing');
  }
});

/** The server's own briefings, newest first, to start a new one from ("Copy from a past op"). */
briefingsRouter.get('/:guildId/briefings', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  try {
    if (!(await assertEventCreator(req, guildId))) { fail(res, 403, 'Forbidden'); return; }
    const rows = await prisma.eventBriefing.findMany({
      where: { event: { guildId } },
      orderBy: { event: { startTime: 'desc' } },
      take: 50,
      select: { eventId: true, content: true, publishedAt: true, updatedAt: true, event: { select: { name: true, startTime: true, aarOutcome: true } } },
    });
    const data = rows.map((r) => ({
      ...toDto(r),
      eventName: r.event.name,
      startTime: r.event.startTime.toISOString(),
      outcome: r.event.aarOutcome,
    }));
    res.json({ success: true, data } satisfies ApiResponse<typeof data>);
  } catch (err) {
    console.error('[briefings] list:', err);
    fail(res, 500, 'Could not load briefings');
  }
});
