import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { notificationsApi } from '@/api/notifications';
import { cn } from '@/lib/utils';
import type { UserNotificationPrefsDto } from '@dem/shared';

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function PrefRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function NotificationSettingsPage() {
  const qc = useQueryClient();

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['notification-prefs'],
    queryFn: notificationsApi.getPrefs,
    staleTime: 5 * 60_000,
  });

  const updateMut = useMutation({
    mutationFn: notificationsApi.updatePrefs,
    onSuccess: (updated) => {
      qc.setQueryData(['notification-prefs'], updated);
    },
  });

  function toggle(key: keyof UserNotificationPrefsDto) {
    if (!prefs) return;
    updateMut.mutate({ [key]: !prefs[key] });
  }

  const busy = updateMut.isPending;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Notification Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Control which events trigger a Discord DM from the bot. Changes take effect immediately.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
        </div>
      )}

      {prefs && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Marketplace
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border pt-0">
              <PrefRow
                label="Trade request received"
                description="DM when a buyer requests to purchase one of your listings."
                checked={prefs.dmTradeRequest}
                onChange={() => toggle('dmTradeRequest')}
                disabled={busy}
              />
              <PrefRow
                label="Trade accepted or declined"
                description="DM when the seller responds to your trade request."
                checked={prefs.dmTradeStatus}
                onChange={() => toggle('dmTradeStatus')}
                disabled={busy}
              />
              <PrefRow
                label="Trade cancelled"
                description="DM when the other party cancels an active trade."
                checked={prefs.dmTradeCancelled}
                onChange={() => toggle('dmTradeCancelled')}
                disabled={busy}
              />
              <PrefRow
                label="New negotiation message"
                description="DM when you receive a message in a trade negotiation (at most once per hour per trade)."
                checked={prefs.dmTradeMessage}
                onChange={() => toggle('dmTradeMessage')}
                disabled={busy}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Events
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border pt-0">
              <PrefRow
                label="15-minute event reminder"
                description="DM shortly before an event you've RSVP'd to begins, if you're not already in a voice channel."
                checked={prefs.dmEventReminder}
                onChange={() => toggle('dmEventReminder')}
                disabled={busy}
              />
              <PrefRow
                label="Loot session complete"
                description="DM with your loot summary when a session you participated in is completed."
                checked={prefs.dmLootComplete}
                onChange={() => toggle('dmLootComplete')}
                disabled={busy}
              />
            </CardContent>
          </Card>

          {updateMut.isError && (
            <p className="text-sm text-destructive">Failed to save. Please try again.</p>
          )}
        </div>
      )}
    </div>
  );
}
