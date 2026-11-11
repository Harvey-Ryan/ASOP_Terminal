import { getMemberNames } from '../../lib/discordRest.js';
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertModuleEnabled } from '../../lib/assertModuleEnabled.js';
import { parseCatalogRef } from '@dem/shared';
import type { ApiResponse, InventoryEntryDto, InventorySearchGroup, UpsertInventoryEntryBody, InventoryItemType } from '@dem/shared';
import type { InventoryEntry } from '@prisma/client';
import { getCatalog, sameItemWhere } from '../../lib/catalog.js';


export const exchangeRouter = Router();

// ── DTO helper ────────────────────────────────────────────────────────────────

function toDto(row: InventoryEntry): InventoryEntryDto {
  return {
    id: row.id,
    guildId: row.guildId,
    userId: row.userId,
    username: row.username,
    itemType: row.itemType as InventoryItemType,
    externalItemId: row.externalItemId,
    itemUuid: row.itemUuid,
    itemName: row.itemName,
    quantity: row.quantity,
    qualityLevel: row.qualityLevel,
    location: row.location,
    forSale: row.forSale,
    quantityListed: row.quantityListed,
    askingPrice: row.askingPrice,
    priceNote: row.priceNote,
    listedAt: row.listedAt?.toISOString() ?? null,
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
  // Which item: a game catalog ref. (Edits by id keep the entry's item.)
  let itemUuid: string | null = null;
  let itemName = body.itemName?.trim() ?? '';
  const ref = body.itemRef ? parseCatalogRef(body.itemRef) : null;
  if (body.itemRef && !ref) {
    res.status(400).json({ success: false, error: 'itemRef is not a valid game item' } satisfies ApiResponse); return;
  }
  if (ref) {
    const entry = (await getCatalog()).get(body.itemRef!);
    if (!entry || entry.kind !== body.itemType) {
      res.status(400).json({ success: false, error: 'That item is not in the game data' } satisfies ApiResponse); return;
    }
    itemUuid = entry.uuid;
    itemName = entry.name;
  } else if (!body.id) {
    res.status(400).json({ success: false, error: 'Pick an item from the list' } satisfies ApiResponse); return;
  }
  if (!itemName) {
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
        location,
        qualityLevel,
        ...sameItemWhere(entry.itemType as InventoryItemType, entry.itemUuid, entry.externalItemId, entry.itemUuid ? null : entry.itemName),
      },
    });
    if (conflict) {
      res.status(409).json({
        success: false,
        error: 'An entry for this item already exists at this location with the same quality level.',
      } satisfies ApiResponse);
      return;
    }

    let listingData: Record<string, unknown> = {};
    if (body.forSale !== undefined) {
      if (body.forSale) {
        const newPrice = body.askingPrice ?? null;
        const newNote = body.priceNote?.trim() || null;
        // Reset listedAt only when the price or note actually changes (enforces
        // renew-requires-price-adjustment rule). Also resets on first listing.
        const priceChanged =
          !entry.forSale ||
          entry.askingPrice !== newPrice ||
          (entry.priceNote ?? null) !== newNote;
        listingData = {
          forSale: true,
          quantityListed: body.quantityListed ?? null,
          askingPrice: newPrice,
          priceNote: newNote,
          ...(priceChanged ? { listedAt: new Date() } : {}),
        };
      } else {
        listingData = { forSale: false, quantityListed: null, askingPrice: null, priceNote: null, listedAt: null };
      }
    }

    const row = await prisma.inventoryEntry.update({
      where: { id: body.id },
      data: { username, itemName: entry.itemUuid ? entry.itemName : itemName, quantity: body.quantity, qualityLevel, location, ...listingData },
    });
    res.json({ success: true, data: toDto(row) } satisfies ApiResponse<InventoryEntryDto>);
    return;
  }

  // ── Composite-key upsert (Add Item form) ──────────────────────────────────
  // Matches on (guildId, userId, item, location, qualityLevel) so that different
  // QL values at the same location are stored as separate rows. "Item" is the
  // game item, so it also finds an older entry for it that isn't linked yet.
  const existing = await prisma.inventoryEntry.findFirst({
    where: { guildId, userId, location, qualityLevel, ...sameItemWhere(body.itemType, itemUuid, null, itemName) },
  });

  const row = existing
    ? await prisma.inventoryEntry.update({
        where: { id: existing.id },
        data: {
          username, quantity: body.quantity, qualityLevel, location, itemUuid, itemName,
        },
      })
    : await prisma.inventoryEntry.create({
        data: { guildId, userId, username, itemType: body.itemType, itemUuid, itemName, quantity: body.quantity, qualityLevel, location },
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
// Query params: itemRef (game catalog ref, "ITEM:<uuid>" / "COMMODITY:<uuid>")

exchangeRouter.get('/:guildId/exchange/search', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertModuleEnabled(guildId, 'exchangeEnabled'))) {
    res.status(403).json({ success: false, error: 'Exchange module is disabled' } satisfies ApiResponse); return;
  }
  // itemRef = the game catalog ref of the item.
  const ref = parseCatalogRef(typeof req.query.itemRef === 'string' ? req.query.itemRef : null);
  if (!ref) {
    res.status(400).json({ success: false, error: 'itemRef is required' } satisfies ApiResponse);
    return;
  }

  const catalogEntry = (await getCatalog()).get(req.query.itemRef as string);
  const rows = await prisma.inventoryEntry.findMany({
    where: { guildId, memberActive: true, ...sameItemWhere(ref.kind, ref.uuid, null, catalogEntry?.name ?? null) },
    orderBy: [{ qualityLevel: 'desc' }, { username: 'asc' }],
  });

  // Resolve live display names from Discord. Falls back to stored username on error.
  const userIds = [...new Set(rows.map((r) => r.userId))];
  // Cached and throttled (lib/discordRest.ts); names Discord can't give right now fall back to the stored one.
  const nickMap = process.env['DISCORD_TOKEN'] && userIds.length > 0 ? await getMemberNames(guildId, userIds) : new Map<string, string>();

  // Group by qualityLevel
  const groupMap = new Map<string, InventorySearchGroup>();
  for (const row of rows) {
    const key = String(row.qualityLevel ?? 'null');
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        itemName: row.itemName,
        itemType: row.itemType as InventoryItemType,
        externalItemId: row.externalItemId,
        itemUuid: row.itemUuid,
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
