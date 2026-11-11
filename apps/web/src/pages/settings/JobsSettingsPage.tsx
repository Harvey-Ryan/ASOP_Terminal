// Job board settings (v1.21.0): the module switch and the optional Discord
// channel jobs are posted in.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsApi, type GuildSettingsData } from '@/api/settings';
import { ChannelSelect, ToggleSwitch } from '@/components/settings/SettingsControls';

export function JobsSettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ['settings', guildId], queryFn: () => settingsApi.getSettings(guildId!) });
  const channels = useQuery({ queryKey: ['channels', guildId], queryFn: () => settingsApi.getChannels(guildId!) });
  const [enabled, setEnabled] = useState(true);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (saved.data) { setEnabled(saved.data.jobsEnabled ?? true); setChannelId(saved.data.jobsChannelId ?? null); }
  }, [saved.data]);

  const save = useMutation({
    mutationFn: (data: Partial<GuildSettingsData>) => settingsApi.updateSettings(guildId!, data),
    onSuccess: (data) => {
      qc.setQueryData(['settings', guildId], data);
      void qc.invalidateQueries({ queryKey: ['my-permissions', guildId] });
      void qc.invalidateQueries({ queryKey: ['setup', guildId] });
      setNote('Saved.');
    },
  });
  const loading = saved.isLoading || channels.isLoading;
  const dirty = !!saved.data && (enabled !== (saved.data.jobsEnabled ?? true) || channelId !== (saved.data.jobsChannelId ?? null));

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Job Board</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Members post small jobs (hauling, escort, crafting…) and others take them.</p>
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Settings</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          {loading ? <Skeleton className="h-24" /> : (
            <>
              <ToggleSwitch label="Enable the job board" description="Shows Jobs in the sidebar for everyone who can see events." checked={enabled}
                onChange={(v) => { setEnabled(v); setNote(null); }} />
              <div className="space-y-1">
                <label htmlFor="jobs-channel" className="text-sm font-medium">Discord channel <span className="font-normal text-muted-foreground">(optional)</span></label>
                <p className="text-xs text-muted-foreground">
                  New jobs are posted here with Take and Leave buttons, and update as people take them. Jobs your allies share with you are posted here too. Without a channel, jobs are on the website only.
                </p>
                <ChannelSelect id="jobs-channel" channels={(channels.data?.channels ?? []).filter((c) => c.type === 0 || c.type === 4 || c.type === 5)}
                  value={channelId} onChange={(v) => { setChannelId(v); setNote(null); }} />
              </div>
              <div className="flex items-center gap-3">
                <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate({ jobsEnabled: enabled, jobsChannelId: channelId })}>
                  {save.isPending ? 'Saving…' : 'Save'}
                </Button>
                {note && <span className="text-sm text-emerald-400">{note}</span>}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
