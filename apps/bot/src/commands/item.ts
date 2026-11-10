import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import type { CatalogDetail } from '@dem/shared';
import { catalog, respondWithCatalog, resolveCatalogOption } from '../catalog.js';

// Item and commodity details from the game files (sc-data). Commodity prices
// come from UEX, which collects them from players.

export const data = new SlashCommandBuilder()
  .setName('item')
  .setDescription('Look up a Star Citizen item or commodity')
  .addStringOption((opt) =>
    opt
      .setName('name')
      .setDescription('Item or commodity name (start typing for suggestions)')
      .setRequired(true)
      .setAutocomplete(true),
  );

export async function autocomplete(interaction: AutocompleteInteraction) {
  await respondWithCatalog(interaction);
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const raw = interaction.options.getString('name', true).trim();
  const entry = await resolveCatalogOption(raw);
  if (!entry) {
    await interaction.reply({ content: `Nothing found for **${raw}**. Pick a name from the suggestions.`, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply();
  const detail = await catalog.detail(entry.ref);
  if (!detail) {
    await interaction.editReply({ content: `**${entry.name}** is no longer in the game data.` });
    return;
  }
  await interaction.editReply({ embeds: [buildItemEmbed(detail)] });
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const aUEC = (n: number) => `${Math.round(n).toLocaleString('en-US')} aUEC`;

export function buildItemEmbed(d: CatalogDetail): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(d.name)
    .setColor(d.kind === 'COMMODITY' ? 0xf59e0b : 0x5865f2)
    .setFooter({ text: d.commodity && (d.commodity.avgBuy != null || d.commodity.avgSell != null)
      ? 'Game data: Star Citizen Wiki · Prices: UEX Corp (player reported)'
      : 'Game data: Star Citizen Wiki' });

  if (d.description) embed.setDescription(clip(d.description, 1000));

  const fields: { name: string; value: string; inline: boolean }[] = [];
  fields.push({ name: 'Type', value: d.detail, inline: true });
  if (d.kind === 'ITEM') {
    if (d.category && d.category !== d.detail) fields.push({ name: 'Category', value: d.category, inline: true });
    if (d.manufacturer) fields.push({ name: 'Manufacturer', value: d.manufacturer, inline: true });
    if (d.stats.length > 0) {
      fields.push({
        name: 'Stats',
        value: clip(d.stats.map((s) => `**${s.name}:** ${s.value}`).join('\n'), 1024),
        inline: false,
      });
    }
  }

  const c = d.commodity;
  if (c) {
    if (c.avgBuy != null)  fields.push({ name: 'Avg Buy',  value: aUEC(c.avgBuy),  inline: true });
    if (c.avgSell != null) fields.push({ name: 'Avg Sell', value: aUEC(c.avgSell), inline: true });
    if (c.avgBuy == null && c.avgSell == null) fields.push({ name: 'Prices', value: 'No UEX price data', inline: true });
    if (c.refinedName) fields.push({ name: 'Refines into', value: c.refinedName, inline: true });
    if (c.code) fields.push({ name: 'Code', value: c.code, inline: true });
  }

  embed.addFields(fields);
  return embed;
}
