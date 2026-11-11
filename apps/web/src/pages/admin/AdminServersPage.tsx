// Admin → Servers (v1.13.0): every server the bot is in, what's switched on,
// what looks unfinished, and how busy it is.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ADMIN_SETTING_FIELDS } from '@dem/shared';
import { adminApi } from '@/api/admin';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ADMIN, Empty, LoadFailed, ago, inputCls, selectCls } from './adminUi';

const MODULES = ADMIN_SETTING_FIELDS.filter((f) => f.group === 'Modules');

export function AdminServersPage() {
  const q = useQuery({ queryKey: ['admin', 'guilds'], queryFn: adminApi.guilds });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'name' | 'joined' | 'active' | 'issues' | 'errors'>('name');
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = (q.data ?? []).filter((g) => !s || g.name.toLowerCase().includes(s) || g.guildId.includes(s));
    const by = {
      name: (a: typeof list[0], b: typeof list[0]) => a.name.localeCompare(b.name),
      joined: (a: typeof list[0], b: typeof list[0]) => b.joinedAt.localeCompare(a.joinedAt),
      active: (a: typeof list[0], b: typeof list[0]) => b.counts.events30d - a.counts.events30d,
      issues: (a: typeof list[0], b: typeof list[0]) => b.setupIssues.length - a.setupIssues.length,
      errors: (a: typeof list[0], b: typeof list[0]) => b.errors7d - a.errors7d,
    }[sort];
    return [...list].sort(by);
  }, [q.data, search, sort]);

  if (q.isError) return <LoadFailed error={q.error} />;
  if (!q.data) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Find a server" className={cn(inputCls, 'min-w-[12rem] flex-1')} placeholder="Find a server by name or id" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Sort" className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="name">Name</option><option value="joined">Newest</option><option value="active">Most events</option>
          <option value="issues">Most setup problems</option><option value="errors">Most errors</option>
        </select>
        <span className="text-sm text-muted-foreground">{q.data.length} servers</span>
      </div>
      {rows.length === 0 ? <Empty>No server matches.</Empty> : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((g) => (
            <Link key={g.guildId} to={`${ADMIN}/servers/${g.guildId}`} className="block rounded-lg border bg-card p-4 transition-colors hover:border-primary/60">
              <div className="flex items-center gap-3">
                {g.iconUrl ? <img src={g.iconUrl} alt="" className="h-10 w-10 rounded-full" /> : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm">{g.name.slice(0, 2)}</div>}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{g.name}</div>
                  <div className="text-xs text-muted-foreground">Joined {ago(g.joinedAt)} · {g.counts.upcomingEvents} upcoming · {g.counts.events30d} events in 30 days · last {ago(g.lastEventAt)}</div>
                </div>
                {g.errors7d > 0 && <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-300" title="Errors in the last 7 days">{g.errors7d} errors</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {MODULES.map((m) => (
                  <span key={m.key} className={cn('rounded px-1.5 py-0.5 text-[11px]', g.modules[m.key] ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground line-through')}>{m.label}</span>
                ))}
              </div>
              <div className="mt-3 text-xs">
                {g.setupIssues.length === 0
                  ? <span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Set up</span>
                  : <span className="inline-flex items-start gap-1 text-yellow-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{g.setupIssues[0]}{g.setupIssues.length > 1 && ` (+${g.setupIssues.length - 1} more)`}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
