import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus, StopCircle, ExternalLink, Package, ChevronsRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { eventsApi } from '@/api/events';
import { applyShade, loadShade, saveShade } from '@/lib/shade';
import { lootApi } from '@/api/loot';
import { canManageGuild } from '@dem/shared';
import type { EventDto, EventRole } from '@dem/shared';
import type { RecentLootEvent } from '@/api/loot';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

const RECUR_LABELS: Record<string, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Every 2 weeks',
  MONTHLY: 'Monthly',
};

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-yellow-500/15 text-yellow-600',
  ACTIVE: 'bg-green-500/15 text-green-600',
  ENDED: 'bg-red-500/15 text-red-500',
  COMPLETED: 'bg-muted text-muted-foreground',
};

type Tab = 'upcoming' | 'completed';

// ── Event detail modal ────────────────────────────────────────────────────────

function EventModal({ event, guildId, onClose, onEnd, isEnding }: {
  event: EventDto;
  guildId: string;
  onClose: () => void;
  onEnd: () => void;
  isEnding: boolean;
}) {
  const roles: EventRole[] = event.roles ?? [];
  const start = new Date(event.startTime);
  const end = event.endTime ? new Date(event.endTime) : null;

  const dateStr = start.toLocaleDateString('en', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const timeStr = start.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  const endTimeStr = end
    ? end.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
    : null;

  const canEnd = event.status !== 'ENDED' && event.status !== 'COMPLETED';
  const unassigned = event.rsvps?.filter((r) => !r.role) ?? [];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto p-0">
        {/* Header */}
        <div className="flex gap-3 p-5 pb-0">
          <div className="flex-1 min-w-0">
            <DialogHeader>
              <DialogTitle className="text-base flex items-center gap-2 flex-wrap">
                📅 {event.name}
                {STATUS_BADGE[event.status] && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[event.status]}`}>
                    {event.status}
                  </span>
                )}
              </DialogTitle>
            </DialogHeader>
            {event.description && (
              <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">{event.description}</p>
            )}
          </div>
          {event.imageUrl && (
            <img
              src={`${API_BASE}${event.imageUrl}`}
              alt="Event"
              className="h-16 w-16 rounded-md object-cover shrink-0 mt-1"
            />
          )}
        </div>

        {/* Embed accent fields */}
        <div className="mx-5 mt-4 rounded-md border-l-4 border-primary bg-muted/40 p-3 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide mb-0.5">🕐 When</p>
            <p className="text-sm">
              {dateStr} · {timeStr}{endTimeStr ? ` → ${endTimeStr}` : ''}
              {event.recurType && (
                <span className="text-muted-foreground"> · {RECUR_LABELS[event.recurType] ?? event.recurType}</span>
              )}
            </p>
          </div>

          {event.musterPoint && (
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide mb-0.5">📍 Muster Point</p>
              <p className="text-sm">{event.musterPoint}</p>
            </div>
          )}

          {roles.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {roles.map((role) => {
                const members = event.rsvps?.filter((r) => r.role === role.name) ?? [];
                return (
                  <div key={role.name}>
                    <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide mb-0.5">
                      {role.name} ({members.length}/{role.count})
                    </p>
                    <p className="text-sm">
                      {members.length > 0
                        ? members.map((r) => r.username).join(', ')
                        : <span className="italic text-muted-foreground">None</span>}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide mb-0.5">
              📋 Unassigned ({unassigned.length})
            </p>
            <p className="text-sm">
              {unassigned.length > 0
                ? unassigned.map((r) => r.username).join(', ')
                : <span className="italic text-muted-foreground">None</span>}
            </p>
          </div>

          {/* Loot result (completed events) */}
          {event.status === 'COMPLETED' && event.hadLoot !== null && (
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide mb-0.5">🎁 Loot</p>
              <p className="text-sm">
                {event.hadLoot ? 'Yes' : 'No loot'}
                {event.lootNotes && <span className="text-muted-foreground"> — {event.lootNotes}</span>}
              </p>
            </div>
          )}

          {/* Loot distribution link (completed events) */}
          {event.status === 'COMPLETED' && (
            <div className="flex items-center justify-between pt-1">
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">🎁 Loot Distribution</p>
              <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1">
                <Link to={`/dashboard/servers/${guildId}/events/${event.id}/loot`}>
                  <ExternalLink className="h-3 w-3" />
                  Open
                </Link>
              </Button>
            </div>
          )}
        </div>

        {/* Audit prompt (ended events) */}
        {event.status === 'ENDED' && (
          <div className="mx-5 mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 flex items-center justify-between gap-3">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              This event has ended. Review attendance and record loot on the audit page.
            </p>
            <Button asChild size="sm" className="shrink-0 gap-1">
              <Link to={`/dashboard/servers/${guildId}/events/${event.id}/audit`}>
                <ExternalLink className="h-3.5 w-3.5" />
                Audit
              </Link>
            </Button>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4">
          <p className="text-xs text-muted-foreground">
            👥 {event.rsvpCounts.total} attending
            {event.discordEventId == null && event.status === 'PENDING' && (
              <span className="ml-2 text-yellow-500">· Discord sync pending…</span>
            )}
          </p>
          {canEnd && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-destructive hover:text-destructive"
              onClick={onEnd}
              disabled={isEnding}
            >
              <StopCircle className="h-3.5 w-3.5" />
              {isEnding ? 'Ending…' : 'End Event'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Event row (Fleet Manager style) ──────────────────────────────────────────

function EventCard({ event, userId, onClick }: { event: EventDto; userId?: string; onClick: () => void }) {
  const start = new Date(event.startTime);
  const month = start.toLocaleDateString('en', { month: 'short' });
  const day = start.getDate();
  const time = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const location = event.musterPoint ?? '—';
  const userRsvp = userId ? event.rsvps.find((r) => r.userId === userId) : undefined;

  return (
    <button
      onClick={onClick}
      className="group w-full text-left flex items-center bg-primary text-primary-foreground hover:bg-background hover:text-primary transition-colors border-b border-background/40 last:border-b-0"
    >
      {/* Date */}
      <div className="w-20 shrink-0 flex flex-col items-center px-4 py-3 text-center">
        <span className="text-[14px] font-bold uppercase leading-none opacity-75">{month}</span>
        <span className="text-[24px] font-bold leading-tight">{day}</span>
      </div>

      {/* Time */}
      <div className="w-28 shrink-0 px-4 py-3">
        <span className="text-[21px] font-medium">{time}</span>
      </div>

      {/* Event */}
      <div className="flex-1 px-4 py-3 min-w-0">
        <p className="font-semibold truncate text-[21px] leading-tight">{event.name}</p>
        {event.recurType && (
          <p className="text-[15px] opacity-60 truncate">{RECUR_LABELS[event.recurType] ?? event.recurType}</p>
        )}
      </div>

      {/* Location + Status + Role + Actions — 1/3 of total width */}
      <div className="w-1/3 shrink-0 flex items-center">
        <div className="flex-[2] px-4 py-3 hidden lg:flex items-center justify-center overflow-hidden">
          <span className="text-[21px] truncate">{location}</span>
        </div>
        <div className="flex-1 px-4 py-3 hidden sm:flex items-center justify-center">
          <span className="text-[21px] font-medium">{userRsvp ? 'Rostered' : '—'}</span>
        </div>
        <div className="flex-1 px-4 py-3 hidden md:flex items-center justify-center overflow-hidden">
          <span className="text-[21px] truncate">{userRsvp?.role ?? '—'}</span>
        </div>
        <div className="flex-1 px-4 py-3 flex justify-end">
          <span className="rounded p-1.5 bg-primary text-primary-foreground group-hover:bg-background group-hover:text-primary transition-colors">
            <ChevronsRight className="h-12 w-12 stroke-[3]" />
          </span>
        </div>
      </div>
    </button>
  );
}

// ── Recent Loot card ──────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function RecentLootCard({ guildId }: { guildId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['loot', 'recent', guildId],
    queryFn: () => lootApi.getRecent(guildId),
  });

  const event = data as RecentLootEvent | null | undefined;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Recent Loot</h2>
        </div>
        {event && (
          <Link
            to={`/dashboard/servers/${guildId}/events/${event.eventId}/loot`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {event.eventName} · {timeAgo(event.sessionUpdatedAt)}
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
        </div>
      ) : !event || event.items.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No loot awarded yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {event.items.map((item) => (
            <li key={item.id} className="py-2.5 first:pt-0 last:pb-0">
              <p className="text-sm font-medium">{item.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {item.winner.username}
                {item.winner.rollValue != null && (
                  <span className="ml-1.5 text-primary">🎲 {item.winner.rollValue}</span>
                )}
                {item.winner.dkpSpent != null && item.winner.dkpSpent > 0 && (
                  <span className="ml-1.5 text-amber-500">{item.winner.dkpSpent} DKP</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ServerPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const navigate = useNavigate();
  const { user, guilds } = useAuth();

  const [darkness, setDarkness] = useState(0);
  useEffect(() => {
    if (!user?.id) return;
    setDarkness(loadShade(user.id));
  }, [user?.id]);

  function handleDarknessChange(val: number) {
    setDarkness(val);
    applyShade(val);
    if (user?.id) saveShade(user.id, val);
  }
  const guild = guilds.find((g) => g.id === guildId);
  const isManager = !!guild && canManageGuild(guild);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [selected, setSelected] = useState<EventDto | null>(null);

  const upcomingQuery = useQuery({
    queryKey: ['events', guildId, 'upcoming'],
    queryFn: () => eventsApi.list(guildId!),
    enabled: !!guildId,
    retry: 1,
  });

  const completedQuery = useQuery({
    queryKey: ['events', guildId, 'completed'],
    queryFn: () => eventsApi.listCompleted(guildId!),
    enabled: !!guildId && tab === 'completed',
    retry: 1,
  });

  const active = tab === 'upcoming' ? upcomingQuery : completedQuery;

  const endMutation = useMutation({
    mutationFn: (eventId: string) => eventsApi.end(guildId!, eventId),
    onSuccess: (_, eventId) => {
      queryClient.invalidateQueries({ queryKey: ['events', guildId, 'upcoming'] });
      navigate(`/dashboard/servers/${guildId}/events/${eventId}/audit`);
    },
  });

  function handleEnd(event: EventDto) {
    if (confirm(`End "${event.name}"? The bot will clean up VCs and archive the forum thread.`)) {
      endMutation.mutate(event.id);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{guild?.name ?? 'Server'}</h1>
        <p className="mt-1 text-muted-foreground">Manage events for this server.</p>
      </div>

      {/* Responsive two-column layout: events left, loot right */}
      <div className={`grid grid-cols-1 gap-6 items-start${isManager ? ' lg:grid-cols-[1fr_360px]' : ''}`}>
        {/* Events panel – Fleet Manager style */}
        <div className="overflow-hidden rounded-xl border border-border">
          {/* Hazard stripe */}
          <div style={{ background: 'repeating-linear-gradient(-45deg, #181818 0px, #181818 8px, hsl(var(--primary)) 8px, hsl(var(--primary)) 12px)' }} className="h-2" />

          {/* Header bar */}
          <div className="flex items-center justify-between bg-card px-4 py-3 border-b border-border">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold uppercase tracking-widest text-white px-6">Event Manager</span>
              <div className="flex gap-1">
                {(['upcoming', 'completed'] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-3 py-1 rounded text-[11px] font-bold uppercase tracking-wide transition-colors ${
                      tab === t
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2" title="Adjust gold shade">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground hidden sm:block">Shade</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={darkness}
                  onChange={(e) => handleDarknessChange(Number(e.target.value))}
                  className="w-24 cursor-pointer"
                  style={{ accentColor: 'hsl(var(--primary))' }}
                />
              </div>
              {isManager && (
                <Button asChild size="sm">
                  <Link to={`/dashboard/servers/${guildId}/events/new`}>
                    <Plus className="h-3.5 w-3.5" />
                    Create Event
                  </Link>
                </Button>
              )}
            </div>
          </div>

          {/* Column headers */}
          <div className="flex items-center bg-secondary text-primary text-[15px] font-bold uppercase tracking-widest border-b border-border">
            <div className="w-20 shrink-0 px-4 py-2">Date</div>
            <div className="w-28 shrink-0 px-4 py-2">Time</div>
            <div className="flex-1 px-4 py-2">Event</div>
            <div className="w-1/3 shrink-0 flex items-center">
              <div className="flex-[2] px-4 py-2 hidden lg:block text-center">Location</div>
              <div className="flex-1 px-4 py-2 hidden sm:block text-center">Status</div>
              <div className="flex-1 px-4 py-2 hidden md:block text-center">Role</div>
              <div className="flex-1 px-4 py-2 text-right">Actions</div>
            </div>
          </div>

          {active.isError && (
            <div className="px-4 py-3 text-sm text-destructive bg-destructive/10 border-b border-border">
              Failed to load events: {(active.error as Error)?.message ?? 'Unknown error'}
            </div>
          )}

          {active.isLoading ? (
            <div>
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 rounded-none border-b border-border last:border-b-0" />
              ))}
            </div>
          ) : !active.data || active.data.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center bg-primary">
              <CalendarDays className="h-7 w-7 text-primary-foreground mb-2" />
              <p className="text-sm text-primary-foreground">
                {tab === 'upcoming' ? 'No upcoming events.' : 'No completed events yet.'}
              </p>
              {tab === 'upcoming' && isManager && (
                <Button asChild size="sm" className="mt-3 bg-background text-primary hover:bg-background/80 hover:text-primary">
                  <Link to={`/dashboard/servers/${guildId}/events/new`}>Create your first event</Link>
                </Button>
              )}
            </div>
          ) : (
            <div className="max-h-[560px] overflow-y-auto [&::-webkit-scrollbar]:w-4 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-track]:[border-left:2px_solid_black] [&::-webkit-scrollbar-thumb]:bg-primary [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:min-h-[16px] [&::-webkit-scrollbar-thumb]:max-h-[16px] [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:[background-clip:padding-box] [&::-webkit-scrollbar-thumb]:[box-shadow:3px_0_8px_2px_rgba(0,0,0,0.9),0_2px_6px_2px_rgba(0,0,0,0.8)]">
              {active.data.map((e) => (
                <EventCard key={e.id} event={e} userId={user?.id} onClick={() => setSelected(e)} />
              ))}
            </div>
          )}
        </div>

        {/* Recent Loot column */}
        {isManager && <RecentLootCard guildId={guildId!} />}
      </div>

      {selected && (
        <EventModal
          event={selected}
          guildId={guildId!}
          onClose={() => setSelected(null)}
          onEnd={() => handleEnd(selected)}
          isEnding={endMutation.isPending && endMutation.variables === selected.id}
        />
      )}
    </div>
  );
}
