import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Upload, Check, LayoutTemplate, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { eventsApi } from '@/api/events';
import { imagesApi } from '@/api/images';
import type { CreateEventBody, EventDto, EventRole, RepeatTemplateDto } from '@dem/shared';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

const inputCls =
  'w-full rounded-md bg-primary text-primary-foreground placeholder:text-primary-foreground/50 px-3 py-2 text-lg border-2 border-primary-foreground/20 focus:outline-none focus:ring-2 focus:ring-primary-foreground/40';

const rowCls = 'flex items-start gap-4 bg-primary text-primary-foreground px-5 py-3 border-b border-background/40';
const labelCls = 'w-36 shrink-0 font-condensed text-base font-extrabold uppercase tracking-widest text-primary-foreground/90 pt-2';

function RoleRow({
  role, onChange, onRemove, onEnter, inputRef,
}: {
  role: EventRole;
  onChange: (r: EventRole) => void;
  onRemove: () => void;
  onEnter: () => void;
  inputRef?: React.RefCallback<HTMLInputElement>;
}) {
  return (
    <div className="flex gap-2 items-center">
      <input
        ref={inputRef}
        className={inputCls}
        placeholder="Role name (e.g. Tank)"
        value={role.name}
        onChange={(e) => onChange({ ...role, name: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }}
      />
      <input
        type="number" min={1} max={99}
        className="w-20 rounded-md bg-primary text-primary-foreground placeholder:text-primary-foreground/50 px-3 py-2 text-lg border-2 border-primary-foreground/20 focus:outline-none focus:ring-2 focus:ring-primary-foreground/40"
        placeholder="Count" value={role.count}
        onChange={(e) => onChange({ ...role, count: Math.max(1, parseInt(e.target.value) || 1) })}
      />
      <button type="button" onClick={onRemove}
        className="text-primary-foreground/60 hover:text-destructive transition-colors" title="Remove role">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function VcRow({
  name, onChange, onRemove, onEnter, inputRef,
}: {
  name: string;
  onChange: (v: string) => void;
  onRemove: () => void;
  onEnter: () => void;
  inputRef?: React.RefCallback<HTMLInputElement>;
}) {
  return (
    <div className="flex gap-2 items-center">
      <input
        ref={inputRef}
        className={inputCls}
        placeholder="VC name (e.g. Squad Alpha)"
        value={name}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }}
      />
      <button type="button" onClick={onRemove}
        className="text-primary-foreground/60 hover:text-destructive transition-colors" title="Remove VC">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function TemplatesPanel({
  guildId,
  onSelect,
  onClose,
}: {
  guildId: string;
  onSelect: (t: RepeatTemplateDto) => void;
  onClose: () => void;
}) {
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['repeat-templates', guildId],
    queryFn: () => eventsApi.listRepeatTemplates(guildId),
  });

  return (
    <div className="bg-primary border-b border-background/40">
      <div className="flex items-center justify-between px-5 py-2 border-b border-background/20">
        <span className="font-condensed text-sm font-extrabold uppercase tracking-widest text-primary-foreground/80">
          Top Templates (last 6 months)
        </span>
        <button type="button" onClick={onClose}
          className="text-primary-foreground/60 hover:text-primary-foreground text-xs uppercase tracking-wide">
          Close
        </button>
      </div>
      {isLoading ? (
        <p className="px-5 py-3 text-sm text-primary-foreground/60">Loading…</p>
      ) : templates.length === 0 ? (
        <p className="px-5 py-3 text-sm text-primary-foreground/60 italic">
          No repeated events yet. Use the Repeat button on completed events to build your list.
        </p>
      ) : (
        <ul>
          {templates.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => { onSelect(t); onClose(); }}
                className="w-full text-left px-5 py-2.5 hover:bg-accent hover:text-accent-foreground transition-colors flex items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-base">{t.name}</p>
                  {t.description && (
                    <p className="text-sm text-primary-foreground/60 truncate max-w-xs">{t.description}</p>
                  )}
                </div>
                <span className="shrink-0 text-sm font-bold text-primary-foreground/60">
                  ×{t.useCount}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EventCreateForm({
  guildId,
  onSuccess,
  onCancel,
  repeatSource,
  fromTemplateId: fromTemplateIdProp,
  isManager,
}: {
  guildId: string;
  onSuccess: () => void;
  onCancel: () => void;
  repeatSource?: EventDto;
  /** Stable template ID resolved before the form opened — carries through regardless of name changes. */
  fromTemplateId?: string;
  isManager?: boolean;
}) {
  const queryClient = useQueryClient();

  const [name, setName] = useState(repeatSource?.name ?? '');
  const [description, setDescription] = useState(repeatSource?.description ?? '');
  const [musterPoint, setMusterPoint] = useState(repeatSource?.musterPoint ?? '');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [roles, setRoles] = useState<EventRole[]>(repeatSource?.roles ?? []);
  const [vcNames, setVcNames] = useState<string[]>(repeatSource?.vcNames ?? []);
  const [duration, setDuration] = useState('120');
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(repeatSource?.imageUrl ?? null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  // fromTemplateIdProp is set when Repeat is clicked (stable, resolved before form opens).
  // Selecting from the Templates list overwrites it with the chosen template's ID.
  const [fromTemplateId, setFromTemplateId] = useState<string | undefined>(fromTemplateIdProp);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refs for keyboard-driven add-row focus
  const roleInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const vcInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const { data: imageLibrary = [] } = useQuery({
    queryKey: ['images', guildId],
    queryFn: () => imagesApi.list(guildId),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => imagesApi.upload(guildId, file),
    onSuccess: (img) => setSelectedImageUrl(img.url),
  });

  const { mutate, isPending } = useMutation({
    mutationFn: (body: CreateEventBody) => eventsApi.create(guildId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', guildId, 'upcoming'] });
      queryClient.invalidateQueries({ queryKey: ['repeat-templates', guildId] });
      onSuccess();
    },
    onError: (err: Error) => setFormError(err.message),
  });

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

  function applyTemplate(t: RepeatTemplateDto) {
    setName(t.name);
    setDescription(t.description ?? '');
    setMusterPoint(t.musterPoint ?? '');
    setRoles(t.roles);
    setVcNames(t.vcNames);
    setSelectedImageUrl(t.imageUrl ?? null);
    setFromTemplateId(t.id);
    setFormError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!startDate || !startTime) { setFormError('Start date and time are required.'); return; }
    const startIso = new Date(`${startDate}T${startTime}:00`);
    if (isNaN(startIso.getTime())) { setFormError('Invalid start date or time.'); return; }
    const durationMins = parseInt(duration) || 0;
    const endIso = durationMins > 0 ? new Date(startIso.getTime() + durationMins * 60_000) : undefined;
    mutate({
      name,
      description: description || undefined,
      musterPoint: musterPoint || undefined,
      startTime: startIso.toISOString(),
      endTime: endIso?.toISOString(),
      roles: roles.filter((r) => r.name.trim()),
      vcNames: vcNames.filter(Boolean),
      imageUrl: selectedImageUrl ?? undefined,
      repeatFromTemplateId: fromTemplateId,
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Templates toggle (manager only) */}
      {isManager && (
        <div className="flex items-center gap-2 bg-primary px-5 py-2 border-b border-background/40">
          <Button type="button" variant="outline" size="sm"
            className="gap-1.5 bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => setShowTemplates((v) => !v)}>
            <LayoutTemplate className="h-3.5 w-3.5" />
            Templates
            <ChevronDown className={`h-3 w-3 transition-transform ${showTemplates ? 'rotate-180' : ''}`} />
          </Button>
          {repeatSource && (
            <span className="text-xs text-primary-foreground/60">
              Repeating: <span className="font-semibold">{repeatSource.name}</span>
            </span>
          )}
        </div>
      )}

      {/* Templates panel */}
      {showTemplates && (
        <TemplatesPanel
          guildId={guildId}
          onSelect={applyTemplate}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {formError && (
        <div className="px-5 py-3 text-sm text-destructive bg-destructive/10 border-b border-background/40">
          {formError}
        </div>
      )}

      {/* Event Name */}
      <div className={rowCls}>
        <span className={labelCls}>Event Name *</span>
        <div className="flex-1">
          <input className={inputCls} value={name} required placeholder="Raid Night"
            onChange={(e) => { setName(e.target.value); setFormError(null); }} />
        </div>
      </div>

      {/* Description */}
      <div className={rowCls}>
        <span className={labelCls}>Description</span>
        <div className="flex-1">
          <textarea className={`${inputCls} resize-none`} rows={3} value={description}
            onChange={(e) => setDescription(e.target.value)} placeholder="Details about this event…" />
        </div>
      </div>

      {/* Muster Point */}
      <div className={rowCls}>
        <span className={labelCls}>Muster Point</span>
        <div className="flex-1">
          <input className={inputCls} value={musterPoint}
            onChange={(e) => setMusterPoint(e.target.value)} placeholder="Main Gate, Zone 7, etc." />
        </div>
      </div>

      {/* Start */}
      <div className={rowCls}>
        <span className={labelCls}>Start *</span>
        <div className="flex flex-1 gap-2">
          <input type="date" className={inputCls} value={startDate} required
            onChange={(e) => { setStartDate(e.target.value); setFormError(null); }} />
          <input type="time"
            className="w-36 shrink-0 rounded-md bg-primary text-primary-foreground placeholder:text-primary-foreground/50 px-3 py-2 text-lg border-2 border-primary-foreground/20 focus:outline-none focus:ring-2 focus:ring-primary-foreground/40"
            value={startTime} required
            onChange={(e) => { setStartTime(e.target.value); setFormError(null); }} />
        </div>
      </div>

      {/* Duration */}
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

      {/* Roles */}
      <div className={rowCls}>
        <span className={labelCls}>Roles</span>
        <div className="flex-1 space-y-2">
          {roles.map((role, i) => (
            <RoleRow key={i} role={role}
              inputRef={(el) => { roleInputRefs.current[i] = el; }}
              onChange={(r) => setRoles((prev) => prev.map((x, idx) => idx === i ? r : x))}
              onRemove={() => setRoles((prev) => prev.filter((_, idx) => idx !== i))}
              onEnter={addRoleAndFocus}
            />
          ))}
          <Button type="button" variant="outline" size="sm"
            className="gap-1 bg-primary text-primary-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={addRoleAndFocus}>
            <Plus className="h-3.5 w-3.5" />Add Role
          </Button>
        </div>
      </div>

      {/* Voice Channels */}
      <div className={rowCls}>
        <span className={labelCls}>
          Voice Channels
          <span className="block text-[10px] opacity-50 normal-case tracking-normal mt-0.5">30 min before start</span>
        </span>
        <div className="flex-1 space-y-2">
          {vcNames.map((vc, i) => (
            <VcRow key={i} name={vc}
              inputRef={(el) => { vcInputRefs.current[i] = el; }}
              onChange={(v) => setVcNames((prev) => prev.map((x, idx) => idx === i ? v : x))}
              onRemove={() => setVcNames((prev) => prev.filter((_, idx) => idx !== i))}
              onEnter={addVcAndFocus}
            />
          ))}
          <Button type="button" variant="outline" size="sm"
            className="gap-1 bg-primary text-primary-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={addVcAndFocus}>
            <Plus className="h-3.5 w-3.5" />Add VC
          </Button>
        </div>
      </div>

      {/* Image */}
      <div className={rowCls}>
        <span className={labelCls}>Event Image</span>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="sm"
              className="gap-1 bg-primary text-primary-foreground hover:bg-accent hover:text-accent-foreground"
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
              <p className="text-xs text-primary-foreground/60">Or select from your server library:</p>
              <div className="grid grid-cols-4 gap-2">
                {imageLibrary.map((img) => (
                  <button key={img.id} type="button" onClick={() => setSelectedImageUrl(img.url)}
                    className={`relative rounded-md overflow-hidden border-2 transition-colors ${
                      selectedImageUrl === img.url ? 'border-primary-foreground' : 'border-transparent hover:border-background/60'
                    }`}>
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

      {/* Actions */}
      <div className="flex justify-end gap-2 bg-primary px-5 py-4">
        <Button type="button" variant="outline"
          className="bg-primary text-primary-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="bg-primary text-primary-foreground hover:bg-accent hover:text-accent-foreground" disabled={isPending}>
          {isPending ? 'Creating…' : repeatSource ? 'Create Repeat Event' : 'Create Event'}
        </Button>
      </div>
    </form>
  );
}
