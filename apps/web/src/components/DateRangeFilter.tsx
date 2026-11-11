// A date range for member history (v1.23.0): All time, the last 30 or 90 days,
// this year, or two chosen days. It lives in the URL (?range=, ?from=, ?to=),
// so it carries over from the list to a member and survives a reload. Days
// are the viewer's own: from the start of the first to the end of the last.

import { useSearchParams } from 'react-router-dom';
import type { MemberRange } from '@/api/members';

export type RangePreset = 'all' | '30d' | '90d' | 'year' | 'custom';
const PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const p2 = (n: number) => String(n).padStart(2, '0');
/** A Date as YYYY-MM-DD in the viewer's time zone. */
export const localDay = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
/** Start or end of a YYYY-MM-DD day in the viewer's time zone. */
const startOf = (day: string) => new Date(`${day}T00:00:00`);
const endOf = (day: string) => new Date(`${day}T23:59:59.999`);

/** The moments to send to the API for a preset (or chosen days). */
export function rangeFor(preset: RangePreset, fromDay: string, toDay: string, now = new Date()): MemberRange {
  const daysAgo = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - (n - 1)); return startOf(localDay(d)).toISOString(); };
  switch (preset) {
    case '30d': return { from: daysAgo(30) };
    case '90d': return { from: daysAgo(90) };
    case 'year': return { from: startOf(`${now.getFullYear()}-01-01`).toISOString() };
    case 'custom': return {
      ...(DAY.test(fromDay) ? { from: startOf(fromDay).toISOString() } : {}),
      ...(DAY.test(toDay) ? { to: endOf(toDay).toISOString() } : {}),
    };
    default: return {};
  }
}

/** The range in the URL, as state and as what to send to the API. */
export function useDateRange() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('range');
  const preset: RangePreset = PRESETS.some((p) => p.value === raw) ? (raw as RangePreset) : 'all';
  const fromDay = params.get('from') ?? '';
  const toDay = params.get('to') ?? '';
  const backwards = preset === 'custom' && DAY.test(fromDay) && DAY.test(toDay) && fromDay > toDay;
  const range = backwards ? {} : rangeFor(preset, fromDay, toDay);

  const set = (next: { preset?: RangePreset; from?: string; to?: string }) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      const value = next.preset ?? preset;
      if (value === 'all') p.delete('range'); else p.set('range', value);
      for (const k of ['from', 'to'] as const) {
        const v = value === 'custom' ? (next[k] ?? p.get(k) ?? '') : '';
        if (v) p.set(k, v); else p.delete(k);
      }
      return p;
    }, { replace: true });
  };

  /** The query string to keep the range when linking to another member page */
  const search = (() => {
    const p = new URLSearchParams();
    for (const k of ['range', 'from', 'to']) { const v = params.get(k); if (v) p.set(k, v); }
    const s = p.toString();
    return s ? `?${s}` : '';
  })();

  return { preset, fromDay, toDay, backwards, range, set, search, active: preset !== 'all' };
}

const control = 'h-9 rounded-md border border-input bg-background px-2 text-sm';

export function DateRangeFilter({ value }: { value: ReturnType<typeof useDateRange> }) {
  const { preset, fromDay, toDay, backwards, set } = value;
  const today = localDay(new Date());
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Date range" value={preset} onChange={(e) => {
        const next = e.target.value as RangePreset;
        // Custom starts from the last 30 days, to edit from there.
        if (next === 'custom' && !fromDay && !toDay) {
          const d = new Date(); d.setDate(d.getDate() - 29);
          set({ preset: next, from: localDay(d), to: today });
        } else set({ preset: next });
      }} className={control}>
        {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      {preset === 'custom' && (
        <>
          <input type="date" aria-label="From" value={fromDay} max={toDay || today} onChange={(e) => set({ from: e.target.value })} className={control} />
          <span className="text-sm text-muted-foreground">to</span>
          <input type="date" aria-label="To" value={toDay} min={fromDay || undefined} max={today} onChange={(e) => set({ to: e.target.value })} className={control} />
        </>
      )}
      {backwards && <span role="alert" className="text-xs text-yellow-300">The start is after the end, so all time is shown.</span>}
    </div>
  );
}
