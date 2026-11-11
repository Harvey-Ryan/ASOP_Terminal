// Admin → Discord feed (v1.13.0): where alerts and the daily digest go.

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminConfigDto } from '@dem/shared';
import { adminApi } from '@/api/admin';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadFailed, Section, inputCls, selectCls } from './adminUi';

type Form = Omit<AdminConfigDto, 'lastDigestDate'>;

export function AdminFeedPage() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['admin', 'config'], queryFn: adminApi.config });
  const guilds = useQuery({ queryKey: ['admin', 'guilds'], queryFn: adminApi.guilds });
  const [form, setForm] = useState<Form | null>(null);
  useEffect(() => { if (config.data && !form) setForm(config.data); }, [config.data, form]);
  const server = useQuery({ queryKey: ['admin', 'guild', form?.feedGuildId], queryFn: () => adminApi.guild(form!.feedGuildId!), enabled: !!form?.feedGuildId });
  const [note, setNote] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => adminApi.saveConfig(form!),
    onSuccess: (c) => { setForm(c); setNote('Saved.'); void qc.invalidateQueries({ queryKey: ['admin'] }); },
  });
  const test = useMutation({ mutationFn: adminApi.testFeed, onSuccess: () => setNote('Test message sent. It should appear in the channel within a few seconds.') });

  if (config.isError) return <LoadFailed error={config.error} />;
  if (!form) return <Skeleton className="h-64" />;
  const set = (patch: Partial<Form>) => { setNote(null); setForm({ ...form, ...patch }); };
  const textChannels = (server.data?.discord?.channels ?? []).filter((c) => c.type === 0 || c.type === 5);
  const dirty = JSON.stringify(form) !== JSON.stringify((({ lastDigestDate: _, ...rest }) => rest)(config.data!));

  return (
    <div className="max-w-2xl space-y-4">
      <Section title="Channel">
        <p className="mb-3 text-sm text-muted-foreground">Pick a private channel in a server the bot is in. Only you should be able to read it: alerts include error messages and server names.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">Server
            <select className={`${selectCls} w-full`} value={form.feedGuildId ?? ''} onChange={(e) => set({ feedGuildId: e.target.value || null, feedChannelId: null })}>
              <option value="">— off —</option>
              {(guilds.data ?? []).map((g) => <option key={g.guildId} value={g.guildId}>{g.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">Channel
            <select className={`${selectCls} w-full`} disabled={!form.feedGuildId || server.isLoading} value={form.feedChannelId ?? ''} onChange={(e) => set({ feedChannelId: e.target.value || null })}>
              <option value="">{server.isLoading ? 'Loading…' : '— choose —'}</option>
              {textChannels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </label>
        </div>
      </Section>

      <Section title="What's posted">
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">Servers adding or removing the bot are always posted.</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={form.alertsEnabled} onChange={(e) => set({ alertsEnabled: e.target.checked })} />
            <span><strong>Error alerts</strong>: when a new kind of error appears, or one you resolved comes back. At most one alert per kind every 6 hours; kinds you ignore are never alerted.</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={form.digestEnabled} onChange={(e) => set({ digestEnabled: e.target.checked })} />
            <span><strong>Daily digest</strong>: errors, new kinds, servers, admin changes and service health for the last 24 hours.</span>
          </label>
          <div className="flex flex-wrap items-center gap-2 pl-6">
            <span>at</span>
            <select aria-label="Digest hour" className={selectCls} disabled={!form.digestEnabled} value={form.digestHour} onChange={(e) => set({ digestHour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' })}</option>)}
            </select>
            <input aria-label="Digest time zone" className={inputCls} disabled={!form.digestEnabled} value={form.digestTimezone} onChange={(e) => set({ digestTimezone: e.target.value })} />
          </div>
          {config.data?.lastDigestDate && <p className="pl-6 text-xs text-muted-foreground">Last digest: {config.data.lastDigestDate}</p>}
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!dirty || save.isPending || (!!form.feedGuildId && !form.feedChannelId)} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save'}</Button>
        <Button variant="outline" disabled={dirty || !config.data?.feedChannelId || test.isPending} onClick={() => test.mutate()}>Send a test message</Button>
        {note && <span className="text-sm text-emerald-300">{note}</span>}
        {dirty && <span className="text-xs text-muted-foreground">Save first to send a test.</span>}
      </div>
    </div>
  );
}
