import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { STARSTRINGS_LIVE_PAGE } from '@dem/shared';
import { liveRelease, starStringsMessage } from '../services/starStringsService.js';

// /starstrings (v1.35.0): the current LIVE build of StarStrings with its
// download link, for anyone to share.

export const data = new SlashCommandBuilder()
  .setName('starstrings')
  .setDescription('Download link for the current StarStrings LIVE build');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const release = await liveRelease();
  if (!release) {
    await interaction.editReply({ content: `Couldn't reach GitHub just now. The latest build is always at <${STARSTRINGS_LIVE_PAGE}>.` });
    return;
  }
  const { embeds, components } = starStringsMessage(release, 'current');
  await interaction.editReply({ embeds, components });
}
