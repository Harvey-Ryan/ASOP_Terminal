import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus, StopCircle, ExternalLink, Package, ChevronsRight, X, Pencil, Trash2, Upload, Check, RotateCcw } from 'lucide-react';
import { imagesApi } from '@/api/images';
import { EventCreateForm } from './events/EventCreateForm';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { eventsApi } from '@/api/events';
import { applyShade, loadShade, saveShade } from '@/lib/shade';
import { lootApi } from '@/api/loot';
import { settingsApi } from '@/api/settings';
import { canManageGuild } from '@dem/shared';
import type { EventDto, EventRole, CreateEventBody } from '@dem/shared';
import { resolveUsername } from '@/lib/displayName';
import type { RecentLootEvent } from '@/api/loot';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

const RECUR_LABELS: Record<string, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Every 2 weeks',
  MONTHLY: 'Monthly',
};

const METHOD_LABELS: Record<string, string> = {
  RANDOM_ROLL: 'Random Roll',
  DKP: 'DKP Bid',
  SNAKE_DRAFT: 'Snake Draft',
};

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-yellow-500/15 text-yellow-600',
  ACTIVE: 'bg-black text-green-400',
  ENDED: 'bg-red-500/15 text-red-500',
  COMPLETED: 'bg-muted text-muted-foreground',
};

type Tab = 'upcoming' | 'completed';
type View = 'table' | 'create' | 'detail' | 'edit';

const rowCls = 'flex items-start gap-4 bg-primary text-primary-foreground px-5 py-3 border-b border-background/40';
const labelCls = 'w-36 shrink-0 font-condensed text-base font-extrabold uppercase tracking-widest text-primary-foreground/90 pt-1';
const inputCls = 'w-full rounded-md bg-primary text-primary-foreground placeholder:text-primary-foreground/50 px-3 py-2 text-lg border-2 border-primary-foreground/20 focus:outline-none focus:ring-2 focus:ring-primary-foreground/40';
const timeInputCls = 'w-36 shrink-0 rounded-md bg-primary text-primary-foreground placeholder:text-primary-foreground/50 px-3 py-2 text-lg border-2 border-primary-foreground/20 focus:outline-none focus:ring-2 focus:ring-primary-foreground/40';
const btnCls = 'gap-1 bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground';

// ── Event edit inline view ────────────────────────────────────────────────────

function EventEditView({ event, guildId, onDone, onCancel }: {
  event: EventDto;
  guildId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const roleInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const vcInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const initStart = new Date(event.startTime);
  const pad = (n: number) => String(n).padStart(2, '0');

  const [name, setName] = useState(event.name);
  const [description, setDescription] = useState(event.description ?? '');
  const [musterPoint, setMusterPoint] = useState(event.musterPoint ?? '');
  const [startDate, setStartDate] = useState(
    `${initStart.getFullYear()}-${pad(initStart.getMonth() + 1)}-${pad(initStart.getDate())}`,
  );
  const [startTime, setStartTime] = useState(`${pad(initStart.getHours())}:${pad(initStart.getMinutes())}`);
  const [duration, setDuration] = useState(() => {
    if (!event.endTime) return '0';
    const mins = Math.round((new Date(event.endTime).getTime() - initStart.getTime()) / 60_000);
    return [30, 60, 90, 120, 180, 240, 360].includes(mins) ? String(mins) : '0';
  });
  const [roles, setRoles] = useState<EventRole[]>(event.roles ?? []);
  const [vcNames, setVcNames] = useState<string[]>(event.vcNames ?? []);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(event.imageUrl ?? null);
  const [formError, setFormError] = useState<string | null>(null);
  const [draggingUserId, setDraggingUserId] = useState<string | null>(null);
  const [dragOverBucket, setDragOverBucket] = useState<string | null>(null);

  const eventQuery = useQuery({
    queryKey: ['events', guildId, event.id],
    queryFn: () => eventsApi.get(guildId, event.id),
    initialData: event,
  });
  const ev = eventQuery.data ?? event;

  const { data: imageLibrary = [] } = useQuery({
    queryKey: ['images', guildId],
    queryFn: () => imagesApi.list(guildId),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => imagesApi.upload(guildId, file),
    onSuccess: (img) => setSelectedImageUrl(img.url),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['events', guildId, event.id] });
    queryClient.invalidateQueries({ queryKey: ['events', guildId, 'upcoming'] });
  }

  const updateMutation = useMutation({
    mutationFn: (body: Partial<CreateEventBody>) => eventsApi.update(guildId, event.id, body),
    onSuccess: () => { invalidate(); onDone(); },
    onError: (err: Error) => setFormError(err.message),
  });

  const reassignMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string | null }) =>
      eventsApi.reassignRsvp(guildId, event.id, userId, role),
    onSuccess: invalidate,
  });

  function handleDrop(targetRole: string | null) {
    if (draggingUserId) {
      const currentRole = ev.rsvps.find((r) => r.userId === draggingUserId)?.role ?? null;
      if (currentRole !== targetRole) reassignMutation.mutate({ userId: draggingUserId, role: targetRole });
    }
    setDraggingUserId(null);
    setDragOverBucket(null);
  }

  function addRoleAndFocus() {
    setRoles((prev) => {
      const next = [...prev, { name: '', count: 1 }];
      setTimeout(() => roleInputRefs.current[next.length - 1]?.focus(), 0);
      return next;
    });
  }

  function addVcAndFocus() {
    setVcNames((prev) => {
      const next = [...prev, ''];
      setTimeout(() => vcInputRefs.current[next.length - 1]?.focus(), 0);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!startDate || !startTime) { setFormError('Start date and time are required.'); return; }
    const startIso = new Date(`${startDate}T${startTime}:00`);
    if (isNaN(startIso.getTime())) { setFormError('Invalid start date or time.'); return; }
    const durationMins = parseInt(duration) || 0;
    const endIso = durationMins > 0 ? new Date(startIso.getTime() + durationMins * 60_000) : undefined;
    updateMutation.mutate({
      name,
      description: description || undefined,
      musterPoint: musterPoint || undefined,
      startTime: startIso.toISOString(),
      endTime: endIso?.toISOString(),
      roles: roles.filter((r) => r.name.trim()),
      vcNames: vcNames.filter(Boolean),
      imageUrl: selectedImageUrl ?? undefined,
    });
  }

  const rosterBuckets = [
    ...roles.filter((r) => r.name.trim()).map((role) => ({
      key: role.name,
      label: role.name,
      count: role.count as number | null,
      members: ev.rsvps.filter((r) => r.role === role.name),
    })),
    { key: '__unassigned', label: 'Unassigned', count: null, members: ev.rsvps.filter((r) => !r.role) },
  ];

  return (
    <form onSubmit={handleSubmit}>
      {formError && (
        <div className="px-5 py-3 text-sm text-destructive bg-destructive/10 border-b border-background/40">
          {formError}
        </div>
      )}

      <div className={rowCls}>
        <span className={labelCls}>Event Name *</span>
        <div className="flex-1">
          <input className={inputCls} value={name} required onChange={(e) => setName(e.target.value)} />
        </div>
      </div>

      <div className={rowCls}>
        <span className={labelCls}>Description</span>
        <div className="flex-1">
          <textarea className={`${inputCls} resize-none`} rows={3} value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <div className={rowCls}>
        <span className={labelCls}>Location</span>
        <div className="flex-1">
          <input className={inputCls} value={musterPoint} placeholder="Main Gate, Zone 7, etc."
            onChange={(e) => setMusterPoint(e.target.value)} />
        </div>
      </div>

      <div className={rowCls}>
        <span className={labelCls}>Start *</span>
        <div className="flex flex-1 gap-2">
          <input type="date" className={inputCls} value={startDate} required
            onChange={(e) => setStartDate(e.target.value)} />
          <input type="time" className={timeInputCls} value={startTime} required
            onChange={(e) => setStartTime(e.target.value)} />
        </div>
      </div>

      <div className={rowCls}>
        <span className={labelCls}>Duration</span>
        <div className="flex-1">
          <select className={inputCls} value={duration} onChange={(e) => setDuration(e.target.value)}>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="90">1.5 hours</option>
            <option value="120">2 hours</option>
            <option value="180">3 hours</option>
            <option value="240">4 hours</option>
            <option value="360">6 hours</option>
            <option value="0">No end time</option>
          </select>
        </div>
      </div>

      <div className={rowCls}>
        <span className={labelCls}>Roles</span>
        <div className="flex-1 space-y-2">
          {roles.map((role, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                ref={(el) => { roleInputRefs.current[i] = el; }}
                className={inputCls} placeholder="Role name (e.g. Tank)" value={role.name}
                onChange={(e) => setRoles((p) => p.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRoleAndFocus(); } }}
              />
              <input type="number" min={1} max={99}
                className="w-20 rounded-md bg-primary text-primary-foreground px-3 py-2 text-lg border-2 border-primary-foreground/20 focus:outline-none focus:ring-2 focus:ring-primary-foreground/40"
                value={role.count}
                onChange={(e) => setRoles((p) => p.map((x, idx) => idx === i ? { ...x, count: Math.max(1, parseInt(e.target.value) || 1) } : x))} />
              <button type="button" onClick={() => setRoles((p) => p.filter((_, idx) => idx !== i))}
                className="text-primary-foreground/60 hover:text-destructive transition-colors">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className={btnCls}
            onClick={addRoleAndFocus}>
            <Plus className="h-3.5 w-3.5" />Add Role
          </Button>
        </div>
      </div>

      <div className={rowCls}>
        <span className={labelCls}>
          Voice Channels
          <span className="block text-[10px] opacity-50 normal-case tracking-normal mt-0.5">30 min before start</span>
        </span>
        <div className="flex-1 space-y-2">
          {vcNames.map((vc, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                ref={(el) => { vcInputRefs.current[i] = el; }}
                className={inputCls} placeholder="VC name (e.g. Squad Alpha)" value={vc}
                onChange={(e) => setVcNames((p) => p.map((x, idx) => idx === i ? e.target.value : x))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addVcAndFocus(); } }}
              />
              <button type="button" onClick={() => setVcNames((p) => p.filter((_, idx) => idx !== i))}
                className="text-primary-foreground/60 hover:text-destructive transition-colors">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className={btnCls}
            onClick={addVcAndFocus}>
            <Plus className="h-3.5 w-3.5" />Add VC
          </Button>
        </div>
      </div>

      <div className={rowCls}>
        <span className={labelCls}>Event Image</span>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="sm" className={btnCls}
              onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
              <Upload className="h-3.5 w-3.5" />
              {uploadMutation.isPending ? 'Uploading…' : 'Upload Image'}
            </Button>
            {selectedImageUrl && (
              <span className="text-xs text-primary-foreground/70 flex items-center gap-1">
                <Check className="h-3.5 w-3.5" /> Image selected
              </span>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMutation.mutate(f); }} />
          </div>
          {selectedImageUrl && (
            <img src={`${API_BASE}${selectedImageUrl}`} alt="Selected"
              className="h-32 w-auto rounded-md border border-background/40 object-cover" />
          )}
          {imageLibrary.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-primary-foreground/60">Or select from library:</p>
              <div className="grid grid-cols-4 gap-2">
                {imageLibrary.map((img) => (
                  <button key={img.id} type="button" onClick={() => setSelectedImageUrl(img.url)}
                    className={`relative rounded-md overflow-hidden border-2 transition-colors ${selectedImageUrl === img.url ? 'border-primary-foreground' : 'border-transparent hover:border-background/60'}`}>
                    <img src={`${API_BASE}${img.url}`} alt={img.filename} className="h-20 w-full object-cover" />
                    {selectedImageUrl === img.url && (
                      <div className="absolute inset-0 bg-background/30 flex items-center justify-center">
                        <Check className="h-5 w-5 text-primary-foreground" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Roster drag-and-drop */}
      {ev.rsvps.length > 0 && (
        <div className={rowCls}>
          <span className={labelCls}>Roster</span>
          <div className="flex-1 space-y-2">
            {rosterBuckets.map((bucket) => (
              <div key={bucket.key}
                onDragOver={(e) => { e.preventDefault(); setDragOverBucket(bucket.key); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverBucket(null); }}
                onDrop={(e) => { e.preventDefault(); handleDrop(bucket.key === '__unassigned' ? null : bucket.key); }}
                className={`rounded border p-2 min-h-[40px] transition-colors ${dragOverBucket === bucket.key ? 'border-primary-foreground bg-primary-foreground/10' : 'border-primary-foreground/30'}`}>
                <p className="text-sm font-bold uppercase tracking-widest opacity-60 mb-1.5">
                  {bucket.label}{bucket.count !== null ? ` (${bucket.members.length}/${bucket.count})` : ` (${bucket.members.length})`}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {bucket.members.map((member) => (
                    <div key={member.userId} draggable
                      onDragStart={(e) => {
                        setDraggingUserId(member.userId);
                        e.dataTransfer.setData('text/plain', member.userId);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => { setDraggingUserId(null); setDragOverBucket(null); }}
                      className={`px-3 py-1 text-base rounded bg-primary-foreground text-primary cursor-grab active:cursor-grabbing select-none transition-opacity ${draggingUserId === member.userId ? 'opacity-40' : ''}`}>
                      {resolveUsername(member.userId, member.username, currentUser?.id)}
                    </div>
                  ))}
                  {bucket.members.length === 0 && (
                    <span className="text-xs opacity-40 italic">Drop here</span>
                  )}
                </div>
              </div>
            ))}
            <p className="text-[10px] opacity-40 italic">Drag members between buckets to reassign roles.</p>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 bg-primary px-5 py-4">
        <Button type="button" size="sm" className={btnCls} onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" className={btnCls} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>
    </form>
  );
}

// ── Event detail inline view ──────────────────────────────────────────────────

function EventDetailView({ event, guildId, isManager, userId, onEdit, onRepeat }: {
  event: EventDto;
  guildId: string;
  isManager: boolean;
  userId?: string;
  onEdit: () => void;
  onRepeat: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const eventQuery = useQuery({
    queryKey: ['events', guildId, event.id],
    queryFn: () => eventsApi.get(guildId, event.id),
    initialData: event,
  });
  const ev = eventQuery.data ?? event;

  function invalidateEvent() {
    queryClient.invalidateQueries({ queryKey: ['events', guildId, event.id] });
    queryClient.invalidateQueries({ queryKey: ['events', guildId, 'upcoming'] });
  }

  const rsvpMutation = useMutation({
    mutationFn: (role: string | null) => eventsApi.rsvp(guildId, event.id, role),
    onSuccess: invalidateEvent,
  });

  const removeRsvpMutation = useMutation({
    mutationFn: () => eventsApi.removeRsvp(guildId, event.id),
    onSuccess: invalidateEvent,
  });

  const endMutation = useMutation({
    mutationFn: () => eventsApi.end(guildId, event.id),
    onSuccess: () => {
      invalidateEvent();
      navigate(`/dashboard/servers/${guildId}/events/${event.id}/audit`);
    },
  });

  const lootQuery = useQuery({
    queryKey: ['loot', guildId, event.id],
    queryFn: () => lootApi.getSession(guildId, event.id),
    enabled: ev.status === 'COMPLETED',
  });
  const lootSession = lootQuery.data ?? null;

  const roles: EventRole[] = ev.roles ?? [];
  const start = new Date(ev.startTime);
  const end = ev.endTime ? new Date(ev.endTime) : null;
  const dateStr = start.toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const endTimeStr = end ? end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : null;
  const canEnd = ev.status !== 'ENDED' && ev.status !== 'COMPLETED';
  const canRsvp = ev.status === 'PENDING' || ev.status === 'ACTIVE';
  const userRsvp = userId ? ev.rsvps.find((r) => r.userId === userId) : undefined;
  const unassigned = ev.rsvps?.filter((r) => !r.role) ?? [];
  const isMutating = rsvpMutation.isPending || removeRsvpMutation.isPending;

  return (
    <div>
      {/* Name + status */}
      <div className={rowCls}>
        <span className={labelCls}>Event</span>
        <div className="flex-1 flex items-center gap-2 flex-wrap pt-0.5">
          <span className="font-semibold text-xl">{ev.name}</span>
          {STATUS_BADGE[ev.status] && (
            <span className={`rounded-full px-2 py-0.5 text-base font-medium ${STATUS_BADGE[ev.status]}`}>
              {ev.status}
            </span>
          )}
          {ev.recurType && (
            <span className="text-base opacity-60">{RECUR_LABELS[ev.recurType] ?? ev.recurType}</span>
          )}
        </div>
      </div>

      {/* When */}
      <div className={rowCls}>
        <span className={labelCls}>When</span>
        <div className="flex-1 text-lg">
          <p>{dateStr}</p>
          <p className="opacity-70 mt-0.5">{timeStr}{endTimeStr ? ` → ${endTimeStr}` : ''}</p>
        </div>
      </div>

      {/* Description */}
      {ev.description && (
        <div className={rowCls}>
          <span className={labelCls}>Description</span>
          <p className="flex-1 text-lg whitespace-pre-wrap">{ev.description}</p>
        </div>
      )}

      {/* Location */}
      {ev.musterPoint && (
        <div className={rowCls}>
          <span className={labelCls}>Location</span>
          <p className="flex-1 text-lg font-medium">{ev.musterPoint}</p>
        </div>
      )}

      {/* Image */}
      {ev.imageUrl && (
        <div className={rowCls}>
          <span className={labelCls}>Image</span>
          <img src={`${API_BASE}${ev.imageUrl}`} alt="Event" className="h-28 w-auto rounded-md object-cover" />
        </div>
      )}

      {/* Roles */}
      {roles.length > 0 && (
        <div className={rowCls}>
          <span className={labelCls}>Roles</span>
          <div className="flex-1 space-y-4">
            {roles.map((role) => {
              const members = ev.rsvps?.filter((r) => r.role === role.name) ?? [];
              const isFull = members.length >= role.count;
              const isMyRole = userRsvp?.role === role.name;
              return (
                <div key={role.name}>
                  <p className="text-base font-extrabold uppercase tracking-widest opacity-90">
                    {role.name} ({members.length}/{role.count})
                  </p>
                  <div className="mt-0.5 space-y-0.5">
                    {members.length > 0
                      ? members.map((r) => (
                          <p key={r.userId} className="text-lg">{resolveUsername(r.userId, r.username, userId)}</p>
                        ))
                      : <span className="opacity-50 italic text-lg">None</span>}
                  </div>
                  {canRsvp && userId && (
                    <div className="mt-1.5">
                      {isMyRole ? (
                        <Button size="sm" disabled={isMutating}
                          className="h-8 px-3 text-base bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground"
                          onClick={() => removeRsvpMutation.mutate()}>
                          Unassign
                        </Button>
                      ) : (
                        <Button size="sm" disabled={isMutating || (isFull && !isMyRole)}
                          className="h-8 px-3 text-base bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
                          onClick={() => rsvpMutation.mutate(role.name)}>
                          {isFull ? 'Full' : userRsvp ? 'Switch Here' : 'Sign Up'}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Unassigned */}
      <div className={rowCls}>
        <span className={labelCls}>Unassigned</span>
        <div className="flex-1">
          <div className="space-y-0.5">
            {unassigned.length > 0
              ? unassigned.map((r) => (
                  <p key={r.userId} className="text-lg">{resolveUsername(r.userId, r.username, userId)}</p>
                ))
              : <span className="opacity-50 italic text-lg">None</span>}
          </div>
          {canRsvp && userId && (
            <div className="mt-1.5">
              {userRsvp && !userRsvp.role ? (
                <Button size="sm" disabled={isMutating}
                  className="h-8 px-3 text-base bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground"
                  onClick={() => removeRsvpMutation.mutate()}>
                  Leave
                </Button>
              ) : !userRsvp ? (
                <Button size="sm" disabled={isMutating}
                  className="h-8 px-3 text-base bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground"
                  onClick={() => rsvpMutation.mutate(null)}>
                  Join (No Role)
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Attending */}
      <div className={rowCls}>
        <span className={labelCls}>Attending</span>
        <p className="flex-1 text-lg font-medium">{ev.rsvpCounts.total}</p>
      </div>

      {/* Loot (completed) */}
      {ev.status === 'COMPLETED' && (
        <>
          {ev.hadLoot !== null && (
            <div className={rowCls}>
              <span className={labelCls}>Loot</span>
              <p className="flex-1 text-lg font-medium">
                {ev.hadLoot ? 'Yes' : 'No loot'}
                {ev.lootNotes && <span className="opacity-70"> — {ev.lootNotes}</span>}
              </p>
            </div>
          )}

          {lootSession && (
            <div className={rowCls}>
              <span className={labelCls}>Loot System</span>
              <p className="flex-1 text-lg font-medium">{METHOD_LABELS[lootSession.method] ?? lootSession.method}</p>
            </div>
          )}

          {lootSession && lootSession.items.length > 0 && (
            <div className={rowCls}>
              <span className={labelCls}>Items</span>
              <div className="flex-1 space-y-3">
                {[...lootSession.items].sort((a, b) => a.sortOrder - b.sortOrder).map((item) => (
                  <div key={item.id}>
                    <p className="text-base font-extrabold uppercase tracking-widest opacity-90">
                      {item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ''}
                    </p>
                    {item.assignments.length > 0 ? (
                      <div className="mt-0.5 space-y-0.5">
                        {item.assignments.map((a) => (
                          <p key={a.id} className="text-lg">
                            {resolveUsername(a.userId, a.username, userId)}
                            {a.rollValue != null && <span className="opacity-60 ml-1.5">🎲 {a.rollValue}</span>}
                            {a.dkpSpent != null && a.dkpSpent > 0 && <span className="opacity-60 ml-1.5">{a.dkpSpent} DKP</span>}
                            {a.pickNumber != null && <span className="opacity-60 ml-1.5">Pick #{a.pickNumber}</span>}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-lg opacity-50 italic mt-0.5">Unassigned</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Audit link (ended) */}
      {ev.status === 'ENDED' && (
        <div className={rowCls}>
          <span className={labelCls}>Audit</span>
          <div className="flex-1">
            <p className="text-lg opacity-70 mb-2">Review attendance and record loot.</p>
            <Button asChild size="sm"
              className="gap-1 bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground">
              <Link to={`/dashboard/servers/${guildId}/events/${ev.id}/audit`}>
                <ExternalLink className="h-3.5 w-3.5" />Go to Audit
              </Link>
            </Button>
          </div>
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center gap-2 bg-primary px-5 py-4">
        {ev.discordEventId == null && ev.status === 'PENDING' && (
          <p className="text-base text-primary-foreground/60 mr-auto">Discord sync pending…</p>
        )}
        <div className="flex gap-2 ml-auto">
          {isManager && ev.status === 'COMPLETED' && (
            <Button size="sm"
              className="gap-1 bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={onRepeat}>
              <RotateCcw className="h-3.5 w-3.5" />Repeat
            </Button>
          )}
          {isManager && ev.status !== 'COMPLETED' && (
            <Button size="sm"
              className="gap-1 bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />Edit
            </Button>
          )}
          {canEnd && isManager && (
            <Button size="sm"
              className="gap-1 bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                if (confirm(`End "${ev.name}"? The bot will clean up VCs and archive the forum thread.`)) {
                  endMutation.mutate();
                }
              }}
              disabled={endMutation.isPending}>
              <StopCircle className="h-3.5 w-3.5" />
              {endMutation.isPending ? 'Ending…' : 'End Event'}
            </Button>
          )}
        </div>
      </div>
    </div>
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
        <p className="font-semibold line-clamp-2 text-[21px] leading-tight">{event.name}</p>
        {event.recurType && (
          <p className="text-[15px] opacity-60 line-clamp-2">{RECUR_LABELS[event.recurType] ?? event.recurType}</p>
        )}
      </div>

      {/* Location + Status + Role + Actions — 5/12 of total width (25% wider than 1/3) */}
      <div className="w-5/12 shrink-0 flex items-center">
        <div className="flex-[2] px-4 py-3 hidden lg:block">
          <span className="text-[21px] line-clamp-2">{location}</span>
        </div>
        <div className="flex-1 px-4 py-3 hidden sm:flex items-center justify-center">
          <span className="text-[21px] font-medium">{userRsvp ? 'Rostered' : '—'}</span>
        </div>
        <div className="flex-1 px-4 py-3 hidden md:block">
          <span className="text-[21px] line-clamp-2">{userRsvp?.role ?? '—'}</span>
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
  const { user } = useAuth();
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
                {resolveUsername(item.winner.userId, item.winner.username, user?.id)}
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
  const isDiscordManager = !!guild && canManageGuild(guild);

  const myPermsQuery = useQuery({
    queryKey: ['my-permissions', guildId],
    queryFn: () => settingsApi.getMyPermissions(guildId!),
    enabled: !!guildId && !isDiscordManager,
    staleTime: 5 * 60_000,
  });
  const isManager = isDiscordManager || (myPermsQuery.data?.canManageEvents ?? false);
  const canView = isManager || (myPermsQuery.data?.canViewEvents ?? false);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [view, setView] = useState<View>('table');
  const [detailEvent, setDetailEvent] = useState<EventDto | null>(null);
  const [repeatSource, setRepeatSource] = useState<EventDto | null>(null);
  const [repeatTemplateId, setRepeatTemplateId] = useState<string | null>(null);

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

  function openDetail(event: EventDto) {
    setDetailEvent(event);
    setView('detail');
  }

  function closePanel() {
    setView('table');
    setDetailEvent(null);
    setRepeatSource(null);
    setRepeatTemplateId(null);
  }

  async function openRepeat(event: EventDto) {
    try {
      const tmpl = await eventsApi.getOrCreateRepeatTemplate(guildId!, event.id);
      setRepeatTemplateId(tmpl.id);
    } catch {
      setRepeatTemplateId(null);
    }
    setRepeatSource(event);
    setView('create');
  }

  return (
    <div className="space-y-6">
      {/* Responsive two-column layout: events left, loot right */}
      <div className={`grid grid-cols-1 gap-6 items-start${canView ? ' lg:grid-cols-[1fr_360px]' : ''}`}>
        {/* Events panel – Fleet Manager style */}
        <div className="overflow-hidden rounded-xl border border-border">
          {/* Hazard stripe */}
          <div style={{ background: 'repeating-linear-gradient(-45deg, #181818 0px, #181818 8px, hsl(var(--primary)) 8px, hsl(var(--primary)) 12px)' }} className="h-2" />

          {/* Header bar */}
          <div className="flex items-center justify-between bg-card px-4 py-3 border-b border-border">
            <div className="flex items-center gap-3">
              <span className="font-condensed text-2xl font-bold uppercase tracking-widest text-white px-6">Event Manager</span>
              {view === 'table' && (
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
              )}
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
              {isManager && view === 'table' && (
                <Button size="sm" onClick={() => setView('create')}>
                  <Plus className="h-3.5 w-3.5" />
                  Create Event
                </Button>
              )}
              {view !== 'table' && (
                <Button size="icon" variant="ghost"
                  className="h-8 w-8 bg-primary text-primary-foreground hover:bg-accent hover:text-accent-foreground"
                  onClick={
                    view === 'edit' ? () => setView('detail')
                    : (view === 'create' && repeatSource) ? () => { setRepeatSource(null); setView('detail'); }
                    : closePanel
                  }>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Create form */}
          {view === 'create' && (
            <div className="max-h-[600px] overflow-y-auto [&::-webkit-scrollbar]:w-4 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-track]:[border-left:2px_solid_black] [&::-webkit-scrollbar-thumb]:bg-primary [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:min-h-[16px] [&::-webkit-scrollbar-thumb]:max-h-[16px] [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:[background-clip:padding-box] [&::-webkit-scrollbar-thumb]:[box-shadow:3px_0_8px_2px_rgba(0,0,0,0.9),0_2px_6px_2px_rgba(0,0,0,0.8)]">
              <EventCreateForm
                guildId={guildId!}
                onSuccess={() => {
                  queryClient.invalidateQueries({ queryKey: ['events', guildId, 'upcoming'] });
                  setRepeatSource(null);
                  setRepeatTemplateId(null);
                  setView('table');
                }}
                onCancel={closePanel}
                repeatSource={repeatSource ?? undefined}
                fromTemplateId={repeatTemplateId ?? undefined}
                isManager={isManager}
              />
            </div>
          )}

          {/* Detail view */}
          {view === 'detail' && detailEvent && (
            <div className="max-h-[600px] overflow-y-auto [&::-webkit-scrollbar]:w-4 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-track]:[border-left:2px_solid_black] [&::-webkit-scrollbar-thumb]:bg-primary [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:min-h-[16px] [&::-webkit-scrollbar-thumb]:max-h-[16px] [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:[background-clip:padding-box] [&::-webkit-scrollbar-thumb]:[box-shadow:3px_0_8px_2px_rgba(0,0,0,0.9),0_2px_6px_2px_rgba(0,0,0,0.8)]">
              <EventDetailView
                event={detailEvent}
                guildId={guildId!}
                isManager={isManager}
                userId={user?.id}
                onEdit={() => setView('edit')}
                onRepeat={() => openRepeat(detailEvent)}
              />
            </div>
          )}

          {/* Edit view */}
          {view === 'edit' && detailEvent && (
            <div className="max-h-[600px] overflow-y-auto [&::-webkit-scrollbar]:w-4 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-track]:[border-left:2px_solid_black] [&::-webkit-scrollbar-thumb]:bg-primary [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:min-h-[16px] [&::-webkit-scrollbar-thumb]:max-h-[16px] [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:[background-clip:padding-box] [&::-webkit-scrollbar-thumb]:[box-shadow:3px_0_8px_2px_rgba(0,0,0,0.9),0_2px_6px_2px_rgba(0,0,0,0.8)]">
              <EventEditView
                event={detailEvent}
                guildId={guildId!}
                onDone={() => setView('detail')}
                onCancel={() => setView('detail')}
              />
            </div>
          )}

          {/* Table view */}
          {view === 'table' && (
            <>
              <div className="flex items-center bg-secondary text-primary text-[15px] font-condensed font-bold uppercase tracking-widest border-b border-border">
                <div className="w-20 shrink-0 px-4 py-2">Date</div>
                <div className="w-28 shrink-0 px-4 py-2">Time</div>
                <div className="flex-1 px-4 py-2">Event</div>
                <div className="w-5/12 shrink-0 flex items-center">
                  <div className="flex-[2] px-4 py-2 hidden lg:block">Location</div>
                  <div className="flex-1 px-4 py-2 hidden sm:block">Status</div>
                  <div className="flex-1 px-4 py-2 hidden md:block">Role</div>
                  <div className="flex-1 px-4 py-2">Actions</div>
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
                    <Button size="sm" className="mt-3 bg-background text-primary hover:bg-background/80 hover:text-primary"
                      onClick={() => setView('create')}>
                      Create your first event
                    </Button>
                  )}
                </div>
              ) : (
                <div className="max-h-[560px] overflow-y-auto [&::-webkit-scrollbar]:w-4 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-track]:[border-left:2px_solid_black] [&::-webkit-scrollbar-thumb]:bg-primary [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:min-h-[16px] [&::-webkit-scrollbar-thumb]:max-h-[16px] [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:[background-clip:padding-box] [&::-webkit-scrollbar-thumb]:[box-shadow:3px_0_8px_2px_rgba(0,0,0,0.9),0_2px_6px_2px_rgba(0,0,0,0.8)]">
                  {active.data.map((e) => (
                    <EventCard key={e.id} event={e} userId={user?.id} onClick={() => openDetail(e)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Recent Loot column */}
        {canView && <RecentLootCard guildId={guildId!} />}
      </div>
    </div>
  );
}
