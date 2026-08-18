import {
  AttachmentBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ChannelType,
  ForumChannel,
} from 'discord.js';
import { client } from '../client.js';
import { prisma } from '../db.js';
import { buildBracketSvg, svgToPng } from '../lib/bracketSvg.js';
import { buildMatchCardPng, buildResultCardPng } from '../lib/matchCardSvg.js';
import type { BracketMatchInfo, BracketParticipantInfo } from '../lib/bracketSvg.js';
import type { MatchCardParticipant } from '../lib/matchCardSvg.js';

// ── Tournament start (called after bracket is generated) ──────────────────────

export async function setupDiscordForTournament(tournamentId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      participants: { include: { teamMembers: true } },
      matches: true,
    },
  });
  if (!tournament) return;

  // Get settings for the guild
  const settings = await prisma.guildSettings.findUnique({ where: { guildId: tournament.guildId } });
  const channelId = tournament.channelId ?? settings?.forumChannelId ?? null;
  if (!channelId) {
    console.warn(`[tournamentService] No channelId for tournament ${tournamentId} — skipping Discord setup`);
    return;
  }

  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || ch.type !== ChannelType.GuildForum) {
    console.warn(`[tournamentService] Channel ${channelId} is not a forum — skipping`);
    return;
  }

  // Generate bracket image
  const bracketBuffer = buildBracketPng(tournament.matches as BracketMatchInfo[], tournament.participants as BracketParticipantInfo[], tournament.name);
  const bracketFile = new AttachmentBuilder(bracketBuffer, { name: 'bracket.png' });

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${tournament.name}`)
    .setDescription(
      tournament.description
        ? `${tournament.description}\n\n**Format:** ${tournament.format.replace('_', ' ')}\n**Participants:** ${tournament.participants.length}`
        : `**Format:** ${tournament.format.replace('_', ' ')}\n**Participants:** ${tournament.participants.length}`,
    )
    .setImage('attachment://bracket.png')
    .setColor(0x5865f2);

  const thread = await (ch as ForumChannel).threads.create({
    name: tournament.name,
    message: { embeds: [embed], files: [bracketFile] },
  });

  // Persist thread and bracket message IDs
  const starterMsg = await thread.fetchStarterMessage().catch(() => null);
  await prisma.tournament.update({
    where: { id: tournamentId },
    data: {
      threadId: thread.id,
      bracketMessageId: starterMsg?.id ?? null,
    },
  });

  // Post round 1 match cards
  const round1 = (tournament.matches as BracketMatchInfo[]).filter(
    (m) => m.round === 1 && m.status !== 'BYE',
  );
  for (const match of round1) {
    await postMatchAnnouncement(match.id, thread.id).catch((err) =>
      console.error(`[tournamentService] postMatchAnnouncement failed for match ${match.id}:`, err),
    );
    await new Promise<void>((r) => setTimeout(r, 500)); // rate-limit buffer
  }

  // DM all participants
  await dmParticipants(
    tournament.participants as Array<{ discordId: string | null; displayName: string }>,
    `🏆 **${tournament.name}** has started! Check the tournament thread for bracket details and your first match.`,
  );
}

// ── Post match announcement ───────────────────────────────────────────────────

export async function postMatchAnnouncement(matchId: string, threadIdOverride?: string): Promise<void> {
  const match = await prisma.tournamentMatch.findUnique({
    where: { id: matchId },
    include: {
      tournament: true,
      participantA: true,
      participantB: true,
    },
  });
  if (!match || !match.participantA || !match.participantB) return;

  const threadId = threadIdOverride ?? match.tournament.threadId;
  if (!threadId) return;

  const thread = await client.channels.fetch(threadId).catch(() => null);
  if (!thread?.isThread()) return;

  const pA = await resolveMatchCardParticipant(match.participantA, match.tournament.guildId);
  const pB = await resolveMatchCardParticipant(match.participantB, match.tournament.guildId);

  const cardBuffer = await buildMatchCardPng({
    tournamentName: match.tournament.name,
    round: match.round,
    position: match.position,
    scheduledAt: match.scheduledAt,
    participantA: pA,
    participantB: pB,
  });

  const attachment = new AttachmentBuilder(cardBuffer, { name: 'match-card.png' });
  const embed = new EmbedBuilder()
    .setTitle(`⚔️ Round ${match.round} — Match ${match.position + 1}`)
    .setDescription(`**${match.participantA.displayName}** vs **${match.participantB.displayName}**`)
    .setImage('attachment://match-card.png')
    .setColor(0x5865f2);

  const readyRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bracket_ready:${matchId}:A`)
      .setLabel(`✅ ${match.participantA.displayName.slice(0, 20)} — Ready`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`bracket_ready:${matchId}:B`)
      .setLabel(`✅ ${match.participantB.displayName.slice(0, 20)} — Ready`)
      .setStyle(ButtonStyle.Success),
  );

  await thread.send({ embeds: [embed], files: [attachment], components: [readyRow] });
}

// ── Post match result ─────────────────────────────────────────────────────────

export async function postMatchResult(matchId: string): Promise<void> {
  const match = await prisma.tournamentMatch.findUnique({
    where: { id: matchId },
    include: {
      tournament: { include: { matches: true, participants: true } },
      participantA: true,
      participantB: true,
      winner: true,
    },
  });
  if (!match?.tournament.threadId) return;

  const thread = await client.channels.fetch(match.tournament.threadId).catch(() => null);
  if (!thread?.isThread()) return;

  const winner = match.winner;
  const loser = match.winner?.id === match.participantAId ? match.participantB : match.participantA;

  // Get ELO deltas from the history rows just created
  const historyRows = await prisma.tournamentRatingHistory.findMany({
    where: { matchId },
    orderBy: { createdAt: 'desc' },
    take: 2,
  });
  const winnerHistory = historyRows.find((h) => h.won);
  const loserHistory = historyRows.find((h) => !h.won);

  const winnerCard = winner
    ? await resolveMatchCardParticipant(winner, match.tournament.guildId)
    : null;
  const loserCard = loser
    ? await resolveMatchCardParticipant(loser, match.tournament.guildId)
    : null;

  if (winnerCard && winner) {
    const resultBuffer = await buildResultCardPng({
      tournamentName: match.tournament.name,
      round: match.round,
      position: match.position,
      winner: winnerCard,
      loser: loserCard,
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      eloChangeWinner: winnerHistory?.delta ?? 0,
      eloChangeLoser: loserHistory?.delta ?? 0,
    });

    const resultAttachment = new AttachmentBuilder(resultBuffer, { name: 'result.png' });
    const deltaStr = (d: number) => (d >= 0 ? `+${d} 🔺` : `${d} 🔻`);

    const resultEmbed = new EmbedBuilder()
      .setTitle(`✅ Round ${match.round} — Match ${match.position + 1} Result`)
      .setDescription(
        [
          `**${winner.displayName}** wins!`,
          winnerHistory ? `${deltaStr(winnerHistory.delta)} ELO` : '',
          match.scoreA != null ? `Score: ${match.scoreA} – ${match.scoreB}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .setImage('attachment://result.png')
      .setColor(0x57f287);

    await thread.send({ embeds: [resultEmbed], files: [resultAttachment] });
  }

  // Regenerate + update pinned bracket image
  await refreshBracketImage(match.tournament.id).catch((err) =>
    console.error(`[tournamentService] refreshBracketImage failed:`, err),
  );

  // Check if next match now has both participants — post its announcement
  if (match.nextMatchId) {
    const nextMatch = await prisma.tournamentMatch.findUnique({
      where: { id: match.nextMatchId },
      include: { participantA: true, participantB: true },
    });
    if (nextMatch?.participantA && nextMatch.participantB && nextMatch.status !== 'COMPLETED') {
      await postMatchAnnouncement(match.nextMatchId).catch((err) =>
        console.error(`[tournamentService] postMatchAnnouncement for next match failed:`, err),
      );
    }
  }

  // DM the winner
  if (winner?.discordId) {
    const discordUser = await client.users.fetch(winner.discordId).catch(() => null);
    if (discordUser) {
      const nextMatch = match.nextMatchId
        ? await prisma.tournamentMatch.findUnique({ where: { id: match.nextMatchId } })
        : null;
      const nextInfo = nextMatch ? `Your next match is in Round ${nextMatch.round}.` : '🏆 You are the champion!';
      await discordUser.send(`✅ You won your Round ${match.round} match in **${match.tournament.name}**! ${nextInfo}`).catch(() => null);
    }
  }

  // DM the loser
  if (loser?.discordId) {
    const discordUser = await client.users.fetch(loser.discordId).catch(() => null);
    if (discordUser) {
      await discordUser.send(`The match results for **${match.tournament.name}** (Round ${match.round}) have been posted. Better luck next time!`).catch(() => null);
    }
  }

  // If tournament completed, post winner announcement
  if (match.tournament.status === 'COMPLETED' || (await prisma.tournament.findUnique({ where: { id: match.tournament.id }, select: { status: true } }))?.status === 'COMPLETED') {
    await postTournamentComplete(match.tournament.id).catch((err) =>
      console.error(`[tournamentService] postTournamentComplete failed:`, err),
    );
  }
}

// ── Tournament open (registration opening announcement) ───────────────────────

export async function postTournamentOpen(tournamentId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament?.channelId) return;

  const settings = await prisma.guildSettings.findUnique({ where: { guildId: tournament.guildId } });
  const channelId = tournament.channelId ?? settings?.forumChannelId;
  if (!channelId) return;

  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || ch.type !== ChannelType.GuildForum) return;

  const regDeadline = tournament.registrationEndsAt
    ? `\nRegistration closes: <t:${Math.floor(tournament.registrationEndsAt.getTime() / 1000)}:F>`
    : '';

  const embed = new EmbedBuilder()
    .setTitle(`📋 ${tournament.name} — Registration Open!`)
    .setDescription(
      [
        tournament.description ?? '',
        `**Format:** ${tournament.format.replace('_', ' ')}`,
        `**Bracket Size:** ${tournament.size} participants`,
        `**Seeding:** ${tournament.seedingMode}`,
        regDeadline,
        '\nRegister via the dashboard or use the button below.',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setColor(0x5865f2);

  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';
  const joinRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bracket_register:${tournamentId}`)
      .setLabel('Join Tournament')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setLabel('Open Dashboard')
      .setStyle(ButtonStyle.Link)
      .setURL(`${webUrl}/dashboard/servers/${tournament.guildId}/tournaments`),
  );

  await (ch as ForumChannel).threads.create({
    name: `${tournament.name} — Registration`,
    message: { embeds: [embed], components: [joinRow] },
  }).catch((err) => console.error(`[tournamentService] failed to create registration thread:`, err));
}

// ── Tournament complete announcement ──────────────────────────────────────────

export async function postTournamentComplete(tournamentId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      participants: { where: { placement: { lte: 3 } }, orderBy: { placement: 'asc' } },
    },
  });
  if (!tournament?.threadId) return;

  const thread = await client.channels.fetch(tournament.threadId).catch(() => null);
  if (!thread?.isThread()) return;

  const top3 = tournament.participants.slice(0, 3);
  const medals = ['🥇', '🥈', '🥉'];
  const podium = top3.map((p, i) => `${medals[i]} <@${p.discordId ?? p.displayName}> — ${p.displayName}`).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${tournament.name} — Tournament Complete!`)
    .setDescription(podium || 'Results finalized.')
    .setColor(0xffd700);

  await thread.send({ embeds: [embed] });
}

// ── Refresh pinned bracket image ──────────────────────────────────────────────

export async function refreshBracketImage(tournamentId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { matches: true, participants: true },
  });
  if (!tournament?.threadId || !tournament.bracketMessageId) return;

  const thread = await client.channels.fetch(tournament.threadId).catch(() => null);
  if (!thread?.isThread()) return;

  const msg = await thread.messages.fetch(tournament.bracketMessageId).catch(() => null);
  if (!msg) return;

  const bracketBuffer = buildBracketPng(
    tournament.matches as BracketMatchInfo[],
    tournament.participants as BracketParticipantInfo[],
    tournament.name,
  );
  const attachment = new AttachmentBuilder(bracketBuffer, { name: 'bracket.png' });

  await msg.edit({ files: [attachment] }).catch((err) =>
    console.error(`[tournamentService] Failed to edit bracket message:`, err),
  );
}

// ── Reminder dispatch (called from scheduler) ─────────────────────────────────

export async function dispatchTournamentReminder(reminderId: string): Promise<void> {
  const reminder = await prisma.tournamentReminder.findUnique({
    where: { id: reminderId },
    include: { tournament: true },
  });
  if (!reminder || reminder.sentAt) return;

  const tournament = reminder.tournament;

  if (reminder.type === 'MATCH_START' && reminder.matchId) {
    const match = await prisma.tournamentMatch.findUnique({
      where: { id: reminder.matchId },
      include: { participantA: true, participantB: true },
    });
    if (match && tournament.threadId) {
      const thread = await client.channels.fetch(tournament.threadId).catch(() => null);
      if (thread?.isThread()) {
        const ts = match.scheduledAt ? `<t:${Math.floor(match.scheduledAt.getTime() / 1000)}:R>` : 'soon';
        await thread.send(
          `⏰ Heads up — Round ${match.round} Match ${match.position + 1} (${match.participantA?.displayName ?? '?'} vs ${match.participantB?.displayName ?? '?'}) starts ${ts}!`,
        ).catch(() => null);
      }

      // DM both participants
      for (const p of [match.participantA, match.participantB]) {
        if (!p?.discordId) continue;
        const user = await client.users.fetch(p.discordId).catch(() => null);
        const ts = match.scheduledAt ? `<t:${Math.floor(match.scheduledAt.getTime() / 1000)}:F>` : 'soon';
        await user?.send(`⏰ Your match in **${tournament.name}** (Round ${match.round}) starts ${ts}!`).catch(() => null);
      }
    }
  }

  if (reminder.type === 'CHECK_IN' && reminder.matchId) {
    const match = await prisma.tournamentMatch.findUnique({
      where: { id: reminder.matchId },
      include: { participantA: true, participantB: true },
    });
    if (match && tournament.threadId) {
      const thread = await client.channels.fetch(tournament.threadId).catch(() => null);
      if (thread?.isThread()) {
        const checkInRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`bracket_checkin:${match.id}:A`)
            .setLabel(`🏁 ${match.participantA?.displayName.slice(0, 20) ?? '?'} — Check In`)
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`bracket_checkin:${match.id}:B`)
            .setLabel(`🏁 ${match.participantB?.displayName.slice(0, 20) ?? '?'} — Check In`)
            .setStyle(ButtonStyle.Primary),
        );
        await thread.send({
          content: `🏁 **Check-in time!** Round ${match.round} Match ${match.position + 1} starts in 15 minutes. Please check in below.`,
          components: [checkInRow],
        }).catch(() => null);
      }
    }
  }

  if (reminder.type === 'REGISTRATION_CLOSE' && tournament.threadId) {
    const thread = await client.channels.fetch(tournament.threadId).catch(() => null);
    if (thread?.isThread()) {
      const participantCount = await prisma.tournamentParticipant.count({ where: { tournamentId: tournament.id } });
      await thread.send(
        `📢 Registration for **${tournament.name}** closes in 1 hour! Currently ${participantCount}/${tournament.size} spots filled.`,
      ).catch(() => null);
    }
  }

  await prisma.tournamentReminder.update({ where: { id: reminderId }, data: { sentAt: new Date() } });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildBracketPng(
  matches: BracketMatchInfo[],
  participants: BracketParticipantInfo[],
  name: string,
): Buffer {
  return svgToPng(buildBracketSvg(name, matches, participants));
}

async function resolveMatchCardParticipant(
  participant: { id: string; discordId: string | null; displayName: string; seed: number | null },
  guildId: string,
): Promise<MatchCardParticipant> {
  let avatarHash: string | null = null;

  if (participant.discordId) {
    const discordUser = await client.users.fetch(participant.discordId).catch(() => null);
    avatarHash = discordUser?.avatar ?? null;
  }

  const rating = participant.discordId
    ? await prisma.tournamentPlayerRating.findUnique({
        where: { guildId_discordId: { guildId, discordId: participant.discordId! } },
        select: { rating: true, matchesPlayed: true },
      })
    : null;

  return {
    discordId: participant.discordId,
    avatarHash,
    displayName: participant.displayName,
    seed: participant.seed,
    rating: rating?.rating ?? 1200,
    matchesPlayed: rating?.matchesPlayed ?? 0,
  };
}

async function dmParticipants(
  participants: Array<{ discordId: string | null; displayName: string }>,
  message: string,
): Promise<void> {
  const DM_CHUNK = 5;
  const eligible = participants.filter((p) => p.discordId);

  for (let i = 0; i < eligible.length; i += DM_CHUNK) {
    if (i > 0) await new Promise<void>((r) => setTimeout(r, 1_000));
    await Promise.allSettled(
      eligible.slice(i, i + DM_CHUNK).map(async (p) => {
        const user = await client.users.fetch(p.discordId!).catch(() => null);
        await user?.send(message).catch(() => null);
      }),
    );
  }
}
