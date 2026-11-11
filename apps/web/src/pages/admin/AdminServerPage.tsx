// Admin → one server (v1.13.0): its setup problems, its settings (editable,
// with the same rules as the server's own settings pages; every change is in
// the activity log), its recent errors and admin history.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { ADMIN_SETTING_FIELDS, type AdminChannelDto, type AdminRoleDto, type AdminSettingField } from '@dem/shared';
import { adminApi } from '@/api/admin';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ADMIN, LoadFailed, Section, ago, inputCls, selectCls, when } from './adminUi';
import { OccurrenceList } from './AdminErrorsPage';

const GROUPS = ['Modules', 'Channels', 'General', 'Roles'] as const;
const CHANNEL_TYPES: Record<string, number[]> = { channel: [0, 5], forum: [15], category: [4] };
const TIME_ZONES: string[] = (() => { try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone'); } catch { return []; } })();

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function AdminServerPage() {
  const guildId = useParams().guildId!;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'guild', guildId], queryFn: () => adminApi.guild(guildId) });
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [savedNote, setSavedNote] = useState<string | null>(null);
  useEffect(() => { if (q.data) setDraft(q.data.settings); }, [q.data]);

  const changes = useMemo(() => {
    if (!q.data) return {};
    return Object.fromEntries(Object.entries(draft).filter(([k, v]) => !same(v, q.data!.settings[k])));
  }, [draft, q.data]);
  const save = useMutation({
    mutationFn: () => adminApi.saveSettings(guildId, changes),
    onSuccess: (r) => {
      setSavedNote(r.changed.length ? `Saved: ${r.changed.map((k) => ADMIN_SETTING_FIELDS.find((f) => f.key === k)?.label ?? k).join(', ')}.` : 'Nothing changed.');
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  if (q.isError) return <LoadFailed error={q.error} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const g = q.data;
  const count = Object.keys(changes).length;

  return (
    <div className="space-y-4 pb-20">
      <Link to={`${ADMIN}/servers`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Servers</Link>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
        {g.iconUrl ? <img src={g.iconUrl} alt="" className="h-12 w-12 rounded-full" /> : <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">{g.name.slice(0, 2)}</div>}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold">{g.name}</h2>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{g.guildId}</span> · bot joined {ago(g.joinedAt)}
            {g.discord?.memberCount != null && ` · ${g.discord.memberCount.toLocaleString()} members`}
            {g.discord?.ownerId && <> · owner <span className="font-mono">{g.discord.ownerId}</span></>}
            {` · ${g.counts.allies} allies · ${g.counts.members} members signed in`}
          </p>
        </div>
        <Link to={`${ADMIN}/errors?view=all&guildId=${g.guildId}`} className="text-sm text-primary hover:underline">{g.errors7d} errors this week</Link>
      </div>

      {g.setupIssues.length > 0 && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
          <p className="mb-1 flex items-center gap-2 font-medium text-yellow-200"><AlertTriangle className="h-4 w-4" />Looks unfinished</p>
          <ul className="list-disc space-y-0.5 pl-6 text-yellow-100/90">{g.setupIssues.map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
      )}
      {!g.discord && <p className="text-sm text-muted-foreground">Discord didn't answer, so channels and roles show as ids. Reload in a moment to pick them from lists.</p>}

      {GROUPS.map((group) => (
        <Section key={group} title={group}>
          <div className={cn('grid gap-3', group === 'Modules' ? 'sm:grid-cols-2 lg:grid-cols-3' : 'md:grid-cols-2')}>
            {ADMIN_SETTING_FIELDS.filter((f) => f.group === group).map((f) => (
              <Field key={f.key} field={f} value={draft[f.key]} changed={f.key in changes}
                channels={g.discord?.channels ?? []} roles={g.discord?.roles ?? []}
                onChange={(v) => { setSavedNote(null); setDraft((d) => ({ ...d, [f.key]: v })); }} />
            ))}
          </div>
        </Section>
      ))}

      <Section title="Recent errors in this server">
        {g.recentErrors.length ? <OccurrenceList rows={g.recentErrors} /> : <p className="text-sm text-muted-foreground">None recorded.</p>}
      </Section>
      <Section title="History">
        {g.log.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
          <ul className="space-y-1.5 text-sm">
            {g.log.map((l) => <li key={l.id}><span className="text-muted-foreground">{when(l.createdAt)}</span> · {l.actorName && <strong>{l.actorName}: </strong>}{l.summary}</li>)}
          </ul>
        )}
      </Section>

      {/* Save bar */}
      {(count > 0 || savedNote) && (
        <div className="sticky bottom-0 z-10 -mx-2 flex flex-wrap items-center gap-3 rounded-lg border bg-card/95 p-3 shadow-lg backdrop-blur">
          {count > 0 ? <>
            <span className="text-sm">{count} unsaved change{count === 1 ? '' : 's'} · applied as if this server's own officers saved them, and recorded in the activity log.</span>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDraft(g.settings)}>Discard</Button>
              <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save changes'}</Button>
            </div>
          </> : <span className="text-sm text-emerald-300">{savedNote}</span>}
        </div>
      )}
    </div>
  );
}

function Field({ field: f, value, changed, channels, roles, onChange }: {
  field: AdminSettingField; value: unknown; changed: boolean; channels: AdminChannelDto[]; roles: AdminRoleDto[]; onChange: (v: unknown) => void;
}) {
  const id = `f-${f.key}`;
  const label = (
    <label htmlFor={id} className="text-sm">
      {f.label}{changed && <span className="ml-1 text-primary" title="Changed">•</span>}
      {f.help && <span className="block text-xs text-muted-foreground">{f.help}</span>}
    </label>
  );

  if (f.type === 'boolean') {
    return (
      <label className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2', changed && 'border-primary/60')}>
        <span className="text-sm">{f.label}{changed && <span className="ml-1 text-primary">•</span>}</span>
        <input id={id} type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={value !== false} onChange={(e) => onChange(e.target.checked)} />
      </label>
    );
  }
  if (f.type === 'channel' || f.type === 'forum' || f.type === 'category') {
    const options = channels.filter((c) => CHANNEL_TYPES[f.type]!.includes(c.type));
    const current = typeof value === 'string' ? value : '';
    const missing = current && channels.length > 0 && !channels.some((c) => c.id === current);
    return (
      <div className="space-y-1">
        {label}
        {channels.length > 0 ? (
          <select id={id} className={cn(selectCls, 'w-full', changed && 'border-primary/60')} value={current} onChange={(e) => onChange(e.target.value || null)}>
            <option value="">— not set —</option>
            {missing && <option value={current}>⚠ deleted channel ({current})</option>}
            {options.map((c) => <option key={c.id} value={c.id}>{f.type === 'category' ? c.name : `#${c.name}`}</option>)}
          </select>
        ) : (
          <input id={id} className={cn(inputCls, 'w-full font-mono')} placeholder="channel id" value={current} onChange={(e) => onChange(e.target.value.trim() || null)} />
        )}
        {missing && <p className="text-xs text-yellow-300">This channel no longer exists in the server.</p>}
      </div>
    );
  }
  if (f.type === 'roles') {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="space-y-1">
        <span className="text-sm">{f.label}{changed && <span className="ml-1 text-primary">•</span>}</span>
        <div className={cn('max-h-40 space-y-0.5 overflow-y-auto rounded-md border p-2', changed && 'border-primary/60')}>
          {roles.length === 0 && <p className="text-xs text-muted-foreground">{selected.length ? selected.join(', ') : 'None'} (roles unavailable)</p>}
          {roles.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.includes(r.id)} onChange={(e) => onChange(e.target.checked ? [...selected, r.id] : selected.filter((x) => x !== r.id))} />
              <span style={r.color ? { color: `#${r.color.toString(16).padStart(6, '0')}` } : undefined}>{r.name}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{selected.length === 0 ? 'None: only the server\'s managers.' : `${selected.length} role${selected.length === 1 ? '' : 's'}`}</p>
      </div>
    );
  }
  if (f.type === 'enum') {
    return (
      <div className="space-y-1">{label}
        <select id={id} className={cn(selectCls, 'w-full', changed && 'border-primary/60')} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {f.options!.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ').toLowerCase()}</option>)}
        </select>
      </div>
    );
  }
  if (f.type === 'timezone') {
    return (
      <div className="space-y-1">{label}
        <input id={id} list="admin-tz" className={cn(inputCls, 'w-full', changed && 'border-primary/60')} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
        <datalist id="admin-tz">{TIME_ZONES.map((t) => <option key={t} value={t} />)}</datalist>
      </div>
    );
  }
  if (f.type === 'int') {
    return (
      <div className="space-y-1">{label}
        <input id={id} type="number" min={f.min} max={f.max} className={cn(inputCls, 'w-full', changed && 'border-primary/60')} value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
      </div>
    );
  }
  return (
    <div className="space-y-1">{label}
      <input id={id} maxLength={f.maxLength} className={cn(inputCls, 'w-full', changed && 'border-primary/60')} value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)} />
    </div>
  );
}
