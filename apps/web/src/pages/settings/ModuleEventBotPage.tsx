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

const TIMEZONES = [
  { value: 'UTC',                               label: 'UTC' },
  { value: 'America/New_York',                  label: 'Eastern — New York' },
  { value: 'America/Chicago',                   label: 'Central — Chicago' },
  { value: 'America/Denver',                    label: 'Mountain — Denver' },
  { value: 'America/Los_Angeles',               label: 'Pacific — Los Angeles' },
  { value: 'America/Phoenix',                   label: 'Arizona — Phoenix' },
  { value: 'America/Anchorage',                 label: 'Alaska — Anchorage' },
  { value: 'Pacific/Honolulu',                  label: 'Hawaii — Honolulu' },
  { value: 'America/Toronto',                   label: 'Eastern Canada — Toronto' },
  { value: 'America/Vancouver',                 label: 'Pacific Canada — Vancouver' },
  { value: 'America/Mexico_City',               label: 'Mexico City' },
  { value: 'America/Bogota',                    label: 'Colombia — Bogotá' },
  { value: 'America/Lima',                      label: 'Peru — Lima' },
  { value: 'America/Santiago',                  label: 'Chile — Santiago' },
  { value: 'America/Sao_Paulo',                 label: 'Brazil — São Paulo' },
  { value: 'America/Argentina/Buenos_Aires',    label: 'Argentina — Buenos Aires' },
  { value: 'Atlantic/Reykjavik',                label: 'Iceland — Reykjavik' },
  { value: 'Europe/London',                     label: 'UK — London' },
  { value: 'Europe/Dublin',                     label: 'Ireland — Dublin' },
  { value: 'Europe/Lisbon',                     label: 'Portugal — Lisbon' },
  { value: 'Europe/Paris',                      label: 'France — Paris' },
  { value: 'Europe/Berlin',                     label: 'Germany — Berlin' },
  { value: 'Europe/Madrid',                     label: 'Spain — Madrid' },
  { value: 'Europe/Rome',                       label: 'Italy — Rome' },
  { value: 'Europe/Amsterdam',                  label: 'Netherlands — Amsterdam' },
  { value: 'Europe/Brussels',                   label: 'Belgium — Brussels' },
  { value: 'Europe/Warsaw',                     label: 'Poland — Warsaw' },
  { value: 'Europe/Prague',                     label: 'Czech Republic — Prague' },
  { value: 'Europe/Vienna',                     label: 'Austria — Vienna' },
  { value: 'Europe/Stockholm',                  label: 'Sweden — Stockholm' },
  { value: 'Europe/Oslo',                       label: 'Norway — Oslo' },
  { value: 'Europe/Copenhagen',                 label: 'Denmark — Copenhagen' },
  { value: 'Europe/Helsinki',                   label: 'Finland — Helsinki' },
  { value: 'Europe/Athens',                     label: 'Greece — Athens' },
  { value: 'Europe/Bucharest',                  label: 'Romania — Bucharest' },
  { value: 'Europe/Sofia',                      label: 'Bulgaria — Sofia' },
  { value: 'Europe/Istanbul',                   label: 'Turkey — Istanbul' },
  { value: 'Europe/Moscow',                     label: 'Russia — Moscow' },
  { value: 'Asia/Jerusalem',                    label: 'Israel — Jerusalem' },
  { value: 'Asia/Riyadh',                       label: 'Saudi Arabia — Riyadh' },
  { value: 'Asia/Dubai',                        label: 'UAE — Dubai' },
  { value: 'Asia/Karachi',                      label: 'Pakistan — Karachi' },
  { value: 'Asia/Kolkata',                      label: 'India — Kolkata' },
  { value: 'Asia/Dhaka',                        label: 'Bangladesh — Dhaka' },
  { value: 'Asia/Bangkok',                      label: 'Thailand — Bangkok' },
  { value: 'Asia/Singapore',                    label: 'Singapore' },
  { value: 'Asia/Hong_Kong',                    label: 'Hong Kong' },
  { value: 'Asia/Shanghai',                     label: 'China — Shanghai' },
  { value: 'Asia/Tokyo',                        label: 'Japan — Tokyo' },
  { value: 'Asia/Seoul',                        label: 'South Korea — Seoul' },
  { value: 'Australia/Perth',                   label: 'Australia — Perth' },
  { value: 'Australia/Brisbane',                label: 'Australia — Brisbane' },
  { value: 'Australia/Sydney',                  label: 'Australia — Sydney' },
  { value: 'Pacific/Auckland',                  label: 'New Zealand — Auckland' },
];

type EventBotForm = Pick<
  GuildSettingsData,
  | 'eventBotEnabled'
  | 'forumChannelId'
  | 'eventChannelId'
  | 'voiceCategoryId'
  | 'timezone'
  | 'eventCreatorRoles'
>;

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

  const [form, setForm] = useState<EventBotForm>({
    eventBotEnabled: true,
    forumChannelId: null,
    eventChannelId: null,
    voiceCategoryId: null,
    timezone: 'UTC',
    eventCreatorRoles: [],
  });
  const [dirty, setDirty]           = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (saved) {
      setForm({
        eventBotEnabled:   saved.eventBotEnabled   ?? true,
        forumChannelId:    saved.forumChannelId    ?? null,
        eventChannelId:    saved.eventChannelId    ?? null,
        voiceCategoryId:   saved.voiceCategoryId   ?? null,
        timezone:          saved.timezone          ?? 'UTC',
        eventCreatorRoles: saved.eventCreatorRoles ?? [],
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

  function setField<K extends keyof EventBotForm>(key: K, value: EventBotForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setSavedFlash(false);
  }

  const channels  = channelData?.channels ?? [];
  const roles     = rolesData ?? [];
  const isLoading = channelsLoading || settingsLoading || rolesLoading;
  const textChannels     = channels.filter((c) => [0, 4, 5].includes(c.type));
  const categoryChannels = channels.filter((c) => c.type === 4);

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Event Bot</h1>
        <p className="mt-1 text-muted-foreground">Configure channel routing and permissions for the Event Bot module.</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
        </div>
      ) : (
        <div className="space-y-6">

          {/* Module toggle */}
          <Card>
            <CardContent className="pt-4">
              <ToggleSwitch
                checked={form.eventBotEnabled}
                onChange={(v) => setField('eventBotEnabled', v)}
                label="Event Bot enabled"
                description={form.eventBotEnabled
                  ? 'Members can create and view events.'
                  : 'Event Bot is disabled. The Events nav link will be hidden for all members.'}
              />
            </CardContent>
          </Card>

          {/* Channels */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Channel Routing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="forumChannel">Forum Channel</label>
                <p className="text-xs text-muted-foreground">
                  Where the bot posts event threads and roster embeds. Must be a Forum channel.
                </p>
                <ChannelSelect
                  id="forumChannel"
                  channels={channels}
                  value={form.forumChannelId}
                  onChange={(v) => setField('forumChannelId', v)}
                  types={[15]}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="eventChannel">Scheduled Events Channel</label>
                <p className="text-xs text-muted-foreground">
                  Text or announcement channel where the bot creates Discord Scheduled Events.
                </p>
                <ChannelSelect
                  id="eventChannel"
                  channels={textChannels}
                  value={form.eventChannelId}
                  onChange={(v) => setField('eventChannelId', v)}
                  types={[0, 5]}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="vcCategory">Voice Channel Category</label>
                <p className="text-xs text-muted-foreground">
                  Category where the bot auto-creates event voice channels 30 minutes before start.
                </p>
                <ChannelSelect
                  id="vcCategory"
                  channels={categoryChannels}
                  value={form.voiceCategoryId}
                  onChange={(v) => setField('voiceCategoryId', v)}
                  types={[4]}
                />
              </div>
            </CardContent>
          </Card>

          {/* Timezone */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Timezone</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                All event times are displayed in this timezone across the bot and dashboard.
              </p>
              <select
                value={form.timezone}
                onChange={(e) => setField('timezone', e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </CardContent>
          </Card>

          {/* Event Creator Roles */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Event Creators</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  Server admins can always create events. If no roles are selected, only admins can create events.
                </span>
              </div>
              {roles.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No assignable roles found in this server.</p>
              ) : (
                <RolePicker
                  roles={roles}
                  selected={form.eventCreatorRoles}
                  onChange={(ids) => setField('eventCreatorRoles', ids)}
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
