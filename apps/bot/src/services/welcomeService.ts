// "Welcome to ASOP!" (v1.15.0): when the bot is added to a server, the person
// who added it gets a DM pointing to the setup checklist on the website.

import { ActionRowBuilder, AuditLogEvent, ButtonBuilder, ButtonStyle, EmbedBuilder, type Guild } from 'discord.js';

/** Who added the bot: from the audit log when the bot may read it, otherwise the server's owner. */
async function whoAddedBot(guild: Guild): Promise<string> {
  try {
    const log = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 });
    const entry = log.entries.find((e) => e.targetId === guild.client.user.id);
    if (entry?.executorId) return entry.executorId;
  } catch { /* no View Audit Log permission: fall back to the owner */ }
  return guild.ownerId;
}

export function welcomeMessage(guild: { id: string; name: string }) {
  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Welcome to ASOP!')
    .setDescription(
      `ASOP is now in **${guild.name}**. A few steps get events posting in Discord: an event forum and a voice channel category.\n\n` +
      'The setup checklist on the website walks you through them, can create the channels for you, and checks that the bot has the permissions it needs.\n\n' +
      'DKP auctions and Tournaments start switched off, since each needs a channel of its own. Turn them on in Module Settings when you want them.',
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open setup').setURL(`${webUrl}/dashboard/servers/${guild.id}/settings/modules`),
  );
  return { embeds: [embed], components: [row] };
}

/** DMs the welcome. Closed DMs are fine: the checklist is on the website either way. */
export async function sendWelcome(guild: Guild): Promise<void> {
  const userId = await whoAddedBot(guild);
  try {
    const user = await guild.client.users.fetch(userId);
    await user.send(welcomeMessage(guild));
  } catch (err) {
    console.warn(`[welcome] Couldn't DM ${userId} for ${guild.name} (${guild.id}):`, err instanceof Error ? err.message : err);
  }
}
