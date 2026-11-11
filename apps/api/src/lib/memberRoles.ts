import type { NextFunction, Request, Response } from 'express';
import { prisma } from './prisma.js';
import { getGuildMember } from './discordRest.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** A role check couldn't reach Discord: answer "try again" (503), not Forbidden. */
      discordUnavailable?: boolean;
    }
  }
}

export const DISCORD_BUSY_MESSAGE = 'Discord is busy right now, so we couldn\'t check your roles. Try again in a few seconds.';

/** Discord id of the signed-in user. */
export async function sessionDiscordUserId(req: Express.Request): Promise<string | null> {
  if (!req.session.userId) return null;
  const u = await prisma.user.findUnique({ where: { id: req.session.userId }, select: { discordId: true } });
  return u?.discordId ?? null;
}

/**
 * Whether the signed-in user holds any of `allowed` in the server. Uses the
 * cached member lookup (one Discord call per person per server per minute at
 * most). If Discord can't answer, marks the request so a 403 becomes a 503.
 */
export async function hasAnyRole(req: Express.Request, guildId: string, allowed: readonly string[]): Promise<boolean> {
  if (allowed.length === 0 || !process.env['DISCORD_TOKEN']) return false;
  const discordId = await sessionDiscordUserId(req);
  if (!discordId) return false;
  const r = await getGuildMember(guildId, discordId);
  if (r.status === 'member') return r.member.roles.some((id) => allowed.includes(id));
  if (r.status === 'unavailable') (req as Request).discordUnavailable = true;
  return false;
}

/**
 * Turns a 403 into a 503 "try again" when the refusal was only because
 * Discord couldn't be asked (rate limited or down). The website retries 503s.
 */
export function discordBusyAsServiceUnavailable(req: Request, res: Response, next: NextFunction): void {
  const status = res.status.bind(res);
  const json = res.json.bind(res);
  let swapped = false;
  res.status = (code: number) => {
    if (code === 403 && req.discordUnavailable) { swapped = true; res.setHeader('Retry-After', '5'); return status(503); }
    return status(code);
  };
  res.json = (body?: unknown) => {
    if (swapped && body && typeof body === 'object' && (body as { success?: unknown }).success === false) {
      return json({ ...(body as object), error: DISCORD_BUSY_MESSAGE });
    }
    return json(body);
  };
  next();
}
