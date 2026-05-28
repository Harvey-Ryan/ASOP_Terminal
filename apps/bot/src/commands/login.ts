import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('login')
  .setDescription('Get a link to log in to the ASOP event manager');

export async function execute(interaction: ChatInputCommandInteraction) {
  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('Log in to ASOP')
      .setStyle(ButtonStyle.Link)
      .setURL(`${webUrl}/api/auth/login`),
  );

  await interaction.reply({ content: 'Click below to log in to the event manager:', components: [row], flags: MessageFlags.Ephemeral });
}
