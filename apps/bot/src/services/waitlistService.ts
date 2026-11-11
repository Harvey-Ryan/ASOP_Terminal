// Role waitlists (v1.14.0), bot side: the "· waitlist" buttons and the DMs to
// people who move off a line. The rules are in packages/shared/src/roster.ts;
// fillFromWaitlist matches the API's (apps/api/src/lib/waitlist.ts).

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { Prisma } from '@prisma/client';
import { findRole, planWaitlistMoves, roleKeyOf, waitlistProblem, type EventRole, type WaitlistMove } from '@dem/shared';
import { prisma } from '../db.js';
import { client } from '../client.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Line order, for includes. */
export const WAITLIST_ORDER = { orderBy: { id: 'asc' } } as const;

/** Holds the event row for the rest of the transaction; roster changes on one event happen one at a time. */
export async function lockEvent(tx: Prisma.TransactionClient, eventId: string): Promise<{ roles: string; status: string } | null> {
  const [row] = await tx.$queryRaw<{ roles: string; status: string }[]>`SELECT roles, status FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
  return row ?? null;
}

/**
 * After a roster change, inside the transaction holding the event row: drops
 * waitlist entries that no longer make sense and moves the first in line into
 * any open slots. Returns who moved, for notifyWaitlistMoves() after the commit.
 */
export async function fillFromWaitlist(tx: Prisma.TransactionClient, eventId: string, event: { roles: string; status: string }): Promise<WaitlistMove[]> {
  const waitlist = await tx.eventWaitlist.findMany({ where: { eventId }, ...WAITLIST_ORDER });
  if (waitlist.length === 0) return [];
  const roles = JSON.parse(event.roles) as EventRole[];
  const rsvps = await tx.eventRsvp.findMany({ where: { eventId }, select: { userId: true, role: true } });
  const roleOf = new Map(rsvps.map((r) => [r.userId, r.role]));

  const stale = waitlist.filter((w) => !roleOf.has(w.userId) || !findRole(roles, w.role) || roleOf.get(w.userId) === w.role);
  const live = waitlist.filter((w) => !stale.includes(w));
  const moves = event.status === 'PENDING' || event.status === 'ACTIVE' ? planWaitlistMoves(roles, rsvps, live) : [];

  for (const m of moves) {
    await tx.eventRsvp.update({ where: { eventId_userId: { eventId, userId: m.userId } }, data: { role: m.role } });
  }
  const moved = new Set(moves.map((m) => m.userId));
  const drop = waitlist.filter((w) => stale.includes(w) || moved.has(w.userId)).map((w) => w.id);
  if (drop.length) await tx.eventWaitlist.deleteMany({ where: { id: { in: drop } } });
  return moves;
}

export type WaitlistClick =
  | { result: 'joined'; roleName: string; position: number; joinedRoster: boolean }
  | { result: 'left' | 'has-role' | 'open'; roleName: string; joinedRoster?: undefined }
  | { result: 'unknown' | 'other-server'; joinedRoster?: undefined };

/**
 * A "· waitlist" button: joins that role's line (going on the roster as
 * Unassigned if needed; waiting for another role moves you to this line), or
 * leaves it when you're already in it.
 */
export async function clickWaitlist(eventId: string, userId: string, username: string, roleKey: string, guildId: string): Promise<WaitlistClick> {
  return prisma.$transaction(async (tx) => {
    const locked = await lockEvent(tx, eventId);
    const roles = JSON.parse(locked?.roles ?? '[]') as EventRole[];
    const role = findRole(roles, roleKey);
    const current = await tx.eventWaitlist.findUnique({ where: { eventId_userId: { eventId, userId } } });
    if (role && current?.role === roleKeyOf(role)) {
      await tx.eventWaitlist.delete({ where: { id: current.id } });
      return { result: 'left', roleName: role.name };
    }
    const rsvps = await tx.eventRsvp.findMany({ where: { eventId }, select: { userId: true, role: true } });
    const why = waitlistProblem(roles, rsvps, roleKey, userId, guildId);
    if (why === 'unknown' || why === 'other-server') return { result: why };
    if (why) return { result: why, roleName: role!.name };

    const key = roleKeyOf(role!);
    const joinedRoster = !rsvps.some((r) => r.userId === userId);
    if (joinedRoster) await tx.eventRsvp.create({ data: { eventId, userId, username, role: null, guildId } });
    else await tx.eventRsvp.updateMany({ where: { eventId, userId, tentative: true }, data: { tentative: false } }); // joining a line means you're coming
    if (current) await tx.eventWaitlist.delete({ where: { id: current.id } });
    await tx.eventWaitlist.create({ data: { eventId, userId, role: key, guildId } });
    const position = await tx.eventWaitlist.count({ where: { eventId, role: key } });
    return { result: 'joined', roleName: role!.name, position, joinedRoster };
  });
}

/** The moves the API sends with /trigger/waitlist-moved. */
export function isWaitlistMoves(v: unknown): v is WaitlistMove[] {
  const str = (x: unknown) => typeof x === 'string' && x.length > 0 && x.length < 200;
  return Array.isArray(v) && v.length <= 50 && v.every((m) => m && typeof m === 'object'
    && str(m.userId) && str(m.role) && str(m.guildId) && (m.from === null || str(m.from)));
}

/** The thread a member sees the event in: their server's copy of a shared event, or the host's. */
async function threadFor(eventId: string, guildId: string, host: { guildId: string; threadId: string | null }): Promise<string | null> {
  if (guildId === host.guildId) return host.threadId;
  const ally = await prisma.eventAllianceGuild.findFirst({ where: { eventId, discordGuildId: guildId }, select: { threadId: true } });
  return ally?.threadId ?? host.threadId;
}

/**
 * DMs each person who moved off a waitlist ("You're in: Miner"). When their
 * DMs are closed, they're mentioned in the event thread instead.
 */
export async function notifyWaitlistMoves(eventId: string, moves: WaitlistMove[]): Promise<void> {
  if (moves.length === 0) return;
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { name: true, startTime: true, roles: true, guildId: true, threadId: true } });
  if (!event) return;
  const roles = JSON.parse(event.roles) as EventRole[];
  const nameOf = (key: string | null) => (key ? findRole(roles, key)?.name ?? key : null);
  const when = `<t:${Math.floor(event.startTime.getTime() / 1000)}:f>`;

  for (const [i, m] of moves.entries()) {
    if (i > 0) await sleep(1_000);
    const role = nameOf(m.role)!;
    const from = nameOf(m.from);
    const threadId = await threadFor(eventId, m.guildId, event);
    const buttons = new ActionRowBuilder<ButtonBuilder>();
    if (threadId) buttons.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('View event').setURL(`https://discord.com/channels/${m.guildId}/${threadId}`));
    buttons.addComponents(new ButtonBuilder().setCustomId(`leave:${eventId}`).setLabel('Leave roster').setStyle(ButtonStyle.Secondary));
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`You're in: ${role}`)
      .setDescription(`A slot opened in **${event.name}** (${when}), so you've been moved from the waitlist.${from ? ` You're no longer ${from}.` : ''}`);
    try {
      const user = await client.users.fetch(m.userId);
      await user.send({ embeds: [embed], components: [buttons] });
    } catch {
      console.warn(`[waitlist] Couldn't DM ${m.userId}; telling them in the event thread instead.`);
      if (!threadId) continue;
      const thread = await client.channels.fetch(threadId).catch(() => null);
      if (thread?.isThread()) {
        await thread.send({ content: `<@${m.userId}> a **${role}** slot opened, so you've been moved from the waitlist.`, allowedMentions: { users: [m.userId] } })
          .catch((err) => console.error(`[waitlist] Couldn't post in thread ${threadId}:`, err));
      }
    }
  }
}
