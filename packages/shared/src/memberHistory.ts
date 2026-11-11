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

/** Attendance as recorded: the officers' check, or else who was in voice; null when neither (or not over yet). */
export function recordedAttendees(e: { status: string; confirmedAttendees: string | null; vcAttendees: string }): string[] | null {
  if (!FINISHED.has(e.status)) return null;
  if (e.confirmedAttendees) return JSON.parse(e.confirmedAttendees) as string[];
  const vc = JSON.parse(e.vcAttendees) as string[];
  return vc.length ? vc : null;
}

/**
 * Who may comment on a finished event's after-action notes (v1.19.0): people
 * who attended, or, where attendance wasn't recorded, who signed up (not maybe).
 */
export function canComment(
  e: { status: string; confirmedAttendees: string | null; vcAttendees: string; rsvps: { userId: string; tentative: boolean }[] },
  userId: string,
): boolean {
  if (!FINISHED.has(e.status)) return false;
  const attended = recordedAttendees(e);
  return attended ? attended.includes(userId) : e.rsvps.some((r) => r.userId === userId && !r.tentative);
}

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

// ── Date range (v1.23.0) ─────────────────────────────────────────────────────

/** Only count what happened between these moments (either end open). */
export interface HistoryRange { from?: Date; to?: Date }

/**
 * The ?from=&to= of a member history request: ISO moments (the website sends
 * the start and end of the chosen days in the viewer's own time zone).
 */
export function parseHistoryRange(from: unknown, to: unknown): { range: HistoryRange } | { error: string } {
  const one = (v: unknown, name: string): Date | undefined | string => {
    if (v === undefined || v === '') return undefined;
    if (typeof v !== 'string' || v.length > 40) return `${name} must be a date.`;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? `${name} must be a date.` : d;
  };
  const f = one(from, 'from');
  const t = one(to, 'to');
  if (typeof f === 'string') return { error: f };
  if (typeof t === 'string') return { error: t };
  if (f && t && f > t) return { error: 'The start of the range is after its end.' };
  return { range: { ...(f ? { from: f } : {}), ...(t ? { to: t } : {}) } };
}

/** A Prisma date filter for the range (undefined when open on both ends). */
export function rangeWhere(r: HistoryRange): { gte?: Date; lte?: Date } | undefined {
  if (!r.from && !r.to) return undefined;
  return { ...(r.from ? { gte: r.from } : {}), ...(r.to ? { lte: r.to } : {}) };
}
