import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsApi } from '@/api/settings';
import type { GuildSettingsData } from '@/api/settings';
import { ToggleSwitch, SettingTooltip } from '@/components/settings/SettingsControls';

type FleetForm = Pick<GuildSettingsData, 'fleetEnabled'>;

export function FleetSettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const { data: saved, isLoading: settingsLoading } = useQuery({
    queryKey: ['settings', guildId],
    queryFn: () => settingsApi.getSettings(guildId!),
    enabled: !!guildId,
  });

  const [form, setForm] = useState<FleetForm>({ fleetEnabled: true });
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (saved) {
      setForm({ fleetEnabled: saved.fleetEnabled ?? true });
      setDirty(false);
    }
  }, [saved]);

  const settingsMutation = useMutation({
    meta: { quietErrors: true }, // shows its own error
    mutationFn: (data: Partial<GuildSettingsData>) => settingsApi.updateSettings(guildId!, data),
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(['settings', guildId], data);
      queryClient.invalidateQueries({ queryKey: ['my-permissions', guildId] });
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    },
  });

  function setField<K extends keyof FleetForm>(key: K, value: FleetForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setSavedFlash(false);
  }

  if (!guildId) return null;

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Fleet Module</h1>
        <p className="mt-1 text-muted-foreground">
          Members keep one fleet each, with <code>/fleet add</code> in Discord or on the Fleet page, and it shows in every ASOP
          server they&apos;re in. Officers see the server&apos;s fleet by role and who has which ship.
        </p>
      </div>

      {settingsLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-lg" />
        </div>
      ) : (
        <div className="space-y-6">

          <Card>
            <CardContent className="pt-4">
              <ToggleSwitch
                checked={form.fleetEnabled}
                onChange={(v) => setField('fleetEnabled', v)}
                label="Fleet enabled"
                description={form.fleetEnabled
                  ? 'Members can see the server\'s fleet and who has which ship.'
                  : 'The Fleet page and /fleet search are off in this server. Members\' own fleets are kept.'}
                tooltip="Fleets belong to each member and show in every ASOP server they're in, so switching this off only hides this server's fleet view; nobody's ships are deleted."
              />
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={() => settingsMutation.mutate(form)} disabled={!dirty || settingsMutation.isPending}>
              {settingsMutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
            {savedFlash && (
              <span className="flex items-center gap-1.5 text-sm text-green-500">
                <Check className="h-4 w-4" /> Saved
              </span>
            )}
            {settingsMutation.isError && (
              <span className="text-sm text-destructive">Failed to save.</span>
            )}
          </div>


        </div>
      )}
    </div>
  );
}
