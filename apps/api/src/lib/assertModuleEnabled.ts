import { prisma } from './prisma.js';

type ModuleKey = 'eventBotEnabled' | 'dkpEnabled' | 'lootEnabled' | 'exchangeEnabled' | 'fleetEnabled';

export async function assertModuleEnabled(guildId: string, module: ModuleKey): Promise<boolean> {
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
        },
      },
    },
  });
  if (!guild?.settings) return true; // no settings row = default = enabled
  return guild.settings[module] !== false;
}
