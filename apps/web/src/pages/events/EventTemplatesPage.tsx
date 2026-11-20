// Event templates (v1.41.0): a server's templates, made here or with "Save as
// template" on an event, each with an optional briefing that new events get
// as an unpublished draft. Rules: apps/api/src/lib/eventTemplates.ts.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarPlus,
  ClipboardList,
  LayoutTemplate,
  MonitorPlay,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import {
  briefingSlides,
  defaultBriefing,
  type BriefingContent,
  type BriefingViewDto,
  type EventRole,
  type EventTemplateDto,
  type UpsertEventTemplateBody,
} from '@dem/shared';
import { eventTemplatesApi } from '@/api/eventTemplates';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ServerImagePicker } from '@/components/ServerImagePicker';
import { cn } from '@/lib/utils';
import { Editor, Present } from './BriefingPage';

const inputCls =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-brand focus:outline-none';
const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `r${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const duration = (m: number | null) =>
  m == null ? null : m % 60 === 0 ? `${m / 60} h` : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0
    ? 'today'
    : days === 1
      ? 'yesterday'
      : days < 60
        ? `${days} days ago`
        : new Date(iso).toLocaleDateString();
};

// ── The form ──────────────────────────────────────────────────────────────────

type Draft = Required<Omit<UpsertEventTemplateBody, 'fromEventId'>>;

const toDraft = (t?: EventTemplateDto): Draft => ({
  name: t?.name ?? '',
  description: t?.description ?? '',
  musterPoint: t?.musterPoint ?? '',
  imageUrl: t?.imageUrl ?? null,
  roles: t?.roles.map((r) => ({ ...r })) ?? [],
  vcNames: t?.vcNames ?? [],
  briefingChannel: t?.briefingChannel ?? false,
  defaultDuration: t?.defaultDuration ?? 120,
});

function TemplateForm({
  guildId,
  template,
  onSaved,
  onCancel,
}: {
  guildId: string;
  template?: EventTemplateDto;
  onSaved: (t: EventTemplateDto) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(() => toDraft(template));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setRole = (i: number, patch: Partial<EventRole>) =>
    set({ roles: d.roles.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const save = useMutation({
    mutationFn: () => {
      const body: UpsertEventTemplateBody = {
        ...d,
        roles: d.roles.filter((r) => r.name.trim()),
        vcNames: d.vcNames.filter((v) => v.trim()),
      };
      return template ? eventTemplatesApi.update(guildId, template.id, body) : eventTemplatesApi.create(guildId, body);
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save'),
  });

  return (
    <form
      className="space-y-4 rounded-lg border border-brand/40 bg-card p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{template ? `Edit "${template.name}"` : 'New template'}</h2>
        <button type="button" aria-label="Close" onClick={onCancel}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-3">
          <label className="block text-sm">
            Name
            <input
              className={cn(inputCls, 'mt-1')}
              required
              maxLength={200}
              value={d.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="e.g. Saturday mining op"
            />
          </label>
          <label className="block text-sm">
            Description
            <textarea
              className={cn(inputCls, 'mt-1 min-h-[80px]')}
              maxLength={2000}
              value={d.description ?? ''}
              onChange={(e) => set({ description: e.target.value })}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Muster point
              <input
                className={cn(inputCls, 'mt-1')}
                maxLength={300}
                value={d.musterPoint ?? ''}
                onChange={(e) => set({ musterPoint: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              Usual length
              <select
                className={cn(inputCls, 'mt-1')}
                value={d.defaultDuration ?? ''}
                onChange={(e) => set({ defaultDuration: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Not set</option>
                {[30, 60, 90, 120, 180, 240, 360].map((m) => (
                  <option key={m} value={m}>
                    {duration(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="text-sm">
          <div className="mb-1">Event image</div>
          <ServerImagePicker
            guildId={guildId}
            value={d.imageUrl}
            onChange={(imageUrl) => set({ imageUrl })}
            emptyLabel="No image"
          />
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-sm">
          Roles{' '}
          <span className="text-muted-foreground">(people sign up for these; roster slides can be linked to them)</span>
        </div>
        <div className="space-y-2">
          {d.roles.map((r, i) => (
            <div key={r.id} className="flex items-center gap-2">
              <input
                className={inputCls}
                placeholder="Role name"
                maxLength={100}
                value={r.name}
                onChange={(e) => setRole(i, { name: e.target.value })}
                aria-label="Role name"
              />
              <input
                type="number"
                min={1}
                max={99}
                className={cn(inputCls, 'w-20')}
                value={r.count}
                aria-label={`How many ${r.name || 'people'}`}
                onChange={(e) => setRole(i, { count: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
              />
              <button
                type="button"
                aria-label={`Remove ${r.name || 'role'}`}
                className="p-1 text-muted-foreground hover:text-red-400"
                onClick={() => set({ roles: d.roles.filter((_, j) => j !== i) })}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => set({ roles: [...d.roles, { id: newId(), name: '', count: 1 }] })}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add a role
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-sm">
            Voice channels <span className="text-muted-foreground">(made before the start)</span>
          </div>
          <div className="space-y-2">
            {d.vcNames.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className={inputCls}
                  maxLength={100}
                  value={v}
                  onChange={(e) => set({ vcNames: d.vcNames.map((x, j) => (j === i ? e.target.value : x)) })}
                  aria-label="Voice channel name"
                />
                <button
                  type="button"
                  aria-label="Remove voice channel"
                  className="p-1 text-muted-foreground hover:text-red-400"
                  onClick={() => set({ vcNames: d.vcNames.filter((_, j) => j !== i) })}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            {d.vcNames.length < 10 && (
              <Button type="button" size="sm" variant="outline" onClick={() => set({ vcNames: [...d.vcNames, ''] })}>
                <Plus className="mr-1 h-4 w-4" />
                Add a voice channel
              </Button>
            )}
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm sm:pt-7">
          <input
            type="checkbox"
            className="mt-0.5 accent-[#b98a13]"
            checked={d.briefingChannel}
            onChange={(e) => set({ briefingChannel: e.target.checked })}
          />
          <span>Also make a push-to-talk Briefing voice channel</span>
        </label>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending || !d.name.trim()}>
          <Save className="mr-1 h-4 w-4" />
          {save.isPending ? 'Saving…' : 'Save template'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── The list ──────────────────────────────────────────────────────────────────

export function EventTemplatesPage() {
  const { guildId = '' } = useParams<{ guildId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const key = ['event-templates-all', guildId];
  const q = useQuery({ queryKey: key, queryFn: () => eventTemplatesApi.all(guildId) });
  const [editing, setEditing] = useState<EventTemplateDto | 'new' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (t: EventTemplateDto) => eventTemplatesApi.remove(guildId, t.id),
    onSuccess: (_r, t) => {
      setMsg(`Deleted "${t.name}". Events already made from it aren't changed.`);
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['event-templates', guildId] });
    },
  });
  const saved = (t: EventTemplateDto) => {
    setEditing(null);
    setMsg(`Saved "${t.name}".`);
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['event-templates', guildId] });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to={`/dashboard/servers/${guildId}`}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Events
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold">
            <LayoutTemplate className="h-6 w-6 text-brand" />
            Event templates
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Start events from a template, with its roles, voice channels and details filled in. A template can carry a
            briefing: every event made from it gets the briefing as an unpublished draft to adjust and publish.
          </p>
        </div>
        {editing === null && (
          <Button
            onClick={() => {
              setEditing('new');
              setMsg(null);
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            New template
          </Button>
        )}
      </div>
      {msg && (
        <p className="text-sm text-[#e2bd5b]" role="status">
          {msg}
        </p>
      )}
      {editing && (
        <TemplateForm
          key={editing === 'new' ? 'new' : editing.id}
          guildId={guildId}
          template={editing === 'new' ? undefined : editing}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      )}

      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <p className="text-sm text-red-400">
          {q.error instanceof Error && /forbidden/i.test(q.error.message)
            ? 'Only people who can create events here can see its templates.'
            : "Templates couldn't be loaded."}
        </p>
      ) : !q.data?.length ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          No templates yet. Make one here, or open an event and choose <b>Save as template</b>.
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {q.data.map((t) => (
            <li key={t.id} className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
              {t.imageUrl && <img src={t.imageUrl} alt="" className="h-24 w-full object-cover" />}
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{t.name}</h3>
                  <div className="flex shrink-0 gap-1.5">
                    {t.hasBriefing ? (
                      <span className="rounded-full border border-brand/60 px-2 py-0.5 text-[11px] text-[#e2bd5b]">
                        Briefing
                      </span>
                    ) : (
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        No briefing
                      </span>
                    )}
                    {!t.curated && (
                      <span
                        className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                        title="Made by the Repeat button. It follows the latest event made from it until someone edits it here."
                      >
                        From Repeat
                      </span>
                    )}
                  </div>
                </div>
                {t.description && <p className="line-clamp-2 text-sm text-muted-foreground">{t.description}</p>}
                <p className="text-xs text-muted-foreground">
                  {t.roles.length ? t.roles.map((r) => `${r.name} ×${r.count}`).join(' · ') : 'No roles'}
                  {t.musterPoint ? ` · Muster: ${t.musterPoint}` : ''}
                  {t.defaultDuration ? ` · ${duration(t.defaultDuration)}` : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  Used {t.useCount} {t.useCount === 1 ? 'time' : 'times'} in 6 months · last {ago(t.lastUsedAt)}
                </p>
                <div className="mt-auto flex flex-wrap gap-2 pt-2">
                  <Button size="sm" onClick={() => navigate(`/dashboard/servers/${guildId}?newFrom=${t.id}`)}>
                    <CalendarPlus className="mr-1 h-4 w-4" />
                    Use
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditing(t);
                      setMsg(null);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
                    <Pencil className="mr-1 h-4 w-4" />
                    Edit
                  </Button>
                  <Button size="sm" variant="secondary" asChild>
                    <Link to={`/dashboard/servers/${guildId}/templates/${t.id}/briefing`}>
                      <ClipboardList className="mr-1 h-4 w-4" />
                      {t.hasBriefing ? 'Briefing' : 'Add briefing'}
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-red-400"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (
                        window.confirm(`Delete the "${t.name}" template? Events already made from it aren't changed.`)
                      )
                        remove.mutate(t);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── A template's briefing ────────────────────────────────────────────────────

export function TemplateBriefingPage() {
  const { guildId = '', templateId = '' } = useParams<{ guildId: string; templateId: string }>();
  const qc = useQueryClient();
  const key = ['event-template-briefing', guildId, templateId];
  const q = useQuery({ queryKey: key, queryFn: () => eventTemplatesApi.briefing(guildId, templateId) });
  const [draft, setDraft] = useState<BriefingContent | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [presentAt, setPresentAt] = useState<number | null>(null);

  useEffect(() => {
    if (q.data && !dirty) setDraft(q.data.content ?? defaultBriefing());
  }, [q.data, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: (c: BriefingContent) => eventTemplatesApi.saveBriefing(guildId, templateId, c),
    onSuccess: (r) => {
      setDirty(false);
      setMsg('Saved. New events made from this template get this briefing as a draft.');
      qc.setQueryData(key, r);
      void qc.invalidateQueries({ queryKey: ['event-templates-all', guildId] });
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : 'Could not save'),
  });
  const remove = useMutation({
    mutationFn: () => eventTemplatesApi.removeBriefing(guildId, templateId),
    onSuccess: () => {
      setDirty(false);
      setDraft(defaultBriefing());
      setMsg('Briefing removed from the template');
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['event-templates-all', guildId] });
    },
  });

  const back = `/dashboard/servers/${guildId}/templates`;
  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (q.isError || !q.data) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-muted-foreground">This template's briefing couldn't be loaded.</p>
        <Link to={back} className="text-sm text-brand hover:underline">
          Back to templates
        </Link>
      </div>
    );
  }
  const t = q.data.template;
  // The editor and slides work on an event; a template stands in for one: no
  // date, nobody signed up, its own roles, the server's logo.
  const view: BriefingViewDto = {
    event: {
      id: '',
      name: t.name,
      startTime: '',
      endTime: null,
      musterPoint: t.musterPoint,
      hostGuildId: guildId,
      signedUp: 0,
      maybe: 0,
      roles: t.roles.map((r) => ({ id: r.id, name: r.name, count: r.count, people: [] })),
      templateId: null,
    },
    briefing: null,
    logos: q.data.logos,
    canEdit: true,
  };
  const setC = (c: BriefingContent) => {
    setDraft(c);
    setDirty(true);
    setMsg(null);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={back} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" />
            Templates
          </Link>
          <h1 className="mt-1 font-condensed text-2xl font-bold uppercase tracking-wide text-foreground sm:text-3xl">
            {t.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Template briefing · copied into each new event as a draft
            <span
              className={cn(
                'ml-2 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                q.data.content ? 'border-brand/60 text-[#e2bd5b]' : 'border-orange-500/50 text-orange-400',
              )}
            >
              {q.data.content ? 'Saved' : 'Not saved yet'}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {draft && briefingSlides(draft).length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setPresentAt(0)}>
              <MonitorPlay className="mr-1 h-4 w-4" />
              Preview slides
            </Button>
          )}
          <Button
            size="sm"
            disabled={(!dirty && !!q.data.content) || save.isPending || !draft}
            onClick={() => draft && save.mutate(draft)}
          >
            <Save className="mr-1 h-4 w-4" />
            {save.isPending ? 'Saving…' : dirty || !q.data.content ? 'Save to template' : 'Saved'}
          </Button>
        </div>
      </div>
      {msg && (
        <p className="text-sm text-[#e2bd5b]" role="status">
          {msg}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Roster slides can be linked to this template's roles; on each event they show whoever signed up. The Force
        section's "From the signed-up fleets" is only on events.
      </p>
      {draft && <Editor guildId={guildId} view={view} c={draft} setC={setC} onPreview={(i) => setPresentAt(i)} />}
      {q.data.content && (
        <div className="border-t border-border pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-red-400"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm("Remove this template's briefing? Events already made from it keep theirs."))
                remove.mutate();
            }}
          >
            <Trash2 className="mr-1 h-4 w-4" />
            Remove briefing
          </Button>
        </div>
      )}
      {presentAt !== null && draft && (
        <Present view={view} c={draft} start={presentAt} onClose={() => setPresentAt(null)} />
      )}
    </div>
  );
}
