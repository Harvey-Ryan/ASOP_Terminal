// Activity heat maps (v1.24.0): a week as 7 × 24 cells (row 0 = Sunday,
// column = hour), in the viewer's time zone. The event map is built here; the
// server and member activity maps come from RoleCall. Also the "best times"
// summary and the words used to read a cell.

import { recordedAttendees } from './memberHistory.js';

export type HeatGrid = number[][];
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const emptyGrid = <T>(fill: T): T[][] => Array.from({ length: 7 }, () => new Array<T>(24).fill(fill));

/** Weekday (0 = Sunday) and hour of a moment in a time zone. */
export function localSlot(at: Date, timeZone: string): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(at);
  const day = DAY_NAMES.indexOf(parts.find((p) => p.type === 'weekday')!.value as typeof DAY_NAMES[number]);
  const hour = Number(parts.find((p) => p.type === 'hour')!.value) % 24;
  return { day, hour };
}

// ── Event planning map ───────────────────────────────────────────────────────

export interface HeatmapEvent {
  startTime: Date;
  status: string;
  confirmedAttendees: string | null;
  vcAttendees: string;
  rsvps: { userId: string; tentative: boolean }[];
}

export interface EventHeatmapDto {
  /** Average people per event that started in the slot (recorded events only); 0 where none */
  attendanceGrid: HeatGrid;
  /** Of the people who signed up (not maybe), the share who came, 0–1; null where nobody signed up */
  ratioGrid: (number | null)[][];
  /** Events with attendance recorded, per slot */
  eventCountGrid: HeatGrid;
  maxAttendance: number;
  /** Events counted (attendance recorded) */
  eventCount: number;
  /** Finished events left out because attendance wasn't recorded */
  notRecorded: number;
  days: number;
  timezone: string;
}

/**
 * When people turn up to events. Uses the same rules as member history:
 * attendance only where it was recorded (the attendance check, else voice),
 * and the show-up rate is about the people who signed up, so walk-ins count
 * towards turnout but not towards it.
 */
export function buildEventHeatmap(events: readonly HeatmapEvent[], timeZone: string, days: number): EventHeatmapDto {
  const people = emptyGrid(0), count = emptyGrid(0), signed = emptyGrid(0), came = emptyGrid(0);
  let notRecorded = 0;
  for (const e of events) {
    const attendees = recordedAttendees(e);
    if (!attendees) { notRecorded++; continue; }
    const { day, hour } = localSlot(e.startTime, timeZone);
    const here = new Set(attendees);
    const yes = e.rsvps.filter((r) => !r.tentative);
    people[day]![hour]! += here.size;
    count[day]![hour]! += 1;
    signed[day]![hour]! += yes.length;
    came[day]![hour]! += yes.filter((r) => here.has(r.userId)).length;
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const attendanceGrid = people.map((row, d) => row.map((p, h) => (count[d]![h]! ? round1(p / count[d]![h]!) : 0)));
  const ratioGrid = signed.map((row, d) => row.map((s, h) => (s ? came[d]![h]! / s : null)));
  return {
    attendanceGrid, ratioGrid, eventCountGrid: count,
    maxAttendance: Math.max(0, ...attendanceGrid.flat()),
    eventCount: count.flat().reduce((a, b) => a + b, 0),
    notRecorded, days, timezone: timeZone,
  };
}

// ── Reading a map ────────────────────────────────────────────────────────────

/** "8 PM", "12 AM" */
export function hourName(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Sat 8–11 PM", "Sun 11 PM–1 AM" (end is exclusive: the hour after the last) */
export function slotRange(day: number, from: number, toExclusive: number): string {
  const a = hourName(from), b = hourName(toExclusive);
  const [an, ap] = a.split(' '), [bn, bp] = b.split(' ');
  return `${DAY_NAMES[day]} ${ap === bp ? an : a}–${b}`.replace(` ${bp}`, '') + ` ${bp}`;
}

export interface BestTime { day: number; from: number; to: number; label: string; peak: number }

/**
 * The busiest stretches of the week: runs of hours on the same day at 75% of
 * the busiest hour or more, busiest first. Empty when there's nothing to show.
 * `usable` leaves out cells that shouldn't count (e.g. no events there).
 */
export function bestTimes(grid: (number | null)[][], limit = 3, usable?: (day: number, hour: number) => boolean): BestTime[] {
  const value = (d: number, h: number) => (usable && !usable(d, h) ? 0 : grid[d]?.[h] ?? 0);
  let max = 0;
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) max = Math.max(max, value(d, h));
  if (max <= 0) return [];
  const runs: (BestTime & { sum: number })[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24;) {
      if (value(d, h) < max * 0.75) { h++; continue; }
      const from = h; let sum = 0, peak = 0;
      while (h < 24 && value(d, h) >= max * 0.75) { sum += value(d, h); peak = Math.max(peak, value(d, h)); h++; }
      runs.push({ day: d, from, to: h, label: slotRange(d, from, h), peak, sum });
    }
  }
  return runs.sort((a, b) => b.peak - a.peak || b.sum - a.sum).slice(0, limit).map(({ sum: _s, ...r }) => r);
}

/** "Saturday 8 PM" */
export const cellName = (day: number, hour: number) => `${LONG_DAYS[day]} ${hourName(hour)}`;
