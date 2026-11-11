// Roster rules shared by the website and the Discord buttons: who can take a
// role (v1.12.0) and how the waitlist for full roles moves (v1.14.0). Both run
// while the event row is locked, so the API and the bot always agree.

import type { EventRole } from './index.js';

/** How an RSVP or waitlist entry refers to a role. */
export const roleKeyOf = (role: EventRole): string => role.id ?? role.name;

/** The role a key refers to (old events stored role names). */
export function findRole(roles: readonly EventRole[], key: string): EventRole | undefined {
  return roles.find((r) => roleKeyOf(r) === key) ?? roles.find((r) => r.name === key);
}

type RosterRow = { userId: string; role: string | null };

/**
 * Why someone can't take a role on an event's roster right now, or null if
 * they can. Checked at the moment of signing up, so two people can't both
 * take the last slot.
 *   unknown      — no such role on the event
 *   other-server — the role is only for members of another server
 *   full         — every slot is taken by someone else
 */
export function roleSignupProblem(
  roles: readonly EventRole[],
  rsvps: readonly RosterRow[],
  roleKey: string,
  userId: string,
  viewingGuildId: string,
): 'unknown' | 'other-server' | 'full' | null {
  const role = findRole(roles, roleKey);
  if (!role) return 'unknown';
  if (role.guildId && role.guildId !== viewingGuildId) return 'other-server';
  const key = roleKeyOf(role);
  const taken = rsvps.filter((r) => r.role === key && r.userId !== userId).length;
  return taken >= role.count ? 'full' : null;
}

export const ROLE_SIGNUP_MESSAGES = {
  unknown: 'That role is no longer on this event.',
  'other-server': 'That role is only for members of another server.',
  full: 'That role just filled up. Pick another one.',
} as const;

// ── Waitlist ─────────────────────────────────────────────────────────────────

/**
 * Whether someone can join the waitlist for a role, or why not.
 *   has-role — they already have it
 *   open     — a slot is free: take the role instead
 */
export function waitlistProblem(
  roles: readonly EventRole[],
  rsvps: readonly RosterRow[],
  roleKey: string,
  userId: string,
  viewingGuildId: string,
): 'unknown' | 'other-server' | 'has-role' | 'open' | null {
  const why = roleSignupProblem(roles, rsvps, roleKey, userId, viewingGuildId);
  if (why === 'unknown' || why === 'other-server') return why;
  const key = roleKeyOf(findRole(roles, roleKey)!);
  if (rsvps.some((r) => r.userId === userId && r.role === key)) return 'has-role';
  return why === 'full' ? null : 'open';
}

export const WAITLIST_MESSAGES = {
  ...ROLE_SIGNUP_MESSAGES,
  'has-role': 'You already have that role.',
  open: 'That role has a free slot. Take it instead.',
} as const;

/** A waitlist entry, in line order. */
export interface WaitlistRow { userId: string; role: string; guildId: string }

/** Someone moved off the waitlist into a role; guildId is the server they joined from. */
export interface WaitlistMove { userId: string; role: string; from: string | null; guildId: string }

/**
 * Who moves off the waitlist into the open slots, first in line first. Only
 * people on the roster move (the waitlist keeps them there), and a role limited
 * to one server only takes that server's members. Moving someone frees their
 * old role, which can let the next person in that role's line move up too.
 */
export function planWaitlistMoves(
  roles: readonly EventRole[],
  rsvps: readonly RosterRow[],
  waitlist: readonly WaitlistRow[],
): WaitlistMove[] {
  const roster = new Map(rsvps.map((r) => [r.userId, r.role]));
  const waiting = [...waitlist];
  const moves: WaitlistMove[] = [];
  const taken = (key: string) => { let n = 0; for (const r of roster.values()) if (r === key) n++; return n; };

  for (let changed = true; changed;) {
    changed = false;
    for (const role of roles) {
      const key = roleKeyOf(role);
      while (taken(key) < role.count) {
        const i = waiting.findIndex((w) => w.role === key && roster.has(w.userId) && roster.get(w.userId) !== key
          && (!role.guildId || role.guildId === w.guildId));
        if (i < 0) break;
        const [w] = waiting.splice(i, 1);
        moves.push({ userId: w!.userId, role: key, from: roster.get(w!.userId) ?? null, guildId: w!.guildId });
        roster.set(w!.userId, key);
        changed = true;
      }
    }
  }
  return moves;
}

// ── Joint ops (v1.20.0) ──────────────────────────────────────────────────────

/** A server's short label on a shared event's roster: its ally tag, else its name. */
export function serverLabel(allianceTag: string | null | undefined, name: string | null | undefined): string {
  const t = allianceTag?.trim() || name?.trim() || '?';
  return t.length > 12 ? `${t.slice(0, 11)}…` : t;
}

/** Who's coming from each server (maybes not counted), host first, then most people. */
export function serverHeadcount(
  rsvps: readonly { guildId: string | null; tentative?: boolean }[],
  hostGuildId: string,
  tags: Readonly<Record<string, string>>,
): { guildId: string; tag: string; count: number }[] {
  const counts = new Map<string, number>([[hostGuildId, 0]]);
  for (const r of rsvps) {
    if (r.tentative) continue;
    const g = r.guildId && tags[r.guildId] ? r.guildId : hostGuildId;
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return [...counts]
    .map(([guildId, count]) => ({ guildId, tag: tags[guildId] ?? '?', count }))
    .sort((a, b) => (a.guildId === hostGuildId ? -1 : b.guildId === hostGuildId ? 1 : b.count - a.count));
}

/** The tag to show next to someone on a shared event (unknown servers count as the host). */
export function serverTagOf(rsvp: { guildId: string | null }, hostGuildId: string, tags: Readonly<Record<string, string>>): string | undefined {
  return tags[rsvp.guildId ?? hostGuildId] ?? tags[hostGuildId];
}
