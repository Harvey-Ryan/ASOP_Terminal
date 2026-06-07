import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus, StopCircle, ExternalLink, Package, ChevronsRight, X, Pencil, Trash2, Upload, Check, RotateCcw, PlayCircle, Mic, Swords, Gavel } from 'lucide-react';
import { imagesApi } from '@/api/images';
import { EventCreateForm } from './events/EventCreateForm';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { eventsApi } from '@/api/events';
import { allianceApi } from '@/api/alliance';
import { applyShade, loadShade, saveShade } from '@/lib/shade';
import { lootApi } from '@/api/loot';
import { auctionsApi } from '@/api/auctions';
import { settingsApi } from '@/api/settings';
import { canManageGuild } from '@dem/shared';
import type { AllianceDto, EventDto, EventRole, CreateEventBody, MyPickDto } from '@dem/shared';
import { resolveUsername } from '@/lib/displayName';
import { useDkpLabel } from '@/hooks/useDkpLabel';
import type { RecentLootEvent } from '@/api/loot';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

function ensureRoleIds(roles: EventRole[]): EventRole[] {
  return roles.map((r) => r.id ? r : { ...r, id: crypto.randomUUID() });
}

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
  PENDING: 'bg-black text-yellow-400',
  ACTIVE: 'bg-black text-green-400',
  ENDED: 'bg-red-500/15 text-red-500',
  COMPLETED: 'bg-muted text-muted-foreground',
};

type Tab = 'upcoming' | 'completed' | 'pending';
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
  const [roles, setRoles] = useState<EventRole[]>(() => ensureRoleIds(event.roles ?? []));
  const [vcNames, setVcNames] = useState<string[]>(event.vcNames ?? []);
  const [briefingChannel, setBriefingChannel] = useState(event.briefingChannel ?? false);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(event.imageUrl ?? null);
  const [selectedAllianceId, setSelectedAllianceId] = useState<string>(event.allianceId ?? '');
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

  const { data: alliances = [] } = useQuery({
    queryKey: ['alliances', guildId],
    queryFn: () => allianceApi.list(guildId ?? undefined),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => imagesApi.upload(guildId, file),
    onSuccess: (img) => setSelectedImageUrl(img.url),
    onError: (err: Error) => setFormError(`Image upload failed: ${err.message}`),
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
      const next = [...prev, { id: crypto.randomUUID(), name: '', count: 1 }];
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
      endTime: endIso ? endIso.toISOString() : null,
      roles: roles.filter((r) => r.name.trim()),
      vcNames: vcNames.filter(Boolean),
      briefingChannel,
      imageUrl: selectedImageUrl ?? undefined,
      allianceId: selectedAllianceId || null,
    });
  }

  const rosterBuckets = [
    ...roles.filter((r) => r.name.trim()).map((role) => ({
      key: role.id ?? role.name,
      label: role.name,
      count: role.count as number | null,
      members: ev.rsvps.filter((r) => r.role === (role.id ?? role.name)),
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
          <select
            className="w-32 shrink-0 rounded-md bg-primary text-primary-foreground px-2 py-2 text-lg border-2 border-primary-foreground/20 focus:outline-none focus:ring-2 focus:ring-primary-foreground/40"
            value={duration} onChange={(e) => setDuration(e.target.value)}>
            <option value="30">30 min</option>
            <option value="60">1 hr</option>
            <option value="90">1.5 hr</option>
            <option value="120">2 hr</option>
            <option value="180">3 hr</option>
            <option value="240">4 hr</option>
            <option value="360">6 hr</option>
            <option value="0">No end</option>
          </select>
        </div>
      </div>

      <div className={rowCls}>
        <span className={labelCls}>Roles</span>
        <div className="flex-1 space-y-2">
          {(() => {
            const selectedAlliance = alliances.find((a) => a.id === selectedAllianceId);
            const guildOptions = selectedAlliance
              ? selectedAlliance.members
                  .filter((m) => m.status === 'ACCEPTED')
                  .map((m) => ({ guildId: m.guildId, label: m.guildId === guildId ? `${m.name} (You)` : m.name }))
              : undefined;
            return roles.map((role, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  ref={(el) => { roleInputRefs.current[i] = el; }}
                  className={inputCls} placeholder="Role name (e.g. Tank)" value={role.name}
                  onChange={(e) => setRoles((p) => p.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRoleAndFocus(); } }}
                />
                <input type="number" min={1} max={99}
                  className="w-20 shrink-0 rounded-md bg-primary text-primary-foreground px-3 py-2 text-lg border-2 border-primary-foreground/20 focus:outline-none focus:ring-2 focus:ring-primary-foreground/40"
                  value={role.count}
                  onChange={(e) => setRoles((p) => p.map((x, idx) => idx === i ? { ...x, count: Math.max(1, parseInt(e.target.value) || 1) } : x))} />
                {guildOptions && (
                  <select
                    className="w-36 shrink-0 rounded-md bg-primary text-primary-foreground px-2 py-2 text-sm border-2 border-primary-foreground/20 focus:outline-none focus:ring-2 focus:ring-primary-foreground/40"
                    value={role.guildId ?? ''}
                    onChange={(e) => setRoles((p) => p.map((x, idx) => idx === i ? { ...x, guildId: e.target.value || null } : x))}
                  >
                    <option value="">All Guilds</option>
                    {guildOptions.map((g) => (
                      <option key={g.guildId} value={g.guildId}>{g.label}</option>
                    ))}
                  </select>
                )}
                <button type="button" onClick={() => setRoles((p) => p.filter((_, idx) => idx !== i))}
                  className="text-primary-foreground/60 hover:text-destructive transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ));
          })()}
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
          <label className="flex items-center gap-3 cursor-pointer pt-1">
            <button
              type="button"
              role="switch"
              aria-checked={briefingChannel}
              onClick={() => setBriefingChannel((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary-foreground/40 ${
                briefingChannel ? 'bg-primary-foreground' : 'bg-primary-foreground/20'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-primary shadow-sm transition-transform ${
                  briefingChannel ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-sm text-primary-foreground/90">
              Briefing Channel
              <span className="block text-[11px] text-primary-foreground/50">PTT-only VC created alongside regular channels</span>
            </span>
          </label>
        </div>
      </div>

      <div className={rowCls}>
        <span className={labelCls}>Alliance Share</span>
        <div className="flex-1 space-y-2">
          <select className={inputCls} value={selectedAllianceId} onChange={(e) => setSelectedAllianceId(e.target.value)}>
            <option value="">None</option>
            {alliances.map((a) => {
              const acceptedCount = a.members.filter((m) => m.status === 'ACCEPTED').length;
              return <option key={a.id} value={a.id}>{a.name} ({acceptedCount} guild{acceptedCount !== 1 ? 's' : ''})</option>;
            })}
          </select>
          {selectedAllianceId && (() => {
            const alliance = alliances.find((a) => a.id === selectedAllianceId);
            const accepted = alliance?.members.filter((m) => m.status === 'ACCEPTED') ?? [];
            if (accepted.length === 0) return null;
            return (
              <div className="flex flex-wrap gap-1.5">
                {accepted.map((m) => (
                  <span key={m.id} className="inline-flex items-center gap-1 text-xs bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded px-2 py-0.5">
                    {m.name}
                  </span>
                ))}
              </div>
            );
          })()}
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
        <Button type="submit" size="sm" className={btnCls} disabled={updateMutation.isPending || uploadMutation.isPending}>
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
  const dkpLabel = useDkpLabel(guildId);
  const [sharePickerOpen, setSharePickerOpen] = useState(false);
  const [selectedGuildId, setSelectedGuildId] = useState('');

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

  const startMutation = useMutation({
    mutationFn: () => eventsApi.start(guildId, event.id),
    onSuccess: invalidateEvent,
  });

  const createVcsMutation = useMutation({
    mutationFn: () => eventsApi.createVcs(guildId, event.id),
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
    enabled: ev.status === 'COMPLETED' || ev.status === 'ENDED',
  });
  const lootSession = lootQuery.data ?? null;

  const myPicksQuery = useQuery({
    queryKey: ['loot', 'my-picks'],
    queryFn: () => lootApi.getMyPicks(),
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  const myDraftPick: MyPickDto | undefined = myPicksQuery.data?.find((p) => p.eventId === event.id);

  const { data: allGuilds = [] } = useQuery({
    queryKey: ['alliances', 'guilds'],
    queryFn: () => allianceApi.listGuilds(),
    staleTime: 5 * 60_000,
    enabled: isManager,
  });

  const { data: alliances = [] } = useQuery({
    queryKey: ['alliances', guildId],
    queryFn: () => allianceApi.list(guildId ?? undefined),
    staleTime: 5 * 60_000,
    enabled: isManager,
  });

  function invalidateShares() {
    queryClient.invalidateQueries({ queryKey: ['events', guildId, event.id] });
    queryClient.invalidateQueries({ queryKey: ['events', guildId, 'upcoming'] });
  }

  const inviteGuildMutation = useMutation({
    mutationFn: (targetDiscordGuildId: string) =>
      eventsApi.inviteGuildDirect(guildId, event.id, targetDiscordGuildId),
    onSuccess: () => { invalidateShares(); setSharePickerOpen(false); setSelectedGuildId(''); },
  });

  const inviteAllianceMutation = useMutation({
    mutationFn: (allianceId: string) => eventsApi.inviteAlliance(guildId, event.id, allianceId),
    onSuccess: invalidateShares,
  });

  const cancelShareMutation = useMutation({
    mutationFn: (shareId: string) => eventsApi.cancelShare(guildId, event.id, shareId),
    onSuccess: invalidateShares,
  });

  const reinviteMutation = useMutation({
    mutationFn: (shareId: string) => eventsApi.reinviteShare(guildId, event.id, shareId),
    onSuccess: invalidateShares,
  });

  const roles: EventRole[] = ev.roles ?? [];
  const start = new Date(ev.startTime);
  const end = ev.endTime ? new Date(ev.endTime) : null;
  const dateStr = start.toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const endTimeStr = end ? end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : null;
  const canEnd = ev.status !== 'ENDED' && ev.status !== 'COMPLETED';
  const canRsvp = ev.status === 'PENDING' || ev.status === 'ACTIVE';
  // Alliance events are read-only for non-host guilds; only the host guild can manage.
  const isHostGuild = ev.guildId === guildId;
  const canManage = isManager && isHostGuild;
  const userRsvp = userId ? ev.rsvps.find((r) => r.userId === userId) : undefined;
  const unassigned = ev.rsvps?.filter((r) => !r.role) ?? [];
  const isMutating = rsvpMutation.isPending || removeRsvpMutation.isPending;

  return (
    <div>
      {/* Draft pick notification */}
      {myDraftPick && (
        <div className={`flex items-center justify-between rounded-lg border px-3 py-2.5 mb-3 gap-3 ${
          myDraftPick.isMyTurn
            ? 'border-amber-500/40 bg-amber-500/10'
            : 'border-border bg-muted/40'
        }`}>
          <div className="flex items-center gap-2 min-w-0">
            <Swords className={`h-4 w-4 shrink-0 ${myDraftPick.isMyTurn ? 'text-amber-500' : 'text-muted-foreground'}`} />
            <span className={`text-sm font-medium truncate ${myDraftPick.isMyTurn ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
              {myDraftPick.isMyTurn ? "It's your turn to pick!" : myDraftPick.method === 'SNAKE_DRAFT' ? 'Snake draft in progress' : 'Loot session in progress'}
              {myDraftPick.itemCount > 0 && ` · ${myDraftPick.itemCount} item${myDraftPick.itemCount !== 1 ? 's' : ''} left`}
            </span>
          </div>
          <Button size="sm" variant={myDraftPick.isMyTurn ? 'default' : 'outline'} className={`shrink-0 h-7 text-xs ${myDraftPick.isMyTurn ? 'bg-amber-500 hover:bg-amber-600 text-white border-0' : ''}`} asChild>
            <Link to={`/dashboard/servers/${guildId}/events/${event.id}/loot`}>
              {myDraftPick.isMyTurn ? 'Pick Now' : 'View Loot'}
            </Link>
          </Button>
        </div>
      )}

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
          {!isHostGuild && (
            <span className="rounded-full px-2 py-0.5 text-sm font-bold uppercase tracking-wide bg-sky-500/20 text-sky-400">Alliance</span>
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
              const roleKey = role.id ?? role.name;
              const members = ev.rsvps?.filter((r) => r.role === roleKey) ?? [];
              const isFull = members.length >= role.count;
              const isMyRole = userRsvp?.role === roleKey;
              return (
                <div key={roleKey}>
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
                          onClick={() => rsvpMutation.mutate(roleKey)}>
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
              <p className="flex-1 text-lg font-medium">{lootSession.method === 'DKP' ? `${dkpLabel} Bid` : METHOD_LABELS[lootSession.method] ?? lootSession.method}</p>
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
                            {a.dkpSpent != null && a.dkpSpent > 0 && <span className="opacity-60 ml-1.5">{a.dkpSpent} {dkpLabel}</span>}
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

      {/* Shared With — host managers only, not on completed events */}
      {canManage && ev.status !== 'COMPLETED' && (
        <div className={rowCls}>
          <span className={labelCls}>Shared With</span>
          <div className="flex-1 space-y-2">
            {ev.shares.length === 0 && !sharePickerOpen && (
              <p className="text-lg opacity-50 italic">Not shared</p>
            )}

            {/* Existing shares list */}
            {ev.shares.map((s) => {
              const statusColor =
                s.status === 'ACCEPTED' ? 'text-green-400' :
                s.status === 'DECLINED' ? 'text-red-400' :
                'text-yellow-400';
              return (
                <div key={s.id} className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg font-medium">{s.guildName}</span>
                  <span className={`text-[11px] font-bold uppercase tracking-wide ${statusColor}`}>
                    {s.status}
                  </span>
                  <span className="text-[11px] opacity-50 uppercase tracking-wide">
                    {s.sourceType === 'ALLIANCE' ? 'via Alliance' : 'Direct'}
                  </span>
                  <div className="flex gap-1 ml-auto">
                    {s.status === 'DECLINED' && (
                      <button
                        onClick={() => reinviteMutation.mutate(s.id)}
                        disabled={reinviteMutation.isPending}
                        className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wide bg-primary-foreground/10 hover:bg-primary-foreground/20 transition-colors disabled:opacity-50"
                      >
                        Re-invite
                      </button>
                    )}
                    {s.status === 'PENDING' && (
                      <button
                        onClick={() => cancelShareMutation.mutate(s.id)}
                        disabled={cancelShareMutation.isPending}
                        className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wide bg-primary-foreground/10 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Inline guild picker */}
            {sharePickerOpen && (
              <div className="flex items-center gap-2 flex-wrap mt-1">
                <select
                  value={selectedGuildId}
                  onChange={(e) => setSelectedGuildId(e.target.value)}
                  className="flex-1 min-w-0 rounded-md bg-primary text-primary-foreground px-2 py-1.5 text-sm border-2 border-primary-foreground/20 focus:outline-none"
                >
                  <option value="">— Select guild —</option>
                  {allGuilds
                    .filter((g) => g.guildId !== guildId && !ev.shares.some((s) => s.guildDiscordId === g.guildId))
                    .map((g) => (
                      <option key={g.guildId} value={g.guildId}>{g.name}</option>
                    ))
                  }
                </select>
                <button
                  disabled={!selectedGuildId || inviteGuildMutation.isPending}
                  onClick={() => inviteGuildMutation.mutate(selectedGuildId)}
                  className="px-3 py-1.5 rounded text-[12px] font-bold uppercase tracking-wide bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50"
                >
                  {inviteGuildMutation.isPending ? 'Sending…' : 'Send Invite'}
                </button>
                <button
                  onClick={() => { setSharePickerOpen(false); setSelectedGuildId(''); }}
                  className="px-2 py-1.5 rounded text-[12px] font-bold uppercase tracking-wide bg-primary-foreground/10 hover:bg-primary-foreground/20 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Action buttons row */}
            <div className="flex gap-2 flex-wrap pt-1">
              {!sharePickerOpen && (
                <button
                  onClick={() => setSharePickerOpen(true)}
                  className="px-3 py-1 rounded text-[11px] font-bold uppercase tracking-wide bg-primary-foreground/10 hover:bg-primary-foreground/20 transition-colors"
                >
                  + Invite Guild
                </button>
              )}
              {alliances.length > 0 && alliances.map((a) => {
                const alreadyInvited = ev.shares.some((s) => s.allianceId === a.id);
                return (
                  <button
                    key={a.id}
                    disabled={alreadyInvited || inviteAllianceMutation.isPending}
                    onClick={() => inviteAllianceMutation.mutate(a.id)}
                    className="px-3 py-1 rounded text-[11px] font-bold uppercase tracking-wide bg-primary-foreground/10 hover:bg-primary-foreground/20 transition-colors disabled:opacity-40"
                    title={alreadyInvited ? 'Alliance already invited' : `Invite all of ${a.name}`}
                  >
                    {alreadyInvited ? `✓ ${a.name}` : `+ ${a.name}`}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center gap-2 bg-primary px-5 py-4">
        {ev.discordEventId == null && ev.status === 'PENDING' && (
          <p className="text-base text-primary-foreground/60 mr-auto">Discord sync pending…</p>
        )}
        <div className="flex gap-2 ml-auto">
          {canManage && ev.vcIds.length === 0 && (ev.vcNames.length > 0 || ev.briefingChannel) && (ev.status === 'PENDING' || ev.status === 'ACTIVE') && (
            <Button size="sm"
              className="gap-1 bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => createVcsMutation.mutate()}
              disabled={createVcsMutation.isPending || createVcsMutation.isSuccess}>
              <Mic className="h-3.5 w-3.5" />
              {createVcsMutation.isPending ? 'Creating…' : createVcsMutation.isSuccess ? 'Queued' : 'Create VCs'}
            </Button>
          )}
          {canManage && ev.status === 'ENDED' && lootSession?.status === 'OPEN' && (
            <Button size="sm" asChild
              className="gap-1 bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground">
              <Link to={`/dashboard/servers/${guildId}/events/${ev.id}/loot`}>
                <PlayCircle className="h-3.5 w-3.5" />Resume Loot
              </Link>
            </Button>
          )}
          {canManage && ev.status === 'COMPLETED' && lootSession?.status === 'OPEN' && (
            <Button size="sm" asChild
              className="gap-1 bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground">
              <Link to={`/dashboard/servers/${guildId}/events/${ev.id}/loot`}>
                <PlayCircle className="h-3.5 w-3.5" />Resume Loot
              </Link>
            </Button>
          )}
          {canManage && ev.status === 'COMPLETED' && lootSession?.status === 'COMPLETED' && (
            <Button size="sm" asChild
              className="gap-1 bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground">
              <Link to={`/dashboard/servers/${guildId}/events/${ev.id}/loot`}>
                <Package className="h-3.5 w-3.5" />Loot
              </Link>
            </Button>
          )}
          {canManage && ev.status === 'COMPLETED' && (
            <Button size="sm"
              className="gap-1 bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={onRepeat}>
              <RotateCcw className="h-3.5 w-3.5" />Repeat
            </Button>
          )}
          {canManage && ev.status !== 'COMPLETED' && (
            <Button size="sm"
              className="gap-1 bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />Edit
            </Button>
          )}
          {canManage && ev.status === 'PENDING' && (
            <Button size="sm"
              className="gap-1 bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}>
              <PlayCircle className="h-3.5 w-3.5" />
              {startMutation.isPending ? 'Starting…' : 'Start Event'}
            </Button>
          )}
          {canEnd && canManage && (
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

function EventCard({ event, userId, alliances, onClick }: { event: EventDto; guildId: string; userId?: string; alliances: import('@dem/shared').AllianceDto[]; onClick: () => void }) {
  const start = new Date(event.startTime);
  const month = start.toLocaleDateString('en', { month: 'short' });
  const day = start.getDate();
  const time = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const location = event.musterPoint ?? '—';
  const userRsvp = userId ? event.rsvps.find((r) => r.userId === userId) : undefined;
  const userRoleName = userRsvp?.role
    ? (event.roles.find((r) => (r.id ?? r.name) === userRsvp.role)?.name ?? userRsvp.role)
    : null;
  const allianceForEvent = event.allianceId ? alliances.find((a) => a.id === event.allianceId) : null;
  const orgTags = allianceForEvent
    ? allianceForEvent.members.filter((m) => m.status === 'ACCEPTED' && m.allianceTag).map((m) => m.allianceTag as string)
    : [];

  return (
    <button
      onClick={onClick}
      className="group w-full text-left flex items-center bg-primary text-primary-foreground hover:bg-background hover:text-primary transition-colors border-b border-black"
    >
      {/* Date */}
      <div className="w-20 shrink-0 flex items-center justify-center px-3 py-3">
        <div className="w-12 border-2 border-current rounded-sm overflow-hidden">
          <div className="bg-current/25 border-b-2 border-current text-center px-1 py-0.5">
            <span className="text-[10px] font-black uppercase tracking-widest leading-none">{month}</span>
          </div>
          <div className="flex items-center justify-center py-2">
            <span className="text-[28px] font-black leading-none">{day}</span>
          </div>
        </div>
      </div>

      {/* Time */}
      <div className="hidden sm:block w-28 shrink-0 px-4 py-3">
        <span className="text-[21px] font-medium">{time}</span>
      </div>

      {/* Event */}
      <div className="flex-1 px-4 py-3 min-w-0">
        <p className="font-semibold line-clamp-2 text-[21px] leading-tight">{event.name}</p>
        {orgTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {orgTags.map((tag) => (
              <span key={tag} className="font-mono text-sm font-bold text-sky-400 shrink-0">[{tag}]</span>
            ))}
          </div>
        )}
        {/* Time + status visible only on mobile */}
        <div className="sm:hidden flex items-center gap-3 mt-0.5 opacity-80">
          <span className="text-[15px] font-medium">{time}</span>
          {userRsvp && <span className="text-[13px] opacity-70">Rostered</span>}
        </div>
        {event.recurType && (
          <p className="text-[15px] opacity-60 line-clamp-2">{RECUR_LABELS[event.recurType] ?? event.recurType}</p>
        )}
      </div>

      {/* Location */}
      <div className="hidden lg:block w-52 shrink-0 px-4 py-3">
        <span className="text-[21px] leading-snug">{location}</span>
      </div>

      {/* Status */}
      <div className="hidden sm:flex w-28 shrink-0 px-4 py-3 items-center justify-center">
        <span className="text-[21px] font-medium">{userRsvp ? 'Rostered' : '—'}</span>
      </div>

      {/* Role */}
      <div className="hidden md:block 2xl:hidden w-28 shrink-0 px-4 py-3">
        <span className="text-[21px] line-clamp-2">{userRoleName ?? '—'}</span>
      </div>

      {/* Actions */}
      <div className="w-24 shrink-0 px-4 py-3 flex justify-end">
        <span className="rounded p-1.5 bg-primary text-primary-foreground group-hover:bg-background group-hover:text-primary transition-colors">
          <ChevronsRight className="h-12 w-12 stroke-[3]" />
        </span>
      </div>
    </button>
  );
}

// ── Pending share card (receiving guild view) ─────────────────────────────────

function PendingShareCard({
  event,
  guildId,
  alliances,
  allGuilds,
  onRespond,
}: {
  event: EventDto;
  guildId: string;
  alliances: AllianceDto[];
  allGuilds: { id: string; guildId: string; name: string }[];
  onRespond: () => void;
}) {
  const queryClient = useQueryClient();
  const start = new Date(event.startTime);
  const month = start.toLocaleDateString('en', { month: 'short' });
  const day = start.getDate();
  const time = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const hostGuild = allGuilds.find((g) => g.guildId === event.guildId);
  const myShare = event.shares.find((s) => s.status === 'PENDING');
  const sourceLabel = myShare?.sourceType === 'ALLIANCE'
    ? `via ${alliances.find((a) => a.id === myShare.allianceId)?.name ?? 'Alliance'}`
    : 'Direct Invite';

  const acceptMutation = useMutation({
    mutationFn: () => eventsApi.respondToShare(guildId, event.id, 'accept'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', guildId, 'pending-shares'] });
      queryClient.invalidateQueries({ queryKey: ['events', guildId, 'upcoming'] });
      onRespond();
    },
  });

  const declineMutation = useMutation({
    mutationFn: () => eventsApi.respondToShare(guildId, event.id, 'decline'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', guildId, 'pending-shares'] });
      onRespond();
    },
  });

  const isMutating = acceptMutation.isPending || declineMutation.isPending;

  return (
    <div className="flex items-center bg-primary text-primary-foreground border-b border-black">
      {/* Date */}
      <div className="w-20 shrink-0 flex items-center justify-center px-3 py-3">
        <div className="w-12 border-2 border-current rounded-sm overflow-hidden">
          <div className="bg-current/25 border-b-2 border-current text-center px-1 py-0.5">
            <span className="text-[10px] font-black uppercase tracking-widest leading-none">{month}</span>
          </div>
          <div className="flex items-center justify-center py-2">
            <span className="text-[28px] font-black leading-none">{day}</span>
          </div>
        </div>
      </div>

      {/* Time */}
      <div className="hidden sm:block w-28 shrink-0 px-4 py-3">
        <span className="text-[21px] font-medium">{time}</span>
      </div>

      {/* Event info */}
      <div className="flex-1 px-4 py-3 min-w-0">
        <p className="font-semibold text-[18px] leading-tight line-clamp-1">{event.name}</p>
        <p className="text-[13px] opacity-70 mt-0.5 truncate">
          {hostGuild ? hostGuild.name : event.guildId} · {sourceLabel}
        </p>
      </div>

      {/* Accept / Decline */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3">
        <button
          disabled={isMutating}
          onClick={() => acceptMutation.mutate()}
          className="px-3 py-1.5 rounded text-[12px] font-bold uppercase tracking-wide bg-green-600 hover:bg-green-500 text-white transition-colors disabled:opacity-50"
        >
          Accept
        </button>
        <button
          disabled={isMutating}
          onClick={() => declineMutation.mutate()}
          className="px-3 py-1.5 rounded text-[12px] font-bold uppercase tracking-wide bg-background/30 hover:bg-background/50 text-primary-foreground transition-colors disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    </div>
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
  const dkpLabel = useDkpLabel(guildId);
  const { data, isLoading } = useQuery({
    queryKey: ['loot', 'recent', guildId],
    queryFn: () => lootApi.getRecent(guildId),
  });

  const event = data as RecentLootEvent | null | undefined;

  return (
    <div className="h-full flex flex-col rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Recent Loot</h2>
        </div>
        {event && (
          <span className="text-xs text-muted-foreground">
            {event.eventName} · {timeAgo(event.sessionUpdatedAt)}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
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
                    <span className="ml-1.5 text-amber-500">{item.winner.dkpSpent} {dkpLabel}</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
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

  const guildSettingsQuery = useQuery({
    queryKey: ['guild-settings', guildId],
    queryFn: () => settingsApi.getSettings(guildId!),
    enabled: !!guildId,
    staleTime: 5 * 60_000,
  });

  const openAuctionQuery = useQuery({
    queryKey: ['auctions', guildId, 'open'],
    queryFn: () => auctionsApi.list(guildId!),
    enabled: !!guildId && (guildSettingsQuery.data?.dkpEnabled ?? false),
    refetchInterval: 10_000,
    select: (data) => data.find((a) => a.status === 'OPEN'),
  });

  const completedQuery = useQuery({
    queryKey: ['events', guildId, 'completed'],
    queryFn: () => eventsApi.listCompleted(guildId!),
    enabled: !!guildId && tab === 'completed',
    retry: 1,
  });

  const pendingSharesQuery = useQuery({
    queryKey: ['events', guildId, 'pending-shares'],
    queryFn: () => eventsApi.listPendingShares(guildId!),
    enabled: !!guildId && isManager,
    retry: 1,
    refetchInterval: 30_000,
  });
  const pendingShareCount = pendingSharesQuery.data?.length ?? 0;

  const active = tab === 'upcoming' ? upcomingQuery : tab === 'completed' ? completedQuery : pendingSharesQuery;

  const { data: alliances = [] } = useQuery({
    queryKey: ['alliances', guildId],
    queryFn: () => allianceApi.list(guildId ?? undefined),
    staleTime: 5 * 60_000,
    enabled: !!guildId,
  });

  const { data: allGuilds = [] } = useQuery({
    queryKey: ['alliances', 'guilds'],
    queryFn: () => allianceApi.listGuilds(),
    staleTime: 5 * 60_000,
    enabled: !!guildId && isManager,
  });

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
      const tmpl = await eventsApi.getOrCreateEventTemplate(guildId!, event.id);
      setRepeatTemplateId(tmpl.id);
    } catch {
      setRepeatTemplateId(null);
    }
    setRepeatSource(event);
    setView('create');
  }

  const openAuction = openAuctionQuery.data;

  return (
    <div className="h-full -m-6 overflow-hidden flex flex-col gap-6 p-6">
      {/* Active auction notification */}
      {openAuction && (
        <div className="shrink-0 flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Gavel className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="text-sm font-medium truncate text-amber-600 dark:text-amber-400">
              Live auction: <span className="font-semibold">{openAuction.title}</span>
              {openAuction.bids.length > 0 && ` · ${openAuction.bids.length} bid${openAuction.bids.length !== 1 ? 's' : ''}`}
              {openAuction.secondsRemaining > 0 && ` · ${Math.ceil(openAuction.secondsRemaining / 60)}m left`}
            </span>
          </div>
          <Button size="sm" className="shrink-0 h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white border-0" asChild>
            <Link to={`/dashboard/servers/${guildId}/auctions`}>Bid Now</Link>
          </Button>
        </div>
      )}

      {/* Responsive two-column layout: events left, loot right */}
      <div className={`flex-1 min-h-0 grid grid-cols-1 gap-6 w-full${canView ? ' 2xl:grid-cols-[1fr_380px]' : ''}`}>
        {/* Events panel – Fleet Manager style */}
        <div className="min-h-0 flex flex-col overflow-hidden rounded-xl border border-border">
          {/* Hazard stripe */}
          <div style={{ background: 'repeating-linear-gradient(-45deg, #181818 0px, #181818 8px, hsl(var(--primary)) 8px, hsl(var(--primary)) 12px)' }} className="h-2 shrink-0" />

          {/* Header bar */}
          <div className="shrink-0 flex items-center justify-between bg-card px-4 py-3 border-b border-border">
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
                  {isManager && (
                    <button
                      onClick={() => setTab('pending')}
                      className={`relative px-3 py-1 rounded text-[11px] font-bold uppercase tracking-wide transition-colors ${
                        tab === 'pending'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Pending
                      {pendingShareCount > 0 && (
                        <span className="absolute -top-1 -right-1 h-4 min-w-4 rounded-full bg-sky-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5">
                          {pendingShareCount}
                        </span>
                      )}
                    </button>
                  )}
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
            <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-4 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-track]:[border-left:2px_solid_black] [&::-webkit-scrollbar-thumb]:bg-primary [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:min-h-[16px] [&::-webkit-scrollbar-thumb]:max-h-[16px] [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:[background-clip:padding-box] [&::-webkit-scrollbar-thumb]:[box-shadow:3px_0_8px_2px_rgba(0,0,0,0.9),0_2px_6px_2px_rgba(0,0,0,0.8)]">
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
            <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-4 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-track]:[border-left:2px_solid_black] [&::-webkit-scrollbar-thumb]:bg-primary [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:min-h-[16px] [&::-webkit-scrollbar-thumb]:max-h-[16px] [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:[background-clip:padding-box] [&::-webkit-scrollbar-thumb]:[box-shadow:3px_0_8px_2px_rgba(0,0,0,0.9),0_2px_6px_2px_rgba(0,0,0,0.8)]">
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
            <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-4 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-track]:[border-left:2px_solid_black] [&::-webkit-scrollbar-thumb]:bg-primary [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:min-h-[16px] [&::-webkit-scrollbar-thumb]:max-h-[16px] [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:[background-clip:padding-box] [&::-webkit-scrollbar-thumb]:[box-shadow:3px_0_8px_2px_rgba(0,0,0,0.9),0_2px_6px_2px_rgba(0,0,0,0.8)]">
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
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="shrink-0 flex items-center bg-secondary text-primary text-[15px] font-condensed font-bold uppercase tracking-widest border-b border-border">
                <div className="w-20 shrink-0 px-4 py-2">Date</div>
                <div className="hidden sm:block w-28 shrink-0 px-4 py-2">Time</div>
                <div className="flex-1 px-4 py-2">Event</div>
                <div className="hidden lg:block w-52 shrink-0 px-4 py-2">Location</div>
                <div className="hidden sm:block w-28 shrink-0 px-4 py-2">Status</div>
                <div className="hidden md:block 2xl:hidden w-28 shrink-0 px-4 py-2">Role</div>
                <div className="hidden sm:block w-24 shrink-0 px-4 py-2 text-center">Actions</div>
              </div>

              {active.isError && (
                <div className="px-4 py-3 text-sm text-destructive bg-destructive/10 border-b border-border">
                  Failed to load events: {(active.error as Error)?.message ?? 'Unknown error'}
                </div>
              )}

              {active.isLoading ? (
                <div className="flex-1 bg-primary">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 rounded-none border-b border-border last:border-b-0" />
                  ))}
                </div>
              ) : !active.data || active.data.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center bg-primary">
                  <CalendarDays className="h-7 w-7 text-primary-foreground mb-2" />
                  <p className="text-sm text-primary-foreground">
                    {tab === 'upcoming' ? 'No upcoming events.' : tab === 'completed' ? 'No completed events yet.' : 'No pending event invites.'}
                  </p>
                  {tab === 'upcoming' && isManager && (
                    <Button size="sm" className="mt-3 bg-background text-primary hover:bg-background/80 hover:text-primary"
                      onClick={() => setView('create')}>
                      Create your first event
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto bg-primary [&::-webkit-scrollbar]:w-4 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-track]:[border-left:2px_solid_black] [&::-webkit-scrollbar-thumb]:bg-primary [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:min-h-[16px] [&::-webkit-scrollbar-thumb]:max-h-[16px] [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:[background-clip:padding-box] [&::-webkit-scrollbar-thumb]:[box-shadow:3px_0_8px_2px_rgba(0,0,0,0.9),0_2px_6px_2px_rgba(0,0,0,0.8)]">
                  {tab === 'pending'
                    ? active.data.map((e) => (
                        <PendingShareCard
                          key={e.id}
                          event={e}
                          guildId={guildId!}
                          alliances={alliances}
                          allGuilds={allGuilds}
                          onRespond={() => {}}
                        />
                      ))
                    : active.data.map((e) => (
                        <EventCard key={e.id} event={e} guildId={guildId!} userId={user?.id} alliances={alliances} onClick={() => openDetail(e)} />
                      ))
                  }
                </div>
              )}
            </div>
          )}
        </div>

        {/* Recent Loot column — only shown at lg+ where the two-column layout is active */}
        {canView && <div className="hidden 2xl:flex flex-col min-h-0"><RecentLootCard guildId={guildId!} /></div>}
      </div>
    </div>
  );
}
