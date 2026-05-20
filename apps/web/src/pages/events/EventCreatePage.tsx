import { useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Upload, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { eventsApi } from '@/api/events';
import { imagesApi } from '@/api/images';
import type { CreateEventBody, EventRole } from '@dem/shared';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

// ── Role builder row ──────────────────────────────────────────────────────────

function RoleRow({
  role,
  onChange,
  onRemove,
}: {
  role: EventRole;
  onChange: (r: EventRole) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex gap-2 items-center">
      <input
        className={inputCls}
        placeholder="Role name (e.g. Tank)"
        value={role.name}
        onChange={(e) => onChange({ ...role, name: e.target.value })}
      />
      <input
        type="number"
        min={1}
        max={99}
        className="w-20 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        placeholder="Count"
        value={role.count}
        onChange={(e) => onChange({ ...role, count: Math.max(1, parseInt(e.target.value) || 1) })}
      />
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive transition-colors"
        title="Remove role"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── VC name row ───────────────────────────────────────────────────────────────

function VcRow({ name, onChange, onRemove }: { name: string; onChange: (v: string) => void; onRemove: () => void }) {
  return (
    <div className="flex gap-2 items-center">
      <input
        className={inputCls}
        placeholder="VC name (e.g. Squad Alpha)"
        value={name}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive transition-colors"
        title="Remove VC"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function EventCreatePage() {
  const { guildId } = useParams<{ guildId: string }>();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [musterPoint, setMusterPoint] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [roles, setRoles] = useState<EventRole[]>([]);
  const [vcNames, setVcNames] = useState<string[]>([]);
  const [duration, setDuration] = useState('120');
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Library of previously uploaded images for this server
  const { data: imageLibrary = [] } = useQuery({
    queryKey: ['images', guildId],
    queryFn: () => imagesApi.list(guildId!),
    enabled: !!guildId,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => imagesApi.upload(guildId!, file),
    onSuccess: (img) => setSelectedImageUrl(img.url),
  });

  const [formError, setFormError] = useState<string | null>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: (body: CreateEventBody) => eventsApi.create(guildId!, body),
    onSuccess: () => navigate(`/dashboard/servers/${guildId}`),
    onError: (err: Error) => setFormError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!startDate || !startTime) {
      setFormError('Start date and time are required.');
      return;
    }

    const startIso = new Date(`${startDate}T${startTime}:00`);
    if (isNaN(startIso.getTime())) {
      setFormError('Invalid start date or time.');
      return;
    }

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
    });
  }

  function addRole() {
    setRoles((prev) => [...prev, { name: '', count: 1 }]);
  }

  function updateRole(i: number, r: EventRole) {
    setRoles((prev) => prev.map((x, idx) => (idx === i ? r : x)));
  }

  function removeRole(i: number) {
    setRoles((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addVc() {
    setVcNames((prev) => [...prev, '']);
  }

  function updateVc(i: number, v: string) {
    setVcNames((prev) => prev.map((x, idx) => (idx === i ? v : x)));
  }

  function removeVc(i: number) {
    setVcNames((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
  }

  return (
    <div className="max-w-2xl">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <Card>
        <CardHeader>
          <CardTitle>Create Event</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {formError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {formError}
              </div>
            )}
            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Event Name *</label>
              <input
                className={inputCls}
                value={name}
                onChange={(e) => { setName(e.target.value); setFormError(null); }}
                required
                placeholder="Raid Night"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <textarea
                className={`${inputCls} resize-none`}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Details about this event…"
              />
            </div>

            {/* Muster Point */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Muster Point</label>
              <input
                className={inputCls}
                value={musterPoint}
                onChange={(e) => setMusterPoint(e.target.value)}
                placeholder="Main Gate, Zone 7, etc."
              />
            </div>

            {/* Start */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Start *</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  className={inputCls}
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); setFormError(null); }}
                  required
                />
                <input
                  type="time"
                  className="w-36 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={startTime}
                  onChange={(e) => { setStartTime(e.target.value); setFormError(null); }}
                  required
                />
              </div>
            </div>

            {/* Duration */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Duration</label>
              <select
                className={inputCls}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              >
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

            {/* Roles */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Roles</label>
              <div className="space-y-2">
                {roles.map((role, i) => (
                  <RoleRow
                    key={i}
                    role={role}
                    onChange={(r) => updateRole(i, r)}
                    onRemove={() => removeRole(i)}
                  />
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addRole} className="gap-1">
                <Plus className="h-3.5 w-3.5" />
                Add Role
              </Button>
            </div>

            {/* Voice Channels */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Voice Channels</label>
              <p className="text-xs text-muted-foreground">Created 30 min before the event starts.</p>
              <div className="space-y-2">
                {vcNames.map((vc, i) => (
                  <VcRow
                    key={i}
                    name={vc}
                    onChange={(v) => updateVc(i, v)}
                    onRemove={() => removeVc(i)}
                  />
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addVc} className="gap-1">
                <Plus className="h-3.5 w-3.5" />
                Add VC
              </Button>
            </div>

            {/* Image */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Event Image</label>

              {/* Upload button */}
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadMutation.isPending}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {uploadMutation.isPending ? 'Uploading…' : 'Upload Image'}
                </Button>
                {selectedImageUrl && (
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <Check className="h-3.5 w-3.5" /> Image selected
                  </span>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {/* Selected preview */}
              {selectedImageUrl && (
                <img
                  src={`${API_BASE}${selectedImageUrl}`}
                  alt="Selected"
                  className="h-32 w-auto rounded-md border border-border object-cover"
                />
              )}

              {/* Server image library */}
              {imageLibrary.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Or select from your server library:</p>
                  <div className="grid grid-cols-4 gap-2">
                    {imageLibrary.map((img) => (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() => setSelectedImageUrl(img.url)}
                        className={`relative rounded-md overflow-hidden border-2 transition-colors ${
                          selectedImageUrl === img.url
                            ? 'border-primary'
                            : 'border-transparent hover:border-border'
                        }`}
                      >
                        <img
                          src={`${API_BASE}${img.url}`}
                          alt={img.filename}
                          className="h-20 w-full object-cover"
                        />
                        {selectedImageUrl === img.url && (
                          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                            <Check className="h-5 w-5 text-primary" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Creating…' : 'Create Event'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
