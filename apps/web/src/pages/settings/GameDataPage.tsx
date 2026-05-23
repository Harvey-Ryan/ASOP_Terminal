import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2, XCircle, Loader2, Database, Clock, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { uexApi } from '@/api/uex';
import type { UexSyncLogDto } from '@dem/shared';

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
      {/* Date + trigger */}
      <div className="min-w-0">
        <p className="font-medium truncate">{formatDate(log.startedAt)}</p>
        <p className="text-xs text-muted-foreground mt-0.5 capitalize">{log.trigger.toLowerCase()}</p>
      </div>

      {/* Status */}
      <StatusBadge status={log.status} />

      {/* Added */}
      <div className="text-right">
        <p className="text-xs text-muted-foreground">Added</p>
        <p className="font-medium text-green-500">+{totalAdded}</p>
      </div>

      {/* Updated */}
      <div className="text-right">
        <p className="text-xs text-muted-foreground">Updated</p>
        <p className="font-medium text-primary">~{totalUpdated}</p>
      </div>

      {/* Duration */}
      <div className="text-right">
        <p className="text-xs text-muted-foreground">Time</p>
        <p className="font-medium">{duration(log)}</p>
      </div>

      {/* Error (full width, only if failed) */}
      {log.status === 'FAILED' && log.error && (
        <div className="col-span-full mt-1.5 flex items-start gap-1.5 rounded-md bg-destructive/10 border border-destructive/20 px-2.5 py-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="break-all">{log.error}</span>
        </div>
      )}
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
      // Start polling immediately
      queryClient.invalidateQueries({ queryKey: ['uex-status'] });
    },
  });

  const status = statusQuery.data;
  const isRunning = status?.isRunning ?? false;
  const lastSync  = status?.lastSync ?? null;
  const counts    = status?.counts;

  // Collect recent logs from the last sync entry — the API returns only the
  // most recent log via /sync/status. A full history endpoint can be added later;
  // for now we show the single most recent entry when not running.
  const recentLogs: UexSyncLogDto[] = lastSync ? [lastSync] : [];

  return (
    <div className="space-y-8 max-w-2xl">
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
          {/* ── Cache stats ── */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cached Records</p>
            <div className="grid grid-cols-3 gap-3">
              <StatTile label="Categories"  value={counts?.categories  ?? 0} />
              <StatTile label="Items"        value={counts?.items        ?? 0} />
              <StatTile label="Commodities"  value={counts?.commodities  ?? 0} />
            </div>
          </div>

          {/* ── Sync control ── */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sync</p>

            <div className="rounded-lg border border-border bg-card p-4 space-y-4">
              {/* Last sync summary */}
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

              {/* Progress detail while running */}
              {isRunning && (
                <div className="rounded-md bg-amber-500/5 border border-amber-500/20 px-3 py-2 text-xs text-amber-500 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  Fetching categories, items, and attributes from UEX Corp API. This may take 1–2 minutes due to rate limiting.
                </div>
              )}

              {/* Trigger error */}
              {syncMutation.isError && (
                <p className="text-xs text-destructive">
                  {syncMutation.error instanceof Error ? syncMutation.error.message : 'Failed to start sync.'}
                </p>
              )}

              {/* Schedule note */}
              <p className="text-xs text-muted-foreground border-t border-border pt-3">
                Automatic sync runs every <span className="font-medium text-foreground">Monday at 03:00 UTC</span>. Use Force Sync to pull the latest data immediately.
              </p>
            </div>
          </div>

          {/* ── Recent sync log ── */}
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

          {/* Empty state */}
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
  );
}
