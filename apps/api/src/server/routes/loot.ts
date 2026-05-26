import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { assertEventViewer } from '../../lib/assertEventViewer.js';
import { assertEventCreator } from '../../lib/assertEventCreator.js';
import { assertLootDraftCreator } from '../../lib/assertLootDraftCreator.js';
import { triggerBot } from '../../lib/triggerBot.js';
import { ValidationError, requireStr, optStrArr, optEnum, optNonNegInt, optPosInt } from '../../lib/validate.js';
import type {
  ApiResponse,
  LootSessionDto,
  LootItemDto,
  LootHistorySessionDto,
  LootParticipant,
  DkpBalanceDto,
  DkpTransactionDto,
  LootMethod,
  MyPickDto,
  LootQueueItemDto,
  CreateStandaloneLootSessionBody,
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
    eventId: s.eventId ?? null,
    name: s.name ?? null,
    guildId: s.guildId,
    method: s.method as LootMethod,
    status: s.status as 'OPEN' | 'COMPLETED',
    draftOrder: JSON.parse(s.draftOrder) as string[],
    draftStarted: s.draftStarted,
    skipCount: s.skipCount,
    totalRounds: s.totalRounds ?? 1,
    dkpAward: s.dkpAward,
    participants: JSON.parse(s.participants) as LootParticipant[],
    ownerId: s.ownerId ?? null,
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
          delivered: a.delivered,
          deliveredAt: a.deliveredAt?.toISOString() ?? null,
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

async function fetchSessionById(sessionId: string): Promise<SessionWithItems | null> {
  return prisma.lootSession.findUnique({
    where: { id: sessionId },
    include: { items: { include: { assignments: true } } },
  });
}

function snakePick(position: number, order: string[]): string | null {
  if (order.length === 0) return null;
  const n = order.length;
  const round = Math.floor(position / n);
  const pos = position % n;
  return round % 2 === 0 ? order[pos]! : order[n - 1 - pos]!;
}

function currentSnakePicker(session: SessionWithItems): string | null {
  const draftOrder: string[] = JSON.parse(session.draftOrder);
  const allCount = session.items.reduce((n, i) => n + i.assignments.length, 0);
  return snakePick(allCount + session.skipCount, draftOrder);
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

// ── GET my active snake draft picks (cross-guild) ────────────────────────────

lootRouter.get('/loot/my-picks', requireAuth, async (req, res) => {
  const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
  if (!dbUser) { res.status(401).json({ success: false, error: 'Unauthorized' } satisfies ApiResponse); return; }

  const sessions = await prisma.lootSession.findMany({
    where: { method: 'SNAKE_DRAFT', status: 'OPEN' },
    include: { items: { include: { assignments: true } } },
  });

  const picks: MyPickDto[] = [];
  for (const session of sessions) {
    const draftOrder: string[] = JSON.parse(session.draftOrder);
    if (!draftOrder.includes(dbUser.discordId)) continue;

    const totalUnassigned = session.items.filter((i) => i.assignments.length === 0).length;
    if (session.items.length > 0 && totalUnassigned === 0) continue;

    const isMyTurn = currentSnakePicker(session) === dbUser.discordId;

    const [event, guild] = await Promise.all([
      session.eventId ? prisma.event.findUnique({ where: { id: session.eventId }, select: { name: true } }) : null,
      prisma.guild.findUnique({ where: { guildId: session.guildId }, select: { name: true } }),
    ]);

    picks.push({
      guildId: session.guildId,
      guildName: guild?.name ?? session.guildId,
      sessionId: session.id,
      eventId: session.eventId ?? null,
      eventName: event?.name ?? session.name ?? 'Unknown',
      itemCount: totalUnassigned,
      isMyTurn,
    });
  }

  res.json({ success: true, data: picks } satisfies ApiResponse<MyPickDto[]>);
});

// ── GET session ───────────────────────────────────────────────────────────────

lootRouter.get('/:guildId/events/:eventId/loot', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };

  const isViewer = await assertEventViewer(req, guildId);
  if (!isViewer) {
    // Allow the current snake draft picker to view their session
    const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (dbUser) {
      const session = await fetchSession(eventId).catch(() => null);
      if (session && session.method === 'SNAKE_DRAFT' && session.status === 'OPEN' &&
          currentSnakePicker(session) === dbUser.discordId) {
        res.json({ success: true, data: sessionToDto(session) } satisfies ApiResponse<LootSessionDto | null>);
        return;
      }
    }
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
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

  triggerBot(`/trigger/loot-session-start/${session.id}`);

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

  if (draftOrder !== undefined && existing.draftStarted) {
    res.status(409).json({ success: false, error: 'Draft has already started — order cannot be changed' } satisfies ApiResponse); return;
  }

  // Deduplicate draft order while preserving first-seen position
  const dedupedOrder = draftOrder ? [...new Set(draftOrder)] : undefined;

  const updated = await prisma.lootSession.update({
    where: { eventId },
    data: {
      ...(method ? { method } : {}),
      ...(dkpAward !== undefined ? { dkpAward } : {}),
      ...(dedupedOrder ? { draftOrder: JSON.stringify(dedupedOrder) } : {}),
    },
    include: { items: { include: { assignments: true } } },
  });

  if (draftOrder !== undefined && !existing.draftStarted) {
    triggerBot(`/trigger/draft-order/${eventId}`);
  }

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
        delivered: a.delivered, deliveredAt: a.deliveredAt?.toISOString() ?? null,
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

  const isManager = await assertGuildManager(req, guildId);

  // Fetch session with items once — needed for both auth check and assignment
  const session = await fetchSession(eventId);
  if (!session) { res.status(404).json({ success: false, error: 'No loot session' } satisfies ApiResponse); return; }

  if (!isManager) {
    // Current snake draft picker may assign to themselves only
    const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
    const isSelf = dbUser && userId === dbUser.discordId;
    const isPickerTurn = session.method === 'SNAKE_DRAFT' && session.status === 'OPEN' &&
      dbUser && currentSnakePicker(session) === dbUser.discordId;
    if (!isSelf || !isPickerTurn) {
      res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
    }
  }

  // For DKP assignments, verify effective balance: raw minus DKP already committed
  // to other items this player has won in this session.
  // The current item is excluded from committed because its assignment is deleted first.
  if (session.method === 'DKP' && dkpSpent !== undefined && dkpSpent > 0) {
    const bal = await prisma.dkpBalance.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });
    const committed = session.items.reduce((sum, i) => {
      if (i.id === itemId) return sum;
      const a = i.assignments.find((a) => a.userId === userId);
      return sum + (a?.dkpSpent ?? 0);
    }, 0);
    const effective = (bal?.balance ?? 0) - committed;
    if (dkpSpent > effective) {
      res.status(400).json({
        success: false,
        error: `Insufficient DKP: bid ${dkpSpent} but only ${effective} available`,
      } satisfies ApiResponse);
      return;
    }
  }

  await prisma.lootAssignment.deleteMany({ where: { itemId } });
  await prisma.lootAssignment.create({
    data: {
      itemId, userId, username,
      ...(dkpSpent !== undefined ? { dkpSpent } : {}),
      ...(pickNumber !== undefined ? { pickNumber } : {}),
    },
  });
  // Remove the just-assigned item from everyone's queue
  await prisma.lootDraftQueue.deleteMany({ where: { itemId, sessionId: session.id } });

  triggerBot(`/trigger/complete/${eventId}`);

  if (session.method === 'SNAKE_DRAFT' && session.status === 'OPEN') {
    const draftOrder: string[] = JSON.parse(session.draftOrder);
    const prevCount = session.items.reduce((n, i) => n + i.assignments.length, 0);
    const wasAssigned = session.items.some((i) => i.id === itemId && i.assignments.length > 0);
    let autoPickCount = prevCount + (wasAssigned ? 0 : 1);

    // Fetch event once for username map + DKP award
    const ev = await prisma.event.findFirst({ where: { id: eventId, guildId }, include: { rsvps: true } });
    const usernameMap = new Map(ev?.rsvps.map((r) => [r.userId, r.username]) ?? []);

    // Auto-pick loop: cascade through consecutive queue-holders until a manual pick is needed
    while (true) {
      const items = await prisma.lootItem.findMany({
        where: { sessionId: session.id },
        include: { assignments: true },
      });
      const allDone = items.every((i) => i.assignments.length > 0);
      const rotationDone = draftOrder.length > 0 && autoPickCount >= draftOrder.length * 2;

      if (allDone || rotationDone) {
        if (ev && session.dkpAward > 0) {
          const confirmedIds: string[] = ev.confirmedAttendees ? JSON.parse(ev.confirmedAttendees) : [];
          for (const uid of confirmedIds) {
            await applyDkp(guildId, uid, usernameMap.get(uid) ?? uid, session.dkpAward, `Attendance: ${ev.name}`);
          }
        }
        await prisma.lootSession.update({ where: { id: session.id }, data: { status: 'COMPLETED' } });
        triggerBot(`/trigger/loot/${session.id}`);
        res.json({ success: true } satisfies ApiResponse);
        return;
      }

      const nextPickerId = snakePick(autoPickCount + session.skipCount, draftOrder);
      if (!nextPickerId) break;

      const queued = await prisma.lootDraftQueue.findMany({
        where: { sessionId: session.id, userId: nextPickerId },
        include: { item: { include: { assignments: true } } },
        orderBy: { priority: 'asc' },
      });

      const topAvailable = queued.find((q: { item: { assignments: unknown[] } }) => q.item.assignments.length === 0) as typeof queued[number] | undefined;
      if (!topAvailable) break; // empty queue or all queued items taken — needs manual pick

      const autoUsername = usernameMap.get(nextPickerId) ?? nextPickerId;
      await prisma.lootAssignment.create({
        data: { itemId: topAvailable.itemId, userId: nextPickerId, username: autoUsername, pickNumber: autoPickCount },
      });
      await prisma.lootDraftQueue.deleteMany({ where: { itemId: topAvailable.itemId, sessionId: session.id } });
      triggerBot(`/trigger/complete/${eventId}`);
      autoPickCount++;
    }

    triggerBot(`/trigger/snake-turn/${eventId}`);
  }

  res.json({ success: true } satisfies ApiResponse);
});

// ── POST skip turn (snake draft) ──────────────────────────────────────────────

lootRouter.post('/:guildId/events/:eventId/loot/skip-turn', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  const session = await fetchSession(eventId);
  if (!session) { res.status(404).json({ success: false, error: 'No loot session' } satisfies ApiResponse); return; }
  if (session.method !== 'SNAKE_DRAFT') { res.status(400).json({ success: false, error: 'Skip is only available for snake draft' } satisfies ApiResponse); return; }
  if (session.status === 'COMPLETED') { res.status(409).json({ success: false, error: 'Session already completed' } satisfies ApiResponse); return; }
  if (!session.draftStarted) { res.status(400).json({ success: false, error: 'Draft has not been started yet' } satisfies ApiResponse); return; }

  const draftOrder: string[] = JSON.parse(session.draftOrder);
  if (draftOrder.length === 0) {
    res.status(400).json({ success: false, error: 'Draft order is empty' } satisfies ApiResponse); return;
  }

  const assignmentCount = session.items.reduce((n, item) => n + item.assignments.length, 0);
  const currentPosition = assignmentCount + session.skipCount;
  const currentPicker = snakePick(currentPosition, draftOrder);

  // Advance past all consecutive positions that belong to the same picker
  // (e.g. at a turnaround C picks twice in a row — one skip should move to B).
  // Cap at draftOrder.length to prevent an infinite loop when there is only one participant.
  let advance = 1;
  while (
    advance < draftOrder.length &&
    snakePick(currentPosition + advance, draftOrder) === currentPicker
  ) {
    advance++;
  }

  const updated = await prisma.lootSession.update({
    where: { eventId },
    data: { skipCount: { increment: advance } },
    include: { items: { include: { assignments: true } } },
  });

  triggerBot(`/trigger/snake-turn/${eventId}`);

  res.json({ success: true, data: sessionToDto(updated) } satisfies ApiResponse<LootSessionDto>);
});

// ── POST start draft ─────────────────────────────────────────────────────────

lootRouter.post('/:guildId/events/:eventId/loot/start-draft', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  const session = await prisma.lootSession.findUnique({ where: { eventId } });
  if (!session || session.method !== 'SNAKE_DRAFT' || session.status !== 'OPEN') {
    res.status(400).json({ success: false, error: 'No open snake draft session for this event' } satisfies ApiResponse); return;
  }

  if (session.draftStarted) {
    res.status(409).json({ success: false, error: 'Draft has already started' } satisfies ApiResponse); return;
  }

  await prisma.lootSession.update({ where: { eventId }, data: { draftStarted: true } });

  triggerBot(`/trigger/snake-turn/${eventId}`);

  res.json({ success: true } satisfies ApiResponse);
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

// ── PATCH toggle delivered ────────────────────────────────────────────────────

lootRouter.patch('/:guildId/events/:eventId/loot/items/:itemId/assign/delivered', requireAuth, async (req, res) => {
  const { guildId, eventId, itemId } = req.params as { guildId: string; eventId: string; itemId: string };

  if (!(await assertEventCreator(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  const session = await prisma.lootSession.findUnique({ where: { eventId } });
  if (!session) { res.status(404).json({ success: false, error: 'No loot session' } satisfies ApiResponse); return; }

  const assignment = await prisma.lootAssignment.findFirst({ where: { itemId } });
  if (!assignment) { res.status(404).json({ success: false, error: 'No assignment for this item' } satisfies ApiResponse); return; }

  const nowDelivered = !assignment.delivered;
  await prisma.lootAssignment.update({
    where: { id: assignment.id },
    data: { delivered: nowDelivered, deliveredAt: nowDelivered ? new Date() : null },
  });

  res.json({ success: true } satisfies ApiResponse);
});

// ── GET draft queue (current user's queue) ────────────────────────────────────

lootRouter.get('/:guildId/events/:eventId/loot/queue', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };

  const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
  if (!dbUser) { res.status(401).json({ success: false, error: 'Unauthorized' } satisfies ApiResponse); return; }

  const session = await fetchSession(eventId);
  if (!session) { res.status(404).json({ success: false, error: 'No loot session' } satisfies ApiResponse); return; }

  // Allow any viewer, or anyone listed in the draft order
  const isViewer = await assertEventViewer(req, guildId);
  if (!isViewer) {
    const draftOrder: string[] = JSON.parse(session.draftOrder);
    if (!draftOrder.includes(dbUser.discordId)) {
      res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
    }
  }

  const queueItems = await prisma.lootDraftQueue.findMany({
    where: { sessionId: session.id, userId: dbUser.discordId },
    include: { item: { include: { assignments: true } } },
    orderBy: { priority: 'asc' },
  });

  const data: LootQueueItemDto[] = queueItems.map((q: { itemId: string; item: { name: string; assignments: unknown[] }; priority: number }) => ({
    itemId: q.itemId,
    itemName: q.item.name,
    priority: q.priority,
    assigned: q.item.assignments.length > 0,
  }));

  res.json({ success: true, data } satisfies ApiResponse<LootQueueItemDto[]>);
});

// ── PUT draft queue (replace current user's queue) ────────────────────────────

lootRouter.put('/:guildId/events/:eventId/loot/queue', requireAuth, async (req, res) => {
  const { guildId, eventId } = req.params as { guildId: string; eventId: string };
  const body = req.body as Record<string, unknown>;

  const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
  if (!dbUser) { res.status(401).json({ success: false, error: 'Unauthorized' } satisfies ApiResponse); return; }

  const session = await fetchSession(eventId);
  if (!session) { res.status(404).json({ success: false, error: 'No loot session' } satisfies ApiResponse); return; }

  const isViewer = await assertEventViewer(req, guildId);
  if (!isViewer) {
    const draftOrder: string[] = JSON.parse(session.draftOrder);
    if (!draftOrder.includes(dbUser.discordId)) {
      res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
    }
  }

  if (!Array.isArray(body.itemIds)) {
    res.status(400).json({ success: false, error: 'itemIds must be an array' } satisfies ApiResponse); return;
  }
  const itemIds = body.itemIds as string[];
  const validIds = new Set(session.items.map((i) => i.id));
  if (!itemIds.every((id) => validIds.has(id))) {
    res.status(400).json({ success: false, error: 'One or more item IDs are invalid' } satisfies ApiResponse); return;
  }

  const userId = dbUser.discordId;
  await prisma.$transaction(async (tx) => {
    await tx.lootDraftQueue.deleteMany({ where: { sessionId: session.id, userId } });
    for (let i = 0; i < itemIds.length; i++) {
      await tx.lootDraftQueue.create({
        data: { sessionId: session.id, userId, itemId: itemIds[i]!, priority: i },
      });
    }
  });

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
          // Cap deduction at the bidder's current balance — guards against balance
          // being manually adjusted between assignment time and completion.
          const bal = await prisma.dkpBalance.findUnique({
            where: { guildId_userId: { guildId, userId: a.userId } },
          });
          const actual = Math.min(a.dkpSpent, bal?.balance ?? 0);
          if (actual > 0) {
            await applyDkp(guildId, a.userId, a.username, -actual, `Won item: ${item.name}`);
          }
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

  const event = session.eventId
    ? await prisma.event.findUnique({ where: { id: session.eventId }, select: { id: true, name: true } })
    : null;

  res.json({
    success: true,
    data: {
      eventId: session.eventId ?? null,
      eventName: event?.name ?? session.name ?? 'Unknown event',
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

// ── GET my DKP balance (viewer-accessible) ────────────────────────────────────

lootRouter.get('/:guildId/dkp/me', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
  if (!dbUser) {
    res.status(401).json({ success: false, error: 'Unauthorized' } satisfies ApiResponse);
    return;
  }
  const bal = await prisma.dkpBalance.findUnique({
    where: { guildId_userId: { guildId, userId: dbUser.discordId } },
  });
  const data: DkpBalanceDto = {
    userId: dbUser.discordId,
    username: bal?.username ?? dbUser.globalName ?? dbUser.username,
    balance: bal?.balance ?? 0,
    updatedAt: bal?.updatedAt.toISOString() ?? new Date().toISOString(),
  };
  res.json({ success: true, data } satisfies ApiResponse<DkpBalanceDto>);
});

// ── GET DKP balances (manager-only leaderboard) ───────────────────────────────

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

// ── GET DKP-eligible players (filtered by viewerRoles if configured) ──────────

lootRouter.get('/:guildId/dkp/players', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertLootDraftCreator(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  const guild = await prisma.guild.findUnique({
    where: { guildId },
    include: { settings: true },
  });
  if (!guild) {
    res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse); return;
  }

  const viewerRoles: string[] = guild.settings
    ? (JSON.parse(guild.settings.viewerRoles) as string[])
    : [];

  // If viewer roles are configured, query Discord for members holding those roles
  if (viewerRoles.length > 0) {
    const botToken = process.env['DISCORD_TOKEN'];
    if (!botToken) {
      res.status(500).json({ success: false, error: 'Bot token not configured' } satisfies ApiResponse); return;
    }

    interface DiscordMember {
      user: { id: string; username: string; global_name: string | null };
      nick: string | null;
      roles: string[];
    }

    // Paginate up to 5 pages × 1000 = 5000 members
    const allMembers: DiscordMember[] = [];
    let after = '0';
    for (let page = 0; page < 5; page++) {
      const url = `https://discord.com/api/v10/guilds/${guildId}/members?limit=1000&after=${after}`;
      const r = await fetch(url, { headers: { Authorization: `Bot ${botToken}` } });
      if (!r.ok) break;
      const batch = (await r.json()) as DiscordMember[];
      if (batch.length === 0) break;
      allMembers.push(...batch);
      if (batch.length < 1000) break;
      after = batch[batch.length - 1]!.user.id;
    }

    const viewerSet = new Set(viewerRoles);
    const filtered = allMembers
      .filter((m) => m.roles.some((r) => viewerSet.has(r)))
      .map((m) => ({
        userId: m.user.id,
        username: m.nick ?? m.user.global_name ?? m.user.username,
      }))
      .sort((a, b) => a.username.localeCompare(b.username));

    res.json({ success: true, data: filtered } satisfies ApiResponse<{ userId: string; username: string }[]>);
    return;
  }

  // No viewer roles configured — fall back to all dashboard-authenticated members
  const members = await prisma.guildMember.findMany({
    where: { guildId: guild.id },
    include: { user: { select: { discordId: true, globalName: true, username: true } } },
    orderBy: { user: { username: 'asc' } },
  });

  const data = members.map((m) => ({
    userId: m.user.discordId,
    username: m.user.globalName ?? m.user.username,
  }));

  res.json({ success: true, data } satisfies ApiResponse<{ userId: string; username: string }[]>);
});

// ── GET DKP transactions (manager = all; member = own) ────────────────────────

lootRouter.get('/:guildId/dkp/transactions', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const isManager = await assertGuildManager(req, guildId);

  let userId: string | undefined;
  if (!isManager) {
    const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!dbUser) {
      res.status(401).json({ success: false, error: 'Unauthorized' } satisfies ApiResponse); return;
    }
    userId = dbUser.discordId;
  }

  const transactions = await prisma.dkpTransaction.findMany({
    where: { guildId, ...(userId ? { userId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const data: DkpTransactionDto[] = transactions.map((t) => ({
    id: t.id,
    userId: t.userId,
    username: t.username,
    amount: t.amount,
    reason: t.reason,
    createdAt: t.createdAt.toISOString(),
  }));

  res.json({ success: true, data } satisfies ApiResponse<DkpTransactionDto[]>);
});

// ── POST DKP adjustment (manager-only) ────────────────────────────────────────

lootRouter.post('/:guildId/dkp/adjust', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  const body = req.body as Record<string, unknown>;
  let targetUserId: string;
  let targetUsername: string;
  let amount: number;
  let reason: string;
  try {
    targetUserId = requireStr(body.userId, 'userId', 30);
    targetUsername = requireStr(body.username, 'username', 100);
    reason = requireStr(body.reason, 'reason', 300);
    if (typeof body.amount !== 'number' || !Number.isInteger(body.amount) || body.amount === 0) {
      throw new ValidationError('amount must be a non-zero integer');
    }
    amount = body.amount as number;
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ success: false, error: err.message } satisfies ApiResponse); return;
    }
    throw err;
  }

  await applyDkp(guildId, targetUserId, targetUsername, amount, reason);

  const bal = await prisma.dkpBalance.findUnique({
    where: { guildId_userId: { guildId, userId: targetUserId } },
  });

  const data: DkpBalanceDto = {
    userId: targetUserId,
    username: targetUsername,
    balance: bal?.balance ?? 0,
    updatedAt: bal?.updatedAt.toISOString() ?? new Date().toISOString(),
  };

  res.json({ success: true, data } satisfies ApiResponse<DkpBalanceDto>);
});

// ════════════════════════════════════════════════════════════════════════════
// ── Standalone loot session routes (:guildId/loot/sessions/...)
// ════════════════════════════════════════════════════════════════════════════

// ── GET history (all sessions server-wide, with items + winners) ──────────────

lootRouter.get('/:guildId/loot/history', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertEventViewer(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }

  const sessions = await prisma.lootSession.findMany({
    where: { guildId },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    include: {
      items: {
        orderBy: { sortOrder: 'asc' },
        include: { assignments: { orderBy: { assignedAt: 'asc' } } },
      },
    },
  });

  const eventIds = [...new Set(sessions.map((s) => s.eventId).filter(Boolean))] as string[];
  const events = eventIds.length
    ? await prisma.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, name: true } })
    : [];
  const eventMap = new Map(events.map((e) => [e.id, e.name]));

  const data: LootHistorySessionDto[] = sessions.map((s) => ({
    id: s.id,
    eventId: s.eventId ?? null,
    eventName: s.eventId ? (eventMap.get(s.eventId) ?? null) : null,
    name: s.name ?? null,
    guildId: s.guildId,
    method: s.method as LootMethod,
    status: s.status as 'OPEN' | 'COMPLETED',
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    items: s.items.map((item) => ({
      id: item.id,
      name: item.name,
      assignments: item.assignments.map((a) => ({
        userId: a.userId,
        username: a.username,
        rollValue: a.rollValue,
        dkpSpent: a.dkpSpent,
        pickNumber: a.pickNumber,
      })),
    })),
  }));

  res.json({ success: true, data } satisfies ApiResponse<LootHistorySessionDto[]>);
});

// ── GET active standalone sessions ────────────────────────────────────────────

lootRouter.get('/:guildId/loot/sessions', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  const isManager = await assertGuildManager(req, guildId);

  const sessions = await prisma.lootSession.findMany({
    where: { guildId, eventId: null, status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
    include: { items: { include: { assignments: true } } },
  });

  if (isManager) {
    res.json({ success: true, data: sessions.map(sessionToDto) } satisfies ApiResponse<LootSessionDto[]>);
    return;
  }

  // Non-managers see sessions they own or are a draft participant in
  const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
  if (!dbUser) { res.status(401).json({ success: false, error: 'Unauthorized' } satisfies ApiResponse); return; }
  const mySessions = sessions.filter((s) => {
    if (s.ownerId === dbUser.discordId) return true;
    const draftOrder: string[] = JSON.parse(s.draftOrder);
    return draftOrder.includes(dbUser.discordId);
  });
  res.json({ success: true, data: mySessions.map(sessionToDto) } satisfies ApiResponse<LootSessionDto[]>);
});

// ── POST create standalone session ────────────────────────────────────────────

lootRouter.post('/:guildId/loot/sessions', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertLootDraftCreator(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }
  const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
  if (!dbUser) { res.status(401).json({ success: false, error: 'Unauthorized' } satisfies ApiResponse); return; }

  const body = req.body as CreateStandaloneLootSessionBody;
  let name: string;
  let method: LootMethod;
  let participants: LootParticipant[];
  let totalRounds: number;
  try {
    name = requireStr(body.name, 'name', 200);
    method = optEnum(body.method, 'method', LOOT_METHODS) ?? 'RANDOM_ROLL';
    participants = Array.isArray(body.participants) ? body.participants : [];
    const rawRounds = optNonNegInt(body.totalRounds, 'totalRounds');
    totalRounds = rawRounds !== undefined ? Math.min(10, Math.max(1, rawRounds)) : 1;
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ success: false, error: err.message } satisfies ApiResponse); return;
    }
    throw err;
  }

  const draftOrder = method === 'SNAKE_DRAFT'
    ? JSON.stringify([...participants].sort(() => Math.random() - 0.5).map((p) => p.userId))
    : '[]';

  const session = await prisma.lootSession.create({
    data: { guildId, name, method, participants: JSON.stringify(participants), draftOrder, totalRounds, ownerId: dbUser.discordId },
    include: { items: { include: { assignments: true } } },
  });

  res.status(201).json({ success: true, data: sessionToDto(session) } satisfies ApiResponse<LootSessionDto>);
});

// ── Helper: resolve standalone session, verify guild ownership ────────────────

async function resolveStandaloneSession(sessionId: string, guildId: string): Promise<SessionWithItems | null> {
  const session = await fetchSessionById(sessionId);
  if (!session || session.guildId !== guildId || session.eventId !== null) return null;
  return session;
}

// Runs the auto-pick cascade for standalone snake draft sessions starting at `startPosition`.
// Returns true if the session was completed inside the cascade.
async function runStandaloneAutoPick(sessionId: string, startPosition: number, skipCount: number, draftOrder: string[], usernameMap: Map<string, string>, totalRounds: number): Promise<boolean> {
  let autoPickCount = startPosition;
  while (true) {
    const items = await prisma.lootItem.findMany({ where: { sessionId }, include: { assignments: true } });
    const allDone = items.every((i) => i.assignments.length > 0);
    const rotationDone = draftOrder.length > 0 && autoPickCount >= draftOrder.length * totalRounds;
    if (allDone || rotationDone) {
      await prisma.lootSession.update({ where: { id: sessionId }, data: { status: 'COMPLETED' } });
      return true;
    }
    const nextPickerId = snakePick(autoPickCount + skipCount, draftOrder);
    if (!nextPickerId) break;
    const queued = await prisma.lootDraftQueue.findMany({
      where: { sessionId, userId: nextPickerId },
      include: { item: { include: { assignments: true } } },
      orderBy: { priority: 'asc' },
    });
    const topAvailable = queued.find((q) => q.item.assignments.length === 0);
    if (!topAvailable) break;
    const autoUsername = usernameMap.get(nextPickerId) ?? nextPickerId;
    await prisma.lootAssignment.create({ data: { itemId: topAvailable.itemId, userId: nextPickerId, username: autoUsername, pickNumber: autoPickCount } });
    await prisma.lootDraftQueue.deleteMany({ where: { itemId: topAvailable.itemId, sessionId } });
    autoPickCount++;
  }
  return false;
}

// ── GET standalone session ────────────────────────────────────────────────────

lootRouter.get('/:guildId/loot/sessions/:sessionId', requireAuth, async (req, res) => {
  const { guildId, sessionId } = req.params as { guildId: string; sessionId: string };
  const session = await resolveStandaloneSession(sessionId, guildId);
  if (!session) { res.status(404).json({ success: false, error: 'Session not found' } satisfies ApiResponse); return; }

  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) {
    const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!dbUser) { res.status(401).json({ success: false, error: 'Unauthorized' } satisfies ApiResponse); return; }
    const isOwner = session.ownerId !== null && dbUser.discordId === session.ownerId;
    const draftOrder: string[] = JSON.parse(session.draftOrder);
    if (!isOwner && !draftOrder.includes(dbUser.discordId)) {
      res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
    }
  }

  res.json({ success: true, data: sessionToDto(session) } satisfies ApiResponse<LootSessionDto>);
});

// ── PATCH standalone session settings ─────────────────────────────────────────

lootRouter.patch('/:guildId/loot/sessions/:sessionId', requireAuth, async (req, res) => {
  const { guildId, sessionId } = req.params as { guildId: string; sessionId: string };
  const isManager = await assertGuildManager(req, guildId);
  const session = await resolveStandaloneSession(sessionId, guildId);
  if (!session) { res.status(404).json({ success: false, error: 'Session not found' } satisfies ApiResponse); return; }
  if (!isManager) {
    const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!dbUser || session.ownerId !== dbUser.discordId) { res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return; }
  }
  const body = req.body as Record<string, unknown>;

  let method: LootMethod | undefined;
  let draftOrder: string[] | undefined;
  let participants: LootParticipant[] | undefined;
  let name: string | undefined;
  let totalRounds: number | undefined;
  try {
    method = optEnum(body.method, 'method', LOOT_METHODS);
    if (body.name !== undefined) name = requireStr(body.name, 'name', 200);
    draftOrder = body.draftOrder !== undefined ? optStrArr(body.draftOrder, 'draftOrder', 500, 30) : undefined;
    participants = Array.isArray(body.participants) ? body.participants as LootParticipant[] : undefined;
    if (body.totalRounds !== undefined) {
      const r = optNonNegInt(body.totalRounds, 'totalRounds');
      totalRounds = r !== undefined ? Math.min(10, Math.max(1, r)) : undefined;
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ success: false, error: err.message } satisfies ApiResponse); return;
    }
    throw err;
  }

  if ((draftOrder !== undefined || totalRounds !== undefined) && session.draftStarted) {
    res.status(409).json({ success: false, error: 'Draft has already started — order cannot be changed' } satisfies ApiResponse); return;
  }

  const dedupedOrder = draftOrder ? [...new Set(draftOrder)] : undefined;

  const updated = await prisma.lootSession.update({
    where: { id: sessionId },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(method ? { method } : {}),
      ...(dedupedOrder !== undefined ? { draftOrder: JSON.stringify(dedupedOrder) } : {}),
      ...(participants !== undefined ? { participants: JSON.stringify(participants) } : {}),
      ...(totalRounds !== undefined ? { totalRounds } : {}),
    },
    include: { items: { include: { assignments: true } } },
  });

  res.json({ success: true, data: sessionToDto(updated) } satisfies ApiResponse<LootSessionDto>);
});

// ── POST add item (standalone) ────────────────────────────────────────────────

lootRouter.post('/:guildId/loot/sessions/:sessionId/items', requireAuth, async (req, res) => {
  const { guildId, sessionId } = req.params as { guildId: string; sessionId: string };
  const isManager = await assertGuildManager(req, guildId);
  const session = await resolveStandaloneSession(sessionId, guildId);
  if (!session) { res.status(404).json({ success: false, error: 'Session not found' } satisfies ApiResponse); return; }
  if (!isManager) {
    const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!dbUser || session.ownerId !== dbUser.discordId) { res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return; }
  }
  const body = req.body as Record<string, unknown>;

  let name: string; let quantity: number; let excludePrevWinners: boolean;
  try {
    name = requireStr(body.name, 'name', 200);
    quantity = optPosInt(body.quantity, 'quantity') ?? 1;
    excludePrevWinners = typeof body.excludePrevWinners === 'boolean' ? body.excludePrevWinners : false;
  } catch (err) {
    if (err instanceof ValidationError) { res.status(400).json({ success: false, error: err.message } satisfies ApiResponse); return; }
    throw err;
  }

  const count = await prisma.lootItem.count({ where: { sessionId } });
  const item = await prisma.lootItem.create({
    data: { sessionId, name, quantity, excludePrevWinners, sortOrder: count },
    include: { assignments: true },
  });

  res.status(201).json({
    success: true,
    data: { id: item.id, name: item.name, quantity: item.quantity, excludePrevWinners: item.excludePrevWinners, sortOrder: item.sortOrder, assignments: [] } satisfies LootItemDto,
  } satisfies ApiResponse<LootItemDto>);
});

// ── PATCH update item (standalone) ────────────────────────────────────────────

lootRouter.patch('/:guildId/loot/sessions/:sessionId/items/:itemId', requireAuth, async (req, res) => {
  const { guildId, sessionId, itemId } = req.params as { guildId: string; sessionId: string; itemId: string };
  const isManager = await assertGuildManager(req, guildId);
  const session = await resolveStandaloneSession(sessionId, guildId);
  if (!session) { res.status(404).json({ success: false, error: 'Session not found' } satisfies ApiResponse); return; }
  if (!isManager) {
    const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!dbUser || session.ownerId !== dbUser.discordId) { res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return; }
  }
  const body = req.body as Record<string, unknown>;

  let name: string | undefined; let quantity: number | undefined; let excludePrevWinners: boolean | undefined; let sortOrder: number | undefined;
  try {
    if (body.name !== undefined) name = requireStr(body.name, 'name', 200);
    quantity = optPosInt(body.quantity, 'quantity');
    if (body.excludePrevWinners !== undefined) {
      if (typeof body.excludePrevWinners !== 'boolean') throw new ValidationError('excludePrevWinners must be a boolean');
      excludePrevWinners = body.excludePrevWinners;
    }
    sortOrder = optNonNegInt(body.sortOrder, 'sortOrder');
  } catch (err) {
    if (err instanceof ValidationError) { res.status(400).json({ success: false, error: err.message } satisfies ApiResponse); return; }
    throw err;
  }

  const item = await prisma.lootItem.update({
    where: { id: itemId, sessionId },
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
        id: a.id, userId: a.userId, username: a.username, rollValue: a.rollValue,
        dkpSpent: a.dkpSpent, pickNumber: a.pickNumber,
        assignedAt: a.assignedAt.toISOString(), delivered: a.delivered, deliveredAt: a.deliveredAt?.toISOString() ?? null,
      })),
    } satisfies LootItemDto,
  } satisfies ApiResponse<LootItemDto>);
});

// ── DELETE item (standalone) ──────────────────────────────────────────────────

lootRouter.delete('/:guildId/loot/sessions/:sessionId/items/:itemId', requireAuth, async (req, res) => {
  const { guildId, sessionId, itemId } = req.params as { guildId: string; sessionId: string; itemId: string };
  const isManager = await assertGuildManager(req, guildId);
  const session = await resolveStandaloneSession(sessionId, guildId);
  if (!session) { res.status(404).json({ success: false, error: 'Session not found' } satisfies ApiResponse); return; }
  if (!isManager) {
    const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!dbUser || session.ownerId !== dbUser.discordId) { res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return; }
  }
  await prisma.lootItem.delete({ where: { id: itemId, sessionId } }).catch(() => null);
  res.json({ success: true } satisfies ApiResponse);
});

// ── POST roll (standalone, RANDOM_ROLL) ───────────────────────────────────────

lootRouter.post('/:guildId/loot/sessions/:sessionId/items/:itemId/roll', requireAuth, async (req, res) => {
  const { guildId, sessionId, itemId } = req.params as { guildId: string; sessionId: string; itemId: string };
  const isManager = await assertGuildManager(req, guildId);
  const session = await resolveStandaloneSession(sessionId, guildId);
  if (!session) { res.status(404).json({ success: false, error: 'Session not found' } satisfies ApiResponse); return; }
  if (!isManager) {
    const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!dbUser || session.ownerId !== dbUser.discordId) { res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return; }
  }
  const item = await prisma.lootItem.findUnique({ where: { id: itemId, sessionId } });
  if (!item) { res.status(404).json({ success: false, error: 'Item not found' } satisfies ApiResponse); return; }

  const participants: LootParticipant[] = JSON.parse(session.participants);
  let eligible = participants.map((p) => p.userId);

  if (item.excludePrevWinners) {
    const prevWinners = await prisma.lootAssignment.findMany({
      where: { item: { sessionId } },
      select: { userId: true },
    });
    const winnerSet = new Set(prevWinners.map((w) => w.userId));
    eligible = eligible.filter((id) => !winnerSet.has(id));
  }

  if (eligible.length === 0) {
    res.status(400).json({ success: false, error: 'No eligible players to roll' } satisfies ApiResponse); return;
  }

  const usernameMap = new Map(participants.map((p) => [p.userId, p.username]));
  const rolls = eligible
    .map((userId) => ({ userId, username: usernameMap.get(userId) ?? userId, rollValue: Math.floor(Math.random() * 100) + 1 }))
    .sort((a, b) => b.rollValue - a.rollValue);

  const winner = rolls[0]!;
  await prisma.lootAssignment.deleteMany({ where: { itemId } });
  await prisma.lootAssignment.create({ data: { itemId, userId: winner.userId, username: winner.username, rollValue: winner.rollValue } });

  res.json({ success: true, data: { rolls, winner } } satisfies ApiResponse);
});

// ── POST assign (standalone) ──────────────────────────────────────────────────

lootRouter.post('/:guildId/loot/sessions/:sessionId/items/:itemId/assign', requireAuth, async (req, res) => {
  const { guildId, sessionId, itemId } = req.params as { guildId: string; sessionId: string; itemId: string };
  const body = req.body as Record<string, unknown>;

  let userId: string; let username: string; let pickNumber: number | undefined;
  try {
    userId = requireStr(body.userId, 'userId', 30);
    username = requireStr(body.username, 'username', 100);
    pickNumber = optNonNegInt(body.pickNumber, 'pickNumber');
  } catch (err) {
    if (err instanceof ValidationError) { res.status(400).json({ success: false, error: err.message } satisfies ApiResponse); return; }
    throw err;
  }

  const isManager = await assertGuildManager(req, guildId);
  const session = await resolveStandaloneSession(sessionId, guildId);
  if (!session) { res.status(404).json({ success: false, error: 'Session not found' } satisfies ApiResponse); return; }

  if (!isManager) {
    const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
    const isOwner = session.ownerId !== null && dbUser?.discordId === session.ownerId;
    if (!isOwner) {
      const isSelf = dbUser && userId === dbUser.discordId;
      const isPickerTurn = session.method === 'SNAKE_DRAFT' && session.status === 'OPEN' &&
        dbUser && currentSnakePicker(session) === dbUser.discordId;
      if (!isSelf || !isPickerTurn) {
        res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
      }
    }
  }

  await prisma.lootAssignment.deleteMany({ where: { itemId } });
  await prisma.lootAssignment.create({ data: { itemId, userId, username, ...(pickNumber !== undefined ? { pickNumber } : {}) } });
  await prisma.lootDraftQueue.deleteMany({ where: { itemId, sessionId } });

  if (session.method === 'SNAKE_DRAFT' && session.status === 'OPEN') {
    const draftOrder: string[] = JSON.parse(session.draftOrder);
    const prevCount = session.items.reduce((n, i) => n + i.assignments.length, 0);
    const wasAssigned = session.items.some((i) => i.id === itemId && i.assignments.length > 0);
    const startPosition = prevCount + (wasAssigned ? 0 : 1);
    const participants: LootParticipant[] = JSON.parse(session.participants);
    const usernameMap = new Map(participants.map((p) => [p.userId, p.username]));

    const completed = await runStandaloneAutoPick(sessionId, startPosition, session.skipCount, draftOrder, usernameMap, session.totalRounds ?? 1);
    if (completed) {
      res.json({ success: true } satisfies ApiResponse);
      return;
    }
    triggerBot(`/trigger/standalone-snake-turn/${sessionId}`);
  }

  res.json({ success: true } satisfies ApiResponse);
});

// ── DELETE assignment (standalone) ────────────────────────────────────────────

lootRouter.delete('/:guildId/loot/sessions/:sessionId/items/:itemId/assign', requireAuth, async (req, res) => {
  const { guildId, sessionId, itemId } = req.params as { guildId: string; sessionId: string; itemId: string };
  const isManager = await assertGuildManager(req, guildId);
  const session = await resolveStandaloneSession(sessionId, guildId);
  if (!session) { res.status(404).json({ success: false, error: 'Session not found' } satisfies ApiResponse); return; }
  if (!isManager) {
    const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!dbUser || session.ownerId !== dbUser.discordId) { res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return; }
  }
  await prisma.lootAssignment.deleteMany({ where: { itemId } });
  res.json({ success: true } satisfies ApiResponse);
});

// ── POST skip turn (standalone) ───────────────────────────────────────────────

lootRouter.post('/:guildId/loot/sessions/:sessionId/skip-turn', requireAuth, async (req, res) => {
  const { guildId, sessionId } = req.params as { guildId: string; sessionId: string };
  const isManager = await assertGuildManager(req, guildId);
  const session = await resolveStandaloneSession(sessionId, guildId);
  if (!session) { res.status(404).json({ success: false, error: 'Session not found' } satisfies ApiResponse); return; }
  if (!isManager) {
    const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!dbUser || session.ownerId !== dbUser.discordId) { res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return; }
  }
  if (session.method !== 'SNAKE_DRAFT') { res.status(400).json({ success: false, error: 'Skip is only for snake draft' } satisfies ApiResponse); return; }
  if (session.status === 'COMPLETED') { res.status(409).json({ success: false, error: 'Session already completed' } satisfies ApiResponse); return; }
  if (!session.draftStarted) { res.status(400).json({ success: false, error: 'Draft has not started' } satisfies ApiResponse); return; }

  const draftOrder: string[] = JSON.parse(session.draftOrder);
  if (draftOrder.length === 0) { res.status(400).json({ success: false, error: 'Draft order is empty' } satisfies ApiResponse); return; }

  const assignmentCount = session.items.reduce((n, item) => n + item.assignments.length, 0);
  const currentPosition = assignmentCount + session.skipCount;
  const currentPicker = snakePick(currentPosition, draftOrder);
  let advance = 1;
  while (advance < draftOrder.length && snakePick(currentPosition + advance, draftOrder) === currentPicker) advance++;

  const updated = await prisma.lootSession.update({
    where: { id: sessionId },
    data: { skipCount: { increment: advance } },
    include: { items: { include: { assignments: true } } },
  });

  const newSkipCount = updated.skipCount;
  const newAssignmentCount = updated.items.reduce((n, i) => n + i.assignments.length, 0);
  const participants: LootParticipant[] = JSON.parse(updated.participants);
  const usernameMap = new Map(participants.map((p) => [p.userId, p.username]));
  await runStandaloneAutoPick(sessionId, newAssignmentCount, newSkipCount, draftOrder, usernameMap, updated.totalRounds ?? 1);

  triggerBot(`/trigger/standalone-snake-turn/${sessionId}`);
  const final = await fetchSessionById(sessionId);
  res.json({ success: true, data: sessionToDto(final!) } satisfies ApiResponse<LootSessionDto>);
});

// ── POST start draft (standalone) ─────────────────────────────────────────────

lootRouter.post('/:guildId/loot/sessions/:sessionId/start-draft', requireAuth, async (req, res) => {
  const { guildId, sessionId } = req.params as { guildId: string; sessionId: string };
  const isManager = await assertGuildManager(req, guildId);
  const session = await resolveStandaloneSession(sessionId, guildId);
  if (!session) { res.status(404).json({ success: false, error: 'Session not found' } satisfies ApiResponse); return; }
  if (!isManager) {
    const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!dbUser || session.ownerId !== dbUser.discordId) { res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return; }
  }
  if (session.method !== 'SNAKE_DRAFT' || session.status !== 'OPEN') {
    res.status(400).json({ success: false, error: 'No open snake draft session' } satisfies ApiResponse); return;
  }
  if (session.draftStarted) { res.status(409).json({ success: false, error: 'Draft already started' } satisfies ApiResponse); return; }
  await prisma.lootSession.update({ where: { id: sessionId }, data: { draftStarted: true } });

  const draftOrder: string[] = JSON.parse(session.draftOrder);
  const participants: LootParticipant[] = JSON.parse(session.participants);
  const usernameMap = new Map(participants.map((p) => [p.userId, p.username]));
  await runStandaloneAutoPick(sessionId, 0, session.skipCount, draftOrder, usernameMap, session.totalRounds ?? 1);

  triggerBot(`/trigger/standalone-snake-turn/${sessionId}`);
  res.json({ success: true } satisfies ApiResponse);
});

// ── GET draft queue (standalone) ──────────────────────────────────────────────

lootRouter.get('/:guildId/loot/sessions/:sessionId/queue', requireAuth, async (req, res) => {
  const { guildId, sessionId } = req.params as { guildId: string; sessionId: string };
  const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
  if (!dbUser) { res.status(401).json({ success: false, error: 'Unauthorized' } satisfies ApiResponse); return; }
  const session = await resolveStandaloneSession(sessionId, guildId);
  if (!session) { res.status(404).json({ success: false, error: 'Session not found' } satisfies ApiResponse); return; }

  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) {
    const draftOrder: string[] = JSON.parse(session.draftOrder);
    if (!draftOrder.includes(dbUser.discordId)) {
      res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
    }
  }

  const queueItems = await prisma.lootDraftQueue.findMany({
    where: { sessionId, userId: dbUser.discordId },
    include: { item: { include: { assignments: true } } },
    orderBy: { priority: 'asc' },
  });

  const data: LootQueueItemDto[] = queueItems.map((q) => ({
    itemId: q.itemId, itemName: q.item.name, priority: q.priority, assigned: q.item.assignments.length > 0,
  }));

  res.json({ success: true, data } satisfies ApiResponse<LootQueueItemDto[]>);
});

// ── PUT draft queue (standalone) ──────────────────────────────────────────────

lootRouter.put('/:guildId/loot/sessions/:sessionId/queue', requireAuth, async (req, res) => {
  const { guildId, sessionId } = req.params as { guildId: string; sessionId: string };
  const body = req.body as Record<string, unknown>;
  const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
  if (!dbUser) { res.status(401).json({ success: false, error: 'Unauthorized' } satisfies ApiResponse); return; }
  const session = await resolveStandaloneSession(sessionId, guildId);
  if (!session) { res.status(404).json({ success: false, error: 'Session not found' } satisfies ApiResponse); return; }

  const isManager = await assertGuildManager(req, guildId);
  if (!isManager) {
    const draftOrder: string[] = JSON.parse(session.draftOrder);
    if (!draftOrder.includes(dbUser.discordId)) {
      res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
    }
  }

  if (!Array.isArray(body.itemIds)) { res.status(400).json({ success: false, error: 'itemIds must be an array' } satisfies ApiResponse); return; }
  const itemIds = body.itemIds as string[];
  const validIds = new Set(session.items.map((i) => i.id));
  if (!itemIds.every((id) => validIds.has(id))) { res.status(400).json({ success: false, error: 'Invalid item IDs' } satisfies ApiResponse); return; }

  const userId = dbUser.discordId;
  await prisma.$transaction(async (tx) => {
    await tx.lootDraftQueue.deleteMany({ where: { sessionId, userId } });
    for (let i = 0; i < itemIds.length; i++) {
      await tx.lootDraftQueue.create({ data: { sessionId, userId, itemId: itemIds[i]!, priority: i } });
    }
  });

  res.json({ success: true } satisfies ApiResponse);
});

// ── POST complete (standalone) ────────────────────────────────────────────────

lootRouter.post('/:guildId/loot/sessions/:sessionId/complete', requireAuth, async (req, res) => {
  const { guildId, sessionId } = req.params as { guildId: string; sessionId: string };
  const isManager = await assertGuildManager(req, guildId);
  const session = await resolveStandaloneSession(sessionId, guildId);
  if (!session) { res.status(404).json({ success: false, error: 'Session not found' } satisfies ApiResponse); return; }
  if (!isManager) {
    const dbUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!dbUser || session.ownerId !== dbUser.discordId) { res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return; }
  }
  if (session.status === 'COMPLETED') { res.status(409).json({ success: false, error: 'Already completed' } satisfies ApiResponse); return; }

  await prisma.lootSession.update({ where: { id: sessionId }, data: { status: 'COMPLETED' } });
  res.json({ success: true } satisfies ApiResponse);
});
