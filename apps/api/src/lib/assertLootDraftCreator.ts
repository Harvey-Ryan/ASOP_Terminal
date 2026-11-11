import { hasAnyRole } from './memberRoles.js';
import { prisma } from './prisma.js';
import { assertGuildManager } from './assertGuildManager.js';

/**
 * Returns true if the session user may create standalone loot sessions.
 * Passes for: guild managers and holders of any configured lootDraftCreatorRole.
 */
export async function assertLootDraftCreator(req: Express.Request, guildId: string): Promise<boolean> {
  if (await assertGuildManager(req, guildId)) return true;

  const guild = await prisma.guild.findUnique({ where: { guildId }, include: { settings: true } });
  const settingsId = guild?.settings?.id;
  if (!settingsId) return false;

  const settings = await prisma.guildSettings.findUnique({
    where: { id: settingsId },
    select: { lootDraftCreatorRoles: true },
  });
  const allowedRoles = JSON.parse(settings?.lootDraftCreatorRoles ?? '[]') as string[];
  if (allowedRoles.length === 0) return true; // no restriction — any authenticated user may create

  // Cached, rate-limit-aware lookup (lib/discordRest.ts).
  return hasAnyRole(req, guildId, allowedRoles);
}
