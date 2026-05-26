import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';
import { prisma } from '../db.js';
import { client } from '../client.js';
import { getGuildDkpLabel } from '../utils/dkpLabel.js';
import { updatePostEventEmbed } from './eventService.js';

// ── Embed builder ─────────────────────────────────────────────────────────────

type AuctionForEmbed = {
  id: string;
  status: string;
  winnerId: string | null;
  winnerUsername: string | null;
  winningBid: number | null;
  closesAt: Date;
  bids: { userId: string; username: string; amount: number }[];
  item: { name: string; session: { eventId: string | null } };
};

const MEDALS = ['🥇', '🥈', '🥉'];

function buildEmbed(auction: AuctionForEmbed, lootUrl: string, dkpLabel: string): EmbedBuilder {
  const isOpen = auction.status === 'OPEN';
  const closesTs = Math.floor(auction.closesAt.getTime() / 1000);
  const sorted = [...auction.bids].sort((a, b) => b.amount - a.amount);

  if (auction.status === 'CANCELLED') {
    return new EmbedBuilder()
      .setTitle(`❌ Auction Cancelled — ${auction.item.name}`)
      .setColor(0x6b7280)
      .setTimestamp();
  }

  if (isOpen) {
    const bidLines = sorted.length > 0
      ? sorted.map((b, i) => `${MEDALS[i] ?? `${i + 1}.`} **${b.username}** — ${b.amount} ${dkpLabel}`).join('\n')
      : '*No bids yet — be the first!*';

    return new EmbedBuilder()
      .setTitle(`🔨 LIVE AUCTION — ${auction.item.name}`)
      .setColor(0xf59e0b)
      .setDescription(bidLines)
      .addFields(
        { name: '⏱ Closes', value: `<t:${closesTs}:R>`, inline: true },
        { name: '💡 How to bid', value: 'Use `/bid <amount>` in Discord or the web dashboard', inline: false },
      )
      .setTimestamp();
  }

  // CLOSED
  const winnerLine = auction.winnerId
    ? `🏆 <@${auction.winnerId}> with **${auction.winningBid} ${dkpLabel}**`
    : '*No bids received — item unawarded*';

  const finalStandings = sorted.length > 0
    ? '\n\n**Final standings:**\n' + sorted.map((b, i) => `${MEDALS[i] ?? `${i + 1}.`} **${b.username}** — ${b.amount} ${dkpLabel}`).join('\n')
    : '';

  return new EmbedBuilder()
    .setTitle(`✅ Auction Closed — ${auction.item.name}`)
    .setColor(0x22c55e)
    .setDescription(`${winnerLine}${finalStandings}`)
    .setTimestamp();
}

// ── Core post/update function ─────────────────────────────────────────────────

export async function postOrUpdateAuctionMessage(auctionId: string): Promise<void> {
  const auction = await prisma.lootAuction.findUnique({
    where: { id: auctionId },
    include: {
      bids: { orderBy: { amount: 'desc' } },
      item: { include: { session: true } },
    },
  });
  if (!auction || !auction.item.session.eventId) return;

  const event = await prisma.event.findUnique({
    where: { id: auction.item.session.eventId },
    select: { threadId: true, name: true },
  });
  if (!event?.threadId) return;

  const thread = await client.channels.fetch(event.threadId).catch(() => null);
  if (!thread?.isThread()) return;

  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';
  const lootUrl = `${webUrl}/dashboard/servers/${auction.guildId}/events/${auction.item.session.eventId}/loot`;
  const dkpLabel = await getGuildDkpLabel(auction.guildId);
  const embed = buildEmbed(auction, lootUrl, dkpLabel);

  if (auction.discordMessageId) {
    try {
      const existing = await thread.messages.fetch(auction.discordMessageId);
      await existing.edit({ embeds: [embed] });
    } catch {
      // Message was deleted — post fresh and save the new ID
      const msg = await thread.send({ embeds: [embed] });
      await prisma.lootAuction.update({ where: { id: auctionId }, data: { discordMessageId: msg.id } });
    }
  } else {
    const wasArchived = thread.archived ?? false;
    if (wasArchived) await thread.setArchived(false).catch(() => null);
    const msg = await thread.send({
      content: `🔨 **LIVE AUCTION** — \`${auction.item.name}\` is now open for bids! Use \`/bid\` or the web dashboard to place your bid.`,
      embeds: [embed],
    });
    if (wasArchived) await thread.setArchived(true).catch(() => null);
    await prisma.lootAuction.update({ where: { id: auctionId }, data: { discordMessageId: msg.id } });
  }

  // DM the winner when auction closes
  if (auction.status === 'CLOSED' && auction.winnerId && auction.winningBid) {
    try {
      const winner = await client.users.fetch(auction.winnerId);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setLabel('View Loot Session').setStyle(ButtonStyle.Link).setURL(lootUrl),
      );
      await winner.send({
        content: `🏆 You won **${auction.item.name}** in the ${dkpLabel} auction for **${auction.winningBid} ${dkpLabel}**!`,
        components: [row],
      });
    } catch {
      // DMs may be disabled — silently skip
    }
  }
}

// ── Standalone auction embed builder ─────────────────────────────────────────

type StandaloneAuctionForEmbed = {
  id: string;
  guildId: string;
  title: string;
  status: string;
  winnerId: string | null;
  winnerUsername: string | null;
  winningBid: number | null;
  closesAt: Date;
  bids: { userId: string; username: string; amount: number }[];
};

function buildStandaloneEmbed(auction: StandaloneAuctionForEmbed, auctionUrl: string, dkpLabel: string): EmbedBuilder {
  const isOpen = auction.status === 'OPEN';
  const closesTs = Math.floor(auction.closesAt.getTime() / 1000);
  const sorted = [...auction.bids].sort((a, b) => b.amount - a.amount);

  if (auction.status === 'CANCELLED') {
    return new EmbedBuilder()
      .setTitle(`❌ Auction Cancelled — ${auction.title}`)
      .setColor(0x6b7280)
      .setTimestamp();
  }

  if (isOpen) {
    const bidLines =
      sorted.length > 0
        ? sorted.map((b, i) => `${MEDALS[i] ?? `${i + 1}.`} **${b.username}** — ${b.amount} ${dkpLabel}`).join('\n')
        : '*No bids yet — be the first!*';

    return new EmbedBuilder()
      .setTitle(`🔨 LIVE AUCTION — ${auction.title}`)
      .setColor(0xf59e0b)
      .setDescription(bidLines)
      .addFields(
        { name: '⏱ Closes', value: `<t:${closesTs}:R>`, inline: true },
        { name: '💡 How to bid', value: 'Use `/bid <amount>` in Discord or the web dashboard', inline: false },
      )
      .setTimestamp();
  }

  // CLOSED
  const winnerLine = auction.winnerId
    ? `🏆 <@${auction.winnerId}> with **${auction.winningBid} ${dkpLabel}**`
    : '*No bids received — item unawarded*';

  const finalStandings =
    sorted.length > 0
      ? '\n\n**Final standings:**\n' +
        sorted.map((b, i) => `${MEDALS[i] ?? `${i + 1}.`} **${b.username}** — ${b.amount} ${dkpLabel}`).join('\n')
      : '';

  return new EmbedBuilder()
    .setTitle(`✅ Auction Closed — ${auction.title}`)
    .setColor(0x22c55e)
    .setDescription(`${winnerLine}${finalStandings}`)
    .setTimestamp();
}

// ── Inline applyDkp for standalone auctions ───────────────────────────────────
// Mirror copy lives in apps/api/src/server/routes/auction.ts — keep in sync.
// Cannot live in packages/shared because it requires a Prisma client instance.

async function applyDkpForStandaloneAuction(
  guildId: string,
  userId: string,
  username: string,
  amount: number,
  title: string,
): Promise<void> {
  const balance = await prisma.dkpBalance.upsert({
    where: { guildId_userId: { guildId, userId } },
    create: { guildId, userId, username, balance: 0 },
    update: {},
  });
  await prisma.dkpBalance.update({
    where: { id: balance.id },
    data: { balance: { increment: -amount }, username },
  });
  await prisma.dkpTransaction.create({
    data: {
      balanceId: balance.id,
      guildId,
      userId,
      username,
      amount: -amount,
      reason: `Standalone Auction: ${title}`,
    },
  });
}

// ── Post/update embed for standalone auctions ─────────────────────────────────

export async function postOrUpdateStandaloneAuctionMessage(auctionId: string): Promise<void> {
  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    include: { bids: { orderBy: { amount: 'desc' } } },
  });
  if (!auction) return;

  const guildSettings = await prisma.guildSettings.findFirst({
    where: { guild: { guildId: auction.guildId } },
    select: { dkpAnnouncementChannelId: true, dkpLabel: true },
  });
  if (!guildSettings?.dkpAnnouncementChannelId) return;

  const channel = await client.channels.fetch(guildSettings.dkpAnnouncementChannelId).catch(() => null);
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) return;

  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';
  const auctionUrl = `${webUrl}/dashboard/servers/${auction.guildId}/auctions`;
  const dkpLabel = guildSettings.dkpLabel ?? 'DKP';
  const embed = buildStandaloneEmbed(auction, auctionUrl, dkpLabel);

  if (auction.discordMessageId) {
    try {
      const existing = await channel.messages.fetch(auction.discordMessageId);
      await existing.edit({ embeds: [embed] });
    } catch {
      // Message deleted — post fresh
      const msg = await channel.send({ embeds: [embed] });
      await prisma.auction.update({
        where: { id: auctionId },
        data: { discordMessageId: msg.id },
      });
    }
  } else {
    const msg = await channel.send({
      content: `🔨 **LIVE AUCTION** — \`${auction.title}\` is now open for bids! Use \`/bid\` or the web dashboard to place your bid.`,
      embeds: [embed],
    });
    await prisma.auction.update({
      where: { id: auctionId },
      data: { discordMessageId: msg.id },
    });
  }

  // DM the winner when auction closes; fall back to the announcement channel if DMs are off
  if (auction.status === 'CLOSED' && auction.winnerId && auction.winningBid) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel('View Auctions').setStyle(ButtonStyle.Link).setURL(auctionUrl),
    );
    let dmSent = false;
    try {
      const winner = await client.users.fetch(auction.winnerId);
      await winner.send({
        content: `🏆 You won **${auction.title}** in the ${dkpLabel} auction for **${auction.winningBid} ${dkpLabel}**!`,
        components: [row],
      });
      dmSent = true;
    } catch {
      // DMs disabled — fall through to channel post
    }
    if (!dmSent) {
      try {
        await channel.send({
          content: `🏆 <@${auction.winnerId}> won **${auction.title}** for **${auction.winningBid} ${dkpLabel}**!`,
          components: [row],
        });
      } catch (err) {
        console.error(`[bot] Failed to post winner announcement for auction ${auction.id}:`, err);
      }
    }
  }
}

// ── Scheduler helper: close expired auctions ──────────────────────────────────
// Called by the bot's 1-minute cron job as a backstop if the lazy API close
// hasn't fired yet (e.g. no one polled the auction endpoint in time).

export async function closeExpiredAuctions(): Promise<void> {
  const expired = await prisma.lootAuction.findMany({
    where: { status: 'OPEN', closesAt: { lte: new Date() } },
    include: { bids: { orderBy: { amount: 'desc' } } },
  });

  for (const auction of expired) {
    try {
      const top = auction.bids[0] ?? null;
      const closed = await prisma.$transaction(async (tx) => {
        // Claim the auction atomically — only proceeds if it is still OPEN.
        const { count } = await tx.lootAuction.updateMany({
          where: { id: auction.id, status: 'OPEN' },
          data: {
            status: 'CLOSED',
            ...(top ? { winnerId: top.userId, winnerUsername: top.username, winningBid: top.amount } : {}),
          },
        });
        if (count === 0) return false; // already closed by the API lazy-close path

        if (top) {
          await tx.lootAssignment.deleteMany({ where: { itemId: auction.itemId } });
          await tx.lootAssignment.create({
            data: { itemId: auction.itemId, userId: top.userId, username: top.username, dkpSpent: top.amount },
          });
        }
        return true;
      });

      if (closed) {
        await postOrUpdateAuctionMessage(auction.id);
        // Update the post-event embed so the loot assignment shows immediately
        const session = await prisma.lootSession.findUnique({
          where: { id: auction.sessionId },
          select: { eventId: true },
        });
        if (session?.eventId) await updatePostEventEmbed(session.eventId).catch(() => null);
      }
    } catch (err) {
      console.error(`[bot] closeExpiredAuctions failed for auction ${auction.id}:`, err);
    }
  }
}

// ── Scheduler helper: close expired standalone auctions ───────────────────────
// Same backstop pattern as closeExpiredAuctions but for the Auction model.

export async function closeExpiredStandaloneAuctions(): Promise<void> {
  const expired = await prisma.auction.findMany({
    where: { status: 'OPEN', closesAt: { lte: new Date() } },
    include: { bids: { orderBy: { amount: 'desc' } } },
  });

  for (const auction of expired) {
    try {
      const top = auction.bids[0] ?? null;

      // Atomic claim — only proceeds if still OPEN
      const { count } = await prisma.auction.updateMany({
        where: { id: auction.id, status: 'OPEN' },
        data: {
          status: 'CLOSED',
          ...(top ? { winnerId: top.userId, winnerUsername: top.username, winningBid: top.amount } : {}),
        },
      });
      if (count === 0) continue; // already closed by a concurrent path

      if (top) {
        await applyDkpForStandaloneAuction(
          auction.guildId,
          top.userId,
          top.username,
          top.amount,
          auction.title,
        );
      }

      await postOrUpdateStandaloneAuctionMessage(auction.id);
    } catch (err) {
      console.error(`[bot] closeExpiredStandaloneAuctions failed for auction ${auction.id}:`, err);
    }
  }
}
