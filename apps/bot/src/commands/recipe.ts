import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { prisma } from '../db.js';
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
  const focused = interaction.options.getFocused();

  const rows = await prisma.scBlueprint.findMany({
    where:   { outputName: { contains: focused, mode: 'insensitive' } },
    orderBy: { outputName: 'asc' },
    take:    25,
    select:  { uuid: true, outputName: true, outputType: true },
  });

  await interaction.respond(
    rows.map((r) => ({
      name:  r.outputType ? `${r.outputName} (${r.outputType})` : r.outputName,
      value: r.uuid,
    })),
  );
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const rawValue = interaction.options.getString('name', true);

  const bp = await prisma.scBlueprint.findFirst({
    where: {
      OR: [
        { uuid: rawValue },
        { outputName: { equals: rawValue, mode: 'insensitive' } },
      ],
    },
    include: {
      tiers: {
        orderBy: { tierIndex: 'asc' },
        include: {
          materials: { orderBy: { name: 'asc' } },
          modifiers: { orderBy: { key:  'asc' } },
        },
      },
    },
  });

  if (!bp) {
    await interaction.editReply({ content: `No blueprint found for **${rawValue}**.` });
    return;
  }

  await interaction.editReply({ embeds: [buildRecipeEmbed(bp)] });
}
