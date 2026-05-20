import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { fetchDiscordGuilds } from '../../lib/discord-oauth.js';
import { getValidAccessToken } from '../../lib/token-helpers.js';
import { getGuildIconUrl } from '@dem/shared';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import type { ApiResponse, ManagedGuild } from '@dem/shared';

export const guildsRouter = Router();

/**
 * GET /api/guilds
 *
 * Returns the authed user's Discord guilds where the bot is installed.
 * The permissions field is preserved so the frontend can gate admin-only nav.
 */
guildsRouter.get('/', requireAuth, async (req, res) => {
  try {
    const account = await prisma.account.findFirst({
      where: { userId: req.session.userId!, provider: 'discord' },
    });

    if (!account) {
      res.status(401).json({
        success: false,
        error: 'No linked Discord account found',
      } satisfies ApiResponse);
      return;
    }

    let accessToken: string;
    try {
      accessToken = await getValidAccessToken(account);
    } catch {
      res.status(401).json({
        success: false,
        error: 'Discord token expired – please log in again',
      } satisfies ApiResponse);
      return;
    }

    const raw = await fetchDiscordGuilds(accessToken);

    const botGuildIds = new Set(
      (await prisma.guild.findMany({ select: { guildId: true } })).map((g) => g.guildId),
    );

    const guilds: ManagedGuild[] = raw
      .filter((g) => botGuildIds.has(g.id))
      .map((g) => ({
        id: g.id,
        name: g.name,
        icon: g.icon,
        iconUrl: getGuildIconUrl(g.id, g.icon),
        owner: g.owner,
        permissions: g.permissions,
        hasBotInstalled: true,
      }))
      .sort((a, b) => {
        // Owner guilds first, then alphabetically
        if (a.owner !== b.owner) return a.owner ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    res.json({ success: true, data: guilds } satisfies ApiResponse<ManagedGuild[]>);
  } catch (err) {
    console.error('[guilds] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch guilds' } satisfies ApiResponse);
  }
});
