import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { ApiResponse, AlliesOverviewDto, AllyDirectoryEntryDto, SendAllyRequestBody, SendAllyRequestResult } from '@dem/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { assertAllianceManager } from '../../lib/assertAllianceManager.js';
import { prisma } from '../../lib/prisma.js';
import {
  AllyError,
  alliesOverview,
  cancelAllyRequest,
  loadGuild,
  pendingAllyRequestCount,
  removeAlly,
  respondToAllyRequest,
  searchDirectory,
  sendAllyRequest,
  setAllyAutoAccept,
  setDirectoryListing,
  setNewAllyCode,
  unblockAlly,
} from '../../lib/allies.js';

// Ally network: one org asks another to be allies; the other accepts or
// rejects. Every route is for ally managers of :guildId (guild managers plus
// the "alliance manager" roles in Org Settings). Rules: packages/shared/src/allies.ts.

export const alliesRouter = Router();

/** Express 4 doesn't catch async errors: answer refusals and failures here. */
const handle = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler => (req, res) => {
  fn(req, res).catch((err) => {
    if (res.headersSent) return;
    if (err instanceof AllyError) {
      res.status(err.status).json({ success: false, error: err.message } satisfies ApiResponse);
      return;
    }
    console.error(`[allies] ${req.method} ${req.path}:`, err);
    res.status(500).json({ success: false, error: 'Something went wrong. Try again.' } satisfies ApiResponse);
  });
};

/** The guild, if the signed-in user may manage its allies; otherwise answers 403 and returns null. */
async function managedGuild(req: Request, res: Response) {
  const guildId = String(req.params['guildId'] ?? '');
  if (!(await assertAllianceManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Only officers who manage allies can do this.' } satisfies ApiResponse);
    return null;
  }
  return loadGuild(guildId);
}

async function discordUserId(req: Request): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: req.session.userId! }, select: { discordId: true } });
  return u?.discordId ?? req.session.userId!;
}

const ok = <T>(res: Response, data?: T, status = 200) => res.status(status).json({ success: true, ...(data !== undefined ? { data } : {}) } satisfies ApiResponse<T>);
const param = (req: Request, name: string) => String(req.params[name] ?? '');

// GET /api/guilds/:guildId/allies
alliesRouter.get('/:guildId/allies', requireAuth, handle(async (req, res) => {
  const guild = await managedGuild(req, res);
  if (guild) ok<AlliesOverviewDto>(res, await alliesOverview(guild));
}));

// GET /api/guilds/:guildId/allies/pending-count: the nav badge.
alliesRouter.get('/:guildId/allies/pending-count', requireAuth, handle(async (req, res) => {
  const guild = await managedGuild(req, res);
  if (guild) ok<{ count: number }>(res, { count: await pendingAllyRequestCount(guild) });
}));

// GET /api/guilds/:guildId/allies/directory?q=
alliesRouter.get('/:guildId/allies/directory', requireAuth, handle(async (req, res) => {
  const guild = await managedGuild(req, res);
  if (!guild) return;
  const q = typeof req.query['q'] === 'string' ? req.query['q'].slice(0, 100) : '';
  ok<AllyDirectoryEntryDto[]>(res, await searchDirectory(guild, q));
}));

// POST /api/guilds/:guildId/allies/requests  { targetGuildId | code, message? }
alliesRouter.post('/:guildId/allies/requests', requireAuth, handle(async (req, res) => {
  const guild = await managedGuild(req, res);
  if (!guild) return;
  const body = (req.body ?? {}) as SendAllyRequestBody;
  const target = {
    ...(typeof body.code === 'string' ? { code: body.code } : {}),
    ...(typeof body.targetGuildId === 'string' ? { targetGuildId: body.targetGuildId } : {}),
  };
  const result = await sendAllyRequest(guild, target, typeof body.message === 'string' ? body.message : undefined, { userId: await discordUserId(req) });
  ok<SendAllyRequestResult>(res, result, 201);
}));

// POST /api/guilds/:guildId/allies/requests/:id/accept | reject | block
for (const action of ['accept', 'reject', 'block'] as const) {
  alliesRouter.post(`/:guildId/allies/requests/:id/${action}`, requireAuth, handle(async (req, res) => {
    const guild = await managedGuild(req, res);
    if (!guild) return;
    await respondToAllyRequest(guild, param(req, 'id'), action, { userId: await discordUserId(req) });
    ok(res);
  }));
}

// DELETE /api/guilds/:guildId/allies/requests/:id  (withdraw your own request)
alliesRouter.delete('/:guildId/allies/requests/:id', requireAuth, handle(async (req, res) => {
  const guild = await managedGuild(req, res);
  if (!guild) return;
  await cancelAllyRequest(guild, param(req, 'id'));
  ok(res);
}));

// PATCH /api/guilds/:guildId/allies/listing  { listed }
alliesRouter.patch('/:guildId/allies/listing', requireAuth, handle(async (req, res) => {
  const guild = await managedGuild(req, res);
  if (!guild) return;
  const listed = (req.body as { listed?: unknown } | undefined)?.listed;
  if (typeof listed !== 'boolean') throw new AllyError(400, 'listed must be true or false');
  await setDirectoryListing(guild, listed);
  ok(res);
}));

// POST /api/guilds/:guildId/allies/code  (new ally code; the old one stops working)
alliesRouter.post('/:guildId/allies/code', requireAuth, handle(async (req, res) => {
  const guild = await managedGuild(req, res);
  if (guild) ok<{ code: string }>(res, { code: await setNewAllyCode(guild) });
}));

// DELETE /api/guilds/:guildId/allies/blocks/:id  (unblock)
alliesRouter.delete('/:guildId/allies/blocks/:id', requireAuth, handle(async (req, res) => {
  const guild = await managedGuild(req, res);
  if (!guild) return;
  await unblockAlly(guild, param(req, 'id'));
  ok(res);
}));

// PATCH /api/guilds/:guildId/allies/:id  { autoAcceptTheirEvents }
alliesRouter.patch('/:guildId/allies/:id', requireAuth, handle(async (req, res) => {
  const guild = await managedGuild(req, res);
  if (!guild) return;
  const value = (req.body as { autoAcceptTheirEvents?: unknown } | undefined)?.autoAcceptTheirEvents;
  if (typeof value !== 'boolean') throw new AllyError(400, 'autoAcceptTheirEvents must be true or false');
  await setAllyAutoAccept(guild, param(req, 'id'), value);
  ok(res);
}));

// DELETE /api/guilds/:guildId/allies/:id  (end the alliance)
alliesRouter.delete('/:guildId/allies/:id', requireAuth, handle(async (req, res) => {
  const guild = await managedGuild(req, res);
  if (!guild) return;
  await removeAlly(guild, param(req, 'id'));
  ok(res);
}));
