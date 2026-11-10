import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import {
  getBlueprints,
  getBlueprintByUuid,
  getContractsForBlueprint,
  gameDataFooter,
  type LocalBlueprint,
} from '../gamedata.js';
import { formatSeconds, estimateAuec, fmtAuec, buildRecipeEmbed } from '../utils/scUtils.js';

// One command for everything about a blueprint: the recipe, what dismantling
// returns, and (behind a button) the missions that can reward it.

export const data = new SlashCommandBuilder()
  .setName('blueprint')
  .setDescription('Show a crafting blueprint: recipe, dismantle return and missions that reward it')
  .addStringOption((opt) =>
    opt
      .setName('name')
      .setDescription('Item name (start typing for suggestions)')
      .setRequired(true)
      .setAutocomplete(true),
  );

/** customId prefix of the "Missions" button (followed by ":<blueprint uuid>"). */
export const MISSIONS_BUTTON = 'bp_missions';

// ── Autocomplete ──────────────────────────────────────────────────────────────

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  const matches = getBlueprints().filter((b) => b.outputName.toLowerCase().includes(focused));
  await interaction.respond(
    matches.slice(0, 25).map((b) => ({
      name:  b.outputType ? `${b.outputName} (${b.outputType})` : b.outputName,
      value: b.uuid,
    })),
  );
}

// ── /blueprint <name> ─────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const rawValue = interaction.options.getString('name', true).trim();
  const bp = resolve(rawValue);

  if (!bp) {
    // Typed text without picking a suggestion: list what it matches.
    const q = rawValue.toLowerCase();
    const similar = getBlueprints().filter((b) => b.outputName.toLowerCase().includes(q));
    if (similar.length === 0) {
      await interaction.editReply({ content: `No blueprint found for **${rawValue}**.` });
      return;
    }
    const shown = similar.slice(0, 15).map((b) => {
      const grade = b.outputGrade ? ` · Grade ${b.outputGrade}` : '';
      return `• **${b.outputName}** — \`${b.outputType}\`${grade}`;
    });
    const embed = new EmbedBuilder()
      .setTitle(`Blueprints matching "${rawValue}"`)
      .setColor(0x00b0f4)
      .setDescription(`${shown.join('\n')}\n\nPick one from the suggestions to see its recipe.`)
      .setFooter({ text: `${similar.length} result${similar.length === 1 ? '' : 's'}${similar.length > 15 ? ', showing 15' : ''} · ${gameDataFooter()}` });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const embed = buildRecipeEmbed(bp);

  const dismantle: string[] = [];
  if (bp.dismantleTimeSecs   != null) dismantle.push(`⏱ ${formatSeconds(bp.dismantleTimeSecs)}`);
  if (bp.dismantleEfficiency != null) dismantle.push(`${(bp.dismantleEfficiency * 100).toFixed(0)}% of materials back`);
  if (dismantle.length) embed.addFields({ name: '🔧 Dismantle', value: dismantle.join(' · '), inline: false });

  const missions = getContractsForBlueprint(bp.uuid).length;
  embed.addFields({
    name:   '🎯 Missions',
    value:  missions > 0
      ? `Can be rewarded by **${missions}** mission${missions === 1 ? '' : 's'}.`
      : 'Not rewarded by any known mission.',
    inline: false,
  });

  const components = missions > 0
    ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${MISSIONS_BUTTON}:${bp.uuid}`)
          .setLabel(`Show missions (${missions})`)
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🎯'),
      )]
    : [];

  await interaction.editReply({ embeds: [embed], components });
}

// ── Missions button ───────────────────────────────────────────────────────────

/** Replies (only to the person who clicked) with the missions that reward the blueprint. */
export async function handleMissionsButton(interaction: ButtonInteraction): Promise<void> {
  const uuid = interaction.customId.slice(MISSIONS_BUTTON.length + 1);
  const bp = getBlueprintByUuid(uuid);
  if (!bp) {
    await interaction.reply({ content: 'This blueprint is no longer in the game data. Run /blueprint again.', flags: MessageFlags.Ephemeral });
    return;
  }
  const embed = buildMissionsEmbed(bp);
  await interaction.reply(
    embed
      ? { embeds: [embed], flags: MessageFlags.Ephemeral }
      : { content: `No missions currently reward **${bp.outputName}**.`, flags: MessageFlags.Ephemeral },
  );
}

function buildMissionsEmbed(bp: LocalBlueprint): EmbedBuilder | null {
  const contracts = getContractsForBlueprint(bp.uuid);
  if (contracts.length === 0) return null;

  const total  = contracts.length;
  const toShow = contracts.slice(0, 10);

  const embed = new EmbedBuilder()
    .setTitle(`🎯 Missions rewarding ${bp.outputName}`)
    .setColor(0x6366f1)
    .setFooter({
      text: `${total} mission${total !== 1 ? 's' : ''}${
        total > toShow.length ? ` · showing ${toShow.length} of ${total}` : ''
      } · ${gameDataFooter()}`,
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

    // Line 3: reputation XP rewards
    if (contract.reputation.length > 0) {
      const byFaction = new Map<string, typeof contract.reputation>();
      for (const r of contract.reputation) {
        const arr = byFaction.get(r.faction) ?? [];
        arr.push(r);
        byFaction.set(r.faction, arr);
      }
      const repParts = [...byFaction.entries()].slice(0, 3).map(([faction, reps]) => {
        const xpStr = reps.map((r) => `+${r.xp} ${scopeLabel(r.scope)}`).join(', ');
        return `${xpStr} (${faction})`;
      });
      lines.push(`⭐ ${repParts.join(' · ')}`);
    }

    // Line 4: locations
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

  return embed;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolve(rawValue: string) {
  return (
    getBlueprintByUuid(rawValue) ??
    getBlueprints().find((b) => b.outputName.toLowerCase() === rawValue.toLowerCase())
  );
}

function scopeLabel(scope: string): string {
  switch (scope) {
    case 'FactionReputation':            return 'XP';
    case 'Affinity':                     return 'Affinity';
    case 'BountyHunter_BountyHuntersGuild': return 'BHG';
    case 'ShipCombat_HeadHunters':       return 'Headhunters';
    default: return scope.replace(/_/g, ' ');
  }
}
