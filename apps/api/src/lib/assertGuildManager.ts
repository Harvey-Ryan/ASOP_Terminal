import { prisma } from './prisma.js';
import { getValidAccessToken } from './token-helpers.js';
import { fetchDiscordGuilds, GuildsFetchError } from './discord-oauth.js';
import { canManageGuild } from '@dem/shared';

// Session TTL: 30 min. Process-level cache TTL: 2 hours.
const SESSION_TTL_MS = 30 * 60_000;
const SERVER_TTL_MS = 2 * 60 * 60_000;

// Process-level cache shared across all requests — survives across session refreshes
// and prevents multiple sessions for the same user from all hitting Discord.
const serverCache = new Map<string, { ids: string[]; cachedAt: number }>();

// Per-user rate-limit expiry: after a 429, no more Discord calls until this clears.
const rateLimitedUntil = new Map<string, number>();

// In-flight deduplication: concurrent requests for the same user share one fetch.
const inflight = new Map<string, Promise<string[]>>();

async function fetchManagedIds(sessionUserId: string): Promise<string[]> {
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
 * Discord guild. Uses a two-tier cache (process-level 2h + session 30m) and
 * per-user rate-limit tracking so a 429 from Discord never causes a call storm.
 */
export async function assertGuildManager(req: Express.Request, guildId: string): Promise<boolean> {
  const now = Date.now();
  const userId = req.session.userId!;

  // 1. Process-level cache (fastest, cross-session)
  const server = serverCache.get(userId);
  if (server && now - server.cachedAt < SERVER_TTL_MS) {
    return server.ids.includes(guildId);
  }

  // 2. Session cache (promotes to server cache on hit)
  const sessionIds = req.session.managedGuildIds;
  const sessionCachedAt = req.session.managedGuildsCachedAt ?? 0;
  if (sessionIds && now - sessionCachedAt < SESSION_TTL_MS) {
    serverCache.set(userId, { ids: sessionIds, cachedAt: sessionCachedAt });
    return sessionIds.includes(guildId);
  }

  // 3. Rate-limit guard — don't hammer Discord while we're still in back-off
  const blockedUntil = rateLimitedUntil.get(userId) ?? 0;
  if (now < blockedUntil) {
    const stale = server?.ids ?? sessionIds;
    if (stale) {
      console.warn(`[assertGuildManager] rate-limited for ${userId}, using stale cache`);
      return stale.includes(guildId);
    }
    return false;
  }

  // 4. Fetch from Discord
  try {
    const ids = await fetchManagedIds(userId);
    const cachedAt = Date.now();

    serverCache.set(userId, { ids, cachedAt });
    req.session.managedGuildIds = ids;
    req.session.managedGuildsCachedAt = cachedAt;
    req.session.save(() => {});

    return ids.includes(guildId);
  } catch (err) {
    if (err instanceof GuildsFetchError && err.status === 429) {
      const retryMs = err.retryAfterMs ?? 10_000;
      rateLimitedUntil.set(userId, Date.now() + retryMs);
      console.warn(`[assertGuildManager] 429 for ${userId}, backing off ${retryMs}ms`);
    } else {
      console.error('[assertGuildManager] Discord API call failed:', err);
    }

    const stale = server?.ids ?? sessionIds;
    if (stale) {
      console.warn('[assertGuildManager] using stale cache as fallback');
      return stale.includes(guildId);
    }
    return false;
  }
}
