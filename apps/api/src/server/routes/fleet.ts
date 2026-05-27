import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertModuleEnabled } from '../../lib/assertModuleEnabled.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { getFleetyardsModels } from '../../lib/fleetyardsCache.js';
import type { ApiResponse, FleetEntryDto, FleetSearchEntry, UpsertFleetEntryBody } from '@dem/shared';

// ── Guild-scoped fleet routes ─────────────────────────────────────────────────
export const fleetRouter = Router();

// ── FleetYards proxy (no guild scope) ────────────────────────────────────────
export const fleetyardsRouter = Router();

// ── DTO helper ────────────────────────────────────────────────────────────────

function toDto(row: {
  id: string;
  guildId: string;
  userId: string;
  username: string;
  shipSlug: string;
  shipName: string;
  manufacturer: string;
  quantity: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}): FleetEntryDto {
  return {
    id: row.id,
    guildId: row.guildId,
    userId: row.userId,
    username: row.username,
    shipSlug: row.shipSlug,
    shipName: row.shipName,
    manufacturer: row.manufacturer,
    quantity: row.quantity,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── GET /api/fleetyards/models ────────────────────────────────────────────────
// Public ship list proxied from FleetYards.net with a 6-hour server-side cache.
// No guild scope — used by the ship combobox in the web app and the bot.

fleetyardsRouter.get('/fleetyards/models', requireAuth, async (_req, res) => {
  try {
    const models = await getFleetyardsModels();
    res.json({ success: true, data: models } satisfies ApiResponse);
  } catch (err) {
    console.error('[fleetyards/models]', err);
    res.status(502).json({ success: false, error: 'Failed to fetch ship data from FleetYards' } satisfies ApiResponse);
  }
});

// ── GET /api/guilds/:guildId/fleet ────────────────────────────────────────────
// Returns the authenticated user's fleet entries for this guild.

fleetRouter.get('/:guildId/fleet', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertModuleEnabled(guildId, 'fleetEnabled'))) {
    res.status(403).json({ success: false, error: 'Fleet module is disabled' } satisfies ApiResponse); return;
  }
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });

  const rows = await prisma.fleetEntry.findMany({
    where: { guildId, userId: dbUser.discordId },
    orderBy: [{ manufacturer: 'asc' }, { shipName: 'asc' }],
  });

  res.json({ success: true, data: rows.map(toDto) } satisfies ApiResponse<FleetEntryDto[]>);
});

// ── PUT /api/guilds/:guildId/fleet ────────────────────────────────────────────
// Upserts one fleet entry.
//
// body.id provided  → direct update by PK (inline editor path).
// body.id absent    → upsert on unique key (guildId, userId, shipSlug).

fleetRouter.put('/:guildId/fleet', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertModuleEnabled(guildId, 'fleetEnabled'))) {
    res.status(403).json({ success: false, error: 'Fleet module is disabled' } satisfies ApiResponse); return;
  }
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });
  const userId = dbUser.discordId;
  const username = dbUser.globalName ?? dbUser.username;
  const body = req.body as UpsertFleetEntryBody;

  if (!body.shipSlug?.trim()) {
    res.status(400).json({ success: false, error: 'shipSlug is required' } satisfies ApiResponse); return;
  }
  if (!body.shipName?.trim()) {
    res.status(400).json({ success: false, error: 'shipName is required' } satisfies ApiResponse); return;
  }
  if (!body.manufacturer?.trim()) {
    res.status(400).json({ success: false, error: 'manufacturer is required' } satisfies ApiResponse); return;
  }
  if (typeof body.quantity !== 'number' || !Number.isInteger(body.quantity) || body.quantity < 1) {
    res.status(400).json({ success: false, error: 'quantity must be a positive integer' } satisfies ApiResponse); return;
  }

  const notes = body.notes?.trim() || null;
  const shipSlug = body.shipSlug.trim();

  // ── Direct update by id (inline editor) ──────────────────────────────────
  if (body.id) {
    const entry = await prisma.fleetEntry.findUnique({ where: { id: body.id } });
    if (!entry || entry.guildId !== guildId || entry.userId !== userId) {
      res.status(404).json({ success: false, error: 'Entry not found' } satisfies ApiResponse); return;
    }
    const row = await prisma.fleetEntry.update({
      where: { id: body.id },
      data: { username, quantity: body.quantity, notes },
    });
    res.json({ success: true, data: toDto(row) } satisfies ApiResponse<FleetEntryDto>);
    return;
  }

  // ── Upsert on (guildId, userId, shipSlug) ─────────────────────────────────
  const row = await prisma.fleetEntry.upsert({
    where: { guildId_userId_shipSlug: { guildId, userId, shipSlug } },
    update: { username, shipName: body.shipName.trim(), manufacturer: body.manufacturer.trim(), quantity: body.quantity, notes },
    create: { guildId, userId, username, shipSlug, shipName: body.shipName.trim(), manufacturer: body.manufacturer.trim(), quantity: body.quantity, notes },
  });

  res.json({ success: true, data: toDto(row) } satisfies ApiResponse<FleetEntryDto>);
});

// ── DELETE /api/guilds/:guildId/fleet/all ─────────────────────────────────────
// Admin-only: wipes every FleetEntry for the guild.
// IMPORTANT: must be registered before /:entryId to avoid shadowing.

fleetRouter.delete('/:guildId/fleet/all', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  const { count } = await prisma.fleetEntry.deleteMany({ where: { guildId } });
  res.json({ success: true, data: { deleted: count } } satisfies ApiResponse<{ deleted: number }>);
});

// ── DELETE /api/guilds/:guildId/fleet/:entryId ────────────────────────────────
// Deletes one entry; the authenticated user must own it.

fleetRouter.delete('/:guildId/fleet/:entryId', requireAuth, async (req, res) => {
  const { guildId, entryId } = req.params as { guildId: string; entryId: string };
  if (!(await assertModuleEnabled(guildId, 'fleetEnabled'))) {
    res.status(403).json({ success: false, error: 'Fleet module is disabled' } satisfies ApiResponse); return;
  }
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });

  const entry = await prisma.fleetEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.guildId !== guildId) {
    res.status(404).json({ success: false, error: 'Entry not found' } satisfies ApiResponse); return;
  }
  if (entry.userId !== dbUser.discordId) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  await prisma.fleetEntry.delete({ where: { id: entryId } });
  res.json({ success: true } satisfies ApiResponse);
});

// ── GET /api/guilds/:guildId/fleet/search ─────────────────────────────────────
// Returns all active guild members who have the specified ship.
// Query params: slug (string — FleetYards slug)
// Display names resolved live from Discord API; ex-members excluded.

fleetRouter.get('/:guildId/fleet/search', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertModuleEnabled(guildId, 'fleetEnabled'))) {
    res.status(403).json({ success: false, error: 'Fleet module is disabled' } satisfies ApiResponse); return;
  }
  const slug = (req.query.slug as string | undefined)?.trim();
  if (!slug) {
    res.status(400).json({ success: false, error: 'slug query parameter is required' } satisfies ApiResponse); return;
  }

  const rows = await prisma.fleetEntry.findMany({
    where: { guildId, shipSlug: slug, memberActive: true },
    orderBy: [{ username: 'asc' }],
  });

  // Resolve live display names from Discord; fall back to stored username on error.
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const nickMap = new Map<string, string>();
  const botToken = process.env['DISCORD_TOKEN'];
  if (botToken && userIds.length > 0) {
    const results = await Promise.allSettled(
      userIds.map((uid) =>
        fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${uid}`, {
          headers: { Authorization: `Bot ${botToken}` },
        }).then((r) =>
          r.ok
            ? (r.json() as Promise<{ user: { id: string; username: string; global_name?: string | null }; nick?: string | null }>)
            : null,
        ),
      ),
    );
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const m = result.value;
        nickMap.set(m.user.id, m.nick ?? m.user.global_name ?? m.user.username);
      }
    }
  }

  const entries: FleetSearchEntry[] = rows.map((r) => ({
    userId: r.userId,
    username: nickMap.get(r.userId) ?? r.username,
    quantity: r.quantity,
    notes: r.notes,
  }));

  res.json({ success: true, data: entries } satisfies ApiResponse<FleetSearchEntry[]>);
});
