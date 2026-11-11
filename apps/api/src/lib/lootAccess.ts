// Who may do what with an event's loot, given the server in the URL (v1.11.3).
//
// The loot routes are /api/guilds/:guildId/events/:eventId/loot/…, and used to
// check the signed-in user's rights in :guildId only, without checking that
// the event had anything to do with that server. So officers of any server
// with the bot could read and change another server's loot.
//
// Now the server in the URL has to be the event's host, or a server that
// accepted the event as a share:
//   - managing loot (items, rolls, awards, the draft, completing): host only;
//   - viewing loot: host, or a server that accepted the share.
// Checks on the person (the current draft picker, the draft order, confirmed
// attendees) are unchanged and don't depend on the server in the URL.

import type { NextFunction, Request, Response } from 'express';
import type { ApiResponse } from '@dem/shared';
import { prisma } from './prisma.js';
import { assertGuildManager } from './assertGuildManager.js';
import { assertEventCreator } from './assertEventCreator.js';
import { assertEventViewer } from './assertEventViewer.js';

/** How the event relates to the server in the URL. */
export async function eventRelation(eventId: string, guildId: string): Promise<'host' | 'shared' | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { guildId: true, guildShares: { where: { status: 'ACCEPTED', guild: { guildId } }, select: { id: true } } },
  });
  if (!event) return null;
  if (event.guildId === guildId) return 'host';
  return event.guildShares.length > 0 ? 'shared' : null;
}

/** An officer of the server that hosts the event. */
export async function assertLootManager(req: Express.Request, guildId: string, eventId: string): Promise<boolean> {
  return (await eventRelation(eventId, guildId)) === 'host' && assertGuildManager(req, guildId);
}

/** An event creator of the server that hosts the event. */
export async function assertLootCreator(req: Express.Request, guildId: string, eventId: string): Promise<boolean> {
  return (await eventRelation(eventId, guildId)) === 'host' && assertEventCreator(req, guildId);
}

/** Someone who can see events in the host, or in a server the event is shared with. */
export async function assertLootViewer(req: Express.Request, guildId: string, eventId: string): Promise<boolean> {
  return (await eventRelation(eventId, guildId)) !== null && assertEventViewer(req, guildId);
}

// ── Items and awards belong to the session in the URL ───────────────────────
// Routes with :itemId or :assignmentId looked the item up by its id alone, so a
// manager of one session (or the draft picker on their turn) could act on an
// item from any other session by its id. These run before every such route
// (router.param) and answer 404 unless the item is in the event's or the
// standalone session's own loot.

type ParamHandler = (req: Request, res: Response, next: NextFunction, value: string) => void;

const notFound = (res: Response, what: string) =>
  res.status(404).json({ success: false, error: `${what} not found` } satisfies ApiResponse);

function belongs(item: { session: { id: string; eventId: string | null } } | null, params: Request['params']): boolean {
  if (!item) return false;
  if (params['eventId']) return item.session.eventId === params['eventId'];
  if (params['sessionId']) return item.session.id === params['sessionId'];
  return false;
}

export const lootItemParam: ParamHandler = (req, res, next, itemId) => {
  prisma.lootItem.findUnique({ where: { id: itemId }, select: { session: { select: { id: true, eventId: true } } } })
    .then((item) => (belongs(item, req.params) ? next() : notFound(res, 'Item')))
    .catch(next);
};

export const lootAssignmentParam: ParamHandler = (req, res, next, assignmentId) => {
  prisma.lootAssignment.findUnique({ where: { id: assignmentId }, select: { item: { select: { session: { select: { id: true, eventId: true } } } } } })
    .then((a) => (belongs(a?.item ?? null, req.params) ? next() : notFound(res, 'Award')))
    .catch(next);
};
