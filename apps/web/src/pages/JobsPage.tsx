// Job board (v1.21.0): post small jobs, take them, mark them done. Rules in
// packages/shared/src/jobs.ts.

import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import { JOB_KINDS, JOB_LIMITS, JOB_VISIBILITY, canManageGuild, type JobDto, type JobInput, type JobKind, type JobVisibility } from '@dem/shared';
import { jobsApi } from '@/api/jobs';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';
const KINDS = Object.entries(JOB_KINDS) as [JobKind, { label: string; emoji: string }][];
const STATUS_LABEL: Record<string, string> = { OPEN: 'Open', DONE: 'Done', CANCELLED: 'Cancelled', EXPIRED: 'Expired' };

const EMPTY: JobInput = { kind: 'HAULING', title: '', details: '', reward: '', location: '', whenText: '', slots: 1, visibility: 'SERVER' };

function JobForm({ initial, onSubmit, onCancel, pending, error }: {
  initial: JobInput; onSubmit: (j: JobInput) => void; onCancel: () => void; pending: boolean; error: string | null;
}) {
  const [j, setJ] = useState<JobInput>(initial);
  const set = <K extends keyof JobInput>(k: K, v: JobInput[K]) => setJ((x) => ({ ...x, [k]: v }));
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit(j); }}>
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <label className="space-y-1 text-sm">Kind
          <select className={inputCls} value={j.kind} onChange={(e) => set('kind', e.target.value as JobKind)}>
            {KINDS.map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">Title
          <input className={inputCls} required maxLength={JOB_LIMITS.title} placeholder="Need a hauler for two runs" value={j.title} onChange={(e) => set('title', e.target.value)} />
        </label>
      </div>
      <label className="block space-y-1 text-sm">Details <span className="text-muted-foreground">(optional)</span>
        <textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={3} maxLength={JOB_LIMITS.details}
          placeholder="Lorville to Area 18, about an hour. Bring a ship with 96+ SCU." value={j.details ?? ''} onChange={(e) => set('details', e.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="space-y-1 text-sm">Reward
          <input className={inputCls} maxLength={JOB_LIMITS.reward} placeholder="60k aUEC" value={j.reward ?? ''} onChange={(e) => set('reward', e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">When
          <input className={inputCls} maxLength={JOB_LIMITS.whenText} placeholder="Tonight, 8 PM" value={j.whenText ?? ''} onChange={(e) => set('whenText', e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">Where
          <input className={inputCls} maxLength={JOB_LIMITS.location} placeholder="Lorville" value={j.location ?? ''} onChange={(e) => set('location', e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">Crew wanted
          <input className={inputCls} type="number" min={1} max={JOB_LIMITS.maxSlots} value={j.slots ?? 1} onChange={(e) => set('slots', Number(e.target.value))} />
        </label>
      </div>
      <fieldset className="space-y-1 text-sm">
        <legend>Who can see it</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.entries(JOB_VISIBILITY) as [JobVisibility, { label: string; help: string }][]).map(([k, v]) => (
            <label key={k} title={v.help} className={cn('cursor-pointer rounded-md border px-3 py-1.5', j.visibility === k ? 'border-primary text-primary' : 'text-muted-foreground')}>
              <input type="radio" name="visibility" className="sr-only" checked={j.visibility === k} onChange={() => set('visibility', k)} />{v.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{JOB_VISIBILITY[j.visibility ?? 'SERVER'].help}. Open jobs close by themselves after 7 days.</p>
      </fieldset>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !j.title.trim()}>{pending ? 'Saving…' : 'Save job'}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function JobRow({ job, guildId, me, isManager }: { job: JobDto; guildId: string; me: string | undefined; isManager: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = () => { setError(null); void qc.invalidateQueries({ queryKey: ['jobs', guildId] }); };
  const act = useMutation({
    meta: { quietErrors: true }, // shows its own error
    mutationFn: (fn: () => Promise<JobDto>) => fn(),
    onSuccess: () => { setEditing(false); done(); },
    onError: (e) => setError(e instanceof Error ? e.message : 'Something went wrong.'),
  });
  const kind = JOB_KINDS[job.kind] ?? JOB_KINDS.OTHER;
  const mine = job.posterId === me;
  const onCrew = job.crew.some((c) => c.userId === me);
  const full = job.crew.length >= job.slots;
  const isOpen = job.status === 'OPEN';
  const fromHere = job.guildId === guildId;

  return (
    <li className="border-b last:border-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-accent sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <span className="min-w-0">
          <span className="block truncate font-medium">{kind.emoji} {job.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{job.posterName}{!fromHere && ` · ${job.guildName}`}{job.visibility !== 'SERVER' && ` · ${JOB_VISIBILITY[job.visibility].label}`}</span>
        </span>
        <span className="hidden truncate text-sm sm:block">{job.reward ?? '—'}</span>
        <span className="hidden truncate text-sm text-muted-foreground sm:block">{job.whenText ?? 'Any time'}</span>
        <span className="flex items-center gap-2">
          <span className={cn('rounded px-2 py-0.5 text-xs', !isOpen ? 'bg-muted text-muted-foreground' : full ? 'bg-yellow-500/15 text-yellow-300' : 'bg-emerald-500/15 text-emerald-300')}>
            {isOpen ? `${job.crew.length}/${job.slots}` : STATUS_LABEL[job.status]}
          </span>
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden /> : <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />}
        </span>
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4 text-sm">
          {editing ? (
            <JobForm initial={{ ...job }} pending={act.isPending} error={error} onCancel={() => setEditing(false)}
              onSubmit={(j) => act.mutate(() => jobsApi.edit(guildId, job.id, j))} />
          ) : (
            <>
              {job.details && <p className="whitespace-pre-wrap">{job.details}</p>}
              <p className="text-muted-foreground">
                {[job.reward && `💰 ${job.reward}`, `🕐 ${job.whenText ?? 'Any time'}`, job.location && `📍 ${job.location}`].filter(Boolean).join(' · ')}
              </p>
              <div>
                <span className="text-muted-foreground">Crew ({job.crew.length}/{job.slots}): </span>
                {job.crew.length === 0 ? <span className="italic text-muted-foreground">nobody yet</span> : job.crew.map((c, i) => (
                  <span key={c.userId}>{i > 0 && ', '}{c.username}
                    {mine && isOpen && (
                      <button type="button" aria-label={`Remove ${c.username}`} className="ml-0.5 align-middle text-muted-foreground hover:text-foreground"
                        onClick={() => act.mutate(() => jobsApi.removeCrew(guildId, job.id, c.userId))}><X className="inline h-3.5 w-3.5" /></button>
                    )}
                  </span>
                ))}
              </div>
              {isOpen && (
                <div className="flex flex-wrap gap-2">
                  {!mine && !onCrew && <Button size="sm" disabled={full || act.isPending} onClick={() => act.mutate(() => jobsApi.take(guildId, job.id))}>{full ? 'Crew full' : 'Take job'}</Button>}
                  {onCrew && <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate(() => jobsApi.leave(guildId, job.id))}>Leave</Button>}
                  {mine && <>
                    <Button size="sm" disabled={act.isPending} onClick={() => act.mutate(() => jobsApi.close(guildId, job.id, 'DONE'))}>Mark done</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
                  </>}
                  {(mine || (isManager && fromHere)) && (
                    <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate(() => jobsApi.close(guildId, job.id, 'CANCELLED'))}>
                      {mine ? 'Cancel job' : 'Take down'}
                    </Button>
                  )}
                </div>
              )}
              {error && <p className="text-destructive">{error}</p>}
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function JobsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'mine' ? 'mine' : 'board';
  const { user, guilds } = useAuth();
  const guild = guilds.find((g) => g.id === guildId);
  const isManager = !!guild && canManageGuild(guild);
  const qc = useQueryClient();
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['jobs', guildId, view], queryFn: () => jobsApi.list(guildId!, view), refetchInterval: 60_000 });
  const post = useMutation({
    meta: { quietErrors: true }, // shows its own error
    mutationFn: (j: JobInput) => jobsApi.post(guildId!, j),
    onSuccess: () => { setPosting(false); setError(null); void qc.invalidateQueries({ queryKey: ['jobs', guildId] }); },
    onError: (e) => setError(e instanceof Error ? e.message : 'Couldn\'t post the job.'),
  });

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Briefcase className="h-6 w-6" aria-hidden />Job Board</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Post small jobs that don't need a full event, take someone else's, sort out the details in game.</p>
        </div>
        {!posting && <Button size="sm" className="gap-1" onClick={() => setPosting(true)}><Plus className="h-4 w-4" aria-hidden />Post a job</Button>}
      </div>

      {posting && (
        <Card><CardContent className="pt-5">
          <JobForm initial={EMPTY} pending={post.isPending} error={error} onCancel={() => { setPosting(false); setError(null); }} onSubmit={(j) => post.mutate(j)} />
        </CardContent></Card>
      )}

      <div className="flex gap-1 border-b" role="tablist">
        {(['board', 'mine'] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setParams(v === 'mine' ? { view: 'mine' } : {})}
            className={cn('border-b-2 px-3 py-2 text-sm', view === v ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {v === 'board' ? 'Open jobs' : 'My jobs'}
          </button>
        ))}
      </div>

      {q.isError ? <p className="text-sm text-muted-foreground">{(q.error as { status?: number })?.status === 404 ? 'The job board is switched off in this server.' : 'Couldn\'t load jobs. Try again in a moment.'}</p>
        : !q.data ? <Skeleton className="h-48" /> : q.data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{view === 'mine' ? 'You haven\'t posted or taken a job yet.' : 'No open jobs right now. Post one!'}</p>
        ) : (
          <Card><CardContent className="p-0"><ul>{q.data.map((j) => <JobRow key={j.id} job={j} guildId={guildId!} me={user?.id} isManager={isManager} />)}</ul></CardContent></Card>
        )}
    </div>
  );
}
