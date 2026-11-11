import { canManageGuild } from '@dem/shared';
import { getUserGuilds, GuildsUnavailableError } from './userGuilds.js';

// How old a server list the manager check accepts. The session keeps a copy,
// so a restart doesn't send everyone to Discord at once.
const MAX_AGE_MS = 30 * 60_000;

/**
 * Returns true if the session user has MANAGE_GUILD (or higher) on the given
 * Discord guild. The list comes from lib/userGuilds.ts (shared with /auth/me,
 * one Discord call per person at a time, rate limits handled there). If
 * Discord can't be asked and nothing is cached, the request is marked so a 403
 * becomes a 503 "try again" (v1.25.1; it used to answer "not a manager").
 */
export async function assertGuildManager(req: Express.Request, guildId: string): Promise<boolean> {
  const userId = req.session.userId!;

  // The session's copy, while fresh (survives a restart; tests set it directly).
  const sessionIds = req.session.managedGuildIds;
  const sessionAt = req.session.managedGuildsCachedAt ?? 0;
  if (sessionIds && Date.now() - sessionAt < MAX_AGE_MS) return sessionIds.includes(guildId);

  try {
    const ids = (await getUserGuilds(userId, MAX_AGE_MS)).filter((g) => canManageGuild(g)).map((g) => g.id);
    req.session.managedGuildIds = ids;
    req.session.managedGuildsCachedAt = Date.now();
    req.session.save(() => {});
    return ids.includes(guildId);
  } catch (err) {
    if (sessionIds) return sessionIds.includes(guildId); // stale, but better than guessing
    if (err instanceof GuildsUnavailableError) (req as { discordUnavailable?: boolean }).discordUnavailable = true;
    else console.error('[assertGuildManager]', err);
    return false;
  }
}
