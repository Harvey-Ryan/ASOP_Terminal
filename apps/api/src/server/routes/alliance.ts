import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import type { ApiResponse, AllianceDto, CreateAllianceBody, RenameAllianceBody, AddAllianceMemberBody } from '@dem/shared';

export const allianceRouter = Router();

function toDto(alliance: {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  members: { guild: { id: string; guildId: string; name: string; icon: string | null } }[];
}): AllianceDto {
  return {
    id: alliance.id,
    name: alliance.name,
    members: alliance.members.map((m) => ({
      id: m.guild.id,
      guildId: m.guild.guildId,
      name: m.guild.name,
      icon: m.guild.icon,
    })),
    createdAt: alliance.createdAt.toISOString(),
    updatedAt: alliance.updatedAt.toISOString(),
  };
}

const memberInclude = { members: { include: { guild: true }, orderBy: { createdAt: 'asc' as const } } };

// ── GET /api/alliances/guilds ─────────────────────────────────────────────────
// All guilds known to the bot — used for the "add server to alliance" picker.

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

  if (!name || name.length > 100) {
    res.status(400).json({ success: false, error: 'Name is required and must be ≤100 characters' } satisfies ApiResponse);
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

  if (!name || name.length > 100) {
    res.status(400).json({ success: false, error: 'Name is required and must be ≤100 characters' } satisfies ApiResponse);
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

  const existing = await prisma.alliance.findUnique({ where: { id: allianceId } });
  if (!existing) {
    res.status(404).json({ success: false, error: 'Alliance not found' } satisfies ApiResponse);
    return;
  }

  await prisma.alliance.delete({ where: { id: allianceId } });
  res.json({ success: true } satisfies ApiResponse);
});

// ── POST /api/alliances/:allianceId/members ───────────────────────────────────
// guildId here is Guild.guildId (Discord snowflake)

allianceRouter.post('/alliances/:allianceId/members', requireAuth, async (req, res) => {
  const { allianceId } = req.params as { allianceId: string };
  const body = req.body as Partial<AddAllianceMemberBody>;
  const guildId = typeof body.guildId === 'string' ? body.guildId.trim() : '';

  if (!guildId) {
    res.status(400).json({ success: false, error: 'guildId is required' } satisfies ApiResponse);
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

  await prisma.allianceMember.create({ data: { allianceId, guildId: guild.id } });

  const updated = await prisma.alliance.findUnique({ where: { id: allianceId }, include: memberInclude });
  res.status(201).json({ success: true, data: toDto(updated!) } satisfies ApiResponse<AllianceDto>);
});

// ── DELETE /api/alliances/:allianceId/members/:guildId ───────────────────────
// :guildId is Guild.guildId (Discord snowflake)

allianceRouter.delete('/alliances/:allianceId/members/:guildId', requireAuth, async (req, res) => {
  const { allianceId, guildId } = req.params as { allianceId: string; guildId: string };

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
