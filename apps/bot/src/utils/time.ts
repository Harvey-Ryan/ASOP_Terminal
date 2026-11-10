/** Parses "YYYY-MM-DD HH:MM" (UTC) into a Date. */
export function parseDateTime(input: string): Date {
  const m = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) throw new Error(`Invalid date format "${input}" — use YYYY-MM-DD HH:MM (UTC)`);
  const [, y, mo, d, h, mi] = m.map(Number) as [unknown, number, number, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (isNaN(date.getTime())) throw new Error(`Invalid date "${input}"`);
  return date;
}

/** Parses "24h 1h 30m" → [1440, 60, 30] (minutes). */
export function parseReminderString(input: string): number[] {
  return input
    .trim()
    .split(/\s+/)
    .map((s) => {
      const h = s.match(/^(\d+)h$/);
      const m = s.match(/^(\d+)m$/);
      if (h) return parseInt(h[1]!) * 60;
      if (m) return parseInt(m[1]!);
      throw new Error(`Invalid reminder "${s}" — use e.g. "24h 1h 30m"`);
    });
}

// Recurring-event dates: see nextOccurrence in packages/shared/src/recurrence.ts.

/** "2 hours", "30 minutes", "1 day", etc. */
export function formatMinutes(minutes: number): string {
  if (minutes >= 1440) {
    const d = minutes / 1440;
    return `${d} day${d !== 1 ? 's' : ''}`;
  }
  if (minutes >= 60) {
    const h = minutes / 60;
    return `${h} hour${h !== 1 ? 's' : ''}`;
  }
  return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
}
