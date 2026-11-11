// Error monitoring for the API (v1.13.0). See packages/shared/src/errorLog.ts.
//
// - Every request gets a short ref (response header X-Request-Id), kept with
//   the route, server and user in AsyncLocalStorage, so anything logged while
//   handling it is stored with that context.
// - console.error / console.warn are recorded too (installed in index.ts), as
//   most routes log their failures in catch blocks.
// - A 5xx answered without anything recorded still leaves one row.
// - Browsers report their errors to POST /api/client-errors (source "web").

import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { ErrorRecorder, captureConsole, newRef, type ErrorInput, type ErrorRow, type ErrorSource } from '@dem/shared';
import { prisma } from './prisma.js';
import { APP_COMMIT, APP_VERSION } from './appVersion.js';
import { normalizePath, extractGuildId } from './requestLogger.js';

export const RELEASE = `${APP_VERSION}${APP_COMMIT ? `+${APP_COMMIT}` : ''}`;

interface RequestContext {
  ref: string;
  method: string;
  route: string;
  guildId: string | null;
  /** Our User.id; turned into the Discord id when the rows are written */
  sessionUserId: string | null;
  /** Something was recorded for this request */
  recorded: boolean;
}

const als = new AsyncLocalStorage<RequestContext>();

/** The current request's ref, if any (for error replies). */
export const currentRef = (): string | null => als.getStore()?.ref ?? null;

/** Writes rows; our User ids in userId become Discord ids. */
async function writeRows(rows: ErrorRow[]): Promise<void> {
  const internal = [...new Set(rows.map((r) => r.userId).filter((u): u is string => !!u && u.startsWith('user:')))];
  const discordIds = new Map<string, string>();
  if (internal.length > 0) {
    const users = await prisma.user.findMany({ where: { id: { in: internal.map((u) => u.slice(5)) } }, select: { id: true, discordId: true } });
    for (const u of users) discordIds.set(`user:${u.id}`, u.discordId);
  }
  await prisma.errorEvent.createMany({
    data: rows.map((r) => ({ ...r, userId: r.userId?.startsWith('user:') ? discordIds.get(r.userId) ?? null : r.userId })),
  });
}

function makeRecorder(source: ErrorSource, withRequestContext: boolean): ErrorRecorder {
  return new ErrorRecorder({
    source,
    release: RELEASE,
    write: writeRows,
    fallbackLog: (...args) => original.error(...args),
    currentContext: withRequestContext ? () => {
      const ctx = als.getStore();
      if (!ctx) return undefined;
      ctx.recorded = true;
      return {
        ref: ctx.ref, guildId: ctx.guildId,
        userId: ctx.sessionUserId ? `user:${ctx.sessionUserId}` : null,
        context: { method: ctx.method, route: ctx.route },
      };
    } : undefined,
  });
}

// Kept so the recorder can report its own problems without recording them.
const original = { error: console.error.bind(console), warn: console.warn.bind(console) };

export const apiErrors = makeRecorder('api', true);
/** Errors browsers report (POST /api/client-errors): their context comes from the report, not the request that carried it. */
export const webErrors = makeRecorder('web', false);

export function recordError(input: ErrorInput): void {
  apiErrors.record(input);
}

/** From index.ts at start-up: record console.error / console.warn from now on. */
export function captureApiConsole(): void {
  captureConsole(apiErrors);
}

export async function flushErrors(): Promise<void> {
  await Promise.all([apiErrors.flush(), webErrors.flush()]);
}

/** First middleware: a ref per request, and the context errors are stored with. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const ref = newRef();
  res.setHeader('X-Request-Id', ref);
  const ctx: RequestContext = {
    ref,
    method: req.method,
    route: normalizePath(req.path),
    guildId: extractGuildId(req.path),
    sessionUserId: null,
    recorded: false,
  };
  res.on('finish', () => {
    // Answered 5xx without an error being recorded (a route that returned 500 quietly).
    if (res.statusCode >= 500 && !ctx.recorded) {
      als.run(ctx, () => recordError({ message: `${req.method} ${ctx.route} answered ${res.statusCode}`, context: { status: res.statusCode } }));
    }
  });
  als.run(ctx, () => {
    // The session is read after this middleware; fill in the user once it is.
    Object.defineProperty(ctx, 'sessionUserId', { get: () => req.session?.userId ?? null, enumerable: true });
    next();
  });
}

/**
 * Deletes old rows, daily from index.ts: errors after 90 days, the admin log
 * after a year, and the request log (Traffic page, every API request) after
 * 90 days, which until v1.13.0 was never pruned. The request log goes in
 * batches so a large first clean-up doesn't hold the table for long.
 */
export async function pruneOldErrors(): Promise<void> {
  const day = 86_400_000;
  const ninetyDays = new Date(Date.now() - 90 * day);
  const [errors, log] = await Promise.all([
    prisma.errorEvent.deleteMany({ where: { createdAt: { lt: ninetyDays } } }),
    prisma.adminLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 365 * day) } } }),
  ]);
  let requests = 0;
  for (;;) {
    const n = await prisma.$executeRaw`DELETE FROM "RequestLog" WHERE id IN (SELECT id FROM "RequestLog" WHERE "createdAt" < ${ninetyDays} LIMIT 20000)`;
    requests += n;
    if (n < 20000) break;
  }
  if (errors.count + log.count + requests > 0) {
    console.log(`[errorLog] Pruned ${errors.count} error(s), ${log.count} admin log entr(ies) and ${requests} request log row(s) past their keep time.`);
  }
}

/** Every minute from index.ts: the API is alive (Overview page). */
export async function apiHeartbeat(startedAt: Date): Promise<void> {
  const details = JSON.stringify({ memoryMb: Math.round(process.memoryUsage().rss / 1_048_576), uptimeMin: Math.round(process.uptime() / 60) });
  await prisma.serviceHeartbeat.upsert({
    where: { service: 'api' },
    create: { service: 'api', startedAt, beatAt: new Date(), release: RELEASE, details },
    update: { startedAt, beatAt: new Date(), release: RELEASE, details },
  });
}
