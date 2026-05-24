import { api } from './client';
import type { ApiResponse, ScSyncStatusDto } from '@dem/shared';

function qs(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  return q.toString() ? `?${q.toString()}` : '';
}

export const scApi = {
  getStatus: () =>
    api.get<ApiResponse<ScSyncStatusDto>>('/sc/sync/status').then((r) => r.data!),

  triggerSync: (guildId: string) =>
    api.post<ApiResponse<{ logId: string }>>(`/sc/sync?guildId=${guildId}`, {}).then((r) => r.data!),

  getBlueprints: (q: string, limit = 50) =>
    api.get<ApiResponse<unknown[]>>(`/sc/blueprints${qs({ q, limit })}`).then((r) => r.data ?? []),

  getShipItems: (q: string, limit = 50) =>
    api.get<ApiResponse<unknown[]>>(`/sc/ship-items${qs({ q, limit })}`).then((r) => r.data ?? []),

  getManufacturers: (q: string, limit = 50) =>
    api.get<ApiResponse<unknown[]>>(`/sc/manufacturers${qs({ q, limit })}`).then((r) => r.data ?? []),

  getCommodities: (q: string, limit = 50) =>
    api.get<ApiResponse<unknown[]>>(`/sc/commodities${qs({ q, limit })}`).then((r) => r.data ?? []),

  getResources: (q: string, kind?: string, limit = 50) =>
    api.get<ApiResponse<unknown[]>>(`/sc/resources${qs({ q, kind, limit })}`).then((r) => r.data ?? []),

  getStarmap: (q: string, limit = 50) =>
    api.get<ApiResponse<unknown[]>>(`/sc/starmap${qs({ q, limit })}`).then((r) => r.data ?? []),

  getTradeLocations: (q: string, limit = 50) =>
    api.get<ApiResponse<unknown[]>>(`/sc/trade-locations${qs({ q, limit })}`).then((r) => r.data ?? []),

  getLabels: (q: string, limit = 50) =>
    api.get<ApiResponse<unknown[]>>(`/sc/labels${qs({ q, limit })}`).then((r) => r.data ?? []),
};
