import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { gameDataApi } from '@/api/gameData';
import { ApiError } from '@/api/client';
import { describeCheckInterval, type GameDataHealth } from '@dem/shared';

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
    meta: { quietErrors: true }, // shows its own error
    mutationFn: gameDataApi.requestSync,
    onSuccess: (data) => queryClient.setQueryData(['game-data-status'], data),
  });
  const cancel = useMutation({
    meta: { quietErrors: true },
    mutationFn: gameDataApi.cancelSync,
    onSuccess: (data) => queryClient.setQueryData(['game-data-status'], data),
  });
  const check = useMutation({ meta: { quietErrors: true }, mutationFn: gameDataApi.check });

  const s = status.data;
  if (status.isLoading || !s) return null;
  const h = HEALTH[s.health];
  const nextCheck = s.lastCheckAt && s.checkIntervalMin
    ? new Date(new Date(s.lastCheckAt).getTime() + s.checkIntervalMin * 60_000).toLocaleString()
    : null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium flex items-center gap-2">
            Game Data
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${h.className}`}>{h.label}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Full copy of every scunpacked-data file, checked {describeCheckInterval(s.checkIntervalMin)}.
          </p>
        </div>
        {s.canRequestSync && (
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Button size="sm" variant="outline" onClick={() => check.mutate()} disabled={check.isPending || !!s.running}
              title="Ask GitHub now whether there's newer game data. Downloads nothing.">
              <Search className={`h-3.5 w-3.5 mr-1.5 ${check.isPending ? 'animate-pulse' : ''}`} />
              {s.running ? 'Syncing…' : check.isPending ? 'Checking…' : 'Check now'}
            </Button>
            {!s.running && !s.pendingRequest && (
              <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => sync.mutate()} disabled={sync.isPending}
                title="Re-check every file at the next scheduled run, even if upstream hasn't changed">
                <RefreshCw className="mr-1 inline h-3 w-3" />Full re-sync
              </button>
            )}
          </div>
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

      {check.data && (
        <p className={`text-xs ${check.data.upToDate ? 'text-green-500' : 'text-amber-500'}`}>
          {check.data.upToDate
            ? `Checked GitHub at ${new Date(check.data.checkedAt).toLocaleTimeString()}: nothing newer than what we hold.`
            : `New data on GitHub${check.data.upstreamBuild ? `: ${check.data.upstreamBuild}` : ''}${check.data.upstreamCommittedAt ? `, published ${when(check.data.upstreamCommittedAt)}` : ''}. It will be synced at the next scheduled check${nextCheck ? ` (around ${nextCheck})` : ''}.`}
        </p>
      )}
      {s.pendingRequest && (
        <p className="text-xs text-muted-foreground">
          Full re-sync requested{ s.pendingRequest.requestedBy ? ` by ${s.pendingRequest.requestedBy}` : ''}; it runs at the next scheduled check{nextCheck ? ` (around ${nextCheck})` : ''}.
          {s.canRequestSync && (
            <button type="button" className="ml-2 text-[#e2bd5b] hover:underline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              {cancel.isPending ? 'Cancelling…' : 'Cancel'}
            </button>
          )}
        </p>
      )}
      {s.health === 'failed' && s.lastRun?.error && (
        <p className="text-xs text-red-400 break-words">Last error: {s.lastRun.error}</p>
      )}
      {[sync, cancel, check].map((m, i) => m.isError && (
        <p key={i} className="text-xs text-red-400">
          {m.error instanceof ApiError ? m.error.message : ['Could not queue the sync.', 'Could not cancel the re-sync.', 'Could not check GitHub.'][i]}
        </p>
      ))}
    </div>
  );
}
