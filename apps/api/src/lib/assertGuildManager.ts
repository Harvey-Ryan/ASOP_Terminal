import { prisma } from './prisma.js';
import { getValidAccessToken } from './token-helpers.js';
import { fetchDiscordGuilds } from './discord-oauth.js';
import { canManageGuild } from '@dem/shared';

const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

/**
 * Returns true if the session user has MANAGE_GUILD (or higher) on the given
 * Discord guild. Results are cached in the session for CACHE_TTL_MS to avoid
 * a live Discord API call on every request.
 */
export async function assertGuildManager(req: Express.Request, guildId: string): Promise<boolean> {
  const now = Date.now();
  const cached = req.session.managedGuildIds;
  const cachedAt = req.session.managedGuildsCachedAt ?? 0;

  // Serve from cache while still fresh
  if (cached && now - cachedAt < CACHE_TTL_MS) {
    return cached.includes(guildId);
  }

  try {
    const account = await prisma.account.findFirst({
      where: { userId: req.session.userId!, provider: 'discord' },
    });
    if (!account) {
      console.warn('[assertGuildManager] no account for userId', req.session.userId);
      return false;
    }

    const token = await getValidAccessToken(account);
    const guilds = await fetchDiscordGuilds(token);
    const ids = guilds.filter((g) => canManageGuild(g)).map((g) => g.id);

    // Persist to session (fire-and-forget)
    req.session.managedGuildIds = ids;
    req.session.managedGuildsCachedAt = now;
    req.session.save(() => {});

    return ids.includes(guildId);
  } catch (err) {
    console.error('[assertGuildManager] Discord API call failed:', err);
    // Fall back to stale cache rather than hard-denying on a transient failure
    if (cached) {
      console.warn('[assertGuildManager] using stale cache as fallback');
      return cached.includes(guildId);
    }
    return false;
  }
}
