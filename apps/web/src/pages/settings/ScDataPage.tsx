import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw, CheckCircle2, XCircle, Loader2, Database, Clock,
  AlertTriangle, Search, Rocket, Package, Star, MapPin, ShoppingBag,
  Pickaxe, Tag, Factory, Globe,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { scApi } from '@/api/sc';
import { useDebounce } from '@/hooks/useDebounce';
import type { ScSyncLogDto } from '@dem/shared';

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000), hours = Math.floor(diff / 3_600_000), days = Math.floor(diff / 86_400_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function duration(log: ScSyncLogDto) {
  if (!log.completedAt) return '—';
  const secs = Math.round((new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()) / 1000);
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === 'RUNNING') return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[11px] font-medium text-amber-500">
      <Loader2 className="h-3 w-3 animate-spin" /> Running
    </span>
  );
  if (status === 'SUCCESS') return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 border border-green-500/30 px-2 py-0.5 text-[11px] font-medium text-green-500">
      <CheckCircle2 className="h-3 w-3" /> Success
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 border border-destructive/30 px-2 py-0.5 text-[11px] font-medium text-destructive">
      <XCircle className="h-3 w-3" /> Failed
    </span>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────

type RecordRow = Record<string, unknown>;

const SKIP_KEYS = new Set(['stdItemJson', 'producesTagsJson', 'consumesTagsJson', 'amenitiesJson', 'locationsJson', 'areasJson', 'groupsJson', 'syncedAt']);

function ResultCard({ row, type }: { row: RecordRow; type: string }) {
  const [expanded, setExpanded] = useState(false);

  const title = (row.name ?? row.outputName ?? row.displayName ?? row.value ?? row.key ?? row.uuid ?? '—') as string;
  const subtitle = (row.type ?? row.outputType ?? row.classification ?? row.kind ?? row.tier ?? '') as string;
  const badge = type;

  const fields = Object.entries(row).filter(([k, v]) =>
    !SKIP_KEYS.has(k) && v != null && v !== '' && v !== false && k !== 'uuid' && k !== 'stdItemJson',
  );

  const primary = fields.slice(0, 6);
  const extra   = fields.slice(6);

  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5 space-y-1.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-sm text-foreground leading-tight break-all">{title}</p>
        <span className="shrink-0 rounded-full bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary uppercase whitespace-nowrap">
          {badge}
        </span>
      </div>

      {subtitle && (
        <p className="text-muted-foreground text-[11px]">{subtitle}</p>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground pt-0.5">
        {primary.map(([k, v]) => (
          <span key={k} className="truncate">
            <span className="text-foreground/60">{k}:</span>{' '}
            <span className="text-foreground">{String(v)}</span>
          </span>
        ))}
      </div>

      {extra.length > 0 && (
        <>
          {expanded && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground border-t border-border pt-1.5">
              {extra.map(([k, v]) => (
                <span key={k} className="truncate">
                  <span className="text-foreground/60">{k}:</span>{' '}
                  <span className="text-foreground">{String(v)}</span>
                </span>
              ))}
            </div>
          )}
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-[10px] text-primary hover:underline"
          >
            {expanded ? 'Show less' : `+${extra.length} more fields`}
          </button>
        </>
      )}
    </div>
  );
}

// ── Tab definition ────────────────────────────────────────────────────────────

type TabId = 'blueprints' | 'ship-items' | 'commodities' | 'resources' | 'starmap' | 'trade-locations' | 'manufacturers' | 'labels';

const TABS: { id: TabId; label: string; icon: React.ReactNode; placeholder: string }[] = [
  { id: 'blueprints',      label: 'Blueprints',      icon: <Star className="h-3.5 w-3.5" />,       placeholder: 'e.g. Laser Cannon' },
  { id: 'ship-items',      label: 'Ship Items',      icon: <Rocket className="h-3.5 w-3.5" />,     placeholder: 'e.g. Shield Generator' },
  { id: 'commodities',     label: 'Commodities',     icon: <Package className="h-3.5 w-3.5" />,    placeholder: 'e.g. Agricium' },
  { id: 'resources',       label: 'Resources',       icon: <Pickaxe className="h-3.5 w-3.5" />,    placeholder: 'e.g. Quantainium' },
  { id: 'starmap',         label: 'Starmap',         icon: <Globe className="h-3.5 w-3.5" />,      placeholder: 'e.g. microTech' },
  { id: 'trade-locations', label: 'Trade Locations', icon: <MapPin className="h-3.5 w-3.5" />,     placeholder: 'e.g. Lorville' },
  { id: 'manufacturers',   label: 'Manufacturers',   icon: <Factory className="h-3.5 w-3.5" />,    placeholder: 'e.g. Aegis' },
  { id: 'labels',          label: 'Labels',          icon: <Tag className="h-3.5 w-3.5" />,         placeholder: 'e.g. Ballistic' },
];

// ── Search panel ──────────────────────────────────────────────────────────────

function SearchPanel() {
  const [tab, setTab] = useState<TabId>('blueprints');
  const [query, setQuery] = useState('');
  const dq = useDebounce(query, 300);
  const enabled = dq.length >= 2;

  const blueprints     = useQuery({ queryKey: ['sc-blueprints', dq],     queryFn: () => scApi.getBlueprints(dq),     enabled: enabled && tab === 'blueprints',      staleTime: 60_000 });
  const shipItems      = useQuery({ queryKey: ['sc-ship-items', dq],     queryFn: () => scApi.getShipItems(dq),     enabled: enabled && tab === 'ship-items',      staleTime: 60_000 });
  const commodities    = useQuery({ queryKey: ['sc-commodities', dq],    queryFn: () => scApi.getCommodities(dq),    enabled: enabled && tab === 'commodities',     staleTime: 60_000 });
  const resources      = useQuery({ queryKey: ['sc-resources', dq],      queryFn: () => scApi.getResources(dq),      enabled: enabled && tab === 'resources',       staleTime: 60_000 });
  const starmap        = useQuery({ queryKey: ['sc-starmap', dq],         queryFn: () => scApi.getStarmap(dq),        enabled: enabled && tab === 'starmap',         staleTime: 60_000 });
  const tradeLocations = useQuery({ queryKey: ['sc-trade-locations', dq], queryFn: () => scApi.getTradeLocations(dq), enabled: enabled && tab === 'trade-locations', staleTime: 60_000 });
  const manufacturers  = useQuery({ queryKey: ['sc-manufacturers', dq],  queryFn: () => scApi.getManufacturers(dq),  enabled: enabled && tab === 'manufacturers',   staleTime: 60_000 });
  const labels         = useQuery({ queryKey: ['sc-labels', dq],          queryFn: () => scApi.getLabels(dq),         enabled: enabled && tab === 'labels',          staleTime: 60_000 });

  const queryMap: Record<TabId, typeof blueprints> = {
    'blueprints': blueprints, 'ship-items': shipItems, 'commodities': commodities,
    'resources': resources, 'starmap': starmap, 'trade-locations': tradeLocations,
    'manufacturers': manufacturers, 'labels': labels,
  };

  const active  = queryMap[tab];
  const results = (active.data ?? []) as RecordRow[];
  const needle  = dq.toLowerCase();
  const rank    = (r: RecordRow) => {
    const name = String(r.name ?? r.outputName ?? r.displayName ?? r.value ?? '').toLowerCase();
    return name.startsWith(needle) ? 0 : 1;
  };
  const sorted = [...results].sort((a, b) => rank(a) - rank(b) || String(a.name ?? a.outputName ?? '').localeCompare(String(b.name ?? b.outputName ?? '')));

  const currentTab = TABS.find((t) => t.id === tab)!;

  return (
    <div className="flex flex-col h-full rounded-lg border border-border bg-card overflow-hidden">

      {/* Tabs */}
      <div className="flex border-b border-border overflow-x-auto shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setQuery(''); }}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Search input */}
      <div className="px-3 pt-3 pb-2 shrink-0 space-y-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={currentTab.placeholder}
            className="w-full rounded-md border border-input bg-background pl-8 pr-8 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
          />
          {active.isFetching && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground animate-spin" />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {!enabled
            ? 'Type at least 2 characters to search'
            : sorted.length > 0
              ? `${sorted.length} result${sorted.length !== 1 ? 's' : ''}${sorted.length === 50 ? ' (first 50)' : ''}`
              : active.isFetching ? 'Searching…' : 'No results'}
        </p>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {!enabled && (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <ShoppingBag className="h-6 w-6 text-muted-foreground opacity-30 mb-2" />
            <p className="text-xs text-muted-foreground">Start typing to search {currentTab.label.toLowerCase()}.</p>
          </div>
        )}
        {enabled && sorted.length === 0 && !active.isFetching && (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <p className="text-xs text-muted-foreground">No {currentTab.label.toLowerCase()} matching &ldquo;{dq}&rdquo;.</p>
          </div>
        )}
        {sorted.map((row, i) => (
          <ResultCard key={String(row.uuid ?? row.key ?? i)} row={row} type={tab} />
        ))}
      </div>
    </div>
  );
}

// ── Sync panel ────────────────────────────────────────────────────────────────

function SyncPanel() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ['sc-status'],
    queryFn: () => scApi.getStatus(),
    refetchInterval: (q) => (q.state.data?.isRunning ? 3000 : false),
  });

  const syncMutation = useMutation({
    mutationFn: () => scApi.triggerSync(guildId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sc-status'] }),
  });

  const status = statusQuery.data;
  const isRunning = status?.isRunning ?? false;
  const lastSync  = status?.lastSync ?? null;

  type DetailCounts = {
    manufacturers?: number; starmapEntries?: number; tradeLocations?: number;
    tags?: number; commodities?: number; resourceLocations?: number;
    resources?: number; labels?: number; shipItemsAdded?: number; shipItemsUpdated?: number;
  };
  const details: DetailCounts = lastSync?.detailsJson ? JSON.parse(lastSync.detailsJson as unknown as string) : {};

  const countTiles: { label: string; key: keyof DetailCounts }[] = [
    { label: 'Manufacturers', key: 'manufacturers' },
    { label: 'Starmap',       key: 'starmapEntries' },
    { label: 'Trade Locs',    key: 'tradeLocations' },
    { label: 'Commodities',   key: 'commodities' },
    { label: 'Resources',     key: 'resources' },
    { label: 'Ship Items',    key: 'shipItemsAdded' },
    { label: 'Labels',        key: 'labels' },
    { label: 'Tags',          key: 'tags' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Database className="h-6 w-6 text-primary" />
          SC Database
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Game data cache sourced from{' '}
          <span className="font-medium text-foreground">scunpacked-data</span>. Synced automatically every Tuesday.
        </p>
      </div>

      {statusQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
        </div>
      ) : (
        <>
          {/* Sync control */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
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
                variant="outline" size="sm"
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
                Fetching all scunpacked-data sources in parallel. This may take a few minutes.
              </div>
            )}

            {lastSync && (
              <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                <span>{fmt(lastSync.startedAt)} · {duration(lastSync)}</span>
                <StatusBadge status={lastSync.status} />
              </div>
            )}

            {lastSync?.status === 'FAILED' && lastSync.error && (
              <div className="flex items-start gap-1.5 rounded-md bg-destructive/10 border border-destructive/20 px-2.5 py-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="break-all">{lastSync.error}</span>
              </div>
            )}

            {syncMutation.isError && (
              <p className="text-xs text-destructive">
                {syncMutation.error instanceof Error ? syncMutation.error.message : 'Failed to start sync.'}
              </p>
            )}
          </div>

          {/* Record counts */}
          {Object.keys(details).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Last Sync Counts</p>
              <div className="grid grid-cols-2 gap-2">
                {countTiles.map(({ label, key }) => (
                  details[key] != null && (
                    <div key={key} className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="text-sm font-bold tabular-nums">{(details[key] as number).toLocaleString()}</span>
                    </div>
                  )
                ))}
              </div>
            </div>
          )}

          {/* Blueprints row */}
          {lastSync?.status === 'SUCCESS' && (
            <div className="rounded-md bg-muted/30 border border-border px-3 py-2.5 text-xs grid grid-cols-2 gap-2 text-center">
              <div>
                <span className="font-bold text-foreground">+{lastSync.blueprintsAdded}</span>
                <p className="text-muted-foreground mt-0.5">Blueprints added</p>
              </div>
              <div>
                <span className="font-bold text-foreground">~{lastSync.blueprintsUpdated}</span>
                <p className="text-muted-foreground mt-0.5">Blueprints updated</p>
              </div>
            </div>
          )}

          {!lastSync && !isRunning && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <Database className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-sm text-muted-foreground">No sync has run yet.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Click <span className="font-medium text-foreground">Force Sync</span> to populate all tables.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ScDataPage() {
  return (
    <div className="flex gap-6 h-full">
      {/* Left: sync management */}
      <div className="w-[340px] shrink-0 overflow-y-auto pr-1">
        <SyncPanel />
      </div>

      {/* Right: search */}
      <div className="flex-1 min-w-0" style={{ height: 'calc(100vh - 56px - 48px)', position: 'sticky', top: 0 }}>
        <SearchPanel />
      </div>
    </div>
  );
}
