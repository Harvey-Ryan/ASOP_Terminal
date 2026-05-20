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

  const rows = await prisma.$queryRaw<{ eventCreatorRoles: string; viewerRoles: string }[]>`
    SELECT eventCreatorRoles, viewerRoles FROM GuildSettings WHERE id = ${settingsId}
  `;
  const allowed = [
    ...JSON.parse(rows[0]?.eventCreatorRoles ?? '[]') as string[],
    ...JSON.parse(rows[0]?.viewerRoles ?? '[]') as string[],
  ];
  if (allowed.length === 0) return false;

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
      return member.roles.some((id) => allowed.includes(id));
    }
  } catch {}
  return false;
}
