// "Your data" (v1.31.0): download everything ASOP holds about you, or delete
// it (lib/myData.ts has what each does).

import { Router } from 'express';
import type { ApiResponse } from '@dem/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { exportMyData, deleteMyData } from '../../lib/myData.js';

export const myDataRouter = Router();

// ── GET /api/me/data: the download ───────────────────────────────────────────

myDataRouter.get('/me/data', requireAuth, async (req, res) => {
  const data = await exportMyData(req.session.userId!);
  const day = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="asop-my-data-${day}.json"`);
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/json').send(JSON.stringify(data, null, 2));
});

// ── POST /api/me/delete { confirm }: delete it ───────────────────────────────
// `confirm` is the person's Discord username, typed in, so it can't happen by
// a stray click.

myDataRouter.post('/me/delete', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.session.userId! }, select: { username: true } });
  if (!user) { res.status(401).json({ success: false, error: 'Unauthorized' } satisfies ApiResponse); return; }
  const confirm = (req.body as { confirm?: unknown }).confirm;
  if (typeof confirm !== 'string' || confirm.trim().toLowerCase() !== user.username.toLowerCase()) {
    res.status(400).json({ success: false, error: `Type your Discord username (${user.username}) to confirm.` } satisfies ApiResponse); return;
  }

  await deleteMyData(req.session.userId!);
  console.log('[my-data] a member deleted their data'); // no names: they asked to be forgotten

  req.session.destroy(() => {
    res.clearCookie('dem.sid');
    res.json({ success: true } satisfies ApiResponse);
  });
});
