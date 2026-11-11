// Admin → Overview (v1.13.0): is everything up, how many errors, what's going on.

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { adminApi } from '@/api/admin';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ADMIN, LoadFailed, Section, Stat, ago } from './adminUi';

export function AdminOverviewPage() {
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: adminApi.overview, refetchInterval: 30_000 });
  if (q.isError) return <LoadFailed error={q.error} />;
  const o = q.data;
  if (!o) return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>;

  const maxHour = Math.max(1, ...o.errorsByHour.map((h) => h.errors + h.warnings));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {o.services.map((s) => (
          <Stat key={s.service} label={s.service === 'api' ? 'Website & API' : 'Discord bot'}
            value={s.up ? 'Up' : 'Not reporting'} tone={s.up ? 'good' : 'bad'}
            sub={<>{s.release || '—'} · {s.up ? `started ${ago(s.startedAt)}` : `last seen ${ago(s.beatAt)}`}
              {s.service === 'bot' && s.up && <> · {String(s.details['guilds'] ?? '?')} servers · ping {String(s.details['wsPingMs'] ?? '?')} ms</>}</>} />
        ))}
        <Stat label="Database" value={`${o.database.latencyMs} ms`} tone={o.database.latencyMs > 500 ? 'warn' : 'good'} sub="round trip" />
        <Stat label="Game data" value={o.gameData?.build ?? 'Not set up'} tone={o.gameData?.build ? undefined : 'warn'}
          sub={o.gameData ? `loaded ${ago(o.gameData.syncedAt)} · checked ${ago(o.gameData.checkedAt)}` : undefined} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Errors, last hour" value={o.errors.lastHour} tone={o.errors.lastHour > 0 ? 'bad' : 'good'} to={`${ADMIN}/errors?view=all&period=1h&level=error`} />
        <Stat label="Errors, 24 h" value={o.errors.last24h}
          sub={Object.entries(o.errors.bySource24h).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'} to={`${ADMIN}/errors?period=24h`} />
        <Stat label="New kinds, 24 h" value={o.errors.newKinds24h} tone={o.errors.newKinds24h > 0 ? 'warn' : undefined} to={`${ADMIN}/errors?period=24h`} />
        <Stat label="Open kinds (7 days)" value={o.errors.openKinds} sub={`${o.errors.warnings24h} warnings in 24 h`} to={`${ADMIN}/errors?period=7d&status=open`} />
      </div>

      <Section title="Errors per hour, last 24 hours">
        <div className="flex h-32 items-end gap-1" role="img" aria-label="Errors and warnings per hour">
          {o.errorsByHour.map((h) => (
            <div key={h.hour} className="flex flex-1 flex-col justify-end" title={`${new Date(h.hour).toLocaleTimeString([], { hour: 'numeric' })}: ${h.errors} errors, ${h.warnings} warnings`}>
              <div className="bg-yellow-400/60" style={{ height: `${(h.warnings / maxHour) * 100}%` }} />
              <div className={cn('bg-red-500/80', h.errors + h.warnings === 0 && 'h-px bg-muted')} style={h.errors ? { height: `${(h.errors / maxHour) * 100}%` } : undefined} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{new Date(o.errorsByHour[0]!.hour).toLocaleTimeString([], { hour: 'numeric' })}</span>
          <span><span className="mr-1 inline-block h-2 w-2 bg-red-500/80" />errors <span className="ml-2 mr-1 inline-block h-2 w-2 bg-yellow-400/60" />warnings</span>
          <span>now</span>
        </div>
      </Section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Servers" value={o.servers.total} sub={`+${o.servers.joined7d} / −${o.servers.left7d} this week`} to={`${ADMIN}/servers`} />
        <Stat label="Requests, 24 h" value={o.requests.last24h.toLocaleString()} sub={`${o.requests.failed24h} failed · slowest ${(o.requests.slowest24hMs / 1000).toFixed(1)} s`}
          tone={o.requests.failed24h > 0 ? 'warn' : undefined} />
        <Stat label="Events" value={o.activity.upcomingEvents} sub={`upcoming · ${o.activity.liveEvents} live now`} />
        <Stat label="People active, 7 days" value={o.activity.activeUsers7d} sub={`${o.activity.openLootSessions} loot sessions open`} />
      </div>

      {!o.feed.configured && (
        <p className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm">
          The admin Discord feed isn't set up yet. <Link to={`${ADMIN}/feed`} className="text-primary underline">Choose a channel</Link> to get error alerts and a daily digest.
        </p>
      )}
      <p className="text-xs text-muted-foreground">Live: v{o.release.version}{o.release.commit && ` (${o.release.commit})`}. Refreshes every 30 seconds.</p>
    </div>
  );
}
