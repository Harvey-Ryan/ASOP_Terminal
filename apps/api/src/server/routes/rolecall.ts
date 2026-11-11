import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertEventCreator } from '../../lib/assertEventCreator.js';
import { assertEventViewer } from '../../lib/assertEventViewer.js';
import { assertModuleEditor } from '../../lib/assertModuleEditor.js';
import { assertModuleEnabled } from '../../lib/assertModuleEnabled.js';
import { activityAvailable } from '../../lib/activityAvailable.js';
import type { ApiResponse } from '@dem/shared';

export const roleCallRouter = Router();

const _rawUrl  = process.env.ROLECALL_API_URL?.trim();
const BASE_URL = _rawUrl
  ? _rawUrl.startsWith('http') ? _rawUrl : `https://${_rawUrl}`
  : undefined;
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

// ── Access (v1.21.1) ────────────────────────────────────────────────────────
// Every route used to pass any guildId straight to RoleCall with our API key,
// so anyone signed in could read (or change the settings of) any server.
// Each route now checks the person against the server it asks about, and only
// the query parameters RoleCall needs are passed on.

type Access = 'viewer' | 'heatmap' | 'self-or-officer' | 'editor';
const PARAMS = ['guildId', 'userId', 'page', 'includeInactive', 'days', 'timezone', 'type'] as const;

/** The query to pass on, or null (answered) when the person may not see this server's data. */
async function allowed(req: Request, res: Response, access: Access): Promise<Record<string, string> | null> {
  const q = req.query as Record<string, unknown>;
  const guildId = typeof q['guildId'] === 'string' ? q['guildId'] : '';
  if (!/^\d{5,25}$/.test(guildId)) {
    res.status(400).json({ success: false, error: 'guildId required' } satisfies ApiResponse);
    return null;
  }
  const deny = () => { res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return null; };
  // RoleCall only tracks some servers (v1.25.0): elsewhere nothing, settings included.
  if (!activityAvailable(guildId)) {
    res.status(404).json({ success: false, error: 'Activity isn\'t available for this server.' } satisfies ApiResponse);
    return null;
  }

  if (access === 'editor') {
    if (!(await assertModuleEditor(req, guildId))) return deny();
  } else {
    if (!(await assertModuleEnabled(guildId, 'activityEnabled'))) {
      res.status(404).json({ success: false, error: 'Activity is switched off in this server.' } satisfies ApiResponse);
      return null;
    }
    if (!(await assertEventViewer(req, guildId))) return deny();
    if (access === 'heatmap' || access === 'self-or-officer') {
      const officer = await assertEventCreator(req, guildId);
      if (!officer) {
        if (access === 'heatmap' && !(await heatmapsPublic(guildId))) return deny();
        if (access === 'self-or-officer' && q['userId'] !== (await myDiscordId(req))) return deny();
      }
    }
  }
  const out: Record<string, string> = {};
  for (const k of PARAMS) if (typeof q[k] === 'string') out[k] = q[k] as string;
  return out;
}

async function heatmapsPublic(guildId: string): Promise<boolean> {
  const g = await prisma.guild.findUnique({ where: { guildId }, select: { settings: { select: { activityHeatmapPublic: true } } } });
  return g?.settings?.activityHeatmapPublic ?? true;
}

async function myDiscordId(req: Request): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: req.session.userId! }, select: { discordId: true } });
  return u?.discordId ?? null;
}

/** A GET passed on to RoleCall after the access check. */
function proxied(path: string, subpath: string, access: Access) {
  roleCallRouter.get(path, requireAuth, async (req, res) => {
    const query = await allowed(req, res, access);
    if (!query) return;
    const result = await proxyGet(subpath, query);
    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error } satisfies ApiResponse);
      return;
    }
    res.json(result.body);
  });
}

// Members who can see events: the server's numbers and leaderboard.
proxied('/rolecall/stats', '/stats', 'viewer');
proxied('/rolecall/leaderboard', '/leaderboard', 'viewer');
// One person's details: officers, or that person.
proxied('/rolecall/member', '/member', 'self-or-officer');
proxied('/rolecall/heatmap/user', '/heatmap/user', 'self-or-officer');
// The server's heat map: officers, or members when the server allows it.
proxied('/rolecall/heatmap/guild', '/heatmap/guild', 'heatmap');
// Activity settings (Module Settings → Activity): module editors.
proxied('/rolecall/config', '/config', 'editor');
proxied('/rolecall/role-change-log', '/role-change-log', 'editor');
proxied('/rolecall/left-members', '/left-members', 'editor');

roleCallRouter.patch('/rolecall/config', requireAuth, async (req, res) => {
  const query = await allowed(req, res, 'editor');
  if (!query) return;
  const result = await proxyPatch('/config', { guildId: query['guildId']! }, req.body);
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error } satisfies ApiResponse);
    return;
  }
  res.json(result.body);
});
