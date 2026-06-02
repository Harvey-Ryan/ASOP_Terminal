import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { assertAllianceManager } from '../../lib/assertAllianceManager.js';
import type {
  ApiResponse,
  AllianceDto,
  AllianceInvitationDto,
  CreateAllianceBody,
  RenameAllianceBody,
  AddAllianceMemberBody,
} from '@dem/shared';

export const allianceRouter = Router();

type MemberRow = {
  id: string;
  status: string;
  invitedByGuildId: string | null;
  guild: { id: string; guildId: string; name: string; icon: string | null };
};

function toDto(alliance: {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  members: MemberRow[];
}): AllianceDto {
  return {
    id: alliance.id,
    name: alliance.name,
    members: alliance.members.map((m) => ({
      id: m.guild.id,
      guildId: m.guild.guildId,
      name: m.guild.name,
      icon: m.guild.icon,
      status: m.status,
      memberId: m.id,
    })),
    createdAt: alliance.createdAt.toISOString(),
    updatedAt: alliance.updatedAt.toISOString(),
  };
}

const memberInclude = { members: { include: { guild: true }, orderBy: { createdAt: 'asc' as const } } };

// ── GET /api/alliances/guilds ─────────────────────────────────────────────────

allianceRouter.get('/alliances/guilds', requireAuth, async (_req, res) => {
  const guilds = await prisma.guild.findMany({
    select: { id: true, guildId: true, name: true, icon: true },
    orderBy: { name: 'asc' },
  });

  res.json({
    success: true,
    data: guilds.map((g) => ({ id: g.id, guildId: g.guildId, name: g.name, icon: g.icon })),
  } satisfies ApiResponse);
});

// ── GET /api/alliances/invitations?discordGuildId=... ─────────────────────────

allianceRouter.get('/alliances/invitations', requireAuth, async (req, res) => {
  const discordGuildId = typeof req.query['discordGuildId'] === 'string' ? req.query['discordGuildId'] : null;
  if (!discordGuildId) {
    res.status(400).json({ success: false, error: 'discordGuildId is required' } satisfies ApiResponse);
    return;
  }

  const members = await prisma.allianceMember.findMany({
    where: { guild: { guildId: discordGuildId }, status: 'PENDING' },
    include: { alliance: true, guild: true },
    orderBy: { createdAt: 'asc' },
  });

  const invitations: AllianceInvitationDto[] = await Promise.all(
    members.map(async (m) => {
      let invitedByGuildName: string | null = null;
      let invitedByGuildIcon: string | null = null;
      if (m.invitedByGuildId) {
        const invitingGuild = await prisma.guild.findUnique({
          where: { guildId: m.invitedByGuildId },
          select: { name: true, icon: true },
        });
        invitedByGuildName = invitingGuild?.name ?? null;
        invitedByGuildIcon = invitingGuild?.icon ?? null;
      }
      return {
        memberId: m.id,
        allianceId: m.allianceId,
        allianceName: m.alliance.name,
        invitedByGuildId: m.invitedByGuildId,
        invitedByGuildName,
        invitedByGuildIcon,
        createdAt: m.createdAt.toISOString(),
      };
    }),
  );

  res.json({ success: true, data: invitations } satisfies ApiResponse<AllianceInvitationDto[]>);
});

// ── GET /api/alliances ────────────────────────────────────────────────────────

allianceRouter.get('/alliances', requireAuth, async (_req, res) => {
  const alliances = await prisma.alliance.findMany({
    include: memberInclude,
    orderBy: { name: 'asc' },
  });

  res.json({ success: true, data: alliances.map(toDto) } satisfies ApiResponse<AllianceDto[]>);
});

// ── POST /api/alliances ───────────────────────────────────────────────────────

allianceRouter.post('/alliances', requireAuth, async (req, res) => {
  const body = req.body as Partial<CreateAllianceBody>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const callerGuildId = typeof body.callerGuildId === 'string' ? body.callerGuildId.trim() : '';

  if (!callerGuildId) {
    res.status(400).json({ success: false, error: 'callerGuildId is required' } satisfies ApiResponse);
    return;
  }
  if (!name || name.length > 100) {
    res.status(400).json({ success: false, error: 'Name is required and must be ≤100 characters' } satisfies ApiResponse);
    return;
  }
  if (!(await assertAllianceManager(req, callerGuildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const alliance = await prisma.alliance.create({
    data: { name },
    include: memberInclude,
  });

  res.status(201).json({ success: true, data: toDto(alliance) } satisfies ApiResponse<AllianceDto>);
});

// ── PATCH /api/alliances/:allianceId ─────────────────────────────────────────

allianceRouter.patch('/alliances/:allianceId', requireAuth, async (req, res) => {
  const { allianceId } = req.params as { allianceId: string };
  const body = req.body as Partial<RenameAllianceBody>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const callerGuildId = typeof body.callerGuildId === 'string' ? body.callerGuildId.trim() : '';

  if (!callerGuildId) {
    res.status(400).json({ success: false, error: 'callerGuildId is required' } satisfies ApiResponse);
    return;
  }
  if (!name || name.length > 100) {
    res.status(400).json({ success: false, error: 'Name is required and must be ≤100 characters' } satisfies ApiResponse);
    return;
  }
  if (!(await assertAllianceManager(req, callerGuildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const existing = await prisma.alliance.findUnique({ where: { id: allianceId } });
  if (!existing) {
    res.status(404).json({ success: false, error: 'Alliance not found' } satisfies ApiResponse);
    return;
  }

  const alliance = await prisma.alliance.update({
    where: { id: allianceId },
    data: { name },
    include: memberInclude,
  });

  res.json({ success: true, data: toDto(alliance) } satisfies ApiResponse<AllianceDto>);
});

// ── DELETE /api/alliances/:allianceId ────────────────────────────────────────

allianceRouter.delete('/alliances/:allianceId', requireAuth, async (req, res) => {
  const { allianceId } = req.params as { allianceId: string };
  const callerGuildId = typeof req.query['callerGuildId'] === 'string' ? req.query['callerGuildId'] : '';

  if (!callerGuildId) {
    res.status(400).json({ success: false, error: 'callerGuildId is required' } satisfies ApiResponse);
    return;
  }
  if (!(await assertAllianceManager(req, callerGuildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const existing = await prisma.alliance.findUnique({ where: { id: allianceId } });
  if (!existing) {
    res.status(404).json({ success: false, error: 'Alliance not found' } satisfies ApiResponse);
    return;
  }

  await prisma.alliance.delete({ where: { id: allianceId } });
  res.json({ success: true } satisfies ApiResponse);
});

// ── POST /api/alliances/:allianceId/members ───────────────────────────────────
// Creates a PENDING invitation. guildId is Guild.guildId (Discord snowflake).

allianceRouter.post('/alliances/:allianceId/members', requireAuth, async (req, res) => {
  const { allianceId } = req.params as { allianceId: string };
  const body = req.body as Partial<AddAllianceMemberBody>;
  const guildId = typeof body.guildId === 'string' ? body.guildId.trim() : '';
  const invitingGuildId = typeof body.invitingGuildId === 'string' ? body.invitingGuildId.trim() : undefined;

  if (!guildId) {
    res.status(400).json({ success: false, error: 'guildId is required' } satisfies ApiResponse);
    return;
  }
  if (!invitingGuildId) {
    res.status(400).json({ success: false, error: 'invitingGuildId is required' } satisfies ApiResponse);
    return;
  }
  if (!(await assertAllianceManager(req, invitingGuildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const [alliance, guild] = await Promise.all([
    prisma.alliance.findUnique({ where: { id: allianceId } }),
    prisma.guild.findUnique({ where: { guildId } }),
  ]);

  if (!alliance) {
    res.status(404).json({ success: false, error: 'Alliance not found' } satisfies ApiResponse);
    return;
  }
  if (!guild) {
    res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
    return;
  }

  const existing = await prisma.allianceMember.findUnique({
    where: { allianceId_guildId: { allianceId, guildId: guild.id } },
  });
  if (existing) {
    res.status(409).json({ success: false, error: 'Guild is already in this alliance' } satisfies ApiResponse);
    return;
  }

  await prisma.allianceMember.create({
    data: {
      allianceId,
      guildId: guild.id,
      status: 'PENDING',
      invitedByGuildId: invitingGuildId ?? null,
    },
  });

  const updated = await prisma.alliance.findUnique({ where: { id: allianceId }, include: memberInclude });
  res.status(201).json({ success: true, data: toDto(updated!) } satisfies ApiResponse<AllianceDto>);
});

// ── PATCH /api/alliances/invitations/:memberId/accept ────────────────────────

allianceRouter.patch('/alliances/invitations/:memberId/accept', requireAuth, async (req, res) => {
  const { memberId } = req.params as { memberId: string };
  const discordGuildId = typeof req.query['discordGuildId'] === 'string' ? req.query['discordGuildId'] : null;

  if (!discordGuildId) {
    res.status(400).json({ success: false, error: 'discordGuildId is required' } satisfies ApiResponse);
    return;
  }

  if (!(await assertGuildManager(req, discordGuildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const member = await prisma.allianceMember.findUnique({
    where: { id: memberId },
    include: { guild: true },
  });

  if (!member) {
    res.status(404).json({ success: false, error: 'Invitation not found' } satisfies ApiResponse);
    return;
  }
  if (member.guild.guildId !== discordGuildId) {
    res.status(403).json({ success: false, error: 'You can only accept invitations for your own guild' } satisfies ApiResponse);
    return;
  }
  if (member.status !== 'PENDING') {
    res.status(409).json({ success: false, error: 'Invitation is not pending' } satisfies ApiResponse);
    return;
  }

  await prisma.allianceMember.update({ where: { id: memberId }, data: { status: 'ACCEPTED' } });

  const updated = await prisma.alliance.findUnique({ where: { id: member.allianceId }, include: memberInclude });
  res.json({ success: true, data: toDto(updated!) } satisfies ApiResponse<AllianceDto>);
});

// ── DELETE /api/alliances/invitations/:memberId (reject / cancel) ─────────────

allianceRouter.delete('/alliances/invitations/:memberId', requireAuth, async (req, res) => {
  const { memberId } = req.params as { memberId: string };
  const discordGuildId = typeof req.query['discordGuildId'] === 'string' ? req.query['discordGuildId'] : null;

  if (!discordGuildId) {
    res.status(400).json({ success: false, error: 'discordGuildId is required' } satisfies ApiResponse);
    return;
  }

  if (!(await assertGuildManager(req, discordGuildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const member = await prisma.allianceMember.findUnique({
    where: { id: memberId },
    include: { guild: true },
  });

  if (!member) {
    res.status(404).json({ success: false, error: 'Invitation not found' } satisfies ApiResponse);
    return;
  }
  if (member.guild.guildId !== discordGuildId) {
    res.status(403).json({ success: false, error: 'You can only reject invitations for your own guild' } satisfies ApiResponse);
    return;
  }

  await prisma.allianceMember.delete({ where: { id: memberId } });
  res.json({ success: true } satisfies ApiResponse);
});

// ── DELETE /api/alliances/:allianceId/members/:guildId ───────────────────────
// :guildId is Guild.guildId (Discord snowflake)

allianceRouter.delete('/alliances/:allianceId/members/:guildId', requireAuth, async (req, res) => {
  const { allianceId, guildId } = req.params as { allianceId: string; guildId: string };
  const callerGuildId = typeof req.query['callerGuildId'] === 'string' ? req.query['callerGuildId'] : '';

  if (!callerGuildId) {
    res.status(400).json({ success: false, error: 'callerGuildId is required' } satisfies ApiResponse);
    return;
  }
  if (!(await assertAllianceManager(req, callerGuildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const guild = await prisma.guild.findUnique({ where: { guildId } });
  if (!guild) {
    res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
    return;
  }

  const member = await prisma.allianceMember.findUnique({
    where: { allianceId_guildId: { allianceId, guildId: guild.id } },
  });
  if (!member) {
    res.status(404).json({ success: false, error: 'Guild is not in this alliance' } satisfies ApiResponse);
    return;
  }

  await prisma.allianceMember.delete({ where: { id: member.id } });

  const updated = await prisma.alliance.findUnique({ where: { id: allianceId }, include: memberInclude });
  if (!updated) {
    res.status(404).json({ success: false, error: 'Alliance not found' } satisfies ApiResponse);
    return;
  }
  res.json({ success: true, data: toDto(updated) } satisfies ApiResponse<AllianceDto>);
});
