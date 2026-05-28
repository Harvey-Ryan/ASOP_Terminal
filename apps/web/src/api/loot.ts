import { api } from './client';
import type {
  ApiResponse,
  LootSessionDto,
  LootItemDto,
  DkpBalanceDto,
  DkpTransactionDto,
  LootAuctionDto,
  CreateLootSessionBody,
  AddLootItemBody,
  AssignLootItemBody,
  LootMethod,
  MyPickDto,
  LootQueueItemDto,
  LootHistorySessionDto,
  LootParticipant,
  CreateStandaloneLootSessionBody,
} from '@dem/shared';

export interface RecentLootWinner {
  userId: string;
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

  skipTurn: (guildId: string, eventId: string) =>
    api.post<ApiResponse<LootSessionDto>>(`${base(guildId, eventId)}/skip-turn`).then((r) => r.data!),

  startDraft: (guildId: string, eventId: string) =>
    api.post<ApiResponse>(`${base(guildId, eventId)}/start-draft`).then((r) => r),

  toggleDelivered: (guildId: string, eventId: string, itemId: string) =>
    api.patch<ApiResponse>(`${base(guildId, eventId)}/items/${itemId}/assign/delivered`).then((r) => r),

  complete: (guildId: string, eventId: string) =>
    api.post<ApiResponse>(`${base(guildId, eventId)}/complete`).then((r) => r),

  getDkp: (guildId: string) =>
    api.get<ApiResponse<DkpBalanceDto[]>>(`/guilds/${guildId}/dkp`).then((r) => r.data!),

  getMyDkp: (guildId: string) =>
    api.get<ApiResponse<DkpBalanceDto>>(`/guilds/${guildId}/dkp/me`).then((r) => r.data!),

  getPlayers: (guildId: string) =>
    api.get<ApiResponse<{ userId: string; username: string }[]>>(`/guilds/${guildId}/dkp/players`).then((r) => r.data ?? []),

  getTransactions: (guildId: string) =>
    api.get<ApiResponse<DkpTransactionDto[]>>(`/guilds/${guildId}/dkp/transactions`).then((r) => r.data ?? []),

  adjustDkp: (guildId: string, body: { userId: string; username: string; amount: number; reason: string }) =>
    api.post<ApiResponse<DkpBalanceDto>>(`/guilds/${guildId}/dkp/adjust`, body).then((r) => r.data!),

  getRecent: (guildId: string) =>
    api.get<ApiResponse<RecentLootEvent | null>>(`/guilds/${guildId}/loot/recent`).then((r) => r.data ?? null),

  getMyPicks: () =>
    api.get<ApiResponse<MyPickDto[]>>('/guilds/loot/my-picks').then((r) => r.data ?? []),

  // ── Auctions ───────────────────────────────────────────────────────────────

  getAuctions: (guildId: string, eventId: string) =>
    api.get<ApiResponse<Record<string, LootAuctionDto>>>(`${base(guildId, eventId)}/auctions`)
      .then((r) => r.data ?? {}),

  startAuction: (guildId: string, eventId: string, itemId: string, body: { durationSecs?: number }) =>
    api.post<ApiResponse<LootAuctionDto>>(`${base(guildId, eventId)}/items/${itemId}/auction`, body)
      .then((r) => r.data!),

  placeBid: (guildId: string, eventId: string, itemId: string, body: { maxBid: number }) =>
    api.post<ApiResponse<LootAuctionDto>>(`${base(guildId, eventId)}/items/${itemId}/auction/bid`, body)
      .then((r) => r.data!),

  closeAuction: (guildId: string, eventId: string, itemId: string) =>
    api.post<ApiResponse<LootAuctionDto>>(`${base(guildId, eventId)}/items/${itemId}/auction/close`, {})
      .then((r) => r.data!),

  cancelAuction: (guildId: string, eventId: string, itemId: string) =>
    api.delete<ApiResponse>(`${base(guildId, eventId)}/items/${itemId}/auction`).then((r) => r),

  // ── Draft queue ────────────────────────────────────────────────────────────

  getQueue: (guildId: string, eventId: string) =>
    api.get<ApiResponse<LootQueueItemDto[]>>(`${base(guildId, eventId)}/queue`)
      .then((r) => r.data ?? []),

  setQueue: (guildId: string, eventId: string, itemIds: string[]) =>
    api.put<ApiResponse>(`${base(guildId, eventId)}/queue`, { itemIds }).then((r) => r),

  // ── Standalone sessions ────────────────────────────────────────────────────

  getHistory: (guildId: string) =>
    api.get<ApiResponse<LootHistorySessionDto[]>>(`/guilds/${guildId}/loot/history`).then((r) => r.data ?? []),

  listSessions: (guildId: string) =>
    api.get<ApiResponse<LootSessionDto[]>>(`/guilds/${guildId}/loot/sessions`).then((r) => r.data ?? []),

  createStandaloneSession: (guildId: string, body: CreateStandaloneLootSessionBody) =>
    api.post<ApiResponse<LootSessionDto>>(`/guilds/${guildId}/loot/sessions`, body).then((r) => r.data!),

  getStandaloneSession: (guildId: string, sessionId: string) =>
    api.get<ApiResponse<LootSessionDto>>(`/guilds/${guildId}/loot/sessions/${sessionId}`).then((r) => r.data!),

  updateStandaloneSession: (guildId: string, sessionId: string, body: { method?: LootMethod; draftOrder?: string[]; participants?: LootParticipant[]; name?: string; totalRounds?: number }) =>
    api.patch<ApiResponse<LootSessionDto>>(`/guilds/${guildId}/loot/sessions/${sessionId}`, body).then((r) => r.data!),

  addStandaloneItem: (guildId: string, sessionId: string, body: AddLootItemBody) =>
    api.post<ApiResponse<LootItemDto>>(`/guilds/${guildId}/loot/sessions/${sessionId}/items`, body).then((r) => r.data!),

  updateStandaloneItem: (guildId: string, sessionId: string, itemId: string, body: Partial<AddLootItemBody>) =>
    api.patch<ApiResponse<LootItemDto>>(`/guilds/${guildId}/loot/sessions/${sessionId}/items/${itemId}`, body).then((r) => r.data!),

  deleteStandaloneItem: (guildId: string, sessionId: string, itemId: string) =>
    api.delete<ApiResponse>(`/guilds/${guildId}/loot/sessions/${sessionId}/items/${itemId}`).then((r) => r),

  rollStandalone: (guildId: string, sessionId: string, itemId: string) =>
    api.post<ApiResponse<{ rolls: { userId: string; username: string; rollValue: number }[]; winner: { userId: string; username: string; rollValue: number } }>>(
      `/guilds/${guildId}/loot/sessions/${sessionId}/items/${itemId}/roll`,
    ).then((r) => r.data!),

  assignStandalone: (guildId: string, sessionId: string, itemId: string, body: AssignLootItemBody) =>
    api.post<ApiResponse>(`/guilds/${guildId}/loot/sessions/${sessionId}/items/${itemId}/assign`, body).then((r) => r),

  clearAssignmentStandalone: (guildId: string, sessionId: string, itemId: string) =>
    api.delete<ApiResponse>(`/guilds/${guildId}/loot/sessions/${sessionId}/items/${itemId}/assign`).then((r) => r),

  skipTurnStandalone: (guildId: string, sessionId: string) =>
    api.post<ApiResponse<LootSessionDto>>(`/guilds/${guildId}/loot/sessions/${sessionId}/skip-turn`).then((r) => r.data!),

  startDraftStandalone: (guildId: string, sessionId: string) =>
    api.post<ApiResponse>(`/guilds/${guildId}/loot/sessions/${sessionId}/start-draft`).then((r) => r),

  getQueueStandalone: (guildId: string, sessionId: string) =>
    api.get<ApiResponse<LootQueueItemDto[]>>(`/guilds/${guildId}/loot/sessions/${sessionId}/queue`).then((r) => r.data ?? []),

  setQueueStandalone: (guildId: string, sessionId: string, itemIds: string[]) =>
    api.put<ApiResponse>(`/guilds/${guildId}/loot/sessions/${sessionId}/queue`, { itemIds }).then((r) => r),

  completeStandalone: (guildId: string, sessionId: string) =>
    api.post<ApiResponse>(`/guilds/${guildId}/loot/sessions/${sessionId}/complete`).then((r) => r),

  commodityRollStandalone: (guildId: string, sessionId: string) =>
    api.post<ApiResponse<LootSessionDto>>(`/guilds/${guildId}/loot/sessions/${sessionId}/commodity-roll`, {}).then((r) => r.data!),

  toggleDeliveredStandalone: (guildId: string, sessionId: string, assignmentId: string) =>
    api.patch<ApiResponse>(`/guilds/${guildId}/loot/sessions/${sessionId}/assignments/${assignmentId}/delivered`, {}).then((r) => r),
};
