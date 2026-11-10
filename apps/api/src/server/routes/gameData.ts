// Status of the sc-data worker (our copy of the Star Citizen game data) and
// "Sync now" requests. The worker owns the scdata / scdata_raw schemas; the API
// only reads its status and drops a row into scdata_raw.sync_request.

import { Router } from 'express';
import {
  GAME_DATA_STATUS_SQL,
  GAME_DATA_NOT_SET_UP,
  parseGameDataStatus,
  isGameDataMissingError,
  type ApiResponse,
  type GameDataStatus,
} from '@dem/shared';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { getPlatformAdmin } from '../../lib/platformAdmin.js';

export const gameDataRouter = Router();

export interface GameDataStatusResponse extends GameDataStatus {
  /** Whether the current user may press "Sync now" */
  canRequestSync: boolean;
}

async function readStatus(): Promise<GameDataStatus> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ status: unknown }[]>(GAME_DATA_STATUS_SQL);
    return parseGameDataStatus(rows[0]?.status);
  } catch (err) {
    if (isGameDataMissingError(err)) return GAME_DATA_NOT_SET_UP;
    throw err;
  }
}

// ── GET /api/game-data/status ─────────────────────────────────────────────────

gameDataRouter.get('/game-data/status', requireAuth, async (req, res) => {
  try {
    const [status, admin] = await Promise.all([readStatus(), getPlatformAdmin(req.session.userId)]);
    res.json({ success: true, data: { ...status, canRequestSync: !!admin } } satisfies ApiResponse<GameDataStatusResponse>);
  } catch (err) {
    console.error('[game-data/status]', err);
    res.status(500).json({ success: false, error: 'Could not read game data status' } satisfies ApiResponse);
  }
});

// ── POST /api/game-data/sync ──────────────────────────────────────────────────
// Platform admins only. Queues a forced full re-check; the worker picks it up
// on its next run (every 5 minutes). Repeated clicks don't queue duplicates.

gameDataRouter.post('/game-data/sync', requireAuth, async (req, res) => {
  const admin = await getPlatformAdmin(req.session.userId);
  if (!admin) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO scdata_raw.sync_request (requested_by)
       SELECT $1::text WHERE NOT EXISTS (SELECT 1 FROM scdata_raw.sync_request WHERE handled_at IS NULL)`,
      admin.username,
    );
    const status = await readStatus();
    res.status(202).json({ success: true, data: { ...status, canRequestSync: true } } satisfies ApiResponse<GameDataStatusResponse>);
  } catch (err) {
    if (isGameDataMissingError(err)) {
      res.status(409).json({
        success: false,
        error: 'The game data worker has not run yet, so there is nothing to sync. Set up the sc-data service first.',
      } satisfies ApiResponse);
      return;
    }
    console.error('[game-data/sync]', err);
    res.status(500).json({ success: false, error: 'Could not queue the sync' } satisfies ApiResponse);
  }
});
