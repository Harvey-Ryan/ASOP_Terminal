import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertModuleEnabled } from '../../lib/assertModuleEnabled.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { getFleetyardsModels } from '../../lib/fleetyardsCache.js';
import { importHangar } from '../../lib/fleetyardsOAuth.js';
import type { ApiResponse, FleetEntryDto, FleetSearchEntry, UpsertFleetEntryBody, FleetLinkStatusDto, FleetyardsLinkDto, RsiRosterDto, RsiRosterViewerMember } from '@dem/shared';

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

// ── POST /api/guilds/:guildId/fleet/sync ──────────────────────────────────────
// Re-imports the authenticated user's FleetYards hangar into this guild
// (and any other guilds where they are currently active).

fleetRouter.post('/:guildId/fleet/sync', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertModuleEnabled(guildId, 'fleetEnabled'))) {
    res.status(403).json({ success: false, error: 'Fleet module is disabled' } satisfies ApiResponse); return;
  }

  const dbUser = await prisma.user.findUniqueOrThrow({
    where: { id: req.session.userId },
    include: { fleetyardsLink: true },
  });

  if (!dbUser.fleetyardsLink) {
    res.status(400).json({ success: false, error: 'No FleetYards account linked' } satisfies ApiResponse); return;
  }

  try {
    await importHangar(
      dbUser.id,
      dbUser.discordId,
      dbUser.globalName ?? dbUser.username,
      dbUser.fleetyardsLink.accessToken,
      guildId,
    );
    res.json({ success: true } satisfies ApiResponse);
  } catch (err) {
    console.error('[fleet/sync]', err);
    res.status(502).json({ success: false, error: 'FleetYards hangar sync failed — your token may have expired' } satisfies ApiResponse);
  }
});

// ── GET /api/fleet/link-status ────────────────────────────────────────────────
// Returns the authenticated user's FleetYards connection state + RSI handle.

fleetyardsRouter.get('/fleet/link-status', requireAuth, async (req, res) => {
  const dbUser = await prisma.user.findUniqueOrThrow({
    where: { id: req.session.userId },
    include: { fleetyardsLink: true },
  });

  const link = dbUser.fleetyardsLink;
  const fyLink: FleetyardsLinkDto | null = link
    ? {
        fyUserId: link.fyUserId,
        fyUsername: link.fyUsername,
        lastSyncAt: link.lastSyncAt?.toISOString() ?? null,
        connectedAt: link.createdAt.toISOString(),
      }
    : null;

  res.json({
    success: true,
    data: {
      fleetyardsConfigured: !!process.env['FLEETYARDS_CLIENT_ID'],
      fleetyardsLink: fyLink,
      rsiHandle: dbUser.rsiHandle ?? null,
    } satisfies FleetLinkStatusDto,
  } satisfies ApiResponse<FleetLinkStatusDto>);
});

// ── DELETE /api/fleet/fleetyards ──────────────────────────────────────────────
// Disconnects the user's FleetYards account (deletes stored tokens).

fleetyardsRouter.delete('/fleet/fleetyards', requireAuth, async (req, res) => {
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });
  await prisma.fleetyardsLink.deleteMany({ where: { userId: dbUser.id } });
  res.json({ success: true } satisfies ApiResponse);
});

// ── PATCH /api/fleet/rsi-handle ───────────────────────────────────────────────
// Updates (or clears) the user's stored RSI handle.

fleetyardsRouter.patch('/fleet/rsi-handle', requireAuth, async (req, res) => {
  const body = req.body as { rsiHandle?: string | null };
  const handle = typeof body.rsiHandle === 'string' ? body.rsiHandle.trim() || null : null;

  await prisma.user.update({
    where: { id: req.session.userId },
    data: { rsiHandle: handle },
  });

  res.json({ success: true } satisfies ApiResponse);
});

// ── GET /api/guilds/:guildId/rsi/roster ───────────────────────────────────────
// Fetches the RSI org roster and cross-references with app members' RSI handles.
// Requires guild manager. Proxies to the RSI org members API to avoid CORS.

fleetRouter.get('/:guildId/rsi/roster', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const guild = await prisma.guild.findUnique({ where: { guildId }, include: { settings: true } });
  if (!guild) {
    res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
    return;
  }

  const orgTag = guild.settings?.rsiOrgTag ?? null;

  if (!orgTag) {
    res.json({ success: true, data: { orgTag: null, linked: [], orgOnly: [], viewers: [], total: 0 } satisfies RsiRosterDto } satisfies ApiResponse<RsiRosterDto>);
    return;
  }

  // Fetch all app members for this guild — use per-guild rsiHandle (verified flow)
  // falling back to the global User.rsiHandle for members who haven't re-linked
  const members = await prisma.guildMember.findMany({
    where: { guildId: guild.id },
    include: { user: { select: { discordId: true, username: true, globalName: true, rsiHandle: true } } },
  });

  // Fetch RSI org roster (paginated, max 32 per page).
  // The endpoint returns { success:1, data:{ totalrows:N, html:"...rendered li items..." } }
  // — not a members array — so we parse handles and rank stars from the HTML.
  const RSI_PAGE_SIZE = 32;
  let page = 1;
  let totalRows = Infinity;
  const orgMembers: { handle: string; stars: number }[] = [];

  function parseMembersHtml(html: string): { handle: string; stars: number }[] {
    const out: { handle: string; stars: number }[] = [];
    // Split on each member-item block boundary
    const blocks = html.split(/<li[^>]+class="[^"]*member-item[^"]*"/);
    for (const block of blocks.slice(1)) {
      const handleMatch = block.match(/href="\/citizens\/([^"]+)"/);
      if (!handleMatch?.[1]) continue;
      const handle = handleMatch[1].trim();
      // Count active star spans: icon-star followed or preceded by "active" somewhere in its class
      const activeStars = (block.match(/class="[^"]*icon-star[^"]*"\s+style="[^"]*color/g) ?? []).length
        || (block.match(/<span[^>]*class="[^"]*icon-star\s+active[^"]*"/g) ?? []).length
        || (block.match(/active(?:[^"]*)?icon-star|icon-star(?:[^"]*)?active/g) ?? []).length;
      out.push({ handle, stars: activeStars });
    }
    return out;
  }

  try {
    while (orgMembers.length < totalRows) {
      const response = await fetch('https://robertsspaceindustries.com/api/orgs/getOrgMembers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Origin': 'https://robertsspaceindustries.com',
          'Referer': `https://robertsspaceindustries.com/en/orgs/${orgTag}`,
        },
        body: JSON.stringify({ symbol: orgTag, page, pagesize: RSI_PAGE_SIZE }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`[rsi/roster] HTTP ${response.status} from RSI:`, body.slice(0, 300));
        res.status(502).json({ success: false, error: `RSI API returned HTTP ${response.status}` } satisfies ApiResponse);
        return;
      }

      const rawText = await response.text();
      let json: { success: number; data: { totalrows: number; html?: string; members?: unknown[] } };
      try {
        json = JSON.parse(rawText);
      } catch {
        console.error('[rsi/roster] Non-JSON response from RSI:', rawText.slice(0, 300));
        res.status(502).json({ success: false, error: 'RSI returned an unexpected response' } satisfies ApiResponse);
        return;
      }

      if (!json.success) {
        console.error('[rsi/roster] RSI returned success=false:', rawText.slice(0, 300));
        res.status(502).json({ success: false, error: 'RSI org not found or is private' } satisfies ApiResponse);
        return;
      }

      totalRows = json.data?.totalrows ?? 0;
      if (totalRows === 0) break;

      const parsed = json.data?.html
        ? parseMembersHtml(json.data.html)
        : (json.data?.members as { handle: string; stars: number }[] | undefined) ?? [];

      if (parsed.length === 0 && page === 1) {
        console.error('[rsi/roster] Could not parse any members from RSI response. html length:', (json.data?.html ?? '').length);
      }

      for (const m of parsed) {
        orgMembers.push(m);
      }
      if (parsed.length < RSI_PAGE_SIZE) break;
      page++;
    }
  } catch (err) {
    console.error('[rsi/roster] Fetch failed:', err);
    res.status(502).json({ success: false, error: 'Failed to reach RSI' } satisfies ApiResponse);
    return;
  }

  // Fetch affiliates — non-fatal, empty set if the call fails or returns nothing
  const affiliateHandleSet = new Set<string>();
  try {
    let affiliatePage = 1;
    let affiliateTotalRows = Infinity;
    while (affiliateHandleSet.size < affiliateTotalRows) {
      const affResponse = await fetch('https://robertsspaceindustries.com/api/orgs/getOrgMembers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Origin': 'https://robertsspaceindustries.com',
          'Referer': `https://robertsspaceindustries.com/en/orgs/${orgTag}`,
        },
        body: JSON.stringify({ symbol: orgTag, page: affiliatePage, pagesize: RSI_PAGE_SIZE, role: 'affiliate' }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!affResponse.ok) break;
      let affJson: { success: number; data: { totalrows: number; html?: string } };
      try { affJson = JSON.parse(await affResponse.text()); } catch { break; }
      if (!affJson.success) break;
      affiliateTotalRows = affJson.data?.totalrows ?? 0;
      if (affiliateTotalRows === 0) break;
      const parsed = affJson.data?.html ? parseMembersHtml(affJson.data.html) : [];
      for (const m of parsed) affiliateHandleSet.add(m.handle.toLowerCase());
      if (parsed.length < RSI_PAGE_SIZE) break;
      affiliatePage++;
    }
  } catch {
    // Affiliate fetch is non-fatal
  }

  const orgHandleSet = new Set(orgMembers.map((m) => m.handle.toLowerCase()));
  const orgRankMap = new Map(orgMembers.map((m) => [m.handle.toLowerCase(), m.stars]));

  const linked = members
    .filter((m) => m.rsiHandle || m.user.rsiHandle)
    .map((m) => {
      const handle = (m.rsiHandle || m.user.rsiHandle)!;
      const handleLc = handle.toLowerCase();
      return {
        discordId: m.user.discordId,
        discordUsername: m.user.globalName ?? m.user.username,
        rsiHandle: handle,
        verified: m.rsiVerified,
        inOrg: orgHandleSet.has(handleLc) || affiliateHandleSet.has(handleLc),
        isAffiliate: affiliateHandleSet.has(handleLc),
        orgRank: orgRankMap.get(handleLc) ?? null,
      };
    });

  const linkedHandles = new Set(linked.map((l) => l.rsiHandle.toLowerCase()));
  const orgOnly = orgMembers
    .filter((m) => !linkedHandles.has(m.handle.toLowerCase()))
    .map((m) => ({ rsiHandle: m.handle, orgRank: m.stars, isAffiliate: affiliateHandleSet.has(m.handle.toLowerCase()) }));

  // Fetch Discord members with viewer roles and show those not already in the org
  const viewers: RsiRosterViewerMember[] = [];
  const viewerRoles: string[] = guild.settings
    ? (JSON.parse(guild.settings.viewerRoles ?? '[]') as string[])
    : [];

  if (viewerRoles.length > 0) {
    const botToken = process.env['DISCORD_TOKEN'];
    if (botToken) {
      interface DiscordMember {
        user: { id: string; username: string; global_name: string | null };
        nick: string | null;
        roles: string[];
      }
      const allDiscordMembers: DiscordMember[] = [];
      let after = '0';
      for (let page = 0; page < 5; page++) {
        const url = `https://discord.com/api/v10/guilds/${guildId}/members?limit=1000&after=${after}`;
        const r = await fetch(url, { headers: { Authorization: `Bot ${botToken}` } });
        if (!r.ok) break;
        const batch = (await r.json()) as DiscordMember[];
        if (batch.length === 0) break;
        allDiscordMembers.push(...batch);
        if (batch.length < 1000) break;
        after = batch[batch.length - 1]!.user.id;
      }

      // Build a discordId → linked member map for quick lookup
      const linkedByDiscordId = new Map(linked.map((l) => [l.discordId, l]));
      const inOrgDiscordIds = new Set(linked.filter((l) => l.inOrg).map((l) => l.discordId));

      const viewerRoleSet = new Set(viewerRoles);
      for (const dm of allDiscordMembers) {
        if (!dm.roles.some((r) => viewerRoleSet.has(r))) continue;
        if (inOrgDiscordIds.has(dm.user.id)) continue; // already shown in "In Org"
        const linked_member = linkedByDiscordId.get(dm.user.id);
        viewers.push({
          discordId: dm.user.id,
          discordUsername: dm.nick ?? dm.user.global_name ?? dm.user.username,
          rsiHandle: linked_member?.rsiHandle ?? null,
          verified: linked_member?.verified ?? false,
        });
      }
      viewers.sort((a, b) => a.discordUsername.localeCompare(b.discordUsername));
    }
  }

  res.json({
    success: true,
    data: { orgTag, linked, orgOnly, viewers, total: orgMembers.length } satisfies RsiRosterDto,
  } satisfies ApiResponse<RsiRosterDto>);
});
