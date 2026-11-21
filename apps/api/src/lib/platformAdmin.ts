import type { NextFunction, Request, Response } from 'express';
import { prisma } from './prisma.js';

// Platform-wide admins (not per-guild): may trigger actions that affect every
// server, like a game data re-sync. Comma-separated Discord user ids, from
// PLATFORM_ADMIN_DISCORD_IDS only. There's no built-in default (there was one
// before v1.59.2): the repo is public, and a copy deployed by someone else must
// not make our admin theirs. Unset = nobody is a platform admin.
const ADMIN_IDS = (process.env['PLATFORM_ADMIN_DISCORD_IDS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (ADMIN_IDS.length === 0 && process.env['NODE_ENV'] === 'production') {
  console.warn('[admin] PLATFORM_ADMIN_DISCORD_IDS is not set: nobody can open the admin panel');
}

export const isPlatformAdminId = (discordId: string): boolean => ADMIN_IDS.includes(discordId);

/** For /api/admin/*: 404 (not 403) for everyone else, so the panel doesn't advertise itself. */
export async function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const admin = await getPlatformAdmin(req.session?.userId);
  if (!admin) {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }
  res.locals['admin'] = admin;
  next();
}

export async function getPlatformAdmin(
  sessionUserId: string | undefined,
): Promise<{ discordId: string; username: string } | null> {
  if (!sessionUserId) return null;
  const user = await prisma.user.findUnique({ where: { id: sessionUserId } });
  if (!user || !ADMIN_IDS.includes(user.discordId)) return null;
  return { discordId: user.discordId, username: user.username };
}
