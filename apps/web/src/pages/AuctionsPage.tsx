import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Gavel,
  Timer,
  X,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Users,
  Globe,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { auctionsApi } from '@/api/auctions';
import { lootApi } from '@/api/loot';
import { eventsApi } from '@/api/events';
import { useAuth } from '@/hooks/useAuth';
import { resolveUsername } from '@/lib/displayName';
import type { AuctionDto } from '@dem/shared';

// ── Constants ─────────────────────────────────────────────────────────────────

const MEDALS = ['🥇', '🥈', '🥉'];

const DURATION_OPTIONS = [
  { label: '30 s', value: 30 },
  { label: '1 min', value: 60 },
  { label: '2 min', value: 120 },
  { label: '5 min', value: 300 },
  { label: '10 min', value: 600 },
];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── AuctionCard ───────────────────────────────────────────────────────────────

function AuctionCard({
  auction,
  guildId,
  currentUserId,
  myRawBalance,
  isManager,
  onChanged,
}: {
  auction: AuctionDto;
  guildId: string;
  currentUserId?: string;
  myRawBalance: number;
  isManager: boolean;
  onChanged: () => void;
}) {
  const [bidInput, setBidInput] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(auction.secondsRemaining);

  // Client-side countdown seeded from server's secondsRemaining
  useEffect(() => {
    if (auction.status !== 'OPEN') return;
    setSecondsLeft(auction.secondsRemaining);
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auction.id, auction.status, auction.secondsRemaining]);

  const bidMutation = useMutation({
    mutationFn: () =>
      auctionsApi.placeBid(guildId, auction.id, { maxBid: Number(bidInput) }),
    onSuccess: () => {
      setBidInput('');
      onChanged();
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => auctionsApi.close(guildId, auction.id),
    onSuccess: onChanged,
  });

  const cancelMutation = useMutation({
    mutationFn: () => auctionsApi.cancel(guildId, auction.id),
    onSuccess: onChanged,
  });

  const myBid = auction.bids.find((b) => b.userId === currentUserId);
  const bidVal = bidInput !== '' ? Number(bidInput) : 0;
  const overBid = bidInput !== '' && bidVal > myRawBalance;
  const belowCurrent = !!myBid && bidInput !== '' && bidVal <= myBid.maxBid;
  const bidInvalid = !bidInput || bidVal <= 0 || overBid || belowCurrent;
  const urgentTime = secondsLeft <= 30 && secondsLeft > 0;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{auction.title}</CardTitle>
            {auction.description && (
              <p className="text-sm text-muted-foreground mt-0.5">{auction.description}</p>
            )}
          </div>
          <span
            className={`flex items-center gap-1 shrink-0 text-sm font-mono font-semibold tabular-nums ${
              urgentTime
                ? 'text-destructive animate-pulse'
                : 'text-muted-foreground'
            }`}
          >
            <Timer className="h-3.5 w-3.5" />
            {secondsLeft === 0 ? 'Closing…' : formatTime(secondsLeft)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Current standings */}
        <div className="space-y-1">
          {auction.bids.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No bids yet — be the first!</p>
          ) : (
            auction.bids.map((b, i) => (
              <div
                key={b.userId}
                className={`flex items-center justify-between text-sm px-2 py-1 rounded ${
                  b.userId === currentUserId ? 'bg-primary/10 font-medium' : ''
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span>{MEDALS[i] ?? `${i + 1}.`}</span>
                  <span>{resolveUsername(b.userId, b.username, currentUserId)}</span>
                  {b.userId === currentUserId && (
                    <span className="text-xs text-muted-foreground">(you)</span>
                  )}
                </span>
                <span className="font-mono tabular-nums">{b.amount} DKP</span>
              </div>
            ))
          )}
        </div>

        {/* Bid input — any authenticated user */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Max Bid
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={myBid ? myBid.maxBid + 1 : 1}
              max={myRawBalance}
              value={bidInput}
              onChange={(e) => setBidInput(e.target.value)}
              placeholder="e.g. 250"
              className={`flex-1 rounded-md border px-2 py-1.5 text-sm ${
                overBid || belowCurrent
                  ? 'border-destructive bg-destructive/10 text-destructive'
                  : 'border-input bg-background'
              }`}
            />
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
            Your available DKP:{' '}
            <span className={myRawBalance <= 0 ? 'text-destructive' : ''}>{myRawBalance}</span>
          </p>
          {overBid && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Max bid exceeds your available balance
            </p>
          )}
          {belowCurrent && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Must exceed your current max of{' '}
              {myBid!.maxBid} DKP
            </p>
          )}
          {bidMutation.isError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />{' '}
              {(bidMutation.error as Error).message}
            </p>
          )}
        </div>

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
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AuctionsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, guilds } = useAuth();

  const isManager = guilds.some((g) => g.id === guildId);

  // Create form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [durationSecs, setDurationSecs] = useState(120);
  const [restrictToEvent, setRestrictToEvent] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState('');

  const auctionsQuery = useQuery({
    queryKey: ['auctions', guildId],
    queryFn: () => auctionsApi.list(guildId!),
    enabled: !!guildId,
    refetchInterval: 2000,
  });

  const eventsQuery = useQuery({
    queryKey: ['events', guildId, 'upcoming'],
    queryFn: () => eventsApi.list(guildId!),
    enabled: !!guildId && isManager,
  });

  const myDkpQuery = useQuery({
    queryKey: ['dkp-me', guildId],
    queryFn: () => lootApi.getMyDkp(guildId!),
    enabled: !!guildId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['auctions', guildId] });
    queryClient.invalidateQueries({ queryKey: ['dkp-me', guildId] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      auctionsApi.create(guildId!, {
        title: title.trim(),
        description: description.trim() || undefined,
        durationSecs,
        eventId: restrictToEvent && selectedEventId ? selectedEventId : undefined,
      }),
    onSuccess: () => {
      setTitle('');
      setDescription('');
      setDurationSecs(120);
      setRestrictToEvent(false);
      setSelectedEventId('');
      invalidate();
    },
  });

  const upcomingEvents = eventsQuery.data ?? [];

  const auctions = auctionsQuery.data ?? [];
  const openAuctions = auctions.filter((a) => a.status === 'OPEN');
  const pastAuctions = auctions.filter(
    (a) => a.status === 'CLOSED' || a.status === 'CANCELLED',
  );
  const myRawBalance = myDkpQuery.data?.balance ?? 0;

  if (auctionsQuery.isLoading) {
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
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Gavel className="h-6 w-6" />
          DKP Auctions
        </h1>
        <p className="text-muted-foreground mt-0.5">
          Standalone DKP auctions — open to all guild members.
        </p>
      </div>

      {/* Create form (managers only) */}
      {isManager && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Create Auction</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Item / Title
              </label>
              <input
                type="text"
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Exotic Armor Chest Piece"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Description (optional)
              </label>
              <textarea
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Additional details about the item…"
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>
            {/* Open to */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Open to</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRestrictToEvent(false)}
                  className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    !restrictToEvent
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Globe className="h-3.5 w-3.5" />
                  All members
                </button>
                <button
                  type="button"
                  onClick={() => setRestrictToEvent(true)}
                  className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    restrictToEvent
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Users className="h-3.5 w-3.5" />
                  Event attendees
                </button>
              </div>
              {restrictToEvent && (
                <select
                  value={selectedEventId}
                  onChange={(e) => setSelectedEventId(e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">— select an event —</option>
                  {upcomingEvents.map((ev) => (
                    <option key={ev.id} value={ev.id}>{ev.name}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Duration
                </label>
                <select
                  value={durationSecs}
                  onChange={(e) => setDurationSecs(Number(e.target.value))}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  {DURATION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1" />
              <Button
                className="gap-1.5 self-end"
                onClick={() => createMutation.mutate()}
                disabled={
                  !title.trim() ||
                  createMutation.isPending ||
                  openAuctions.length > 0 ||
                  (restrictToEvent && !selectedEventId)
                }
                title={openAuctions.length > 0 ? 'Close the current auction before starting a new one' : undefined}
              >
                <Plus className="h-4 w-4" />
                {createMutation.isPending ? 'Creating…' : 'Create Auction'}
              </Button>
            </div>
            {createMutation.isError && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />{' '}
                {(createMutation.error as Error).message}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Open auctions */}
      {openAuctions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wide flex items-center gap-1.5">
            <Gavel className="h-3.5 w-3.5" />
            Live Auctions ({openAuctions.length})
          </h2>
          {openAuctions.map((auction) => (
            <AuctionCard
              key={auction.id}
              auction={auction}
              guildId={guildId!}
              currentUserId={user?.id}
              myRawBalance={myRawBalance}
              isManager={isManager}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}

      {openAuctions.length === 0 && !isManager && (
        <div className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          <Gavel className="h-8 w-8 mx-auto mb-2 opacity-30" />
          No live auctions right now. Check back soon.
        </div>
      )}

      {openAuctions.length === 0 && isManager && (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No live auctions. Create one above to get started.
        </div>
      )}

      {/* Past auctions */}
      {pastAuctions.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wide">
            Past Auctions
          </h2>
          <Card>
            <CardContent className="pt-3 divide-y divide-border">
              {pastAuctions.map((auction) => (
                <div
                  key={auction.id}
                  className="flex items-center justify-between py-2.5 gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{auction.title}</p>
                    {auction.status === 'CLOSED' ? (
                      auction.winnerId ? (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <CheckCircle2 className="h-3 w-3 text-green-500" />
                          Won by{' '}
                          {resolveUsername(
                            auction.winnerId,
                            auction.winnerUsername ?? auction.winnerId,
                            user?.id,
                          )}{' '}
                          for {auction.winningBid} DKP
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-0.5 italic">
                          No bids received
                        </p>
                      )
                    ) : (
                      <p className="text-xs text-muted-foreground mt-0.5 italic">Cancelled</p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${
                      auction.status === 'CLOSED'
                        ? 'border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400'
                        : 'border-border text-muted-foreground'
                    }`}
                  >
                    {auction.status === 'CLOSED' ? 'Closed' : 'Cancelled'}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
