import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { prisma } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('blueprint')
  .setDescription('Look up Star Citizen crafting blueprints from the scunpacked database')
  .addSubcommand((sub) =>
    sub
      .setName('search')
      .setDescription('Search blueprints by output item name')
      .addStringOption((opt) =>
        opt.setName('name').setDescription('Item name to search for').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('recipe')
      .setDescription('Show the full crafting recipe for a blueprint')
      .addStringOption((opt) =>
        opt
          .setName('name')
          .setDescription('Blueprint name (start typing for suggestions)')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('dismantle')
      .setDescription('Show the dismantle return for a blueprint')
      .addStringOption((opt) =>
        opt
          .setName('name')
          .setDescription('Blueprint name (start typing for suggestions)')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  );

// ── Autocomplete ──────────────────────────────────────────────────────────────

export async function autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused();

  const rows = await prisma.scBlueprint.findMany({
    where: { outputName: { contains: focused, mode: 'insensitive' } },
    orderBy: { outputName: 'asc' },
    take: 25,
    select: { uuid: true, outputName: true, outputType: true },
  });

  await interaction.respond(
    rows.map((r) => ({
      name: r.outputType ? `${r.outputName} (${r.outputType})` : r.outputName,
      value: r.uuid,
    })),
  );
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'search')   return handleSearch(interaction);
  if (sub === 'recipe')   return handleRecipe(interaction);
  if (sub === 'dismantle') return handleDismantle(interaction);
}

// ── /blueprint search ─────────────────────────────────────────────────────────

async function handleSearch(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const query = interaction.options.getString('name', true).trim();

  const rows = await prisma.scBlueprint.findMany({
    where: { outputName: { contains: query, mode: 'insensitive' } },
    orderBy: { outputName: 'asc' },
    take: 15,
    include: { _count: { select: { tiers: true } } },
  });

  if (rows.length === 0) {
    await interaction.editReply({ content: `No blueprints found matching **${query}**.` });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`Blueprint Search — "${query}"`)
    .setColor(0x00b0f4)
    .setFooter({ text: `scunpacked · ${rows.length} result${rows.length === 1 ? '' : 's'}` });

  const lines = rows.map((r) => {
    const grade = r.outputGrade ? ` · Grade ${r.outputGrade}` : '';
    const tiers = r._count.tiers > 1 ? ` · ${r._count.tiers} tiers` : '';
    return `**${r.outputName}** — \`${r.outputType}\`${grade}${tiers}`;
  });

  embed.setDescription(lines.join('\n'));
  await interaction.editReply({ embeds: [embed] });
}

// ── /blueprint recipe ─────────────────────────────────────────────────────────

async function handleRecipe(interaction: ChatInputCommandInteraction) {
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
          modifiers: { orderBy: { key: 'asc' } },
        },
      },
    },
  });

  if (!bp) {
    await interaction.editReply({ content: `No blueprint found for **${rawValue}**.` });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`📋 ${bp.outputName}`)
    .setColor(0x00b0f4)
    .setFooter({ text: 'scunpacked · Star Citizen Blueprint Database' });

  const fields: { name: string; value: string; inline: boolean }[] = [];

  fields.push({ name: 'Type',  value: bp.outputType,  inline: true });
  if (bp.outputSubtype) fields.push({ name: 'Subtype', value: bp.outputSubtype, inline: true });
  if (bp.outputGrade)   fields.push({ name: 'Grade',   value: bp.outputGrade,   inline: true });

  // Show all tiers (cap at 3 to stay under Discord's embed field limit)
  const tiersToShow = bp.tiers.slice(0, 3);
  for (const tier of tiersToShow) {
    const header = bp.tiers.length > 1 ? `Tier ${tier.tierIndex + 1}` : 'Materials';
    const time = formatSeconds(tier.craftTimeSecs);

    if (tier.materials.length === 0) {
      fields.push({ name: `${header} · ⏱ ${time}`, value: '_No materials listed_', inline: false });
      continue;
    }

    const matLines = tier.materials.map((m) => {
      const qty = m.quantityScu != null
        ? `${m.quantityScu} SCU`
        : m.quantity != null
          ? `×${m.quantity}`
          : '';
      const qual = m.minQuality ? ` _(min q${m.minQuality})_` : '';
      return `• **${m.name}** ${qty}${qual}`;
    });

    fields.push({
      name: `${header} · ⏱ ${time}`,
      value: matLines.slice(0, 20).join('\n') + (matLines.length > 20 ? `\n_…and ${matLines.length - 20} more_` : ''),
      inline: false,
    });

    // Quality modifiers
    if (tier.modifiers.length > 0) {
      const modLines = tier.modifiers.map((mod) => {
        const lo = (mod.modifierAtMin * 100).toFixed(0);
        const hi = (mod.modifierAtMax * 100).toFixed(0);
        const unit = mod.unitFormat ?? '%';
        return `• **${mod.name}**: ${lo}${unit} → ${hi}${unit}`;
      });
      fields.push({
        name: `${header} · Quality Range (q${tiersToShow[0]?.modifiers[0]?.qualityMin ?? 0}–${tiersToShow[0]?.modifiers[0]?.qualityMax ?? 100})`,
        value: modLines.slice(0, 10).join('\n'),
        inline: false,
      });
    }
  }

  if (bp.tiers.length > 3) {
    fields.push({ name: '​', value: `_…${bp.tiers.length - 3} more tier(s) not shown_`, inline: false });
  }

  embed.addFields(fields);
  await interaction.editReply({ embeds: [embed] });
}

// ── /blueprint dismantle ──────────────────────────────────────────────────────

async function handleDismantle(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const rawValue = interaction.options.getString('name', true);

  const bp = await prisma.scBlueprint.findFirst({
    where: {
      OR: [
        { uuid: rawValue },
        { outputName: { equals: rawValue, mode: 'insensitive' } },
      ],
    },
  });

  if (!bp) {
    await interaction.editReply({ content: `No blueprint found for **${rawValue}**.` });
    return;
  }

  if (bp.dismantleTimeSecs == null && bp.dismantleEfficiency == null) {
    await interaction.editReply({ content: `**${bp.outputName}** has no dismantle data recorded.` });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`🔧 Dismantle — ${bp.outputName}`)
    .setColor(0xf59e0b)
    .setFooter({ text: 'scunpacked · Star Citizen Blueprint Database' });

  const fields: { name: string; value: string; inline: boolean }[] = [];
  if (bp.dismantleTimeSecs != null) fields.push({ name: 'Time',       value: formatSeconds(bp.dismantleTimeSecs), inline: true });
  if (bp.dismantleEfficiency != null) fields.push({ name: 'Recovery', value: `${(bp.dismantleEfficiency * 100).toFixed(0)}%`, inline: true });

  embed.addFields(fields);
  await interaction.editReply({ embeds: [embed] });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSeconds(secs: number): string {
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}
