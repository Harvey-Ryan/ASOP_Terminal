import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { prisma } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('material')
  .setDescription('Look up Star Citizen crafting materials from the scunpacked database')
  .addSubcommand((sub) =>
    sub
      .setName('usedby')
      .setDescription('Find all blueprints that require a given material')
      .addStringOption((opt) =>
        opt
          .setName('name')
          .setDescription('Material name (start typing for suggestions)')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  );

// ── Autocomplete ──────────────────────────────────────────────────────────────

export async function autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused();

  const rows = await prisma.scBlueprintMaterial.findMany({
    where: { name: { contains: focused, mode: 'insensitive' } },
    select: { name: true },
    distinct: ['name'],
    orderBy: { name: 'asc' },
    take: 25,
  });

  await interaction.respond(rows.map((r) => ({ name: r.name, value: r.name })));
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'usedby') return handleUsedBy(interaction);
}

// ── /material usedby ──────────────────────────────────────────────────────────

async function handleUsedBy(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const materialName = interaction.options.getString('name', true).trim();

  // Find all blueprint tiers that contain this material
  const matchedMaterials = await prisma.scBlueprintMaterial.findMany({
    where: { name: { contains: materialName, mode: 'insensitive' } },
    select: { tierId: true, name: true, quantityScu: true, quantity: true },
    take: 200,
  });

  if (matchedMaterials.length === 0) {
    await interaction.editReply({ content: `No blueprints found that use **${materialName}**.` });
    return;
  }

  // Group by exact material name to find the canonical match
  const nameCounts = new Map<string, number>();
  for (const m of matchedMaterials) {
    nameCounts.set(m.name, (nameCounts.get(m.name) ?? 0) + 1);
  }

  // Resolve tier IDs → blueprint UUIDs
  const tierIds = [...new Set(matchedMaterials.map((m) => m.tierId))];
  const tiers = await prisma.scBlueprintTier.findMany({
    where: { id: { in: tierIds } },
    select: { blueprintUuid: true },
    distinct: ['blueprintUuid'],
  });

  const blueprintUuids = [...new Set(tiers.map((t) => t.blueprintUuid))];
  const blueprints = await prisma.scBlueprint.findMany({
    where: { uuid: { in: blueprintUuids } },
    orderBy: { outputName: 'asc' },
    take: 20,
    select: {
      uuid: true,
      outputName: true,
      outputType: true,
      outputGrade: true,
    },
  });

  const total = blueprintUuids.length;
  const showing = blueprints.length;

  // Find the quantities for the first exact match (best match label)
  const firstMatch = matchedMaterials.find((m) =>
    m.name.toLowerCase() === materialName.toLowerCase(),
  ) ?? matchedMaterials[0]!;
  const qty = firstMatch.quantityScu != null
    ? `${firstMatch.quantityScu} SCU`
    : firstMatch.quantity != null
      ? `×${firstMatch.quantity}`
      : '';

  const embed = new EmbedBuilder()
    .setTitle(`🔩 Blueprints using "${firstMatch.name}"${qty ? ` (${qty})` : ''}`)
    .setColor(0x10b981)
    .setFooter({
      text: `scunpacked · ${total} blueprint${total === 1 ? '' : 's'} total${showing < total ? `, showing ${showing}` : ''}`,
    });

  const lines = blueprints.map((b) => {
    const grade = b.outputGrade ? ` · Grade ${b.outputGrade}` : '';
    return `• **${b.outputName}** — \`${b.outputType}\`${grade}`;
  });

  if (lines.length > 0) {
    embed.setDescription(lines.join('\n'));
  }

  // Show all distinct material names that matched (in case of fuzzy hit)
  if (nameCounts.size > 1) {
    const variantLines = [...nameCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([n, c]) => `• ${n} (${c})`);
    embed.addFields([{ name: 'Matched variants', value: variantLines.join('\n'), inline: false }]);
  }

  await interaction.editReply({ embeds: [embed] });
}
