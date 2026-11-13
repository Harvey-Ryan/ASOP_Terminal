// Mission briefings (v1.36.0): when one is published, the roster gets its
// Briefing button (updateRosterEmbed) and the event's threads, the host's and
// every ally's, get a short notice with a link, opened as that server.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { prisma } from '../db.js';
import { client } from '../client.js';
import { queueRosterUpdate } from './rsvpService.js';

const webUrl = () => (process.env['WEB_URL'] ?? 'http://localhost:5173').replace(/\/$/, '');

export async function announceBriefing(eventId: string): Promise<void> {
  await queueRosterUpdate(eventId);
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, name: true, guildId: true, threadId: true, status: true, briefingPublishedAt: true, briefingSummary: true },
  });
  if (!event?.briefingPublishedAt || !['PENDING', 'ACTIVE'].includes(event.status)) return;
  const allies = await prisma.eventAllianceGuild.findMany({ where: { eventId, threadId: { not: null } }, select: { discordGuildId: true, threadId: true } });
  const targets = [
    ...(event.threadId ? [{ guildId: event.guildId, threadId: event.threadId }] : []),
    ...allies.map((a) => ({ guildId: a.discordGuildId, threadId: a.threadId! })),
  ];
  for (const t of targets) {
    try {
      const thread = await client.channels.fetch(t.threadId).catch(() => null);
      if (!thread?.isThread()) continue;
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open the briefing').setEmoji('📋')
          .setURL(`${webUrl()}/dashboard/servers/${t.guildId}/events/${event.id}/briefing`),
      );
      await thread.send({
        content: `📋 **The briefing for ${event.name} is ready.**${event.briefingSummary ? `\n> ${event.briefingSummary}` : ''}`,
        components: [row],
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      console.warn(`[briefing] Couldn't post the briefing notice in thread ${t.threadId}:`, err instanceof Error ? err.message : err);
    }
  }
}
