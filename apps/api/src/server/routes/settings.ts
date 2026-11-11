import { cachedDiscordGet } from '../../lib/discordRest.js';
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { assertModuleEditor } from '../../lib/assertModuleEditor.js';
import { assertEventCreator } from '../../lib/assertEventCreator.js';
import { assertEventViewer } from '../../lib/assertEventViewer.js';
import { assertLootDraftCreator } from '../../lib/assertLootDraftCreator.js';
import { assertAllianceManager } from '../../lib/assertAllianceManager.js';
import { triggerBot } from '../../lib/triggerBot.js';
import { ValidationError } from '../../lib/validate.js';
import { applySettingsPatch, parseSettingsPatch, patchNeedsManager, readPermissionFields, type SettingsPatch } from '../../lib/guildSettings.js';
import { setupChecklist, type ApiResponse, type DiscordChannelInfo, type DiscordRoleInfo, type SetupChecklistDto, type SetupDiscord } from '@dem/shared';

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
    const [canManageEvents, canViewEvents, canCreateLootDraft, canManageAllies] = await Promise.all([
      assertEventCreator(req, guildId),
      assertEventViewer(req, guildId),
      assertLootDraftCreator(req, guildId),
      assertAllianceManager(req, guildId),
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
        canManageAllies,
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
        jobsEnabled:        s?.jobsEnabled         ?? true,
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
    // Cached 30 s (lib/discordRest.ts): settings pages ask for this on every visit.
    const r = await cachedDiscordGet<DiscordRole[]>(`roles:${guildId}`, `/guilds/${guildId}/roles`, `roles:${guildId}`, 30_000);
    if (!r.ok) {
      res.status(r.unavailable ? 503 : 502).json({ success: false, error: r.unavailable ? 'Discord is busy right now. Try again in a few seconds.' : 'Failed to fetch roles from Discord' } satisfies ApiResponse);
      return;
    }
    const all = [...r.data];
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
    // Cached 30 s (lib/discordRest.ts): every settings page with a channel picker asks for this.
    const r = await cachedDiscordGet<DiscordChannel[]>(`channels:${guildId}`, `/guilds/${guildId}/channels`, `channels:${guildId}`, 30_000);
    if (!r.ok) {
      res.status(r.unavailable ? 503 : 502).json({ success: false, error: r.unavailable ? 'Discord is busy right now. Try again in a few seconds.' : 'Failed to fetch channels from Discord' } satisfies ApiResponse);
      return;
    }

    const all = [...r.data];
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
        tournamentHideElo:          s?.tournamentHideElo           ?? false,
        tournamentChannelId:        s?.tournamentChannelId         ?? null,
        h2hChannelId:               s?.h2hChannelId                ?? null,
        statusChannelId:            s?.statusChannelId             ?? null,
        allyNoticeChannelId:        s?.allyNoticeChannelId         ?? null,
        jobsEnabled:                s?.jobsEnabled                 ?? true,
        jobsChannelId:              s?.jobsChannelId               ?? null,
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

  let body: SettingsPatch;
  try {
    body = parseSettingsPatch(raw);
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ success: false, error: err.message } satisfies ApiResponse);
      return;
    }
    throw err;
  }

  // Enable toggles, editor/viewer roles, dkpLabel, and lootDraftCreatorRoles are admin-only fields — require full guild manager
  const needsAdmin = patchNeedsManager(body);
  const allowed = needsAdmin
    ? await assertGuildManager(req, guildId)
    : await assertModuleEditor(req, guildId);

  if (!allowed) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  try {
    const saved = await applySettingsPatch(guildId, body);
    if (!saved) {
      res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
      return;
    }
    res.json({ success: true, data: saved } satisfies ApiResponse);
  } catch (err) {
    console.error('[settings/patch]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── GET / PUT /api/guilds/:guildId/setup (v1.15.0) ───────────────────────────
// The setup checklist for officers who can change settings. Others get null
// (not an error), so the server page can simply ask.

/** The bot's own channels-and-roles view of a server, or null when Discord can't say right now. */
async function setupDiscord(guildId: string): Promise<SetupDiscord | null> {
  const [me, channels, roles] = await Promise.all([
    cachedDiscordGet<{ id: string }>('bot-user', '/users/@me', 'users', 24 * 3600_000),
    cachedDiscordGet<DiscordChannelInfo[]>(`channels:${guildId}`, `/guilds/${guildId}/channels`, `channels:${guildId}`, 30_000),
    cachedDiscordGet<(DiscordRoleInfo & DiscordRole)[]>(`roles:${guildId}`, `/guilds/${guildId}/roles`, `roles:${guildId}`, 30_000),
  ]);
  if (!me.ok || !channels.ok || !roles.ok) return null;
  const member = await cachedDiscordGet<{ roles: string[] }>(`bot-member:${guildId}`, `/guilds/${guildId}/members/${me.data.id}`, `member:${guildId}`, 30_000);
  if (!member.ok) return null;
  return { guildId, botId: me.data.id, botRoleIds: member.data.roles, channels: channels.data, roles: roles.data };
}

settingsRouter.get('/:guildId/setup', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertModuleEditor(req, guildId))) {
    res.json({ success: true, data: null } satisfies ApiResponse<SetupChecklistDto | null>);
    return;
  }
  const guild = await prisma.guild.findUnique({ where: { guildId }, include: { settings: true } });
  const [discord, anyEvent] = await Promise.all([
    setupDiscord(guildId),
    prisma.event.findFirst({ where: { guildId }, select: { id: true } }),
  ]);
  const steps = setupChecklist({ settings: (guild?.settings ?? null) as Record<string, unknown> | null, hasEvents: !!anyEvent, discord });
  res.json({ success: true, data: { steps, hidden: guild?.settings?.setupHidden ?? false, discordChecked: !!discord } } satisfies ApiResponse<SetupChecklistDto>);
});

settingsRouter.put('/:guildId/setup/hidden', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertModuleEditor(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }
  const hidden = (req.body as { hidden?: unknown }).hidden;
  if (typeof hidden !== 'boolean') {
    res.status(400).json({ success: false, error: 'hidden must be true or false' } satisfies ApiResponse);
    return;
  }
  const guild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
  if (!guild) {
    res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
    return;
  }
  await prisma.guildSettings.upsert({ where: { guildId: guild.id }, update: { setupHidden: hidden }, create: { guildId: guild.id, setupHidden: hidden } });
  res.json({ success: true, data: { hidden } } satisfies ApiResponse);
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
