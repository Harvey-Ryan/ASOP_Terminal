import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── GET /api/guilds/:guildId/exchange/inventory ───────────────────────────────
// Returns the authenticated user's inventory entries for this guild.

exchangeRouter.get('/:guildId/exchange/inventory', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });

  const rows = await prisma.inventoryEntry.findMany({
    where: { guildId, userId: dbUser.discordId },
    orderBy: [{ itemType: 'asc' }, { itemName: 'asc' }],
  });

  res.json({ success: true, data: rows.map(toDto) } satisfies ApiResponse<InventoryEntryDto[]>);
});

// ── PUT /api/guilds/:guildId/exchange/inventory ───────────────────────────────
// Upserts one inventory entry. If (guildId, userId, itemType, externalItemId)
// already exists it is updated; otherwise a new row is inserted.

exchangeRouter.put('/:guildId/exchange/inventory', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });
  const userId = dbUser.discordId;
  const username = dbUser.globalName ?? dbUser.username;
  const body = req.body as UpsertInventoryEntryBody;

  if (!body.itemType || !['ITEM', 'COMMODITY'].includes(body.itemType)) {
    res.status(400).json({ success: false, error: 'itemType must be ITEM or COMMODITY' } satisfies ApiResponse);
    return;
  }
  if (typeof body.externalItemId !== 'number' || body.externalItemId <= 0) {
    res.status(400).json({ success: false, error: 'externalItemId must be a positive number' } satisfies ApiResponse);
    return;
  }
  if (!body.itemName?.trim()) {
    res.status(400).json({ success: false, error: 'itemName is required' } satisfies ApiResponse);
    return;
  }
  if (typeof body.quantity !== 'number' || body.quantity < 0) {
    res.status(400).json({ success: false, error: 'quantity must be a non-negative number' } satisfies ApiResponse);
    return;
  }
  if (body.qualityLevel !== undefined && body.qualityLevel !== null) {
    if (!Number.isInteger(body.qualityLevel) || body.qualityLevel < 0 || body.qualityLevel > 1000) {
      res.status(400).json({ success: false, error: 'qualityLevel must be an integer between 0 and 1000' } satisfies ApiResponse);
      return;
    }
  }

  const row = await prisma.inventoryEntry.upsert({
    where: {
      guildId_userId_itemType_externalItemId: {
        guildId,
        userId,
        itemType: body.itemType,
        externalItemId: body.externalItemId,
      },
    },
    create: {
      guildId,
      userId,
      username,
      itemType: body.itemType,
      externalItemId: body.externalItemId,
      itemName: body.itemName.trim(),
      quantity: body.quantity,
      qualityLevel: body.qualityLevel ?? null,
      location: body.location?.trim() || null,
    },
    update: {
      username,
      itemName: body.itemName.trim(),
      quantity: body.quantity,
      qualityLevel: body.qualityLevel ?? null,
      location: body.location?.trim() || null,
    },
  });

  res.json({ success: true, data: toDto(row) } satisfies ApiResponse<InventoryEntryDto>);
});

// ── DELETE /api/guilds/:guildId/exchange/inventory/:entryId ───────────────────
// Deletes one entry; the authenticated user must own it.

exchangeRouter.delete('/:guildId/exchange/inventory/:entryId', requireAuth, async (req, res) => {
  const { guildId, entryId } = req.params as { guildId: string; entryId: string };
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
// Returns all guild members who have the specified item in their inventory,
// grouped by qualityLevel.
// Query params: itemType (ITEM|COMMODITY), externalItemId (number)

exchangeRouter.get('/:guildId/exchange/search', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
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
    where: { guildId, itemType, externalItemId },
    orderBy: [{ qualityLevel: 'desc' }, { username: 'asc' }],
  });

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
    groupMap.get(key)!.entries.push(toDto(row));
  }

  res.json({ success: true, data: [...groupMap.values()] } satisfies ApiResponse<InventorySearchGroup[]>);
});
