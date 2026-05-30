import { api } from './client';
import type { ApiResponse, FleetEntryDto, FleetSearchEntry, UpsertFleetEntryBody, FleetyardsModelDto, FleetLinkStatusDto, RsiRosterDto } from '@dem/shared';

export const fleetApi = {
  getMyFleet: (guildId: string) =>
    api
      .get<ApiResponse<FleetEntryDto[]>>(`/guilds/${guildId}/fleet`)
      .then((r) => r.data ?? []),

  upsertEntry: (guildId: string, body: UpsertFleetEntryBody) =>
    api
      .put<ApiResponse<FleetEntryDto>>(`/guilds/${guildId}/fleet`, body)
      .then((r) => r.data!),

  deleteEntry: (guildId: string, entryId: string) =>
    api.delete<ApiResponse>(`/guilds/${guildId}/fleet/${entryId}`),

  wipeFleet: (guildId: string) =>
    api.delete<ApiResponse<{ deleted: number }>>(`/guilds/${guildId}/fleet/all`).then((r) => r.data!),

  search: (guildId: string, slug: string) =>
    api
      .get<ApiResponse<FleetSearchEntry[]>>(`/guilds/${guildId}/fleet/search?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.data ?? []),

  getModels: () =>
    api
      .get<ApiResponse<FleetyardsModelDto[]>>('/fleetyards/models')
      .then((r) => r.data ?? []),

  getLinkStatus: () =>
    api.get<ApiResponse<FleetLinkStatusDto>>('/fleet/link-status').then((r) => r.data!),

  syncHangar: (guildId: string) =>
    api.post<ApiResponse>(`/guilds/${guildId}/fleet/sync`),

  disconnectFY: () =>
    api.delete<ApiResponse>('/fleet/fleetyards'),

  updateRsiHandle: (rsiHandle: string | null) =>
    api.patch<ApiResponse>('/fleet/rsi-handle', { rsiHandle }),

  getRsiRoster: (guildId: string) =>
    api.get<ApiResponse<RsiRosterDto>>(`/guilds/${guildId}/rsi/roster`).then((r) => r.data!),
};
