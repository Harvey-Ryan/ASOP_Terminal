import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsApi } from '@/api/settings';
import type { DiscordChannel } from '@/api/settings';

// Discord channel type constants
const CH_TYPE: Record<number, string> = {
  0:  '#',
  2:  '🔊',
  4:  '📁',
  5:  '📢',
  13: '🎭',
  15: '📋',
  16: '🖼️',
};

function channelLabel(ch: DiscordChannel): string {
  const prefix = CH_TYPE[ch.type] ?? '·';
  return `${prefix}  ${ch.name}`;
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
        <option key={ch.id} value={ch.id}>{channelLabel(ch)}</option>
      ))}
      {categories.map((cat) => {
        const children = childrenOf(cat.id);
        return (
          <optgroup key={cat.id} label={`📁  ${cat.name}`}>
            <option value={cat.id}>{channelLabel(cat)}</option>
            {children.map((ch) => (
              <option key={ch.id} value={ch.id}>{channelLabel(ch)}</option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

export function DkpSettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const { data: channelData, isLoading: channelsLoading } = useQuery({
    queryKey: ['channels', guildId],
    queryFn: () => settingsApi.getChannels(guildId!),
    enabled: !!guildId,
  });

  const { data: saved, isLoading: settingsLoading } = useQuery({
    queryKey: ['settings', guildId],
    queryFn: () => settingsApi.getSettings(guildId!),
    enabled: !!guildId,
  });

  const [announcementChannelId, setAnnouncementChannelId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (saved) {
      setAnnouncementChannelId(saved.dkpAnnouncementChannelId ?? null);
      setDirty(false);
    }
  }, [saved]);

  const mutation = useMutation({
    mutationFn: () =>
      settingsApi.updateSettings(guildId!, { dkpAnnouncementChannelId: announcementChannelId }),
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(['settings', guildId], data);
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    },
  });

  const channels = channelData?.channels ?? [];
  const textChannels = channels.filter((c) => c.type === 0 || c.type === 5 || c.type === 4);
  const isLoading = channelsLoading || settingsLoading;

  return (
    <div className="space-y-8 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">DKP Module</h1>
        <p className="mt-1 text-muted-foreground">Configure auction announcements and currency settings.</p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            <div>
              <label htmlFor="announcement-channel" className="text-sm font-medium">
                Auction Announcement Channel
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                When a standalone auction starts, the bot posts and updates the live bid embed in this channel.
              </p>
            </div>
            <ChannelSelect
              id="announcement-channel"
              channels={textChannels}
              value={announcementChannelId}
              onChange={(v) => { setAnnouncementChannelId(v); setDirty(true); setSavedFlash(false); }}
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={() => mutation.mutate()}
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
