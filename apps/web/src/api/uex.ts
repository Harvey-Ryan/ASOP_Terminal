import { api } from './client';
import type { ApiResponse, UexCategoryDto, UexItemDto, UexCommodityDto, UexSyncStatusDto } from '@dem/shared';

export const uexApi = {
  getStatus: () =>
    api.get<ApiResponse<UexSyncStatusDto>>('/uex/sync/status').then((r) => r.data!),

  triggerSync: (guildId: string) =>
    api.post<ApiResponse<{ logId: string }>>(`/uex/sync?guildId=${guildId}`, {}).then((r) => r.data!),

  getCategories: () =>
    api.get<ApiResponse<UexCategoryDto[]>>('/uex/categories').then((r) => r.data ?? []),

  getItems: (params?: { q?: string; categoryId?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.categoryId !== undefined) qs.set('categoryId', String(params.categoryId));
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<ApiResponse<UexItemDto[]>>(`/uex/items${query}`).then((r) => r.data ?? []);
  },

  getCommodities: (params?: { q?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<ApiResponse<UexCommodityDto[]>>(`/uex/commodities${query}`).then((r) => r.data ?? []);
  },
};
