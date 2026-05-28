import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import type { ApiResponse, RsiVerifyStatusDto } from '@dem/shared';

export const rsiRouter = Router();

// ── GET /api/guilds/:guildId/rsi/verify-status ────────────────────────────────
// Returns the current user's RSI handle and verification state for this guild.

rsiRouter.get('/:guildId/rsi/verify-status', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };

  const guild = await prisma.guild.findUnique({ where: { guildId }, include: { settings: true } });
  if (!guild) {
    res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
    return;
  }

  const member = await prisma.guildMember.findUnique({
    where: { userId_guildId: { userId: req.session.userId!, guildId: guild.id } },
  });

  res.json({
    success: true,
    data: {
      handle: member?.rsiHandle ?? null,
      verified: member?.rsiVerified ?? false,
      token: member?.rsiVerifyToken ?? null,
      orgRequired: !!(guild.settings?.rsiOrgTag),
    } satisfies RsiVerifyStatusDto,
  } satisfies ApiResponse<RsiVerifyStatusDto>);
});

// ── POST /api/guilds/:guildId/rsi/start-verify ────────────────────────────────
// Sets the member's RSI handle for this guild and generates a fresh verify token.

rsiRouter.post('/:guildId/rsi/start-verify', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const body = req.body as { handle?: unknown };
  const handle = typeof body.handle === 'string' ? body.handle.trim() : null;

  if (!handle || handle.length < 2 || handle.length > 60) {
    res.status(400).json({ success: false, error: 'Invalid RSI handle' } satisfies ApiResponse);
    return;
  }

  const guild = await prisma.guild.findUnique({ where: { guildId } });
  if (!guild) {
    res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
    return;
  }

  // Generate a token that's clearly machine-issued and easy to paste
  const token = `DEM-${randomBytes(6).toString('hex').toUpperCase()}`;

  const member = await prisma.guildMember.upsert({
    where: { userId_guildId: { userId: req.session.userId!, guildId: guild.id } },
    update: { rsiHandle: handle, rsiVerified: false, rsiVerifyToken: token },
    create: {
      userId: req.session.userId!,
      guildId: guild.id,
      role: 'MEMBER',
      rsiHandle: handle,
      rsiVerified: false,
      rsiVerifyToken: token,
    },
  });

  res.json({
    success: true,
    data: {
      handle: member.rsiHandle!,
      verified: false,
      token: member.rsiVerifyToken!,
      orgRequired: true,
    } satisfies RsiVerifyStatusDto,
  } satisfies ApiResponse<RsiVerifyStatusDto>);
});

// ── POST /api/guilds/:guildId/rsi/complete-verify ─────────────────────────────
// Fetches the RSI citizen profile page and checks the bio for the member's token.

rsiRouter.post('/:guildId/rsi/complete-verify', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };

  const guild = await prisma.guild.findUnique({ where: { guildId } });
  if (!guild) {
    res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
    return;
  }

  const member = await prisma.guildMember.findUnique({
    where: { userId_guildId: { userId: req.session.userId!, guildId: guild.id } },
  });

  if (!member?.rsiHandle || !member.rsiVerifyToken) {
    res.status(400).json({ success: false, error: 'No pending verification — start the flow first' } satisfies ApiResponse);
    return;
  }

  const profileUrl = `https://robertsspaceindustries.com/en/citizens/${encodeURIComponent(member.rsiHandle)}`;

  let pageHtml: string;
  try {
    const response = await fetch(profileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 404) {
      res.status(400).json({ success: false, error: `RSI citizen "${member.rsiHandle}" not found` } satisfies ApiResponse);
      return;
    }

    if (!response.ok) {
      res.status(502).json({ success: false, error: 'Failed to reach RSI' } satisfies ApiResponse);
      return;
    }

    pageHtml = await response.text();
  } catch (err) {
    console.error('[rsi/complete-verify] Fetch failed:', err);
    res.status(502).json({ success: false, error: 'Failed to reach RSI' } satisfies ApiResponse);
    return;
  }

  if (!pageHtml.includes(member.rsiVerifyToken)) {
    res.status(400).json({ success: false, error: 'Token not found in bio — make sure you saved the bio on RSI' } satisfies ApiResponse);
    return;
  }

  await prisma.guildMember.update({
    where: { id: member.id },
    data: { rsiVerified: true, rsiVerifyToken: null },
  });

  res.json({
    success: true,
    data: {
      handle: member.rsiHandle,
      verified: true,
      token: null,
      orgRequired: true,
    } satisfies RsiVerifyStatusDto,
  } satisfies ApiResponse<RsiVerifyStatusDto>);
});
