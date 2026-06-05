import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { BLUEPRINTS, BLUEPRINT_BY_UUID } from '../gamedata.js';
import { buildRecipeEmbed } from '../utils/scUtils.js';

export const data = new SlashCommandBuilder()
  .setName('recipe')
  .setDescription('Show the full crafting recipe for a Star Citizen blueprint')
  .addStringOption((opt) =>
    opt
      .setName('name')
      .setDescription('Blueprint name (start typing for suggestions)')
      .setRequired(true)
      .setAutocomplete(true),
  );

// ── Autocomplete ──────────────────────────────────────────────────────────────

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();

  const matches = BLUEPRINTS
    .filter((b) => b.outputName.toLowerCase().includes(focused))
    .slice(0, 25);

  await interaction.respond(
    matches.map((b) => ({
      name:  b.outputType ? `${b.outputName} (${b.outputType})` : b.outputName,
      value: b.uuid,
    })),
  );
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const rawValue = interaction.options.getString('name', true);

  const bp =
    BLUEPRINT_BY_UUID.get(rawValue) ??
    BLUEPRINTS.find((b) => b.outputName.toLowerCase() === rawValue.toLowerCase());

  if (!bp) {
    await interaction.editReply({ content: `No blueprint found for **${rawValue}**.` });
    return;
  }

  await interaction.editReply({ embeds: [buildRecipeEmbed(bp)] });
}
