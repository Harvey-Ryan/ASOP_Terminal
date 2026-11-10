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

  wipeInventories: (guildId: string) =>
    api.delete<ApiResponse<{ deleted: number }>>(`/guilds/${guildId}/exchange/inventory/all`).then((r) => r.data!),

  /** Members of this server who have the item. `itemRef` is a game catalog ref. */
  search: (guildId: string, itemRef: string) =>
    api
      .get<ApiResponse<InventorySearchGroup[]>>(
        `/guilds/${guildId}/exchange/search?itemRef=${encodeURIComponent(itemRef)}`,
      )
      .then((r) => r.data ?? []),
};
