// Role waitlists (v1.14.0), database side. The rules are in
// packages/shared/src/roster.ts; the bot has the same helper
// (apps/bot/src/services/waitlistService.ts) for the Discord buttons.

import type { Prisma } from '@prisma/client';
import { findRole, planWaitlistMoves, roleKeyOf, type EventRole, type WaitlistMove } from '@dem/shared';
import { triggerBot } from './triggerBot.js';

/** Line order, for includes. */
export const WAITLIST_ORDER = { orderBy: { id: 'asc' } } as const;

/** Holds the event row for the rest of the transaction; roster changes on one event happen one at a time. */
export async function lockEvent(tx: Prisma.TransactionClient, eventId: string): Promise<{ roles: string; status: string } | null> {
  const [row] = await tx.$queryRaw<{ roles: string; status: string }[]>`SELECT roles, status FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
  return row ?? null;
}

/**
 * After a roster change, inside the transaction holding the event row: drops
 * waitlist entries that no longer make sense (left the roster, role removed,
 * already in the role) and moves the first in line into any open slots.
 * Returns who moved, for announceWaitlistMoves() after the commit.
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

/** Tells the bot to DM the people who moved off the waitlist (and refresh the roster). */
export function announceWaitlistMoves(eventId: string, moves: WaitlistMove[]): void {
  for (let i = 0; i < moves.length; i += 50) triggerBot(`/trigger/waitlist-moved/${eventId}`, { moves: moves.slice(i, i + 50) });
}

/**
 * Keeps the roster in step with edited roles: a role saved before roles had ids
 * is stored by name, so its people (and line) move to the id it gets now; people
 * in a removed role go to Unassigned. Renamed roles keep their id and people.
 */
export async function carryRoleChanges(tx: Prisma.TransactionClient, eventId: string, oldRoles: EventRole[], newRoles: EventRole[]): Promise<void> {
  for (const r of newRoles) {
    if (r.id && oldRoles.some((o) => !o.id && o.name === r.name)) {
      await tx.eventRsvp.updateMany({ where: { eventId, role: r.name }, data: { role: r.id } });
      await tx.eventWaitlist.updateMany({ where: { eventId, role: r.name }, data: { role: r.id } });
    }
  }
  const keep = new Set(newRoles.map(roleKeyOf));
  const removed = oldRoles.map(roleKeyOf).filter((k) => !keep.has(k));
  if (removed.length) await tx.eventRsvp.updateMany({ where: { eventId, role: { in: removed } }, data: { role: null } });
}
