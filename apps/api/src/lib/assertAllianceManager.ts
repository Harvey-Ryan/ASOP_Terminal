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

  const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
  const botToken = process.env['DISCORD_TOKEN'];
  if (!dbUser || !botToken) return false;

  try {
    const r = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${dbUser.discordId}`,
      { headers: { Authorization: `Bot ${botToken}` } },
    );
    if (r.ok) {
      const member = (await r.json()) as { roles: string[] };
      return member.roles.some((id) => allowedRoles.includes(id));
    }
  } catch {}
  return false;
}
