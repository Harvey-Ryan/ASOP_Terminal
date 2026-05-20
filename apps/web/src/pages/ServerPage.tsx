import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus, StopCircle, ExternalLink, Package } from 'lucide-react';
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
        <div className="mx-5 mt-4 rounded-md border-l-4 border-[#5865f2] bg-muted/40 p-3 space-y-3">
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

// ── Event card ────────────────────────────────────────────────────────────────

function EventCard({ event, onClick }: { event: EventDto; onClick: () => void }) {
  const start = new Date(event.startTime);
  const month = start.toLocaleDateString('en', { month: 'short' });
  const day = start.getDate();
  const time = start.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  const roles: EventRole[] = event.roles ?? [];

  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-start gap-4 rounded-xl border border-border bg-card p-4 hover:bg-accent/40 transition-colors"
    >
      {/* Date badge */}
      <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 text-primary">
        <span className="text-[10px] font-semibold uppercase leading-none">{month}</span>
        <span className="text-xl font-bold leading-tight">{day}</span>
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium truncate">{event.name}</p>
          {STATUS_BADGE[event.status] && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[event.status]}`}>
              {event.status}
            </span>
          )}
          {event.status === 'PENDING' && event.discordEventId == null && (
            <span className="text-xs text-yellow-500">Discord sync pending…</span>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          {time}
          {event.recurType && ` · ${RECUR_LABELS[event.recurType] ?? event.recurType}`}
          {event.musterPoint && ` · 📍 ${event.musterPoint}`}
        </p>

        {roles.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {roles.map((r) => (
              <span key={r.name} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                {r.name} ×{r.count}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Thumbnail */}
      {event.imageUrl && (
        <img
          src={`${API_BASE}${event.imageUrl}`}
          alt=""
          className="h-12 w-12 shrink-0 rounded-md object-cover"
        />
      )}

      {/* Roster count */}
      <span className="shrink-0 text-sm text-muted-foreground self-center" title="Roster size">
        👥 {event.rsvpCounts.total}
      </span>
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
  const { guilds } = useAuth();
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
        {/* Events card */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          {/* Card header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Events</h2>
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

          {/* Tabs */}
          <div className="flex gap-1 border-b border-border">
            {(['upcoming', 'completed'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                  tab === t
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {active.isError && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Failed to load events: {(active.error as Error)?.message ?? 'Unknown error'}
            </div>
          )}

          {active.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : !active.data || active.data.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CalendarDays className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">
                {tab === 'upcoming' ? 'No upcoming events.' : 'No completed events yet.'}
              </p>
              {tab === 'upcoming' && isManager && (
                <Button asChild variant="outline" className="mt-4">
                  <Link to={`/dashboard/servers/${guildId}/events/new`}>Create your first event</Link>
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {active.data.map((e) => (
                <EventCard key={e.id} event={e} onClick={() => setSelected(e)} />
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
