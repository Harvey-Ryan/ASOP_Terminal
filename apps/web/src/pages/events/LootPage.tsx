import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Shuffle, RotateCcw, CheckCircle2, Coins, Save, SkipForward, Play, Package, EyeOff, AlertTriangle, Gavel, Timer, X, GripVertical, ListOrdered, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { lootApi } from '@/api/loot';
import { eventsApi } from '@/api/events';
import { uexApi } from '@/api/uex';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { resolveUsername } from '@/lib/displayName';
import type { LootSessionDto, LootItemDto, LootMethod, DkpBalanceDto, RsvpDto, LootAuctionDto, LootQueueItemDto, UexItemDto, UexCommodityDto } from '@dem/shared';

const METHOD_LABELS: Record<LootMethod, string> = {
  RANDOM_ROLL: '🎲 Random Roll',
  DKP: '🪙 DKP',
  SNAKE_DRAFT: '🐍 Snake Draft',
  COMMODITY_DRAFT: '📦 Commodity Draft',
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

// ── Auction helpers ───────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const DURATION_OPTIONS = [
  { label: '30 s', value: 30 },
  { label: '1 min', value: 60 },
  { label: '2 min', value: 120 },
  { label: '5 min', value: 300 },
  { label: '10 min', value: 600 },
];

const MEDALS = ['🥇', '🥈', '🥉'];

function AuctionPanel({
  auction,
  item,
  session,
  guildId,
  eventId,
  currentUserId,
  eligiblePlayers,
  myEffectiveBalance,
  isManager,
  onAuctionChange,
}: {
  auction: LootAuctionDto | null;
  item: LootItemDto;
  session: LootSessionDto;
  guildId: string;
  eventId: string;
  currentUserId?: string;
  eligiblePlayers: RsvpDto[];
  myEffectiveBalance: number;
  isManager: boolean;
  onAuctionChange: () => void;
}) {
  const [durationSecs, setDurationSecs] = useState(120);
  const [bidInput, setBidInput] = useState('');

  const startMutation = useMutation({
    mutationFn: () => lootApi.startAuction(guildId, eventId, item.id, { durationSecs }),
    onSuccess: onAuctionChange,
  });

  const bidMutation = useMutation({
    mutationFn: () => lootApi.placeBid(guildId, eventId, item.id, { maxBid: Number(bidInput) }),
    onSuccess: () => { setBidInput(''); onAuctionChange(); },
  });

  const closeMutation = useMutation({
    mutationFn: () => lootApi.closeAuction(guildId, eventId, item.id),
    onSuccess: onAuctionChange,
  });

  const cancelMutation = useMutation({
    mutationFn: () => lootApi.cancelAuction(guildId, eventId, item.id),
    onSuccess: onAuctionChange,
  });

  // Client-side countdown, seeded from server's secondsRemaining
  const [secondsLeft, setSecondsLeft] = useState(auction?.secondsRemaining ?? 0);
  useEffect(() => {
    if (!auction || auction.status !== 'OPEN') return;
    setSecondsLeft(auction.secondsRemaining);
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auction?.id, auction?.status, auction?.secondsRemaining]);

  // No active auction
  if (!auction || auction.status === 'CANCELLED') {
    if (!isManager) return null;
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={durationSecs}
          onChange={(e) => setDurationSecs(Number(e.target.value))}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
        >
          {DURATION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => startMutation.mutate()}
          disabled={startMutation.isPending}
        >
          <Gavel className="h-3.5 w-3.5" />
          {startMutation.isPending ? 'Starting…' : 'Start Auction'}
        </Button>
        {startMutation.isError && (
          <span className="text-xs text-destructive flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {(startMutation.error as Error).message}
          </span>
        )}
      </div>
    );
  }

  if (auction.status !== 'OPEN') return null;

  const isEligible = isManager || eligiblePlayers.some((p) => p.userId === currentUserId);
  const myBid = auction.bids.find((b) => b.userId === currentUserId);
  const bidVal = bidInput !== '' ? Number(bidInput) : 0;
  const overBid = bidInput !== '' && bidVal > myEffectiveBalance;
  const belowCurrent = !!myBid && bidInput !== '' && bidVal <= myBid.maxBid;
  const bidInvalid = !bidInput || bidVal <= 0 || overBid || belowCurrent;
  const urgentTime = secondsLeft <= 30 && secondsLeft > 0;

  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 flex items-center gap-1">
          <Gavel className="h-3.5 w-3.5" />
          Live Auction
        </p>
        <span className={`flex items-center gap-1 text-sm font-mono font-semibold tabular-nums ${urgentTime ? 'text-destructive animate-pulse' : 'text-muted-foreground'}`}>
          <Timer className="h-3.5 w-3.5" />
          {secondsLeft === 0 ? 'Closing…' : formatTime(secondsLeft)}
        </span>
      </div>

      {/* Current standings */}
      <div className="space-y-1">
        {auction.bids.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No bids yet — be the first!</p>
        ) : (
          auction.bids.map((b, i) => (
            <div
              key={b.userId}
              className={`flex items-center justify-between text-sm px-2 py-1 rounded ${b.userId === currentUserId ? 'bg-primary/10 font-medium' : ''}`}
            >
              <span className="flex items-center gap-1.5">
                <span>{MEDALS[i] ?? `${i + 1}.`}</span>
                <span>{resolveUsername(b.userId, b.username, currentUserId)}</span>
                {b.userId === currentUserId && <span className="text-xs text-muted-foreground">(you)</span>}
              </span>
              <span className="font-mono tabular-nums">{b.amount} DKP</span>
            </div>
          ))
        )}
      </div>

      {/* Bid input — confirmed attendees and managers */}
      {isEligible && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Max Bid
          </label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="number"
                min={myBid ? myBid.maxBid + 1 : 1}
                max={myEffectiveBalance}
                value={bidInput}
                onChange={(e) => setBidInput(e.target.value)}
                placeholder="e.g. 250"
                className={`w-full rounded-md border px-2 py-1.5 text-sm ${
                  overBid || belowCurrent
                    ? 'border-destructive bg-destructive/10 text-destructive'
                    : 'border-input bg-background'
                }`}
              />
            </div>
            <Button
              size="sm"
              className="gap-1 shrink-0"
              onClick={() => bidMutation.mutate()}
              disabled={bidInvalid || bidMutation.isPending}
            >
              {bidMutation.isPending ? 'Bidding…' : myBid ? 'Raise Max' : 'Bid'}
            </Button>
          </div>
          {myBid && (
            <p className="text-xs text-muted-foreground">
              Your max: <span className="font-medium">{myBid.maxBid} DKP</span>
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Your available DKP: <span className={myEffectiveBalance <= 0 ? 'text-destructive' : ''}>{myEffectiveBalance}</span>
          </p>
          {overBid && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Max bid exceeds your available balance
            </p>
          )}
          {belowCurrent && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Must exceed your current max of {myBid!.maxBid} DKP
            </p>
          )}
          {bidMutation.isError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {(bidMutation.error as Error).message}
            </p>
          )}
        </div>
      )}

      {/* Manager controls */}
      {isManager && (
        <div className="flex items-center gap-2 pt-0.5 border-t border-border/50">
          <Button
            size="sm"
            variant="outline"
            className="gap-1 h-7 text-xs"
            onClick={() => closeMutation.mutate()}
            disabled={closeMutation.isPending}
          >
            <CheckCircle2 className="h-3 w-3" />
            {closeMutation.isPending ? 'Closing…' : 'Close Now'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 h-7 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
          >
            <X className="h-3 w-3" />
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

// ── UEX info popover (hover on loot items) ────────────────────────────────────

function UexInfoCard({ data }: { data: UexItemDto | UexCommodityDto }) {
  const isItem = 'categoryName' in data;

  if (isItem) {
    const item = data as UexItemDto;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-foreground leading-tight">{item.name}</p>
          <span className="shrink-0 rounded-full bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">Item</span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
          {item.categoryName && <span><span className="text-foreground/60">Category:</span> {item.categoryName}</span>}
          {item.section      && <span><span className="text-foreground/60">Section:</span> {item.section}</span>}
          {item.gameVersion  && <span><span className="text-foreground/60">Version:</span> {item.gameVersion}</span>}
          {item.slug         && <span className="col-span-2 break-all"><span className="text-foreground/60">Slug:</span> {item.slug}</span>}
        </div>
        {(item.isCommodity || item.isHarvestable) && (
          <div className="flex flex-wrap gap-1">
            {item.isCommodity   && <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">commodity</span>}
            {item.isHarvestable && <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">harvestable</span>}
          </div>
        )}
        {item.attributes.length > 0 && (
          <div className="border-t border-border pt-1.5 space-y-0.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Attributes</p>
            {item.attributes.map((a, i) => (
              <div key={i} className="flex gap-1.5">
                {a.name && <span className="text-foreground/60 shrink-0">{a.name}:</span>}
                <span className="text-foreground">{a.value}{a.unit ? ` ${a.unit}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const com = data as UexCommodityDto;
  const flags = [
    com.isMineral    && 'mineral',
    com.isRaw        && 'raw',
    com.isRefined    && 'refined',
    com.isHarvestable && 'harvestable',
    com.isFuel       && 'fuel',
    com.isIllegal    && 'illegal',
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-foreground leading-tight">{com.name}</p>
        <span className="shrink-0 rounded-full bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">Commodity</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
        {com.code            && <span><span className="text-foreground/60">Code:</span> {com.code}</span>}
        {com.weightScu   != null && <span><span className="text-foreground/60">Weight:</span> {com.weightScu} SCU</span>}
        {com.priceAvgBuy  != null && <span><span className="text-foreground/60">Buy avg:</span> {com.priceAvgBuy.toLocaleString()} aUEC</span>}
        {com.priceAvgSell != null && <span><span className="text-foreground/60">Sell avg:</span> {com.priceAvgSell.toLocaleString()} aUEC</span>}
      </div>
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {flags.map((f) => (
            <span key={f} className={`rounded-sm px-1.5 py-0.5 text-[10px] ${f === 'illegal' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>{f}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemInfoPopover({ name }: { name: string }) {
  const [show, setShow] = useState(false);

  const infoQuery = useQuery({
    queryKey: ['uex-item-info', name],
    queryFn: async () => {
      const [items, commodities] = await Promise.all([
        uexApi.getItems({ q: name, limit: 10 }),
        uexApi.getCommodities({ q: name, limit: 5 }),
      ]);
      const lc = name.toLowerCase();
      return (
        items.find((i) => i.name.toLowerCase() === lc) ??
        commodities.find((c) => c.name.toLowerCase() === lc) ??
        items[0] ??
        commodities[0] ??
        null
      );
    },
    enabled: show,
    staleTime: 10 * 60 * 1000,
  });

  return (
    <div className="relative" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <button
        type="button"
        tabIndex={-1}
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {show && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg border border-border bg-card p-3 shadow-xl text-xs pointer-events-none">
          {infoQuery.isLoading && <p className="text-muted-foreground">Looking up "{name}"…</p>}
          {!infoQuery.isLoading && infoQuery.data === null && (
            <p className="text-muted-foreground">No UEX record found for "{name}".</p>
          )}
          {infoQuery.data && <UexInfoCard data={infoQuery.data} />}
        </div>
      )}
    </div>
  );
}

// ── Item row ──────────────────────────────────────────────────────────────────

function ItemRow({
  item,
  session,
  auction,
  dkpBalances,
  eligiblePlayers,
  allRsvpMap,
  allAssignmentCount,
  skipCount,
  onRolled,
  onAssigned,
  onDelete,
  onAuctionChange,
  guildId,
  eventId,
  currentUserId,
  myEffectiveBalance,
  isManager,
}: {
  item: LootItemDto;
  session: LootSessionDto;
  auction: LootAuctionDto | null;
  dkpBalances: DkpBalanceDto[];
  eligiblePlayers: RsvpDto[];
  allRsvpMap: Map<string, string>;
  allAssignmentCount: number;
  skipCount: number;
  onRolled: () => void;
  onAssigned: () => void;
  onDelete: () => void;
  onAuctionChange: () => void;
  guildId: string;
  eventId: string;
  currentUserId?: string;
  myEffectiveBalance: number;
  isManager: boolean;
}) {
  const [rollResult, setRollResult] = useState<{ rolls: { userId: string; username: string; rollValue: number }[]; winner: { userId: string; username: string; rollValue: number } } | null>(null);
  const [showRolls, setShowRolls] = useState(false);

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

  const deliveredMutation = useMutation({
    mutationFn: () => lootApi.toggleDelivered(guildId, eventId, item.id),
    onSuccess: onAssigned,
  });

  const deleteMutation = useMutation({
    mutationFn: () => lootApi.deleteItem(guildId, eventId, item.id),
    onSuccess: onDelete,
  });

  const nextPicker = session.method === 'SNAKE_DRAFT'
    ? getNextPicker(allAssignmentCount + skipCount, session.draftOrder)
    : null;
  const nextPickerName = nextPicker
    ? resolveUsername(nextPicker, eligiblePlayers.find((p) => p.userId === nextPicker)?.username ?? allRsvpMap.get(nextPicker) ?? nextPicker, currentUserId)
    : null;
  const isMyTurn = session.method === 'SNAKE_DRAFT' && !isAssigned && nextPicker !== null;

  return (
    <div className={`rounded-lg border ${isAssigned ? 'border-green-500/30 bg-green-500/5' : 'border-border bg-card'} p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium truncate">{item.name}{item.quantity > 1 && <span className="ml-1 text-muted-foreground text-sm">×{item.quantity}</span>}</p>
          {isAssigned ? (
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {resolveUsername(winner.userId, winner.username || allRsvpMap.get(winner.userId) || winner.userId, currentUserId)}
                {winner.rollValue != null && <span className="text-muted-foreground"> (rolled {winner.rollValue})</span>}
                {winner.dkpSpent != null && <span className="text-muted-foreground"> ({winner.dkpSpent} DKP)</span>}
                {winner.pickNumber != null && <span className="text-muted-foreground"> (pick #{winner.pickNumber + 1})</span>}
              </p>
              {isManager ? (
                <button
                  onClick={() => deliveredMutation.mutate()}
                  disabled={deliveredMutation.isPending}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border transition-colors ${
                    winner.delivered
                      ? 'border-green-500/50 bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/25'
                      : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                  }`}
                  title={winner.delivered ? 'Mark as not delivered' : 'Mark as delivered'}
                >
                  <Package className="h-3 w-3" />
                  {winner.delivered ? 'Delivered' : 'Deliver'}
                </button>
              ) : winner.delivered ? (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border border-green-500/50 bg-green-500/15 text-green-600 dark:text-green-400">
                  <Package className="h-3 w-3" />
                  Delivered
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mt-0.5">Unassigned</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <ItemInfoPopover name={item.name} />
          {isManager && (
            <>
              {isAssigned && (
                <Button size="sm" variant="ghost" onClick={() => clearMutation.mutate()} disabled={clearMutation.isPending} title="Clear assignment">
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} title="Delete item">
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Random Roll controls — managers only */}
      {isManager && session.method === 'RANDOM_ROLL' && !isAssigned && (
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
              <span>{resolveUsername(r.userId, r.username, currentUserId)} {r.userId === rollResult.winner.userId && '🏆'}</span>
              <span className="font-mono">{r.rollValue}</span>
            </div>
          ))}
        </div>
      )}

      {/* DKP live auction */}
      {session.method === 'DKP' && !isAssigned && (
        <AuctionPanel
          auction={auction}
          item={item}
          session={session}
          guildId={guildId}
          eventId={eventId}
          currentUserId={currentUserId}
          eligiblePlayers={eligiblePlayers}
          myEffectiveBalance={myEffectiveBalance}
          isManager={isManager}
          onAuctionChange={onAuctionChange}
        />
      )}

      {/* Snake draft pick — managers see picker name; pickers see "Pick This" for themselves */}
      {session.method === 'SNAKE_DRAFT' && isMyTurn && (isManager || nextPicker === currentUserId) && (
        <div className="flex items-center gap-2">
          {isManager && (
            <span className="text-sm text-muted-foreground">Pick for <span className="font-medium text-foreground">{nextPickerName}</span>:</span>
          )}
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
            {isManager ? 'Award' : 'Pick This Item'}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Draft queue card ──────────────────────────────────────────────────────────

function QueueCard({
  session,
  guildId,
  eventId,
}: {
  session: LootSessionDto;
  guildId: string;
  eventId: string;
}) {
  const queryClient = useQueryClient();

  const queueQuery = useQuery({
    queryKey: ['loot-queue', guildId, eventId],
    queryFn: () => lootApi.getQueue(guildId, eventId),
    refetchInterval: 4000,
  });

  // Local item-id order drives the drag-and-drop UI optimistically
  const [localIds, setLocalIds] = useState<string[]>([]);
  const isDraggingRef = useRef(false);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Sync server → local when not mid-drag and server has new data
  useEffect(() => {
    if (isDraggingRef.current) return;
    setLocalIds((queueQuery.data ?? []).map((q) => q.itemId));
  }, [queueQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (ids: string[]) => lootApi.setQueue(guildId, eventId, ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loot-queue', guildId, eventId] }),
  });

  const byItemId = new Map<string, LootQueueItemDto>((queueQuery.data ?? []).map((q) => [q.itemId, q]));
  const inQueueIds = new Set(localIds);

  // Items that can still be added (unassigned, not yet queued)
  const addable = session.items.filter(
    (i) => i.assignments.length === 0 && !inQueueIds.has(i.id),
  );

  function addItem(itemId: string) {
    const next = [...localIds, itemId];
    setLocalIds(next);
    saveMutation.mutate(next);
  }

  function removeItem(itemId: string) {
    const next = localIds.filter((id) => id !== itemId);
    setLocalIds(next);
    saveMutation.mutate(next);
  }

  // ── Drag handlers ───────────────────────────────────────────────────────────

  function onDragStart(index: number) {
    isDraggingRef.current = true;
    dragIndexRef.current = index;
  }

  function onDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragOverIndex(index);
  }

  function onDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault();
    const from = dragIndexRef.current;
    if (from === null || from === dropIndex) return;
    const next = [...localIds];
    const [moved] = next.splice(from, 1);
    next.splice(dropIndex, 0, moved!);
    setLocalIds(next);
    saveMutation.mutate(next);
  }

  function onDragEnd() {
    isDraggingRef.current = false;
    dragIndexRef.current = null;
    setDragOverIndex(null);
  }

  const isCompleted = session.status === 'COMPLETED';

  return (
    <Card className="w-72 shrink-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ListOrdered className="h-4 w-4" />
          My Draft Queue
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {isCompleted ? 'Draft complete.' : 'Your top available item will be auto-picked on your turn.'}
        </p>
      </CardHeader>
      <CardContent className="space-y-1 pb-3">
        {localIds.length === 0 && (
          <p className="text-xs text-muted-foreground italic py-1">No items queued yet.</p>
        )}

        {localIds.map((itemId, index) => {
          const entry = byItemId.get(itemId);
          const sessionItem = session.items.find((i) => i.id === itemId);
          const name = entry?.itemName ?? sessionItem?.name ?? itemId;
          const assigned = entry?.assigned ?? (sessionItem?.assignments.length ?? 0) > 0;
          const isDragTarget = dragOverIndex === index;

          return (
            <div
              key={itemId}
              draggable={!isCompleted}
              onDragStart={() => onDragStart(index)}
              onDragOver={(e) => onDragOver(e, index)}
              onDrop={(e) => onDrop(e, index)}
              onDragEnd={onDragEnd}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors
                ${assigned ? 'opacity-40 line-through border-border/50 bg-muted/30' : 'border-border bg-card'}
                ${isDragTarget ? 'border-primary bg-primary/5' : ''}
                ${!isCompleted ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              {!isCompleted && (
                <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="text-xs text-muted-foreground w-4 shrink-0 text-right">{index + 1}.</span>
              <span className="flex-1 min-w-0 truncate">{name}</span>
              {!isCompleted && (
                <button
                  type="button"
                  onClick={() => removeItem(itemId)}
                  className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                  title="Remove from queue"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}

        {/* Add items */}
        {!isCompleted && addable.length > 0 && (
          <div className="pt-1">
            <p className="text-xs font-medium text-muted-foreground mb-1">Add to queue</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {addable.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addItem(item.id)}
                  className="w-full flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground transition-colors text-left"
                >
                  <Plus className="h-3 w-3 shrink-0" />
                  <span className="truncate">{item.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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
  const { user, guilds } = useAuth();

  const [newItemName, setNewItemName] = useState('');
  const newItemInputRef = useRef<HTMLInputElement>(null);

  const sessionQuery = useQuery({
    queryKey: ['loot', guildId, eventId],
    queryFn: () => lootApi.getSession(guildId!, eventId!),
    enabled: !!guildId && !!eventId,
    refetchInterval: 4000,
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

  const myDkpQuery = useQuery({
    queryKey: ['dkp-me', guildId],
    queryFn: () => lootApi.getMyDkp(guildId!),
    enabled: !!guildId && sessionQuery.data?.method === 'DKP',
  });

  const auctionQuery = useQuery({
    queryKey: ['loot-auctions', guildId, eventId],
    queryFn: () => lootApi.getAuctions(guildId!, eventId!),
    enabled: !!guildId && !!eventId && sessionQuery.data?.method === 'DKP',
    refetchInterval: sessionQuery.data?.method === 'DKP' && sessionQuery.data?.status === 'OPEN' ? 2000 : false,
  });

  const playersQuery = useQuery({
    queryKey: ['players', guildId],
    queryFn: () => lootApi.getPlayers(guildId!),
    enabled: !!guildId && sessionQuery.data?.method === 'SNAKE_DRAFT',
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
    queryClient.invalidateQueries({ queryKey: ['loot-queue', guildId, eventId] });
    queryClient.invalidateQueries({ queryKey: ['dkp', guildId] });
    queryClient.invalidateQueries({ queryKey: ['dkp-me', guildId] });
    queryClient.invalidateQueries({ queryKey: ['loot-auctions', guildId, eventId] });
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

  const [hideAssigned, setHideAssigned] = useState(false);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [startConfirm, setStartConfirm] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [newItemInputFocused, setNewItemInputFocused] = useState(false);
  const debouncedNewItem = useDebounce(newItemName, 250);

  const suggestQuery = useQuery({
    queryKey: ['uex-suggest-loot', debouncedNewItem],
    queryFn: async () => {
      const [items, commodities] = await Promise.all([
        uexApi.getItems({ q: debouncedNewItem, limit: 8 }),
        uexApi.getCommodities({ q: debouncedNewItem, limit: 4 }),
      ]);
      const seen = new Set<string>();
      const results: { id: number; name: string; detail: string; type: 'item' | 'commodity' }[] = [];
      for (const i of items) {
        const lc = i.name.toLowerCase();
        if (!seen.has(lc)) { seen.add(lc); results.push({ id: i.id, name: i.name, detail: i.categoryName || i.section || '', type: 'item' }); }
      }
      for (const c of commodities) {
        const lc = c.name.toLowerCase();
        if (!seen.has(lc)) { seen.add(lc); results.push({ id: c.id, name: c.name, detail: c.code || '', type: 'commodity' }); }
      }
      return results;
    },
    enabled: debouncedNewItem.length >= 3,
    staleTime: 2 * 60 * 1000,
  });
  const skipMutation = useMutation({
    mutationFn: () => lootApi.skipTurn(guildId!, eventId!),
    onSuccess: () => { setSkipConfirm(false); invalidate(); },
    onError: () => setSkipConfirm(false),
  });

  const startDraftMutation = useMutation({
    mutationFn: () => lootApi.startDraft(guildId!, eventId!),
    onSuccess: () => { setStartConfirm(false); invalidate(); },
    onError: () => setStartConfirm(false),
  });

  // Shuffle the current draft order in-place (preserves manually added members)
  function handleShuffle() {
    if (!session) return;
    const shuffled = [...session.draftOrder].sort(() => Math.random() - 0.5);
    updateMutation.mutate({ draftOrder: shuffled });
  }

  // Lookup map for all known members: RSVPs + DKP players (covers manually-added non-RSVP members)
  const allRsvpMap = new Map([
    ...(playersQuery.data ?? []).map((p) => [p.userId, p.username] as [string, string]),
    ...(event?.rsvps ?? []).map((r) => [r.userId, r.username] as [string, string]),
  ]);

  // All known guild members (DKP players + RSVPs) not yet in the draft order
  const allKnownPlayers: { userId: string; username: string }[] = (() => {
    const map = new Map<string, string>();
    for (const p of (playersQuery.data ?? [])) map.set(p.userId, p.username);
    for (const r of (event?.rsvps ?? [])) map.set(r.userId, r.username);
    return Array.from(map.entries()).map(([userId, username]) => ({ userId, username }));
  })();
  const draftSet = new Set(session?.draftOrder ?? []);
  const notInDraft = allKnownPlayers
    .filter((p) => !draftSet.has(p.userId))
    .filter((p) => !memberSearch || p.username.toLowerCase().includes(memberSearch.toLowerCase()))
    .sort((a, b) => a.username.localeCompare(b.username));

  const allAssignmentCount = session?.items.reduce((n, item) => n + item.assignments.length, 0) ?? 0;
  const skipCount = session?.skipCount ?? 0;
  const nextPickerId = session ? getNextPicker(allAssignmentCount + skipCount, session.draftOrder) : null;
  const nextPickerName = nextPickerId
    ? resolveUsername(nextPickerId, eligiblePlayers.find((p) => p.userId === nextPickerId)?.username ?? allRsvpMap.get(nextPickerId) ?? nextPickerId, user?.id)
    : null;

  const isManager = guilds.some((g) => g.id === guildId);
  const isCurrentPicker = session?.method === 'SNAKE_DRAFT' && session.status === 'OPEN' && nextPickerId === user?.id;

  // Effective DKP balance for the current user: raw minus DKP committed to items already won this session
  const myRawBalance = myDkpQuery.data?.balance ?? 0;
  const myCommitted = session?.items.reduce((sum, item) => {
    const a = item.assignments[0];
    return sum + (a?.userId === user?.id && a.dkpSpent ? a.dkpSpent : 0);
  }, 0) ?? 0;
  const myEffectiveBalance = myRawBalance - myCommitted;

  const isLoading = sessionQuery.isLoading || eventQuery.isLoading;

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const isSnakeDraft = session?.method === 'SNAKE_DRAFT';

  return (
    <div className={isSnakeDraft ? 'space-y-5' : 'max-w-2xl space-y-5'}>
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

      {/* No session yet — managers only */}
      {!session && isManager && (
        <SetupForm guildId={guildId!} eventId={eventId!} onCreated={invalidate} />
      )}
      {!session && !isManager && (
        <p className="text-sm text-muted-foreground italic py-4">No loot session has been started for this event yet.</p>
      )}

      {/* Active session */}
      {session && (
        <div className={isSnakeDraft ? 'flex gap-5 items-start' : ''}>
        {/* Main content column */}
        <div className={isSnakeDraft ? 'flex-1 min-w-0 space-y-5' : ''}>
        <>
          {/* Method + DKP award row — managers only */}
          {isManager && <Card>
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
          </Card>}

          {/* Snake draft order */}
          {session.method === 'SNAKE_DRAFT' && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">🐍 Draft Order</CardTitle>
                  {isManager && session.status === 'OPEN' && !session.draftStarted && (
                    <div className="flex items-center gap-2">
                      {!startConfirm ? (
                        <>
                          <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={handleShuffle}>
                            <Shuffle className="h-3 w-3" />
                            Shuffle
                          </Button>
                          <Button
                            size="sm"
                            className="gap-1 h-7 text-xs"
                            onClick={() => setStartConfirm(true)}
                            disabled={session.draftOrder.length === 0}
                          >
                            <Play className="h-3 w-3" />
                            Start Draft
                          </Button>
                        </>
                      ) : (
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground">Draft order is locked on start.</span>
                          <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => startDraftMutation.mutate()} disabled={startDraftMutation.isPending}>
                            {startDraftMutation.isPending ? 'Starting…' : 'Yes, Start'}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setStartConfirm(false)}>
                            Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {nextPickerName && session.status === 'OPEN' && (isManager || isCurrentPicker) && (
                  <div className="mb-3 space-y-2">
                    <div className="rounded-md bg-primary/10 border border-primary/30 px-3 py-2 flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-primary">Now picking: {nextPickerName}</span>
                      {isManager && (!skipConfirm ? (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0" onClick={() => setSkipConfirm(true)}>
                          <SkipForward className="h-3 w-3" />
                          Skip Turn
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground">Skip {nextPickerName}?</span>
                          <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => skipMutation.mutate()} disabled={skipMutation.isPending}>
                            {skipMutation.isPending ? 'Skipping…' : 'Yes, Skip'}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSkipConfirm(false)}>
                            Cancel
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {session.draftOrder.map((userId, i) => {
                    const name = resolveUsername(userId, eligiblePlayers.find((p) => p.userId === userId)?.username ?? allRsvpMap.get(userId) ?? userId, user?.id);
                    const isCurrent = userId === nextPickerId;
                    const canRemove = isManager && session.status === 'OPEN' && !session.draftStarted;
                    return (
                      <span
                        key={userId}
                        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border ${isCurrent ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
                      >
                        {i + 1}. {name}
                        {canRemove && (
                          <button
                            type="button"
                            className="ml-1 opacity-50 hover:opacity-100 leading-none"
                            onClick={() => updateMutation.mutate({ draftOrder: session.draftOrder.filter((id) => id !== userId) })}
                            title={`Remove ${name}`}
                          >
                            ×
                          </button>
                        )}
                      </span>
                    );
                  })}
                  {session.draftOrder.length === 0 && (
                    <p className="text-sm text-muted-foreground italic">No members in draft order yet.</p>
                  )}
                </div>
                {isManager && session.status === 'OPEN' && !session.draftStarted && (
                  <div className="mt-3 pt-3 border-t border-border space-y-2">
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">Add members to draft:</p>
                      <input
                        type="text"
                        placeholder="Search…"
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                        className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
                      />
                    </div>
                    {notInDraft.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {notInDraft.map((p) => (
                          <button
                            key={p.userId}
                            type="button"
                            className="rounded-full px-3 py-1 text-xs font-medium border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                            onClick={() => updateMutation.mutate({ draftOrder: [...session.draftOrder, p.userId] })}
                          >
                            + {resolveUsername(p.userId, p.username, user?.id)}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">{memberSearch ? 'No members match.' : 'All known members are already in the draft.'}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Item list */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wide">Items ({session.items.length})</h2>
              <div className="flex items-center gap-3">
                {session.items.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {session.items.filter((i) => i.assignments.length > 0).length} / {session.items.length} assigned
                  </span>
                )}
                {session.items.some((i) => i.assignments.length > 0) && (
                  <button
                    type="button"
                    onClick={() => setHideAssigned((v) => !v)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border transition-colors ${
                      hideAssigned
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    <EyeOff className="h-3 w-3" />
                    {hideAssigned ? 'Showing available' : 'Hide assigned'}
                  </button>
                )}
              </div>
            </div>

            {[...session.items]
              .sort((a, b) => {
                const aAssigned = a.assignments.length > 0 ? 1 : 0;
                const bAssigned = b.assignments.length > 0 ? 1 : 0;
                if (aAssigned !== bAssigned) return aAssigned - bAssigned;
                return a.sortOrder - b.sortOrder;
              })
              .filter((item) => !hideAssigned || item.assignments.length === 0)
              .map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                session={session}
                auction={auctionQuery.data?.[item.id] ?? null}
                dkpBalances={dkpQuery.data ?? []}
                eligiblePlayers={eligiblePlayers}
                allRsvpMap={allRsvpMap}
                allAssignmentCount={allAssignmentCount}
                skipCount={skipCount}
                onRolled={invalidate}
                onAssigned={invalidate}
                onDelete={invalidate}
                onAuctionChange={invalidate}
                guildId={guildId!}
                eventId={eventId!}
                currentUserId={user?.id}
                myEffectiveBalance={myEffectiveBalance}
                isManager={isManager}
              />
            ))}

            {/* Add item — managers only */}
            {isManager && session.status === 'OPEN' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newItemName.trim()) addItemMutation.mutate(newItemName.trim());
                }}
                className="flex gap-2"
              >
                <div className="relative flex-1">
                  <input
                    ref={newItemInputRef}
                    className={inputCls}
                    placeholder="Item name…"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    onFocus={() => setNewItemInputFocused(true)}
                    onBlur={() => setNewItemInputFocused(false)}
                    autoComplete="off"
                  />
                  {newItemInputFocused && newItemName.length >= 3 && (suggestQuery.data?.length ?? 0) > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-border bg-card shadow-lg max-h-56 overflow-y-auto">
                      {suggestQuery.data!.map((s) => (
                        <button
                          key={`${s.type}-${s.id}`}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setNewItemName(s.name);
                            setNewItemInputFocused(false);
                            newItemInputRef.current?.focus();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                        >
                          <span className="flex-1 truncate">{s.name}</span>
                          {s.detail && <span className="text-xs text-muted-foreground shrink-0">{s.detail}</span>}
                          <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${s.type === 'item' ? 'bg-primary/10 text-primary' : 'bg-amber-500/10 text-amber-500'}`}>
                            {s.type}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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

          {/* Complete — managers only */}
          {isManager && session.status === 'OPEN' && (
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <div className="space-y-1">
                {session.dkpAward > 0 && (
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Coins className="h-3.5 w-3.5" />
                    +{session.dkpAward} DKP to {eligiblePlayers.length} attendee{eligiblePlayers.length !== 1 ? 's' : ''} on completion
                  </span>
                )}
                <p className="text-xs text-muted-foreground">Changes are saved automatically.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => navigate(`/dashboard/servers/${guildId}`)}
                  className="gap-1"
                >
                  <Save className="h-4 w-4" />
                  Save & Exit
                </Button>
                <Button
                  onClick={() => completeMutation.mutate()}
                  disabled={completeMutation.isPending}
                  className="gap-1"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {completeMutation.isPending ? 'Completing…' : 'Complete & Post to Discord'}
                </Button>
              </div>
            </div>
          )}

          {session.status === 'COMPLETED' && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-400">
              ✅ Loot session completed. Results posted to the event forum thread.
            </div>
          )}
        </>
        </div>{/* end main content column */}

        {/* Queue card — snake draft only */}
        {isSnakeDraft && (
          <div className="sticky top-4 self-start">
            <QueueCard
              session={session}
              guildId={guildId!}
              eventId={eventId!}
            />
          </div>
        )}
        </div>
      )}
    </div>
  );
}
