import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import type { ApiResponse, UserNotificationPrefsDto, UpdateNotificationPrefsBody } from '@dem/shared';

export const notificationsRouter = Router();

const DEFAULTS: UserNotificationPrefsDto = {
  dmTradeRequest:   true,
  dmTradeStatus:    true,
  dmTradeCancelled: true,
  dmTradeMessage:   true,
  dmEventReminder:  true,
  dmLootComplete:   true,
};

// ── GET /api/notifications/prefs ──────────────────────────────────────────────
// Returns the current user's notification preferences.
// If no row exists yet, returns the defaults without writing to the DB.

notificationsRouter.get('/notifications/prefs', requireAuth, async (req, res) => {
  const prefs = await prisma.userNotificationPrefs.findUnique({
    where: { userId: req.session.userId },
  });

  res.json({
    success: true,
    data: prefs ?? DEFAULTS,
  } satisfies ApiResponse<UserNotificationPrefsDto>);
});

// ── PUT /api/notifications/prefs ──────────────────────────────────────────────
// Partial update — only provided fields are changed.
// Upserts the row so the first save always succeeds.

notificationsRouter.put('/notifications/prefs', requireAuth, async (req, res) => {
  const body = req.body as UpdateNotificationPrefsBody;

  const allowed: (keyof UserNotificationPrefsDto)[] = [
    'dmTradeRequest', 'dmTradeStatus', 'dmTradeCancelled',
    'dmTradeMessage', 'dmEventReminder', 'dmLootComplete',
  ];

  const update: Partial<UserNotificationPrefsDto> = {};
  for (const key of allowed) {
    if (typeof body[key] === 'boolean') update[key] = body[key];
  }

  const userId = req.session.userId as string;
  const prefs = await prisma.userNotificationPrefs.upsert({
    where: { userId },
    create: { userId, ...DEFAULTS, ...update },
    update,
  });

  res.json({ success: true, data: prefs } satisfies ApiResponse<UserNotificationPrefsDto>);
});
