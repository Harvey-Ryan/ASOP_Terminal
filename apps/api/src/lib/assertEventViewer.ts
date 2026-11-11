import { hasAnyRole } from './memberRoles.js';
import { prisma } from './prisma.js';
import { assertGuildManager } from './assertGuildManager.js';

/**
 * Returns true if the session user may view events and loot for the guild.
 * Passes for: guild managers, event creators, and viewer-role holders.
 * Falls back to false when no viewer/creator roles are configured.
 */
export async function assertEventViewer(req: Express.Request, guildId: string): Promise<boolean> {
  if (await assertGuildManager(req, guildId)) return true;

  const guild = await prisma.guild.findUnique({ where: { guildId }, include: { settings: true } });
  const settingsId = guild?.settings?.id;
  if (!settingsId) return false;

  const settings = await prisma.guildSettings.findUnique({
    where: { id: settingsId },
    select: { eventCreatorRoles: true, viewerRoles: true },
  });
  const allowed = [
    ...JSON.parse(settings?.eventCreatorRoles ?? '[]') as string[],
    ...JSON.parse(settings?.viewerRoles ?? '[]') as string[],
  ];
  if (allowed.length === 0) return false;

  // Cached, rate-limit-aware lookup (lib/discordRest.ts).
  return hasAnyRole(req, guildId, allowed);
}
