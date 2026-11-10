import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { prisma } from '../db.js';
import { client } from '../client.js';
import { respondWithCatalog, resolveCatalogOption, inventoryOf } from '../catalog.js';

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
// Values are game catalog refs ("ITEM:<uuid>" / "COMMODITY:<uuid>").

export async function autocomplete(interaction: AutocompleteInteraction) {
  await respondWithCatalog(interaction);
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  const raw = interaction.options.getString('item', true);
  const item = await resolveCatalogOption(raw);
  if (!item) {
    await interaction.editReply({ content: 'Please select an item from the suggestions.' });
    return;
  }
  const itemType = item.kind;

  const entries = await prisma.inventoryEntry.findMany({
    where: { guildId: interaction.guildId, memberActive: true, ...inventoryOf(item) },
    orderBy: [{ qualityLevel: 'desc' }, { username: 'asc' }],
  });

  // Resolve server nicknames for all members in the result set
  const guild = interaction.guild ?? await client.guilds.fetch(interaction.guildId);
  const userIds = [...new Set(entries.map((e) => e.userId))];
  const nickMap = new Map<string, string>();
  if (userIds.length > 0) {
    try {
      const members = await guild.members.fetch({ user: userIds });
      for (const [, member] of members) {
        nickMap.set(member.user.id, member.displayName);
      }
    } catch {
      // Non-fatal — fall back to stored username per entry below
    }
  }

  const itemName = item.name;

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
      const prefix = itemType === 'COMMODITY' ? '' : '×';
      const suffix = itemType === 'COMMODITY' ? ' cSCU' : '';
      const loc = e.location ? ` · 📍 ${e.location}` : '';
      const displayName = nickMap.get(e.userId) ?? e.username;
      return `**${displayName}** — ${prefix}${qty}${suffix}${loc}`;
    });
    embed.addFields({ name: header, value: lines.join('\n'), inline: false });
  }

  await interaction.editReply({ embeds: [embed] });
}
