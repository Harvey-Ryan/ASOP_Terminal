import { prisma } from './prisma.js';
import { refreshAccessToken } from './discord-oauth.js';
import { decryptToken, encryptToken } from './discordTokens.js';
import type { Account } from '@prisma/client';

/**
 * Returns a valid access token for the given account.
 * Automatically refreshes the token if it expires within the next 5 minutes,
 * persisting the new tokens to the database (encrypted, v1.59.1: lib/discordTokens.ts).
 *
 * Throws if the refresh request itself fails, or if the stored tokens can't be
 * read (SESSION_SECRET changed): the person then has to sign in again (caller
 * should decide whether to propagate or swallow the error).
 */
export async function getValidAccessToken(account: Account): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = account.expiresAt ?? 0;
  const discordId = account.providerAccountId;
  const accessToken = decryptToken(account.accessToken, discordId);
  const refreshToken = account.refreshToken ? decryptToken(account.refreshToken, discordId) : null;
  if (accessToken === null)
    throw new Error('Stored Discord sign-in could not be read; the person needs to sign in again');

  if (expiresAt - nowSec < 300 && refreshToken) {
    const fresh = await refreshAccessToken(refreshToken);
    await prisma.account.update({
      where: { id: account.id },
      data: {
        accessToken: encryptToken(fresh.access_token, discordId),
        refreshToken: fresh.refresh_token ? encryptToken(fresh.refresh_token, discordId) : null,
        expiresAt: nowSec + fresh.expires_in,
      },
    });
    return fresh.access_token;
  }

  return accessToken;
}
