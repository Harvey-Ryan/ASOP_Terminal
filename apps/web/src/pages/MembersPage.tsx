// Member history (v1.18.0): the list of everyone who signed up for or attended
// this server's events (officers), and one person's history (officers, or
// anyone for their own at /members/me).

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, History, Users } from 'lucide-react';
import type { HistoryOutcome, MemberSummaryDto } from '@dem/shared';
import { membersApi } from '@/api/members';
import { DateRangeFilter, useDateRange } from '@/components/DateRangeFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDkpLabel } from '@/hooks/useDkpLabel';
import { cn } from '@/lib/utils';

const ago = (iso: string | null) => {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
const rate = (n: number | null) => (n === null ? '—' : `${n}%`);

function Failed({ error }: { error: unknown }) {
  const forbidden = (error as { status?: number })?.status === 403;
  return <p className="text-sm text-muted-foreground">{forbidden ? 'Only officers who can create events can see other members\' history.' : 'Couldn\'t load this. Try again in a moment.'}</p>;
}

// ── The list ─────────────────────────────────────────────────────────────────

type Sort = 'name' | 'attended' | 'rate' | 'last';

export function MembersPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const dr = useDateRange();
  const q = useQuery({ queryKey: ['members', guildId, 'list', dr.range], queryFn: () => membersApi.list(guildId!, dr.range), retry: false, placeholderData: (prev) => prev });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('attended');

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = (q.data ?? []).filter((m) => !s || m.name.toLowerCase().includes(s));
    const by: Record<Sort, (a: MemberSummaryDto, b: MemberSummaryDto) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      attended: (a, b) => b.attended - a.attended || a.name.localeCompare(b.name),
      rate: (a, b) => (b.showRate ?? -1) - (a.showRate ?? -1) || b.signedUp - a.signedUp,
      last: (a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''),
    };
    return [...list].sort(by[sort]);
  }, [q.data, search, sort]);

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Users className="h-6 w-6" aria-hidden />Members</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Everyone who signed up for or attended this server's events. Attendance counts where it was recorded: the attendance check after an event, or who was in its voice channels.
        </p>
      </div>
      {q.isError ? <Failed error={q.error} /> : !q.data ? <Skeleton className="h-64" /> : (
        <>
          <DateRangeFilter value={dr} />
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Find a member" placeholder="Find a member" value={search} onChange={(e) => setSearch(e.target.value)}
              className="h-9 min-w-[12rem] flex-1 rounded-md border border-input bg-background px-3 text-sm" />
            <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm">
              <option value="attended">Most attended</option>
              <option value="rate">Best show-up rate</option>
              <option value="last">Seen most recently</option>
              <option value="name">Name</option>
            </select>
            <span className="text-sm text-muted-foreground">{q.data.length} member{q.data.length === 1 ? '' : 's'}</span>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="grid grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
                <span>Member</span><span>Attended</span><span title="Of the events they signed up for">Showed up</span><span>Last seen</span>
              </div>
              {rows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">{q.data.length ? 'No member matches.' : dr.active ? 'Nobody signed up for or attended an event in this range.' : 'Nobody has signed up for an event yet.'}</p>}
              {rows.map((m) => (
                <Link key={m.userId} to={`${m.userId}${dr.search}`}
                  className="grid grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] items-center gap-2 border-b px-4 py-2.5 text-sm last:border-0 hover:bg-accent">
                  <span className="truncate font-medium">{m.name}</span>
                  <span>{m.attended}</span>
                  <span className={cn(m.showRate !== null && m.showRate < 60 && 'text-yellow-400')}>
                    {rate(m.showRate)}{m.noShows > 0 && <span className="ml-1 text-xs text-muted-foreground">({m.noShows} no-show{m.noShows === 1 ? '' : 's'})</span>}
                  </span>
                  <span className="text-muted-foreground">{ago(m.lastSeen)}</span>
                </Link>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ── One member ───────────────────────────────────────────────────────────────

const OUTCOME: Record<HistoryOutcome, { label: string; cls: string }> = {
  attended: { label: 'Attended', cls: 'bg-emerald-500/15 text-emerald-300' },
  'no-show': { label: 'No-show', cls: 'bg-red-500/15 text-red-300' },
  maybe: { label: 'Maybe', cls: 'bg-muted text-muted-foreground' },
  upcoming: { label: 'Upcoming', cls: 'bg-sky-500/15 text-sky-300' },
  'not-recorded': { label: 'Not recorded', cls: 'bg-muted text-muted-foreground' },
};

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function MemberHistoryPage() {
  const { guildId, userId } = useParams<{ guildId: string; userId: string }>();
  const dkpLabel = useDkpLabel(guildId);
  const own = userId === 'me';
  const dr = useDateRange();
  const q = useQuery({ queryKey: ['members', guildId, userId, dr.range], queryFn: () => membersApi.get(guildId!, userId!, dr.range), retry: false, placeholderData: (prev) => prev });
  const h = q.data;

  return (
    <div className="max-w-4xl space-y-4">
      {!own && <Link to={`..${dr.search}`} relative="path" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden />Members</Link>}
      {q.isError ? <Failed error={q.error} /> : !h ? <Skeleton className="h-96" /> : (
        <>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><History className="h-6 w-6" aria-hidden />{own ? 'My history' : h.name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[h.rsiHandle && `RSI: ${h.rsiHandle}`, h.stats.firstSeen && `First event ${new Date(h.stats.firstSeen).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`].filter(Boolean).join(' · ') || 'No events attended yet.'}
            </p>
          </div>

          <DateRangeFilter value={dr} />

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat value={h.stats.attended} label="Attended" />
            <Stat value={rate(h.stats.showRate)} label="Showed up when signed up" />
            <Stat value={h.stats.noShows} label="No-shows" />
            {h.dkp ? <Stat value={h.dkp.balance} label={dr.active ? `${dkpLabel} now` : dkpLabel} /> : <Stat value={h.loot.total} label="Loot items" />}
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Events</CardTitle></CardHeader>
            <CardContent className="pt-0">
              {h.events.length === 0 ? <p className="text-sm text-muted-foreground">{dr.active ? 'No events in this range.' : 'No events yet.'}</p> : (
                <ul>
                  {h.events.map((e) => (
                    <li key={e.eventId} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-2 border-t py-2 text-sm first:border-t-0">
                      <span className="text-muted-foreground">{day(e.startTime)}</span>
                      <span className="truncate">{e.name}{e.role && <span className="text-muted-foreground"> · {e.role}</span>}{e.walkIn && <span className="text-muted-foreground"> · came without signing up</span>}</span>
                      <span className={cn('rounded px-2 py-0.5 text-xs', OUTCOME[e.outcome].cls)}>{OUTCOME[e.outcome].label}</span>
                    </li>
                  ))}
                </ul>
              )}
              {h.rolesPlayed.length > 0 && (
                <p className="mt-3 border-t pt-3 text-sm"><span className="text-muted-foreground">Roles played most: </span>{h.rolesPlayed.slice(0, 5).map((r) => `${r.role} ${r.count}`).join(' · ')}</p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Loot received ({h.loot.total})</CardTitle></CardHeader>
              <CardContent className="pt-0">
                {h.loot.recent.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
                  <ul className="space-y-1.5 text-sm">
                    {h.loot.recent.map((l, i) => (
                      <li key={i} className="flex justify-between gap-2"><span className="truncate">{l.name}{l.quantity > 1 && ` ×${l.quantity}`}<span className="text-muted-foreground"> · {l.session}</span></span><span className="shrink-0 text-muted-foreground">{day(l.at)}</span></li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{dkpLabel}</CardTitle></CardHeader>
              <CardContent className="pt-0">
                {!h.dkp ? <p className="text-sm text-muted-foreground">No {dkpLabel} yet.</p> : (
                  <ul className="space-y-1.5 text-sm">
                    {h.dkp.recent.length === 0 && <li className="text-muted-foreground">Balance {h.dkp.balance}, no changes yet.</li>}
                    {h.dkp.recent.map((t, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="truncate"><span className={t.amount >= 0 ? 'text-emerald-300' : 'text-red-300'}>{t.amount >= 0 ? '+' : ''}{t.amount}</span> · {t.reason}</span>
                        <span className="shrink-0 text-muted-foreground">{day(t.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {h.tournaments.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Tournaments</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <ul className="space-y-1.5 text-sm">
                  {h.tournaments.map((t) => (
                    <li key={t.id} className="flex justify-between gap-2"><span className="truncate">{t.name}<span className="text-muted-foreground"> · {t.result}</span></span><span className="shrink-0 text-muted-foreground">{day(t.at)}</span></li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
