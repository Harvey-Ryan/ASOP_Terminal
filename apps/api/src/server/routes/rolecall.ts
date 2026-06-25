import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import type { ApiResponse } from '@dem/shared';

export const roleCallRouter = Router();

const BASE_URL = process.env.ROLECALL_API_URL ?? 'http://localhost:3000';
const API_KEY  = process.env.ROLECALL_API_KEY  ?? '';

async function proxyGet(subpath: string, query: Record<string, unknown>) {
  const qs = new URLSearchParams(query as Record<string, string>).toString();
  const url = `${BASE_URL}/api${subpath}${qs ? `?${qs}` : ''}`;
  const r = await fetch(url, {
    headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: `RoleCall ${r.status}` }));
    return { ok: false as const, status: r.status, body: err };
  }
  return { ok: true as const, body: await r.json() };
}

roleCallRouter.get('/rolecall/guilds', requireAuth, async (_req, res) => {
  const result = await proxyGet('/guilds', {});
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.body } satisfies ApiResponse);
    return;
  }
  res.json(result.body);
});

roleCallRouter.get('/rolecall/stats', requireAuth, async (req, res) => {
  const result = await proxyGet('/stats', req.query);
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.body } satisfies ApiResponse);
    return;
  }
  res.json(result.body);
});

roleCallRouter.get('/rolecall/leaderboard', requireAuth, async (req, res) => {
  const result = await proxyGet('/leaderboard', req.query);
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.body } satisfies ApiResponse);
    return;
  }
  res.json(result.body);
});

roleCallRouter.get('/rolecall/member', requireAuth, async (req, res) => {
  const result = await proxyGet('/member', req.query);
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.body } satisfies ApiResponse);
    return;
  }
  res.json(result.body);
});
