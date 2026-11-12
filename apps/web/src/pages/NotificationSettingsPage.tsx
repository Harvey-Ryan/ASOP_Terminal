import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Check, Copy, Download, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { notificationsApi } from '@/api/notifications';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/api/client';
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

// ── Calendar feed (v1.16.0) ───────────────────────────────────────────────────

/** Your sign-ups as a calendar link that Google / Apple / Outlook subscribe to. */
function CalendarCard() {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const { data: token } = useQuery({ queryKey: ['calendar-token'], queryFn: notificationsApi.getCalendarToken, staleTime: Infinity });
  const reset = useMutation({
    mutationFn: notificationsApi.resetCalendarToken,
    onSuccess: (t) => { qc.setQueryData(['calendar-token'], t); setConfirmReset(false); setCopied(false); },
  });

  const url = token ? `${window.location.origin}/api/calendar/${token}.ics` : '';
  const webcal = url.replace(/^https?:/, 'webcal:');
  const links = [
    { label: 'Google Calendar', href: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` },
    { label: 'Apple Calendar', href: webcal },
    { label: 'Outlook', href: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent('ASOP events')}` },
  ];

  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the field can still be selected */ }
  }

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <CalendarDays className="h-4 w-4" aria-hidden />Calendar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Add the events you sign up for to your own calendar, with your role. It keeps itself up to date as you join, leave or
          change roles; calendar apps check for changes every few hours.
        </p>
        <div className="flex gap-2">
          <input readOnly aria-label="Your calendar link" value={url} onFocus={(e) => e.target.select()}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-xs" />
          <Button size="sm" variant="outline" className="h-9 shrink-0" disabled={!url} onClick={copy}>
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            <span className="ml-1.5">{copied ? 'Copied' : 'Copy'}</span>
          </Button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">Add to:</span>
          {links.map((l) => (
            <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="text-primary hover:underline">{l.label}</a>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="flex-1">Anyone with this link can see the events you signed up for. If you shared it by mistake, reset it; the old link stops working.</span>
          {confirmReset ? (
            <>
              <Button size="sm" variant="destructive" className="h-7" disabled={reset.isPending} onClick={() => reset.mutate()}>Reset link</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setConfirmReset(false)}>Keep it</Button>
            </>
          ) : (
            <Button size="sm" variant="outline" className="h-7" disabled={!url} onClick={() => setConfirmReset(true)}>Reset link</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Your data (v1.31.0) ───────────────────────────────────────────────────────

function YourDataCard() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState('');
  const del = useMutation({
    meta: { quietErrors: true }, // shows its own error
    mutationFn: () => notificationsApi.deleteMyData(typed),
    onSuccess: () => { qc.clear(); window.location.href = '/login?deleted=1'; },
  });
  const username = user?.username ?? '';
  const matches = typed.trim().toLowerCase() === username.toLowerCase() && !!username;

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="h-4 w-4" aria-hidden />Your data
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Download everything ASOP holds about you, from every server you&apos;re in: sign-ups, loot, DKP, bids, listings and
          trades, fleet, tournaments, jobs and settings.
        </p>
        <Button asChild size="sm" variant="outline">
          <a href={notificationsApi.myDataUrl} download>
            <Download className="mr-1.5 h-4 w-4" aria-hidden />Download my data
          </a>
        </Button>

        <div className="space-y-2 border-t border-border pt-3">
          {!deleting ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1 text-xs text-muted-foreground">Delete your data and sign out everywhere. This can&apos;t be undone.</span>
              <Button size="sm" variant="outline" className="h-7 text-red-400 hover:text-red-300" onClick={() => setDeleting(true)}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />Delete my data…
              </Button>
            </div>
          ) : (
            <div className="space-y-2 rounded-md border border-red-500/40 bg-red-500/5 p-3 text-sm">
              <p className="font-medium">Delete your data?</p>
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                <li><span className="text-foreground">Removed:</span> your sign-in, sign-ups and waitlist places for events still to come (the next person waiting gets your slot), draft queues, fleet, map pin, listings nobody traded on, comments, settings and calendar link.</li>
                <li><span className="text-foreground">Kept as &ldquo;Deleted member&rdquo;:</span> things other people&apos;s records rely on: loot already handed out, DKP history, past attendance, auction results, trades with other people, tournaments and jobs.</li>
                <li><span className="text-foreground">Not changed:</span> messages the bot already posted in Discord, and activity counted by RoleCall.</li>
              </ul>
              <p className="text-xs text-muted-foreground">Signing in again later starts you from scratch. Download your data first if you want a copy.</p>
              <label className="block text-xs">
                Type your Discord username, <span className="font-mono text-foreground">{username}</span>, to confirm
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false}
                  className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm" />
              </label>
              {del.isError && (
                <p role="alert" className="text-xs text-red-400">
                  {del.error instanceof ApiError ? del.error.message : 'Something went wrong. Nothing was deleted.'}
                </p>
              )}
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" disabled={!matches || del.isPending} onClick={() => del.mutate()}>
                  {del.isPending ? 'Deleting…' : 'Delete everything'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setDeleting(false); setTyped(''); del.reset(); }}>Keep my data</Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
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
    meta: { quietErrors: true }, // shows its own error
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
          Control which events trigger a Discord DM from the bot, sync your events to your calendar, and download or delete your data. Changes take effect immediately.
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

          <CalendarCard />

          <YourDataCard />

          {updateMut.isError && (
            <p className="text-sm text-destructive">Failed to save. Please try again.</p>
          )}
        </div>
      )}
    </div>
  );
}
