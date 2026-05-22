import { SlashCommandBuilder, GuildMember } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '../db.js';
import { postOrUpdateAuctionMessage, postOrUpdateStandaloneAuctionMessage } from '../services/auctionService.js';

export const data = new SlashCommandBuilder()
  .setName('bid')
  .setDescription('Place or raise your DKP bid in the current live auction')
  .addIntegerOption((opt) =>
    opt
      .setName('amount')
      .setDescription('DKP amount to bid')
      .setRequired(true)
      .setMinValue(1),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply('This command can only be used in a server.');
    return;
  }

  const amount = interaction.options.getInteger('amount', true);
  const userId = interaction.user.id;
  const username =
    interaction.member instanceof GuildMember
      ? interaction.member.displayName
      : interaction.user.username;

  // Find the most recently started OPEN auction from EITHER table
  const [lootAuction, standaloneAuction] = await Promise.all([
    prisma.lootAuction.findFirst({
      where: { guildId, status: 'OPEN' },
      include: {
        bids: { orderBy: { amount: 'desc' } },
        item: { include: { session: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.auction.findFirst({
      where: { guildId, status: 'OPEN' },
      include: { bids: { orderBy: { amount: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // Pick the most recent by createdAt
  const useLootAuction =
    lootAuction &&
    (!standaloneAuction ||
      lootAuction.createdAt.getTime() >= standaloneAuction.createdAt.getTime());

  // ── Standalone auction path ───────────────────────────────────────────────

  if (!useLootAuction) {
    if (!standaloneAuction) {
      await interaction.editReply('❌ There is no live auction running in this server right now.');
      return;
    }

    if (standaloneAuction.closesAt <= new Date()) {
      await interaction.editReply(
        '❌ The auction has already closed. Check the web dashboard for results.',
      );
      return;
    }

    // Bid must exceed current standing bid
    const existing = standaloneAuction.bids.find((b) => b.userId === userId);
    if (existing && amount <= existing.amount) {
      await interaction.editReply(
        `❌ Your bid must exceed your current bid of **${existing.amount} DKP**. Bid higher to raise it.`,
      );
      return;
    }

    // Raw DKP balance check — no committed subtraction for standalone
    const bal = await prisma.dkpBalance.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });
    const rawBalance = bal?.balance ?? 0;

    if (amount > rawBalance) {
      await interaction.editReply(
        `❌ Insufficient DKP. You bid **${amount}** but only have **${rawBalance}** available.`,
      );
      return;
    }

    await prisma.auctionBid.upsert({
      where: { auctionId_userId: { auctionId: standaloneAuction.id, userId } },
      create: { auctionId: standaloneAuction.id, userId, username, amount },
      update: { username, amount, placedAt: new Date() },
    });

    await postOrUpdateStandaloneAuctionMessage(standaloneAuction.id).catch(() => null);

    const closesTs = Math.floor(standaloneAuction.closesAt.getTime() / 1000);
    const action = existing ? 'raised to' : 'placed at';
    await interaction.editReply(
      `✅ Bid ${action} **${amount} DKP** for **${standaloneAuction.title}**.\nAuction closes <t:${closesTs}:R>.`,
    );
    return;
  }

  // ── Loot auction path (existing logic, unchanged) ─────────────────────────

  const auction = lootAuction!;

  if (auction.closesAt <= new Date()) {
    await interaction.editReply(
      '❌ The auction has already closed. Check the web dashboard or forum thread for results.',
    );
    return;
  }

  // Check eligibility against live confirmedAttendees so players confirmed after
  // session creation can still bid (draftOrder is a creation-time snapshot).
  const event = await prisma.event.findUnique({
    where: { id: auction.item.session.eventId },
    select: { confirmedAttendees: true },
  });
  const confirmedAttendees: string[] = event?.confirmedAttendees
    ? JSON.parse(event.confirmedAttendees)
    : [];
  if (!confirmedAttendees.includes(userId)) {
    await interaction.editReply(
      '❌ You are not a confirmed attendee for this loot session and cannot bid.',
    );
    return;
  }

  // Bid must exceed current standing bid
  const existing = auction.bids.find((b) => b.userId === userId);
  if (existing && amount <= existing.amount) {
    await interaction.editReply(
      `❌ Your bid must exceed your current bid of **${existing.amount} DKP**. Bid higher to raise it.`,
    );
    return;
  }

  // Effective balance = raw balance − DKP committed to items already won in this session
  const bal = await prisma.dkpBalance.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  const won = await prisma.lootAssignment.findMany({
    where: { item: { sessionId: auction.item.session.id }, userId },
    select: { dkpSpent: true },
  });
  const committed = won.reduce((s, a) => s + (a.dkpSpent ?? 0), 0);
  const effective = (bal?.balance ?? 0) - committed;

  if (amount > effective) {
    await interaction.editReply(
      `❌ Insufficient DKP. You bid **${amount}** but only have **${effective}** available (balance: ${bal?.balance ?? 0}, committed: ${committed}).`,
    );
    return;
  }

  // Place or raise the bid
  await prisma.lootAuctionBid.upsert({
    where: { auctionId_userId: { auctionId: auction.id, userId } },
    create: { auctionId: auction.id, userId, username, amount },
    update: { username, amount, placedAt: new Date() },
  });

  // Update the Discord embed in the forum thread
  await postOrUpdateAuctionMessage(auction.id).catch(() => null);

  const closesTs = Math.floor(auction.closesAt.getTime() / 1000);
  const action = existing ? 'raised to' : 'placed at';
  await interaction.editReply(
    `✅ Bid ${action} **${amount} DKP** for **${auction.item.name}**.\nAuction closes <t:${closesTs}:R>.`,
  );
}
