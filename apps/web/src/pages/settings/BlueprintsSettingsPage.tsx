import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Construction } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsApi } from '@/api/settings';
import type { GuildSettingsData } from '@/api/settings';
import { ToggleSwitch } from '@/components/settings/SettingsControls';

type BlueprintsForm = Pick<GuildSettingsData, 'blueprintsEnabled'>;

export function BlueprintsSettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const { data: saved, isLoading } = useQuery({
    queryKey: ['settings', guildId],
    queryFn: () => settingsApi.getSettings(guildId!),
    enabled: !!guildId,
  });

  const [form, setForm] = useState<BlueprintsForm>({ blueprintsEnabled: true });
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (saved) {
      setForm({ blueprintsEnabled: saved.blueprintsEnabled ?? true });
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

  function setField<K extends keyof BlueprintsForm>(key: K, value: BlueprintsForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setSavedFlash(false);
  }

  if (!guildId) return null;

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Blueprints Module</h1>
        <p className="mt-1 text-muted-foreground">Configure the Star Citizen blueprints browser.</p>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm">
        <Construction className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium text-yellow-500">Under Construction</p>
          <p className="text-muted-foreground">
            The Blueprints browser is functional for browsing and searching SC crafting data.
            Additional features like personal watchlists and material cost tracking are planned.
          </p>
        </div>
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
                checked={form.blueprintsEnabled}
                onChange={(v) => setField('blueprintsEnabled', v)}
                label="Blueprints enabled"
                description={form.blueprintsEnabled
                  ? 'Members can browse and search SC blueprints.'
                  : 'Blueprints is disabled. The Blueprints nav link will be hidden for all members.'}
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
