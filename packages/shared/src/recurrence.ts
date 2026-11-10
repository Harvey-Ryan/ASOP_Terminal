// ── Recurring event scheduling ───────────────────────────────────────────────
// Used by the bot (to create the next occurrence when one ends) and the web
// form (to label the options and preview upcoming dates), so both agree.
//
// Everything is computed in the organiser's time zone, from the series'
// anchor (its first occurrence), not from the previous occurrence:
//   - "8:00 PM every Tuesday" stays 8:00 PM local across daylight saving changes
//   - "monthly on the 31st" is the 31st, or the last day in shorter months,
//     and goes back to the 31st afterwards (no drift: Jan 31 → Feb 28 → Mar 31)
//   - "monthly on the 2nd Tuesday" / "on the last Friday" by weekday

export const RECUR_TYPES = [
  'DAILY',
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'MONTHLY_WEEKDAY',
  'MONTHLY_LAST_WEEKDAY',
] as const;
export type RecurType = (typeof RECUR_TYPES)[number];

export function isRecurType(v: unknown): v is RecurType {
  return typeof v === 'string' && (RECUR_TYPES as readonly string[]).includes(v);
}

export interface RecurRule {
  type: RecurType;
  /** First occurrence of the series; its local date and time define the pattern. */
  anchor: Date;
  /** IANA time zone the pattern is kept in, e.g. "America/Chicago". */
  timeZone: string;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ── Time zone helpers (Intl only, no library) ───────────────────────────────

interface LocalParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(timeZone, f);
  }
  return f;
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const p: Record<string, string> = {};
  for (const { type, value } of formatter(timeZone).formatToParts(date)) p[type] = value;
  return {
    year: Number(p['year']), month: Number(p['month']), day: Number(p['day']),
    hour: Number(p['hour']) % 24, minute: Number(p['minute']), second: Number(p['second']),
    weekday: WEEKDAYS.indexOf(p['weekday'] ?? 'Sun'),
  };
}

/** Milliseconds the zone is ahead of UTC at `date`. */
function offsetAt(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (date.getTime() - date.getUTCMilliseconds());
}

/**
 * The instant at which the wall clock in `timeZone` reads the given local time.
 * Times that don't exist (spring-forward gap) land just after the gap; times
 * that happen twice (fall-back overlap) resolve to the first.
 */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // The answer is guess minus the zone's offset at the answer. Try the offsets
  // in effect around the guess (they differ only near a DST change).
  const offsets = new Set([
    offsetAt(new Date(guess), timeZone),
    offsetAt(new Date(guess - 14 * 3600e3), timeZone),
    offsetAt(new Date(guess + 14 * 3600e3), timeZone),
  ]);
  const candidates = [...offsets].map((o) => guess - o);
  const shows = (ts: number) => {
    const p = localParts(new Date(ts), timeZone);
    return p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute;
  };
  const exact = candidates.filter(shows);
  // Repeated time (fall-back): the earlier instant. Missing time (spring-forward
  // gap): none show it, so take the latest candidate, which lands just after the gap.
  return new Date(exact.length > 0 ? Math.min(...exact) : Math.max(...candidates));
}

// ── Calendar helpers ─────────────────────────────────────────────────────────

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

function addMonths(year: number, month: number, n: number): { year: number; month: number } {
  const i = year * 12 + (month - 1) + n;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

function addDays(year: number, month: number, day: number, n: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Day of month of the nth (1–5) `weekday` in a month, or null if there isn't one. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number | null {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return day <= daysInMonth(year, month) ? day : null;
}

function lastWeekday(year: number, month: number, weekday: number): number {
  const dim = daysInMonth(year, month);
  const last = new Date(Date.UTC(year, month - 1, dim)).getUTCDay();
  return dim - ((last - weekday + 7) % 7);
}

/** 1-based position of a date's weekday within its month (the 15th → 3rd). */
export function weekdayOrdinal(day: number): number {
  return Math.ceil(day / 7);
}

// ── Next occurrence ──────────────────────────────────────────────────────────

/**
 * The occurrence after `previous` (normally the one that just ended), always
 * strictly later than it. The time of day and the day pattern come from the
 * rule's anchor, so earlier drift (e.g. a clamped Feb 28) never carries over.
 */
export function nextOccurrence(previous: Date, rule: RecurRule): Date {
  const a = localParts(rule.anchor, rule.timeZone);
  let p = localParts(previous, rule.timeZone);

  for (let guard = 0; guard < 24; guard++) {
    let target: { year: number; month: number; day: number };
    switch (rule.type) {
      case 'DAILY':
        target = addDays(p.year, p.month, p.day, 1);
        break;
      case 'WEEKLY':
        target = addDays(p.year, p.month, p.day, 7);
        break;
      case 'BIWEEKLY':
        target = addDays(p.year, p.month, p.day, 14);
        break;
      case 'MONTHLY': {
        const m = addMonths(p.year, p.month, 1);
        target = { ...m, day: Math.min(a.day, daysInMonth(m.year, m.month)) };
        break;
      }
      case 'MONTHLY_WEEKDAY': {
        const m = addMonths(p.year, p.month, 1);
        const n = weekdayOrdinal(a.day);
        // A "5th Friday" doesn't exist every month: use the last one instead.
        target = { ...m, day: nthWeekday(m.year, m.month, a.weekday, n) ?? lastWeekday(m.year, m.month, a.weekday) };
        break;
      }
      case 'MONTHLY_LAST_WEEKDAY': {
        const m = addMonths(p.year, p.month, 1);
        target = { ...m, day: lastWeekday(m.year, m.month, a.weekday) };
        break;
      }
    }
    const next = zonedTimeToUtc(target.year, target.month, target.day, a.hour, a.minute, rule.timeZone);
    if (next.getTime() > previous.getTime()) return next;
    // Only reachable with an odd anchor/previous combination: step again from the target.
    p = { ...p, year: target.year, month: target.month, day: target.day };
  }
  throw new Error(`Could not compute the next ${rule.type} occurrence after ${previous.toISOString()}`);
}

/** The next `count` occurrences after `start` (for previews). */
export function upcomingOccurrences(start: Date, rule: RecurRule, count: number): Date[] {
  const out: Date[] = [];
  let cur = start;
  for (let i = 0; i < count; i++) {
    cur = nextOccurrence(cur, rule);
    out.push(cur);
  }
  return out;
}

// ── Labels ───────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINAL_WORDS = ['', '1st', '2nd', '3rd', '4th', '5th'];

function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Short label, e.g. "Monthly on the 2nd Tuesday". Without an anchor, a generic one. */
export function describeRecurrence(type: string, anchor?: Date | null, timeZone?: string | null): string {
  if (!anchor || !timeZone || !isValidTimeZone(timeZone)) {
    return ({ DAILY: 'Daily', WEEKLY: 'Weekly', BIWEEKLY: 'Every 2 weeks', MONTHLY: 'Monthly',
      MONTHLY_WEEKDAY: 'Monthly (same weekday)', MONTHLY_LAST_WEEKDAY: 'Monthly (last weekday)' } as Record<string, string>)[type] ?? type;
  }
  const a = localParts(anchor, timeZone);
  const day = DAY_NAMES[a.weekday];
  switch (type) {
    case 'DAILY': return 'Daily';
    case 'WEEKLY': return `Weekly on ${day}`;
    case 'BIWEEKLY': return `Every 2 weeks on ${day}`;
    case 'MONTHLY':
      return a.day > 28 ? `Monthly on the ${ordinalSuffix(a.day)} (last day in shorter months)` : `Monthly on the ${ordinalSuffix(a.day)}`;
    case 'MONTHLY_WEEKDAY': {
      const n = weekdayOrdinal(a.day);
      return n === 5 ? `Monthly on the last ${day}` : `Monthly on the ${ORDINAL_WORDS[n]} ${day}`;
    }
    case 'MONTHLY_LAST_WEEKDAY': return `Monthly on the last ${day}`;
    default: return type;
  }
}

/**
 * The options to offer for a first occurrence at `start` (in `timeZone`).
 * "nth weekday" is offered for the 1st–4th; "last weekday" when the date
 * falls in the month's final 7 days (covers what a "5th" would mean).
 */
export function recurrenceOptions(start: Date, timeZone: string): { type: RecurType; label: string }[] {
  const a = localParts(start, timeZone);
  const types: RecurType[] = ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'];
  if (weekdayOrdinal(a.day) <= 4) types.push('MONTHLY_WEEKDAY');
  if (a.day > daysInMonth(a.year, a.month) - 7) types.push('MONTHLY_LAST_WEEKDAY');
  return types.map((type) => ({ type, label: describeRecurrence(type, start, timeZone) }));
}
