import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import type { ApiResponse, KanbanColumnDto, KanbanCardDto } from '@dem/shared';

export const kanbanRouter = Router();

const ADMIN_DISCORD_ID = '1135606224155586571';

async function isAdmin(sessionUserId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: sessionUserId },
    select: { discordId: true },
  });
  return user?.discordId === ADMIN_DISCORD_ID;
}

function toCardDto(c: {
  id: string; columnId: string; title: string; description: string | null;
  sortOrder: number; createdAt: Date; updatedAt: Date;
}): KanbanCardDto {
  return { ...c, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() };
}

function toColumnDto(col: {
  id: string; title: string; color: string; sortOrder: number;
  createdAt: Date; updatedAt: Date;
  cards: { id: string; columnId: string; title: string; description: string | null; sortOrder: number; createdAt: Date; updatedAt: Date }[];
}): KanbanColumnDto {
  return {
    id: col.id,
    title: col.title,
    color: col.color,
    sortOrder: col.sortOrder,
    createdAt: col.createdAt.toISOString(),
    updatedAt: col.updatedAt.toISOString(),
    cards: col.cards.map(toCardDto),
  };
}

// ── GET /api/kanban ───────────────────────────────────────────────────────────
// Public read — all authenticated users can view the board.

kanbanRouter.get('/kanban', requireAuth, async (_req, res) => {
  const columns = await prisma.kanbanColumn.findMany({
    orderBy: { sortOrder: 'asc' },
    include: { cards: { orderBy: { sortOrder: 'asc' } } },
  });
  res.json({ success: true, data: columns.map(toColumnDto) } satisfies ApiResponse<KanbanColumnDto[]>);
});

// ── POST /api/kanban/columns ──────────────────────────────────────────────────

kanbanRouter.post('/kanban/columns', requireAuth, async (req, res) => {
  if (!(await isAdmin(req.session.userId!))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }
  const { title, color } = req.body as { title?: string; color?: string };
  if (!title?.trim()) {
    res.status(400).json({ success: false, error: 'title is required' } satisfies ApiResponse); return;
  }
  const last = await prisma.kanbanColumn.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
  const col = await prisma.kanbanColumn.create({
    data: { title: title.trim(), color: color ?? 'slate', sortOrder: (last?.sortOrder ?? -1) + 1 },
    include: { cards: true },
  });
  res.status(201).json({ success: true, data: toColumnDto(col) } satisfies ApiResponse<KanbanColumnDto>);
});

// ── PATCH /api/kanban/columns/:id ─────────────────────────────────────────────

kanbanRouter.patch('/kanban/columns/:id', requireAuth, async (req, res) => {
  if (!(await isAdmin(req.session.userId!))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }
  const { id } = req.params as { id: string };
  const { title, color, sortOrder } = req.body as { title?: string; color?: string; sortOrder?: number };
  const col = await prisma.kanbanColumn.update({
    where: { id },
    data: {
      ...(title?.trim() ? { title: title.trim() } : {}),
      ...(color ? { color } : {}),
      ...(typeof sortOrder === 'number' ? { sortOrder } : {}),
    },
    include: { cards: { orderBy: { sortOrder: 'asc' } } },
  });
  res.json({ success: true, data: toColumnDto(col) } satisfies ApiResponse<KanbanColumnDto>);
});

// ── DELETE /api/kanban/columns/:id ────────────────────────────────────────────

kanbanRouter.delete('/kanban/columns/:id', requireAuth, async (req, res) => {
  if (!(await isAdmin(req.session.userId!))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }
  const { id } = req.params as { id: string };
  await prisma.kanbanColumn.delete({ where: { id } });
  res.json({ success: true } satisfies ApiResponse);
});

// ── POST /api/kanban/cards ────────────────────────────────────────────────────

kanbanRouter.post('/kanban/cards', requireAuth, async (req, res) => {
  if (!(await isAdmin(req.session.userId!))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }
  const { columnId, title, description } = req.body as { columnId?: string; title?: string; description?: string };
  if (!columnId) {
    res.status(400).json({ success: false, error: 'columnId is required' } satisfies ApiResponse); return;
  }
  if (!title?.trim()) {
    res.status(400).json({ success: false, error: 'title is required' } satisfies ApiResponse); return;
  }
  const last = await prisma.kanbanCard.findFirst({
    where: { columnId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  const card = await prisma.kanbanCard.create({
    data: {
      columnId,
      title: title.trim(),
      description: description?.trim() || null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
  res.status(201).json({ success: true, data: toCardDto(card) } satisfies ApiResponse<KanbanCardDto>);
});

// ── PATCH /api/kanban/cards/:id ───────────────────────────────────────────────

kanbanRouter.patch('/kanban/cards/:id', requireAuth, async (req, res) => {
  if (!(await isAdmin(req.session.userId!))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }
  const { id } = req.params as { id: string };
  const { title, description, columnId, sortOrder } = req.body as {
    title?: string; description?: string | null; columnId?: string; sortOrder?: number;
  };
  const card = await prisma.kanbanCard.update({
    where: { id },
    data: {
      ...(title?.trim() ? { title: title.trim() } : {}),
      ...(description !== undefined ? { description: description?.trim() || null } : {}),
      ...(columnId ? { columnId } : {}),
      ...(typeof sortOrder === 'number' ? { sortOrder } : {}),
    },
  });
  res.json({ success: true, data: toCardDto(card) } satisfies ApiResponse<KanbanCardDto>);
});

// ── DELETE /api/kanban/cards/:id ──────────────────────────────────────────────

kanbanRouter.delete('/kanban/cards/:id', requireAuth, async (req, res) => {
  if (!(await isAdmin(req.session.userId!))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse); return;
  }
  const { id } = req.params as { id: string };
  await prisma.kanbanCard.delete({ where: { id } });
  res.json({ success: true } satisfies ApiResponse);
});
