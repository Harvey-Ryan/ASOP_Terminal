import { Router } from 'express';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { triggerBot } from '../../lib/triggerBot.js';
import { generateSingleElimBracket } from '../../lib/bracketGenerator.js';
import { calcElo } from '../../lib/eloCalculator.js';
import type { ApiResponse } from '@dem/shared';

export const tournamentRouter = Router();

const VALID_SIZES = [4, 8, 16, 32];
const VALID_FORMATS = ['SINGLE_ELIM'] as const; // DOUBLE_ELIM added in Phase 2
const VALID_SEEDING = ['RANDOM', 'DKP', 'ACTIVITY', 'MANUAL'] as const;

// ── helper ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function forbidden(res: any): void {
  res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function notFound(res: any): void {
  res.status(404).json({ success: false, error: 'Not found' } satisfies ApiResponse);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function badRequest(res: any, msg: string): void {
  res.status(400).json({ success: false, error: msg } satisfies ApiResponse);
}

// ── GET /:guildId/tournaments  ────────────────────────────────────────────────

tournamentRouter.get('/:guildId/tournaments', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const statusFilter = req.query['status'] as string | undefined;
  const statuses = statusFilter ? statusFilter.split(',').map((s) => s.trim()).filter(Boolean) : [];

  try {
    const where = statuses.length === 0
      ? { guildId }
      : statuses.length === 1
        ? { guildId, status: statuses[0]! }
        : { guildId, status: { in: statuses } };

    const tournaments = await prisma.tournament.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { participants: true, matches: true } } },
    });

    res.json({ success: true, data: tournaments } satisfies ApiResponse);
  } catch (err) {
    console.error('[GET tournaments]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── GET /:guildId/tournaments/rankings ───────────────────────────────────────

tournamentRouter.get('/:guildId/tournaments/rankings', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const page = Math.max(1, Number(req.query['page'] ?? 1));
  const limit = 50;

  try {
    const [total, players] = await Promise.all([
      prisma.tournamentPlayerRating.count({ where: { guildId } }),
      prisma.tournamentPlayerRating.findMany({
        where: { guildId },
        orderBy: { rating: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    res.json({ success: true, data: { players, total, page, limit } } satisfies ApiResponse);
  } catch (err) {
    console.error('[GET rankings]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── GET /:guildId/tournaments/seasons ────────────────────────────────────────

tournamentRouter.get('/:guildId/tournaments/seasons', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };

  try {
    const seasons = await prisma.tournamentSeason.findMany({
      where: { guildId },
      orderBy: { startsAt: 'desc' },
      include: { _count: { select: { links: true } } },
    });
    res.json({ success: true, data: seasons } satisfies ApiResponse);
  } catch (err) {
    console.error('[GET seasons]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── POST /:guildId/tournaments/seasons ───────────────────────────────────────

tournamentRouter.post('/:guildId/tournaments/seasons', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) return forbidden(res);

  const { name } = req.body as { name?: string };
  if (!name?.trim()) return badRequest(res, 'Season name is required');

  try {
    const season = await prisma.tournamentSeason.create({
      data: { guildId, name: name.trim() },
    });
    res.json({ success: true, data: season } satisfies ApiResponse);
  } catch (err) {
    console.error('[POST seasons]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── PATCH /:guildId/tournaments/seasons/:seasonId ────────────────────────────

tournamentRouter.patch('/:guildId/tournaments/seasons/:seasonId', requireAuth, async (req, res) => {
  const { guildId, seasonId } = req.params as { guildId: string; seasonId: string };
  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) return forbidden(res);

  const { name, status } = req.body as { name?: string; status?: string };

  try {
    const season = await prisma.tournamentSeason.findFirst({ where: { id: seasonId, guildId } });
    if (!season) return notFound(res);

    const data: Record<string, unknown> = {};
    if (name?.trim()) data['name'] = name.trim();
    if (status === 'COMPLETED') {
      data['status'] = 'COMPLETED';
      data['endsAt'] = new Date();
    }

    const updated = await prisma.tournamentSeason.update({ where: { id: seasonId }, data });
    res.json({ success: true, data: updated } satisfies ApiResponse);
  } catch (err) {
    console.error('[PATCH season]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── GET /:guildId/tournaments/seasons/:seasonId/standings ─────────────────────

tournamentRouter.get('/:guildId/tournaments/seasons/:seasonId/standings', requireAuth, async (req, res) => {
  const { guildId, seasonId } = req.params as { guildId: string; seasonId: string };

  try {
    const standings = await prisma.tournamentSeasonStanding.findMany({
      where: { seasonId, guildId },
      orderBy: { rating: 'desc' },
      take: 100,
    });
    res.json({ success: true, data: standings } satisfies ApiResponse);
  } catch (err) {
    console.error('[GET standings]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── GET /:guildId/tournaments/players/:discordId/history ──────────────────────

tournamentRouter.get('/:guildId/tournaments/players/:discordId/history', requireAuth, async (req, res) => {
  const { guildId, discordId } = req.params as { guildId: string; discordId: string };

  try {
    const rating = await prisma.tournamentPlayerRating.findUnique({
      where: { guildId_discordId: { guildId, discordId } },
      include: {
        history: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!rating) return notFound(res);
    res.json({ success: true, data: rating } satisfies ApiResponse);
  } catch (err) {
    console.error('[GET player history]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── Demo tournament — 4 sequential steps so the UI can report progress ────────

const DEMO_FAKE_NAMES = [
  'Aelindra Swiftblade', 'Borin Ironforge', 'Cassara Dusk', 'Drakon Vex',
  'Elara Moonwhisper', 'Fyros the Bold', 'Griselda Storm', 'Harken Vale',
];

// Step 1: Create the tournament record (DRAFT, no participants yet)
tournamentRouter.post('/:guildId/tournaments/demo', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) return forbidden(res);

  try {
    const creatorId = req.session.userId!;
    const label = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const name = `Demo Tournament ${label}`;

    const tournament = await prisma.tournament.create({
      data: {
        guildId,
        name,
        format: 'SINGLE_ELIM',
        participantMode: 'INDIVIDUAL',
        size: 8,
        status: 'DRAFT',
        seedingMode: 'RANDOM',
        createdById: creatorId,
      },
    });

    res.json({ success: true, data: { tournamentId: tournament.id, name: tournament.name } } satisfies ApiResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST demo step 1]', err);
    res.status(500).json({ success: false, error: msg } satisfies ApiResponse);
  }
});

// Step 2: Add 8 fake participants (null discordId → no ELO/DKP side-effects)
tournamentRouter.post('/:guildId/tournaments/:id/demo/participants', requireAuth, async (req, res) => {
  const { guildId, id } = req.params as { guildId: string; id: string };
  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) return forbidden(res);

  try {
    const tournament = await prisma.tournament.findFirst({ where: { id, guildId } });
    if (!tournament) return notFound(res);
    if (tournament.status !== 'DRAFT') return badRequest(res, `Expected DRAFT, got ${tournament.status}`);

    await prisma.tournamentParticipant.createMany({
      data: DEMO_FAKE_NAMES.map((displayName, i) => ({
        tournamentId: id,
        displayName,
        discordId: null,
        seed: i + 1,
        status: 'ACTIVE',
      })),
    });

    res.json({ success: true, data: { count: DEMO_FAKE_NAMES.length } } satisfies ApiResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST demo step 2]', err);
    res.status(500).json({ success: false, error: msg } satisfies ApiResponse);
  }
});

// Step 3: Generate single-elim bracket, transition to IN_PROGRESS
tournamentRouter.post('/:guildId/tournaments/:id/demo/bracket', requireAuth, async (req, res) => {
  const { guildId, id } = req.params as { guildId: string; id: string };
  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) return forbidden(res);

  try {
    const tournament = await prisma.tournament.findFirst({
      where: { id, guildId },
      include: { participants: { orderBy: { seed: 'asc' } } },
    });
    if (!tournament) return notFound(res);
    if (tournament.status !== 'DRAFT') return badRequest(res, `Expected DRAFT, got ${tournament.status}`);
    if (tournament.participants.length < 2) return badRequest(res, `Need at least 2 participants, have ${tournament.participants.length}`);

    const seededParticipants = tournament.participants.map((p) => ({ id: p.id, seed: p.seed ?? 999 }));
    const slots = generateSingleElimBracket(id, seededParticipants);
    const keyToId = new Map(slots.map((s) => [s.key, randomUUID()]));
    const matchData = slots.map((slot) => ({
      id: keyToId.get(slot.key)!,
      tournamentId: id,
      round: slot.round,
      position: slot.position,
      bracketSide: slot.bracketSide,
      participantAId: slot.participantAId,
      participantBId: slot.participantBId,
      status: slot.status,
      nextMatchId: slot.nextMatchKey ? (keyToId.get(slot.nextMatchKey) ?? null) : null,
    }));

    await prisma.$transaction(async (tx) => {
      await tx.tournamentMatch.createMany({ data: matchData });

      const byes = matchData.filter((m) => m.status === 'BYE');
      for (const bye of byes) {
        if (bye.participantAId && bye.nextMatchId) {
          const next = matchData.find((m) => m.id === bye.nextMatchId)!;
          const field = next.participantAId ? 'participantBId' : 'participantAId';
          next[field] = bye.participantAId;
          await tx.tournamentMatch.update({ where: { id: bye.nextMatchId }, data: { [field]: bye.participantAId } });
        }
      }

      await tx.tournament.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    });

    res.json({ success: true, data: { matchCount: matchData.length } } satisfies ApiResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST demo step 3]', err);
    res.status(500).json({ success: false, error: msg } satisfies ApiResponse);
  }
});

// Step 4: Randomly resolve every match round-by-round, then mark COMPLETED
tournamentRouter.post('/:guildId/tournaments/:id/demo/resolve', requireAuth, async (req, res) => {
  const { guildId, id } = req.params as { guildId: string; id: string };
  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) return forbidden(res);

  try {
    const tournament = await prisma.tournament.findFirst({ where: { id, guildId } });
    if (!tournament) return notFound(res);
    if (tournament.status !== 'IN_PROGRESS') return badRequest(res, `Expected IN_PROGRESS, got ${tournament.status}`);

    const matches = await prisma.tournamentMatch.findMany({
      where: { tournamentId: id },
      orderBy: [{ round: 'asc' }, { position: 'asc' }],
    });

    const now = new Date();
    // Mutable snapshot — winner advances are tracked here so later rounds see updated participants
    const matchData = matches.map((m) => ({ ...m }));
    let finalWinnerId: string | null = null;
    let finalLoserId: string | null = null;
    const maxRound = Math.max(...matchData.map((m) => m.round));

    for (let round = 1; round <= maxRound; round++) {
      for (const match of matchData.filter((m) => m.round === round)) {
        if (match.status === 'BYE') {
          if (match.participantAId && match.nextMatchId) {
            const next = matchData.find((m) => m.id === match.nextMatchId)!;
            const field = next.participantAId ? 'participantBId' : 'participantAId';
            next[field] = match.participantAId;
            await prisma.tournamentMatch.update({ where: { id: match.nextMatchId }, data: { [field]: match.participantAId } });
          }
          continue;
        }

        if (!match.participantAId || !match.participantBId) continue;

        const aWins = Math.random() < 0.5;
        const winnerId = aWins ? match.participantAId : match.participantBId;
        const loserId = aWins ? match.participantBId : match.participantAId;

        await prisma.tournamentMatch.update({ where: { id: match.id }, data: { winnerId, status: 'COMPLETED', resultPostedAt: now } });
        await prisma.tournamentParticipant.update({ where: { id: loserId }, data: { status: 'ELIMINATED' } });

        if (match.nextMatchId) {
          const next = matchData.find((m) => m.id === match.nextMatchId)!;
          const field = next.participantAId ? 'participantBId' : 'participantAId';
          next[field] = winnerId;
          await prisma.tournamentMatch.update({ where: { id: match.nextMatchId }, data: { [field]: winnerId } });
        }

        if (round === maxRound) { finalWinnerId = winnerId; finalLoserId = loserId; }
      }
    }

    let winnerName = 'Unknown';
    if (finalWinnerId) {
      const w = await prisma.tournamentParticipant.update({ where: { id: finalWinnerId }, data: { status: 'WINNER', placement: 1 } });
      winnerName = w.displayName;
    }
    if (finalLoserId) {
      await prisma.tournamentParticipant.update({ where: { id: finalLoserId }, data: { status: 'RUNNER_UP', placement: 2 } });
    }
    await prisma.tournament.update({ where: { id }, data: { status: 'COMPLETED', completedAt: now } });

    res.json({ success: true, data: { winner: winnerName, tournamentId: id } } satisfies ApiResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST demo step 4]', err);
    res.status(500).json({ success: false, error: msg } satisfies ApiResponse);
  }
});

// ── POST /:guildId/tournaments ────────────────────────────────────────────────

tournamentRouter.post('/:guildId/tournaments', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) return forbidden(res);

  const {
    name, description, format = 'SINGLE_ELIM', participantMode = 'INDIVIDUAL',
    size = 8, seedingMode = 'RANDOM', dkpPrize1st = 0, dkpPrize2nd = 0, dkpPrize3rd = 0,
    channelId, registrationEndsAt, seasonId,
  } = req.body as {
    name?: string; description?: string; format?: string; participantMode?: string;
    size?: number; seedingMode?: string; dkpPrize1st?: number; dkpPrize2nd?: number;
    dkpPrize3rd?: number; channelId?: string; registrationEndsAt?: string; seasonId?: string;
  };

  if (!name?.trim()) return badRequest(res, 'Tournament name is required');
  if (!VALID_FORMATS.includes(format as typeof VALID_FORMATS[number])) return badRequest(res, `format must be one of: ${VALID_FORMATS.join(', ')}`);
  if (!VALID_SIZES.includes(size)) return badRequest(res, `size must be one of: ${VALID_SIZES.join(', ')}`);
  if (!VALID_SEEDING.includes(seedingMode as typeof VALID_SEEDING[number])) return badRequest(res, `seedingMode must be one of: ${VALID_SEEDING.join(', ')}`);

  const userId = req.session.userId!;

  try {
    const tournament = await prisma.$transaction(async (tx) => {
      const t = await tx.tournament.create({
        data: {
          guildId,
          name: name.trim(),
          description: description?.trim() ?? null,
          format,
          participantMode,
          size,
          seedingMode,
          dkpPrize1st,
          dkpPrize2nd,
          dkpPrize3rd,
          channelId: channelId ?? null,
          registrationEndsAt: registrationEndsAt ? new Date(registrationEndsAt) : null,
          createdById: userId,
        },
      });
      if (seasonId) {
        const season = await tx.tournamentSeason.findFirst({ where: { id: seasonId, guildId } });
        if (season) {
          await tx.tournamentSeasonLink.create({ data: { seasonId, tournamentId: t.id } });
        }
      }
      return t;
    });

    // Fire-and-forget: bot creates the forum thread immediately so the thread
    // exists throughout the tournament lifecycle (draft → registration → bracket).
    triggerBot(`/trigger/tournament-created/${tournament.id}`);

    res.json({ success: true, data: tournament } satisfies ApiResponse);
  } catch (err) {
    console.error('[POST tournament]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── GET /:guildId/tournaments/:id ─────────────────────────────────────────────

tournamentRouter.get('/:guildId/tournaments/:id', requireAuth, async (req, res) => {
  const { guildId, id } = req.params as { guildId: string; id: string };

  try {
    const tournament = await prisma.tournament.findFirst({
      where: { id, guildId },
      include: {
        participants: { include: { teamMembers: true }, orderBy: { seed: 'asc' } },
        matches: { orderBy: [{ round: 'asc' }, { position: 'asc' }] },
        seasons: { include: { season: { select: { id: true, name: true, status: true } } } },
      },
    });

    if (!tournament) return notFound(res);
    res.json({ success: true, data: tournament } satisfies ApiResponse);
  } catch (err) {
    console.error('[GET tournament]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── PATCH /:guildId/tournaments/:id ───────────────────────────────────────────

tournamentRouter.patch('/:guildId/tournaments/:id', requireAuth, async (req, res) => {
  const { guildId, id } = req.params as { guildId: string; id: string };
  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) return forbidden(res);

  const { name, description, channelId, registrationEndsAt, dkpPrize1st, dkpPrize2nd, dkpPrize3rd } =
    req.body as Record<string, unknown>;

  try {
    const tournament = await prisma.tournament.findFirst({ where: { id, guildId } });
    if (!tournament) return notFound(res);
    if (tournament.status === 'COMPLETED') return badRequest(res, 'Cannot edit a completed tournament');

    const data: Record<string, unknown> = {};
    if (typeof name === 'string' && name.trim()) data['name'] = name.trim();
    if (description !== undefined) data['description'] = typeof description === 'string' ? description.trim() : null;
    if (channelId !== undefined) data['channelId'] = channelId ?? null;
    if (registrationEndsAt !== undefined) data['registrationEndsAt'] = registrationEndsAt ? new Date(registrationEndsAt as string) : null;
    if (typeof dkpPrize1st === 'number') data['dkpPrize1st'] = dkpPrize1st;
    if (typeof dkpPrize2nd === 'number') data['dkpPrize2nd'] = dkpPrize2nd;
    if (typeof dkpPrize3rd === 'number') data['dkpPrize3rd'] = dkpPrize3rd;

    const updated = await prisma.tournament.update({ where: { id }, data });
    res.json({ success: true, data: updated } satisfies ApiResponse);
  } catch (err) {
    console.error('[PATCH tournament]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── DELETE /:guildId/tournaments/:id ──────────────────────────────────────────

tournamentRouter.delete('/:guildId/tournaments/:id', requireAuth, async (req, res) => {
  const { guildId, id } = req.params as { guildId: string; id: string };
  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) return forbidden(res);

  try {
    const tournament = await prisma.tournament.findFirst({ where: { id, guildId } });
    if (!tournament) return notFound(res);
    if (!['DRAFT', 'REGISTRATION'].includes(tournament.status)) return badRequest(res, 'Only DRAFT or REGISTRATION tournaments can be deleted');

    await prisma.tournament.delete({ where: { id } });
    res.json({ success: true } satisfies ApiResponse);
  } catch (err) {
    console.error('[DELETE tournament]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── POST /:guildId/tournaments/:id/register ───────────────────────────────────

tournamentRouter.post('/:guildId/tournaments/:id/register', requireAuth, async (req, res) => {
  const { guildId, id } = req.params as { guildId: string; id: string };
  const userId = req.session.userId!;

  const {
    discordId, displayName, teamName, teamMembers,
  } = req.body as {
    discordId?: string; displayName?: string;
    teamName?: string; teamMembers?: Array<{ discordId: string; displayName: string }>;
  };

  try {
    const tournament = await prisma.tournament.findFirst({ where: { id, guildId } });
    if (!tournament) return notFound(res);
    // Managers can pre-register participants during DRAFT; everyone can register during REGISTRATION.
    if (!['DRAFT', 'REGISTRATION'].includes(tournament.status)) return badRequest(res, 'Registration is not open');

    const existing = await prisma.tournamentParticipant.count({ where: { tournamentId: id } });
    if (existing >= tournament.size) return badRequest(res, 'Tournament is full');

    const isManager = await assertGuildManager(req, guildId);
    // Non-managers can only register themselves, and only during REGISTRATION (not DRAFT)
    if (!isManager && tournament.status === 'DRAFT') return forbidden(res);

    if (tournament.participantMode === 'INDIVIDUAL') {
      // Managers can specify a discordId and/or displayName.
      // If neither is provided, or a non-manager is registering, default to the session user.
      const targetDiscordId: string | null = isManager
        ? (discordId?.trim() || null)
        : userId;
      const targetName = displayName?.trim() || targetDiscordId || 'Unknown';

      // Duplicate check: only apply when a discordId is set (null discordIds are allowed to coexist)
      if (targetDiscordId) {
        const dup = await prisma.tournamentParticipant.findFirst({
          where: { tournamentId: id, discordId: targetDiscordId },
        });
        if (dup) return badRequest(res, 'Participant already registered');
      }

      const participant = await prisma.tournamentParticipant.create({
        data: { tournamentId: id, discordId: targetDiscordId, displayName: targetName },
      });
      if (targetDiscordId) triggerBot(`/trigger/tournament-participant-joined/${id}/${targetDiscordId}`);
      triggerBot(`/trigger/tournament-roster/${id}`);
      res.json({ success: true, data: participant } satisfies ApiResponse);
    } else {
      // Team mode — manager must add both a team name and member list
      if (!isManager) return forbidden(res);
      if (!teamName?.trim()) return badRequest(res, 'teamName is required for team mode');
      if (!teamMembers?.length) return badRequest(res, 'teamMembers is required for team mode');

      const participant = await prisma.$transaction(async (tx) => {
        const p = await tx.tournamentParticipant.create({
          data: { tournamentId: id, displayName: teamName.trim() },
        });
        await tx.tournamentTeamMember.createMany({
          data: teamMembers.map((m) => ({
            participantId: p.id,
            discordId: m.discordId,
            displayName: m.displayName,
          })),
        });
        return p;
      });

      // Add each team member to the thread
      for (const m of teamMembers) {
        triggerBot(`/trigger/tournament-participant-joined/${id}/${m.discordId}`);
      }
      triggerBot(`/trigger/tournament-roster/${id}`);
      res.json({ success: true, data: participant } satisfies ApiResponse);
    }
  } catch (err) {
    console.error('[POST register]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── DELETE /:guildId/tournaments/:id/participants/:pid ────────────────────────

tournamentRouter.delete('/:guildId/tournaments/:id/participants/:pid', requireAuth, async (req, res) => {
  const { guildId, id, pid } = req.params as { guildId: string; id: string; pid: string };
  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) return forbidden(res);

  try {
    const tournament = await prisma.tournament.findFirst({ where: { id, guildId } });
    if (!tournament) return notFound(res);
    if (!['DRAFT', 'REGISTRATION'].includes(tournament.status)) return badRequest(res, 'Can only remove participants during draft or registration');

    await prisma.tournamentParticipant.deleteMany({ where: { id: pid, tournamentId: id } });
    triggerBot(`/trigger/tournament-roster/${id}`);
    res.json({ success: true } satisfies ApiResponse);
  } catch (err) {
    console.error('[DELETE participant]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── PATCH /:guildId/tournaments/:id/seed ──────────────────────────────────────

tournamentRouter.patch('/:guildId/tournaments/:id/seed', requireAuth, async (req, res) => {
  const { guildId, id } = req.params as { guildId: string; id: string };
  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) return forbidden(res);

  const { order } = req.body as { order?: string[] };
  if (!Array.isArray(order)) return badRequest(res, 'order must be an array of participant ids');

  try {
    const tournament = await prisma.tournament.findFirst({ where: { id, guildId } });
    if (!tournament) return notFound(res);
    if (tournament.status !== 'REGISTRATION') return badRequest(res, 'Can only seed during registration');

    await prisma.$transaction(
      order.map((pid, i) =>
        prisma.tournamentParticipant.updateMany({
          where: { id: pid, tournamentId: id },
          data: { seed: i + 1 },
        }),
      ),
    );

    res.json({ success: true } satisfies ApiResponse);
  } catch (err) {
    console.error('[PATCH seed]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── POST /:guildId/tournaments/:id/open ───────────────────────────────────────

tournamentRouter.post('/:guildId/tournaments/:id/open', requireAuth, async (req, res) => {
  const { guildId, id } = req.params as { guildId: string; id: string };
  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) return forbidden(res);

  try {
    const tournament = await prisma.tournament.findFirst({ where: { id, guildId } });
    if (!tournament) return notFound(res);
    if (tournament.status !== 'DRAFT') return badRequest(res, 'Tournament must be in DRAFT status to open');

    const updated = await prisma.tournament.update({
      where: { id },
      data: { status: 'REGISTRATION' },
    });

    // Reminder for registration close if a deadline is set
    if (tournament.registrationEndsAt) {
      const closeReminderAt = new Date(tournament.registrationEndsAt.getTime() - 60 * 60_000);
      if (closeReminderAt > new Date()) {
        await prisma.tournamentReminder.create({
          data: {
            tournamentId: id,
            type: 'REGISTRATION_CLOSE',
            scheduledAt: closeReminderAt,
          },
        });
      }
    }

    triggerBot(`/trigger/tournament-open/${id}`);
    res.json({ success: true, data: updated } satisfies ApiResponse);
  } catch (err) {
    console.error('[POST open]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── POST /:guildId/tournaments/:id/start ──────────────────────────────────────

tournamentRouter.post('/:guildId/tournaments/:id/start', requireAuth, async (req, res) => {
  const { guildId, id } = req.params as { guildId: string; id: string };
  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) return forbidden(res);

  try {
    const tournament = await prisma.tournament.findFirst({
      where: { id, guildId },
      include: { participants: true },
    });
    if (!tournament) return notFound(res);
    if (tournament.status !== 'REGISTRATION') return badRequest(res, 'Tournament must be in REGISTRATION to start');
    if (tournament.participants.length < 2) return badRequest(res, 'Need at least 2 participants to start');

    // ── Auto-seeding ──────────────────────────────────────────────────────────
    let participants = [...tournament.participants];

    if (tournament.seedingMode === 'RANDOM') {
      // Fisher-Yates shuffle
      for (let i = participants.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [participants[i], participants[j]] = [participants[j]!, participants[i]!];
      }
      await prisma.$transaction(
        participants.map((p, i) =>
          prisma.tournamentParticipant.update({ where: { id: p.id }, data: { seed: i + 1 } }),
        ),
      );
      participants = participants.map((p, i) => ({ ...p, seed: i + 1 }));
    } else if (tournament.seedingMode === 'DKP') {
      const discordIds = participants.map((p) => p.discordId).filter(Boolean) as string[];
      const balances = await prisma.dkpBalance.findMany({
        where: { guildId, userId: { in: discordIds } },
        orderBy: { balance: 'desc' },
      });
      const rankMap = new Map(balances.map((b, i) => [b.userId, i + 1]));
      await prisma.$transaction(
        participants.map((p) =>
          prisma.tournamentParticipant.update({
            where: { id: p.id },
            data: { seed: p.discordId ? (rankMap.get(p.discordId) ?? 999) : 999 },
          }),
        ),
      );
      participants = participants.map((p) => ({
        ...p,
        seed: p.discordId ? (rankMap.get(p.discordId) ?? 999) : 999,
      }));
    } else if (tournament.seedingMode === 'ACTIVITY') {
      const discordIds = participants.map((p) => p.discordId).filter(Boolean) as string[];
      // Activity score = number of events attended in this guild
      const rsvpCounts = await prisma.eventRsvp.groupBy({
        by: ['userId'],
        where: {
          event: { guildId },
          userId: { in: discordIds },
        },
        _count: { _all: true },
        orderBy: { _count: { userId: 'desc' } },
      });
      const rankMap = new Map(rsvpCounts.map((r, i) => [r.userId, i + 1]));
      await prisma.$transaction(
        participants.map((p) =>
          prisma.tournamentParticipant.update({
            where: { id: p.id },
            data: { seed: p.discordId ? (rankMap.get(p.discordId) ?? 999) : 999 },
          }),
        ),
      );
      participants = participants.map((p) => ({
        ...p,
        seed: p.discordId ? (rankMap.get(p.discordId) ?? 999) : 999,
      }));
    }
    // MANUAL: seeds already set by manager via /seed endpoint

    // ── Generate bracket ──────────────────────────────────────────────────────
    const seededParticipants = participants
      .map((p) => ({ id: p.id, seed: p.seed ?? 999 }))
      .sort((a, b) => a.seed - b.seed);

    const slots = generateSingleElimBracket(id, seededParticipants);

    // Pre-assign real UUIDs so we can resolve nextMatchId before inserting
    const keyToId = new Map(slots.map((s) => [s.key, randomUUID()]));

    const matchData = slots.map((slot) => ({
      id: keyToId.get(slot.key)!,
      tournamentId: id,
      round: slot.round,
      position: slot.position,
      bracketSide: slot.bracketSide,
      participantAId: slot.participantAId,
      participantBId: slot.participantBId,
      status: slot.status,
      nextMatchId: slot.nextMatchKey ? (keyToId.get(slot.nextMatchKey) ?? null) : null,
    }));

    await prisma.$transaction(async (tx) => {
      await tx.tournamentMatch.createMany({ data: matchData });

      // Auto-advance BYE matches — participant advances to next match immediately
      const byes = matchData.filter((m) => m.status === 'BYE');
      for (const bye of byes) {
        if (bye.participantAId && bye.nextMatchId) {
          const next = matchData.find((m) => m.id === bye.nextMatchId);
          if (next) {
            // Check the in-memory snapshot (not DB) so multiple BYEs feeding the
            // same next match don't both write to participantAId.
            const field = next.participantAId ? 'participantBId' : 'participantAId';
            next[field] = bye.participantAId; // keep snapshot in sync
            await tx.tournamentMatch.update({
              where: { id: bye.nextMatchId },
              data: { [field]: bye.participantAId },
            });
          }
        }
      }

      await tx.tournament.update({
        where: { id },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });
    });

    triggerBot(`/trigger/tournament-start/${id}`);
    res.json({ success: true } satisfies ApiResponse);
  } catch (err) {
    console.error('[POST start]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── POST /:guildId/tournaments/:id/matches/:matchId/schedule ──────────────────

tournamentRouter.post('/:guildId/tournaments/:id/matches/:matchId/schedule', requireAuth, async (req, res) => {
  const { guildId, id, matchId } = req.params as { guildId: string; id: string; matchId: string };
  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) return forbidden(res);

  const { scheduledAt } = req.body as { scheduledAt?: string };
  if (!scheduledAt) return badRequest(res, 'scheduledAt is required');

  const dt = new Date(scheduledAt);
  if (isNaN(dt.getTime())) return badRequest(res, 'scheduledAt is not a valid date');

  try {
    const match = await prisma.tournamentMatch.findFirst({
      where: { id: matchId, tournamentId: id, tournament: { guildId } },
    });
    if (!match) return notFound(res);
    if (match.status === 'COMPLETED') return badRequest(res, 'Match is already completed');

    await prisma.$transaction(async (tx) => {
      await tx.tournamentMatch.update({
        where: { id: matchId },
        data: { scheduledAt: dt, status: 'SCHEDULED' },
      });

      // Cancel any existing reminders for this match before creating new ones
      await tx.tournamentReminder.deleteMany({ where: { matchId, sentAt: null } });

      const reminders: Array<{ tournamentId: string; matchId: string; type: string; scheduledAt: Date }> = [];
      const minus60 = new Date(dt.getTime() - 60 * 60_000);
      const minus15 = new Date(dt.getTime() - 15 * 60_000);
      if (minus60 > new Date()) reminders.push({ tournamentId: id, matchId, type: 'MATCH_START', scheduledAt: minus60 });
      if (minus15 > new Date()) reminders.push({ tournamentId: id, matchId, type: 'CHECK_IN', scheduledAt: minus15 });

      if (reminders.length) await tx.tournamentReminder.createMany({ data: reminders });
    });

    triggerBot(`/trigger/tournament-match-scheduled/${matchId}`);
    res.json({ success: true } satisfies ApiResponse);
  } catch (err) {
    console.error('[POST schedule]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── POST /:guildId/tournaments/:id/matches/:matchId/result ────────────────────

tournamentRouter.post('/:guildId/tournaments/:id/matches/:matchId/result', requireAuth, async (req, res) => {
  const { guildId, id, matchId } = req.params as { guildId: string; id: string; matchId: string };
  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) return forbidden(res);

  const { winnerId, scoreA, scoreB } = req.body as {
    winnerId?: string; scoreA?: number; scoreB?: number;
  };
  if (!winnerId) return badRequest(res, 'winnerId is required');

  try {
    const match = await prisma.tournamentMatch.findFirst({
      where: { id: matchId, tournamentId: id, tournament: { guildId } },
      include: {
        participantA: true,
        participantB: true,
        tournament: { select: { dkpPrize1st: true, dkpPrize2nd: true, dkpPrize3rd: true, participantMode: true } },
      },
    });
    if (!match) return notFound(res);
    if (match.status === 'COMPLETED') return badRequest(res, 'Match already completed');

    const participantIds = [match.participantAId, match.participantBId].filter(Boolean);
    if (!participantIds.includes(winnerId)) return badRequest(res, 'winnerId must be one of the match participants');

    const loserId = winnerId === match.participantAId ? match.participantBId : match.participantAId;
    const aWon = winnerId === match.participantAId;

    await prisma.$transaction(async (tx) => {
      // Mark match completed (idempotency: only if not already set)
      const updated = await tx.tournamentMatch.updateMany({
        where: { id: matchId, resultPostedAt: null },
        data: {
          winnerId,
          scoreA: scoreA ?? null,
          scoreB: scoreB ?? null,
          status: 'COMPLETED',
          resultPostedAt: new Date(),
        },
      });
      if (updated.count === 0) return; // already processed

      // Mark loser as ELIMINATED
      if (loserId) {
        await tx.tournamentParticipant.update({
          where: { id: loserId },
          data: { status: 'ELIMINATED' },
        });
      }

      // Advance winner to next match
      if (match.nextMatchId) {
        const nextMatch = await tx.tournamentMatch.findUnique({
          where: { id: match.nextMatchId },
        });
        if (nextMatch) {
          const field = nextMatch.participantAId ? 'participantBId' : 'participantAId';
          const bothFilled = nextMatch.participantAId && nextMatch.participantBId;
          await tx.tournamentMatch.update({
            where: { id: match.nextMatchId },
            data: {
              [field]: winnerId,
              // If advancing this winner completes the pair, mark match READY
              ...(bothFilled ? {} : {}),
            },
          });
        }
      }

      // ── ELO update (individual mode only) ──────────────────────────────────
      if (match.tournament.participantMode === 'INDIVIDUAL' && match.participantA?.discordId && match.participantB?.discordId) {
        const pA = match.participantA;
        const pB = match.participantB;
        const discordIdA = pA.discordId as string;
        const discordIdB = pB.discordId as string;

        const [ratingA, ratingB] = await Promise.all([
          tx.tournamentPlayerRating.upsert({
            where: { guildId_discordId: { guildId, discordId: discordIdA } },
            create: { guildId, discordId: discordIdA, displayName: pA.displayName },
            update: {},
          }),
          tx.tournamentPlayerRating.upsert({
            where: { guildId_discordId: { guildId, discordId: discordIdB } },
            create: { guildId, discordId: discordIdB, displayName: pB.displayName },
            update: {},
          }),
        ]);

        const elo = calcElo(ratingA.rating, ratingA.matchesPlayed, ratingB.rating, ratingB.matchesPlayed, aWon);

        await Promise.all([
          tx.tournamentPlayerRating.update({
            where: { id: ratingA.id },
            data: {
              rating: elo.newA,
              matchesPlayed: { increment: 1 },
              wins: aWon ? { increment: 1 } : undefined,
              losses: !aWon ? { increment: 1 } : undefined,
              peakRating: elo.newA > ratingA.peakRating ? elo.newA : undefined,
            },
          }),
          tx.tournamentPlayerRating.update({
            where: { id: ratingB.id },
            data: {
              rating: elo.newB,
              matchesPlayed: { increment: 1 },
              wins: !aWon ? { increment: 1 } : undefined,
              losses: aWon ? { increment: 1 } : undefined,
              peakRating: elo.newB > ratingB.peakRating ? elo.newB : undefined,
            },
          }),
          tx.tournamentRatingHistory.createMany({
            data: [
              {
                ratingId: ratingA.id,
                matchId,
                tournamentId: id,
                ratingBefore: ratingA.rating,
                ratingAfter: elo.newA,
                delta: elo.deltaA,
                won: aWon,
                opponentName: pB.displayName,
                opponentRatingBefore: ratingB.rating,
              },
              {
                ratingId: ratingB.id,
                matchId,
                tournamentId: id,
                ratingBefore: ratingB.rating,
                ratingAfter: elo.newB,
                delta: elo.deltaB,
                won: !aWon,
                opponentName: pA.displayName,
                opponentRatingBefore: ratingA.rating,
              },
            ],
          }),
        ]);

        // Season standings update (if tournament belongs to a season)
        const seasonLinks = await tx.tournamentSeasonLink.findMany({ where: { tournamentId: id } });
        for (const link of seasonLinks) {
          const season = await tx.tournamentSeason.findUnique({ where: { id: link.seasonId } });
          if (season?.status !== 'ACTIVE') continue;

          await Promise.all([
            tx.tournamentSeasonStanding.upsert({
              where: { seasonId_discordId: { seasonId: link.seasonId, discordId: discordIdA } },
              create: {
                seasonId: link.seasonId, guildId, discordId: discordIdA, displayName: pA.displayName,
                rating: 1200 + elo.deltaA, wins: aWon ? 1 : 0, losses: !aWon ? 1 : 0, matchesPlayed: 1,
              },
              update: {
                rating: { increment: elo.deltaA },
                wins: aWon ? { increment: 1 } : undefined,
                losses: !aWon ? { increment: 1 } : undefined,
                matchesPlayed: { increment: 1 },
              },
            }),
            tx.tournamentSeasonStanding.upsert({
              where: { seasonId_discordId: { seasonId: link.seasonId, discordId: discordIdB } },
              create: {
                seasonId: link.seasonId, guildId, discordId: discordIdB, displayName: pB.displayName,
                rating: 1200 + elo.deltaB, wins: !aWon ? 1 : 0, losses: aWon ? 1 : 0, matchesPlayed: 1,
              },
              update: {
                rating: { increment: elo.deltaB },
                wins: !aWon ? { increment: 1 } : undefined,
                losses: aWon ? { increment: 1 } : undefined,
                matchesPlayed: { increment: 1 },
              },
            }),
          ]);
        }
      }

      // ── Check if tournament is complete ────────────────────────────────────
      const remaining = await tx.tournamentMatch.count({
        where: { tournamentId: id, status: { notIn: ['COMPLETED', 'BYE'] } },
      });
      if (remaining === 0) {
        // Mark champion and runner-up
        await tx.tournamentParticipant.update({
          where: { id: winnerId },
          data: { status: 'WINNER', placement: 1 },
        });
        if (loserId) {
          await tx.tournamentParticipant.update({
            where: { id: loserId },
            data: { status: 'RUNNER_UP', placement: 2 },
          });
        }

        // DKP prizes
        const prizes = [
          { participantId: winnerId, amount: match.tournament.dkpPrize1st },
          ...(loserId ? [{ participantId: loserId, amount: match.tournament.dkpPrize2nd }] : []),
        ].filter((p) => p.amount > 0);

        for (const prize of prizes) {
          const participant = await tx.tournamentParticipant.findUnique({ where: { id: prize.participantId } });
          if (!participant?.discordId) continue;
          const balance = await tx.dkpBalance.findUnique({
            where: { guildId_userId: { guildId, userId: participant.discordId } },
          });
          if (!balance) continue;
          await tx.dkpTransaction.create({
            data: {
              balanceId: balance.id,
              guildId,
              userId: participant.discordId,
              username: participant.displayName,
              amount: prize.amount,
              reason: `Tournament: ${id}`,
            },
          });
          await tx.dkpBalance.update({
            where: { id: balance.id },
            data: { balance: { increment: prize.amount } },
          });
        }

        await tx.tournament.update({
          where: { id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      }
    });

    triggerBot(`/trigger/tournament-match-result/${matchId}`);
    // If the transaction marked the tournament completed, also trigger the completion handler
    // (check the DB state to avoid reading inside the now-committed transaction scope)
    const finalStatus = await prisma.tournament.findUnique({ where: { id }, select: { status: true } });
    if (finalStatus?.status === 'COMPLETED') {
      triggerBot(`/trigger/tournament-complete/${id}`);
    }
    res.json({ success: true } satisfies ApiResponse);
  } catch (err) {
    console.error('[POST result]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── POST /:guildId/tournaments/:id/complete ───────────────────────────────────

tournamentRouter.post('/:guildId/tournaments/:id/complete', requireAuth, async (req, res) => {
  const { guildId, id } = req.params as { guildId: string; id: string };
  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) return forbidden(res);

  try {
    const tournament = await prisma.tournament.findFirst({ where: { id, guildId } });
    if (!tournament) return notFound(res);
    if (tournament.status !== 'IN_PROGRESS') return badRequest(res, 'Tournament must be IN_PROGRESS to complete');

    await prisma.tournament.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    triggerBot(`/trigger/tournament-complete/${id}`);
    res.json({ success: true } satisfies ApiResponse);
  } catch (err) {
    console.error('[POST complete]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});
