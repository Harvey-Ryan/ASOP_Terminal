import { prisma } from './prisma.js';
import { refreshAccessToken } from './discord-oauth.js';
import type { Account } from '@prisma/client';

/**
 * Returns a valid access token for the given account.
 * Automatically refreshes the token if it expires within the next 5 minutes,
 * persisting the new tokens to the database.
 *
 * Throws if the refresh request itself fails (caller should decide whether
 * to propagate or swallow the error).
 */
export async function getValidAccessToken(account: Account): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = account.expiresAt ?? 0;

  if (expiresAt - nowSec < 300 && account.refreshToken) {
    const fresh = await refreshAccessToken(account.refreshToken);
    await prisma.account.update({
      where: { id: account.id },
      data: {
        accessToken: fresh.access_token,
        refreshToken: fresh.refresh_token,
        expiresAt: nowSec + fresh.expires_in,
      },
    });
    return fresh.access_token;
  }

  return account.accessToken;
}
