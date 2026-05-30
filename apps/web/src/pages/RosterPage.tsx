import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, RefreshCw, CheckCircle2, XCircle, Link2Off, Settings, AlertCircle, ShieldCheck, ShieldOff, MonitorDot, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fleetApi } from '@/api/fleet';
import { cn } from '@/lib/utils';
import type { RsiRosterLinkedMember, RsiRosterOrgOnlyMember, RsiRosterViewerMember, RsiRosterUnlinkedMember } from '@dem/shared';

const RANK_LABELS = ['Recruit', 'Member', 'Veteran', 'Officer', 'Commander', 'Founder'];
const RANK_COLORS = [
  'text-muted-foreground',
  'text-sky-500',
  'text-green-500',
  'text-yellow-500',
  'text-orange-500',
  'text-purple-500',
];

function RankBadge({ stars }: { stars: number | null }) {
  if (stars == null) return null;
  const label = RANK_LABELS[stars] ?? `Rank ${stars}`;
  const color = RANK_COLORS[stars] ?? 'text-muted-foreground';
  return <span className={cn('text-xs', color)}>{label}</span>;
}

function LinkedRow({ member }: { member: RsiRosterLinkedMember }) {
  const ShieldIcon = member.verified ? ShieldCheck : ShieldOff;
  const shieldCls = member.isAffiliate
    ? (member.verified ? 'text-blue-500' : 'text-blue-500/30')
    : (member.verified ? 'text-green-500' : 'text-muted-foreground/50');

  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
      {member.inOrg
        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
        : <XCircle className="h-4 w-4 shrink-0 text-yellow-500" />}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-sm font-medium truncate">{member.discordUsername}</span>
        <span className="text-xs text-muted-foreground font-mono">{member.rsiHandle}</span>
        {member.isAffiliate && (
          <span className="text-[10px] font-medium text-blue-500 bg-blue-500/10 border border-blue-500/20 rounded px-1 py-0.5 shrink-0">
            Affiliate
          </span>
        )}
      </div>
      <ShieldIcon className={`h-3.5 w-3.5 shrink-0 ${shieldCls}`} />
      <RankBadge stars={member.inOrg ? member.orgRank : null} />
      {!member.inOrg && (
        <span className="text-xs text-yellow-500/80 shrink-0">Not in org</span>
      )}
    </div>
  );
}

function ViewerRow({ member }: { member: RsiRosterViewerMember }) {
  const ShieldIcon = member.verified ? ShieldCheck : ShieldOff;
  const shieldCls = member.verified ? 'text-green-500' : 'text-muted-foreground/50';

  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
      <MonitorDot className="h-4 w-4 shrink-0 text-indigo-400" />
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-sm font-medium truncate">{member.discordUsername}</span>
        {member.rsiHandle
          ? <span className="text-xs text-muted-foreground font-mono">{member.rsiHandle}</span>
          : <span className="text-xs text-muted-foreground/50 italic">no RSI handle</span>}
      </div>
      {member.rsiHandle && <ShieldIcon className={`h-3.5 w-3.5 shrink-0 ${shieldCls}`} />}
    </div>
  );
}

function OrgOnlyRow({
  member,
  guildId,
  unlinkedMembers,
  onAssigned,
}: {
  member: RsiRosterOrgOnlyMember;
  guildId: string;
  unlinkedMembers: RsiRosterUnlinkedMember[];
  onAssigned: () => void;
}) {
  const [assigning, setAssigning] = useState(false);
  const [selectedDiscordId, setSelectedDiscordId] = useState('');

  const assignMutation = useMutation({
    mutationFn: () => fleetApi.assignRsiHandle(guildId, { rsiHandle: member.rsiHandle, discordId: selectedDiscordId }),
    onSuccess: () => { setAssigning(false); setSelectedDiscordId(''); onAssigned(); },
  });

  if (assigning) {
    return (
      <div className="flex items-center gap-2 py-2 border-b border-border/50 last:border-0">
        <UserPlus className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-sm font-mono shrink-0">{member.rsiHandle}</span>
        <span className="text-xs text-muted-foreground shrink-0">→</span>
        <select
          className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
          value={selectedDiscordId}
          onChange={(e) => setSelectedDiscordId(e.target.value)}
          autoFocus
        >
          <option value="">{unlinkedMembers.length === 0 ? 'No unlinked members available' : 'Select Discord member…'}</option>
          {unlinkedMembers.map((m) => (
            <option key={m.discordId} value={m.discordId}>{m.discordUsername}</option>
          ))}
        </select>
        <Button
          size="sm"
          className="h-7 text-xs shrink-0"
          disabled={!selectedDiscordId || assignMutation.isPending}
          onClick={() => assignMutation.mutate()}
        >
          {assignMutation.isPending ? 'Saving…' : 'Assign'}
        </Button>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground shrink-0"
          onClick={() => { setAssigning(false); setSelectedDiscordId(''); }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0 group">
      <Link2Off className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-sm font-mono text-muted-foreground">{member.rsiHandle}</span>
      <RankBadge stars={member.orgRank} />
      <button
        type="button"
        onClick={() => setAssigning(true)}
        className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
      >
        <UserPlus className="h-3 w-3" />
        Assign
      </button>
    </div>
  );
}

export function RosterPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['rsi-roster', guildId],
    queryFn: () => fleetApi.getRsiRoster(guildId!),
    enabled: !!guildId,
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!guildId) return null;

  const inOrg = data?.linked.filter((m) => m.inOrg) ?? [];
  const notInOrg = data?.linked.filter((m) => !m.inOrg) ?? [];
  const orgOnly = data?.orgOnly ?? [];
  const viewers = data?.viewers ?? [];
  const unlinkedMembers = data?.unlinkedMembers ?? [];

  function invalidateRoster() {
    queryClient.invalidateQueries({ queryKey: ['rsi-roster', guildId] });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6" />
            RSI Roster
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Cross-reference app members' RSI handles against the org roster.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn('h-4 w-4 mr-1.5', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Shield key */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground shrink-0">Shield Key</span>
        <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-green-500" /> Main member · verified</span>
        <span className="flex items-center gap-1.5"><ShieldOff className="h-3.5 w-3.5 text-muted-foreground/50" /> Main member · unverified</span>
        <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-blue-500" /> Affiliate · verified</span>
        <span className="flex items-center gap-1.5"><ShieldOff className="h-3.5 w-3.5 text-blue-500/30" /> Affiliate · unverified</span>
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      )}

      {isError && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">Failed to load roster</p>
            <p className="text-muted-foreground mt-0.5">
              {(error as Error)?.message ?? 'An error occurred fetching the RSI org roster.'}
            </p>
          </div>
        </div>
      )}

      {!isLoading && !isError && data?.orgTag === null && (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-4 py-4 text-sm">
          <Settings className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">No RSI org tag configured</p>
            <p className="text-muted-foreground mt-0.5">
              Set your org's RSI tag in{' '}
              <Link
                to={`/dashboard/servers/${guildId}/settings/modules/fleet`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Fleet Settings
              </Link>{' '}
              to enable roster sync.
            </p>
          </div>
        </div>
      )}

      {data?.orgTag && (
        <>
          {/* Summary bar */}
          <div className="flex flex-wrap items-center gap-6 rounded-lg border border-border bg-card px-4 py-3">
            <div className="text-center">
              <p className="text-xl font-bold">{data.total}</p>
              <p className="text-xs text-muted-foreground">Org Members</p>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="text-center">
              <p className="text-xl font-bold text-green-500">{inOrg.length}</p>
              <p className="text-xs text-muted-foreground">Linked &amp; In Org</p>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="text-center">
              <p className="text-xl font-bold text-yellow-500">{notInOrg.length}</p>
              <p className="text-xs text-muted-foreground">Linked, Not In Org</p>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="text-center">
              <p className="text-xl font-bold text-muted-foreground">{orgOnly.length}</p>
              <p className="text-xs text-muted-foreground">Unlinked</p>
            </div>
            {viewers.length > 0 && (
              <>
                <div className="h-8 w-px bg-border" />
                <div className="text-center">
                  <p className="text-xl font-bold text-indigo-400">{viewers.length}</p>
                  <p className="text-xs text-muted-foreground">Dashboard Only</p>
                </div>
              </>
            )}
            <div className="ml-auto font-mono text-sm text-muted-foreground bg-muted px-2 py-1 rounded">
              {data.orgTag}
            </div>
          </div>

          {/* In org */}
          {inOrg.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  In Org ({inOrg.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {inOrg
                  .sort((a, b) => (b.orgRank ?? 0) - (a.orgRank ?? 0) || a.discordUsername.localeCompare(b.discordUsername))
                  .map((m) => <LinkedRow key={m.discordId} member={m} />)}
              </CardContent>
            </Card>
          )}

          {/* Linked but not in org */}
          {notInOrg.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-yellow-500" />
                  Linked but Not in Org ({notInOrg.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {notInOrg
                  .sort((a, b) => a.discordUsername.localeCompare(b.discordUsername))
                  .map((m) => <LinkedRow key={m.discordId} member={m} />)}
              </CardContent>
            </Card>
          )}

          {/* Dashboard members not in RSI org */}
          {viewers.length > 0 && (
            <Card className="border-indigo-500/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-indigo-400">
                  <MonitorDot className="h-4 w-4" />
                  Dashboard Members, Not in Org ({viewers.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground mb-3">
                  These members have dashboard access but are not in the RSI org.
                </p>
                {viewers.map((m) => <ViewerRow key={m.discordId} member={m} />)}
              </CardContent>
            </Card>
          )}

          {/* Org members with no app link */}
          {orgOnly.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <Link2Off className="h-4 w-4" />
                  Not Linked ({orgOnly.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground mb-3">
                  These org members haven't linked their RSI handle in the app.
                </p>
                {orgOnly
                  .sort((a, b) => (b.orgRank ?? 0) - (a.orgRank ?? 0) || a.rsiHandle.localeCompare(b.rsiHandle))
                  .map((m) => (
                    <OrgOnlyRow
                      key={m.rsiHandle}
                      member={m}
                      guildId={guildId!}
                      unlinkedMembers={unlinkedMembers}
                      onAssigned={invalidateRoster}
                    />
                  ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
