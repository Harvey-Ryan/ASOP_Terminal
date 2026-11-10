import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import type { CatalogKind } from '@dem/shared';
import { catalogApi } from '@/api/catalog';
import { useDebounce } from '@/hooks/useDebounce';

// Search box for picking a game item or commodity (game item catalog, sc-data).

export interface PickedItem {
  type: CatalogKind;
  /** Catalog ref, "ITEM:<uuid>" / "COMMODITY:<uuid>". */
  ref: string;
  name: string;
  detail: string;
}

export function ItemCombobox({
  placeholder,
  onSelect,
  value,
  onClear,
}: {
  placeholder: string;
  onSelect: (picked: PickedItem) => void;
  value: string;
  onClear: () => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(query, 200);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { data: results = [] } = useQuery({
    queryKey: ['catalog-search', debouncedQuery],
    queryFn: () => catalogApi.search(debouncedQuery, { limit: 25 }),
    enabled: debouncedQuery.trim().length >= 2 && open,
    staleTime: 5 * 60_000,
  });

  useEffect(() => { setHighlight(-1); }, [results]);

  function select(i: number) {
    const r = results[i];
    if (!r) return;
    setQuery(r.name);
    setOpen(false);
    onSelect({ type: r.kind, ref: r.ref, name: r.name, detail: r.detail });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? Math.min(highlight + 1, results.length - 1) : Math.max(highlight - 1, 0);
      setHighlight(next);
      (listRef.current?.children[next] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && highlight >= 0) {
      e.preventDefault();
      select(highlight);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (query.length >= 2) setOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="w-full rounded-md border border-input bg-background pl-9 pr-9 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        {query && (
          <button type="button" onClick={() => { setQuery(''); onClear(); }} aria-label="Clear" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div ref={listRef} className="absolute z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg max-h-64 overflow-y-auto">
          {results.map((r, i) => (
            <button
              type="button"
              key={r.ref}
              onMouseDown={(e) => { e.preventDefault(); select(i); }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm text-left ${i === highlight ? 'bg-accent' : 'hover:bg-accent'}`}
            >
              <span className={`text-[10px] rounded px-1.5 py-0.5 font-medium shrink-0 ${r.kind === 'COMMODITY' ? 'bg-amber-500/10 text-amber-500' : 'bg-primary/10 text-primary'}`}>
                {r.kind === 'COMMODITY' ? 'COM' : 'ITEM'}
              </span>
              <span className="truncate">{r.name}</span>
              <span className="ml-auto text-xs text-muted-foreground truncate max-w-[45%]">{r.detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
