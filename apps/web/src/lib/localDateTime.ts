// <input type="datetime-local"> holds a wall-clock time with no time zone, and
// `new Date(value)` reads it as the browser's local time. So filling it must use
// local time too: toISOString() is UTC and shifted the time by the UTC offset
// on every save (v1.21.2).

/** A moment as the value of a datetime-local input, in the browser's time zone. */
export function toLocalInputValue(at: Date | string | null | undefined): string {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A datetime-local value (local time) as an ISO moment, or undefined when empty. */
export function fromLocalInputValue(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
