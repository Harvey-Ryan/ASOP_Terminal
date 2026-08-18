import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsApi } from '@/api/settings';
import { tournamentApi } from '@/api/tournament';
import { ChannelSelect, ToggleSwitch } from '@/components/settings/SettingsControls';
import type { GuildSettingsData } from '@/api/settings';

type StepState = 'idle' | 'running' | 'done' | 'error';
interface DemoStep { label: string; state: StepState; detail?: string; }

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

  const INITIAL_STEPS: DemoStep[] = [
    { label: 'Create tournament', state: 'idle' },
    { label: 'Add 8 participants', state: 'idle' },
    { label: 'Generate bracket', state: 'idle' },
    { label: 'Resolve matches', state: 'idle' },
  ];

  const [demoSteps, setDemoSteps] = useState<DemoStep[]>(INITIAL_STEPS);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoTournamentId, setDemoTournamentId] = useState<string | null>(null);

  function setStep(i: number, patch: Partial<DemoStep>) {
    setDemoSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function runDemo() {
    setDemoRunning(true);
    setDemoTournamentId(null);
    setDemoSteps(INITIAL_STEPS);
    let tid: string | null = null;

    setStep(0, { state: 'running' });
    try {
      const r = await tournamentApi.demo(guildId!);
      tid = r.tournamentId;
      setDemoTournamentId(tid);
      setStep(0, { state: 'done', detail: r.name });
    } catch (e) {
      setStep(0, { state: 'error', detail: (e as Error).message });
      setDemoRunning(false);
      return;
    }

    setStep(1, { state: 'running' });
    try {
      const r = await tournamentApi.demoParticipants(guildId!, tid!);
      setStep(1, { state: 'done', detail: `${r.count} participants added` });
    } catch (e) {
      setStep(1, { state: 'error', detail: (e as Error).message });
      setDemoRunning(false);
      return;
    }

    setStep(2, { state: 'running' });
    try {
      const r = await tournamentApi.demoBracket(guildId!, tid!);
      setStep(2, { state: 'done', detail: `${r.matchCount} matches created` });
    } catch (e) {
      setStep(2, { state: 'error', detail: (e as Error).message });
      setDemoRunning(false);
      return;
    }

    setStep(3, { state: 'running' });
    try {
      const r = await tournamentApi.demoResolve(guildId!, tid!);
      setStep(3, { state: 'done', detail: `Winner: ${r.winner}` });
      qc.invalidateQueries({ queryKey: ['tournaments', guildId] });
    } catch (e) {
      setStep(3, { state: 'error', detail: (e as Error).message });
      setDemoRunning(false);
      return;
    }

    setDemoRunning(false);
  }

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
            Runs through all four tournament steps with fake participants so you can test the bracket
            viewer without real players. No Discord announcements are sent.
          </p>
          <Button size="sm" variant="outline" onClick={runDemo} disabled={demoRunning}>
            {demoRunning
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Running…</>
              : 'Run Demo Tournament'}
          </Button>

          {demoSteps.some((s) => s.state !== 'idle') && (
            <div className="space-y-2 pt-1">
              {demoSteps.map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {step.state === 'idle' && (
                    <div className="h-4 w-4 shrink-0 rounded-full border border-muted-foreground/30" />
                  )}
                  {step.state === 'running' && (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                  )}
                  {step.state === 'done' && (
                    <Check className="h-4 w-4 shrink-0 text-green-500" />
                  )}
                  {step.state === 'error' && (
                    <X className="h-4 w-4 shrink-0 text-destructive" />
                  )}
                  <span className={
                    step.state === 'error' ? 'text-destructive' :
                    step.state === 'running' ? 'font-medium' :
                    step.state === 'done' ? 'text-foreground' :
                    'text-muted-foreground'
                  }>
                    {step.label}
                  </span>
                  {step.detail && (
                    <span className="text-xs text-muted-foreground">— {step.detail}</span>
                  )}
                </div>
              ))}
              {!demoRunning && demoTournamentId && demoSteps.every((s) => s.state === 'done') && (
                <button
                  className="text-xs text-primary underline underline-offset-2 hover:opacity-80 mt-1"
                  onClick={() => navigate(`/dashboard/servers/${guildId}/tournaments?demo=${demoTournamentId}`)}
                >
                  View completed tournament →
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
