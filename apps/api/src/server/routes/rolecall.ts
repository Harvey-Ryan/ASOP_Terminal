import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import type { ApiResponse } from '@dem/shared';

export const roleCallRouter = Router();

const BASE_URL = process.env.ROLECALL_API_URL;
const API_KEY  = process.env.ROLECALL_API_KEY  ?? '';

async function proxyGet(subpath: string, query: Record<string, string>) {
  if (!BASE_URL) return { ok: false as const, status: 503, error: 'RoleCall service not configured' };

  const qs = new URLSearchParams(query).toString();
  const url = `${BASE_URL}/api${subpath}${qs ? `?${qs}` : ''}`;

  try {
    const r = await fetch(url, {
      headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => null) as { error?: string } | null;
      return { ok: false as const, status: r.status, error: err?.error ?? `RoleCall ${r.status}` };
    }
    return { ok: true as const, body: await r.json() as unknown };
  } catch (err) {
    console.error('[rolecall] proxy error:', err);
    return { ok: false as const, status: 502, error: 'RoleCall service unreachable' };
  }
}

async function proxyPatch(subpath: string, query: Record<string, string>, body: unknown) {
  if (!BASE_URL) return { ok: false as const, status: 503, error: 'RoleCall service not configured' };

  const qs = new URLSearchParams(query).toString();
  const url = `${BASE_URL}/api${subpath}${qs ? `?${qs}` : ''}`;

  try {
    const r = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => null) as { error?: string } | null;
      return { ok: false as const, status: r.status, error: err?.error ?? `RoleCall ${r.status}` };
    }
    return { ok: true as const, body: await r.json() as unknown };
  } catch (err) {
    console.error('[rolecall] proxy error:', err);
    return { ok: false as const, status: 502, error: 'RoleCall service unreachable' };
  }
}

roleCallRouter.get('/rolecall/guilds', requireAuth, async (_req, res) => {
  const result = await proxyGet('/guilds', {});
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error } satisfies ApiResponse);
    return;
  }
  res.json(result.body);
});

roleCallRouter.get('/rolecall/stats', requireAuth, async (req, res) => {
  const result = await proxyGet('/stats', req.query as Record<string, string>);
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error } satisfies ApiResponse);
    return;
  }
  res.json(result.body);
});

roleCallRouter.get('/rolecall/leaderboard', requireAuth, async (req, res) => {
  const result = await proxyGet('/leaderboard', req.query as Record<string, string>);
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error } satisfies ApiResponse);
    return;
  }
  res.json(result.body);
});

roleCallRouter.get('/rolecall/member', requireAuth, async (req, res) => {
  const result = await proxyGet('/member', req.query as Record<string, string>);
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error } satisfies ApiResponse);
    return;
  }
  res.json(result.body);
});

roleCallRouter.get('/rolecall/config', requireAuth, async (req, res) => {
  const result = await proxyGet('/config', req.query as Record<string, string>);
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error } satisfies ApiResponse);
    return;
  }
  res.json(result.body);
});

roleCallRouter.patch('/rolecall/config', requireAuth, async (req, res) => {
  const result = await proxyPatch('/config', req.query as Record<string, string>, req.body);
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error } satisfies ApiResponse);
    return;
  }
  res.json(result.body);
});

roleCallRouter.get('/rolecall/role-change-log', requireAuth, async (req, res) => {
  const result = await proxyGet('/role-change-log', req.query as Record<string, string>);
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error } satisfies ApiResponse);
    return;
  }
  res.json(result.body);
});
