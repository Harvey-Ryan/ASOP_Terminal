import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { triggerBot } from '../../lib/triggerBot.js';
import { ValidationError, requireStr, optStr, optPosInt } from '../../lib/validate.js';
import type { ApiResponse, AuctionDto, AuctionBidDto } from '@dem/shared';

export const auctionRouter = Router();

// ── DTO helper ────────────────────────────────────────────────────────────────

type AuctionRow = {
  id: string;
  guildId: string;
  title: string;
  description: string | null;
  durationSecs: number;
  closesAt: Date;
  status: string;
  winnerId: string | null;
  winnerUsername: string | null;
  winningBid: number | null;
  createdAt: Date;
  updatedAt: Date;
  bids: { userId: string; username: string; amount: number; placedAt: Date }[];
};

function auctionToDto(a: AuctionRow): AuctionDto {
  const secondsRemaining = Math.max(0, Math.floor((a.closesAt.getTime() - Date.now()) / 1000));
  return {
    id: a.id,
    guildId: a.guildId,
    title: a.title,
    description: a.description,
    durationSecs: a.durationSecs,
    closesAt: a.closesAt.toISOString(),
    secondsRemaining,
    status: a.status as 'OPEN' | 'CLOSED' | 'CANCELLED',
    winnerId: a.winnerId,
    winnerUsername: a.winnerUsername,
    winningBid: a.winningBid,
    bids: [...a.bids]
      .sort((x, y) => y.amount - x.amount)
      .map((b): AuctionBidDto => ({
        userId: b.userId,
        username: b.username,
        amount: b.amount,
        placedAt: b.placedAt.toISOString(),
      })),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

// ── Inline applyDkp helper ────────────────────────────────────────────────────

async function applyDkpForAuction(
  guildId: string,
  userId: string,
  username: string,
  amount: number,
  title: string,
): Promise<void> {
  const balance = await prisma.dkpBalance.upsert({
    where: { guildId_userId: { guildId, userId } },
    create: { guildId, userId, username, balance: 0 },
    update: {},
  });
  await prisma.dkpBalance.update({
    where: { id: balance.id },
    data: { balance: { increment: -amount }, username },
  });
  await prisma.dkpTransaction.create({
    data: {
      balanceId: balance.id,
      guildId,
      userId,
      username,
      amount: -amount,
      reason: `Standalone Auction: ${title}`,
    },
  });
}

// ── Auto-close helper ─────────────────────────────────────────────────────────
// Called lazily on GET and on bid expiry check. Idempotent via updateMany.

export async function maybeAutoCloseStandalone(auctionId: string): Promise<void> {
  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    include: { bids: { orderBy: { amount: 'desc' } } },
  });
  if (!auction || auction.status !== 'OPEN' || auction.closesAt > new Date()) return;

  const top = auction.bids[0] ?? null;

  // Atomic claim — only one caller wins the race
  const { count } = await prisma.auction.updateMany({
    where: { id: auctionId, status: 'OPEN' },
    data: {
      status: 'CLOSED',
      ...(top ? { winnerId: top.userId, winnerUsername: top.username, winningBid: top.amount } : {}),
    },
  });
  if (count === 0) return; // already closed by a concurrent call

  if (top) {
    await applyDkpForAuction(auction.guildId, top.userId, top.username, top.amount, auction.title);
  }

  triggerBot(`/trigger/standalone-auction-close/${auctionId}`);
}

// ── GET /api/guilds/:guildId/auctions ─────────────────────────────────────────
// Returns OPEN auctions first (sorted by closesAt asc), then CLOSED/CANCELLED
// by updatedAt desc. Lazily closes any expired OPEN auctions first.

auctionRouter.get('/:guildId/auctions', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };

  // Lazy-close any expired auctions
  const expired = await prisma.auction.findMany({
    where: { guildId, status: 'OPEN', closesAt: { lte: new Date() } },
    select: { id: true },
  });
  for (const { id } of expired) {
    await maybeAutoCloseStandalone(id).catch(() => null);
  }

  // Fetch up to 20 auctions: OPEN first, then recent closed/cancelled
  const [open, recent] = await Promise.all([
    prisma.auction.findMany({
      where: { guildId, status: 'OPEN' },
      include: { bids: true },
      orderBy: { closesAt: 'asc' },
    }),
    prisma.auction.findMany({
      where: { guildId, status: { in: ['CLOSED', 'CANCELLED'] } },
      include: { bids: true },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
  ]);

  const data = [...open, ...recent].map((a) => auctionToDto(a));
  res.json({ success: true, data } satisfies ApiResponse<AuctionDto[]>);
});

// ── POST /api/guilds/:guildId/auctions ────────────────────────────────────────
// Create a new standalone auction (managers only).

auctionRouter.post('/:guildId/auctions', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const body = req.body as Record<string, unknown>;

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  let title: string;
  let description: string | null;
  let durationSecs: number;

  try {
    title = requireStr(body.title, 'title', 100);
    description = optStr(body.description, 'description', 500);
    durationSecs = optPosInt(body.durationSecs, 'durationSecs') ?? 120;
    if (durationSecs > 3600) throw new ValidationError('durationSecs cannot exceed 3600');
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ success: false, error: err.message } satisfies ApiResponse);
      return;
    }
    throw err;
  }

  const openAuction = await prisma.auction.findFirst({
    where: { guildId, status: 'OPEN' },
  });
  if (openAuction) {
    res.status(409).json({
      success: false,
      error: 'An auction is already open in this server. Close it first.',
    } satisfies ApiResponse);
    return;
  }

  const closesAt = new Date(Date.now() + durationSecs * 1000);
  const auction = await prisma.auction.create({
    data: {
      guildId,
      title,
      description,
      startedById: req.session.userId!,
      durationSecs,
      closesAt,
    },
    include: { bids: true },
  });

  triggerBot(`/trigger/standalone-auction-start/${auction.id}`);

  res.status(201).json({
    success: true,
    data: auctionToDto(auction),
  } satisfies ApiResponse<AuctionDto>);
});

// ── POST /api/guilds/:guildId/auctions/:auctionId/bid ────────────────────────
// Place or raise a bid. Any authenticated guild user can bid (raw DKP check only).

auctionRouter.post('/:guildId/auctions/:auctionId/bid', requireAuth, async (req, res) => {
  const { guildId, auctionId } = req.params as { guildId: string; auctionId: string };
  const body = req.body as Record<string, unknown>;

  let amount: number;
  try {
    amount = optPosInt(body.amount, 'amount') ?? 0;
    if (amount <= 0) throw new ValidationError('amount must be greater than 0');
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ success: false, error: err.message } satisfies ApiResponse);
      return;
    }
    throw err;
  }

  const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
  if (!dbUser) {
    res.status(401).json({ success: false, error: 'Unauthorized' } satisfies ApiResponse);
    return;
  }

  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    include: { bids: true },
  });

  if (!auction || auction.guildId !== guildId) {
    res.status(404).json({ success: false, error: 'Auction not found' } satisfies ApiResponse);
    return;
  }

  if (auction.status !== 'OPEN') {
    res.status(409).json({ success: false, error: 'Auction is not open' } satisfies ApiResponse);
    return;
  }

  if (auction.closesAt <= new Date()) {
    await maybeAutoCloseStandalone(auction.id);
    res.status(409).json({ success: false, error: 'Auction has already closed' } satisfies ApiResponse);
    return;
  }

  const userId = dbUser.discordId;
  const username = dbUser.globalName ?? dbUser.username;

  // Bid must exceed current standing bid for this user
  const existing = auction.bids.find((b) => b.userId === userId);
  if (existing && amount <= existing.amount) {
    res.status(400).json({
      success: false,
      error: `Bid must exceed your current bid of ${existing.amount} DKP`,
    } satisfies ApiResponse);
    return;
  }

  // Raw DKP balance check — no session-committed subtraction for standalone
  const bal = await prisma.dkpBalance.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  const rawBalance = bal?.balance ?? 0;

  if (amount > rawBalance) {
    res.status(400).json({
      success: false,
      error: `Insufficient DKP: bid ${amount} but only ${rawBalance} available`,
    } satisfies ApiResponse);
    return;
  }

  await prisma.auctionBid.upsert({
    where: { auctionId_userId: { auctionId: auction.id, userId } },
    create: { auctionId: auction.id, userId, username, amount },
    update: { username, amount, placedAt: new Date() },
  });

  triggerBot(`/trigger/standalone-auction-bid/${auction.id}`);

  const updated = await prisma.auction.findUnique({
    where: { id: auction.id },
    include: { bids: true },
  });

  res.json({
    success: true,
    data: auctionToDto(updated!),
  } satisfies ApiResponse<AuctionDto>);
});

// ── POST /api/guilds/:guildId/auctions/:auctionId/close ──────────────────────
// Force-close an open auction immediately (managers only).

auctionRouter.post('/:guildId/auctions/:auctionId/close', requireAuth, async (req, res) => {
  const { guildId, auctionId } = req.params as { guildId: string; auctionId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    include: { bids: { orderBy: { amount: 'desc' } } },
  });

  if (!auction || auction.guildId !== guildId) {
    res.status(404).json({ success: false, error: 'Auction not found' } satisfies ApiResponse);
    return;
  }

  if (auction.status !== 'OPEN') {
    res.status(409).json({ success: false, error: 'Auction is not open' } satisfies ApiResponse);
    return;
  }

  const top = auction.bids[0] ?? null;

  const { count } = await prisma.auction.updateMany({
    where: { id: auctionId, status: 'OPEN' },
    data: {
      status: 'CLOSED',
      closesAt: new Date(),
      ...(top ? { winnerId: top.userId, winnerUsername: top.username, winningBid: top.amount } : {}),
    },
  });

  if (count > 0 && top) {
    await applyDkpForAuction(auction.guildId, top.userId, top.username, top.amount, auction.title);
  }

  triggerBot(`/trigger/standalone-auction-close/${auctionId}`);

  const updated = await prisma.auction.findUnique({
    where: { id: auctionId },
    include: { bids: true },
  });

  res.json({
    success: true,
    data: auctionToDto(updated!),
  } satisfies ApiResponse<AuctionDto>);
});

// ── DELETE /api/guilds/:guildId/auctions/:auctionId ──────────────────────────
// Cancel an open auction with no winner (managers only).

auctionRouter.delete('/:guildId/auctions/:auctionId', requireAuth, async (req, res) => {
  const { guildId, auctionId } = req.params as { guildId: string; auctionId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const auction = await prisma.auction.findUnique({ where: { id: auctionId } });

  if (!auction || auction.guildId !== guildId) {
    res.status(404).json({ success: false, error: 'Auction not found' } satisfies ApiResponse);
    return;
  }

  if (auction.status !== 'OPEN') {
    res.status(409).json({ success: false, error: 'Auction is not open' } satisfies ApiResponse);
    return;
  }

  await prisma.auction.update({
    where: { id: auctionId },
    data: { status: 'CANCELLED' },
  });

  triggerBot(`/trigger/standalone-auction-close/${auctionId}`);

  res.json({ success: true } satisfies ApiResponse);
});
