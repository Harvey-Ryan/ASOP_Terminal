import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2, XCircle, Loader2, Database, Clock, AlertTriangle, Search, Tag, Layers, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { uexApi } from '@/api/uex';
import { useDebounce } from '@/hooks/useDebounce';
import type { UexSyncLogDto, UexItemDto, UexCommodityDto } from '@dem/shared';

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)   return 'just now';
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  return `${days}d ago`;
}

function duration(log: UexSyncLogDto): string {
  if (!log.completedAt) return '—';
  const secs = Math.round((new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()) / 1000);
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === 'RUNNING') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[11px] font-medium text-amber-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        Running
      </span>
    );
  }
  if (status === 'SUCCESS') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 border border-green-500/30 px-2 py-0.5 text-[11px] font-medium text-green-500">
        <CheckCircle2 className="h-3 w-3" />
        Success
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 border border-destructive/30 px-2 py-0.5 text-[11px] font-medium text-destructive">
      <XCircle className="h-3 w-3" />
      Failed
    </span>
  );
}

// ── Stat tile ─────────────────────────────────────────────────────────────────

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-center">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

// ── Log row ───────────────────────────────────────────────────────────────────

function LogRow({ log }: { log: UexSyncLogDto }) {
  const totalAdded   = log.categoriesAdded   + log.itemsAdded   + log.commoditiesAdded;
  const totalUpdated = log.categoriesUpdated + log.itemsUpdated + log.commoditiesUpdated;

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4 gap-y-1 rounded-md border border-border px-3 py-2.5 text-sm">
      <div className="min-w-0">
        <p className="font-medium truncate">{formatDate(log.startedAt)}</p>
        <p className="text-xs text-muted-foreground mt-0.5 capitalize">{log.trigger.toLowerCase()}</p>
      </div>
      <StatusBadge status={log.status} />
      <div className="text-right">
        <p className="text-xs text-muted-foreground">Added</p>
        <p className="font-medium text-green-500">+{totalAdded}</p>
      </div>
      <div className="text-right">
        <p className="text-xs text-muted-foreground">Updated</p>
        <p className="font-medium text-primary">~{totalUpdated}</p>
      </div>
      <div className="text-right">
        <p className="text-xs text-muted-foreground">Time</p>
        <p className="font-medium">{duration(log)}</p>
      </div>
      {log.status === 'FAILED' && log.error && (
        <div className="col-span-full mt-1.5 flex items-start gap-1.5 rounded-md bg-destructive/10 border border-destructive/20 px-2.5 py-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="break-all">{log.error}</span>
        </div>
      )}
    </div>
  );
}

// ── Search result cards ───────────────────────────────────────────────────────

function ItemCard({ item }: { item: UexItemDto }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5 space-y-1.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-sm text-foreground leading-tight">{item.name}</p>
        <span className="shrink-0 rounded-full bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">Item</span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
        <span><span className="text-foreground/60">ID:</span> {item.id}</span>
        <span><span className="text-foreground/60">Category:</span> {item.categoryName || '—'}</span>
        {item.slug && <span><span className="text-foreground/60">Slug:</span> {item.slug}</span>}
        {item.section && <span><span className="text-foreground/60">Section:</span> {item.section}</span>}
        {item.size && <span><span className="text-foreground/60">Size:</span> {item.size}</span>}
        {item.gameVersion && <span><span className="text-foreground/60">Version:</span> {item.gameVersion}</span>}
      </div>

      <div className="flex flex-wrap gap-1 pt-0.5">
        {item.isCommodity   && <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">commodity</span>}
        {item.isHarvestable && <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">harvestable</span>}
      </div>

      {item.attributes.length > 0 && (
        <div className="border-t border-border pt-1.5 space-y-0.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Attributes</p>
          {item.attributes.map((a, i) => (
            <div key={i} className="flex gap-1.5">
              {a.name && <span className="text-foreground/60 shrink-0">{a.name}:</span>}
              <span className="text-foreground">{a.value}{a.unit ? ` ${a.unit}` : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommodityCard({ com }: { com: UexCommodityDto }) {
  const flags = [
    com.isMineral    && 'mineral',
    com.isRaw        && 'raw',
    com.isRefined    && 'refined',
    com.isHarvestable && 'harvestable',
    com.isFuel       && 'fuel',
    com.isIllegal    && 'illegal',
  ].filter(Boolean) as string[];

  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5 space-y-1.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-sm text-foreground leading-tight">{com.name}</p>
        <span className="shrink-0 rounded-full bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">Commodity</span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
        <span><span className="text-foreground/60">ID:</span> {com.id}</span>
        <span><span className="text-foreground/60">Code:</span> {com.code || '—'}</span>
        {com.slug && <span><span className="text-foreground/60">Slug:</span> {com.slug}</span>}
        {com.weightScu   != null && <span><span className="text-foreground/60">Weight:</span> {com.weightScu} SCU</span>}
        {com.priceAvgBuy  != null && <span><span className="text-foreground/60">Buy avg:</span> {com.priceAvgBuy.toLocaleString()} aUEC</span>}
        {com.priceAvgSell != null && <span><span className="text-foreground/60">Sell avg:</span> {com.priceAvgSell.toLocaleString()} aUEC</span>}
      </div>

      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {flags.map((f) => (
            <span key={f} className={`rounded-sm px-1.5 py-0.5 text-[10px] ${f === 'illegal' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>{f}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Search panel ──────────────────────────────────────────────────────────────

type SearchMode = 'items' | 'commodities';

function SearchPanel() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('items');
  const debouncedQuery = useDebounce(query, 300);

  const itemsQuery = useQuery({
    queryKey: ['uex-search-items', debouncedQuery],
    queryFn: () => uexApi.getItems({ q: debouncedQuery, limit: 50 }),
    enabled: mode === 'items',
  });

  const commoditiesQuery = useQuery({
    queryKey: ['uex-search-commodities', debouncedQuery],
    queryFn: () => uexApi.getCommodities({ q: debouncedQuery, limit: 50 }),
    enabled: mode === 'commodities',
  });

  const isLoading = mode === 'items' ? itemsQuery.isFetching : commoditiesQuery.isFetching;
  const results   = mode === 'items' ? (itemsQuery.data ?? []) : (commoditiesQuery.data ?? []);

  return (
    <div className="flex flex-col h-full rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border space-y-3 shrink-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Search className="h-3.5 w-3.5" />
          Database Search
        </p>

        {/* Mode toggle */}
        <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
          <button
            onClick={() => setMode('items')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 transition-colors ${mode === 'items' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
          >
            <Package className="h-3 w-3" />
            Items
          </button>
          <button
            onClick={() => setMode('commodities')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 transition-colors ${mode === 'commodities' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
          >
            <Layers className="h-3 w-3" />
            Commodities
          </button>
        </div>

        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${mode}…`}
            className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
          />
          {isLoading && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground animate-spin" />
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {results.length > 0
            ? `${results.length} result${results.length !== 1 ? 's' : ''}${results.length === 50 ? ' (showing first 50)' : ''}`
            : debouncedQuery
            ? 'No results'
            : 'Type to search'}
        </p>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {results.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <Tag className="h-6 w-6 text-muted-foreground opacity-40 mb-2" />
            <p className="text-xs text-muted-foreground">
              {debouncedQuery ? 'No matches found.' : `Start typing to search ${mode}.`}
            </p>
          </div>
        )}

        {mode === 'items' && (itemsQuery.data ?? []).map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}

        {mode === 'commodities' && (commoditiesQuery.data ?? []).map((com) => (
          <CommodityCard key={com.id} com={com} />
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function GameDataPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ['uex-status'],
    queryFn: () => uexApi.getStatus(),
    refetchInterval: (query) => (query.state.data?.isRunning ? 3000 : false),
  });

  const syncMutation = useMutation({
    mutationFn: () => uexApi.triggerSync(guildId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uex-status'] });
    },
  });

  const status  = statusQuery.data;
  const isRunning = status?.isRunning ?? false;
  const lastSync  = status?.lastSync ?? null;
  const counts    = status?.counts;
  const recentLogs: UexSyncLogDto[] = lastSync ? [lastSync] : [];

  return (
    <div className="flex gap-6 h-full">
      {/* ── Left: sync management ── */}
      <div className="w-[520px] shrink-0 space-y-8 overflow-y-auto pr-1">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Database className="h-6 w-6 text-primary" />
            Game Data
          </h1>
          <p className="mt-1 text-muted-foreground">
            Local cache of Star Citizen items, commodities, and categories sourced from{' '}
            <span className="font-medium text-foreground">UEX Corp</span>. Updated automatically every Monday.
          </p>
        </div>

        {statusQuery.isLoading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-20 rounded-lg" />
            </div>
            <Skeleton className="h-16 rounded-lg" />
          </div>
        ) : (
          <>
            {/* Cache stats */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cached Records</p>
              <div className="grid grid-cols-3 gap-3">
                <StatTile label="Categories"  value={counts?.categories  ?? 0} />
                <StatTile label="Items"        value={counts?.items        ?? 0} />
                <StatTile label="Commodities"  value={counts?.commodities  ?? 0} />
              </div>
            </div>

            {/* Sync control */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sync</p>
              <div className="rounded-lg border border-border bg-card p-4 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4 shrink-0" />
                    {isRunning ? (
                      <span className="text-amber-500 font-medium">Sync in progress…</span>
                    ) : lastSync?.completedAt ? (
                      <span>Last synced <span className="text-foreground font-medium">{timeAgo(lastSync.completedAt)}</span></span>
                    ) : (
                      <span>Never synced</span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => syncMutation.mutate()}
                    disabled={isRunning || syncMutation.isPending}
                    className="shrink-0 gap-1.5"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${(isRunning || syncMutation.isPending) ? 'animate-spin' : ''}`} />
                    {isRunning ? 'Running…' : syncMutation.isPending ? 'Starting…' : 'Force Sync'}
                  </Button>
                </div>

                {isRunning && (
                  <div className="rounded-md bg-amber-500/5 border border-amber-500/20 px-3 py-2 text-xs text-amber-500 flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    Fetching categories, items, and attributes from UEX Corp API. This may take 1–2 minutes due to rate limiting.
                  </div>
                )}

                {syncMutation.isError && (
                  <p className="text-xs text-destructive">
                    {syncMutation.error instanceof Error ? syncMutation.error.message : 'Failed to start sync.'}
                  </p>
                )}

                <p className="text-xs text-muted-foreground border-t border-border pt-3">
                  Automatic sync runs every <span className="font-medium text-foreground">Monday at 03:00 UTC</span>. Use Force Sync to pull the latest data immediately.
                </p>
              </div>
            </div>

            {/* Recent sync log */}
            {recentLogs.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Sync</p>
                <div className="space-y-2">
                  {recentLogs.map((log) => (
                    <LogRow key={log.id} log={log} />
                  ))}
                </div>

                {lastSync && lastSync.status === 'SUCCESS' && (
                  <div className="rounded-md bg-muted/30 border border-border px-3 py-2 text-xs text-muted-foreground grid grid-cols-3 gap-2 text-center">
                    <div>
                      <span className="font-medium text-foreground">{lastSync.categoriesAdded + lastSync.categoriesUpdated > 0
                        ? `+${lastSync.categoriesAdded} / ~${lastSync.categoriesUpdated}`
                        : 'No change'}</span>
                      <p className="mt-0.5">Categories</p>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">{lastSync.itemsAdded + lastSync.itemsUpdated > 0
                        ? `+${lastSync.itemsAdded} / ~${lastSync.itemsUpdated}`
                        : 'No change'}</span>
                      <p className="mt-0.5">Items</p>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">{lastSync.commoditiesAdded + lastSync.commoditiesUpdated > 0
                        ? `+${lastSync.commoditiesAdded} / ~${lastSync.commoditiesUpdated}`
                        : 'No change'}</span>
                      <p className="mt-0.5">Commodities</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {recentLogs.length === 0 && !isRunning && (
              <div className="rounded-lg border border-dashed border-border p-8 text-center">
                <Database className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-sm text-muted-foreground">No sync has been run yet.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Click <span className="font-medium text-foreground">Force Sync</span> above to populate the game data cache.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Right: search ── */}
      <div className="flex-1 min-w-0" style={{ height: 'calc(100vh - 56px - 48px)', position: 'sticky', top: 0 }}>
        <SearchPanel />
      </div>
    </div>
  );
}
