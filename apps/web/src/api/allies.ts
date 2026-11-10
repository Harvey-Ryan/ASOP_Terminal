import { api } from './client';
import type {
  ApiResponse,
  AlliesOverviewDto,
  AllyDirectoryEntryDto,
  SendAllyRequestBody,
  SendAllyRequestResult,
} from '@dem/shared';

// Ally network (Settings → Allies). Rules: packages/shared/src/allies.ts.

const base = (guildId: string) => `/guilds/${guildId}/allies`;

export const alliesApi = {
  overview: (guildId: string) =>
    api.get<ApiResponse<AlliesOverviewDto>>(base(guildId)).then((r) => r.data!),

  pendingCount: (guildId: string) =>
    api.get<ApiResponse<{ count: number }>>(`${base(guildId)}/pending-count`).then((r) => r.data?.count ?? 0),

  directory: (guildId: string, q: string) =>
    api.get<ApiResponse<AllyDirectoryEntryDto[]>>(`${base(guildId)}/directory?q=${encodeURIComponent(q)}`).then((r) => r.data ?? []),

  sendRequest: (guildId: string, body: SendAllyRequestBody) =>
    api.post<ApiResponse<SendAllyRequestResult>>(`${base(guildId)}/requests`, body).then((r) => r.data!),

  respond: (guildId: string, id: string, action: 'accept' | 'reject' | 'block') =>
    api.post<ApiResponse>(`${base(guildId)}/requests/${id}/${action}`),

  cancelRequest: (guildId: string, id: string) =>
    api.delete<ApiResponse>(`${base(guildId)}/requests/${id}`),

  setAutoAccept: (guildId: string, id: string, autoAcceptTheirEvents: boolean) =>
    api.patch<ApiResponse>(`${base(guildId)}/${id}`, { autoAcceptTheirEvents }),

  removeAlly: (guildId: string, id: string) =>
    api.delete<ApiResponse>(`${base(guildId)}/${id}`),

  unblock: (guildId: string, id: string) =>
    api.delete<ApiResponse>(`${base(guildId)}/blocks/${id}`),

  setListed: (guildId: string, listed: boolean) =>
    api.patch<ApiResponse>(`${base(guildId)}/listing`, { listed }),

  newCode: (guildId: string) =>
    api.post<ApiResponse<{ code: string }>>(`${base(guildId)}/code`).then((r) => r.data!.code),
};
