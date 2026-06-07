import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsApi } from '@/api/settings';
import type { GuildSettingsData } from '@/api/settings';
import { ChannelSelect, ToggleSwitch, SettingTooltip } from '@/components/settings/SettingsControls';

type DkpForm = Pick<
  GuildSettingsData,
  | 'dkpEnabled'
  | 'dkpLabel'
  | 'dkpAnnouncementChannelId'
  | 'dkpDefaultAuctionDuration'
  | 'dkpMinBid'
>;

const inputCls = 'rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

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

  const [form, setForm] = useState<DkpForm>({
    dkpEnabled:               true,
    dkpLabel:                 'DKP',
    dkpAnnouncementChannelId: null,
    dkpDefaultAuctionDuration: 24,
    dkpMinBid:                0,
  });
  const [dirty, setDirty]           = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (saved) {
      setForm({
        dkpEnabled:                saved.dkpEnabled               ?? true,
        dkpLabel:                  saved.dkpLabel                 ?? 'DKP',
        dkpAnnouncementChannelId:  saved.dkpAnnouncementChannelId ?? null,
        dkpDefaultAuctionDuration: saved.dkpDefaultAuctionDuration ?? 24,
        dkpMinBid:                 saved.dkpMinBid                ?? 0,
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

  function setField<K extends keyof DkpForm>(key: K, value: DkpForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setSavedFlash(false);
  }

  const channels    = channelData?.channels ?? [];
  const textChannels = channels.filter((c) => [0, 4, 5].includes(c.type));
  const isLoading   = channelsLoading || settingsLoading;

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">DKP Module</h1>
        <p className="mt-1 text-muted-foreground">Configure currency, auctions, and announcement settings.</p>
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
                checked={form.dkpEnabled}
                onChange={(v) => setField('dkpEnabled', v)}
                label="DKP Module enabled"
                description={form.dkpEnabled
                  ? 'Members can view the leaderboard and participate in auctions.'
                  : 'DKP and Auctions are disabled. Both nav links will be hidden.'}
                tooltip="Controls whether DKP (points tracking) and Auctions are active for this server. When disabled, both nav links are hidden and DKP attendance awards from loot sessions are skipped."
              />
            </CardContent>
          </Card>

          {/* Currency */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Currency</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <label className="text-sm font-medium" htmlFor="dkpLabel">Currency Label</label>
                <SettingTooltip content='The name of your points currency shown throughout the dashboard, bot messages, and DM notifications. Change this to match your org\'s terminology — e.g. "Credits", "Points", or "Merits". Max 30 characters.' />
              </div>
              <p className="text-xs text-muted-foreground">
                The name shown throughout the UI and bot messages, e.g. "Credits" or "Points".
              </p>
              <input
                id="dkpLabel"
                type="text"
                maxLength={30}
                value={form.dkpLabel}
                onChange={(e) => setField('dkpLabel', e.target.value)}
                className={`w-full ${inputCls}`}
                placeholder="DKP"
              />
            </CardContent>
          </Card>

          {/* Auctions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Auction Defaults</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <label className="text-sm font-medium" htmlFor="auctionChannel">Announcement Channel</label>
                  <SettingTooltip content="The Discord channel where the bot posts a live bid embed when a standalone auction starts. The embed updates in real time as bids are placed. Leave unset to disable standalone auction announcements in Discord." />
                </div>
                <p className="text-xs text-muted-foreground">
                  When an auction starts, the bot posts a live bid embed in this channel.
                </p>
                <ChannelSelect
                  id="auctionChannel"
                  channels={textChannels}
                  value={form.dkpAnnouncementChannelId}
                  onChange={(v) => setField('dkpAnnouncementChannelId', v)}
                  types={[0, 5]}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <label className="text-sm font-medium" htmlFor="auctionDuration">Default Auction Duration</label>
                  <SettingTooltip content="The pre-filled duration in hours when creating a new standalone auction. Individual auctions can override this value at creation time. Must be between 1 and 168 hours (7 days)." />
                </div>
                <p className="text-xs text-muted-foreground">
                  Hours a new standalone auction runs before closing (1–168).
                </p>
                <div className="flex items-center gap-2">
                  <input
                    id="auctionDuration"
                    type="number"
                    min={1}
                    max={168}
                    value={form.dkpDefaultAuctionDuration}
                    onChange={(e) => {
                      const v = Math.min(168, Math.max(1, parseInt(e.target.value, 10) || 1));
                      setField('dkpDefaultAuctionDuration', v);
                    }}
                    className={`w-20 text-center ${inputCls}`}
                  />
                  <span className="text-sm text-muted-foreground">hours</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <label className="text-sm font-medium" htmlFor="minBid">Minimum Bid</label>
                  <SettingTooltip content={`The lowest bid amount accepted in any auction for this server. Set to 0 for no minimum. Members attempting to bid below this value will be rejected by the bot. Applies to both standalone auctions and loot ${form.dkpLabel || 'DKP'} Bid sessions.`} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Smallest valid bid amount in {form.dkpLabel || 'DKP'}. Set to 0 for no minimum.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    id="minBid"
                    type="number"
                    min={0}
                    value={form.dkpMinBid}
                    onChange={(e) => {
                      const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                      setField('dkpMinBid', v);
                    }}
                    className={`w-24 text-center ${inputCls}`}
                  />
                  <span className="text-sm text-muted-foreground">{form.dkpLabel || 'DKP'}</span>
                </div>
              </div>
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
