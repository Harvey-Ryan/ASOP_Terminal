import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsApi } from '@/api/settings';
import { tournamentApi } from '@/api/tournament';
import { ChannelSelect, ToggleSwitch } from '@/components/settings/SettingsControls';
import type { GuildSettingsData } from '@/api/settings';

export function TournamentSettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: saved, isLoading: settingsLoading } = useQuery({
    queryKey: ['settings', guildId],
    queryFn: () => settingsApi.getSettings(guildId!),
    enabled: !!guildId,
  });

  const { data: channelData, isLoading: channelsLoading } = useQuery({
    queryKey: ['channels', guildId],
    queryFn: () => settingsApi.getChannels(guildId!),
    enabled: !!guildId,
  });

  const loading = settingsLoading || channelsLoading;
  const channels = channelData?.channels ?? [];
  // Forum (15) and text (0) channels are valid targets for tournament threads
  const threadableChannels = channels.filter((c) => c.type === 15 || c.type === 0 || c.type === 5);

  // ── Enabled toggle ────────────────────────────────────────────────────────

  const [enabled, setEnabled] = useState(true);
  const [enabledDirty, setEnabledDirty] = useState(false);
  const [enabledFlash, setEnabledFlash] = useState(false);

  // ── Channel ───────────────────────────────────────────────────────────────

  const [channelId, setChannelId] = useState<string | null>(null);
  const [channelDirty, setChannelDirty] = useState(false);
  const [channelFlash, setChannelFlash] = useState(false);

  useEffect(() => {
    if (saved) {
      setEnabled(saved.tournamentsEnabled ?? true);
      setEnabledDirty(false);
      setChannelId(saved.tournamentChannelId ?? null);
      setChannelDirty(false);
    }
  }, [saved]);

  function flash(set: (v: boolean) => void) {
    set(true);
    setTimeout(() => set(false), 2500);
  }

  const save = useMutation({
    mutationFn: (data: Partial<GuildSettingsData>) => settingsApi.updateSettings(guildId!, data),
    onSuccess: (data) => {
      if (data) qc.setQueryData(['settings', guildId], data);
      qc.invalidateQueries({ queryKey: ['my-permissions', guildId] });
    },
  });

  function saveEnabled() {
    save.mutate({ tournamentsEnabled: enabled }, {
      onSuccess: () => { setEnabledDirty(false); flash(setEnabledFlash); },
    });
  }

  function saveChannel() {
    save.mutate({ tournamentChannelId: channelId }, {
      onSuccess: () => { setChannelDirty(false); flash(setChannelFlash); },
    });
  }

  const demo = useMutation({
    mutationFn: () => tournamentApi.demo(guildId!),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['tournaments', guildId] });
      navigate(`/dashboard/servers/${guildId}/tournaments?demo=${data.tournamentId}`);
    },
  });

  return (
    <div className="space-y-6">
      {/* ── Enable/disable ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tournaments Module</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? <Skeleton className="h-8 w-full" /> : (
            <ToggleSwitch
              label="Enable Tournaments"
              description="Show the Tournaments page in the sidebar and allow managers to create and run brackets."
              checked={enabled}
              onChange={(v) => { setEnabled(v); setEnabledDirty(true); }}
            />
          )}
          {enabledDirty && (
            <Button size="sm" onClick={saveEnabled} disabled={save.isPending}>
              {enabledFlash ? <><Check className="h-4 w-4 mr-1" />Saved</> : 'Save'}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── Announcement channel ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Announcement Channel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Default channel where tournament threads are created. Each tournament can override this individually.
            Forum channels (📋) are recommended — the bot creates a thread per tournament.
          </p>
          {loading ? <Skeleton className="h-9 w-full" /> : (
            <ChannelSelect
              id="tournament-channel"
              channels={threadableChannels}
              value={channelId}
              onChange={(v) => { setChannelId(v); setChannelDirty(true); }}
              types={[0, 5, 15]}
            />
          )}
          {channelDirty && (
            <Button size="sm" onClick={saveChannel} disabled={save.isPending}>
              {channelFlash ? <><Check className="h-4 w-4 mr-1" />Saved</> : 'Save'}
            </Button>
          )}
          {save.isError && (
            <p className="text-xs text-destructive">Failed to save — {(save.error as Error).message}</p>
          )}
        </CardContent>
      </Card>

      {/* ── Demo tournament ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Demo Tournament</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Creates a completed 8-person tournament with fake participants and randomly resolved
            matches. Useful for testing the bracket viewer and result flow without real participants.
            No Discord announcements are sent.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => demo.mutate()}
            disabled={demo.isPending}
          >
            {demo.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Running demo…</>
            ) : (
              'Run Demo Tournament'
            )}
          </Button>
          {demo.isError && (
            <p className="text-xs text-destructive">Failed — {(demo.error as Error).message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
