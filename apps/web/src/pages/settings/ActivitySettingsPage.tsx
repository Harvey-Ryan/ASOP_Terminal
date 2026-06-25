import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { settingsApi } from '@/api/settings';
import { roleCallApi } from '@/api/rolecall';
import type { RcConfig, RcRoleChangeRow } from '@/api/rolecall';
import { ChannelSelect, ToggleSwitch, RolePicker } from '@/components/settings/SettingsControls';
import type { GuildSettingsData } from '@/api/settings';

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`;
}

function FieldLabel({ htmlFor, label, description }: { htmlFor?: string; label: string; description?: string }) {
  return (
    <div className="space-y-0.5">
      <label className="text-sm font-medium" htmlFor={htmlFor}>{label}</label>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RoleChangeRow({ row }: { row: RcRoleChangeRow }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <Avatar className="h-8 w-8 shrink-0 mt-0.5">
        <AvatarImage src={row.avatar} alt={row.displayName} />
        <AvatarFallback className="text-xs">{row.displayName[0]?.toUpperCase() ?? '?'}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{row.displayName}</p>
        <p className="text-xs text-muted-foreground capitalize">{row.change_type.replace(/_/g, ' ')}</p>
        {row.reason && <p className="text-xs text-muted-foreground mt-0.5">{row.reason}</p>}
      </div>
      <span className="text-xs text-muted-foreground shrink-0">{timeAgo(row.changed_at)}</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ActivitySettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  // ── ASOP Terminal settings ────────────────────────────────────────────────
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

  const { data: rolesData, isLoading: rolesLoading } = useQuery({
    queryKey: ['roles', guildId],
    queryFn: () => settingsApi.getRoles(guildId!),
    enabled: !!guildId,
  });

  const [enabled, setEnabled] = useState(true);
  const [enabledDirty, setEnabledDirty] = useState(false);
  const [enabledFlash, setEnabledFlash] = useState(false);

  useEffect(() => {
    if (saved) {
      setEnabled(saved.activityEnabled ?? true);
      setEnabledDirty(false);
    }
  }, [saved]);

  const enabledMutation = useMutation({
    mutationFn: (data: Partial<GuildSettingsData>) => settingsApi.updateSettings(guildId!, data),
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(['settings', guildId], data);
      queryClient.invalidateQueries({ queryKey: ['my-permissions', guildId] });
      setEnabledDirty(false);
      setEnabledFlash(true);
      setTimeout(() => setEnabledFlash(false), 2500);
    },
  });

  // ── RoleCallBot config ────────────────────────────────────────────────────
  const { data: rcConfig, isLoading: rcLoading } = useQuery({
    queryKey: ['rolecall-config', guildId],
    queryFn: () => roleCallApi.getConfig(guildId!),
    enabled: !!guildId,
    retry: false,
  });

  type RcForm = {
    inactivity_days: number;
    active_role_id: string | null;
    inactive_role_id: string | null;
    achievements_channel_id: string | null;
    leaderboard_channel_id: string | null;
    leaderboard_schedule: 'daily' | 'weekly';
    message_weight: number;
    voice_weight: number;
  };

  const [rcForm, setRcForm] = useState<RcForm>({
    inactivity_days: 30,
    active_role_id: null,
    inactive_role_id: null,
    achievements_channel_id: null,
    leaderboard_channel_id: null,
    leaderboard_schedule: 'weekly',
    message_weight: 1,
    voice_weight: 2,
  });
  const [rcDirty, setRcDirty] = useState(false);
  const [rcFlash, setRcFlash] = useState(false);

  useEffect(() => {
    if (rcConfig) {
      setRcForm({
        inactivity_days:         rcConfig.inactivity_days,
        active_role_id:          rcConfig.active_role_id,
        inactive_role_id:        rcConfig.inactive_role_id,
        achievements_channel_id: rcConfig.achievements_channel_id,
        leaderboard_channel_id:  rcConfig.leaderboard_channel_id,
        leaderboard_schedule:    rcConfig.leaderboard_schedule,
        message_weight:          Number(rcConfig.message_weight),
        voice_weight:            Number(rcConfig.voice_weight),
      });
      setRcDirty(false);
    }
  }, [rcConfig]);

  function setRcField<K extends keyof RcForm>(key: K, value: RcForm[K]) {
    setRcForm((f) => ({ ...f, [key]: value }));
    setRcDirty(true);
  }

  const rcMutation = useMutation({
    mutationFn: (data: Partial<Omit<RcConfig, 'guild_id'>>) =>
      roleCallApi.updateConfig(guildId!, data),
    onSuccess: (data) => {
      queryClient.setQueryData(['rolecall-config', guildId], data);
      setRcDirty(false);
      setRcFlash(true);
      setTimeout(() => setRcFlash(false), 2500);
    },
  });

  // ── Role change log ───────────────────────────────────────────────────────
  const [logPage, setLogPage] = useState(1);
  const { data: log, isLoading: logLoading, isError: logError } = useQuery({
    queryKey: ['rolecall-role-change-log', guildId, logPage],
    queryFn: () => roleCallApi.getRoleChangeLog(guildId!, logPage),
    enabled: !!guildId,
    retry: false,
  });

  const channels = channelData?.channels ?? [];
  // Include text (0) and announcement/news (5) channels
  const textChannels = channels.filter((c) => c.type === 0 || c.type === 5);
  const roles = rolesData ?? [];
  const loading = settingsLoading || channelsLoading || rolesLoading;

  return (
    <div className="space-y-6">
      {/* ── Enable/disable ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Activity Module</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? <Skeleton className="h-8 w-full" /> : (
            <ToggleSwitch
              label="Enable Activity"
              description="Show the Activity page in the sidebar and allow members to view leaderboards and stats."
              checked={enabled}
              onChange={(v) => { setEnabled(v); setEnabledDirty(true); }}
            />
          )}
          {enabledDirty && (
            <Button
              size="sm"
              onClick={() => enabledMutation.mutate({ activityEnabled: enabled })}
              disabled={enabledMutation.isPending}
            >
              {enabledFlash ? <><Check className="h-4 w-4 mr-1" />Saved</> : 'Save'}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── RoleCallBot config ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">RoleCallBot Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {rcLoading && <Skeleton className="h-48 w-full" />}

          {!rcLoading && !rcConfig && (
            <p className="text-sm text-muted-foreground">
              RoleCallBot service unavailable. Check that <code>ROLECALL_API_URL</code> is configured.
            </p>
          )}

          {rcConfig && (
            <>
              {/* Inactivity threshold */}
              <div className="space-y-1.5">
                <FieldLabel
                  htmlFor="inactivity-days"
                  label="Inactivity Threshold (days)"
                  description="Members inactive for this many days are marked inactive and have roles updated."
                />
                <input
                  id="inactivity-days"
                  type="number"
                  min={1}
                  max={365}
                  value={rcForm.inactivity_days}
                  onChange={(e) => setRcField('inactivity_days', Math.min(365, Math.max(1, Number(e.target.value))))}
                  className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Roles */}
              {rolesLoading ? <Skeleton className="h-10 w-full" /> : (
                <>
                  <div className="space-y-1.5">
                    <FieldLabel
                      label="Active Role"
                      description="Role assigned to members who are actively participating."
                    />
                    <RolePicker
                      roles={roles}
                      selected={rcForm.active_role_id ? [rcForm.active_role_id] : []}
                      onChange={([id]) => setRcField('active_role_id', id ?? null)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel
                      label="Inactive Role"
                      description="Role assigned to members who have been marked inactive."
                    />
                    <RolePicker
                      roles={roles}
                      selected={rcForm.inactive_role_id ? [rcForm.inactive_role_id] : []}
                      onChange={([id]) => setRcField('inactive_role_id', id ?? null)}
                    />
                  </div>
                </>
              )}

              {/* Channels */}
              {channelsLoading ? <Skeleton className="h-10 w-full" /> : (
                <>
                  <div className="space-y-1.5">
                    <FieldLabel
                      htmlFor="achievements-channel"
                      label="Achievements Channel"
                      description="Channel where achievement unlock notifications are posted."
                    />
                    <ChannelSelect
                      id="achievements-channel"
                      channels={channels}
                      value={rcForm.achievements_channel_id}
                      onChange={(v) => setRcField('achievements_channel_id', v)}
                      types={[0, 5]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel
                      htmlFor="leaderboard-channel"
                      label="Leaderboard Channel"
                      description="Channel where the leaderboard is automatically posted on schedule."
                    />
                    <ChannelSelect
                      id="leaderboard-channel"
                      channels={channels}
                      value={rcForm.leaderboard_channel_id}
                      onChange={(v) => setRcField('leaderboard_channel_id', v)}
                      types={[0, 5]}
                    />
                  </div>
                </>
              )}

              {/* Leaderboard schedule */}
              <div className="space-y-1.5">
                <FieldLabel
                  label="Leaderboard Schedule"
                  description="How often the leaderboard auto-posts to the configured channel."
                />
                <div className="flex gap-2">
                  {(['daily', 'weekly'] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setRcField('leaderboard_schedule', opt)}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                        rcForm.leaderboard_schedule === opt
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-input hover:bg-accent'
                      }`}
                    >
                      {opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Score weights */}
              <div className="space-y-3">
                <FieldLabel
                  label="Score Weights"
                  description="Points per message and per voice minute used to calculate member scores."
                />
                <div className="flex gap-6">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide" htmlFor="msg-weight">Message</label>
                    <input
                      id="msg-weight"
                      type="number"
                      min={0}
                      step={0.1}
                      value={rcForm.message_weight}
                      onChange={(e) => setRcField('message_weight', Math.max(0, Number(e.target.value)))}
                      className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide" htmlFor="voice-weight">Voice (per min)</label>
                    <input
                      id="voice-weight"
                      type="number"
                      min={0}
                      step={0.1}
                      value={rcForm.voice_weight}
                      onChange={(e) => setRcField('voice_weight', Math.max(0, Number(e.target.value)))}
                      className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              </div>

              {/* Save */}
              <div className="flex items-center gap-3 pt-1">
                <Button
                  size="sm"
                  onClick={() => rcMutation.mutate(rcForm)}
                  disabled={!rcDirty || rcMutation.isPending}
                >
                  {rcFlash ? <><Check className="h-4 w-4 mr-1" />Saved</> : 'Save RoleCallBot Settings'}
                </Button>
                {rcMutation.isError && (
                  <p className="text-xs text-destructive">Failed to save — check RoleCallBot service.</p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Role change log ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Role Change Log
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {logLoading && (
            <div className="space-y-2 py-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          )}

          {logError && (
            <p className="py-4 text-sm text-muted-foreground text-center">
              Could not load role change log.
            </p>
          )}

          {log && log.rows.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground text-center">No role changes recorded yet.</p>
          )}

          {log?.rows.map((row) => <RoleChangeRow key={row.id} row={row} />)}

          {log && log.totalPages > 1 && (
            <div className="flex items-center justify-between pt-3">
              <Button variant="ghost" size="sm" onClick={() => setLogPage((p) => Math.max(1, p - 1))} disabled={logPage === 1}>
                <ChevronLeft className="h-4 w-4" />Prev
              </Button>
              <span className="text-xs text-muted-foreground">Page {log.page} of {log.totalPages}</span>
              <Button variant="ghost" size="sm" onClick={() => setLogPage((p) => Math.min(log.totalPages, p + 1))} disabled={logPage === log.totalPages}>
                Next<ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
