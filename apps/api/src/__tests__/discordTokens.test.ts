// v1.59.1: Discord sign-in tokens are stored encrypted.
import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { decryptToken, encryptToken, encryptStoredDiscordTokens, isEncryptedToken } from '../lib/discordTokens.js';
import { getValidAccessToken } from '../lib/token-helpers.js';
import { createUser } from './factories.js';

describe('Discord token encryption', () => {
  it('round-trips, and is bound to the Discord id', () => {
    const stored = encryptToken('abc123', '111');
    expect(isEncryptedToken(stored)).toBe(true);
    expect(stored).not.toContain('abc123');
    expect(encryptToken('abc123', '111')).not.toBe(stored); // fresh IV each time
    expect(decryptToken(stored, '111')).toBe('abc123');
    expect(decryptToken(stored, '222')).toBeNull();
    expect(decryptToken('t1:broken', '111')).toBeNull();
  });

  it('reads plain values from before', () => {
    expect(decryptToken('old-plain-token', '111')).toBe('old-plain-token');
  });

  it('encrypts plain stored tokens once, and they still work', async () => {
    const user = await createUser();
    const account = await prisma.account.create({
      data: {
        userId: user.id,
        provider: 'discord',
        providerAccountId: user.discordId,
        accessToken: 'PLAIN-ACCESS',
        refreshToken: 'PLAIN-REFRESH',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    });
    expect(await encryptStoredDiscordTokens()).toBeGreaterThanOrEqual(1);
    const row = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(isEncryptedToken(row.accessToken)).toBe(true);
    expect(isEncryptedToken(row.refreshToken!)).toBe(true);
    expect(decryptToken(row.refreshToken!, user.discordId)).toBe('PLAIN-REFRESH');
    expect(await getValidAccessToken(row)).toBe('PLAIN-ACCESS');
    expect(await encryptStoredDiscordTokens()).toBe(0);
  });
});
