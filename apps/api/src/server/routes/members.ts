// Member history (v1.18.0): attendance, no-shows, roles, loot, DKP and
// tournaments per person in a server. Officers who can create events see
// everyone; anyone who can view events sees their own ("me").
// The rules are in packages/shared/src/memberHistory.ts.

import { Router } from 'express';
import {
  outcomeFor, rolesPlayed, statsFor, summarizeMembers, tournamentResult,
  type ApiResponse, type EventRole, type HistoryEvent, type MemberHistoryDto, type MemberSummaryDto,
} from '@dem/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertEventCreator } from '../../lib/assertEventCreator.js';
import { assertEventViewer } from '../../lib/assertEventViewer.js';

export const membersRouter = Router();

/** The most events a history reads (the newest). */
const MAX_EVENTS = 2000;

/** Attendance as recorded: the officers' check, or else who was in voice; null when neither. */
function attendeesOf(e: { status: string; confirmedAttendees: string | null; vcAttendees: string }): string[] | null {
  if (e.status !== 'ENDED' && e.status !== 'COMPLETED') return null;
  if (e.confirmedAttendees) return JSON.parse(e.confirmedAttendees) as string[];
  const vc = JSON.parse(e.vcAttendees) as string[];
  return vc.length ? vc : null;
}

/** This server's own events (shared events are counted by the server that ran them). */
async function historyEvents(guildId: string, userId?: string): Promise<HistoryEvent[]> {
  const events = await prisma.event.findMany({
    where: { guildId, status: { not: 'CANCELLED' } },
    orderBy: { startTime: 'desc' },
    take: MAX_EVENTS,
    select: {
      id: true, name: true, startTime: true, status: true, roles: true, confirmedAttendees: true, vcAttendees: true,
      rsvps: { ...(userId ? { where: { userId } } : {}), select: { userId: true, username: true, role: true, tentative: true } },
    },
  });
  return events.map((e) => ({ ...e, roles: JSON.parse(e.roles) as EventRole[], attendees: attendeesOf(e) }));
}

/** Names for people we only know by id (they turned up without signing up). */
async function namesFor(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const users = await prisma.user.findMany({ where: { discordId: { in: ids } }, select: { discordId: true, globalName: true, username: true } });
  return new Map(users.map((u) => [u.discordId, u.globalName ?? u.username]));
}

async function myDiscordId(req: Express.Request): Promise<string> {
  return (await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId! }, select: { discordId: true } })).discordId;
}

membersRouter.get('/:guildId/members', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertEventCreator(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }
  const events = await historyEvents(guildId);
  const signedUp = new Set(events.flatMap((e) => e.rsvps.map((r) => r.userId)));
  const onlyAttended = [...new Set(events.flatMap((e) => e.attendees ?? []))].filter((id) => !signedUp.has(id));
  const members = summarizeMembers(events, await namesFor(onlyAttended));
  res.json({ success: true, data: members } satisfies ApiResponse<MemberSummaryDto[]>);
});

membersRouter.get('/:guildId/members/:userId', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string; userId: string };
  const me = await myDiscordId(req);
  const userId = req.params['userId'] === 'me' ? me : String(req.params['userId']);
  const allowed = (await assertEventCreator(req, guildId)) || (userId === me && (await assertEventViewer(req, guildId)));
  if (!allowed) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const [events, guild, user] = await Promise.all([
    historyEvents(guildId, userId),
    prisma.guild.findUnique({ where: { guildId }, select: { id: true } }),
    prisma.user.findUnique({ where: { discordId: userId }, select: { id: true, globalName: true, username: true, rsiHandle: true } }),
  ]);
  const mine = events.map((e) => outcomeFor(e, userId)).filter((o) => o !== null);

  const [lootCount, loot, balance, tournaments, member] = await Promise.all([
    prisma.lootAssignment.count({ where: { userId, item: { session: { guildId } } } }),
    prisma.lootAssignment.findMany({
      where: { userId, item: { session: { guildId } } },
      orderBy: { assignedAt: 'desc' },
      take: 10,
      select: { assignedAt: true, username: true, item: { select: { name: true, quantity: true, session: { select: { name: true, eventId: true } } } } },
    }),
    prisma.dkpBalance.findUnique({
      where: { guildId_userId: { guildId, userId } },
      select: { balance: true, username: true, transactions: { orderBy: { createdAt: 'desc' }, take: 10, select: { amount: true, reason: true, createdAt: true } } },
    }),
    prisma.tournamentParticipant.findMany({
      where: { tournament: { guildId }, OR: [{ discordId: userId }, { teamMembers: { some: { discordId: userId } } }] },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { placement: true, status: true, tournament: { select: { id: true, name: true, status: true, createdAt: true } } },
    }),
    guild && user ? prisma.guildMember.findUnique({ where: { userId_guildId: { userId: user.id, guildId: guild.id } }, select: { rsiHandle: true } }) : null,
  ]);

  // Loot from an event's session is named after the event.
  const eventNames = new Map((await prisma.event.findMany({
    where: { id: { in: loot.map((l) => l.item.session.eventId).filter((id): id is string => !!id) } },
    select: { id: true, name: true },
  })).map((e) => [e.id, e.name]));

  const latestRsvpName = events.flatMap((e) => e.rsvps).at(0)?.username; // events are newest first
  const name = latestRsvpName ?? (user ? user.globalName ?? user.username : null) ?? loot[0]?.username ?? balance?.username ?? userId;

  const data: MemberHistoryDto = {
    userId,
    name,
    rsiHandle: member?.rsiHandle ?? user?.rsiHandle ?? null,
    stats: statsFor(mine),
    events: mine.slice(0, 100),
    rolesPlayed: rolesPlayed(mine),
    loot: {
      total: lootCount,
      recent: loot.map((l) => ({
        name: l.item.name, quantity: l.item.quantity, at: l.assignedAt.toISOString(),
        session: l.item.session.name ?? (l.item.session.eventId ? eventNames.get(l.item.session.eventId) ?? 'Event' : 'Loot session'),
      })),
    },
    dkp: balance ? { balance: balance.balance, recent: balance.transactions.map((t) => ({ amount: t.amount, reason: t.reason, at: t.createdAt.toISOString() })) } : null,
    tournaments: tournaments.map((t) => ({
      id: t.tournament.id, name: t.tournament.name,
      result: tournamentResult(t.status, t.placement, t.tournament.status), at: t.tournament.createdAt.toISOString(),
    })),
  };
  res.json({ success: true, data } satisfies ApiResponse<MemberHistoryDto>);
});
