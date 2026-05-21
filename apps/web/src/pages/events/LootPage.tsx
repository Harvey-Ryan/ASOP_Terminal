import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Shuffle, RotateCcw, CheckCircle2, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { lootApi } from '@/api/loot';
import { eventsApi } from '@/api/events';
import type { LootSessionDto, LootItemDto, LootMethod, DkpBalanceDto, RsvpDto } from '@dem/shared';

const METHOD_LABELS: Record<LootMethod, string> = {
  RANDOM_ROLL: '🎲 Random Roll',
  DKP: '🪙 DKP',
  SNAKE_DRAFT: '🐍 Snake Draft',
};

const inputCls = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

// ── Snake draft helper ────────────────────────────────────────────────────────

function getNextPicker(assignmentCount: number, draftOrder: string[]): string | null {
  if (draftOrder.length === 0) return null;
  const n = draftOrder.length;
  const round = Math.floor(assignmentCount / n);
  const pos = assignmentCount % n;
  return round % 2 === 0 ? draftOrder[pos]! : draftOrder[n - 1 - pos]!;
}

// ── Item row ──────────────────────────────────────────────────────────────────

function ItemRow({
  item,
  session,
  dkpBalances,
  eligiblePlayers,
  allAssignmentCount,
  onRolled,
  onAssigned,
  onDelete,
  guildId,
  eventId,
}: {
  item: LootItemDto;
  session: LootSessionDto;
  dkpBalances: DkpBalanceDto[];
  eligiblePlayers: RsvpDto[];
  allAssignmentCount: number;
  onRolled: () => void;
  onAssigned: () => void;
  onDelete: () => void;
  guildId: string;
  eventId: string;
}) {
  const [rollResult, setRollResult] = useState<{ rolls: { userId: string; username: string; rollValue: number }[]; winner: { userId: string; username: string; rollValue: number } } | null>(null);
  const [showRolls, setShowRolls] = useState(false);
  const [bidsOpen, setBidsOpen] = useState(false);
  const [bids, setBids] = useState<Record<string, string>>({});

  const winner = item.assignments[0];
  const isAssigned = !!winner;

  const rollMutation = useMutation({
    mutationFn: () => lootApi.roll(guildId, eventId, item.id),
    onSuccess: (result) => {
      setRollResult(result);
      setShowRolls(true);
      onRolled();
    },
  });

  const assignMutation = useMutation({
    mutationFn: (body: { userId: string; username: string; dkpSpent?: number; pickNumber?: number }) =>
      lootApi.assign(guildId, eventId, item.id, body),
    onSuccess: onAssigned,
  });

  const clearMutation = useMutation({
    mutationFn: () => lootApi.clearAssignment(guildId, eventId, item.id),
    onSuccess: () => { setRollResult(null); setShowRolls(false); onAssigned(); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => lootApi.deleteItem(guildId, eventId, item.id),
    onSuccess: onDelete,
  });

  const nextPicker = session.method === 'SNAKE_DRAFT'
    ? getNextPicker(allAssignmentCount, session.draftOrder)
    : null;
  const nextPickerName = nextPicker
    ? (eligiblePlayers.find((p) => p.userId === nextPicker)?.username ?? nextPicker)
    : null;
  const isMyTurn = session.method === 'SNAKE_DRAFT' && !isAssigned && nextPicker !== null;

  function handleDkpAward() {
    const bidEntries = Object.entries(bids).filter(([, v]) => v !== '' && !isNaN(Number(v)));
    if (bidEntries.length === 0) return;
    const sorted = bidEntries.sort(([, a], [, b]) => Number(b) - Number(a));
    const [winnerId, winnerBid] = sorted[0]!;
    const winnerUsername = eligiblePlayers.find((p) => p.userId === winnerId)?.username ?? winnerId;
    assignMutation.mutate({ userId: winnerId, username: winnerUsername, dkpSpent: Number(winnerBid) });
    setBidsOpen(false);
  }

  return (
    <div className={`rounded-lg border ${isAssigned ? 'border-green-500/30 bg-green-500/5' : 'border-border bg-card'} p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium truncate">{item.name}{item.quantity > 1 && <span className="ml-1 text-muted-foreground text-sm">×{item.quantity}</span>}</p>
          {isAssigned ? (
            <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1 mt-0.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {winner.username}
              {winner.rollValue != null && <span className="text-muted-foreground"> (rolled {winner.rollValue})</span>}
              {winner.dkpSpent != null && <span className="text-muted-foreground"> ({winner.dkpSpent} DKP)</span>}
              {winner.pickNumber != null && <span className="text-muted-foreground"> (pick #{winner.pickNumber + 1})</span>}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground mt-0.5">Unassigned</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isAssigned && (
            <Button size="sm" variant="ghost" onClick={() => clearMutation.mutate()} disabled={clearMutation.isPending} title="Clear assignment">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} title="Delete item">
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
          </Button>
        </div>
      </div>

      {/* Random Roll controls */}
      {session.method === 'RANDOM_ROLL' && !isAssigned && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => rollMutation.mutate()} disabled={rollMutation.isPending}>
            🎲 {rollMutation.isPending ? 'Rolling…' : 'Roll Now'}
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={item.excludePrevWinners} readOnly className="h-3 w-3" />
            Exclude prev winners
          </label>
        </div>
      )}

      {/* Roll results */}
      {rollResult && showRolls && (
        <div className="rounded-md bg-muted/50 border border-border p-3 space-y-1">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Roll Results</p>
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowRolls(false)}>Hide</button>
          </div>
          {rollResult.rolls.map((r) => (
            <div key={r.userId} className={`flex items-center justify-between text-sm px-2 py-1 rounded ${r.userId === rollResult.winner.userId ? 'bg-primary/10 font-medium' : ''}`}>
              <span>{r.username} {r.userId === rollResult.winner.userId && '🏆'}</span>
              <span className="font-mono">{r.rollValue}</span>
            </div>
          ))}
        </div>
      )}

      {/* DKP bid controls */}
      {session.method === 'DKP' && !isAssigned && (
        <div>
          {!bidsOpen ? (
            <Button size="sm" variant="outline" onClick={() => setBidsOpen(true)}>Enter Bids</Button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Bids</p>
              {eligiblePlayers.map((p) => {
                const bal = dkpBalances.find((b) => b.userId === p.userId);
                return (
                  <div key={p.userId} className="flex items-center gap-2">
                    <span className="text-sm w-32 truncate">{p.username}</span>
                    <span className="text-xs text-muted-foreground w-20">{bal ? `${bal.balance} DKP` : '—'}</span>
                    <input
                      type="number"
                      min={0}
                      className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm"
                      placeholder="0"
                      value={bids[p.userId] ?? ''}
                      onChange={(e) => setBids((prev) => ({ ...prev, [p.userId]: e.target.value }))}
                    />
                  </div>
                );
              })}
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={handleDkpAward} disabled={assignMutation.isPending}>Award to Highest Bid</Button>
                <Button size="sm" variant="ghost" onClick={() => { setBidsOpen(false); setBids({}); }}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Snake draft pick */}
      {session.method === 'SNAKE_DRAFT' && isMyTurn && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Pick for <span className="font-medium text-foreground">{nextPickerName}</span>:</span>
          <Button
            size="sm"
            onClick={() =>
              assignMutation.mutate({
                userId: nextPicker!,
                username: nextPickerName!,
                pickNumber: allAssignmentCount,
              })
            }
            disabled={assignMutation.isPending}
          >
            Award
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Setup form (no session yet) ───────────────────────────────────────────────

function SetupForm({ guildId, eventId, onCreated }: { guildId: string; eventId: string; onCreated: () => void }) {
  const [method, setMethod] = useState<LootMethod>('RANDOM_ROLL');
  const [dkpAward, setDkpAward] = useState('0');

  const createMutation = useMutation({
    mutationFn: () => lootApi.createSession(guildId, eventId, { method, dkpAward: parseInt(dkpAward) || 0 }),
    onSuccess: onCreated,
  });

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Start Loot Session</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-medium">Distribution Method</label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(METHOD_LABELS) as LootMethod[]).map((m) => (
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
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">DKP Award per Attendee</label>
          <input
            type="number"
            min={0}
            className={inputCls}
            value={dkpAward}
            onChange={(e) => setDkpAward(e.target.value)}
            placeholder="0"
          />
          <p className="text-xs text-muted-foreground">Awarded to all confirmed attendees when the session is completed.</p>
        </div>
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="w-full">
          {createMutation.isPending ? 'Creating…' : 'Start Session'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function LootPage() {
  const { guildId, eventId } = useParams<{ guildId: string; eventId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [newItemName, setNewItemName] = useState('');
  const newItemInputRef = useRef<HTMLInputElement>(null);

  const sessionQuery = useQuery({
    queryKey: ['loot', guildId, eventId],
    queryFn: () => lootApi.getSession(guildId!, eventId!),
    enabled: !!guildId && !!eventId,
  });

  const eventQuery = useQuery({
    queryKey: ['event', guildId, eventId],
    queryFn: () => eventsApi.get(guildId!, eventId!),
    enabled: !!guildId && !!eventId,
  });

  const dkpQuery = useQuery({
    queryKey: ['dkp', guildId],
    queryFn: () => lootApi.getDkp(guildId!),
    enabled: !!guildId && sessionQuery.data?.method === 'DKP',
  });

  const session = sessionQuery.data;
  const event = eventQuery.data;

  const eligiblePlayers: RsvpDto[] = (() => {
    if (!event) return [];
    const ids = new Set<string>(event.confirmedAttendees ?? []);
    return event.rsvps.filter((r) => ids.has(r.userId));
  })();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['loot', guildId, eventId] });
  };

  const updateMutation = useMutation({
    mutationFn: (body: { method?: LootMethod; dkpAward?: number; draftOrder?: string[] }) =>
      lootApi.updateSession(guildId!, eventId!, body),
    onSuccess: invalidate,
  });

  const addItemMutation = useMutation({
    mutationFn: (name: string) => lootApi.addItem(guildId!, eventId!, { name }),
    onSuccess: () => {
      setNewItemName('');
      invalidate();
      setTimeout(() => newItemInputRef.current?.focus(), 0);
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => lootApi.complete(guildId!, eventId!),
    onSuccess: () => navigate(`/dashboard/servers/${guildId}?tab=completed`),
  });

  function handleShuffle() {
    if (!session) return;
    const shuffled = [...eligiblePlayers.map((p) => p.userId)].sort(() => Math.random() - 0.5);
    updateMutation.mutate({ draftOrder: shuffled });
  }

  const allAssignmentCount = session?.items.reduce((n, item) => n + item.assignments.length, 0) ?? 0;
  const nextPickerId = session ? getNextPicker(allAssignmentCount, session.draftOrder) : null;
  const nextPickerName = nextPickerId
    ? (eligiblePlayers.find((p) => p.userId === nextPickerId)?.username ?? nextPickerId)
    : null;

  const isLoading = sessionQuery.isLoading || eventQuery.isLoading;

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5">
      <button
        onClick={() => navigate(`/dashboard/servers/${guildId}`)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to server
      </button>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">🎁 Loot Distribution</h1>
        {event && <p className="text-muted-foreground mt-0.5">{event.name}</p>}
      </div>

      {/* No session yet */}
      {!session && (
        <SetupForm guildId={guildId!} eventId={eventId!} onCreated={invalidate} />
      )}

      {/* Active session */}
      {session && (
        <>
          {/* Method + DKP award row */}
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div className="flex items-start gap-4 flex-wrap">
                <div className="space-y-1.5 flex-1 min-w-[200px]">
                  <label className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Method</label>
                  <div className="flex gap-2 flex-wrap">
                    {(Object.keys(METHOD_LABELS) as LootMethod[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => updateMutation.mutate({ method: m })}
                        disabled={session.status === 'COMPLETED'}
                        className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${session.method === m ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}
                      >
                        {METHOD_LABELS[m]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5 w-36">
                  <label className="text-xs font-semibold uppercase text-muted-foreground tracking-wide flex items-center gap-1">
                    <Coins className="h-3 w-3" /> DKP Award
                  </label>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                    value={session.dkpAward}
                    disabled={session.status === 'COMPLETED'}
                    onChange={(e) => updateMutation.mutate({ dkpAward: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Snake draft order */}
          {session.method === 'SNAKE_DRAFT' && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">🐍 Draft Order</CardTitle>
                  {session.status === 'OPEN' && (
                    <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={handleShuffle}>
                      <Shuffle className="h-3 w-3" />
                      Shuffle
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {nextPickerName && (
                  <div className="mb-3 rounded-md bg-primary/10 border border-primary/30 px-3 py-2 text-sm font-medium text-primary">
                    Now picking: {nextPickerName}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {session.draftOrder.map((userId, i) => {
                    const name = eligiblePlayers.find((p) => p.userId === userId)?.username ?? userId;
                    const isCurrent = userId === nextPickerId;
                    return (
                      <span
                        key={userId}
                        className={`rounded-full px-3 py-1 text-xs font-medium border ${isCurrent ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
                      >
                        {i + 1}. {name}
                      </span>
                    );
                  })}
                  {session.draftOrder.length === 0 && (
                    <p className="text-sm text-muted-foreground italic">No confirmed attendees in draft order. Complete the attendance audit first.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Item list */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wide">Items ({session.items.length})</h2>
              {session.items.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {session.items.filter((i) => i.assignments.length > 0).length} / {session.items.length} assigned
                </span>
              )}
            </div>

            {session.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                session={session}
                dkpBalances={dkpQuery.data ?? []}
                eligiblePlayers={eligiblePlayers}
                allAssignmentCount={allAssignmentCount}
                onRolled={invalidate}
                onAssigned={invalidate}
                onDelete={invalidate}
                guildId={guildId!}
                eventId={eventId!}
              />
            ))}

            {/* Add item */}
            {session.status === 'OPEN' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newItemName.trim()) addItemMutation.mutate(newItemName.trim());
                }}
                className="flex gap-2"
              >
                <input
                  ref={newItemInputRef}
                  className={inputCls}
                  placeholder="Item name…"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                />
                <Button type="submit" disabled={!newItemName.trim() || addItemMutation.isPending} className="shrink-0 gap-1">
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </form>
            )}

            {session.items.length === 0 && (
              <p className="text-sm text-muted-foreground italic py-2">No items yet. Add items above to start distributing loot.</p>
            )}
          </div>

          {/* Complete */}
          {session.status === 'OPEN' && (
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <div className="text-sm text-muted-foreground">
                {session.dkpAward > 0 && (
                  <span className="flex items-center gap-1">
                    <Coins className="h-3.5 w-3.5" />
                    +{session.dkpAward} DKP to {eligiblePlayers.length} attendee{eligiblePlayers.length !== 1 ? 's' : ''} on completion
                  </span>
                )}
              </div>
              <Button
                onClick={() => completeMutation.mutate()}
                disabled={completeMutation.isPending}
                className="gap-1"
              >
                <CheckCircle2 className="h-4 w-4" />
                {completeMutation.isPending ? 'Completing…' : 'Complete & Post to Discord'}
              </Button>
            </div>
          )}

          {session.status === 'COMPLETED' && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-400">
              ✅ Loot session completed. Results posted to the event forum thread.
            </div>
          )}
        </>
      )}
    </div>
  );
}
