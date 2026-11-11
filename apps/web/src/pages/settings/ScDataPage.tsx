import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2, Database, Search, Rocket, Package, Star, MapPin, ShoppingBag,
  Pickaxe, Tag, Factory, Globe,
} from 'lucide-react';
import { scApi } from '@/api/sc';
import { GameDataPipelineCard } from '@/components/GameDataPipelineCard';
import { useDebounce } from '@/hooks/useDebounce';

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
  const results = (active.data ?? []) as unknown as RecordRow[];
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

// ── About panel ───────────────────────────────────────────────────────────────

function AboutPanel() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Database className="h-6 w-6 text-primary" />
          SC Database
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search our copy of the Star Citizen game data, from{' '}
          <span className="font-medium text-foreground">scunpacked-data</span>. The game data service checks for
          new data automatically; its status is below. This is the same data the bot's{' '}
          <span className="font-mono text-xs">/blueprint</span>, <span className="font-mono text-xs">/item</span> and{' '}
          <span className="font-mono text-xs">/material</span> commands use.
        </p>
      </div>

      <GameDataPipelineCard />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ScDataPage() {
  return (
    // Side by side on wide screens; stacked on phones and narrow windows.
    <div className="flex flex-col lg:flex-row gap-6 lg:h-full">
      {/* Left: what this is + game data status */}
      <div className="w-full lg:w-[340px] lg:shrink-0 lg:overflow-y-auto lg:pr-1">
        <AboutPanel />
      </div>

      {/* Right: search */}
      <div className="flex-1 min-w-0 h-[70vh] lg:h-[calc(100vh-56px-48px)] lg:sticky lg:top-0">
        <SearchPanel />
      </div>
    </div>
  );
}
