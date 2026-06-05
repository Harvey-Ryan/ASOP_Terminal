import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import {
  BLUEPRINTS,
  BLUEPRINT_BY_UUID,
  BLUEPRINT_UUIDS_WITH_CONTRACTS,
  getContractsForBlueprint,
} from '../gamedata.js';
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
  const focused = interaction.options.getFocused().toLowerCase();
  const sub     = interaction.options.getSubcommand(false);

  let matches = BLUEPRINTS.filter((b) => b.outputName.toLowerCase().includes(focused));

  if (sub === 'contracts') {
    matches = matches.filter((b) => BLUEPRINT_UUIDS_WITH_CONTRACTS.has(b.uuid));
  }

  await interaction.respond(
    matches.slice(0, 25).map((b) => ({
      name:  b.outputType ? `${b.outputName} (${b.outputType})` : b.outputName,
      value: b.uuid,
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
  const query  = interaction.options.getString('name', true).trim().toLowerCase();
  const rows   = BLUEPRINTS.filter((b) => b.outputName.toLowerCase().includes(query)).slice(0, 15);

  if (rows.length === 0) {
    await interaction.editReply({ content: `No blueprints found matching **${query}**.` });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`Blueprint Search — "${query}"`)
    .setColor(0x00b0f4)
    .setFooter({ text: `Star Citizen · ${rows.length} result${rows.length === 1 ? '' : 's'}` });

  const lines = rows.map((b) => {
    const grade = b.outputGrade ? ` · Grade ${b.outputGrade}` : '';
    return `**${b.outputName}** — \`${b.outputType}\`${grade}`;
  });

  embed.setDescription(lines.join('\n'));
  await interaction.editReply({ embeds: [embed] });
}

// ── /blueprint recipe ─────────────────────────────────────────────────────────

async function handleRecipe(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const rawValue = interaction.options.getString('name', true);
  const bp = resolve(rawValue);

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
  const bp = resolve(rawValue);

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
    .setFooter({ text: 'Star Citizen Blueprint Database' });

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
  const bp = resolve(rawValue);

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

  const total  = contracts.length;
  const toShow = contracts.slice(0, 10);

  const embed = new EmbedBuilder()
    .setTitle(`Contracts Rewarding "${bp.outputName}"`)
    .setColor(0x6366f1)
    .setFooter({
      text: `Star Citizen · ${total} contract${total !== 1 ? 's' : ''}${
        total > toShow.length ? ` · showing ${toShow.length} of ${total}` : ''
      }`,
    });

  for (const contract of toShow) {
    const relevantLocs = new Set<string>();
    for (const pool of contract.pools) {
      if (pool.blueprints.some((b) => b.blueprintUuid === bp.uuid)) {
        for (const loc of pool.locations) relevantLocs.add(loc);
      }
    }
    const locsSorted = [...relevantLocs].sort();

    const lines: string[] = [];

    const meta: string[] = [];
    if (contract.missionType)  meta.push(`\`${contract.missionType}\``);
    if (contract.missionGiver) meta.push(`Giver: ${contract.missionGiver}`);
    if (contract.faction)      meta.push(contract.faction);
    if (contract.illegal)      meta.push('⚠️ **ILLEGAL**');
    if (meta.length)           lines.push(meta.join(' · '));

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolve(rawValue: string) {
  return (
    BLUEPRINT_BY_UUID.get(rawValue) ??
    BLUEPRINTS.find((b) => b.outputName.toLowerCase() === rawValue.toLowerCase())
  );
}
