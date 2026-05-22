import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { assertEventViewer } from '../../lib/assertEventViewer.js';
import { triggerBot } from '../../lib/triggerBot.js';
import { ValidationError, optPosInt } from '../../lib/validate.js';
import type { ApiResponse, LootAuctionDto, LootAuctionBidDto } from '@dem/shared';

export const auctionRouter = Router();

// ── DTO helper ────────────────────────────────────────────────────────────────

type AuctionRow = {
  id: string; itemId: string; sessionId: string; guildId: string;
  durationSecs: number; closesAt: Date; status: string;
  winnerId: string | null; winnerUsername: string | null; winningBid: number | null;
  createdAt: Date; updatedAt: Date;
  bids: { userId: string; username: string; amount: number; maxBid: number; placedAt: Date }[];
};

function auctionToDto(a: AuctionRow, itemName: string): LootAuctionDto {
  const secondsRemaining = Math.max(0, Math.floor((a.closesAt.getTime() - Date.now()) / 1000));
  return {
    id: a.id,
    itemId: a.itemId,
    itemName,
    sessionId: a.sessionId,
    guildId: a.guildId,
    durationSecs: a.durationSecs,
    closesAt: a.closesAt.toISOString(),
    secondsRemaining,
    status: a.status as 'OPEN' | 'CLOSED' | 'CANCELLED',
    winnerId: a.winnerId,
    winnerUsername: a.winnerUsername,
    winningBid: a.winningBid,
    bids: [...a.bids]
      .sort((x, y) => y.amount - x.amount)
      .map((b): LootAuctionBidDto => ({
        userId: b.userId,
        username: b.username,
        amount: b.amount,
        maxBid: b.maxBid,
        placedAt: b.placedAt.toISOString(),
      })),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

// ── Proxy bidding helper ──────────────────────────────────────────────────────

function resolveProxy(
  bids: { userId: string; maxBid: number; placedAt: Date }[],
  increment = 1,
): Map<string, number> {
  if (bids.length === 0) return new Map();
  const sorted = [...bids].sort((a, b) =>
    b.maxBid !== a.maxBid
      ? b.maxBid - a.maxBid
      : a.placedAt.getTime() - b.placedAt.getTime(),
  );
  const result = new Map<string, number>();
  const winner = sorted[0]!;
  const runnerUp = sorted[1];
  if (!runnerUp) {
    result.set(winner.userId, winner.maxBid);
  } else {
    result.set(winner.userId, Math.min(winner.maxBid, runnerUp.maxBid + increment));
    for (let i = 1; i < sorted.length; i++) {
      result.set(sorted[i]!.userId, sorted[i]!.maxBid);
    }
  }
  return result;
}

// ── Auto-close helper ─────────────────────────────────────────────────────────
// Called lazily on GET; also called by the bot scheduler every minute.

export async function maybeAutoClose(auctionId: string): Promise<void> {
  const auction = await prisma.lootAuction.findUnique({
    where: { id: auctionId },
    include: { bids: { orderBy: { amount: 'desc' } } },
  });
  if (!auction || auction.status !== 'OPEN' || auction.closesAt > new Date()) return;

  const top = auction.bids[0] ?? null;
  await prisma.$transaction(async (tx) => {
    if (top) {
      await tx.lootAssignment.deleteMany({ where: { itemId: auction.itemId } });
      await tx.lootAssignment.create({
        data: { itemId: auction.itemId, userId: top.userId, username: top.username, dkpSpent: top.amount },
      });
    }
    await tx.lootAuction.update({
      where: { id: auctionId },
      data: {
        status: 'CLOSED',
        ...(top ? { winnerId: top.userId, winnerUsername: top.username, winningBid: top.amount } : {}),
      },
    });
  });

  triggerBot(`/trigger/auction-close/${auctionId}`);
  if (top) {
    const session = await prisma.lootSession.findUnique({
      where: { id: auction.sessionId },
      select: { eventId: true },
    });
    if (session) triggerBot(`/trigger/complete/${session.eventId}`);
  }
}

// ── GET /api/guilds/:guildId/events/:eventId/loot/auctions ───────────────────
// Returns all auction states for this session keyed by itemId.

auctionRouter.get('/:guildId/events/:eventId/loot/auctions', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };

  if (!(await assertEventViewer(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const session = await prisma.lootSession.findUnique({
    where: { eventId },
    include: { items: true },
  });
  if (!session) {
    res.json({ success: true, data: {} } satisfies ApiResponse<Record<string, LootAuctionDto>>);
    return;
  }

  const auctions = await prisma.lootAuction.findMany({
    where: { sessionId: session.id },
    include: { bids: true },
  });

  // Lazy-close any expired auctions before returning
  for (const a of auctions) {
    if (a.status === 'OPEN' && a.closesAt <= new Date()) {
      await maybeAutoClose(a.id).catch(() => null);
    }
  }

  const fresh = await prisma.lootAuction.findMany({
    where: { sessionId: session.id },
    include: { bids: true },
  });

  const itemNameMap = new Map(session.items.map((i) => [i.id, i.name]));
  const data: Record<string, LootAuctionDto> = {};
  for (const a of fresh) {
    data[a.itemId] = auctionToDto(a, itemNameMap.get(a.itemId) ?? '');
  }

  res.json({ success: true, data } satisfies ApiResponse<Record<string, LootAuctionDto>>);
});

// ── POST /api/guilds/:guildId/events/:eventId/loot/items/:itemId/auction ─────
// Start a live auction for a DKP item.

auctionRouter.post('/:guildId/events/:eventId/loot/items/:itemId/auction', requireAuth, async (req, res) => {
  const { guildId, eventId, itemId } = req.params as { guildId: string; eventId: string; itemId: string };
  const body = req.body as Record<string, unknown>;

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  let durationSecs: number;
  try {
    durationSecs = optPosInt(body.durationSecs, 'durationSecs') ?? 120;
    if (durationSecs > 3600) throw new ValidationError('durationSecs cannot exceed 3600');
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ success: false, error: err.message } satisfies ApiResponse);
      return;
    }
    throw err;
  }

  const session = await prisma.lootSession.findUnique({ where: { eventId } });
  if (!session) {
    res.status(404).json({ success: false, error: 'No loot session found' } satisfies ApiResponse);
    return;
  }
  if (session.method !== 'DKP') {
    res.status(400).json({ success: false, error: 'Auctions are only available for DKP sessions' } satisfies ApiResponse);
    return;
  }

  const item = await prisma.lootItem.findUnique({ where: { id: itemId, sessionId: session.id } });
  if (!item) {
    res.status(404).json({ success: false, error: 'Item not found' } satisfies ApiResponse);
    return;
  }

  // Only one OPEN auction allowed per session at a time
  const openAuction = await prisma.lootAuction.findFirst({
    where: { sessionId: session.id, status: 'OPEN' },
  });
  if (openAuction) {
    res.status(409).json({
      success: false,
      error: 'Another auction is already open in this session. Close it first.',
    } satisfies ApiResponse);
    return;
  }

  // Cancel any lingering non-closed auction for this item
  await prisma.lootAuction.updateMany({
    where: { itemId, status: { not: 'CLOSED' } },
    data: { status: 'CANCELLED' },
  });

  const closesAt = new Date(Date.now() + durationSecs * 1000);
  const auction = await prisma.lootAuction.create({
    data: { itemId, sessionId: session.id, guildId, startedById: req.session.userId!, durationSecs, closesAt },
    include: { bids: true },
  });

  triggerBot(`/trigger/auction-start/${auction.id}`);

  res.status(201).json({
    success: true,
    data: auctionToDto(auction, item.name),
  } satisfies ApiResponse<LootAuctionDto>);
});

// ── POST /api/guilds/:guildId/events/:eventId/loot/items/:itemId/auction/bid ──
// Place or raise a bid. Bidder must be a confirmed attendee or guild manager.

auctionRouter.post('/:guildId/events/:eventId/loot/items/:itemId/auction/bid', requireAuth, async (req, res) => {
  const { guildId, eventId, itemId } = req.params as { guildId: string; eventId: string; itemId: string };
  const body = req.body as Record<string, unknown>;

  let maxBid: number;
  try {
    maxBid = optPosInt(body.maxBid, 'maxBid') ?? 0;
    if (maxBid <= 0) throw new ValidationError('maxBid must be greater than 0');
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

  const isManager = await assertGuildManager(req, guildId);

  const session = await prisma.lootSession.findUnique({ where: { eventId } });
  if (!session) {
    res.status(404).json({ success: false, error: 'No loot session found' } satisfies ApiResponse);
    return;
  }

  const auction = await prisma.lootAuction.findUnique({
    where: { itemId },
    include: { bids: true },
  });
  if (!auction || auction.status !== 'OPEN') {
    res.status(404).json({ success: false, error: 'No open auction for this item' } satisfies ApiResponse);
    return;
  }

  if (auction.closesAt <= new Date()) {
    await maybeAutoClose(auction.id);
    res.status(409).json({ success: false, error: 'Auction has already closed' } satisfies ApiResponse);
    return;
  }

  const userId = dbUser.discordId;

  // DKP eligibility is checked against live confirmedAttendees, not the draftOrder snapshot
  // taken at session creation — so players confirmed after the session opened can bid.
  const eventRow = await prisma.event.findFirst({ where: { id: eventId }, select: { confirmedAttendees: true } });
  const confirmedAttendees: string[] = eventRow?.confirmedAttendees ? JSON.parse(eventRow.confirmedAttendees) : [];
  if (!isManager && !confirmedAttendees.includes(userId)) {
    res.status(403).json({ success: false, error: 'You are not a confirmed attendee for this loot session' } satisfies ApiResponse);
    return;
  }

  // Validation: new maxBid must exceed current maxBid
  const existing = auction.bids.find((b) => b.userId === userId);
  if (existing && maxBid <= existing.maxBid) {
    res.status(400).json({
      success: false,
      error: `Max bid must exceed your current max of ${existing.maxBid} DKP`,
    } satisfies ApiResponse);
    return;
  }

  // Balance check against maxBid (worst-case spend)
  const bal = await prisma.dkpBalance.findUnique({ where: { guildId_userId: { guildId, userId } } });
  const won = await prisma.lootAssignment.findMany({
    where: { item: { sessionId: session.id }, userId },
    select: { dkpSpent: true },
  });
  const committed = won.reduce((s, a) => s + (a.dkpSpent ?? 0), 0);
  const effective = (bal?.balance ?? 0) - committed;
  if (maxBid > effective) {
    res.status(400).json({
      success: false,
      error: `Insufficient DKP: max bid ${maxBid} but only ${effective} available`,
    } satisfies ApiResponse);
    return;
  }

  const username = dbUser.globalName ?? dbUser.username;

  // Place bid and resolve proxy amounts in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.lootAuctionBid.upsert({
      where: { auctionId_userId: { auctionId: auction.id, userId } },
      create: { auctionId: auction.id, userId, username, amount: maxBid, maxBid },
      update: { username, maxBid, placedAt: new Date() },
    });
    const allBids = await tx.lootAuctionBid.findMany({ where: { auctionId: auction.id } });
    const resolved = resolveProxy(allBids);
    for (const [uid, amt] of resolved) {
      await tx.lootAuctionBid.update({
        where: { auctionId_userId: { auctionId: auction.id, userId: uid } },
        data: { amount: amt },
      });
    }
  });

  triggerBot(`/trigger/auction-bid/${auction.id}`);

  const [updated, item] = await Promise.all([
    prisma.lootAuction.findUnique({ where: { id: auction.id }, include: { bids: true } }),
    prisma.lootItem.findUnique({ where: { id: itemId } }),
  ]);

  res.json({
    success: true,
    data: auctionToDto(updated!, item!.name),
  } satisfies ApiResponse<LootAuctionDto>);
});

// ── POST /api/guilds/:guildId/events/:eventId/loot/items/:itemId/auction/close ─
// Close an open auction immediately, awarding the item to the highest bidder.

auctionRouter.post('/:guildId/events/:eventId/loot/items/:itemId/auction/close', requireAuth, async (req, res) => {
  const { guildId, eventId, itemId } = req.params as { guildId: string; eventId: string; itemId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const auction = await prisma.lootAuction.findUnique({
    where: { itemId },
    include: { bids: { orderBy: { amount: 'desc' } } },
  });
  if (!auction || auction.status !== 'OPEN') {
    res.status(404).json({ success: false, error: 'No open auction for this item' } satisfies ApiResponse);
    return;
  }

  const top = auction.bids[0] ?? null;
  await prisma.$transaction(async (tx) => {
    if (top) {
      await tx.lootAssignment.deleteMany({ where: { itemId } });
      await tx.lootAssignment.create({
        data: { itemId, userId: top.userId, username: top.username, dkpSpent: top.amount },
      });
    }
    await tx.lootAuction.update({
      where: { id: auction.id },
      data: {
        status: 'CLOSED',
        closesAt: new Date(),
        ...(top ? { winnerId: top.userId, winnerUsername: top.username, winningBid: top.amount } : {}),
      },
    });
  });

  triggerBot(`/trigger/auction-close/${auction.id}`);
  if (top) triggerBot(`/trigger/complete/${eventId}`);

  const [updated, item] = await Promise.all([
    prisma.lootAuction.findUnique({ where: { id: auction.id }, include: { bids: true } }),
    prisma.lootItem.findUnique({ where: { id: itemId } }),
  ]);

  res.json({
    success: true,
    data: auctionToDto(updated!, item!.name),
  } satisfies ApiResponse<LootAuctionDto>);
});

// ── DELETE /api/guilds/:guildId/events/:eventId/loot/items/:itemId/auction ────
// Cancel an open auction with no winner awarded.

auctionRouter.delete('/:guildId/events/:eventId/loot/items/:itemId/auction', requireAuth, async (req, res) => {
  const { guildId, eventId: _eventId, itemId } = req.params as { guildId: string; eventId: string; itemId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const auction = await prisma.lootAuction.findUnique({ where: { itemId } });
  if (!auction || auction.status !== 'OPEN') {
    res.status(404).json({ success: false, error: 'No open auction to cancel' } satisfies ApiResponse);
    return;
  }

  await prisma.lootAuction.update({
    where: { id: auction.id },
    data: { status: 'CANCELLED' },
  });

  triggerBot(`/trigger/auction-close/${auction.id}`);
  res.json({ success: true } satisfies ApiResponse);
});
