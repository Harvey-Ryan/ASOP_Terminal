import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { exchangeApi } from '@/api/exchange';

const CONFIRM_PHRASE = 'Wipe Inventories';

export function ExchangeSettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();

  const [phase, setPhase] = useState<'idle' | 'typing' | 'confirming'>('idle');
  const [input, setInput] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const wipeMutation = useMutation({
    mutationFn: () => exchangeApi.wipeInventories(guildId!),
    onSuccess: (data) => {
      setResult(`Done — ${data.deleted} entr${data.deleted === 1 ? 'y' : 'ies'} removed.`);
      setPhase('idle');
      setInput('');
    },
    onError: (err: Error) => {
      setResult(`Error: ${err.message}`);
      setPhase('idle');
      setInput('');
    },
  });

  if (!guildId) return null;

  function startWipe() {
    setPhase('typing');
    setInput('');
    setResult(null);
  }

  function cancel() {
    setPhase('idle');
    setInput('');
  }

  const phraseMatches = input === CONFIRM_PHRASE;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Exchange Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage the guild's Exchange module.
        </p>
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

            {result && (
              <p className="text-xs text-muted-foreground">{result}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
