import { prisma } from '../db.js';

export async function getGuildDkpLabel(guildId: string): Promise<string> {
  const settings = await prisma.guildSettings.findFirst({
    where: { guild: { guildId } },
    select: { dkpLabel: true },
  });
  return settings?.dkpLabel ?? 'DKP';
}
