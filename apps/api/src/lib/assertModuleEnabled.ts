import { prisma } from './prisma.js';
import { activityAvailable } from './activityAvailable.js';

type ModuleKey = 'eventBotEnabled' | 'dkpEnabled' | 'lootEnabled' | 'exchangeEnabled' | 'fleetEnabled' | 'activityEnabled' | 'jobsEnabled' | 'tournamentsEnabled';

export async function assertModuleEnabled(guildId: string, module: ModuleKey): Promise<boolean> {
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
        },
      },
    },
  });
  if (!guild?.settings) return true; // no settings row = default = enabled
  return guild.settings[module] !== false;
}
