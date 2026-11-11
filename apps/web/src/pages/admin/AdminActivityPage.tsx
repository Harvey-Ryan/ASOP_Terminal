// Admin → Activity (v1.13.0): servers adding or removing the bot, and every
// change made from the admin panel, newest first.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ADMIN_LOG_KINDS } from '@dem/shared';
import { adminApi } from '@/api/admin';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ADMIN, Empty, LoadFailed, selectCls, when } from './adminUi';

const ICON: Record<string, string> = { 'guild.joined': '➕', 'guild.left': '➖', 'admin.settings': '⚙️', 'admin.errors': '🩹', 'admin.config': '📡', 'admin.test': '✅' };
const label = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : String(v));

export function AdminActivityPage() {
  const [kind, setKind] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['admin', 'log', kind],
    queryFn: ({ pageParam }) => adminApi.log({ kind: kind || undefined, before: pageParam, limit: 50 }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.length === 50 ? last[last.length - 1]!.id : undefined),
  });
  const rows = q.data?.pages.flat() ?? [];
  return (
    <div className="space-y-3">
      <select aria-label="Kind" className={selectCls} value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="">Everything</option>
        <option value="guild.">Servers joining and leaving</option>
        <option value="admin.">Admin changes</option>
        {Object.entries(ADMIN_LOG_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      {q.isError ? <LoadFailed error={q.error} /> : !q.data ? <Skeleton className="h-64" /> : rows.length === 0 ? <Empty>Nothing yet.</Empty> : (
        <ol className="overflow-hidden rounded-lg border">
          {rows.map((l) => {
            const changes = (l.details['changes'] ?? null) as Record<string, [unknown, unknown]> | null;
            return (
              <li key={l.id} className="border-b bg-card px-4 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span aria-hidden>{ICON[l.kind] ?? '•'}</span>
                  <time dateTime={l.createdAt}>{when(l.createdAt)}</time>
                  <span>· {ADMIN_LOG_KINDS[l.kind] ?? l.kind}</span>
                  {l.actorName && <span>· by {l.actorName}</span>}
                  {l.guildId && <Link className="text-primary hover:underline" to={`${ADMIN}/servers/${l.guildId}`}>· {l.guildName ?? l.guildId}</Link>}
                </div>
                <p className="mt-1 text-sm">{l.summary}</p>
                {changes && (
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {Object.entries(changes).map(([k, [a, b]]) => <li key={k}><span className="font-mono">{k}</span>: {label(a)} → <span className="text-foreground">{label(b)}</span></li>)}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {q.hasNextPage && <div className="flex justify-center"><Button size="sm" variant="outline" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Load older</Button></div>}
    </div>
  );
}
