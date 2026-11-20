// Discord sign-in tokens at rest (v1.59.1). Account.accessToken / refreshToken
// used to be stored as plain text, so a copy of the database was enough to act
// as anyone who had signed in (read their server list, until the token
// expired or was refreshed). They're now AES-256-GCM encrypted with a key
// derived from SESSION_SECRET (never in the database), bound to the person's
// Discord id, like the AI keys in aiKeys.ts.
//
// Plain values from before still read as they are, and are encrypted at
// start-up (encryptStoredDiscordTokens). If SESSION_SECRET ever changes, the
// stored tokens no longer decrypt: those people are asked to sign in again,
// which stores fresh ones.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { prisma } from './prisma.js';

const FORMAT = 't1';

function key(): Buffer {
  const secret = process.env['SESSION_SECRET'] ?? 'dev-secret-CHANGE-ME'; // same fallback as the session (dev only)
  return Buffer.from(hkdfSync('sha256', secret, 'asop', 'discord-oauth-token', 32));
}

const aad = (discordId: string) => Buffer.from(`asop-discord-token:${discordId}`, 'utf8');

export const isEncryptedToken = (stored: string): boolean => stored.startsWith(`${FORMAT}:`);

export function encryptToken(plain: string, discordId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(aad(discordId));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `${FORMAT}:${iv.toString('base64')}:${body.toString('base64')}`;
}

/** The token; a plain value from before v1.59.1 as it is; null when it can't be read (other secret, damaged). */
export function decryptToken(stored: string, discordId: string): string | null {
  if (!isEncryptedToken(stored)) return stored;
  const [, ivB64, bodyB64] = stored.split(':');
  if (!ivB64 || !bodyB64) return null;
  try {
    const body = Buffer.from(bodyB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    decipher.setAAD(aad(discordId));
    decipher.setAuthTag(body.subarray(body.length - 16));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Encrypts tokens still stored as plain text. Safe to run every start. */
export async function encryptStoredDiscordTokens(): Promise<number> {
  const rows = await prisma.account.findMany({
    where: { provider: 'discord', NOT: { accessToken: { startsWith: `${FORMAT}:` } } },
    select: { id: true, providerAccountId: true, accessToken: true, refreshToken: true },
  });
  for (const r of rows) {
    await prisma.account.update({
      where: { id: r.id },
      data: {
        accessToken: encryptToken(r.accessToken, r.providerAccountId),
        refreshToken:
          r.refreshToken && !isEncryptedToken(r.refreshToken)
            ? encryptToken(r.refreshToken, r.providerAccountId)
            : r.refreshToken,
      },
    });
  }
  return rows.length;
}
