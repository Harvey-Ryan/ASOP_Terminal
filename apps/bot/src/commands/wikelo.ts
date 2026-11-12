import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { searchWikelo, turnInQty, wikeloRewardTitle, type WikeloMission } from '@dem/shared';
import { prisma } from '../db.js';
import { hiddenModules } from '../utils/hiddenModules.js';
import { wikeloMissions } from '../services/wikeloService.js';

// /wikelo (v1.34.0): one of Wikelo's missions: what it rewards and exactly
// what to turn in. Anyone can look any mission up; checklists live on the
// website and aren't shown here.

export const data = new SlashCommandBuilder()
  .setName('wikelo')
  .setDescription('What a Wikelo mission rewards and what you turn in for it')
  .addStringOption((opt) =>
    opt
      .setName('mission')
      .setDescription('Mission, reward or item (start typing for suggestions)')
      .setRequired(true)
      .setAutocomplete(true),
  );

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const missions = await wikeloMissions();
  const matches = searchWikelo(missions, interaction.options.getFocused());
  await interaction.respond(
    matches.slice(0, 25).map((m) => ({ name: clip(`${m.title} → ${wikeloRewardTitle(m)}`, 100), value: m.id })),
  );
}

export function buildWikeloEmbed(m: WikeloMission, link: string | null): EmbedBuilder {
  const rewards = m.rewards.length === 1
    ? (m.rewards[0] ?? []).map((r) => `${r.amount > 1 ? `${r.amount}× ` : ''}${r.name}`).join('\n')
    : `${m.rewards.length} possible rewards (see the website for the list)`;
  const turnIn = m.turnIn.map((t) => `**${turnInQty(t)}${t.scu === null ? '×' : ''}** ${t.name}`).join('\n');
  const embed = new EmbedBuilder()
    .setTitle(clip(m.title, 256))
    .setColor(0xf0b45a)
    .addFields(
      { name: 'Reward', value: clip(rewards || '—', 1024) },
      { name: 'Turn in', value: clip(turnIn, 1024) },
    );
  if (m.stations.length) embed.addFields({ name: 'Where', value: `Any Wikelo Emporium: ${m.stations.join(', ')}` });
  const notes = [m.onceOnly ? 'Once only' : null, m.shareable ? 'Shareable' : 'Not shareable'].filter(Boolean).join(' · ');
  embed.setFooter({ text: `${notes}${link ? ' · Tick items off on the website' : ''}` });
  if (link) embed.setURL(link);
  return embed;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.guildId) {
    const hidden = await hiddenModules();
    const settings = await prisma.guildSettings.findFirst({ where: { guild: { guildId: interaction.guildId } }, select: { wikeloEnabled: true } });
    if (hidden.has('wikeloEnabled') || settings?.wikeloEnabled === false) {
      await interaction.reply({ content: 'Wikelo isn\'t available in this server.', flags: MessageFlags.Ephemeral });
      return;
    }
  }
  const raw = interaction.options.getString('mission', true).trim();
  const missions = await wikeloMissions();
  if (!missions.length) {
    await interaction.reply({ content: 'Game data isn\'t available yet. Try again in a few minutes.', flags: MessageFlags.Ephemeral });
    return;
  }
  const found = missions.find((m) => m.id === raw);
  const matches = found ? [found] : searchWikelo(missions, raw);
  if (matches.length === 0) {
    await interaction.reply({ content: `No Wikelo mission matches **${clip(raw, 80)}**.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (matches.length > 1) {
    const list = matches.slice(0, 15).map((m) => `• **${m.title}** → ${wikeloRewardTitle(m)}`).join('\n');
    await interaction.reply({
      content: `${matches.length} missions match **${clip(raw, 80)}**${matches.length > 15 ? ' (first 15)' : ''}. Pick one from the suggestions:\n${list}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const m = matches[0]!;
  const web = process.env['WEB_URL'];
  const link = web && interaction.guildId ? `${web.replace(/\/$/, '')}/dashboard/servers/${interaction.guildId}/wikelo/${m.id}` : null;
  await interaction.reply({ embeds: [buildWikeloEmbed(m, link)] });
}
