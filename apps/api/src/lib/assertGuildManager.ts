import { prisma } from './prisma.js';
import { getValidAccessToken } from './token-helpers.js';
import { fetchDiscordGuilds } from './discord-oauth.js';
import { canManageGuild } from '@dem/shared';

// 30 minutes — long enough to avoid redundant Discord calls across a session.
const CACHE_TTL_MS = 30 * 60_000;

// In-flight deduplication: if two requests arrive before the first one has
// written back to the session, they share one Discord API call instead of each
// firing independently and hitting the rate limit.
const inflight = new Map<string, Promise<string[]>>();

async function fetchManagedIds(sessionUserId: string): Promise<string[]> {
  // Coalesce concurrent callers for the same session user
  const existing = inflight.get(sessionUserId);
  if (existing) return existing;

  const promise = (async () => {
    const account = await prisma.account.findFirst({
      where: { userId: sessionUserId, provider: 'discord' },
    });
    if (!account) throw new Error(`No discord account for userId ${sessionUserId}`);

    const token = await getValidAccessToken(account);
    const guilds = await fetchDiscordGuilds(token);
    return guilds.filter((g) => canManageGuild(g)).map((g) => g.id);
  })().finally(() => inflight.delete(sessionUserId));

  inflight.set(sessionUserId, promise);
  return promise;
}

/**
 * Returns true if the session user has MANAGE_GUILD (or higher) on the given
 * Discord guild. Results are cached in the session for CACHE_TTL_MS to avoid
 * redundant Discord API calls. Concurrent requests for the same user share a
 * single in-flight fetch to prevent rate-limit (429) storms.
 */
export async function assertGuildManager(req: Express.Request, guildId: string): Promise<boolean> {
  const now = Date.now();
  const cached = req.session.managedGuildIds;
  const cachedAt = req.session.managedGuildsCachedAt ?? 0;

  if (cached && now - cachedAt < CACHE_TTL_MS) {
    return cached.includes(guildId);
  }

  try {
    const ids = await fetchManagedIds(req.session.userId!);

    req.session.managedGuildIds = ids;
    req.session.managedGuildsCachedAt = now;
    req.session.save(() => {});

    return ids.includes(guildId);
  } catch (err) {
    console.error('[assertGuildManager] Discord API call failed:', err);
    if (cached) {
      console.warn('[assertGuildManager] using stale cache as fallback');
      return cached.includes(guildId);
    }
    return false;
  }
}
