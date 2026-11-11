import { hasAnyRole } from './memberRoles.js';
import { prisma } from './prisma.js';
import { assertGuildManager } from './assertGuildManager.js';

/**
 * Returns true if the session user may manage alliances for the given guild.
 * Passes for: guild managers and holders of any configured allianceManagerRole.
 * If allianceManagerRoles is empty, only guild managers are allowed.
 */
export async function assertAllianceManager(req: Express.Request, guildId: string): Promise<boolean> {
  if (await assertGuildManager(req, guildId)) return true;

  const guild = await prisma.guild.findUnique({ where: { guildId }, include: { settings: true } });
  const settingsId = guild?.settings?.id;
  if (!settingsId) return false;

  const settings = await prisma.guildSettings.findUnique({
    where: { id: settingsId },
    select: { allianceManagerRoles: true },
  });
  const allowedRoles = JSON.parse((settings as unknown as { allianceManagerRoles?: string })?.allianceManagerRoles ?? '[]') as string[];
  if (allowedRoles.length === 0) return false;

  // Cached, rate-limit-aware lookup (lib/discordRest.ts).
  return hasAnyRole(req, guildId, allowedRoles);
}
