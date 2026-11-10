import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Copy, Handshake, RefreshCw, Search, Send, Server, UserMinus, X } from 'lucide-react';
import type { AllyGuildDto, AlliesOverviewDto, AllyDirectoryEntryDto } from '@dem/shared';
import { ALLY_MESSAGE_MAX, formatAllyCode, getGuildIconUrl } from '@dem/shared';
import { alliesApi } from '@/api/allies';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ChannelSelect, RolePicker, ToggleSwitch } from '@/components/settings/SettingsControls';
import { settingsApi } from '@/api/settings';
import { useAuth } from '@/hooks/useAuth';
import { canManageGuild } from '@dem/shared';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';

// Settings → Allies: the org's ally list. One org asks another to be allies;
// the other accepts or rejects. Event sharing moves onto this list in v2.0.0.

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const errorText = (err: unknown) => (err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong. Try again.');

function OrgIcon({ guild, size = 'h-9 w-9' }: { guild: AllyGuildDto; size?: string }) {
  const url = getGuildIconUrl(guild.guildId, guild.icon, 64);
  return url
    ? <img src={url} alt="" className={cn(size, 'shrink-0 rounded-full object-cover bg-muted')} />
    : <div className={cn(size, 'shrink-0 rounded-full bg-muted flex items-center justify-center')}><Server className="h-4 w-4 text-muted-foreground" /></div>;
}

function OrgName({ guild, sub }: { guild: AllyGuildDto; sub?: React.ReactNode }) {
  const tags = [guild.allianceTag, guild.rsiOrgTag && guild.rsiOrgTag !== guild.allianceTag ? guild.rsiOrgTag : null].filter(Boolean);
  return (
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium break-words">
        {guild.name}
        {tags.map((t) => <span key={t} className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground align-middle">{t}</span>)}
      </p>
      {sub && <div className="text-xs text-muted-foreground break-words">{sub}</div>}
    </div>
  );
}

/** A button that asks "Sure?" inline before doing something hard to undo (no browser dialogs). */
function ConfirmButton({ label, confirmLabel, icon, onConfirm, disabled, variant = 'outline' }: {
  label: string; confirmLabel: string; icon?: React.ReactNode; onConfirm: () => void; disabled?: boolean;
  variant?: 'outline' | 'ghost';
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return <Button size="sm" variant={variant} disabled={disabled} onClick={() => setAsking(true)}>{icon}{label}</Button>;
  }
  return (
    <span className="flex items-center gap-1">
      <Button size="sm" variant="destructive" disabled={disabled} onClick={() => { setAsking(false); onConfirm(); }}>{confirmLabel}</Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Keep</Button>
    </span>
  );
}

function Section({ title, count, children, action }: { title: string; count?: number; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          {title}
          {count != null && count > 0 && <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">{count}</span>}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

const Row = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center gap-3 py-3 border-b border-border last:border-0">{children}</div>
);
const Empty = ({ children }: { children: React.ReactNode }) => <p className="py-2 text-sm text-muted-foreground">{children}</p>;

// ── Add an ally ──────────────────────────────────────────────────────────────

function AddAlly({ guildId, onDone }: { guildId: string; onDone: (msg: string) => void }) {
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounce(query.trim(), 300);

  const directory = useQuery({
    queryKey: ['allies-directory', guildId, debounced],
    queryFn: () => alliesApi.directory(guildId, debounced),
    enabled: debounced.length >= 2,
  });

  const send = useMutation({
    mutationFn: (target: { targetGuildId?: string; code?: string }) =>
      alliesApi.sendRequest(guildId, { ...target, ...(message.trim() ? { message: message.trim() } : {}) }),
    onSuccess: (r) => {
      setError(null); setCode(''); setMessage(''); setQuery('');
      onDone(r.outcome === 'accepted'
        ? `${r.guild.name} had already asked you, so you're now allies.`
        : `Request sent to ${r.guild.name}.`);
    },
    onError: (err) => setError(errorText(err)),
  });

  const results: AllyDirectoryEntryDto[] = debounced.length >= 2 ? (directory.data ?? []) : [];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="ally-search" className="text-sm font-medium">Find an org</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            id="ally-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or tag of an org listed in the ally directory"
            className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {debounced.length >= 2 && !directory.isFetching && results.length === 0 && (
          <p className="text-xs text-muted-foreground">No listed org matches. Orgs that aren't listed can only be added with their ally code.</p>
        )}
        {results.length > 0 && (
          <div className="rounded-md border border-border px-3">
            {results.map((r) => (
              <Row key={r.guild.guildId}>
                <OrgIcon guild={r.guild} size="h-7 w-7" />
                <OrgName guild={r.guild} sub={r.reason ?? undefined} />
                <Button size="sm" disabled={!r.requestable || send.isPending} onClick={() => send.mutate({ targetGuildId: r.guild.guildId })}>
                  <Send className="h-3.5 w-3.5 mr-1.5" />Send request
                </Button>
              </Row>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="ally-code" className="text-sm font-medium">Or use an ally code</label>
        <div className="flex flex-wrap gap-2">
          <input
            id="ally-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD-EFGH"
            maxLength={11}
            className="w-40 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono tracking-wider outline-none focus:ring-1 focus:ring-ring"
          />
          <Button variant="outline" disabled={code.replace(/[\s-]/g, '').length !== 8 || send.isPending} onClick={() => send.mutate({ code })}>
            <Send className="h-3.5 w-3.5 mr-1.5" />Send request
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Every org has a private code under "Your listing". Ask their officers for it.</p>
      </div>

      <div className="space-y-2">
        <label htmlFor="ally-message" className="text-sm font-medium">Message <span className="font-normal text-muted-foreground">(optional, sent with the request)</span></label>
        <input
          id="ally-message"
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, ALLY_MESSAGE_MAX))}
          placeholder="e.g. Let's run the Saturday mining ops together"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

// ── Ally settings (org tag, notices channel, who manages allies) ──────────────────────────────

function AllySettings({ guildId, isGuildManager, onSaved, onError }: {
  guildId: string; isGuildManager: boolean; onSaved: (msg: string) => void; onError: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings', guildId], queryFn: () => settingsApi.getSettings(guildId), retry: false });
  const roles = useQuery({ queryKey: ['roles', guildId], queryFn: () => settingsApi.getRoles(guildId), enabled: isGuildManager, retry: false });
  const channels = useQuery({ queryKey: ['channels', guildId], queryFn: () => settingsApi.getChannels(guildId), enabled: settings.isSuccess, retry: false });
  const [tag, setTag] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (data: Parameters<typeof settingsApi.updateSettings>[1]) => settingsApi.updateSettings(guildId, data),
    onSuccess: (_r, data) => {
      void queryClient.invalidateQueries({ queryKey: ['settings', guildId] });
      void queryClient.invalidateQueries({ queryKey: ['allies', guildId] });
      onSaved('allianceTag' in data ? 'Org tag saved.' : 'allyNoticeChannelId' in data ? 'Ally notices channel saved.' : 'Ally managers saved.');
      setTag(null);
    },
    onError: (err) => onError(errorText(err)),
  });

  // Officers who can manage allies but not edit settings just don't see this card.
  if (settings.isError) return null;
  if (!settings.data) return <Skeleton className="h-24 rounded-lg" />;

  const current = settings.data.allianceTag ?? '';
  const draft = tag ?? current;
  const validTag = /^[A-Za-z0-9]{0,4}$/.test(draft);

  return (
    <Section title="Ally settings">
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="ally-tag" className="text-sm font-medium">Org tag</label>
          <div className="flex gap-2">
            <input
              id="ally-tag"
              value={draft}
              onChange={(e) => setTag(e.target.value.toUpperCase())}
              maxLength={4}
              placeholder="ASOP"
              className="w-28 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono tracking-wider uppercase outline-none focus:ring-1 focus:ring-ring"
            />
            <Button variant="outline" disabled={draft === current || !validTag || save.isPending}
              onClick={() => save.mutate({ allianceTag: draft || null })}>Save</Button>
          </div>
          <p className={cn('text-xs', validTag ? 'text-muted-foreground' : 'text-destructive')}>
            {validTag ? 'Up to 4 letters or numbers. Shown next to your name in the ally directory and on shared events, and other orgs can search for it.' : 'Use up to 4 letters or numbers.'}
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="ally-notice-channel" className="text-sm font-medium">Ally notices channel</label>
          <p className="text-xs text-muted-foreground">
            The bot posts new ally requests here with Accept, Reject and Block buttons, and tells you when another org answers yours or ends an alliance.
            Pick an officers-only channel: anyone who can manage allies can use the buttons. Leave unset to use this page only.
          </p>
          {channels.data
            ? <ChannelSelect id="ally-notice-channel" channels={channels.data.channels} types={[0, 5]}
                value={settings.data.allyNoticeChannelId} onChange={(v) => save.mutate({ allyNoticeChannelId: v })} />
            : channels.isError
              ? <p className="text-xs text-destructive">Couldn't load your channels. Reload the page to try again.</p>
              : <Skeleton className="h-9 rounded-md" />}
          {settings.data.allyNoticeChannelId && (
            <p className="text-xs text-muted-foreground">The bot needs View Channel, Send Messages and Embed Links there.</p>
          )}
        </div>

        {isGuildManager && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Who can manage allies</p>
            <p className="text-xs text-muted-foreground">Server managers always can. Add roles to let other officers send and answer ally requests.</p>
            {roles.data
              ? <RolePicker roles={roles.data} selected={settings.data.allianceManagerRoles} onChange={(ids) => save.mutate({ allianceManagerRoles: ids })} />
              : <Skeleton className="h-9 rounded-md" />}
          </div>
        )}
      </div>
    </Section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function AlliesPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();
  const { guilds } = useAuth();
  const thisGuild = guilds.find((g) => g.id === guildId);
  const isGuildManager = !!thisGuild && canManageGuild(thisGuild);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const key = ['allies', guildId] as const;
  const overview = useQuery({
    queryKey: key,
    queryFn: () => alliesApi.overview(guildId!),
    enabled: !!guildId,
    retry: (n, err) => !(err instanceof ApiError && (err.status === 403 || err.status === 404)) && n < 2,
  });

  /** Runs an action, then refreshes the page and the nav badge. */
  const act = useMutation({
    mutationFn: async ({ run }: { run: () => Promise<unknown>; done: string }) => run(),
    onSuccess: (_r, { done }) => setNotice({ kind: 'ok', text: done }),
    onError: (err) => setNotice({ kind: 'error', text: errorText(err) }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ['allies-pending', guildId] });
      void queryClient.invalidateQueries({ queryKey: ['allies-directory', guildId] });
    },
  });
  const run = (fn: () => Promise<unknown>, done: string) => act.mutate({ run: fn, done });
  const busy = act.isPending;

  const header = (
    <div>
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Handshake className="h-6 w-6" />Allies</h1>
      <p className="mt-1 text-muted-foreground">
        Orgs on ASOP Terminal can become allies: one sends a request and the other accepts or rejects it.
        Event sharing will move onto your ally list in an upcoming update.
      </p>
    </div>
  );

  if (overview.isLoading) {
    return <div className="space-y-6 max-w-3xl">{header}<Skeleton className="h-24 rounded-lg" /><Skeleton className="h-40 rounded-lg" /></div>;
  }
  if (overview.isError || !overview.data) {
    const forbidden = overview.error instanceof ApiError && overview.error.status === 403;
    return (
      <div className="space-y-6 max-w-3xl">
        {header}
        <p className="text-sm text-muted-foreground">
          {forbidden ? 'Only officers who manage allies can open this page. Ask a server manager to give your role access in Org Settings.' : errorText(overview.error)}
        </p>
      </div>
    );
  }

  const d: AlliesOverviewDto = overview.data;

  return (
    <div className="space-y-6 max-w-3xl">
      {header}

      {notice && (
        <div role="status" className={cn('flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm',
          notice.kind === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-destructive/30 bg-destructive/10 text-destructive')}>
          <span>{notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
      )}

      {d.incoming.length > 0 && (
        <Section title="Requests for you" count={d.incoming.length}>
          {d.incoming.map((r) => (
            <Row key={r.id}>
              <OrgIcon guild={r.guild} />
              <OrgName guild={r.guild} sub={<>Asked {fmtDate(r.requestedAt)}{r.message && <> · <span className="italic">"{r.message}"</span></>}</>} />
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" disabled={busy} onClick={() => run(() => alliesApi.respond(guildId!, r.id, 'accept'), `You and ${r.guild.name} are now allies.`)}>
                  <Check className="h-3.5 w-3.5 mr-1.5" />Accept
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => alliesApi.respond(guildId!, r.id, 'reject'), `Request from ${r.guild.name} rejected. They can ask again in 7 days.`)}>
                  Reject
                </Button>
                <ConfirmButton variant="ghost" label="Reject and block" confirmLabel="Block them" icon={<Ban className="h-3.5 w-3.5 mr-1.5" />} disabled={busy}
                  onConfirm={() => run(() => alliesApi.respond(guildId!, r.id, 'block'), `${r.guild.name} is blocked and can't send you requests.`)} />
              </div>
            </Row>
          ))}
        </Section>
      )}

      <Section title="Your allies" count={undefined}>
        {d.allies.length === 0
          ? <Empty>No allies yet. Find an org below, or share your ally code with one.</Empty>
          : d.allies.map((a) => (
            <Row key={a.id}>
              <OrgIcon guild={a.guild} />
              <OrgName guild={a.guild} sub={`Allies since ${fmtDate(a.since)}`} />
              <ConfirmButton label="Remove" confirmLabel={`Remove ${a.guild.name}`} icon={<UserMinus className="h-3.5 w-3.5 mr-1.5" />} disabled={busy}
                onConfirm={() => run(() => alliesApi.removeAlly(guildId!, a.id), `${a.guild.name} is no longer an ally.`)} />
            </Row>
          ))}
      </Section>

      <Section title="Add an ally">
        <AddAlly guildId={guildId!} onDone={(text) => {
          setNotice({ kind: 'ok', text });
          void queryClient.invalidateQueries({ queryKey: key });
        }} />
      </Section>

      {d.outgoing.length > 0 && (
        <Section title="Requests you sent">
          {d.outgoing.map((r) => (
            <Row key={r.id}>
              <OrgIcon guild={r.guild} />
              <OrgName guild={r.guild} sub={r.status === 'PENDING'
                ? <>Sent {fmtDate(r.requestedAt)}, waiting for an answer</>
                : <>Declined. You can ask again after {fmtDate(r.retryAfter!)}.</>} />
              {r.status === 'PENDING' && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => alliesApi.cancelRequest(guildId!, r.id), `Request to ${r.guild.name} withdrawn.`)}>
                  Cancel request
                </Button>
              )}
            </Row>
          ))}
        </Section>
      )}

      <Section title="Your listing">
        <div className="space-y-5">
          <ToggleSwitch
            checked={d.listing.listed}
            onChange={(listed) => run(() => alliesApi.setListed(guildId!, listed), listed ? 'Your org is now listed in the ally directory.' : 'Your org is no longer listed. Others can still use your ally code.')}
            label="Listed in the ally directory"
            description="Other orgs can find you by name or tag and send a request. When off, only orgs with your ally code can."
          />
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Your ally code</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md border border-border bg-muted px-3 py-1.5 font-mono text-base tracking-widest">{formatAllyCode(d.listing.code)}</code>
              <Button size="sm" variant="outline" onClick={() => {
                void navigator.clipboard?.writeText(formatAllyCode(d.listing.code)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
              }}>
                {copied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}{copied ? 'Copied' : 'Copy'}
              </Button>
              <ConfirmButton label="New code" confirmLabel="Replace code" icon={<RefreshCw className="h-3.5 w-3.5 mr-1.5" />} disabled={busy}
                onConfirm={() => run(() => alliesApi.newCode(guildId!), 'New ally code created. The old one no longer works.')} />
            </div>
            <p className="text-xs text-muted-foreground">Give this to another org's officers so they can send you a request. A new code stops the old one working.</p>
          </div>
        </div>
      </Section>

      <AllySettings guildId={guildId!} isGuildManager={isGuildManager}
        onSaved={(text) => setNotice({ kind: 'ok', text })} onError={(text) => setNotice({ kind: 'error', text })} />

      {d.blocked.length > 0 && (
        <Section title="Blocked">
          {d.blocked.map((b) => (
            <Row key={b.id}>
              <OrgIcon guild={b.guild} />
              <OrgName guild={b.guild} sub={`Blocked ${fmtDate(b.blockedAt)}. They can't send you requests.`} />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => alliesApi.unblock(guildId!, b.id), `${b.guild.name} is unblocked.`)}>
                Unblock
              </Button>
            </Row>
          ))}
        </Section>
      )}
    </div>
  );
}
