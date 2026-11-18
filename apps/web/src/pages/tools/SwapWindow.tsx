// The swap window (v1.47.0): one window per slot, Erkul-style. Every item
// that fits, every stat as a sortable column (click; shift-click adds a
// second sort), filters, search, and the difference from what's fitted.
// Used for guns, components and missiles.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fmt } from '../../lib/gameTools';

export interface SwapColumn<T> {
  key: string;
  label: string;
  /** The value sorted on (numbers) or shown (text). */
  get: (x: T) => number | string | null | undefined;
  digits?: number;
  /** Lower is better (spool time, EM…): sorts ascending first and colours the difference the other way. */
  low?: boolean;
  /** How the cell reads, when not just the number. */
  render?: (x: T) => ReactNode;
  /** Text column: left-aligned, never a difference. */
  text?: boolean;
}

export interface SwapFilter<T> {
  label: string;
  get: (x: T) => string | null | undefined;
}

interface Sort { key: string; dir: 1 | -1 }

export function SwapWindow<T>({ eyebrow, title, items, columns, filters, searchText, idOf, nameOf, subOf, fittedId, stockId, defaultSort, onPick, onStock, onClose, note, locked }: {
  eyebrow: string;
  title: string;
  items: T[];
  columns: SwapColumn<T>[];
  filters: SwapFilter<T>[];
  searchText: (x: T) => string;
  idOf: (x: T) => string;
  nameOf: (x: T) => string;
  subOf: (x: T) => string;
  fittedId: string | null;
  stockId: string | null;
  defaultSort: string;
  onPick: (x: T) => void;
  onStock?: () => void;
  onClose: () => void;
  note?: ReactNode;
  /** Shown instead of the list's "click to fit" when the slot can't change. */
  locked?: string;
}) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const colOf = (key: string) => columns.find((c) => c.key === key);
  const firstDir = (key: string): 1 | -1 => (colOf(key)?.low || colOf(key)?.text ? 1 : -1);
  const [sorts, setSorts] = useState<Sort[]>([{ key: defaultSort, dir: firstDir(defaultSort) }]);
  const searchRef = useRef<HTMLInputElement>(null);
  const backTo = useRef<Element | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Opened: focus the search, lock the page behind, Escape closes; closed: focus back where it was.
  useEffect(() => {
    backTo.current = document.activeElement;
    searchRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      (backTo.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  const fitted = items.find((x) => idOf(x) === fittedId) ?? null;
  const filterOptions = useMemo(() => filters.map((f) => {
    const seen = new Set<string>();
    for (const x of items) { const v = f.get(x); if (v) seen.add(v); }
    return [...seen].sort();
  }), [filters, items]);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = items.filter((x) => {
      if (filters.some((f) => chosen[f.label] && f.get(x) !== chosen[f.label])) return false;
      const hay = searchText(x).toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const val = (x: T, key: string) => colOf(key)?.get(x);
    return list.sort((a, b) => {
      for (const s of sorts) {
        const av = val(a, s.key), bv = val(b, s.key);
        if (av === bv) continue;
        if (av == null) return 1;
        if (bv == null) return -1;
        const d = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
        if (d) return d * s.dir;
      }
      return nameOf(a).localeCompare(nameOf(b));
    });
  }, [items, query, chosen, sorts]); // eslint-disable-line react-hooks/exhaustive-deps

  const primary = colOf(sorts[0]!.key);
  const sortBy = (key: string, add: boolean) => setSorts((now) => {
    const [first, second] = now;
    if (add && first && first.key !== key) {
      return [first, { key, dir: second?.key === key ? (second.dir === 1 ? -1 : 1) : firstDir(key) }];
    }
    return [{ key, dir: first?.key === key ? (first.dir === 1 ? -1 : 1) : firstDir(key) }];
  });
  const arrow = (key: string) => {
    const i = sorts.findIndex((s) => s.key === key);
    if (i < 0) return '';
    return `${sorts[i]!.dir === 1 ? ' ▲' : ' ▼'}${sorts.length > 1 ? i + 1 : ''}`;
  };

  return (
    <div className="gt-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="gt-swap-h" className="gt-modal">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-3">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="gt-label gt-label-acc">{eyebrow}</span>
            <h2 id="gt-swap-h" className="m-0 text-2xl font-bold gt-hi">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="gt-btn" style={{ width: 44, height: 44, padding: 0 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 px-5 sm:px-6 pb-4" style={{ borderBottom: '1px solid var(--gt-line)' }}>
          <label className="flex flex-col gap-1 flex-[1_1_240px]">
            <span className="gt-label" style={{ fontSize: 11 }}>Search</span>
            <input ref={searchRef} type="search" className="gt-input" placeholder="Name, maker or type…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {filters.map((f, i) => filterOptions[i]!.length > 1 && (
            <div key={f.label} className="flex flex-col gap-1 min-w-0 max-w-full">
              <span className="gt-label" style={{ fontSize: 11 }}>{f.label}</span>
              <div className="flex flex-nowrap sm:flex-wrap gap-1.5 overflow-x-auto">
                {['All', ...filterOptions[i]!].map((o) => {
                  const on = (chosen[f.label] ?? 'All') === o;
                  return <button key={o} type="button" className="gt-chip" aria-pressed={on} onClick={() => setChosen((c) => ({ ...c, [f.label]: o === 'All' ? '' : o }))}>{o}</button>;
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="gt-scroll flex-1 min-h-0">
          <table className="gt-table gt-swap-table">
            <thead>
              <tr>
                {columns.map((c, i) => (
                  <th key={c.key} className={c.text ? '' : 'num'} style={i === 0 ? { paddingLeft: 24 } : undefined}>
                    <button type="button" aria-pressed={sorts[0]!.key === c.key} className="whitespace-nowrap" title="Click to sort; shift-click to add a second sort"
                      onClick={(e) => sortBy(c.key, e.shiftKey || e.ctrlKey || e.metaKey)}>{c.label}{arrow(c.key)}</button>
                  </th>
                ))}
                {primary && !primary.text && <th className="num" style={{ paddingRight: 24 }}>{primary.label} vs fitted</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => {
                const id = idOf(x);
                const on = id === fittedId;
                let diff: ReactNode = null;
                if (primary && !primary.text) {
                  const now = primary.get(x), was = fitted ? primary.get(fitted) : null;
                  if (on) diff = <span className="gt-acc">fitted</span>;
                  else if (typeof now === 'number' && typeof was === 'number') {
                    const d = now - was;
                    const tiny = Math.abs(d) < (primary.digits ? 0.5 * 10 ** -primary.digits : 0.5);
                    const good = primary.low ? d < 0 : d > 0;
                    diff = <span className={tiny ? 'gt-dim' : good ? 'gt-good' : 'gt-bad'}>{tiny ? '0' : `${d > 0 ? '+' : '−'}${fmt(Math.abs(d), primary.digits ?? 0)}`}</span>;
                  } else diff = <span className="gt-dim">–</span>;
                }
                return (
                  <tr key={id} className={on ? 'is-on' : ''}>
                    {columns.map((c, i) => {
                      if (i === 0) {
                        return (
                          <td key={c.key} style={{ paddingLeft: 24, minWidth: 210 }}>
                            <button type="button" className="gt-cellbtn" disabled={!!locked} onClick={() => onPick(x)}>{nameOf(x)}</button>
                            <span className="block text-xs gt-dim">{subOf(x)}{id === stockId ? ' · stock' : ''}{on ? ' · fitted' : ''}</span>
                          </td>
                        );
                      }
                      const v = c.get(x);
                      return (
                        <td key={c.key} className={c.text ? 'text-sm' : `num${sorts[0]!.key === c.key ? ' gt-hi' : ''}`}>
                          {c.render ? c.render(x) : typeof v === 'number' ? fmt(v, c.digits ?? 0) : v ?? '–'}
                        </td>
                      );
                    })}
                    {primary && !primary.text && <td className="num" style={{ paddingRight: 24 }}>{diff}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!shown.length && <p className="gt-dim px-6 py-6 m-0">Nothing matches that.</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 sm:px-6 py-4" style={{ borderTop: '1px solid var(--gt-line)' }}>
          <span className="text-sm gt-dim">
            <b className="gt-acc">{shown.length} of {items.length}</b> fit this slot
            <span className="hidden sm:inline"> · {locked ?? 'click a name to fit it · shift-click a column for a second sort'}{note ? <> · {note}</> : null}</span>
            {locked && <span className="sm:hidden"> · {locked}</span>}
          </span>
          <div className="flex flex-wrap gap-2">
            {onStock && !locked && fittedId !== stockId && <button type="button" className="gt-btn" onClick={onStock}>Back to stock</button>}
            <button type="button" className="gt-btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
