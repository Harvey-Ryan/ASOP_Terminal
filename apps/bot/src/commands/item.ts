import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { prisma } from '../db.js';

// Item and commodity details from the UEX Corp cache. Items and commodities
// share one command; the autocomplete value says which one was picked.

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

// ── Autocomplete ──────────────────────────────────────────────────────────────

export async function autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused();
  if (focused.trim().length < 2) {
    await interaction.respond([]);
    return;
  }

  const needle = focused.toLowerCase();
  const rank = (name: string) => (name.toLowerCase().startsWith(needle) ? 0 : 1);

  const [items, commodities] = await Promise.all([
    prisma.uexItem.findMany({
      where: { isActive: true, name: { contains: focused, mode: 'insensitive' } },
      orderBy: { name: 'asc' },
      take: 25,
      select: { id: true, name: true, categoryName: true },
    }),
    prisma.uexCommodity.findMany({
      where: { isActive: true, name: { contains: focused, mode: 'insensitive' } },
      orderBy: { name: 'asc' },
      take: 25,
      select: { id: true, name: true, code: true },
    }),
  ]);

  const choices = [
    ...commodities.map((r) => ({ label: r.name, name: `${r.name} (Commodity${r.code ? ` · ${r.code}` : ''})`, value: `COMMODITY:${r.id}` })),
    ...items.map((r) => ({ label: r.name, name: r.categoryName ? `${r.name} (${r.categoryName})` : r.name, value: `ITEM:${r.id}` })),
  ]
    .sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label))
    .slice(0, 25);

  await interaction.respond(choices.map(({ name, value }) => ({ name: name.slice(0, 100), value })));
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction) {
  const raw = interaction.options.getString('name', true).trim();
  const [kind, id] = raw.split(':') as [string, string | undefined];
  if (kind === 'COMMODITY' && id) return handleCommodity(interaction, id);
  if (kind === 'ITEM' && id) return handleItem(interaction, id);

  // Typed without picking a suggestion: an exact item name wins, then a commodity.
  const item = await prisma.uexItem.findFirst({ where: { isActive: true, name: { equals: raw, mode: 'insensitive' } }, select: { id: true } });
  if (item) return handleItem(interaction, String(item.id));
  const com = await prisma.uexCommodity.findFirst({ where: { isActive: true, name: { equals: raw, mode: 'insensitive' } }, select: { id: true } });
  if (com) return handleCommodity(interaction, String(com.id));
  await interaction.reply({ content: `Nothing found for **${raw}**. Pick a name from the suggestions.`, flags: MessageFlags.Ephemeral });
}

// ── Item ─────────────────────────────────────────────────────────────────────

async function handleItem(interaction: ChatInputCommandInteraction, rawId: string) {
  await interaction.deferReply();

  const id = parseInt(rawId, 10);
  const item = isNaN(id) ? null : await prisma.uexItem.findUnique({ where: { id } });

  if (!item) {
    await interaction.editReply({ content: `That item is no longer in the UEX data.` });
    return;
  }

  type Attribute = { name?: string; value: string; unit?: string };
  const attrs: Attribute[] = JSON.parse(item.attributes ?? '[]');

  const embed = new EmbedBuilder()
    .setTitle(item.name)
    .setColor(0x5865f2)
    .setFooter({ text: 'UEX Corp · Star Citizen Item Database' });

  const fields: { name: string; value: string; inline: boolean }[] = [];

  if (item.categoryName) fields.push({ name: 'Category',     value: item.categoryName, inline: true });
  if (item.section)      fields.push({ name: 'Section',      value: item.section,      inline: true });
  if (item.gameVersion)  fields.push({ name: 'Game Version', value: item.gameVersion,  inline: true });
  if (item.slug)         fields.push({ name: 'Slug',         value: item.slug,         inline: true });

  const flags = [
    item.isCommodity   && 'Commodity',
    item.isHarvestable && 'Harvestable',
  ].filter(Boolean).join(', ');
  if (flags) fields.push({ name: 'Flags', value: flags, inline: true });

  if (attrs.length > 0) {
    const attrLines = attrs
      .map((a) => `${a.name ? `**${a.name}:** ` : ''}${a.value}${a.unit ? ` ${a.unit}` : ''}`)
      .join('\n');
    fields.push({ name: 'Attributes', value: attrLines, inline: false });
  }

  if (fields.length > 0) embed.addFields(fields);

  await interaction.editReply({ embeds: [embed] });
}

// ── Commodity ──────────────────────────────────────────────────────────────

async function handleCommodity(interaction: ChatInputCommandInteraction, rawId: string) {
  await interaction.deferReply();

  const id = parseInt(rawId, 10);
  const com = isNaN(id) ? null : await prisma.uexCommodity.findUnique({ where: { id } });

  if (!com) {
    await interaction.editReply({ content: `That commodity is no longer in the UEX data.` });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(com.name)
    .setColor(0xf59e0b)
    .setFooter({ text: 'UEX Corp · Star Citizen Commodity Database' });

  const fields: { name: string; value: string; inline: boolean }[] = [];

  if (com.code)              fields.push({ name: 'Code',       value: com.code,                              inline: true });
  if (com.slug)              fields.push({ name: 'Slug',       value: com.slug,                              inline: true });
  if (com.weightScu != null) fields.push({ name: 'Weight',     value: `${com.weightScu} SCU`,                inline: true });
  if (com.priceAvgBuy != null)  fields.push({ name: 'Avg Buy',  value: `${com.priceAvgBuy.toLocaleString()} aUEC`,  inline: true });
  if (com.priceAvgSell != null) fields.push({ name: 'Avg Sell', value: `${com.priceAvgSell.toLocaleString()} aUEC`, inline: true });

  const flags = [
    com.isMineral    && 'Mineral',
    com.isRaw        && 'Raw',
    com.isRefined    && 'Refined',
    com.isHarvestable && 'Harvestable',
    com.isFuel       && 'Fuel',
    com.isIllegal    && '⚠️ Illegal',
  ].filter(Boolean).join(', ');
  if (flags) fields.push({ name: 'Flags', value: flags, inline: false });

  if (fields.length > 0) embed.addFields(fields);

  await interaction.editReply({ embeds: [embed] });
}
