// Member history (v1.18.0): who signed up for and turned up to a server's
// events. Attendance is only counted for events where it was recorded: the
// officers' attendance check at the end, or else who was in the event's voice
// channels. Maybes are never no-shows; turning up without signing up counts.

import type { EventRole } from './index.js';
import { findRole } from './roster.js';

/** A finished or upcoming event, as the history needs it. */
export interface HistoryEvent {
  id: string;
  name: string;
  startTime: Date;
  status: string;
  roles: EventRole[];
  rsvps: { userId: string; username: string; role: string | null; tentative: boolean }[];
  /** Who attended: the attendance check, or else who was in voice. Null = not recorded. */
  attendees: string[] | null;
}

export type HistoryOutcome = 'attended' | 'no-show' | 'maybe' | 'upcoming' | 'not-recorded';

export interface MemberEventDto {
  eventId: string;
  name: string;
  startTime: string;
  /** Role name, "Unassigned", or null when they only turned up */
  role: string | null;
  outcome: HistoryOutcome;
  /** Turned up without signing up */
  walkIn: boolean;
}

export interface MemberStatsDto {
  attended: number;
  /** Signed up (not maybe) for an event whose attendance was recorded */
  signedUp: number;
  noShows: number;
  /** attended-when-signed-up ÷ signedUp, 0–100; null when nothing to count */
  showRate: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface MemberSummaryDto extends MemberStatsDto {
  userId: string;
  name: string;
}

export interface MemberHistoryDto {
  userId: string;
  name: string;
  rsiHandle: string | null;
  stats: MemberStatsDto;
  /** Newest first */
  events: MemberEventDto[];
  rolesPlayed: { role: string; count: number }[];
  loot: { total: number; recent: { name: string; quantity: number; at: string; session: string }[] };
  dkp: { balance: number; recent: { amount: number; reason: string; at: string }[] } | null;
  /** result: "Winner", "Runner-up", "Third", "4th place", "Eliminated", "Playing", "Signed up", "Took part" or "Cancelled" */
  tournaments: { id: string; name: string; result: string; at: string }[];
}

const FINISHED = new Set(['ENDED', 'COMPLETED']);

/** One person's outcome for one event, or null when they had nothing to do with it. */
export function outcomeFor(e: HistoryEvent, userId: string): MemberEventDto | null {
  const rsvp = e.rsvps.find((r) => r.userId === userId);
  const there = e.attendees?.includes(userId) ?? false;
  if (!rsvp && !there) return null;
  const role = rsvp && !rsvp.tentative ? (rsvp.role ? findRole(e.roles, rsvp.role)?.name ?? rsvp.role : 'Unassigned') : null;
  let outcome: HistoryOutcome;
  if (!FINISHED.has(e.status)) outcome = rsvp?.tentative ? 'maybe' : 'upcoming';
  else if (e.attendees === null) outcome = rsvp?.tentative ? 'maybe' : 'not-recorded';
  else if (there) outcome = 'attended';
  else outcome = rsvp?.tentative ? 'maybe' : 'no-show';
  return { eventId: e.id, name: e.name, startTime: e.startTime.toISOString(), role, outcome, walkIn: there && (!rsvp || rsvp.tentative) };
}

export function statsFor(events: readonly MemberEventDto[]): MemberStatsDto {
  let attended = 0, signedUp = 0, showedWhenSignedUp = 0;
  const seen: string[] = [];
  for (const e of events) {
    if (e.outcome === 'attended') { attended++; seen.push(e.startTime); }
    if ((e.outcome === 'attended' && !e.walkIn) || e.outcome === 'no-show') {
      signedUp++;
      if (e.outcome === 'attended') showedWhenSignedUp++;
    }
  }
  seen.sort();
  return {
    attended, signedUp, noShows: signedUp - showedWhenSignedUp,
    showRate: signedUp ? Math.round((showedWhenSignedUp / signedUp) * 100) : null,
    firstSeen: seen[0] ?? null, lastSeen: seen.at(-1) ?? null,
  };
}

/** Everyone who signed up for or attended these events, with their numbers. */
export function summarizeMembers(events: readonly HistoryEvent[], names: ReadonlyMap<string, string> = new Map()): MemberSummaryDto[] {
  const byUser = new Map<string, MemberEventDto[]>();
  const nameOf = new Map(names);
  const sorted = [...events].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  for (const e of sorted) {
    for (const r of e.rsvps) nameOf.set(r.userId, r.username); // the latest name they signed up with
    const people = new Set([...e.rsvps.map((r) => r.userId), ...(e.attendees ?? [])]);
    for (const u of people) {
      const o = outcomeFor(e, u);
      if (o) byUser.set(u, [...(byUser.get(u) ?? []), o]);
    }
  }
  return [...byUser].map(([userId, evs]) => ({ userId, name: nameOf.get(userId) ?? userId, ...statsFor(evs) }));
}

/** The roles someone played at events they attended, most first. */
export function rolesPlayed(events: readonly MemberEventDto[]): { role: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of events) if (e.outcome === 'attended' && e.role && e.role !== 'Unassigned') counts.set(e.role, (counts.get(e.role) ?? 0) + 1);
  return [...counts].map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));
}

/** A tournament entry's result in words. */
export function tournamentResult(status: string, placement: number | null, tournamentStatus: string): string {
  const named: Record<string, string> = { WINNER: 'Winner', RUNNER_UP: 'Runner-up', THIRD: 'Third' };
  if (named[status]) return named[status]!;
  if (placement) {
    const n = placement % 100, suffix = n >= 11 && n <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][placement % 10] ?? 'th';
    return `${placement}${suffix} place`;
  }
  if (status === 'ELIMINATED') return 'Eliminated';
  return ({ COMPLETED: 'Took part', CANCELLED: 'Cancelled', IN_PROGRESS: 'Playing' } as Record<string, string>)[tournamentStatus] ?? 'Signed up';
}
