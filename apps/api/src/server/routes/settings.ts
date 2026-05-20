import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
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

// ── Raw-SQL helpers ───────────────────────────────────────────────────────────
// eventCreatorRoles and moduleEditorRoles were added after the last prisma
// generate, so we access them via $queryRaw / $executeRaw to avoid
// PrismaClientValidationError or a missing-column issue on stale clients.

interface PermissionFields {
  eventCreatorRoles: string[];
  moduleEditorRoles: string[];
  viewerRoles: string[];
}

async function readPermissionFields(settingsId: string): Promise<PermissionFields> {
  const rows = await prisma.$queryRaw<{ eventCreatorRoles: string; moduleEditorRoles: string; viewerRoles: string }[]>`
    SELECT eventCreatorRoles, moduleEditorRoles, viewerRoles FROM GuildSettings WHERE id = ${settingsId}
  `;
  return {
    eventCreatorRoles: JSON.parse(rows[0]?.eventCreatorRoles ?? '[]') as string[],
    moduleEditorRoles: JSON.parse(rows[0]?.moduleEditorRoles ?? '[]') as string[],
    viewerRoles:       JSON.parse(rows[0]?.viewerRoles       ?? '[]') as string[],
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
    const { eventCreatorRoles, moduleEditorRoles, viewerRoles } = s
      ? await readPermissionFields(s.id)
      : { eventCreatorRoles: [], moduleEditorRoles: [], viewerRoles: [] };
    res.json({
      success: true,
      data: {
        forumChannelId: s?.forumChannelId ?? null,
        voiceCategoryId: s?.voiceCategoryId ?? null,
        eventCreatorRoles,
        moduleEditorRoles,
        viewerRoles,
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
  const body = req.body as {
    forumChannelId?: string | null;
    voiceCategoryId?: string | null;
    eventCreatorRoles?: string[];
    moduleEditorRoles?: string[];
    viewerRoles?: string[];
  };

  // moduleEditorRoles and viewerRoles are admin-only fields — require full guild manager
  const needsAdmin = body.moduleEditorRoles !== undefined || body.viewerRoles !== undefined;
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

    // Upsert the fields the generated Prisma client knows about
    const s = await prisma.guildSettings.upsert({
      where: { guildId: guild.id },
      update: {
        ...(body.forumChannelId !== undefined ? { forumChannelId: body.forumChannelId } : {}),
        ...(body.voiceCategoryId !== undefined ? { voiceCategoryId: body.voiceCategoryId } : {}),
      },
      create: {
        guildId: guild.id,
        forumChannelId: body.forumChannelId ?? null,
        voiceCategoryId: body.voiceCategoryId ?? null,
      },
    });

    // Write JSON-array fields via raw SQL — works even with a stale Prisma client
    if (body.eventCreatorRoles !== undefined) {
      const encoded = JSON.stringify(body.eventCreatorRoles);
      await prisma.$executeRaw`UPDATE GuildSettings SET eventCreatorRoles = ${encoded} WHERE id = ${s.id}`;
    }
    if (body.moduleEditorRoles !== undefined) {
      const encoded = JSON.stringify(body.moduleEditorRoles);
      await prisma.$executeRaw`UPDATE GuildSettings SET moduleEditorRoles = ${encoded} WHERE id = ${s.id}`;
    }
    if (body.viewerRoles !== undefined) {
      const encoded = JSON.stringify(body.viewerRoles);
      await prisma.$executeRaw`UPDATE GuildSettings SET viewerRoles = ${encoded} WHERE id = ${s.id}`;
    }

    const { eventCreatorRoles, moduleEditorRoles, viewerRoles } = await readPermissionFields(s.id);
    res.json({
      success: true,
      data: {
        forumChannelId: s.forumChannelId ?? null,
        voiceCategoryId: s.voiceCategoryId ?? null,
        eventCreatorRoles,
        moduleEditorRoles,
        viewerRoles,
      },
    } satisfies ApiResponse);
  } catch (err) {
    console.error('[settings/patch]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

