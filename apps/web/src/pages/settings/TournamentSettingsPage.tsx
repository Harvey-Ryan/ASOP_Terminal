import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsApi } from '@/api/settings';
import { tournamentApi } from '@/api/tournament';
import { ChannelSelect, ToggleSwitch } from '@/components/settings/SettingsControls';
import type { GuildSettingsData } from '@/api/settings';

type StepState = 'idle' | 'running' | 'done' | 'error';
interface TestStep { label: string; state: StepState; detail?: string; }

// Fake Discord snowflake IDs used only for the lifecycle test so ELO ratings
// are exercised. These IDs are below the valid Discord snowflake range and will
// never collide with real users.
const LIFECYCLE_PARTICIPANTS = [
  { name: 'Alice',   discordId: '999000000000001' },
  { name: 'Bob',     discordId: '999000000000002' },
  { name: 'Charlie', discordId: '999000000000003' },
  { name: 'Diana',   discordId: '999000000000004' },
  { name: 'Eve',     discordId: '999000000000005' },
  { name: 'Frank',   discordId: '999000000000006' },
  { name: 'Grace',   discordId: '999000000000007' },
  { name: 'Henry',   discordId: '999000000000008' },
];
const PAUSE_SECONDS = 30;

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
  const forumChannels = channels.filter((c) => c.type === 15);

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

  function buildInitialSteps(): TestStep[] {
    return [
      { label: 'Create tournament', state: 'idle' },
      { label: 'Open registration', state: 'idle' },
      ...LIFECYCLE_PARTICIPANTS.map((p) => ({ label: `Register ${p.name}`, state: 'idle' as StepState })),
      { label: 'Start tournament', state: 'idle' },
    ];
  }

  const [testSteps, setTestSteps] = useState<TestStep[]>(buildInitialSteps);
  const [testRunning, setTestRunning] = useState(false);
  const [testCountdown, setTestCountdown] = useState<number | null>(null);
  const [testDoneId, setTestDoneId] = useState<string | null>(null);

  function patchStep(i: number, patch: Partial<TestStep>) {
    setTestSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  async function pauseForDiscord() {
    for (let i = PAUSE_SECONDS; i > 0; i--) {
      setTestCountdown(i);
      await sleep(1000);
    }
    setTestCountdown(null);
  }

  async function runTest() {
    setTestRunning(true);
    setTestDoneId(null);
    setTestSteps(buildInitialSteps());
    let idx = 0;
    let tid = '';

    // ── Create tournament ───────────────────────────────────────────────────
    patchStep(idx, { state: 'running' });
    try {
      const r = await tournamentApi.create(guildId!, {
        name: `Lifecycle Test ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        description: 'Smoke test — please ignore.',
        format: 'SINGLE_ELIM',
        size: LIFECYCLE_PARTICIPANTS.length,
        seedingMode: 'RANDOM',
      });
      tid = r.id;
      patchStep(idx, { state: 'done', detail: r.name });
    } catch (e) {
      patchStep(idx, { state: 'error', detail: (e as Error).message });
      setTestRunning(false); return;
    }
    idx++;

    // 30s: wait for bot to create the draft thread and save threadId before
    // postTournamentOpen runs — otherwise it sees null and creates a second thread
    await pauseForDiscord();

    // ── Open registration ───────────────────────────────────────────────────
    patchStep(idx, { state: 'running' });
    try {
      await tournamentApi.open(guildId!, tid);
      patchStep(idx, { state: 'done' });
    } catch (e) {
      patchStep(idx, { state: 'error', detail: (e as Error).message });
      setTestRunning(false); return;
    }
    idx++;

    // ── Register participants (with fake Discord IDs so ELO is exercised) ──
    for (const p of LIFECYCLE_PARTICIPANTS) {
      patchStep(idx, { state: 'running' });
      try {
        await tournamentApi.register(guildId!, tid, { displayName: p.name, discordId: p.discordId });
        patchStep(idx, { state: 'done' });
      } catch (e) {
        patchStep(idx, { state: 'error', detail: (e as Error).message });
        setTestRunning(false); return;
      }
      await sleep(2_500); // rate-limit buffer between Discord embed edits
      idx++;
    }

    // 30s: watch registration embed update in Discord
    await pauseForDiscord();

    // ── Start tournament ────────────────────────────────────────────────────
    patchStep(idx, { state: 'running' });
    try {
      await tournamentApi.start(guildId!, tid);
      patchStep(idx, { state: 'done' });
    } catch (e) {
      patchStep(idx, { state: 'error', detail: (e as Error).message });
      setTestRunning(false); return;
    }
    idx++;

    // 30s: watch "🔒 Registration closed" + bracket + Round 1 match cards
    await pauseForDiscord();

    // ── Fetch match structure; dynamically add match steps ──────────────────
    let detail = await tournamentApi.get(guildId!, tid);
    const maxRound = Math.max(...detail.matches.map((m) => m.round));

    const matchSteps: TestStep[] = [];
    for (let r = 1; r <= maxRound; r++) {
      const roundMs = detail.matches.filter((m) => m.round === r && m.status !== 'BYE');
      for (const m of roundMs) {
        const isThirdPlace = m.bracketSide === 'THIRD_PLACE';
        const winnersBracketAtRound = roundMs.filter((x) => x.bracketSide === 'WINNERS');
        const isGrandFinal = m.bracketSide === 'WINNERS' && winnersBracketAtRound.length === 1 && r === maxRound;
        let label: string;
        if (isThirdPlace) label = '3rd Place — submit result';
        else if (isGrandFinal) label = 'Final — submit result';
        else label = `Round ${r} · Match ${m.position + 1}`;
        matchSteps.push({ label, state: 'idle' });
      }
    }
    setTestSteps((prev) => [...prev, ...matchSteps]);

    // ── Submit results round by round ───────────────────────────────────────
    for (let round = 1; round <= maxRound; round++) {
      // Re-fetch: later rounds have participantAId / participantBId populated
      // only after earlier rounds complete
      detail = await tournamentApi.get(guildId!, tid);

      const roundMatches = detail.matches
        .filter((m) => m.round === round && m.status !== 'BYE' && m.participantAId && m.participantBId)
        .sort((a, b) => a.position - b.position);

      for (const match of roundMatches) {
        patchStep(idx, { state: 'running' });
        try {
          await tournamentApi.submitResult(guildId!, tid, match.id, {
            winnerId: match.participantAId!,
            scoreA: 2,
            scoreB: 1,
          });
          patchStep(idx, { state: 'done', detail: '2 – 1' });
        } catch (e) {
          patchStep(idx, { state: 'error', detail: (e as Error).message });
          setTestRunning(false); return;
        }
        idx++;
        // 30s after each result: result card + bracket refresh (+ next-round card if applicable)
        await pauseForDiscord();
      }
    }

    qc.invalidateQueries({ queryKey: ['tournaments', guildId] });
    setTestDoneId(tid);
    setTestRunning(false);
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
            Forum channel where tournament threads are created. Must be a Discord forum channel (📋) —
            the bot creates one thread per tournament for announcements and match cards.
            Each tournament can override this individually.
          </p>
          {loading ? <Skeleton className="h-9 w-full" /> : (
            <ChannelSelect
              id="tournament-channel"
              channels={forumChannels}
              value={channelId}
              onChange={(v) => { setChannelId(v); setChannelDirty(true); }}
              types={[15]}
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

      {/* ── Lifecycle test ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Lifecycle Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Walks through the full tournament lifecycle end-to-end — draft thread, registration embed,
            bracket generation, match cards, result cards, and champion announcement — pausing
            {' '}{PAUSE_SECONDS}s between Discord-triggering stages so you can observe each post.
          </p>
          <Button size="sm" variant="outline" onClick={runTest} disabled={testRunning}>
            {testRunning
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Running…</>
              : 'Run Lifecycle Test'}
          </Button>

          {testSteps.some((s) => s.state !== 'idle') && (
            <div className="space-y-1.5 pt-1">
              {testSteps.map((step, i) => (
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
                    step.state === 'error'   ? 'text-destructive' :
                    step.state === 'running' ? 'font-medium' :
                    step.state === 'done'    ? 'text-foreground' :
                    'text-muted-foreground'
                  }>
                    {step.label}
                  </span>
                  {step.detail && (
                    <span className="text-xs text-muted-foreground">— {step.detail}</span>
                  )}
                </div>
              ))}

              {/* Countdown shown between Discord-triggering stages */}
              {testCountdown !== null && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground pt-0.5 pl-6">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  <span>Watching Discord… next stage in {testCountdown}s</span>
                </div>
              )}

              {!testRunning && testDoneId && testSteps.every((s) => s.state === 'done') && (
                <button
                  className="text-xs text-primary underline underline-offset-2 hover:opacity-80 mt-1 pl-6"
                  onClick={() => navigate(`/dashboard/servers/${guildId}/tournaments`)}
                >
                  View tournament →
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Reset Rankings ─────────────────────────────────────────────────── */}
      <ResetRankingsCard guildId={guildId!} />
    </div>
  );
}

// ── Reset Rankings card ───────────────────────────────────────────────────────

function ResetRankingsCard({ guildId }: { guildId: string }) {
  const qc = useQueryClient();
  const [flash, setFlash] = useState(false);

  const reset = useMutation({
    mutationFn: () => tournamentApi.resetRankings(guildId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['tournament-rankings', guildId] });
      setFlash(true);
      setTimeout(() => setFlash(false), 3000);
      return data;
    },
  });

  return (
    <Card className="border-destructive/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">ELO Rankings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Permanently wipes all ELO ratings and match history for this server.
          Use this to clean up after lifecycle tests or to start a fresh season.
          This cannot be undone.
        </p>
        {reset.isError && (
          <p className="text-xs text-destructive">{(reset.error as Error).message}</p>
        )}
        <Button
          size="sm"
          variant="destructive"
          disabled={reset.isPending}
          onClick={() => {
            if (confirm('Reset all ELO rankings for this server? This cannot be undone.')) {
              reset.mutate();
            }
          }}
        >
          {reset.isPending ? (
            <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Resetting…</>
          ) : flash ? (
            <><Check className="h-4 w-4 mr-1" />{(reset.data as { deleted: number } | undefined)?.deleted ?? 0} records cleared</>
          ) : (
            <><RotateCcw className="h-4 w-4 mr-1" />Reset Rankings</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
