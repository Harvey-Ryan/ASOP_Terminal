// A signed-in person's Discord servers (GET /users/@me/guilds), shared by
// /auth/me and the manager check (v1.25.1). Discord rate-limits this route
// tightly per person, and both used to ask it separately (/auth/me on every
// page load, uncached), so one would often hit a 429 right after the other.
//
// - One cached list per person; callers say how old an answer they accept.
// - Concurrent callers share one Discord call, and a failure is logged once.
// - A 429 with a short Retry-After is waited out and retried once; otherwise
//   no calls until it clears, serving the last list meanwhile.

import { prisma } from './prisma.js';
import { getValidAccessToken } from './token-helpers.js';
import { fetchDiscordGuilds, GuildsFetchError, type DiscordApiGuild } from './discord-oauth.js';

const cache = new Map<string, { guilds: DiscordApiGuild[]; at: number }>();
const inflight = new Map<string, Promise<DiscordApiGuild[]>>();
const blockedUntil = new Map<string, number>();

/** Longest 429 wait worth sitting through inside a request. */
const MAX_INLINE_WAIT_MS = 5_000;

/** Discord can't be asked right now and there's no earlier answer to fall back on. */
export class GuildsUnavailableError extends Error {
  constructor(message = 'Discord is busy, so your servers couldn\'t be loaded.') { super(message); this.name = 'GuildsUnavailableError'; }
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function fetchOnce(userId: string): Promise<DiscordApiGuild[]> {
  const account = await prisma.account.findFirst({ where: { userId, provider: 'discord' } });
  if (!account) throw new Error(`No discord account for userId ${userId}`);
  const token = await getValidAccessToken(account);
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchDiscordGuilds(token);
    } catch (err) {
      if (!(err instanceof GuildsFetchError) || err.status !== 429) throw err;
      const wait = Math.max(500, err.retryAfterMs ?? 5_000);
      if (attempt === 0 && wait <= MAX_INLINE_WAIT_MS) { await sleep(wait + 100); continue; }
      blockedUntil.set(userId, Date.now() + wait);
      throw err;
    }
  }
}

/**
 * The person's servers, no older than `maxAgeMs`. While Discord is limiting
 * us, the last list is returned whatever its age; with none, it throws
 * GuildsUnavailableError.
 */
export async function getUserGuilds(userId: string, maxAgeMs: number): Promise<DiscordApiGuild[]> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.guilds;
  if (Date.now() < (blockedUntil.get(userId) ?? 0)) {
    if (hit) return hit.guilds;
    throw new GuildsUnavailableError();
  }

  let p = inflight.get(userId);
  if (!p) {
    p = fetchOnce(userId)
      .then((guilds) => { cache.set(userId, { guilds, at: Date.now() }); return guilds; })
      .catch((err: unknown) => {
        // Logged here, once per Discord call, not once per waiting caller.
        if (err instanceof GuildsFetchError && err.status === 429) {
          console.warn(`[userGuilds] Discord rate limit for ${userId}; ${hit ? 'using the last server list' : 'no server list yet'} (retry after ${Math.ceil((err.retryAfterMs ?? 0) / 1000)} s)`);
        } else {
          console.error('[userGuilds] Couldn\'t load servers from Discord:', err);
        }
        throw err;
      })
      .finally(() => inflight.delete(userId));
    inflight.set(userId, p);
  }
  try {
    return await p;
  } catch {
    if (hit) return hit.guilds;
    throw new GuildsUnavailableError();
  }
}

/** Tests only. */
export function resetUserGuilds(): void { cache.clear(); inflight.clear(); blockedUntil.clear(); }
