// The setup checklist for officers (v1.15.0). On the server page it's a card
// listing what's left, until the required steps are done or someone hides it;
// Module Settings always shows every step. Built by packages/shared/src/setup.ts.

import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronRight, Circle, X } from 'lucide-react';
import type { SetupPage, SetupStep } from '@dem/shared';
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

  if (!Array.isArray(data?.steps)) return null; // not an officer, or not loaded
  const todo = unfinished(data.steps);
  if (variant === 'card' && (data.hidden || todo === 0)) return null;
  const done = data.steps.filter((s) => s.done).length;

  return (
    <section aria-label="Setup checklist" className="shrink-0 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-semibold">{todo ? 'Finish setting up ASOP' : 'ASOP is set up'}</h2>
        <span className="text-sm text-muted-foreground">{done} of {data.steps.length} done</span>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {variant === 'card' ? (
            <button type="button" disabled={hide.isPending} onClick={() => hide.mutate(true)}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              title="Hide this card for everyone. The checklist stays in Module Settings.">
              <X className="h-4 w-4" aria-hidden />Hide
            </button>
          ) : data.hidden && todo > 0 ? (
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
            </div>
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
