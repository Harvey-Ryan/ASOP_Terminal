import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { prisma } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('uex')
  .setDescription('Search the local UEX Corp game data cache')
  .addSubcommand((sub) =>
    sub
      .setName('item')
      .setDescription('Look up a Star Citizen item by name')
      .addStringOption((opt) =>
        opt
          .setName('name')
          .setDescription('Item name to search for')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('commodity')
      .setDescription('Look up a Star Citizen commodity by name')
      .addStringOption((opt) =>
        opt
          .setName('name')
          .setDescription('Commodity name to search for')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  );

// ── Autocomplete ──────────────────────────────────────────────────────────────

export async function autocomplete(interaction: AutocompleteInteraction) {
  const sub = interaction.options.getSubcommand();
  const focused = interaction.options.getFocused();

  if (focused.length < 4) {
    await interaction.respond([]);
    return;
  }

  if (sub === 'item') {
    const rows = await prisma.uexItem.findMany({
      where: {
        isActive: true,
        name: { contains: focused, mode: 'insensitive' },
      },
      orderBy: { name: 'asc' },
      take: 25,
      select: { id: true, name: true, categoryName: true },
    });
    await interaction.respond(
      rows.map((r) => ({
        name: r.categoryName ? `${r.name} (${r.categoryName})` : r.name,
        value: String(r.id),
      })),
    );
    return;
  }

  if (sub === 'commodity') {
    const rows = await prisma.uexCommodity.findMany({
      where: {
        isActive: true,
        name: { contains: focused, mode: 'insensitive' },
      },
      orderBy: { name: 'asc' },
      take: 25,
      select: { id: true, name: true, code: true },
    });
    await interaction.respond(
      rows.map((r) => ({
        name: r.code ? `${r.name} (${r.code})` : r.name,
        value: String(r.id),
      })),
    );
  }
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'item') return handleItem(interaction);
  if (sub === 'commodity') return handleCommodity(interaction);
}

// ── /uex item ─────────────────────────────────────────────────────────────────

async function handleItem(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const rawValue = interaction.options.getString('name', true);
  const id = parseInt(rawValue, 10);

  const item = isNaN(id)
    ? await prisma.uexItem.findFirst({
        where: { isActive: true, name: { equals: rawValue, mode: 'insensitive' } },
      })
    : await prisma.uexItem.findUnique({ where: { id } });

  if (!item) {
    await interaction.editReply({ content: `No item found matching **${rawValue}**.` });
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

// ── /uex commodity ────────────────────────────────────────────────────────────

async function handleCommodity(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const rawValue = interaction.options.getString('name', true);
  const id = parseInt(rawValue, 10);

  const com = isNaN(id)
    ? await prisma.uexCommodity.findFirst({
        where: { isActive: true, name: { equals: rawValue, mode: 'insensitive' } },
      })
    : await prisma.uexCommodity.findUnique({ where: { id } });

  if (!com) {
    await interaction.editReply({ content: `No commodity found matching **${rawValue}**.` });
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
