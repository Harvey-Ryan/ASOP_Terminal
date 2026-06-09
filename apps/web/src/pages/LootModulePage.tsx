import { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ChevronDown, ChevronRight, Package, ExternalLink, Truck, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { lootApi } from '@/api/loot';
import { settingsApi } from '@/api/settings';
import { useAuth } from '@/hooks/useAuth';
import { canManageGuild } from '@dem/shared';
import type { LootHistorySessionDto, LootMethod, MyPickDto } from '@dem/shared';

const METHOD_LABELS: Record<LootMethod, string> = {
  RANDOM_ROLL: '🎲 Random Roll',
  DKP: '🪙 DKP',
  SNAKE_DRAFT: '🐍 Snake Draft',
  COMMODITY_DRAFT: '📦 Commodity Draft',
};

const METHOD_COLORS: Record<LootMethod, string> = {
  RANDOM_ROLL: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  DKP: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  SNAKE_DRAFT: 'bg-green-500/10 text-green-500 border-green-500/20',
  COMMODITY_DRAFT: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── History row ───────────────────────────────────────────────────────────────

function HistoryRow({ session, isManager, currentUserId }: { session: LootHistorySessionDto; isManager: boolean; currentUserId: string | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();
  const canManage = isManager || (!!session.ownerId && session.ownerId === currentUserId);

  const toggleMutation = useMutation({
    mutationFn: ({ itemIds, assignmentIds }: { itemIds: string[]; assignmentIds: string[] }) =>
      session.eventId
        ? Promise.all(itemIds.map((id) => lootApi.toggleDelivered(session.guildId, session.eventId!, id)))
        : Promise.all(assignmentIds.map((id) => lootApi.toggleDeliveredStandalone(session.guildId, session.id, id))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loot-history', session.guildId] });
      queryClient.invalidateQueries({ queryKey: ['loot', 'my-history'] });
    },
  });

  const displayName = session.eventName ?? session.name ?? 'Unnamed Session';
  const label = session.eventName ? `📅 ${displayName}` : displayName;
  const itemCount = session.items.length;
  const assignedCount = session.items.filter((i) => i.assignments.length > 0).length;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
      >
        <span className="shrink-0 text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="font-medium truncate block">{label}</span>
          <span className="text-xs text-muted-foreground">{formatDate(session.createdAt)}</span>
        </span>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${METHOD_COLORS[session.method]}`}>
          {METHOD_LABELS[session.method]}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground ml-2">
          {assignedCount}/{itemCount} items
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          {session.items.length === 0 && (
            <p className="text-sm text-muted-foreground italic">No items in this session.</p>
          )}

          {session.method === 'COMMODITY_DRAFT' ? (() => {
            // Group all assignments by participant, stack identical name+QL
            type StackedLine = { name: string; qualityLevel: number | null; count: number; pickNumber: number | null; delivered: boolean; itemIds: string[]; assignmentIds: string[] };
            type Bucket = { username: string; lines: StackedLine[] };
            const buckets = new Map<string, Bucket>();
            for (const item of session.items) {
              for (const a of item.assignments) {
                if (!buckets.has(a.userId)) buckets.set(a.userId, { username: a.username, lines: [] });
                const key = `${item.name}__${item.qualityLevel ?? ''}`;
                const existing = buckets.get(a.userId)!.lines.find((l) => `${l.name}__${l.qualityLevel ?? ''}` === key);
                if (existing) { existing.count++; existing.itemIds.push(item.id); existing.assignmentIds.push(a.id); if (!a.delivered) existing.delivered = false; }
                else { buckets.get(a.userId)!.lines.push({ name: item.name, qualityLevel: item.qualityLevel, count: 1, pickNumber: a.pickNumber, delivered: a.delivered, itemIds: [item.id], assignmentIds: [a.id] }); }
              }
            }
            return [...buckets.values()].sort((a, b) => a.username.localeCompare(b.username)).map((bucket) => (
              <div key={bucket.username} className="space-y-0.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">{bucket.username}</p>
                {bucket.lines.map((line, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm pl-2">
                    {line.delivered
                      ? <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
                      : <Package className="h-3 w-3 shrink-0 text-muted-foreground" />}
                    <span className={`flex-1 ${line.delivered ? 'line-through text-muted-foreground' : ''}`}>
                      {line.name}
                      {line.qualityLevel !== null && <span className="ml-1.5 text-xs text-muted-foreground">QL {line.qualityLevel}</span>}
                      {line.count > 1 && <span className="ml-1 text-xs text-muted-foreground">×{line.count}</span>}
                    </span>
                    {line.pickNumber !== null && <span className="text-xs text-muted-foreground shrink-0 mr-1">pick #{line.pickNumber + 1}</span>}
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => toggleMutation.mutate({ itemIds: line.itemIds, assignmentIds: line.assignmentIds })}
                        disabled={toggleMutation.isPending}
                        className={`shrink-0 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border transition-colors ${
                          line.delivered
                            ? 'border-green-500/40 bg-green-500/10 text-green-600 hover:bg-green-500/20'
                            : 'border-border text-muted-foreground hover:border-primary/50 hover:text-primary'
                        }`}
                      >
                        <Truck className="h-2.5 w-2.5" />
                        {line.delivered ? 'Delivered' : 'Deliver'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ));
          })() : (
            [...session.items]
              .sort((a, b) => {
                const wa = a.assignments[0];
                const wb = b.assignments[0];
                if (wa && wb) return wa.username.localeCompare(wb.username);
                if (wa) return -1;
                if (wb) return 1;
                return 0;
              })
              .map((item) => {
                const winner = item.assignments[0];
                return (
                  <div key={item.id} className="flex items-center gap-3 text-sm">
                    {winner?.delivered
                      ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
                      : <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <span className={`flex-1 font-medium ${winner?.delivered ? 'line-through text-muted-foreground' : ''}`}>{item.name}</span>
                    {winner ? (
                      <>
                        <span className="text-green-600 dark:text-green-400 shrink-0">
                          {winner.username}
                          {winner.rollValue != null && <span className="text-muted-foreground ml-1">(rolled {winner.rollValue})</span>}
                          {winner.dkpSpent != null && <span className="text-muted-foreground ml-1">({winner.dkpSpent} DKP)</span>}
                          {winner.pickNumber != null && <span className="text-muted-foreground ml-1">(pick #{winner.pickNumber + 1})</span>}
                        </span>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => toggleMutation.mutate({ itemIds: [item.id], assignmentIds: [winner.id] })}
                            disabled={toggleMutation.isPending}
                            className={`shrink-0 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border transition-colors ${
                              winner.delivered
                                ? 'border-green-500/40 bg-green-500/10 text-green-600 hover:bg-green-500/20'
                                : 'border-border text-muted-foreground hover:border-primary/50 hover:text-primary'
                            }`}
                          >
                            <Truck className="h-2.5 w-2.5" />
                            {winner.delivered ? 'Delivered' : 'Deliver'}
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground shrink-0 italic">Unassigned</span>
                    )}
                  </div>
                );
              })
          )}
        </div>
      )}
    </div>
  );
}

// ── New session dialog ────────────────────────────────────────────────────────

function NewSessionDialog({
  guildId,
  open,
  onClose,
  onCreated,
}: {
  guildId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (sessionId: string) => void;
}) {
  const [name, setName] = useState('');
  const [method, setMethod] = useState<LootMethod>('RANDOM_ROLL');
  const [totalRounds, setTotalRounds] = useState(1);

  const STANDALONE_METHODS: LootMethod[] = ['RANDOM_ROLL', 'SNAKE_DRAFT', 'COMMODITY_DRAFT'];

  const createMutation = useMutation({
    mutationFn: () => lootApi.createStandaloneSession(guildId, { name: name.trim(), method, ...(method === 'SNAKE_DRAFT' ? { totalRounds } : {}) }),
    onSuccess: (session) => {
      setName('');
      setMethod('RANDOM_ROLL');
      onCreated(session.id);
    },
  });

  function handleClose() {
    if (createMutation.isPending) return;
    setName('');
    setMethod('RANDOM_ROLL');
    setTotalRounds(1);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Loot Session</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Session Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) createMutation.mutate(); }}
              placeholder="e.g. Saturday Salvage Run"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Distribution Method</label>
            <div className="grid grid-cols-2 gap-2">
              {STANDALONE_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${method === m ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}
                >
                  {METHOD_LABELS[m]}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Add participants after creating the session.</p>
          </div>

          {method === 'SNAKE_DRAFT' && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Rounds</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={totalRounds}
                  onChange={(e) => setTotalRounds(Number(e.target.value))}
                  className="flex-1 accent-primary"
                />
                <span className="w-6 text-center text-sm font-semibold tabular-nums">{totalRounds}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Draft ends after {totalRounds} round{totalRounds !== 1 ? 's' : ''} or when all items are claimed.
              </p>
            </div>
          )}

          {createMutation.isError && (
            <p className="text-sm text-destructive">{(createMutation.error as Error).message}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating…' : 'Create Session'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function LootModulePage() {
  const { guildId } = useParams<{ guildId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, guilds } = useAuth();

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: 'sessions' | 'history' | 'my-loot' = tabParam === 'history' ? 'history' : tabParam === 'my-loot' ? 'my-loot' : 'sessions';
  function setTab(t: 'sessions' | 'history' | 'my-loot') { setSearchParams(t === 'sessions' ? {} : { tab: t }); }
  const [newSessionOpen, setNewSessionOpen] = useState(false);

  const isManager = guilds.some((g) => g.id === guildId);

  const permissionsQuery = useQuery({
    queryKey: ['my-permissions', guildId],
    queryFn: () => settingsApi.getMyPermissions(guildId!),
    enabled: !!guildId && !isManager,
  });
  const canCreateSession = isManager || (permissionsQuery.data?.canCreateLootDraft ?? false);

  const sessionsQuery = useQuery({
    queryKey: ['loot-sessions', guildId],
    queryFn: () => lootApi.listSessions(guildId!),
    enabled: !!guildId,
    refetchInterval: tab === 'sessions' ? 10000 : false,
  });

  const myPicksQuery = useQuery({
    queryKey: ['loot', 'my-picks'],
    queryFn: () => lootApi.getMyPicks(),
    enabled: tab === 'sessions',
    refetchInterval: tab === 'sessions' ? 10000 : false,
  });
  // Sessions in guilds the user is not a member of (participating as an allied member)
  const crossGuildPicks: MyPickDto[] = (myPicksQuery.data ?? []).filter((p) => p.guildId !== guildId);

  const historyQuery = useQuery({
    queryKey: ['loot-history', guildId],
    queryFn: () => lootApi.getHistory(guildId!),
    enabled: !!guildId && tab === 'history',
  });

  const myHistoryQuery = useQuery({
    queryKey: ['loot', 'my-history'],
    queryFn: () => lootApi.getMyHistory(),
    enabled: tab === 'my-loot',
    retry: false,
  });

  const tabCls = (active: boolean) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${active
      ? 'border-primary text-foreground'
      : 'border-transparent text-muted-foreground hover:text-foreground'}`;

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">🎁 Loot</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">Manage loot sessions independently of events.</p>
        </div>
        {canCreateSession && (
          <Button className="gap-2" onClick={() => setNewSessionOpen(true)}>
            <Plus className="h-4 w-4" />
            New Session
          </Button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border -mb-5">
        <button className={tabCls(tab === 'sessions')} onClick={() => setTab('sessions')}>
          Sessions
        </button>
        <button className={tabCls(tab === 'history')} onClick={() => setTab('history')}>
          History
        </button>
        <button className={tabCls(tab === 'my-loot')} onClick={() => setTab('my-loot')}>
          My Loot
        </button>
      </div>

      {/* Sessions tab */}
      {tab === 'sessions' && (
        <div className="space-y-3 pt-5">
          {crossGuildPicks.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Participating In</p>
              {crossGuildPicks.map((pick) => {
                const href = pick.eventId
                  ? `/dashboard/servers/${pick.guildId}/events/${pick.eventId}/loot`
                  : `/dashboard/servers/${pick.guildId}/loot/sessions/${pick.sessionId}`;
                return (
                  <div
                    key={pick.sessionId}
                    className="rounded-lg border border-border bg-card p-4 flex items-center gap-4"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">📅 {pick.eventName}</p>
                        {pick.isMyTurn && (
                          <span className="shrink-0 rounded-sm bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-500">your turn</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className={`rounded-full border px-2 py-0.5 font-medium ${METHOD_COLORS[pick.method]}`}>
                          {METHOD_LABELS[pick.method]}
                        </span>
                        <span>{pick.guildName}</span>
                        <span>{pick.itemCount} item{pick.itemCount !== 1 ? 's' : ''} remaining</span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1.5"
                      onClick={() => navigate(href)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {sessionsQuery.isLoading && (
            <>
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
            </>
          )}

          {!sessionsQuery.isLoading && sessionsQuery.data?.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-muted-foreground text-sm">No active loot sessions.</p>
                {canCreateSession && (
                  <Button variant="outline" className="mt-4 gap-2" onClick={() => setNewSessionOpen(true)}>
                    <Plus className="h-4 w-4" />
                    Start one now
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {sessionsQuery.data?.map((session) => {
            const isEventSession = !!session.eventId;
            const baseName = session.eventName ?? session.name ?? 'Unnamed Session';
            const displayName = session.eventName ? `📅 ${baseName}` : baseName;
            const participantCount = session.participants.length;
            const itemCount = session.items.length;
            const assignedCount = session.items.filter((i) => i.assignments.length > 0).length;
            const href = isEventSession
              ? `/dashboard/servers/${guildId}/events/${session.eventId}/loot`
              : `/dashboard/servers/${guildId}/loot/sessions/${session.id}`;

            return (
              <div
                key={session.id}
                className="rounded-lg border border-border bg-card p-4 flex items-center gap-4"
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{displayName}</p>
                    {isEventSession && (
                      <span className="shrink-0 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">event</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    <span className={`rounded-full border px-2 py-0.5 font-medium ${METHOD_COLORS[session.method]}`}>
                      {METHOD_LABELS[session.method]}
                    </span>
                    <span>{participantCount} participant{participantCount !== 1 ? 's' : ''}</span>
                    <span>{assignedCount}/{itemCount} items assigned</span>
                    <span>{formatDate(session.createdAt)}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5"
                  onClick={() => navigate(href)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </Button>
              </div>
            );
          })}

        </div>
      )}

      {/* History tab */}
      {tab === 'history' && (
        <div className="space-y-3 pt-5">
          {historyQuery.isLoading && (
            <>
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
            </>
          )}

          {!historyQuery.isLoading && historyQuery.data?.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-muted-foreground text-sm">No completed loot sessions yet.</p>
              </CardContent>
            </Card>
          )}

          {historyQuery.data?.map((session) => (
            <HistoryRow key={session.id} session={session} isManager={isManager} currentUserId={user?.id} />
          ))}
        </div>
      )}

      {/* My Loot tab — user-scoped history across all guilds */}
      {tab === 'my-loot' && (
        <div className="space-y-3 pt-5">
          {myHistoryQuery.isLoading && (
            <>
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
            </>
          )}

          {!myHistoryQuery.isLoading && myHistoryQuery.data?.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-muted-foreground text-sm">You haven't received any loot yet.</p>
              </CardContent>
            </Card>
          )}

          {myHistoryQuery.data?.map((session) => (
            <HistoryRow key={session.id} session={session} isManager={false} currentUserId={user?.id} />
          ))}
        </div>
      )}

      <NewSessionDialog
        guildId={guildId!}
        open={newSessionOpen}
        onClose={() => setNewSessionOpen(false)}
        onCreated={(id) => {
          setNewSessionOpen(false);
          queryClient.invalidateQueries({ queryKey: ['loot-sessions', guildId] });
          navigate(`/dashboard/servers/${guildId}/loot/sessions/${id}`);
        }}
      />
    </div>
  );
}
