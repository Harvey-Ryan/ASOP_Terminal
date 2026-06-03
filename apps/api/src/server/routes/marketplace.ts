import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import type { ApiResponse, MarketplaceListingDto, TradeDto, TradeMessageDto, CreateTradeBody, InventoryItemType, TradeStatus } from '@dem/shared';

export const marketplaceRouter = Router();

// ── Discord DM helper ─────────────────────────────────────────────────────────
// Best-effort: silently swallows all errors so a failed DM never breaks the
// main request.

const WEB_URL = process.env['WEB_URL'] ?? 'http://localhost:5173';
const NOTIF_SETTINGS_URL = `${WEB_URL}/dashboard/settings/notifications`;
const NOTIF_FOOTER = `\n\nChange notification settings: ${NOTIF_SETTINGS_URL}`;

async function sendBotDm(userId: string, content: string): Promise<void> {
  const token = process.env['DISCORD_TOKEN'];
  if (!token) return;
  try {
    const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: userId }),
    });
    if (!dmRes.ok) return;
    const { id: channelId } = await dmRes.json() as { id: string };
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  } catch {
    // intentionally swallowed
  }
}

// ── Notification preference lookup ────────────────────────────────────────────
// Looks up prefs by Discord snowflake. Returns all-enabled defaults if the user
// has never logged in or has no saved preferences.

type NotifKey = 'dmTradeRequest' | 'dmTradeStatus' | 'dmTradeCancelled' | 'dmTradeMessage';

async function canSendDm(discordId: string, key: NotifKey): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { discordId },
    select: {
      notificationPrefs: {
        select: { dmTradeRequest: true, dmTradeStatus: true, dmTradeCancelled: true, dmTradeMessage: true },
      },
    },
  });
  // Unknown user or no saved prefs row → default opt-in
  if (!user || !user.notificationPrefs) return true;
  return user.notificationPrefs[key];
}

// ── Trade message DM debounce ─────────────────────────────────────────────────
// Keyed by "recipientId:tradeId". A DM is only sent if no DM has been sent for
// this conversation in the last hour, preventing spam in rapid exchanges.

const DM_COOLDOWN_MS = 60 * 60 * 1000;
const dmCooldowns = new Map<string, number>();

async function maybeSendMessageDm(recipientId: string, tradeId: string, content: string) {
  if (!await canSendDm(recipientId, 'dmTradeMessage')) return;
  const key = `${recipientId}:${tradeId}`;
  const lastSent = dmCooldowns.get(key) ?? 0;
  if (Date.now() - lastSent < DM_COOLDOWN_MS) return;
  dmCooldowns.set(key, Date.now());
  sendBotDm(recipientId, content).catch(() => null);
}

// ── DTO helper ────────────────────────────────────────────────────────────────

const LISTING_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function toListingDto(
  row: {
    id: string; guildId: string; userId: string; username: string;
    itemType: string; externalItemId: number; itemName: string;
    quantity: number; quantityListed: number | null; qualityLevel: number | null;
    location: string | null; askingPrice: number | null; priceNote: string | null;
    listedAt: Date | null; updatedAt: Date;
  },
  guildName: string,
): MarketplaceListingDto {
  return {
    id: row.id,
    guildId: row.guildId,
    guildName,
    userId: row.userId,
    username: row.username,
    itemType: row.itemType as InventoryItemType,
    externalItemId: row.externalItemId,
    itemName: row.itemName,
    quantity: row.quantity,
    quantityListed: row.quantityListed,
    qualityLevel: row.qualityLevel,
    location: row.location,
    askingPrice: row.askingPrice,
    priceNote: row.priceNote,
    listedAt: (row.listedAt ?? row.updatedAt).toISOString(),
  };
}

function tradeToDto(t: {
  id: string; inventoryEntryId: string; listingSnapshot: unknown;
  buyerGuildId: string; buyerId: string; buyerUsername: string;
  quantityRequested: number; note: string | null; status: string;
  sellerActive: boolean; unreadCount: number;
  createdAt: Date; updatedAt: Date;
}): TradeDto {
  return {
    id: t.id,
    inventoryEntryId: t.inventoryEntryId,
    listingSnapshot: t.listingSnapshot as MarketplaceListingDto,
    buyerGuildId: t.buyerGuildId,
    buyerId: t.buyerId,
    buyerUsername: t.buyerUsername,
    quantityRequested: t.quantityRequested,
    note: t.note,
    status: t.status as TradeStatus,
    sellerActive: t.sellerActive,
    unreadCount: t.unreadCount,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

// ── GET /api/marketplace/browse ───────────────────────────────────────────────
// Returns all active for-sale listings across ALL guilds.
// Query params:
//   q             – item name text search (case-insensitive, partial)
//   itemType      – ITEM | COMMODITY (omit for both)
//   filterGuildId – restrict to a single guild's listings
//   hasPriceOnly  – "true" → only listings with a fixed aUEC price
//   sort          – "newest" (default) | "price_asc"
//   limit         – max rows returned, capped at 50 (default 50)
//   offset        – rows to skip for load-more pagination (default 0)

const BROWSE_MAX = 50;

marketplaceRouter.get('/marketplace/browse', requireAuth, async (req, res) => {
  const q             = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  const itemType      = typeof req.query.itemType === 'string' ? req.query.itemType : undefined;
  const filterGuildId = typeof req.query.filterGuildId === 'string' ? req.query.filterGuildId : undefined;
  const hasPriceOnly  = req.query.hasPriceOnly === 'true';
  const sort          = req.query.sort === 'price_asc' ? 'price_asc' : 'newest';
  const rawLimit      = parseInt(String(req.query.limit ?? ''), 10);
  const rawOffset     = parseInt(String(req.query.offset ?? ''), 10);
  const limit         = Math.min(isNaN(rawLimit) || rawLimit <= 0 ? BROWSE_MAX : rawLimit, BROWSE_MAX);
  const offset        = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

  if (itemType && !['ITEM', 'COMMODITY'].includes(itemType)) {
    res.status(400).json({ success: false, error: 'itemType must be ITEM or COMMODITY' } satisfies ApiResponse);
    return;
  }

  const expiryCutoff = new Date(Date.now() - LISTING_TTL_MS);

  const orderBy =
    sort === 'price_asc'
      ? [{ askingPrice: { sort: 'asc' as const, nulls: 'last' as const } }, { listedAt: { sort: 'desc' as const, nulls: 'last' as const } }]
      : [{ listedAt: { sort: 'desc' as const, nulls: 'last' as const } }, { itemName: 'asc' as const }];

  const rows = await prisma.inventoryEntry.findMany({
    where: {
      forSale: true,
      memberActive: true,
      listedAt: { gte: expiryCutoff },
      ...(itemType ? { itemType } : {}),
      ...(filterGuildId ? { guildId: filterGuildId } : {}),
      ...(hasPriceOnly ? { askingPrice: { not: null } } : {}),
      ...(q ? { itemName: { contains: q, mode: 'insensitive' } } : {}),
    },
    orderBy,
    take: limit,
    skip: offset,
  });

  // Batch-load guild names only for the returned rows
  const guildIds = [...new Set(rows.map((r) => r.guildId))];
  const guilds = guildIds.length > 0
    ? await prisma.guild.findMany({
        where: { guildId: { in: guildIds } },
        select: { guildId: true, name: true },
      })
    : [];
  const guildNameMap = new Map(guilds.map((g) => [g.guildId, g.name]));

  const data: MarketplaceListingDto[] = rows.map((row) =>
    toListingDto(row, guildNameMap.get(row.guildId) ?? 'Unknown Guild'),
  );

  res.json({ success: true, data } satisfies ApiResponse<MarketplaceListingDto[]>);
});

// ── GET /api/guilds/:guildId/marketplace/trades/pending-count ─────────────────
// Lightweight count of PENDING incoming trades for the current user (as seller).
// Used by the sidebar badge — intentionally returns only the number, not the rows.
// IMPORTANT: must be registered before /:tradeId routes or Express matches "pending-count" as an id.

marketplaceRouter.get('/guilds/:guildId/marketplace/trades/pending-count', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });

  const count = await prisma.trade.count({
    where: { inventoryEntry: { guildId, userId: dbUser.discordId }, status: 'PENDING' },
  });

  res.json({ success: true, data: { count } } satisfies ApiResponse<{ count: number }>);
});

// ── GET /api/guilds/:guildId/marketplace/trades/unread-count ─────────────────
// Total unread message count across all of the user's trades in this guild.
// Used by the sidebar badge. IMPORTANT: must be registered before /:tradeId routes.

marketplaceRouter.get('/guilds/:guildId/marketplace/trades/unread-count', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });
  const me = dbUser.discordId;

  const trades = await prisma.trade.findMany({
    where: {
      OR: [
        { inventoryEntry: { guildId, userId: me } },
        { buyerGuildId: guildId, buyerId: me },
      ],
    },
    select: { id: true },
  });

  if (trades.length === 0) {
    res.json({ success: true, data: { count: 0 } } satisfies ApiResponse<{ count: number }>);
    return;
  }

  const tradeIds = trades.map((t) => t.id);
  const readRecords = await prisma.tradeMessageRead.findMany({
    where: { userId: me, tradeId: { in: tradeIds } },
  });
  const readMap = new Map(readRecords.map((r) => [r.tradeId, r.lastReadAt]));

  const counts = await Promise.all(
    tradeIds.map((id) =>
      prisma.tradeMessage.count({
        where: {
          tradeId: id,
          senderId: { not: me },
          ...(readMap.has(id) ? { createdAt: { gt: readMap.get(id)! } } : {}),
        },
      }),
    ),
  );

  const count = counts.reduce((sum, c) => sum + c, 0);
  res.json({ success: true, data: { count } } satisfies ApiResponse<{ count: number }>);
});

// ── GET /api/guilds/:guildId/marketplace/trades ───────────────────────────────
// Returns trades where the current user is buyer (outgoing) or seller (incoming).

marketplaceRouter.get('/guilds/:guildId/marketplace/trades', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });
  const me = dbUser.discordId;

  const [incoming, outgoing] = await Promise.all([
    prisma.trade.findMany({
      where: { inventoryEntry: { guildId, userId: me } },
      include: { inventoryEntry: { select: { memberActive: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.trade.findMany({
      where: { buyerGuildId: guildId, buyerId: me },
      include: { inventoryEntry: { select: { memberActive: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const allTrades = [...incoming, ...outgoing];

  // Load read records for the current user across all returned trades
  const readRecords = allTrades.length > 0
    ? await prisma.tradeMessageRead.findMany({
        where: { userId: me, tradeId: { in: allTrades.map((t) => t.id) } },
      })
    : [];
  const readMap = new Map(readRecords.map((r) => [r.tradeId, r.lastReadAt]));

  // Count messages sent by the other party after the user's lastReadAt
  const unreadCounts = await Promise.all(
    allTrades.map((t) => {
      const lastReadAt = readMap.get(t.id);
      return prisma.tradeMessage.count({
        where: {
          tradeId: t.id,
          senderId: { not: me },
          ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
        },
      });
    }),
  );

  const unreadMap = new Map(allTrades.map((t, i) => [t.id, unreadCounts[i]!]));

  res.json({
    success: true,
    data: {
      incoming: incoming.map((t) => tradeToDto({ ...t, sellerActive: t.inventoryEntry.memberActive, unreadCount: unreadMap.get(t.id) ?? 0 })),
      outgoing: outgoing.map((t) => tradeToDto({ ...t, sellerActive: t.inventoryEntry.memberActive, unreadCount: unreadMap.get(t.id) ?? 0 })),
    },
  } satisfies ApiResponse<{ incoming: TradeDto[]; outgoing: TradeDto[] }>);
});

// ── POST /api/guilds/:guildId/marketplace/trades ──────────────────────────────
// Buyer creates a trade request on a listing.

marketplaceRouter.post('/guilds/:guildId/marketplace/trades', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });
  const body = req.body as CreateTradeBody;

  if (!body.inventoryEntryId) {
    res.status(400).json({ success: false, error: 'inventoryEntryId is required' } satisfies ApiResponse); return;
  }
  if (typeof body.quantityRequested !== 'number' || body.quantityRequested <= 0) {
    res.status(400).json({ success: false, error: 'quantityRequested must be a positive number' } satisfies ApiResponse); return;
  }

  const listing = await prisma.inventoryEntry.findUnique({ where: { id: body.inventoryEntryId } });
  if (!listing || !listing.forSale || !listing.memberActive) {
    res.status(404).json({ success: false, error: 'Listing not found or no longer available' } satisfies ApiResponse); return;
  }
  if (listing.userId === dbUser.discordId) {
    res.status(400).json({ success: false, error: 'You cannot buy your own listing' } satisfies ApiResponse); return;
  }

  const available = listing.quantityListed ?? listing.quantity;
  if (body.quantityRequested > available) {
    res.status(400).json({ success: false, error: `Only ${available} available` } satisfies ApiResponse); return;
  }

  const existingPending = await prisma.trade.findFirst({
    where: { inventoryEntryId: listing.id, buyerId: dbUser.discordId, status: 'PENDING' },
  });
  if (existingPending) {
    res.status(409).json({ success: false, error: 'You already have a pending request for this listing' } satisfies ApiResponse); return;
  }

  const guild = await prisma.guild.findFirst({ where: { guildId: listing.guildId }, select: { name: true } });
  const snapshot = toListingDto(listing, guild?.name ?? 'Unknown Guild');

  const trade = await prisma.trade.create({
    data: {
      inventoryEntryId: listing.id,
      listingSnapshot: JSON.parse(JSON.stringify(snapshot)),
      buyerGuildId: guildId,
      buyerId: dbUser.discordId,
      buyerUsername: dbUser.globalName ?? dbUser.username,
      quantityRequested: body.quantityRequested,
      note: body.note?.trim() || null,
    },
  });

  const buyerName = dbUser.globalName ?? dbUser.username;
  canSendDm(listing.userId, 'dmTradeRequest').then((ok) => {
    if (!ok) return;
    sendBotDm(
      listing.userId,
      `New trade request! ${buyerName} wants to buy ${body.quantityRequested}x ${listing.itemName} from your marketplace listing.${body.note ? `\n"${body.note}"` : ''}\n\nSign in to accept or decline: ${WEB_URL}${NOTIF_FOOTER}`,
    );
  }).catch(() => null);

  res.status(201).json({ success: true, data: tradeToDto({ ...trade, sellerActive: true, unreadCount: 0 }) } satisfies ApiResponse<TradeDto>);
});

// ── PATCH /api/guilds/:guildId/marketplace/trades/:tradeId/accept ─────────────
// Seller accepts. Decrements quantity; auto-declines all other pending requests
// for the same listing if supply is exhausted.

marketplaceRouter.patch('/guilds/:guildId/marketplace/trades/:tradeId/accept', requireAuth, async (req, res) => {
  const { tradeId } = req.params as { guildId: string; tradeId: string };
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });

  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    include: { inventoryEntry: true },
  });
  if (!trade || trade.status !== 'PENDING') {
    res.status(404).json({ success: false, error: 'Trade not found or already resolved' } satisfies ApiResponse); return;
  }
  if (trade.inventoryEntry.userId !== dbUser.discordId) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  const available = trade.inventoryEntry.quantityListed ?? trade.inventoryEntry.quantity;
  if (trade.quantityRequested > available) {
    res.status(409).json({ success: false, error: 'Not enough quantity remaining to fulfil this trade' } satisfies ApiResponse); return;
  }

  const newQty = trade.inventoryEntry.quantity - trade.quantityRequested;
  const newListed = trade.inventoryEntry.quantityListed !== null
    ? trade.inventoryEntry.quantityListed - trade.quantityRequested
    : null;
  const exhausted = (newListed !== null ? newListed : newQty) <= 0;

  await prisma.$transaction([
    prisma.trade.update({ where: { id: tradeId }, data: { status: 'ACCEPTED' } }),
    prisma.inventoryEntry.update({
      where: { id: trade.inventoryEntryId },
      data: {
        quantity: Math.max(0, newQty),
        quantityListed: newListed !== null ? Math.max(0, newListed) : null,
        forSale: !exhausted,
      },
    }),
    prisma.trade.updateMany({
      where: { inventoryEntryId: trade.inventoryEntryId, id: { not: tradeId }, status: 'PENDING' },
      data: { status: 'DECLINED' },
    }),
  ]);

  canSendDm(trade.buyerId, 'dmTradeStatus').then((ok) => {
    if (!ok) return;
    sendBotDm(
      trade.buyerId,
      `Trade accepted! ${dbUser.globalName ?? dbUser.username} accepted your request for ${trade.quantityRequested}x ${trade.inventoryEntry.itemName}. Reach out to arrange the handoff.${NOTIF_FOOTER}`,
    );
  }).catch(() => null);

  res.json({ success: true } satisfies ApiResponse);
});

// ── PATCH /api/guilds/:guildId/marketplace/trades/:tradeId/decline ────────────

marketplaceRouter.patch('/guilds/:guildId/marketplace/trades/:tradeId/decline', requireAuth, async (req, res) => {
  const { tradeId } = req.params as { guildId: string; tradeId: string };
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });

  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    include: { inventoryEntry: true },
  });
  if (!trade || trade.status !== 'PENDING') {
    res.status(404).json({ success: false, error: 'Trade not found or already resolved' } satisfies ApiResponse); return;
  }
  if (trade.inventoryEntry.userId !== dbUser.discordId) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  await prisma.trade.update({ where: { id: tradeId }, data: { status: 'DECLINED' } });

  canSendDm(trade.buyerId, 'dmTradeStatus').then((ok) => {
    if (!ok) return;
    sendBotDm(
      trade.buyerId,
      `Trade declined. ${dbUser.globalName ?? dbUser.username} declined your request for ${trade.quantityRequested}x ${trade.inventoryEntry.itemName}.${NOTIF_FOOTER}`,
    );
  }).catch(() => null);

  res.json({ success: true } satisfies ApiResponse);
});

// ── PATCH /api/guilds/:guildId/marketplace/trades/:tradeId/cancel ─────────────
// Either the buyer or the seller can cancel a PENDING trade.
// Soft-deletes with CANCELLED status; notifies the other party via bot DM.

marketplaceRouter.patch('/guilds/:guildId/marketplace/trades/:tradeId/cancel', requireAuth, async (req, res) => {
  const { tradeId } = req.params as { guildId: string; tradeId: string };
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });
  const me = dbUser.discordId;
  const myName = dbUser.globalName ?? dbUser.username;

  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    include: { inventoryEntry: true },
  });

  if (!trade || trade.status !== 'PENDING') {
    res.status(404).json({ success: false, error: 'Trade not found or already resolved' } satisfies ApiResponse);
    return;
  }

  const isBuyer  = trade.buyerId === me;
  const isSeller = trade.inventoryEntry.userId === me;

  if (!isBuyer && !isSeller) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  await prisma.trade.update({ where: { id: tradeId }, data: { status: 'CANCELLED' } });

  const itemName = trade.inventoryEntry.itemName;
  const qty = trade.quantityRequested;

  if (isBuyer) {
    canSendDm(trade.inventoryEntry.userId, 'dmTradeCancelled').then((ok) => {
      if (!ok) return;
      sendBotDm(
        trade.inventoryEntry.userId,
        `Trade request cancelled. ${myName} cancelled their request for ${qty}x ${itemName}.${NOTIF_FOOTER}`,
      );
    }).catch(() => null);
  } else {
    canSendDm(trade.buyerId, 'dmTradeCancelled').then((ok) => {
      if (!ok) return;
      sendBotDm(
        trade.buyerId,
        `Trade cancelled. ${myName} cancelled the trade for ${qty}x ${itemName}.${NOTIF_FOOTER}`,
      );
    }).catch(() => null);
  }

  res.json({ success: true } satisfies ApiResponse);
});

// ── GET /api/guilds/:guildId/marketplace/trades/:tradeId/messages ─────────────
// Returns the message history for a trade. Only accessible to buyer and seller.

marketplaceRouter.get('/guilds/:guildId/marketplace/trades/:tradeId/messages', requireAuth, async (req, res) => {
  const { guildId, tradeId } = req.params as { guildId: string; tradeId: string };
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });
  const me = dbUser.discordId;

  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    include: { inventoryEntry: { select: { userId: true, guildId: true } } },
  });
  if (!trade) { res.status(404).json({ success: false, error: 'Trade not found' } satisfies ApiResponse); return; }
  if (trade.inventoryEntry.guildId !== guildId && trade.buyerGuildId !== guildId) {
    res.status(404).json({ success: false, error: 'Trade not found' } satisfies ApiResponse); return;
  }
  if (trade.buyerId !== me && trade.inventoryEntry.userId !== me) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  const messages = await prisma.tradeMessage.findMany({
    where: { tradeId },
    orderBy: { createdAt: 'asc' },
  });

  res.json({
    success: true,
    data: messages.map((m) => ({
      id: m.id,
      tradeId: m.tradeId,
      senderId: m.senderId,
      senderUsername: m.senderUsername,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  } satisfies ApiResponse<TradeMessageDto[]>);
});

// ── POST /api/guilds/:guildId/marketplace/trades/:tradeId/messages ────────────
// Sends a message. Only buyer and seller can post; DMs the other party.

marketplaceRouter.post('/guilds/:guildId/marketplace/trades/:tradeId/messages', requireAuth, async (req, res) => {
  const { guildId, tradeId } = req.params as { guildId: string; tradeId: string };
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });
  const me = dbUser.discordId;
  const myName = dbUser.globalName ?? dbUser.username;

  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    include: { inventoryEntry: { select: { userId: true, itemName: true, guildId: true } } },
  });
  if (!trade) { res.status(404).json({ success: false, error: 'Trade not found' } satisfies ApiResponse); return; }
  if (trade.inventoryEntry.guildId !== guildId && trade.buyerGuildId !== guildId) {
    res.status(404).json({ success: false, error: 'Trade not found' } satisfies ApiResponse); return;
  }

  const isBuyer  = trade.buyerId === me;
  const isSeller = trade.inventoryEntry.userId === me;
  if (!isBuyer && !isSeller) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }
  if (trade.status === 'DECLINED' || trade.status === 'CANCELLED') {
    res.status(409).json({ success: false, error: 'Cannot message on a closed trade' } satisfies ApiResponse); return;
  }

  const body = (req.body as { body?: unknown }).body;
  if (typeof body !== 'string' || !body.trim()) {
    res.status(400).json({ success: false, error: 'body is required' } satisfies ApiResponse); return;
  }
  if (body.trim().length > 1000) {
    res.status(400).json({ success: false, error: 'Message too long (max 1000 characters)' } satisfies ApiResponse); return;
  }

  const message = await prisma.tradeMessage.create({
    data: { tradeId, senderId: me, senderUsername: myName, body: body.trim() },
  });

  const otherParty = isBuyer ? trade.inventoryEntry.userId : trade.buyerId;
  const itemName = trade.inventoryEntry.itemName;
  const preview = body.trim().slice(0, 100) + (body.trim().length > 100 ? '…' : '');
  maybeSendMessageDm(
    otherParty,
    tradeId,
    `${myName} sent a message about your ${itemName} trade: "${preview}"\n\nReply at ${WEB_URL}${NOTIF_FOOTER}`,
  );

  res.status(201).json({
    success: true,
    data: {
      id: message.id,
      tradeId: message.tradeId,
      senderId: message.senderId,
      senderUsername: message.senderUsername,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
    },
  } satisfies ApiResponse<TradeMessageDto>);
});

// ── POST /api/guilds/:guildId/marketplace/trades/:tradeId/messages/read ────────
// Marks all messages in this trade as read for the current user.
// IMPORTANT: must be registered before /:tradeId/messages to avoid route clash.

marketplaceRouter.post('/guilds/:guildId/marketplace/trades/:tradeId/messages/read', requireAuth, async (req, res) => {
  const { guildId, tradeId } = req.params as { guildId: string; tradeId: string };
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });
  const me = dbUser.discordId;

  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    include: { inventoryEntry: { select: { userId: true, guildId: true } } },
  });
  if (!trade) { res.status(404).json({ success: false, error: 'Trade not found' } satisfies ApiResponse); return; }
  if (trade.inventoryEntry.guildId !== guildId && trade.buyerGuildId !== guildId) {
    res.status(404).json({ success: false, error: 'Trade not found' } satisfies ApiResponse); return;
  }
  if (trade.buyerId !== me && trade.inventoryEntry.userId !== me) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  await prisma.tradeMessageRead.upsert({
    where: { tradeId_userId: { tradeId, userId: me } },
    create: { tradeId, userId: me, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });

  res.json({ success: true } satisfies ApiResponse);
});
