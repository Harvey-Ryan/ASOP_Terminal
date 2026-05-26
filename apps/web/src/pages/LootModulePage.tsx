import { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ChevronDown, ChevronRight, Package, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { lootApi } from '@/api/loot';
import { useAuth } from '@/hooks/useAuth';
import { canManageGuild } from '@dem/shared';
import type { LootHistorySessionDto, LootMethod } from '@dem/shared';

const METHOD_LABELS: Record<LootMethod, string> = {
  RANDOM_ROLL: '🎲 Random Roll',
  DKP: '🪙 DKP',
  SNAKE_DRAFT: '🐍 Snake Draft',
};

const METHOD_COLORS: Record<LootMethod, string> = {
  RANDOM_ROLL: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  DKP: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  SNAKE_DRAFT: 'bg-green-500/10 text-green-500 border-green-500/20',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── History row ───────────────────────────────────────────────────────────────

function HistoryRow({ session }: { session: LootHistorySessionDto }) {
  const [expanded, setExpanded] = useState(false);

  const displayName = session.name ?? (session.eventName ? session.eventName : 'Unnamed Session');
  const label = session.eventName && !session.name ? `📅 ${session.eventName}` : displayName;
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
          {session.items.map((item) => {
            const winner = item.assignments[0];
            return (
              <div key={item.id} className="flex items-center gap-3 text-sm">
                <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 font-medium">{item.name}</span>
                {winner ? (
                  <span className="text-green-600 dark:text-green-400 shrink-0">
                    {winner.username}
                    {winner.rollValue != null && <span className="text-muted-foreground ml-1">(rolled {winner.rollValue})</span>}
                    {winner.dkpSpent != null && <span className="text-muted-foreground ml-1">({winner.dkpSpent} DKP)</span>}
                    {winner.pickNumber != null && <span className="text-muted-foreground ml-1">(pick #{winner.pickNumber + 1})</span>}
                  </span>
                ) : (
                  <span className="text-muted-foreground shrink-0 italic">Unassigned</span>
                )}
              </div>
            );
          })}
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

  const STANDALONE_METHODS: LootMethod[] = ['RANDOM_ROLL', 'SNAKE_DRAFT'];

  const createMutation = useMutation({
    mutationFn: () => lootApi.createStandaloneSession(guildId, { name: name.trim(), method }),
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
  const { guilds } = useAuth();

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: 'sessions' | 'history' = tabParam === 'history' ? 'history' : 'sessions';
  function setTab(t: 'sessions' | 'history') { setSearchParams(t === 'sessions' ? {} : { tab: t }); }
  const [newSessionOpen, setNewSessionOpen] = useState(false);

  const isManager = guilds.some((g) => g.id === guildId);

  const sessionsQuery = useQuery({
    queryKey: ['loot-sessions', guildId],
    queryFn: () => lootApi.listSessions(guildId!),
    enabled: !!guildId,
    refetchInterval: tab === 'sessions' ? 10000 : false,
  });

  const historyQuery = useQuery({
    queryKey: ['loot-history', guildId],
    queryFn: () => lootApi.getHistory(guildId!),
    enabled: !!guildId && tab === 'history',
  });

  const tabCls = (active: boolean) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${active
      ? 'border-primary text-foreground'
      : 'border-transparent text-muted-foreground hover:text-foreground'}`;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">🎁 Loot</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">Manage loot sessions independently of events.</p>
        </div>
        {isManager && (
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
      </div>

      {/* Sessions tab */}
      {tab === 'sessions' && (
        <div className="space-y-3 pt-5">
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
                {isManager && (
                  <Button variant="outline" className="mt-4 gap-2" onClick={() => setNewSessionOpen(true)}>
                    <Plus className="h-4 w-4" />
                    Start one now
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {sessionsQuery.data?.map((session) => {
            const displayName = session.name ?? 'Unnamed Session';
            const participantCount = session.participants.length;
            const itemCount = session.items.length;
            const assignedCount = session.items.filter((i) => i.assignments.length > 0).length;

            return (
              <div
                key={session.id}
                className="rounded-lg border border-border bg-card p-4 flex items-center gap-4"
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="font-medium truncate">{displayName}</p>
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
                  onClick={() => navigate(`/dashboard/servers/${guildId}/loot/sessions/${session.id}`)}
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
            <HistoryRow key={session.id} session={session} />
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
