import { api } from './client';
import type { ApiResponse, KanbanColumnDto, KanbanCardDto } from '@dem/shared';

export const kanbanApi = {
  getBoard: () =>
    api.get<ApiResponse<KanbanColumnDto[]>>('/kanban').then((r) => r.data ?? []),

  createColumn: (title: string, color: string) =>
    api.post<ApiResponse<KanbanColumnDto>>('/kanban/columns', { title, color }).then((r) => r.data!),

  updateColumn: (id: string, patch: { title?: string; color?: string; sortOrder?: number }) =>
    api.patch<ApiResponse<KanbanColumnDto>>(`/kanban/columns/${id}`, patch).then((r) => r.data!),

  deleteColumn: (id: string) =>
    api.delete<ApiResponse>(`/kanban/columns/${id}`),

  createCard: (columnId: string, title: string, description?: string) =>
    api.post<ApiResponse<KanbanCardDto>>('/kanban/cards', { columnId, title, description }).then((r) => r.data!),

  updateCard: (id: string, patch: { title?: string; description?: string | null; columnId?: string; sortOrder?: number }) =>
    api.patch<ApiResponse<KanbanCardDto>>(`/kanban/cards/${id}`, patch).then((r) => r.data!),

  deleteCard: (id: string) =>
    api.delete<ApiResponse>(`/kanban/cards/${id}`),
};
