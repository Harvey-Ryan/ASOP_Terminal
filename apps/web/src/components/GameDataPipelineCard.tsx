import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { gameDataApi } from '@/api/gameData';
import { ApiError } from '@/api/client';
import { GAME_DATA_CHECK_INTERVAL_MIN, type GameDataHealth } from '@dem/shared';

const HEALTH: Record<GameDataHealth, { label: string; className: string }> = {
  ok:         { label: 'Up to date',       className: 'border-green-500/40 bg-green-500/10 text-green-500' },
  syncing:    { label: 'Updating…',        className: 'border-blue-500/40 bg-blue-500/10 text-blue-400' },
  failed:     { label: 'Last update failed', className: 'border-red-500/40 bg-red-500/10 text-red-400' },
  stale:      { label: 'Checks stopped',   className: 'border-amber-500/40 bg-amber-500/10 text-amber-500' },
  not_set_up: { label: 'Not set up',       className: 'border-border bg-muted/40 text-muted-foreground' },
};

function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  const rel = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 48 * 60 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
  return `${d.toLocaleString()} (${rel})`;
}

/** Status of the sc-data worker (our full copy of the game data) with "Sync now" for platform admins. */
export function GameDataPipelineCard() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ['game-data-status'],
    queryFn: gameDataApi.getStatus,
    refetchInterval: (q) => (q.state.data?.running || q.state.data?.pendingRequest ? 10_000 : 60_000),
  });
  const sync = useMutation({
    mutationFn: gameDataApi.requestSync,
    onSuccess: (data) => queryClient.setQueryData(['game-data-status'], data),
  });

  const s = status.data;
  if (status.isLoading || !s) return null;
  const h = HEALTH[s.health];

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium flex items-center gap-2">
            Game Data
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${h.className}`}>{h.label}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Full copy of every scunpacked-data file, checked every {GAME_DATA_CHECK_INTERVAL_MIN} minutes.
          </p>
        </div>
        {s.canRequestSync && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => sync.mutate()}
            disabled={sync.isPending || !!s.pendingRequest || !!s.running}
            title="Re-check every file now, even if upstream hasn't changed"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${s.running ? 'animate-spin' : ''}`} />
            {s.running ? 'Syncing…' : s.pendingRequest ? 'Sync queued' : 'Sync now'}
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Game build</dt>
        <dd className="font-mono">{s.build ?? s.commit?.slice(0, 12) ?? '—'}</dd>
        <dt className="text-muted-foreground">Published upstream</dt>
        <dd>{when(s.committedAt)}</dd>
        <dt className="text-muted-foreground">Synced to ASOP</dt>
        <dd>{when(s.syncedAt)}</dd>
        <dt className="text-muted-foreground">Last check</dt>
        <dd>{when(s.lastCheckAt)}</dd>
        {s.lastChange && (
          <>
            <dt className="text-muted-foreground">Last update</dt>
            <dd>+{s.lastChange.added} new · {s.lastChange.changed} changed · {s.lastChange.removed} removed</dd>
          </>
        )}
        {s.counts && (
          <>
            <dt className="text-muted-foreground">Contents</dt>
            <dd>
              {s.counts.items.toLocaleString()} items · {s.counts.ships.toLocaleString()} ships · {s.counts.contracts.toLocaleString()} missions · {s.counts.blueprints.toLocaleString()} blueprints
            </dd>
          </>
        )}
      </dl>

      {s.pendingRequest && (
        <p className="text-xs text-muted-foreground">
          Full re-sync requested{ s.pendingRequest.requestedBy ? ` by ${s.pendingRequest.requestedBy}` : ''}; it starts within {GAME_DATA_CHECK_INTERVAL_MIN} minutes.
        </p>
      )}
      {s.health === 'failed' && s.lastRun?.error && (
        <p className="text-xs text-red-400 break-words">Last error: {s.lastRun.error}</p>
      )}
      {sync.isError && (
        <p className="text-xs text-red-400">
          {sync.error instanceof ApiError ? sync.error.message : 'Could not queue the sync.'}
        </p>
      )}
    </div>
  );
}
