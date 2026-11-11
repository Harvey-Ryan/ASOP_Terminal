// The admin activity log (v1.13.0): admin changes and platform events, shown
// in the admin panel and sent to the admin Discord feed by the bot.

import { prisma } from './prisma.js';

export interface AdminLogInput {
  kind: string;
  summary: string;
  actor?: { discordId: string; username: string } | null;
  guildId?: string | null;
  guildName?: string | null;
  details?: Record<string, unknown>;
}

export async function adminLog(entry: AdminLogInput): Promise<void> {
  await prisma.adminLog.create({
    data: {
      kind: entry.kind,
      summary: entry.summary.slice(0, 500),
      actorId: entry.actor?.discordId ?? null,
      actorName: entry.actor?.username ?? null,
      guildId: entry.guildId ?? null,
      guildName: entry.guildName ?? null,
      details: JSON.stringify(entry.details ?? {}),
    },
  });
}
