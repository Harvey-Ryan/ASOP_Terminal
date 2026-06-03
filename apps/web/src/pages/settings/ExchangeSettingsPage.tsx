import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsApi } from '@/api/settings';
import type { GuildSettingsData } from '@/api/settings';
import { ToggleSwitch } from '@/components/settings/SettingsControls';
import { inventoryApi } from '@/api/marketplace';

type ExchangeForm = Pick<GuildSettingsData, 'exchangeEnabled'>;

const CONFIRM_PHRASE = 'Wipe Inventories';

export function ExchangeSettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const { data: saved, isLoading: settingsLoading } = useQuery({
    queryKey: ['settings', guildId],
    queryFn: () => settingsApi.getSettings(guildId!),
    enabled: !!guildId,
  });

  const [form, setForm] = useState<ExchangeForm>({ exchangeEnabled: true });
  const [dirty, setDirty]           = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (saved) {
      setForm({ exchangeEnabled: saved.exchangeEnabled ?? true });
      setDirty(false);
    }
  }, [saved]);

  const settingsMutation = useMutation({
    mutationFn: (data: Partial<GuildSettingsData>) => settingsApi.updateSettings(guildId!, data),
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(['settings', guildId], data);
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    },
  });

  function setField<K extends keyof ExchangeForm>(key: K, value: ExchangeForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setSavedFlash(false);
  }

  // Wipe state
  const [phase, setPhase] = useState<'idle' | 'typing' | 'confirming'>('idle');
  const [input, setInput] = useState('');
  const [wipeResult, setWipeResult] = useState<string | null>(null);

  const wipeMutation = useMutation({
    mutationFn: () => inventoryApi.wipeInventories(guildId!),
    onSuccess: (data) => {
      setWipeResult(`Done — ${data.deleted} entr${data.deleted === 1 ? 'y' : 'ies'} removed.`);
      setPhase('idle');
      setInput('');
    },
    onError: (err: Error) => {
      setWipeResult(`Error: ${err.message}`);
      setPhase('idle');
      setInput('');
    },
  });

  if (!guildId) return null;

  function startWipe() { setPhase('typing'); setInput(''); setWipeResult(null); }
  function cancel()    { setPhase('idle'); setInput(''); }

  const phraseMatches = input === CONFIRM_PHRASE;

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Marketplace Module</h1>
        <p className="mt-1 text-muted-foreground">Configure the cross-guild marketplace and member inventory.</p>
      </div>

      {settingsLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-lg" />
        </div>
      ) : (
        <div className="space-y-6">

          {/* Module toggle */}
          <Card>
            <CardContent className="pt-4">
              <ToggleSwitch
                checked={form.exchangeEnabled}
                onChange={(v) => setField('exchangeEnabled', v)}
                label="Marketplace enabled"
                description={form.exchangeEnabled
                  ? 'Members can manage their inventory and list items for sale on the cross-guild marketplace.'
                  : 'Marketplace is disabled. The nav link will be hidden for all members.'}
              />
            </CardContent>
          </Card>

          {/* Save */}
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

          {/* Danger zone */}
          <Card className="border-destructive/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-destructive">
                <Trash2 className="h-4 w-4" />
                Danger Zone
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 space-y-3">
                <div>
                  <p className="text-sm font-medium">Wipe All Inventories</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Permanently deletes every member's inventory entries for this server. This cannot be undone.
                  </p>
                </div>

                {phase === 'idle' && (
                  <Button variant="destructive" size="sm" onClick={startWipe}>
                    Wipe Inventories
                  </Button>
                )}

                {phase === 'typing' && (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Type <span className="font-mono font-semibold text-foreground">{CONFIRM_PHRASE}</span> to continue.
                    </p>
                    <input
                      autoFocus
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={CONFIRM_PHRASE}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={!phraseMatches}
                        onClick={() => setPhase('confirming')}
                      >
                        Continue
                      </Button>
                      <Button variant="ghost" size="sm" onClick={cancel}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {phase === 'confirming' && (
                  <div className="space-y-3 rounded-md border border-destructive/50 bg-destructive/10 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <p className="text-sm font-medium text-destructive">
                        Last chance — this will permanently delete all inventory data for every member in this server.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={wipeMutation.isPending}
                        onClick={() => wipeMutation.mutate()}
                      >
                        {wipeMutation.isPending ? 'Wiping…' : 'Yes, Wipe Everything'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={cancel} disabled={wipeMutation.isPending}>
                        Abort
                      </Button>
                    </div>
                  </div>
                )}

                {wipeResult && (
                  <p className="text-xs text-muted-foreground">{wipeResult}</p>
                )}
              </div>
            </CardContent>
          </Card>

        </div>
      )}
    </div>
  );
}
