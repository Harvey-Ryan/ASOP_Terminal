import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { prisma } from '../db.js';
import { getContractsForBlueprint, BLUEPRINT_UUIDS_WITH_CONTRACTS } from '../gamedata.js';
import { formatSeconds, estimateAuec, fmtAuec, buildRecipeEmbed } from '../utils/scUtils.js';

export const data = new SlashCommandBuilder()
  .setName('blueprint')
  .setDescription('Look up Star Citizen crafting blueprints')
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
  )
  .addSubcommand((sub) =>
    sub
      .setName('contracts')
      .setDescription('Show which mission contracts can reward a blueprint')
      .addStringOption((opt) =>
        opt
          .setName('name')
          .setDescription('Blueprint name (start typing for suggestions)')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  );

// ── Autocomplete ──────────────────────────────────────────────────────────────

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused();
  const sub     = interaction.options.getSubcommand(false);

  // For contracts, fetch extra rows so we have enough after filtering to known-obtainable blueprints
  const rows = await prisma.scBlueprint.findMany({
    where:   { outputName: { contains: focused, mode: 'insensitive' } },
    orderBy: { outputName: 'asc' },
    take:    sub === 'contracts' ? 100 : 25,
    select:  { uuid: true, outputName: true, outputType: true },
  });

  const suggestions = sub === 'contracts'
    ? rows.filter((r) => BLUEPRINT_UUIDS_WITH_CONTRACTS.has(r.uuid)).slice(0, 25)
    : rows;

  await interaction.respond(
    suggestions.map((r) => ({
      name:  r.outputType ? `${r.outputName} (${r.outputType})` : r.outputName,
      value: r.uuid,
    })),
  );
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub === 'search')    return handleSearch(interaction);
  if (sub === 'recipe')    return handleRecipe(interaction);
  if (sub === 'dismantle') return handleDismantle(interaction);
  if (sub === 'contracts') return handleContracts(interaction);
}

// ── /blueprint search ─────────────────────────────────────────────────────────

async function handleSearch(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const query = interaction.options.getString('name', true).trim();

  const rows = await prisma.scBlueprint.findMany({
    where:   { outputName: { contains: query, mode: 'insensitive' } },
    orderBy: { outputName: 'asc' },
    take:    15,
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

async function handleRecipe(interaction: ChatInputCommandInteraction): Promise<void> {
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

// ── /blueprint dismantle ──────────────────────────────────────────────────────

async function handleDismantle(interaction: ChatInputCommandInteraction): Promise<void> {
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
    await interaction.editReply({
      content: `**${bp.outputName}** has no dismantle data recorded.`,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`🔧 Dismantle — ${bp.outputName}`)
    .setColor(0xf59e0b)
    .setFooter({ text: 'scunpacked · Star Citizen Blueprint Database' });

  const fields: { name: string; value: string; inline: boolean }[] = [];
  if (bp.dismantleTimeSecs   != null) fields.push({ name: 'Time',     value: formatSeconds(bp.dismantleTimeSecs),                   inline: true });
  if (bp.dismantleEfficiency != null) fields.push({ name: 'Recovery', value: `${(bp.dismantleEfficiency * 100).toFixed(0)}%`, inline: true });

  embed.addFields(fields);
  await interaction.editReply({ embeds: [embed] });
}

// ── /blueprint contracts ──────────────────────────────────────────────────────

async function handleContracts(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const rawValue = interaction.options.getString('name', true);

  const bp = await prisma.scBlueprint.findFirst({
    where: {
      OR: [
        { uuid: rawValue },
        { outputName: { equals: rawValue, mode: 'insensitive' } },
      ],
    },
    select: { uuid: true, outputName: true, outputType: true },
  });

  if (!bp) {
    await interaction.editReply({ content: `No blueprint found for **${rawValue}**.` });
    return;
  }

  const contracts = getContractsForBlueprint(bp.uuid);

  if (contracts.length === 0) {
    await interaction.editReply({
      content: `No mission contracts found for **${bp.outputName}**. This blueprint may not be obtainable through contract missions.`,
    });
    return;
  }

  const total   = contracts.length;
  const toShow  = contracts.slice(0, 10);

  const embed = new EmbedBuilder()
    .setTitle(`Contracts Rewarding "${bp.outputName}"`)
    .setColor(0x6366f1)
    .setFooter({
      text: `Star Citizen · ${total} contract${total !== 1 ? 's' : ''}${
        total > toShow.length ? ` · showing ${toShow.length} of ${total}` : ''
      }`,
    });

  for (const contract of toShow) {
    // Resolve locations for the specific pool(s) that contain this blueprint
    const relevantLocs = new Set<string>();
    for (const pool of contract.pools) {
      if (pool.blueprints.some((b) => b.blueprintUuid === bp.uuid)) {
        for (const loc of pool.locations) relevantLocs.add(loc);
      }
    }
    const locsSorted = [...relevantLocs].sort();

    const lines: string[] = [];

    // Line 1: type · giver · faction · illegal flag
    const meta: string[] = [];
    if (contract.missionType)  meta.push(`\`${contract.missionType}\``);
    if (contract.missionGiver) meta.push(`Giver: ${contract.missionGiver}`);
    if (contract.faction)      meta.push(contract.faction);
    if (contract.illegal)      meta.push('⚠️ **ILLEGAL**');
    if (meta.length)           lines.push(meta.join(' · '));

    // Line 2: time · risk score · aUEC estimate · standing requirement
    const stats: string[] = [];
    if (contract.timeToCompleteMinutes) stats.push(`⏱ ${contract.timeToCompleteMinutes} min`);
    const risk = contract.difficulty?.riskOfLoss;
    if (risk) {
      stats.push(`Risk ${risk}/7`);
      const est = estimateAuec(contract.timeToCompleteMinutes, risk);
      if (est) stats.push(`~${fmtAuec(est.low)}–${fmtAuec(est.high)} aUEC est.`);
    }
    if (contract.minStanding) {
      stats.push(`Req: ${contract.minStanding.name} ${contract.minStanding.minReputation}`);
    }
    if (stats.length) lines.push(stats.join(' · '));

    // Line 3: locations
    if (locsSorted.length > 0) {
      const preview = locsSorted.slice(0, 3).join(', ');
      const extra   = locsSorted.length > 3 ? ` +${locsSorted.length - 3} more` : '';
      lines.push(`📍 ${preview}${extra}`);
    }

    embed.addFields({
      name:   contract.illegal ? `${contract.title} ⚠️` : contract.title,
      value:  lines.join('\n') || '_No additional details_',
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
