import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { MATERIAL_NAMES, getBlueprintsForMaterial } from '../gamedata.js';

export const data = new SlashCommandBuilder()
  .setName('material')
  .setDescription('Look up Star Citizen crafting materials')
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

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();

  const matches = MATERIAL_NAMES
    .filter((n) => n.includes(focused))
    .slice(0, 25);

  await interaction.respond(matches.map((n) => ({ name: n, value: n })));
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub === 'usedby') return handleUsedBy(interaction);
}

// ── /material usedby ──────────────────────────────────────────────────────────

async function handleUsedBy(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const materialName = interaction.options.getString('name', true).trim();

  // Find all blueprints using any material name containing the search term
  const search  = materialName.toLowerCase();
  const matches = MATERIAL_NAMES.filter((n) => n.includes(search));

  if (matches.length === 0) {
    await interaction.editReply({ content: `No blueprints found that use **${materialName}**.` });
    return;
  }

  // Collect all matching blueprints (de-duped)
  const bpSet = new Set(matches.flatMap((n) => getBlueprintsForMaterial(n)));
  const blueprints = [...bpSet].sort((a, b) => a.outputName.localeCompare(b.outputName));
  const total   = blueprints.length;
  const showing = blueprints.slice(0, 20);

  // For the title, prefer an exact match
  const exactMatch = matches.find((n) => n === search) ?? matches[0]!;

  // Find qty from first blueprint that uses the exact-matched material name
  const firstBp = getBlueprintsForMaterial(exactMatch)[0];
  const firstMat = firstBp?.materials.find((m) => m.name.toLowerCase() === exactMatch);
  const qty = firstMat
    ? firstMat.quantityScu != null
      ? `${firstMat.quantityScu} SCU`
      : firstMat.quantity != null
        ? `×${firstMat.quantity}`
        : ''
    : '';

  const embed = new EmbedBuilder()
    .setTitle(`🔩 Blueprints using "${exactMatch}"${qty ? ` (${qty})` : ''}`)
    .setColor(0x10b981)
    .setFooter({
      text: `Star Citizen · ${total} blueprint${total === 1 ? '' : 's'} total${showing.length < total ? `, showing ${showing.length}` : ''}`,
    });

  const lines = showing.map((b) => {
    const grade = b.outputGrade ? ` · Grade ${b.outputGrade}` : '';
    return `• **${b.outputName}** — \`${b.outputType}\`${grade}`;
  });

  if (lines.length > 0) embed.setDescription(lines.join('\n'));

  // Show matched variant names when the search hit multiple distinct names
  if (matches.length > 1) {
    const variantLines = matches
      .slice(0, 5)
      .map((n) => `• ${n} (${getBlueprintsForMaterial(n).length})`);
    embed.addFields([{ name: 'Matched variants', value: variantLines.join('\n'), inline: false }]);
  }

  await interaction.editReply({ embeds: [embed] });
}
