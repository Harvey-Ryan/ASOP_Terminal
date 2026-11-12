// Wikelo (v1.34.0): his missions, what they reward and what you turn in
// (packages/shared/src/wikelo.ts, from scdata), and each person's own
// checklist (WikeloProgress), which only they see and which never changes
// what anyone else is shown.

import { Router, type Request } from 'express';
import {
  buildWikeloMissions, WIKELO_CONTRACTS_SQL, isGameDataMissingError, parseTicked, wikeloBaseShipName, shipIndex, matchShip,
  type ApiResponse, type WikeloContractJson, type WikeloDataDto, type WikeloMission, type WikeloProgressDto,
} from '@dem/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { listShips } from '../../lib/shipCatalog.js';

export const wikeloRouter = Router();

const fail = (res: import('express').Response, status: number, error: string) => {
  res.status(status).json({ success: false, error } satisfies ApiResponse);
};

// ── The missions: built once per game build ──────────────────────────────────

let cached: { commit: string; at: number; data: WikeloDataDto } | null = null;
/** Ship pictures can arrive after the missions (the ship list refreshes at start-up): rebuild now and then. */
const REBUILD_MS = 60 * 60_000;

/** For tests: missions to use instead of scdata (null = back to scdata). */
let testData: WikeloDataDto | null = null;
export function useWikeloDataForTests(data: WikeloDataDto | null): void { testData = data; cached = null; }

export async function getWikeloData(): Promise<WikeloDataDto | null> {
  if (testData) return testData;
  let source: { commit: string | null; build: string | null } | undefined;
  try {
    source = (await prisma.$queryRawUnsafe<{ commit: string | null; build: string | null }[]>('SELECT commit, build FROM scdata.source LIMIT 1'))[0];
  } catch (err) {
    if (isGameDataMissingError(err)) return null;
    throw err;
  }
  if (!source?.commit) return null;
  if (cached && cached.commit === source.commit && Date.now() - cached.at < REBUILD_MS) return cached.data;

  const rows = await prisma.$queryRawUnsafe<{ uuid: string; data: WikeloContractJson }[]>(WIKELO_CONTRACTS_SQL);
  const missions = buildWikeloMissions(rows);
  await addShipImages(missions).catch((err: unknown) => console.warn('[wikelo] No ship pictures:', err));
  const data: WikeloDataDto = { build: source.build, missions };
  cached = { commit: source.commit, at: Date.now(), data };
  return data;
}

/** The base ship's picture for ship rewards the ship list knows ("…Firebird Wikelo War Special" → Sabre Firebird). */
async function addShipImages(missions: WikeloMission[]): Promise<void> {
  const ships = (await listShips()).filter((s) => s.imageUrl || s.thumbUrl);
  if (!ships.length) return;
  const index = shipIndex(ships);
  for (const m of missions) {
    if (m.category !== 'ships' || m.rewards.length !== 1) continue;
    const items = m.rewards[0] ?? [];
    const main = items.find((i) => /\bWikelo\b/.test(i.name)) ?? items[0];
    if (!main) continue;
    const hit = matchShip(wikeloBaseShipName(main.name), index);
    m.image = hit.status === 'matched' ? hit.ship.imageUrl ?? hit.ship.thumbUrl : null;
  }
}

wikeloRouter.get('/wikelo', requireAuth, async (_req, res) => {
  try {
    const data = await getWikeloData();
    if (!data) { fail(res, 503, 'Game data isn\'t available yet. Try again in a few minutes.'); return; }
    res.json({ success: true, data } satisfies ApiResponse<WikeloDataDto>);
  } catch (err) {
    console.error('[wikelo] GET /wikelo:', err);
    fail(res, 500, 'Could not load Wikelo\'s missions');
  }
});

// ── Your checklist ────────────────────────────────────────────────────────────

async function discordIdOf(req: Request): Promise<string> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId! }, select: { discordId: true } });
  return u.discordId;
}

const toDto = (r: { missionId: string; ticked: string; completedAt: Date | null }): WikeloProgressDto => ({
  missionId: r.missionId, ticked: parseTicked(r.ticked), completedAt: r.completedAt?.toISOString() ?? null,
});

wikeloRouter.get('/me/wikelo', requireAuth, async (req, res) => {
  try {
    const rows = await prisma.wikeloProgress.findMany({ where: { discordId: await discordIdOf(req) } });
    res.json({ success: true, data: rows.map(toDto) } satisfies ApiResponse<WikeloProgressDto[]>);
  } catch (err) {
    console.error('[wikelo] GET /me/wikelo:', err);
    fail(res, 500, 'Could not load your checklist');
  }
});

/**
 * PUT /api/me/wikelo/:missionId { ticked: string[], completed: boolean }:
 * saves one mission's checklist. Nothing ticked and not complete = forgotten.
 */
wikeloRouter.put('/me/wikelo/:missionId', requireAuth, async (req, res) => {
  const body = req.body as { ticked?: unknown; completed?: unknown };
  if (!Array.isArray(body.ticked) || typeof body.completed !== 'boolean') { fail(res, 400, 'Send ticked (a list) and completed (true or false)'); return; }
  try {
    const data = await getWikeloData();
    const mission = data?.missions.find((m) => m.id === req.params.missionId);
    if (!mission) { fail(res, 404, 'That mission isn\'t in the game data'); return; }
    const keys = new Set(mission.turnIn.map((t) => t.key));
    const ticked = [...new Set(body.ticked.filter((k): k is string => typeof k === 'string' && keys.has(k)))];
    const discordId = await discordIdOf(req);
    const where = { discordId_missionId: { discordId, missionId: mission.id } };

    if (!ticked.length && !body.completed) {
      await prisma.wikeloProgress.deleteMany({ where: { discordId, missionId: mission.id } });
      res.json({ success: true, data: { missionId: mission.id, ticked: [], completedAt: null } } satisfies ApiResponse<WikeloProgressDto>);
      return;
    }
    const existing = await prisma.wikeloProgress.findUnique({ where });
    // Keep the first completion time while it stays complete.
    const completedAt = body.completed ? existing?.completedAt ?? new Date() : null;
    const row = await prisma.wikeloProgress.upsert({
      where,
      create: { discordId, missionId: mission.id, ticked: JSON.stringify(ticked), completedAt },
      update: { ticked: JSON.stringify(ticked), completedAt },
    });
    res.json({ success: true, data: toDto(row) } satisfies ApiResponse<WikeloProgressDto>);
  } catch (err) {
    console.error('[wikelo] PUT /me/wikelo:', err);
    fail(res, 500, 'Could not save your checklist');
  }
});
