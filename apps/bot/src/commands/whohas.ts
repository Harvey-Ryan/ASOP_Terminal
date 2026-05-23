import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { prisma } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('whohas')
  .setDescription('Search guild member inventories for an item or commodity')
  .addStringOption((opt) =>
    opt
      .setName('item')
      .setDescription('Item or commodity name')
      .setRequired(true)
      .setAutocomplete(true),
  );

// ── Autocomplete ──────────────────────────────────────────────────────────────
// Value is encoded as "ITEM:<id>" or "COMMODITY:<id>" so the execute handler
// can recover both the type and the numeric UEX ID from a single string field.

export async function autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused();

  const [items, commodities] = await Promise.all([
    prisma.uexItem.findMany({
      where: { isActive: true, name: { contains: focused, mode: 'insensitive' } },
      orderBy: { name: 'asc' },
      take: 13,
      select: { id: true, name: true, categoryName: true },
    }),
    prisma.uexCommodity.findMany({
      where: { isActive: true, name: { contains: focused, mode: 'insensitive' } },
      orderBy: { name: 'asc' },
      take: 12,
      select: { id: true, name: true, code: true },
    }),
  ]);

  const choices = [
    ...items.map((r) => ({
      name: r.categoryName ? `${r.name} (${r.categoryName})` : r.name,
      value: `ITEM:${r.id}`,
    })),
    ...commodities.map((r) => ({
      name: r.code ? `${r.name} [${r.code}]` : r.name,
      value: `COMMODITY:${r.id}`,
    })),
  ]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 25);

  await interaction.respond(choices);
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const raw = interaction.options.getString('item', true);
  const [itemType, rawId] = raw.split(':') as [string, string | undefined];
  const externalItemId = parseInt(rawId ?? '', 10);

  if ((itemType !== 'ITEM' && itemType !== 'COMMODITY') || isNaN(externalItemId)) {
    await interaction.editReply({ content: 'Please select an item from the autocomplete list.' });
    return;
  }

  const entries = await prisma.inventoryEntry.findMany({
    where: { guildId: interaction.guildId, itemType, externalItemId },
    orderBy: [{ qualityLevel: 'desc' }, { username: 'asc' }],
  });

  const itemName = entries[0]?.itemName
    ?? (itemType === 'ITEM'
      ? (await prisma.uexItem.findUnique({ where: { id: externalItemId }, select: { name: true } }))?.name
      : (await prisma.uexCommodity.findUnique({ where: { id: externalItemId }, select: { name: true } }))?.name)
    ?? raw;

  if (entries.length === 0) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`🔍 ${itemName}`)
          .setDescription('No members currently have this in their inventory.')
          .setColor(0x747f8d),
      ],
    });
    return;
  }

  // Group by qualityLevel
  const groups = new Map<string | null, typeof entries>();
  for (const e of entries) {
    const key = e.qualityLevel !== null ? String(e.qualityLevel) : null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const embed = new EmbedBuilder()
    .setTitle(`🔍 Who has ${itemName}?`)
    .setColor(itemType === 'COMMODITY' ? 0xf59e0b : 0x5865f2)
    .setFooter({ text: `${entries.length} member${entries.length !== 1 ? 's' : ''} · Exchange` });

  for (const [ql, group] of groups) {
    const header = ql !== null ? `QL ${ql}` : itemName;
    const lines = group.map((e) => {
      const qty =
        e.quantity % 1 === 0
          ? e.quantity.toFixed(0)
          : e.quantity.toFixed(itemType === 'COMMODITY' ? 3 : 2);
      const unit = itemType === 'COMMODITY' ? ' cSCU' : '×';
      const loc = e.location ? ` · 📍 ${e.location}` : '';
      return `**${e.username}** — ${qty}${unit}${loc}`;
    });
    embed.addFields({ name: header, value: lines.join('\n'), inline: false });
  }

  await interaction.editReply({ embeds: [embed] });
}
