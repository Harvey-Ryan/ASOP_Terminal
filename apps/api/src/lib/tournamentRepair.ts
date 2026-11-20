// Tournament sign-ups made on the website before v1.59.1 stored the person's
// internal User.id where their Discord id belongs (TournamentParticipant.discordId).
// The bot, the website's "already registered" check, ratings and history all
// key on the Discord id, so those rows are moved over to it here, at start-up.
// Tournament.createdById had the same mix-up (events store the Discord id, and
// Your data looks for it), so it's moved too.
// Safe to run every time: once nothing matches a User.id, it does nothing.

import { prisma } from './prisma.js';

export interface TournamentRepairResult {
  participants: number;
  creators: number;
  ratings: number;
  standings: number;
  /** Rows left alone because the person already has one under their Discord id. */
  conflicts: number;
}

export async function repairTournamentSignups(): Promise<TournamentRepairResult> {
  const result: TournamentRepairResult = { participants: 0, creators: 0, ratings: 0, standings: 0, conflicts: 0 };

  // Every value that is really a User.id, mapped to that user's Discord id.
  const [creatorIds, participantIds, ratingIds, standingIds] = await Promise.all([
    prisma.tournament
      .findMany({ select: { createdById: true } })
      .then((r) => r.map((t) => ({ discordId: t.createdById }))),
    prisma.tournamentParticipant.findMany({ where: { discordId: { not: null } }, select: { discordId: true } }),
    prisma.tournamentPlayerRating.findMany({ select: { discordId: true } }),
    prisma.tournamentSeasonStanding.findMany({ select: { discordId: true } }),
  ]);
  const candidates = [
    ...new Set(
      [...creatorIds, ...participantIds, ...ratingIds, ...standingIds]
        .map((r) => r.discordId)
        .filter((v): v is string => !!v && !/^\d+$/.test(v) && !v.startsWith('deleted-')),
    ),
  ];
  if (candidates.length === 0) return result;
  const users = await prisma.user.findMany({
    where: { id: { in: candidates } },
    select: { id: true, discordId: true },
  });
  if (users.length === 0) return result;

  for (const u of users) {
    const c = await prisma.tournament.updateMany({ where: { createdById: u.id }, data: { createdById: u.discordId } });
    result.creators += c.count;

    // One entry per person per tournament: someone who signed up on the
    // website and again from Discord has two, so the website one is left as is.
    const entries = await prisma.tournamentParticipant.findMany({ where: { discordId: u.id } });
    for (const e of entries) {
      const taken = await prisma.tournamentParticipant.findFirst({
        where: { tournamentId: e.tournamentId, discordId: u.discordId },
        select: { id: true },
      });
      if (taken) {
        result.conflicts++;
        continue;
      }
      await prisma.tournamentParticipant.update({ where: { id: e.id }, data: { discordId: u.discordId } });
      result.participants++;
    }

    // Ratings are one row per server per person: move it unless the person
    // already has one under their Discord id (then it's left for a manual look).
    const ratings = await prisma.tournamentPlayerRating.findMany({ where: { discordId: u.id } });
    for (const r of ratings) {
      const taken = await prisma.tournamentPlayerRating.findUnique({
        where: { guildId_discordId: { guildId: r.guildId, discordId: u.discordId } },
        select: { id: true },
      });
      if (taken) {
        result.conflicts++;
        continue;
      }
      await prisma.tournamentPlayerRating.update({ where: { id: r.id }, data: { discordId: u.discordId } });
      result.ratings++;
    }

    const standings = await prisma.tournamentSeasonStanding.findMany({ where: { discordId: u.id } });
    for (const s of standings) {
      const taken = await prisma.tournamentSeasonStanding.findUnique({
        where: { seasonId_discordId: { seasonId: s.seasonId, discordId: u.discordId } },
        select: { id: true },
      });
      if (taken) {
        result.conflicts++;
        continue;
      }
      await prisma.tournamentSeasonStanding.update({ where: { id: s.id }, data: { discordId: u.discordId } });
      result.standings++;
    }
  }

  if (result.conflicts > 0) {
    console.warn(
      `[tournaments] ${result.conflicts} sign-up/rating/standing row(s) kept under an internal user id: the same person already has one under their Discord id`,
    );
  }
  return result;
}
