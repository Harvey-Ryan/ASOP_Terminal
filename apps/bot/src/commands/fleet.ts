import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { prisma } from '../db.js';
import { client } from '../client.js';
import { getFleetyardsModels } from '../fleetyardsCache.js';

export const data = new SlashCommandBuilder()
  .setName('fleet')
  .setDescription('Search guild member fleet registries for a ship')
  .addStringOption((opt) =>
    opt
      .setName('ship')
      .setDescription('Ship name')
      .setRequired(true)
      .setAutocomplete(true),
  );

// ── Autocomplete ──────────────────────────────────────────────────────────────
// Value is the FleetYards slug so the execute handler can query directly.

export async function autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused().toLowerCase();
  try {
    const models = await getFleetyardsModels();
    const matches = models
      .filter(
        (m) =>
          m.name.toLowerCase().includes(focused) ||
          m.manufacturer.toLowerCase().includes(focused),
      )
      .sort((a, b) => {
        const aS = a.name.toLowerCase().startsWith(focused) ? 0 : 1;
        const bS = b.name.toLowerCase().startsWith(focused) ? 0 : 1;
        return aS - bS || a.name.localeCompare(b.name);
      })
      .slice(0, 25);

    await interaction.respond(
      matches.map((m) => ({
        name: `${m.name} — ${m.manufacturer}`.slice(0, 100),
        value: m.slug,
      })),
    );
  } catch {
    await interaction.respond([]);
  }
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const slug = interaction.options.getString('ship', true);

  const entries = await prisma.fleetEntry.findMany({
    where: { guildId: interaction.guildId, shipSlug: slug, memberActive: true },
    orderBy: { username: 'asc' },
  });

  const shipName = entries[0]?.shipName ?? slug;
  const manufacturer = entries[0]?.manufacturer ?? '';

  if (entries.length === 0) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`🚀 ${shipName}`)
          .setDescription('No members currently have this ship registered.')
          .setColor(0x747f8d),
      ],
    });
    return;
  }

  // Resolve server nicknames
  const guild = interaction.guild ?? (await client.guilds.fetch(interaction.guildId));
  const userIds = [...new Set(entries.map((e) => e.userId))];
  const nickMap = new Map<string, string>();
  if (userIds.length > 0) {
    try {
      const members = await guild.members.fetch({ user: userIds });
      for (const [, member] of members) {
        nickMap.set(member.user.id, member.displayName);
      }
    } catch {
      // Non-fatal — fall back to stored username per entry
    }
  }

  const lines = entries.map((e) => {
    const displayName = nickMap.get(e.userId) ?? e.username;
    const qty = e.quantity > 1 ? ` ×${e.quantity}` : '';
    const notes = e.notes ? ` — *${e.notes}*` : '';
    return `**${displayName}**${qty}${notes}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`🚀 Who has a ${shipName}?`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${manufacturer} · ${entries.length} member${entries.length !== 1 ? 's' : ''} · Fleet Registry` })
    .setColor(0x5865f2);

  await interaction.editReply({ embeds: [embed] });
}
