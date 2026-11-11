// POST /api/client-errors: errors from people's browsers (v1.13.0).
//
// The website reports crashes, unhandled errors and pages that failed to load
// (apps/web/src/lib/reportError.ts). Anyone may report, signed in or not, so
// it's limited per address and per session, and every field is size-capped.

import { Router } from 'express';
import type { ApiResponse, ClientErrorReport } from '@dem/shared';
import { webErrors } from '../../lib/errorLog.js';

export const clientErrorsRouter = Router();

const PER_MINUTE = 20;
const recent = new Map<string, { start: number; count: number }>();

function allowed(key: string): boolean {
  const now = Date.now();
  const w = recent.get(key);
  if (!w || now - w.start > 60_000) {
    if (recent.size > 10_000) recent.clear();
    recent.set(key, { start: now, count: 1 });
    return true;
  }
  return ++w.count <= PER_MINUTE;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.slice(0, max) : null);

clientErrorsRouter.post('/client-errors', (req, res) => {
  const body = (req.body ?? {}) as Partial<ClientErrorReport>;
  const message = str(body.message, 2_000);
  if (!message) {
    res.status(400).json({ success: false, error: 'message is required' } satisfies ApiResponse);
    return;
  }
  if (!allowed(`ip:${req.ip}`) || (req.session?.userId && !allowed(`u:${req.session.userId}`))) {
    res.status(429).json({ success: false, error: 'Too many reports' } satisfies ApiResponse);
    return;
  }
  let path: string | null = null;
  try { path = new URL(str(body.url, 1_000) ?? '', 'http://x').pathname; } catch { /* not a URL */ }
  webErrors.record({
    message,
    stack: str(body.stack, 8_000),
    ref: str(body.ref, 12),
    guildId: str(body.guildId, 30) ?? path?.match(/\/servers\/(\d{15,21})/)?.[1] ?? null,
    userId: req.session?.userId ? `user:${req.session.userId}` : null,
    context: { kind: str(body.kind, 40) ?? 'error', page: path, userAgent: str(req.get('user-agent'), 300) },
  });
  res.status(202).json({ success: true, data: null } satisfies ApiResponse);
});
