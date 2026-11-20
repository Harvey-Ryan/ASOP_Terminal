// Community corrections (v1.53.0): who someone is to the corrections system,
// where the game value of a stat comes from, and what a new game build does
// to the corrections already live. Rules: packages/shared/src/corrections.ts.

import type { Request } from 'express';
import {
  APPLIED_STATUSES,
  CORRECTION_KINDS,
  correctionActions,
  gameNumber,
  recheckOnNewBuild,
  rockRecordKey,
  type CorrectionActor,
  type CorrectionDto,
  type CorrectionStatus,
  type LiveCorrectionDto,
  type MiningDataDto,
} from '@dem/shared';
import { prisma } from './prisma.js';
import { isPlatformAdminId } from './platformAdmin.js';
import { getUserGuilds } from './userGuilds.js';
import { adminLog } from './adminLog.js';
import { getMiningData } from '../server/routes/gameTools.js';

export interface CorrectionUser extends CorrectionActor {
  userId: string;
  username: string;
  /** How they're credited by name */
  displayName: string;
  platformAdmin: boolean;
}

/** In a server that has ASOP: their site memberships first, else their Discord server list. */
async function isAsopMember(userId: string): Promise<boolean> {
  if (await prisma.guildMember.findFirst({ where: { userId }, select: { id: true } })) return true;
  try {
    const guilds = await getUserGuilds(userId, 30 * 60_000);
    if (!guilds.length) return false;
    return (await prisma.guild.count({ where: { guildId: { in: guilds.map((g) => g.id) } } })) > 0;
  } catch {
    return false;
  }
}

export async function isDataReviewer(discordId: string): Promise<boolean> {
  if (isPlatformAdminId(discordId)) return true;
  return !!(await prisma.dataReviewer.findUnique({ where: { discordId } }));
}

/** The signed-in person, or null. */
export async function correctionUser(req: Request): Promise<CorrectionUser | null> {
  const userId = req.session?.userId;
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.discordId.startsWith('deleted-')) return null;
  const platformAdmin = isPlatformAdminId(user.discordId);
  const reviewer = await isDataReviewer(user.discordId);
  const member = platformAdmin || reviewer || (await isAsopMember(userId));
  return {
    userId,
    discordId: user.discordId,
    username: user.username,
    displayName: user.globalName || user.username,
    member,
    reviewer,
    platformAdmin,
  };
}

// ── Game values ─────────────────────────────────────────────────────────────

export interface GameRecord {
  name: string;
  record: unknown;
}

/** A record from our game data, by kind and key; null if it isn't there. */
export function findGameRecord(data: MiningDataDto, kind: string, recordKey: string): GameRecord | null {
  switch (kind) {
    case 'mining-laser': {
      const r = data.lasers.find((l) => l.uuid === recordKey);
      return r ? { name: r.name, record: r } : null;
    }
    case 'mining-module': {
      const r = data.modules.find((m) => m.uuid === recordKey);
      return r ? { name: r.name, record: r } : null;
    }
    case 'mining-gadget': {
      const r = (data.gadgets ?? []).find((g) => g.uuid === recordKey);
      return r ? { name: r.name, record: r } : null;
    }
    case 'rock-signature': {
      const r = data.signatures.find((s) => rockRecordKey(s) === recordKey);
      return r ? { name: r.rock, record: r } : null;
    }
    default:
      return null;
  }
}

/** The kinds' game data, with its build. */
export async function gameDataFor(
  kind: string,
): Promise<{ build: string | null; find: (key: string) => GameRecord | null } | null> {
  if (!CORRECTION_KINDS[kind]) return null;
  const data = await getMiningData();
  if (!data) return null;
  return { build: data.build, find: (key) => findGameRecord(data, kind, key) };
}

// ── A new game build ────────────────────────────────────────────────────────

let lastChecked: string | null = null;

/**
 * Once per game build: every applied correction is compared with the new
 * game value. Fixed in the files → RETIRED (credit kept); game value moved
 * elsewhere → RECHECK (not shown until a reviewer looks again).
 */
export async function recheckForBuild(): Promise<void> {
  const data = await getMiningData();
  if (!data?.build || data.build === lastChecked) return;
  const applied = await prisma.dataCorrection.findMany({
    where: { status: { in: [...APPLIED_STATUSES] }, NOT: { checkedBuild: data.build } },
  });
  for (const c of applied) {
    const found = findGameRecord(data, c.kind, c.recordKey);
    const current = found ? gameNumber(found.record, c.field) : null;
    const verdict = found ? recheckOnNewBuild({ gameValue: c.gameValue, value: c.value }, current) : 'recheck';
    if (verdict === 'keep') {
      await prisma.dataCorrection.update({ where: { id: c.id }, data: { checkedBuild: data.build } });
      continue;
    }
    const status: CorrectionStatus = verdict === 'retire' ? 'RETIRED' : 'RECHECK';
    const note =
      verdict === 'retire'
        ? `The game files now say ${current}: fixed by CIG in ${data.build}.`
        : found
          ? `The game files changed from ${c.gameValue} to ${current} in ${data.build}.`
          : `Not in the game data of ${data.build} any more.`;
    await prisma.dataCorrection.update({
      where: { id: c.id },
      data: { status, checkedBuild: data.build, ...(verdict === 'retire' ? { retiredBuild: data.build } : {}) },
    });
    await prisma.correctionEvent.create({
      data: { correctionId: c.id, action: verdict === 'retire' ? 'retired' : 'recheck', note },
    });
    await adminLog({
      kind: verdict === 'retire' ? 'corrections.retired' : 'corrections.recheck',
      summary: `${c.recordName}: ${note}`,
      details: { correctionId: c.id },
    });
  }
  lastChecked = data.build;
}

export function resetCorrectionsForTests(): void {
  lastChecked = null;
}

// ── Shapes ──────────────────────────────────────────────────────────────────

type Row = Awaited<ReturnType<typeof loadCorrection>>;

export function loadCorrection(id: string) {
  return prisma.dataCorrection.findUnique({
    where: { id },
    include: { confirmations: { orderBy: { createdAt: 'asc' } }, events: { orderBy: { id: 'asc' } } },
  });
}

export function toLiveDto(
  c: NonNullable<Row> | (Omit<NonNullable<Row>, 'events'> & { events?: unknown }),
): LiveCorrectionDto {
  return {
    id: c.id,
    kind: c.kind,
    recordKey: c.recordKey,
    field: c.field,
    gameValue: c.gameValue,
    value: c.value,
    credit: c.creditName,
    confirmations: c.confirmations.length,
    disputed: c.status === 'DISPUTED',
    build: c.build,
    approvedAt: c.approvedAt?.toISOString() ?? null,
  };
}

const DISPUTE_ACTIONS = new Set(['disputed']);

export function toDto(c: NonNullable<Row>, who: CorrectionUser | null): CorrectionDto {
  const confirmedBy = c.confirmations.map((x) => x.discordId);
  const disputedBy = c.events.filter((e) => DISPUTE_ACTIONS.has(e.action) && e.actorId).map((e) => e.actorId!);
  const status = c.status as CorrectionStatus;
  return {
    ...toLiveDto(c),
    status,
    recordName: c.recordName,
    note: c.note,
    evidenceUrl: c.evidenceUrl,
    bigChange: c.bigChange,
    submittedAt: c.createdAt.toISOString(),
    reviewer: c.reviewedName,
    reviewNote: c.reviewNote,
    retiredBuild: c.retiredBuild,
    actions: correctionActions({ status, submittedBy: c.submittedBy, confirmedBy, disputedBy }, who),
    mine: !!who && who.discordId === c.submittedBy,
    youConfirmed: !!who && confirmedBy.includes(who.discordId),
    confirmers: who?.reviewer ? c.confirmations.map((x) => x.username) : [],
    history: c.events.map((e) => ({
      action: e.action,
      // Names in the history: the submitter as credited, reviewers by name, others only to reviewers.
      actor:
        e.actorId === c.submittedBy
          ? (c.creditName ?? 'an ASOP member')
          : e.action === 'approved' ||
              e.action === 'rejected' ||
              e.action === 'reverted' ||
              e.action === 'upheld' ||
              who?.reviewer
            ? e.actorName
            : e.actorId
              ? 'a member'
              : null,
      note: e.note,
      evidenceUrl: e.evidenceUrl,
      at: e.createdAt.toISOString(),
    })),
  };
}
