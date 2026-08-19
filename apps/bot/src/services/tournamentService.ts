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

  // GuildSettings.guildId is a FK to Guild.id (CUID), so we must traverse via
  // Guild.guildId (Discord snowflake) → include: settings.
  const guildRecord = await prisma.guild
    .findUnique({ where: { guildId: tournament.guildId }, include: { settings: true } })
    .catch(() => null);
  const channelId = tournament.channelId
    ?? guildRecord?.settings?.tournamentChannelId
    ?? guildRecord?.settings?.forumChannelId
    ?? null;

  // Announce registration closed in the existing thread before posting the bracket
  if (tournament.threadId) {
    const existing = await client.channels.fetch(tournament.threadId).catch(() => null);
    if (existing?.isThread()) {
      const participantCount = tournament.participants.length;
      await existing.send(
        `🔒 **Registration is now closed!** ${participantCount} participant${participantCount === 1 ? '' : 's'} locked in — generating bracket…`,
      ).catch((err) => console.error(`[tournamentService] Failed to post registration-closed message:`, err));
    }
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

  let threadId: string | null = tournament.threadId;
  let bracketMessageId: string | null = null;

  if (tournament.threadId) {
    // Reuse the registration thread: rename it and post the bracket there
    const existing = await client.channels.fetch(tournament.threadId).catch(() => null);
    if (existing?.isThread()) {
      await existing.setName(tournament.name).catch((err) =>
        console.error(`[tournamentService] Failed to rename thread:`, err),
      );
      const msg = await existing.send({ embeds: [embed], files: [bracketFile] });
      bracketMessageId = msg.id;
    } else {
      threadId = null; // thread was deleted — fall through to create a new one
    }
  }

  if (!threadId) {
    if (!channelId) {
      console.error(`[tournamentService] setupDiscordForTournament: no forum channel configured for guild ${tournament.guildId}`);
      return;
    }
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch) {
      console.error(`[tournamentService] setupDiscordForTournament: channel ${channelId} not found`);
      return;
    }
    if (ch.type !== ChannelType.GuildForum) {
      console.error(`[tournamentService] setupDiscordForTournament: channel ${channelId} is type ${ch.type}, expected GuildForum (15)`);
      return;
    }
    const created = await (ch as ForumChannel).threads.create({
      name: tournament.name,
      message: { embeds: [embed], files: [bracketFile] },
    });
    threadId = created.id;
    const starterMsg = await created.fetchStarterMessage().catch(() => null);
    bracketMessageId = starterMsg?.id ?? null;
  }

  // Persist thread and bracket message IDs
  await prisma.tournament.update({
    where: { id: tournamentId },
    data: { threadId, bracketMessageId },
  });

  // Post round 1 match cards
  const round1 = (tournament.matches as BracketMatchInfo[]).filter(
    (m) => m.round === 1 && m.status !== 'BYE',
  );
  for (const match of round1) {
    await postMatchAnnouncement(match.id, threadId!).catch((err) =>
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
  const matchTitle = match.bracketSide === 'THIRD_PLACE'
    ? '🥉 3rd Place Match'
    : `⚔️ Round ${match.round} — Match ${match.position + 1}`;
  const embed = new EmbedBuilder()
    .setTitle(matchTitle)
    .setDescription(`**${match.participantA.displayName}** vs **${match.participantB.displayName}**`)
    .setImage('attachment://match-card.png')
    .setColor(match.bracketSide === 'THIRD_PLACE' ? 0xcd7f32 : 0x5865f2); // bronze for 3rd place

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

  const msg = await thread.send({ embeds: [embed], files: [attachment], components: [readyRow] });

  // Persist the message ID so postMatchScheduled can edit this card later
  await prisma.tournamentMatch.update({
    where: { id: matchId },
    data: { announcementMessageId: msg.id },
  }).catch((err) => console.error(`[tournamentService] postMatchAnnouncement: failed to save announcementMessageId:`, err));
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
    // Determine which raw score belongs to which player
    const winnerIsA = match.winnerId === match.participantAId;
    const winnerScore = winnerIsA ? match.scoreA : match.scoreB;
    const loserScore  = winnerIsA ? match.scoreB : match.scoreA;

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

    const descLines: string[] = [`**${winner.displayName}** wins!`];
    if (winnerHistory) descLines.push(`${winner.displayName}: ${deltaStr(winnerHistory.delta)} ELO`);
    if (loser && loserHistory) descLines.push(`${loser.displayName}: ${deltaStr(loserHistory.delta)} ELO`);
    if (winnerScore != null) descLines.push(`Score: ${winnerScore} – ${loserScore}`);

    const resultTitle = match.bracketSide === 'THIRD_PLACE'
      ? '🥉 3rd Place Result'
      : `✅ Round ${match.round} — Match ${match.position + 1} Result`;
    const resultEmbed = new EmbedBuilder()
      .setTitle(resultTitle)
      .setDescription(descLines.join('\n'))
      .setImage('attachment://result.png')
      .setColor(0x57f287);

    await thread.send({ embeds: [resultEmbed], files: [resultAttachment] });
  }

  // Regenerate + update pinned bracket image
  await refreshBracketImage(match.tournament.id).catch((err) =>
    console.error(`[tournamentService] refreshBracketImage failed:`, err),
  );

  // Check if next winners match now has both participants — post its announcement
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

  // Check if the 3rd-place match now has both participants — post its announcement
  if (match.nextLoserMatchId) {
    const tpMatch = await prisma.tournamentMatch.findUnique({
      where: { id: match.nextLoserMatchId },
      include: { participantA: true, participantB: true },
    });
    if (tpMatch?.participantA && tpMatch.participantB && tpMatch.status !== 'COMPLETED') {
      await postMatchAnnouncement(match.nextLoserMatchId).catch((err) =>
        console.error(`[tournamentService] postMatchAnnouncement for 3rd place match failed:`, err),
      );
    }
  }

  // Check if this was the last non-BYE match in its round — announce round complete
  const roundMatches = match.tournament.matches.filter(
    (m) => m.round === match.round && m.status !== 'BYE',
  );
  const allDone = roundMatches.every((m) => m.id === matchId || m.status === 'COMPLETED');
  if (allDone && roundMatches.length > 0) {
    const maxRound = Math.max(...match.tournament.matches.map((m) => m.round));
    const isFinalRound = match.round === maxRound;
    if (!isFinalRound) {
      await thread.send(
        `🏁 **Round ${match.round} complete!** Advancing to Round ${match.round + 1}…`,
      ).catch(() => null);
    }
  }

  const isThirdPlaceMatch = match.bracketSide === 'THIRD_PLACE';
  const isGrandFinal = !match.nextMatchId && match.bracketSide === 'WINNERS';

  // DM the winner
  if (winner?.discordId) {
    const discordUser = await client.users.fetch(winner.discordId).catch(() => null);
    if (discordUser) {
      let nextInfo: string;
      if (isThirdPlaceMatch) {
        nextInfo = '🥉 You finished 3rd place!';
      } else if (isGrandFinal) {
        nextInfo = '🏆 You are the champion!';
      } else {
        const nextMatch = match.nextMatchId
          ? await prisma.tournamentMatch.findUnique({ where: { id: match.nextMatchId } })
          : null;
        nextInfo = nextMatch ? `Your next match is in Round ${nextMatch.round}.` : '🏆 You are the champion!';
      }
      await discordUser.send(`✅ You won your Round ${match.round} match in **${match.tournament.name}**! ${nextInfo}`).catch(() => null);
    }
  }

  // DM the loser
  if (loser?.discordId) {
    const discordUser = await client.users.fetch(loser.discordId).catch(() => null);
    if (discordUser) {
      const loserMsg = match.nextLoserMatchId
        ? `You've been eliminated from the main bracket in **${match.tournament.name}**, but you're competing for 3rd place! Check the tournament thread.`
        : `The match results for **${match.tournament.name}** have been posted. Better luck next time!`;
      await discordUser.send(loserMsg).catch(() => null);
    }
  }

  // Tournament-complete announcement is handled by the API firing
  // /trigger/tournament-complete separately — do not call it here to
  // avoid posting the champion embed twice.
}

// ── Shared embed/button helpers ───────────────────────────────────────────────

type TournamentMeta = {
  id: string;
  guildId: string;
  name: string;
  description: string | null;
  format: string;
  size: number;
  seedingMode: string;
  registrationEndsAt: Date | null;
  dkpPrize1st: number;
  dkpPrize2nd: number;
  dkpPrize3rd: number;
};

function buildTournamentDescription(t: TournamentMeta): string {
  const lines: string[] = [];
  if (t.description) { lines.push(t.description, ''); }
  lines.push(`**Format:** ${t.format.replace('_', ' ')}`);
  lines.push(`**Bracket Size:** ${t.size} participants`);
  lines.push(`**Seeding:** ${t.seedingMode}`);
  if (t.registrationEndsAt) {
    lines.push(`**Registration Closes:** <t:${Math.floor(t.registrationEndsAt.getTime() / 1000)}:F>`);
  }
  return lines.join('\n');
}

function buildRegistrationEmbed(
  t: TournamentMeta,
  participants: Array<{ discordId: string | null; displayName: string }>,
): EmbedBuilder {
  const filled = participants.length;
  const isFull = filled >= t.size;

  const rosterLines = participants.length > 0
    ? participants.map((p, i) => `${i + 1}. ${p.discordId ? `<@${p.discordId}>` : p.displayName}`)
    : ['*No participants yet — be the first to sign up!*'];

  // Embed field values are capped at 1024 chars; join the list and truncate safely
  let rosterValue = rosterLines.join('\n');
  if (rosterValue.length > 1024) {
    rosterValue = rosterValue.slice(0, 1020) + '\n…';
  }

  const embed = new EmbedBuilder()
    .setTitle(`📋 ${t.name} — Registration ${isFull ? 'Full' : 'Open'}`)
    .setDescription(buildTournamentDescription(t))
    .setColor(isFull ? 0xed4245 : 0x57f287)
    .addFields({ name: `Participants (${filled} / ${t.size})`, value: rosterValue });

  const prizes: string[] = [];
  if (t.dkpPrize1st > 0) prizes.push(`🥇 1st — ${t.dkpPrize1st} DKP`);
  if (t.dkpPrize2nd > 0) prizes.push(`🥈 2nd — ${t.dkpPrize2nd} DKP`);
  if (t.dkpPrize3rd > 0) prizes.push(`🥉 3rd — ${t.dkpPrize3rd} DKP`);
  if (prizes.length > 0) {
    embed.addFields({ name: 'Prizes', value: prizes.join('\n'), inline: true });
  }

  return embed;
}

function buildJoinRow(tournamentId: string, guildId: string, disabled = false) {
  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bracket_register:${tournamentId}`)
      .setLabel('Join Tournament')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setLabel('Open Dashboard')
      .setStyle(ButtonStyle.Link)
      .setURL(`${webUrl}/dashboard/servers/${guildId}/tournaments`),
  );
}

// ── Resolve the forum channel for a guild ─────────────────────────────────────

// GuildSettings.guildId is a FK to Guild.id (CUID), not the Discord snowflake.
// To get settings, look up Guild by its Discord snowflake and follow the relation —
// the same pattern used by resolveForumChannelId in eventService.ts.
async function resolveTournamentChannel(discordGuildId: string, channelIdOverride: string | null): Promise<ForumChannel | null> {
  // Per-tournament channel override takes priority
  if (channelIdOverride) {
    const ch = await client.channels.fetch(channelIdOverride).catch(() => null);
    if (ch?.type === ChannelType.GuildForum) return ch as ForumChannel;
  }

  const guildRecord = await prisma.guild
    .findUnique({ where: { guildId: discordGuildId }, include: { settings: true } })
    .catch(() => null);

  const channelId = guildRecord?.settings?.tournamentChannelId
    ?? guildRecord?.settings?.forumChannelId
    ?? null;

  if (!channelId) return null;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || ch.type !== ChannelType.GuildForum) return null;
  return ch as ForumChannel;
}

// ── Create draft forum thread when tournament is first created ────────────────

export async function setupDraftThread(tournamentId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) return;
  if (tournament.threadId) return; // thread already exists

  const forumCh = await resolveTournamentChannel(tournament.guildId, tournament.channelId);
  if (!forumCh) {
    console.error(`[tournamentService] setupDraftThread: no forum channel configured for guild ${tournament.guildId} — set one in Module Settings › Tournaments`);
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${tournament.name}`)
    .setDescription(buildTournamentDescription(tournament))
    .setColor(0x5865f2)
    .setFooter({ text: 'Status: Draft — Registration not yet open' });

  const thread = await forumCh.threads.create({
    name: tournament.name,
    message: { embeds: [embed] },
  }).catch((err) => {
    console.error(`[tournamentService] setupDraftThread: failed to create thread:`, err);
    return null;
  });
  if (!thread) return;

  await prisma.tournament.update({
    where: { id: tournamentId },
    data: { threadId: thread.id },
  });

  console.log(`[tournamentService] setupDraftThread: created thread ${thread.id} for tournament ${tournamentId}`);
}

// ── Post the live registration roster embed when registration opens ────────────

export async function postTournamentOpen(tournamentId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { participants: true },
  });
  if (!tournament) return;

  let threadId = tournament.threadId;

  // If setupDraftThread didn't run yet (no channel configured at creation time),
  // fall back to creating the thread now.
  if (!threadId) {
    const forumCh = await resolveTournamentChannel(tournament.guildId, tournament.channelId);
    if (!forumCh) {
      console.error(`[tournamentService] postTournamentOpen: no forum channel configured for guild ${tournament.guildId}`);
      return;
    }
    const embed = buildRegistrationEmbed(tournament, tournament.participants);
    const joinRow = buildJoinRow(tournamentId, tournament.guildId);
    const thread = await forumCh.threads.create({
      name: `${tournament.name} — Registration`,
      message: { embeds: [embed], components: [joinRow] },
    }).catch((err) => {
      console.error(`[tournamentService] postTournamentOpen: failed to create fallback thread:`, err);
      return null;
    });
    if (!thread) return;
    const starter = await thread.fetchStarterMessage().catch(() => null);
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { threadId: thread.id, registrationMessageId: starter?.id ?? null },
    });
    threadId = thread.id;

    // Add pre-registered participants to the thread
    for (const p of tournament.participants) {
      if (p.discordId) await thread.members.add(p.discordId).catch(() => null);
    }
    return;
  }

  // Thread exists (normal path) — rename it and post the registration roster embed.
  const thread = await client.channels.fetch(threadId).catch(() => null);
  if (!thread?.isThread()) {
    console.error(`[tournamentService] postTournamentOpen: thread ${threadId} not found or not a thread`);
    return;
  }

  // Unarchive if Discord auto-archived the draft thread
  if (thread.archived) await thread.setArchived(false).catch(() => null);
  await thread.setName(`${tournament.name} — Registration`).catch((err) =>
    console.error(`[tournamentService] postTournamentOpen: failed to rename thread:`, err),
  );

  const embed = buildRegistrationEmbed(tournament, tournament.participants);
  const joinRow = buildJoinRow(tournamentId, tournament.guildId);
  const msg = await thread.send({ embeds: [embed], components: [joinRow] });

  await prisma.tournament.update({
    where: { id: tournamentId },
    data: { registrationMessageId: msg.id },
  });

  // Add any pre-registered participants to the thread
  for (const p of tournament.participants) {
    if (p.discordId) await thread.members.add(p.discordId).catch(() => null);
  }
}

// ── Update the live registration embed as participants join / leave ────────────

export async function updateRegistrationEmbed(tournamentId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { participants: true },
  });
  if (!tournament?.threadId || !tournament.registrationMessageId) return;
  if (tournament.status !== 'REGISTRATION') return;

  const thread = await client.channels.fetch(tournament.threadId).catch(() => null);
  if (!thread?.isThread()) return;

  const msg = await thread.messages.fetch(tournament.registrationMessageId).catch(() => null);
  if (!msg) return;

  const isFull = tournament.participants.length >= tournament.size;
  const embed = buildRegistrationEmbed(tournament, tournament.participants);
  const joinRow = buildJoinRow(tournamentId, tournament.guildId, isFull);

  await msg.edit({ embeds: [embed], components: [joinRow] }).catch((err) =>
    console.error(`[tournamentService] updateRegistrationEmbed: failed to edit message:`, err),
  );
}

// ── Match schedule notification ───────────────────────────────────────────────

export async function postMatchScheduled(matchId: string): Promise<void> {
  const match = await prisma.tournamentMatch.findUnique({
    where: { id: matchId },
    include: { tournament: true, participantA: true, participantB: true },
  });
  if (!match?.scheduledAt || !match.tournament.threadId) return;
  if (!match.participantA || !match.participantB) return;

  const thread = await client.channels.fetch(match.tournament.threadId).catch(() => null);
  if (!thread?.isThread()) return;

  const ts = Math.floor(match.scheduledAt.getTime() / 1000);

  // Re-generate the match card PNG with the new scheduledAt displayed
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

  const updatedEmbed = new EmbedBuilder()
    .setTitle(`⚔️ Round ${match.round} — Match ${match.position + 1}`)
    .setDescription(
      `**${match.participantA.displayName}** vs **${match.participantB.displayName}**\n` +
      `📅 <t:${ts}:F>`,
    )
    .setImage('attachment://match-card.png')
    .setColor(0x5865f2);

  if (match.announcementMessageId) {
    // Edit the original match-card message in place
    const existing = await thread.messages.fetch(match.announcementMessageId).catch(() => null);
    if (existing) {
      await existing.edit({
        embeds: [updatedEmbed],
        files: [attachment],
        attachments: [],   // clear old image; new file replaces it
      }).catch((err) => console.error(`[tournamentService] postMatchScheduled: failed to edit message:`, err));
    } else {
      // Message was deleted — fall through to posting fresh
      await thread.send({ embeds: [updatedEmbed], files: [attachment] }).catch(() => null);
    }
  } else {
    // No announcement yet (match announced before migration) — post fresh card
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
    const msg = await thread.send({ embeds: [updatedEmbed], files: [attachment], components: [readyRow] })
      .catch(() => null);
    if (msg) {
      await prisma.tournamentMatch.update({
        where: { id: matchId },
        data: { announcementMessageId: msg.id },
      }).catch(() => null);
    }
  }

  // Refresh the pinned bracket image — scheduled matches render with blurple border
  await refreshBracketImage(match.tournament.id).catch((err) =>
    console.error(`[tournamentService] postMatchScheduled: refreshBracketImage failed:`, err),
  );
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
  // Use a real mention only when we have a discordId; otherwise fall back to bold displayName
  // so we never render a broken `<@Alice>` mention for display-name-only participants.
  const podium = top3.map((p, i) => {
    const nameTag = p.discordId ? `<@${p.discordId}>` : `**${p.displayName}**`;
    return `${medals[i]} ${nameTag} — ${p.displayName}`;
  }).join('\n');

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

  await msg.edit({ files: [attachment], attachments: [] }).catch((err) =>
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

// ── Add a participant to the tournament thread and refresh the embed ──────────

export async function addParticipantToThread(tournamentId: string, discordId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { threadId: true },
  });
  if (!tournament?.threadId) return;

  const thread = await client.channels.fetch(tournament.threadId).catch(() => null);
  if (!thread?.isThread()) return;

  await thread.members.add(discordId).catch((err) =>
    console.error(`[tournamentService] Failed to add ${discordId} to thread ${tournament.threadId}:`, err),
  );

  // Update the live registration roster embed so the new participant appears immediately
  await updateRegistrationEmbed(tournamentId).catch((err) =>
    console.error(`[tournamentService] addParticipantToThread: updateRegistrationEmbed failed:`, err),
  );
}
