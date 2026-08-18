import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { trafficApi } from '@/api/traffic';
import type { ModuleStat, DayStat } from '@/api/traffic';

// ── Helpers ───────────────────────────────────────────────────────────────────

function titleCase(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function usePref<T>(key: string, def: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : def;
    } catch {
      return def;
    }
  });
  function save(v: T) {
    setVal(v);
    localStorage.setItem(key, JSON.stringify(v));
  }
  return [val, save];
}

const METHOD_COLORS: Record<string, string> = {
  GET:    'bg-blue-500/15 text-blue-400',
  POST:   'bg-green-500/15 text-green-400',
  PATCH:  'bg-yellow-500/15 text-yellow-400',
  PUT:    'bg-orange-500/15 text-orange-400',
  DELETE: 'bg-red-500/15 text-red-400',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function TrendBar({ timeSeries }: { timeSeries: DayStat[] }) {
  if (timeSeries.length === 0) {
    return <p className="text-xs text-muted-foreground">No data for this period.</p>;
  }
  const max = Math.max(...timeSeries.map((d) => d.total), 1);
  return (
    <div className="flex items-end gap-px h-16 w-full">
      {timeSeries.map((d) => {
        const pct = Math.max((d.total / max) * 100, 2);
        return (
          <Tooltip key={d.date}>
            <TooltipTrigger asChild>
              <div
                className="flex-1 min-w-0 rounded-t-sm bg-primary/60 hover:bg-primary transition-colors cursor-default"
                style={{ height: `${pct}%` }}
              />
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">{d.date}</p>
              <p className="text-xs font-semibold">{d.total.toLocaleString()} reqs</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function ModuleCard({
  stat,
  badge,
}: {
  stat: ModuleStat;
  badge: 'most' | 'least' | null;
}) {
  const dim = stat.requests === 0;
  return (
    <Card className={dim ? 'opacity-40' : ''}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-sm font-medium leading-tight">{titleCase(stat.module)}</p>
          {badge === 'most' && (
            <span className="shrink-0 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold text-green-400">
              Most used
            </span>
          )}
          {badge === 'least' && (
            <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
              Least used
            </span>
          )}
        </div>
        <p className="text-2xl font-bold tabular-nums">{stat.requests.toLocaleString()}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {stat.uniqueUsers} unique user{stat.uniqueUsers !== 1 ? 's' : ''}
        </p>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function TrafficPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [days, setDays] = usePref<number>(`traffic-${guildId}-days`, 30);

  const { data, isLoading, error } = useQuery({
    queryKey: ['traffic-summary', guildId, days],
    queryFn: () => trafficApi.getSummary(guildId!, days),
    enabled: !!guildId,
    staleTime: 60_000,
    retry: false,
  });

  if (error && (error as { status?: number }).status === 403) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm text-muted-foreground">
            You need guild manager permissions to view traffic data.
          </p>
        </CardContent>
      </Card>
    );
  }

  const modules = data?.modules ?? [];
  const topRoutes = data?.topRoutes ?? [];
  const timeSeries = data?.timeSeries ?? [];
  const totalRequests = data?.totalRequests ?? 0;

  const busiest = timeSeries.reduce(
    (best, d) => (d.total > (best?.total ?? 0) ? d : best),
    null as DayStat | null,
  );

  const uniqueUsersTotal = modules.reduce((sum, m) => sum + m.uniqueUsers, 0);

  // Badge only the top/bottom non-zero module
  const nonZero = modules.filter((m) => m.requests > 0);
  const mostUsed = nonZero[0]?.module ?? null;
  const leastUsed = nonZero.length > 1 ? nonZero[nonZero.length - 1]?.module ?? null : null;

  return (
    <div className="space-y-6">

      {/* Controls */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-lg font-semibold">Traffic Monitor</h1>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-4 pb-4"><Skeleton className="h-10 w-full" /></CardContent></Card>
          ))
        ) : (
          <>
            <StatCard label="Total requests" value={totalRequests.toLocaleString()} />
            <StatCard label="Unique users" value={uniqueUsersTotal.toLocaleString()} />
            <StatCard
              label="Busiest day"
              value={busiest ? `${busiest.date} (${busiest.total.toLocaleString()})` : '—'}
            />
          </>
        )}
      </div>

      {/* Daily trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Daily Request Volume</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <TrendBar timeSeries={timeSeries} />
          )}
        </CardContent>
      </Card>

      {/* Module cards */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Module Usage</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
          ) : modules.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No traffic data yet for this period. Data appears after the first flush (~10 s after requests arrive).
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {modules.map((m) => (
                <ModuleCard
                  key={m.module}
                  stat={m}
                  badge={
                    m.module === mostUsed ? 'most'
                    : m.module === leastUsed ? 'least'
                    : null
                  }
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top routes table */}
      {topRoutes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Top Routes</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="pl-6 pr-3 py-2 text-left font-medium">Method</th>
                  <th className="px-3 py-2 text-left font-medium">Path</th>
                  <th className="px-3 py-2 text-right font-medium">Requests</th>
                  <th className="pl-3 pr-6 py-2 text-right font-medium">% of total</th>
                </tr>
              </thead>
              <tbody>
                {topRoutes.slice(0, 15).map((r, i) => {
                  const pct = totalRequests > 0 ? ((r.count / totalRequests) * 100).toFixed(1) : '0.0';
                  const methodCls = METHOD_COLORS[r.method] ?? 'bg-muted text-muted-foreground';
                  return (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="pl-6 pr-3 py-2">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold font-mono ${methodCls}`}>
                          {r.method}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground truncate max-w-[280px]">
                        {r.path}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.count.toLocaleString()}
                      </td>
                      <td className="pl-3 pr-6 py-2 text-right text-muted-foreground tabular-nums">
                        {pct}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
