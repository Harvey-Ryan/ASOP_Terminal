import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertModuleEnabled } from '../../lib/assertModuleEnabled.js';
import type { ApiResponse, InventoryEntryDto, InventorySearchGroup, UpsertInventoryEntryBody, InventoryItemType } from '@dem/shared';


export const exchangeRouter = Router();

// ── DTO helper ────────────────────────────────────────────────────────────────

function toDto(row: {
  id: string;
  guildId: string;
  userId: string;
  username: string;
  itemType: string;
  externalItemId: number;
  itemName: string;
  quantity: number;
  qualityLevel: number | null;
  location: string | null;
  forSale: boolean;
  quantityListed: number | null;
  askingPrice: number | null;
  priceNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}): InventoryEntryDto {
  return {
    id: row.id,
    guildId: row.guildId,
    userId: row.userId,
    username: row.username,
    itemType: row.itemType as InventoryItemType,
    externalItemId: row.externalItemId,
    itemName: row.itemName,
    quantity: row.quantity,
    qualityLevel: row.qualityLevel,
    location: row.location,
    forSale: row.forSale,
    quantityListed: row.quantityListed,
    askingPrice: row.askingPrice,
    priceNote: row.priceNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── GET /api/guilds/:guildId/exchange/inventory ───────────────────────────────
// Returns the authenticated user's inventory entries for this guild.

exchangeRouter.get('/:guildId/exchange/inventory', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertModuleEnabled(guildId, 'exchangeEnabled'))) {
    res.status(403).json({ success: false, error: 'Exchange module is disabled' } satisfies ApiResponse); return;
  }
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });

  const rows = await prisma.inventoryEntry.findMany({
    where: { guildId, userId: dbUser.discordId },
    orderBy: [{ itemType: 'asc' }, { itemName: 'asc' }],
  });

  res.json({ success: true, data: rows.map(toDto) } satisfies ApiResponse<InventoryEntryDto[]>);
});

// ── PUT /api/guilds/:guildId/exchange/inventory ───────────────────────────────
// Upserts one inventory entry.
//
// body.id provided  → direct update by PK (inline editor path). A conflict check
//                     prevents silently creating duplicates when location or QL changes.
// body.id absent    → composite-key upsert on (guildId, userId, itemType,
//                     externalItemId, location, qualityLevel). Creates a new row only
//                     when the full tuple doesn't match an existing entry, allowing
//                     the same item at the same location to exist at different QLs.

exchangeRouter.put('/:guildId/exchange/inventory', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertModuleEnabled(guildId, 'exchangeEnabled'))) {
    res.status(403).json({ success: false, error: 'Exchange module is disabled' } satisfies ApiResponse); return;
  }
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });
  const userId = dbUser.discordId;
  const username = dbUser.globalName ?? dbUser.username;
  const body = req.body as UpsertInventoryEntryBody;

  if (!body.itemType || !['ITEM', 'COMMODITY'].includes(body.itemType)) {
    res.status(400).json({ success: false, error: 'itemType must be ITEM or COMMODITY' } satisfies ApiResponse); return;
  }
  if (typeof body.externalItemId !== 'number' || body.externalItemId <= 0) {
    res.status(400).json({ success: false, error: 'externalItemId must be a positive number' } satisfies ApiResponse); return;
  }
  if (!body.itemName?.trim()) {
    res.status(400).json({ success: false, error: 'itemName is required' } satisfies ApiResponse); return;
  }
  if (typeof body.quantity !== 'number' || body.quantity < 0) {
    res.status(400).json({ success: false, error: 'quantity must be a non-negative number' } satisfies ApiResponse); return;
  }
  if (body.qualityLevel !== undefined && body.qualityLevel !== null) {
    if (!Number.isInteger(body.qualityLevel) || body.qualityLevel < 0 || body.qualityLevel > 1000) {
      res.status(400).json({ success: false, error: 'qualityLevel must be an integer between 0 and 1000' } satisfies ApiResponse); return;
    }
  }

  const location = body.location?.trim() || null;
  const qualityLevel = body.qualityLevel ?? null;

  // ── Direct update by id (inline editor) ──────────────────────────────────
  if (body.id) {
    const entry = await prisma.inventoryEntry.findUnique({ where: { id: body.id } });
    if (!entry || entry.guildId !== guildId || entry.userId !== userId) {
      res.status(404).json({ success: false, error: 'Entry not found' } satisfies ApiResponse);
      return;
    }

    // Prevent a silent duplicate when location/QL changes to match an existing row.
    const conflict = await prisma.inventoryEntry.findFirst({
      where: {
        id: { not: body.id },
        guildId,
        userId,
        itemType: entry.itemType,
        externalItemId: entry.externalItemId,
        location,
        qualityLevel,
      },
    });
    if (conflict) {
      res.status(409).json({
        success: false,
        error: 'An entry for this item already exists at this location with the same quality level.',
      } satisfies ApiResponse);
      return;
    }

    const listingData = body.forSale !== undefined ? {
      forSale: body.forSale,
      quantityListed: body.forSale ? (body.quantityListed ?? null) : null,
      askingPrice: body.forSale ? (body.askingPrice ?? null) : null,
      priceNote: body.forSale ? (body.priceNote?.trim() || null) : null,
    } : {};

    const row = await prisma.inventoryEntry.update({
      where: { id: body.id },
      data: { username, itemName: body.itemName.trim(), quantity: body.quantity, qualityLevel, location, ...listingData },
    });
    res.json({ success: true, data: toDto(row) } satisfies ApiResponse<InventoryEntryDto>);
    return;
  }

  // ── Composite-key upsert (Add Item form) ──────────────────────────────────
  // Matches on the full (guildId, userId, itemType, externalItemId, location, qualityLevel)
  // tuple so that different QL values at the same location are stored as separate rows.
  const existing = await prisma.inventoryEntry.findFirst({
    where: { guildId, userId, itemType: body.itemType, externalItemId: body.externalItemId, location, qualityLevel },
  });

  const row = existing
    ? await prisma.inventoryEntry.update({
        where: { id: existing.id },
        data: { username, itemName: body.itemName.trim(), quantity: body.quantity, qualityLevel, location },
      })
    : await prisma.inventoryEntry.create({
        data: { guildId, userId, username, itemType: body.itemType, externalItemId: body.externalItemId, itemName: body.itemName.trim(), quantity: body.quantity, qualityLevel, location },
      });

  res.json({ success: true, data: toDto(row) } satisfies ApiResponse<InventoryEntryDto>);
});

// ── DELETE /api/guilds/:guildId/exchange/inventory/all ───────────────────────
// Admin-only: wipes every InventoryEntry for the guild.
// IMPORTANT: must be registered before /:entryId or Express will treat "all" as an id.

exchangeRouter.delete('/:guildId/exchange/inventory/all', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };

  const { assertGuildManager } = await import('../../lib/assertGuildManager.js');
  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const { count } = await prisma.inventoryEntry.deleteMany({ where: { guildId } });
  res.json({ success: true, data: { deleted: count } } satisfies ApiResponse<{ deleted: number }>);
});

// ── DELETE /api/guilds/:guildId/exchange/inventory/:entryId ───────────────────
// Deletes one entry; the authenticated user must own it.

exchangeRouter.delete('/:guildId/exchange/inventory/:entryId', requireAuth, async (req, res) => {
  const { guildId, entryId } = req.params as { guildId: string; entryId: string };
  if (!(await assertModuleEnabled(guildId, 'exchangeEnabled'))) {
    res.status(403).json({ success: false, error: 'Exchange module is disabled' } satisfies ApiResponse); return;
  }
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });

  const entry = await prisma.inventoryEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.guildId !== guildId) {
    res.status(404).json({ success: false, error: 'Entry not found' } satisfies ApiResponse);
    return;
  }
  if (entry.userId !== dbUser.discordId) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  await prisma.inventoryEntry.delete({ where: { id: entryId } });
  res.json({ success: true } satisfies ApiResponse);
});

// ── GET /api/guilds/:guildId/exchange/search ──────────────────────────────────
// Returns all active guild members who have the specified item in their inventory,
// grouped by qualityLevel. Ex-members (memberActive: false) are excluded.
// Display names are resolved live from the Discord API so nicknames are always current.
// Query params: itemType (ITEM|COMMODITY), externalItemId (number)

exchangeRouter.get('/:guildId/exchange/search', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertModuleEnabled(guildId, 'exchangeEnabled'))) {
    res.status(403).json({ success: false, error: 'Exchange module is disabled' } satisfies ApiResponse); return;
  }
  const itemType = req.query.itemType as string | undefined;
  const externalItemId = parseInt(String(req.query.externalItemId ?? ''), 10);

  if (!itemType || !['ITEM', 'COMMODITY'].includes(itemType)) {
    res.status(400).json({ success: false, error: 'itemType must be ITEM or COMMODITY' } satisfies ApiResponse);
    return;
  }
  if (isNaN(externalItemId) || externalItemId <= 0) {
    res.status(400).json({ success: false, error: 'externalItemId must be a positive number' } satisfies ApiResponse);
    return;
  }

  const rows = await prisma.inventoryEntry.findMany({
    where: { guildId, itemType, externalItemId, memberActive: true },
    orderBy: [{ qualityLevel: 'desc' }, { username: 'asc' }],
  });

  // Resolve live display names from Discord. Falls back to stored username on error.
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const nickMap = new Map<string, string>();
  const botToken = process.env['DISCORD_TOKEN'];
  if (botToken && userIds.length > 0) {
    const results = await Promise.allSettled(
      userIds.map((uid) =>
        fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${uid}`, {
          headers: { Authorization: `Bot ${botToken}` },
        }).then((r) => (r.ok ? (r.json() as Promise<{ user: { id: string; username: string; global_name?: string | null }; nick?: string | null }>) : null)),
      ),
    );
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const m = result.value;
        nickMap.set(m.user.id, m.nick ?? m.user.global_name ?? m.user.username);
      }
    }
  }

  // Group by qualityLevel
  const groupMap = new Map<string, InventorySearchGroup>();
  for (const row of rows) {
    const key = String(row.qualityLevel ?? 'null');
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        itemName: row.itemName,
        itemType: row.itemType as InventoryItemType,
        externalItemId: row.externalItemId,
        qualityLevel: row.qualityLevel,
        entries: [],
      });
    }
    const dto = toDto(row);
    const liveNick = nickMap.get(row.userId);
    if (liveNick) dto.username = liveNick;
    groupMap.get(key)!.entries.push(dto);
  }

  res.json({ success: true, data: [...groupMap.values()] } satisfies ApiResponse<InventorySearchGroup[]>);
});
