// Community corrections (v1.53.0). Members submit fixes to numbers the game
// files get wrong, other members confirm them, a data reviewer approves, and
// the website shows the corrected value with credit (or the game files' value,
// if the viewer switches). Rules and lifecycle: packages/shared/src/corrections.ts.
//
//   GET    /api/corrections/live          public: applied corrections (website, bot)
//   GET    /api/corrections?view=open|live|closed|mine   the queue
//   GET    /api/corrections/role          what the signed-in person may do
//   GET    /api/corrections/:id
//   POST   /api/corrections               submit
//   POST   /api/corrections/evidence      upload a screenshot
//   POST   /api/corrections/:id/:action   confirm | approve | reject | dispute | uphold | revert | withdraw
//   GET/POST/DELETE /api/admin/reviewers  (routes/admin.ts)

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  APPLIED_STATUSES,
  CLOSED_STATUSES,
  CONFIRMATIONS_NEEDED,
  CONFIRMS_PER_DAY,
  CORRECTION_KINDS,
  EVIDENCE_PER_DAY,
  OPEN_STATUSES,
  SUBMITS_PER_DAY,
  checkCorrectionValue,
  correctableField,
  correctionActions,
  gameNumber,
  formatCorrectionValue,
  type ApiResponse,
  type CorrectionAction,
  type CorrectionDto,
  type CorrectionRoleDto,
  type CorrectionStatus,
  type LiveCorrectionsDto,
} from '@dem/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { adminLog } from '../../lib/adminLog.js';
import {
  ImageRejected,
  UPLOADS_BASE,
  UPLOAD_MAX_INPUT_BYTES,
  forgetStorageReport,
  optimiseUpload,
} from '../../lib/uploads.js';
import {
  correctionUser,
  gameDataFor,
  loadCorrection,
  recheckForBuild,
  toDto,
  toLiveDto,
  type CorrectionUser,
} from '../../lib/corrections.js';
import { getMiningData } from './gameTools.js';

export const correctionsRouter = Router();

const fail = (res: Response, status: number, error: string) => {
  res.status(status).json({ success: false, error } satisfies ApiResponse);
};
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const DAY_MS = 24 * 60 * 60_000;

/** Screenshots are ours: /uploads/corrections/<file>. Nothing else is accepted as evidence. */
export const EVIDENCE_DIR = () => path.join(UPLOADS_BASE, 'corrections');
const EVIDENCE_URL = /^\/uploads\/corrections\/[A-Za-z0-9_-]+\.webp$/;
const evidenceOk = (v: unknown): v is string => typeof v === 'string' && EVIDENCE_URL.test(v);

async function signedIn(req: Request, res: Response): Promise<CorrectionUser | null> {
  const who = await correctionUser(req);
  if (!who) {
    fail(res, 401, 'Unauthorized – please log in');
    return null;
  }
  return who;
}

// ── Live corrections (public) ────────────────────────────────────────────────

let liveCache: { at: number; data: LiveCorrectionsDto } | null = null;
const LIVE_CACHE_MS = 30_000;
const forgetLive = () => {
  liveCache = null;
};

correctionsRouter.get('/corrections/live', async (_req, res) => {
  if (!liveCache || Date.now() - liveCache.at > LIVE_CACHE_MS) {
    try {
      await recheckForBuild();
    } catch (err) {
      console.error('[corrections] build re-check failed:', err);
    }
    const rows = await prisma.dataCorrection.findMany({
      where: { status: { in: [...APPLIED_STATUSES] } },
      include: { confirmations: { select: { id: true } } },
      orderBy: { approvedAt: 'asc' },
    });
    const build = (await getMiningData().catch(() => null))?.build ?? null;
    liveCache = { at: Date.now(), data: { build, corrections: rows.map((r) => toLiveDto(r as never)) } };
  }
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json({ success: true, data: liveCache.data } satisfies ApiResponse<LiveCorrectionsDto>);
});

// ── Who am I here ────────────────────────────────────────────────────────────

correctionsRouter.get('/corrections/role', async (req, res) => {
  const who = await correctionUser(req);
  const data: CorrectionRoleDto = {
    signedIn: !!who,
    member: !!who?.member,
    reviewer: !!who?.reviewer,
    platformAdmin: !!who?.platformAdmin,
  };
  res.json({ success: true, data } satisfies ApiResponse<CorrectionRoleDto>);
});

// ── The queue ────────────────────────────────────────────────────────────────

const VIEWS: Record<string, readonly CorrectionStatus[]> = {
  open: OPEN_STATUSES,
  live: APPLIED_STATUSES,
  closed: CLOSED_STATUSES,
};

correctionsRouter.get('/corrections', async (req, res) => {
  const who = await correctionUser(req);
  const view = String(req.query['view'] ?? 'open');
  if (view === 'mine' && !who) {
    fail(res, 401, 'Unauthorized – please log in');
    return;
  }
  const where =
    view === 'mine' ? { submittedBy: who!.discordId } : { status: { in: [...(VIEWS[view] ?? OPEN_STATUSES)] } };
  const rows = await prisma.dataCorrection.findMany({
    where,
    include: { confirmations: { orderBy: { createdAt: 'asc' } }, events: { orderBy: { id: 'asc' } } },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });
  res.json({ success: true, data: rows.map((r) => toDto(r, who)) } satisfies ApiResponse<CorrectionDto[]>);
});

correctionsRouter.get('/corrections/:id', async (req, res) => {
  const c = await loadCorrection(String(req.params['id']));
  if (!c) {
    fail(res, 404, 'Not found');
    return;
  }
  res.json({ success: true, data: toDto(c, await correctionUser(req)) } satisfies ApiResponse<CorrectionDto>);
});

// ── Evidence ─────────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = EVIDENCE_DIR();
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) =>
      cb(
        null,
        `${Date.now()}-${randomBytes(6).toString('hex')}${path
          .extname(file.originalname)
          .toLowerCase()
          .replace(/[^.a-z0-9]/g, '')}`,
      ),
  }),
  limits: { fileSize: UPLOAD_MAX_INPUT_BYTES, files: 1 },
  fileFilter: (_req, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only image files are allowed')),
});

/** Evidence uploads per person per day, counted from the history (each piece of evidence ends up in one). */
const evidenceToday = new Map<string, number[]>();

correctionsRouter.post('/corrections/evidence', requireAuth, async (req, res, next) => {
  const who = await signedIn(req, res);
  if (!who) return;
  if (!who.member) {
    fail(res, 403, 'Only members of a server that uses ASOP can send corrections.');
    return;
  }
  const times = (evidenceToday.get(who.discordId) ?? []).filter((t) => Date.now() - t < DAY_MS);
  if (times.length >= EVIDENCE_PER_DAY) {
    fail(res, 429, 'That’s enough screenshots for today. Try again tomorrow.');
    return;
  }
  upload.single('image')(req, res, async (err: unknown) => {
    if (err) {
      fail(res, 400, err instanceof Error ? err.message : 'Upload failed');
      return;
    }
    const file = req.file;
    if (!file) {
      fail(res, 400, 'No image sent');
      return;
    }
    try {
      const out = await optimiseUpload(file.path);
      evidenceToday.set(who.discordId, [...times, Date.now()]);
      forgetStorageReport();
      res.json({ success: true, data: { url: `/uploads/corrections/${out.filename}` } } satisfies ApiResponse<{
        url: string;
      }>);
    } catch (e) {
      fs.rm(file.path, { force: true }, () => undefined);
      if (e instanceof ImageRejected) {
        fail(res, 400, 'That file isn’t a picture we can read.');
        return;
      }
      next(e);
    }
  });
});

// ── Submit ───────────────────────────────────────────────────────────────────

correctionsRouter.post('/corrections', requireAuth, async (req, res) => {
  const who = await signedIn(req, res);
  if (!who) return;
  if (!who.member) {
    fail(res, 403, 'Only members of a server that uses ASOP can send corrections.');
    return;
  }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const kind = text(b['kind'], 40),
    recordKey = text(b['recordKey'], 200),
    field = text(b['field'], 80);
  const note = text(b['note'], 1000);
  if (!CORRECTION_KINDS[kind] || !correctableField(kind, field)) {
    fail(res, 400, 'That stat can’t be corrected.');
    return;
  }
  if (!evidenceOk(b['evidenceUrl'])) {
    fail(res, 400, 'Add a screenshot that shows the right value in game.');
    return;
  }
  if (note.length < 5) {
    fail(res, 400, 'Say where you saw it (a few words is enough).');
    return;
  }

  const recent = await prisma.dataCorrection.count({
    where: { submittedBy: who.discordId, createdAt: { gt: new Date(Date.now() - DAY_MS) } },
  });
  if (recent >= SUBMITS_PER_DAY) {
    fail(res, 429, `You can send ${SUBMITS_PER_DAY} corrections a day. Try again tomorrow.`);
    return;
  }

  const game = await gameDataFor(kind);
  if (!game) {
    fail(res, 503, 'Game data isn’t loaded yet. Try again in a few minutes.');
    return;
  }
  const found = game.find(recordKey);
  if (!found) {
    fail(res, 404, 'That item isn’t in the current game data.');
    return;
  }
  const gameValue = gameNumber(found.record, field);
  const check = checkCorrectionValue(kind, field, gameValue, b['value']);
  if (!check.ok) {
    fail(res, 400, check.error);
    return;
  }

  // One open or applied correction per stat at a time: confirm that one instead.
  const existing = await prisma.dataCorrection.findFirst({
    where: { kind, recordKey, field, status: { in: [...OPEN_STATUSES, ...APPLIED_STATUSES] }, value: check.value },
  });
  if (existing) {
    fail(res, 409, `Someone already sent that correction. Confirm it instead (#${existing.id.slice(-6)}).`);
    return;
  }

  const credit = b['credit'] !== false;
  const created = await prisma.dataCorrection.create({
    data: {
      kind,
      recordKey,
      field,
      recordName: found.name.slice(0, 200),
      gameValue,
      value: check.value,
      note,
      evidenceUrl: b['evidenceUrl'] as string,
      build: game.build,
      checkedBuild: game.build,
      bigChange: check.bigChange,
      submittedBy: who.discordId,
      submittedName: who.username,
      creditName: credit ? who.displayName : null,
      events: {
        create: {
          action: 'submitted',
          actorId: who.discordId,
          actorName: who.username,
          note,
          evidenceUrl: b['evidenceUrl'] as string,
        },
      },
    },
  });
  const full = await loadCorrection(created.id);
  res.status(201).json({ success: true, data: toDto(full!, who) } satisfies ApiResponse<CorrectionDto>);
});

// ── Actions ──────────────────────────────────────────────────────────────────

const ACTIONS = new Set<CorrectionAction>(['confirm', 'approve', 'reject', 'dispute', 'uphold', 'revert', 'withdraw']);
/** Actions that need a reason written down. */
const NEEDS_NOTE = new Set<CorrectionAction>(['reject', 'dispute', 'revert']);

correctionsRouter.post('/corrections/:id/:action', requireAuth, async (req, res) => {
  const action = String(req.params['action']) as CorrectionAction;
  if (!ACTIONS.has(action)) {
    fail(res, 404, 'Not found');
    return;
  }
  const who = await signedIn(req, res);
  if (!who) return;
  const id = String(req.params['id']);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const note = text(b['note'], 1000) || null;
  const evidenceUrl = b['evidenceUrl'] == null || b['evidenceUrl'] === '' ? null : b['evidenceUrl'];
  if (evidenceUrl != null && !evidenceOk(evidenceUrl)) {
    fail(res, 400, 'Screenshots have to be uploaded here.');
    return;
  }
  if (NEEDS_NOTE.has(action) && !note) {
    fail(res, 400, 'Say why, so others can check.');
    return;
  }
  if (action === 'confirm') {
    const today = await prisma.correctionConfirmation.count({
      where: { discordId: who.discordId, createdAt: { gt: new Date(Date.now() - DAY_MS) } },
    });
    if (today >= CONFIRMS_PER_DAY) {
      fail(res, 429, 'That’s enough confirmations for today. Try again tomorrow.');
      return;
    }
  }

  type Outcome = { error: [number, string] } | { log?: { kind: string; summary: string } };
  const outcome: Outcome = await prisma.$transaction(async (tx) => {
    // Hold the row so two people acting at once can't both move it.
    await tx.$queryRaw`SELECT id FROM "DataCorrection" WHERE id = ${id} FOR UPDATE`;
    const c = await tx.dataCorrection.findUnique({
      where: { id },
      include: { confirmations: true, events: { where: { action: 'disputed' }, select: { actorId: true } } },
    });
    if (!c) return { error: [404, 'Not found'] as [number, string] };
    const status = c.status as CorrectionStatus;
    const allowed = correctionActions(
      {
        status,
        submittedBy: c.submittedBy,
        confirmedBy: c.confirmations.map((x) => x.discordId),
        disputedBy: c.events.map((e) => e.actorId).filter((x): x is string => !!x),
      },
      who,
    );
    if (!allowed.includes(action))
      return { error: [403, notAllowedReason(action, status, who, c.submittedBy)] as [number, string] };
    if (action === 'approve' && c.bigChange && b['acknowledgeBigChange'] !== true) {
      return {
        error: [400, 'This is a big change from the game files. Tick that you’ve checked the screenshots.'] as [
          number,
          string,
        ],
      };
    }

    const event = (name: string) =>
      tx.correctionEvent.create({
        data: {
          correctionId: id,
          action: name,
          actorId: who.discordId,
          actorName: who.username,
          note,
          evidenceUrl: evidenceUrl as string | null,
        },
      });
    const review = { reviewedBy: who.discordId, reviewedName: who.username, reviewedAt: new Date(), reviewNote: note };
    const what = `${c.recordName} · ${CORRECTION_KINDS[c.kind]?.fields[c.field]?.label ?? c.field}: ${formatCorrectionValue(c.kind, c.field, c.gameValue)} → ${formatCorrectionValue(c.kind, c.field, c.value)}`;

    switch (action) {
      case 'confirm': {
        await tx.correctionConfirmation.create({
          data: {
            correctionId: id,
            discordId: who.discordId,
            username: who.username,
            evidenceUrl: evidenceUrl as string | null,
            note,
          },
        });
        await event('confirmed');
        if (c.confirmations.length + 1 >= CONFIRMATIONS_NEEDED) {
          await tx.dataCorrection.update({ where: { id }, data: { status: 'REVIEW' } });
          return { log: { kind: 'corrections.ready', summary: `Ready for review: ${what}` } };
        }
        await tx.dataCorrection.update({ where: { id }, data: { updatedAt: new Date() } });
        return {};
      }
      case 'approve': {
        // One applied correction per stat: an older one is replaced.
        await tx.dataCorrection.updateMany({
          where: {
            kind: c.kind,
            recordKey: c.recordKey,
            field: c.field,
            id: { not: id },
            status: { in: [...APPLIED_STATUSES, 'RECHECK'] },
          },
          data: { status: 'SUPERSEDED' },
        });
        const game = await gameDataFor(c.kind);
        const found = game?.find(c.recordKey);
        await tx.dataCorrection.update({
          where: { id },
          data: {
            status: 'LIVE',
            approvedAt: new Date(),
            ...review,
            // A re-check approval adopts the new game value as the baseline.
            ...(status === 'RECHECK' && found ? { gameValue: gameNumber(found.record, c.field) } : {}),
            checkedBuild: game?.build ?? c.checkedBuild,
          },
        });
        await event('approved');
        return { log: { kind: 'corrections.approved', summary: `Approved by ${who.username}: ${what}` } };
      }
      case 'reject':
        await tx.dataCorrection.update({ where: { id }, data: { status: 'REJECTED', ...review } });
        await event('rejected');
        return {};
      case 'dispute':
        await tx.dataCorrection.update({ where: { id }, data: { status: 'DISPUTED' } });
        await event('disputed');
        return { log: { kind: 'corrections.disputed', summary: `Disputed: ${what}. ${note}` } };
      case 'uphold':
        await tx.dataCorrection.update({ where: { id }, data: { status: 'LIVE', ...review } });
        await event('upheld');
        return {};
      case 'revert':
        await tx.dataCorrection.update({ where: { id }, data: { status: 'REVERTED', ...review } });
        await event('reverted');
        return { log: { kind: 'corrections.reverted', summary: `Reverted by ${who.username}: ${what}. ${note}` } };
      case 'withdraw':
        await tx.dataCorrection.update({ where: { id }, data: { status: 'WITHDRAWN' } });
        await event('withdrawn');
        return {};
    }
    return {};
  });

  if ('error' in outcome) {
    fail(res, outcome.error[0], outcome.error[1]);
    return;
  }
  if (outcome.log)
    await adminLog({
      ...outcome.log,
      actor: { discordId: who.discordId, username: who.username },
      details: { correctionId: id },
    });
  forgetLive();
  const full = await loadCorrection(id);
  res.json({ success: true, data: toDto(full!, who) } satisfies ApiResponse<CorrectionDto>);
});

function notAllowedReason(
  action: CorrectionAction,
  status: CorrectionStatus,
  who: CorrectionUser,
  submittedBy: string,
): string {
  const mine = who.discordId === submittedBy;
  if ((action === 'confirm' || action === 'approve' || action === 'dispute') && mine)
    return 'You can’t do that to your own correction.';
  if (action === 'approve' && status !== 'REVIEW' && status !== 'RECHECK') return 'It isn’t waiting for review.';
  if (action === 'approve') return 'Only a data reviewer who didn’t confirm it can approve it.';
  if (['reject', 'uphold', 'revert'].includes(action) && !who.reviewer) return 'Only data reviewers can do that.';
  if (!who.member) return 'Only members of a server that uses ASOP can do that.';
  return 'That can’t be done right now.';
}

/** Tests only. */
export function resetCorrectionsRoutes(): void {
  liveCache = null;
  evidenceToday.clear();
}
