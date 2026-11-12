// The setup checklist for officers (v1.15.0). On the server page it's a card
// listing what's left, until someone hides it; Module Settings lists every
// step. Once the required steps are done it's gone from both (v1.22.1), and
// comes back by itself if something breaks later. Built by
// packages/shared/src/setup.ts.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronRight, Circle, Plus, X } from 'lucide-react';
import { CREATABLE_CHANNELS, type CreatableChannel, type SetupPage, type SetupStep } from '@dem/shared';
import { settingsApi } from '@/api/settings';
import { cn } from '@/lib/utils';

const PAGE_PATH: Record<SetupPage, string> = {
  'event-bot': 'settings/modules/event-bot',
  loot: 'settings/modules/loot',
  dkp: 'settings/modules/dkp',
  tournaments: 'settings/modules/tournaments',
  bot: 'settings/bot',
  allies: 'settings/allies',
  jobs: 'settings/modules/jobs',
  'new-event': 'events/new',
};

export function useSetupChecklist(guildId: string) {
  return useQuery({
    queryKey: ['setup', guildId],
    queryFn: () => settingsApi.getSetup(guildId),
    staleTime: 30_000,
    retry: false,
  });
}

const unfinished = (steps: SetupStep[]) => steps.filter((s) => !s.done && !s.optional).length;

export function SetupChecklist({ guildId, variant }: { guildId: string; variant: 'card' | 'page' }) {
  const qc = useQueryClient();
  const { data } = useSetupChecklist(guildId);
  const hide = useMutation({
    mutationFn: (hidden: boolean) => settingsApi.setSetupHidden(guildId, hidden),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['setup', guildId] }),
  });
  // "Create it" (v1.29.0): the bot makes the channel and it's saved, like choosing one in settings.
  const [createError, setCreateError] = useState<{ key: CreatableChannel; message: string } | null>(null);
  const create = useMutation({
    mutationFn: (key: CreatableChannel) => settingsApi.createSetupChannel(guildId, key),
    onMutate: () => setCreateError(null),
    onError: (err, key) => setCreateError({ key, message: err instanceof Error ? err.message : 'Couldn\'t create it.' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['setup', guildId] });
      void qc.invalidateQueries({ queryKey: ['settings', guildId] });
    },
  });

  if (!Array.isArray(data?.steps)) return null; // not an officer, or not loaded
  const todo = unfinished(data.steps);
  if (todo === 0) return null; // all set up: no banner anywhere
  if (variant === 'card' && data.hidden) return null;
  const done = data.steps.filter((s) => s.done).length;

  return (
    <section aria-label="Setup checklist" className="shrink-0 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-semibold">Finish setting up ASOP</h2>
        <span className="text-sm text-muted-foreground">{done} of {data.steps.length} done</span>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {variant === 'card' ? (
            <button type="button" disabled={hide.isPending} onClick={() => hide.mutate(true)}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              title="Hide this card for everyone. The checklist stays in Module Settings.">
              <X className="h-4 w-4" aria-hidden />Hide
            </button>
          ) : data.hidden ? (
            <button type="button" disabled={hide.isPending} onClick={() => hide.mutate(false)} className="text-primary hover:underline">
              Show on the server page
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round((done / Math.max(1, data.steps.length)) * 100)}%` }} />
      </div>
      <ul className={cn('mt-2 grid gap-x-6', variant === 'card' && 'lg:grid-cols-2')}>
        {data.steps.filter((s) => variant === 'page' || !s.done).map((s) => (
          <li key={s.key} className="flex items-start gap-2.5 py-1.5 text-sm">
            {s.done
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-label="Done" />
              : s.broken
                ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" aria-label="Needs fixing" />
                : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="To do" />}
            <div className="min-w-0 flex-1">
              <span className={cn(s.done && 'text-muted-foreground')}>{s.label}</span>
              {s.optional && !s.done && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">optional</span>}
              {s.detail && <p className={cn('text-xs', s.broken ? 'text-yellow-300' : 'text-muted-foreground')}>{s.detail}</p>}
              {createError?.key === s.key && <p className="text-xs text-red-400" role="alert">{createError.message}</p>}
            </div>
            {!s.done && s.create && (
              <button type="button" disabled={create.isPending} onClick={() => create.mutate(s.create!)}
                title={`The bot makes ${CREATABLE_CHANNELS[s.create].what} and it's chosen here. You can rename or move it in Discord.`}
                className="inline-flex shrink-0 items-center gap-0.5 rounded border border-primary/40 px-2 py-0.5 text-primary hover:bg-primary/10 disabled:opacity-60">
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {create.isPending && create.variables === s.create ? 'Creating…' : 'Create it'}
              </button>
            )}
            {!s.done && (
              <Link to={`/dashboard/servers/${guildId}/${PAGE_PATH[s.page]}`} className="inline-flex shrink-0 items-center text-primary hover:underline">
                {s.page === 'new-event' ? 'Create' : s.broken ? 'Fix' : 'Set up'}<ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            )}
          </li>
        ))}
      </ul>
      {!data.discordChecked && <p className="mt-1 text-xs text-muted-foreground">Discord didn't answer, so channels and the bot's permissions weren't checked. Reload in a moment.</p>}
      {data.steps.some((s) => s.broken && s.detail?.includes('missing')) && (
        <p className="mt-1 text-xs text-muted-foreground">Give the bot's role the missing permissions in Discord: in the channel's Edit Channel → Permissions, or for the whole server in Server Settings → Roles. Changes show here within a minute.</p>
      )}
    </section>
  );
}
