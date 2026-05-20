import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsApi } from '@/api/settings';
import type { DiscordChannel, GuildSettingsData } from '@/api/settings';
import type { DiscordRoleDto } from '@dem/shared';

// Discord channel type constants
const CH_TYPE: Record<number, string> = {
  0:  '#',   // GUILD_TEXT
  2:  '🔊',  // GUILD_VOICE
  4:  '📁',  // GUILD_CATEGORY
  5:  '📢',  // GUILD_ANNOUNCEMENT
  13: '🎭',  // GUILD_STAGE_VOICE
  15: '📋',  // GUILD_FORUM
  16: '🖼️', // GUILD_MEDIA
};

function channelLabel(ch: DiscordChannel): string {
  const prefix = CH_TYPE[ch.type] ?? '·';
  return `${prefix}  ${ch.name}`;
}

function roleColorCss(color: number): string {
  if (color === 0) return '#99aab5';
  return `#${color.toString(16).padStart(6, '0')}`;
}

function ChannelSelect({
  id,
  channels,
  value,
  onChange,
}: {
  id: string;
  channels: DiscordChannel[];
  value: string | null;
  onChange: (val: string | null) => void;
}) {
  const categories = channels.filter((c) => c.type === 4);
  const uncategorised = channels.filter((c) => c.type !== 4 && !c.parent_id);
  const childrenOf = (catId: string) => channels.filter((c) => c.parent_id === catId);

  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <option value="">— Not set —</option>

      {uncategorised.map((ch) => (
        <option key={ch.id} value={ch.id}>
          {channelLabel(ch)}
        </option>
      ))}

      {categories.map((cat) => {
        const children = childrenOf(cat.id);
        return (
          <optgroup key={cat.id} label={`📁  ${cat.name}`}>
            <option value={cat.id}>{channelLabel(cat)}</option>
            {children.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {channelLabel(ch)}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

export function ModuleEventBotPage() {
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

  const [form, setForm] = useState<Pick<GuildSettingsData, 'forumChannelId' | 'voiceCategoryId' | 'eventCreatorRoles'>>({
    forumChannelId: null,
    voiceCategoryId: null,
    eventCreatorRoles: [],
  });
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (saved) {
      setForm({
        forumChannelId: saved.forumChannelId,
        voiceCategoryId: saved.voiceCategoryId,
        eventCreatorRoles: saved.eventCreatorRoles ?? [],
      });
      setDirty(false);
    }
  }, [saved]);

  const mutation = useMutation({
    mutationFn: (data: Partial<GuildSettingsData>) => settingsApi.updateSettings(guildId!, data),
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(['settings', guildId], data);
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    },
  });

  type EventBotForm = Pick<GuildSettingsData, 'forumChannelId' | 'voiceCategoryId' | 'eventCreatorRoles'>;
  function setField<K extends keyof EventBotForm>(key: K, value: EventBotForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setSavedFlash(false);
  }

  function addCreatorRole(roleId: string) {
    setForm((f) => ({ ...f, eventCreatorRoles: [...(f.eventCreatorRoles ?? []), roleId] }));
    setDirty(true); setSavedFlash(false);
  }
  function removeCreatorRole(roleId: string) {
    setForm((f) => ({ ...f, eventCreatorRoles: (f.eventCreatorRoles ?? []).filter((id) => id !== roleId) }));
    setDirty(true); setSavedFlash(false);
  }

  const channels = channelData?.channels ?? [];
  const roles = rolesData ?? [];
  const selectedCreatorIds = form.eventCreatorRoles ?? [];
  const unselectedCreatorRoles = roles.filter((r) => !selectedCreatorIds.includes(r.id));
  const isLoading = channelsLoading || settingsLoading || rolesLoading;

  return (
    <div className="space-y-8 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Event Bot</h1>
        <p className="mt-1 text-muted-foreground">Configure channel routing and permissions for the Event Bot module.</p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Forum Channel */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="forumChannel">
              Forum Channel
            </label>
            <p className="text-xs text-muted-foreground">
              Where the bot posts event threads and roster embeds. Must be a Forum channel.
            </p>
            <ChannelSelect
              id="forumChannel"
              channels={channels}
              value={form.forumChannelId}
              onChange={(v) => setField('forumChannelId', v)}
            />
          </div>

          {/* VC Category */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="vcCategory">
              Voice Channel Category
            </label>
            <p className="text-xs text-muted-foreground">
              Category where the bot creates event voice channels.
            </p>
            <ChannelSelect
              id="vcCategory"
              channels={channels}
              value={form.voiceCategoryId}
              onChange={(v) => setField('voiceCategoryId', v)}
            />
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Event Creators */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Event Creators</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Roles allowed to create events in addition to server admins.
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Server admins can always create events. If no roles are selected, only admins can create events.
              </span>
            </div>

            {roles.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No assignable roles found in this server.</p>
            ) : (
              <div className="space-y-2">
                {selectedCreatorIds.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedCreatorIds.map((roleId) => {
                      const role = roles.find((r: DiscordRoleDto) => r.id === roleId);
                      if (!role) return null;
                      return (
                        <span key={roleId} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm font-medium">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: roleColorCss(role.color) }} />
                          {role.name}
                          <button type="button" onClick={() => removeCreatorRole(roleId)} className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors" aria-label={`Remove ${role.name}`}>
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                {unselectedCreatorRoles.length > 0 ? (
                  <select value="" onChange={(e) => { if (e.target.value) addCreatorRole(e.target.value); }} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="">Add a role…</option>
                    {unselectedCreatorRoles.map((role: DiscordRoleDto) => <option key={role.id} value={role.id}>{role.name}</option>)}
                  </select>
                ) : selectedCreatorIds.length > 0 ? (
                  <p className="text-xs text-muted-foreground italic">All roles have been added.</p>
                ) : null}
              </div>
            )}
          </div>

          {/* Save */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={() => mutation.mutate(form)}
              disabled={!dirty || mutation.isPending}
            >
              {mutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
            {savedFlash && (
              <span className="flex items-center gap-1.5 text-sm text-green-500">
                <Check className="h-4 w-4" />
                Saved
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
