import { api } from './client';
import type {
  ApiResponse,
  InventoryEntryDto,
  InventorySearchGroup,
  UpsertInventoryEntryBody,
  MarketplaceListingDto,
  TradeDto,
  TradeMessageDto,
  CreateTradeBody,
} from '@dem/shared';

// Inventory management (guild-scoped — powers the My Inventory tab)
export const inventoryApi = {
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
    api
      .delete<ApiResponse<{ deleted: number }>>(`/guilds/${guildId}/exchange/inventory/all`)
      .then((r) => r.data!),

  search: (guildId: string, itemType: string, externalItemId: number) =>
    api
      .get<ApiResponse<InventorySearchGroup[]>>(
        `/guilds/${guildId}/exchange/search?itemType=${itemType}&externalItemId=${externalItemId}`,
      )
      .then((r) => r.data ?? []),
};

// Marketplace browse (cross-guild)
export const marketplaceApi = {
  browse: (params?: {
    q?: string;
    itemType?: string;
    filterGuildId?: string;
    hasPriceOnly?: boolean;
    sort?: 'newest' | 'price_asc';
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.itemType) qs.set('itemType', params.itemType);
    if (params?.filterGuildId) qs.set('filterGuildId', params.filterGuildId);
    if (params?.hasPriceOnly) qs.set('hasPriceOnly', 'true');
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.limit != null) qs.set('limit', String(params.limit));
    if (params?.offset != null) qs.set('offset', String(params.offset));
    return api
      .get<ApiResponse<MarketplaceListingDto[]>>(`/marketplace/browse?${qs}`)
      .then((r) => r.data ?? []);
  },

  getPendingCount: (guildId: string) =>
    api
      .get<ApiResponse<{ count: number }>>(`/guilds/${guildId}/marketplace/trades/pending-count`)
      .then((r) => r.data?.count ?? 0),

  getUnreadMessageCount: (guildId: string) =>
    api
      .get<ApiResponse<{ count: number }>>(`/guilds/${guildId}/marketplace/trades/unread-count`)
      .then((r) => r.data?.count ?? 0),

  getTrades: (guildId: string) =>
    api
      .get<ApiResponse<{ incoming: TradeDto[]; outgoing: TradeDto[] }>>(
        `/guilds/${guildId}/marketplace/trades`,
      )
      .then((r) => r.data!),

  requestTrade: (guildId: string, body: CreateTradeBody) =>
    api
      .post<ApiResponse<TradeDto>>(`/guilds/${guildId}/marketplace/trades`, body)
      .then((r) => r.data!),

  acceptTrade: (guildId: string, tradeId: string) =>
    api.patch<ApiResponse>(`/guilds/${guildId}/marketplace/trades/${tradeId}/accept`),

  declineTrade: (guildId: string, tradeId: string) =>
    api.patch<ApiResponse>(`/guilds/${guildId}/marketplace/trades/${tradeId}/decline`),

  cancelTrade: (guildId: string, tradeId: string) =>
    api.patch<ApiResponse>(`/guilds/${guildId}/marketplace/trades/${tradeId}/cancel`),

  getMessages: (guildId: string, tradeId: string) =>
    api
      .get<ApiResponse<TradeMessageDto[]>>(`/guilds/${guildId}/marketplace/trades/${tradeId}/messages`)
      .then((r) => r.data ?? []),

  sendMessage: (guildId: string, tradeId: string, body: string) =>
    api
      .post<ApiResponse<TradeMessageDto>>(`/guilds/${guildId}/marketplace/trades/${tradeId}/messages`, { body })
      .then((r) => r.data!),

  markAsRead: (guildId: string, tradeId: string) =>
    api.post<ApiResponse>(`/guilds/${guildId}/marketplace/trades/${tradeId}/messages/read`),
};
