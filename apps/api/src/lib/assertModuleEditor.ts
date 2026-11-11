import { prisma } from './prisma.js';
import { assertGuildManager } from './assertGuildManager.js';
import { readPermissionFields } from './guildSettings.js';
import { hasAnyRole } from './memberRoles.js';

/**
 * Who may change a server's module settings: its managers, plus anyone holding
 * one of its module editor roles. (Moved out of routes/settings.ts in v1.21.1.)
 */
export async function assertModuleEditor(req: Express.Request, guildId: string): Promise<boolean> {
  if (await assertGuildManager(req, guildId)) return true;

  const guild = await prisma.guild.findUnique({ where: { guildId }, include: { settings: true } });
  const settingsId = guild?.settings?.id;
  if (!settingsId) return false;

  const { moduleEditorRoles } = await readPermissionFields(settingsId);
  if (moduleEditorRoles.length === 0) return false;

  // Cached, rate-limit-aware lookup (lib/discordRest.ts).
  return hasAnyRole(req, guildId, moduleEditorRoles);
}
