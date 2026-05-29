import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Gift, PackageX, Plus, X, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { eventsApi } from '@/api/events';
import { lootApi } from '@/api/loot';
import { useAuth } from '@/hooks/useAuth';
import { resolveUsername } from '@/lib/displayName';
import type { EventDto, RsvpDto } from '@dem/shared';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

// ── Inline toggle ─────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
        checked ? 'bg-primary' : 'bg-input'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// ── Roster row ────────────────────────────────────────────────────────────────

function AttendeeRow({
  rsvp,
  currentUserId,
  checked,
  wasInVc,
  onChange,
}: {
  rsvp: RsvpDto;
  currentUserId?: string;
  checked: boolean;
  wasInVc: boolean;
  onChange: (v: boolean) => void;
}) {
  const name = resolveUsername(rsvp.userId, rsvp.username, currentUserId);
  return (
    <div
      className={`flex items-center justify-between rounded-lg border px-4 py-3 transition-colors ${
        checked ? 'border-border bg-card' : 'border-border/50 bg-muted/30 opacity-60'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex flex-col min-w-0">
          <span className={`text-sm font-medium truncate ${checked ? '' : 'line-through text-muted-foreground'}`}>
            {name}
          </span>
          {rsvp.role && (
            <span className="text-xs text-muted-foreground truncate">{rsvp.role}</span>
          )}
        </div>
        {wasInVc && (
          <span className="shrink-0 rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600">
            VC Active
          </span>
        )}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function EventAuditPage() {
  const { guildId, eventId } = useParams<{ guildId: string; eventId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [attendance, setAttendance] = useState<Record<string, boolean>>({});
  const [attendanceInitialized, setAttendanceInitialized] = useState(false);
  const [hadLoot, setHadLoot] = useState<boolean | null>(null);
  const [lootItems, setLootItems] = useState<string[]>([]);
  const [newLootItem, setNewLootItem] = useState('');

  const { data: existingSession } = useQuery({
    queryKey: ['loot', guildId, eventId],
    queryFn: () => lootApi.getSession(guildId!, eventId!),
    enabled: !!guildId && !!eventId,
  });

  const { data: event, isLoading, isError } = useQuery({
    queryKey: ['event', guildId, eventId],
    queryFn: () => eventsApi.get(guildId!, eventId!),
    enabled: !!guildId && !!eventId,
    refetchInterval: (query) => {
      const data = query.state.data as EventDto | undefined;
      return data?.status === 'ENDED' && data?.botCleanedUp === false ? 5000 : false;
    },
  });

  // Initialize attendance toggles once bot cleanup is done
  useEffect(() => {
    if (!event || attendanceInitialized) return;
    if (!event.botCleanedUp) return;

    const vcSet = new Set(event.vcAttendees);
    const initial: Record<string, boolean> = {};
    for (const rsvp of event.rsvps) {
      initial[rsvp.userId] = vcSet.has(rsvp.userId);
    }
    setAttendance(initial);
    setAttendanceInitialized(true);
  }, [event, attendanceInitialized]);

  const effectiveHadLoot = existingSession != null ? true : hadLoot;

  const completeMutation = useMutation({
    mutationFn: async () => {
      await eventsApi.complete(guildId!, eventId!, {
        hadLoot: effectiveHadLoot!,
        confirmedAttendees: Object.entries(attendance)
          .filter(([, v]) => v)
          .map(([k]) => k),
      });
      // Skip session creation if one already exists from before the event ended
      if (!existingSession && hadLoot && lootItems.length > 0) {
        await lootApi.createSession(guildId!, eventId!, { method: 'RANDOM_ROLL' });
        for (const name of lootItems) {
          await lootApi.addItem(guildId!, eventId!, { name });
        }
      }
    },
    onSuccess: () =>
      effectiveHadLoot
        ? navigate(`/dashboard/servers/${guildId}/events/${eventId}/loot`)
        : navigate(`/dashboard/servers/${guildId}?tab=completed`),
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (isError || !event) {
    return (
      <div className="max-w-2xl">
        <p className="text-destructive text-sm">Failed to load event.</p>
      </div>
    );
  }

  const start = new Date(event.startTime);
  const dateStr = start.toLocaleDateString('en', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const timeStr = start.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });

  const confirmedCount = Object.values(attendance).filter(Boolean).length;
  const canComplete = existingSession != null || hadLoot !== null;

  return (
    <div className="max-w-2xl space-y-5">
      <button
        onClick={() => navigate(`/dashboard/servers/${guildId}`)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to server
      </button>

      {/* Event summary */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex gap-4 items-start">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-lg">🏁 {event.name}</CardTitle>
              {event.description && (
                <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{event.description}</p>
              )}
              <p className="mt-2 text-sm text-muted-foreground">
                {dateStr} · {timeStr}
                {event.musterPoint && <> · 📍 {event.musterPoint}</>}
              </p>
            </div>
            {event.imageUrl && (
              <img
                src={`${API_BASE}${event.imageUrl}`}
                alt="Event"
                className="h-16 w-16 rounded-md object-cover shrink-0"
              />
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Attendance roster */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Attendance Audit
            </CardTitle>
            {event.botCleanedUp && (
              <span className="text-sm text-muted-foreground">
                {confirmedCount} / {event.rsvps.length} confirmed
              </span>
            )}
          </div>
          {event.botCleanedUp && event.vcAttendees.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Members marked <span className="text-green-600 font-medium">VC Active</span> were present in a voice channel at event end. Toggles default to their status — adjust as needed.
            </p>
          )}
        </CardHeader>
        <CardContent>
          {!event.botCleanedUp ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Bot is cleaning up VCs… this should take a few seconds.
            </div>
          ) : event.rsvps.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground italic">No roster members for this event.</p>
          ) : (
            <div className="space-y-2">
              {event.rsvps.map((rsvp: RsvpDto) => (
                <AttendeeRow
                  key={rsvp.userId}
                  rsvp={rsvp}
                  currentUserId={user?.id}
                  checked={attendance[rsvp.userId] ?? false}
                  wasInVc={event.vcAttendees.includes(rsvp.userId)}
                  onChange={(v) => setAttendance((prev) => ({ ...prev, [rsvp.userId]: v }))}
                />
              ))}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() =>
                    setAttendance(Object.fromEntries(event.rsvps.map((r: RsvpDto) => [r.userId, true])))
                  }
                >
                  Select all
                </button>
                <span className="text-xs text-muted-foreground">·</span>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() =>
                    setAttendance(Object.fromEntries(event.rsvps.map((r: RsvpDto) => [r.userId, false])))
                  }
                >
                  Deselect all
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loot prompt */}
      {event.botCleanedUp && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Gift className="h-4 w-4" />
                Loot
              </CardTitle>
              {!existingSession && hadLoot !== null && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => { setHadLoot(null); setLootItems([]); setNewLootItem(''); }}
                >
                  Change
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {existingSession ? (
              <p className="text-sm text-muted-foreground">
                A loot session is already in progress — you can continue it after completing the audit.
              </p>
            ) : hadLoot === null ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => setHadLoot(true)}
                >
                  <Gift className="h-3.5 w-3.5" />
                  Yes, there was loot
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => setHadLoot(false)}
                >
                  <PackageX className="h-3.5 w-3.5" />
                  No loot
                </Button>
              </div>
            ) : hadLoot ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Add items to the loot list before moving to the distribution page.</p>
                {lootItems.length > 0 && (
                  <ul className="space-y-1">
                    {lootItems.map((item, i) => (
                      <li key={i} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-sm">
                        <span>{item}</span>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          onClick={() => setLootItems((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const trimmed = newLootItem.trim();
                    if (trimmed) {
                      setLootItems((prev) => [...prev, trimmed]);
                      setNewLootItem('');
                    }
                  }}
                >
                  <input
                    type="text"
                    className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Item name…"
                    value={newLootItem}
                    onChange={(e) => setNewLootItem(e.target.value)}
                  />
                  <Button type="submit" size="sm" variant="outline" className="gap-1">
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </Button>
                </form>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No loot for this event.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Complete */}
      {event.botCleanedUp && (
        <div className="flex items-center justify-between">
          {completeMutation.isError && (
            <p className="text-sm text-destructive">Failed to complete event. Please try again.</p>
          )}
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              onClick={() => navigate(`/dashboard/servers/${guildId}`)}
            >
              Save for later
            </Button>
            <Button
              disabled={!canComplete || completeMutation.isPending}
              onClick={() => completeMutation.mutate()}
            >
              {completeMutation.isPending ? 'Completing…' : 'Complete Event'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
