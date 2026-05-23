import { api } from './client';
import type { ApiResponse, InventoryEntryDto, InventorySearchGroup, UpsertInventoryEntryBody } from '@dem/shared';

export const exchangeApi = {
  getMyInventory: (guildId: string) =>
    api
      .get<ApiResponse<InventoryEntryDto[]>>(`/guilds/${guildId}/exchange/inventory`)
      .then((r) => r.data ?? []),

  upsertEntry: (guildId: string, body: UpsertInventoryEntryBody) =>
    api
      .put<ApiResponse<InventoryEntryDto>>(`/guilds/${guildId}/exchange/inventory`, body)
      .then((r) => r.data!),

  deleteEntry: (guildId: string, entryId: string) =>
    api.delete<ApiResponse>(`/guilds/${guildId}/exchange/inventory/${entryId}`),

  search: (guildId: string, itemType: string, externalItemId: number) =>
    api
      .get<ApiResponse<InventorySearchGroup[]>>(
        `/guilds/${guildId}/exchange/search?itemType=${itemType}&externalItemId=${externalItemId}`,
      )
      .then((r) => r.data ?? []),
};
