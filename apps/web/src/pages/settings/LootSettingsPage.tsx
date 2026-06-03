import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsApi } from '@/api/settings';
import type { GuildSettingsData } from '@/api/settings';
import { ChannelSelect, ToggleSwitch, RolePicker } from '@/components/settings/SettingsControls';

const LOOT_METHODS = [
  { value: 'RANDOM_ROLL', label: '🎲 Random Roll — items are distributed by dice roll' },
  { value: 'DKP',         label: '🪙 DKP Auction — members bid using their DKP balance' },
  { value: 'SNAKE_DRAFT', label: '🐍 Snake Draft — turn-based draft in a snake order' },
];

type LootForm = Pick<
  GuildSettingsData,
  | 'lootEnabled'
  | 'lootChannelId'
  | 'lootDefaultMethod'
  | 'lootDraftCreatorRoles'
>;

export function LootSettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

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

  const { data: saved, isLoading: settingsLoading } = useQuery({
    queryKey: ['settings', guildId],
    queryFn: () => settingsApi.getSettings(guildId!),
    enabled: !!guildId,
  });

  const [form, setForm] = useState<LootForm>({
    lootEnabled:          true,
    lootChannelId:        null,
    lootDefaultMethod:    'RANDOM_ROLL',
    lootDraftCreatorRoles: [],
  });
  const [dirty, setDirty]           = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (saved) {
      setForm({
        lootEnabled:           saved.lootEnabled           ?? true,
        lootChannelId:         saved.lootChannelId         ?? null,
        lootDefaultMethod:     saved.lootDefaultMethod     ?? 'RANDOM_ROLL',
        lootDraftCreatorRoles: saved.lootDraftCreatorRoles ?? [],
      });
      setDirty(false);
    }
  }, [saved]);

  const mutation = useMutation({
    mutationFn: (data: Partial<GuildSettingsData>) => settingsApi.updateSettings(guildId!, data),
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(['settings', guildId], data);
      queryClient.invalidateQueries({ queryKey: ['my-permissions', guildId] });
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    },
  });

  function setField<K extends keyof LootForm>(key: K, value: LootForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setSavedFlash(false);
  }

  const channels    = channelData?.channels ?? [];
  const textChannels = channels.filter((c) => [0, 4, 5].includes(c.type));
  const roles       = rolesData ?? [];
  const isLoading   = channelsLoading || settingsLoading || rolesLoading;

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Loot Module</h1>
        <p className="mt-1 text-muted-foreground">Configure loot distribution defaults and access control.</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
        </div>
      ) : (
        <div className="space-y-6">

          {/* Module toggle */}
          <Card>
            <CardContent className="pt-4">
              <ToggleSwitch
                checked={form.lootEnabled}
                onChange={(v) => setField('lootEnabled', v)}
                label="Loot Module enabled"
                description={form.lootEnabled
                  ? 'Members can create and participate in loot sessions.'
                  : 'Loot is disabled. The Loot nav link will be hidden for all members.'}
              />
            </CardContent>
          </Card>

          {/* Results channel */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Results Channel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                When a loot session is completed, the bot posts a summary to this channel. Leave unset to skip posting.
              </p>
              <ChannelSelect
                id="lootChannel"
                channels={textChannels}
                value={form.lootChannelId}
                onChange={(v) => setField('lootChannelId', v)}
                types={[0, 5]}
              />
            </CardContent>
          </Card>

          {/* Default method */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Default Distribution Method</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Pre-selected method when a new standalone session is created.
              </p>
              <select
                value={form.lootDefaultMethod}
                onChange={(e) => setField('lootDefaultMethod', e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {LOOT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </CardContent>
          </Card>

          {/* Session creator roles */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Session Creators</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  Server admins can always create loot sessions. Select roles below to restrict session creation to specific roles. If no roles are selected, any member can create a session.
                </span>
              </div>
              {roles.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No assignable roles found in this server.</p>
              ) : (
                <RolePicker
                  roles={roles}
                  selected={form.lootDraftCreatorRoles}
                  onChange={(ids) => setField('lootDraftCreatorRoles', ids)}
                />
              )}
            </CardContent>
          </Card>

          {/* Save */}
          <div className="flex items-center gap-3">
            <Button onClick={() => mutation.mutate(form)} disabled={!dirty || mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
            {savedFlash && (
              <span className="flex items-center gap-1.5 text-sm text-green-500">
                <Check className="h-4 w-4" /> Saved
              </span>
            )}
            {mutation.isError && (
              <span className="text-sm text-destructive">Failed to save.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
