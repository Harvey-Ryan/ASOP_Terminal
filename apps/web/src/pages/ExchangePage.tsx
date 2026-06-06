import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Package, Plus, Trash2, Pencil, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { exchangeApi } from '@/api/exchange';
import { uexApi } from '@/api/uex';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import type { InventoryEntryDto, InventorySearchGroup, UexItemDto, UexCommodityDto, InventoryItemType } from '@dem/shared';

// ── Types ─────────────────────────────────────────────────────────────────────

type UexResult =
  | { type: 'ITEM'; item: UexItemDto }
  | { type: 'COMMODITY'; item: UexCommodityDto };

// ── UEX autocomplete ──────────────────────────────────────────────────────────

function UexCombobox({
  placeholder,
  onSelect,
  value,
  onClear,
}: {
  placeholder: string;
  onSelect: (result: UexResult) => void;
  value: string;
  onClear: () => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(query, 250);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { data: items = [] } = useQuery({
    queryKey: ['uex-items', debouncedQuery],
    queryFn: () => uexApi.getItems({ q: debouncedQuery, limit: 50 }),
    enabled: debouncedQuery.length >= 2 && open,
    staleTime: 60_000,
  });

  const { data: commodities = [] } = useQuery({
    queryKey: ['uex-commodities', debouncedQuery],
    queryFn: () => uexApi.getCommodities({ q: debouncedQuery, limit: 50 }),
    enabled: debouncedQuery.length >= 2 && open,
    staleTime: 60_000,
  });

  const needle = debouncedQuery.toLowerCase();
  const rank = (name: string) => (name.toLowerCase().startsWith(needle) ? 0 : 1);
  const results: UexResult[] = [
    ...items.map((i): UexResult => ({ type: 'ITEM', item: i })),
    ...commodities.map((c): UexResult => ({ type: 'COMMODITY', item: c })),
  ].sort((a, b) => rank(a.item.name) - rank(b.item.name) || a.item.name.localeCompare(b.item.name)).slice(0, 25);

  function select(r: UexResult) {
    setQuery(r.item.name);
    setOpen(false);
    onSelect(r);
  }

  function clear() {
    setQuery('');
    onClear();
  }

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (query.length >= 2) setOpen(true); }}
          placeholder={placeholder}
          className="w-full rounded-md border border-input bg-background pl-9 pr-9 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        {query && (
          <button onClick={clear} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg max-h-64 overflow-y-auto">
          {results.map((r) => (
            <button
              key={`${r.type}-${r.item.id}`}
              onMouseDown={(e) => { e.preventDefault(); select(r); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
            >
              <span className="text-xs rounded px-1.5 py-0.5 font-mono bg-muted text-muted-foreground shrink-0">
                {r.type === 'COMMODITY' ? 'COM' : 'ITEM'}
              </span>
              <span className="truncate">{r.item.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab 1 — Search ────────────────────────────────────────────────────────────

function SearchTab({ guildId }: { guildId: string }) {
  const [selected, setSelected] = useState<UexResult | null>(null);
  const [labelValue, setLabelValue] = useState('');

  const { data: groups = [], isFetching } = useQuery({
    queryKey: ['exchange-search', guildId, selected?.type, selected?.item.id],
    queryFn: () =>
      selected
        ? exchangeApi.search(guildId, selected.type, selected.item.id)
        : Promise.resolve<InventorySearchGroup[]>([]),
    enabled: !!selected,
  });

  function handleSelect(r: UexResult) {
    setSelected(r);
    setLabelValue(r.item.name);
  }

  function handleClear() {
    setSelected(null);
    setLabelValue('');
  }

  return (
    <div className="space-y-4">
      <UexCombobox
        placeholder="Search for an item or commodity…"
        onSelect={handleSelect}
        value={labelValue}
        onClear={handleClear}
      />

      {selected && isFetching && (
        <div className="space-y-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
      )}

      {selected && !isFetching && groups.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No members currently have <span className="font-medium text-foreground">{selected.item.name}</span> in their inventory.
        </p>
      )}

      {groups.map((group) => (
        <Card key={String(group.qualityLevel)}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              {group.itemName}
              {group.qualityLevel !== null && (
                <span className="text-xs font-normal bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                  QL {group.qualityLevel}
                </span>
              )}
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {group.entries.length} member{group.entries.length !== 1 ? 's' : ''}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {group.entries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium">{entry.username}</span>
                  <div className="flex items-center gap-4 text-muted-foreground">
                    {entry.location && <span className="text-xs">📍 {entry.location}</span>}
                    <span className="tabular-nums">
                      {group.itemType === 'COMMODITY' ? '' : '×'}
                      {entry.quantity % 1 === 0 ? entry.quantity.toFixed(0) : entry.quantity.toFixed(entry.itemType === 'COMMODITY' ? 3 : 2)}
                      {group.itemType === 'COMMODITY' ? ' cSCU' : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Inline row editor ─────────────────────────────────────────────────────────

function InventoryRow({
  entry,
  guildId,
  onDelete,
}: {
  entry: InventoryEntryDto;
  guildId: string;
  onDelete: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(entry.quantity));
  const [ql, setQl] = useState(entry.qualityLevel !== null ? String(entry.qualityLevel) : '');
  const [loc, setLoc] = useState(entry.location ?? '');
  const [saveError, setSaveError] = useState('');

  const saveMutation = useMutation({
    mutationFn: () => {
      if (entry.itemType === 'COMMODITY' && ql === '') throw new Error('Quality Level is required for commodities');
      return exchangeApi.upsertEntry(guildId, {
        id: entry.id,
        itemType: entry.itemType,
        externalItemId: entry.externalItemId,
        itemName: entry.itemName,
        quantity: parseFloat(qty) || 0,
        qualityLevel: ql !== '' ? parseInt(ql, 10) : null,
        location: loc.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-inventory', guildId] });
      setSaveError('');
      setEditing(false);
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => exchangeApi.deleteEntry(guildId, entry.id),
    onSuccess: () => onDelete(entry.id),
  });

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 py-2 text-sm">
        <span className="font-medium min-w-0 flex-1">{entry.itemName}</span>
        <input
          type="number"
          min={0}
          step={entry.itemType === 'COMMODITY' ? 0.001 : 1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-24 rounded border border-input bg-background px-2 py-1 text-sm text-right outline-none focus:ring-1 focus:ring-ring"
          placeholder="Qty"
        />
        <input
          type="number"
          min={0}
          max={1000}
          step={1}
          value={ql}
          onChange={(e) => setQl(e.target.value)}
          className="w-20 rounded border border-input bg-background px-2 py-1 text-sm text-right outline-none focus:ring-1 focus:ring-ring"
          placeholder={entry.itemType === 'COMMODITY' ? 'QL *' : 'QL'}
        />
        <input
          value={loc}
          onChange={(e) => setLoc(e.target.value)}
          className="w-36 rounded border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
          placeholder="Location"
        />
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="text-green-500 hover:text-green-400 disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
        </button>
        <button onClick={() => { setEditing(false); setSaveError(''); }} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
        {saveError && <p className="w-full text-xs text-destructive -mt-1">{saveError}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-2 text-sm group">
      <div className="flex-1 min-w-0">
        <span className="font-medium">{entry.itemName}</span>
        <span className="ml-2 text-xs rounded px-1.5 py-0.5 font-mono bg-muted text-muted-foreground">
          {entry.itemType === 'COMMODITY' ? 'COM' : 'ITEM'}
        </span>
      </div>
      <div className="flex items-center gap-3 text-muted-foreground shrink-0">
        {entry.qualityLevel !== null && (
          <span className="text-xs">QL {entry.qualityLevel}</span>
        )}
        {entry.location && <span className="text-xs">📍 {entry.location}</span>}
        <span className="tabular-nums">
          {entry.itemType === 'COMMODITY' ? '' : '×'}
          {entry.quantity % 1 === 0 ? entry.quantity.toFixed(0) : entry.quantity.toFixed(entry.itemType === 'COMMODITY' ? 3 : 2)}
          {entry.itemType === 'COMMODITY' ? ' cSCU' : ''}
        </span>
        <button
          onClick={() => setEditing(true)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive/80 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Tab 2 — My Inventory ──────────────────────────────────────────────────────

function InventoryTab({ guildId }: { guildId: string }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [selected, setSelected] = useState<UexResult | null>(null);
  const [labelValue, setLabelValue] = useState('');
  const [qty, setQty] = useState('1');
  const [ql, setQl] = useState('');
  const [loc, setLoc] = useState('');
  const [formError, setFormError] = useState('');

  const { data: inventory = [], isLoading } = useQuery({
    queryKey: ['exchange-inventory', guildId],
    queryFn: () => exchangeApi.getMyInventory(guildId),
  });

  const addMutation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('No item selected');
      const quantity = parseFloat(qty);
      if (isNaN(quantity) || quantity < 0) throw new Error('Invalid quantity');
      if (selected.type === 'COMMODITY' && ql === '') throw new Error('Quality Level is required for commodities');
      const qualityLevel = ql !== '' ? parseInt(ql, 10) : null;
      if (qualityLevel !== null && (isNaN(qualityLevel) || qualityLevel < 0 || qualityLevel > 1000)) {
        throw new Error('QL must be 0–1000');
      }
      return exchangeApi.upsertEntry(guildId, {
        itemType: selected.type,
        externalItemId: selected.item.id,
        itemName: selected.item.name,
        quantity,
        qualityLevel,
        location: loc.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-inventory', guildId] });
      setSelected(null);
      setLabelValue('');
      setQty('1');
      setQl('');
      setLoc('');
      setFormError('');
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const isCommodity = selected?.type === 'COMMODITY';

  return (
    <div className="space-y-6">
      {/* ── Add item form ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add Item
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <UexCombobox
            placeholder="Search for an item or commodity to add…"
            onSelect={(r) => { setSelected(r); setLabelValue(r.item.name); setQl(''); }}
            value={labelValue}
            onClear={() => { setSelected(null); setLabelValue(''); }}
          />

          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[100px]">
              <label className="text-xs text-muted-foreground block mb-1">
                {isCommodity ? 'Quantity ( cSCU )' : 'Quantity'}
              </label>
              <input
                type="number"
                min={0}
                step={isCommodity ? 0.001 : 1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="w-28">
              <label className="text-xs text-muted-foreground block mb-1">
                Quality (0–1000){isCommodity ? ' *' : ''}
              </label>
              <input
                type="number"
                min={0}
                max={1000}
                step={1}
                value={ql}
                onChange={(e) => setQl(e.target.value)}
                placeholder={isCommodity ? 'Required' : 'Optional'}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-muted-foreground block mb-1">Location (optional)</label>
              <input
                value={loc}
                onChange={(e) => setLoc(e.target.value)}
                placeholder="e.g. Lorville - TDD"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {formError && <p className="text-xs text-destructive">{formError}</p>}

          <Button
            size="sm"
            onClick={() => addMutation.mutate()}
            disabled={!selected || addMutation.isPending}
          >
            {addMutation.isPending ? 'Saving…' : 'Add to Inventory'}
          </Button>
        </CardContent>
      </Card>

      {/* ── My inventory list ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            My Inventory
            {user && <span className="text-xs font-normal text-muted-foreground ml-1">— {user.globalName ?? user.username}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 rounded" />)}
            </div>
          )}

          {!isLoading && inventory.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Your inventory is empty. Add items above.
            </p>
          )}

          {!isLoading && inventory.length > 0 && (
            <div className="divide-y divide-border">
              {inventory.map((entry) => (
                <InventoryRow
                  key={entry.id}
                  entry={entry}
                  guildId={guildId}
                  onDelete={() => queryClient.invalidateQueries({ queryKey: ['exchange-inventory', guildId] })}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TABS = ['Search', 'My Inventory'] as const;
type Tab = (typeof TABS)[number];

export function ExchangePage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [activeTab, setActiveTab] = useState<Tab>('Search');

  if (!guildId) return null;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Exchange</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse member inventories or manage your own stock.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Search' && <SearchTab guildId={guildId} />}
      {activeTab === 'My Inventory' && <InventoryTab guildId={guildId} />}
    </div>
  );
}
