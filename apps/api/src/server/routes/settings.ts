import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { assertEventCreator } from '../../lib/assertEventCreator.js';
import { assertEventViewer } from '../../lib/assertEventViewer.js';
import { assertLootDraftCreator } from '../../lib/assertLootDraftCreator.js';
import { triggerBot } from '../../lib/triggerBot.js';
import { ValidationError, optStr, optStrArr, optBool, optNonNegInt, requireStr } from '../../lib/validate.js';
import type { ApiResponse } from '@dem/shared';

export const settingsRouter = Router();

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  position: number;
  parent_id: string | null;
}

interface DiscordRole {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
}

// ── GET /api/guilds/:guildId/my-permissions ───────────────────────────────────

settingsRouter.get('/:guildId/my-permissions', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  try {
    const [canManageEvents, canViewEvents, canCreateLootDraft] = await Promise.all([
      assertEventCreator(req, guildId),
      assertEventViewer(req, guildId),
      assertLootDraftCreator(req, guildId),
    ]);
    const guild = await prisma.guild.findUnique({ where: { guildId }, include: { settings: true } });
    const s = guild?.settings;

    const orgRequired = !!(s?.rsiOrgTag);
    let rsiVerified = false;
    if (orgRequired && guild) {
      const member = await prisma.guildMember.findUnique({
        where: { userId_guildId: { userId: req.session.userId!, guildId: guild.id } },
        select: { rsiVerified: true },
      });
      rsiVerified = member?.rsiVerified ?? false;
    }

    res.json({
      success: true,
      data: {
        canManageEvents,
        canViewEvents,
        canCreateLootDraft,
        eventBotEnabled:    s?.eventBotEnabled    ?? true,
        dkpEnabled:         s?.dkpEnabled         ?? true,
        lootEnabled:        s?.lootEnabled         ?? true,
        exchangeEnabled:    s?.exchangeEnabled     ?? true,
        fleetEnabled:       s?.fleetEnabled        ?? true,
        blueprintsEnabled:  s?.blueprintsEnabled   ?? true,
        craftingEnabled:    s?.craftingEnabled     ?? true,
        activityEnabled:    s?.activityEnabled     ?? true,
        activityHeatmapPublic: s?.activityHeatmapPublic ?? true,
        tournamentsEnabled: s?.tournamentsEnabled  ?? true,
        rsiOrgRequired:     orgRequired,
        rsiVerified,
      },
    } satisfies ApiResponse);
  } catch (err) {
    console.error('[settings/my-permissions]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── GET /api/guilds/:guildId/roles ────────────────────────────────────────────

settingsRouter.get('/:guildId/roles', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };

  if (!(await assertModuleEditor(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const botToken = process.env['DISCORD_TOKEN'];
  if (!botToken) {
    res.status(500).json({ success: false, error: 'Bot token not configured' } satisfies ApiResponse);
    return;
  }

  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (!response.ok) {
      res.status(502).json({ success: false, error: 'Failed to fetch roles from Discord' } satisfies ApiResponse);
      return;
    }
    const all = (await response.json()) as DiscordRole[];
    // Exclude @everyone (id === guildId) and bot-managed roles
    const roles = all
      .filter((r) => r.id !== guildId && !r.managed)
      .sort((a, b) => b.position - a.position);
    res.json({ success: true, data: { roles } } satisfies ApiResponse);
  } catch (err) {
    console.error('[settings/roles]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── GET /api/guilds/:guildId/channels ─────────────────────────────────────────

settingsRouter.get('/:guildId/channels', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };

  if (!(await assertModuleEditor(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const botToken = process.env['DISCORD_TOKEN'];
  if (!botToken) {
    res.status(500).json({ success: false, error: 'Bot token not configured' } satisfies ApiResponse);
    return;
  }

  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${botToken}` },
    });

    if (!response.ok) {
      res.status(502).json({ success: false, error: 'Failed to fetch channels from Discord' } satisfies ApiResponse);
      return;
    }

    const all = (await response.json()) as DiscordChannel[];
    // Sort: categories first by position, then channels by position within their category
    const channels = all.sort((a, b) => {
      const aCat = a.type === 4 ? a.position : (all.find(c => c.id === a.parent_id)?.position ?? 999);
      const bCat = b.type === 4 ? b.position : (all.find(c => c.id === b.parent_id)?.position ?? 999);
      if (aCat !== bCat) return aCat - bCat;
      if (a.type === 4) return -1;
      if (b.type === 4) return 1;
      return a.position - b.position;
    });

    res.json({ success: true, data: { channels } } satisfies ApiResponse);
  } catch (err) {
    console.error('[settings/channels]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── Permission fields helpers ─────────────────────────────────────────────────

interface PermissionFields {
  eventCreatorRoles: string[];
  moduleEditorRoles: string[];
  viewerRoles: string[];
}

async function readPermissionFields(settingsId: string): Promise<PermissionFields & { dkpLabel: string; lootDraftCreatorRoles: string[]; allianceManagerRoles: string[] }> {
  const settings = await prisma.guildSettings.findUnique({
    where: { id: settingsId },
    select: { eventCreatorRoles: true, moduleEditorRoles: true, viewerRoles: true, dkpLabel: true, lootDraftCreatorRoles: true, allianceManagerRoles: true } as Record<string, boolean>,
  });
  const s = settings as unknown as Record<string, string | undefined>;
  return {
    eventCreatorRoles:      JSON.parse(s['eventCreatorRoles']      ?? '[]') as string[],
    moduleEditorRoles:      JSON.parse(s['moduleEditorRoles']      ?? '[]') as string[],
    viewerRoles:            JSON.parse(s['viewerRoles']            ?? '[]') as string[],
    dkpLabel:               s['dkpLabel'] ?? 'DKP',
    lootDraftCreatorRoles:  JSON.parse(s['lootDraftCreatorRoles']  ?? '[]') as string[],
    allianceManagerRoles:   JSON.parse(s['allianceManagerRoles']   ?? '[]') as string[],
  };
}

// ── Module-editor permission check ────────────────────────────────────────────
// Guild managers always pass. Non-managers pass if they hold any moduleEditorRole.

async function assertModuleEditor(req: Express.Request, guildId: string): Promise<boolean> {
  if (await assertGuildManager(req, guildId)) return true;

  const guild = await prisma.guild.findUnique({ where: { guildId }, include: { settings: true } });
  const settingsId = guild?.settings?.id;
  if (!settingsId) return false;

  const { moduleEditorRoles } = await readPermissionFields(settingsId);
  if (moduleEditorRoles.length === 0) return false;

  const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
  const botToken = process.env['DISCORD_TOKEN'];
  if (!dbUser || !botToken) return false;

  try {
    const r = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${dbUser.discordId}`,
      { headers: { Authorization: `Bot ${botToken}` } },
    );
    if (r.ok) {
      const member = (await r.json()) as { roles: string[] };
      return member.roles.some((id) => moduleEditorRoles.includes(id));
    }
  } catch {}
  return false;
}

// ── GET /api/guilds/:guildId/settings ─────────────────────────────────────────

settingsRouter.get('/:guildId/settings', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };

  if (!(await assertModuleEditor(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  try {
    const guild = await prisma.guild.findUnique({ where: { guildId }, include: { settings: true } });
    const s = guild?.settings;
    const { eventCreatorRoles, moduleEditorRoles, viewerRoles, dkpLabel, lootDraftCreatorRoles, allianceManagerRoles } = s
      ? await readPermissionFields(s.id)
      : { eventCreatorRoles: [], moduleEditorRoles: [], viewerRoles: [], dkpLabel: 'DKP', lootDraftCreatorRoles: [], allianceManagerRoles: [] };
    res.json({
      success: true,
      data: {
        forumChannelId:             s?.forumChannelId             ?? null,
        eventChannelId:             s?.eventChannelId             ?? null,
        voiceCategoryId:            s?.voiceCategoryId            ?? null,
        lootChannelId:              s?.lootChannelId              ?? null,
        dkpAnnouncementChannelId:   s?.dkpAnnouncementChannelId   ?? null,
        timezone:                   s?.timezone                   ?? 'UTC',
        eventCreatorRoles,
        moduleEditorRoles,
        viewerRoles,
        dkpLabel,
        lootDraftCreatorRoles,
        allianceManagerRoles,
        eventBotEnabled:            s?.eventBotEnabled            ?? true,
        dkpEnabled:                 s?.dkpEnabled                 ?? true,
        lootEnabled:                s?.lootEnabled                ?? true,
        exchangeEnabled:            s?.exchangeEnabled            ?? true,
        fleetEnabled:               s?.fleetEnabled               ?? true,
        blueprintsEnabled:          s?.blueprintsEnabled          ?? true,
        craftingEnabled:            s?.craftingEnabled            ?? true,
        activityEnabled:            s?.activityEnabled            ?? true,
        activityHeatmapPublic:      s?.activityHeatmapPublic      ?? true,
        tournamentsEnabled:         s?.tournamentsEnabled          ?? true,
        tournamentChannelId:        s?.tournamentChannelId         ?? null,
        dkpDefaultAuctionDuration:  s?.dkpDefaultAuctionDuration  ?? 24,
        dkpMinBid:                  s?.dkpMinBid                  ?? 0,
        lootDefaultMethod:          s?.lootDefaultMethod          ?? 'RANDOM_ROLL',
        rsiOrgTag:                  s?.rsiOrgTag                  ?? null,
        allianceTag:                s?.allianceTag                 ?? null,
      },
    } satisfies ApiResponse);
  } catch (err) {
    console.error('[settings/get]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── PATCH /api/guilds/:guildId/settings ───────────────────────────────────────

settingsRouter.patch('/:guildId/settings', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const raw = req.body as Record<string, unknown>;

  // Validate before checking permissions
  let body: {
    forumChannelId?: string | null;
    eventChannelId?: string | null;
    voiceCategoryId?: string | null;
    lootChannelId?: string | null;
    dkpAnnouncementChannelId?: string | null;
    timezone?: string;
    eventCreatorRoles?: string[];
    moduleEditorRoles?: string[];
    viewerRoles?: string[];
    dkpLabel?: string;
    lootDraftCreatorRoles?: string[];
    allianceManagerRoles?: string[];
    eventBotEnabled?: boolean;
    dkpEnabled?: boolean;
    lootEnabled?: boolean;
    exchangeEnabled?: boolean;
    fleetEnabled?: boolean;
    blueprintsEnabled?: boolean;
    craftingEnabled?: boolean;
    activityEnabled?: boolean;
    activityHeatmapPublic?: boolean;
    tournamentsEnabled?: boolean;
    tournamentChannelId?: string | null;
    dkpDefaultAuctionDuration?: number;
    dkpMinBid?: number;
    lootDefaultMethod?: string;
    rsiOrgTag?: string | null;
    allianceTag?: string | null;
  };
  try {
    const rawDur = raw.dkpDefaultAuctionDuration !== undefined ? optNonNegInt(raw.dkpDefaultAuctionDuration, 'dkpDefaultAuctionDuration') : undefined;
    const rawMin = raw.dkpMinBid !== undefined ? optNonNegInt(raw.dkpMinBid, 'dkpMinBid') : undefined;
    const LOOT_METHODS = ['RANDOM_ROLL', 'DKP', 'SNAKE_DRAFT'] as const;
    body = {
      forumChannelId:            raw.forumChannelId !== undefined ? optStr(raw.forumChannelId, 'forumChannelId', 30) : undefined,
      eventChannelId:            raw.eventChannelId !== undefined ? optStr(raw.eventChannelId, 'eventChannelId', 30) : undefined,
      voiceCategoryId:           raw.voiceCategoryId !== undefined ? optStr(raw.voiceCategoryId, 'voiceCategoryId', 30) : undefined,
      lootChannelId:             raw.lootChannelId !== undefined ? optStr(raw.lootChannelId, 'lootChannelId', 30) : undefined,
      dkpAnnouncementChannelId:  raw.dkpAnnouncementChannelId !== undefined ? optStr(raw.dkpAnnouncementChannelId, 'dkpAnnouncementChannelId', 30) : undefined,
      timezone:                  raw.timezone !== undefined ? requireStr(raw.timezone, 'timezone', 60) : undefined,
      eventCreatorRoles:         raw.eventCreatorRoles !== undefined ? optStrArr(raw.eventCreatorRoles, 'eventCreatorRoles', 100, 30) : undefined,
      moduleEditorRoles:         raw.moduleEditorRoles !== undefined ? optStrArr(raw.moduleEditorRoles, 'moduleEditorRoles', 100, 30) : undefined,
      viewerRoles:               raw.viewerRoles !== undefined ? optStrArr(raw.viewerRoles, 'viewerRoles', 100, 30) : undefined,
      dkpLabel:                  raw.dkpLabel !== undefined ? requireStr(raw.dkpLabel, 'dkpLabel', 30) : undefined,
      lootDraftCreatorRoles:     raw.lootDraftCreatorRoles !== undefined ? optStrArr(raw.lootDraftCreatorRoles, 'lootDraftCreatorRoles', 100, 30) : undefined,
      allianceManagerRoles:      raw.allianceManagerRoles !== undefined ? optStrArr(raw.allianceManagerRoles, 'allianceManagerRoles', 100, 30) : undefined,
      eventBotEnabled:           raw.eventBotEnabled !== undefined ? optBool(raw.eventBotEnabled, 'eventBotEnabled') : undefined,
      dkpEnabled:                raw.dkpEnabled !== undefined ? optBool(raw.dkpEnabled, 'dkpEnabled') : undefined,
      lootEnabled:               raw.lootEnabled !== undefined ? optBool(raw.lootEnabled, 'lootEnabled') : undefined,
      exchangeEnabled:           raw.exchangeEnabled !== undefined ? optBool(raw.exchangeEnabled, 'exchangeEnabled') : undefined,
      fleetEnabled:              raw.fleetEnabled !== undefined ? optBool(raw.fleetEnabled, 'fleetEnabled') : undefined,
      blueprintsEnabled:         raw.blueprintsEnabled !== undefined ? optBool(raw.blueprintsEnabled, 'blueprintsEnabled') : undefined,
      craftingEnabled:           raw.craftingEnabled !== undefined ? optBool(raw.craftingEnabled, 'craftingEnabled') : undefined,
      activityEnabled:           raw.activityEnabled !== undefined ? optBool(raw.activityEnabled, 'activityEnabled') : undefined,
      activityHeatmapPublic:     raw.activityHeatmapPublic !== undefined ? optBool(raw.activityHeatmapPublic, 'activityHeatmapPublic') : undefined,
      tournamentsEnabled:        raw.tournamentsEnabled !== undefined ? optBool(raw.tournamentsEnabled, 'tournamentsEnabled') : undefined,
      tournamentChannelId:       raw.tournamentChannelId !== undefined ? optStr(raw.tournamentChannelId, 'tournamentChannelId', 30) : undefined,
      dkpDefaultAuctionDuration: rawDur !== undefined ? Math.min(168, Math.max(1, rawDur)) : undefined,
      dkpMinBid:                 rawMin !== undefined ? Math.max(0, rawMin) : undefined,
      lootDefaultMethod:         raw.lootDefaultMethod !== undefined && LOOT_METHODS.includes(raw.lootDefaultMethod as typeof LOOT_METHODS[number]) ? raw.lootDefaultMethod as string : undefined,
      rsiOrgTag:                 raw.rsiOrgTag !== undefined ? optStr(raw.rsiOrgTag, 'rsiOrgTag', 20) : undefined,
      allianceTag:               raw.allianceTag !== undefined ? optStr(raw.allianceTag, 'allianceTag', 4) : undefined,
    };
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ success: false, error: err.message } satisfies ApiResponse);
      return;
    }
    throw err;
  }

  // Enable toggles, editor/viewer roles, dkpLabel, and lootDraftCreatorRoles are admin-only fields — require full guild manager
  const needsAdmin =
    body.moduleEditorRoles !== undefined ||
    body.viewerRoles !== undefined ||
    body.dkpLabel !== undefined ||
    body.lootDraftCreatorRoles !== undefined ||
    body.allianceManagerRoles !== undefined ||
    body.eventBotEnabled !== undefined ||
    body.dkpEnabled !== undefined ||
    body.lootEnabled !== undefined ||
    body.exchangeEnabled !== undefined ||
    body.fleetEnabled !== undefined ||
    body.blueprintsEnabled !== undefined ||
    body.craftingEnabled !== undefined ||
    body.activityEnabled !== undefined ||
    body.activityHeatmapPublic !== undefined ||
    body.tournamentsEnabled !== undefined;
  const allowed = needsAdmin
    ? await assertGuildManager(req, guildId)
    : await assertModuleEditor(req, guildId);

  if (!allowed) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  try {
    const guild = await prisma.guild.findUnique({ where: { guildId } });
    if (!guild) {
      res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
      return;
    }

    const s = await prisma.guildSettings.upsert({
      where: { guildId: guild.id },
      update: {
        ...(body.forumChannelId !== undefined            ? { forumChannelId: body.forumChannelId }                                   : {}),
        ...(body.eventChannelId !== undefined            ? { eventChannelId: body.eventChannelId }                                   : {}),
        ...(body.voiceCategoryId !== undefined           ? { voiceCategoryId: body.voiceCategoryId }                                 : {}),
        ...(body.lootChannelId !== undefined             ? { lootChannelId: body.lootChannelId }                                     : {}),
        ...(body.dkpAnnouncementChannelId !== undefined  ? { dkpAnnouncementChannelId: body.dkpAnnouncementChannelId }               : {}),
        ...(body.timezone !== undefined                  ? { timezone: body.timezone }                                               : {}),
        ...(body.eventCreatorRoles !== undefined         ? { eventCreatorRoles: JSON.stringify(body.eventCreatorRoles) }             : {}),
        ...(body.moduleEditorRoles !== undefined         ? { moduleEditorRoles: JSON.stringify(body.moduleEditorRoles) }             : {}),
        ...(body.viewerRoles !== undefined               ? { viewerRoles: JSON.stringify(body.viewerRoles) }                         : {}),
        ...(body.dkpLabel !== undefined                  ? { dkpLabel: body.dkpLabel }                                               : {}),
        ...(body.lootDraftCreatorRoles !== undefined     ? { lootDraftCreatorRoles: JSON.stringify(body.lootDraftCreatorRoles) }     : {}),
        ...(body.allianceManagerRoles !== undefined      ? { allianceManagerRoles:  JSON.stringify(body.allianceManagerRoles) }      : {}),
        ...(body.eventBotEnabled !== undefined           ? { eventBotEnabled: body.eventBotEnabled }                                 : {}),
        ...(body.dkpEnabled !== undefined                ? { dkpEnabled: body.dkpEnabled }                                           : {}),
        ...(body.lootEnabled !== undefined               ? { lootEnabled: body.lootEnabled }                                         : {}),
        ...(body.exchangeEnabled !== undefined           ? { exchangeEnabled: body.exchangeEnabled }                                 : {}),
        ...(body.fleetEnabled !== undefined              ? { fleetEnabled: body.fleetEnabled }                                       : {}),
        ...(body.blueprintsEnabled !== undefined         ? { blueprintsEnabled: body.blueprintsEnabled }                             : {}),
        ...(body.craftingEnabled !== undefined           ? { craftingEnabled: body.craftingEnabled }                                 : {}),
        ...(body.activityEnabled !== undefined           ? { activityEnabled: body.activityEnabled }                                 : {}),
        ...(body.activityHeatmapPublic !== undefined     ? { activityHeatmapPublic: body.activityHeatmapPublic }                     : {}),
        ...(body.tournamentsEnabled !== undefined         ? { tournamentsEnabled: body.tournamentsEnabled }                           : {}),
        ...(body.tournamentChannelId !== undefined        ? { tournamentChannelId: body.tournamentChannelId }                         : {}),
        ...(body.dkpDefaultAuctionDuration !== undefined ? { dkpDefaultAuctionDuration: body.dkpDefaultAuctionDuration }             : {}),
        ...(body.dkpMinBid !== undefined                 ? { dkpMinBid: body.dkpMinBid }                                             : {}),
        ...(body.lootDefaultMethod !== undefined         ? { lootDefaultMethod: body.lootDefaultMethod }                             : {}),
        ...(body.rsiOrgTag !== undefined                 ? { rsiOrgTag: body.rsiOrgTag }                                             : {}),
        ...(body.allianceTag !== undefined               ? { allianceTag: body.allianceTag }                                         : {}),
      },
      create: {
        guildId:                    guild.id,
        forumChannelId:             body.forumChannelId             ?? null,
        eventChannelId:             body.eventChannelId             ?? null,
        voiceCategoryId:            body.voiceCategoryId            ?? null,
        lootChannelId:              body.lootChannelId              ?? null,
        dkpAnnouncementChannelId:   body.dkpAnnouncementChannelId   ?? null,
        timezone:                   body.timezone                   ?? 'UTC',
        eventCreatorRoles:          JSON.stringify(body.eventCreatorRoles          ?? []),
        moduleEditorRoles:          JSON.stringify(body.moduleEditorRoles          ?? []),
        viewerRoles:                JSON.stringify(body.viewerRoles                ?? []),
        dkpLabel:                   body.dkpLabel                   ?? 'DKP',
        lootDraftCreatorRoles:      JSON.stringify(body.lootDraftCreatorRoles      ?? []),
        allianceManagerRoles:       JSON.stringify(body.allianceManagerRoles       ?? []),
        eventBotEnabled:            body.eventBotEnabled            ?? true,
        dkpEnabled:                 body.dkpEnabled                 ?? true,
        lootEnabled:                body.lootEnabled                ?? true,
        exchangeEnabled:            body.exchangeEnabled            ?? true,
        fleetEnabled:               body.fleetEnabled               ?? true,
        blueprintsEnabled:          body.blueprintsEnabled          ?? true,
        craftingEnabled:            body.craftingEnabled            ?? true,
        activityEnabled:            body.activityEnabled            ?? true,
        activityHeatmapPublic:      body.activityHeatmapPublic      ?? true,
        tournamentsEnabled:         body.tournamentsEnabled          ?? true,
        tournamentChannelId:        body.tournamentChannelId         ?? null,
        dkpDefaultAuctionDuration:  body.dkpDefaultAuctionDuration  ?? 24,
        dkpMinBid:                  body.dkpMinBid                  ?? 0,
        lootDefaultMethod:          body.lootDefaultMethod          ?? 'RANDOM_ROLL',
        rsiOrgTag:                  body.rsiOrgTag                  ?? null,
        allianceTag:                body.allianceTag                ?? null,
      },
    });

    const { eventCreatorRoles, moduleEditorRoles, viewerRoles, dkpLabel, lootDraftCreatorRoles, allianceManagerRoles } = await readPermissionFields(s.id);
    res.json({
      success: true,
      data: {
        forumChannelId:             s.forumChannelId             ?? null,
        eventChannelId:             s.eventChannelId             ?? null,
        voiceCategoryId:            s.voiceCategoryId            ?? null,
        lootChannelId:              s.lootChannelId              ?? null,
        dkpAnnouncementChannelId:   s.dkpAnnouncementChannelId   ?? null,
        timezone:                   s.timezone                   ?? 'UTC',
        eventCreatorRoles,
        moduleEditorRoles,
        viewerRoles,
        dkpLabel,
        lootDraftCreatorRoles,
        allianceManagerRoles,
        eventBotEnabled:            s.eventBotEnabled            ?? true,
        dkpEnabled:                 s.dkpEnabled                 ?? true,
        lootEnabled:                s.lootEnabled                ?? true,
        exchangeEnabled:            s.exchangeEnabled            ?? true,
        fleetEnabled:               s.fleetEnabled               ?? true,
        blueprintsEnabled:          s.blueprintsEnabled          ?? true,
        craftingEnabled:            s.craftingEnabled            ?? true,
        activityEnabled:            s.activityEnabled            ?? true,
        activityHeatmapPublic:      s.activityHeatmapPublic      ?? true,
        tournamentsEnabled:         s.tournamentsEnabled          ?? true,
        tournamentChannelId:        s.tournamentChannelId         ?? null,
        dkpDefaultAuctionDuration:  s.dkpDefaultAuctionDuration  ?? 24,
        dkpMinBid:                  s.dkpMinBid                  ?? 0,
        lootDefaultMethod:          s.lootDefaultMethod          ?? 'RANDOM_ROLL',
        rsiOrgTag:                  s.rsiOrgTag                  ?? null,
        allianceTag:                s.allianceTag                ?? null,
      },
    } satisfies ApiResponse);
  } catch (err) {
    console.error('[settings/patch]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── POST /api/guilds/:guildId/settings/register-commands ─────────────────────

settingsRouter.post('/:guildId/settings/register-commands', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!await assertGuildManager(req, guildId)) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }
  triggerBot('/trigger/register-commands');
  res.json({ success: true, data: null } satisfies ApiResponse);
});

// ── GET /api/guilds/:guildId/settings/label (any authenticated user) ──────────

settingsRouter.get('/:guildId/settings/label', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const guild = await prisma.guild.findUnique({ where: { guildId }, include: { settings: true } });
  const dkpLabel = guild?.settings?.dkpLabel ?? 'DKP';
  res.json({ success: true, data: { dkpLabel } } satisfies ApiResponse<{ dkpLabel: string }>);
});

// ── GET /api/guilds/:guildId/settings/bot-config ──────────────────────────────

settingsRouter.get('/:guildId/settings/bot-config', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!await assertGuildManager(req, guildId)) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }
  const config = await prisma.botConfig.findUnique({ where: { id: 1 } });
  res.json({
    success: true,
    data: { globalCommandsEnabled: config?.globalCommandsEnabled ?? true },
  } satisfies ApiResponse);
});

// ── PATCH /api/guilds/:guildId/settings/bot-config ────────────────────────────

settingsRouter.patch('/:guildId/settings/bot-config', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!await assertGuildManager(req, guildId)) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }
  const body = req.body as Record<string, unknown>;
  if (typeof body.globalCommandsEnabled !== 'boolean') {
    res.status(400).json({ success: false, error: 'globalCommandsEnabled must be a boolean' } satisfies ApiResponse);
    return;
  }
  const config = await prisma.botConfig.upsert({
    where: { id: 1 },
    create: { id: 1, globalCommandsEnabled: body.globalCommandsEnabled },
    update: { globalCommandsEnabled: body.globalCommandsEnabled },
  });
  triggerBot('/trigger/register-commands');
  res.json({ success: true, data: { globalCommandsEnabled: config.globalCommandsEnabled } } satisfies ApiResponse);
});
