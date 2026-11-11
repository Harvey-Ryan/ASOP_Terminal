// Job board (v1.21.0): members post small jobs, others take them, the poster
// marks them done. A job is seen by its own server, its allies too, or every
// ASOP server (rules: packages/shared/src/jobs.ts). The bot posts jobs in the
// servers' jobs channels when they have one (/trigger/job/:id).

import { Router, type Request, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import {
  JOB_EXPIRY_DAYS, JOB_LIMITS, JOB_TAKE_MESSAGES, jobTakeProblem, jobVisibleTo, parseJobInput,
  type ApiResponse, type JobDto, type JobKind, type JobStatus, type JobVisibility,
} from '@dem/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertEventViewer } from '../../lib/assertEventViewer.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { assertModuleEnabled } from '../../lib/assertModuleEnabled.js';
import { triggerBot } from '../../lib/triggerBot.js';

export const jobsRouter = Router();

const withCrew = { crew: { orderBy: { id: 'asc' } } } as const;
type JobRow = Prisma.JobGetPayload<{ include: typeof withCrew }>;

/** Discord ids of the servers allied with this one. */
async function alliesOf(discordGuildId: string): Promise<Set<string>> {
  const guild = await prisma.guild.findUnique({ where: { guildId: discordGuildId }, select: { id: true } });
  if (!guild) return new Set();
  const links = await prisma.guildAlly.findMany({
    where: { status: 'ACCEPTED', OR: [{ guildAId: guild.id }, { guildBId: guild.id }] },
    select: { guildAId: true, guildBId: true },
  });
  const ids = links.map((l) => (l.guildAId === guild.id ? l.guildBId : l.guildAId));
  const others = await prisma.guild.findMany({ where: { id: { in: ids } }, select: { guildId: true } });
  return new Set(others.map((g) => g.guildId));
}

async function toDtos(rows: JobRow[]): Promise<JobDto[]> {
  const names = new Map((await prisma.guild.findMany({
    where: { guildId: { in: [...new Set(rows.map((r) => r.guildId))] } }, select: { guildId: true, name: true },
  })).map((g) => [g.guildId, g.name]));
  return rows.map((j) => ({
    id: j.id, guildId: j.guildId, guildName: names.get(j.guildId) ?? 'Unknown server',
    posterId: j.posterId, posterName: j.posterName, kind: j.kind as JobKind, title: j.title, details: j.details,
    reward: j.reward, location: j.location, whenText: j.whenText, slots: j.slots,
    visibility: j.visibility as JobVisibility,
    status: (j.status === 'OPEN' && j.expiresAt < new Date() ? 'EXPIRED' : j.status) as JobStatus,
    expiresAt: j.expiresAt.toISOString(), createdAt: j.createdAt.toISOString(),
    crew: j.crew.map((c) => ({ userId: c.userId, username: c.username })),
  }));
}

/** The signed-in person, if they can use the job board from this server (else answers 403/404). */
async function boardUser(req: Request, res: Response) {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertEventViewer(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return null;
  }
  if (!(await assertModuleEnabled(guildId, 'jobsEnabled'))) {
    res.status(404).json({ success: false, error: 'The job board is switched off in this server.' } satisfies ApiResponse);
    return null;
  }
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId! }, select: { discordId: true, globalName: true, username: true } });
  return { guildId, userId: u.discordId, name: u.globalName ?? u.username };
}

/** A job this server can see, or null (answered 404). */
async function visibleJob(res: Response, guildId: string, jobId: string): Promise<JobRow | null> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: withCrew });
  if (!job || !jobVisibleTo(job, guildId, job.visibility === 'ALLIES' ? await alliesOf(job.guildId) : new Set())) {
    res.status(404).json({ success: false, error: 'Job not found' } satisfies ApiResponse);
    return null;
  }
  return job;
}

const one = async (res: Response, jobId: string) => {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, include: withCrew });
  res.json({ success: true, data: (await toDtos([job]))[0] } satisfies ApiResponse<JobDto>);
};

// GET /api/guilds/:guildId/jobs?view=board|mine
jobsRouter.get('/:guildId/jobs', requireAuth, async (req, res) => {
  const me = await boardUser(req, res);
  if (!me) return;
  const rows = req.query['view'] === 'mine'
    ? await prisma.job.findMany({
        where: { OR: [{ posterId: me.userId }, { crew: { some: { userId: me.userId } } }] },
        orderBy: { createdAt: 'desc' }, take: 50, include: withCrew,
      })
    : await prisma.job.findMany({
        where: {
          status: 'OPEN', expiresAt: { gt: new Date() },
          OR: [{ guildId: me.guildId }, { visibility: 'GLOBAL' }, { visibility: 'ALLIES', guildId: { in: [...(await alliesOf(me.guildId))] } }],
        },
        orderBy: { createdAt: 'desc' }, take: 200, include: withCrew,
      });
  res.json({ success: true, data: await toDtos(rows) } satisfies ApiResponse<JobDto[]>);
});

// POST /api/guilds/:guildId/jobs: any member posts a job
jobsRouter.post('/:guildId/jobs', requireAuth, async (req, res) => {
  const me = await boardUser(req, res);
  if (!me) return;
  const parsed = parseJobInput(req.body);
  if ('error' in parsed) {
    res.status(400).json({ success: false, error: parsed.error } satisfies ApiResponse);
    return;
  }
  const open = await prisma.job.count({ where: { posterId: me.userId, status: 'OPEN', expiresAt: { gt: new Date() } } });
  if (open >= JOB_LIMITS.openPerPerson) {
    res.status(409).json({ success: false, error: `You already have ${JOB_LIMITS.openPerPerson} open jobs. Close one first.` } satisfies ApiResponse);
    return;
  }
  const job = await prisma.job.create({
    data: { ...parsed.job, guildId: me.guildId, posterId: me.userId, posterName: me.name, expiresAt: new Date(Date.now() + JOB_EXPIRY_DAYS * 86_400_000) },
  });
  triggerBot(`/trigger/job/${job.id}`);
  res.status(201);
  await one(res, job.id);
});

// PUT /api/guilds/:guildId/jobs/:jobId: the poster edits an open job
jobsRouter.put('/:guildId/jobs/:jobId', requireAuth, async (req, res) => {
  const me = await boardUser(req, res);
  if (!me) return;
  const job = await visibleJob(res, me.guildId, String(req.params['jobId']));
  if (!job) return;
  if (job.posterId !== me.userId || job.status !== 'OPEN') {
    res.status(403).json({ success: false, error: 'Only the poster can edit an open job.' } satisfies ApiResponse);
    return;
  }
  const parsed = parseJobInput(req.body);
  if ('error' in parsed) {
    res.status(400).json({ success: false, error: parsed.error } satisfies ApiResponse);
    return;
  }
  if (parsed.job.slots < job.crew.length) {
    res.status(400).json({ success: false, error: `${job.crew.length} people already took it; remove some first.` } satisfies ApiResponse);
    return;
  }
  await prisma.job.update({ where: { id: job.id }, data: parsed.job });
  triggerBot(`/trigger/job/${job.id}`);
  await one(res, job.id);
});

// POST /api/guilds/:guildId/jobs/:jobId/take: join the crew (checked with the job held, so it can't overfill)
jobsRouter.post('/:guildId/jobs/:jobId/take', requireAuth, async (req, res) => {
  const me = await boardUser(req, res);
  if (!me) return;
  const job = await visibleJob(res, me.guildId, String(req.params['jobId']));
  if (!job) return;
  const problem = await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ status: string; slots: number; posterId: string; expiresAt: Date }[]>`
      SELECT status, slots, "posterId", "expiresAt" FROM "Job" WHERE id = ${job.id} FOR UPDATE`;
    if (!row) return 'closed' as const;
    const crew = await tx.jobCrew.findMany({ where: { jobId: job.id }, select: { userId: true } });
    const why = jobTakeProblem({ ...row, status: row.expiresAt < new Date() ? 'EXPIRED' : row.status }, crew, me.userId);
    if (why) return why;
    await tx.jobCrew.create({ data: { jobId: job.id, userId: me.userId, username: me.name, guildId: me.guildId } });
    return null;
  });
  if (problem) {
    res.status(409).json({ success: false, error: JOB_TAKE_MESSAGES[problem] } satisfies ApiResponse);
    return;
  }
  triggerBot(`/trigger/job/${job.id}`, { taken: me.userId });
  await one(res, job.id);
});

// POST /api/guilds/:guildId/jobs/:jobId/leave
jobsRouter.post('/:guildId/jobs/:jobId/leave', requireAuth, async (req, res) => {
  const me = await boardUser(req, res);
  if (!me) return;
  const job = await visibleJob(res, me.guildId, String(req.params['jobId']));
  if (!job) return;
  await prisma.jobCrew.deleteMany({ where: { jobId: job.id, userId: me.userId } });
  triggerBot(`/trigger/job/${job.id}`);
  await one(res, job.id);
});

// DELETE /api/guilds/:guildId/jobs/:jobId/crew/:userId: the poster removes someone
jobsRouter.delete('/:guildId/jobs/:jobId/crew/:userId', requireAuth, async (req, res) => {
  const me = await boardUser(req, res);
  if (!me) return;
  const job = await visibleJob(res, me.guildId, String(req.params['jobId']));
  if (!job) return;
  if (job.posterId !== me.userId) {
    res.status(403).json({ success: false, error: 'Only the poster can remove crew.' } satisfies ApiResponse);
    return;
  }
  await prisma.jobCrew.deleteMany({ where: { jobId: job.id, userId: String(req.params['userId']) } });
  triggerBot(`/trigger/job/${job.id}`);
  await one(res, job.id);
});

// POST /api/guilds/:guildId/jobs/:jobId/close { status: DONE | CANCELLED }
// The poster; or the managers of the server it was posted from, to take a job down.
jobsRouter.post('/:guildId/jobs/:jobId/close', requireAuth, async (req, res) => {
  const me = await boardUser(req, res);
  if (!me) return;
  const job = await visibleJob(res, me.guildId, String(req.params['jobId']));
  if (!job) return;
  const status = (req.body as { status?: unknown }).status;
  if (status !== 'DONE' && status !== 'CANCELLED') {
    res.status(400).json({ success: false, error: 'status must be DONE or CANCELLED' } satisfies ApiResponse);
    return;
  }
  const isPoster = job.posterId === me.userId;
  const isHomeManager = job.guildId === me.guildId && (await assertGuildManager(req, me.guildId));
  if (!isPoster && !(isHomeManager && status === 'CANCELLED')) {
    res.status(403).json({ success: false, error: 'Only the poster can close this job.' } satisfies ApiResponse);
    return;
  }
  if (job.status !== 'OPEN') {
    res.status(409).json({ success: false, error: 'This job is already closed.' } satisfies ApiResponse);
    return;
  }
  await prisma.job.update({ where: { id: job.id }, data: { status, closedAt: new Date() } });
  triggerBot(`/trigger/job/${job.id}`);
  await one(res, job.id);
});
