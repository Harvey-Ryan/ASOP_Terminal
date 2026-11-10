import { prisma } from './prisma.js';

// Platform-wide admins (not per-guild): may trigger actions that affect every
// server, like a game data re-sync. Comma-separated Discord user ids; defaults
// to the existing roadmap admin.
const ADMIN_IDS = (process.env['PLATFORM_ADMIN_DISCORD_IDS'] ?? '1135606224155586571')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export async function getPlatformAdmin(sessionUserId: string | undefined): Promise<{ discordId: string; username: string } | null> {
  if (!sessionUserId) return null;
  const user = await prisma.user.findUnique({ where: { id: sessionUserId } });
  if (!user || !ADMIN_IDS.includes(user.discordId)) return null;
  return { discordId: user.discordId, username: user.username };
}
