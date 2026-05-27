import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Rocket, Plus, Trash2, Pencil, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fleetApi } from '@/api/fleet';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import type { FleetEntryDto, FleetyardsModelDto } from '@dem/shared';

// ── Ship combobox ─────────────────────────────────────────────────────────────

function ShipCombobox({
  placeholder,
  onSelect,
  value,
  onClear,
}: {
  placeholder: string;
  onSelect: (model: FleetyardsModelDto) => void;
  value: string;
  onClear: () => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { data: allModels = [] } = useQuery({
    queryKey: ['fleetyards-models'],
    queryFn: () => fleetApi.getModels(),
    staleTime: Infinity,
  });

  const needle = query.toLowerCase();
  const filtered = needle.length < 1
    ? []
    : allModels
        .filter(
          (m) =>
            m.name.toLowerCase().includes(needle) ||
            m.manufacturer.toLowerCase().includes(needle),
        )
        .sort((a, b) => {
          const aS = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
          const bS = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
          return aS - bS || a.name.localeCompare(b.name);
        })
        .slice(0, 25);

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full rounded-md border border-input bg-background pl-9 pr-9 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setOpen(false); onClear(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg max-h-64 overflow-y-auto">
          {filtered.map((m) => (
            <button
              key={m.slug}
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery(m.name);
                setOpen(false);
                onSelect(m);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
            >
              {m.imageUrl && (
                <img src={m.imageUrl} alt="" className="h-6 w-10 object-cover rounded shrink-0 opacity-80" />
              )}
              <span className="flex-1 truncate font-medium">{m.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">{m.manufacturer}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Fleet row (inline editor) ─────────────────────────────────────────────────

function FleetRow({
  entry,
  guildId,
  onDelete,
}: {
  entry: FleetEntryDto;
  guildId: string;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(entry.quantity));
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [saveError, setSaveError] = useState('');

  const saveMutation = useMutation({
    mutationFn: () => {
      const quantity = parseInt(qty, 10);
      if (isNaN(quantity) || quantity < 1) throw new Error('Quantity must be at least 1');
      return fleetApi.upsertEntry(guildId, {
        id: entry.id,
        shipSlug: entry.shipSlug,
        shipName: entry.shipName,
        manufacturer: entry.manufacturer,
        quantity,
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet-my', guildId] });
      setSaveError('');
      setEditing(false);
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => fleetApi.deleteEntry(guildId, entry.id),
    onSuccess: onDelete,
  });

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 py-2 text-sm">
        <div className="flex-1 min-w-0">
          <span className="font-medium">{entry.shipName}</span>
          <span className="ml-1.5 text-xs text-muted-foreground">{entry.manufacturer}</span>
        </div>
        <input
          type="number"
          min={1}
          step={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-20 rounded border border-input bg-background px-2 py-1 text-sm text-right outline-none focus:ring-1 focus:ring-ring"
          placeholder="Qty"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-48 rounded border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
          placeholder="Notes (optional)"
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
        <span className="font-medium">{entry.shipName}</span>
        <span className="ml-1.5 text-xs text-muted-foreground">{entry.manufacturer}</span>
        {entry.notes && (
          <span className="ml-2 text-xs text-muted-foreground italic">— {entry.notes}</span>
        )}
      </div>
      <div className="flex items-center gap-3 text-muted-foreground shrink-0">
        {entry.quantity > 1 && <span className="tabular-nums text-xs">×{entry.quantity}</span>}
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

// ── Tab: Search ───────────────────────────────────────────────────────────────

function SearchTab({ guildId }: { guildId: string }) {
  const [selected, setSelected] = useState<FleetyardsModelDto | null>(null);
  const [labelValue, setLabelValue] = useState('');

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['fleet-search', guildId, selected?.slug],
    queryFn: () => (selected ? fleetApi.search(guildId, selected.slug) : Promise.resolve([])),
    enabled: !!selected,
  });

  return (
    <div className="space-y-4">
      <ShipCombobox
        placeholder="Search for a ship…"
        onSelect={(m) => { setSelected(m); setLabelValue(m.name); }}
        value={labelValue}
        onClear={() => { setSelected(null); setLabelValue(''); }}
      />

      {selected && isFetching && (
        <div className="space-y-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
        </div>
      )}

      {selected && !isFetching && results.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No members currently have a <span className="font-medium text-foreground">{selected.name}</span> registered.
        </p>
      )}

      {selected && !isFetching && results.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              {selected.name}
              <span className="text-xs font-normal text-muted-foreground">{selected.manufacturer}</span>
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {results.length} member{results.length !== 1 ? 's' : ''}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {results.map((entry) => (
                <div key={entry.userId} className="flex items-center justify-between py-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{entry.username}</span>
                    {entry.notes && (
                      <span className="ml-2 text-xs text-muted-foreground italic">— {entry.notes}</span>
                    )}
                  </div>
                  {entry.quantity > 1 && (
                    <span className="tabular-nums text-xs text-muted-foreground shrink-0">×{entry.quantity}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Tab: My Fleet ─────────────────────────────────────────────────────────────

function MyFleetTab({ guildId }: { guildId: string }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [selected, setSelected] = useState<FleetyardsModelDto | null>(null);
  const [labelValue, setLabelValue] = useState('');
  const [qty, setQty] = useState('1');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');

  const { data: fleet = [], isLoading } = useQuery({
    queryKey: ['fleet-my', guildId],
    queryFn: () => fleetApi.getMyFleet(guildId),
  });

  const addMutation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('No ship selected');
      const quantity = parseInt(qty, 10);
      if (isNaN(quantity) || quantity < 1) throw new Error('Quantity must be at least 1');
      return fleetApi.upsertEntry(guildId, {
        shipSlug: selected.slug,
        shipName: selected.name,
        manufacturer: selected.manufacturer,
        quantity,
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet-my', guildId] });
      setSelected(null);
      setLabelValue('');
      setQty('1');
      setNotes('');
      setFormError('');
    },
    onError: (err: Error) => setFormError(err.message),
  });

  return (
    <div className="space-y-6">
      {/* ── Add ship form ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add Ship
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ShipCombobox
            placeholder="Search for a ship to add…"
            onSelect={(m) => { setSelected(m); setLabelValue(m.name); }}
            value={labelValue}
            onClear={() => { setSelected(null); setLabelValue(''); }}
          />

          <div className="flex flex-wrap gap-2">
            <div className="w-28">
              <label className="text-xs text-muted-foreground block mb-1">Quantity</label>
              <input
                type="number"
                min={1}
                step={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs text-muted-foreground block mb-1">Notes (optional)</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. daily driver, cargo loadout…"
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
            {addMutation.isPending ? 'Saving…' : 'Add to Fleet'}
          </Button>
        </CardContent>
      </Card>

      {/* ── My fleet list ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Rocket className="h-4 w-4" />
            My Fleet
            {user && (
              <span className="text-xs font-normal text-muted-foreground ml-1">
                — {user.globalName ?? user.username}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 rounded" />)}
            </div>
          )}

          {!isLoading && fleet.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Your fleet is empty. Add ships above.
            </p>
          )}

          {!isLoading && fleet.length > 0 && (
            <div className="divide-y divide-border">
              {fleet.map((entry) => (
                <FleetRow
                  key={entry.id}
                  entry={entry}
                  guildId={guildId}
                  onDelete={() => queryClient.invalidateQueries({ queryKey: ['fleet-my', guildId] })}
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

const TABS = ['Search', 'My Fleet'] as const;
type Tab = (typeof TABS)[number];

export function FleetPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [activeTab, setActiveTab] = useState<Tab>('Search');

  if (!guildId) return null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Fleet Registry</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse your org's ships or register your own fleet.
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
      {activeTab === 'My Fleet' && <MyFleetTab guildId={guildId} />}
    </div>
  );
}
