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

type WikeloForm = Pick<GuildSettingsData, 'wikeloEnabled'>;

export function WikeloSettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const { data: saved, isLoading } = useQuery({
    queryKey: ['settings', guildId],
    queryFn: () => settingsApi.getSettings(guildId!),
    enabled: !!guildId,
  });

  const [form, setForm] = useState<WikeloForm>({ wikeloEnabled: true });
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (saved) {
      setForm({ wikeloEnabled: saved.wikeloEnabled ?? true });
      setDirty(false);
    }
  }, [saved]);

  const mutation = useMutation({
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

  function setField<K extends keyof WikeloForm>(key: K, value: WikeloForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setSavedFlash(false);
  }

  if (!guildId) return null;

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Wikelo Module</h1>
        <p className="mt-1 text-muted-foreground">Wikelo's missions, their rewards and what to turn in, with a checklist for each member.</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-lg" />
        </div>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-4">
              <ToggleSwitch
                checked={form.wikeloEnabled}
                onChange={(v) => setField('wikeloEnabled', v)}
                label="Wikelo enabled"
                description={form.wikeloEnabled
                  ? 'Members can look up Wikelo\'s missions and keep their own checklists.'
                  : 'Wikelo is off. The nav link is hidden and /wikelo answers that it isn\'t available here.'}
                tooltip="Controls whether the Wikelo page and /wikelo are available in this server. Members' checklists are kept either way."
              />
            </CardContent>
          </Card>

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
