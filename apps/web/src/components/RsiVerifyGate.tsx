import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Copy, Check, AlertCircle, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { rsiApi } from '@/api/rsi';
import { cn } from '@/lib/utils';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={copy}
      className={cn(
        'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
        copied
          ? 'bg-green-500/20 text-green-500'
          : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function RsiVerifyGate({ guildId, children }: { guildId: string; children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [handle, setHandle] = useState('');
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ['rsi-verify-status', guildId],
    queryFn: () => rsiApi.getVerifyStatus(guildId),
    staleTime: 30_000,
  });

  const startMutation = useMutation({
    mutationFn: () => rsiApi.startVerify(guildId, handle),
    onSuccess: (data) => {
      queryClient.setQueryData(['rsi-verify-status', guildId], data);
      setVerifyError(null);
    },
    onError: (err: Error) => setVerifyError(err.message),
  });

  const completeMutation = useMutation({
    mutationFn: () => rsiApi.completeVerify(guildId),
    onSuccess: (data) => {
      queryClient.setQueryData(['rsi-verify-status', guildId], data);
      // Invalidate my-permissions so the layout re-checks
      queryClient.invalidateQueries({ queryKey: ['my-permissions', guildId] });
      setVerifyError(null);
    },
    onError: (err: Error) => setVerifyError(err.message),
  });

  // Not required, or already verified — render children normally
  if (isLoading) return <>{children}</>;
  if (!status?.orgRequired || status.verified) return <>{children}</>;

  const token = status.token;
  const hasHandle = !!status.handle;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="rounded-full bg-primary/10 p-4">
              <ShieldCheck className="h-8 w-8 text-primary" />
            </div>
          </div>
          <h2 className="text-xl font-bold tracking-tight">RSI Verification Required</h2>
          <p className="text-sm text-muted-foreground">
            This server requires you to verify your RSI citizen account before accessing the dashboard.
          </p>
        </div>

        {/* Step 1 — enter handle */}
        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
            <p className="text-sm font-medium">Enter your RSI citizen handle</p>
          </div>
          <div className="flex gap-2">
            <input
              value={handle || status.handle || ''}
              onChange={(e) => setHandle(e.target.value.trim())}
              onKeyDown={(e) => { if (e.key === 'Enter' && (handle || status.handle)) startMutation.mutate(); }}
              placeholder="e.g. Destrokk"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            <Button
              size="sm"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending || !(handle || status.handle)}
            >
              {startMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Get Token'}
            </Button>
          </div>
          {hasHandle && !token && (
            <p className="text-xs text-muted-foreground">Handle: <span className="font-mono font-medium text-foreground">{status.handle}</span></p>
          )}
        </div>

        {/* Step 2 — paste token in bio */}
        {token && (
          <div className="rounded-lg border border-border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
              <p className="text-sm font-medium">Paste this token anywhere in your RSI bio</p>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
              <code className="flex-1 text-sm font-mono break-all select-all">{token}</code>
              <CopyButton text={token} />
            </div>
            <p className="text-xs text-muted-foreground">
              Go to{' '}
              <a
                href="https://robertsspaceindustries.com/account/profile"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                RSI Account → Profile <ExternalLink className="h-3 w-3" />
              </a>
              , add the token to your <strong>Bio</strong> field, and save. You can remove it after verifying.
            </p>
          </div>
        )}

        {/* Step 3 — verify */}
        {token && (
          <div className="rounded-lg border border-border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
              <p className="text-sm font-medium">Click Verify once your bio is saved</p>
            </div>
            <Button
              className="w-full"
              onClick={() => completeMutation.mutate()}
              disabled={completeMutation.isPending}
            >
              {completeMutation.isPending ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Checking RSI…</>
              ) : (
                <><ShieldCheck className="h-4 w-4 mr-2" /> Verify My Account</>
              )}
            </Button>
          </div>
        )}

        {/* Error */}
        {verifyError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <span className="text-destructive">{verifyError}</span>
          </div>
        )}
      </div>
    </div>
  );
}
