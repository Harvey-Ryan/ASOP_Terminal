// Admin → Errors (v1.13.0).
//   Kinds: one row per kind of error in a period, with triage (resolve/ignore).
//   All:   every occurrence, newest first, filterable, "Load older".
//   Live:  new occurrences as they arrive (checks every 3 seconds).
// Filters live in the URL, so a view can be bookmarked or linked from Discord.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Search } from 'lucide-react';
import type { ErrorEventDto, ErrorGroupDto, ErrorGroupStatus } from '@dem/shared';
import { adminApi, type ErrorFilters } from '@/api/admin';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ADMIN, Empty, LevelDot, LoadFailed, SourceBadge, ago, inputCls, selectCls, when } from './adminUi';

const FILTER_KEYS = ['source', 'level', 'q', 'guildId', 'userId', 'ref', 'fingerprint', 'release', 'period', 'status'] as const;
type View = 'kinds' | 'all' | 'live';

export function AdminErrorsPage() {
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as View | null) ?? 'kinds';
  const filters: ErrorFilters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? undefined])), [params]);
  const set = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
    setParams(next, { replace: true });
  };
  const active = FILTER_KEYS.filter((k) => k !== 'period' && k !== 'status' && params.get(k));

  return (
    <div className="space-y-4">
      <FindByRef onFind={(ref) => set({ ref, view: 'all' })} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5" role="tablist">
          {(['kinds', 'all', 'live'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => set({ view: v === 'kinds' ? undefined : v })}
              className={cn('rounded px-3 py-1 text-sm capitalize', view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {v === 'kinds' ? 'Kinds' : v === 'all' ? 'All' : 'Live'}
            </button>
          ))}
        </div>
        <select aria-label="Source" className={selectCls} value={filters.source ?? ''} onChange={(e) => set({ source: e.target.value || undefined })}>
          <option value="">All sources</option><option value="api">API</option><option value="bot">Bot</option><option value="web">Browsers</option><option value="sc-data">sc-data</option>
        </select>
        <select aria-label="Level" className={selectCls} value={filters.level ?? ''} onChange={(e) => set({ level: e.target.value || undefined })}>
          <option value="">Errors and warnings</option><option value="error">Errors only</option><option value="warn">Warnings only</option>
        </select>
        {view === 'kinds' && <>
          <select aria-label="Period" className={selectCls} value={filters.period ?? '24h'} onChange={(e) => set({ period: e.target.value === '24h' ? undefined : e.target.value })}>
            <option value="1h">Last hour</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option>
          </select>
          <select aria-label="Status" className={selectCls} value={filters.status ?? 'all'} onChange={(e) => set({ status: e.target.value === 'all' ? undefined : e.target.value })}>
            <option value="all">Any status</option><option value="open">Open</option><option value="resolved">Resolved</option><option value="ignored">Ignored</option>
          </select>
        </>}
        <SearchBox value={filters.q ?? ''} onChange={(q) => set({ q })} />
      </div>
      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {active.map((k) => (
            <button key={k} onClick={() => set({ [k]: undefined })} className="rounded-full border px-2 py-0.5 hover:border-destructive" title="Remove filter">
              {k}: <span className="font-mono">{params.get(k)!.slice(0, 24)}</span> ✕
            </button>
          ))}
        </div>
      )}

      {view === 'kinds' && <Kinds filters={filters} onPick={(fp) => set({ fingerprint: fp, view: 'all' })} />}
      {view === 'all' && <All filters={filters} />}
      {view === 'live' && <Live filters={filters} />}
    </div>
  );
}

function FindByRef({ onFind }: { onFind: (ref: string) => void }) {
  const [ref, setRef] = useState('');
  return (
    <form className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3" onSubmit={(e) => { e.preventDefault(); const r = ref.trim().toUpperCase().replace(/^REF[\s:#]*/, ''); if (r) onFind(r); }}>
      <label htmlFor="ref" className="text-sm text-muted-foreground">Someone gave you a code?</label>
      <input id="ref" className={cn(inputCls, 'w-36 font-mono uppercase tracking-widest')} placeholder="K7QW3P" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={16} />
      <Button size="sm" type="submit">Find</Button>
    </form>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string | undefined) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => { if (text !== value) onChange(text.trim() || undefined); }, 400);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative min-w-[12rem] flex-1">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
      <input aria-label="Search messages, stacks and context" className={cn(inputCls, 'w-full pl-8')} placeholder="Search message, stack, route…" value={text} onChange={(e) => setText(e.target.value)} />
    </div>
  );
}

// ── Kinds ───────────────────────────────────────────────────────────────────

function Kinds({ filters, onPick }: { filters: ErrorFilters; onPick: (fingerprint: string) => void }) {
  const q = useQuery({ queryKey: ['admin', 'groups', filters], queryFn: () => adminApi.groups(filters), refetchInterval: 30_000 });
  if (q.isError) return <LoadFailed error={q.error} />;
  if (!q.data) return <Skeleton className="h-64" />;
  if (q.data.length === 0) return <Empty>No errors in this period. 🎉</Empty>;
  return (
    <div className="overflow-hidden rounded-lg border">
      {q.data.map((g) => <KindRow key={g.fingerprint} g={g} onPick={onPick} />)}
    </div>
  );
}

const STATUS_CLS: Record<ErrorGroupStatus, string> = { open: 'text-red-300', resolved: 'text-emerald-300', ignored: 'text-muted-foreground' };

function KindRow({ g, onPick }: { g: ErrorGroupDto; onPick: (fp: string) => void }) {
  const qc = useQueryClient();
  const mark = useMutation({
    mutationFn: (status: ErrorGroupStatus) => adminApi.markGroup(g.fingerprint, { status }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin'] }); },
  });
  return (
    <div className="flex flex-col gap-2 border-b bg-card px-4 py-3 last:border-b-0 sm:flex-row sm:items-center">
      <button className="min-w-0 flex-1 text-left" onClick={() => onPick(g.fingerprint)}>
        <div className="flex flex-wrap items-center gap-2">
          <LevelDot level={g.level} />
          <SourceBadge source={g.source} />
          {g.isNew && <span className="rounded bg-red-500/20 px-1.5 text-[11px] uppercase text-red-300">new</span>}
          <span className={cn('text-[11px] uppercase', STATUS_CLS[g.status])}>{g.status}</span>
        </div>
        <p className="mt-1 break-words font-mono text-sm">{g.message.slice(0, 220)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {g.count}× · last {ago(g.lastSeen)} · first {ago(g.firstSeen)}
          {g.servers > 0 && ` · ${g.servers} server${g.servers === 1 ? '' : 's'}`}
          {g.users > 0 && ` · ${g.users} user${g.users === 1 ? '' : 's'}`}
          {g.releases.length > 0 && ` · ${g.releases.slice(0, 3).join(', ')}`}
          {g.note && <> · <span className="italic">{g.note}</span></>}
        </p>
      </button>
      <div className="flex shrink-0 gap-1.5">
        {g.status !== 'resolved' && <Button size="sm" variant="outline" disabled={mark.isPending} onClick={() => mark.mutate('resolved')}>Resolve</Button>}
        {g.status !== 'ignored' && <Button size="sm" variant="ghost" disabled={mark.isPending} onClick={() => mark.mutate('ignored')}>Ignore</Button>}
        {g.status !== 'open' && <Button size="sm" variant="ghost" disabled={mark.isPending} onClick={() => mark.mutate('open')}>Reopen</Button>}
      </div>
    </div>
  );
}

// ── Occurrences ─────────────────────────────────────────────────────────────

export function OccurrenceList({ rows, highlight }: { rows: ErrorEventDto[]; highlight?: Set<number> }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-hidden rounded-lg border">
      {rows.map((e) => (
        <Link key={e.id} to={`${ADMIN}/errors/${e.id}`} onClick={(ev) => { if (ev.metaKey || ev.ctrlKey) return; ev.preventDefault(); navigate(`${ADMIN}/errors/${e.id}`); }}
          className={cn('block border-b bg-card px-4 py-2.5 last:border-b-0 hover:bg-accent/40', highlight?.has(e.id) && 'bg-primary/10')}>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <LevelDot level={e.level} />
            <SourceBadge source={e.source} />
            <time dateTime={e.createdAt} title={e.createdAt}>{when(e.createdAt)}</time>
            {e.ref && <span className="font-mono">Ref {e.ref}</span>}
            {e.guildName && <span>· {e.guildName}</span>}
            {e.userName && <span>· {e.userName}</span>}
            {typeof e.context['route'] === 'string' && <span className="font-mono">· {String(e.context['method'] ?? '')} {e.context['route']}</span>}
            {typeof e.context['interaction'] === 'string' && <span className="font-mono">· {e.context['interaction']}</span>}
            {typeof e.context['page'] === 'string' && <span className="font-mono">· {e.context['page']}</span>}
            {e.suppressed > 0 && <span>· +{e.suppressed} similar dropped</span>}
          </div>
          <p className="mt-1 break-words font-mono text-sm">{e.message.slice(0, 300)}</p>
        </Link>
      ))}
    </div>
  );
}

function All({ filters }: { filters: ErrorFilters }) {
  const navigate = useNavigate();
  const q = useInfiniteQuery({
    queryKey: ['admin', 'errors', filters],
    queryFn: ({ pageParam }) => adminApi.errors({ ...filters, period: undefined, status: undefined, before: pageParam, limit: 50 }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.length === 50 ? last[last.length - 1]!.id : undefined),
  });
  const rows = q.data?.pages.flat() ?? [];
  // Searching a ref that matches one error opens it.
  useEffect(() => {
    if (filters.ref && q.data && rows.length === 1) navigate(`${ADMIN}/errors/${rows[0]!.id}`, { replace: true });
  }, [filters.ref, q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.isError) return <LoadFailed error={q.error} />;
  if (!q.data) return <Skeleton className="h-64" />;
  if (rows.length === 0) return <Empty>{filters.ref ? `Nothing found for Ref ${filters.ref}. Codes are kept 90 days.` : 'Nothing matches.'}</Empty>;
  return (
    <div className="space-y-3">
      <OccurrenceList rows={rows} />
      {q.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>{q.isFetchingNextPage ? 'Loading…' : 'Load older'}</Button>
        </div>
      )}
    </div>
  );
}

function Live({ filters }: { filters: ErrorFilters }) {
  const [rows, setRows] = useState<ErrorEventDto[]>([]);
  const [paused, setPaused] = useState(false);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const cursor = useRef<number | null>(null);
  const key = JSON.stringify(filters);

  // Start from the latest 20, then ask for anything newer every 3 seconds.
  const start = useQuery({ queryKey: ['admin', 'live-start', key], queryFn: () => adminApi.errors({ ...filters, period: undefined, status: undefined, limit: 20 }), staleTime: Infinity });
  useEffect(() => {
    if (!start.data) return;
    setRows(start.data);
    cursor.current = start.data[0]?.id ?? 0;
  }, [start.data]);
  const poll = useQuery({
    queryKey: ['admin', 'live', key, cursor.current],
    queryFn: () => adminApi.errors({ ...filters, period: undefined, status: undefined, after: cursor.current ?? 0, limit: 100 }),
    enabled: cursor.current !== null && !paused,
    refetchInterval: 3_000,
  });
  useEffect(() => {
    const got = poll.data;
    if (!got || got.length === 0) return;
    cursor.current = got[got.length - 1]!.id;
    const newest = [...got].reverse();
    setFresh(new Set(newest.map((e) => e.id)));
    setRows((old) => [...newest, ...old.filter((o) => !newest.some((n) => n.id === o.id))].slice(0, 300));
  }, [poll.data]);

  if (start.isError) return <LoadFailed error={start.error} />;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <span className={cn('inline-flex items-center gap-2', paused ? 'text-muted-foreground' : 'text-emerald-300')}>
          <span className={cn('h-2 w-2 rounded-full', paused ? 'bg-muted-foreground' : 'animate-pulse bg-emerald-400')} />
          {paused ? 'Paused' : 'Watching for new errors'}
        </span>
        <Button size="sm" variant="outline" onClick={() => setPaused((p) => !p)}>
          {paused ? <><Play className="mr-1 h-3.5 w-3.5" />Resume</> : <><Pause className="mr-1 h-3.5 w-3.5" />Pause</>}
        </Button>
        {poll.isError && <span className="text-xs text-destructive">Lost connection; retrying…</span>}
      </div>
      {!start.data ? <Skeleton className="h-64" /> : rows.length === 0 ? <Empty>Nothing yet. New errors appear here as they happen.</Empty> : <OccurrenceList rows={rows} highlight={fresh} />}
    </div>
  );
}
