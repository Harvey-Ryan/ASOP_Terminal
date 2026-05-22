import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { assertEventViewer } from '../../lib/assertEventViewer.js';
import { triggerBot } from '../../lib/triggerBot.js';
import { ValidationError, requireStr, optStrArr, optEnum, optNonNegInt, optPosInt } from '../../lib/validate.js';
import type {
  ApiResponse,
  LootSessionDto,
  LootItemDto,
  DkpBalanceDto,
  LootMethod,
} from '@dem/shared';

export const lootRouter = Router();

type SessionWithItems = Prisma.LootSessionGetPayload<{
  include: { items: { include: { assignments: true } } };
}>;

const LOOT_METHODS = ['RANDOM_ROLL', 'DKP', 'SNAKE_DRAFT'] as const;

// ── DTO helpers ───────────────────────────────────────────────────────────────

function sessionToDto(s: SessionWithItems): LootSessionDto {
  return {
    id: s.id,
    eventId: s.eventId,
    guildId: s.guildId,
    method: s.method as LootMethod,
    status: s.status as 'OPEN' | 'COMPLETED',
    draftOrder: JSON.parse(s.draftOrder) as string[],
    skipCount: s.skipCount,
    dkpAward: s.dkpAward,
    items: [...s.items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item): LootItemDto => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        excludePrevWinners: item.excludePrevWinners,
        sortOrder: item.sortOrder,
        assignments: item.assignments.map((a) => ({
          id: a.id,
          userId: a.userId,
          username: a.username,
          rollValue: a.rollValue,
          dkpSpent: a.dkpSpent,
          pickNumber: a.pickNumber,
          assignedAt: a.assignedAt.toISOString(),
        })),
      })),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

async function fetchSession(eventId: string): Promise<SessionWithItems | null> {
  return prisma.lootSession.findUnique({
    where: { eventId },
    include: { items: { include: { assignments: true } } },
  });
}

// ── DKP helpers ───────────────────────────────────────────────────────────────

async function applyDkp(guildId: string, userId: string, username: string, amount: number, reason: string) {
  const balance = await prisma.dkpBalance.upsert({
    where: { guildId_userId: { guildId, userId } },
    create: { guildId, userId, username, balance: 0 },
    update: { username },
  });
  await prisma.dkpBalance.update({
    where: { id: balance.id },
    data: { balance: { increment: amount } },
  });
  await prisma.dkpTransaction.create({
    data: { balanceId: balance.id, guildId, userId, username, amount, reason },
  });
}

// ── GET session ───────────────────────────────────────────────────────────────

lootRouter.get('/:guildId/events/:eventId/loot', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };
  if (!(await assertEventViewer(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }
  const session = await fetchSession(eventId).catch(() => null);
  res.json({ success: true, data: session ? sessionToDto(session) : null } satisfies ApiResponse<LootSessionDto | null>);
});

// ── POST create session ───────────────────────────────────────────────────────

lootRouter.post('/:guildId/events/:eventId/loot', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };
  const body = req.body as Record<string, unknown>;

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  let method: LootMethod;
  let dkpAward: number;
  try {
    method = optEnum(body.method, 'method', LOOT_METHODS) ?? 'RANDOM_ROLL';
    dkpAward = optNonNegInt(body.dkpAward, 'dkpAward') ?? 0;
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ success: false, error: err.message } satisfies ApiResponse); return;
    }
    throw err;
  }

  const existing = await fetchSession(eventId);
  if (existing) {
    res.status(409).json({ success: false, error: 'Loot session already exists' } satisfies ApiResponse); return;
  }

  const event = await prisma.event.findFirst({ where: { id: eventId, guildId } });
  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse); return;
  }

  const attendees: string[] = event.confirmedAttendees ? JSON.parse(event.confirmedAttendees) : [];
  const shuffled = [...attendees].sort(() => Math.random() - 0.5);

  const session = await prisma.lootSession.create({
    data: { eventId, guildId, method, dkpAward, draftOrder: JSON.stringify(shuffled) },
    include: { items: { include: { assignments: true } } },
  });

  res.status(201).json({ success: true, data: sessionToDto(session) } satisfies ApiResponse<LootSessionDto>);
});

// ── PATCH session settings ────────────────────────────────────────────────────

lootRouter.patch('/:guildId/events/:eventId/loot', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };
  const body = req.body as Record<string, unknown>;

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  let method: LootMethod | undefined;
  let dkpAward: number | undefined;
  let draftOrder: string[] | undefined;
  try {
    method = optEnum(body.method, 'method', LOOT_METHODS);
    dkpAward = optNonNegInt(body.dkpAward, 'dkpAward');
    draftOrder = body.draftOrder !== undefined
      ? optStrArr(body.draftOrder, 'draftOrder', 500, 30)
      : undefined;
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ success: false, error: err.message } satisfies ApiResponse); return;
    }
    throw err;
  }

  const existing = await prisma.lootSession.findUnique({ where: { eventId } });
  if (!existing) {
    res.status(404).json({ success: false, error: 'No loot session found' } satisfies ApiResponse); return;
  }

  const updated = await prisma.lootSession.update({
    where: { eventId },
    data: {
      ...(method ? { method } : {}),
      ...(dkpAward !== undefined ? { dkpAward } : {}),
      ...(draftOrder ? { draftOrder: JSON.stringify(draftOrder) } : {}),
    },
    include: { items: { include: { assignments: true } } },
  });

  res.json({ success: true, data: sessionToDto(updated) } satisfies ApiResponse<LootSessionDto>);
});

// ── POST add item ─────────────────────────────────────────────────────────────

lootRouter.post('/:guildId/events/:eventId/loot/items', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string; itemId: string };
  const body = req.body as Record<string, unknown>;

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  let name: string;
  let quantity: number;
  let excludePrevWinners: boolean;
  try {
    name = requireStr(body.name, 'name', 200);
    quantity = optPosInt(body.quantity, 'quantity') ?? 1;
    excludePrevWinners = typeof body.excludePrevWinners === 'boolean' ? body.excludePrevWinners : false;
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ success: false, error: err.message } satisfies ApiResponse); return;
    }
    throw err;
  }

  const session = await prisma.lootSession.findUnique({ where: { eventId } });
  if (!session) {
    res.status(404).json({ success: false, error: 'No loot session found' } satisfies ApiResponse); return;
  }

  const count = await prisma.lootItem.count({ where: { sessionId: session.id } });
  const item = await prisma.lootItem.create({
    data: { sessionId: session.id, name, quantity, excludePrevWinners, sortOrder: count },
    include: { assignments: true },
  });

  res.status(201).json({
    success: true,
    data: {
      id: item.id, name: item.name, quantity: item.quantity,
      excludePrevWinners: item.excludePrevWinners, sortOrder: item.sortOrder, assignments: [],
    } satisfies LootItemDto,
  } satisfies ApiResponse<LootItemDto>);
});

// ── PATCH update item ─────────────────────────────────────────────────────────

lootRouter.patch('/:guildId/events/:eventId/loot/items/:itemId', requireAuth, async (req, res) => {
  const { guildId, eventId, itemId } = req.params as { guildId: string; eventId: string; itemId: string };
  const body = req.body as Record<string, unknown>;

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  let name: string | undefined;
  let quantity: number | undefined;
  let excludePrevWinners: boolean | undefined;
  let sortOrder: number | undefined;
  try {
    if (body.name !== undefined) name = requireStr(body.name, 'name', 200);
    quantity = optPosInt(body.quantity, 'quantity');
    if (body.excludePrevWinners !== undefined) {
      if (typeof body.excludePrevWinners !== 'boolean')
        throw new ValidationError('excludePrevWinners must be a boolean');
      excludePrevWinners = body.excludePrevWinners;
    }
    sortOrder = optNonNegInt(body.sortOrder, 'sortOrder');
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ success: false, error: err.message } satisfies ApiResponse); return;
    }
    throw err;
  }

  const session = await prisma.lootSession.findUnique({ where: { eventId } });
  if (!session) {
    res.status(404).json({ success: false, error: 'No loot session' } satisfies ApiResponse); return;
  }

  const item = await prisma.lootItem.update({
    where: { id: itemId, sessionId: session.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(quantity !== undefined ? { quantity } : {}),
      ...(excludePrevWinners !== undefined ? { excludePrevWinners } : {}),
      ...(sortOrder !== undefined ? { sortOrder } : {}),
    },
    include: { assignments: true },
  });

  res.json({
    success: true,
    data: {
      id: item.id, name: item.name, quantity: item.quantity,
      excludePrevWinners: item.excludePrevWinners, sortOrder: item.sortOrder,
      assignments: item.assignments.map((a) => ({
        id: a.id, userId: a.userId, username: a.username,
        rollValue: a.rollValue, dkpSpent: a.dkpSpent, pickNumber: a.pickNumber,
        assignedAt: a.assignedAt.toISOString(),
      })),
    } satisfies LootItemDto,
  } satisfies ApiResponse<LootItemDto>);
});

// ── DELETE item ───────────────────────────────────────────────────────────────

lootRouter.delete('/:guildId/events/:eventId/loot/items/:itemId', requireAuth, async (req, res) => {
  const { guildId, eventId, itemId } = req.params as { guildId: string; eventId: string; itemId: string };
  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }
  const session = await prisma.lootSession.findUnique({ where: { eventId } });
  if (!session) { res.status(404).json({ success: false, error: 'No loot session' } satisfies ApiResponse); return; }
  await prisma.lootItem.delete({ where: { id: itemId, sessionId: session.id } }).catch(() => null);
  res.json({ success: true } satisfies ApiResponse);
});

// ── POST roll (random roll method) ────────────────────────────────────────────

lootRouter.post('/:guildId/events/:eventId/loot/items/:itemId/roll', requireAuth, async (req, res) => {
  const { guildId, eventId, itemId } = req.params as { guildId: string; eventId: string; itemId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  const session = await prisma.lootSession.findUnique({ where: { eventId } });
  if (!session) { res.status(404).json({ success: false, error: 'No loot session' } satisfies ApiResponse); return; }

  const item = await prisma.lootItem.findUnique({ where: { id: itemId, sessionId: session.id } });
  if (!item) { res.status(404).json({ success: false, error: 'Item not found' } satisfies ApiResponse); return; }

  const event = await prisma.event.findFirst({
    where: { id: eventId, guildId },
    include: { rsvps: true },
  });
  if (!event) { res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse); return; }

  const confirmedIds: string[] = event.confirmedAttendees ? JSON.parse(event.confirmedAttendees) : [];
  const usernameMap = new Map(event.rsvps.map((r) => [r.userId, r.username]));

  let eligible = confirmedIds;

  if (item.excludePrevWinners) {
    const prevWinners = await prisma.lootAssignment.findMany({
      where: { item: { sessionId: session.id } },
      select: { userId: true },
    });
    const winnerSet = new Set(prevWinners.map((w) => w.userId));
    eligible = eligible.filter((id) => !winnerSet.has(id));
  }

  if (eligible.length === 0) {
    res.status(400).json({ success: false, error: 'No eligible players to roll' } satisfies ApiResponse); return;
  }

  const rolls = eligible
    .map((userId) => ({
      userId,
      username: usernameMap.get(userId) ?? userId,
      rollValue: Math.floor(Math.random() * 100) + 1,
    }))
    .sort((a, b) => b.rollValue - a.rollValue);

  const winner = rolls[0]!;

  await prisma.lootAssignment.deleteMany({ where: { itemId } });
  await prisma.lootAssignment.create({
    data: { itemId, userId: winner.userId, username: winner.username, rollValue: winner.rollValue },
  });

  triggerBot(`/trigger/complete/${eventId}`);

  res.json({ success: true, data: { rolls, winner } } satisfies ApiResponse);
});

// ── POST assign (DKP / snake draft / manual) ──────────────────────────────────

lootRouter.post('/:guildId/events/:eventId/loot/items/:itemId/assign', requireAuth, async (req, res) => {
  const { guildId, eventId, itemId } = req.params as { guildId: string; eventId: string; itemId: string };
  const body = req.body as Record<string, unknown>;

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  let userId: string;
  let username: string;
  let dkpSpent: number | undefined;
  let pickNumber: number | undefined;
  try {
    userId = requireStr(body.userId, 'userId', 30);
    username = requireStr(body.username, 'username', 100);
    dkpSpent = optNonNegInt(body.dkpSpent, 'dkpSpent');
    pickNumber = optNonNegInt(body.pickNumber, 'pickNumber');
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ success: false, error: err.message } satisfies ApiResponse); return;
    }
    throw err;
  }

  const session = await prisma.lootSession.findUnique({ where: { eventId } });
  if (!session) { res.status(404).json({ success: false, error: 'No loot session' } satisfies ApiResponse); return; }

  await prisma.lootAssignment.deleteMany({ where: { itemId } });
  await prisma.lootAssignment.create({
    data: {
      itemId, userId, username,
      ...(dkpSpent !== undefined ? { dkpSpent } : {}),
      ...(pickNumber !== undefined ? { pickNumber } : {}),
    },
  });

  triggerBot(`/trigger/complete/${eventId}`);
  if (session.method === 'SNAKE_DRAFT') triggerBot(`/trigger/snake-turn/${eventId}`);

  res.json({ success: true } satisfies ApiResponse);
});

// ── POST skip turn (snake draft) ──────────────────────────────────────────────

lootRouter.post('/:guildId/events/:eventId/loot/skip-turn', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  const session = await prisma.lootSession.findUnique({ where: { eventId } });
  if (!session) { res.status(404).json({ success: false, error: 'No loot session' } satisfies ApiResponse); return; }
  if (session.method !== 'SNAKE_DRAFT') { res.status(400).json({ success: false, error: 'Skip is only available for snake draft' } satisfies ApiResponse); return; }
  if (session.status === 'COMPLETED') { res.status(409).json({ success: false, error: 'Session already completed' } satisfies ApiResponse); return; }

  const updated = await prisma.lootSession.update({
    where: { eventId },
    data: { skipCount: { increment: 1 } },
    include: { items: { include: { assignments: true } } },
  });

  triggerBot(`/trigger/snake-turn/${eventId}`);

  res.json({ success: true, data: sessionToDto(updated) } satisfies ApiResponse<LootSessionDto>);
});

// ── DELETE assignment ─────────────────────────────────────────────────────────

lootRouter.delete('/:guildId/events/:eventId/loot/items/:itemId/assign', requireAuth, async (req, res) => {
  const { guildId, eventId, itemId } = req.params as { guildId: string; eventId: string; itemId: string };
  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }
  await prisma.lootAssignment.deleteMany({ where: { itemId } });

  triggerBot(`/trigger/complete/${eventId}`);

  res.json({ success: true } satisfies ApiResponse);
});

// ── POST complete session ─────────────────────────────────────────────────────

lootRouter.post('/:guildId/events/:eventId/loot/complete', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  const session = await fetchSession(eventId);
  if (!session) { res.status(404).json({ success: false, error: 'No loot session' } satisfies ApiResponse); return; }
  if (session.status === 'COMPLETED') {
    res.status(409).json({ success: false, error: 'Session already completed' } satisfies ApiResponse); return;
  }

  const event = await prisma.event.findFirst({ where: { id: eventId, guildId }, include: { rsvps: true } });
  if (!event) { res.status(404).json({ success: false, error: 'Event not found' } satisfies ApiResponse); return; }

  const confirmedIds: string[] = event.confirmedAttendees ? JSON.parse(event.confirmedAttendees) : [];
  const usernameMap = new Map(event.rsvps.map((r) => [r.userId, r.username]));

  if (session.dkpAward > 0) {
    for (const userId of confirmedIds) {
      const username = usernameMap.get(userId) ?? userId;
      await applyDkp(guildId, userId, username, session.dkpAward, `Attendance: ${event.name}`);
    }
  }

  if (session.method === 'DKP') {
    for (const item of session.items) {
      for (const a of item.assignments) {
        if (a.dkpSpent && a.dkpSpent > 0) {
          await applyDkp(guildId, a.userId, a.username, -a.dkpSpent, `Won item: ${item.name}`);
        }
      }
    }
  }

  await prisma.lootSession.update({ where: { id: session.id }, data: { status: 'COMPLETED' } });

  triggerBot(`/trigger/loot/${session.id}`);

  res.json({ success: true, message: 'Loot session completed' } satisfies ApiResponse);
});

// ── GET recent loot ───────────────────────────────────────────────────────────

lootRouter.get('/:guildId/loot/recent', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertEventViewer(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  const session = await prisma.lootSession.findFirst({
    where: { guildId, items: { some: { assignments: { some: {} } } } },
    orderBy: { updatedAt: 'desc' },
    include: {
      items: {
        include: { assignments: { orderBy: { assignedAt: 'desc' }, take: 1 } },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  if (!session) {
    res.json({ success: true, data: null } satisfies ApiResponse);
    return;
  }

  const event = await prisma.event.findUnique({
    where: { id: session.eventId },
    select: { id: true, name: true },
  });

  res.json({
    success: true,
    data: {
      eventId: session.eventId,
      eventName: event?.name ?? 'Unknown event',
      method: session.method,
      sessionUpdatedAt: session.updatedAt.toISOString(),
      items: session.items
        .filter((item) => item.assignments.length > 0)
        .map((item) => ({
          id: item.id,
          name: item.name,
          winner: {
            userId: item.assignments[0]!.userId,
            username: item.assignments[0]!.username,
            rollValue: item.assignments[0]!.rollValue,
            dkpSpent: item.assignments[0]!.dkpSpent,
          },
        })),
    },
  } satisfies ApiResponse);
});

// ── GET DKP balances ──────────────────────────────────────────────────────────

lootRouter.get('/:guildId/dkp', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }
  const balances = await prisma.dkpBalance.findMany({
    where: { guildId },
    orderBy: { balance: 'desc' },
  });
  const data: DkpBalanceDto[] = balances.map((b) => ({
    userId: b.userId,
    username: b.username,
    balance: b.balance,
    updatedAt: b.updatedAt.toISOString(),
  }));
  res.json({ success: true, data } satisfies ApiResponse<DkpBalanceDto[]>);
});
