import { api } from './client';
import type {
  ApiResponse,
  LootSessionDto,
  LootItemDto,
  DkpBalanceDto,
  CreateLootSessionBody,
  AddLootItemBody,
  AssignLootItemBody,
  LootMethod,
} from '@dem/shared';

export interface RecentLootWinner {
  username: string;
  rollValue: number | null;
  dkpSpent: number | null;
}

export interface RecentLootItem {
  id: string;
  name: string;
  winner: RecentLootWinner;
}

export interface RecentLootEvent {
  eventId: string;
  eventName: string;
  method: string;
  sessionUpdatedAt: string;
  items: RecentLootItem[];
}

const base = (guildId: string, eventId: string) => `/guilds/${guildId}/events/${eventId}/loot`;

export const lootApi = {
  getSession: (guildId: string, eventId: string) =>
    api.get<ApiResponse<LootSessionDto | null>>(base(guildId, eventId)).then((r) => r.data ?? null),

  createSession: (guildId: string, eventId: string, body: CreateLootSessionBody) =>
    api.post<ApiResponse<LootSessionDto>>(base(guildId, eventId), body).then((r) => r.data!),

  updateSession: (guildId: string, eventId: string, body: { method?: LootMethod; dkpAward?: number; draftOrder?: string[] }) =>
    api.patch<ApiResponse<LootSessionDto>>(base(guildId, eventId), body).then((r) => r.data!),

  addItem: (guildId: string, eventId: string, body: AddLootItemBody) =>
    api.post<ApiResponse<LootItemDto>>(`${base(guildId, eventId)}/items`, body).then((r) => r.data!),

  updateItem: (guildId: string, eventId: string, itemId: string, body: Partial<AddLootItemBody>) =>
    api.patch<ApiResponse<LootItemDto>>(`${base(guildId, eventId)}/items/${itemId}`, body).then((r) => r.data!),

  deleteItem: (guildId: string, eventId: string, itemId: string) =>
    api.delete<ApiResponse>(`${base(guildId, eventId)}/items/${itemId}`).then((r) => r),

  roll: (guildId: string, eventId: string, itemId: string) =>
    api.post<ApiResponse<{ rolls: { userId: string; username: string; rollValue: number }[]; winner: { userId: string; username: string; rollValue: number } }>>(
      `${base(guildId, eventId)}/items/${itemId}/roll`,
    ).then((r) => r.data!),

  assign: (guildId: string, eventId: string, itemId: string, body: AssignLootItemBody) =>
    api.post<ApiResponse>(`${base(guildId, eventId)}/items/${itemId}/assign`, body).then((r) => r),

  clearAssignment: (guildId: string, eventId: string, itemId: string) =>
    api.delete<ApiResponse>(`${base(guildId, eventId)}/items/${itemId}/assign`).then((r) => r),

  complete: (guildId: string, eventId: string) =>
    api.post<ApiResponse>(`${base(guildId, eventId)}/complete`).then((r) => r),

  getDkp: (guildId: string) =>
    api.get<ApiResponse<DkpBalanceDto[]>>(`/guilds/${guildId}/dkp`).then((r) => r.data!),

  getRecent: (guildId: string) =>
    api.get<ApiResponse<RecentLootEvent | null>>(`/guilds/${guildId}/loot/recent`).then((r) => r.data ?? null),
};
