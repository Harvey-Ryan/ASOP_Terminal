import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search, X, ChevronRight, Clock, Layers, Wrench, Info, AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import { scApi } from '@/api/sc';
import type { ScBlueprintDto, ScBlueprintModifierDto, ScBlueprintSummaryDto } from '@dem/shared';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSecs(s: number) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function interpolate(mod: ScBlueprintModifierDto, ql: number): number {
  const range = mod.qualityMax - mod.qualityMin;
  if (range <= 0) return mod.modifierAtMin;
  const t = Math.max(0, Math.min(1, (ql - mod.qualityMin) / range));
  return mod.modifierAtMin + t * (mod.modifierAtMax - mod.modifierAtMin);
}

function fmtModValue(val: number, unitFormat: string | null): string {
  const isPercent = !unitFormat || unitFormat.includes('%%');
  const showSign  = unitFormat?.includes('+') ?? false;
  const dpMatch   = unitFormat?.match(/\.(\d+)f/);
  const dp        = dpMatch ? parseInt(dpMatch[1]!, 10) : 1;

  const scaled    = isPercent ? val * 100 : val;
  const formatted = scaled.toFixed(dp);
  const prefix    = showSign && scaled >= 0 ? '+' : '';
  const suffix    = isPercent ? ' %' : '';

  return `${prefix}${formatted}${suffix}`;
}

function formatPoolKey(key: string) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── QL Calculator ─────────────────────────────────────────────────────────────

function QlCalculator({ bp, tierIndex }: { bp: ScBlueprintDto; tierIndex: number }) {
  const [ql, setQl] = useState(500);
  const tier = bp.tiers[tierIndex];
  if (!tier) return null;

  const modifiers = tier.modifiers;
  if (modifiers.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">No quality modifiers for this tier.</p>
    );
  }

  // Collect all unique quality boundaries for the breakpoints table
  const boundaries = [...new Set(
    modifiers.flatMap((m) => [m.qualityMin, m.qualityMax]),
  )].sort((a, b) => a - b);

  return (
    <div className="space-y-4">
      {/* QL slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Quality Level
          </span>
          <input
            type="number"
            min={0}
            max={1000}
            value={ql}
            onChange={(e) => setQl(Math.max(0, Math.min(1000, Number(e.target.value) || 0)))}
            className="w-16 text-right font-mono text-sm font-bold text-primary bg-transparent border-b border-primary/40 focus:outline-none focus:border-primary"
          />
        </div>
        <input
          type="range"
          min={0}
          max={1000}
          step={5}
          value={ql}
          onChange={(e) => setQl(Number(e.target.value))}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>0</span>
          <span>250</span>
          <span>500</span>
          <span>750</span>
          <span>1000</span>
        </div>
      </div>

      {/* Stats at current QL */}
      <div className="rounded-md border border-border overflow-hidden">
        <div className="bg-muted/40 px-3 py-1.5 border-b border-border">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Stats at QL {ql}
          </p>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50">
              <th className="text-left px-3 py-1.5 text-muted-foreground font-medium">Modifier</th>
              <th className="text-right px-3 py-1.5 text-muted-foreground font-medium">Value</th>
              <th className="text-right px-3 py-1.5 text-muted-foreground font-medium">Range</th>
            </tr>
          </thead>
          <tbody>
            {modifiers.map((mod) => {
              const val = interpolate(mod, ql);
              const unit = mod.unitFormat ?? '%';
              const inRange = ql >= mod.qualityMin && ql <= mod.qualityMax;
              return (
                <tr key={mod.key} className="border-b border-border/30 last:border-0">
                  <td className="px-3 py-1.5 font-medium text-foreground">{mod.name || mod.key}</td>
                  <td className={cn(
                    'px-3 py-1.5 text-right font-mono font-bold',
                    inRange ? 'text-primary' : 'text-muted-foreground',
                  )}>
                    {fmtModValue(val, unit)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">
                    {fmtModValue(mod.modifierAtMin, unit)} – {fmtModValue(mod.modifierAtMax, unit)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Breakpoints table */}
      {boundaries.length > 2 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Quality Breakpoints
          </p>
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50 bg-muted/40">
                  <th className="text-left px-3 py-1.5 text-muted-foreground font-medium">QL Range</th>
                  {modifiers.map((m) => (
                    <th key={m.key} className="text-right px-3 py-1.5 text-muted-foreground font-medium truncate max-w-[80px]">
                      {m.name || m.key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {boundaries.slice(0, -1).map((lo, i) => {
                  const hi = boundaries[i + 1]!;
                  const midQl = Math.floor((lo + hi) / 2);
                  const isActive = ql >= lo && ql < hi;
                  return (
                    <tr key={lo} className={cn(
                      'border-b border-border/30 last:border-0',
                      isActive && 'bg-primary/5',
                    )}>
                      <td className={cn(
                        'px-3 py-1.5 font-mono',
                        isActive ? 'text-primary font-semibold' : 'text-muted-foreground',
                      )}>
                        {lo} – {hi}
                      </td>
                      {modifiers.map((mod) => {
                        const val = interpolate(mod, midQl);
                        return (
                          <td key={mod.key} className={cn(
                            'px-3 py-1.5 text-right font-mono',
                            isActive ? 'text-foreground' : 'text-muted-foreground',
                          )}>
                            {fmtModValue(val, mod.unitFormat ?? '%')}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Blueprint detail panel ────────────────────────────────────────────────────

function BlueprintDetail({
  summary,
  onClose,
}: {
  summary: ScBlueprintSummaryDto;
  onClose: () => void;
}) {
  const [activeTier, setActiveTier] = useState(0);

  const { data: bp, isLoading, isError } = useQuery({
    queryKey: ['sc-blueprint', summary.uuid],
    queryFn: () => scApi.getBlueprint(summary.uuid),
    staleTime: 10 * 60_000,
  });

  const tier = bp?.tiers[activeTier];

  return (
    <div className="flex flex-col h-full overflow-hidden border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-start gap-3 px-5 py-4 border-b border-border shrink-0">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold leading-tight truncate">{summary.outputName}</h2>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded font-mono">
              {summary.outputType}
            </span>
            {summary.outputSubtype && (
              <span className="text-xs text-muted-foreground">{summary.outputSubtype}</span>
            )}
            {summary.outputGrade && (
              <span className="text-xs text-muted-foreground">Grade {summary.outputGrade}</span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-8 rounded-md" />
            <Skeleton className="h-32 rounded-md" />
            <Skeleton className="h-48 rounded-md" />
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Failed to load blueprint details.
          </div>
        )}

        {bp && (
          <>
            {/* Tier tabs */}
            {bp.tiers.length > 1 && (
              <div className="flex gap-1">
                {bp.tiers.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveTier(i)}
                    className={cn(
                      'px-3 py-1 text-xs rounded font-medium transition-colors',
                      activeTier === i
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    Tier {i + 1}
                  </button>
                ))}
              </div>
            )}

            {/* Craft time */}
            {tier && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4 shrink-0" />
                <span>Craft time: <strong className="text-foreground">{fmtSecs(tier.craftTimeSecs)}</strong></span>
              </div>
            )}

            {/* Materials */}
            {tier && tier.materials.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Materials
                </p>
                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      {tier.materials.map((mat, i) => (
                        <tr key={i} className="border-b border-border/40 last:border-0">
                          <td className="px-3 py-2 font-medium">{mat.name}</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                            {mat.quantityScu != null
                              ? `${mat.quantityScu} SCU`
                              : mat.quantity != null
                                ? `×${mat.quantity}`
                                : '—'}
                          </td>
                          {mat.minQuality != null && (
                            <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                              min q{mat.minQuality}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Dismantle */}
            {(bp.dismantleTimeSecs != null || bp.dismantleEfficiency != null) && (
              <div className="flex items-center gap-4 rounded-md border border-border/60 px-4 py-2.5 text-sm bg-muted/20">
                <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">Dismantle</span>
                {bp.dismantleTimeSecs != null && (
                  <span>{fmtSecs(bp.dismantleTimeSecs)}</span>
                )}
                {bp.dismantleEfficiency != null && (
                  <span className="text-green-500 font-semibold">
                    {(bp.dismantleEfficiency * 100).toFixed(0)}% recovery
                  </span>
                )}
              </div>
            )}

            {/* QL Calculator */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold">QL Calculator</p>
              </div>
              <QlCalculator bp={bp} tierIndex={activeTier} />
            </div>

            {/* Mission sources */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5" />
                Mission Sources ({bp.rewardPools.length} pool{bp.rewardPools.length !== 1 ? 's' : ''})
              </p>
              {bp.missions.length > 0 ? (
                <div className="space-y-1">
                  {bp.missions.map((m) => (
                    <div key={m.uuid} className="rounded-md border border-border px-3 py-2 text-sm">
                      <p className="font-medium">{m.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                        {m.faction && <span>{m.faction}</span>}
                        {m.missionType && <span>· {m.missionType}</span>}
                        {m.locationName && <span>· {m.locationName}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : bp.rewardPools.length > 0 ? (
                <div className="space-y-1">
                  {bp.rewardPools.map((p) => (
                    <div key={p.poolUuid} className="rounded-md bg-muted/40 border border-border/50 px-3 py-1.5 text-xs font-mono text-muted-foreground">
                      {formatPoolKey(p.poolKey)}
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground italic mt-1">
                    Mission data not yet synced — pool keys shown as reference.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  This blueprint has no mission reward pool data.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Blueprint list row ────────────────────────────────────────────────────────

function BlueprintRow({
  bp,
  selected,
  onClick,
}: {
  bp: ScBlueprintSummaryDto;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 text-left border-b border-border/50 last:border-0 transition-colors',
        selected
          ? 'bg-primary/10 border-l-2 border-l-primary'
          : 'hover:bg-accent/40 border-l-2 border-l-transparent',
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{bp.outputName}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs font-mono text-muted-foreground">{bp.outputType}</span>
          {bp.outputSubtype && (
            <span className="text-xs text-muted-foreground">{bp.outputSubtype}</span>
          )}
          {bp.outputGrade && (
            <span className="text-xs text-muted-foreground">Grade {bp.outputGrade}</span>
          )}
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-3 text-xs text-muted-foreground">
        {bp.tierCount > 1 && (
          <span className="flex items-center gap-1">
            <Layers className="h-3 w-3" />
            {bp.tierCount}
          </span>
        )}
        {bp.dismantleTimeSecs != null && (
          <span className="flex items-center gap-1">
            <Wrench className="h-3 w-3" />
          </span>
        )}
        <ChevronRight className={cn('h-4 w-4 transition-transform', selected && 'text-primary')} />
      </div>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function BlueprintsPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selected, setSelected] = useState<ScBlueprintSummaryDto | null>(null);

  const debouncedSearch = useDebounce(search, 300);
  const debouncedType   = useDebounce(typeFilter, 300);

  const { data: blueprints = [], isLoading } = useQuery({
    queryKey: ['sc-blueprints', debouncedSearch, debouncedType],
    queryFn: () => scApi.getBlueprints({ q: debouncedSearch, type: debouncedType, limit: 75 }),
    staleTime: 5 * 60_000,
  });

  function handleSelect(bp: ScBlueprintSummaryDto) {
    setSelected((prev) => (prev?.uuid === bp.uuid ? null : bp));
  }

  return (
    <div className="flex h-full gap-0 -m-6 overflow-hidden">
      {/* ── Left: search + list ─────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border shrink-0 space-y-4 bg-background">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Blueprints</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Search crafting blueprints, inspect recipes, and calculate stat outputs by quality level.
            </p>
          </div>

          <div className="flex gap-2">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search blueprints…"
                className="w-full pl-9 pr-4 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Type filter */}
            <div className="relative w-44">
              <input
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                placeholder="Filter by type…"
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {typeFilter && (
                <button
                  onClick={() => setTypeFilter('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Results count */}
          <p className="text-xs text-muted-foreground">
            {isLoading ? 'Loading…' : `${blueprints.length} blueprint${blueprints.length !== 1 ? 's' : ''}${blueprints.length === 75 ? ' (showing first 75)' : ''}`}
          </p>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-md" />
              ))}
            </div>
          ) : blueprints.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center px-6">
              <p className="text-muted-foreground text-sm">No blueprints found.</p>
              {(search || typeFilter) && (
                <Button
                  variant="link"
                  size="sm"
                  className="mt-2"
                  onClick={() => { setSearch(''); setTypeFilter(''); }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <div>
              {blueprints.map((bp) => (
                <BlueprintRow
                  key={bp.uuid}
                  bp={bp}
                  selected={selected?.uuid === bp.uuid}
                  onClick={() => handleSelect(bp)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: detail panel ─────────────────────────────────────────────── */}
      {selected && (
        <div className="w-[460px] shrink-0 overflow-hidden flex flex-col">
          <BlueprintDetail
            key={selected.uuid}
            summary={selected}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
    </div>
  );
}
