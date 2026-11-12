import { prisma } from './prisma.js';
import type { ModuleSetting } from '@dem/shared';
import { activityAvailable } from './activityAvailable.js';
import { hiddenModules } from './hiddenModules.js';

export async function assertModuleEnabled(guildId: string, module: ModuleSetting): Promise<boolean> {
  if ((await hiddenModules()).has(module)) return false; // hidden for every server by a platform admin (v1.28.0)
  if (module === 'activityEnabled' && !activityAvailable(guildId)) return false; // RoleCall only tracks some servers
  const guild = await prisma.guild.findUnique({
    where: { guildId },
    include: {
      settings: {
        select: {
          eventBotEnabled: true,
          dkpEnabled: true,
          lootEnabled: true,
          exchangeEnabled: true,
          fleetEnabled: true,
          activityEnabled: true,
          jobsEnabled: true,
          tournamentsEnabled: true,
          blueprintsEnabled: true,
          craftingEnabled: true,
        },
      },
    },
  });
  if (!guild?.settings) return true; // no settings row = default = enabled
  return guild.settings[module] !== false;
}
