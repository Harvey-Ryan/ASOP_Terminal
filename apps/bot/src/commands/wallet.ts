import { SlashCommandBuilder, EmbedBuilder, GuildMember, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '../db.js';
import { getGuildDkpLabel } from '../utils/dkpLabel.js';

export const data = new SlashCommandBuilder()
  .setName('wallet')
  .setDescription('Check your DKP balance and recent transactions')
  .addUserOption((opt) =>
    opt
      .setName('user')
      .setDescription('Check another member\'s balance (visible to everyone)')
      .setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply('This command can only be used in a server.');
    return;
  }

  const dkpLabel = await getGuildDkpLabel(guildId);

  const targetUser = interaction.options.getUser('user');
  const isSelf = !targetUser || targetUser.id === interaction.user.id;

  // Resolve target Discord ID and display name
  let targetDiscordId: string;
  let targetDisplayName: string;

  if (targetUser) {
    targetDiscordId = targetUser.id;
    // Try to get guild display name
    const member = interaction.guild?.members.cache.get(targetUser.id)
      ?? await interaction.guild?.members.fetch(targetUser.id).catch(() => null);
    targetDisplayName = member instanceof GuildMember
      ? member.displayName
      : targetUser.username;
  } else {
    targetDiscordId = interaction.user.id;
    targetDisplayName = interaction.member instanceof GuildMember
      ? interaction.member.displayName
      : interaction.user.username;
  }

  // Fetch balance and leaderboard rank in parallel
  const [balance, allBalances, recentTx] = await Promise.all([
    prisma.dkpBalance.findUnique({
      where: { guildId_userId: { guildId, userId: targetDiscordId } },
    }),
    prisma.dkpBalance.findMany({
      where: { guildId },
      orderBy: { balance: 'desc' },
      select: { userId: true },
    }),
    prisma.dkpTransaction.findMany({
      where: { guildId, userId: targetDiscordId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);

  const currentBalance = balance?.balance ?? 0;
  const rank = allBalances.findIndex((b) => b.userId === targetDiscordId) + 1;
  const rankDisplay = rank > 0 ? `#${rank} of ${allBalances.length}` : `Unranked`;

  // Recent transactions field
  const txLines = recentTx.length > 0
    ? recentTx.map((t) => {
        const sign = t.amount >= 0 ? '+' : '';
        const icon = t.amount >= 0 ? '📈' : '📉';
        const date = new Date(t.createdAt).toLocaleDateString('en', { month: 'short', day: 'numeric' });
        return `${icon} **${sign}${t.amount.toLocaleString()}** — ${t.reason} *(${date})*`;
      }).join('\n')
    : '*No transactions yet.*';

  const embed = new EmbedBuilder()
    .setTitle(`🪙 ${dkpLabel} Wallet — ${targetDisplayName}`)
    .setColor(currentBalance >= 0 ? 0xf59e0b : 0xef4444)
    .addFields(
      {
        name: 'Balance',
        value: `**${currentBalance.toLocaleString()} ${dkpLabel}**`,
        inline: true,
      },
      {
        name: 'Rank',
        value: rankDisplay,
        inline: true,
      },
      {
        name: 'Recent Transactions',
        value: txLines,
        inline: false,
      },
    )
    .setTimestamp();

  // Self-checks are ephemeral; looking up someone else posts publicly
  if (isSelf) {
    await interaction.editReply({ embeds: [embed] });
  } else {
    await interaction.editReply({ content: ' ' }); // dismiss the ephemeral defer
    await interaction.followUp({ embeds: [embed], ephemeral: false });
  }
}
